// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Plain unit tests of the Discord adapter; no network.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ZenChatConnection, ZenChatConnectionState } from "@t3tools/contracts/zenChat";
import { describe, expect, it } from "@effect/vitest";

import type { InboundEvent, InboundMessage } from "../model.ts";
import { verifyDiscordSignature } from "../signatures.ts";
import {
  createDiscordAdapter,
  createDiscordClient,
  DISCORD_INTENTS,
  DISCORD_PERMISSIONS,
  discordManifest,
  translateDiscordDispatch,
} from "./discord.ts";
import type { ConnectionRuntime } from "./types.ts";

const BOT = "1300000000000000001";
const fixture = (name: string) =>
  JSON.parse(
    NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "..", "fixtures", "discord", name),
      "utf8",
    ),
  ) as { t: string; d: unknown };

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function fakeRuntime(
  respond: (url: string, method: string) => unknown = () => ({ id: "m1" }),
  WebSocketImpl?: unknown,
) {
  const calls: Call[] = [];
  const events: InboundEvent[] = [];
  const statuses: Array<[ZenChatConnectionState, string | null]> = [];
  const connection: ZenChatConnection = {
    id: "dc",
    platform: "discord",
    name: "Discord",
    scope: "company",
    enabled: true,
    workspaceAllowlist: ["1240000000000000001"],
    channelAllowlist: [],
    settings: { applicationId: "1300000000000000001", guildId: "1240000000000000001" },
  };
  const runtime: ConnectionRuntime = {
    connection,
    secret: (id) => (id === "botToken" ? "bot-token-1" : null),
    emit: async (event) => {
      events.push(event);
    },
    setStatus: (state, detail) => statuses.push([state, detail]),
    log: () => undefined,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body });
      const answer = respond(url, method);
      return answer instanceof Response
        ? answer
        : new Response(JSON.stringify(answer), { status: 200 });
    }) as typeof fetch,
    WebSocket: (WebSocketImpl ?? globalThis.WebSocket) as typeof WebSocket,
    apiBase: null,
    now: () => Date.parse("2026-11-07T20:00:00Z"),
  };
  return { runtime, calls, events, statuses };
}

describe("Discord translation", () => {
  it("turns a mention with an image into a message for the bot", () => {
    const { t, d } = fixture("message-mention.json");
    const [event] = translateDiscordDispatch(t, d, BOT) as InboundMessage[];
    expect(event).toMatchObject({
      type: "message",
      platform: "discord",
      workspaceId: "1240000000000000001",
      channelId: "1250000000000000010",
      channelType: "channel",
      threadId: null,
      messageId: "1436512380000000001",
      mentioned: true,
      text: "rezumă comenzile de ieri pentru @Maria Pop",
      command: null,
      user: { id: "1200000000000000042", name: "Alex M" },
    });
    expect(event!.attachments).toEqual([
      expect.objectContaining({
        name: "comenzi.png",
        kind: "image",
        mimeType: "image/png",
        sizeBytes: 48211,
      }),
    ]);
  });

  it("treats DMs as addressed, other channel messages as not, and skips its own", () => {
    const dm = translateDiscordDispatch(
      "MESSAGE_CREATE",
      fixture("message-dm.json").d,
      BOT,
    )[0] as InboundMessage;
    expect(dm).toMatchObject({ channelType: "dm", workspaceId: "dm", mentioned: true });
    const other = translateDiscordDispatch(
      "MESSAGE_CREATE",
      fixture("message-unaddressed.json").d,
      BOT,
    )[0] as InboundMessage;
    expect(other.mentioned).toBe(false);
    const own = {
      ...(fixture("message-dm.json").d as object),
      author: { id: BOT, username: "zen", bot: true },
    };
    expect(translateDiscordDispatch("MESSAGE_CREATE", own, BOT)).toEqual([]);
    const reply = {
      ...(fixture("message-unaddressed.json").d as object),
      content: "și pentru azi",
      referenced_message: { id: "1", author: { id: BOT, bot: true } },
    };
    expect(
      (translateDiscordDispatch("MESSAGE_CREATE", reply, BOT)[0] as InboundMessage).mentioned,
    ).toBe(true);
  });

  it("maps the /zen command and approval buttons", () => {
    const [command] = translateDiscordDispatch(
      "INTERACTION_CREATE",
      fixture("interaction-command.json").d,
      BOT,
    ) as InboundMessage[];
    expect(command).toMatchObject({
      command: { args: "pregătește raportul săptămânal" },
      messageId: "",
      mentioned: true,
      responseRef: "1436512410000000004:aW50ZXJhY3Rpb246MTQzNjUxMjQxMDAwMDAwMDAwNDpzZWNyZXQ",
      user: { id: "1200000000000000042" },
    });
    const [button] = translateDiscordDispatch(
      "INTERACTION_CREATE",
      fixture("interaction-button.json").d,
      BOT,
    );
    expect(button).toMatchObject({
      type: "action",
      value: "zenapr:0123456789abcdef:accept",
      workspaceId: "dm",
      messageId: "1436512420000000005",
      user: { id: "1200000000000000077" },
    });
  });
});

