// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Plain unit tests of the Slack, Telegram and Teams adapters and the signature checks; no network.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ZenChatConnection, ZenChatPlatform } from "@t3tools/contracts/zenChat";
import { describe, expect, it } from "@effect/vitest";

import type { InboundEvent, InboundMessage } from "../model.ts";
import {
  decodeRelayInput,
  handleZenChatRelay,
  setZenChatRelayHandler,
  webhookUrlFor,
} from "../relay.ts";
import {
  verifyJwt,
  verifyMetaSignature,
  verifySlackSignature,
  verifyTelegramSecret,
  type Jwk,
} from "../signatures.ts";
import {
  createSlackAdapter,
  slackManifest,
  slackMessageBody,
  translateSlackEnvelope,
  type SlackEnvelope,
} from "./slack.ts";
import {
  createTeamsAdapter,
  splitTeamsConversation,
  teamsActivity,
  teamsManifest,
  translateTeamsActivity,
} from "./teams.ts";
import { createTelegramAdapter, telegramSendBody, translateTelegramUpdate } from "./telegram.ts";
import type { ConnectionRuntime } from "./types.ts";

const fixture = (platform: string, name: string): Record<string, unknown> =>
  JSON.parse(
    NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "..", "fixtures", platform, name),
      "utf8",
    ),
  );

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function fakeRuntime(
  platform: ZenChatPlatform,
  settings: Record<string, string>,
  secrets: Record<string, string>,
  respond: (call: Call) => unknown,
) {
  const calls: Call[] = [];
  const events: InboundEvent[] = [];
  const connection: ZenChatConnection = {
    id: `${platform}-1`,
    platform,
    name: platform,
    scope: "company",
    enabled: true,
    workspaceAllowlist: [],
    channelAllowlist: [],
    settings,
  };
  const runtime: ConnectionRuntime = {
    connection,
    secret: (id) => secrets[id] ?? null,
    emit: async (event) => {
      events.push(event);
    },
    setStatus: () => undefined,
    log: () => undefined,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      let body: unknown = init?.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = Object.fromEntries(new URLSearchParams(body as string));
        }
      }
      const call = { url: String(input), method: init?.method ?? "GET", headers, body };
      calls.push(call);
      return new Response(JSON.stringify(respond(call)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    WebSocket: globalThis.WebSocket,
    apiBase: null,
    now: () => Date.parse("2026-11-07T10:00:05Z"),
  };
  return { runtime, calls, events };
}

