// @effect-diagnostics extendsNativeError:off -- Plain errors of the platform HTTP clients, outside the Effect runtime.
// Zen Staff chat integrations: what every platform adapter provides. An adapter is created per
// connection with its secrets (read from the runner's vault on demand, never stored elsewhere),
// translates platform payloads to `InboundEvent`s for the engine, and implements `PlatformClient`.
// Outbound transports (Slack Socket Mode, Discord gateway, Telegram long polling) run in `start`;
// platforms that need a public HTTPS endpoint get their webhooks through the hub relay
// (`handleWebhook`), and check the platform's signature themselves.
import type {
  ZenChatConnection,
  ZenChatConnectionState,
  ZenChatPlatform,
} from "@t3tools/contracts/zenChat";

import type { InboundEvent, PlatformClient, RelayedRequest, RelayedResponse } from "../model.ts";

export interface ConnectionRuntime {
  readonly connection: ZenChatConnection;
  /** A secret from the runner's vault (null when not stored). Read it when needed; do not cache it on disk. */
  readonly secret: (secretId: string) => string | null;
  /** Hands an event to the engine. */
  readonly emit: (event: InboundEvent) => Promise<void>;
  readonly setStatus: (state: ZenChatConnectionState, detail: string | null) => void;
  readonly log: (message: string) => void;
  readonly fetch: typeof globalThis.fetch;
  readonly WebSocket: typeof globalThis.WebSocket;
  /**
   * Dev/test only (`ZEN_CHAT_<PLATFORM>_API_URL`): the platform's API base, so the local fake
   * platform harness can stand in for it. Unset in production.
   */
  readonly apiBase: string | null;
  readonly now: () => number;
  /** E-mail: the labels / folders the connection's bindings route from (besides the inbox). */
  readonly watchedLabels?: () => ReadonlyArray<string>;
}

export interface AdapterInstance {
  readonly client: PlatformClient;
  /** Starts the outbound transport (no-op for hub-relay platforms). */
  start(): void;
  stop(): void;
  /** Hub-relayed webhook (Teams, Google Chat, WhatsApp): verify, translate, emit, answer. */
  handleWebhook?(request: RelayedRequest): Promise<RelayedResponse>;
  /** A cheap authenticated call that proves the secrets work (auth.test, getMe, ...). */
  test(): Promise<{ readonly ok: boolean; readonly detail: string }>;
}

export type AdapterFactory = (runtime: ConnectionRuntime) => AdapterInstance;

/** Install material for the setup page: a manifest to paste, a file to upload, or a link. */
export interface PlatformManifest {
  readonly kind: "json" | "yaml" | "text" | "url";
  readonly fileName: string | null;
  readonly content: string;
  readonly openUrl: string | null;
}

export type ManifestBuilder = (input: {
  readonly connection: ZenChatConnection | null;
  readonly appName: string;
  readonly webhookUrl: string | null;
}) => PlatformManifest;

export class PlatformApiError extends Error {
  readonly status: number;
  readonly platform: ZenChatPlatform;
  constructor(platform: ZenChatPlatform, status: number, message: string) {
    super(message);
    this.platform = platform;
    this.status = status;
  }
}

/** Reconnect delays for outbound transports: 1 s doubling to 30 s. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/** A download may carry a bot token only to the platform's own hosts. */
export function hostAllowed(
  url: string,
  allowed: ReadonlyArray<string | RegExp>,
  apiBase: string | null,
): boolean {
  try {
    const parsed = new URL(url);
    if (apiBase !== null && parsed.origin === new URL(apiBase).origin) return true;
    if (parsed.protocol !== "https:") return false;
    return allowed.some((host) =>
      typeof host === "string" ? parsed.hostname === host : host.test(parsed.hostname),
    );
  } catch {
    return false;
  }
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
