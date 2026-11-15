// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalTimers:off - plain async code around the `claude` CLI, wrapped by ZenConnectors.ts.
// Zen Staff connectors: the person's own Claude Code does every connection. Zen runs its official
// commands (`claude mcp list / add / get / remove / login`) and reads what they print; Claude Code
// keeps every token in its own store. Nothing here writes a credential anywhere.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

import {
  parseClaudeMcpList,
  type ZenLoginView,
  type ZenProviderServer,
} from "@t3tools/contracts/zenConnectors";

export interface ClaudeCliOptions {
  /** `claude` on PATH unless ZEN_CONNECT_CLAUDE_BIN says otherwise. */
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
}

export interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type RunClaude = (
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly timeoutMs: number },
) => Promise<RunResult>;

export function makeRunClaude(cli: ClaudeCliOptions): RunClaude {
  return (args, options) =>
    new Promise((resolve) => {
      const child = NodeChildProcess.spawn(cli.bin, args as string[], {
        cwd: options.cwd,
        env: cli.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: `${stderr}${String(error)}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
}

export async function claudeVersion(run: RunClaude, cwd: string): Promise<string | null> {
  const result = await run(["--version"], { cwd, timeoutMs: 15_000 });
  return result.code === 0 ? (result.stdout.trim().split(/\s/)[0] ?? null) : null;
}

export async function listServers(
  run: RunClaude,
  cwd: string,
): Promise<{ readonly servers: ReadonlyArray<ZenProviderServer>; readonly error: string | null }> {
  const result = await run(["mcp", "list"], { cwd, timeoutMs: 90_000 });
  const servers = parseClaudeMcpList(result.stdout);
  if (result.code !== 0 && servers.length === 0) {
    return {
      servers,
      error: (result.stderr || result.stdout).trim().slice(0, 300) || "claude mcp list failed.",
    };
  }
  return { servers, error: null };
}

// under `script` (a pseudo-terminal). It prints the provider's sign-in link and listens on
// 127.0.0.1:<port>/callback. A browser on this machine lands there by itself; from another device
// the person pastes the address the browser ended on, and Zen hands it to that same local
// listener. The code in it is used once and never stored.

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;

/** The sign-in link and callback port from Claude Code's login output, or null. Pure. */
export function parseLoginOutput(
  output: string,
): { readonly url: string; readonly port: number } | null {
  // OSC-8 hyperlinks carry the URL inside the escape; look at the raw text first.
  const candidates = [...output.matchAll(/https:\/\/[^\s\u0007\u001b"'<>]+/g)].map(
    (match) => match[0],
  );
  for (const url of candidates) {
    try {
      const parsed = new URL(url);
      const redirect = parsed.searchParams.get("redirect_uri");
      if (!redirect) continue;
      const back = new URL(redirect);
      if (back.hostname !== "localhost" && back.hostname !== "127.0.0.1") continue;
      const port = Number(back.port);
      if (!Number.isInteger(port) || port <= 0) continue;
      return { url, port };
    } catch {
      continue;
    }
  }
  return null;
}

function stripTerminal(output: string): string {
  return output.replaceAll(ANSI, "").replaceAll("\r", "");
}

/**
 * Checks a pasted address before Zen hands it to Claude Code's local listener: only
 * http://localhost:<the login's port>/callback with a code (or an error) and a state.
 */
export function callbackTarget(pasted: string, port: number): string | null {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
  if (Number(url.port) !== port) return null;
  if (url.pathname !== "/callback") return null;
  if (!url.searchParams.get("state")) return null;
  if (!url.searchParams.get("code") && !url.searchParams.get("error")) return null;
  return `http://127.0.0.1:${port}/callback${url.search}`;
}

/** How to start `claude mcp login <server>` with a pseudo-terminal on this platform. */
export function loginCommand(
  bin: string,
  server: string,
  platform: NodeJS.Platform,
): { readonly command: string; readonly args: ReadonlyArray<string> } {
  const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  if (platform === "linux") {
    return {
      command: "script",
      args: ["-qfec", `${quoted(bin)} mcp login ${quoted(server)}`, "/dev/null"],
    };
  }
  if (platform === "darwin") {
    return { command: "script", args: ["-q", "/dev/null", bin, "mcp", "login", server] };
  }
  // Windows has no `script`; Claude Code may refuse without a terminal (ZEN.md gap).
  return { command: bin, args: ["mcp", "login", server] };
}

interface LoginSession {
  view: ZenLoginView;
  waiters: Array<() => void>;
  child: NodeChildProcess.ChildProcess | null;
  output: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export class LoginSessions {
  private readonly sessions = new Map<string, LoginSession>();
  private readonly cli: ClaudeCliOptions;
  private readonly onDone: (server: string) => void;
  private readonly fetchImpl: typeof fetch;

  constructor(
    cli: ClaudeCliOptions,
    onDone: (server: string) => void,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.cli = cli;
    this.onDone = onDone;
    this.fetchImpl = fetchImpl;
  }

  start(server: string, cwd: string, timeoutMs = 10 * 60_000): ZenLoginView {
    for (const session of this.sessions.values()) {
      if (
        session.view.server === server &&
        (session.view.state === "starting" || session.view.state === "waiting")
      ) {
        return session.view;
      }
    }
    const id = NodeCrypto.randomUUID();
    const { command, args } = loginCommand(this.cli.bin, server, this.cli.platform);
    const session: LoginSession = {
      view: {
        id,
        server,
        state: "starting",
        authorizeUrl: null,
        callbackPort: null,
        message: null,
      },
      child: null,
      output: "",
      timer: null,
      waiters: [],
    };
    this.sessions.set(id, session);
    let child: NodeChildProcess.ChildProcess;
    try {
      child = NodeChildProcess.spawn(command, args as string[], {
        cwd,
        // The card opens the link; Claude Code must not open a second browser tab.
        env: {
          ...this.cli.env,
          BROWSER: this.cli.platform === "win32" ? "none" : "true",
          NO_COLOR: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      session.view = { ...session.view, state: "failed", message: String(error) };
      return session.view;
    }
    session.child = child;
    const onData = (chunk: Buffer) => {
      session.output = (session.output + chunk.toString("utf8")).slice(-20_000);
      if (session.view.authorizeUrl === null) {
        const found = parseLoginOutput(session.output);
        if (found) {
          session.view = {
            ...session.view,
            state: "waiting",
            authorizeUrl: found.url,
            callbackPort: found.port,
          };
          this.wake(session);
        }
      }
      if (
        /authentication successful|successfully authenticated|Authenticated with/i.test(
          stripTerminal(session.output),
        )
      ) {
        this.finish(session, "done", null);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => this.finish(session, "failed", String(error)));
    child.on("close", (code) => {
      if (session.view.state === "done" || session.view.state === "failed") return;
      const text = stripTerminal(session.output);
      if (
        code === 0 &&
        !/couldn't|could not|failed|error/i.test(text.split("\n").slice(-6).join("\n"))
      ) {
        this.finish(session, "done", null);
      } else {
        const last = text
          .split("\n")
          .map((line) => line.trim())
          .filter(
            (line) => line.length > 0 && !line.startsWith("[mcp-sdk]") && !/^https?:/.test(line),
          )
          .at(-1);
        this.finish(session, "failed", last ?? "The sign-in did not finish.");
      }
    });
    session.timer = setTimeout(
      () => this.finish(session, "failed", "The sign-in took too long; start it again."),
      timeoutMs,
    );
    return session.view;
  }

  private finish(session: LoginSession, state: "done" | "failed", message: string | null) {
    if (session.view.state === "done" || session.view.state === "failed") return;
    session.view = { ...session.view, state, message };
    if (session.timer) clearTimeout(session.timer);
    if (session.child && session.child.exitCode === null) session.child.kill("SIGTERM");
    session.output = "";
    this.wake(session);
    if (state === "done") this.onDone(session.view.server);
  }

  private wake(session: LoginSession) {
    for (const waiter of session.waiters.splice(0)) waiter();
  }

  /** Resolves once the sign-in link is known or the sign-in ended (or after `timeoutMs`). */
  whenReady(id: string, timeoutMs: number): Promise<ZenLoginView | null> {
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve(null);
    if (
      session.view.authorizeUrl !== null ||
      session.view.state === "done" ||
      session.view.state === "failed"
    ) {
      return Promise.resolve(session.view);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(session.view), timeoutMs);
      session.waiters.push(() => {
        clearTimeout(timer);
        resolve(session.view);
      });
    });
  }

  /** Resolves once the sign-in ended (or after `timeoutMs`). */
  whenFinished(id: string, timeoutMs: number): Promise<ZenLoginView | null> {
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve(null);
    const deadline = Date.now() + timeoutMs;
    const loop = (): Promise<ZenLoginView> => {
      if (
        session.view.state === "done" ||
        session.view.state === "failed" ||
        Date.now() >= deadline
      ) {
        return Promise.resolve(session.view);
      }
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
        session.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      }).then(loop);
    };
    return loop();
  }

  status(id: string): ZenLoginView | null {
    return this.sessions.get(id)?.view ?? null;
  }

  /** Hands a pasted callback address to Claude Code's own listener on this machine. */
  async complete(id: string, pasted: string): Promise<ZenLoginView> {
    const session = this.sessions.get(id);
    if (!session) throw new Error("This sign-in is no longer running; start it again.");
    if (session.view.callbackPort === null) throw new Error("The sign-in link is not ready yet.");
    const target = callbackTarget(pasted, session.view.callbackPort);
    if (target === null) {
      throw new Error(
        "That is not the address the sign-in came back to (it starts with http://localhost).",
      );
    }
    await this.fetchImpl(target, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(
      () => undefined,
    );
    // Claude Code exchanges the code and exits; the close handler records the result.
    return (await this.whenFinished(id, 15_000)) ?? session.view;
  }

  dispose() {
    for (const session of this.sessions.values()) {
      if (session.timer) clearTimeout(session.timer);
      if (session.child && session.child.exitCode === null) session.child.kill("SIGTERM");
    }
    this.sessions.clear();
  }
}
