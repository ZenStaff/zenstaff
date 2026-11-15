// @effect-diagnostics nodeBuiltinImport:off - plain async code that runs outside the Effect runtime (wrapped by ZenStaff.ts).
// Zen Staff AI staff: the `zen-staff` MCP server agent threads get (loopback, one random token
// per thread, valid only in this server process), and ClaudeAdapterV2's two hooks: the MCP
// override for agent threads and the tool gate that holds outbound connector calls until the
// manager approved them. Module-level resolvers keep the adapter free of a new service.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import { STAFF_MCP_SERVER_NAME, type GateDecision } from "./staffModel.ts";

export interface StaffToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

const STAFF_MCP_TOOLS: ReadonlyArray<StaffToolDefinition> = [
  {
    name: "staff_request_approval",
    description:
      "Ask your manager to approve an outbound action (send an e-mail or message, publish a post, pay, delete). Give the exact final content and the target. The content is checked (brand, prices, GDPR/ANPC basics) and shown to the manager; end your turn after calling this. When the manager approves, you get a message to carry it out; when they reject, you get their reason.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "publish", "pay", "delete", "other"] },
        target: { type: "string", description: "Recipient, page, payee or what is deleted." },
        content: { type: "string", description: "The exact text (or description) that goes out." },
        reason: { type: "string", description: "One sentence: why this is needed." },
      },
      required: ["action", "target", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "staff_record_result",
    description:
      "Record how you got to the result, at the end of every task: a summary, three short lines that explain it to your manager, the sources and files you used, your steps and your assumptions.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        explain_to_boss: { type: "array", items: { type: "string" }, maxItems: 3 },
        sources: { type: "array", items: { type: "string" } },
        files_read: { type: "array", items: { type: "string" } },
        steps: { type: "array", items: { type: "string" } },
        assumptions: { type: "array", items: { type: "string" } },
        files: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description:
            "Files you made for the person (paths in your folder). When the task came from an @mention they are attached to your reply in that chat.",
        },
      },
      required: ["summary", "explain_to_boss"],
      additionalProperties: false,
    },
  },
  {
    name: "staff_handoff",
    description:
      "Hand the task card you are working on to the next step: a colleague (human) or another AI employee, by name, with a short note.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Name of the person or AI employee." },
        note: { type: "string" },
      },
      required: ["to"],
      additionalProperties: false,
    },
  },
];

export const STAFF_MCP_TOOL_NAMES = STAFF_MCP_TOOLS.map((tool) => tool.name);

export interface StaffToolBackend {
  readonly instructions: string;
  readonly call: (tool: string, args: Readonly<Record<string, unknown>>) => Promise<string>;
}

const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function handleStaffMcpMessage(
  message: Record<string, unknown>,
  backend: StaffToolBackend,
): Promise<Record<string, unknown> | null> {
  const id = message.id;
  if (id === undefined || id === null) return null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const params = isRecord(message.params) ? message.params : {};
  switch (message.method) {
    case "initialize": {
      const requested =
        typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
      return reply({
        protocolVersion:
          requested !== undefined && SUPPORTED_PROTOCOLS.includes(requested)
            ? requested
            : SUPPORTED_PROTOCOLS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: STAFF_MCP_SERVER_NAME, version: "1.0.0" },
        instructions: backend.instructions,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: STAFF_MCP_TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!STAFF_MCP_TOOL_NAMES.includes(name)) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } };
      }
      try {
        const text = await backend.call(name, isRecord(params.arguments) ? params.arguments : {});
        return reply({ content: [{ type: "text", text }] });
      } catch (cause) {
        return reply({
          content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }],
          isError: true,
        });
      }
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${String(message.method)}` },
      };
  }
}

export interface RunningStaffMcpServer {
  readonly urlFor: (threadId: string) => string;
  readonly tokenFor: (threadId: string) => string;
  readonly close: () => Promise<void>;
}

const MAX_BODY_BYTES = 512 * 1024;

export function startStaffMcpServer(
  backendFor: (threadId: string) => StaffToolBackend | null,
  port = 0,
): Promise<RunningStaffMcpServer> {
  const tokens = new Map<string, string>();
  const tokenFor = (threadId: string) => {
    let token = tokens.get(threadId);
    if (token === undefined) {
      token = NodeCrypto.randomBytes(24).toString("base64url");
      tokens.set(threadId, token);
    }
    return token;
  };
  const authorized = (threadId: string, header: string | undefined) => {
    const expected = tokens.get(threadId);
    if (expected === undefined || header === undefined) return false;
    const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && NodeCrypto.timingSafeEqual(given, wanted);
  };
  const server = NodeHttp.createServer((request, response) => {
    const match = /^\/mcp\/t\/([A-Za-z0-9_:.-]{1,160})\/?$/.exec(
      (request.url ?? "").split("?")[0] ?? "",
    );
    if (match === null) {
      response.writeHead(404).end();
      return;
    }
    const threadId = decodeURIComponent(match[1]!);
    if (!authorized(threadId, request.headers.authorization)) {
      response.writeHead(401, { "content-type": "text/plain" }).end("Unauthorized");
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" }).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        response.writeHead(413).end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
        const backend = backendFor(threadId);
        if (backend === null) {
          response.writeHead(404, { "content-type": "text/plain" }).end("Not an AI staff thread.");
          return;
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const answers = (
          await Promise.all(
            messages.map((message) =>
              isRecord(message) ? handleStaffMcpMessage(message, backend) : Promise.resolve(null),
            ),
          )
        ).filter((answer): answer is Record<string, unknown> => answer !== null);
        if (answers.length === 0) {
          response.writeHead(202).end();
          return;
        }
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(Array.isArray(parsed) ? answers : answers[0]));
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500).end();
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        urlFor: (threadId) =>
          `http://127.0.0.1:${actualPort}/mcp/t/${encodeURIComponent(threadId)}`,
        tokenFor,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

