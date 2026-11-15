// Zen Staff "Conectează-ți AI-ul": what each card shows and does next (pure). Claude/ChatGPT
// come from the server job (`zen.aiConnect.call`), Google from upstream's managed install and
// sign-in; both become one `ConnectProgress`. ZEN.md, "Connect your AI".
import type { ProviderAuthState, ProviderInstallState, ServerProvider } from "@t3tools/contracts";
import {
  type AiConnectJob,
  type AiConnectStep,
  AI_CONNECT_STEPS,
} from "@t3tools/contracts/zenCompanies";

import { getOnboardingProviderState } from "../../onboarding/providerReadiness.logic";
import { type AiAccount, aiAccountFromProvider } from "../aiAccount/aiAccountModel";

export type AiConnectService = "claude" | "codex" | "google";
/** Card order: Claude, ChatGPT, Google. */
export const AI_CONNECT_SERVICES: ReadonlyArray<AiConnectService> = ["claude", "codex", "google"];

export const serviceDriver = (service: AiConnectService): string =>
  service === "claude" ? "claudeAgent" : service === "codex" ? "codex" : "antigravity";

export type ConnectErrorCode =
  | NonNullable<AiConnectJob["error"]>["code"]
  | "not-detected"
  | "google-install"
  | "google-signin";

/** One shape for a CLI job and for Google's install + sign-in. */
export interface ConnectProgress {
  readonly phase: AiConnectJob["phase"];
  readonly step: AiConnectStep;
  readonly done: ReadonlyArray<AiConnectStep>;
  readonly skipped: ReadonlyArray<AiConnectStep>;
  readonly attempt: number;
  readonly loginUrl: string | null;
  /** "code": Claude's pasted code; "callback": Google's last page address; null: neither. */
  readonly input: "code" | "callback" | null;
  readonly inputSent: boolean;
  readonly bytes: { readonly done: number; readonly total: number | null } | null;
  readonly error: { readonly code: ConnectErrorCode; readonly detail: string } | null;
  readonly log: string;
  readonly endedAt: number | null;
}

export function progressFromJob(job: AiConnectJob | null): ConnectProgress | null {
  if (job === null) return null;
  const ended = job.phase === "succeeded" || job.phase === "failed" || job.phase === "cancelled";
  return {
    phase: job.phase,
    step: job.step,
    done: job.done,
    skipped: job.skipped,
    attempt: job.attempt,
    loginUrl: job.loginUrl,
    input: job.acceptsCode ? "code" : null,
    inputSent: job.codeSubmitted,
    bytes: null,
    error: job.error,
    log: job.log,
    endedAt: ended ? Date.parse(job.updatedAt) || null : null,
  };
}

const INSTALL_RUNNING = new Set(["downloading", "extracting", "verifying"]);
const AUTH_RUNNING = new Set(["starting", "waiting", "verifying"]);

/**
 * Google: upstream's install state (download, extract, verify) and sign-in state (starting,
 * waiting for the browser, verifying) as one progress. `startedAt` is when the person clicked,
 * so an old failure from before is not shown.
 */
