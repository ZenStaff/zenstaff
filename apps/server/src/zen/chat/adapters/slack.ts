// @effect-diagnostics globalTimers:off globalDate:off -- Socket Mode client: timers and sockets outside the Effect runtime.
// Zen Staff chat integrations: Slack. Events arrive over Socket Mode (the runner dials out with
// the app-level token; no public endpoint), answers go through the Web API with the bot token.
// The app is installed in the customer's own workspace from the manifest below.
import type {
  ChatUser,
  ConversationTarget,
  InboundAttachment,
  InboundEvent,
  OutboundMessage,
  PlatformClient,
} from "../model.ts";
import { verifySlackSignature } from "../signatures.ts";
import { attachmentKind, decodeSlackText } from "../text.ts";
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

const SLACK_API = "https://slack.com/api";

// Translation (pure)

export interface SlackContext {
  readonly botUserId: string | null;
  /** Users already looked up (id -> name), to show `@Maria` instead of `<@U123>`. */
  readonly names?: Readonly<Record<string, string>>;
}

export interface SlackEnvelope {
  readonly envelope_id?: string;
  readonly type: string;
  readonly payload?: Record<string, unknown>;
  readonly accepts_response_payload?: boolean;
}

type Json = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};

function slackFiles(files: unknown): InboundAttachment[] {
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    const entry = obj(file);
    const url = str(entry.url_private_download) || str(entry.url_private);
    if (url === "") return [];
    const mimeType = str(entry.mimetype) || "application/octet-stream";
    return [
      {
        id: str(entry.id),
        name: str(entry.name) || "file",
        mimeType,
        sizeBytes: typeof entry.size === "number" ? entry.size : null,
        kind: attachmentKind(mimeType),
        ref: url,
      },
    ];
  });
}

const channelTypeOf = (channelType: string, channelId: string) =>
  channelType === "im" || channelId.startsWith("D")
    ? ("dm" as const)
    : channelType === "mpim"
      ? ("group" as const)
      : ("channel" as const);

/** One Socket Mode envelope (or Events API body) -> inbound events. */
export function translateSlackEnvelope(
  envelope: SlackEnvelope,
  context: SlackContext,
): InboundEvent[] {
  const payload = obj(envelope.payload);
  if (envelope.type === "events_api") {
    const event = obj(payload.event);
    const teamId = str(payload.team_id) || str(event.team);
    const type = str(event.type);
    const subtype = str(event.subtype);
    if (type !== "app_mention" && type !== "message") return [];
    if (event.bot_id !== undefined || subtype === "bot_message" || str(event.user) === "")
      return [];
    if (subtype !== "" && subtype !== "file_share" && subtype !== "thread_broadcast") return [];
    const channelId = str(event.channel);
    const rawText = str(event.text);
    const mentionsBot = context.botUserId !== null && rawText.includes(`<@${context.botUserId}`);
    const channelType =
      type === "app_mention" ? "channel" : channelTypeOf(str(event.channel_type), channelId);
    // A channel message that mentions the bot also comes as app_mention: keep only that one.
    if (type === "message" && channelType !== "dm" && mentionsBot) return [];
    const ts = str(event.ts);
    const threadTs = str(event.thread_ts);
    return [
      {
        type: "message",
        platform: "slack",
        workspaceId: teamId,
        channelId,
        channelType: type === "app_mention" ? channelTypeOf("", channelId) : channelType,
        threadId: threadTs !== "" && threadTs !== ts ? threadTs : null,
        messageId: ts,
        user: { id: str(event.user), name: context.names?.[str(event.user)] ?? str(event.user) },
        text: decodeSlackText(rawText, context.botUserId, context.names),
        mentioned: type === "app_mention" || channelType === "dm" || mentionsBot,
        attachments: slackFiles(event.files),
        command: null,
      },
    ];
  }
  if (envelope.type === "interactive") {
    if (str(payload.type) !== "block_actions") return [];
    const user = obj(payload.user);
    const channel = obj(payload.channel);
    const container = obj(payload.container);
    const message = obj(payload.message);
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    return actions.flatMap((action) => {
      const value = str(obj(action).value);
      if (value === "") return [];
      return [
        {
          type: "action" as const,
          platform: "slack" as const,
          workspaceId: str(obj(payload.team).id) || str(user.team_id),
          channelId: str(channel.id) || str(container.channel_id),
          threadId: str(message.thread_ts) || null,
          messageId: str(container.message_ts) || str(message.ts),
          user: { id: str(user.id), name: str(user.name) || str(user.username) || str(user.id) },
          value,
          ...(str(payload.response_url) ? { responseRef: str(payload.response_url) } : {}),
        },
      ];
    });
  }
  if (envelope.type === "slash_commands") {
    if (str(payload.command) !== "/zen") return [];
    const channelId = str(payload.channel_id);
    return [
      {
        type: "message",
        platform: "slack",
        workspaceId: str(payload.team_id),
        channelId,
        channelType: channelTypeOf(
          str(payload.channel_name) === "directmessage" ? "im" : "",
          channelId,
        ),
        threadId: null,
        messageId: "",
        user: { id: str(payload.user_id), name: str(payload.user_name) || str(payload.user_id) },
        text: str(payload.text).trim(),
        mentioned: true,
        attachments: [],
        command: { args: str(payload.text).trim() },
        ...(str(payload.response_url) ? { responseRef: str(payload.response_url) } : {}),
      },
    ];
  }
  return [];
}

