// Zen Staff: the public-web rules of the research packs, as code (no dependencies): robots.txt,
// site terms, at most 2 requests per site with pauses and backoff, an honest user agent, no
// CAPTCHA or block work-arounds, a source for every value, business contacts only. The same
// file ships in client-radar, outreach-approved and competitor-radar (a test keeps them equal).

export const BOT_TOKEN = "ZenStaffBot";
export const MAX_PER_DOMAIN = 2;
export const DEFAULT_DELAY_MS = 2000;
export const MAX_CRAWL_DELAY_MS = 30000;
export const MAX_RETRY_AFTER_MS = 60000;
/** Pauses and backoff never go below 2 s for other people's sites (only this machine is exempt). */
export const MIN_DELAY_MS = 2000;

/** This machine (tests, a preview of your own site): the only host where shorter pauses are allowed. */
export function isLoopbackHost(host) {
  const name = String(host ?? "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return name === "localhost" || name === "::1" || /^127\./.test(name);
}

/** The pause for a host: at least 2 s anywhere but this machine. */
export function politeDelay(host, ms) {
  return isLoopbackHost(host) ? Math.max(0, ms) : Math.max(MIN_DELAY_MS, ms);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The user agent: names the bot, what it does and who to contact. Never a browser's string. */
export function userAgent(contact) {
  const who = String(contact ?? "").trim() || "contact not given";
  return `${BOT_TOKEN}/1.0 (public business research for a Zen Staff user; contact: ${who})`;
}

/** robots.txt text -> { groups: [{ agents, rules: [{ allow, path }], crawlDelay }], sitemaps }. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow allows everything: it adds no rule.
      if (value === "" && key === "disallow") continue;
      current.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const seconds = Number(value.replace(",", "."));
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }
  return { groups, sitemaps };
}

/** The groups that apply to `token`: the most specific agent name that matches, else `*`. */
export function robotsGroupsFor(robots, token = BOT_TOKEN) {
  const name = token.toLowerCase();
  const own = robots.groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && agent === name),
  );
  if (own.length > 0) return own;
  return robots.groups.filter((group) => group.agents.includes("*"));
}

const escapeRegex = (value) => value.replace(/[.+?^{}()|[\]\\]/g, "\\$&");

function ruleMatches(rulePath, path) {
  let pattern = rulePath;
  const anchored = pattern.endsWith("$");
  if (anchored) pattern = pattern.slice(0, -1);
  const source = pattern
    .split("*")
    .map((part) => escapeRegex(normalizePercent(part)))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

function normalizePercent(value) {
  try {
    return encodeURI(decodeURI(value));
  } catch {
    return value;
  }
}

/** { allowed, rule, crawlDelaySeconds } for a path (with its query string) on this site. */
export function robotsVerdict(robots, pathWithQuery, token = BOT_TOKEN) {
  const path = normalizePercent(pathWithQuery || "/");
  if (path === "/robots.txt") return { allowed: true, rule: null, crawlDelaySeconds: null };
  const groups = robotsGroupsFor(robots, token);
  let best = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!ruleMatches(rule.path, path)) continue;
      const length = rule.path.replace(/\$$/, "").length;
      if (
        !best ||
        length > best.length ||
        (length === best.length && rule.allow && !best.rule.allow)
      ) {
        best = { rule, length };
      }
    }
  }
  const delays = groups.map((group) => group.crawlDelay).filter((delay) => delay !== null);
  return {
    allowed: best ? best.rule.allow : true,
    rule: best ? `${best.rule.allow ? "Allow" : "Disallow"}: ${best.rule.path}` : null,
    crawlDelaySeconds: delays.length > 0 ? Math.max(...delays) : null,
  };
}

