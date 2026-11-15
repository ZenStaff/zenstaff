// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - tests of the plain async NVD client.
import type { ZenToolCatalogEntry } from "@t3tools/contracts/zenToolchains";
import { describe, expect, it } from "vite-plus/test";

import {
  buildNvdQueries,
  cpeMatchCovers,
  isReleaseVersion,
  makeNvdClient,
  nvdMatchString,
  parseNvdCve,
  scanNvd,
} from "./nvdScanner.ts";
import { buildAdvisoryFile } from "./osvScanner.ts";

const FFMPEG = "cpe:2.3:a:ffmpeg:ffmpeg";
const CHROME = "cpe:2.3:a:google:chrome";

const entry = (id: string, versions: string[], nvd: ZenToolCatalogEntry["nvd"]) =>
  ({
    id,
    name: id,
    description: "",
    homepage: "https://example.com",
    kind: "binary",
    license: { spdx: "MIT", url: "https://example.com", commercialUse: "free", note: "" },
    untrustedInput: true,
    verify: { bin: id, args: [], expect: "" },
    nvd,
    versions: versions.map((version) => ({ version, released: "2026-01-01", recipes: [] })),
  }) as unknown as ZenToolCatalogEntry;

const cve = (
  id: string,
  matches: ReadonlyArray<Record<string, unknown>>,
  severity = "HIGH",
  extra: Record<string, unknown> = {},
) => ({
  cve: {
    id,
    vulnStatus: "Analyzed",
    descriptions: [{ lang: "en", value: `${id} description\nmore` }],
    metrics: { cvssMetricV31: [{ type: "Primary", cvssData: { baseSeverity: severity } }] },
    configurations: [
      {
        nodes: [
          {
            operator: "AND",
            nodes: [{ cpeMatch: matches.map((match) => ({ vulnerable: true, ...match })) }],
          },
        ],
      },
    ],
    ...extra,
  },
});