describe("Discord client", () => {
  it("posts replies with buttons and no pings", async () => {
    const { runtime, calls } = fakeRuntime();
    const client = createDiscordClient(runtime);
    const sent = await client.post(
      { workspaceId: "g", channelId: "c1", threadId: null, replyTo: "m0" },
      {
        text: "Aprobi?",
        buttons: [
          { label: "Aprob", value: "zenapr:0123456789abcdef:accept", style: "primary" },
          { label: "Refuz", value: "zenapr:0123456789abcdef:decline", style: "danger" },
        ],
      },
    );
    expect(sent.messageId).toBe("m1");
    expect(calls[0]).toMatchObject({
      url: "https://discord.com/api/v10/channels/c1/messages",
      method: "POST",
      headers: { authorization: "Bot bot-token-1" },
      body: {
        content: "Aprobi?",
        allowed_mentions: { parse: [] },
        message_reference: { message_id: "m0", fail_if_not_exists: false },
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 3, label: "Aprob", custom_id: "zenapr:0123456789abcdef:accept" },
              { type: 2, style: 4, label: "Refuz", custom_id: "zenapr:0123456789abcdef:decline" },
            ],
          },
        ],
      },
    });
    await client.update!({ workspaceId: "g", channelId: "c1", threadId: null }, "m1", {
      text: "Aprobat.",
    });
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      body: { content: "Aprobat.", components: [] },
    });
    await client.typing!({ workspaceId: "g", channelId: "c1", threadId: null });
    expect(calls[2]!.url).toBe("https://discord.com/api/v10/channels/c1/typing");
  });

  it("opens a DM for the manager and answers interactions privately without the bot token", async () => {
    const { runtime, calls } = fakeRuntime((url) =>
      url.endsWith("/users/@me/channels") ? { id: "dm9" } : { id: "m2" },
    );
    const client = createDiscordClient(runtime);
    expect(await client.directMessage!("g", "u7", { text: "card" })).toEqual({
      channelId: "dm9",
      messageId: "m2",
    });
    expect(calls[0]!.body).toEqual({ recipient_id: "u7" });
    const [event] = translateDiscordDispatch(
      "INTERACTION_CREATE",
      fixture("interaction-button.json").d,
      BOT,
    );
    await client.answer!(event!, "Aprobat de Maria.");
    const followUp = calls.at(-1)!;
    expect(followUp.url).toBe(
      "https://discord.com/api/v10/webhooks/1300000000000000001/aW50ZXJhY3Rpb246YnV0dG9u",
    );
    expect(followUp.body).toMatchObject({ content: "Aprobat de Maria.", flags: 64 });
    expect(followUp.headers.authorization).toBeUndefined();
  });

  it("downloads only from Discord's CDN", async () => {
    const { runtime, calls } = fakeRuntime(() => new Response(new Uint8Array([1, 2, 3])));
    const client = createDiscordClient(runtime);
    const base = {
      id: "a",
      name: "x.png",
      mimeType: "image/png",
      sizeBytes: 3,
      kind: "image" as const,
    };
    expect(
      await client.download!({ ...base, ref: "https://cdn.discordapp.com/attachments/1/2/x.png" }),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]!.headers.authorization).toBeUndefined();
    await expect(client.download!({ ...base, ref: "https://evil.example/x.png" })).rejects.toThrow(
      /CDN/,
    );
  });
});

