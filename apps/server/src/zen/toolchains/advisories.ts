// Zen Staff: blocked tool versions, merged from the catalog entry, the shipped advisories.json
// and the file pulled from the hub. A version below a minimum safe version or in a blocked range
// never runs (docs/zen-toolchain-security.md).
import {
  ZenAdvisoryFile,
  type ZenAdvisoryFile as ZenAdvisoryFileType,
  type ZenBlockedVersion,
} from "@t3tools/contracts/zenToolchains";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { CatalogEntry } from "./catalog.ts";
import { compareVersions, satisfiesRange } from "./versions.ts";

export interface ToolBlockRules {
  readonly minSafeVersion: string | null;
  readonly blocked: ReadonlyArray<ZenBlockedVersion>;
}

export interface BlockList {
  readonly rules: ReadonlyMap<string, ToolBlockRules>;
  /** Where the newest advisories came from, for Settings > Tools. */
  readonly source: string;
  readonly generatedAt: string | null;
}

const decodeAdvisories = Schema.decodeUnknownResult(ZenAdvisoryFile);

export function parseAdvisoryFile(text: string): ZenAdvisoryFileType | null {
  try {
    const decoded = decodeAdvisories(JSON.parse(text));
    return Result.isSuccess(decoded) ? decoded.success : null;
  } catch {
    return null;
  }
}

const higher = (left: string | null, right: string | undefined): string | null => {
  if (right === undefined) return left;
  if (left === null) return right;
  return compareVersions(right, left) > 0 ? right : left;
};

/** Merges the catalog's own rules with advisory files (later files only add rules). */
export function mergeBlockLists(
  catalog: Iterable<CatalogEntry>,
  files: ReadonlyArray<ZenAdvisoryFileType | null>,
): BlockList {
  const rules = new Map<string, { minSafeVersion: string | null; blocked: ZenBlockedVersion[] }>();
  const rule = (id: string) => {
    let existing = rules.get(id);
    if (!existing) {
      existing = { minSafeVersion: null, blocked: [] };
      rules.set(id, existing);
    }
    return existing;
  };
  for (const entry of catalog) {
    const current = rule(entry.id);
    current.minSafeVersion = higher(current.minSafeVersion, entry.minSafeVersion);
    current.blocked.push(...(entry.blockedVersions ?? []));
  }
  let source = "catalog";
  let generatedAt: string | null = null;
  for (const file of files) {
    if (file === null) continue;
    for (const [id, tool] of Object.entries(file.tools)) {
      const current = rule(id);
      current.minSafeVersion = higher(current.minSafeVersion, tool.minSafeVersion);
      current.blocked.push(...tool.blockedVersions);
    }
    if (generatedAt === null || file.generatedAt > generatedAt) {
      generatedAt = file.generatedAt;
      source = file.source;
    }
  }
  return { rules, source, generatedAt };
}

/** Why `toolId@version` is blocked, in plain words, or null when it may run. */
export function blockReason(list: BlockList, toolId: string, version: string): string | null {
  const rules = list.rules.get(toolId);
  if (!rules) return null;
  if (rules.minSafeVersion !== null && compareVersions(version, rules.minSafeVersion) < 0) {
    return `Version ${version} is older than the safe minimum ${rules.minSafeVersion}.`;
  }
  const hit = rules.blocked.find((blocked) => satisfiesRange(version, blocked.version));
  if (!hit) return null;
  const ids = hit.advisories && hit.advisories.length > 0 ? ` (${hit.advisories.join(", ")})` : "";
  return `${hit.reason}${ids}`;
}

export function blockedCount(list: BlockList): number {
  let count = 0;
  for (const rules of list.rules.values()) count += rules.blocked.length;
  return count;
}
