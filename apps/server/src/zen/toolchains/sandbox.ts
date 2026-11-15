// Zen Staff: per-thread command launchers that confine tools: bubblewrap on Linux (task folder
// writable, tools read-only, no network unless declared), sandbox-exec on macOS (untested), a
// plain launcher elsewhere; plus the Claude Code permission rules for workflow threads.
// docs/zen-toolchain-security.md lists what each OS can and cannot enforce.
import type { ZenSandboxKind } from "@t3tools/contracts/zenToolchains";

export interface ShimSpec {
  /** Command name the agent types ("ffmpeg"). */
  readonly name: string;
  /** The real program and any leading arguments (["/…/node", "/…/remotion-cli.js"]). */
  readonly command: ReadonlyArray<string>;
}

export interface SandboxPolicy {
  readonly kind: ZenSandboxKind;
  readonly platform: "linux" | "macos" | "windows";
  /** The task folder: the only place tools may write. */
  readonly workDir: string;
  /** Toolchain folders and the workflow's own folder, readable. */
  readonly readOnlyDirs: ReadonlyArray<string>;
  readonly network: boolean;
  /** Extra variables the tools see (ZEN_TOOL_*, ZEN_REMOTION_MODULES). */
  readonly env: Readonly<Record<string, string>>;
}

const depth = (dir: string) => dir.split(/[\\/]+/).filter(Boolean).length;

const shQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The unprivileged user tools run as inside bubblewrap (never root, no capabilities). */
const BWRAP_SANDBOX_UID = 65534;

/** bubblewrap arguments, before the command. */
export function bwrapArgs(policy: SandboxPolicy): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    // A user namespace with an unprivileged id and no capabilities: even when the server runs as
    // root, a tool cannot remount the read-only folders writable (verified by the escape test).
    "--unshare-user",
    "--uid",
    String(BWRAP_SANDBOX_UID),
    "--gid",
    String(BWRAP_SANDBOX_UID),
    "--cap-drop",
    "ALL",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup-try",
    ...(policy.network ? [] : ["--unshare-net"]),
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind-try",
    "/bin",
    "/bin",
    "--ro-bind-try",
    "/sbin",
    "/sbin",
    "--ro-bind-try",
    "/lib",
    "/lib",
    "--ro-bind-try",
    "/lib64",
    "/lib64",
    "--ro-bind-try",
    "/lib32",
    "/lib32",
    "--ro-bind-try",
    "/etc/ssl",
    "/etc/ssl",
    "--ro-bind-try",
    "/etc/ca-certificates",
    "/etc/ca-certificates",
    "--ro-bind-try",
    "/etc/fonts",
    "/etc/fonts",
    "--ro-bind-try",
    "/etc/alternatives",
    "/etc/alternatives",
    "--ro-bind-try",
    "/etc/ld.so.cache",
    "/etc/ld.so.cache",
    "--ro-bind-try",
    "/etc/localtime",
    "/etc/localtime",
    // Name lookup of `localhost` reads these even without network: tools such as Remotion fetch
    // from their own server on the loopback (which --unshare-net keeps) by that name.
    "--ro-bind-try",
    "/etc/hosts",
    "/etc/hosts",
    "--ro-bind-try",
    "/etc/nsswitch.conf",
    "/etc/nsswitch.conf",
    ...(policy.network ? ["--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf"] : []),
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/dev/shm",
    "--tmpfs",
    "/tmp",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "TMPDIR",
    "/tmp",
  ];
  // Parents before children, so a folder nested in another keeps its own mode (a workflow folder
  // inside the task folder stays read-only; a task folder inside a read-only one stays writable).
  const mounts = [
    ...policy.readOnlyDirs.map((dir) => ({ dir, writable: false })),
    { dir: policy.workDir, writable: true },
  ].toSorted((a, b) => depth(a.dir) - depth(b.dir));
  for (const mount of mounts) {
    args.push(mount.writable ? "--bind" : "--ro-bind", mount.dir, mount.dir);
  }
  for (const [name, value] of Object.entries(policy.env)) args.push("--setenv", name, value);
  // Launchers called from inside (a node script running $ZEN_TOOL_FFMPEG) run the command in this
  // same sandbox: bubblewrap cannot nest, and the tools of the thread are all mounted here.
  args.push("--setenv", "ZEN_TOOL_SANDBOXED", "bwrap");
  return args;
}

/** A sandbox-exec (Seatbelt) profile for macOS. */
export function seatbeltProfile(policy: SandboxPolicy): string {
  const lit = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return [
    "(version 1)",
    "(allow default)",
    ...(policy.network ? [] : ["(deny network-outbound (remote ip))", "(deny network-inbound)"]),
    "(deny file-write*)",
    `(allow file-write* (subpath ${lit(policy.workDir)}) (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))`,
    '(deny file-read* (subpath (param "HOME")))',
    `(allow file-read* (subpath ${lit(policy.workDir)}) ${policy.readOnlyDirs.map((dir) => `(subpath ${lit(dir)})`).join(" ")})`,
  ].join("\n");
}