describe("NVD scanner", () => {
  it("builds one query per tool version and product, mapping bundled component versions", () => {
    const queries = buildNvdQueries([
      entry("ffmpeg", ["8.1.3", "6.1.1"], [{ cpe: FFMPEG, label: "FFmpeg" }]),
      entry(
        "playwright",
        ["1.64.1", "1.60.0"],
        [{ cpe: CHROME, label: "Chrome", versions: { "1.64.1": "156.0.8078.4" } }],
      ),
      entry("pandoc", ["3.12.1"], undefined),
    ]);
    expect(
      queries.map((query) => [query.toolId, query.toolVersion, query.version, query.own]),
    ).toEqual([
      ["ffmpeg", "8.1.3", "8.1.3", true],
      ["ffmpeg", "6.1.1", "6.1.1", true],
      // 1.60.0 has no mapped Chrome version, so it is not guessed.
      ["playwright", "1.64.1", "156.0.8078.4", false],
    ]);
    expect(nvdMatchString(queries[2]!)).toBe("cpe:2.3:a:google:chrome:156.0.8078.4:*:*:*:*:*:*:*");
  });

  it("decides coverage from the CVE's own ranges, not the API's broad match", () => {
    const range = {
      vulnerable: true,
      criteria: `${CHROME}:*:*:*:*:*:*:*:*`,
      versionEndExcluding: "156.0.8078.47",
    };
    expect(cpeMatchCovers(range, CHROME, "156.0.8078.4")).toBe(true);
    expect(cpeMatchCovers(range, CHROME, "156.0.8078.47")).toBe(false);
    expect(cpeMatchCovers({ ...range, vulnerable: false }, CHROME, "1.0")).toBe(false);
    // Another product in the same configuration (an OS) is ignored.
    expect(
      cpeMatchCovers(
        { vulnerable: true, criteria: "cpe:2.3:o:microsoft:windows:-:*:*:*:*:*:*:*" },
        CHROME,
        "1",
      ),
    ).toBe(false);
    const exact = { vulnerable: true, criteria: `${FFMPEG}:6.1.1:*:*:*:*:*:*:*` };
    expect(cpeMatchCovers(exact, FFMPEG, "6.1.1")).toBe(true);
    expect(cpeMatchCovers(exact, FFMPEG, "8.1.3")).toBe(false);
    const bounded = {
      vulnerable: true,
      criteria: `${FFMPEG}:*:*:*:*:*:*:*:*`,
      versionStartIncluding: "7.0",
      versionEndIncluding: "7.1.1",
    };
    expect(cpeMatchCovers(bounded, FFMPEG, "6.1.1")).toBe(false);
    expect(cpeMatchCovers(bounded, FFMPEG, "7.1.1")).toBe(true);
    // FFmpeg "git-master before 2025-01-13" is not a release bound: skipped, never a false hit.
    const dated = {
      vulnerable: true,
      criteria: `${FFMPEG}:*:*:*:*:*:*:*:*`,
      versionEndExcluding: "2025-01-13",
    };
    expect(cpeMatchCovers(dated, FFMPEG, "8.1.3")).toBe(false);
    expect(isReleaseVersion("156.0.8078.47")).toBe(true);
    expect(isReleaseVersion("2025-01-13")).toBe(false);
  });

  it("parses severity, the fixing version of the matching range, and drops rejected CVEs", () => {
    const record = cve("CVE-2026-1", [
      {
        criteria: `${FFMPEG}:*:*:*:*:*:*:*:*`,
        versionStartIncluding: "8.0",
        versionEndExcluding: "8.1.4",
      },
      // A range for an older branch does not contribute its fix.
      {
        criteria: `${FFMPEG}:*:*:*:*:*:*:*:*`,
        versionStartIncluding: "6.0",
        versionEndExcluding: "6.1.2",
      },
    ]);
    expect(parseNvdCve(record, FFMPEG, "8.1.3")).toEqual({
      id: "CVE-2026-1",
      summary: "CVE-2026-1 description",
      severity: "HIGH",
      fixed: ["8.1.4"],
    });
    expect(parseNvdCve(record, FFMPEG, "8.1.4")).toBeNull();
    expect(
      parseNvdCve(
        cve("CVE-2026-2", [{ criteria: `${FFMPEG}:8.1.3:*:*:*:*:*:*:*` }], "MEDIUM"),
        FFMPEG,
        "8.1.3",
      )?.severity,
    ).toBe("MODERATE");
    expect(
      parseNvdCve(
        cve("CVE-2026-3", [{ criteria: `${FFMPEG}:8.1.3:*:*:*:*:*:*:*` }], "HIGH", {
          vulnStatus: "Rejected",
        }),
        FFMPEG,
        "8.1.3",
      ),
    ).toBeNull();
    const noMetrics = cve("CVE-2026-4", [{ criteria: `${FFMPEG}:8.1.3:*:*:*:*:*:*:*` }], "HIGH", {
      metrics: {},
    });
    expect(parseNvdCve(noMetrics, FFMPEG, "8.1.3")?.severity).toBe("UNKNOWN");
  });

  it("is polite: pauses between requests, backs off on 403/429 and reads every page", async () => {
    const sleeps: number[] = [];
    const urls: string[] = [];
    let calls = 0;
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      calls++;
      if (calls === 1) return new Response("slow down", { status: 403 });
      const start = Number(new URL(url).searchParams.get("startIndex"));
      const body = {
        totalResults: 3,
        vulnerabilities: start === 0 ? [cve("CVE-A", []), cve("CVE-B", [])] : [cve("CVE-C", [])],
      };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const client = makeNvdClient({
      fetch: fakeFetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      delayMs: 6500,
    });
    const records = await client.cvesFor({ name: FFMPEG, version: "8.1.3" });
    expect(records).toHaveLength(3);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("virtualMatchString=cpe%3A2.3%3Aa%3Affmpeg%3Affmpeg%3A8.1.3");
    expect(urls[2]).toContain("startIndex=2");
    // A backoff after the 403, and a pause before every later request.
    expect(sleeps[0]).toBe(13_000);
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
  });

  it("turns NVD findings into blocked versions with a plain reason and a safe minimum", async () => {
    const fakeFetch = (async (url: string) => {
      const match = new URL(url).searchParams.get("virtualMatchString") ?? "";
      const vulnerabilities = match.startsWith(FFMPEG)
        ? [
            cve(
              "CVE-2026-9",
              [{ criteria: `${FFMPEG}:*:*:*:*:*:*:*:*`, versionEndExcluding: "8.1.4" }],
              "CRITICAL",
            ),
          ]
        : [
            cve("CVE-2026-8", [
              { criteria: `${CHROME}:*:*:*:*:*:*:*:*`, versionEndExcluding: "156.0.8078.47" },
            ]),
          ];
      return new Response(
        JSON.stringify({ totalResults: vulnerabilities.length, vulnerabilities }),
      );
    }) as unknown as typeof fetch;
    const scan = await scanNvd(
      [
        entry("ffmpeg", ["8.1.3"], [{ cpe: FFMPEG, label: "FFmpeg" }]),
        entry(
          "playwright",
          ["1.64.1"],
          [{ cpe: CHROME, label: "Chrome headless shell", versions: { "1.64.1": "156.0.8078.4" } }],
        ),
      ],
      { fetch: fakeFetch, sleep: async () => {}, delayMs: 0 },
    );
    expect(scan.queries).toBe(2);
    const file = buildAdvisoryFile(scan.findings, {
      now: "2026-11-08T00:00:00.000Z",
      source: "osv.dev+nvd",
    });
    expect(file.tools.ffmpeg).toEqual({
      minSafeVersion: "8.1.4",
      blockedVersions: [
        {
          version: "8.1.3",
          reason: "Known security problem: CVE-2026-9 description",
          advisories: ["CVE-2026-9"],
        },
      ],
    });
    // A bundled component blocks the tool version but never raises the tool's own minimum.
    expect(file.tools.playwright?.minSafeVersion).toBeUndefined();
    expect(file.tools.playwright?.blockedVersions[0]?.reason).toBe(
      "Known security problem in Chrome headless shell 156.0.8078.4: CVE-2026-8 description",
    );
  });
});
