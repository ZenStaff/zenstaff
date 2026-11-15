// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalTimers:off - plain async code used by the advisories scanner outside the Effect runtime.
// Zen Staff: NVD (National Vulnerability Database) queries for tools OSV.dev does not cover:
// FFmpeg, Node.js and the Chromium builds of Playwright and Remotion. Catalog entries name CPE
// products (`nvd` in tools/*.json); the scanner asks the NVD 2.0 API for CVEs whose CPE match
// criteria cover that product version, then decides locally (version ranges in each CVE's
// configurations) whether our exact version is affected and which version fixes it.
// Rate limit: NVD allows 5 requests per 30 s without a key and 50 with one (`NVD_API_KEY`);
// we wait 6.5 s (0.7 s with a key) between requests and back off on 403/429/503.
import type { CatalogEntry } from "./catalog.ts";
import type { OsvQuery, OsvVulnSummary, ScanFinding } from "./osvScanner.ts";
import { compareVersions, isValidVersion } from "./versions.ts";

const NVD_API = "https://services.nvd.nist.gov/rest/json/cves/2.0";

export interface NvdQuery extends OsvQuery {
  readonly ecosystem: "NVD";
  /** CPE `cpe:2.3:part:vendor:product` prefix. */
  readonly name: string;
  readonly label: string;
}

