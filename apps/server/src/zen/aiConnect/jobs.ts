// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - plain async code that runs outside the Effect runtime (wrapped by ZenAiConnect.ts).
// Zen Staff "Conectează-ți AI-ul": the background job that installs Claude Code or Codex with the
// official script and runs the CLI's own browser sign-in, without a terminal. One job per
// provider; the web polls `status`. Every process is spawned with an argument array (no shell),
// in its own process group on POSIX, and stopped by PID on cancel, timeout or server shutdown.
// The state machine is `reduceAiConnectJob` (contracts); I/O is injectable for tests.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  type AiConnectCliProvider,
  type AiConnectEvent,
  type AiConnectJob,
  type AiConnectMode,
  initialAiConnectJob,
  isAiConnectJobActive,
  normalizeAiConnectCode,
  reduceAiConnectJob,
} from "@t3tools/contracts/zenCompanies";

import {
  type AiConnectOs,
  type SpawnPlan,
  aiConnectOs,
  binaryName,
  installerCommand,
  installerSource,
  isOnPath,
  killPlan,
  knownBinaryPaths,
  loginCommand,
  redactAiConnectOutput,
  scanLoginOutput,
  versionCommand,
} from "./commands.ts";
import { InstallerDownloadError, downloadInstaller } from "./download.ts";

export const AI_CONNECT_TIMEOUTS = {
  downloadMs: 30_000,
  installMs: 10 * 60_000,
  versionMs: 30_000,
  loginMs: 15 * 60_000,
  killGraceMs: 3_000,
};

export interface AiConnectDeps {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Folder for the job's private files (the downloaded script). */
  readonly workDir: string;
  readonly download?: typeof downloadInstaller;
  readonly spawn?: typeof NodeChildProcess.spawn;
  readonly now?: () => string;
  readonly fileExists?: (path: string) => boolean;
  /** Also look for the bare command on PATH (off in tests that must not find the host's CLI). */
  readonly lookupOnPath?: boolean;
  readonly timeouts?: Partial<typeof AI_CONNECT_TIMEOUTS>;
}

interface Running {
  job: AiConnectJob;
  child: NodeChildProcess.ChildProcess | null;
  cancelled: boolean;
  abort: AbortController;
}

const isFile = (path: string) => {
  try {
    return NodeFS.statSync(path).isFile();
  } catch {
    return false;
  }
};

export class AiConnectJobs {
  private readonly jobs = new Map<AiConnectCliProvider, Running>();
  private readonly os: AiConnectOs | null;
  private readonly timeouts: typeof AI_CONNECT_TIMEOUTS;
  private readonly deps: AiConnectDeps;