describe("Discord gateway", () => {
  it("identifies without privileged intents, acks interactions and emits events", async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      readonly url: string;
      readonly sent: unknown[] = [];
      private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};
      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }
      addEventListener(type: string, listener: (event: unknown) => void) {
        (this.listeners[type] ??= []).push(listener);
      }
      send(data: string) {
        this.sent.push(JSON.parse(data));
      }
      close() {}
      receive(frame: unknown) {
        for (const listener of this.listeners.message ?? [])
          listener({ data: JSON.stringify(frame) });
      }
    }
    const { runtime, calls, events, statuses } = fakeRuntime(
      (url) => (url.endsWith("/gateway/bot") ? { url: "wss://gateway.discord.gg" } : {}),
      FakeSocket,
    );
    const adapter = createDiscordAdapter(runtime);
    adapter.start();
    await flushMicrotasks();
    expect(
      calls.some(
        (call) =>
          call.method === "PUT" &&
          call.url.endsWith(
            "/applications/1300000000000000001/guilds/1240000000000000001/commands",
          ),
      ),
    ).toBe(true);
    const socket = sockets[0]!;
    expect(socket.url).toBe("wss://gateway.discord.gg?v=10&encoding=json");
    socket.receive({ op: 10, d: { heartbeat_interval: 60_000 } });
    expect(socket.sent[0]).toMatchObject({
      op: 2,
      d: { token: "bot-token-1", intents: DISCORD_INTENTS },
    });
    expect(DISCORD_INTENTS & (1 << 15)).toBe(0);
    socket.receive({
      op: 0,
      s: 1,
      t: "READY",
      d: { user: { id: BOT }, session_id: "s1", resume_gateway_url: "wss://resume" },
    });
    expect(statuses.at(-1)).toEqual(["connected", null]);
    socket.receive(fixture("message-mention.json"));
    socket.receive(fixture("interaction-command.json"));
    await flushMicrotasks();
    expect(events.map((event) => event.type)).toEqual(["message", "message"]);
    const ack = calls.find((call) => call.url.includes("/interactions/1436512410000000004/"));
    expect(ack?.body).toEqual({ type: 5, data: { flags: 64 } });
    adapter.stop();
  });
});

describe("Discord signatures and install", () => {
  it("verifies Ed25519 interaction signatures", () => {
    const { publicKey, privateKey } = NodeCrypto.generateKeyPairSync("ed25519");
    const publicKeyHex = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url").toString(
      "hex",
    );
    const body = '{"type":1}';
    const timestamp = "1762546800";
    const signature = NodeCrypto.sign(null, Buffer.from(timestamp + body), privateKey).toString(
      "hex",
    );
    const headers = { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp };
    expect(verifyDiscordSignature({ publicKeyHex, headers, body })).toEqual({ ok: true });
    expect(verifyDiscordSignature({ publicKeyHex, headers, body: '{"type":2}' }).ok).toBe(false);
  });

  it("builds the install link with minimal permissions", () => {
    expect(DISCORD_PERMISSIONS).toBe("274878008320");
    const manifest = discordManifest({
      connection: fakeRuntime().runtime.connection,
      appName: "Zen",
      webhookUrl: null,
    });
    expect(manifest.kind).toBe("url");
    expect(manifest.openUrl).toBe(
      "https://discord.com/oauth2/authorize?client_id=1300000000000000001&scope=bot%20applications.commands&permissions=274878008320",
    );
  });
});

/** Lets fire-and-forget handlers (`void emit(...)`) run; no clock involved. */
async function flushMicrotasks() {
  for (let index = 0; index < 50; index++) await Promise.resolve();
}