const AUTOMATION_WORDS = [
  /scrap(e|es|ed|ing|er|ers)\b/,
  /crawl(s|ed|ing|er|ers)?\b/,
  /spider(s|ing)?\b/,
  /\brobots?\b/,
  /\bbots?\b/,
  /automated (means|access|systems?|tools?|queries|collection|programs?|software|scripts?)/,
  /data mining/,
  /harvest(ing)?\b/,
  /extragere(a)? automat/,
  /extrage(rea)? (de )?date(lor)? (in mod |în mod )?automat/,
  /colectare(a)? automat/,
  /mijloace automate/,
  /programe automate/,
  /instrumente automate/,
  /roboti\b|roboți\b|robotilor|roboților/,
];
const PROHIBITION_WORDS = [
  /prohibit/,
  /not (be )?(permitted|allowed)/,
  /forbidden/,
  /\bmay not\b/,
  /\bmust not\b/,
  /\bshall not\b/,
  /\bcannot\b/,
  /\bno (person|user|one) (may|shall)/,
  /without (our |the )?(express |prior )?(written )?(consent|permission|authori[sz]ation)/,
  /interzis/,
  /se interzice/,
  /nu (este|e|va fi) (permis|permisa|permisă|admis)/,
  /nu (aveti|aveți|are|au) dreptul/,
  /nu (puteti|puteți|poate|pot) (sa |să )?(folosi|utiliza|accesa|extrage|copia)/,
  /fara (acordul|permisiunea|consimtamantul)|fără (acordul|permisiunea|consimțământul)/,
];

const fold = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replaceAll("ş", "ș")
    .replaceAll("ţ", "ț");

/**
 * Does this terms text forbid automated access? { forbids, sentence }: the first sentence that
 * names automated access (scraping, crawling, bots, data mining...) together with a prohibition.
 */
export function termsVerdict(text) {
  const plain = fold(htmlToText(text));
  for (const sentence of plain.split(/(?<=[.;!?])\s+|\n+/)) {
    if (!AUTOMATION_WORDS.some((word) => word.test(sentence))) continue;
    if (!PROHIBITION_WORDS.some((word) => word.test(sentence))) continue;
    return { forbids: true, sentence: sentence.trim().slice(0, 300) };
  }
  return { forbids: false, sentence: null };
}

const TERMS_LINK =
  /(terms|terms-of-use|terms-of-service|tos\b|legal|termeni|conditii|condiții|utilizare|politica-de-utilizare|regulament)/i;

/** Links to the site's own terms pages found in its HTML (same host, at most `limit`). */
export function findTermsLinks(html, baseUrl, limit = 2) {
  const base = new URL(baseUrl);
  const found = [];
  for (const match of String(html ?? "").matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const [, href, label] = match;
    if (!TERMS_LINK.test(href) && !TERMS_LINK.test(htmlToText(label))) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.host !== base.host || !/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    if (!found.includes(url.href)) found.push(url.href);
    if (found.length >= limit) break;
  }
  return found;
}

/** At most `maxPerDomain` (never more than 2) requests at a time per host, and a pause between starts. */
export class DomainLimiter {
  constructor({ maxPerDomain = MAX_PER_DOMAIN, delayMs = DEFAULT_DELAY_MS, now, wait } = {}) {
    this.maxPerDomain = Math.max(1, Math.min(MAX_PER_DOMAIN, maxPerDomain));
    this.delayMs = Math.max(0, delayMs);
    this.now = now ?? (() => Date.now());
    this.wait = wait ?? sleep;
    this.hosts = new Map();
  }

  host(name) {
    let state = this.hosts.get(name);
    if (!state) {
      state = {
        active: 0,
        queue: [],
        nextStart: 0,
        delayMs: politeDelay(name, this.delayMs),
        peak: 0,
      };
      this.hosts.set(name, state);
    }
    return state;
  }

  /** The site asked for a longer pause (Crawl-delay); capped at 30 s. */
  setDelay(hostName, ms) {
    const state = this.host(hostName);
    state.delayMs = Math.max(politeDelay(hostName, this.delayMs), Math.min(MAX_CRAWL_DELAY_MS, ms));
  }

  delayFor(hostName) {
    return this.host(hostName).delayMs;
  }

  peak(hostName) {
    return this.host(hostName).peak;
  }

  async run(url, task) {
    const hostName = new URL(url).host;
    const state = this.host(hostName);
    if (state.active >= this.maxPerDomain) {
      await new Promise((resolve) => state.queue.push(resolve));
    }
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    try {
      const start = Math.max(this.now(), state.nextStart);
      state.nextStart = start + state.delayMs;
      const waitMs = start - this.now();
      if (waitMs > 0) await this.wait(waitMs);
      return await task();
    } finally {
      state.active -= 1;
      state.queue.shift()?.();
    }
  }
}

/** Retry-After header -> milliseconds (seconds or an HTTP date), capped at 60 s. */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(MAX_RETRY_AFTER_MS, ms);
}

