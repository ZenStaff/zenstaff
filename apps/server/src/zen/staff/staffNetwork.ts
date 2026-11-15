// @effect-diagnostics nodeBuiltinImport:off - plain synchronous code called while the adapter builds a session.
// Zen Staff AI staff: no network for the shell of company agent threads while the company's
// "Aprobări" switch is on. Anything that leaves the company has to go through a connector tool,
// which the outbound gate (staffMcp.ts) holds until the manager approves it. Nothing here guesses
// which commands are dangerous: the shell itself runs where there is no network.
//
// - Linux: Claude Code's Bash tool starts its shell through `CLAUDE_CODE_SHELL`; for these threads
//   that is a per-thread launcher named `bash` that runs the real bash inside bubblewrap with an
//   empty network namespace (--unshare-net), an unprivileged user namespace without capabilities,
//   a seccomp filter that refuses new Unix-domain sockets and io_uring (so no daemon socket such
//   as docker.sock or a tmux server can do the request instead), and a read-only file system
//   except the project folder, /tmp and the task folders (with the project's .claude, .mcp.json,
//   .git/config and .git/hooks kept read-only, so the agent cannot plant hooks that run later
//   outside the sandbox). Hooks and stdio MCP servers are started by Claude Code without that
//   shell, so they keep working.
// - macOS: the same launcher runs bash under sandbox-exec with outbound network denied (untested).
// - Windows, or no working sandbox: the shell tools are denied in these threads (fail closed).
// WebFetch runs inside the Claude Code process (outside any shell sandbox), so it is denied too.
// docs/zen-toolchain-security.md, "Company agent threads", lists what each OS enforces.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export type AgentShellIsolation = "bwrap" | "sandbox-exec" | "deny-shell";

export interface AgentShellPlan {
  readonly isolation: AgentShellIsolation;
  /** Folder holding the launcher named `bash` (null when the shell is denied). */
  readonly shellPath: string | null;
  readonly env: Readonly<Record<string, string>>;
  readonly deny: ReadonlyArray<string>;
}

const shQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The user tools run as inside bubblewrap, like the toolchain launchers (never root). */
const SANDBOX_UID = 65534;

// seccomp: refuse socket(AF_UNIX, ...) and io_uring_setup (io_uring can open sockets without the
// socket syscall); socketpair stays (it cannot reach anything outside the process tree).
const SECCOMP_RET_ALLOW = 0x7fff_0000;
const SECCOMP_RET_ERRNO = 0x0005_0000;
const EPERM = 1;
const AF_UNIX = 1;
const IO_URING_SETUP = 425;
const X32_SYSCALL_BIT = 0x4000_0000;

interface SeccompArch {
  readonly audit: number;
  readonly socket: number;
  readonly x32: boolean;
}

const SECCOMP_ARCHES: Readonly<Record<string, SeccompArch>> = {
  x64: { audit: 0xc000_003e, socket: 41, x32: true },
  arm64: { audit: 0xc000_00b7, socket: 198, x32: false },
};

/** A classic BPF program (struct sock_filter[]) for bwrap --seccomp, or null for other CPUs. */
export function unixSocketSeccompFilter(arch: string): Buffer | null {
  const spec = SECCOMP_ARCHES[arch];
  if (spec === undefined) return null;
  const LD_ABS_W = 0x20;
  const JEQ_K = 0x15;
  const RET_K = 0x06;
  const deny = SECCOMP_RET_ERRNO | EPERM;
  // [code, jt, jf, k]; jumps count from the next instruction.
  const program: Array<[number, number, number, number]> = [
    [LD_ABS_W, 0, 0, 4], // 0: arch
    [JEQ_K, 1, 0, spec.audit], // 1: native arch -> 3
    [RET_K, 0, 0, deny], // 2: any other ABI is refused
    [LD_ABS_W, 0, 0, 0], // 3: syscall number
    [JEQ_K, 4, 0, IO_URING_SETUP], // 4: -> 9
    [JEQ_K, 3, 0, spec.x32 ? X32_SYSCALL_BIT | IO_URING_SETUP : IO_URING_SETUP], // 5: -> 9
    [JEQ_K, 3, 0, spec.socket], // 6: -> 10
    [JEQ_K, 2, 0, spec.x32 ? X32_SYSCALL_BIT | spec.socket : spec.socket], // 7: -> 10
    [RET_K, 0, 0, SECCOMP_RET_ALLOW], // 8
    [RET_K, 0, 0, deny], // 9: io_uring
    [LD_ABS_W, 0, 0, 16], // 10: args[0] (low 32 bits, little endian)
    [JEQ_K, 0, 1, AF_UNIX], // 11: -> 12 / 13
    [RET_K, 0, 0, deny], // 12: a Unix-domain socket
    [RET_K, 0, 0, SECCOMP_RET_ALLOW], // 13
  ];
  const buffer = Buffer.alloc(program.length * 8);
  program.forEach(([code, jt, jf, k], index) => {
    buffer.writeUInt16LE(code, index * 8);
    buffer.writeUInt8(jt, index * 8 + 2);
    buffer.writeUInt8(jf, index * 8 + 3);
    buffer.writeUInt32LE(k >>> 0, index * 8 + 4);
  });
  return buffer;
}

