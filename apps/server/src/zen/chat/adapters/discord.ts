// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off -- A plain gateway/REST client driven by sockets and timers outside the Effect runtime.
// Zen Staff chat integrations: Discord. The runner dials out to the gateway (WebSocket, v10); no
// public endpoint. Intents: GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES only, without the
// privileged MESSAGE_CONTENT intent: Discord still delivers the text of messages that mention the
// bot, reply to it, or are DMs, which is all the bot answers. Slash command `/zen` and buttons
// arrive as interactions over the same socket (so no Ed25519 endpoint is needed; see
// `verifyDiscordSignature` for the HTTP variant).
import * as NodeFS from "node:fs";

import type {
  ChatUser,
  InboundAttachment,
  InboundEvent,
  InboundMessage,
  OutboundMessage,
  PlatformClient,
} from "../model.ts";
import { attachmentKind, mimeFromName, stripMention } from "../text.ts";
import {
  backoffMs,
  hostAllowed,
  PlatformApiError,
  readJsonResponse,
  type AdapterFactory,
  type ConnectionRuntime,
  type ManifestBuilder,
} from "./types.ts";

const DISCORD_API = "https://discord.com/api/v10";
/** GUILDS (1) | GUILD_MESSAGES (1 << 9) | DIRECT_MESSAGES (1 << 12). No MESSAGE_CONTENT. */
export const DISCORD_INTENTS = 1 | (1 << 9) | (1 << 12);
/** View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files. */
export const DISCORD_PERMISSIONS = (
  (1n << 10n) |
  (1n << 11n) |
  (1n << 38n) |
  (1n << 16n) |
  (1n << 15n)
).toString();

const CDN_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"] as const;

// Translation (pure)

interface DiscordUser {
  readonly id: string;
  readonly username?: string;
  readonly global_name?: string | null;
  readonly bot?: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function toUser(raw: unknown): ChatUser {
  const user = asRecord(raw) as unknown as DiscordUser;
  return {
    id: str(user.id),
    name: str(user.global_name) || str(user.username) || str(user.id),
    isBot: user.bot === true,
  };
}

function toAttachments(raw: unknown): InboundAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const attachment = asRecord(item);
    const name = str(attachment.filename) || "file";
    const url = str(attachment.url);
    if (url === "") return [];
    const mimeType = str(attachment.content_type) || mimeFromName(name);
    return [
      {
        id: str(attachment.id),
        name,
        mimeType,
        sizeBytes: typeof attachment.size === "number" ? attachment.size : null,
        kind: attachmentKind(mimeType),
        ref: url,
      },
    ];
  });
}

/** A gateway dispatch (`t`, `d`) as inbound events. Own messages and unknown events give []. */
export function translateDiscordDispatch(
  type: string,
  data: unknown,
  botUserId: string | null,
): InboundEvent[] {
  const d = asRecord(data);
  if (type === "MESSAGE_CREATE") {
    const author = toUser(d.author);
    if (botUserId !== null && author.id === botUserId) return [];
    if (d.webhook_id !== undefined) return [];
    const guildId = str(d.guild_id);
    const dm = guildId === "";
    const mentions = Array.isArray(d.mentions) ? d.mentions.map((item) => asRecord(item)) : [];
    const referenced = asRecord(d.referenced_message);
    const mentioned =
      dm ||
      (botUserId !== null && mentions.some((mention) => str(mention.id) === botUserId)) ||
      (botUserId !== null && str(asRecord(referenced.author).id) === botUserId);
    let text = str(d.content);
    if (botUserId !== null) text = stripMention(text, new RegExp(`<@!?${botUserId}>`, "g"));
    text = text.replace(/<@!?(\d+)>/g, (_match, id: string) => {
      const user = mentions.find((mention) => str(mention.id) === id);
      return `@${user ? toUser(user).name : id}`;
    });
    const message: InboundMessage = {
      type: "message",
      platform: "discord",
      workspaceId: dm ? "dm" : guildId,
      channelId: str(d.channel_id),
      channelType: dm ? "dm" : "channel",
      threadId: null,
      messageId: str(d.id),
      user: author,
      text: text.trim(),
      mentioned,
      attachments: toAttachments(d.attachments),
      command: null,
    };
    return [message];
  }
  if (type === "INTERACTION_CREATE") {
    const guildId = str(d.guild_id);
    const dm = guildId === "";
    const user = toUser(asRecord(d.member).user ?? d.user);
    const responseRef = `${str(d.id)}:${str(d.token)}`;
    const interactionData = asRecord(d.data);
    if (d.type === 2 && str(interactionData.name) === "zen") {
      const options = Array.isArray(interactionData.options) ? interactionData.options : [];
      const args = options
        .map((option) => asRecord(option))
        .map((option) => (typeof option.value === "string" ? option.value : ""))
        .join(" ")
        .trim();
      return [
        {
          type: "message",
          platform: "discord",
          workspaceId: dm ? "dm" : guildId,
          channelId: str(d.channel_id),
          channelType: dm ? "dm" : "channel",
          threadId: null,
          messageId: "",
          user,
          text: args,
          mentioned: true,
          attachments: [],
          command: { args },
          responseRef,
        },
      ];
    }
    if (d.type === 3) {
      return [
        {
          type: "action",
          platform: "discord",
          workspaceId: dm ? "dm" : guildId,
          channelId: str(d.channel_id),
          threadId: null,
          messageId: str(asRecord(d.message).id),
          user,
          value: str(interactionData.custom_id),
          responseRef,
        },
      ];
    }
  }
  return [];
}