/** Exponential backoff with a little jitter: 1 s, 2 s, 4 s ... (base 1 s). */
export function backoffMs(attempt, baseMs = 1000, random = Math.random) {
  return Math.round(baseMs * 2 ** attempt * (1 + random() * 0.25));
}

const CHALLENGE_ANY =
  /(g-recaptcha|hcaptcha|h-captcha|cf-challenge|challenge-platform|cf_chl_|turnstile|<title>\s*just a moment|attention required! \| cloudflare|verify you are (a )?human|are you a robot|captcha)/i;
const CHALLENGE_PAGE =
  /(cf-challenge|challenge-platform|cf_chl_|<title>\s*just a moment|attention required! \| cloudflare|verify you are (a )?human|are you a robot\?|<title>[^<]*captcha[^<]*<\/title>)/i;

/**
 * A page that is a CAPTCHA or a bot check rather than content. An ordinary page with a reCAPTCHA
 * on its contact form is content; a 403/429/503 that mentions a CAPTCHA is a challenge.
 */
export function looksLikeChallenge(status, text) {
  const head = String(text ?? "").slice(0, 20000);
  if (status === 403 || status === 429 || status === 503) return CHALLENGE_ANY.test(head);
  if (status === 200) return CHALLENGE_PAGE.test(head);
  return false;
}

/**
 * Every request of a research pack goes through here. `check(url)` says whether a URL may be
 * read and why not; `get(url)` reads it politely or returns `{ skipped, reason }`.
 * Every request and every skip is logged (`log`), with the time.
 */
export class PublicWebGate {
  constructor({
    contact,
    fetchImpl,
    limiter,
    retries = 3,
    backoffBaseMs = 1000,
    timeoutMs = 30000,
    checkTerms = true,
    termsUrls = {},
    now,
    wait,
  } = {}) {
    this.ua = userAgent(contact);
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.limiter = limiter ?? new DomainLimiter({ wait });
    this.retries = Math.max(0, Math.min(5, retries));
    this.backoffBaseMs = backoffBaseMs;
    this.timeoutMs = timeoutMs;
    this.checkTerms = checkTerms;
    this.termsUrls = termsUrls;
    this.now = now ?? (() => new Date());
    this.wait = wait ?? sleep;
    this.robots = new Map();
    this.terms = new Map();
    this.blocked = new Map();
    this.log = [];
  }

  stamp() {
    return this.now().toISOString();
  }

  note(entry) {
    const full = { at: this.stamp(), ...entry };
    this.log.push(full);
    return full;
  }

  /** The skipped sites and pages, one line each, for the report. */
  skipped() {
    return this.log.filter((entry) => entry.skipped);
  }

