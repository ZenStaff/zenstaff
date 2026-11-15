// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off globalTimers:off globalDate:off - Live verification helper.
// Zen Staff: starts a Zen server (source `src/bin.ts` or the built `dist/bin.mjs`) on a port with a
// throwaway home, signs in with a one-time bootstrap token and calls WebSocket RPCs. Used by the
// live verifiers in this folder (ZEN.md, "Toolchains for workflows"). Not shipped.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

export interface LiveServerOptions {
  /** Absolute path of `dist/bin.mjs` or `src/bin.ts`. */
  readonly bin: string;
  readonly port: number;
  readonly home: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly log: string;
}

export interface LiveServer {
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly pid: number;
  /** Calls one RPC of WsRpcGroup by name. */
  readonly rpc: <A = unknown>(method: string, payload: unknown) => Promise<A>;
  readonly stop: () => Promise<void>;
}

export async function startLiveServer(options: LiveServerOptions): Promise<LiveServer> {
  const bootstrap = NodeCrypto.randomUUID();
  NodeFS.mkdirSync(options.home, { recursive: true });
  const child = NodeChildProcess.spawn(
    process.execPath,
    [options.bin, "start", "--bootstrap-fd", "3", "--log-level", "info"],
    {
      cwd: options.cwd,
      // ZEN_HOME wins over T3CODE_HOME; drop the variables of any T3 session this runs inside.
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !/^(T3|ZEN_|CLAUDE)/.test(name)),
        ),
        ZEN_HOME: options.home,
        T3CODE_HOME: options.home,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    },
  );
  const pipe = child.stdio[3];
  NodeAssert.ok(pipe && "write" in pipe);
  pipe.end(
    JSON.stringify({
      mode: "desktop",
      noBrowser: true,
      port: options.port,
      t3Home: options.home,
      host: "127.0.0.1",
      desktopBootstrapToken: bootstrap,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    }),
  );
  const ready = Promise.withResolvers<void>();
  let tail = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (data: Buffer) => {
      const text = data.toString().replaceAll(bootstrap, "[REDACTED]");
      NodeFS.appendFileSync(options.log, text);
      tail = (tail + text).slice(-8192);
      if (/startup phase: complete|Listening on http/.test(tail)) ready.resolve();
    });
  }
  child.once("exit", (code) => ready.reject(new Error(`Server exited ${code}: ${tail}`)));
  const deadline = setTimeout(() => ready.reject(new Error("Server startup timed out")), 90_000);
  try {
    await ready.promise.finally(() => clearTimeout(deadline));
  } catch (error) {
    // Only our own child process.
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }

  const origin = `http://127.0.0.1:${options.port}`;
  const tokenResponse = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: bootstrap,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
  });
  NodeAssert.ok(tokenResponse.ok, `Authentication failed: ${tokenResponse.status}`);
  const token = ((await tokenResponse.json()) as { access_token: string }).access_token;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    [ORCHESTRATION_PROTOCOL_HEADER]: String(ORCHESTRATION_PROTOCOL_VERSION),
  };

  const rpc = async <A>(method: string, payload: unknown): Promise<A> => {
    const ticketResponse = await fetch(`${origin}/api/auth/websocket-ticket`, {
      method: "POST",
      headers,
    });
    NodeAssert.ok(ticketResponse.ok, `WebSocket ticket failed: ${ticketResponse.status}`);
    const ticket = ((await ticketResponse.json()) as { ticket: string }).ticket;
    const layerSocket = Socket.layerWebSocket(
      `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`,
    ).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
    const layerProtocol = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(layerSocket),
      Layer.provide(RpcSerialization.layerJson),
    );
    const program = Effect.gen(function* () {
      const client = yield* RpcClient.make(WsRpcGroup);
      const fn = (client as unknown as Record<string, (input: unknown) => Effect.Effect<A>>)[
        method
      ];
      NodeAssert.ok(fn, `No RPC ${method}`);
      return yield* fn(payload);
    });
    return Effect.runPromise(
      program.pipe(Effect.scoped, Effect.provide(layerProtocol)) as Effect.Effect<A>,
    );
  };

  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((done) => child.once("exit", () => done()));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(timer);
  };
  NodeAssert.ok(child.pid !== undefined);
  return { origin, headers, pid: child.pid, rpc, stop };
}