/** Message body for chat.postMessage / chat.update: mrkdwn text, buttons as a Block Kit action row. */
export function slackMessageBody(target: ConversationTarget, message: OutboundMessage): Json {
  const blocks =
    message.buttons && message.buttons.length > 0
      ? [
          { type: "section", text: { type: "mrkdwn", text: message.text.slice(0, 3000) } },
          {
            type: "actions",
            elements: message.buttons.map((button, index) => ({
              type: "button",
              action_id: `zen_${index}`,
              text: { type: "plain_text", text: button.label.slice(0, 75) },
              value: button.value,
              ...(button.style === "default" ? {} : { style: button.style }),
            })),
          },
        ]
      : undefined;
  return {
    channel: target.channelId,
    text: message.text,
    mrkdwn: true,
    unfurl_links: false,
    unfurl_media: false,
    ...(target.threadId ? { thread_ts: target.threadId } : {}),
    ...(blocks ? { blocks } : {}),
  };
}

// Web API

class SlackApi {
  private readonly runtime: ConnectionRuntime;
  constructor(runtime: ConnectionRuntime) {
    this.runtime = runtime;
  }

  get base(): string {
    return this.runtime.apiBase ?? SLACK_API;
  }

  async call(method: string, body: Json, token: "bot" | "app" = "bot"): Promise<Json> {
    const secret = this.runtime.secret(token === "bot" ? "botToken" : "appToken");
    if (secret === null)
      throw new PlatformApiError("slack", 401, `The Slack ${token} token is not stored.`);
    const response = await this.runtime.fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = obj(await readJsonResponse(response));
    if (!response.ok || json.ok !== true) {
      throw new PlatformApiError(
        "slack",
        response.status,
        `${method}: ${str(json.error) || response.status}`,
      );
    }
    return json;
  }

  /** Form-encoded call (files.getUploadURLExternal only accepts form or query arguments). */
  async form(method: string, body: Record<string, string>): Promise<Json> {
    const secret = this.runtime.secret("botToken");
    if (secret === null)
      throw new PlatformApiError("slack", 401, "The Slack bot token is not stored.");
    const response = await this.runtime.fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const json = obj(await readJsonResponse(response));
    if (!response.ok || json.ok !== true) {
      throw new PlatformApiError(
        "slack",
        response.status,
        `${method}: ${str(json.error) || response.status}`,
      );
    }
    return json;
  }
}

const SLACK_FILE_HOSTS = ["files.slack.com", "slack-files.com"];