export function progressFromGoogle(input: {
  readonly requested: boolean;
  readonly install: ProviderInstallState | null;
  readonly auth: ProviderAuthState | null;
  readonly skippedInstall: boolean;
  readonly now: number;
}): ConnectProgress | null {
  const { install, auth } = input;
  const installRunning = install !== null && INSTALL_RUNNING.has(install.phase);
  const authActive = auth !== null && AUTH_RUNNING.has(auth.phase);
  if (!input.requested && !installRunning && !authActive) return null;
  const base = {
    attempt: 1,
    inputSent: false,
    log: [install?.message, auth?.message].filter(Boolean).join("\n"),
  };
  const skipped: ReadonlyArray<AiConnectStep> = input.skippedInstall ? ["download", "install"] : [];
  if (installRunning) {
    return {
      ...base,
      phase: "running",
      step: install.phase === "downloading" ? "download" : "install",
      done: install.phase === "downloading" ? [] : ["download"],
      skipped: [],
      loginUrl: null,
      input: null,
      bytes: { done: install.downloadedBytes, total: install.totalBytes },
      error: null,
      endedAt: null,
    };
  }
  if (input.requested && install?.phase === "failed") {
    return {
      ...base,
      phase: "failed",
      step: "install",
      done: [],
      skipped: [],
      loginUrl: null,
      input: null,
      bytes: null,
      error: { code: "google-install", detail: install.message ?? "" },
      endedAt: input.now,
    };
  }
  const installDone: ReadonlyArray<AiConnectStep> = input.skippedInstall
    ? []
    : ["download", "install"];
  if (authActive) {
    const url = auth.interaction?.type === "browser" ? auth.interaction.url : auth.authorizationUrl;
    const waiting = auth.phase === "waiting" && url !== null && url !== undefined;
    return {
      ...base,
      phase: waiting ? "waiting-browser" : "running",
      step: "signin",
      done: auth.phase === "verifying" ? [...installDone, "signin"] : installDone,
      skipped,
      loginUrl: waiting ? url : null,
      input:
        auth.interaction?.type === "browser" && auth.interaction.acceptsCallback
          ? "callback"
          : null,
      bytes: null,
      error: null,
      endedAt: null,
    };
  }
  if (input.requested && auth?.phase === "failed") {
    return {
      ...base,
      phase: "failed",
      step: "signin",
      done: installDone,
      skipped,
      loginUrl: null,
      input: null,
      bytes: null,
      error: { code: "google-signin", detail: auth.message ?? "" },
      endedAt: input.now,
    };
  }
  if (input.requested && auth?.phase === "succeeded") {
    return {
      ...base,
      phase: "succeeded",
      step: "signin",
      done: [...installDone, "signin"],
      skipped,
      loginUrl: null,
      input: null,
      bytes: null,
      error: null,
      endedAt: input.now,
    };
  }
  // Requested, nothing running yet: the first step is about to start.
  return input.requested
    ? {
        ...base,
        phase: "running",
        step: input.skippedInstall ? "signin" : "download",
        done: [],
        skipped,
        loginUrl: null,
        input: null,
        bytes: null,
        error: null,
        endedAt: null,
      }
    : null;
}

export type StepStatus = "done" | "active" | "pending" | "skipped";

export function stepStatuses(
  progress: ConnectProgress,
): ReadonlyArray<{ readonly step: AiConnectStep; readonly status: StepStatus }> {
  return AI_CONNECT_STEPS.map((step) => ({
    step,
    status: progress.skipped.includes(step)
      ? "skipped"
      : progress.done.includes(step)
        ? "done"
        : progress.step === step
          ? "active"
          : "pending",
  }));
}

/** How long a finished sign-in may wait for the provider to report the account. */
export const DETECTION_GRACE_MS = 90_000;

export type CardView =
  | { readonly kind: "checking" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "idle"; readonly action: "connect" | "signin" }
  | { readonly kind: "working"; readonly progress: ConnectProgress }
  | { readonly kind: "browser"; readonly progress: ConnectProgress }
  | { readonly kind: "verifying" }
  | { readonly kind: "found"; readonly account: AiAccount }
  | { readonly kind: "in-use"; readonly account: AiAccount }
  | {
      readonly kind: "failed";
      readonly code: ConnectErrorCode;
      readonly detail: string;
      readonly log: string;
    };

/**
 * What a card shows. A running job wins (also "connect another account" over a signed-in one);
 * then a signed-in account (asked before use: found / in use); then a failure; then a finished
 * sign-in still waiting for the provider snapshot (verifying, then "not detected"); then idle.
 */
export function aiConnectCardView(input: {
  readonly provider: ServerProvider | undefined;
  readonly allowed: boolean;
  readonly progress: ConnectProgress | null;
  readonly confirmed: (account: AiAccount) => boolean;
  readonly now: number;
}): CardView {
  const { provider, progress } = input;
  if (!input.allowed) return { kind: "unavailable" };
  if (progress && (progress.phase === "running" || progress.phase === "waiting-browser")) {
    return progress.phase === "waiting-browser" && progress.loginUrl
      ? { kind: "browser", progress }
      : { kind: "working", progress };
  }
  const account = provider ? aiAccountFromProvider(provider) : null;
  if (account?.state === "signed-in") {
    return input.confirmed(account) ? { kind: "in-use", account } : { kind: "found", account };
  }
  if (progress?.phase === "failed" && progress.error) {
    return {
      kind: "failed",
      code: progress.error.code,
      detail: progress.error.detail,
      log: progress.log,
    };
  }
  if (progress?.phase === "succeeded") {
    const waited = progress.endedAt === null ? 0 : input.now - progress.endedAt;
    return waited > DETECTION_GRACE_MS
      ? { kind: "failed", code: "not-detected", detail: "", log: progress.log }
      : { kind: "verifying" };
  }
  if (provider === undefined || account?.state === "checking") return { kind: "checking" };
  return {
    kind: "idle",
    action: account?.state === "signed-out" ? "signin" : "connect",
  };
}

