// Zen Staff "Conectează-ți AI-ul": Claude Code / Codex installed by the official script and signed
// in through the CLI's browser login, as a server job (no terminal). `zen.aiConnect.call` rides on
// ZEN_COMPANIES_RPCS; the job state machine is shared by server and web. ZEN.md, "Connect your AI".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { AuthProvidersManageScope, EnvironmentAuthorizationError } from "./auth.ts";

export const ZEN_AI_CONNECT_WS_METHODS = {
  call: "zen.aiConnect.call",
} as const;

const ZEN_AI_CONNECT_OPS = ["status", "start", "submitCode", "cancel"] as const;
export type ZenAiConnectOp = (typeof ZEN_AI_CONNECT_OPS)[number];

export const ZenAiConnectCallInput = Schema.Struct({
  op: Schema.Literals(ZEN_AI_CONNECT_OPS),
  input: Schema.Unknown,
});
export type ZenAiConnectCallInput = typeof ZenAiConnectCallInput.Type;

export class ZenAiConnectError extends Schema.TaggedError<ZenAiConnectError>()(
  "ZenAiConnectError",
  {
    reason: Schema.Literals(["invalid-input", "not-found", "unavailable", "unsupported"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const ZenAiConnectCallRpc = Rpc.make(ZEN_AI_CONNECT_WS_METHODS.call, {
  payload: ZenAiConnectCallInput,
  success: Schema.Unknown,
  error: Schema.Union([ZenAiConnectError, EnvironmentAuthorizationError]),
});

/** Spread into ZEN_COMPANIES_RPCS. Installing a provider is a provider-management action. */
export const ZEN_AI_CONNECT_RPCS = [ZenAiConnectCallRpc] as const;
export const ZEN_AI_CONNECT_RPC_SCOPES = {
  [ZEN_AI_CONNECT_WS_METHODS.call]: AuthProvidersManageScope,
} as const;
export const ZEN_AI_CONNECT_RPC_AGGREGATES = {
  [ZEN_AI_CONNECT_WS_METHODS.call]: "zen",
} as const;

// The job

/** The CLIs installed by script. Google (Antigravity) is installed by upstream's managed setup. */
const AI_CONNECT_CLI_PROVIDERS = ["claude", "codex"] as const;
export type AiConnectCliProvider = (typeof AI_CONNECT_CLI_PROVIDERS)[number];

export const isAiConnectCliProvider = (value: unknown): value is AiConnectCliProvider =>
  value === "claude" || value === "codex";

/** connect: install when missing, then sign in. signin: sign in only (another account too). */
export type AiConnectMode = "connect" | "signin";

export type AiConnectStep = "download" | "install" | "signin";
export const AI_CONNECT_STEPS: ReadonlyArray<AiConnectStep> = ["download", "install", "signin"];

export type AiConnectPhase = "running" | "waiting-browser" | "succeeded" | "failed" | "cancelled";

export type AiConnectErrorCode =
  | "network"
  | "download-rejected"
  | "install-failed"
  | "install-timeout"
  | "not-found-after-install"
  | "login-failed"
  | "login-timeout"
  | "unsupported-os";

export interface AiConnectJob {
  readonly id: string;
  readonly provider: AiConnectCliProvider;
  readonly mode: AiConnectMode;
  readonly phase: AiConnectPhase;
  readonly step: AiConnectStep;
  /** Steps already done (download and install are skipped when the CLI is already there). */
  readonly done: ReadonlyArray<AiConnectStep>;
  readonly skipped: ReadonlyArray<AiConnectStep>;
  /** Download attempt (retried automatically on network errors). */
  readonly attempt: number;
  /** The official sign-in page the CLI opened (only allowlisted hosts). */
  readonly loginUrl: string | null;
  /** The CLI asks for a code from the sign-in page (Claude, when the browser is elsewhere). */
  readonly acceptsCode: boolean;
  readonly codeSubmitted: boolean;
  readonly binaryPath: string | null;
  /** Whether the bare command (`claude`) resolves on the server's PATH. */
  readonly binaryOnPath: boolean;
  readonly error: { readonly code: AiConnectErrorCode; readonly detail: string } | null;
  /** Redacted output (no tokens, no URL query strings), last 16 KB. */
  readonly log: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export type AiConnectEvent =
  | { readonly type: "download-retry"; readonly attempt: number }
  | { readonly type: "downloaded" }
  | { readonly type: "already-installed"; readonly binaryPath: string; readonly onPath: boolean }
  | { readonly type: "installed"; readonly binaryPath: string; readonly onPath: boolean }
  | { readonly type: "login-url"; readonly url: string; readonly acceptsCode: boolean }
  | { readonly type: "code-submitted" }
  | { readonly type: "login-exited"; readonly exitCode: number | null }
  | { readonly type: "fail"; readonly code: AiConnectErrorCode; readonly detail: string }
  | { readonly type: "cancel" }
  | { readonly type: "log"; readonly text: string };

const LOG_LIMIT = 16_384;
const terminal = (phase: AiConnectPhase) =>
  phase === "succeeded" || phase === "failed" || phase === "cancelled";

export function initialAiConnectJob(input: {
  readonly id: string;
  readonly provider: AiConnectCliProvider;
  readonly mode: AiConnectMode;
  readonly now: string;
}): AiConnectJob {
  return {
    id: input.id,
    provider: input.provider,
    mode: input.mode,
    phase: "running",
    step: input.mode === "signin" ? "signin" : "download",
    done: [],
    skipped: input.mode === "signin" ? ["download", "install"] : [],
    attempt: 1,
    loginUrl: null,
    acceptsCode: false,
    codeSubmitted: false,
    binaryPath: null,
    binaryOnPath: false,
    error: null,
    log: "",
    startedAt: input.now,
    updatedAt: input.now,
  };
}

const withDone = (job: AiConnectJob, step: AiConnectStep): ReadonlyArray<AiConnectStep> =>
  job.done.includes(step) ? job.done : [...job.done, step];

/**
 * The job's state machine. Events after the job ended are ignored (a late exit of a killed
 * process does not turn "cancelled" into "failed"), except log lines.
 */
export function reduceAiConnectJob(
  job: AiConnectJob,
  event: AiConnectEvent,
  now: string,
): AiConnectJob {
  if (event.type === "log") {
    const log = `${job.log}${event.text}`;
    return { ...job, log: log.length > LOG_LIMIT ? log.slice(-LOG_LIMIT) : log, updatedAt: now };
  }
  if (terminal(job.phase)) return job;
  const next = (patch: Partial<AiConnectJob>): AiConnectJob => ({
    ...job,
    ...patch,
    updatedAt: now,
  });
  switch (event.type) {
    case "download-retry":
      return job.step === "download" ? next({ attempt: event.attempt }) : job;
    case "downloaded":
      return job.step === "download"
        ? next({ step: "install", done: withDone(job, "download") })
        : job;
    case "already-installed":
      if (job.step === "signin")
        return next({ binaryPath: event.binaryPath, binaryOnPath: event.onPath });
      return next({
        step: "signin",
        skipped: ["download", "install"],
        binaryPath: event.binaryPath,
        binaryOnPath: event.onPath,
      });
    case "installed":
      return job.step === "install"
        ? next({
            step: "signin",
            done: withDone(job, "install"),
            binaryPath: event.binaryPath,
            binaryOnPath: event.onPath,
          })
        : job;
    case "login-url":
      return job.step === "signin"
        ? next({ phase: "waiting-browser", loginUrl: event.url, acceptsCode: event.acceptsCode })
        : job;
    case "code-submitted":
      return job.step === "signin" && job.acceptsCode ? next({ codeSubmitted: true }) : job;
    case "login-exited":
      if (job.step !== "signin") return job;
      return event.exitCode === 0
        ? next({ phase: "succeeded", done: withDone(job, "signin"), loginUrl: null })
        : next({
            phase: "failed",
            loginUrl: null,
            error: {
              code: "login-failed",
              detail: job.codeSubmitted
                ? "The sign-in code was not accepted."
                : "The sign-in did not finish.",
            },
          });
    case "fail":
      return next({
        phase: "failed",
        loginUrl: null,
        error: { code: event.code, detail: event.detail },
      });
    case "cancel":
      return next({ phase: "cancelled", loginUrl: null });
  }
}

export const isAiConnectJobActive = (job: AiConnectJob | null | undefined): boolean =>
  job !== null && job !== undefined && !terminal(job.phase);

/** Hosts a sign-in link may point at; anything else the CLI prints is never shown as a link. */
const AI_CONNECT_LOGIN_HOSTS: Readonly<Record<AiConnectCliProvider, ReadonlyArray<string>>> = {
  claude: ["claude.com", "claude.ai", "platform.claude.com", "console.anthropic.com"],
  codex: ["auth.openai.com", "chatgpt.com"],
};

/** A sign-in URL from CLI output when it is https on an allowlisted host, else null. */
export function safeAiConnectLoginUrl(
  provider: AiConnectCliProvider,
  candidate: string,
): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return AI_CONNECT_LOGIN_HOSTS[provider].includes(url.hostname.toLowerCase()) ? url.href : null;
}

/** The code pasted from Claude's sign-in page: one line of URL-safe characters. */
export function normalizeAiConnectCode(value: string): string | null {
  const code = value.trim();
  return /^[A-Za-z0-9._~#-]{8,512}$/.test(code) ? code : null;
}