  constructor(deps: AiConnectDeps) {
    this.deps = deps;
    this.os = aiConnectOs(deps.platform);
    this.timeouts = { ...AI_CONNECT_TIMEOUTS, ...deps.timeouts };
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private emit(running: Running, event: AiConnectEvent): void {
    running.job = reduceAiConnectJob(running.job, event, this.now());
  }

  private log(running: Running, text: string): void {
    if (text) this.emit(running, { type: "log", text: redactAiConnectOutput(text) });
  }

  status(): ReadonlyArray<AiConnectJob> {
    return [...this.jobs.values()].map((running) => running.job);
  }

  get(provider: AiConnectCliProvider): AiConnectJob | null {
    return this.jobs.get(provider)?.job ?? null;
  }

  /** Starts a job, or returns the one already running for this provider. */
  start(provider: AiConnectCliProvider, mode: AiConnectMode): AiConnectJob {
    const existing = this.jobs.get(provider);
    if (existing && isAiConnectJobActive(existing.job)) return existing.job;
    const running: Running = {
      job: initialAiConnectJob({ id: NodeCrypto.randomUUID(), provider, mode, now: this.now() }),
      child: null,
      cancelled: false,
      abort: new AbortController(),
    };
    this.jobs.set(provider, running);
    void this.run(running).catch((cause: unknown) => {
      this.emit(running, {
        type: "fail",
        code: running.job.step === "signin" ? "login-failed" : "install-failed",
        detail:
          cause instanceof Error ? redactAiConnectOutput(cause.message) : "The setup stopped.",
      });
    });
    return running.job;
  }

  submitCode(jobId: string, value: string): AiConnectJob {
    const running = this.byId(jobId);
    const code = normalizeAiConnectCode(value);
    if (code === null)
      throw new Error("This is not a sign-in code. Copy the whole code from the page.");
    const stdin = running.child?.stdin;
    if (!running.job.acceptsCode || !stdin || stdin.destroyed) {
      throw new Error("The sign-in is not waiting for a code.");
    }
    // Written to the CLI only: never logged, never kept on the job.
    stdin.write(`${code}\n`);
    this.emit(running, { type: "code-submitted" });
    return running.job;
  }

  cancel(jobId: string): AiConnectJob {
    const running = this.byId(jobId);
    running.cancelled = true;
    running.abort.abort();
    this.emit(running, { type: "cancel" });
    this.stop(running);
    return running.job;
  }

  /** Server shutdown: stop every job's process. */
  dispose(): void {
    for (const running of this.jobs.values()) {
      if (!isAiConnectJobActive(running.job)) continue;
      running.cancelled = true;
      running.abort.abort();
      this.emit(running, { type: "cancel" });
      this.stop(running);
    }
  }

  private byId(jobId: string): Running {
    for (const running of this.jobs.values()) if (running.job.id === jobId) return running;
    throw new Error("This setup is no longer running.");
  }

  /** Kills the job's current process tree by PID (never by name). */
  private stop(running: Running): void {
    const child = running.child;
    const pid = child?.pid;
    if (!child || pid === undefined || child.exitCode !== null || this.os === null) return;
    const plan = killPlan(this.os, pid, this.deps.env);
    if (plan.kind === "spawn") {
      const spawn = this.deps.spawn ?? NodeChildProcess.spawn;
      spawn(plan.plan.command, [...plan.plan.args], { stdio: "ignore", windowsHide: true }).on(
        "error",
        () => undefined,
      );
      return;
    }
    const signal = (name: NodeJS.Signals) => {
      try {
        process.kill(-plan.pid, name);
      } catch {
        try {
          child.kill(name);
        } catch {}
      }
    };
    signal("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) signal("SIGKILL");
    }, this.timeouts.killGraceMs).unref();
  }

  private findBinary(provider: AiConnectCliProvider): { path: string; onPath: boolean } | null {
    const os = this.os!;
    const exists = this.deps.fileExists ?? isFile;
    const pathValue = this.deps.env.PATH ?? this.deps.env.Path;
    for (const candidate of knownBinaryPaths(provider, os, this.deps.env)) {
      if (exists(candidate)) return { path: candidate, onPath: isOnPath(candidate, pathValue, os) };
    }
    if (this.deps.lookupOnPath === false || !pathValue) return null;
    const separator = os === "windows" ? ";" : ":";
    for (const dir of pathValue.split(separator)) {
      if (!dir) continue;
      const candidate = NodePath[os === "windows" ? "win32" : "posix"].join(
        dir,
        binaryName(provider, os),
      );
      if (exists(candidate)) return { path: candidate, onPath: true };
    }
    return null;
  }

