#!/usr/bin/env node
// Zen Staff "Radar de clienți": the fetching and the arithmetic, so the agent reads and judges.
// Every request goes through web-rules.mjs; every value keeps its source URL and time.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { readTable, toCsv, writeXlsx } from "./tables.mjs";
import {
  DomainLimiter,
  PublicWebGate,
  b2bOnly,
  backoffMs,
  classifyEmail,
  containsPersonalId,
  htmlToText,
  safeHost,
  sourced,
  unsourcedFields,
  loadPlaywright,
  renderPage,
  userAgent,
} from "./web-rules.mjs";

const USAGE = `  add       --leads leads.json --from candidates.json [--meta '{"niche":...}']
  anaf      --leads leads.json                 fill name/address/status from ANAF (by CUI)
  overpass  --leads leads.json --area <name> --tag key=value [--tag ...] [--max 300]
  places    --leads leads.json --query "<text>" [--max 60]   (only with GOOGLE_PLACES_API_KEY)
  crawl     --leads leads.json --start <list URL> [--follow <regex>] [--max 30] --contact <e-mail>
  site      --leads leads.json [--id <id>] --contact <your business e-mail> [--pages 3] [--render]
  dedupe    --leads leads.json [--existing <csv|xlsx>]
  score     --leads leads.json
  check     --leads leads.json
  export    --leads leads.json --out <folder> [--lang ro|en]
No dependencies besides Node 24. Tables: tables.mjs (shared copy).`;

const here = import.meta.dirname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SOURCES = {
  anaf: "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva",
  anafDocs: "https://www.anaf.ro/anaf/internet/ANAF/servicii_online/servicii_web_anaf",
  overpass: "https://overpass-api.de/api/interpreter",
  places: "https://places.googleapis.com/v1/places:searchText",
};

/** Hosts whose published business data counts as official (registers, OSM, Google). */
export const OFFICIAL_HOSTS = [
  "webservicesp.anaf.ro",
  "anaf.ro",
  "onrc.ro",
  "openstreetmap.org",
  "google.com",
  "maps.google.com",
  "data.gov.ro",
];

export function emptyLeads(meta = {}) {
  return { meta: { created: new Date().toISOString(), ...meta }, leads: [], skipped: [] };
}

export function readLeads(file) {
  if (!NodeFS.existsSync(file)) return emptyLeads();
  const data = JSON.parse(NodeFS.readFileSync(file, "utf8"));
  data.leads ??= [];
  data.skipped ??= [];
  data.meta ??= {};
  return data;
}

export function writeLeads(file, data) {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(file)), { recursive: true });
  NodeFS.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
}

