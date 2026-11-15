// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Long-polling client: timers outside the Effect runtime.
// Zen Staff chat integrations: Telegram. The runner long-polls the Bot API (`getUpdates`, outbound
// only, no webhook). Keep the bot's group privacy mode on: in groups it then only receives
// commands, mentions and replies to its own messages.
import * as NodeFS from "node:fs";

import type { InboundAttachment, InboundEvent, OutboundMessage, PlatformClient } from "../model.ts";
import { verifyTelegramSecret } from "../signatures.ts";
import { attachmentKind, parseZenCommand } from "../text.ts";
import {
  backoffMs,
  hostAllowed,
  PlatformApiError,
  readJsonResponse,
  type AdapterFactory,
  type AdapterInstance,
  type ConnectionRuntime,
  type ManifestBuilder,
} from "./types.ts";

const TELEGRAM_API = "https://api.telegram.org";

type Json = Record<string, unknown>;
const str = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};

export interface TelegramContext {
  readonly botUsername: string;
  readonly botId: string | null;
  /** Bot message id -> the conversation root it belongs to (replies to the bot continue it). */
  readonly rootOf: (chatId: string, messageId: string) => string | null;
}

function telegramAttachments(message: Json): InboundAttachment[] {
  const out: InboundAttachment[] = [];
  const add = (file: Json, name: string, mimeType: string) => {
    const id = str(file.file_id);
    if (id === "") return;
    out.push({
      id: str(file.file_unique_id) || id,
      name,
      mimeType,
      sizeBytes: typeof file.file_size === "number" ? file.file_size : null,
      kind: attachmentKind(mimeType),
      ref: id,
    });
  };
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Sizes come smallest first; take the largest.
    add(obj(message.photo.at(-1)), `photo-${str(message.message_id)}.jpg`, "image/jpeg");
  }
  const document = obj(message.document);
  if (str(document.file_id))
    add(
      document,
      str(document.file_name) || "document",
      str(document.mime_type) || "application/octet-stream",
    );
  const audio = obj(message.audio);
  if (str(audio.file_id))
    add(audio, str(audio.file_name) || "audio.mp3", str(audio.mime_type) || "audio/mpeg");
  const voice = obj(message.voice);
  if (str(voice.file_id))
    add(voice, `voice-${str(message.message_id)}.ogg`, str(voice.mime_type) || "audio/ogg");
  const video = obj(message.video);
  if (str(video.file_id))
    add(video, str(video.file_name) || "video.mp4", str(video.mime_type) || "video/mp4");
  return out;
}

function userOf(from: Json) {
  const name = [str(from.first_name), str(from.last_name)].filter((part) => part !== "").join(" ");
  return {
    id: str(from.id),
    name: name || str(from.username) || str(from.id),
    isBot: from.is_bot === true,
  };
}

/** One update from getUpdates (or a webhook) -> inbound events. */
export function translateTelegramUpdate(update: Json, context: TelegramContext): InboundEvent[] {
  const callback = obj(update.callback_query);
  if (str(callback.id) !== "") {
    const message = obj(callback.message);
    const chat = obj(message.chat);
    const chatId = str(chat.id);
    return [
      {
        type: "action",
        platform: "telegram",
        workspaceId: "telegram",
        channelId: chatId,
        threadId: null,
        messageId: str(message.message_id),
        user: userOf(obj(callback.from)),
        value: str(callback.data),
        responseRef: str(callback.id),
      },
    ];
  }
  const message = obj(update.message);
  if (str(message.message_id) === "") return [];
  const chat = obj(message.chat);
  const chatId = str(chat.id);
  const chatType = str(chat.type);
  const rawText = str(message.text) || str(message.caption);
  const botMention = new RegExp(`@${context.botUsername.replace(/[^\w]/g, "")}\\b`, "gi");
  const mentionTest = new RegExp(`@${context.botUsername.replace(/[^\w]/g, "")}\\b`, "i");
  const entities = [
    ...(Array.isArray(message.entities) ? message.entities : []),
    ...(Array.isArray(message.caption_entities) ? message.caption_entities : []),
  ].map(obj);
  const mentionsBot = entities.some((entity) => {
    const type = str(entity.type);
    if (type !== "mention" && type !== "bot_command") return false;
    const offset = Number(entity.offset);
    const piece = rawText.slice(offset, offset + Number(entity.length));
    return mentionTest.test(piece) || (type === "bot_command" && chatType === "private");
  });
  const replyTo = obj(message.reply_to_message);
  const repliesToBot =
    str(obj(replyTo.from).id) !== "" && str(obj(replyTo.from).id) === (context.botId ?? "\u0000");
  const replyRoot =
    str(replyTo.message_id) !== "" ? context.rootOf(chatId, str(replyTo.message_id)) : null;
  const text = rawText
    .replace(botMention, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const command = parseZenCommand(text);
  return [
    {
      type: "message",
      platform: "telegram",
      workspaceId: "telegram",
      channelId: chatId,
      channelType: chatType === "private" ? "dm" : "group",
      // A private chat is one running conversation; in groups a reply to the bot continues its thread.
      threadId:
        chatType === "private"
          ? null
          : (replyRoot ?? (repliesToBot ? str(replyTo.message_id) : null)),
      messageId: str(message.message_id),
      user: userOf(obj(message.from)),
      text: command ? command.args : text,
      mentioned: chatType === "private" || mentionsBot || repliesToBot || command !== null,
      attachments: telegramAttachments(message),
      command,
    },
  ];
}

export function telegramSendBody(
  chatId: string,
  message: OutboundMessage,
  replyTo: string | null,
): Json {
  return {
    chat_id: chatId,
    text: message.text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyTo
      ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } }
      : {}),
    ...(message.buttons && message.buttons.length > 0
      ? {
          reply_markup: {
            inline_keyboard: [
              message.buttons.map((button) => ({
                text: button.label,
                callback_data: button.value.slice(0, 64),
              })),
            ],
          },
        }
      : {}),
  };
}

