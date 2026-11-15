// ClaudeAdapterV2's hook: a session in a project of a company with hosted memory gets the
// `zen-memory` MCP server (loopback, per-company token) with its read-only tools pre-approved.
// A module-level resolver, installed by ZenMemory, keeps the adapter free of a new service.
import { MEMORY_MCP_SERVER_NAME, MEMORY_MCP_TOOL_NAMES } from "./mcpServer.ts";

export interface MemoryMcpEndpoint {
  readonly url: string;
  readonly token: string;
}

type Resolver = (projectId: string) => MemoryMcpEndpoint | null;

let resolver: Resolver = () => null;

export function setZenMemoryMcpResolver(next: Resolver | null): void {
  resolver = next ?? (() => null);
}

function zenMemoryMcpEndpoint(projectId: string): MemoryMcpEndpoint | null {
  try {
    return resolver(projectId);
  } catch {
    return null;
  }
}

const MEMORY_TOOL_TIMEOUT_MS = 60_000;

/** The MCP overrides plus `zen-memory` when the project's company has hosted memory. */
export function withZenCompanyMemoryMcp<
  Overrides extends {
    readonly allowedTools?: ReadonlyArray<string> | undefined;
    readonly mcpServers?: Readonly<Record<string, unknown>> | undefined;
  },
>(projectId: string, overrides: Overrides): Overrides {
  const endpoint = zenMemoryMcpEndpoint(projectId);
  if (endpoint === null) return overrides;
  const allowed = MEMORY_MCP_TOOL_NAMES.map((name) => `mcp__${MEMORY_MCP_SERVER_NAME}__${name}`);
  return {
    ...overrides,
    allowedTools: Array.from(new Set([...(overrides.allowedTools ?? []), ...allowed])),
    mcpServers: {
      ...overrides.mcpServers,
      [MEMORY_MCP_SERVER_NAME]: {
        type: "http",
        url: endpoint.url,
        headers: { Authorization: `Bearer ${endpoint.token}` },
        timeout: MEMORY_TOOL_TIMEOUT_MS,
      },
    },
  } as Overrides;
}

// Codex: its per-thread config takes `mcp_servers.<name>` keys, but the adapter knows only the
// thread's working folder there, so ZenMemory also resolves a folder to its project (the deepest
// project root that contains it).
type CwdResolver = (cwd: string) => string | null;
let cwdResolver: CwdResolver = () => null;

export function setZenMemoryProjectByCwd(next: CwdResolver | null): void {
  cwdResolver = next ?? (() => null);
}

/** The project whose folder contains `cwd` (null when none or not known yet). */
export function zenProjectIdForCwd(cwd: string | undefined): string | null {
  if (cwd === undefined) return null;
  try {
    return cwdResolver(cwd);
  } catch {
    return null;
  }
}

/** The deepest root that is the folder or one of its parents, or null. */
export function projectForCwd(
  cwd: string,
  roots: ReadonlyArray<{ readonly root: string; readonly projectId: string }>,
): string | null {
  const clean = (path: string) => path.replace(/[\\/]+$/, "");
  const folder = clean(cwd);
  let best: { readonly root: string; readonly projectId: string } | null = null;
  for (const entry of roots) {
    const root = clean(entry.root);
    const inside =
      folder === root || folder.startsWith(`${root}/`) || folder.startsWith(`${root}\\`);
    if (inside && (best === null || root.length > clean(best.root).length)) best = entry;
  }
  return best?.projectId ?? null;
}

/** Codex thread config plus `zen-memory` when the folder's project has hosted company memory. */
export function withZenCompanyMemoryCodexConfig<Config extends Readonly<Record<string, unknown>>>(
  cwd: string | undefined,
  config: Config,
): Config {
  if (cwd === undefined) return config;
  let projectId: string | null = null;
  try {
    projectId = cwdResolver(cwd);
  } catch {
    projectId = null;
  }
  const endpoint = projectId === null ? null : zenMemoryMcpEndpoint(projectId);
  if (endpoint === null) return config;
  return {
    ...config,
    [`mcp_servers.${MEMORY_MCP_SERVER_NAME}`]: {
      url: endpoint.url,
      http_headers: { Authorization: `Bearer ${endpoint.token}` },
      tool_timeout_sec: MEMORY_TOOL_TIMEOUT_MS / 1000,
      enabled_tools: [...MEMORY_MCP_TOOL_NAMES],
    },
  };
}
