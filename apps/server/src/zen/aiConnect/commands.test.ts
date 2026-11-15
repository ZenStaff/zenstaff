// @effect-diagnostics nodeBuiltinImport:off -- Plain unit tests of pure command construction.
import { describe, expect, it } from "vite-plus/test";

import {
  aiConnectOs,
  installerCommand,
  installerSource,
  isOnPath,
  killPlan,
  knownBinaryPaths,
  loginCommand,
  redactAiConnectOutput,
  scanLoginOutput,
} from "./commands.ts";
import { isAllowedInstallerUrl, looksLikeInstaller } from "./download.ts";

const WIN_ENV = {
  USERPROFILE: "C:\\Users\\Ana",
  LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local",
  SystemRoot: "C:\\Windows",
};

describe("installer per OS", () => {
  it("maps Node platforms", () => {
    expect(aiConnectOs("linux")).toBe("linux");
    expect(aiConnectOs("darwin")).toBe("darwin");
    expect(aiConnectOs("win32")).toBe("windows");
    expect(aiConnectOs("freebsd")).toBeNull();
  });

  it("uses only the official installer URLs", () => {
    expect(installerSource("claude", "linux").url).toBe("https://claude.ai/install.sh");
    expect(installerSource("claude", "darwin").url).toBe("https://claude.ai/install.sh");
    expect(installerSource("claude", "windows").url).toBe("https://claude.ai/install.ps1");
    expect(installerSource("codex", "linux").url).toBe("https://chatgpt.com/codex/install.sh");
    expect(installerSource("codex", "windows").url).toBe("https://chatgpt.com/codex/install.ps1");
  });

  it("runs the script file with an absolute interpreter and no shell string", () => {
    const claude = installerCommand(installerSource("claude", "linux"), "/s/install.sh");
    expect(claude.command).toBe("/bin/bash");
    expect(claude.args).toEqual(["/s/install.sh"]);
    const codex = installerCommand(installerSource("codex", "darwin"), "/s/install.sh");
    expect(codex.command).toBe("/bin/sh");
    expect(codex.env.CODEX_NON_INTERACTIVE).toBe("1");
  });

  it("bypasses the execution policy for this PowerShell process only", () => {
    const plan = installerCommand(
      installerSource("claude", "windows"),
      "C:\\z\\install.ps1",
      WIN_ENV,
    );
    expect(plan.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(plan.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\z\\install.ps1",
    ]);
    expect(plan.args.join(" ")).not.toMatch(/Set-ExecutionPolicy|-Scope|iex|Invoke-Expression/);
  });

  it("knows where the installers put the CLI, per user", () => {
    expect(knownBinaryPaths("claude", "linux", { HOME: "/home/ana" })).toEqual([
      "/home/ana/.local/bin/claude",
    ]);
    expect(knownBinaryPaths("codex", "darwin", { HOME: "/Users/ana" })).toEqual([
      "/Users/ana/.local/bin/codex",
    ]);
    expect(knownBinaryPaths("claude", "windows", WIN_ENV)).toEqual([
      "C:\\Users\\Ana\\.local\\bin\\claude.exe",
    ]);
    expect(knownBinaryPaths("codex", "windows", WIN_ENV)).toEqual([
      "C:\\Users\\Ana\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe",
    ]);
    expect(knownBinaryPaths("claude", "linux", {})).toEqual([]);
  });

  it("signs in with the CLI's own browser flow", () => {
    expect(loginCommand("claude", "/h/.local/bin/claude")).toMatchObject({
      command: "/h/.local/bin/claude",
      args: ["auth", "login", "--claudeai"],
    });
    expect(loginCommand("codex", "C:\\x\\codex.exe")).toMatchObject({ args: ["login"] });
  });

  it("stops a process by PID: the group on POSIX, taskkill on Windows", () => {
    expect(killPlan("linux", 4321)).toEqual({ kind: "signal-group", pid: 4321 });
    expect(killPlan("windows", 4321, WIN_ENV)).toEqual({
      kind: "spawn",
      plan: {
        command: "C:\\Windows\\System32\\taskkill.exe",
        args: ["/PID", "4321", "/T", "/F"],
        env: {},
      },
    });
    expect(() => killPlan("linux", 1)).toThrow();
    expect(() => killPlan("linux", Number.NaN)).toThrow();
  });

  it("tells whether the install folder is on PATH", () => {
    expect(isOnPath("/home/a/.local/bin/claude", "/usr/bin:/home/a/.local/bin/", "linux")).toBe(
      true,
    );
    expect(isOnPath("/home/a/.local/bin/claude", "/usr/bin", "linux")).toBe(false);
    expect(
      isOnPath("C:\\U\\.local\\bin\\claude.exe", "C:\\Windows;c:\\u\\.local\\bin", "windows"),
    ).toBe(true);
  });
});

