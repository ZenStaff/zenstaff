// Zen Staff connectors: other Zen features add agent tools to the `zen-connect` MCP server every
// Claude thread already has (pre-approved), so they need no adapter hook (zen/intake uses it), and
// can list the person's connections without depending on the connectors service.
import type { GatewayTool } from "./gateway.ts";

const groups = new Map<string, ReadonlyArray<GatewayTool>>();

/** Adds (or replaces) a group of tools; returns the function that removes them again. */
export function registerZenGatewayTools(
  group: string,
  tools: ReadonlyArray<GatewayTool>,
): () => void {
  groups.set(group, tools);
  return () => {
    if (groups.get(group) === tools) groups.delete(group);
  };
}

/** Every registered tool, in registration order. */
export function zenGatewayExtraTools(): ReadonlyArray<GatewayTool> {
  return [...groups.values()].flat();
}

export interface ZenConnectionSummary {
  readonly name: string;
  readonly app: string | null;
  /** "local" (Claude Code), "account" (AI account connector), "plugin". */
  readonly origin: string;
  readonly health: string;
}

type Lister = () => Promise<ReadonlyArray<ZenConnectionSummary>>;
let lister: Lister | null = null;

export function setZenConnectionsLister(next: Lister | null): void {
  lister = next;
}

/** The person's connections as the connectors service sees them; empty without it. */
export async function listZenConnections(): Promise<ReadonlyArray<ZenConnectionSummary>> {
  if (lister === null) return [];
  try {
    return await lister();
  } catch {
    return [];
  }
}
