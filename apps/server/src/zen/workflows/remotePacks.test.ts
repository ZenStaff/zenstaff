// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Plain tests that load the remote packs' scripts from disk and serve local fixture sites.
// The remote packs (client-radar, outreach-approved, competitor-radar) ship through the remote
// registry, not inside the app. These tests: every pack validates and installs from a local
// remote index; the public-web rules (robots.txt, terms, 2 per site, backoff, sources, B2B only)
// hold as code; the outreach books never release a batch without an approval; and an offline end
// to end run against fixture sites on 127.0.0.1 skips the page robots.txt disallows, the site whose
// terms forbid scraping, the site whose robots.txt is down and the one with a CAPTCHA.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { parseCatalogEntry } from "../toolchains/catalog.ts";
import { parseRequires, parseUnattended } from "../toolchains/workflowRequirements.ts";
import { writeTarGz } from "./devRegistry/tarGz.ts";
import { sha256Hex } from "./remoteRegistry.ts";
import { loadWorkflowDir, parseRegistry } from "./workflowStore.ts";
import * as ZenOffice from "./ZenOffice.ts";
import { privateNamesPattern } from "./privateNames.test-support.ts";

const here = import.meta.dirname;
const remote = NodePath.join(here, "remote-packs");
const PACKS = ["client-radar", "outreach-approved", "competitor-radar"] as const;
const SCRIPT = {
  "client-radar": "radar.mjs",
  "outreach-approved": "outreach.mjs",
  "competitor-radar": "competitors.mjs",
} as const;

/** The packs are plain JS modules; their exports are read as loosely typed values. */
type Module = Record<string, any>;
const load = async (pack: string, file: string): Promise<Module> =>
  (await import(NodePath.join(remote, pack, file))) as Module;

const read = (...parts: string[]) => NodeFS.readFileSync(NodePath.join(remote, ...parts), "utf8");
const tmp = (prefix: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));

/** Runs a pack script in a child process (async, so the fixture servers in this process can answer). */
function run(
  pack: keyof typeof SCRIPT,
  args: ReadonlyArray<string>,
  cwd: string,
  env: Record<string, string> = {},
) {
  return new Promise<{ code: number | null; out: string; err: string; json: Module | null }>(
    (resolve) => {
      NodeChildProcess.execFile(
        process.execPath,
        [NodePath.join(remote, pack, SCRIPT[pack]), ...args],
        {
          cwd,
          encoding: "utf8",
          env: { ...process.env, ZEN_CRAWLEE_MODULES: "", GOOGLE_PLACES_API_KEY: "", ...env },
          timeout: 60000,
        },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
          resolve({ code, out: stdout, err: stderr, json: safeJson(stdout) });
        },
      );
    },
  );
}
const safeJson = (text: string) => {
  try {
    return JSON.parse(text) as Module;
  } catch {
    return null;
  }
};

