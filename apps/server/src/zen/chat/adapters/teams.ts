// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Bot Framework client outside the Effect runtime.
// Zen Staff chat integrations: Microsoft Teams through the Bot Framework. Teams only delivers to a
// public HTTPS messaging endpoint, so activities reach the runner through the Zen hub relay; the
// runner checks the Bot Framework JWT itself (issuer, audience = the bot's app id, the msteams
// endorsement, the serviceUrl claim) before anything is read. Answers go straight from the runner
// to the Bot Connector with a token from the customer's own Entra app registration.
import * as NodeFS from "node:fs";

import type {
  ConversationTarget,
  InboundAttachment,
  InboundEvent,
  OutboundMessage,
  PlatformClient,
} from "../model.ts";
import {
  BOT_FRAMEWORK_ISSUERS,
  BOT_FRAMEWORK_OPENID,
  bearerToken,
  JwksCache,
  jwtKeyId,
  verifyJwt,
  type JsonFetch,
} from "../signatures.ts";
import { attachmentKind, decodeTeamsText } from "../text.ts";
import {
  hostAllowed,
  PlatformApiError,
  readJsonResponse,
  type AdapterFactory,
  type AdapterInstance,
  type ConnectionRuntime,
  type ManifestBuilder,
} from "./types.ts";

type Json = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};

const DEFAULT_SERVICE_URL = "https://smba.trafficmanager.net/teams/";

/** `19:abc@thread.tacv2;messageid=1700` -> channel `19:abc@thread.tacv2`, thread root `1700`. */
export function splitTeamsConversation(id: string): {
  channelId: string;
  threadRoot: string | null;
} {
  const match = /^(.*);messageid=(\d+)$/.exec(id);
  return match
    ? { channelId: match[1]!, threadRoot: match[2]! }
    : { channelId: id, threadRoot: null };
}

function teamsAttachments(activity: Json): InboundAttachment[] {
  const list = Array.isArray(activity.attachments) ? activity.attachments.map(obj) : [];
  return list.flatMap((attachment, index) => {
    const contentType = str(attachment.contentType);
    if (contentType === "application/vnd.microsoft.teams.file.download.info") {
      const content = obj(attachment.content);
      const name = str(attachment.name) || `file.${str(content.fileType) || "bin"}`;
      const url = str(content.downloadUrl);
      if (url === "") return [];
      const mimeType = mimeOf(name);
      return [
        {
          id: str(content.uniqueId) || `${index}`,
          name,
          mimeType,
          sizeBytes: null,
          kind: attachmentKind(mimeType),
          ref: `public:${url}`,
        },
      ];
    }
    if (contentType.startsWith("image/") && str(attachment.contentUrl) !== "") {
      return [
        {
          id: `${index}`,
          name: str(attachment.name) || `image-${index}.png`,
          mimeType: contentType,
          sizeBytes: null,
          kind: "image" as const,
          ref: `bot:${str(attachment.contentUrl)}`,
        },
      ];
    }
    return [];
  });
}

const mimeOf = (name: string) => {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const known: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    txt: "text/plain",
    csv: "text/csv",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
  };
  return known[extension] ?? "application/octet-stream";
};

export interface TeamsContext {
  /** The bot's own channel account id (`28:<app id>`). */
  readonly botId: string;
}

