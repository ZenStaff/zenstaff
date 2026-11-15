// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off -- A plain REST client and relay handler, called outside the Effect runtime.
// Zen Staff chat integrations: Google Chat. Google calls an HTTPS endpoint, so events come through
// the Zen hub relay; the runner checks Google's signed bearer token (issuer
// chat@system.gserviceaccount.com, audience = the Cloud project number) itself. Answers go back
// asynchronously through the Chat REST API with the app's service account (scope chat.bot); the
// webhook only answers `{}`. File upload is not offered: the Chat API uploads media only with user
// authentication, which a bot account does not have. Attachments sent to the app are downloaded
// with app authentication (media.download).
import * as NodeCrypto from "node:crypto";

import type {
  ChatUser,
  InboundAttachment,
  InboundEvent,
  OutboundMessage,
  PlatformClient,
} from "../model.ts";
import {
  bearerToken,
  GOOGLE_CHAT_ISSUERS,
  GOOGLE_CHAT_JWKS,
  JwksCache,
  jwtKeyId,
  verifyJwt,
} from "../signatures.ts";
import { attachmentKind, mimeFromName } from "../text.ts";
import {
  PlatformApiError,
  readJsonResponse,
  type AdapterFactory,
  type ConnectionRuntime,
  type ManifestBuilder,
} from "./types.ts";

const GOOGLE_CHAT_API = "https://chat.googleapis.com";
const GOOGLE_CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
const GOOGLE_WORKSPACE_ID = "google";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

// Translation (pure)

function toUser(raw: unknown): ChatUser {
  const user = asRecord(raw);
  const email = str(user.email);
  return {
    id: str(user.name),
    name: str(user.displayName) || email || str(user.name),
    email: email === "" ? null : email,
    isBot: str(user.type) === "BOT",
  };
}

function isDirect(space: Record<string, unknown>): boolean {
  return (
    str(space.type) === "DM" ||
    str(space.spaceType) === "DIRECT_MESSAGE" ||
    space.singleUserBotDm === true
  );
}

function toAttachments(raw: unknown): InboundAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const attachment = asRecord(item);
    const resourceName = str(asRecord(attachment.attachmentDataRef).resourceName);
    // Drive files are not media the app may download; only uploaded content is.
    if (resourceName === "") return [];
    const name = str(attachment.contentName) || "file";
    const mimeType = str(attachment.contentType) || mimeFromName(name);
    return [
      {
        id: str(attachment.name) || resourceName,
        name,
        mimeType,
        sizeBytes: null,
        kind: attachmentKind(mimeType),
        ref: resourceName,
      },
    ];
  });
}

/** One Google Chat event (classic Chat app format) as inbound events. */
export function translateGoogleChatEvent(payload: unknown): InboundEvent[] {
  const event = asRecord(payload);
  const type = str(event.type);
  const message = asRecord(event.message);
  const space = asRecord(
    Object.keys(asRecord(message.space)).length > 0 ? message.space : event.space,
  );
  const dm = isDirect(space);
  const threadName = str(asRecord(message.thread).name);
  if (type === "MESSAGE") {
    const sender = toUser(
      Object.keys(asRecord(message.sender)).length > 0 ? message.sender : event.user,
    );
    const text = (
      typeof message.argumentText === "string" ? message.argumentText : str(message.text)
    ).trim();
    const slash = Object.keys(asRecord(message.slashCommand)).length > 0;
    return [
      {
        type: "message",
        platform: "googlechat",
        workspaceId: GOOGLE_WORKSPACE_ID,
        channelId: str(space.name),
        channelType: dm ? "dm" : str(space.spaceType) === "GROUP_CHAT" ? "group" : "channel",
        // In a DM the whole chat is one conversation; in a space, Google's thread is the thread.
        threadId: dm || threadName === "" ? null : threadName,
        messageId: str(message.name),
        user: sender,
        text,
        // Chat delivers space messages to an app only when it is @mentioned or a command is used.
        mentioned: true,
        attachments: toAttachments(message.attachment),
        command: slash ? { args: text } : null,
      },
    ];
  }
  if (type === "CARD_CLICKED") {
    const action = asRecord(event.action);
    const parameters = Array.isArray(action.parameters)
      ? action.parameters.map((item) => asRecord(item))
      : [];
    const common = asRecord(asRecord(event.common).parameters);
    const value =
      str(parameters.find((parameter) => str(parameter.key) === "value")?.value) ||
      str(common.value);
    if (value === "") return [];
    return [
      {
        type: "action",
        platform: "googlechat",
        workspaceId: GOOGLE_WORKSPACE_ID,
        channelId: str(space.name),
        threadId: dm || threadName === "" ? null : threadName,
        messageId: str(message.name),
        user: toUser(event.user),
        value,
      },
    ];
  }
  return [];
}