const fold = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Name without legal forms and punctuation, for matching. */
export function nameKey(name) {
  return fold(name)
    .replace(/["'„”«»().,/&-]/g, " ")
    .replace(
      /\b(s\.?r\.?l|s\.?a|srl|sa|sc|pfa|ii|if|acs|cs|css|asociatia|asociatiei|clubul|club|fundatia|ltd|gmbh|inc|llc|the)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function phoneKey(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

export const cuiKey = (cui) => {
  const digits = String(cui ?? "")
    .toUpperCase()
    .replace(/^RO/, "")
    .replace(/\D/g, "");
  return digits.length >= 2 ? digits : null;
};

const val = (field) => (field && typeof field === "object" && "v" in field ? field.v : field);

/** Keys that identify a business: CUI, site host, e-mail, phone, name + city. */
export function leadKeys(lead) {
  const keys = [];
  const cui = cuiKey(val(lead.cui));
  if (cui) keys.push(`cui:${cui}`);
  const host = val(lead.website) ? safeHost(val(lead.website)) : null;
  if (host && !/(facebook|instagram|google|linktr\.ee|wix|blogspot)\./.test(host))
    keys.push(`site:${host}`);
  const email = val(lead.email);
  if (email) keys.push(`email:${String(email).toLowerCase()}`);
  const phone = phoneKey(val(lead.phone));
  if (phone) keys.push(`phone:${phone}`);
  const name = nameKey(val(lead.name));
  if (name) keys.push(`name:${name}|${fold(val(lead.city))}`);
  return keys;
}

let counter = 0;
export function newId(name) {
  counter += 1;
  const slug =
    fold(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "lead";
  return `${slug}-${Date.now().toString(36).slice(-4)}${counter}`;
}

/** Adds candidates, merging the ones that are the same business (fields not yet known are filled). */
export function mergeCandidates(data, candidates) {
  let added = 0;
  let merged = 0;
  for (const candidate of candidates) {
    const keys = leadKeys(candidate);
    const existing = data.leads.find((lead) => leadKeys(lead).some((key) => keys.includes(key)));
    if (existing) {
      for (const [field, value] of Object.entries(candidate)) {
        if (field === "id") continue;
        if (field === "socials") {
          existing.socials = { ...value, ...existing.socials };
        } else if (existing[field] === undefined || existing[field] === null) {
          existing[field] = value;
        }
      }
      existing.foundVia = [
        ...new Set([...(existing.foundVia ?? []), ...(candidate.foundVia ?? [])]),
      ];
      merged += 1;
    } else {
      data.leads.push({ id: candidate.id ?? newId(val(candidate.name)), ...candidate });
      added += 1;
    }
  }
  return { added, merged };
}

async function apiRequest(url, init, { retries = 3, limiter } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const run = () => fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
      const response = limiter ? await limiter.run(url, run) : await run();
      const text = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await sleep(backoffMs(attempt, 2000));
        continue;
      }
      return { status: response.status, text };
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(backoffMs(attempt, 2000));
    }
  }
}

/** ANAF answer -> fields (the company's own registered data; its phone is a business phone). */
export function anafFields(found, at) {
  const g = found?.date_generale ?? {};
  const src = `${SOURCES.anaf}#cui=${g.cui ?? ""}`;
  const fields = {
    name: sourced(g.denumire, src, at),
    address: sourced(g.adresa, src, at),
    status: sourced(g.stare_inregistrare, src, at),
    caen: sourced(g.cod_CAEN, src, at),
    registeredSince: sourced(g.data_inregistrare, src, at),
  };
  if (g.telefon) fields.phone = sourced(g.telefon, src, at);
  if (found?.stare_inactiv?.statusInactivi) fields.inactive = sourced(true, src, at);
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}

async function cmdAnaf(args) {
  const data = readLeads(args.leads);
  const withCui = data.leads.filter((lead) => cuiKey(val(lead.cui)));
  const today = new Date().toISOString().slice(0, 10);
  let filled = 0;
  for (let i = 0; i < withCui.length; i += 100) {
    const batch = withCui.slice(i, i + 100);
    const { status, text } = await apiRequest(SOURCES.anaf, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": userAgent(args.contact) },
      body: JSON.stringify(
        batch.map((lead) => ({ cui: Number(cuiKey(val(lead.cui))), data: today })),
      ),
    });
    if (status !== 200) {
      console.error(`ANAF answered HTTP ${status}; try again later.`);
      break;
    }
    const at = new Date().toISOString();
    const json = JSON.parse(text);
    for (const found of json.found ?? []) {
      const lead = batch.find((item) => cuiKey(val(item.cui)) === String(found.date_generale?.cui));
      if (!lead) continue;
      for (const [field, value] of Object.entries(anafFields(found, at))) {
        if (field === "name" && lead.name) lead.officialName = value;
        else if (!lead[field]) lead[field] = value;
      }
      filled += 1;
    }
    for (const missing of json.notFound ?? []) {
      const lead = batch.find((item) => cuiKey(val(item.cui)) === String(missing));
      if (lead) lead.notes = [lead.notes, "CUI necunoscut la ANAF"].filter(Boolean).join("; ");
    }
    await sleep(1100); // ANAF: one request a second.
  }
  writeLeads(args.leads, data);
  console.log(JSON.stringify({ withCui: withCui.length, filled }, null, 1));
}

/** Overpass QL for named businesses with these tags inside an administrative area. */
export function overpassQuery(area, tags, max = 300) {
  const safe = (text) => String(text).replace(/["\\]/g, "");
  const selectors = tags
    .map((tag) => {
      const [key, value] = String(tag).split("=");
      return value
        ? `nwr["${safe(key)}"="${safe(value)}"]["name"](area.a);`
        : `nwr["${safe(key)}"]["name"](area.a);`;
    })
    .join("");
  return `[out:json][timeout:90];area["name"="${safe(area)}"]["boundary"="administrative"]->.a;(${selectors});out center tags ${Math.max(1, Math.min(2000, max))};`;
}

/** An OSM element -> a candidate lead; every field's source is the element's own page. */
export function osmCandidate(element, at) {
  const tags = element.tags ?? {};
  const src = `https://www.openstreetmap.org/${element.type}/${element.id}`;
  const pick = (...keys) => keys.map((key) => tags[key]).find(Boolean);
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const candidate = {
    name: sourced(tags.name, src, at),
    category: sourced(
      pick("leisure", "amenity", "shop", "office", "club", "sport", "craft", "tourism"),
      src,
      at,
    ),
    city: sourced(pick("addr:city", "addr:place"), src, at),
    address: sourced(street || null, src, at),
    website: sourced(pick("website", "contact:website", "url"), src, at),
    email: sourced(pick("email", "contact:email"), src, at),
    phone: sourced(pick("phone", "contact:phone", "contact:mobile"), src, at),
    lat: element.lat ?? element.center?.lat ?? null,
    lon: element.lon ?? element.center?.lon ?? null,
    foundVia: ["OpenStreetMap"],
  };
  const socials = {};
  const facebook = pick("contact:facebook", "facebook");
  const instagram = pick("contact:instagram", "instagram");
  if (facebook) socials.facebook = sourced(facebook, src, at);
  if (instagram) socials.instagram = sourced(instagram, src, at);
  if (Object.keys(socials).length) candidate.socials = socials;
  return Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== null));
}

async function cmdOverpass(args) {
  const data = readLeads(args.leads);
  const tags = [].concat(args.tag ?? []);
  if (!args.area || tags.length === 0)
    throw new Error("Give --area <name> and at least one --tag key=value.");
  const query = overpassQuery(args.area, tags, Number(args.max ?? 300));
  const url = `${SOURCES.overpass}?data=${encodeURIComponent(query)}`;
  const { status, text } = await apiRequest(url, {
    headers: { "User-Agent": userAgent(args.contact) },
  });
  if (status !== 200)
    throw new Error(`Overpass answered HTTP ${status}; try again in a few minutes.`);
  const at = new Date().toISOString();
  const elements = JSON.parse(text).elements ?? [];
  const result = mergeCandidates(
    data,
    elements.map((element) => osmCandidate(element, at)),
  );
  data.meta.attribution = "Date © OpenStreetMap contributors, ODbL (openstreetmap.org/copyright)";
  writeLeads(args.leads, data);
  console.log(JSON.stringify({ found: elements.length, ...result }, null, 1));
}

/** A Places (New) result -> a candidate lead; the source is the place's Google Maps page. */
export function placeCandidate(place, at) {
  const src = place.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`;
  const candidate = {
    name: sourced(place.displayName?.text, src, at),
    category: sourced(place.primaryType, src, at),
    address: sourced(place.formattedAddress, src, at),
    website: sourced(place.websiteUri, src, at),
    phone: sourced(place.internationalPhoneNumber || place.nationalPhoneNumber, src, at),
    lat: place.location?.latitude ?? null,
    lon: place.location?.longitude ?? null,
    placeId: place.id,
    foundVia: ["Google Places API"],
  };
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
    candidate.notes = `Google: ${place.businessStatus}`;
  }
  return Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== null));
}

async function cmdPlaces(args) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "GOOGLE_PLACES_API_KEY is not set; Google Places is optional.",
      }),
    );
    return;
  }
  if (!args.query) throw new Error('Give --query "<what> in <where>".');
  const data = readLeads(args.leads);
  const max = Math.min(Number(args.max ?? 60), 200);
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.internationalPhoneNumber",
    "places.location",
    "places.businessStatus",
    "places.primaryType",
    "places.googleMapsUri",
    "nextPageToken",
  ].join(",");
  const candidates = [];
  let pageToken;
  while (candidates.length < max) {
    const { status, text } = await apiRequest(SOURCES.places, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify({
        textQuery: args.query,
        pageSize: 20,
        ...(pageToken ? { pageToken } : {}),
      }),
    });
    if (status !== 200)
      throw new Error(`Google Places answered HTTP ${status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    const at = new Date().toISOString();
    candidates.push(...(json.places ?? []).map((place) => placeCandidate(place, at)));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
    await sleep(2000);
  }
  const result = mergeCandidates(data, candidates.slice(0, max));
  data.meta.googlePlaces =
    "Date Google Places: păstrează doar ID-urile locurilor peste 30 de zile (termenii Google).";
  writeLeads(args.leads, data);
  console.log(JSON.stringify({ found: candidates.length, ...result }, null, 1));
}

const SOCIAL = [
  [
    "facebook",
    /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|profile\.php)[A-Za-z0-9._/-]+/gi,
  ],
  [
    "instagram",
    /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|stories\/|explore\/)[A-Za-z0-9._]+\/?/gi,
  ],
  ["tiktok", /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._]+/gi],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)[A-Za-z0-9._-]+/gi],
  ["linkedin", /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9._-]+/gi],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+40|0040|\b0)\s?(?:[237]\d{1,2})[\s./-]?\d{3}[\s.-]?\d{3,4}\b/g;