function createSlackClient(
  runtime: ConnectionRuntime,
  api: SlackApi,
): PlatformClient & {
  users: Map<string, ChatUser>;
} {
  const users = new Map<string, ChatUser>();
  return {
    platform: "slack",
    users,
    async post(target, message) {
      const result = await api.call("chat.postMessage", slackMessageBody(target, message));
      return { messageId: str(result.ts) };
    },
    async update(target, messageId, message) {
      const body = slackMessageBody({ ...target, threadId: null }, message);
      await api.call("chat.update", {
        channel: body.channel,
        ts: messageId,
        text: body.text,
        blocks: body.blocks ?? [
          { type: "section", text: { type: "mrkdwn", text: message.text.slice(0, 3000) } },
        ],
      });
    },
    async directMessage(_workspaceId, userId, message) {
      // Posting to a user id lands in the app's DM with that person (chat:write is enough).
      const result = await api.call(
        "chat.postMessage",
        slackMessageBody({ workspaceId: "", channelId: userId, threadId: null }, message),
      );
      return { channelId: str(result.channel), messageId: str(result.ts) };
    },
    async upload(target, file) {
      const NodeFS = await import("node:fs");
      const bytes = await NodeFS.promises.readFile(file.path);
      const slot = await api.form("files.getUploadURLExternal", {
        filename: file.name,
        length: String(bytes.byteLength),
      });
      const uploaded = await runtime.fetch(str(slot.upload_url), {
        method: "POST",
        body: bytes,
        signal: AbortSignal.timeout(120_000),
      });
      if (!uploaded.ok) throw new PlatformApiError("slack", uploaded.status, "file upload failed");
      await api.call("files.completeUploadExternal", {
        files: [{ id: str(slot.file_id), title: file.title }],
        channel_id: target.channelId,
        ...(target.threadId ? { thread_ts: target.threadId } : {}),
      });
    },
    async download(attachment) {
      if (!hostAllowed(attachment.ref, SLACK_FILE_HOSTS, runtime.apiBase)) {
        throw new PlatformApiError("slack", 400, "Refusing to download from a non-Slack host.");
      }
      const response = await runtime.fetch(attachment.ref, {
        headers: { authorization: `Bearer ${runtime.secret("botToken") ?? ""}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new PlatformApiError("slack", response.status, "download failed");
      return new Uint8Array(await response.arrayBuffer());
    },
    async answer(event, text) {
      if (text === "" || event.responseRef === undefined) return;
      // response_url is a hooks.slack.com URL carried by the payload; nothing secret goes there.
      if (!hostAllowed(event.responseRef, ["hooks.slack.com"], runtime.apiBase)) return;
      await runtime.fetch(event.responseRef, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
        signal: AbortSignal.timeout(10_000),
      });
    },
    async lookupUser(_workspaceId, userId) {
      const cached = users.get(userId);
      if (cached) return cached;
      try {
        const result = await api.call("users.info", { user: userId });
        const user = obj(result.user);
        const profile = obj(user.profile);
        const found: ChatUser = {
          id: userId,
          name: str(profile.display_name) || str(profile.real_name) || str(user.name) || userId,
          email: str(profile.email) || null,
          isBot: user.is_bot === true,
        };
        users.set(userId, found);
        return found;
      } catch {
        return null;
      }
    },
  };
}

// Socket Mode transport

class SlackSocketMode {
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly runtime: ConnectionRuntime;
  private readonly api: SlackApi;
  private readonly onEnvelope: (envelope: SlackEnvelope) => Promise<void>;

  constructor(
    runtime: ConnectionRuntime,
    api: SlackApi,
    onEnvelope: (envelope: SlackEnvelope) => Promise<void>,
  ) {
    this.runtime = runtime;
    this.api = api;
    this.onEnvelope = onEnvelope;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.socket?.close();
    } catch {
      // Already closed.
    }
    this.socket = null;
    this.runtime.setStatus("stopped", null);
  }

  private retry(detail: string) {
    if (this.stopped) return;
    this.runtime.setStatus("error", detail);
    const delay = backoffMs(this.attempt++);
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  private async connect() {
    if (this.stopped) return;
    this.runtime.setStatus("connecting", null);
    let url: string;
    try {
      const opened = await this.api.call("apps.connections.open", {}, "app");
      url = str(opened.url);
      if (url === "") throw new Error("no Socket Mode URL");
    } catch (error) {
      this.retry(error instanceof Error ? error.message : "Slack refused the app token.");
      return;
    }
    if (this.stopped) return;
    const socket = new this.runtime.WebSocket(url);
    this.socket = socket;
    socket.addEventListener("message", (message) => {
      let envelope: SlackEnvelope & { reason?: string };
      try {
        envelope = JSON.parse(String(message.data)) as SlackEnvelope & { reason?: string };
      } catch {
        return;
      }
      if (envelope.type === "hello") {
        this.attempt = 0;
        this.runtime.setStatus("connected", null);
        return;
      }
      if (envelope.type === "disconnect") {
        // Slack rotates sockets; open a fresh one.
        try {
          socket.close();
        } catch {
          // Ignore.
        }
        return;
      }
      if (envelope.envelope_id) {
        // Ack first (Slack retries after 3 s), then work.
        socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        void this.onEnvelope(envelope).catch((error) =>
          this.runtime.log(`slack: event failed: ${String(error)}`),
        );
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      if (!this.stopped) this.retry("Socket closed; reconnecting.");
    });
    socket.addEventListener("error", () => {
      // "close" follows and reconnects.
    });
  }
}

export const createSlackAdapter: AdapterFactory = (runtime): AdapterInstance => {
  const api = new SlackApi(runtime);
  const client = createSlackClient(runtime, api);
  let botUserId: string | null = runtime.connection.settings.botUserId || null;

  const ensureBot = async () => {
    if (botUserId !== null) return;
    try {
      botUserId = str((await api.call("auth.test", {})).user_id) || null;
    } catch {
      botUserId = null;
    }
  };

  /** Adds name and verified e-mail (users:read.email) so people map to members by e-mail. */
  const enrich = async (event: InboundEvent): Promise<InboundEvent> => {
    const found = await client.lookupUser!(event.workspaceId, event.user.id);
    if (found === null) return event;
    return {
      ...event,
      user: {
        ...event.user,
        name: found.name,
        email: found.email ?? null,
        isBot: found.isBot ?? false,
      },
    };
  };

  const handle = async (envelope: SlackEnvelope) => {
    await ensureBot();
    const names = Object.fromEntries(
      [...client.users.values()].map((user) => [user.id, user.name]),
    );
    for (const event of translateSlackEnvelope(envelope, { botUserId, names })) {
      await runtime.emit(await enrich(event));
    }
  };

  const socket = new SlackSocketMode(runtime, api, handle);
  return {
    client,
    start: () => socket.start(),
    stop: () => socket.stop(),
    /** Events API over the hub relay (optional alternative to Socket Mode): signed requests only. */
    async handleWebhook(request) {
      const signingSecret = runtime.secret("signingSecret");
      if (signingSecret === null) return { status: 404, body: "not configured" };
      const verdict = verifySlackSignature({
        signingSecret,
        headers: request.headers,
        body: request.body,
        nowSeconds: Math.floor(runtime.now() / 1000),
      });
      if (!verdict.ok) return { status: 401, body: verdict.reason };
      const body = obj(JSON.parse(new TextDecoder().decode(request.body)));
      if (body.type === "url_verification")
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: str(body.challenge),
        };
      void handle({ type: "events_api", payload: body }).catch(() => undefined);
      return { status: 200, body: "" };
    },
    async test() {
      try {
        const auth = await api.call("auth.test", {});
        botUserId = str(auth.user_id) || botUserId;
        await api.call("apps.connections.open", {}, "app");
        return {
          ok: true,
          detail: `Connected to ${str(auth.team)} as @${str(auth.user)} (team ${str(auth.team_id)}).`,
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

/** App manifest: Create New App > From an app manifest > paste. Minimal scopes, Socket Mode on. */
export const slackManifest: ManifestBuilder = ({ appName }) => {
  const manifest = {
    display_information: {
      name: appName.slice(0, 35),
      description: "AI staff of your company (Zen Staff).",
      background_color: "#1b2b24",
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: { display_name: appName.slice(0, 80), always_online: true },
      slash_commands: [
        {
          command: "/zen",
          description: "Give a task to the AI staff, or /zen status",
          usage_hint: "<task> | status | help",
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          "app_mentions:read",
          "chat:write",
          "im:history",
          "channels:history",
          "groups:history",
          "files:read",
          "files:write",
          "users:read",
          "users:read.email",
          "commands",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ["app_mention", "message.im", "message.channels", "message.groups"],
      },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
  return {
    kind: "json",
    fileName: "slack-app-manifest.json",
    content: JSON.stringify(manifest, null, 2),
    openUrl: "https://api.slack.com/apps?new_app=1",
  };
};