class TelegramApi {
  private readonly runtime: ConnectionRuntime;
  constructor(runtime: ConnectionRuntime) {
    this.runtime = runtime;
  }

  get base(): string {
    return this.runtime.apiBase ?? TELEGRAM_API;
  }

  private token(): string {
    const token = this.runtime.secret("botToken");
    if (token === null)
      throw new PlatformApiError("telegram", 401, "The Telegram bot token is not stored.");
    return token;
  }

  async call(method: string, body: Json | FormData, timeoutMs = 20_000): Promise<unknown> {
    const isForm = body instanceof FormData;
    const response = await this.runtime.fetch(`${this.base}/bot${this.token()}/${method}`, {
      method: "POST",
      ...(isForm
        ? { body }
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = obj(await readJsonResponse(response));
    if (json.ok !== true) {
      throw new PlatformApiError(
        "telegram",
        response.status,
        `${method}: ${str(json.description) || response.status}`,
      );
    }
    return json.result;
  }

  fileUrl(filePath: string): string {
    return `${this.base}/file/bot${this.token()}/${filePath}`;
  }
}

export const createTelegramAdapter: AdapterFactory = (
  runtime: ConnectionRuntime,
): AdapterInstance => {
  const api = new TelegramApi(runtime);
  const botUsername = (runtime.connection.settings.botUsername ?? "").replace(/^@/, "");
  let botId: string | null = null;
  /** chatId:botMessageId -> conversation root (in memory; older replies start a new thread). */
  const roots = new Map<string, string>();
  const remember = (chatId: string, messageId: string, root: string | null) => {
    if (root === null) return;
    roots.set(`${chatId}:${messageId}`, root);
    if (roots.size > 5000) roots.delete(roots.keys().next().value!);
  };

  const client: PlatformClient = {
    platform: "telegram",
    async post(target, message) {
      const result = obj(
        await api.call(
          "sendMessage",
          telegramSendBody(target.channelId, message, target.replyTo ?? target.threadId ?? null),
        ),
      );
      const id = str(result.message_id);
      remember(target.channelId, id, target.threadId);
      return { messageId: id };
    },
    async update(target, messageId, message) {
      await api.call("editMessageText", {
        chat_id: target.channelId,
        message_id: Number(messageId),
        text: message.text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: message.buttons
            ? [
                message.buttons.map((button) => ({
                  text: button.label,
                  callback_data: button.value.slice(0, 64),
                })),
              ]
            : [],
        },
      });
    },
    async typing(target) {
      await api.call("sendChatAction", { chat_id: target.channelId, action: "typing" });
    },
    async directMessage(_workspaceId, userId, message) {
      // Works once the person has opened the bot (Telegram does not let bots write first).
      const result = obj(await api.call("sendMessage", telegramSendBody(userId, message, null)));
      return { channelId: userId, messageId: str(result.message_id) };
    },
    async upload(target, file) {
      const form = new FormData();
      const method =
        file.mimeType.startsWith("image/") &&
        file.mimeType !== "image/svg+xml" &&
        file.sizeBytes < 10 * 1024 * 1024
          ? "sendPhoto"
          : file.mimeType.startsWith("video/")
            ? "sendVideo"
            : file.mimeType.startsWith("audio/")
              ? "sendAudio"
              : "sendDocument";
      const field =
        method === "sendPhoto"
          ? "photo"
          : method === "sendVideo"
            ? "video"
            : method === "sendAudio"
              ? "audio"
              : "document";
      form.set("chat_id", target.channelId);
      form.set("caption", file.title.slice(0, 1000));
      const replyTo = target.replyTo ?? target.threadId;
      if (replyTo)
        form.set(
          "reply_parameters",
          JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true }),
        );
      form.set(
        field,
        new Blob([await NodeFS.promises.readFile(file.path)], { type: file.mimeType }),
        file.name,
      );
      await api.call(method, form, 120_000);
    },
    async download(attachment) {
      const file = obj(await api.call("getFile", { file_id: attachment.ref }));
      const path = str(file.file_path);
      if (path === "" || path.includes(".."))
        throw new PlatformApiError("telegram", 400, "no file path");
      const url = api.fileUrl(path);
      if (!hostAllowed(url, ["api.telegram.org"], runtime.apiBase))
        throw new PlatformApiError("telegram", 400, "bad host");
      const response = await runtime.fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new PlatformApiError("telegram", response.status, "download failed");
      return new Uint8Array(await response.arrayBuffer());
    },
    async answer(event, text) {
      if (event.type === "action" && event.responseRef) {
        await api.call("answerCallbackQuery", {
          callback_query_id: event.responseRef,
          ...(text ? { text: text.replace(/<[^>]+>/g, "").slice(0, 190) } : {}),
        });
        return;
      }
      if (text !== "") {
        await client.post(
          {
            workspaceId: event.workspaceId,
            channelId: event.channelId,
            threadId: null,
            replyTo: event.messageId || null,
          },
          { text },
        );
      }
    },
  };

