// Zen Staff connectors: ClaudeAdapterV2 wraps its MCP overrides with this, so every Claude thread
// gets the `zen-connect` server, pre-approved. The URL carries a version that changes when a
// connection is added or removed, which changes the query key and restarts Claude Code with its
// own updated MCP config. No credential passes here.

export interface ZenConnectThreadServer {
  readonly url: string;
  readonly authorization: string;
}

type Resolver = (threadId: string) => ZenConnectThreadServer | null;

let resolver: Resolver = () => null;

export function setZenConnectorThreadResolver(next: Resolver | null): void {
  resolver = next ?? (() => null);
}

const ZEN_CONNECT_SERVER = "zen-connect";
const ZEN_CONNECT_TOOLS = `mcp__${ZEN_CONNECT_SERVER}__*`;

/** Adds `zen-connect` to a thread's MCP overrides (same shape as `claudeMcpQueryOverrides`). */
export function withZenConnectorMcp<
  Overrides extends {
    readonly allowedTools?: ReadonlyArray<string> | undefined;
    readonly mcpServers?: Record<string, unknown> | undefined;
  },
>(threadId: string, overrides: Overrides): Overrides {
  let server: ZenConnectThreadServer | null;
  try {
    server = resolver(threadId);
  } catch {
    server = null;
  }
  if (server === null) return overrides;
  return {
    ...overrides,
    allowedTools: Array.from(new Set([...(overrides.allowedTools ?? []), ZEN_CONNECT_TOOLS])),
    mcpServers: {
      ...overrides.mcpServers,
      [ZEN_CONNECT_SERVER]: {
        type: "http",
        url: server.url,
        headers: { Authorization: server.authorization },
      },
    },
  } as Overrides;
}
