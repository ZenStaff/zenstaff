// Zen Staff "Conectează-ți AI-ul": which official installer to fetch, how to run it and the CLI's
// sign-in per OS, where the CLI lands, how to stop a process by PID, and how output is redacted.
// Pure (no I/O), so every OS is unit-tested on Linux (commands.test.ts). Arguments are always
// arrays passed to spawn without a shell; nothing the person types reaches a command line.
import { type AiConnectCliProvider, safeAiConnectLoginUrl } from "@t3tools/contracts/zenCompanies";

export type AiConnectOs = "linux" | "darwin" | "windows";

export function aiConnectOs(platform: NodeJS.Platform): AiConnectOs | null {
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "windows";
  return null;
}

export interface InstallerSource {
  /** The URL Anthropic / OpenAI publish in their docs. */
  readonly url: string;
  /** Hosts the download may be redirected through (https only). */
  readonly hosts: ReadonlyArray<string>;
  readonly kind: "bash" | "sh" | "powershell";
  readonly fileName: string;
}

const CLAUDE_HOSTS = ["claude.ai", "downloads.claude.ai"];
const CODEX_HOSTS = ["chatgpt.com", "releases.openai.com"];

/** The official installer for a provider on an OS (claude.ai/install.*, chatgpt.com/codex/install.*). */
export function installerSource(provider: AiConnectCliProvider, os: AiConnectOs): InstallerSource {
  const windows = os === "windows";
  if (provider === "claude") {
    return windows
      ? {
          url: "https://claude.ai/install.ps1",
          hosts: CLAUDE_HOSTS,
          kind: "powershell",
          fileName: "install.ps1",
        }
      : {
          url: "https://claude.ai/install.sh",
          hosts: CLAUDE_HOSTS,
          kind: "bash",
          fileName: "install.sh",
        };
  }
  return windows
    ? {
        url: "https://chatgpt.com/codex/install.ps1",
        hosts: CODEX_HOSTS,
        kind: "powershell",
        fileName: "install.ps1",
      }
    : {
        url: "https://chatgpt.com/codex/install.sh",
        hosts: CODEX_HOSTS,
        kind: "sh",
        fileName: "install.sh",
      };
}

export interface SpawnPlan {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Extra variables on top of the server's own environment. */
  readonly env: Readonly<Record<string, string>>;
}

/** Absolute interpreter paths, so a PATH entry cannot stand in for the shell. */
function windowsPowerShell(env: Readonly<Record<string, string | undefined>>): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/**
 * Runs the downloaded script from its file. PowerShell gets ExecutionPolicy Bypass for this one
 * process only (`-ExecutionPolicy Bypass -File`), never a machine or user policy change. Codex's
 * installer is told not to ask questions; both install for the current user, without admin rights.
 */
export function installerCommand(
  source: InstallerSource,
  scriptPath: string,
  env: Readonly<Record<string, string | undefined>> = {},
): SpawnPlan {
  const quiet = { CODEX_NON_INTERACTIVE: "1", NO_COLOR: "1", TERM: "dumb" };
  if (source.kind === "powershell") {
    return {
      command: windowsPowerShell(env),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
      ],
      env: quiet,
    };
  }
  return {
    command: source.kind === "bash" ? "/bin/bash" : "/bin/sh",
    args: [scriptPath],
    env: quiet,
  };
}