/** The settings change a CLI provider needs once installed: enabled, and its path if not on PATH. */
export function cliProviderPatch(input: {
  readonly provider: ServerProvider | undefined;
  readonly instance:
    | { readonly driver: string; readonly enabled?: boolean; readonly config?: unknown }
    | undefined;
  readonly job: AiConnectJob | null;
}): { readonly enabled: true; readonly binaryPath: string | null } | null {
  const { job } = input;
  if (job === null || job.step !== "signin" || job.binaryPath === null) return null;
  const config =
    input.instance?.config !== null && typeof input.instance?.config === "object"
      ? (input.instance.config as Record<string, unknown>)
      : {};
  const enabled =
    input.provider?.enabled !== false &&
    input.instance?.enabled !== false &&
    config.enabled !== false;
  const wantPath = job.binaryOnPath ? null : job.binaryPath;
  const currentPath = typeof config.binaryPath === "string" ? config.binaryPath : null;
  const pathOk = wantPath === null || currentPath === wantPath;
  return enabled && pathOk ? null : { enabled: true, binaryPath: pathOk ? null : wantPath };
}

/** Google: the next upstream call for a requested connection, or null while one is running. */
export function nextGoogleAction(input: {
  readonly requested: boolean;
  readonly provider: ServerProvider | undefined;
  readonly authMethod: string | null;
  readonly install: ProviderInstallState | null;
  readonly auth: ProviderAuthState | null;
  readonly fired: ReadonlySet<string>;
}): "enable" | "install" | "signin" | null {
  const { provider, install, auth } = input;
  if (!input.requested || provider === undefined) return null;
  if (!provider.enabled || input.authMethod !== "oauth-personal") {
    return input.fired.has("enable") ? null : "enable";
  }
  if (install !== null && INSTALL_RUNNING.has(install.phase)) return null;
  if (!provider.installed) {
    if (install?.phase === "failed" || input.fired.has("install")) return null;
    return "install";
  }
  if (auth !== null && AUTH_RUNNING.has(auth.phase)) return null;
  if (provider.auth.status === "authenticated" || input.fired.has("signin")) return null;
  return "signin";
}

/**
 * Google reports "unknown" auth once installed (it checks the account when a session starts):
 * a sign-in that just succeeded counts as signed in, otherwise the card offers to sign in.
 */
export function googleProviderForCard(
  provider: ServerProvider | undefined,
  auth: ProviderAuthState | null,
): ServerProvider | undefined {
  if (!provider || !provider.enabled || !provider.installed || provider.auth.status !== "unknown")
    return provider;
  return {
    ...provider,
    auth: {
      ...provider.auth,
      status: auth?.phase === "succeeded" ? "authenticated" : "unauthenticated",
    },
  };
}

const PROVIDER_STATE_PRIORITY = {
  checking: 0,
  disabled: 1,
  install: 2,
  attention: 3,
  signIn: 4,
  ready: 5,
} as const;

/**
 * One provider per driver, the most ready one when several instances share a driver. Upstream's
 * `selectOnboardingProvidersByDriver` went away with its first-run wizard; this is that helper.
 */
export function selectProvidersByDriver(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): Map<string, ServerProvider> {
  const providersByDriver = new Map<string, ServerProvider>();
  for (const provider of providers ?? []) {
    const existing = providersByDriver.get(provider.driver);
    if (
      existing === undefined ||
      PROVIDER_STATE_PRIORITY[getOnboardingProviderState(provider)] >
        PROVIDER_STATE_PRIORITY[getOnboardingProviderState(existing)]
    ) {
      providersByDriver.set(provider.driver, provider);
    }
  }
  return providersByDriver;
}
