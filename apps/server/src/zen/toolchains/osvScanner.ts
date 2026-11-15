// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - plain async code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: the advisories scanner (night ops / hub). Queries OSV.dev for every catalog tool
// version and every package pinned in its lockfiles, plus NVD for the CPE products OSV does not
// cover (nvdScanner.ts), and writes advisories.json:
//   node apps/server/src/zen/toolchains/osvScanner.ts --out <file> [--block-moderate] [--no-nvd]
// NVD_API_KEY (optional) raises NVD's rate limit.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ZenAdvisoryFile, ZenBlockedVersion } from "@t3tools/contracts/zenToolchains";

import { parseCatalogEntry, type CatalogEntry } from "./catalog.ts";
import { scanNvd } from "./nvdScanner.ts";
import { compareVersions } from "./versions.ts";

export interface OsvQuery {
  readonly toolId: string;
  readonly toolVersion: string;
  readonly ecosystem: string;
  readonly name: string;
  readonly version: string;
  /** The tool's own package (its versions are the tool's versions). */
  readonly own: boolean;
  /** Plain name for reasons ("Chrome headless shell"); defaults to `name`. */
  readonly label?: string;
}

export interface OsvVulnSummary {
  readonly id: string;
  readonly summary: string;
  readonly severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  /** "fixed" versions for the queried package. */
  readonly fixed: ReadonlyArray<string>;
}

/** Packages pinned in an npm v2/v3 lockfile. */
export function lockfilePackages(lockText: string): Array<{ name: string; version: string }> {
  const lock = JSON.parse(lockText) as {
    packages?: Record<string, { version?: string; optional?: boolean }>;
  };
  const out: Array<{ name: string; version: string }> = [];
  for (const [key, value] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith("node_modules/") || !value.version) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    out.push({ name, version: value.version });
  }
  return out;
}

/** Packages pinned in a `uv pip compile --generate-hashes` requirements file. */
export function requirementsPackages(text: string): Array<{ name: string; version: string }> {
  const out: Array<{ name: string; version: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9._-]+)==([^\s;\\]+)/.exec(line.trim());
    if (match) out.push({ name: match[1]!.toLowerCase(), version: match[2]! });
  }
  return out;
}