  let stopped = true;
  let offset = 0;
  let attempt = 0;
  let controller: AbortController | null = null;

  const emitUpdate = async (update: Json) => {
    const context: TelegramContext = {
      botUsername,
      botId,
      rootOf: (chatId, messageId) => roots.get(`${chatId}:${messageId}`) ?? null,
    };
    for (const event of translateTelegramUpdate(update, context)) await runtime.emit(event);
  };

  const loop = async () => {
    runtime.setStatus("connecting", null);
    while (!stopped) {
      try {
        if (botId === null) botId = str(obj(await api.call("getMe", {})).id) || null;
        controller = new AbortController();
        const response = await runtime.fetch(
          `${api.base}/bot${runtime.secret("botToken") ?? ""}/getUpdates`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              offset,
              timeout: 25,
              allowed_updates: ["message", "callback_query"],
            }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]),
          },
        );
        const json = obj(await readJsonResponse(response));
        if (json.ok !== true) {
          throw new PlatformApiError(
            "telegram",
            response.status,
            response.status === 409
              ? "A webhook is set for this bot; long polling needs it removed (deleteWebhook)."
              : str(json.description) || `HTTP ${response.status}`,
          );
        }
        attempt = 0;
        runtime.setStatus("connected", null);
        for (const update of Array.isArray(json.result) ? json.result.map(obj) : []) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          await emitUpdate(update).catch((error) =>
            runtime.log(`telegram: event failed: ${String(error)}`),
          );
        }
      } catch (error) {
        if (stopped) break;
        runtime.setStatus("error", error instanceof Error ? error.message : String(error));
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt++)));
      }
    }
  };

  return {
    client,
    start() {
      if (!stopped) return;
      stopped = false;
      void loop();
    },
    stop() {
      stopped = true;
      controller?.abort();
      runtime.setStatus("stopped", null);
    },
    /** Webhook variant over the hub relay (not the default): the secret token header is checked. */
    async handleWebhook(request) {
      const secretToken = runtime.secret("webhookSecret");
      if (secretToken === null) return { status: 404, body: "not configured" };
      const verdict = verifyTelegramSecret({ secretToken, headers: request.headers });
      if (!verdict.ok) return { status: 401, body: verdict.reason };
      void emitUpdate(obj(JSON.parse(new TextDecoder().decode(request.body)))).catch(
        () => undefined,
      );
      return { status: 200, body: "" };
    },
    async test() {
      try {
        const me = obj(await api.call("getMe", {}));
        botId = str(me.id) || botId;
        const username = str(me.username);
        const mismatch = botUsername !== "" && username.toLowerCase() !== botUsername.toLowerCase();
        return {
          ok: !mismatch,
          detail: mismatch
            ? `The token belongs to @${username}, not @${botUsername}.`
            : `Connected as @${username}.`,
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

/** BotFather settings: the command list to paste after /setcommands, and the privacy note. */
export const telegramManifest: ManifestBuilder = () => ({
  kind: "text",
  fileName: null,
  content: [
    "/setcommands -> choose the bot -> paste:",
    "zen - Give a task to the AI staff (or: zen status, zen help)",
    "",
    "/setprivacy -> Enable (the bot reads only commands, mentions and replies to it in groups)",
    "/setjoingroups -> Enable only while you add the bot to your groups, then Disable",
  ].join("\n"),
  openUrl: "https://t.me/BotFather",
});
