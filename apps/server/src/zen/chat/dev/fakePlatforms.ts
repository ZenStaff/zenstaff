// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off -- Dev harness, plain Node.
// Zen Staff chat integrations: a local fake of Slack (Web API + Socket Mode) and Telegram (Bot API
// with long polling), speaking the same request and payload shapes as the real platforms, so the
// whole flow can run end to end without a real workspace.
//
//   node apps/server/src/zen/chat/dev/fakePlatforms.ts 3995
//
// Point the Zen server at it with ZEN_CHAT_SLACK_API_URL=http://127.0.0.1:3995/slack/api and
// ZEN_CHAT_TELEGRAM_API_URL=http://127.0.0.1:3995/telegram. Drive it with the control API:
//   POST /control/slack/mention   {user, channel, text, thread_ts?}
//   POST /control/slack/click     {user, channel, message_ts, value}
//   POST /control/telegram/message {from:{id,first_name}, chat:{id,type,title?}, text, reply_to?}
//   POST /control/telegram/click  {from, chat, message_id, data}
//   GET  /control/log             everything the bots sent
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

export interface FakeLogEntry {
  readonly at: string;
  readonly platform: "slack" | "telegram";
  readonly method: string;
  readonly body: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
}

// A minimal RFC 6455 server side (text frames, ping/close), enough for Socket Mode.

class MiniSocket {
  private buffer = Buffer.alloc(0);
  private readonly socket: NodeNet.Socket;
  onText: (text: string) => void = () => undefined;
  closed = false;

  constructor(socket: NodeNet.Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("close", () => {
      this.closed = true;
    });
    socket.on("error", () => {
      this.closed = true;
    });
  }

  private drain() {
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0]! & 0x0f;
      let length = this.buffer[1]! & 0x7f;
      const masked = (this.buffer[1]! & 0x80) !== 0;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
      }
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x1) this.onText(payload.toString("utf8"));
      else if (opcode === 0x8) this.close();
      else if (opcode === 0x9) this.frame(0xa, payload);
    }
  }

  private frame(opcode: number, payload: Buffer) {
    if (this.closed) return;
    const head =
      payload.length < 126
        ? Buffer.from([0x80 | opcode, payload.length])
        : payload.length < 65536
          ? Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff])
          : (() => {
              const buffer = Buffer.alloc(10);
              buffer[0] = 0x80 | opcode;
              buffer[1] = 127;
              buffer.writeBigUInt64BE(BigInt(payload.length), 2);
              return buffer;
            })();
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(text: string) {
    this.frame(0x1, Buffer.from(text, "utf8"));
  }

  close() {
    if (this.closed) return;
    this.frame(0x8, Buffer.alloc(0));
    this.closed = true;
    this.socket.end();
  }
}

