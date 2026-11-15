// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Plain unit tests of the WhatsApp adapter; no network.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ZenChatConnection } from "@t3tools/contracts/zenChat";
import { describe, expect, it } from "@effect/vitest";

import type { InboundEvent, InboundMessage } from "../model.ts";
import {
  createWhatsAppAdapter,
  createWhatsAppClient,
  templateParameter,
  translateWhatsAppWebhook,
  WhatsAppConversations,
  whatsAppManifest,
} from "./whatsapp.ts";
import { PlatformApiError, type ConnectionRuntime } from "./types.ts";

const fixtureText = (name: string) =>
  NodeFS.readFileSync(
    NodePath.join(import.meta.dirname, "..", "fixtures", "whatsapp", name),
    "utf8",
  );
const fixture = (name: string): unknown => JSON.parse(fixtureText(name));

const SECRETS: Record<string, string> = {
  accessToken: "EAAG-token",
  appSecret: "app-secret-1",
  verifyToken: "verify-me-please",
};

function fakeRuntime(
  settings: Record<string, string> = {
    phoneNumberId: "106540352242922",
    reportTemplate: "zen_report:ro",
  },
) {
  let now = Date.parse("2026-11-07T20:00:00Z");
  const calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];
  const events: InboundEvent[] = [];
  const connection: ZenChatConnection = {
    id: "wa",
    platform: "whatsapp",
    name: "WhatsApp",
    scope: "company",
    enabled: true,
    workspaceAllowlist: ["106540352242922"],
    channelAllowlist: [],
    settings,
  };
  const runtime: ConnectionRuntime = {
    connection,
    secret: (id) => SECRETS[id] ?? null,
    emit: async (event) => {
      events.push(event);
    },
    setStatus: () => undefined,
    log: () => undefined,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });
      if (url.endsWith("/1003383421387256")) {
        return Response.json({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1003383421387256",
          mime_type: "image/jpeg",
        });
      }
      if (url.endsWith("/666")) return Response.json({ url: "https://evil.example/file" });
      if (url.startsWith("https://lookaside.fbsbx.com/"))
        return new Response(new Uint8Array([9, 9]));
      return Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.out" }] });
    }) as typeof fetch,
    WebSocket: globalThis.WebSocket,
    apiBase: null,
    now: () => now,
  };
  return { runtime, calls, events, advance: (ms: number) => (now += ms) };
}

const sign = (body: string, secret = SECRETS.appSecret!) =>
  `sha256=${NodeCrypto.createHmac("sha256", secret).update(body).digest("hex")}`;
const post = (body: string, signature: string | null) => ({
  method: "POST",
  path: "/",
  query: {},
  headers: signature === null ? {} : { "X-Hub-Signature-256": signature },
  body: new TextEncoder().encode(body),
});
const target = { workspaceId: "106540352242922", channelId: "40722111222", threadId: null };

describe("WhatsApp translation", () => {
  it("reads text, image with caption and voice notes", () => {
    const events = translateWhatsAppWebhook(fixture("text-and-image.json")) as InboundMessage[];
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      platform: "whatsapp",
      workspaceId: "106540352242922",
      channelId: "40722111222",
      channelType: "dm",
      threadId: null,
      mentioned: true,
      text: "Bună! Ce comenzi avem azi?",
      user: { id: "40722111222", name: "Maria Pop" },
    });
    expect(events[1]!.text).toBe("factura asta");
    expect(events[1]!.attachments[0]).toMatchObject({
      ref: "1003383421387256",
      mimeType: "image/jpeg",
      kind: "image",
    });
    expect(events[2]!.attachments[0]).toMatchObject({ mimeType: "audio/ogg", kind: "audio" });
  });

  it("reads approval button replies and ignores delivery statuses", () => {
    expect(translateWhatsAppWebhook(fixture("button-reply.json"))).toEqual([
      expect.objectContaining({
        type: "action",
        value: "zenapr:0123456789abcdef:accept",
        channelId: "40733444555",
      }),
    ]);
    expect(translateWhatsAppWebhook(fixture("status.json"))).toEqual([]);
    expect(translateWhatsAppWebhook({ object: "page", entry: [] })).toEqual([]);
  });
});

describe("WhatsApp relay webhook", () => {
  it("answers Meta's subscription check only with the right verify token", async () => {
    const adapter = createWhatsAppAdapter(fakeRuntime().runtime);
    const get = (token: string) => ({
      method: "GET",
      path: "/",
      query: { "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" },
      headers: {},
      body: new Uint8Array(),
    });
    expect(await adapter.handleWebhook!(get("verify-me-please"))).toMatchObject({
      status: 200,
      body: "1158201444",
    });
    expect((await adapter.handleWebhook!(get("wrong"))).status).toBe(403);
  });

  it("accepts only bodies signed with the app secret", async () => {
    const { runtime, events } = fakeRuntime();
    const adapter = createWhatsAppAdapter(runtime);
    const body = fixtureText("text-and-image.json");
    expect((await adapter.handleWebhook!(post(body, null))).status).toBe(401);
    expect((await adapter.handleWebhook!(post(body, sign(body, "other")))).status).toBe(401);
    expect((await adapter.handleWebhook!(post(`${body} `, sign(body)))).status).toBe(401);
    expect(events).toHaveLength(0);
    expect((await adapter.handleWebhook!(post(body, sign(body)))).status).toBe(200);
    await flushMicrotasks();
    expect(events).toHaveLength(3);
  });
});