describe("remote packs: manifests", () => {
  it.effect("every pack loads as a workflow, with valid requires and a translated manifest", () =>
    Effect.gen(function* () {
      const loaded = yield* loadWorkflowDir(remote, "user");
      expect(loaded.problems).toEqual([]);
      expect(loaded.workflows.map((item) => item.manifest.id).toSorted()).toEqual(
        [...PACKS].toSorted(),
      );
      const companySpecific = new RegExp(
        `horecaos|zed-?zen|meniul ?zilei|\\/root\\/|${privateNamesPattern().source}`,
        "i",
      );
      const endings = [
        "Answer the person in their language and write the documents in it too",
        "give one line on what it holds and its full absolute path",
        "embed it in the reply as `![short title](/absolute/path/to/file.ext)`",
      ];
      for (const item of loaded.workflows) {
        const { manifest } = item;
        const ro = manifest.i18n?.ro;
        expect(ro?.name && ro.description && ro.output, manifest.id).toBeTruthy();
        for (const input of manifest.inputs) {
          expect(ro?.inputs?.[input.id]?.label, `${manifest.id}.${input.id}`).toBeTruthy();
          if (input.options)
            expect(ro?.inputs?.[input.id]?.options?.length).toBe(input.options.length);
        }
        for (const line of endings) expect(item.prompt.slice(-900), manifest.id).toContain(line);
        for (const text of [
          item.prompt,
          item.skill ?? "",
          JSON.stringify({ ...manifest, author: "" }),
        ]) {
          expect(text, manifest.id).not.toMatch(companySpecific);
          expect(text, manifest.id).not.toMatch(/[şţŞŢ]/); // comma-below ș ț only
        }
        const json = read(manifest.id, "workflow.json");
        const requires = parseRequires(json);
        expect(requires.problem ?? null, manifest.id).toBeNull();
        expect(requires.requires?.tools?.some((tool) => tool.id === "node")).toBe(true);
        const unattended = parseUnattended(json);
        expect(unattended.problems ?? [], manifest.id).toEqual([]);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("the shared rules block, web-rules.mjs and tables.mjs are identical in every pack", () => {
    const block = (text: string) =>
      /<!-- public-web-rules:start -->[\s\S]*<!-- public-web-rules:end -->/.exec(text)?.[0];
    const blocks = PACKS.map((pack) => block(read(pack, "SKILL.md")));
    expect(blocks[0]).toBeTruthy();
    for (const other of blocks) expect(other).toBe(blocks[0]);
    for (const rule of [
      "robots.txt",
      "terms",
      "2 requests at a time",
      "CAPTCHA",
      "B2B",
      "source",
      "Nothing invented",
    ]) {
      expect(blocks[0]).toContain(rule);
    }
    const rules = PACKS.map((pack) => read(pack, "web-rules.mjs"));
    for (const copy of rules) expect(copy).toBe(rules[0]);
    const tables = NodeFS.readFileSync(
      NodePath.join(here, "packs", "horeca-kit", "food-cost-pricing", "tables.mjs"),
      "utf8",
    );
    expect(read("client-radar", "tables.mjs")).toBe(tables);
    expect(read("outreach-approved", "tables.mjs")).toBe(tables);
  });

  it("no script uses stealth browsers, fingerprint tricks, CAPTCHA solvers or proxies", () => {
    const forbidden =
      /(camoufox|puppeteer-extra|playwright-extra|stealth|undetected|fingerprint-(injector|generator)|2captcha|anti-?captcha|capsolver|proxy-?chain|proxyUrl|useHeaderGenerator:\s*true)/i;
    for (const pack of PACKS) {
      for (const name of NodeFS.readdirSync(NodePath.join(remote, pack)).filter((file) =>
        file.endsWith(".mjs"),
      )) {
        const text = read(pack, name).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        expect(text, `${pack}/${name}`).not.toMatch(forbidden);
      }
    }
  });

  it("outreach never sends unattended and says why there is no WhatsApp or SMS", () => {
    const json = JSON.parse(read("outreach-approved", "workflow.json"));
    expect(json.unattended.commands).toEqual(["node", "mkdir", "ls", "cat"]);
    expect(json.unattended.tools ?? []).toEqual([]);
    const skill = read("outreach-approved", "SKILL.md");
    expect(skill).toContain("Why e-mail only (no WhatsApp, no SMS)");
    expect(skill).toContain("staff_request_approval");
    expect(skill).toMatch(/A scheduled \(unattended\) run only prepares/);
  });

  it("the packs stay out of the app bundle and the bundled registry; the remote index matches", () => {
    const embedded = NodeFS.readFileSync(NodePath.join(here, "embeddedAssets.gen.ts"), "utf8");
    expect(embedded).not.toContain('"remote-packs/');
    for (const pack of PACKS) expect(embedded).not.toContain(`"packs/${pack}/`);
    const bundled = parseRegistry(
      NodeFS.readFileSync(NodePath.join(here, "registry.json"), "utf8"),
    );
    if ("error" in bundled) throw new Error(bundled.error);
    for (const pack of PACKS)
      expect(bundled.entries.some((entry) => entry.id === pack)).toBe(false);
    const index = parseRegistry(read("index.json"));
    if ("error" in index) throw new Error(index.error);
    for (const pack of PACKS) {
      const entry = index.entries.find((item) => item.id === pack);
      const manifest = JSON.parse(read(pack, "workflow.json"));
      expect(entry, pack).toBeDefined();
      expect([
        entry?.name,
        entry?.description,
        entry?.version,
        entry?.icon,
        entry?.category,
      ]).toEqual([
        manifest.name,
        manifest.description,
        manifest.version,
        manifest.icon,
        manifest.category,
      ]);
      expect(entry?.i18n?.ro).toEqual({
        name: manifest.i18n.ro.name,
        description: manifest.i18n.ro.description,
      });
    }
  });

  it("Crawlee is in the tool catalog, pinned, Apache-2.0, installed from its lockfile", () => {
    const catalog = NodePath.join(here, "..", "toolchains", "catalog");
    const parsed = parseCatalogEntry(
      NodeFS.readFileSync(NodePath.join(catalog, "tools", "crawlee.json"), "utf8"),
    );
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.entry.license.spdx).toBe("Apache-2.0");
    expect(parsed.entry.versions.map((version) => version.version)).toEqual(["3.18.2"]);
    const lock = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(catalog, "npm", "crawlee-3.18.2", "package-lock.json"),
        "utf8",
      ),
    );
    expect(lock.packages["node_modules/@crawlee/cheerio"].version).toBe("3.18.2");
    for (const [name, info] of Object.entries(
      lock.packages as Record<string, { integrity?: string }>,
    )) {
      if (name) expect(info.integrity, name).toMatch(/^sha512-/);
    }
  });
});

describe("web rules", () => {
  it("parses robots.txt and obeys it (RFC 9309: longest match, Allow on ties, * and $)", async () => {
    const { parseRobots, robotsVerdict } = await load("client-radar", "web-rules.mjs");
    const robots = parseRobots(
      [
        "User-agent: Googlebot",
        "Disallow: /",
        "",
        "User-agent: *",
        "Disallow: /private",
        "Allow: /private/public-page",
        "Disallow: /*.pdf$",
        "Disallow: /search?",
        "Crawl-delay: 5",
        "Sitemap: https://example.test/sitemap.xml",
      ].join("\n"),
    );
    expect(robotsVerdict(robots, "/").allowed).toBe(true);
    expect(robotsVerdict(robots, "/private/x")).toMatchObject({
      allowed: false,
      rule: "Disallow: /private",
    });
    expect(robotsVerdict(robots, "/private/public-page").allowed).toBe(true);
    expect(robotsVerdict(robots, "/files/offer.pdf").allowed).toBe(false);
    expect(robotsVerdict(robots, "/files/offer.pdf?x=1").allowed).toBe(true);
    expect(robotsVerdict(robots, "/search?q=1").allowed).toBe(false);
    expect(robotsVerdict(robots, "/").crawlDelaySeconds).toBe(5);
    expect(robots.sitemaps).toEqual(["https://example.test/sitemap.xml"]);
    // A group naming our bot wins over *.
    const own = parseRobots("User-agent: *\nAllow: /\n\nUser-agent: ZenStaffBot\nDisallow: /\n");
    expect(robotsVerdict(own, "/anything").allowed).toBe(false);
    // An empty Disallow allows everything; no robots.txt allows everything.
    expect(robotsVerdict(parseRobots("User-agent: *\nDisallow:\n"), "/x").allowed).toBe(true);
    expect(robotsVerdict(parseRobots(""), "/x").allowed).toBe(true);
  });

  it("reads site terms that forbid automated access, in English and Romanian", async () => {
    const { termsVerdict, findTermsLinks } = await load("client-radar", "web-rules.mjs");
    expect(
      termsVerdict(
        "<p>Any scraping, crawling or automated access to this website is strictly prohibited.</p>",
      ).forbids,
    ).toBe(true);
    expect(
      termsVerdict("Este interzisă extragerea automată a datelor de pe acest site.").forbids,
    ).toBe(true);
    expect(
      termsVerdict(
        "Utilizatorii nu au dreptul să folosească roboți sau programe automate pentru a copia conținutul.",
      ).forbids,
    ).toBe(true);
    expect(
      termsVerdict("You may not use bots or data mining tools without our prior written consent.")
        .forbids,
    ).toBe(true);
    expect(
      termsVerdict("We use cookies. Robots like our pages. Contact us at office@example.test.")
        .forbids,
    ).toBe(false);
    expect(
      termsVerdict("Prețurile pot fi modificate. Comenzile automate de stoc sunt procesate zilnic.")
        .forbids,
    ).toBe(false);
    expect(
      findTermsLinks(
        '<a href="/termeni-si-conditii">Termeni</a><a href="https://other.test/terms">x</a><a href="/blog">Blog</a>',
        "https://site.test/",
      ),
    ).toEqual(["https://site.test/termeni-si-conditii"]);
  });

  it("keeps at most 2 requests at a time per site and pauses between them", async () => {
    const { DomainLimiter, politeDelay, MIN_DELAY_MS } = await load(
      "client-radar",
      "web-rules.mjs",
    );
    let clock = 0;
    const limiter = new DomainLimiter({
      maxPerDomain: 8,
      delayMs: 20,
      now: () => clock,
      wait: async (ms: number) => void (clock += ms),
    });
    expect(limiter.maxPerDomain).toBe(2);
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const releases: Array<() => void> = [];
    const task = () =>
      new Promise<void>((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        starts.push(clock);
        releases.push(() => {
          active -= 1;
          resolve();
        });
      });
    const flush = async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve();
    };
    const all = Promise.all(
      Array.from({ length: 6 }, () => limiter.run("http://127.0.0.1:9/x", task)),
    );
    for (let done = 0; done < 6; done++) {
      await flush();
      expect(active).toBeLessThanOrEqual(2);
      releases.shift()?.();
    }
    await all;
    expect(peak).toBe(2);
    expect(limiter.peak("127.0.0.1:9")).toBe(2);
    for (let i = 1; i < starts.length; i++)
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(20);
    // Other people's sites never get less than 2 s; Crawl-delay can only make it longer (max 30 s).
    expect(MIN_DELAY_MS).toBe(2000);
    expect(politeDelay("shop.example.test", 100)).toBe(2000);
    expect(politeDelay("127.0.0.1:8080", 100)).toBe(100);
    const other = new DomainLimiter({ delayMs: 10 });
    expect(other.delayFor("example.test")).toBe(2000);
    other.setDelay("example.test", 120000);
    expect(other.delayFor("example.test")).toBe(30000);
  });

  it("retries 429/5xx with backoff and Retry-After, never 403, and stops at a CAPTCHA", async () => {
    const { PublicWebGate, DomainLimiter, retryAfterMs, backoffMs, looksLikeChallenge, userAgent } =
      await load("client-radar", "web-rules.mjs");
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs("999")).toBe(60000);
    expect(backoffMs(0, 1000, () => 0)).toBe(1000);
    expect(backoffMs(3, 1000, () => 0)).toBe(8000);
    expect(looksLikeChallenge(200, '<form><div class="g-recaptcha"></div></form>')).toBe(false);
    expect(looksLikeChallenge(200, "<title>Just a moment...</title>")).toBe(true);
    expect(looksLikeChallenge(403, "please complete the captcha")).toBe(true);
    expect(userAgent("office@me.test")).toBe(
      "ZenStaffBot/1.0 (public business research for a Zen Staff user; contact: office@me.test)",
    );
    const waits: number[] = [];
    const calls: string[] = [];
    let flaky = 0;
    const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(url);
      expect(init.headers["User-Agent"]).toContain("ZenStaffBot/1.0");
      const path = new URL(url).pathname;
      const reply = (status: number, body = "", headers: Record<string, string> = {}) =>
        new Response(body, { status, headers });
      if (path === "/robots.txt") return reply(404);
      if (path === "/") return reply(200, "<html><body>home</body></html>");
      if (path === "/flaky")
        return ++flaky < 3 ? reply(503, "busy", { "retry-after": "1" }) : reply(200, "ok now");
      if (path === "/forbidden") return reply(403, "no");
      return reply(404);
    };
    const gate = new PublicWebGate({
      contact: "office@me.test",
      fetchImpl,
      limiter: new DomainLimiter({ delayMs: 0, wait: async () => undefined }),
      wait: async (ms: number) => void waits.push(ms),
    });
    const flakyPage = await gate.get("http://127.0.0.1:1/flaky");
    expect(flakyPage.status).toBe(200);
    expect(waits).toEqual([1000, 1000]);
    const refused = await gate.get("http://127.0.0.1:1/forbidden");
    expect(refused).toMatchObject({ skipped: true });
    expect(refused.reason).toContain("HTTP 403");
    expect(calls.filter((url) => url.endsWith("/forbidden"))).toHaveLength(1);
    // After a refusal the whole site is left alone.
    expect((await gate.get("http://127.0.0.1:1/")).skipped).toBe(true);
  });

  it("an unreachable robots.txt closes the site", async () => {
    const { PublicWebGate, DomainLimiter } = await load("client-radar", "web-rules.mjs");
    const gate = new PublicWebGate({
      contact: "x@y.test",
      fetchImpl: async () => new Response("down", { status: 500 }),
      limiter: new DomainLimiter({ delayMs: 0 }),
      retries: 0,
      checkTerms: false,
    });
    const verdict = await gate.check("http://127.0.0.1:2/page");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("robots.txt could not be read");
  });

  it("records a source and a date for every value, and refuses values without a source", async () => {
    const { sourced, unsourcedFields } = await load("client-radar", "web-rules.mjs");
    const field = sourced(
      "office@club.test",
      "https://club.test/contact",
      "2026-11-08T10:00:00.000Z",
    );
    expect(field).toEqual({
      v: "office@club.test",
      src: "https://club.test/contact",
      at: "2026-11-08T10:00:00.000Z",
    });
    expect(sourced("", "https://x.test")).toBeNull();
    expect(() => sourced("value", "")).toThrow(/source/);
    expect(
      unsourcedFields({
        name: field,
        email: { v: "a@b.test", src: "" },
        socials: { facebook: { v: "fb", src: "x", at: "" } },
      }),
    ).toEqual(["email", "socials.facebook"]);
  });

  it("keeps business contacts only (B2B): role and published business addresses, no private persons", async () => {
    const { b2bOnly, classifyEmail } = await load("client-radar", "web-rules.mjs");
    expect(classifyEmail("office@club.test")).toBe("role");
    expect(classifyEmail("Rezervari@restaurant.test")).toBe("role");
    expect(classifyEmail("ion.popescu@club.test")).toBe("person");
    expect(classifyEmail("maria_ionescu@gmail.com")).toBe("person");
    expect(classifyEmail("clubsportivnord@gmail.com")).toBe("business");
    expect(classifyEmail("andrei@studio.test", { firstNames: ["Andrei"] })).toBe("person");
    expect(classifyEmail("not an email")).toBe("invalid");
    const at = "2026-11-08T10:00:00.000Z";
    const { lead, dropped } = b2bOnly(
      {
        id: "a",
        name: { v: "Club Nord", src: "https://club.test/", at },
        website: { v: "https://club.test", src: "https://club.test/", at },
        email: { v: "clubsportivnord@gmail.com", src: "https://club.test/contact", at },
        phone: { v: "0712345678", src: "https://forum.other.test/thread", at },
        socials: {
          facebook: { v: "https://facebook.com/profile.php?id=1", src: "https://club.test/", at },
        },
        birthday: "1990-01-01",
      },
      { officialHosts: ["webservicesp.anaf.ro"] },
    );
    expect(lead.email.v).toBe("clubsportivnord@gmail.com"); // published on its own site
    expect(lead.phone).toBeUndefined(); // only on someone else's page
    expect(lead.socials.facebook).toBeUndefined(); // a personal profile
    expect(lead.birthday).toBeUndefined();
    expect(dropped.map((item: { field: string }) => item.field).toSorted()).toEqual([
      "birthday",
      "phone",
      "socials.facebook",
    ]);
    const person = b2bOnly({
      id: "b",
      email: { v: "ion.popescu@club.test", src: "https://club.test/", at },
      website: { v: "https://club.test", src: "https://club.test/", at },
    });
    expect(person.lead.email).toBeUndefined();
  });
});