const CONTACT_LINK = /(contact|kontakt|despre|about|cine-suntem|date-de-contact|program)/i;

/** What a business's own page shows about itself: contacts, socials and plain web signals. */
export function extractPage(html, pageUrl, fetchedAt) {
  const text = htmlToText(html);
  const src = pageUrl;
  const out = { emails: [], phones: [], socials: {}, signals: [], links: [] };
  const mailtos = [...String(html).matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)].map((m) =>
    decodeURIComponent(m[1]),
  );
  for (const email of new Set([...mailtos, ...(text.match(EMAIL) ?? [])])) {
    const clean = email
      .trim()
      .toLowerCase()
      .replace(/[.,;]+$/, "");
    if (/\.(png|jpe?g|gif|webp|svg)$/.test(clean) || /example\.|sentry|wixpress/.test(clean))
      continue;
    out.emails.push(sourced(clean, src, fetchedAt));
  }
  const tels = [...String(html).matchAll(/href\s*=\s*["']tel:([^"']+)/gi)].map((m) => m[1]);
  for (const phone of new Set(
    [...tels, ...(text.match(PHONE) ?? [])].map((p) => p.replace(/[^\d+]/g, "")),
  )) {
    if (phone.replace(/\D/g, "").length >= 9) out.phones.push(sourced(phone, src, fetchedAt));
  }
  for (const [network, pattern] of SOCIAL) {
    const found = String(html).match(pattern);
    if (found?.length) out.socials[network] = sourced(found[0].replace(/\/$/, ""), src, fetchedAt);
  }
  const signal = (code, ro, en) => out.signals.push({ code, ro, en, src, at: fetchedAt });
  const url = new URL(pageUrl);
  if (url.protocol !== "https:")
    signal(
      "no-https",
      "site fără HTTPS (apare „nesigur” în browser)",
      "no HTTPS (browsers show “not secure”)",
    );
  if (!/<meta[^>]+name=["']viewport["']/i.test(html))
    signal(
      "not-mobile",
      "site neadaptat pentru telefon (fără viewport)",
      "not built for phones (no viewport)",
    );
  const years = [
    ...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2}|19\d{2})/gi),
  ].map((m) => Number(m[1]));
  const year = years.length ? Math.max(...years) : null;
  if (year && year <= new Date(fetchedAt).getUTCFullYear() - 2) {
    signal(
      "old-copyright",
      `an de copyright vechi pe site (${year})`,
      `old copyright year on the site (${year})`,
    );
  }
  const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(html)?.[1];
  if (generator) out.generator = sourced(generator, src, fetchedAt);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) out.title = sourced(htmlToText(title), src, fetchedAt);
  if (!/<meta[^>]+name=["']description["']/i.test(html))
    signal(
      "no-description",
      "fără descriere pentru Google (meta description)",
      "no description for Google (meta description)",
    );
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const link = new URL(match[1], url);
      if (link.host === url.host && CONTACT_LINK.test(link.pathname)) out.links.push(link.href);
    } catch {
      // not a link
    }
  }
  out.links = [...new Set(out.links)];
  out.lastYear = year;
  return out;
}

