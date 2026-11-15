// @effect-diagnostics nodeBuiltinImport:off - a small loopback HTTP server outside the Effect runtime (wrapped by ZenConnectors.ts).
// Zen Staff connectors: the `zen-connect` MCP server every Claude thread gets. It answers on
// 127.0.0.1 only, for threads holding their own signed token, and has three tools: find a
// connector, show the connect card, list connections. It carries no third-party credential.
// Minimal MCP over streamable HTTP: JSON-RPC requests answered with application/json.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

export interface GatewayTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly readOnly: boolean;
  readonly run: (threadId: string, args: Record<string, unknown>) => Promise<string>;
}

export interface Gateway {
  readonly url: string;
  readonly tokenFor: (threadId: string) => string;
  readonly close: () => Promise<void>;
}

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export function signThreadToken(secret: Buffer, threadId: string): string {
  const signature = NodeCrypto.createHmac("sha256", secret).update(threadId).digest("base64url");
  return `${Buffer.from(threadId, "utf8").toString("base64url")}.${signature}`;
}

/** The thread a bearer token belongs to, or null. Pure apart from the HMAC. */
export function verifyThreadToken(secret: Buffer, header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header ?? "");
  if (!match) return null;
  const threadId = Buffer.from(match[1]!, "base64url").toString("utf8");
  const expected = signThreadToken(secret, threadId).split(".")[1]!;
  const given = Buffer.from(match[2]!);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && NodeCrypto.timingSafeEqual(given, wanted)
    ? threadId
    : null;
}

/** One JSON-RPC message for the MCP server; null for notifications. */
export async function handleMcpMessage(
  message: { readonly id?: unknown; readonly method?: unknown; readonly params?: unknown },
  threadId: string,
  tools: ReadonlyArray<GatewayTool>,
  instructions: string,
): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const error = (code: number, text: string) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message: text },
  });
  if (message.id === undefined) return null;
  const params = (message.params ?? {}) as Record<string, unknown>;
  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "zen-connect", version: "1.0.0" },
        instructions,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = tools.find((candidate) => candidate.name === params.name);
      if (!tool) return error(-32602, `Unknown tool ${String(params.name)}.`);
      try {
        const text = await tool.run(threadId, (params.arguments ?? {}) as Record<string, unknown>);
        return reply({ content: [{ type: "text", text }] });
      } catch (cause) {
        return reply({
          content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }],
          isError: true,
        });
      }
    }
    default:
      return error(-32601, `Method ${String(message.method)} is not supported.`);
  }
}

export function startGateway(
  toolsOrList: ReadonlyArray<GatewayTool> | (() => ReadonlyArray<GatewayTool>),
  instructions: string,
): Promise<Gateway> {
  // A function is asked again on every request, so tools registered later are listed too.
  const toolsNow = () => (typeof toolsOrList === "function" ? toolsOrList() : toolsOrList);
  const secret = NodeCrypto.randomBytes(32);
  const server = NodeHttp.createServer((request, response) => {
    if (!(request.url ?? "").startsWith("/mcp")) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" }).end();
      return;
    }
    const threadId = verifyThreadToken(secret, request.headers.authorization);
    if (threadId === null) {
      response.writeHead(401, { "content-type": "text/plain" }).end("Not a Zen Staff thread.");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 1_000_000) chunks.push(chunk);
    });
    request.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.writeHead(400, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          }),
        );
        return;
      }
      const messages = Array.isArray(body) ? body : [body];
      void Promise.all(
        messages.map((message) =>
          handleMcpMessage(message as Record<string, unknown>, threadId, toolsNow(), instructions),
        ),
      ).then((results) => {
        const answers = results.filter((result) => result !== null);
        if (answers.length === 0) {
          response.writeHead(202).end();
          return;
        }
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(Array.isArray(body) ? answers : answers[0]));
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        tokenFor: (threadId) => signThreadToken(secret, threadId),
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
