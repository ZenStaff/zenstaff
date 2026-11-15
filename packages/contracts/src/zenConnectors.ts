// Zen Staff: "Conectează-mi X". The catalog says how each app connects (AI account connector,
// Claude Code's own `claude mcp add`, the person's Zapier, CSV export, browser); Zen never holds a
// third-party credential. One RPC `zen.connectors.call {op, input}`; pure rules shared by server,
// web and tests. ZEN.md, "Connectors".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "./auth.ts";

export const ZEN_CONNECTORS_WS_METHODS = {
  call: "zen.connectors.call",
} as const;

const ZEN_CONNECTORS_OPS = [
  "catalog",
  "overview",
  "requests.list",
  "requests.create",
  "requests.dismiss",
  "connect.add",
  "connect.loginStatus",
  "connect.finishLogin",
  "connect.sendLink",
  "connect.verify",
  "connect.custom",
  "connection.test",
  "connection.remove",
  "support.create",
  "support.list",
  "grant",
  "revoke",
] as const;
export type ZenConnectorsOp = (typeof ZEN_CONNECTORS_OPS)[number];

export const ZenConnectorsCallInput = Schema.Struct({
  op: Schema.Literals(ZEN_CONNECTORS_OPS),
  input: Schema.Unknown,
});
export type ZenConnectorsCallInput = typeof ZenConnectorsCallInput.Type;