/** One Bot Framework activity -> inbound events (plus the serviceUrl to answer through). */
export function translateTeamsActivity(activity: Json, context: TeamsContext): InboundEvent[] {
  const type = str(activity.type);
  if (type !== "message") return [];
  const conversation = obj(activity.conversation);
  const from = obj(activity.from);
  const channelData = obj(activity.channelData);
  const tenantId = str(obj(channelData.tenant).id) || str(conversation.tenantId);
  const { channelId, threadRoot } = splitTeamsConversation(str(conversation.id));
  const conversationType = str(conversation.conversationType);
  const channelType =
    conversationType === "personal" ? "dm" : conversationType === "groupChat" ? "group" : "channel";
  const user = {
    id: str(from.id),
    name: str(from.name) || str(from.id),
    email: null,
    isBot: from.role === "bot",
  };
  const value = obj(activity.value);
  if (typeof value.zenAction === "string") {
    return [
      {
        type: "action",
        platform: "teams",
        workspaceId: tenantId,
        channelId,
        threadId: threadRoot,
        messageId: str(activity.replyToId),
        user,
        value: value.zenAction,
      },
    ];
  }
  const recipient = obj(activity.recipient);
  const botName = str(recipient.name) || null;
  const entities = Array.isArray(activity.entities) ? activity.entities.map(obj) : [];
  const mentionsBot = entities.some(
    (entity) =>
      str(entity.type) === "mention" &&
      str(obj(entity.mentioned).id) === (str(recipient.id) || context.botId),
  );
  const text = decodeTeamsText(str(activity.text), botName);
  // The manifest's command list sends "zen <task>" / "zen status" as text.
  const typed = /^\/?zen(?:\s+([\s\S]*))?$/i.exec(text);
  return [
    {
      type: "message",
      platform: "teams",
      workspaceId: tenantId,
      channelId,
      channelType,
      threadId: channelType === "channel" ? threadRoot : null,
      messageId: str(activity.id),
      user,
      text: typed ? (typed[1] ?? "").trim() : text,
      mentioned: channelType === "dm" || mentionsBot,
      attachments: teamsAttachments(activity),
      command: typed ? { args: (typed[1] ?? "").trim() } : null,
    },
  ];
}

/** Adaptive Card with Action.Submit buttons (a press comes back as a message with `value`). */
export function teamsActivity(message: OutboundMessage): Json {
  if (!message.buttons || message.buttons.length === 0) {
    return { type: "message", text: message.text, textFormat: "markdown" };
  }
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.4",
          body: [{ type: "TextBlock", text: message.text, wrap: true }],
          actions: message.buttons.map((button) => ({
            type: "Action.Submit",
            title: button.label,
            style:
              button.style === "danger"
                ? "destructive"
                : button.style === "primary"
                  ? "positive"
                  : "default",
            data: { zenAction: button.value },
          })),
        },
      },
    ],
  };
}

class TeamsConnector {
  private token: { value: string; expiresAt: number } | null = null;
  /** Tenant -> serviceUrl seen on inbound activities (falls back to the global one). */
  readonly serviceUrls = new Map<string, string>();
  private readonly runtime: ConnectionRuntime;

  constructor(runtime: ConnectionRuntime) {
    this.runtime = runtime;
  }

  serviceUrl(tenantId: string): string {
    const url = this.runtime.apiBase ?? this.serviceUrls.get(tenantId) ?? DEFAULT_SERVICE_URL;
    return url.endsWith("/") ? url : `${url}/`;
  }

