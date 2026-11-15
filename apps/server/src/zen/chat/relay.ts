// Zen Staff chat integrations: the hub relay seam for webhook platforms (Teams, Google Chat,
// WhatsApp). The hub forwards `chat.webhook` frames over the runner socket; the runner verifies
// each platform signature itself, so the hub cannot forge events. Contract: docs/zen-chat-integrations.md.
import type { RelayedRequest, RelayedResponse } from "./model.ts";

export type ChatRelayHandler = (
  connectionId: string,
  request: RelayedRequest,
) => Promise<RelayedResponse>;

let handler: ChatRelayHandler | null = null;

export function setZenChatRelayHandler(next: ChatRelayHandler | null): void {
  handler = next;
}

const MAX_BODY = 4 * 1024 * 1024;

const record = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [key.toLowerCase(), item as string]),
  );
};

/** Parses the relay frame's input; null when it is not a well-formed chat webhook. */
export function decodeRelayInput(
  input: unknown,
): { readonly connectionId: string; readonly request: RelayedRequest } | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const connectionId = typeof raw.connectionId === "string" ? raw.connectionId : "";
  if (!/^[a-z0-9-]{1,64}$/.test(connectionId)) return null;
  const method = typeof raw.method === "string" ? raw.method.toUpperCase() : "";
  if (method !== "GET" && method !== "POST") return null;
  const bodyBase64 = typeof raw.bodyBase64 === "string" ? raw.bodyBase64 : "";
  if (bodyBase64.length > (MAX_BODY * 4) / 3 + 4) return null;
  return {
    connectionId,
    request: {
      method,
      path: typeof raw.path === "string" ? raw.path : "/",
      // Query keys keep their case (WhatsApp sends hub.mode / hub.verify_token / hub.challenge).
      query: Object.fromEntries(
        Object.entries((raw.query ?? {}) as Record<string, unknown>).filter(
          ([, value]) => typeof value === "string",
        ),
      ) as Record<string, string>,
      headers: record(raw.headers),
      body: new Uint8Array(Buffer.from(bodyBase64, "base64")),
    },
  };
}

/** Called by ZenHub's relay handler for `chat.*` ops. */
export async function handleZenChatRelay(op: string, input: unknown): Promise<RelayedResponse> {
  if (op !== "chat.webhook") return { status: 400, body: "unknown chat op" };
  if (handler === null) return { status: 503, body: "chat integrations are not running here" };
  const decoded = decodeRelayInput(input);
  if (decoded === null) return { status: 400, body: "bad relay request" };
  return handler(decoded.connectionId, decoded.request);
}

/** The address a platform must call for this connection (through the hub). */
export function webhookUrlFor(
  hubUrl: string | null,
  environmentId: string | null,
  connectionId: string,
): string | null {
  if (hubUrl === null || environmentId === null) return null;
  return `${hubUrl.replace(/\/$/, "")}/v1/chat/webhook/${encodeURIComponent(environmentId)}/${encodeURIComponent(connectionId)}`;
}