describe("client radar logic", () => {
  it("scores A/B/C with reasons, dedupes against an existing list and maps OSM elements", async () => {
    const radar = await load("client-radar", "radar.mjs");
    const at = "2026-11-08T10:00:00.000Z";
    const s = (v: unknown, src = "https://x.test/") => ({ v, src, at });
    const a = radar.scoreLead({
      email: s("office@x.test"),
      opportunities: [{ text: "fără site", strength: "clear", src: "https://x.test/" }],
    });
    expect(a.score).toBe("A");
    expect(a.reasons).toEqual(["nevoie clară: fără site", "contact de firmă găsit"]);
    expect(
      radar.scoreLead({
        phone: s("0712345678"),
        opportunities: [{ text: "site vechi", strength: "clear" }],
      }).score,
    ).toBe("B");
    expect(radar.scoreLead({ email: s("office@x.test"), opportunities: [] }).score).toBe("C");
    expect(
      radar.scoreLead({
        email: s("office@x.test"),
        status: s("radiată"),
        opportunities: [{ text: "x", strength: "clear" }],
      }).score,
    ).toBe("C");
    expect(
      radar.scoreLead(
        { email: s("office@x.test"), opportunities: [{ text: "x", strength: "probable" }] },
        "en",
      ).reasons[0],
    ).toBe("probable need: x");

    const data = {
      meta: {},
      leads: [
        {
          id: "1",
          name: s("ACS Club Sportiv Nord"),
          city: s("Reghin"),
          website: s("https://www.clubnord.test"),
        },
        { id: "2", name: s("Club Sportiv Nord"), city: s("Reghin") },
        { id: "3", name: s("Pizzeria Sud SRL"), email: s("office@pizzasud.test") },
        { id: "4", name: s("Altceva"), cui: s("RO 14399840") },
      ] as Module[],
      skipped: [] as Module[],
    };
    const existing = radar.existingFromRows([
      ["Nume", "Email", "CUI"],
      ["Pizzeria Sud", "office@pizzasud.test", ""],
      ["", "", "14399840"],
    ]);
    const result = radar.dedupe(data, existing);
    expect(result).toEqual({ kept: 1, duplicates: 1, alreadyKnown: 2 });
    expect(data.leads[0]!.website.v).toBe("https://www.clubnord.test");

    const osm = radar.osmCandidate(
      {
        type: "node",
        id: 42,
        lat: 46.7,
        lon: 24.7,
        tags: {
          name: "Club Nord",
          leisure: "sports_centre",
          website: "https://clubnord.test",
          "addr:city": "Reghin",
          "contact:facebook": "https://facebook.com/clubnord",
        },
      },
      at,
    );
    expect(osm.name).toEqual({ v: "Club Nord", src: "https://www.openstreetmap.org/node/42", at });
    expect(osm.socials.facebook.src).toBe("https://www.openstreetmap.org/node/42");
    expect(radar.overpassQuery('Mureș"', ["leisure=sports_centre", "club"], 5000)).toBe(
      '[out:json][timeout:90];area["name"="Mureș"]["boundary"="administrative"]->.a;(nwr["leisure"="sports_centre"]["name"](area.a);nwr["club"]["name"](area.a););out center tags 2000;',
    );
    const anaf = radar.anafFields(
      {
        date_generale: {
          cui: 14399840,
          denumire: "EXEMPLU SRL",
          adresa: "Str. X 1",
          telefon: "0265000000",
          stare_inregistrare: "INREGISTRAT",
          cod_CAEN: "9312",
        },
      },
      at,
    );
    expect(anaf.phone.src).toBe(
      "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva#cui=14399840",
    );
  });

  it("finds contacts, social pages and plain signals on a business page", async () => {
    const { extractPage } = await load("client-radar", "radar.mjs");
    const html = `<html><head><title>Club Nord</title></head><body>
      <a href="mailto:office@clubnord.test">scrie-ne</a> Antrenor: ion.popescu@clubnord.test
      <a href="tel:+40 265 123 456">sună</a>
      <a href="https://www.facebook.com/clubnord/">fb</a> <a href="https://facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="/contact">Contact</a> <a href="/despre-noi">Despre</a> <a href="/galerie">Galerie</a>
      <footer>© 2019 Club Nord</footer></body></html>`;
    const page = extractPage(html, "http://clubnord.test/", "2026-11-08T10:00:00.000Z");
    expect(page.emails.map((item: { v: string }) => item.v)).toEqual([
      "office@clubnord.test",
      "ion.popescu@clubnord.test",
    ]);
    expect(page.phones[0].v).toBe("+40265123456");
    expect(page.socials.facebook.v).toBe("https://www.facebook.com/clubnord");
    expect(page.signals.map((item: { code: string }) => item.code).toSorted()).toEqual([
      "no-description",
      "no-https",
      "not-mobile",
      "old-copyright",
    ]);
    expect(page.links).toEqual(["http://clubnord.test/contact", "http://clubnord.test/despre-noi"]);
  });
});