  async rawGet(
    url,
    { accept = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } = {},
  ) {
    let attempt = 0;
    for (;;) {
      let response;
      let text = "";
      try {
        response = await this.limiter.run(url, () =>
          this.fetchImpl(url, {
            headers: { "User-Agent": this.ua, Accept: accept, "Accept-Language": "ro,en;q=0.8" },
            redirect: "follow",
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
        );
        text = await response.text();
      } catch (error) {
        if (attempt >= this.retries) {
          return {
            status: 0,
            text: "",
            error: String(error?.message ?? error),
            url,
            attempts: attempt + 1,
          };
        }
        await this.wait(backoffMs(attempt, politeDelay(new URL(url).host, this.backoffBaseMs)));
        attempt += 1;
        continue;
      }
      const status = response.status;
      const retryable = status === 429 || status >= 500;
      if (retryable && !looksLikeChallenge(status, text) && attempt < this.retries) {
        const after = retryAfterMs(response.headers.get("retry-after"), this.now().getTime());
        await this.wait(
          after ?? backoffMs(attempt, politeDelay(new URL(url).host, this.backoffBaseMs)),
        );
        attempt += 1;
        continue;
      }
      return {
        status,
        text,
        url: response.url || url,
        contentType: response.headers.get("content-type") ?? "",
        attempts: attempt + 1,
      };
    }
  }

  async robotsFor(origin) {
    if (this.robots.has(origin)) return this.robots.get(origin);
    const robotsUrl = `${origin}/robots.txt`;
    const result = await this.rawGet(robotsUrl, { accept: "text/plain,*/*;q=0.5" });
    let entry;
    if (result.status >= 200 && result.status < 300) {
      entry = { state: "parsed", robots: parseRobots(result.text), url: robotsUrl };
    } else if (result.status >= 400 && result.status < 500) {
      entry = { state: "missing", robots: parseRobots(""), url: robotsUrl };
    } else {
      // RFC 9309 2.3.1.4: unreachable robots.txt = assume the whole site is disallowed.
      entry = { state: "unreachable", robots: null, url: robotsUrl, status: result.status };
    }
    this.note({ url: robotsUrl, kind: "robots", status: result.status, state: entry.state });
    if (entry.robots) {
      const verdict = robotsVerdict(entry.robots, "/");
      if (verdict.crawlDelaySeconds !== null) {
        this.limiter.setDelay(new URL(origin).host, verdict.crawlDelaySeconds * 1000);
      }
    }
    this.robots.set(origin, entry);
    return entry;
  }

  robotsAllows(entry, url) {
    if (!entry.robots) return { allowed: false, rule: "robots.txt unreachable" };
    const parsed = new URL(url);
    return robotsVerdict(entry.robots, parsed.pathname + parsed.search);
  }

  async termsFor(origin) {
    if (!this.checkTerms) return { forbids: false, checked: [] };
    if (this.terms.has(origin)) return this.terms.get(origin);
    const pending = (async () => {
      const robots = await this.robotsFor(origin);
      const checked = [];
      let links = [...(this.termsUrls[origin] ?? [])];
      if (links.length === 0 && this.robotsAllows(robots, `${origin}/`).allowed) {
        const home = await this.rawGet(`${origin}/`);
        this.note({ url: `${origin}/`, kind: "terms-discovery", status: home.status });
        if (home.status >= 200 && home.status < 300)
          links = findTermsLinks(home.text, `${origin}/`);
      }
      for (const link of links) {
        if (!this.robotsAllows(robots, link).allowed) {
          checked.push({ url: link, readable: false });
          continue;
        }
        const page = await this.rawGet(link);
        this.note({ url: link, kind: "terms", status: page.status });
        if (page.status < 200 || page.status >= 300) continue;
        const verdict = termsVerdict(page.text);
        checked.push({ url: link, readable: true, forbids: verdict.forbids });
        if (verdict.forbids)
          return { forbids: true, url: link, sentence: verdict.sentence, checked };
      }
      return { forbids: false, checked };
    })();
    this.terms.set(origin, pending);
    const result = await pending;
    this.terms.set(origin, result);
    return result;
  }

  /** May this URL be read? { allowed, reason, rule?, termsUrl? } */
  async check(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: "not a valid address" };
    }
    if (!/^https?:$/.test(parsed.protocol))
      return { allowed: false, reason: "only http and https" };
    const origin = parsed.origin;
    const blocked = this.blocked.get(origin);
    if (blocked) return { allowed: false, reason: blocked };
    const robots = await this.robotsFor(origin);
    const verdict = this.robotsAllows(robots, url);
    if (!verdict.allowed) {
      return {
        allowed: false,
        reason:
          robots.state === "unreachable"
            ? "robots.txt could not be read (server error): the site is treated as closed to bots"
            : `robots.txt does not allow it (${verdict.rule})`,
        robotsUrl: robots.url,
      };
    }
    const terms = await this.termsFor(origin);
    if (terms.forbids) {
      return {
        allowed: false,
        reason: `the site's terms forbid automated access ("${terms.sentence}")`,
        termsUrl: terms.url,
      };
    }
    return { allowed: true, reason: null, robotsUrl: robots.url };
  }

  /** Reads a public page politely: { status, text, url, fetchedAt } or { skipped, reason }. */
  async get(url) {
    const verdict = await this.check(url);
    if (!verdict.allowed) {
      return this.note({
        url,
        skipped: true,
        reason: verdict.reason,
        termsUrl: verdict.termsUrl ?? null,
      });
    }
    const result = await this.rawGet(url);
    const fetchedAt = this.stamp();
    const origin = new URL(url).origin;
    if (
      result.status === 401 ||
      result.status === 403 ||
      looksLikeChallenge(result.status, result.text)
    ) {
      const reason =
        result.status === 401 || result.status === 403
          ? `the site refused access (HTTP ${result.status}); not retried, not worked around`
          : "the site shows a CAPTCHA or bot check; not solved, not worked around";
      this.blocked.set(origin, reason);
      return this.note({ url, skipped: true, reason, status: result.status });
    }
    if (result.status === 429) {
      const reason =
        "the site still asks us to slow down after the retries (HTTP 429); stopped for this site";
      this.blocked.set(origin, reason);
      return this.note({ url, skipped: true, reason, status: 429 });
    }
    this.note({ url, kind: "page", status: result.status, attempts: result.attempts });
    return { ...result, fetchedAt, source: result.url || url };
  }
}

