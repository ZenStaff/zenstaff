// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Plain unit tests of the Google Chat adapter; no network.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ZenChatConnection } from "@t3tools/contracts/zenChat";
import { describe, expect, it } from "@effect/vitest";

import type { InboundEvent, InboundMessage } from "../model.ts";
import { GOOGLE_CHAT_JWKS } from "../signatures.ts";
import {
  createGoogleChatAdapter,
  createGoogleChatClient,
  googleChatManifest,
  translateGoogleChatEvent,
} from "./googleChat.ts";
import type { ConnectionRuntime } from "./types.ts";

const fixtureText = (name: string) =>
  NodeFS.readFileSync(
    NodePath.join(import.meta.dirname, "..", "fixtures", "googlechat", name),
    "utf8",
  );
const fixture = (name: string): unknown => JSON.parse(fixtureText(name));

const NOW = Date.parse("2026-11-07T20:30:00Z");
const PROJECT = "123456789012";
const signing = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "chat-key-1";

function signJwt(claims: Record<string, unknown>, key = signing.privateKey, kid = KID): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode(claims)}`;
  return `${unsigned}.${NodeCrypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
}

const validClaims = {
  iss: "chat@system.gserviceaccount.com",
  aud: PROJECT,
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 3600,
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function fakeRuntime() {
  const calls: Call[] = [];
  const events: InboundEvent[] = [];
  const connection: ZenChatConnection = {
    id: "gc",
    platform: "googlechat",
    name: "Google Chat",
    scope: "company",
    enabled: true,
    workspaceAllowlist: ["google"],
    channelAllowlist: [],
    settings: { projectNumber: PROJECT },
  };
  const key = JSON.stringify({
    type: "service_account",
    client_email: "zen-staff@acme-chat.iam.gserviceaccount.com",
    private_key: serviceAccount.privateKey.export({ format: "pem", type: "pkcs8" }),
    token_uri: "https://oauth2.googleapis.com/token",
  });
  const runtime: ConnectionRuntime = {
    connection,
    secret: (id) => (id === "serviceAccountKey" ? key : null),
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
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (url === GOOGLE_CHAT_JWKS) {
        const jwk = signing.publicKey.export({ format: "jwk" });
        return Response.json({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "ya29.token",
          expires_in: 3599,
          token_type: "Bearer",
        });
      }
      if (url.includes("spaces:findDirectMessage"))
        return Response.json({ name: "spaces/DMmanager" });
      return Response.json({ name: "spaces/AAAAzQx1b2E/messages/new.1" });
    }) as typeof fetch,
    WebSocket: globalThis.WebSocket,
    apiBase: null,
    now: () => NOW,
  };
  return { runtime, calls, events };
}

const request = (body: string, token: string | null) => ({
  method: "POST",
  path: "/",
  query: {},
  headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  body: new TextEncoder().encode(body),
});

describe("Google Chat translation", () => {
  it("reads a space mention: argument text, sender e-mail, thread, attachment", () => {
    const [event] = translateGoogleChatEvent(fixture("message-space.json")) as InboundMessage[];
    expect(event).toMatchObject({
      platform: "googlechat",
      workspaceId: "google",
      channelId: "spaces/AAAAzQx1b2E",
      channelType: "channel",
      threadId: "spaces/AAAAzQx1b2E/threads/QWqhHHMxAqI",
      messageId: "spaces/AAAAzQx1b2E/messages/QWqhHHMxAqI.QWqhHHMxAqI",
      text: "cât am vândut ieri?",
      mentioned: true,
      command: null,
      user: { id: "users/111111111111111111111", name: "Maria Pop", email: "maria@acme.example" },
    });
    expect(event!.attachments).toEqual([
      expect.objectContaining({
        name: "vanzari.csv",
        mimeType: "text/csv",
        ref: "spaces/AAAAzQx1b2E/attachments/AATUf-J",
      }),
    ]);
  });

  it("reads a slash command in a DM as one conversation", () => {
    const [event] = translateGoogleChatEvent(fixture("slash-dm.json")) as InboundMessage[];
    expect(event).toMatchObject({
      channelType: "dm",
      threadId: null,
      command: { args: "status" },
      text: "status",
    });
  });

  it("reads approval clicks", () => {
    expect(translateGoogleChatEvent(fixture("card-clicked.json"))).toEqual([
      expect.objectContaining({
        type: "action",
        value: "zenapr:0123456789abcdef:decline",
        channelId: "spaces/DMmanager",
        user: expect.objectContaining({ email: "ana@acme.example" }),
      }),
    ]);
  });
});