describe("outreach with approval", () => {
  const settings = {
    from: "Ana <office@studio.test>",
    cap: 3,
    followupDays: [4, 7],
    lang: "ro",
    unsubscribeLine: undefined as string | undefined,
    signature: "Ana, Studio",
  };
  const leadOf = (id: string, extra: Module = {}) => ({
    id,
    name: `Club ${id}`,
    email: `office@club${id}.test`,
    order: Number(id.replace(/\D/g, "")) || 0,
    status: "new",
    step: 0,
    lastSentAt: null,
    history: [],
    facts: { opportunities: [{ text: "site vechi din 2018" }] },
    ...extra,
  });

  it("adds the unsubscribe line and the signature to every e-mail, once", async () => {
    const o = await load("outreach-approved", "outreach.mjs");
    const body = o.finalBody("Bună ziua,\nAm văzut site-ul vostru.", settings);
    expect(body).toContain(o.UNSUBSCRIBE.ro);
    expect(body).toContain("Ana, Studio");
    expect(o.finalBody(body, settings)).toBe(body);
    expect(
      o.hasUnsubscribeLine(o.finalBody("Hi", { ...settings, lang: "en" }), { lang: "en" }),
    ).toBe(true);
  });

  it("caps the day (default 20, never above 50), puts follow-ups first and skips who replied or opted out", async () => {
    const o = await load("outreach-approved", "outreach.mjs");
    expect(o.DEFAULT_CAP).toBe(20);
    expect(o.HARD_CAP).toBe(50);
    const leads: Record<string, Module> = {};
    for (let i = 1; i <= 6; i++) leads[`l${i}`] = leadOf(`l${i}`);
    leads.l5 = leadOf("l5", {
      status: "in-sequence",
      step: 1,
      lastSentAt: "2026-11-01T09:00:00.000Z",
    });
    leads.l6 = leadOf("l6", { status: "replied", step: 1, lastSentAt: "2026-11-01T09:00:00.000Z" });
    const messages = Object.fromEntries(
      Object.keys(leads).map((id) => [
        id,
        {
          steps: [
            { subject: `Pentru Club ${id}`, body: "Bună, Club" },
            { body: "Revin" },
            { body: "Închei" },
          ],
        },
      ]),
    );
    const state = { settings, leads };
    const due = o.dueItems(state, messages, "2026-11-08", {});
    expect(due.items.map((item: Module) => item.leadId)).toEqual(["l5", "l1", "l2"]);
    expect(due.items[0]).toMatchObject({ step: 2, subject: "Re: Pentru Club l5" });
    expect(due.waiting).toEqual(["l3", "l4"]);
    expect(o.dueItems(state, messages, "2026-11-08", { alreadyToday: 2 }).items).toHaveLength(1);
    expect(o.dueItems(state, messages, "2026-11-08", { cap: 500 }).limit).toBe(50);
    // A follow-up waits its days.
    expect(
      o.dueItems(state, messages, "2026-11-04", {}).items.map((item: Module) => item.leadId),
    ).not.toContain("l5");
    for (const item of due.items) expect(item.body).toContain(o.UNSUBSCRIBE.ro);
  });

  it("drops personal addresses, opt-outs (address or domain), customers and duplicates", async () => {
    const o = await load("outreach-approved", "outreach.mjs");
    const optouts = new Set(["stop@a.test", "@b.test"]);
    const { kept, left } = o.selectRecipients(
      [
        { id: "1", name: "A", email: "stop@a.test" },
        { id: "2", name: "B", email: "office@b.test" },
        { id: "3", name: "C", email: "ion.popescu@c.test" },
        { id: "4", name: "D", email: "office@d.test" },
        { id: "5", name: "D bis", email: "OFFICE@d.test" },
        { id: "6", name: "Client Vechi", email: "contact@e.test" },
        { id: "7", name: "F", email: "" },
      ],
      { optouts, exclude: new Set(["client vechi"]) },
    );
    expect(kept.map((lead: Module) => lead.id)).toEqual(["4"]);
    expect(left.map((item: Module) => item.reason)).toEqual([
      "on the opt-out list",
      "on the opt-out list",
      "looks like a private person's address (B2B only)",
      "the same address is already in the list",
      "on the do-not-contact list (customers, partners)",
      "no business e-mail",
    ]);
  });

  it("never releases a batch that was not approved, was changed after approval or passes the cap", async () => {
    const o = await load("outreach-approved", "outreach.mjs");
    const items = [
      { leadId: "l1", name: "Club l1", to: "office@clubl1.test", step: 1, subject: "S", body: "B" },
      { leadId: "l2", name: "Club l2", to: "office@clubl2.test", step: 1, subject: "S", body: "B" },
    ];
    const batch = {
      date: "2026-11-08",
      items,
      waiting: [],
      hash: o.batchHash(items),
      released: false,
    };
    expect(() => o.assertReleasable(batch, [], { cap: 20 })).toThrow(
      /NOT SENDING: this batch has not been approved/,
    );
    for (const said of ["arată bine", "ok", "nu aprob", "", "trimitem mâine?"]) {
      expect(() => o.approveBatch(batch, { by: "Ana", said })).toThrow(/not an approval/);
    }
    const { batch: approved, approval } = o.approveBatch(batch, {
      by: "Ana",
      said: "Aprobă",
      skip: ["l2"],
    });
    expect(approved.items.map((item: Module) => item.leadId)).toEqual(["l1"]);
    expect(o.assertReleasable(approved, [approval], { cap: 20 })).toBe(approval);
    // The approval of the full batch does not cover another batch.
    expect(() => o.assertReleasable(batch, [approval], { cap: 20 })).toThrow(/not been approved/);
    const edited = { ...approved, items: [{ ...approved.items[0], body: "B, changed" }] };
    expect(() => o.assertReleasable(edited, [approval], { cap: 20 })).toThrow(
      /changed after it was written/,
    );
    expect(() => o.assertReleasable(approved, [approval], { cap: 20, sentToday: 20 })).toThrow(
      /limit of 20/,
    );
    expect(o.APPROVAL.test("Approve")).toBe(true);
    expect(o.APPROVAL.test("da, trimite")).toBe(true);
  });

  it("checks the messages (placeholders, personal, follow-ups, no WhatsApp) and reads the replies", async () => {
    const o = await load("outreach-approved", "outreach.mjs");
    const state = { settings, leads: { l1: leadOf("l1"), l2: leadOf("l2") } };
    const problems = o.lintMessages(state, {
      l1: {
        steps: [
          { subject: "Salut [Nume]", body: "Bună ziua, vă scriem garantat." },
          { body: "Revin" },
        ],
      },
      l2: {
        steps: [
          {
            subject: "Club l2 și site-ul",
            body: "Am văzut că site-ul vechi din 2018 nu merge pe telefon.",
          },
          { body: "Revin" },
          { body: "Vă trimit pe WhatsApp detalii" },
        ],
      },
    });
    expect(problems.join("\n")).toMatch(/l1.*3 messages expected/);
    expect(problems.join("\n")).toMatch(/placeholder \(\[Nume\]\)/);
    expect(problems.join("\n")).toMatch(/pushy or unprovable claim \("garantat"\)/);
    expect(problems.join("\n")).toMatch(/l1.*does not mention the business/);
    expect(problems.join("\n")).toMatch(/l2.*WhatsApp\/SMS/);
    expect(o.classifyReply("Vă rog să mă dezabonați")).toBe("unsubscribe");
    expect(o.classifyReply("Nu suntem interesați, mulțumim")).toBe("negative");
    expect(o.classifyReply("Da, putem discuta joi?")).toBe("positive");
    const optouts = new Set<string>();
    const s2 = { settings, leads: { l1: leadOf("l1"), l2: leadOf("l2") } };
    o.applyReplies(
      s2,
      [
        { from: "Club <office@clubl1.test>", snippet: "stop, nu mai trimiteți" },
        { from: "office@clubl2.test", snippet: "Cât costă?" },
      ],
      optouts,
    );
    expect(s2.leads.l1.status).toBe("opted-out");
    expect([...optouts]).toEqual(["office@clubl1.test"]);
    expect(s2.leads.l2.status).toBe("replied");
    expect(o.dueItems(s2, {}, "2026-11-08", {}).items).toEqual([]);
  });

  it("end to end: init, lint, batch, refused release, approval, .eml with unsubscribe, sent log", async () => {
    const dir = tmp("zen-outreach-");
    try {
      const leads = NodePath.join(dir, "leads.csv");
      NodeFS.writeFileSync(
        leads,
        "Nume,Email,Oportunitate\nClub Nord,office@clubnord.test,site vechi din 2018\nClub Sud,ion.popescu@clubsud.test,fără site\nClub Est,contact@clubest.test,fără Instagram\n",
      );
      const optout = NodePath.join(dir, "refuzuri.txt");
      NodeFS.writeFileSync(optout, "contact@clubest.test\n");
      const out = NodePath.join(dir, "outreach");
      const init = await run(
        "outreach-approved",
        [
          "init",
          "--leads",
          leads,
          "--from",
          "Ana Pop <office@studio.test>",
          "--cap",
          "20",
          "--followups",
          "4",
          "--optout",
          optout,
          "--dir",
          out,
        ],
        dir,
      );
      expect(init.code, init.err).toBe(0);
      expect(init.json).toMatchObject({ recipients: 1, leftOut: 2 });
      NodeFS.writeFileSync(
        NodePath.join(out, "messages.json"),
        JSON.stringify({
          "row-2": {
            steps: [
              {
                subject: "Site-ul Club Nord pe telefon",
                body: "Bună ziua,\n\nAm văzut că site-ul Club Nord e din 2018 și nu se vede bine pe telefon. Facem site-uri pentru cluburi mici.\nVă interesează o verificare gratuită de 20 de minute?\n\nAna",
              },
              { body: "Revin cu un exemplu scurt." },
            ],
          },
        }),
      );
      expect((await run("outreach-approved", ["lint", "--dir", out], dir)).code).toBe(0);
      const batch = await run(
        "outreach-approved",
        ["batch", "--date", "2026-11-09", "--dir", out],
        dir,
      );
      expect(batch.code, batch.err).toBe(0);
      expect(batch.json?.count).toBe(1);
      const batchFile = batch.json?.batch as string;
      expect(NodeFS.readFileSync(batch.json?.preview as string, "utf8")).toContain(
        "Nimic nu pleacă până nu scrii „Aprobă”",
      );
      const refused = await run(
        "outreach-approved",
        ["release", "--batch", batchFile, "--dir", out],
        dir,
      );
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("NOT SENDING");
      expect(NodeFS.existsSync(NodePath.join(out, "outbox"))).toBe(false);
      expect(
        (
          await run(
            "outreach-approved",
            ["sent", "--batch", batchFile, "--id", "row-2", "--dir", out],
            dir,
          )
        ).err,
      ).toContain("NOT LOGGED");
      expect(
        (
          await run(
            "outreach-approved",
            ["approve", "--batch", batchFile, "--by", "Ana", "--said", "arată bine", "--dir", out],
            dir,
          )
        ).code,
      ).toBe(1);
      expect(
        (
          await run(
            "outreach-approved",
            ["approve", "--batch", batchFile, "--by", "Ana", "--said", "Aprobă", "--dir", out],
            dir,
          )
        ).code,
      ).toBe(0);
      const released = await run(
        "outreach-approved",
        ["release", "--batch", batchFile, "--dir", out],
        dir,
      );
      expect(released.code, released.err).toBe(0);
      const sent = released.json?.send as Module[];
      expect(sent).toHaveLength(1);
      const eml = NodeFS.readFileSync(sent[0]!.eml as string, "utf8");
      expect(eml).toContain("To: office@clubnord.test");
      expect(eml).toContain("List-Unsubscribe: <mailto:office@studio.test?subject=dezabonare>");
      expect(eml).toContain("X-Unsent: 1");
      const decoded = Buffer.from(
        eml.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain("răspunde cu „dezabonare”");
      expect(
        (
          await run(
            "outreach-approved",
            ["sent", "--batch", batchFile, "--id", "row-2", "--via", "draft", "--dir", out],
            dir,
          )
        ).code,
      ).toBe(0);
      expect(
        (
          await run(
            "outreach-approved",
            ["sent", "--batch", batchFile, "--id", "row-2", "--dir", out],
            dir,
          )
        ).err,
      ).toContain("already got message 1");
      // The released batch cannot be rewritten for the same day.
      expect(
        (await run("outreach-approved", ["batch", "--date", "2026-11-09", "--dir", out], dir)).err,
      ).toContain("already released");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});

interface Site {
  readonly url: string;
  readonly requests: Array<{ path: string; ua: string }>;
  peak: number;
  close(): Promise<void>;
}

/** A static site on 127.0.0.1: `pages` maps a path to [status, body]. */
function startSite(pages: Record<string, readonly [number, string]>): Promise<Site> {
  return new Promise((resolve) => {
    let active = 0;
    const site = {
      requests: [] as Array<{ path: string; ua: string }>,
      peak: 0,
    } as unknown as Site & { peak: number };
    const server = NodeHttp.createServer((request, response) => {
      active += 1;
      site.peak = Math.max(site.peak, active);
      const path = request.url ?? "/";
      site.requests.push({ path, ua: String(request.headers["user-agent"] ?? "") });
      const page = pages[path] ?? ([404, "not found"] as const);
      response.writeHead(page[0], {
        "content-type": path === "/robots.txt" ? "text/plain" : "text/html; charset=utf-8",
      });
      response.end(page[1], () => {
        active -= 1;
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as NodeNet.AddressInfo;
      Object.assign(site, {
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
      resolve(site);
    });
  });
}

const PAGE = (body: string, title = "Pagina") =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

describe("offline end to end on fixture sites", () => {
  it("client radar reads allowed pages only, skips robots/terms/CAPTCHA sites and exports XLSX, CSV and the dashboard", async () => {
    const good = await startSite({
      "/robots.txt": [200, "User-agent: *\nDisallow: /despre\nDisallow: /private\n"],
      "/": [
        200,
        PAGE(
          '<a href="/despre-noi">Despre noi</a> <a href="/contact">Contact</a> <a href="/private/members">Membri</a> <a href="/termeni">Termeni</a> <a href="https://facebook.com/clubnord">fb</a> © 2019',
          "Club Nord",
        ),
      ],
      "/contact": [
        200,
        PAGE(
          '<a href="mailto:office@clubnord.test">office@clubnord.test</a> Antrenor Ion: ion.popescu@clubnord.test, telefon 0265 123 456',
        ),
      ],
      "/termeni": [200, PAGE("Prețurile pot fi modificate. Datele personale sunt protejate.")],
      "/private/members": [200, PAGE("lista membrilor cu telefoane personale")],
    });
    const noScrape = await startSite({
      "/robots.txt": [200, "User-agent: *\nAllow: /\n"],
      "/": [
        200,
        PAGE(
          '<a href="/terms">Terms of use</a> <a href="mailto:office@noscrape.test">mail</a>',
          "No Scrape",
        ),
      ],
      "/terms": [
        200,
        PAGE(
          "<p>Any scraping, crawling or automated access to this website is strictly prohibited.</p>",
        ),
      ],
      "/contact": [200, PAGE("office@noscrape.test")],
    });
    const closed = await startSite({ "/robots.txt": [500, "error"], "/": [200, PAGE("secret")] });
    const captcha = await startSite({
      "/robots.txt": [404, ""],
      "/": [
        403,
        PAGE('<div class="g-recaptcha"></div> please complete the captcha', "Attention Required!"),
      ],
      "/contact": [200, PAGE("should never be read")],
    });
    const dir = tmp("zen-radar-");
    try {
      const at = "2026-11-08T09:00:00.000Z";
      const src = "https://www.openstreetmap.org/node/1";
      const candidates = [
        {
          name: { v: "Club Nord", src, at },
          city: { v: "Reghin", src, at },
          website: { v: good.url, src, at },
          lat: 46.77,
          lon: 24.7,
        },
        { name: { v: "No Scrape SRL", src, at }, website: { v: noScrape.url, src, at } },
        { name: { v: "Closed Club", src, at }, website: { v: closed.url, src, at } },
        {
          name: { v: "Captcha Club", src, at },
          website: { v: captcha.url, src, at },
          lat: 46.6,
          lon: 24.5,
        },
        { name: { v: "Fără Sursă", src: "", at } },
      ];
      const candidatesFile = NodePath.join(dir, "candidates.json");
      NodeFS.writeFileSync(candidatesFile, JSON.stringify(candidates));
      const leads = NodePath.join(dir, "leads.json");
      const added = await run(
        "client-radar",
        [
          "add",
          "--leads",
          leads,
          "--from",
          candidatesFile,
          "--meta",
          '{"niche":"cluburi","region":"Mureș","offer":"site-uri","lang":"ro"}',
        ],
        dir,
      );
      expect(added.code).toBe(2); // the one without a source is refused
      expect(added.json).toMatchObject({ added: 4, merged: 0 });
      expect(added.json?.refused[0]).toContain("the name needs");

      const site = await run(
        "client-radar",
        [
          "site",
          "--leads",
          leads,
          "--contact",
          "office@me.test",
          "--delay",
          "40",
          "--backoff",
          "5",
          "--pages",
          "3",
        ],
        dir,
      );
      expect(site.code, site.err).toBe(0);
      // robots.txt: /private was never requested; terms: only robots, home and the terms page.
      expect(good.requests.some((request) => /^\/(private|despre)/.test(request.path))).toBe(false);
      expect(good.requests.map((request) => request.path)).toContain("/contact");
      expect(noScrape.requests.map((request) => request.path).toSorted()).toEqual([
        "/",
        "/robots.txt",
        "/terms",
      ]);
      expect(closed.requests.every((request) => request.path === "/robots.txt")).toBe(true);
      expect(captcha.requests.filter((request) => request.path === "/contact")).toHaveLength(0);
      for (const s of [good, noScrape, closed, captcha]) {
        expect(s.peak).toBeLessThanOrEqual(2);
        for (const request of s.requests)
          expect(request.ua).toBe(
            "ZenStaffBot/1.0 (public business research for a Zen Staff user; contact: office@me.test)",
          );
      }
      const data = JSON.parse(NodeFS.readFileSync(leads, "utf8"));
      const reasons = data.skipped.map((item: Module) => item.reason).join("\n");
      expect(reasons).toContain("robots.txt does not allow it (Disallow: /despre)");
      expect(reasons).toContain("the site's terms forbid automated access");
      expect(data.skipped.find((item: Module) => /terms forbid/.test(item.reason)).termsUrl).toBe(
        `${noScrape.url}/terms`,
      );
      expect(reasons).toContain("robots.txt could not be read");
      expect(reasons).toMatch(/refused access \(HTTP 403\)|CAPTCHA/);
      const nord = data.leads.find((lead: Module) => lead.name.v === "Club Nord");
      expect(nord.email).toMatchObject({ v: "office@clubnord.test", src: `${good.url}/contact` });
      expect(nord.socials.facebook.v).toBe("https://facebook.com/clubnord");
      expect(NodeFS.existsSync(NodePath.join(dir, "dossiers", `${nord.id}.json`))).toBe(true);
      expect(NodeFS.readFileSync(NodePath.join(dir, "crawl-log.jsonl"), "utf8")).toContain(
        '"skipped":true',
      );

      // The agent's judgement, then check, score and export.
      nord.opportunities = [
        {
          text: "site vechi (© 2019), fără variantă pentru telefon",
          strength: "clear",
          src: good.url + "/",
        },
      ];
      nord.email2 = { v: "ion.popescu@clubnord.test", src: `${good.url}/contact`, at };
      NodeFS.writeFileSync(leads, JSON.stringify(data));
      const check = await run("client-radar", ["check", "--leads", leads], dir);
      expect(check.json?.fixed.join("\n")).toContain("email2");
      expect((await run("client-radar", ["score", "--leads", leads], dir)).json).toMatchObject({
        A: 1,
      });
      const exported = await run(
        "client-radar",
        ["export", "--leads", leads, "--out", dir, "--lang", "ro"],
        dir,
      );
      expect(exported.code, exported.err).toBe(0);
      expect(exported.json).toMatchObject({ leads: 4, A: 1, withEmail: 1 });
      const csv = NodeFS.readFileSync(NodePath.join(dir, "leaduri.csv"), "utf8");
      expect(csv).toContain("office@clubnord.test");
      expect(csv).not.toContain("ion.popescu");
      expect(
        NodeFS.readFileSync(NodePath.join(dir, "leaduri.xlsx")).subarray(0, 2).toString(),
      ).toBe("PK");
      const html = NodeFS.readFileSync(NodePath.join(dir, "radar.html"), "utf8");
      expect(html).toContain("<title>Radar de clienți: cluburi, Mureș</title>");
      expect(html).not.toContain("__RADAR_DATA__");
      expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=["']https?:/); // self-contained, no network
      const payload = JSON.parse(
        /<script type="application\/json" id="radar-data">([\s\S]*?)<\/script>/.exec(html)![1]!,
      );
      expect(payload.leads).toHaveLength(4);
      expect(JSON.stringify(payload)).not.toContain("ion.popescu");
    } finally {
      await Promise.all([good, noScrape, closed, captcha].map((s) => s.close()));
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("client radar walks a public list page by page under the same rules", async () => {
    const list = await startSite({
      "/robots.txt": [200, "User-agent: *\nDisallow: /admin\n"],
      "/cluburi": [
        200,
        PAGE(
          '<a href="/cluburi?p=2">Pagina 2</a> <a href="/admin">admin</a> <ul><li>Club A</li></ul>',
        ),
      ],
      "/cluburi?p=2": [200, PAGE('<a href="/cluburi?p=3">Pagina 3</a> <ul><li>Club B</li></ul>')],
      "/cluburi?p=3": [200, PAGE("<ul><li>Club C</li></ul>")],
    });
    const dir = tmp("zen-radar-list-");
    try {
      const leads = NodePath.join(dir, "leads.json");
      const crawled = await run(
        "client-radar",
        [
          "crawl",
          "--leads",
          leads,
          "--start",
          `${list.url}/cluburi`,
          "--follow",
          "cluburi\\?p=|admin",
          "--max",
          "10",
          "--contact",
          "office@me.test",
          "--delay",
          "20",
          "--backoff",
          "5",
          "--engine",
          "gate",
        ],
        dir,
      );
      expect(crawled.code, crawled.err).toBe(0);
      expect(crawled.json).toMatchObject({ engine: "gate", pages: 3, skipped: 1 });
      expect(list.requests.some((request) => request.path === "/admin")).toBe(false);
    } finally {
      await list.close();
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The Crawlee engine needs the toolchain installed; set ZEN_TEST_CRAWLEE_MODULES to its node_modules.
  it.skipIf(!process.env.ZEN_TEST_CRAWLEE_MODULES)(
    "with Crawlee, the list walk keeps the same rules",
    async () => {
      const list = await startSite({
        "/robots.txt": [200, "User-agent: *\nDisallow: /admin\n"],
        "/cluburi": [
          200,
          PAGE(
            '<a href="/cluburi?p=2">Pagina 2</a> <a href="/admin">admin</a> <a href="/termeni">Termeni</a>',
          ),
        ],
        "/cluburi?p=2": [200, PAGE('<a href="/cluburi?p=3">Pagina 3</a>')],
        "/cluburi?p=3": [200, PAGE("<ul><li>Club C</li></ul>")],
        "/termeni": [200, PAGE("Conținutul este protejat.")],
      });
      const closed = await startSite({
        "/robots.txt": [200, "User-agent: *\nAllow: /\n"],
        "/": [200, PAGE('<a href="/terms">Terms</a>')],
        "/terms": [200, PAGE("Scraping or crawling this website is prohibited.")],
        "/list": [200, PAGE("x")],
      });
      const dir = tmp("zen-radar-crawlee-");
      try {
        const leads = NodePath.join(dir, "leads.json");
        const env = { ZEN_CRAWLEE_MODULES: process.env.ZEN_TEST_CRAWLEE_MODULES! };
        const crawled = await run(
          "client-radar",
          [
            "crawl",
            "--leads",
            leads,
            "--start",
            `${list.url}/cluburi`,
            "--follow",
            "cluburi\\?p=|admin",
            "--max",
            "10",
            "--contact",
            "office@me.test",
            "--delay",
            "20",
          ],
          dir,
          env,
        );
        expect(crawled.code, crawled.err).toBe(0);
        expect(crawled.json).toMatchObject({ engine: "crawlee", pages: 3 });
        expect(list.requests.some((request) => request.path === "/admin")).toBe(false);
        expect(list.peak).toBeLessThanOrEqual(2);
        for (const request of list.requests) expect(request.ua).toContain("ZenStaffBot/1.0");
        const refused = await run(
          "client-radar",
          [
            "crawl",
            "--leads",
            leads,
            "--start",
            `${closed.url}/list`,
            "--contact",
            "office@me.test",
            "--delay",
            "20",
          ],
          dir,
          env,
        );
        expect(refused.json).toMatchObject({ engine: "crawlee", pages: 0 });
        expect(closed.requests.some((request) => request.path === "/list")).toBe(false);
      } finally {
        await Promise.all([list.close(), closed.close()]);
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // Rendering needs the Playwright toolchain; set ZEN_TEST_PLAYWRIGHT_MODULES and ZEN_TEST_CHROME.
  it.skipIf(!process.env.ZEN_TEST_PLAYWRIGHT_MODULES || !process.env.ZEN_TEST_CHROME)(
    "a page that needs JavaScript is rendered under the same rules",
    async () => {
      const app = await startSite({
        "/robots.txt": [200, "User-agent: *\nDisallow: /private\n"],
        "/": [
          200,
          PAGE(
            '<div id="app"></div><script>fetch("/data").then(r=>r.text()).then(t=>{document.getElementById("app").textContent=t});fetch("/private/data").catch(()=>{})</script>',
          ),
        ],
        "/data": [200, "Contact: office@jsclub.test"],
        "/private/data": [200, "secret"],
      });
      try {
        const { PublicWebGate, DomainLimiter, renderPage, loadPlaywright } = await load(
          "client-radar",
          "web-rules.mjs",
        );
        const playwright = await loadPlaywright({
          ZEN_PLAYWRIGHT_MODULES: process.env.ZEN_TEST_PLAYWRIGHT_MODULES,
          ZEN_CHROME: process.env.ZEN_TEST_CHROME,
        });
        expect(playwright).not.toBeNull();
        const gate = new PublicWebGate({
          contact: "office@me.test",
          limiter: new DomainLimiter({ delayMs: 10 }),
          backoffBaseMs: 5,
        });
        const page = await renderPage(gate, `${app.url}/`, { playwright });
        expect(page.rendered).toBe(true);
        expect(page.text).toContain("office@jsclub.test");
        expect(app.requests.some((request) => request.path.startsWith("/private"))).toBe(false);
        for (const request of app.requests) expect(request.ua).toContain("ZenStaffBot/1.0");
        expect(
          gate.skipped().some((entry: Module) => /Disallow: \/private/.test(entry.reason)),
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
  );

  it("competitor radar: snapshot, diff and a report check that refuses numbers without a source", async () => {
    const shop = await startSite({
      "/robots.txt": [200, "User-agent: *\nAllow: /\n"],
      "/": [200, PAGE('<a href="/termeni">Termeni</a><p>Nou: modul de rezervări online</p>')],
      "/termeni": [200, PAGE("Conținutul este protejat de drepturi de autor.")],
      "/preturi": [
        200,
        PAGE("<h2>Start</h2><p>99 lei/lună + TVA</p><h2>Pro</h2><p>199 lei/lună + TVA</p>"),
      ],
    });
    const forbidden = await startSite({
      "/robots.txt": [200, "User-agent: *\nDisallow: /preturi\n"],
      "/preturi": [200, PAGE("149 lei")],
    });
    const dir = tmp("zen-competitors-");
    try {
      const list = NodePath.join(dir, "competitors.json");
      NodeFS.writeFileSync(
        list,
        JSON.stringify([
          {
            name: "Exemplu Soft",
            site: shop.url,
            pages: [
              { url: `${shop.url}/preturi`, kind: "pricing" },
              { url: `${shop.url}/`, kind: "home" },
            ],
          },
          {
            name: "Închis",
            site: forbidden.url,
            pages: [{ url: `${forbidden.url}/preturi`, kind: "pricing" }],
          },
        ]),
      );
      const week = NodePath.join(dir, "radar-concurenta", "2026-11-09");
      const snap = await run(
        "competitor-radar",
        [
          "snapshot",
          "--competitors",
          list,
          "--out",
          week,
          "--contact",
          "office@me.test",
          "--delay",
          "20",
          "--backoff",
          "5",
        ],
        dir,
      );
      expect(snap.code, snap.err).toBe(0);
      expect(snap.json).toMatchObject({ pages: 2, skipped: 1, prices: 2 });
      expect(forbidden.requests.some((request) => request.path === "/preturi")).toBe(false);
      const diff = await run("competitor-radar", ["diff", "--cur", week], dir);
      expect(diff.json).toMatchObject({ since: null, newPrices: 2 });
      const snapshot = JSON.parse(
        NodeFS.readFileSync(NodePath.join(week, "snapshot.json"), "utf8"),
      );
      expect(snapshot.prices[0]).toMatchObject({
        competitor: "Exemplu Soft",
        amount: 99,
        currency: "RON",
        period: "lună",
        vat: "fără TVA",
        url: `${shop.url}/preturi`,
      });
      expect(snapshot.news.map((item: Module) => item.line)).toContain(
        "Nou: modul de rezervări online",
      );

      const good = [
        "# Radar",
        "## Tabel",
        "| Concurent | Preț public | Sursa |",
        "| --- | --- | --- |",
        `| Exemplu Soft | Start 99 lei/lună + TVA, Pro 199 lei/lună + TVA | [prețuri](${shop.url}/preturi) |`,
        "| Închis | nepublicat | robots.txt nu permite citirea |",
        "## 3 observații",
        "1. a",
        "2. b",
        "3. c",
        "## De decis",
        "- nimic",
      ].join("\n");
      const report = NodePath.join(week, "raport.md");
      NodeFS.writeFileSync(report, good);
      const passed = await run(
        "competitor-radar",
        ["check-report", "--report", report, "--snapshot", week],
        dir,
      );
      expect(passed.json?.problems).toEqual([]);
      const bad = good
        .replace("| Închis | nepublicat |", "| Închis | 149 lei |")
        .replace("Pro 199 lei", "Pro 249 lei")
        .replace("3. c\n", "");
      NodeFS.writeFileSync(report, bad);
      const failed = await run(
        "competitor-radar",
        ["check-report", "--report", report, "--snapshot", week],
        dir,
      );
      expect(failed.code).toBe(2);
      const problems = ((failed.json?.problems ?? []) as string[]).join("\n");
      expect(problems).toContain("249 lei is not on any page read this week");
      expect(problems).toContain("(149 lei) without a source link");
      expect(problems).toContain("exactly 3 are expected");
    } finally {
      await Promise.all([shop.close(), forbidden.close()]);
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** The test's own registry signing key (the app embeds the real public key). */
const signingKeys = NodeCrypto.generateKeyPairSync("ed25519");
const TEST_PUBLIC_KEY = signingKeys.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");

/** Serves the three packs as a remote registry (tar.gz each, sha256 in the index) on 127.0.0.1. */
function startRegistry(): Promise<{ url: string; close(): Promise<void> }> {
  const archives = new Map<string, Uint8Array>();
  const collect = (dir: string, prefix: string): Array<{ path: string; data: Uint8Array }> =>
    NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? collect(NodePath.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [
            {
              path: `${prefix}${entry.name}`,
              data: NodeFS.readFileSync(NodePath.join(dir, entry.name)),
            },
          ],
    );
  for (const pack of PACKS)
    archives.set(
      pack,
      writeTarGz(
        collect(NodePath.join(remote, pack), `${pack}/`).toSorted((a, b) =>
          a.path < b.path ? -1 : 1,
        ),
      ),
    );
  const index = JSON.parse(read("index.json"));
  index.entries = index.entries.map((entry: Module) => {
    const { path: _path, ...rest } = entry;
    const archive = archives.get(entry.id)!;
    return {
      ...rest,
      download: {
        url: `packs/${entry.id}.tar.gz`,
        sha256: sha256Hex(archive),
        format: "tar.gz",
        size: archive.byteLength,
      },
    };
  });
  const indexBytes = Buffer.from(JSON.stringify(index));
  return new Promise((resolve) => {
    const server = NodeHttp.createServer((request, response) => {
      const name = /^\/packs\/([a-z-]+)\.tar\.gz$/.exec(request.url ?? "")?.[1];
      if (request.url === "/registry.json") {
        response.writeHead(200, { "content-type": "application/json" }).end(indexBytes);
      } else if (request.url === "/registry.json.sig") {
        response
          .writeHead(200, { "content-type": "text/plain" })
          .end(NodeCrypto.sign(null, indexBytes, signingKeys.privateKey).toString("base64"));
      } else if (name && archives.has(name)) {
        response.writeHead(200, { "content-type": "application/gzip" }).end(archives.get(name));
      } else {
        response.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as NodeNet.AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/registry.json`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

it.layer(Layer.mergeAll(NodeServices.layer, SqlitePersistence.layerMemory))(
  "remote packs from a remote index",
  (it) => {
    it.effect("the app lists, installs and loads all three from a remote registry", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const registry = yield* Effect.acquireRelease(Effect.promise(startRegistry), (hub) =>
          Effect.promise(() => hub.close()),
        );
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-remote-packs-" });
        const office = yield* ZenOffice.make({
          defaultRegistryUrl: registry.url,
          remoteRegistryTtlMs: 0,
          registryPublicKey: TEST_PUBLIC_KEY,
        }).pipe(Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)));
        const market = yield* office.registry;
        expect(market.notice).toBeNull();
        expect(market.sourceKind).toBe("remote");
        for (const pack of PACKS) {
          expect(
            market.entries.find((item) => item.entry.id === pack),
            pack,
          ).toMatchObject({ installed: false });
          yield* office.installPack({ id: pack });
        }
        const listed = yield* office.listWorkflows({});
        for (const pack of PACKS) {
          const workflow = listed.workflows.find((item) => item.manifest.id === pack);
          expect(workflow, pack).toMatchObject({ source: "user", packId: pack, editable: false });
          expect(workflow?.skill).toContain("<!-- public-web-rules:start -->");
          const folder = NodePath.join(baseDir, "workflows", pack);
          expect(yield* fs.exists(NodePath.join(folder, SCRIPT[pack]))).toBe(true);
          expect(yield* fs.exists(NodePath.join(folder, "web-rules.mjs"))).toBe(true);
        }
        expect(
          yield* fs.exists(
            NodePath.join(baseDir, "workflows", "client-radar", "template", "dashboard.html"),
          ),
        ).toBe(true);
      }),
    );
  },
);