/** A value with where it came from and when: { v, src, at }. */
export function sourced(value, src, at) {
  if (value === undefined || value === null || value === "") return null;
  if (!src) throw new Error("A value without a source URL is not kept.");
  return { v: value, src, at: at ?? new Date().toISOString() };
}

/** Fields of a record that hold a value without a source or a date. */
export function unsourcedFields(record, path = "") {
  const problems = [];
  for (const [key, value] of Object.entries(record ?? {})) {
    const where = path ? `${path}.${key}` : key;
    if (value && typeof value === "object" && "v" in value) {
      if (!value.src || !value.at) problems.push(where);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      problems.push(...unsourcedFields(value, where));
    }
  }
  return problems;
}

export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/?(p|div|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|nav|main)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const ROLE_MAILBOXES = new Set(
  (
    "office contact contacts info information hello hi salut sales vanzari vânzări comenzi orders order " +
    "rezervari rezervare booking bookings reservations reservation secretariat secretary admin " +
    "administratie administrare marketing pr press presa media support suport help ajutor service " +
    "servicii client clienti customer customers customerservice relatii relatiiclienti bun office1 " +
    "management manager director directiune conducere club team echipa general hr cariere careers " +
    "jobs juridic legal financiar contabilitate accounting billing facturare invoice facturi " +
    "achizitii procurement oferte ofertare comercial business partners parteneriate sponsorizari " +
    "events evenimente tickets bilete shop magazin receptie reception front frontdesk"
  ).split(/\s+/),
);

const FREE_MAIL =
  /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|gmx|mail|yandex|zoho)\.[a-z.]+$/;

/**
 * "role" (office@, contact@...), "person" (looks like a private person: first.last@, a free
 * mailbox with a person-like name) or "business" (a name of its own on the business's domain or a
 * brand-like mailbox). `firstNames` makes person detection stronger.
 */