export interface NoNetworkShellInput {
  readonly sandboxProgram: string;
  /** The real bash. */
  readonly bash: string;
  /** The project folder (writable). */
  readonly projectDir: string;
  /** Other writable folders (task folders, /tmp). */
  readonly writableDirs: ReadonlyArray<string>;
  /** Absolute path of the seccomp program written next to the launcher. */
  readonly seccompFile: string | null;
  readonly homeDir: string | null;
}

/** Files and folders inside the project that are run later by tools outside the sandbox. */
function protectedProjectPaths(projectDir: string): string[] {
  return [
    NodePath.join(projectDir, ".claude"),
    NodePath.join(projectDir, ".mcp.json"),
    NodePath.join(projectDir, ".git", "config"),
    NodePath.join(projectDir, ".git", "hooks"),
  ];
}

/** bubblewrap arguments for the agent's shell, before the bash command line. */
export function noNetworkBwrapArgs(input: NoNetworkShellInput): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--uid",
    String(SANDBOX_UID),
    "--gid",
    String(SANDBOX_UID),
    "--cap-drop",
    "ALL",
    "--unshare-net",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/dev/shm",
  ];
  const writable = [input.projectDir, ...input.writableDirs].toSorted(
    (a, b) => a.split(/[\\/]+/).length - b.split(/[\\/]+/).length,
  );
  for (const dir of writable) args.push("--bind-try", dir, dir);
  for (const path of protectedProjectPaths(input.projectDir)) {
    args.push("--ro-bind-try", path, path);
  }
  // Claude Code writes its shell snapshot from inside this shell: give it a private, throwaway
  // folder so the agent cannot rewrite the snapshots other (unsandboxed) sessions source.
  if (input.homeDir !== null) {
    args.push("--tmpfs", NodePath.join(input.homeDir, ".claude", "shell-snapshots"));
  }
  args.push("--setenv", "ZEN_AGENT_NETWORK", "off");
  // bubblewrap cannot nest (AppArmor refuses the inner user namespace): the thread's toolchain
  // launchers see this and run their tool directly, inside this sandbox.
  args.push("--setenv", "ZEN_TOOL_SANDBOXED", "bwrap");
  return args;
}

/** The launcher Claude Code runs as its shell (CLAUDE_CODE_SHELL), named `bash`. */
function noNetworkShellScript(input: NoNetworkShellInput): string {
  const bwrap = noNetworkBwrapArgs(input).map(shQuote).join(" ");
  const seccomp = input.seccompFile === null ? "" : ` --seccomp 9 9<${shQuote(input.seccompFile)}`;
  return [
    "#!/bin/sh",
    "# Zen Staff: the shell of a company AI agent, without network (Aprobări is on).",
    "# Anything that leaves the company goes through a connector tool and the manager's approval.",
    `exec ${shQuote(input.sandboxProgram)} ${bwrap}${seccomp} -- ${shQuote(input.bash)} "$@"`,
    "",
  ].join("\n");
}