/** The launcher files for one command: [file name, content]. */
export function shimFiles(
  spec: ShimSpec,
  policy: SandboxPolicy,
  sandboxProgram: string | null,
): ReadonlyArray<{ readonly fileName: string; readonly content: string; readonly mode: number }> {
  if (policy.platform === "windows") {
    const quoted = spec.command.map((part) => `"${part}"`).join(" ");
    return [
      { fileName: `${spec.name}.cmd`, content: `@echo off\r\n${quoted} %*\r\n`, mode: 0o755 },
    ];
  }
  const command = spec.command.map(shQuote).join(" ");
  const exports = Object.entries(policy.env)
    .map(([name, value]) => `export ${name}=${shQuote(value)}`)
    .join("\n");
  let exec: string;
  if (policy.kind === "bwrap" && sandboxProgram) {
    // Run from the task folder when the caller is elsewhere (outside paths are not mounted).
    exec = [
      `if [ "\${ZEN_TOOL_SANDBOXED:-}" = bwrap ]; then exec ${command} "$@"; fi`,
      `case "$PWD" in ${shQuote(policy.workDir)}|${shQuote(policy.workDir)}/*) dir="$PWD" ;; *) dir=${shQuote(policy.workDir)} ;; esac`,
      `exec ${shQuote(sandboxProgram)} ${bwrapArgs(policy).map(shQuote).join(" ")} --chdir "$dir" ${command} "$@"`,
    ].join("\n");
  } else if (policy.kind === "sandbox-exec" && sandboxProgram) {
    exec = `exec ${shQuote(sandboxProgram)} -D HOME="$HOME" -p ${shQuote(seatbeltProfile(policy))} ${command} "$@"`;
  } else {
    exec = `exec ${command} "$@"`;
  }
  return [
    {
      fileName: spec.name,
      content: `#!/bin/sh\n# Zen Staff toolchain launcher (sandbox: ${policy.kind}).\n${exports}\n${exec}\n`,
      mode: 0o755,
    },
  ];
}

/**
 * Claude Code permission rules for a workflow thread (flag settings). The declared commands run
 * without asking; installers, admin rights and download commands (curl, wget) are denied: a
 * workflow that needs the internet declares a tool for it (yt-dlp), never a raw download. Other commands still go through the thread's normal approval mode.
 */
export function workflowPermissionRules(
  commands: ReadonlyArray<string>,
  shimDir: string,
): { readonly allow: string[]; readonly deny: string[] } {
  const allow = commands.flatMap((name) => [`Bash(${name}:*)`, `Bash(${shimDir}/${name}:*)`]);
  const deny = [
    "sudo",
    "su",
    "doas",
    "apt",
    "apt-get",
    "dnf",
    "yum",
    "pacman",
    "brew",
    "port",
    "choco",
    "winget",
    "scoop",
    "pip install",
    "pip3 install",
    "python -m pip",
    "python3 -m pip",
    "uv pip",
    "uv tool",
    "pipx",
    "npm install",
    "npm i",
    "npm ci",
    "npx",
    "pnpm",
    "yarn",
    "bun",
    "curl",
    "wget",
    "Invoke-WebRequest",
    "iwr",
    "Start-Process",
    "chmod +s",
    "setcap",
  ].map((name) => `Bash(${name}:*)`);
  return { allow, deny };
}

/** A Claude Code path rule specifier for an absolute folder and everything under it. */
function folderRule(tool: "Read" | "Edit", folder: string): string {
  const posix = folder.replaceAll("\\", "/").replace(/\/+$/, "");
  return `${tool}(//${posix.replace(/^\/+/, "")}/**)`;
}

/**
 * Rules for an unattended (scheduled) workflow run in dontAsk mode: declared commands, the tools'
 * launchers, file work in the task folder and declared agent tools are allowed; the rest is
 * denied. A declared download command leaves the deny list; installers and admin rights stay.
 */
export function unattendedPermissionRules(input: {
  readonly commands: ReadonlyArray<string>;
  readonly agentTools: ReadonlyArray<string>;
  readonly shimDir: string | null;
  readonly taskDir: string;
  readonly workflowDir: string;
  /** The allow rules the thread already has from its toolchains (tool launchers). */
  readonly toolAllow?: ReadonlyArray<string>;
}): { readonly allow: string[]; readonly deny: string[] } {
  const base = workflowPermissionRules([], input.shimDir ?? "");
  const declared = new Set(input.commands);
  const allow = [
    ...input.commands.map((name) => `Bash(${name}:*)`),
    ...(input.shimDir === null
      ? []
      : input.commands.map((name) => `Bash(${input.shimDir}/${name}:*)`)),
    ...(input.toolAllow ?? []),
    folderRule("Read", input.taskDir),
    folderRule("Edit", input.taskDir),
    folderRule("Read", input.workflowDir),
    ...input.agentTools,
  ];
  const deny = base.deny.filter((rule) => !declared.has(rule.slice("Bash(".length, -":*)".length)));
  return { allow: [...new Set(allow)], deny };
}