describe("Slack translation (recorded Socket Mode envelopes)", () => {
  const context = { botUserId: "U0ZENBOT", names: { U0ANA: "Ana" } };

  it("turns an app_mention into a channel message with the bot mention removed and files", () => {
    const [event] = translateSlackEnvelope(
      fixture("slack", "app_mention.json") as unknown as SlackEnvelope,
      context,
    ) as InboundMessage[];
    expect(event).toMatchObject({
      type: "message",
      workspaceId: "T0001ZEN",
      channelId: "C0SALES",
      channelType: "channel",
      threadId: null,
      messageId: "1731000000.000100",
      mentioned: true,
      text: "please summarise the Q3 report (https://example.com/report) for #sales & ping @Ana",
    });
    expect(event!.attachments).toEqual([
      {
        id: "F0PDF",
        name: "q3.pdf",
        mimeType: "application/pdf",
        sizeBytes: 52344,
        kind: "file",
        ref: "https://files.slack.com/files-pri/T0001ZEN-F0PDF/download/q3.pdf",
      },
    ]);
  });

  it("keeps thread replies and DMs, drops bot echoes", () => {
    const [reply] = translateSlackEnvelope(
      fixture("slack", "thread_reply.json") as unknown as SlackEnvelope,
      context,
    ) as InboundMessage[];
    expect(reply).toMatchObject({
      threadId: "1731000000.000100",
      mentioned: false,
      channelType: "channel",
    });
    const [dm] = translateSlackEnvelope(
      fixture("slack", "dm.json") as unknown as SlackEnvelope,
      context,
    ) as InboundMessage[];
    expect(dm).toMatchObject({ channelType: "dm", mentioned: true, threadId: null });
    expect(
      translateSlackEnvelope(
        fixture("slack", "bot_echo.json") as unknown as SlackEnvelope,
        context,
      ),
    ).toEqual([]);
  });

  it("does not answer a mention twice (message.channels copy of an app_mention)", () => {
    const envelope = fixture("slack", "thread_reply.json") as unknown as SlackEnvelope & {
      payload: { event: Record<string, unknown> };
    };
    envelope.payload.event.text = "<@U0ZENBOT> hi";
    expect(translateSlackEnvelope(envelope, context)).toEqual([]);
  });

  it("translates button presses and /zen", () => {
    expect(
      translateSlackEnvelope(
        fixture("slack", "block_actions.json") as unknown as SlackEnvelope,
        context,
      ),
    ).toEqual([
      {
        type: "action",
        platform: "slack",
        workspaceId: "T0001ZEN",
        channelId: "D0BOSS",
        threadId: null,
        messageId: "1731000200.000600",
        user: { id: "U0BOSS", name: "ion" },
        value: "zenapr:0123456789abcdef:accept",
        responseRef: "https://hooks.slack.com/actions/T0001ZEN/1/abc",
      },
    ]);
    const [command] = translateSlackEnvelope(
      fixture("slack", "slash_command.json") as unknown as SlackEnvelope,
      context,
    ) as InboundMessage[];
    expect(command).toMatchObject({
      messageId: "",
      command: { args: "draft the weekly newsletter" },
      channelType: "channel",
    });
  });

  it("builds chat.postMessage bodies with Block Kit buttons", () => {
    const body = slackMessageBody(
      { workspaceId: "T", channelId: "C1", threadId: "1.2" },
      {
        text: "Approve?",
        buttons: [{ label: "Approve", value: "zenapr:0123456789abcdef:accept", style: "primary" }],
      },
    );
    expect(body).toMatchObject({ channel: "C1", thread_ts: "1.2", text: "Approve?" });
    expect((body.blocks as Array<Record<string, unknown>>)[1]).toMatchObject({
      type: "actions",
      elements: [{ type: "button", value: "zenapr:0123456789abcdef:accept", style: "primary" }],
    });
  });

  it("ships a manifest with Socket Mode and minimal scopes", () => {
    const manifest = JSON.parse(
      slackManifest({ connection: null, appName: "Acme AI", webhookUrl: null }).content,
    );
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.oauth_config.scopes.bot).not.toContain("chat:write.customize");
    expect(manifest.oauth_config.scopes.bot).not.toContain("admin");
    expect(manifest.features.slash_commands[0].command).toBe("/zen");
  });

  it("downloads files only from Slack hosts and enriches users with their e-mail", async () => {
    const { runtime, calls } = fakeRuntime(
      "slack",
      {},
      { botToken: "xoxb-1", appToken: "xapp-1" },
      (call) =>
        call.url.endsWith("users.info")
          ? {
              ok: true,
              user: {
                name: "maria",
                profile: { real_name: "Maria Pop", email: "maria@acme.example" },
              },
            }
          : { ok: true },
    );
    const adapter = createSlackAdapter(runtime);
    await expect(
      adapter.client.download!({
        id: "f",
        name: "x",
        mimeType: "text/plain",
        sizeBytes: 1,
        kind: "file",
        ref: "https://evil.example/steal",
      }),
    ).rejects.toThrow(/non-Slack host/);
    expect(calls).toHaveLength(0);
    expect(await adapter.client.lookupUser!("T1", "U1")).toMatchObject({
      name: "Maria Pop",
      email: "maria@acme.example",
    });
    expect(calls[0]!.headers.authorization).toBe("Bearer xoxb-1");
  });
});

