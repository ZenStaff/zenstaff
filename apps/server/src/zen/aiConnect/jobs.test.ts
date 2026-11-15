// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Runs real processes (a fake installer and a fake CLI) in a throwaway HOME.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { reduceAiConnectJob, type AiConnectJob } from "@t3tools/contracts/zenCompanies";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { aiConnectDispatch } from "./ZenAiConnect.ts";
import { InstallerDownloadError } from "./download.ts";
import { AiConnectJobs, type AiConnectDeps } from "./jobs.ts";

const FAKE_CLI = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ]; then
  echo "Opening browser to sign in..."
  echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=XYZSTATE&code_challenge=PKCE"
  printf "Paste code here if prompted > "
  read code
  if [ "$code" = "good-code-1234" ]; then echo "Login successful."; exit 0; fi
  echo "Invalid code"; exit 1
fi
exit 2
`;

const installer = (exitCode = 0) => `#!/bin/bash
set -e
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/claude" <<'CLI'
${FAKE_CLI}CLI
chmod +x "$HOME/.local/bin/claude"
echo "Installing for $HOME"
exit ${exitCode}
`;

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) NodeFS.rmSync(home, { recursive: true, force: true });
});

function setup(overrides: Partial<AiConnectDeps> = {}) {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-ai-connect-"));
  homes.push(home);
  const jobs = new AiConnectJobs({
    platform: "linux",
    env: { HOME: home, PATH: "/usr/bin:/bin" },
    workDir: NodePath.join(home, "state"),
    lookupOnPath: false,
    download: async () => installer(),
    ...overrides,
  });
  return { home, jobs };
}

/** Waits for the job (real processes) to reach a state. */
async function until(read: () => AiConnectJob | null, check: (job: AiConnectJob) => boolean) {
  await expect
    .poll(
      () => {
        const job = read();
        return job !== null && check(job);
      },
      { timeout: 15_000, interval: 25 },
    )
    .toBe(true);
  return read()!;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("AI connect job (real processes, throwaway HOME)", () => {
  it("installs with the script, reaches the browser sign-in and finishes with the code", async () => {
    const { home, jobs } = setup();
    const started = jobs.start("claude", "connect");
    expect(started.step).toBe("download");
    const waiting = await until(
      () => jobs.get("claude"),
      (job) => job.phase === "waiting-browser" && job.acceptsCode,
    );
    expect(waiting.done).toEqual(["download", "install"]);
    expect(waiting.binaryPath).toBe(`${home}/.local/bin/claude`);
    expect(waiting.binaryOnPath).toBe(false);
    expect(waiting.loginUrl).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
    // Starting again while it runs returns the same job.
    expect(jobs.start("claude", "connect").id).toBe(started.id);
    expect(() => jobs.submitCode(started.id, "bad code with spaces")).toThrow();
    jobs.submitCode(started.id, "  good-code-1234\n");
    const done = await until(
      () => jobs.get("claude"),
      (job) => job.phase !== "waiting-browser",
    );
    expect(done.phase).toBe("succeeded");
    expect(done.done).toEqual(["download", "install", "signin"]);
    expect(done.log).toContain("Login successful.");
    expect(done.log).not.toContain("XYZSTATE");
    expect(done.log).not.toContain("PKCE");
    expect(done.log).not.toContain("good-code-1234");
    // The job folder (downloaded script) is removed.
    await until(
      () => jobs.get("claude"),
      () => !NodeFS.existsSync(NodePath.join(home, "state", started.id)),
    );
  });

  it("fails clearly on a rejected code and can start again", async () => {
    const { jobs } = setup();
    const job = jobs.start("claude", "connect");
    await until(
      () => jobs.get("claude"),
      (current) => current.phase === "waiting-browser",
    );
    jobs.submitCode(job.id, "wrong-code-0000");
    const failed = await until(
      () => jobs.get("claude"),
      (current) => current.phase === "failed",
    );
    expect(failed.error?.code).toBe("login-failed");
    expect(failed.error?.detail).toMatch(/code was not accepted/);
    const again = jobs.start("claude", "connect");
    expect(again.id).not.toBe(job.id);
    const retried = await until(
      () => jobs.get("claude"),
      (current) => current.phase === "waiting-browser",
    );
    expect(retried.skipped).toEqual(["download", "install"]);
    jobs.cancel(again.id);
  });

  it("cancel kills the sign-in process by PID", async () => {
    const spawned: number[] = [];
    const { jobs } = setup({
      spawn: ((command: string, args: string[], options: NodeChildProcess.SpawnOptions) => {
        const child = NodeChildProcess.spawn(command, args, options);
        if (child.pid) spawned.push(child.pid);
        return child;
      }) as unknown as NonNullable<AiConnectDeps["spawn"]>,
    });
    const job = jobs.start("claude", "connect");
    await until(
      () => jobs.get("claude"),
      (current) => current.phase === "waiting-browser",
    );
    const loginPid = spawned.at(-1)!;
    expect(alive(loginPid)).toBe(true);
    expect(jobs.cancel(job.id).phase).toBe("cancelled");
    await expect.poll(() => alive(loginPid), { timeout: 5_000, interval: 25 }).toBe(false);
    // A late exit does not turn cancelled into failed.
    expect(jobs.get("claude")?.phase).toBe("cancelled");
  });

  it("reports an installer that fails", async () => {
    const { jobs } = setup({ download: async () => installer(3) });
    jobs.start("claude", "connect");
    const failed = await until(
      () => jobs.get("claude"),
      (job) => job.phase === "failed",
    );
    expect(failed.error).toMatchObject({ code: "install-failed" });
    expect(failed.error?.detail).toContain("code 3");
    expect(failed.log).toContain("Installing for");
  });

  it("retries the download on network errors, fails at once when rejected", async () => {
    const { jobs } = setup({
      download: async (_source, options) => {
        options?.onRetry?.(2, new Error("offline"));
        options?.onRetry?.(3, new Error("offline"));
        throw new InstallerDownloadError("network", "The installer could not be downloaded.");
      },
    });
    jobs.start("codex", "connect");
    const failed = await until(
      () => jobs.get("codex"),
      (job) => job.phase === "failed",
    );
    expect(failed.attempt).toBe(3);
    expect(failed.error?.code).toBe("network");

    const rejected = setup({
      download: async () => {
        throw new InstallerDownloadError(
          "rejected",
          "The installer address is not an official one.",
        );
      },
    });
    rejected.jobs.start("claude", "connect");
    const job = await until(
      () => rejected.jobs.get("claude"),
      (current) => current.phase === "failed",
    );
    expect(job.error?.code).toBe("download-rejected");
  });

  it("skips the install when the CLI is already there", async () => {
    let downloads = 0;
    const { home, jobs } = setup({
      download: async () => {
        downloads++;
        return installer();
      },
    });
    NodeFS.mkdirSync(NodePath.join(home, ".local", "bin"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(home, ".local", "bin", "claude"), FAKE_CLI, { mode: 0o755 });
    const job = jobs.start("claude", "connect");
    const waiting = await until(
      () => jobs.get("claude"),
      (current) => current.phase === "waiting-browser",
    );
    expect(waiting.skipped).toEqual(["download", "install"]);
    expect(downloads).toBe(0);
    jobs.cancel(job.id);
  });

  it("stops a sign-in that takes too long", async () => {
    const { jobs } = setup({ timeouts: { loginMs: 300, killGraceMs: 50 } });
    jobs.start("claude", "connect");
    const failed = await until(
      () => jobs.get("claude"),
      (job) => job.phase === "failed",
    );
    expect(failed.error?.code).toBe("login-timeout");
  });

  it("asks for a sign-in only when the CLI is missing", async () => {
    const { jobs } = setup();
    jobs.start("claude", "signin");
    const failed = await until(
      () => jobs.get("claude"),
      (job) => job.phase === "failed",
    );
    expect(failed.error?.code).toBe("not-found-after-install");
  });

  it("refuses an unsupported OS", async () => {
    const { jobs } = setup({ platform: "aix" });
    jobs.start("claude", "connect");
    const failed = await until(
      () => jobs.get("claude"),
      (job) => job.phase === "failed",
    );
    expect(failed.error?.code).toBe("unsupported-os");
  });
});

describe("dispatcher", () => {
  it("validates input", () => {
    const { jobs } = setup();
    expect(aiConnectDispatch(jobs, "status", {})).toEqual({ jobs: [] });
    expect(() => aiConnectDispatch(jobs, "start", { provider: "gemini" })).toThrow(
      /Unknown AI provider/,
    );
    expect(() => aiConnectDispatch(jobs, "cancel", {})).toThrow(/jobId/);
    expect(() => aiConnectDispatch(jobs, "submitCode", { jobId: "x", code: "abcdefghij" })).toThrow(
      /no longer running/,
    );
    expect(() => aiConnectDispatch(jobs, "nope", {})).toThrow(/Unknown operation/);
  });
});

describe("state machine", () => {
  const base: AiConnectJob = {
    id: "j",
    provider: "claude",
    mode: "connect",
    phase: "running",
    step: "download",
    done: [],
    skipped: [],
    attempt: 1,
    loginUrl: null,
    acceptsCode: false,
    codeSubmitted: false,
    binaryPath: null,
    binaryOnPath: false,
    error: null,
    log: "",
    startedAt: "t0",
    updatedAt: "t0",
  };
  it("ignores events after the end except log lines", () => {
    const cancelled = reduceAiConnectJob(base, { type: "cancel" }, "t1");
    expect(reduceAiConnectJob(cancelled, { type: "login-exited", exitCode: 1 }, "t2").phase).toBe(
      "cancelled",
    );
    expect(reduceAiConnectJob(cancelled, { type: "log", text: "bye" }, "t2").log).toBe("bye");
  });
  it("keeps the log to its last 16 KB", () => {
    const long = reduceAiConnectJob(base, { type: "log", text: "x".repeat(20_000) }, "t1");
    expect(long.log.length).toBe(16_384);
  });
  it("only accepts steps in order", () => {
    expect(
      reduceAiConnectJob(base, { type: "installed", binaryPath: "/b", onPath: true }, "t1"),
    ).toBe(base);
    expect(
      reduceAiConnectJob(
        base,
        { type: "login-url", url: "https://claude.com/x", acceptsCode: false },
        "t1",
      ),
    ).toBe(base);
    expect(reduceAiConnectJob(base, { type: "code-submitted" }, "t1")).toBe(base);
  });
});
