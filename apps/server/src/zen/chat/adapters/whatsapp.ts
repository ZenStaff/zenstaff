// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off -- A plain REST client and relay handler, called outside the Effect runtime.
// Zen Staff chat integrations: WhatsApp, only through Meta's official WhatsApp Business Cloud API
// (no WhatsApp Web automation). Meta calls a webhook, so events come through the Zen hub relay;
// the runner checks `X-Hub-Signature-256` with the app secret itself. WhatsApp has no channels or
// threads: each customer/employee number is one direct conversation. Meta's 24-hour rule: free-form
// messages only within 24 hours of the person's last message; outside it (and for reports, which
// the agent sends on its own) only an approved template may be sent.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import type {
  ChatUser,
  ConversationTarget,
  InboundEvent,
  OutboundMessage,
  PlatformClient,
} from "../model.ts";
import { verifyMetaSignature } from "../signatures.ts";
import { attachmentKind } from "../text.ts";
import {
  hostAllowed,
  PlatformApiError,
  readJsonResponse,
  type AdapterFactory,
  type ConnectionRuntime,
  type ManifestBuilder,
} from "./types.ts";

const WHATSAPP_API = "https://graph.facebook.com/v21.0";
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MEDIA_HOSTS = ["lookaside.fbsbx.com", "graph.facebook.com", /(^|\.)fbcdn\.net$/] as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

// Translation (pure)

export interface WhatsAppInbound {
  readonly waId: string;
  readonly messageId: string;
}

const MEDIA_TYPES = ["image", "document", "audio", "video", "voice", "sticker"] as const;

/** A webhook body (`object: whatsapp_business_account`) as inbound events. Statuses are ignored. */
export function translateWhatsAppWebhook(payload: unknown): InboundEvent[] {
  const body = asRecord(payload);
  if (str(body.object) !== "whatsapp_business_account") return [];
  const events: InboundEvent[] = [];
  for (const entry of list(body.entry)) {
    for (const change of list(entry.changes)) {
      if (str(change.field) !== "messages") continue;
      const value = asRecord(change.value);
      const phoneNumberId = str(asRecord(value.metadata).phone_number_id);
      const contacts = list(value.contacts);
      for (const message of list(value.messages)) {
        const from = str(message.from);
        const contact = contacts.find((candidate) => str(candidate.wa_id) === from);
        const user: ChatUser = {
          id: from,
          name: str(asRecord(contact?.profile).name) || `+${from}`,
        };
        const base = {
          platform: "whatsapp" as const,
          workspaceId: phoneNumberId,
          channelId: from,
          threadId: null,
          messageId: str(message.id),
          user,
        };
        const type = str(message.type);
        if (type === "interactive") {
          const interactive = asRecord(message.interactive);
          const reply = asRecord(interactive.button_reply ?? interactive.list_reply);
          if (str(reply.id) !== "") events.push({ ...base, type: "action", value: str(reply.id) });
          continue;
        }
        if (type === "button") {
          const payloadValue = str(asRecord(message.button).payload);
          if (payloadValue !== "") events.push({ ...base, type: "action", value: payloadValue });
          continue;
        }
        let text = "";
        const attachments = [];
        if (type === "text") text = str(asRecord(message.text).body);
        else if ((MEDIA_TYPES as ReadonlyArray<string>).includes(type) && type !== "sticker") {
          const media = asRecord(message[type]);
          const mimeType = (str(media.mime_type) || "application/octet-stream")
            .split(";")[0]!
            .trim();
          text = str(media.caption);
          const extension = mimeType.split("/")[1] ?? "bin";
          attachments.push({
            id: str(media.id),
            name: str(media.filename) || `${type}-${str(media.id).slice(-6)}.${extension}`,
            mimeType,
            sizeBytes: null,
            kind:
              type === "document"
                ? ("file" as const)
                : type === "voice"
                  ? ("audio" as const)
                  : attachmentKind(mimeType),
            ref: str(media.id),
          });
        } else {
          continue;
        }
        events.push({
          ...base,
          type: "message",
          channelType: "dm",
          text: text.trim(),
          mentioned: true,
          attachments,
          command: null,
        });
      }
    }
  }
  return events;
}

/** The last message from each number, for the 24-hour window and read/typing receipts. */
function latestInbound(payload: unknown): ReadonlyArray<WhatsAppInbound> {
  return translateWhatsAppWebhook(payload).map((event) => ({
    waId: event.channelId,
    messageId: event.messageId,
  }));
}

/** `name:language` from the reportTemplate setting. */
function parseTemplateSetting(
  value: string | undefined,
): { name: string; language: string } | null {
  const match = /^\s*([a-z0-9_]+)\s*:\s*([A-Za-z_]{2,8})\s*$/.exec(value ?? "");
  return match ? { name: match[1]!, language: match[2]! } : null;
}