export function buildOsvQueries(
  entries: ReadonlyArray<CatalogEntry>,
  readCatalogFile: (relative: string) => string | null,
): OsvQuery[] {
  const queries: OsvQuery[] = [];
  const seen = new Set<string>();
  const add = (query: OsvQuery) => {
    const key = `${query.toolId}@${query.toolVersion} ${query.ecosystem}:${query.name}@${query.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(query);
  };
  for (const entry of entries) {
    for (const version of entry.versions) {
      for (const pkg of entry.osv ?? []) {
        add({
          toolId: entry.id,
          toolVersion: version.version,
          ...pkg,
          version: version.version,
          own: true,
        });
      }
      for (const recipe of version.recipes) {
        for (const step of recipe.steps) {
          if (step.type === "npm") {
            const lock = readCatalogFile(NodePath.join(step.lockfileDir, "package-lock.json"));
            for (const pkg of lock ? lockfilePackages(lock) : []) {
              add({
                toolId: entry.id,
                toolVersion: version.version,
                ecosystem: "npm",
                ...pkg,
                own: false,
              });
            }
          }
          if (step.type === "pip") {
            const text = readCatalogFile(step.requirements);
            for (const pkg of text ? requirementsPackages(text) : []) {
              add({
                toolId: entry.id,
                toolVersion: version.version,
                ecosystem: "PyPI",
                ...pkg,
                own: false,
              });
            }
          }
        }
      }
    }
  }
  return queries;
}

/** Vulnerability ids per query from a /v1/querybatch response (same order as the queries). */
export function parseOsvBatch(response: unknown, count: number): string[][] {
  const results =
    (response as { results?: Array<{ vulns?: Array<{ id?: string }> }> }).results ?? [];
  return Array.from({ length: count }, (_, index) =>
    (results[index]?.vulns ?? []).flatMap((vuln) => (typeof vuln.id === "string" ? [vuln.id] : [])),
  );
}

const SEVERITIES = ["CRITICAL", "HIGH", "MODERATE", "LOW"] as const;

/** Severity and fixed versions of one /v1/vulns/{id} record, for one package. */
export function parseOsvVuln(record: unknown, ecosystem: string, name: string): OsvVulnSummary {
  const vuln = record as {
    id: string;
    summary?: string;
    details?: string;
    database_specific?: { severity?: string };
    affected?: Array<{
      package?: { ecosystem?: string; name?: string };
      ranges?: Array<{ events?: Array<{ fixed?: string }> }>;
      ecosystem_specific?: { severity?: string };
    }>;
  };
  const raw = (vuln.database_specific?.severity ?? "").toUpperCase();
  const severity = (SEVERITIES as ReadonlyArray<string>).includes(raw)
    ? (raw as OsvVulnSummary["severity"])
    : raw === "MEDIUM"
      ? "MODERATE"
      : "UNKNOWN";
  const fixed = (vuln.affected ?? [])
    .filter(
      (affected) =>
        affected.package?.ecosystem?.toLowerCase() === ecosystem.toLowerCase() &&
        affected.package?.name?.toLowerCase() === name.toLowerCase(),
    )
    .flatMap((affected) => affected.ranges ?? [])
    .flatMap((range) => range.events ?? [])
    .flatMap((event) => (event.fixed ? [event.fixed] : []));
  return {
    id: vuln.id,
    summary: (vuln.summary ?? vuln.details ?? "").split("\n")[0]!.slice(0, 160),
    severity,
    fixed,
  };
}

export interface ScanFinding {
  readonly query: OsvQuery;
  readonly vulns: ReadonlyArray<OsvVulnSummary>;
}

/** The advisories file: a tool version is blocked when any blocking advisory hits it. */
export function buildAdvisoryFile(
  findings: ReadonlyArray<ScanFinding>,
  options: { readonly now: string; readonly blockModerate?: boolean; readonly source?: string },
): ZenAdvisoryFile {
  const blocking = new Set(
    options.blockModerate
      ? ["CRITICAL", "HIGH", "UNKNOWN", "MODERATE"]
      : ["CRITICAL", "HIGH", "UNKNOWN"],
  );
  const tools: Record<string, { minSafeVersion?: string; blockedVersions: ZenBlockedVersion[] }> =
    {};
  for (const finding of findings) {
    const hits = finding.vulns.filter((vuln) => blocking.has(vuln.severity));
    if (hits.length === 0) continue;
    const { toolId, toolVersion } = finding.query;
    const tool = (tools[toolId] ??= { blockedVersions: [] });
    const where = finding.query.own
      ? ""
      : finding.query.label !== undefined
        ? ` in ${finding.query.label} ${finding.query.version}`
        : ` in ${finding.query.name}@${finding.query.version}`;
    const existing = tool.blockedVersions.find((blocked) => blocked.version === toolVersion);
    const ids = hits.map((vuln) => vuln.id);
    if (existing) {
      (existing.advisories as string[]).push(
        ...ids.filter((id) => !existing.advisories?.includes(id)),
      );
    } else {
      tool.blockedVersions.push({
        version: toolVersion,
        reason: `Known security problem${hits.length > 1 ? "s" : ""}${where}: ${hits[0]!.summary || hits[0]!.id}`,
        advisories: ids,
      });
    }
    if (finding.query.own) {
      for (const fixed of hits.flatMap((vuln) => vuln.fixed)) {
        if (tool.minSafeVersion === undefined || compareVersions(fixed, tool.minSafeVersion) > 0) {
          tool.minSafeVersion = fixed;
        }
      }
    }
  }
  return { version: 1, generatedAt: options.now, source: options.source ?? "osv.dev", tools };
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export interface ScanOptions {
  readonly blockModerate?: boolean;
  /** Also query NVD for the catalog's CPE products (default true). */
  readonly nvd?: boolean;
  readonly nvdApiKey?: string | undefined;
  readonly log?: (line: string) => void;
}

export async function scanCatalog(
  catalogDir: string,
  options: ScanOptions = {},
): Promise<{
  readonly file: ZenAdvisoryFile;
  readonly queries: number;
  readonly vulns: number;
  readonly nvdQueries: number;
  readonly nvdCves: number;
}> {
  const toolsDir = NodePath.join(catalogDir, "tools");
  const entries = NodeFS.readdirSync(toolsDir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const parsed = parseCatalogEntry(NodeFS.readFileSync(NodePath.join(toolsDir, name), "utf8"));
      return "entry" in parsed ? [parsed.entry] : [];
    });
  const queries = buildOsvQueries(entries, (relative) => {
    try {
      return NodeFS.readFileSync(NodePath.join(catalogDir, relative), "utf8");
    } catch {
      return null;
    }
  });
  const ids: string[][] = [];
  for (let start = 0; start < queries.length; start += 500) {
    const chunk = queries.slice(start, start + 500);
    const response = await postJson("https://api.osv.dev/v1/querybatch", {
      queries: chunk.map((query) => ({
        package: { ecosystem: query.ecosystem, name: query.name },
        version: query.version,
      })),
    });
    ids.push(...parseOsvBatch(response, chunk.length));
  }
  const records = new Map<string, unknown>();
  for (const id of new Set(ids.flat())) {
    const response = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) records.set(id, await response.json());
  }
  const findings: ScanFinding[] = queries.map((query, index) => ({
    query,
    vulns: (ids[index] ?? []).flatMap((id) =>
      records.has(id) ? [parseOsvVuln(records.get(id), query.ecosystem, query.name)] : [],
    ),
  }));
  const nvd =
    options.nvd === false
      ? { findings: [], queries: 0, cves: 0 }
      : await scanNvd(entries, {
          apiKey: options.nvdApiKey,
          ...(options.log ? { log: options.log } : {}),
        });
  return {
    file: buildAdvisoryFile([...findings, ...nvd.findings], {
      now: new Date().toISOString(),
      ...(options.blockModerate !== undefined ? { blockModerate: options.blockModerate } : {}),
      source: options.nvd === false ? "osv.dev" : "osv.dev+nvd",
    }),
    queries: queries.length,
    vulns: records.size,
    nvdQueries: nvd.queries,
    nvdCves: nvd.cves,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const catalogDir = NodePath.join(import.meta.dirname, "catalog");
  scanCatalog(catalogDir, {
    blockModerate: args.includes("--block-moderate"),
    nvd: !args.includes("--no-nvd"),
    nvdApiKey: process.env.NVD_API_KEY || undefined,
    log: (line) => process.stderr.write(`${line}\n`),
  })
    .then(({ file, queries, vulns, nvdQueries, nvdCves }) => {
      const text = `${JSON.stringify(file, null, 2)}\n`;
      if (out) {
        // Write next to the target, then rename: readers never see a half-written file.
        const temp = `${out}.tmp-${process.pid}`;
        NodeFS.writeFileSync(temp, text);
        NodeFS.renameSync(temp, out);
      } else process.stdout.write(text);
      process.stderr.write(
        `osv: ${queries} queries, ${vulns} advisories read; nvd: ${nvdQueries} queries, ${nvdCves} candidate CVEs; ${Object.keys(file.tools).length} tools with blocked versions\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`osv scan failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