export function startFakePlatforms(
  port: number,
  options: { readonly log?: (line: string) => void } = {},
) {
  const say = options.log ?? (() => undefined);
  const log: FakeLogEntry[] = [];
  const sockets: MiniSocket[] = [];
  const acks: string[] = [];
  let tsCounter = 1731000000;
  const nextTs = () => `${++tsCounter}.000100`;
  const slackUsers: Record<string, { name: string; email: string }> = {
    UMARIA: { name: "Maria Pop", email: "maria@acme.test" },
    UION: { name: "Ion Ionescu", email: "ion@acme.test" },
  };
  const telegramUpdates: Record<string, unknown>[] = [];
  const telegramWaiters: Array<() => void> = [];
  let updateId = 500000;
  let telegramMessageId = 1000;

  const record = (entry: Omit<FakeLogEntry, "at">) => {
    log.push({ ...entry, at: new Date().toISOString() });
    say(`${entry.platform} ${entry.method} ${JSON.stringify(entry.body).slice(0, 160)}`);
  };

  const readBody = (request: NodeHttp.IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => resolve(Buffer.concat(chunks)));
    });

  const parse = (request: NodeHttp.IncomingMessage, raw: Buffer): Record<string, unknown> => {
    const type = request.headers["content-type"] ?? "";
    const text = raw.toString("utf8");
    if (type.includes("application/json")) {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (type.includes("x-www-form-urlencoded"))
      return Object.fromEntries(new URLSearchParams(text));
    return { raw: text.slice(0, 200) };
  };

  const json = (response: NodeHttp.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  const pushSlack = (envelope: Record<string, unknown>) => {
    const live = sockets.filter((socket) => !socket.closed);
    for (const socket of live) socket.send(JSON.stringify(envelope));
    return live.length;
  };

  const pushTelegram = (update: Record<string, unknown>) => {
    telegramUpdates.push({ update_id: ++updateId, ...update });
    for (const wake of telegramWaiters.splice(0)) wake();
  };
  const slackApi = (
    method: string,
    token: string,
    body: Record<string, unknown>,
  ): Record<string, unknown> => {
    const isApp = token.startsWith("xapp-");
    if (method === "apps.connections.open") {
      if (!isApp) return { ok: false, error: "not_allowed_token_type" };
      return {
        ok: true,
        url: `ws://127.0.0.1:${port}/slack/socket?ticket=${NodeCrypto.randomUUID()}`,
      };
    }
    if (!token.startsWith("xoxb-")) return { ok: false, error: "invalid_auth" };
    switch (method) {
      case "auth.test":
        return {
          ok: true,
          url: "https://acme.slack.com/",
          team: "Acme",
          user: "zen",
          team_id: "T0ACME",
          user_id: "UZENBOT",
          bot_id: "BZEN",
        };
      case "users.info": {
        const user = slackUsers[String(body.user)];
        return user
          ? {
              ok: true,
              user: {
                id: body.user,
                name: user.name.split(" ")[0]!.toLowerCase(),
                profile: { real_name: user.name, display_name: user.name, email: user.email },
              },
            }
          : { ok: false, error: "user_not_found" };
      }
      case "chat.postMessage": {
        const channel = String(body.channel);
        const ts = nextTs();
        const result = {
          ok: true,
          channel: channel.startsWith("U") ? `D${channel.slice(1)}` : channel,
          ts,
        };
        record({ platform: "slack", method, body, result });
        return result;
      }
      case "chat.update":
        record({ platform: "slack", method, body });
        return { ok: true, channel: body.channel, ts: body.ts };
      case "files.getUploadURLExternal":
        return {
          ok: true,
          upload_url: `http://127.0.0.1:${port}/slack/upload/F${tsCounter}`,
          file_id: `F${tsCounter}`,
        };
      case "files.completeUploadExternal":
        record({ platform: "slack", method, body });
        return { ok: true, files: body.files };
      default:
        return { ok: false, error: "unknown_method" };
    }
  };
  const telegramApi = async (
    method: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    switch (method) {
      case "getMe":
        return {
          ok: true,
          result: { id: 6000, is_bot: true, first_name: "Zen Staff", username: "ZenStaffTestBot" },
        };
      case "getUpdates": {
        const offset = Number(body.offset ?? 0);
        const pending = () =>
          telegramUpdates.filter((update) => Number(update.update_id) >= offset);
        if (pending().length === 0) {
          const timeout = Math.min(Number(body.timeout ?? 0), 25) * 1000;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, timeout);
            telegramWaiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
        return { ok: true, result: pending() };
      }
      case "sendMessage": {
        const result = {
          message_id: ++telegramMessageId,
          chat: { id: body.chat_id },
          date: Math.floor(Date.now() / 1000),
          text: body.text,
        };
        record({ platform: "telegram", method, body, result });
        return { ok: true, result };
      }
      case "editMessageText":
      case "answerCallbackQuery":
      case "sendChatAction":
        record({ platform: "telegram", method, body });
        return { ok: true, result: true };
      default:
        return { ok: false, error_code: 404, description: "Not Found" };
    }
  };

  const server = NodeHttp.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const raw = await readBody(request);
    const body = parse(request, raw);
    try {
      let match = /^\/slack\/api\/([\w.]+)$/.exec(url.pathname);
      if (match) {
        const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        return json(response, 200, slackApi(match[1]!, token, body));
      }
      if (url.pathname.startsWith("/slack/upload/")) {
        record({ platform: "slack", method: "upload", body: { bytes: raw.length } });
        return json(response, 200, { ok: true });
      }
      match = /^\/telegram\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
      if (match) {
        if (!/^\d+:[\w-]+$/.test(match[1]!))
          return json(response, 401, { ok: false, error_code: 401, description: "Unauthorized" });
        return json(response, 200, await telegramApi(match[2]!, body));
      }
      // Control API: the test driver injects platform events here.
      if (url.pathname === "/control/slack/mention" && request.method === "POST") {
        const ts = nextTs();
        const user = String(body.user ?? "UMARIA");
        const channel = String(body.channel ?? "C0SALES");
        const text = String(body.text ?? "");
        const envelope = {
          envelope_id: NodeCrypto.randomUUID(),
          type: "events_api",
          accepts_response_payload: false,
          retry_attempt: 0,
          retry_reason: "",
          payload: {
            token: "fake",
            team_id: "T0ACME",
            api_app_id: "A0ZEN",
            type: "event_callback",
            event_id: `Ev${ts}`,
            event_time: Math.floor(Date.now() / 1000),
            event: {
              type: body.thread_ts && !text.includes("<@UZENBOT>") ? "message" : "app_mention",
              ...(body.thread_ts && !text.includes("<@UZENBOT>")
                ? { channel_type: "channel" }
                : {}),
              user,
              text,
              ts,
              ...(body.thread_ts ? { thread_ts: body.thread_ts } : {}),
              team: "T0ACME",
              channel,
              event_ts: ts,
            },
          },
        };
        const delivered = pushSlack(envelope);
        return json(response, 200, { ts, delivered });
      }
      if (url.pathname === "/control/slack/click" && request.method === "POST") {
        const user = String(body.user ?? "UION");
        const envelope = {
          envelope_id: NodeCrypto.randomUUID(),
          type: "interactive",
          accepts_response_payload: false,
          payload: {
            type: "block_actions",
            user: {
              id: user,
              username: slackUsers[user]?.name ?? user,
              name: slackUsers[user]?.name ?? user,
              team_id: "T0ACME",
            },
            api_app_id: "A0ZEN",
            container: {
              type: "message",
              message_ts: body.message_ts,
              channel_id: body.channel,
              is_ephemeral: false,
            },
            trigger_id: `${Date.now()}.1.fake`,
            team: { id: "T0ACME", domain: "acme" },
            channel: { id: body.channel, name: "directmessage" },
            message: { type: "message", ts: body.message_ts, text: "" },
            response_url: `http://127.0.0.1:${port}/slack/response/${Date.now()}`,
            actions: [
              {
                action_id: "zen_0",
                block_id: "b",
                value: body.value,
                type: "button",
                action_ts: `${Date.now() / 1000}`,
              },
            ],
          },
        };
        return json(response, 200, { delivered: pushSlack(envelope) });
      }
      if (url.pathname.startsWith("/slack/response/")) {
        record({ platform: "slack", method: "response_url", body });
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/control/telegram/message" && request.method === "POST") {
        const messageId = ++telegramMessageId;
        const text = String(body.text ?? "");
        const entities = [...text.matchAll(/@\w+|\/zen(?:@\w+)?/g)].map((found) => ({
          offset: found.index,
          length: found[0].length,
          type: found[0].startsWith("/") ? "bot_command" : "mention",
        }));
        pushTelegram({
          message: {
            message_id: messageId,
            from: { is_bot: false, ...(body.from as object) },
            chat: body.chat,
            date: Math.floor(Date.now() / 1000),
            text,
            ...(entities.length > 0 ? { entities } : {}),
            ...(body.reply_to
              ? {
                  reply_to_message: {
                    message_id: body.reply_to,
                    from: {
                      id: 6000,
                      is_bot: true,
                      first_name: "Zen Staff",
                      username: "ZenStaffTestBot",
                    },
                    chat: body.chat,
                    date: 0,
                    text: "",
                  },
                }
              : {}),
          },
        });
        return json(response, 200, { message_id: messageId });
      }
      if (url.pathname === "/control/telegram/click" && request.method === "POST") {
        pushTelegram({
          callback_query: {
            id: NodeCrypto.randomBytes(8).toString("hex"),
            from: { is_bot: false, ...(body.from as object) },
            message: { message_id: body.message_id, chat: body.chat, date: 0, text: "" },
            chat_instance: "1",
            data: body.data,
          },
        });
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/control/log")
        return json(response, 200, {
          log,
          acks: acks.length,
          sockets: sockets.filter((socket) => !socket.closed).length,
        });
      json(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      json(response, 500, { ok: false, error: String(error) });
    }
  });

  server.on("upgrade", (request, socket) => {
    if (!(request.url ?? "").startsWith("/slack/socket")) {
      socket.destroy();
      return;
    }
    const key = String(request.headers["sec-websocket-key"] ?? "");
    const accept = NodeCrypto.createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    const mini = new MiniSocket(socket as NodeNet.Socket);
    mini.onText = (text) => {
      try {
        const frame = JSON.parse(text) as { envelope_id?: string };
        if (frame.envelope_id) acks.push(frame.envelope_id);
      } catch {
        // Ignore.
      }
    };
    sockets.push(mini);
    mini.send(
      JSON.stringify({
        type: "hello",
        num_connections: 1,
        debug_info: { host: "fake-slack" },
        connection_info: { app_id: "A0ZEN" },
      }),
    );
    say("slack socket connected");
  });

  return new Promise<{ close: () => void; log: FakeLogEntry[] }>((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        close: () => {
          for (const socket of sockets) socket.close();
          server.close();
        },
        log,
      }),
    );
  });
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? 3995);
  void startFakePlatforms(port, { log: (line) => console.log(line) }).then(() =>
    console.log(`fake Slack + Telegram on http://127.0.0.1:${port}`),
  );
}