/** One query per (tool version, NVD product); `own` when the product version is the tool's. */
export function buildNvdQueries(entries: ReadonlyArray<CatalogEntry>): NvdQuery[] {
  const queries: NvdQuery[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const product of entry.nvd ?? []) {
      for (const toolVersion of entry.versions.map((version) => version.version)) {
        const mapped = product.versions?.[toolVersion];
        if (product.versions !== undefined && mapped === undefined) continue;
        const version = mapped ?? toolVersion;
        const key = `${entry.id}@${toolVersion} ${product.cpe}@${version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queries.push({
          toolId: entry.id,
          toolVersion,
          ecosystem: "NVD",
          name: product.cpe,
          version,
          own: mapped === undefined,
          label: product.label ?? entry.name,
        });
      }
    }
  }
  return queries;
}

/** The NVD `virtualMatchString` for one product version. */
export function nvdMatchString(query: Pick<NvdQuery, "name" | "version">): string {
  return `${query.name}:${query.version}:*:*:*:*:*:*:*`;
}

interface NvdCpeMatch {
  readonly vulnerable?: boolean;
  readonly criteria?: string;
  readonly versionStartIncluding?: string;
  readonly versionStartExcluding?: string;
  readonly versionEndIncluding?: string;
  readonly versionEndExcluding?: string;
}

interface NvdNode {
  readonly cpeMatch?: ReadonlyArray<NvdCpeMatch>;
  readonly nodes?: ReadonlyArray<NvdNode>;
}

interface NvdCve {
  readonly id: string;
  readonly vulnStatus?: string;
  readonly descriptions?: ReadonlyArray<{ readonly lang?: string; readonly value?: string }>;
  readonly metrics?: Record<
    string,
    ReadonlyArray<{
      readonly type?: string;
      readonly baseSeverity?: string;
      readonly cvssData?: { readonly baseSeverity?: string };
    }>
  >;
  readonly configurations?: ReadonlyArray<{ readonly nodes?: ReadonlyArray<NvdNode> }>;
}

/** A dotted release number ("8.1.3", "156.0.8078.47"), not a date or a commit. */
export function isReleaseVersion(value: string): boolean {
  return isValidVersion(value) && !/^\d{4}-\d{2}/.test(value.trim());
}

/** Does one CPE match criterion cover `version` of `product` ("cpe:2.3:a:vendor:product")? */
export function cpeMatchCovers(match: NvdCpeMatch, product: string, version: string): boolean {
  if (match.vulnerable !== true || typeof match.criteria !== "string") return false;
  const parts = match.criteria.split(":");
  const [, , part, vendor, name, exact = "*"] = parts;
  if (`cpe:2.3:${part}:${vendor}:${name}`.toLowerCase() !== product.toLowerCase()) return false;
  if (exact !== "*" && exact !== "-") {
    // An exact version ("8.0") or a version with an update field ("8.0:rc1") in the criterion.
    const update = parts[6] ?? "*";
    return compareVersions(exact, version) === 0 && (update === "*" || update === "-");
  }
  const ranged =
    match.versionStartIncluding !== undefined ||
    match.versionStartExcluding !== undefined ||
    match.versionEndIncluding !== undefined ||
    match.versionEndExcluding !== undefined;
  // "every version" without bounds: NVD uses it for products with no fix yet.
  if (!ranged) return true;
  // Bounds that are not release versions (FFmpeg's "git-master before 2025-01-13") cannot be
  // compared with a release number; such criteria are skipped rather than guessed.
  const bounds = [
    match.versionStartIncluding,
    match.versionStartExcluding,
    match.versionEndIncluding,
    match.versionEndExcluding,
  ].filter((bound): bound is string => bound !== undefined);
  if (!bounds.every(isReleaseVersion)) return false;
  if (
    match.versionStartIncluding !== undefined &&
    compareVersions(version, match.versionStartIncluding) < 0
  )
    return false;
  if (
    match.versionStartExcluding !== undefined &&
    compareVersions(version, match.versionStartExcluding) <= 0
  )
    return false;
  if (
    match.versionEndIncluding !== undefined &&
    compareVersions(version, match.versionEndIncluding) > 0
  )
    return false;
  if (
    match.versionEndExcluding !== undefined &&
    compareVersions(version, match.versionEndExcluding) >= 0
  )
    return false;
  return true;
}

function matchesIn(nodes: ReadonlyArray<NvdNode> | undefined): NvdCpeMatch[] {
  return (nodes ?? []).flatMap((node) => [...(node.cpeMatch ?? []), ...matchesIn(node.nodes)]);
}

const SEVERITY_ORDER = ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"];

function severityOf(cve: NvdCve): OsvVulnSummary["severity"] {
  for (const key of SEVERITY_ORDER) {
    const metrics = cve.metrics?.[key] ?? [];
    const primary = metrics.find((metric) => metric.type === "Primary") ?? metrics[0];
    const raw = (primary?.cvssData?.baseSeverity ?? primary?.baseSeverity ?? "").toUpperCase();
    if (raw === "CRITICAL" || raw === "HIGH" || raw === "LOW") return raw;
    if (raw === "MEDIUM") return "MODERATE";
    if (raw === "NONE") return "LOW";
  }
  return "UNKNOWN";
}

/**
 * One CVE record for our product version: null when its configurations do not cover the version
 * (the API's virtual match is broader than ours) or it was rejected; else the summary with the
 * fixing versions of the ranges that contain our version.
 */
export function parseNvdCve(
  record: unknown,
  product: string,
  version: string,
): OsvVulnSummary | null {
  const cve = ((record as { cve?: NvdCve }).cve ?? record) as NvdCve;
  if (typeof cve.id !== "string") return null;
  if ((cve.vulnStatus ?? "").toLowerCase() === "rejected") return null;
  const covering = (cve.configurations ?? [])
    .flatMap((configuration) => matchesIn(configuration.nodes))
    .filter((match) => cpeMatchCovers(match, product, version));
  if (covering.length === 0) return null;
  const description =
    cve.descriptions?.find((entry) => entry.lang === "en")?.value ??
    cve.descriptions?.[0]?.value ??
    "";
  const fixed = [...new Set(covering.flatMap((match) => match.versionEndExcluding ?? []))].toSorted(
    compareVersions,
  );
  return {
    id: cve.id,
    summary: description.split("\n")[0]!.slice(0, 160),
    severity: severityOf(cve),
    fixed,
  };
}

export interface NvdFetchOptions {
  readonly apiKey?: string | undefined;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Pause between requests; default 6500 ms without a key, 700 ms with one. */
  readonly delayMs?: number;
  readonly log?: (line: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** A polite NVD client: one request at a time, a pause between them, backoff on throttling. */
export function makeNvdClient(options: NvdFetchOptions = {}) {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const delay = options.delayMs ?? (options.apiKey ? 700 : 6500);
  let last = 0;
  const get = async (url: string): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + delay - Date.now();
      if (last > 0 && wait > 0) await sleep(wait);
      last = Date.now();
      const response = await doFetch(url, {
        headers: {
          ...(options.apiKey ? { apiKey: options.apiKey } : {}),
          "user-agent": "zen-staff-advisories (+https://zed-zen.com)",
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) return response.json();
      if ([403, 429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
        options.log?.(`nvd: HTTP ${response.status}, retrying`);
        await sleep(delay * 2 ** (attempt + 1));
        continue;
      }
      throw new Error(`NVD ${url}: HTTP ${response.status}`);
    }
  };
  /** Every CVE whose match criteria cover `query` (all pages). */
  const cvesFor = async (query: Pick<NvdQuery, "name" | "version">): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (let start = 0; ;) {
      const url = `${NVD_API}?virtualMatchString=${encodeURIComponent(nvdMatchString(query))}&resultsPerPage=2000&startIndex=${start}`;
      const page = (await get(url)) as {
        totalResults?: number;
        resultsPerPage?: number;
        vulnerabilities?: unknown[];
      };
      const items = page.vulnerabilities ?? [];
      out.push(...items);
      start += items.length;
      if (items.length === 0 || start >= (page.totalResults ?? 0)) return out;
    }
  };
  return { cvesFor };
}

/** Findings for every NVD product of the catalog, in the scanner's format. */
export async function scanNvd(
  entries: ReadonlyArray<CatalogEntry>,
  options: NvdFetchOptions = {},
): Promise<{ readonly findings: ScanFinding[]; readonly queries: number; readonly cves: number }> {
  const client = makeNvdClient(options);
  const queries = buildNvdQueries(entries);
  const byMatch = new Map<string, unknown[]>();
  const findings: ScanFinding[] = [];
  let cves = 0;
  for (const query of queries) {
    const key = nvdMatchString(query);
    let records = byMatch.get(key);
    if (records === undefined) {
      records = await client.cvesFor(query);
      byMatch.set(key, records);
      cves += records.length;
      options.log?.(`nvd: ${query.label} ${query.version}: ${records.length} candidate CVEs`);
    }
    const vulns = records.flatMap((record) => {
      const parsed = parseNvdCve(record, query.name, query.version);
      return parsed ? [parsed] : [];
    });
    findings.push({ query, vulns });
  }
  return { findings, queries: queries.length, cves };
}