  async accessToken(): Promise<string> {
    if (this.token !== null && this.token.expiresAt > this.runtime.now() + 60_000)
      return this.token.value;
    const settings = this.runtime.connection.settings;
    const secret = this.runtime.secret("clientSecret");
    if (!settings.appId || !settings.tenantId || secret === null) {
      throw new PlatformApiError("teams", 401, "App id, tenant id and client secret are needed.");
    }
    const tokenBase = this.runtime.apiBase ?? "https://login.microsoftonline.com/";
    const response = await this.runtime.fetch(
      `${tokenBase.replace(/\/$/, "")}/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: settings.appId,
          client_secret: secret,
          scope: "https://api.botframework.com/.default",
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const json = obj(await readJsonResponse(response));
    if (!response.ok || str(json.access_token) === "") {
      throw new PlatformApiError(
        "teams",
        response.status,
        str(json.error_description) || "Microsoft refused the bot credentials.",
      );
    }
    this.token = {
      value: str(json.access_token),
      expiresAt: this.runtime.now() + Number(json.expires_in ?? 3000) * 1000,
    };
    return this.token.value;
  }

  async request(method: string, tenantId: string, path: string, body?: Json): Promise<Json> {
    const response = await this.runtime.fetch(`${this.serviceUrl(tenantId)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const json = obj(await readJsonResponse(response));
    if (!response.ok)
      throw new PlatformApiError(
        "teams",
        response.status,
        `Bot Connector ${method} ${response.status}`,
      );
    return json;
  }
}

const conversationPath = (target: ConversationTarget) => {
  const id = target.threadId
    ? `${target.channelId};messageid=${target.threadId}`
    : target.channelId;
  return `v3/conversations/${encodeURIComponent(id)}/activities`;
};

function createTeamsClient(runtime: ConnectionRuntime, connector: TeamsConnector): PlatformClient {
  return {
    platform: "teams",
    async post(target, message) {
      const result = await connector.request(
        "POST",
        target.workspaceId,
        conversationPath(target),
        teamsActivity(message),
      );
      return { messageId: str(result.id) };
    },
    async update(target, messageId, message) {
      await connector.request(
        "PUT",
        target.workspaceId,
        `${conversationPath(target)}/${encodeURIComponent(messageId)}`,
        {
          ...teamsActivity(message),
          id: messageId,
        },
      );
    },
    async typing(target) {
      await connector.request("POST", target.workspaceId, conversationPath(target), {
        type: "typing",
      });
    },
    async directMessage(workspaceId, userId, message) {
      // Proactive 1:1 chat: works when the person has the app (install it for everyone in the tenant).
      const created = await connector.request("POST", workspaceId, "v3/conversations", {
        bot: { id: `28:${runtime.connection.settings.appId ?? ""}` },
        members: [{ id: userId }],
        isGroup: false,
        tenantId: workspaceId,
        channelData: { tenant: { id: workspaceId } },
      });
      const channelId = str(created.id);
      if (channelId === "") return null;
      const sent = await connector.request(
        "POST",
        workspaceId,
        conversationPath({ workspaceId, channelId, threadId: null }),
        teamsActivity(message),
      );
      return { channelId, messageId: str(sent.id) };
    },
    async upload(target, file) {
      // Bots can attach small images inline; other files need OneDrive/SharePoint consent flows,
      // so they are sent as a note (gap documented in ZEN.md).
      if (!file.mimeType.startsWith("image/") || file.sizeBytes > 4 * 1024 * 1024) {
        await this.post(target, {
          text: `${file.title} (${file.name}) is ready on the company server.`,
        });
        return;
      }
      const data = (await NodeFS.promises.readFile(file.path)).toString("base64");
      await connector.request("POST", target.workspaceId, conversationPath(target), {
        type: "message",
        text: file.title,
        attachments: [
          {
            contentType: file.mimeType,
            contentUrl: `data:${file.mimeType};base64,${data}`,
            name: file.name,
          },
        ],
      });
    },
    async download(attachment) {
      const [kind, url] = attachment.ref.startsWith("public:")
        ? ["public", attachment.ref.slice(7)]
        : ["bot", attachment.ref.slice(4)];
      const hosts = [
        /\.sharepoint\.com$/,
        /\.botframework\.com$/,
        "smba.trafficmanager.net",
        /\.teams\.microsoft\.com$/,
        /\.asm\.skype\.com$/,
      ];
      if (!hostAllowed(url!, hosts, runtime.apiBase))
        throw new PlatformApiError("teams", 400, "Refusing to download from a non-Microsoft host.");
      const response = await runtime.fetch(url!, {
        ...(kind === "bot"
          ? { headers: { authorization: `Bearer ${await connector.accessToken()}` } }
          : {}),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new PlatformApiError("teams", response.status, "download failed");
      return new Uint8Array(await response.arrayBuffer());
    },
    async answer(event, text) {
      if (text === "") return;
      await this.post(
        { workspaceId: event.workspaceId, channelId: event.channelId, threadId: event.threadId },
        { text },
      );
    },
  };
}

export const createTeamsAdapter: AdapterFactory = (runtime): AdapterInstance => {
  const connector = new TeamsConnector(runtime);
  const client = createTeamsClient(runtime, connector);
  const fetchJson: JsonFetch = async (url) =>
    readJsonResponse(await runtime.fetch(url, { signal: AbortSignal.timeout(15_000) }));
  const keys = new JwksCache({ openIdUrl: BOT_FRAMEWORK_OPENID }, fetchJson);
  const appId = runtime.connection.settings.appId ?? "";

  return {
    client,
    start: () => runtime.setStatus("waiting-relay", "Activities arrive through the Zen hub relay."),
    stop: () => runtime.setStatus("stopped", null),
    async handleWebhook(request) {
      if (request.method !== "POST") return { status: 405 };
      const token = bearerToken(request.headers);
      if (token === null) return { status: 401, body: "missing token" };
      let activity: Json;
      try {
        activity = obj(JSON.parse(new TextDecoder().decode(request.body)));
      } catch {
        return { status: 400, body: "bad body" };
      }
      const verdict = verifyJwt({
        token,
        keys: await keys.get(jwtKeyId(token), runtime.now()),
        issuers: BOT_FRAMEWORK_ISSUERS,
        audience: appId,
        nowSeconds: Math.floor(runtime.now() / 1000),
        endorsement: "msteams",
      });
      if (!verdict.ok) return { status: 401, body: verdict.reason };
      const claimedServiceUrl = str(verdict.claims.serviceurl) || str(verdict.claims.serviceUrl);
      const serviceUrl = str(activity.serviceUrl);
      if (claimedServiceUrl !== "" && claimedServiceUrl !== serviceUrl)
        return { status: 401, body: "serviceUrl mismatch" };
      const events = translateTeamsActivity(activity, { botId: `28:${appId}` });
      for (const event of events) {
        if (
          serviceUrl !== "" &&
          hostAllowed(
            serviceUrl,
            [/\.trafficmanager\.net$/, /\.botframework\.com$/, /\.teams\.microsoft\.com$/],
            null,
          )
        ) {
          connector.serviceUrls.set(event.workspaceId, serviceUrl);
        }
        void runtime
          .emit(event)
          .catch((error) => runtime.log(`teams: event failed: ${String(error)}`));
      }
      runtime.setStatus("connected", null);
      return { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
    },
    async test() {
      try {
        await connector.accessToken();
        return {
          ok: true,
          detail: "Microsoft accepted the bot credentials. Messages arrive through the hub relay.",
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

/** Teams app manifest (v1.17) to zip with two icons and upload in Teams admin center or Developer Portal. */
export const teamsManifest: ManifestBuilder = ({ connection, appName }) => {
  const appId = connection?.settings.appId || "00000000-0000-0000-0000-000000000000";
  const manifest = {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id: appId,
    developer: {
      name: "Zen Staff",
      websiteUrl: "https://zed-zen.com",
      privacyUrl: "https://zed-zen.com/ro/confidentialitate",
      termsOfUseUrl: "https://zed-zen.com/ro/termeni",
    },
    name: { short: appName.slice(0, 30), full: `${appName} (AI staff)`.slice(0, 100) },
    description: {
      short: "Talk to your company's AI staff.",
      full: "Mention the bot with a task; it answers in the thread, posts reports and asks your manager to approve actions.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#1B2B24",
    bots: [
      {
        botId: appId,
        scopes: ["personal", "team", "groupChat"],
        supportsFiles: true,
        isNotificationOnly: false,
        commandLists: [
          {
            scopes: ["personal", "team", "groupChat"],
            commands: [
              { title: "zen", description: "Give a task: zen <task>" },
              { title: "zen status", description: "What the AI staff is working on here" },
            ],
          },
        ],
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [],
  };
  return {
    kind: "json",
    fileName: "manifest.json",
    content: JSON.stringify(manifest, null, 2),
    openUrl: "https://dev.teams.microsoft.com/apps",
  };
};
