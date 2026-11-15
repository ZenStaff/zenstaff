import type { ProviderAuthState, ProviderInstallState, ServerProvider } from "@t3tools/contracts";
import {
  type AiConnectJob,
  initialAiConnectJob,
  normalizeAiConnectCode,
  reduceAiConnectJob,
  safeAiConnectLoginUrl,
} from "@t3tools/contracts/zenCompanies";
import { describe, expect, it } from "vite-plus/test";

import { classifyAiAccount } from "../aiAccount/aiAccountModel";
import { isAiNotConnectedError } from "./aiConnectClient";
import {
  AI_CONNECT_SERVICES,
  DETECTION_GRACE_MS,
  aiConnectCardView,
  cliProviderPatch,
  googleProviderForCard,
  nextGoogleAction,
  progressFromGoogle,
  progressFromJob,
  stepStatuses,
} from "./aiConnectFlow.logic";

const provider = (overrides: Record<string, unknown> = {}): ServerProvider =>
  ({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    displayName: "Claude",
    enabled: true,
    installed: true,
    status: "ready",
    auth: {
      status: "authenticated",
      email: "alex@firma.example",
      label: "Claude Pro Subscription",
    },
    ...overrides,
  }) as unknown as ServerProvider;

const signedOut = provider({ status: "error", auth: { status: "unauthenticated" } });
const notInstalled = provider({ installed: false, status: "error", auth: { status: "unknown" } });

const T0 = "2026-11-08T10:00:00.000Z";
const job = (
  events: Parameters<typeof reduceAiConnectJob>[1][],
  mode: "connect" | "signin" = "connect",
) =>
  events.reduce<AiConnectJob>(
    (current, event) => reduceAiConnectJob(current, event, T0),
    initialAiConnectJob({ id: "job-1", provider: "claude", mode, now: T0 }),
  );

const view = (input: Partial<Parameters<typeof aiConnectCardView>[0]>) =>
  aiConnectCardView({
    provider: signedOut,
    allowed: true,
    progress: null,
    confirmed: () => false,
    now: Date.parse(T0),
    ...input,
  });

describe("cards", () => {
  it("are ordered Claude, ChatGPT, Google", () => {
    expect(AI_CONNECT_SERVICES).toEqual(["claude", "codex", "google"]);
  });

  it("offers to connect, or only to sign in when the tool is there", () => {
    expect(view({ provider: notInstalled })).toEqual({ kind: "idle", action: "connect" });
    expect(view({ provider: signedOut })).toEqual({ kind: "idle", action: "signin" });
    expect(view({ provider: provider({ enabled: false }) })).toEqual({
      kind: "idle",
      action: "connect",
    });
    expect(view({ provider: undefined })).toEqual({ kind: "checking" });
    expect(view({ allowed: false })).toEqual({ kind: "unavailable" });
  });

  it("walks the steps: download, install, browser sign-in", () => {
    const downloading = view({ progress: progressFromJob(job([])) });
    expect(downloading.kind).toBe("working");
    if (downloading.kind !== "working") throw new Error("not working");
    expect(stepStatuses(downloading.progress).map((s) => s.status)).toEqual([
      "active",
      "pending",
      "pending",
    ]);

    const installing = progressFromJob(job([{ type: "downloaded" }]))!;
    expect(stepStatuses(installing).map((s) => s.status)).toEqual(["done", "active", "pending"]);

    const browser = view({
      progress: progressFromJob(
        job([
          { type: "downloaded" },
          { type: "installed", binaryPath: "/h/.local/bin/claude", onPath: false },
          { type: "login-url", url: "https://claude.com/cai/oauth/authorize?x", acceptsCode: true },
        ]),
      ),
    });
    expect(browser.kind).toBe("browser");
    if (browser.kind !== "browser") throw new Error("not browser");
    expect(browser.progress.input).toBe("code");
    expect(stepStatuses(browser.progress).map((s) => s.status)).toEqual(["done", "done", "active"]);
  });

  it("shows skipped steps when the tool was already installed", () => {
    const progress = progressFromJob(
      job([{ type: "already-installed", binaryPath: "/b", onPath: true }]),
    )!;
    expect(stepStatuses(progress).map((s) => s.status)).toEqual(["skipped", "skipped", "active"]);
  });

  it("after the sign-in: verifying, then the account is asked before use", () => {
    const finished = job([
      { type: "already-installed", binaryPath: "/b", onPath: true },
      { type: "login-url", url: "https://claude.com/cai/oauth/authorize", acceptsCode: false },
      { type: "login-exited", exitCode: 0 },
    ]);
    // The CLI finished, the provider snapshot does not show the account yet.
    expect(view({ progress: progressFromJob(finished) })).toEqual({ kind: "verifying" });
    expect(
      view({ progress: progressFromJob(finished), now: Date.parse(T0) + DETECTION_GRACE_MS + 1 })
        .kind,
    ).toBe("failed");
    // Detected (stubbed provider snapshot): found, not used until confirmed.
    const found = view({ provider: provider(), progress: progressFromJob(finished) });
    expect(found.kind).toBe("found");
    const inUse = view({
      provider: provider(),
      progress: progressFromJob(finished),
      confirmed: () => true,
    });
    expect(inUse.kind).toBe("in-use");
    if (inUse.kind === "in-use") expect(inUse.account.plan).toBe("Claude Pro");
  });

  it("another account: a running sign-in wins over the signed-in account", () => {
    const running = job([], "signin");
    expect(view({ provider: provider(), progress: progressFromJob(running) }).kind).toBe("working");
  });

  it("shows a failure with its code and log, retry starts over", () => {
    const failed = job([
      { type: "fail", code: "network", detail: "offline" },
      { type: "log", text: "curl: 6" },
    ]);
    expect(view({ progress: progressFromJob(failed) })).toEqual({
      kind: "failed",
      code: "network",
      detail: "offline",
      log: "curl: 6",
    });
  });
});