/** Reads a lead's site (home + a few contact/about pages) through the gate and keeps a dossier. */
export async function dossierFor(lead, gate, { pages = 3, render = null } = {}) {
  const site = val(lead.website);
  const dossier = {
    id: lead.id,
    site,
    pages: [],
    skipped: [],
    signals: [],
    at: new Date().toISOString(),
  };
  if (!site) {
    dossier.signals.push({
      code: "no-site",
      ro: "nu are site propriu găsit",
      en: "no website of its own found",
      src: null,
      at: dossier.at,
    });
    return { dossier, found: null };
  }
  let start;
  try {
    start = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
  } catch {
    dossier.skipped.push({ url: site, reason: "not a valid address" });
    return { dossier, found: null };
  }
  if (/(facebook|instagram)\.com$/.test(start.host.replace(/^www\./, ""))) {
    dossier.signals.push({
      code: "social-only",
      ro: "are doar pagină de social media în loc de site",
      en: "only a social media page instead of a website",
      src: start.href,
      at: dossier.at,
    });
    return { dossier, found: null };
  }
  const found = { emails: [], phones: [], socials: {}, signals: [] };
  const queue = [start.href];
  const seen = new Set();
  while (queue.length && dossier.pages.length + dossier.skipped.length < pages + 1) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let page = await gate.get(url);
    // A page that is empty without JavaScript is read once more in the browser, same rules.
    if (
      render &&
      !page.skipped &&
      page.status === 200 &&
      htmlToText(page.text).length < 200 &&
      /<script/i.test(page.text)
    ) {
      const rendered = await render(url);
      if (!rendered.skipped) page = rendered;
    }
    if (page.skipped) {
      dossier.skipped.push({
        url,
        reason: page.reason,
        termsUrl: page.termsUrl ?? null,
        at: page.at,
      });
      // A whole site closed (terms, refusal, CAPTCHA, robots.txt down): stop. One page closed: next.
      if (/terms|refused|CAPTCHA|slow down|could not be read|closed to bots/.test(page.reason))
        break;
      continue;
    }
    if (page.status < 200 || page.status >= 300) {
      dossier.skipped.push({
        url,
        reason: `HTTP ${page.status || "no answer"}`,
        at: page.fetchedAt,
      });
      continue;
    }
    const extracted = extractPage(page.text, page.source, page.fetchedAt);
    dossier.pages.push({ url: page.source, at: page.fetchedAt, title: extracted.title?.v ?? null });
    found.emails.push(...extracted.emails);
    found.phones.push(...extracted.phones);
    found.socials = { ...extracted.socials, ...found.socials };
    if (dossier.pages.length === 1) {
      found.signals.push(...extracted.signals);
      if (extracted.generator) dossier.generator = extracted.generator;
      if (extracted.title) dossier.title = extracted.title;
      for (const link of extracted.links.slice(0, pages)) queue.push(link);
    }
  }
  if (dossier.pages.length > 0) {
    if (!found.socials.facebook && !found.socials.instagram) {
      found.signals.push({
        code: "no-social-links",
        ro: "site-ul nu trimite spre Facebook sau Instagram",
        en: "the site links to no Facebook or Instagram",
        src: dossier.pages[0].url,
        at: dossier.pages[0].at,
      });
    }
    if (found.emails.length === 0 && found.phones.length === 0) {
      found.signals.push({
        code: "no-contact",
        ro: "pe site nu apare un e-mail sau un telefon",
        en: "no e-mail or phone on the site",
        src: dossier.pages[0].url,
        at: dossier.pages[0].at,
      });
    }
  }
  dossier.signals.push(...found.signals);
  return { dossier, found };
}

