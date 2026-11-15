#!/usr/bin/env node
// Zen Staff "Radar concurență și prețuri": dated snapshots of competitors' public pages under
// web-rules.mjs, every price with its source, the weekly changes, and a check that every number
// in the report has a link and is on a page that was read ("nepublicat" otherwise).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  DomainLimiter,
  PublicWebGate,
  htmlToText,
  loadPlaywright,
  renderPage,
} from "./web-rules.mjs";

const USAGE = `  snapshot      --competitors competitors.json --out <week folder> --contact <e-mail> [--render]
  diff          --cur <week folder> [--prev <older week folder>]
  check-report  --report <raport.md> --snapshot <week folder>
competitors.json: [{ "name", "site", "pages": [{ "url", "kind": "pricing|home|news|features" }] }]`;

const sha = (text) => NodeCrypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
const slug = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const CURRENCY = "(lei|ron|eur|euro|€|\\$|usd|£|gbp)(?![a-zăâîșț])";
const AMOUNT = "(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const PRICE = new RegExp(
  `(?:${CURRENCY}\\s?${AMOUNT}|${AMOUNT}\\s?${CURRENCY})(?:\\s*(?:\\+\\s*tva|fără tva|fara tva|cu tva|excl\\.? vat|incl\\.? vat))?(?:\\s*(?:\\/|pe|per|on)\\s*(lună|luna|an|month|year|mo|yr|utilizator|user|locație|locatie|location))?`,
  "gi",
);

/** "1.234,50" / "1,234.50" / "49" -> number. */
export function parseAmount(text) {
  let value = String(text).replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value))
    value = value.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(value)) value = value.replace(/,/g, "");
  else value = value.replace(",", ".");
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const normalizeCurrency = (raw) => {
  const c = String(raw ?? "").toLowerCase();
  if (c === "lei" || c === "ron") return "RON";
  if (c === "€" || c === "eur" || c === "euro") return "EUR";
  if (c === "$" || c === "usd") return "USD";
  if (c === "£" || c === "gbp") return "GBP";
  return c.toUpperCase();
};

const vatOf = (text) =>
  /\+\s*tva|fără tva|fara tva|excl\.? vat|\+\s*vat/i.test(text)
    ? "fără TVA"
    : /cu tva|incl\.? (tva|vat)/i.test(text)
      ? "cu TVA"
      : null;

/** Every price on a page: { amount, currency, period, vat, context }. */
export function extractPrices(text) {
  const prices = [];
  for (const match of String(text).matchAll(PRICE)) {
    const [whole, c1, a1, a2, c2, period] = match;
    const amount = parseAmount(a1 ?? a2);
    if (amount === null || amount === 0) continue;
    const start = Math.max(0, match.index - 80);
    const context = String(text)
      .slice(start, match.index + whole.length + 60)
      .replace(/\s+/g, " ")
      .trim();
    prices.push({
      amount,
      currency: normalizeCurrency(c1 ?? c2),
      period: period ? period.toLowerCase().replace("luna", "lună") : null,
      vat: vatOf(
        `${whole}${String(text).slice(match.index + whole.length, match.index + whole.length + 16)}`,
      ),
      raw: whole.trim(),
      context,
    });
  }
  return prices;
}

const NEWS =
  /(\bnou\b|\bnoua\b|\bnouă\b|lans(ăm|am|at)|acum disponibil|disponibil(ă)? de acum|promoți|promoti|reducere|discount|ofert(ă|a) special|gratuit|free trial|\bnew\b|launch|now available|introducing|limited time|black friday|-\d{1,2}\s?%)/i;

/** Lines that announce something: new features, launches, promotions, discounts. */
export function newsLines(text) {
  return [
    ...new Set(
      String(text)
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 12 && line.length <= 280 && NEWS.test(line)),
    ),
  ].slice(0, 40);
}