/** Template parameters may not contain line breaks, tabs or long runs of spaces. */
export function templateParameter(text: string): string {
  return text
    .replace(/\s*\n+\s*/g, " | ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim()
    .slice(0, 1000);
}

// Client

export class WhatsAppConversations {
  private readonly lastInbound = new Map<string, { at: number; messageId: string }>();

  record(waId: string, messageId: string, at: number) {
    this.lastInbound.set(waId, { at, messageId });
  }

  windowOpen(waId: string, now: number): boolean {
    const last = this.lastInbound.get(waId);
    return last !== undefined && now - last.at < WHATSAPP_WINDOW_MS;
  }

  lastMessageId(waId: string): string | null {
    return this.lastInbound.get(waId)?.messageId ?? null;
  }
}

class WhatsAppRest {
  private readonly runtime: ConnectionRuntime;
  constructor(runtime: ConnectionRuntime) {
    this.runtime = runtime;
  }

  get base(): string {
    return (this.runtime.apiBase ?? WHATSAPP_API).replace(/\/$/, "");
  }

  token(): string {
    const token = this.runtime.secret("accessToken");
    if (token === null)
      throw new PlatformApiError("whatsapp", 0, "The WhatsApp access token is not stored.");
    return token;
  }

  async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const isForm = body instanceof FormData;
    const response = await this.runtime.fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token()}`,
        ...(body === undefined || isForm ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = asRecord(await readJsonResponse(response));
    if (!response.ok) {
      throw new PlatformApiError(
        "whatsapp",
        response.status,
        str(asRecord(json.error).message) || `WhatsApp answered ${response.status}.`,
      );
    }
    return json;
  }
}

export function createWhatsAppClient(
  runtime: ConnectionRuntime,
  conversations: WhatsAppConversations,
  rest = new WhatsAppRest(runtime),
): PlatformClient {
  const phoneNumberId = () => runtime.connection.settings.phoneNumberId ?? "";
  const messagesPath = () => `/${phoneNumberId()}/messages`;
  const sentId = (json: Record<string, unknown>) => str(list(json.messages)[0]?.id);

  const sendTemplate = async (to: string, text: string) => {
    const template = parseTemplateSetting(runtime.connection.settings.reportTemplate);
    if (template === null) {
      throw new PlatformApiError(
        "whatsapp",
        0,
        "WhatsApp allows messages outside the 24-hour window only as an approved template. Set the report template (name:language).",
      );
    }
    return sentId(
      await rest.call("POST", messagesPath(), {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          components: [
            { type: "body", parameters: [{ type: "text", text: templateParameter(text) }] },
          ],
        },
      }),
    );
  };

  const post = async (target: ConversationTarget, message: OutboundMessage) => {
    const to = target.channelId;
    if (message.proactive === true || !conversations.windowOpen(to, runtime.now())) {
      return { messageId: await sendTemplate(to, message.text) };
    }
    const context = target.replyTo ? { context: { message_id: target.replyTo } } : {};
    const body =
      message.buttons && message.buttons.length > 0
        ? {
            type: "interactive",
            interactive: {
              type: "button",
              body: { text: message.text.slice(0, 1024) || "-" },
              action: {
                buttons: message.buttons.slice(0, 3).map((button) => ({
                  type: "reply",
                  reply: { id: button.value.slice(0, 256), title: button.label.slice(0, 20) },
                })),
              },
            },
          }
        : { type: "text", text: { body: message.text, preview_url: false } };
    const json = await rest.call("POST", messagesPath(), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      ...context,
      ...body,
    });
    return { messageId: sentId(json) };
  };

  return {
    platform: "whatsapp",
    post,
    async typing(target) {
      const messageId = conversations.lastMessageId(target.channelId);
      if (messageId === null || !conversations.windowOpen(target.channelId, runtime.now())) return;
      await rest.call("POST", messagesPath(), {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      });
    },
    async upload(target, file) {
      if (!conversations.windowOpen(target.channelId, runtime.now())) {
        throw new PlatformApiError(
          "whatsapp",
          0,
          "Files can be sent only within 24 hours of the person's last message.",
        );
      }
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", file.mimeType);
      form.append(
        "file",
        new Blob([await NodeFS.promises.readFile(file.path)], { type: file.mimeType }),
        file.name,
      );
      const media = await rest.call("POST", `/${phoneNumberId()}/media`, form);
      const kind = attachmentKind(file.mimeType);
      const type = kind === "file" ? "document" : kind;
      await rest.call("POST", messagesPath(), {
        messaging_product: "whatsapp",
        to: target.channelId,
        type,
        [type]: {
          id: str(media.id),
          ...(type === "document" ? { filename: file.name } : {}),
          ...(type !== "audio" && file.title !== file.name ? { caption: file.title } : {}),
        },
      });
    },
    async directMessage(_workspaceId, userId, message) {
      // Buttons need the 24-hour window: outside it the engine falls back to the thread card.
      if (!conversations.windowOpen(userId, runtime.now())) return null;
      const sent = await post(
        { workspaceId: phoneNumberId(), channelId: userId, threadId: null },
        message,
      );
      return { channelId: userId, messageId: sent.messageId };
    },
    async download(attachment) {
      const media = await rest.call("GET", `/${encodeURIComponent(attachment.ref)}`);
      const url = str(media.url);
      if (!hostAllowed(url, MEDIA_HOSTS, runtime.apiBase)) {
        throw new PlatformApiError("whatsapp", 0, "The media address is not a Meta host.");
      }
      const response = await runtime.fetch(url, {
        headers: { authorization: `Bearer ${rest.token()}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new PlatformApiError("whatsapp", response.status, "Download failed.");
      return new Uint8Array(await response.arrayBuffer());
    },
    async answer(event, text) {
      if (text.trim() === "") return;
      await post(
        { workspaceId: event.workspaceId, channelId: event.channelId, threadId: null },
        { text },
      );
    },
  };
}