export class ZenConnectorsError extends Schema.TaggedError<ZenConnectorsError>()(
  "ZenConnectorsError",
  {
    reason: Schema.Literals([
      "invalid-input",
      "not-found",
      "forbidden",
      "needs-runner",
      "no-provider",
      "failed",
      "unavailable",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const ZenConnectorsCallRpc = Rpc.make(ZEN_CONNECTORS_WS_METHODS.call, {
  payload: ZenConnectorsCallInput,
  success: Schema.Unknown,
  error: Schema.Union([ZenConnectorsError, EnvironmentAuthorizationError]),
});

/** Spread into `WsRpcGroup` (rpc.ts). */
export const ZEN_CONNECTORS_RPCS = [ZenConnectorsCallRpc] as const;

export const ZEN_CONNECTORS_RPC_SCOPES = {
  [ZEN_CONNECTORS_WS_METHODS.call]: AuthOrchestrationOperateScope,
} as const;

export const ZEN_CONNECTORS_RPC_AGGREGATES = {
  [ZEN_CONNECTORS_WS_METHODS.call]: "zen",
} as const;

export interface ZenText {
  readonly en: string;
  readonly ro: string;
}

export interface ZenSteps {
  readonly en: ReadonlyArray<string>;
  readonly ro: ReadonlyArray<string>;
}

export const ZEN_CONNECTOR_PATH_KINDS = [
  "native",
  "local-mcp",
  "automation",
  "csv",
  "browser",
] as const;
export type ZenConnectorPathKind = (typeof ZEN_CONNECTOR_PATH_KINDS)[number];

const ZEN_CONNECTOR_CATEGORIES = [
  "email",
  "files",
  "calendar",
  "chat",
  "notes",
  "tasks",
  "crm",
  "invoicing",
  "payments",
  "shop",
  "social",
  "reviews",
  "voice",
  "restaurant",
  "automation",
  "other",
] as const;
export type ZenConnectorCategory = (typeof ZEN_CONNECTOR_CATEGORIES)[number];

const ZEN_AI_PROVIDERS = ["claude", "chatgpt", "gemini"] as const;
export type ZenAiProvider = (typeof ZEN_AI_PROVIDERS)[number];

/** Where a connector is added in a person's AI account. */
export interface ZenNativeConnector {
  readonly provider: ZenAiProvider;
  /** Settings page (deep link where the provider has one). */
  readonly settingsUrl: string;
  /** "directory": listed by the provider; "custom": added by URL (custom connector). */
  readonly kind: "directory" | "custom";
  /** The name the provider shows ("Gmail"); claude.ai connectors appear as `claude.ai <name>`. */
  readonly connectorName: string;
  /** The connector's MCP URL when known (for custom connectors and for matching). */
  readonly url?: string;
  readonly steps: ZenSteps;
}

export interface ZenConnectorMcp {
  readonly transport: "http" | "stdio";
  /** http: the server URL. */
  readonly url?: string;
  /** stdio: command and arguments. */
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  /**
   * How the server signs in. `oauth`: Claude Code's own sign-in (`claude mcp login`). `none`:
   * public. `env`: needs a key in the server's environment; Zen does not take keys, so the
   * person adds it with the command shown (or asks ZED-ZEN).
   */
  readonly auth: "oauth" | "none" | "env";
  /** env: the variable names the person must set. */
  readonly envNames?: ReadonlyArray<string>;
  /** Server name used with `claude mcp add` (default: the entry id). */
  readonly serverName?: string;
}

export interface ZenConnectorPath {
  readonly kind: ZenConnectorPathKind;
  /** native: one or more providers, in the order shown. */
  readonly native?: ReadonlyArray<ZenNativeConnector>;
  /** local-mcp: the MCP server Claude Code adds. */
  readonly mcp?: ZenConnectorMcp;
  /** automation: which automation accounts can reach the app. */
  readonly automation?: ReadonlyArray<"zapier" | "make" | "n8n">;
  /** What the connection can see by default (read-only) and what writing would add. */
  readonly access: { readonly read: ZenText; readonly write?: ZenText };
  readonly setup: ZenSteps;
  readonly notes?: ZenText;
  /** browser: the app's terms allow an assistant working in the person's own session. */
  readonly tosAllowsBrowser?: boolean;
  /** csv: where the export starts (opened by the card). */
  readonly url?: string;
  /** How the facts in this path were checked (shown on the Connections page). */
  readonly verified: { readonly status: "verified" | "unverified"; readonly note: string };
}

export interface ZenConnectorEntry {
  readonly id: string;
  readonly name: string;
  readonly category: ZenConnectorCategory;
  /** Names people use in chat, lower case, without diacritics ("smart bill", "spv"). */
  readonly aliases: ReadonlyArray<string>;
  readonly description: ZenText;
  readonly website: string;
  /** Standard: anyone on their own machine. Enterprise: company runner + per-person grant. */
  readonly tier: "standard" | "enterprise";
  /** Company data (invoicing, the restaurant): offered as a company connection first. */
  readonly defaultScope?: "personal" | "company";
  /** Hosts of MCP servers that belong to this app (to recognise existing connections). */
  readonly mcpHosts?: ReadonlyArray<string>;
  /** Paths in priority order. */
  readonly paths: ReadonlyArray<ZenConnectorPath>;
  /** Public API facts (documentation only; Zen does not call it). */
  readonly api?: {
    readonly docsUrl: string;
    readonly auth: string;
    readonly verified: { readonly status: "verified" | "unverified"; readonly note: string };
  };
  readonly tos: ZenText;
}

const ID = /^[a-z][a-z0-9-]{1,40}$/;

function textProblems(value: unknown, where: string): string[] {
  const text = value as Partial<ZenText> | undefined;
  if (typeof text?.en !== "string" || text.en.trim() === "")
    return [`${where}: English is missing.`];
  if (typeof text.ro !== "string" || text.ro.trim() === "")
    return [`${where}: Romanian is missing.`];
  return [];
}

function stepsProblems(value: unknown, where: string): string[] {
  const steps = value as Partial<ZenSteps> | undefined;
  if (!Array.isArray(steps?.en) || steps.en.length === 0)
    return [`${where}: English steps missing.`];
  if (!Array.isArray(steps.ro) || steps.ro.length === 0)
    return [`${where}: Romanian steps missing.`];
  if (steps.en.length !== steps.ro.length)
    return [`${where}: English and Romanian differ in length.`];
  return [];
}

const httpsUrl = (url: unknown) => typeof url === "string" && /^https:\/\/[^\s]+$/.test(url);

/** Keys that would mean Zen stores or asks for a credential. The catalog must not have them. */
const CREDENTIAL_KEYS =
  /"(?:fields|secret|apiKey|token|header|headers|clientSecret|password|vault)"\s*:/i;

/** Every reason a catalog entry is not valid; empty when it is. */
export function connectorEntryProblems(raw: unknown): ReadonlyArray<string> {
  const entry = raw as Partial<ZenConnectorEntry> | null;
  if (entry === null || typeof entry !== "object") return ["Not an object."];
  const problems: string[] = [];
  if (typeof entry.id !== "string" || !ID.test(entry.id)) problems.push("id is not valid.");
  const where = typeof entry.id === "string" ? entry.id : "entry";
  if (CREDENTIAL_KEYS.test(JSON.stringify(entry))) {
    problems.push(`${where}: the catalog never asks for keys, tokens or headers.`);
  }
  if (typeof entry.name !== "string" || entry.name.trim() === "")
    problems.push(`${where}: name missing.`);
  if (!ZEN_CONNECTOR_CATEGORIES.includes(entry.category as ZenConnectorCategory)) {
    problems.push(`${where}: category is not known.`);
  }
  if (
    !Array.isArray(entry.aliases) ||
    entry.aliases.length === 0 ||
    entry.aliases.some((alias) => typeof alias !== "string" || alias !== normalizeChatText(alias))
  ) {
    problems.push(`${where}: aliases must be lower case without diacritics.`);
  }
  problems.push(...textProblems(entry.description, `${where} description`));
  problems.push(...textProblems(entry.tos, `${where} tos`));
  if (!httpsUrl(entry.website)) problems.push(`${where}: website must be https.`);
  if (entry.tier !== "standard" && entry.tier !== "enterprise") problems.push(`${where}: tier.`);
  if (entry.api !== undefined && !httpsUrl(entry.api.docsUrl))
    problems.push(`${where}: api docs must be https.`);
  if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
    problems.push(`${where}: no paths.`);
    return problems;
  }
  const kinds = new Set<string>();
  entry.paths.forEach((path, index) => {
    const at = `${where} path ${index + 1} (${String(path?.kind)})`;
    if (!ZEN_CONNECTOR_PATH_KINDS.includes(path?.kind)) {
      problems.push(`${at}: kind is not known.`);
      return;
    }
    if (kinds.has(path.kind)) problems.push(`${at}: the same kind twice.`);
    kinds.add(path.kind);
    problems.push(...textProblems(path.access?.read, `${at} access.read`));
    if (path.access?.write !== undefined)
      problems.push(...textProblems(path.access.write, `${at} access.write`));
    problems.push(...stepsProblems(path.setup, `${at} setup`));
    if (path.notes !== undefined) problems.push(...textProblems(path.notes, `${at} notes`));
    if (path.verified?.status !== "verified" && path.verified?.status !== "unverified") {
      problems.push(`${at}: say whether it was verified.`);
    }
    if (path.kind === "native") {
      if (!Array.isArray(path.native) || path.native.length === 0)
        problems.push(`${at}: no provider.`);
      for (const native of path.native ?? []) {
        if (!ZEN_AI_PROVIDERS.includes(native.provider))
          problems.push(`${at}: provider ${native.provider}.`);
        if (!httpsUrl(native.settingsUrl)) problems.push(`${at}: settingsUrl must be https.`);
        if (native.url !== undefined && !httpsUrl(native.url))
          problems.push(`${at}: url must be https.`);
        if (native.kind === "custom" && native.url === undefined)
          problems.push(`${at}: a custom connector needs its url.`);
        problems.push(...stepsProblems(native.steps, `${at} ${native.provider} steps`));
      }
    }
    if (path.kind === "local-mcp") {
      const mcp = path.mcp;
      if (!mcp) problems.push(`${at}: mcp missing.`);
      else {
        if (mcp.transport === "http" && !httpsUrl(mcp.url))
          problems.push(`${at}: mcp url must be https.`);
        if (mcp.transport === "stdio" && typeof mcp.command !== "string")
          problems.push(`${at}: mcp command.`);
        if (mcp.transport !== "http" && mcp.transport !== "stdio")
          problems.push(`${at}: mcp transport.`);
        if (!["oauth", "none", "env"].includes(mcp.auth)) problems.push(`${at}: mcp auth.`);
        if (mcp.auth === "env" && !(mcp.envNames?.length ?? 0))
          problems.push(`${at}: say which variables.`);
        if (mcp.auth === "oauth" && mcp.transport !== "http")
          problems.push(`${at}: sign-in needs http.`);
        if (mcp.serverName !== undefined && !/^[a-z][a-z0-9-]{1,40}$/.test(mcp.serverName)) {
          problems.push(`${at}: serverName.`);
        }
      }
    }
    if (path.kind === "automation" && !(path.automation?.length ?? 0))
      problems.push(`${at}: which automation.`);
    if (path.kind === "browser" && path.tosAllowsBrowser !== true) {
      problems.push(`${at}: a browser path needs terms that allow it (tosAllowsBrowser).`);
    }
    if (path.url !== undefined && !httpsUrl(path.url)) problems.push(`${at}: url must be https.`);
  });
  return problems;
}

/** Lower case, no diacritics (ă â î ș ş ț ţ), single spaces. */
export function normalizeChatText(text: string): string {
  return text
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .replaceAll("ş", "s")
    .replaceAll("ţ", "t")
    .toLowerCase()
    .replaceAll(/[’']/g, "'")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * Phrases that mean "connect / give access / work inside" in Romanian and English. Each must be
 * followed (within a few words) by an app name or an app kind; on their own they mean nothing.
 */
const EN_LEAD = String.raw`(?:^|[.!?] |please |pls |can you |could you |would you |will you |i want (?:you )?to |i'd like (?:you )?to |i would like (?:you )?to |we want (?:you )?to |let's |lets |help me |go ahead and |now )`;
const CONNECT_PHRASES: ReadonlyArray<RegExp> = [
  // Romanian: conectează(-mi), conectați, conectezi, conectăm, conectare la
  /\bconect(?:eaza|ati|ezi|am|are la|area la|eaza-mi|eaza-ne)\b/,
  // leagă / legați / legăm (+ -mi / -ne)
  /\b(?:leaga|legati|legam|legi)\b/,
  // integrează / integrați / integrare cu
  /\b(?:integreaza|integrati|integrezi|integrare cu|integrarea cu)\b/,
  // dă-ți / să ai acces la
  /\b(?:da-?ti acces|ai acces|aiba acces|sa ai acces|acces direct) (?:la|in)\b/,
  // vreau să lucrezi în X (second person: said to the assistant)
  /\blucrezi (?:direct )?(?:in|cu|pe)\b/,
  // English, as a request to the assistant
  new RegExp(`${EN_LEAD}(?:connect|hook up|integrate|plug in|set up)\\b`),
  // "link my Gmail", "add our Slack": only with a possessive, never "add Stripe numbers".
  /\b(?:link|add) (?:my|our)\b/,
  new RegExp(`${EN_LEAD}(?:work|log in|sign in) (?:directly )?(?:in|inside|into|with|on)\\b`),
  /\b(?:connect|link|hook up|integrate) (?:me|us) (?:to|with|up)\b/,
  /\bgive (?:you|yourself) access to\b/,
];

/** Kinds of app people name without a brand ("our CRM", "facturarea"). */
const KIND_WORDS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly category: ZenConnectorCategory;
}> = [
  { pattern: /\bcrm(?:-ul)?\b/, category: "crm" },
  {
    pattern: /\b(?:facturare|facturarea|programul de facturare|invoicing|invoices app)\b/,
    category: "invoicing",
  },
  { pattern: /\b(?:e-?mail(?:ul)?|mail(?:ul)?|inbox(?:ul)?|posta)\b/, category: "email" },
  { pattern: /\b(?:calendar(?:ul)?|agenda)\b/, category: "calendar" },
  { pattern: /\b(?:magazin(?:ul)? online|shop(?:ul)?|online store|store)\b/, category: "shop" },
];

/** Things that look like a connect phrase but are not about apps. */
const NOT_ABOUT_APPS: ReadonlyArray<RegExp> = [
  /\bconnect the dots\b/,
  /\bleaga (?:paragrafele|ideile|propozitiile|frazele)\b/,
  /\bconecteaza-te (?:la sedinta|la apel|la call|la wifi|la internet|la vpn)\b/,
  /\b(?:wifi|wi-fi|bluetooth|imprimanta|printer|vpn|internet)\b/,
];

export interface ZenConnectIntent {
  /** The catalog entry named, or null when only a kind was named ("our CRM"). */
  readonly appId: string | null;
  /** Category when only a kind was named. */
  readonly category: ZenConnectorCategory | null;
  /** Other entries that match (a kind names several apps). */
  readonly candidates: ReadonlyArray<string>;
  /** The phrase that triggered it, for the log. */
  readonly phrase: string;
}

function aliasPattern(alias: string): RegExp {
  const escaped = alias.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "[ -]?");
  // Romanian articles and endings glue onto names: "smartbill-ul", "gmailul", "notion-ul".
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:-?(?:ul|ului|ul nostru|ul meu|-ul))?(?![a-z0-9])`);
}

/** Every catalog entry named in the text, in order of first mention. */
function connectorsMentioned(
  text: string,
  entries: ReadonlyArray<Pick<ZenConnectorEntry, "id" | "aliases" | "name">>,
): ReadonlyArray<string> {
  const normalized = normalizeChatText(text);
  const found: Array<{ id: string; at: number; length: number }> = [];
  for (const entry of entries) {
    let best: { at: number; length: number } | null = null;
    for (const alias of new Set([...entry.aliases, normalizeChatText(entry.name)])) {
      const match = aliasPattern(alias).exec(normalized);
      if (match && (best === null || match.index < best.at))
        best = { at: match.index, length: alias.length };
    }
    if (best) found.push({ id: entry.id, ...best });
  }
  // "Google Drive" also contains "drive"; when two names overlap, the longer wins.
  const kept = found.filter(
    (item) =>
      !found.some(
        (other) =>
          other !== item &&
          other.length > item.length &&
          other.at <= item.at &&
          other.at + other.length >= item.at + item.length,
      ),
  );
  return [...kept].sort((a, b) => a.at - b.at).map((item) => item.id);
}

/** Words allowed between the phrase and the app ("conectează-mi contul de Gmail"). */
const FILLER = new Set([
  "mi",
  "ne",
  "-mi",
  "-ne",
  "te",
  "la",
  "cu",
  "in",
  "pe",
  "de",
  "din",
  "si",
  "al",
  "a",
  "o",
  "un",
  "contul",
  "cont",
  "contului",
  "meu",
  "mea",
  "nostru",
  "noastra",
  "firmei",
  "firma",
  "aplicatia",
  "aplicatie",
  "pagina",
  "paginile",
  "direct",
  "tau",
  "acum",
  "te rog",
  "rog",
  "the",
  "my",
  "our",
  "me",
  "us",
  "to",
  "with",
  "up",
  "into",
  "inside",
  "account",
  "app",
  "company",
  "company's",
  "page",
  "pages",
  "workspace",
  "directly",
  "your",
  "now",
  "please",
  "and",
  "a",
  "an",
  "of",
]);

function onlyFiller(between: string): boolean {
  const words = between.split(/[\s,]+/).filter((word) => word.length > 0);
  return (
    words.length <= 4 &&
    words.every((word) => FILLER.has(word.replace(/^-/, "")) || FILLER.has(word))
  );
}

/**
 * A connect request in a chat message, or null. Needs a connect phrase directly followed (only
 * filler words such as "contul de", "our", "my" in between) by an app name or an app kind from
 * the catalog; questions about an app and plain mentions are not requests. Long messages
 * (pasted documents) are ignored.
 */
export function detectConnectIntent(
  text: string,
  entries: ReadonlyArray<Pick<ZenConnectorEntry, "id" | "aliases" | "name" | "category">>,
): ZenConnectIntent | null {
  if (text.length > 600) return null;
  const normalized = normalizeChatText(text);
  if (NOT_ABOUT_APPS.some((pattern) => pattern.test(normalized))) return null;
  for (const pattern of CONNECT_PHRASES) {
    const global = new RegExp(pattern.source, "g");
    for (const phrase of normalized.matchAll(global)) {
      const rest = normalized.slice(phrase.index + phrase[0].length);
      const mentioned = connectorsMentioned(rest, entries);
      if (mentioned.length > 0) {
        const first = mentioned[0]!;
        const entry = entries.find((candidate) => candidate.id === first)!;
        const at = Math.min(
          ...[...entry.aliases, normalizeChatText(entry.name)].map((alias) => {
            const match = aliasPattern(alias).exec(rest);
            return match ? match.index : Number.POSITIVE_INFINITY;
          }),
        );
        if (onlyFiller(rest.slice(0, at))) {
          // Other apps named in the same request ("Gmail și Google Calendar").
          return {
            appId: first,
            category: null,
            candidates: mentioned.slice(1),
            phrase: phrase[0].trim(),
          };
        }
      }
      for (const kind of KIND_WORDS) {
        const match = kind.pattern.exec(rest);
        if (!match || !onlyFiller(rest.slice(0, match.index))) continue;
        const candidates = entries
          .filter((entry) => entry.category === kind.category)
          .map((entry) => entry.id);
        if (candidates.length === 0) continue;
        return { appId: null, category: kind.category, candidates, phrase: phrase[0].trim() };
      }
    }
  }
  return null;
}

/**
 * A connect request for a public MCP server named by its address ("conectează
 * https://mcp.deepwiki.com/mcp"): a connect phrase anywhere and an https URL that looks like an
 * MCP endpoint. Returns the URL or null.
 */
export function detectMcpUrlIntent(text: string): string | null {
  if (text.length > 600) return null;
  const normalized = normalizeChatText(text);
  if (
    !CONNECT_PHRASES.some((pattern) => pattern.test(normalized)) &&
    !/\bconecteaz|\bconnect\b/.test(normalized)
  ) {
    return null;
  }
  const url = /https:\/\/[^\s<>"'`]+/.exec(text)?.[0]?.replace(/[.,;:!?)]+$/, "");
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return /(?:^|\.)mcp\.|\/mcp(?:\/|$)|\/sse(?:\/|$)/.test(`${parsed.hostname}${parsed.pathname}`)
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Catalog entries for a free-text query (the agent's `find_connector`). */
export function searchConnectors(
  query: string,
  entries: ReadonlyArray<ZenConnectorEntry>,
): ReadonlyArray<ZenConnectorEntry> {
  const intent = detectConnectIntent(`connect ${query}`, entries);
  const ids = intent
    ? [intent.appId, ...intent.candidates].filter((id): id is string => id !== null)
    : [];
  if (ids.length > 0)
    return ids.map((id) => entries.find((entry) => entry.id === id)!).filter(Boolean);
  const words = normalizeChatText(query)
    .split(" ")
    .filter((word) => word.length > 2);
  return entries.filter((entry) => {
    const hay = normalizeChatText(
      `${entry.name} ${entry.aliases.join(" ")} ${entry.category} ${entry.description.en} ${entry.description.ro}`,
    );
    return words.some((word) => hay.includes(word));
  });
}

export type ZenMcpHealth = "connected" | "needs-auth" | "failed" | "pending" | "unknown";

export interface ZenProviderServer {
  /** As listed: `claude.ai Gmail`, `plugin:x:y`, `horecaos`. */
  readonly name: string;
  readonly target: string;
  /** Where it was added: the AI account (claude.ai), a plugin, or Claude Code's own config. */
  readonly origin: "account" | "plugin" | "local";
  readonly health: ZenMcpHealth;
  readonly detail: string;
}

/** Parses `claude mcp list` output (Claude Code 2.x). Unknown lines are skipped. */
export function parseClaudeMcpList(output: string): ReadonlyArray<ZenProviderServer> {
  const servers: ZenProviderServer[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^(.+?): (.+?) - (✔|✓|!|✘|✗|⏸)\s*(.*)$/u.exec(line);
    if (!match) continue;
    const [, name, target, mark, rest] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    const detail = rest.trim();
    const health: ZenMcpHealth =
      mark === "✔" || mark === "✓"
        ? "connected"
        : mark === "⏸"
          ? "pending"
          : mark === "!"
            ? /needs authentication/i.test(detail)
              ? "needs-auth"
              : /^connected/i.test(detail)
                ? "connected"
                : "unknown"
            : "failed";
    servers.push({
      name,
      target: target.replace(/ \((?:HTTP|SSE|stdio)\)$/i, ""),
      origin: name.startsWith("claude.ai ")
        ? "account"
        : name.startsWith("plugin:")
          ? "plugin"
          : "local",
      health,
      detail,
    });
  }
  return servers;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The catalog entry a provider server belongs to (by MCP host, then by name), or null. */
export function catalogEntryForServer(
  server: Pick<ZenProviderServer, "name" | "target">,
  entries: ReadonlyArray<ZenConnectorEntry>,
): ZenConnectorEntry | null {
  const host = hostOf(server.target);
  if (host !== null) {
    for (const entry of entries) {
      const hosts = new Set<string>(entry.mcpHosts ?? []);
      for (const path of entry.paths) {
        if (path.mcp?.url) hosts.add(hostOf(path.mcp.url) ?? "");
        for (const native of path.native ?? []) if (native.url) hosts.add(hostOf(native.url) ?? "");
      }
      if (hosts.has(host)) return entry;
    }
  }
  const name = normalizeChatText(
    server.name.replace(/^claude\.ai /, "").replace(/^plugin:[^:]+:/, ""),
  );
  return (
    entries.find(
      (entry) =>
        normalizeChatText(entry.name) === name ||
        entry.id === name ||
        entry.paths.some((path) => path.mcp?.serverName === name) ||
        entry.aliases.includes(name),
    ) ?? null
  );
}

export type ZenConnectionScope = "personal" | "company";

export interface ZenPathContext {
  /** Claude Code is installed and answers on this machine. */
  readonly claudeCli: boolean;
  /** A Zapier (or other automation) MCP is already connected. */
  readonly hasAutomation: boolean;
  /** The app can drive a browser (preview tooling present). */
  readonly browserAvailable: boolean;
  readonly scope: ZenConnectionScope;
  /** This machine is the company's runner (company connections and enterprise entries). */
  readonly isRunner: boolean;
}

export type ZenPathBlock = "needs-runner" | "no-claude" | "needs-automation" | "no-browser";

export interface ZenPathOption {
  readonly index: number;
  readonly kind: ZenConnectorPathKind;
  readonly available: boolean;
  readonly block: ZenPathBlock | null;
  /** Slower and needs someone watching (browser). */
  readonly supervised: boolean;
  /** The person finishes it by hand (a key in a local MCP's environment). */
  readonly manual: boolean;
}

export interface ZenPathChoice {
  readonly chosen: ZenPathOption | null;
  readonly options: ReadonlyArray<ZenPathOption>;
}

function pathBlock(
  entry: ZenConnectorEntry,
  path: ZenConnectorPath,
  context: ZenPathContext,
): ZenPathBlock | null {
  const touchesMachine = path.kind === "local-mcp" || path.kind === "native";
  if (
    touchesMachine &&
    (entry.tier === "enterprise" || context.scope === "company") &&
    !context.isRunner
  ) {
    return "needs-runner";
  }
  if (touchesMachine && !context.claudeCli) {
    // Native connectors still work in claude.ai itself; Zen just cannot check them.
    if (path.kind === "local-mcp") return "no-claude";
  }
  if (path.kind === "automation" && !context.hasAutomation) return "needs-automation";
  if (path.kind === "browser" && !context.browserAvailable) return "no-browser";
  return null;
}

/**
 * The best way to connect here: the first path in the catalog's priority order that works on
 * this machine, with every option and why the others do not. `preferred` (a kind the person
 * picked on the card) wins when it is available. A path finished by hand (a key in a local MCP's
 * environment) is never chosen over one Zen can complete.
 */
export function choosePath(
  entry: ZenConnectorEntry,
  context: ZenPathContext,
  preferred?: ZenConnectorPathKind | null,
): ZenPathChoice {
  const options = entry.paths.map((path, index): ZenPathOption => {
    const block = pathBlock(entry, path, context);
    return {
      index,
      kind: path.kind,
      available: block === null,
      block,
      supervised: path.kind === "browser",
      manual: path.kind === "local-mcp" && path.mcp?.auth === "env",
    };
  });
  const wanted = preferred
    ? options.find((option) => option.kind === preferred && option.available)
    : undefined;
  return {
    chosen:
      wanted ??
      options.find((option) => option.available && !option.manual) ??
      options.find((option) => option.available) ??
      null,
    options,
  };
}

/** The `claude mcp add` arguments for a local MCP path (never with keys or headers). */
export function claudeMcpAddArgs(
  entry: Pick<ZenConnectorEntry, "id">,
  mcp: ZenConnectorMcp,
  scope: "user" | "local" | "project",
): ReadonlyArray<string> {
  const name = mcp.serverName ?? entry.id;
  if (mcp.transport === "http")
    return ["mcp", "add", "--transport", "http", "--scope", scope, name, mcp.url!];
  return ["mcp", "add", "--scope", scope, name, "--", mcp.command!, ...(mcp.args ?? [])];
}

/** What the person runs themselves for an `env` server (the key stays with them). */
export function manualMcpCommand(
  entry: Pick<ZenConnectorEntry, "id">,
  mcp: ZenConnectorMcp,
): string {
  const name = mcp.serverName ?? entry.id;
  const env = (mcp.envNames ?? []).map((variable) => `-e ${variable}=<${variable}>`).join(" ");
  return `claude mcp add --scope user ${name} ${env} -- ${mcp.command} ${(mcp.args ?? []).join(" ")}`
    .replaceAll(/\s+/g, " ")
    .trim();
}

export interface ZenConnectionView {
  /** The provider's server name. */
  readonly name: string;
  readonly target: string;
  readonly origin: ZenProviderServer["origin"];
  readonly health: ZenMcpHealth;
  readonly detail: string;
  readonly appId: string | null;
  readonly appName: string | null;
  /** personal: this machine's Claude Code; company: this machine is the company runner. */
  readonly scope: ZenConnectionScope;
  /** What the catalog says the connection reads by default. */
  readonly access: ZenText | null;
  readonly tier: "standard" | "enterprise" | null;
  /** Workflows that declare this app in `requires.connectors` or `access.secrets`. */
  readonly usedBy: ReadonlyArray<string>;
  /** When Zen last checked it (nothing else is kept). */
  readonly checkedAt: string;
  /** Zen can remove it with `claude mcp remove` (only servers in Claude Code's own config). */
  readonly removable: boolean;
}

export interface ZenConnectRequestView {
  readonly id: string;
  readonly threadId: string;
  readonly appId: string | null;
  readonly category: ZenConnectorCategory | null;
  readonly candidates: ReadonlyArray<string>;
  readonly preferredKind: ZenConnectorPathKind | null;
  readonly scope: ZenConnectionScope;
  readonly source: "chat" | "agent";
  readonly state: "open" | "connected" | "dismissed" | "support";
  /** A custom MCP address the agent or person proposed (public server). */
  readonly customUrl: string | null;
  readonly createdAt: string;
}

/** A running `claude mcp login`, as the card sees it (no codes, no tokens). */
export interface ZenLoginView {
  readonly id: string;
  readonly server: string;
  readonly state: "starting" | "waiting" | "done" | "failed";
  /** The provider's sign-in page (opened, sent to a phone, or copied). */
  readonly authorizeUrl: string | null;
  /** The address the browser comes back to (on this machine). */
  readonly callbackPort: number | null;
  readonly message: string | null;
}

export interface ZenSupportRequestView {
  readonly id: string;
  readonly appId: string;
  readonly appName: string;
  readonly note: string;
  readonly contact: string | null;
  readonly threadId: string | null;
  readonly createdAt: string;
  /** "local" until the hub accepts it. */
  readonly delivery: "local" | "hub";
}

export interface ZenConnectorsOverview {
  readonly connections: ReadonlyArray<ZenConnectionView>;
  readonly provider: {
    readonly claudeCli: boolean;
    readonly version: string | null;
    readonly error: string | null;
    readonly checkedAt: string | null;
  };
  readonly support: ReadonlyArray<ZenSupportRequestView>;
  readonly isRunner: boolean;
  readonly runnerSource: "hub" | "local" | "none";
  readonly hubUser: string | null;
  readonly grants: ReadonlyArray<{ readonly appId: string; readonly user: string }>;
  readonly mcpScope: "user" | "local";
}

/** Plain sentences for a blocked path, in English and Romanian. */
export const ZEN_PATH_BLOCK_TEXT: Record<ZenPathBlock, ZenText> = {
  "needs-runner": {
    en: "Company connections live on the company's always-on server, not on a personal computer.",
    ro: "Conexiunile firmei stau pe serverul firmei, pornit mereu, nu pe un calculator personal.",
  },
  "no-claude": {
    en: "Claude Code is not installed on this computer.",
    ro: "Claude Code nu este instalat pe acest calculator.",
  },
  "needs-automation": {
    en: "Connect Zapier (or Make / n8n) first.",
    ro: "Conectează mai întâi Zapier (sau Make / n8n).",
  },
  "no-browser": {
    en: "The built-in browser is not available on this machine.",
    ro: "Browserul integrat nu este disponibil pe acest calculator.",
  },
};