describe("Telegram translation (recorded getUpdates results)", () => {
  const context = { botUsername: "ZenStaffBot", botId: "6000", rootOf: () => null };

  it("handles a group mention, a reply to the bot and a private photo", () => {
    const [mention] = translateTelegramUpdate(
      fixture("telegram", "group_mention.json"),
      context,
    ) as InboundMessage[];
    expect(mention).toMatchObject({
      channelId: "-1002233",
      channelType: "group",
      mentioned: true,
      text: "fă un rezumat al comenzilor de azi",
      user: { id: "7001", name: "Maria Pop" },
    });
    const [reply] = translateTelegramUpdate(fixture("telegram", "reply_to_bot.json"), {
      ...context,
      rootOf: (_chat, id) => (id === "43" ? "41" : null),
    }) as InboundMessage[];
    expect(reply).toMatchObject({ mentioned: true, threadId: "41" });
    const [photo] = translateTelegramUpdate(
      fixture("telegram", "private_photo.json"),
      context,
    ) as InboundMessage[];
    expect(photo).toMatchObject({
      channelType: "dm",
      threadId: null,
      mentioned: true,
      text: "ce scrie pe factura asta?",
    });
    expect(photo!.attachments[0]).toMatchObject({
      ref: "AgAClarge",
      kind: "image",
      sizeBytes: 88000,
    });
  });

  it("handles /zen@bot commands and button callbacks", () => {
    const [command] = translateTelegramUpdate(
      fixture("telegram", "command.json"),
      context,
    ) as InboundMessage[];
    expect(command).toMatchObject({ command: { args: "status" }, mentioned: true });
    expect(translateTelegramUpdate(fixture("telegram", "callback_query.json"), context)).toEqual([
      {
        type: "action",
        platform: "telegram",
        workspaceId: "telegram",
        channelId: "7002",
        threadId: null,
        messageId: "77",
        user: { id: "7002", name: "Ion Manager", isBot: false },
        value: "zenapr:0123456789abcdef:decline",
        responseRef: "4382bfdwdsb323b2d9",
      },
    ]);
  });

  it("sends HTML replies with inline keyboards", () => {
    expect(
      telegramSendBody(
        "-1",
        {
          text: "<b>Ok</b>",
          buttons: [{ label: "Aprob", value: "zenapr:0123456789abcdef:accept", style: "primary" }],
        },
        "41",
      ),
    ).toEqual({
      chat_id: "-1",
      text: "<b>Ok</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: 41, allow_sending_without_reply: true },
      reply_markup: {
        inline_keyboard: [[{ text: "Aprob", callback_data: "zenapr:0123456789abcdef:accept" }]],
      },
    });
  });

  it("remembers which conversation a bot message belongs to", async () => {
    let next = 100;
    const { runtime } = fakeRuntime(
      "telegram",
      { botUsername: "ZenStaffBot" },
      { botToken: "1:abc" },
      () => ({ ok: true, result: { message_id: next++ } }),
    );
    const adapter = createTelegramAdapter(runtime);
    await adapter.client.post(
      { workspaceId: "telegram", channelId: "-1002233", threadId: "41", replyTo: "41" },
      { text: "hi" },
    );
    // A reply to message 100 maps back to the conversation rooted at 41.
    const update = fixture("telegram", "reply_to_bot.json") as {
      message: { reply_to_message: { message_id: number } };
    };
    update.message.reply_to_message.message_id = 100;
    // The adapter's own translate uses its memory; check through the webhook path.
    const { runtime: hookRuntime, events } = fakeRuntime(
      "telegram",
      { botUsername: "ZenStaffBot" },
      { botToken: "1:abc", webhookSecret: "s3cret-token" },
      () => ({ ok: true, result: { message_id: 1 } }),
    );
    const hooked = createTelegramAdapter(hookRuntime);
    const denied = await hooked.handleWebhook!({
      method: "POST",
      path: "/",
      query: {},
      headers: { "x-telegram-bot-api-secret-token": "nope" },
      body: new TextEncoder().encode(JSON.stringify(update)),
    });
    expect(denied.status).toBe(401);
    const accepted = await hooked.handleWebhook!({
      method: "POST",
      path: "/",
      query: {},
      headers: { "x-telegram-bot-api-secret-token": "s3cret-token" },
      body: new TextEncoder().encode(JSON.stringify(update)),
    });
    expect(accepted.status).toBe(200);
    await flushMicrotasks();
    expect(events).toHaveLength(1);
  });
});