describe("CLI settings patch", () => {
  const atSignin = job([
    { type: "downloaded" },
    { type: "installed", binaryPath: "/h/.local/bin/claude", onPath: false },
  ]);
  it("points the provider at the new CLI when it is not on PATH", () => {
    expect(
      cliProviderPatch({ provider: notInstalled, instance: undefined, job: atSignin }),
    ).toEqual({
      enabled: true,
      binaryPath: "/h/.local/bin/claude",
    });
    expect(
      cliProviderPatch({
        provider: notInstalled,
        instance: { driver: "claudeAgent", config: { binaryPath: "/h/.local/bin/claude" } },
        job: atSignin,
      }),
    ).toBeNull();
  });
  it("only enables it when the CLI is on PATH", () => {
    const onPath = job([
      { type: "already-installed", binaryPath: "/usr/bin/claude", onPath: true },
    ]);
    expect(cliProviderPatch({ provider: signedOut, instance: undefined, job: onPath })).toBeNull();
    expect(
      cliProviderPatch({
        provider: provider({ enabled: false }),
        instance: undefined,
        job: onPath,
      }),
    ).toEqual({ enabled: true, binaryPath: null });
    expect(cliProviderPatch({ provider: signedOut, instance: undefined, job: job([]) })).toBeNull();
  });
});