async function cmdSite(args) {
  if (!args.contact) {
    throw new Error(
      "Give --contact <your business e-mail or site>: it goes in the user agent so site owners can reach you.",
    );
  }
  const data = readLeads(args.leads);
  const folder = NodePath.dirname(NodePath.resolve(args.leads));
  const dossierDir = NodePath.join(folder, "dossiers");
  NodeFS.mkdirSync(dossierDir, { recursive: true });
  const gate = new PublicWebGate({
    contact: args.contact,
    backoffBaseMs: Number(args.backoff ?? 2000),
    limiter: new DomainLimiter({ delayMs: Number(args.delay ?? 2000) }),
  });
  const targets = data.leads.filter((lead) =>
    args.id ? lead.id === args.id : !lead.dossier || args.again,
  );
  const pages = Math.max(0, Math.min(6, Number(args.pages ?? 3)));
  const playwright = args.render ? await loadPlaywright() : null;
  const render = playwright ? (url) => renderPage(gate, url, { playwright }) : null;
  let index = 0;
  const worker = async () => {
    while (index < targets.length) {
      const lead = targets[index++];
      const { dossier, found } = await dossierFor(lead, gate, { pages, render });
      if (found) {
        const email = found.emails.find(
          (item) => !["person", "invalid"].includes(classifyEmail(item.v)),
        );
        const phone = found.phones[0];
        if (email && !lead.email) lead.email = email;
        if (phone && !lead.phone) lead.phone = phone;
        lead.socials = { ...found.socials, ...lead.socials };
      }
      lead.dossier = {
        file: `dossiers/${lead.id}.json`,
        signals: dossier.signals,
        skipped: dossier.skipped,
        at: dossier.at,
      };
      for (const skip of dossier.skipped) data.skipped.push({ lead: lead.id, ...skip });
      NodeFS.writeFileSync(
        NodePath.join(dossierDir, `${lead.id}.json`),
        JSON.stringify(dossier, null, 1),
      );
    }
  };
  // Sites differ, so up to 4 leads at a time; the limiter keeps any one site at 2 requests.
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
  writeLeads(args.leads, data);
  NodeFS.appendFileSync(
    NodePath.join(folder, "crawl-log.jsonl"),
    gate.log.map((entry) => JSON.stringify(entry)).join("\n") + (gate.log.length ? "\n" : ""),
  );
  console.log(JSON.stringify({ read: targets.length, skipped: gate.skipped().length }, null, 1));
}

/** Same-site links of a page that match `follow` (a regex source), without fragments. */
export function followLinks(html, pageUrl, follow) {
  const base = new URL(pageUrl);
  const pattern = follow ? new RegExp(follow, "i") : null;
  const out = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const link = new URL(match[1], base);
      link.hash = "";
      if (link.host !== base.host || !/^https?:$/.test(link.protocol)) continue;
      if (pattern && !pattern.test(link.href)) continue;
      if (!out.includes(link.href)) out.push(link.href);
    } catch {
      // not a link
    }
  }
  return out;
}

/**
 * Reads a public list and its next pages under the rules and saves each page. With Crawlee
 * (ZEN_CRAWLEE_MODULES) its CheerioCrawler walks (2 at a time, pauses, retries) and every request
 * still passes the gate first; without it the gate walks the pages itself.
 */
export async function crawlList({ start, follow, maxPages = 30, out, gate, crawleeModules }) {
  NodeFS.mkdirSync(out, { recursive: true });
  const saved = [];
  const save = (url, html, at) => {
    const file = NodePath.join(out, `page-${String(saved.length + 1).padStart(3, "0")}.html`);
    NodeFS.writeFileSync(file, html);
    saved.push({
      url,
      file,
      at,
      title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null,
    });
  };
  if (crawleeModules) {
    const { createRequire } = await import("node:module");
    const require = createRequire(NodePath.join(crawleeModules, "zen.cjs"));
    process.env.CRAWLEE_STORAGE_DIR ??= NodePath.join(out, ".crawlee");
    const { CheerioCrawler, Configuration, log } = require("@crawlee/cheerio");
    log.setLevel(log.LEVELS.OFF); // stdout stays the JSON summary; the gate keeps the log.
    const delaySecs = Math.ceil(gate.limiter.delayFor(new URL(start).host) / 1000);
    const crawler = new CheerioCrawler(
      {
        maxConcurrency: 2,
        useSessionPool: false,
        persistCookiesPerSession: false,
        maxRequestsPerCrawl: maxPages,
        maxRequestRetries: 3,
        sameDomainDelaySecs: Math.max(1, delaySecs),
        // robots.txt is checked by the gate in the hook below, with our own user agent (Crawlee's
        // own robots.txt request would go out with a browser's user agent).
        respectRobotsTxtFile: false,
        preNavigationHooks: [
          async ({ request }, gotOptions) => {
            const verdict = await gate.check(request.url);
            if (!verdict.allowed) {
              request.noRetry = true;
              gate.note({
                url: request.url,
                skipped: true,
                reason: verdict.reason,
                termsUrl: verdict.termsUrl ?? null,
              });
              throw new Error(`skipped: ${verdict.reason}`);
            }
            // Our own honest headers only: no generated browser fingerprint headers.
            gotOptions.useHeaderGenerator = false;
            gotOptions.headers = { ...gotOptions.headers, "user-agent": gate.ua };
          },
        ],
        async requestHandler({ request, body, response, enqueueLinks }) {
          const html = String(body);
          if (looksBlocked(response?.statusCode, html)) {
            gate.note({
              url: request.url,
              skipped: true,
              reason: "the site refused access or shows a bot check; not worked around",
            });
            return;
          }
          gate.note({
            url: request.url,
            kind: "page",
            status: response?.statusCode,
            via: "crawlee",
          });
          save(request.loadedUrl ?? request.url, html, gate.stamp());
          const next = followLinks(html, request.loadedUrl ?? request.url, follow);
          await enqueueLinks({ urls: next });
        },
        failedRequestHandler({ request }, error) {
          if (!String(error?.message).startsWith("skipped:")) {
            gate.note({
              url: request.url,
              skipped: true,
              reason: `could not be read: ${error?.message ?? error}`,
            });
          }
        },
      },
      new Configuration({ persistStorage: false }),
    );
    await crawler.run([start]);
    return { engine: "crawlee", saved };
  }
  const queue = [start];
  const seen = new Set();
  while (queue.length && saved.length < maxPages) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await gate.get(url);
    if (page.skipped || page.status !== 200) continue;
    save(page.source, page.text, page.fetchedAt);
    for (const link of followLinks(page.text, page.source, follow))
      if (!seen.has(link)) queue.push(link);
  }
  return { engine: "gate", saved };
}