// REST client

function components(message: OutboundMessage): unknown[] {
  if (!message.buttons || message.buttons.length === 0) return [];
  return [
    {
      type: 1,
      components: message.buttons.slice(0, 5).map((button) => ({
        type: 2,
        style: button.style === "primary" ? 3 : button.style === "danger" ? 4 : 2,
        label: button.label.slice(0, 80),
        custom_id: button.value.slice(0, 100),
      })),
    },
  ];
}

class DiscordRest {
  private readonly runtime: ConnectionRuntime;
  constructor(runtime: ConnectionRuntime) {
    this.runtime = runtime;
  }

  get base(): string {
    return (this.runtime.apiBase ?? DISCORD_API).replace(/\/$/, "");
  }

  private token(): string {
    const token = this.runtime.secret("botToken");
    if (token === null)
      throw new PlatformApiError("discord", 0, "The Discord bot token is not stored.");
    return token;
  }

  async call(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
    retry = true,
  ): Promise<unknown> {
    const isForm = body instanceof FormData;
    const response = await this.runtime.fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bot ${this.token()}` } : {}),
        ...(body === undefined || isForm ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await readJsonResponse(response);
    if (response.status === 429 && retry) {
      const wait = Math.min(10, Number(asRecord(json).retry_after) || 1);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return this.call(method, path, body, auth, false);
    }
    if (!response.ok) {
      throw new PlatformApiError(
        "discord",
        response.status,
        str(asRecord(json).message) || `Discord answered ${response.status}.`,
      );
    }
    return json;
  }
}

export function createDiscordClient(
  runtime: ConnectionRuntime,
  rest = new DiscordRest(runtime),
): PlatformClient {
  const appId = () => runtime.connection.settings.applicationId ?? "";
  const post: PlatformClient["post"] = async (target, message) => {
    const sent = asRecord(
      await rest.call("POST", `/channels/${target.channelId}/messages`, {
        content: message.text,
        allowed_mentions: { parse: [] },
        ...(target.replyTo
          ? { message_reference: { message_id: target.replyTo, fail_if_not_exists: false } }
          : {}),
        ...(message.buttons && message.buttons.length > 0
          ? { components: components(message) }
          : {}),
      }),
    );
    return { messageId: str(sent.id) };
  };
  return {
    platform: "discord",
    post,
    async update(target, messageId, message) {
      await rest.call("PATCH", `/channels/${target.channelId}/messages/${messageId}`, {
        content: message.text,
        components: components(message),
      });
    },
    async typing(target) {
      await rest.call("POST", `/channels/${target.channelId}/typing`);
    },
    async upload(target, file) {
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({
          content: file.title === file.name ? "" : file.title,
          allowed_mentions: { parse: [] },
          attachments: [{ id: 0, filename: file.name }],
          ...(target.replyTo
            ? { message_reference: { message_id: target.replyTo, fail_if_not_exists: false } }
            : {}),
        }),
      );
      const bytes = await NodeFS.promises.readFile(file.path);
      form.append("files[0]", new Blob([bytes], { type: file.mimeType }), file.name);
      await rest.call("POST", `/channels/${target.channelId}/messages`, form);
    },
    async directMessage(_workspaceId, userId, message) {
      const channel = asRecord(
        await rest.call("POST", "/users/@me/channels", { recipient_id: userId }),
      );
      const channelId = str(channel.id);
      const sent = await post({ workspaceId: "dm", channelId, threadId: null }, message);
      return { channelId, messageId: sent.messageId };
    },
    async download(attachment) {
      // CDN links are signed; no token is sent, and only Discord's CDN is fetched.
      if (!hostAllowed(attachment.ref, CDN_HOSTS, runtime.apiBase)) {
        throw new PlatformApiError("discord", 0, "Not a Discord CDN address.");
      }
      const response = await runtime.fetch(attachment.ref, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new PlatformApiError("discord", response.status, "Download failed.");
      return new Uint8Array(await response.arrayBuffer());
    },
    async answer(event, text) {
      if (text.trim() === "" || event.responseRef === undefined) return;
      const token = event.responseRef.slice(event.responseRef.indexOf(":") + 1);
      await rest.call(
        "POST",
        `/webhooks/${appId()}/${token}`,
        { content: text, flags: 64, allowed_mentions: { parse: [] } },
        false,
      );
    },
  };
}

// Gateway

/** Close codes after which reconnecting cannot help (bad token, intents, shard config). */
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

class DiscordGateway {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private acked = true;
  private attempt = 0;
  private stopped = true;
  botUserId: string | null = null;

  private readonly runtime: ConnectionRuntime;
  private readonly rest: DiscordRest;
  private readonly onDispatch: (type: string, data: unknown) => void;

  constructor(
    runtime: ConnectionRuntime,
    rest: DiscordRest,
    onDispatch: (type: string, data: unknown) => void,
  ) {
    this.runtime = runtime;
    this.rest = rest;
    this.onDispatch = onDispatch;
  }

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    try {
      this.socket?.close(1000);
    } catch {
      // Already closed.
    }
    this.socket = null;
    this.runtime.setStatus("stopped", null);
  }

  private clearTimers() {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.reconnectTimer = null;
  }

  private send(payload: unknown) {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch {
      // The close handler reconnects.
    }
  }

  private scheduleReconnect(resume: boolean) {
    if (this.stopped) return;
    this.clearTimers();
    if (!resume) {
      this.sessionId = null;
      this.sequence = null;
      this.resumeUrl = null;
    }
    const delay = backoffMs(this.attempt++);
    this.runtime.setStatus("connecting", `Reconnecting in ${Math.round(delay / 1000)} s`);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private async connect() {
    if (this.stopped) return;
    this.runtime.setStatus("connecting", null);
    let url = this.resumeUrl;
    if (url === null) {
      try {
        url = str(asRecord(await this.rest.call("GET", "/gateway/bot")).url);
      } catch (error) {
        const status = error instanceof PlatformApiError ? error.status : 0;
        if (status === 401) {
          this.runtime.setStatus("error", "Discord refused the bot token.");
          return;
        }
        this.runtime.log(`discord: gateway lookup failed: ${String(error)}`);
        this.scheduleReconnect(false);
        return;
      }
    }
    let socket: WebSocket;
    try {
      socket = new this.runtime.WebSocket(
        `${url}${url.includes("?") ? "&" : "?"}v=10&encoding=json`,
      );
    } catch {
      this.scheduleReconnect(false);
      return;
    }
    this.socket = socket;
    socket.addEventListener("message", (event) =>
      this.onMessage(String((event as MessageEvent).data)),
    );
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const code = (event as CloseEvent).code;
      if (FATAL_CLOSE.has(code)) {
        this.clearTimers();
        this.runtime.setStatus(
          "error",
          code === 4004
            ? "Discord refused the bot token."
            : `Discord closed the connection (${code}).`,
        );
        return;
      }
      this.scheduleReconnect(this.sessionId !== null);
    });
  }

  private onMessage(raw: string) {
    let frame: { op?: number; d?: unknown; s?: number | null; t?: string | null };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return;
    }
    if (typeof frame.s === "number") this.sequence = frame.s;
    switch (frame.op) {
      case 10: {
        const interval = Number(asRecord(frame.d).heartbeat_interval) || 41_250;
        this.acked = true;
        if (this.heartbeat !== null) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
          if (!this.acked) {
            // A zombie connection: drop it and resume.
            try {
              this.socket?.close(4000);
            } catch {
              // Already closed.
            }
            return;
          }
          this.acked = false;
          this.send({ op: 1, d: this.sequence });
        }, interval);
        const token = this.runtime.secret("botToken") ?? "";
        if (this.sessionId !== null) {
          this.send({ op: 6, d: { token, session_id: this.sessionId, seq: this.sequence } });
        } else {
          this.send({
            op: 2,
            d: {
              token,
              intents: DISCORD_INTENTS,
              properties: { os: "linux", browser: "zen-staff", device: "zen-staff" },
            },
          });
        }
        return;
      }
      case 11:
        this.acked = true;
        return;
      case 1:
        this.send({ op: 1, d: this.sequence });
        return;
      case 7:
        try {
          this.socket?.close(4000);
        } catch {
          // Already closed.
        }
        return;
      case 9: {
        const resumable = frame.d === true;
        if (!resumable) {
          this.sessionId = null;
          this.sequence = null;
          this.resumeUrl = null;
        }
        try {
          this.socket?.close(4000);
        } catch {
          // Already closed.
        }
        return;
      }
      case 0: {
        const type = frame.t ?? "";
        if (type === "READY") {
          const data = asRecord(frame.d);
          this.botUserId = str(asRecord(data.user).id) || null;
          this.sessionId = str(data.session_id) || null;
          this.resumeUrl = str(data.resume_gateway_url) || null;
          this.attempt = 0;
          this.runtime.setStatus("connected", null);
          return;
        }
        if (type === "RESUMED") {
          this.attempt = 0;
          this.runtime.setStatus("connected", null);
          return;
        }
        this.onDispatch(type, frame.d);
        return;
      }
      default:
        return;
    }
  }
}

// Adapter

const ZEN_DISCORD_COMMAND = {
  name: "zen",
  description: "Give a task to the AI staff of this channel (or: status, help)",
  type: 1,
  options: [
    { type: 3, name: "task", description: "What to do, or status / help", required: false },
  ],
} as const;

export const createDiscordAdapter: AdapterFactory = (runtime) => {
  const rest = new DiscordRest(runtime);
  const client = createDiscordClient(runtime, rest);
  const appId = () => runtime.connection.settings.applicationId ?? "";

  const ackInteraction = async (data: unknown) => {
    const d = asRecord(data);
    const type = d.type === 2 ? 5 : d.type === 3 ? 6 : null;
    if (type === null) return;
    await rest
      .call(
        "POST",
        `/interactions/${str(d.id)}/${str(d.token)}/callback`,
        type === 5 ? { type, data: { flags: 64 } } : { type },
        false,
      )
      .catch((error) => runtime.log(`discord: interaction ack failed: ${String(error)}`));
  };

  const gateway = new DiscordGateway(runtime, rest, (type, data) => {
    void (async () => {
      if (type === "INTERACTION_CREATE") await ackInteraction(data);
      const events = translateDiscordDispatch(type, data, gateway.botUserId);
      for (const event of events) {
        await runtime
          .emit(event)
          .catch((error) => runtime.log(`discord: event failed: ${String(error)}`));
        // A deferred slash command shows "thinking" until answered: close it if nobody did.
        if (
          event.type === "message" &&
          event.command !== null &&
          !/^(status|help)$/i.test(event.command.args)
        ) {
          await client.answer?.(event, "Sent to the AI staff.").catch(() => undefined);
        }
      }
    })();
  });

  return {
    client,
    start() {
      if (runtime.secret("botToken") === null) {
        runtime.setStatus("error", "Add the bot token first.");
        return;
      }
      const guildId = runtime.connection.settings.guildId ?? "";
      if (appId() !== "" && guildId !== "") {
        void rest
          .call("PUT", `/applications/${appId()}/guilds/${guildId}/commands`, [ZEN_DISCORD_COMMAND])
          .catch((error) => runtime.log(`discord: /zen command not registered: ${String(error)}`));
      }
      gateway.start();
    },
    stop() {
      gateway.stop();
    },
    async test() {
      try {
        const me = asRecord(await rest.call("GET", "/users/@me"));
        return { ok: true, detail: `Signed in as ${str(me.username) || str(me.id)}` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

export const discordManifest: ManifestBuilder = ({ connection }) => {
  const clientId = connection?.settings.applicationId ?? "";
  const url =
    `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId || "<APPLICATION_ID>")}` +
    `&scope=bot%20applications.commands&permissions=${DISCORD_PERMISSIONS}`;
  return {
    kind: "url",
    fileName: null,
    openUrl: clientId === "" ? null : url,
    content: [
      `Install link (opens Discord, a server admin approves): ${url}`,
      "",
      "Bot settings: Public Bot off. Privileged Gateway Intents: leave all off (the bot reads only messages that mention it, reply to it, or are DMs).",
      `Permissions requested (${DISCORD_PERMISSIONS}): View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files.`,
      "Slash command registered automatically on this server when the connection starts: /zen task:<what to do> (also /zen task:status, /zen task:help).",
    ].join("\n"),
  };
};