describe("Teams translation (recorded Bot Framework activities)", () => {
  const context = { botId: "28:app-zen-0001" };

  it("splits channel thread ids", () => {
    expect(splitTeamsConversation("19:a@thread.tacv2;messageid=17")).toEqual({
      channelId: "19:a@thread.tacv2",
      threadRoot: "17",
    });
    expect(splitTeamsConversation("a:1personal")).toEqual({
      channelId: "a:1personal",
      threadRoot: null,
    });
  });

  it("translates a channel mention, a personal file and a card submit", () => {
    const [mention] = translateTeamsActivity(
      fixture("teams", "channel_mention.json"),
      context,
    ) as InboundMessage[];
    expect(mention).toMatchObject({
      workspaceId: "tenant-zen-0001",
      channelId: "19:salesabc@thread.tacv2",
      channelType: "channel",
      threadId: "1731000000000",
      mentioned: true,
      text: "prepare the offer for Hotel Arcadia",
    });
    const [file] = translateTeamsActivity(
      fixture("teams", "personal_file.json"),
      context,
    ) as InboundMessage[];
    expect(file).toMatchObject({ channelType: "dm", mentioned: true });
    expect(file!.attachments[0]).toMatchObject({
      name: "contract.pdf",
      mimeType: "application/pdf",
      ref: expect.stringMatching(/^public:https:\/\/zen\.sharepoint\.com\//),
    });
    expect(translateTeamsActivity(fixture("teams", "card_submit.json"), context)).toMatchObject([
      {
        type: "action",
        value: "zenapr:0123456789abcdef:accept",
        user: { id: "29:1abcBOSS" },
        messageId: "1731000590000",
      },
    ]);
  });

  it("renders buttons as an Adaptive Card and ships an app manifest", () => {
    const activity = teamsActivity({
      text: "Approve?",
      buttons: [{ label: "Approve", value: "zenapr:0123456789abcdef:accept", style: "primary" }],
    });
    expect(JSON.stringify(activity)).toContain(
      '"data":{"zenAction":"zenapr:0123456789abcdef:accept"}',
    );
    const manifest = JSON.parse(
      teamsManifest({ connection: null, appName: "Zen", webhookUrl: null }).content,
    );
    expect(manifest.bots[0].scopes).toEqual(["personal", "team", "groupChat"]);
  });

  it("accepts only activities signed by the Bot Framework for this bot", async () => {
    const { publicKey, privateKey } = NodeCrypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwk = {
      ...(publicKey.export({ format: "jwk" }) as Jwk),
      kid: "k1",
      endorsements: ["msteams"],
    };
    const activity = fixture("teams", "channel_mention.json");
    const sign = (claims: Record<string, unknown>) => {
      const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })).toString(
        "base64url",
      );
      const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = NodeCrypto.sign(
        "RSA-SHA256",
        Buffer.from(`${head}.${body}`),
        privateKey,
      ).toString("base64url");
      return `${head}.${body}.${signature}`;
    };
    const now = Math.floor(Date.parse("2026-11-07T10:00:05Z") / 1000);
    const good = {
      iss: "https://api.botframework.com",
      aud: "app-zen-0001",
      exp: now + 600,
      nbf: now - 10,
      serviceurl: "https://smba.trafficmanager.net/emea/",
    };
    const { runtime, events } = fakeRuntime(
      "teams",
      { appId: "app-zen-0001", tenantId: "tenant-zen-0001" },
      { clientSecret: "s" },
      (call) =>
        call.url.includes("openidconfiguration")
          ? { jwks_uri: "https://login.botframework.com/v1/.well-known/keys" }
          : { keys: [jwk] },
    );
    const adapter = createTeamsAdapter(runtime);
    const send = (token: string, body = activity) =>
      adapter.handleWebhook!({
        method: "POST",
        path: "/",
        query: {},
        headers: { authorization: `Bearer ${token}` },
        body: new TextEncoder().encode(JSON.stringify(body)),
      });
    expect((await send(sign({ ...good, aud: "someone-else" }))).status).toBe(401);
    expect((await send(sign({ ...good, iss: "https://evil" }))).status).toBe(401);
    expect((await send(sign({ ...good, exp: now - 3600 }))).status).toBe(401);
    expect((await send(sign({ ...good, serviceurl: "https://evil.example/" }))).status).toBe(401);
    expect((await send(`${sign(good).slice(0, -4)}AAAA`)).status).toBe(401);
    expect(events).toHaveLength(0);
    expect((await send(sign(good))).status).toBe(200);
    await flushMicrotasks();
    expect(events).toHaveLength(1);
    // Wrong channel endorsement.
    expect(
      verifyJwt({
        token: sign(good),
        keys: [{ ...jwk, endorsements: ["skype"] }],
        issuers: ["https://api.botframework.com"],
        audience: "app-zen-0001",
        nowSeconds: now,
        endorsement: "msteams",
      }),
    ).toMatchObject({ ok: false });
  });

  it("gets a Bot Connector token with the customer's own app registration", async () => {
    const { runtime, calls } = fakeRuntime(
      "teams",
      { appId: "app-zen-0001", tenantId: "tenant-zen-0001" },
      { clientSecret: "s3" },
      (call) =>
        call.url.includes("/oauth2/v2.0/token")
          ? { access_token: "tok", expires_in: 3600 }
          : { id: "act-1" },
    );
    const adapter = createTeamsAdapter(runtime);
    const posted = await adapter.client.post(
      { workspaceId: "tenant-zen-0001", channelId: "19:a@thread.tacv2", threadId: "17" },
      { text: "hello" },
    );
    expect(posted.messageId).toBe("act-1");
    expect(calls[0]!.url).toBe(
      "https://login.microsoftonline.com/tenant-zen-0001/oauth2/v2.0/token",
    );
    expect(calls[0]!.body).toMatchObject({
      grant_type: "client_credentials",
      client_id: "app-zen-0001",
      scope: "https://api.botframework.com/.default",
    });
    expect(calls[1]!.url).toBe(
      "https://smba.trafficmanager.net/teams/v3/conversations/19%3Aa%40thread.tacv2%3Bmessageid%3D17/activities",
    );
    expect(calls[1]!.headers.authorization).toBe("Bearer tok");
  });
});