const looksBlocked = (status, html) =>
  status === 401 ||
  status === 403 ||
  /(cf-challenge|challenge-platform|<title>\s*just a moment|verify you are (a )?human)/i.test(
    String(html).slice(0, 20000),
  );

async function cmdAdd(args) {
  if (!args.from)
    throw new Error(
      "Give --from <candidates.json>: a list of leads whose fields are { v, src, at }.",
    );
  const data = readLeads(args.leads);
  const list = JSON.parse(NodeFS.readFileSync(args.from, "utf8"));
  const candidates = Array.isArray(list) ? list : (list.leads ?? []);
  const refused = [];
  const ok = candidates.filter((candidate, i) => {
    const missing = unsourcedFields(candidate);
    if (!candidate.name?.v || !candidate.name?.src)
      refused.push(`#${i + 1}: the name needs { v, src, at }`);
    else if (missing.length)
      refused.push(`#${i + 1} ${candidate.name.v}: no source for ${missing.join(", ")}`);
    else return true;
    return false;
  });
  const result = mergeCandidates(data, ok);
  if (args.meta) data.meta = { ...data.meta, ...JSON.parse(args.meta) };
  writeLeads(args.leads, data);
  console.log(JSON.stringify({ ...result, refused }, null, 1));
  if (refused.length) process.exitCode = 2;
}

async function cmdCrawl(args) {
  if (!args.contact) throw new Error("Give --contact <your business e-mail or site>.");
  if (!args.start) throw new Error("Give --start <the list's first page>.");
  const folder = NodePath.dirname(NodePath.resolve(args.leads));
  const out = NodePath.resolve(
    args.out ??
      NodePath.join(
        folder,
        "lists",
        (safeHost(args.start) ?? "list").replace(/[^a-z0-9.-]+/gi, "-"),
      ),
  );
  const gate = new PublicWebGate({
    contact: args.contact,
    backoffBaseMs: Number(args.backoff ?? 2000),
    limiter: new DomainLimiter({ delayMs: Number(args.delay ?? 2000) }),
  });
  const modules =
    process.env.ZEN_CRAWLEE_MODULES && NodeFS.existsSync(process.env.ZEN_CRAWLEE_MODULES)
      ? process.env.ZEN_CRAWLEE_MODULES
      : null;
  const result = await crawlList({
    start: args.start,
    follow: args.follow ?? null,
    maxPages: Math.max(1, Math.min(200, Number(args.max ?? 30))),
    out,
    gate,
    crawleeModules: args.engine === "gate" ? null : modules,
  });
  NodeFS.writeFileSync(
    NodePath.join(out, "pages.json"),
    JSON.stringify({ start: args.start, ...result, log: gate.log }, null, 1),
  );
  const data = readLeads(args.leads);
  for (const skip of gate.skipped())
    data.skipped.push({
      url: skip.url,
      reason: skip.reason,
      termsUrl: skip.termsUrl ?? null,
      at: skip.at,
    });
  writeLeads(args.leads, data);
  console.log(
    JSON.stringify(
      {
        engine: result.engine,
        pages: result.saved.length,
        skipped: gate.skipped().length,
        folder: out,
      },
      null,
      1,
    ),
  );
}

export function dedupe(data, existingRows = []) {
  const existingKeys = new Set(existingRows.flatMap((row) => leadKeys(row)));
  const kept = [];
  let duplicates = 0;
  let known = 0;
  for (const lead of data.leads) {
    const keys = leadKeys(lead);
    if (keys.some((key) => existingKeys.has(key))) {
      data.skipped.push({
        lead: lead.id,
        name: val(lead.name),
        reason: "already in your existing list",
        at: new Date().toISOString(),
      });
      known += 1;
      continue;
    }
    const twin = kept.find((other) => leadKeys(other).some((key) => keys.includes(key)));
    if (twin) {
      for (const [field, value] of Object.entries(lead))
        if (twin[field] === undefined) twin[field] = value;
      duplicates += 1;
      continue;
    }
    kept.push(lead);
  }
  data.leads = kept;
  return { kept: kept.length, duplicates, alreadyKnown: known };
}

/** Rows of the person's own list (CSV/XLSX) -> plain leads for matching. */
export function existingFromRows(rows) {
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => fold(cell));
  const col = (...names) => header.findIndex((cell) => names.some((name) => cell.includes(name)));
  const c = {
    name: col("nume", "name", "denumire", "firma", "company", "club"),
    site: col("site", "web", "url"),
    email: col("email", "e-mail", "mail"),
    phone: col("telefon", "phone", "tel"),
    cui: col("cui", "cif", "vat", "cod fiscal"),
    city: col("oras", "city", "localitate"),
  };
  return rows.slice(1).map((row) => ({
    name: row[c.name] ?? "",
    website: row[c.site] ?? "",
    email: row[c.email] ?? "",
    phone: row[c.phone] ?? "",
    cui: row[c.cui] ?? "",
    city: row[c.city] ?? "",
  }));
}