describe("download checks", () => {
  const claude = installerSource("claude", "linux");
  it("accepts only https on the provider's hosts", () => {
    expect(isAllowedInstallerUrl(claude, "https://claude.ai/install.sh")).toBe(true);
    expect(
      isAllowedInstallerUrl(
        claude,
        "https://downloads.claude.ai/claude-code-releases/bootstrap.sh",
      ),
    ).toBe(true);
    expect(isAllowedInstallerUrl(claude, "http://claude.ai/install.sh")).toBe(false);
    expect(isAllowedInstallerUrl(claude, "https://claude.ai.evil.com/install.sh")).toBe(false);
    expect(isAllowedInstallerUrl(claude, "https://user@claude.ai/install.sh")).toBe(false);
    expect(isAllowedInstallerUrl(claude, "https://claude.ai:8443/install.sh")).toBe(false);
    expect(isAllowedInstallerUrl(claude, "https://releases.openai.com/codex/install.sh")).toBe(
      false,
    );
  });

  it("rejects pages that are not the script", () => {
    const script = `#!/bin/bash\nset -e\n${"echo installing\n".repeat(10)}`;
    expect(looksLikeInstaller(claude, script)).toBe(true);
    expect(looksLikeInstaller(claude, "<!doctype html><html>blocked</html>".repeat(4))).toBe(false);
    expect(looksLikeInstaller(claude, "#!/bin/bash")).toBe(false);
    const ps = installerSource("codex", "windows");
    expect(looksLikeInstaller(ps, `param([string]$Target)\n${"Write-Host 'x'\n".repeat(8)}`)).toBe(
      true,
    );
  });
});

describe("output", () => {
  const claudeOutput = [
    "Opening browser to sign in…",
    "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c&state=SECRETSTATE&code_challenge=CHALLENGE",
    "Paste code here if prompted > ",
  ].join("\n");

  it("finds Claude's sign-in link and its code prompt", () => {
    const scan = scanLoginOutput("claude", claudeOutput);
    expect(scan.url).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
    expect(scan.asksForCode).toBe(true);
  });

  it("finds Codex's link and ignores the local callback server", () => {
    const scan = scanLoginOutput(
      "codex",
      "Starting local login server on http://localhost:1455.\nnavigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&state=S\n",
    );
    expect(scan.url).toMatch(/^https:\/\/auth\.openai\.com\/oauth\/authorize/);
    expect(scan.asksForCode).toBe(false);
  });

  it("never treats another host as a sign-in link", () => {
    expect(
      scanLoginOutput("claude", "visit https://evil.example/oauth/authorize?x=1").url,
    ).toBeNull();
    expect(scanLoginOutput("codex", "https://claude.com/cai/oauth/authorize").url).toBeNull();
  });

  it("redacts query strings, keys, tokens and colour codes", () => {
    const redacted = redactAiConnectOutput(
      `\u001b[32mok\u001b[0m ${claudeOutput}\nkey sk-ant-api03-abcdefghijklmnop token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk ${"A".repeat(60)}`,
    );
    expect(redacted).not.toContain("SECRETSTATE");
    expect(redacted).not.toContain("CHALLENGE");
    expect(redacted).not.toContain("sk-ant");
    expect(redacted).not.toContain("eyJhbGci");
    expect(redacted).not.toContain("A".repeat(60));
    expect(redacted).not.toContain("\u001b");
    expect(redacted).toContain("https://claude.com/cai/oauth/authorize?[…]");
  });
});