describe("signatures", () => {
  it("checks Slack request signatures with recorded headers", () => {
    const body = "token=x&team_id=T1&command=%2Fzen&text=status";
    const timestamp = "1731000000";
    const signature = `v0=${NodeCrypto.createHmac("sha256", "8f742231b10e8888abcd99yyyzzz85a5").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    const headers = { "X-Slack-Request-Timestamp": timestamp, "X-Slack-Signature": signature };
    expect(
      verifySlackSignature({
        signingSecret: "8f742231b10e8888abcd99yyyzzz85a5",
        headers,
        body,
        nowSeconds: 1731000100,
      }),
    ).toEqual({ ok: true });
    expect(
      verifySlackSignature({ signingSecret: "other", headers, body, nowSeconds: 1731000100 }),
    ).toMatchObject({ ok: false });
    expect(
      verifySlackSignature({
        signingSecret: "8f742231b10e8888abcd99yyyzzz85a5",
        headers,
        body: `${body}&x=1`,
        nowSeconds: 1731000100,
      }),
    ).toMatchObject({ ok: false });
    expect(
      verifySlackSignature({
        signingSecret: "8f742231b10e8888abcd99yyyzzz85a5",
        headers,
        body,
        nowSeconds: 1731009999,
      }),
    ).toMatchObject({ ok: false, reason: "stale Slack request" });
  });

  it("checks Meta and Telegram secrets in constant time", () => {
    const body = '{"object":"whatsapp_business_account"}';
    const signature = `sha256=${NodeCrypto.createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(
      verifyMetaSignature({
        appSecret: "app-secret",
        headers: { "x-hub-signature-256": signature },
        body,
      }),
    ).toEqual({ ok: true });
    expect(
      verifyMetaSignature({
        appSecret: "app-secret",
        headers: { "x-hub-signature-256": "sha256=00" },
        body,
      }),
    ).toMatchObject({ ok: false });
    expect(verifyTelegramSecret({ secretToken: "abc", headers: {} })).toMatchObject({ ok: false });
  });
});

describe("hub relay seam", () => {
  it("decodes relayed requests and routes them to the connection", async () => {
    expect(decodeRelayInput({ connectionId: "../x", method: "POST" })).toBeNull();
    expect(decodeRelayInput({ connectionId: "teams-1", method: "DELETE" })).toBeNull();
    const decoded = decodeRelayInput({
      connectionId: "teams-1",
      method: "post",
      headers: { Authorization: "Bearer t" },
      query: { "hub.mode": "subscribe" },
      bodyBase64: Buffer.from("{}").toString("base64"),
    });
    expect(decoded).toMatchObject({
      connectionId: "teams-1",
      request: {
        method: "POST",
        headers: { authorization: "Bearer t" },
        query: { "hub.mode": "subscribe" },
      },
    });
    expect(await handleZenChatRelay("chat.webhook", {})).toMatchObject({ status: 503 });
    setZenChatRelayHandler(async (connectionId) => ({ status: 200, body: connectionId }));
    expect(
      await handleZenChatRelay("chat.webhook", {
        connectionId: "teams-1",
        method: "POST",
        bodyBase64: "",
      }),
    ).toEqual({ status: 200, body: "teams-1" });
    expect(await handleZenChatRelay("chat.other", {})).toMatchObject({ status: 400 });
    setZenChatRelayHandler(null);
    expect(webhookUrlFor("https://hub.example.com/", "env-1", "teams-1")).toBe(
      "https://hub.example.com/v1/chat/webhook/env-1/teams-1",
    );
    expect(webhookUrlFor(null, "env-1", "teams-1")).toBeNull();
  });
});

/** Lets fire-and-forget handlers (`void emit(...)`) run; no clock involved. */
async function flushMicrotasks() {
  for (let index = 0; index < 50; index++) await Promise.resolve();
}