/** The sandbox-exec profile for the agent's shell on macOS (untested on a Mac). */
function noNetworkSeatbeltProfile(projectDir: string, writableDirs: ReadonlyArray<string>) {
  const lit = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const protectedPaths = protectedProjectPaths(projectDir);
  return [
    "(version 1)",
    "(allow default)",
    "(deny network-outbound)",
    "(deny network-inbound)",
    "(deny network-bind)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${lit(projectDir)}) ${writableDirs.map((dir) => `(subpath ${lit(dir)})`).join(" ")} (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/tty"))`,
    `(deny file-write* ${protectedPaths.map((path) => `(subpath ${lit(path)})`).join(" ")})`,
  ].join("\n");
}

function seatbeltShellScript(input: {
  readonly bash: string;
  readonly projectDir: string;
  readonly writableDirs: ReadonlyArray<string>;
}): string {
  return [
    "#!/bin/sh",
    "# Zen Staff: the shell of a company AI agent, without network (Aprobări is on).",
    `exec /usr/bin/sandbox-exec -p ${shQuote(noNetworkSeatbeltProfile(input.projectDir, input.writableDirs))} ${shQuote(input.bash)} "$@"`,
    "",
  ].join("\n");
}

/**
 * Rules every isolated thread gets: WebFetch runs inside Claude Code (outside the shell
 * sandbox), PowerShell does not go through CLAUDE_CODE_SHELL, and the project's Claude Code
 * settings and MCP file must not be rewritten by the agent's file tools.
 */
export function isolationDenyRules(projectDir: string, denyShell: boolean): string[] {
  const posix = projectDir.replaceAll("\\", "/").replace(/\/+$/, "").replace(/^\/+/, "");
  return [
    "WebFetch",
    "PowerShell",
    `Edit(//${posix}/.claude/**)`,
    `Edit(//${posix}/.mcp.json)`,
    `Edit(//${posix}/.git/config)`,
    `Edit(//${posix}/.git/hooks/**)`,
    ...(denyShell ? ["Bash", "Monitor"] : []),
  ];
}

export interface PlanInput {
  readonly platform: NodeJS.Platform;
  /** CPU architecture (process.arch spelling), for the seccomp filter. */
  readonly arch: string;
  readonly threadId: string;
  readonly projectDir: string;
  /** Where per-thread launchers live (`<state>/zen/staff/shell`). */
  readonly shellRoot: string;
  readonly sandboxProgram: string | null;
  readonly bash: string | null;
  readonly writableDirs: ReadonlyArray<string>;
  readonly homeDir: string | null;
}

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);

/** Writes the thread's launcher (when the OS has a sandbox) and returns what the session gets. */
export function planAgentShell(input: PlanInput): AgentShellPlan {
  const deny = (isolation: AgentShellIsolation): AgentShellPlan => ({
    isolation,
    shellPath: null,
    env: { ZEN_AGENT_NETWORK: "off" },
    deny: isolationDenyRules(input.projectDir, true),
  });
  if (input.bash === null) return deny("deny-shell");
  const dir = NodePath.join(input.shellRoot, safeSegment(input.threadId));
  let script: string;
  let isolation: AgentShellIsolation;
  if (input.platform === "linux" && input.sandboxProgram !== null) {
    const seccomp = unixSocketSeccompFilter(input.arch);
    const seccompFile = seccomp === null ? null : NodePath.join(dir, "seccomp.bpf");
    NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (seccomp !== null && seccompFile !== null) {
      NodeFS.writeFileSync(seccompFile, seccomp, { mode: 0o600 });
    }
    script = noNetworkShellScript({
      sandboxProgram: input.sandboxProgram,
      bash: input.bash,
      projectDir: input.projectDir,
      writableDirs: input.writableDirs,
      seccompFile,
      homeDir: input.homeDir,
    });
    isolation = "bwrap";
  } else if (input.platform === "darwin" && NodeFS.existsSync("/usr/bin/sandbox-exec")) {
    script = seatbeltShellScript({
      bash: input.bash,
      projectDir: input.projectDir,
      writableDirs: input.writableDirs,
    });
    isolation = "sandbox-exec";
  } else {
    return deny("deny-shell");
  }
  NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Read-only binds need their mount point: an empty .claude keeps the agent from creating one
  // with hooks in it.
  try {
    NodeFS.mkdirSync(NodePath.join(input.projectDir, ".claude"), { recursive: true });
  } catch {
    // A project folder we cannot write to: nothing to protect from the agent either.
  }
  const shell = NodePath.join(dir, "bash");
  NodeFS.writeFileSync(shell, script, { mode: 0o700 });
  NodeFS.chmodSync(shell, 0o700);
  if (!launcherWorks(shell, `${isolation}:${input.sandboxProgram ?? ""}`))
    return deny("deny-shell");
  return {
    isolation,
    shellPath: shell,
    env: { CLAUDE_CODE_SHELL: shell, ZEN_AGENT_NETWORK: "off" },
    deny: isolationDenyRules(input.projectDir, false),
  };
}

const verified = new Map<string, boolean>();

/** Runs the launcher once (`bash -c true`): a sandbox that cannot start here denies the shell. */
function launcherWorks(shell: string, key: string): boolean {
  const known = verified.get(key);
  if (known !== undefined) return known;
  const result = NodeChildProcess.spawnSync(shell, ["-c", "true"], {
    stdio: "ignore",
    timeout: 10_000,
  });
  const works = result.status === 0;
  verified.set(key, works);
  return works;
}