export async function snapshot({ competitors, out, gate, render = null }) {
  NodeFS.mkdirSync(NodePath.join(out, "pages"), { recursive: true });
  const result = {
    date: new Date().toISOString().slice(0, 10),
    takenAt: new Date().toISOString(),
    pages: [],
    prices: [],
    news: [],
    skipped: [],
  };
  const jobs = competitors.flatMap((competitor) =>
    (competitor.pages?.length ? competitor.pages : [{ url: competitor.site, kind: "home" }]).map(
      (page) => ({ competitor, page }),
    ),
  );
  let index = 0;
  const worker = async () => {
    while (index < jobs.length) {
      const { competitor, page } = jobs[index++];
      let read = await gate.get(page.url);
      if (
        render &&
        !read.skipped &&
        read.status === 200 &&
        htmlToText(read.text).length < 200 &&
        /<script/i.test(read.text)
      ) {
        const rendered = await render(page.url);
        if (!rendered.skipped) read = rendered;
      }
      if (read.skipped || read.status !== 200) {
        const reason = read.skipped ? read.reason : `HTTP ${read.status || "no answer"}`;
        result.skipped.push({
          competitor: competitor.name,
          url: page.url,
          reason,
          termsUrl: read.termsUrl ?? null,
          at: read.at ?? gate.stamp(),
        });
        result.pages.push({
          competitor: competitor.name,
          url: page.url,
          kind: page.kind ?? null,
          skipped: true,
          reason,
        });
        continue;
      }
      const text = htmlToText(read.text);
      const file = `pages/${slug(competitor.name)}-${slug(page.kind ?? "page")}-${sha(page.url).slice(0, 6)}.txt`;
      NodeFS.writeFileSync(NodePath.join(out, file), text);
      result.pages.push({
        competitor: competitor.name,
        url: read.source,
        kind: page.kind ?? null,
        at: read.fetchedAt,
        hash: sha(text),
        textFile: file,
        rendered: Boolean(read.rendered),
      });
      for (const price of extractPrices(text))
        result.prices.push({
          competitor: competitor.name,
          url: read.source,
          at: read.fetchedAt,
          ...price,
        });
      for (const line of newsLines(text))
        result.news.push({
          competitor: competitor.name,
          url: read.source,
          at: read.fetchedAt,
          line,
        });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  result.log = gate.log;
  NodeFS.writeFileSync(NodePath.join(out, "snapshot.json"), JSON.stringify(result, null, 1));
  return result;
}

const priceKey = (price) =>
  `${price.competitor}|${price.amount}|${price.currency}|${price.period ?? ""}`;

export function diffSnapshots(prev, cur) {
  const pages = cur.pages
    .filter((page) => !page.skipped)
    .map((page) => {
      const before = prev?.pages.find((item) => item.url === page.url && !item.skipped);
      return {
        competitor: page.competitor,
        url: page.url,
        change: !before ? "new page" : before.hash === page.hash ? "same" : "changed",
      };
    });
  const prevPrices = new Set((prev?.prices ?? []).map(priceKey));
  const curPrices = new Set(cur.prices.map(priceKey));
  const prevNews = new Set((prev?.news ?? []).map((item) => `${item.competitor}|${item.line}`));
  return {
    since: prev?.date ?? null,
    pages,
    newPrices: cur.prices.filter((price) => !prevPrices.has(priceKey(price))),
    gonePrices: (prev?.prices ?? []).filter((price) => !curPrices.has(priceKey(price))),
    newNews: cur.news.filter((item) => !prevNews.has(`${item.competitor}|${item.line}`)),
  };
}

function previousFolder(cur) {
  const parent = NodePath.dirname(cur);
  const name = NodePath.basename(cur);
  const older = NodeFS.readdirSync(parent)
    .filter(
      (entry) => entry < name && NodeFS.existsSync(NodePath.join(parent, entry, "snapshot.json")),
    )
    .sort();
  return older.length ? NodePath.join(parent, older.at(-1)) : null;
}

const NUMBER_WITH_UNIT = new RegExp(
  `(?:${CURRENCY}\\s?${AMOUNT}|${AMOUNT}\\s?(?:${CURRENCY}|%))`,
  "gi",
);

/**
 * Problems in the report: a table row with a number but no link, a number not found on the
 * linked page (or any page read this week), and the "3 observations" and "To decide" sections.
 */
export function checkReport(markdown, snap) {
  const problems = [];
  const amountsByUrl = new Map();
  for (const price of snap.prices ?? []) {
    const list = amountsByUrl.get(price.url) ?? [];
    list.push(price.amount);
    amountsByUrl.set(price.url, list);
  }
  const allAmounts = new Set((snap.prices ?? []).map((price) => price.amount));
  const lines = String(markdown).split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (!/^\s*\|/.test(line) || /^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
    const numbers = [...line.matchAll(NUMBER_WITH_UNIT)].map((m) => m[0]);
    if (numbers.length === 0) continue;
    const links = [
      ...line.matchAll(/\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s|)]+)/g),
    ].map((m) => m[1] ?? m[2] ?? m[3]);
    if (links.length === 0) {
      problems.push(`line ${i + 1}: numbers (${numbers.join(", ")}) without a source link`);
      continue;
    }
    for (const raw of numbers) {
      if (/%$/.test(raw.trim())) continue;
      const amount = parseAmount((/(\d[\d.,\s]*\d|\d)/.exec(raw) ?? [""])[0]);
      const onLinked = links.some((link) => (amountsByUrl.get(link) ?? []).includes(amount));
      if (!onLinked && !allAmounts.has(amount)) {
        problems.push(
          `line ${i + 1}: ${raw.trim()} is not on any page read this week (write "nepublicat" if it is not public)`,
        );
      } else if (!onLinked) {
        problems.push(
          `line ${i + 1}: ${raw.trim()} is not on the linked page; link the page it is on`,
        );
      }
    }
  }
  const text = String(markdown);
  const section = (pattern) => {
    const start = lines.findIndex((line) => /^#{1,4}\s/.test(line) && pattern.test(line));
    if (start < 0) return null;
    const end = lines.findIndex((line, j) => j > start && /^#{1,4}\s/.test(line));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };
  const observations = section(/observa(ț|t)ii|observations/i);
  if (!observations) problems.push('the "3 observații" section is missing');
  else {
    const items = observations.filter((line) => /^\s*(\d+[.)]|[-*])\s+\S/.test(line)).length;
    if (items !== 3) problems.push(`"observații" has ${items} items; exactly 3 are expected`);
  }
  if (!section(/de decis|to decide/i)) problems.push('the "De decis" section is missing');
  if (
    /\b(probabil|estimat|aproximativ|cca\.?|around|about|approx)\b[^|\n]{0,20}\d/i.test(
      text
        .split(/\n/)
        .filter((line) => /^\s*\|/.test(line))
        .join("\n"),
    )
  ) {
    problems.push("a table holds an estimated number; only published numbers go in the table");
  }
  return problems;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const next = argv[i + 1];
    args[item.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args._[0]) {
    case "snapshot": {
      if (!args.competitors || !args.out)
        throw new Error("Give --competitors <file> and --out <week folder>.");
      if (!args.contact)
        throw new Error(
          "Give --contact <your business e-mail or site>: it goes in the user agent.",
        );
      const competitors = JSON.parse(NodeFS.readFileSync(args.competitors, "utf8"));
      const gate = new PublicWebGate({
        contact: args.contact,
        backoffBaseMs: Number(args.backoff ?? 2000),
        limiter: new DomainLimiter({ delayMs: Number(args.delay ?? 2000) }),
      });
      const playwright = args.render ? await loadPlaywright() : null;
      const out = NodePath.resolve(args.out);
      const result = await snapshot({
        competitors: Array.isArray(competitors) ? competitors : competitors.competitors,
        out,
        gate,
        render: playwright ? (url) => renderPage(gate, url, { playwright }) : null,
      });
      return console.log(
        JSON.stringify(
          {
            folder: out,
            pages: result.pages.filter((p) => !p.skipped).length,
            skipped: result.skipped.length,
            prices: result.prices.length,
            news: result.news.length,
          },
          null,
          1,
        ),
      );
    }
    case "diff": {
      const cur = NodePath.resolve(args.cur);
      const prevDir = args.prev ? NodePath.resolve(args.prev) : previousFolder(cur);
      const read = (dir) =>
        JSON.parse(NodeFS.readFileSync(NodePath.join(dir, "snapshot.json"), "utf8"));
      const changes = diffSnapshots(prevDir ? read(prevDir) : null, read(cur));
      NodeFS.writeFileSync(NodePath.join(cur, "changes.json"), JSON.stringify(changes, null, 1));
      return console.log(
        JSON.stringify(
          {
            since: changes.since,
            changedPages: changes.pages.filter((p) => p.change !== "same").length,
            newPrices: changes.newPrices.length,
            gonePrices: changes.gonePrices.length,
            newNews: changes.newNews.length,
          },
          null,
          1,
        ),
      );
    }
    case "check-report": {
      const snap = JSON.parse(
        NodeFS.readFileSync(
          NodePath.join(NodePath.resolve(args.snapshot), "snapshot.json"),
          "utf8",
        ),
      );
      const problems = checkReport(NodeFS.readFileSync(args.report, "utf8"), snap);
      console.log(JSON.stringify({ problems }, null, 1));
      if (problems.length) process.exitCode = 2;
      return;
    }
    default:
      console.log(USAGE);
  }
}

if (process.argv[1] && NodePath.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