  /** Runs one process to its end; output goes to the job log (redacted). */
  private runProcess(
    running: Running,
    plan: SpawnPlan,
    options: {
      readonly timeoutMs: number;
      readonly stdin: "ignore" | "pipe";
      readonly onOutput?: (all: string) => void;
    },
  ): Promise<{ readonly exitCode: number | null; readonly timedOut: boolean }> {
    const spawn = this.deps.spawn ?? NodeChildProcess.spawn;
    return new Promise((resolve) => {
      const child = spawn(plan.command, [...plan.args], {
        cwd: this.jobDir(running),
        env: { ...this.deps.env, ...plan.env } as NodeJS.ProcessEnv,
        // Own process group on POSIX: no controlling terminal (installers cannot prompt) and the
        // whole tree can be stopped by PID.
        detached: this.os !== "windows",
        windowsHide: true,
        stdio: [options.stdin, "pipe", "pipe"],
      });
      running.child = child;
      let all = "";
      let timedOut = false;
      const onData = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        all = `${all}${text}`.slice(-65_536);
        this.log(running, text);
        options.onOutput?.(all);
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      const timer = setTimeout(() => {
        timedOut = true;
        this.stop(running);
      }, options.timeoutMs);
      let settled = false;
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (running.child === child) running.child = null;
        resolve({ exitCode, timedOut });
      };
      child.on("error", (error) => {
        this.log(running, `${error.message}\n`);
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  }

  private jobDir(running: Running): string {
    return NodePath.join(this.deps.workDir, running.job.id);
  }

  private async run(running: Running): Promise<void> {
    const { provider } = running.job;
    const os = this.os;
    if (os === null) {
      this.emit(running, {
        type: "fail",
        code: "unsupported-os",
        detail: "This computer's system is not supported yet.",
      });
      return;
    }
    const dir = this.jobDir(running);
    NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      let binary = this.findBinary(provider);
      if (running.job.mode === "connect") {
        const works = binary !== null && (await this.versionWorks(running, binary.path));
        if (binary !== null && works) {
          this.emit(running, {
            type: "already-installed",
            binaryPath: binary.path,
            onPath: binary.onPath,
          });
        } else {
          binary = await this.install(running, os, dir);
          if (binary === null) return;
          this.emit(running, { type: "installed", binaryPath: binary.path, onPath: binary.onPath });
        }
      } else if (binary === null) {
        this.emit(running, {
          type: "fail",
          code: "not-found-after-install",
          detail: "The tool is not installed on this computer. Connect it again to install it.",
        });
        return;
      } else {
        this.emit(running, {
          type: "already-installed",
          binaryPath: binary.path,
          onPath: binary.onPath,
        });
      }
      if (running.cancelled) return;
      await this.login(running, binary.path);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  }

  private async versionWorks(running: Running, binaryPath: string): Promise<boolean> {
    const result = await this.runProcess(running, versionCommand(binaryPath), {
      timeoutMs: this.timeouts.versionMs,
      stdin: "ignore",
    });
    return result.exitCode === 0;
  }

  private async install(
    running: Running,
    os: AiConnectOs,
    dir: string,
  ): Promise<{ path: string; onPath: boolean } | null> {
    const { provider } = running.job;
    const source = installerSource(provider, os);
    this.log(running, `Downloading ${source.url}\n`);
    let script: string;
    try {
      script = await (this.deps.download ?? downloadInstaller)(source, {
        timeoutMs: this.timeouts.downloadMs,
        signal: running.abort.signal,
        onRetry: (attempt, error) => {
          this.log(running, `${error.message} Trying again (${attempt}).\n`);
          this.emit(running, { type: "download-retry", attempt });
        },
      });
    } catch (cause) {
      if (running.cancelled) return null;
      const rejected = cause instanceof InstallerDownloadError && cause.kind === "rejected";
      this.emit(running, {
        type: "fail",
        code: rejected ? "download-rejected" : "network",
        detail: cause instanceof Error ? cause.message : "The installer could not be downloaded.",
      });
      return null;
    }
    if (running.cancelled) return null;
    const scriptPath = NodePath.join(dir, source.fileName);
    NodeFS.writeFileSync(scriptPath, script, { mode: 0o600 });
    this.emit(running, { type: "downloaded" });
    const result = await this.runProcess(
      running,
      installerCommand(source, scriptPath, this.deps.env),
      {
        timeoutMs: this.timeouts.installMs,
        stdin: "ignore",
      },
    );
    if (running.cancelled) return null;
    if (result.timedOut || result.exitCode !== 0) {
      this.emit(running, {
        type: "fail",
        code: result.timedOut ? "install-timeout" : "install-failed",
        detail: result.timedOut
          ? "The installation took too long and was stopped."
          : `The official installer stopped with code ${result.exitCode ?? "unknown"}.`,
      });
      return null;
    }
    const binary = this.findBinary(provider);
    if (binary === null || !(await this.versionWorks(running, binary.path))) {
      if (running.cancelled) return null;
      this.emit(running, {
        type: "fail",
        code: "not-found-after-install",
        detail: "The installer finished, but the tool was not found where it installs.",
      });
      return null;
    }
    return binary;
  }

  private async login(running: Running, binaryPath: string): Promise<void> {
    const { provider } = running.job;
    const result = await this.runProcess(running, loginCommand(provider, binaryPath), {
      timeoutMs: this.timeouts.loginMs,
      stdin: "pipe",
      onOutput: (all) => {
        const scan = scanLoginOutput(provider, all);
        if (
          scan.url !== null &&
          (scan.url !== running.job.loginUrl || scan.asksForCode !== running.job.acceptsCode)
        ) {
          this.emit(running, { type: "login-url", url: scan.url, acceptsCode: scan.asksForCode });
        }
      },
    });
    if (running.cancelled) return;
    if (result.timedOut) {
      this.emit(running, {
        type: "fail",
        code: "login-timeout",
        detail: "The sign-in was not finished in time.",
      });
      return;
    }
    this.emit(running, { type: "login-exited", exitCode: result.exitCode });
  }
}