const REASONS = {
  ro: {
    clear: (text) => `nevoie clară: ${text}`,
    probable: (text) => `nevoie probabilă: ${text}`,
    contact: "contact de firmă găsit",
    noContact: "fără contact de firmă",
    partial: "doar telefon, fără e-mail",
    noNeed: "nu se vede o nevoie pentru ce oferi",
    inactive: "firmă inactivă sau radiată la ANAF",
    big: "firmă mare, probabil are deja furnizor",
  },
  en: {
    clear: (text) => `clear need: ${text}`,
    probable: (text) => `probable need: ${text}`,
    contact: "business contact found",
    noContact: "no business contact",
    partial: "phone only, no e-mail",
    noNeed: "no visible need for what you sell",
    inactive: "inactive or deregistered company (ANAF)",
    big: "large company, likely has a supplier already",
  },
};

/**
 * A = a clear need and a business e-mail; B = a probable need, or a clear need with only a phone
 * or no contact; C = no visible need, inactive, or a large company. Reasons say why.
 */
export function scoreLead(lead, lang = "ro") {
  const t = REASONS[lang] ?? REASONS.ro;
  const opportunities = lead.opportunities ?? [];
  const clear = opportunities.filter((item) => item.strength === "clear");
  const probable = opportunities.filter((item) => item.strength !== "clear");
  const hasEmail = Boolean(val(lead.email));
  const hasPhone = Boolean(val(lead.phone));
  const reasons = [];
  for (const item of clear.slice(0, 2)) reasons.push(t.clear(item.text));
  for (const item of probable.slice(0, 2)) reasons.push(t.probable(item.text));
  if (hasEmail) reasons.push(t.contact);
  else if (hasPhone) reasons.push(t.partial);
  else reasons.push(t.noContact);
  const inactive =
    val(lead.inactive) === true || /radiat|inactiv/i.test(String(val(lead.status) ?? ""));
  if (inactive) return { score: "C", reasons: [t.inactive, ...reasons] };
  if (lead.large === true) return { score: "C", reasons: [t.big, ...reasons] };
  if (clear.length === 0 && probable.length === 0)
    return { score: "C", reasons: [t.noNeed, ...reasons] };
  if (clear.length > 0 && hasEmail) return { score: "A", reasons };
  return { score: "B", reasons };
}

export function checkLeads(data, options = {}) {
  const problems = [];
  const fixed = [];
  data.leads = data.leads.map((lead) => {
    const where = `${lead.id} (${val(lead.name) ?? "?"})`;
    for (const field of unsourcedFields(lead))
      problems.push(`${where}: ${field} has no source URL or date`);
    if (!lead.name) problems.push(`${where}: no name`);
    for (const item of lead.opportunities ?? []) {
      if (!item.src) problems.push(`${where}: opportunity "${item.text}" has no source`);
    }
    const text = JSON.stringify(lead);
    if (containsPersonalId(text))
      problems.push(`${where}: holds what looks like a personal ID number (CNP); remove it`);
    const { lead: clean, dropped } = b2bOnly(lead, { officialHosts: OFFICIAL_HOSTS, ...options });
    for (const item of dropped)
      fixed.push(
        `${where}: dropped ${item.field}${item.value ? ` ${item.value}` : ""} (${item.reason})`,
      );
    return clean;
  });
  return { problems, fixed };
}

const L = {
  ro: {
    leads: "Leaduri",
    sources: "Surse",
    skipped: "Sărite",
    cols: [
      "Scor",
      "Nume",
      "Categorie",
      "Oraș",
      "Site",
      "E-mail",
      "Telefon",
      "Facebook",
      "Instagram",
      "Ce lipsește / oportunitate",
      "De ce acest scor",
      "Sursa principală",
      "Citit la",
    ],
    srcCols: ["Lead", "Câmp", "Valoare", "Sursa", "Citit la"],
    skipCols: ["Lead", "Adresa", "Motiv", "Termeni", "Când"],
    title: (meta) =>
      `Radar de clienți: ${meta.niche ?? ""}${meta.region ? `, ${meta.region}` : ""}`,
  },
  en: {
    leads: "Leads",
    sources: "Sources",
    skipped: "Skipped",
    cols: [
      "Score",
      "Name",
      "Category",
      "City",
      "Website",
      "E-mail",
      "Phone",
      "Facebook",
      "Instagram",
      "What is missing / opportunity",
      "Why this score",
      "Main source",
      "Read at",
    ],
    srcCols: ["Lead", "Field", "Value", "Source", "Read at"],
    skipCols: ["Lead", "Address", "Reason", "Terms", "When"],
    title: (meta) => `Client radar: ${meta.niche ?? ""}${meta.region ? `, ${meta.region}` : ""}`,
  },
};

export function sourceRows(lead) {
  const rows = [];
  const walk = (value, path) => {
    if (value && typeof value === "object" && "v" in value) {
      rows.push([val(lead.name), path, String(value.v), value.src, value.at]);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) =>
        item?.src && item?.text
          ? rows.push([val(lead.name), `${path}[${i}]`, item.text, item.src, item.at ?? ""])
          : walk(item, `${path}[${i}]`),
      );
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key);
    }
  };
  for (const [key, value] of Object.entries(lead)) if (key !== "dossier") walk(value, key);
  return rows;
}

const ORDER = { A: 0, B: 1, C: 2 };