// Adapter

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && NodeCrypto.timingSafeEqual(a, b);
}

export const createWhatsAppAdapter: AdapterFactory = (runtime) => {
  const conversations = new WhatsAppConversations();
  const rest = new WhatsAppRest(runtime);
  const client = createWhatsAppClient(runtime, conversations, rest);
  const ok = { status: 200, headers: { "content-type": "application/json" }, body: "{}" };

  return {
    client,
    start() {
      const missing = ["accessToken", "appSecret", "verifyToken"].filter(
        (id) => runtime.secret(id) === null,
      );
      const ready =
        missing.length === 0 && (runtime.connection.settings.phoneNumberId ?? "") !== "";
      runtime.setStatus(
        ready ? "waiting-relay" : "error",
        ready
          ? "Waiting for WhatsApp events through the hub."
          : "Add the phone number ID, access token, app secret and verify token.",
      );
    },
    stop() {
      runtime.setStatus("stopped", null);
    },
    async handleWebhook(request) {
      const method = request.method.toUpperCase();
      if (method === "GET") {
        const verifyToken = runtime.secret("verifyToken");
        const sent = request.query["hub.verify_token"] ?? "";
        if (
          request.query["hub.mode"] === "subscribe" &&
          verifyToken !== null &&
          safeEqual(sent, verifyToken)
        ) {
          return {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: request.query["hub.challenge"] ?? "",
          };
        }
        return { status: 403, body: "forbidden" };
      }
      if (method !== "POST") return { status: 405, body: "method not allowed" };
      const appSecret = runtime.secret("appSecret");
      if (appSecret === null) return { status: 401, body: "unauthorized" };
      const verdict = verifyMetaSignature({
        appSecret,
        headers: request.headers,
        body: request.body,
      });
      if (!verdict.ok) {
        runtime.log(`whatsapp: refused webhook: ${verdict.reason}`);
        return { status: 401, body: "unauthorized" };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(request.body));
      } catch {
        return ok;
      }
      runtime.setStatus("connected", null);
      const now = runtime.now();
      for (const inbound of latestInbound(payload))
        conversations.record(inbound.waId, inbound.messageId, now);
      for (const event of translateWhatsAppWebhook(payload)) {
        // Meta retries anything slower than a few seconds: answer first, work after.
        void runtime
          .emit(event)
          .catch((error) => runtime.log(`whatsapp: event failed: ${String(error)}`));
      }
      return ok;
    },
    async test() {
      try {
        const phone = await rest.call(
          "GET",
          `/${runtime.connection.settings.phoneNumberId ?? ""}?fields=display_phone_number,verified_name`,
        );
        return {
          ok: true,
          detail: `${str(phone.verified_name)} ${str(phone.display_phone_number)}`.trim(),
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

export const whatsAppManifest: ManifestBuilder = ({ webhookUrl }) => ({
  kind: "text",
  fileName: null,
  openUrl: "https://developers.facebook.com/apps/",
  content: [
    "Meta for Developers > your app (type Business) > WhatsApp > Configuration > Webhook:",
    `Callback URL: ${webhookUrl ?? "<shown once the connection is saved and the hub is linked>"}`,
    'Verify token: the same value you store in Zen Staff as "Webhook verify token" (choose a long random string).',
    'Webhook fields: subscribe to "messages" only.',
    "",
    "Business settings > Users > System users: create a system user, assign the app and the WhatsApp account, generate a token with whatsapp_business_messaging and whatsapp_business_management.",
    "App settings > Basic > App secret: store it in Zen Staff (used to check X-Hub-Signature-256).",
    "Reports and messages outside the 24-hour customer-service window need an approved template with one body variable ({{1}}); set it as name:language, e.g. zen_report:ro.",
    "Only the official Cloud API is used; personal WhatsApp accounts and WhatsApp Web are never automated.",
  ].join("\n"),
});