// ClaudeAdapterV2 hooks.

interface StaffResolver {
  readonly mcpFor: (threadId: string) => { readonly url: string; readonly token: string } | null;
  readonly gate: (threadId: string, toolName: string) => GateDecision;
  /** The thread's shell runs without network (company agent, "Aprobări" on). */
  readonly shellOffline?: (threadId: string) => boolean;
}

let resolver: StaffResolver | null = null;

export function setZenStaffResolver(next: StaffResolver | null): void {
  resolver = next;
}

const STAFF_TOOL_TIMEOUT_MS = 120_000;

/** The MCP overrides plus `zen-staff` (tools pre-approved) when the thread is an AI staff task. */
export function withZenStaffMcp<
  Overrides extends {
    readonly allowedTools?: ReadonlyArray<string> | undefined;
    readonly mcpServers?: Readonly<Record<string, unknown>> | undefined;
  },
>(threadId: string, overrides: Overrides): Overrides {
  let endpoint: { readonly url: string; readonly token: string } | null = null;
  try {
    endpoint = resolver?.mcpFor(threadId) ?? null;
  } catch {
    endpoint = null;
  }
  if (endpoint === null) return overrides;
  let offline = false;
  try {
    offline = resolver?.shellOffline?.(threadId) ?? false;
  } catch {
    offline = false;
  }
  const allowed = STAFF_MCP_TOOL_NAMES.map((name) => `mcp__${STAFF_MCP_SERVER_NAME}__${name}`);
  return {
    ...overrides,
    allowedTools: Array.from(new Set([...(overrides.allowedTools ?? []), ...allowed])),
    mcpServers: {
      ...overrides.mcpServers,
      [STAFF_MCP_SERVER_NAME]: {
        type: "http",
        url: endpoint.url,
        // The shell mode is part of the session's options, so switching "Aprobări" restarts the
        // agent's Claude Code process on its next turn instead of keeping the old shell.
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          "X-Zen-Shell-Network": offline ? "off" : "on",
        },
        timeout: STAFF_TOOL_TIMEOUT_MS,
      },
    },
  } as Overrides;
}

/**
 * Wraps the adapter's permission callback (toolName, input, { toolUseID, ... }) for agent
 * threads: an outbound connector call without the manager's approval is denied with
 * instructions to ask for it; an approved one is allowed without asking the thread again.
 * Everything else goes to the adapter as before.
 */
export function withZenStaffToolGate<Callback extends (...args: never[]) => Promise<unknown>>(
  threadId: string,
  canUseTool: Callback,
): Callback {
  const gated = (...args: Parameters<Callback>) => {
    const [toolName, input, options] = args as unknown as [
      string,
      Record<string, unknown>,
      { readonly toolUseID?: string },
    ];
    let decision: GateDecision = { behavior: "pass" };
    try {
      decision = resolver?.gate(threadId, toolName) ?? { behavior: "pass" };
    } catch {
      decision = { behavior: "pass" };
    }
    if (decision.behavior === "deny") {
      return Promise.resolve({
        behavior: "deny",
        message: decision.message,
        toolUseID: options?.toolUseID,
      });
    }
    if (decision.behavior === "allow") {
      return Promise.resolve({
        behavior: "allow",
        updatedInput: input,
        toolUseID: options?.toolUseID,
      });
    }
    return canUseTool(...args);
  };
  return gated as unknown as Callback;
}