describe("Google Chat relay webhook", () => {
  it("accepts only Google's signed token for this project", async () => {
    const { runtime, events } = fakeRuntime();
    const adapter = createGoogleChatAdapter(runtime);
    const body = fixtureText("message-space.json");
    expect((await adapter.handleWebhook!(request(body, null))).status).toBe(401);
    expect(
      (await adapter.handleWebhook!(request(body, signJwt({ ...validClaims, aud: "999" })))).status,
    ).toBe(401);
    expect(
      (
        await adapter.handleWebhook!(
          request(body, signJwt({ ...validClaims, iss: "someone@else.com" })),
        )
      ).status,
    ).toBe(401);
    const forged = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect((await adapter.handleWebhook!(request(body, signJwt(validClaims, forged)))).status).toBe(
      401,
    );
    expect(
      (
        await adapter.handleWebhook!(
          request(body, signJwt({ ...validClaims, exp: NOW / 1000 - 3600 })),
        )
      ).status,
    ).toBe(401);
    expect(events).toHaveLength(0);
    const accepted = await adapter.handleWebhook!(request(body, signJwt(validClaims)));
    expect(accepted).toMatchObject({ status: 200, body: "{}" });
    await flushMicrotasks();
    expect(events).toHaveLength(1);
    const added = await adapter.handleWebhook!(
      request(
        JSON.stringify({ type: "ADDED_TO_SPACE", space: { name: "spaces/x", type: "ROOM" } }),
        signJwt(validClaims),
      ),
    );
    expect(JSON.parse(added.body!)).toHaveProperty("text");
  });
});

describe("Google Chat client", () => {
  it("authenticates as the service account and replies in the thread with buttons", async () => {
    const { runtime, calls } = fakeRuntime();
    const client = createGoogleChatClient(runtime);
    const sent = await client.post(
      {
        workspaceId: "google",
        channelId: "spaces/AAAAzQx1b2E",
        threadId: "spaces/AAAAzQx1b2E/threads/T1",
      },
      {
        text: "Aprobi?",
        buttons: [{ label: "Aprob", value: "zenapr:0123456789abcdef:accept", style: "primary" }],
      },
    );
    expect(sent.messageId).toBe("spaces/AAAAzQx1b2E/messages/new.1");
    const token = calls[0]!;
    expect(token.url).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(token.body).get("assertion")!;
    const [head, claims, signature] = assertion.split(".");
    expect(
      NodeCrypto.verify(
        "RSA-SHA256",
        Buffer.from(`${head}.${claims}`),
        serviceAccount.publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      iss: "zen-staff@acme-chat.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/chat.bot",
      aud: "https://oauth2.googleapis.com/token",
    });
    const post = calls[1]!;
    expect(post.url).toBe(
      "https://chat.googleapis.com/v1/spaces/AAAAzQx1b2E/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
    );
    expect(post.headers.authorization).toBe("Bearer ya29.token");
    const body = JSON.parse(post.body);
    expect(body.thread).toEqual({ name: "spaces/AAAAzQx1b2E/threads/T1" });
    expect(
      body.cardsV2[0].card.sections[0].widgets[0].buttonList.buttons[0].onClick.action,
    ).toEqual({
      function: "zen",
      parameters: [{ key: "value", value: "zenapr:0123456789abcdef:accept" }],
    });
    // The token is cached: a second post does not ask Google again.
    await client.update!(
      { workspaceId: "google", channelId: "spaces/AAAAzQx1b2E", threadId: null },
      "spaces/AAAAzQx1b2E/messages/new.1",
      { text: "Aprobat." },
    );
    expect(calls.filter((call) => call.url.includes("oauth2"))).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({
      method: "PATCH",
      url: "https://chat.googleapis.com/v1/spaces/AAAAzQx1b2E/messages/new.1?updateMask=text,cardsV2",
    });
    expect(client.upload).toBeUndefined();
  });

  it("finds the manager's DM space", async () => {
    const { runtime, calls } = fakeRuntime();
    const client = createGoogleChatClient(runtime);
    expect(await client.directMessage!("google", "users/222", { text: "card" })).toEqual({
      channelId: "spaces/DMmanager",
      messageId: "spaces/AAAAzQx1b2E/messages/new.1",
    });
    expect(
      calls.some((call) => call.url.endsWith("spaces:findDirectMessage?name=users%2F222")),
    ).toBe(true);
  });

  it("documents the console values", () => {
    const manifest = googleChatManifest({
      connection: fakeRuntime().runtime.connection,
      appName: "Zen Staff",
      webhookUrl: "https://hub.example/v1/chat/webhook/e/gc",
    });
    expect(manifest.content).toContain("https://hub.example/v1/chat/webhook/e/gc");
    expect(manifest.content).toContain(PROJECT);
    expect(manifest.content).toContain("/zen");
  });
});

/** Lets fire-and-forget handlers (`void emit(...)`) run; no clock involved. */
async function flushMicrotasks() {
  for (let index = 0; index < 50; index++) await Promise.resolve();
}