describe("WhatsApp client", () => {
  it("replies freely inside the 24-hour window and uses the template outside it", async () => {
    const { runtime, calls, advance } = fakeRuntime();
    const conversations = new WhatsAppConversations();
    const client = createWhatsAppClient(runtime, conversations);
    conversations.record("40722111222", "wamid.in1", runtime.now());
    await client.post({ ...target, replyTo: "wamid.in1" }, { text: "Avem 12 comenzi." });
    expect(calls[0]).toMatchObject({
      url: "https://graph.facebook.com/v21.0/106540352242922/messages",
      headers: { authorization: "Bearer EAAG-token" },
      body: {
        messaging_product: "whatsapp",
        to: "40722111222",
        context: { message_id: "wamid.in1" },
        type: "text",
        text: { body: "Avem 12 comenzi.", preview_url: false },
      },
    });
    await client.post(target, { text: "Raport:\nvânzări 1200 lei", proactive: true });
    expect(calls[1]!.body).toMatchObject({
      type: "template",
      template: {
        name: "zen_report",
        language: { code: "ro" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Raport: | vânzări 1200 lei" }] },
        ],
      },
    });
    advance(25 * 60 * 60 * 1000);
    await client.post(target, { text: "Mai e cineva?" });
    expect((calls[2]!.body as { type: string }).type).toBe("template");
    expect(await client.directMessage!("x", "40722111222", { text: "card" })).toBeNull();
  });

  it("refuses to break the 24-hour rule without an approved template", async () => {
    const { runtime } = fakeRuntime({ phoneNumberId: "106540352242922" });
    const client = createWhatsAppClient(runtime, new WhatsAppConversations());
    await expect(client.post(target, { text: "Raport", proactive: true })).rejects.toBeInstanceOf(
      PlatformApiError,
    );
  });

  it("sends approval buttons as reply buttons and marks messages read while typing", async () => {
    const { runtime, calls } = fakeRuntime();
    const conversations = new WhatsAppConversations();
    conversations.record("40722111222", "wamid.in2", runtime.now());
    const client = createWhatsAppClient(runtime, conversations);
    await client.post(target, {
      text: "Aprobi trimiterea?",
      buttons: [
        {
          label: "Aprob trimiterea e-mailului",
          value: "zenapr:0123456789abcdef:accept",
          style: "primary",
        },
        { label: "Refuz", value: "zenapr:0123456789abcdef:decline", style: "danger" },
      ],
    });
    expect(calls[0]!.body).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Aprobi trimiterea?" },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "zenapr:0123456789abcdef:accept", title: "Aprob trimiterea e-m" },
            },
            { type: "reply", reply: { id: "zenapr:0123456789abcdef:decline", title: "Refuz" } },
          ],
        },
      },
    });
    await client.typing!(target);
    expect(calls[1]!.body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.in2",
      typing_indicator: { type: "text" },
    });
  });

  it("downloads media only from Meta's hosts", async () => {
    const { runtime, calls } = fakeRuntime();
    const client = createWhatsAppClient(runtime, new WhatsAppConversations());
    const base = {
      id: "m",
      name: "f.jpg",
      mimeType: "image/jpeg",
      sizeBytes: null,
      kind: "image" as const,
    };
    expect(await client.download!({ ...base, ref: "1003383421387256" })).toEqual(
      new Uint8Array([9, 9]),
    );
    expect(calls[1]!.headers.authorization).toBe("Bearer EAAG-token");
    await expect(client.download!({ ...base, ref: "666" })).rejects.toThrow(/Meta host/);
    expect(calls.some((call) => call.url.startsWith("https://evil.example"))).toBe(false);
  });

  it("cleans template parameters and documents the webhook", () => {
    expect(templateParameter("a\n\n  b\tc     d")).toBe("a | b c   d");
    const manifest = whatsAppManifest({
      connection: null,
      appName: "Zen",
      webhookUrl: "https://hub.example/v1/chat/webhook/e/wa",
    });
    expect(manifest.content).toContain("https://hub.example/v1/chat/webhook/e/wa");
    expect(manifest.content).toContain("messages");
  });
});

/** Lets fire-and-forget handlers (`void emit(...)`) run; no clock involved. */
async function flushMicrotasks() {
  for (let index = 0; index < 50; index++) await Promise.resolve();
}