export function classifyEmail(email, { firstNames = [] } = {}) {
  const match = /^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/i.exec(
    String(email ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!match) return "invalid";
  const [, local, domain] = match;
  const base = local.replace(/[0-9]+$/, "");
  if (ROLE_MAILBOXES.has(base) || ROLE_MAILBOXES.has(base.replace(/[._-]/g, ""))) return "role";
  const parts = base.split(/[._-]+/).filter(Boolean);
  const names = new Set(firstNames.map((name) => fold(name)));
  const nameLike =
    parts.length >= 2 && parts.length <= 3 && parts.every((part) => /^[a-z]{2,}$/.test(part));
  if (nameLike && !parts.some((part) => ROLE_MAILBOXES.has(part))) return "person";
  if (parts.some((part) => names.has(part))) return "person";
  if (
    FREE_MAIL.test(domain) &&
    names.size > 0 &&
    [...names].some((name) => base.startsWith(name))
  ) {
    return "person";
  }
  return "business";
}

const PERSONAL_PROFILE =
  /(facebook\.com\/(profile\.php|people\/)|linkedin\.com\/in\/|instagram\.com\/stories\/)/i;

/**
 * Keeps only business contact fields of a lead (name, company id, site, business socials, the
 * business's own e-mail and phone, city/address, category) and drops the rest with a reason.
 * A phone or e-mail is kept only when its source is the business's own page or a public register.
 */
export function b2bOnly(lead, { firstNames = [], officialHosts = [] } = {}) {
  const KEEP = new Set([
    "id",
    "name",
    "cui",
    "category",
    "city",
    "county",
    "country",
    "address",
    "website",
    "email",
    "phone",
    "socials",
    "lat",
    "lon",
    "opportunities",
    "score",
    "reasons",
    "notes",
    "status",
    "source",
    "sources",
    "foundVia",
    "dossier",
    "extra",
  ]);
  const kept = {};
  const dropped = [];
  const ownHost = lead.website?.v ? safeHost(lead.website.v) : null;
  const trusted = (src) => {
    const host = safeHost(src);
    if (!host) return false;
    if (
      ownHost &&
      (host === ownHost || host.endsWith(`.${ownHost}`) || ownHost.endsWith(`.${host}`))
    )
      return true;
    return officialHosts.some((official) => host === official || host.endsWith(`.${official}`));
  };
  for (const [key, value] of Object.entries(lead)) {
    if (!KEEP.has(key)) {
      dropped.push({ field: key, reason: "not a business contact field" });
      continue;
    }
    kept[key] = value;
  }
  for (const key of ["email", "phone"]) {
    const value = kept[key];
    if (!value) continue;
    const list = Array.isArray(value) ? value : [value];
    const ok = list.filter((item) => {
      if (!item?.v || !item.src) {
        dropped.push({ field: key, reason: "no source" });
        return false;
      }
      if (key === "email") {
        const kind = classifyEmail(item.v, { firstNames });
        if (kind === "invalid" || kind === "person") {
          dropped.push({
            field: key,
            value: item.v,
            reason:
              kind === "person" ? "looks like a private person's address" : "not an e-mail address",
          });
          return false;
        }
        if (kind === "business" && !trusted(item.src)) {
          dropped.push({
            field: key,
            value: item.v,
            reason: "not published by the business itself",
          });
          return false;
        }
      }
      if (key === "phone" && !trusted(item.src)) {
        dropped.push({ field: key, value: item.v, reason: "not published by the business itself" });
        return false;
      }
      return true;
    });
    if (ok.length === 0) delete kept[key];
    else kept[key] = Array.isArray(value) ? ok : ok[0];
  }
  if (kept.socials) {
    for (const [network, item] of Object.entries(kept.socials)) {
      if (item?.v && PERSONAL_PROFILE.test(item.v)) {
        dropped.push({
          field: `socials.${network}`,
          value: item.v,
          reason: "a personal profile, not a business page",
        });
        delete kept.socials[network];
      }
    }
  }
  return { lead: kept, dropped };
}

export function safeHost(url) {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Personal ids that never belong in a lead list (Romanian CNP, card numbers). */
export function containsPersonalId(text) {
  const value = String(text ?? "");
  return /\b[1-8]\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6}\b/.test(value);
}

/** Playwright from the Zen toolchain (ZEN_PLAYWRIGHT_MODULES + ZEN_CHROME), or null. */
export async function loadPlaywright(env = process.env) {
  const modules = env.ZEN_PLAYWRIGHT_MODULES;
  const chrome = env.ZEN_CHROME;
  if (!modules || !chrome) return null;
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  try {
    const require = createRequire(join(modules, "zen.cjs"));
    return { chromium: require("playwright-core").chromium, chrome };
  } catch {
    return null;
  }
}

/**
 * Renders a page in headless Chrome under the same rules: the page and every request it makes
 * for data (document, xhr, fetch) pass the gate (robots.txt, terms, 2 per site, pauses); images,
 * media and fonts are not loaded; the user agent is the honest one; a CAPTCHA stops the site.
 * Returns what `gate.get` returns.
 */
export async function renderPage(gate, url, { playwright, timeoutMs = 45000 } = {}) {
  const verdict = await gate.check(url);
  if (!verdict.allowed)
    return gate.note({
      url,
      skipped: true,
      reason: verdict.reason,
      termsUrl: verdict.termsUrl ?? null,
    });
  const pw = playwright ?? (await loadPlaywright());
  if (!pw)
    return gate.note({
      url,
      skipped: true,
      reason: "the browser tool is not prepared (Playwright); read without JavaScript instead",
    });
  const browser = await pw.chromium.launch({ executablePath: pw.chrome, headless: true });
  try {
    const context = await browser.newContext({ userAgent: gate.ua, serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const type = request.resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      if (type === "document" || type === "xhr" || type === "fetch") {
        const allowed = await gate.check(request.url());
        if (!allowed.allowed) {
          gate.note({ url: request.url(), skipped: true, reason: allowed.reason, during: url });
          return route.abort();
        }
        return gate.limiter.run(request.url(), () => route.continue());
      }
      return route.continue();
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    const status = response?.status() ?? 0;
    const text = await page.content();
    const fetchedAt = gate.stamp();
    if (status === 401 || status === 403 || looksLikeChallenge(status, text)) {
      const reason = "the site refused access or shows a bot check; not worked around";
      gate.blocked.set(new URL(url).origin, reason);
      return gate.note({ url, skipped: true, reason, status });
    }
    gate.note({ url, kind: "rendered", status });
    return { status, text, url: page.url(), fetchedAt, source: page.url(), rendered: true };
  } finally {
    await browser.close();
  }
}