export function exportRows(data) {
  return [...data.leads]
    .sort(
      (a, b) =>
        (ORDER[a.score] ?? 3) - (ORDER[b.score] ?? 3) ||
        String(val(a.name)).localeCompare(String(val(b.name)), "ro"),
    )
    .map((lead) => [
      lead.score ?? "",
      val(lead.name) ?? "",
      val(lead.category) ?? "",
      val(lead.city) ?? "",
      val(lead.website) ?? "",
      val(lead.email) ?? "",
      val(lead.phone) ?? "",
      val(lead.socials?.facebook) ?? "",
      val(lead.socials?.instagram) ?? "",
      (lead.opportunities ?? []).map((item) => item.text).join("; "),
      (lead.reasons ?? []).join("; "),
      lead.name?.src ?? "",
      lead.name?.at ? lead.name.at.slice(0, 10) : "",
    ]);
}

/** The dashboard: the template with the data inside (no network, opens from the folder). */
export function renderDashboard(data, lang = "ro") {
  const template = NodeFS.readFileSync(NodePath.join(here, "template", "dashboard.html"), "utf8");
  const payload = JSON.stringify({
    lang,
    meta: data.meta,
    leads: data.leads,
    skipped: data.skipped,
  }).replace(/</g, "\\u003c");
  return template
    .replace(/\/\*__RADAR_DATA__\*\/\s*null/, () => payload)
    .replace("__RADAR_TITLE__", () => escapeHtml(L[lang].title(data.meta)));
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function cmdExport(args) {
  const lang = args.lang === "en" ? "en" : "ro";
  const t = L[lang];
  const data = readLeads(args.leads);
  const out = NodePath.resolve(args.out ?? NodePath.dirname(args.leads));
  NodeFS.mkdirSync(out, { recursive: true });
  const rows = exportRows(data);
  NodeFS.writeFileSync(NodePath.join(out, "leaduri.csv"), `\ufeff${toCsv([t.cols, ...rows])}`);
  const sources = data.leads.flatMap(sourceRows);
  const skipped = data.skipped.map((item) => [
    item.lead ?? "",
    item.url ?? item.name ?? "",
    item.reason ?? "",
    item.termsUrl ?? "",
    (item.at ?? "").slice(0, 16),
  ]);
  const xlsx = writeXlsx({
    title: t.title(data.meta),
    accent: "121A2B",
    sheets: [
      {
        name: t.leads,
        title: t.title(data.meta),
        columns: t.cols.map((header, i) => ({
          header,
          width: [7, 30, 16, 14, 28, 26, 16, 28, 28, 44, 44, 34, 11][i],
          type: i >= 9 && i <= 10 ? "wrap" : "text",
        })),
        rows: rows.map((row) => ({ cells: row, style: row[0] === "A" ? "good" : "plain" })),
      },
      {
        name: t.sources,
        columns: t.srcCols.map((header, i) => ({ header, width: [28, 18, 34, 50, 22][i] })),
        rows: sources,
      },
      {
        name: t.skipped,
        columns: t.skipCols.map((header, i) => ({
          header,
          width: [24, 44, 60, 40, 17][i],
          type: i === 2 ? "wrap" : "text",
        })),
        rows: skipped.length ? skipped : [["", "", "", "", ""]],
      },
    ],
  });
  NodeFS.writeFileSync(NodePath.join(out, "leaduri.xlsx"), xlsx);
  NodeFS.writeFileSync(NodePath.join(out, "radar.html"), renderDashboard(data, lang));
  const counts = { A: 0, B: 0, C: 0 };
  for (const lead of data.leads) if (lead.score in counts) counts[lead.score] += 1;
  console.log(
    JSON.stringify(
      {
        csv: NodePath.join(out, "leaduri.csv"),
        xlsx: NodePath.join(out, "leaduri.xlsx"),
        dashboard: NodePath.join(out, "radar.html"),
        leads: data.leads.length,
        ...counts,
        withEmail: data.leads.filter((lead) => val(lead.email)).length,
        skipped: data.skipped.length,
      },
      null,
      1,
    ),
  );
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (args[key] === undefined) args[key] = value;
    else args[key] = [].concat(args[key], value);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!args.leads && command !== "help")
    throw new Error("Give --leads <file>.json (it is created when missing).");
  switch (command) {
    case "anaf":
      return cmdAnaf(args);
    case "overpass":
      return cmdOverpass(args);
    case "places":
      return cmdPlaces(args);
    case "add":
      return cmdAdd(args);
    case "crawl":
      return cmdCrawl(args);
    case "site":
      return cmdSite(args);
    case "dedupe": {
      const data = readLeads(args.leads);
      const existing = args.existing
        ? existingFromRows(readTable(args.existing).sheets[0]?.rows ?? [])
        : [];
      const result = dedupe(data, existing);
      writeLeads(args.leads, data);
      return console.log(JSON.stringify(result, null, 1));
    }
    case "score": {
      const data = readLeads(args.leads);
      const lang = args.lang === "en" ? "en" : (data.meta.lang ?? "ro");
      for (const lead of data.leads) Object.assign(lead, scoreLead(lead, lang));
      writeLeads(args.leads, data);
      const counts = { A: 0, B: 0, C: 0 };
      for (const lead of data.leads) counts[lead.score] += 1;
      return console.log(JSON.stringify(counts, null, 1));
    }
    case "check": {
      const data = readLeads(args.leads);
      const result = checkLeads(data);
      writeLeads(args.leads, data);
      console.log(JSON.stringify(result, null, 1));
      if (result.problems.length) process.exitCode = 2;
      return;
    }
    case "export":
      return cmdExport(args);
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