// Service-account authentication

interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri: string;
}

function parseServiceAccountKey(raw: string | null): ServiceAccountKey | null {
  if (raw === null) return null;
  try {
    const key = asRecord(JSON.parse(raw));
    if (str(key.client_email) === "" || str(key.private_key) === "") return null;
    return {
      client_email: str(key.client_email),
      private_key: str(key.private_key),
      token_uri: str(key.token_uri) || "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

/** The signed assertion exchanged for an access token (RFC 7523, as Google's libraries do). */
function serviceAccountAssertion(key: ServiceAccountKey, nowSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: key.client_email,
    scope: GOOGLE_CHAT_SCOPE,
    aud: key.token_uri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })}`;
  const signature = NodeCrypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString(
    "base64url",
  );
  return `${unsigned}.${signature}`;
}

class GoogleChatRest {
  private cached: { token: string; expiresAt: number } | null = null;
  private readonly runtime: ConnectionRuntime;

  constructor(runtime: ConnectionRuntime) {
    this.runtime = runtime;
  }

  get base(): string {
    return (this.runtime.apiBase ?? GOOGLE_CHAT_API).replace(/\/$/, "");
  }

  async accessToken(): Promise<string> {
    const now = this.runtime.now();
    if (this.cached !== null && this.cached.expiresAt - 60_000 > now) return this.cached.token;
    const key = parseServiceAccountKey(this.runtime.secret("serviceAccountKey"));
    if (key === null)
      throw new PlatformApiError(
        "googlechat",
        0,
        "The service account key is missing or not valid JSON.",
      );
    const response = await this.runtime.fetch(key.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: serviceAccountAssertion(key, Math.floor(now / 1000)),
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const json = asRecord(await readJsonResponse(response));
    const token = str(json.access_token);
    if (!response.ok || token === "") {
      throw new PlatformApiError(
        "googlechat",
        response.status,
        str(json.error_description) || "Google refused the service account.",
      );
    }
    this.cached = { token, expiresAt: now + (Number(json.expires_in) || 3600) * 1000 };
    return token;
  }

  async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.runtime.fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await readJsonResponse(response);
    if (!response.ok) {
      throw new PlatformApiError(
        "googlechat",
        response.status,
        str(asRecord(asRecord(json).error).message) || `Google Chat answered ${response.status}.`,
      );
    }
    return json;
  }

  async bytes(path: string): Promise<Uint8Array> {
    const response = await this.runtime.fetch(`${this.base}${path}`, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new PlatformApiError("googlechat", response.status, "Download failed.");
    return new Uint8Array(await response.arrayBuffer());
  }
}

function cards(message: OutboundMessage): unknown[] {
  if (!message.buttons || message.buttons.length === 0) return [];
  return [
    {
      cardId: "zen-actions",
      card: {
        sections: [
          {
            widgets: [
              {
                buttonList: {
                  buttons: message.buttons.map((button) => ({
                    text: button.label,
                    ...(button.style === "primary"
                      ? { color: { red: 0.13, green: 0.45, blue: 0.3, alpha: 1 } }
                      : {}),
                    onClick: {
                      action: {
                        function: "zen",
                        parameters: [{ key: "value", value: button.value }],
                      },
                    },
                  })),
                },
              },
            ],
          },
        ],
      },
    },
  ];
}

export function createGoogleChatClient(
  runtime: ConnectionRuntime,
  rest = new GoogleChatRest(runtime),
): PlatformClient {
  const post: PlatformClient["post"] = async (target, message) => {
    const query = target.threadId ? "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : "";
    const sent = asRecord(
      await rest.call("POST", `/v1/${target.channelId}/messages${query}`, {
        text: message.text,
        ...(target.threadId ? { thread: { name: target.threadId } } : {}),
        ...(message.buttons && message.buttons.length > 0 ? { cardsV2: cards(message) } : {}),
      }),
    );
    return { messageId: str(sent.name) };
  };
  return {
    platform: "googlechat",
    post,
    async update(_target, messageId, message) {
      await rest.call("PATCH", `/v1/${messageId}?updateMask=text,cardsV2`, {
        text: message.text,
        cardsV2: cards(message),
      });
    },
    async directMessage(_workspaceId, userId, message) {
      const user = userId.startsWith("users/") ? userId : `users/${userId}`;
      const space = asRecord(
        await rest.call("GET", `/v1/spaces:findDirectMessage?name=${encodeURIComponent(user)}`),
      );
      const channelId = str(space.name);
      if (channelId === "") return null;
      const sent = await post(
        { workspaceId: GOOGLE_WORKSPACE_ID, channelId, threadId: null },
        message,
      );
      return { channelId, messageId: sent.messageId };
    },
    async download(attachment) {
      return rest.bytes(`/v1/media/${attachment.ref}?alt=media`);
    },
    async answer(event, text) {
      if (text.trim() === "") return;
      await post(
        { workspaceId: event.workspaceId, channelId: event.channelId, threadId: event.threadId },
        { text },
      );
    },
  };
}

// Adapter

export const createGoogleChatAdapter: AdapterFactory = (runtime) => {
  const rest = new GoogleChatRest(runtime);
  const client = createGoogleChatClient(runtime, rest);
  const jwks = new JwksCache({ jwksUrl: GOOGLE_CHAT_JWKS }, async (url) => {
    const response = await runtime.fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok)
      throw new PlatformApiError("googlechat", response.status, "Google signing keys unavailable.");
    return readJsonResponse(response);
  });
  const json = (status: number, body: unknown) => ({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    client,
    start() {
      const ready =
        parseServiceAccountKey(runtime.secret("serviceAccountKey")) !== null &&
        (runtime.connection.settings.projectNumber ?? "") !== "";
      runtime.setStatus(
        ready ? "waiting-relay" : "error",
        ready
          ? "Waiting for Google Chat events through the hub."
          : "Add the project number and the service account key.",
      );
    },
    stop() {
      runtime.setStatus("stopped", null);
    },
    async handleWebhook(request) {
      if (request.method.toUpperCase() !== "POST")
        return json(405, { error: "method not allowed" });
      const audience = runtime.connection.settings.projectNumber ?? "";
      const token = bearerToken(request.headers);
      if (token === null || audience === "") return json(401, { error: "unauthorized" });
      let keys;
      try {
        keys = await jwks.get(jwtKeyId(token), runtime.now());
      } catch {
        return json(503, { error: "signing keys unavailable" });
      }
      const verdict = verifyJwt({
        token,
        keys,
        issuers: GOOGLE_CHAT_ISSUERS,
        audience,
        nowSeconds: Math.floor(runtime.now() / 1000),
      });
      if (!verdict.ok) {
        runtime.log(`googlechat: refused event: ${verdict.reason}`);
        return json(401, { error: "unauthorized" });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(request.body));
      } catch {
        return json(400, { error: "bad json" });
      }
      runtime.setStatus("connected", null);
      if (str(asRecord(payload).type) === "ADDED_TO_SPACE") {
        return json(200, { text: "Hi! Mention me with a task, or use /zen <task>." });
      }
      for (const event of translateGoogleChatEvent(payload)) {
        // Answer Google at once; the agent's reply is posted later through the REST API.
        void runtime
          .emit(event)
          .catch((error) => runtime.log(`googlechat: event failed: ${String(error)}`));
      }
      return json(200, {});
    },
    async test() {
      try {
        await rest.call("GET", "/v1/spaces?pageSize=1");
        return { ok: true, detail: "The service account can reach Google Chat." };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

export const googleChatManifest: ManifestBuilder = ({ connection, appName, webhookUrl }) => {
  const projectNumber = connection?.settings.projectNumber || "<project number>";
  return {
    kind: "text",
    fileName: null,
    openUrl: "https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat",
    content: [
      "Google Cloud console > Google Chat API > Configuration:",
      `App name: ${appName}`,
      "Avatar URL: any public image; Description: AI staff",
      "Functionality: Receive 1:1 messages, Join spaces and group conversations",
      "Connection settings: HTTP endpoint URL",
      `HTTP endpoint URL: ${webhookUrl ?? "<shown once the connection is saved and the hub is linked>"}`,
      `Authentication audience: Project Number (${projectNumber})`,
      'Slash commands: name /zen, command ID 1, description "Give a task to the AI staff"',
      "Visibility: only the people or groups who should use it in your domain",
      "",
      "Service account (IAM > Service accounts > Create, no roles needed) > Keys > Add key > JSON: paste the JSON into Zen Staff. Scope used: https://www.googleapis.com/auth/chat.bot.",
    ].join("\n"),
  };
};