describe("Google (Antigravity)", () => {
  const google = (overrides: Record<string, unknown> = {}) =>
    provider({
      instanceId: "antigravity",
      driver: "antigravity",
      installed: false,
      status: "error",
      auth: { status: "unknown" },
      ...overrides,
    });
  const install = (phase: ProviderInstallState["phase"]): ProviderInstallState =>
    ({
      driver: "antigravity",
      operationId: "op",
      phase,
      downloadedBytes: 1_000_000,
      totalBytes: 100_000_000,
      version: "1.4.5",
      installedVersion: null,
      canRemove: false,
      message: phase === "failed" ? "Checksum mismatch" : null,
    }) as ProviderInstallState;
  const auth = (phase: ProviderAuthState["phase"], url: string | null = null): ProviderAuthState =>
    ({
      instanceId: "antigravity",
      phase,
      flowId: "flow",
      authorizationUrl: url,
      expiresAt: null,
      message: null,
      interaction: url
        ? { type: "browser", id: "flow", url, requiresConsent: false, acceptsCallback: true }
        : null,
    }) as ProviderAuthState;

  it("enables the provider with the Google account sign-in, installs, then signs in", () => {
    const base = { requested: true, install: null, auth: null, fired: new Set<string>() };
    expect(
      nextGoogleAction({ ...base, provider: google({ enabled: false }), authMethod: null }),
    ).toBe("enable");
    expect(
      nextGoogleAction({
        ...base,
        provider: google({ enabled: false }),
        authMethod: null,
        fired: new Set(["enable"]),
      }),
    ).toBeNull();
    expect(nextGoogleAction({ ...base, provider: google(), authMethod: "gemini-api-key" })).toBe(
      "enable",
    );
    expect(nextGoogleAction({ ...base, provider: google(), authMethod: "oauth-personal" })).toBe(
      "install",
    );
    expect(
      nextGoogleAction({
        ...base,
        provider: google(),
        authMethod: "oauth-personal",
        install: install("downloading"),
      }),
    ).toBeNull();
    expect(
      nextGoogleAction({
        ...base,
        provider: google(),
        authMethod: "oauth-personal",
        install: install("failed"),
      }),
    ).toBeNull();
    const installed = google({ installed: true, auth: { status: "unauthenticated" } });
    expect(nextGoogleAction({ ...base, provider: installed, authMethod: "oauth-personal" })).toBe(
      "signin",
    );
    expect(
      nextGoogleAction({
        ...base,
        provider: installed,
        authMethod: "oauth-personal",
        auth: auth("waiting", "https://x"),
      }),
    ).toBeNull();
    expect(
      nextGoogleAction({
        ...base,
        provider: google({ installed: true, auth: { status: "authenticated" } }),
        authMethod: "oauth-personal",
      }),
    ).toBeNull();
    expect(
      nextGoogleAction({
        ...base,
        requested: false,
        provider: installed,
        authMethod: "oauth-personal",
      }),
    ).toBeNull();
  });

  it("maps upstream's install and sign-in states to the same steps", () => {
    const at = { requested: true, skippedInstall: false, now: 1 };
    const downloading = progressFromGoogle({ ...at, install: install("downloading"), auth: null })!;
    expect(downloading.step).toBe("download");
    expect(downloading.bytes).toEqual({ done: 1_000_000, total: 100_000_000 });
    expect(progressFromGoogle({ ...at, install: install("extracting"), auth: null })!.step).toBe(
      "install",
    );
    const browser = progressFromGoogle({
      ...at,
      install: install("succeeded"),
      auth: auth("waiting", "https://accounts.google.com/o/oauth2"),
    })!;
    expect(browser.phase).toBe("waiting-browser");
    expect(browser.input).toBe("callback");
    expect(stepStatuses(browser).map((s) => s.status)).toEqual(["done", "done", "active"]);
    expect(progressFromGoogle({ ...at, install: install("failed"), auth: null })!.error?.code).toBe(
      "google-install",
    );
    expect(progressFromGoogle({ ...at, install: null, auth: auth("failed") })!.error?.code).toBe(
      "google-signin",
    );
    // Not requested and nothing running: no progress (an old failure is not shown).
    expect(
      progressFromGoogle({ ...at, requested: false, install: install("failed"), auth: null }),
    ).toBeNull();
  });

  it("treats Google's unknown auth: signed in after a sign-in, else offers to sign in", () => {
    const installed = google({ installed: true, status: "warning", auth: { status: "unknown" } });
    expect(googleProviderForCard(installed, null)?.auth.status).toBe("unauthenticated");
    expect(googleProviderForCard(installed, auth("succeeded"))?.auth.status).toBe("authenticated");
    expect(view({ provider: googleProviderForCard(installed, null) })).toEqual({
      kind: "idle",
      action: "signin",
    });
    expect(googleProviderForCard(google(), null)).toEqual(google());
  });

  it("names Google accounts by their sign-in method", () => {
    expect(classifyAiAccount({ type: "oauth-personal", label: "Google account" })).toBe("personal");
    expect(classifyAiAccount({ type: "oauth-business", label: "Gemini Enterprise" })).toBe(
      "company",
    );
    expect(classifyAiAccount({ type: "gemini-api-key", label: "Gemini API key" })).toBe("api");
  });
});

describe("safety", () => {
  it("only shows sign-in links on the provider's own hosts", () => {
    expect(
      safeAiConnectLoginUrl("claude", "https://claude.com/cai/oauth/authorize?a=1"),
    ).not.toBeNull();
    expect(safeAiConnectLoginUrl("claude", "http://claude.com/cai/oauth/authorize")).toBeNull();
    expect(safeAiConnectLoginUrl("claude", "https://claude.com.evil.example/oauth")).toBeNull();
    expect(
      safeAiConnectLoginUrl("codex", "https://auth.openai.com/oauth/authorize"),
    ).not.toBeNull();
    expect(safeAiConnectLoginUrl("codex", "javascript:alert(1)")).toBeNull();
  });
  it("accepts one-line codes only", () => {
    expect(normalizeAiConnectCode("  abcDEF123#xyz_-.~ \n")).toBe("abcDEF123#xyz_-.~");
    expect(normalizeAiConnectCode("abc")).toBeNull();
    expect(normalizeAiConnectCode("abcdefgh; rm -rf ~")).toBeNull();
    expect(normalizeAiConnectCode("abcdefgh\nsecond")).toBeNull();
  });
  it("recognizes 'AI not connected' errors", () => {
    expect(
      isAiNotConnectedError(
        "Claude Code is not authenticated. Run `claude auth login` and try again.",
      ),
    ).toBe(true);
    expect(isAiNotConnectedError("Sign in via the CLI to authenticate again.")).toBe(true);
    expect(isAiNotConnectedError("Codex CLI is not installed")).toBe(true);
    expect(isAiNotConnectedError("ffmpeg is not installed")).toBe(false);
    expect(isAiNotConnectedError("Rate limit reached")).toBe(false);
    expect(isAiNotConnectedError(null)).toBe(false);
  });
});