/** Where the official installers put the CLI (current user, no admin). First match wins. */
export function knownBinaryPaths(
  provider: AiConnectCliProvider,
  os: AiConnectOs,
  env: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<string> {
  if (os === "windows") {
    const profile = env.USERPROFILE;
    const local = env.LOCALAPPDATA;
    if (provider === "claude") return profile ? [`${profile}\\.local\\bin\\claude.exe`] : [];
    const custom = env.CODEX_INSTALL_DIR;
    return [
      ...(custom ? [`${custom}\\codex.exe`] : []),
      ...(local ? [`${local}\\Programs\\OpenAI\\Codex\\bin\\codex.exe`] : []),
    ];
  }
  const home = env.HOME;
  if (!home) return [];
  if (provider === "claude") return [`${home}/.local/bin/claude`];
  const custom = env.CODEX_INSTALL_DIR;
  return [...(custom ? [`${custom}/codex`] : []), `${home}/.local/bin/codex`];
}

export const binaryName = (provider: AiConnectCliProvider, os: AiConnectOs): string =>
  `${provider}${os === "windows" ? ".exe" : ""}`;

/** The CLI's own browser sign-in: `claude auth login --claudeai` (subscription) or `codex login`. */
export function loginCommand(provider: AiConnectCliProvider, binaryPath: string): SpawnPlan {
  return provider === "claude"
    ? { command: binaryPath, args: ["auth", "login", "--claudeai"], env: { NO_COLOR: "1" } }
    : { command: binaryPath, args: ["login"], env: { NO_COLOR: "1" } };
}

export const versionCommand = (binaryPath: string): SpawnPlan => ({
  command: binaryPath,
  args: ["--version"],
  env: { NO_COLOR: "1" },
});

/**
 * Stops a job's process tree by its PID. POSIX jobs run in their own process group (spawned
 * detached), so the group is signalled; Windows uses taskkill on the PID with its children.
 */
export function killPlan(
  os: AiConnectOs,
  pid: number,
  env: Readonly<Record<string, string | undefined>> = {},
):
  | { readonly kind: "signal-group"; readonly pid: number }
  | { readonly kind: "spawn"; readonly plan: SpawnPlan } {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("Not a process id.");
  if (os === "windows") {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
    return {
      kind: "spawn",
      plan: {
        command: `${root}\\System32\\taskkill.exe`,
        args: ["/PID", String(pid), "/T", "/F"],
        env: {},
      },
    };
  }
  return { kind: "signal-group", pid };
}

/** Whether a directory list (PATH) contains the directory of `binaryPath`. */
export function isOnPath(
  binaryPath: string,
  pathValue: string | undefined,
  os: AiConnectOs,
): boolean {
  if (!pathValue) return false;
  const separator = os === "windows" ? "\\" : "/";
  const index = binaryPath.lastIndexOf(separator);
  if (index <= 0) return false;
  const dir = binaryPath.slice(0, index);
  const norm = (value: string) => {
    const trimmed = value.replace(/[\\/]+$/, "");
    return os === "windows" ? trimmed.toLowerCase() : trimmed;
  };
  return pathValue
    .split(os === "windows" ? ";" : ":")
    .some((entry) => entry !== "" && norm(entry) === norm(dir));
}

// Output

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/**
 * What may be kept in a job log: no colour codes, no URL query strings (OAuth state, PKCE
 * challenge), no API keys, JWTs or long opaque strings. The pasted sign-in code is never logged.
 */
export function redactAiConnectOutput(text: string): string {
  return text
    .replace(ANSI, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g, "$1?[…]")
    .replace(/\b(sk-[A-Za-z0-9_-]{6,}|sess-[A-Za-z0-9_-]{6,})/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_\-+/=#]{48,}\b/g, "[redacted]");
}

export interface LoginOutputScan {
  /** The first https sign-in link on an allowed host, unredacted (it is shown to the person). */
  readonly url: string | null;
  readonly asksForCode: boolean;
}

/** Reads the sign-in link and the "paste the code" prompt from the CLI's output so far. */
export function scanLoginOutput(provider: AiConnectCliProvider, output: string): LoginOutputScan {
  const clean = output.replace(ANSI, "");
  let url: string | null = null;
  for (const candidate of clean.match(/https:\/\/[^\s"'<>]+/g) ?? []) {
    url = safeAiConnectLoginUrl(provider, candidate);
    if (url !== null) break;
  }
  return { url, asksForCode: /paste (the )?code/i.test(clean) };
}
