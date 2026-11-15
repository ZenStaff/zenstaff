// @effect-diagnostics nodeBuiltinImport:off globalDate:off - read synchronously when a company chat's Claude process starts.
// Zen Staff: what a company server may use for other people, chosen and recorded by the owner or
// admin who made the machine the company server (review 0.2.3, P0-6).
//
// Without a recorded choice a company server never lends this machine's own AI login or its
// personal connectors to colleagues:
// - colleagues' prompts in company chats and tasks for the company's AI staff are refused until
//   the choice is recorded and the company AI account is chosen ("Nesetat" no longer means "the
//   machine's account");
// - company chats never see a connector that was not shared on purpose: claude.ai connectors are
//   turned off unless one of them was shared, and every other known connector is denied by a
//   permission rule (`mcp__<server>`), so a new personal connector stays private by default.
//
// Pure rules + a small file (`<state dir>/zen/company-server.json`, mode 0600). Tests:
// serverConsent.test.ts.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** The AI account the owner saw and accepted for the company's AI staff. */
export interface ServerConsentAccount {
  readonly provider: "claude" | "codex";
  readonly mode: "seat" | "api-key";
  /** What the dialog named (e-mail and plan of the machine's login, or the key's name). */
  readonly label: string;
  /** A personal subscription (Pro, Max, Plus...) accepted with the warning shown. */
  readonly personal: boolean;
}

export interface ServerConsentConnector {
  /** The provider's server name ("claude.ai Trello", "salarizare"). */
  readonly name: string;
  /** "account" = a claude.ai connector of the signed-in account; others are local config. */
  readonly origin: string;
}

export interface ServerConsent {
  readonly account: ServerConsentAccount;
  /** Connectors colleagues' company chats may use (names, as listed). */
  readonly shared: ReadonlyArray<string>;
  /** Every connector the dialog listed, shared or not (to deny the others by name). */
  readonly seen: ReadonlyArray<ServerConsentConnector>;
  readonly confirmedAt: string;
  /** Hub user id of who confirmed (null when unknown). */
  readonly confirmedBy: string | null;
}

export type ServerConsents = Readonly<Record<string, ServerConsent>>;

const MAX_CONNECTORS = 200;
const MAX_NAME = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cleanName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name === "" || name.length > MAX_NAME) return null;
  for (const char of name) if (char.charCodeAt(0) < 32) return null;
  return name;
};

/**
 * The `confirm` block of `runner.set` / `runner.consent.set`, validated. Null when it is missing
 * or not usable: the server is then not made a company server.
 */
export function parseServerConfirmation(
  raw: unknown,
  now: Date,
  confirmedBy: string | null,
): ServerConsent | null {
  if (!isRecord(raw) || !isRecord(raw.account)) return null;
  const account = raw.account;
  const provider =
    account.provider === "codex" ? "codex" : account.provider === "claude" ? "claude" : null;
  const mode = account.mode === "api-key" ? "api-key" : account.mode === "seat" ? "seat" : null;
  const label = cleanName(account.label);
  if (provider === null || mode === null || label === null) return null;
  if (raw.acknowledged !== true) return null;
  const seen: ServerConsentConnector[] = [];
  const seenNames = new Set<string>();
  for (const item of Array.isArray(raw.seen) ? raw.seen.slice(0, MAX_CONNECTORS) : []) {
    if (!isRecord(item)) continue;
    const name = cleanName(item.name);
    if (name === null || seenNames.has(name)) continue;
    seenNames.add(name);
    seen.push({ name, origin: typeof item.origin === "string" ? item.origin.slice(0, 40) : "" });
  }
  // Only connectors that were listed can be shared: nothing is shared by a name nobody saw.
  const shared = [
    ...new Set(
      (Array.isArray(raw.shared) ? raw.shared : [])
        .map(cleanName)
        .filter((name): name is string => name !== null && seenNames.has(name)),
    ),
  ];
  return {
    account: { provider, mode, label, personal: account.personal === true },
    shared,
    seen,
    confirmedAt: now.toISOString(),
    confirmedBy,
  };
}

function normalizeServerConsents(raw: unknown): ServerConsents {
  const out: Record<string, ServerConsent> = {};
  if (!isRecord(raw) || !isRecord(raw.companies)) return out;
  for (const [companyId, value] of Object.entries(raw.companies)) {
    if (!isRecord(value)) continue;
    const parsed = parseServerConfirmation(
      { ...value, acknowledged: true },
      new Date(typeof value.confirmedAt === "string" ? value.confirmedAt : 0),
      typeof value.confirmedBy === "string" ? value.confirmedBy : null,
    );
    if (parsed !== null && typeof value.confirmedAt === "string") {
      out[companyId] = { ...parsed, confirmedAt: value.confirmedAt };
    }
  }
  return out;
}

export function loadServerConsents(file: string): ServerConsents {
  try {
    return normalizeServerConsents(JSON.parse(NodeFS.readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

export function saveServerConsents(file: string, consents: ServerConsents): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temp, `${JSON.stringify({ version: 1, companies: consents }, null, 2)}\n`, {
    mode: 0o600,
  });
  NodeFS.renameSync(temp, file);
}

export type ServerBlock = "no-consent" | "no-ai-account";

/**
 * Whether the company server may run work for other people of that company: the choice is
 * recorded and the company AI account is chosen. Null: it may.
 */
export function serverBlockFor(input: {
  readonly hubCompanyId: string;
  readonly consents: ServerConsents;
  readonly companyAis: Readonly<Record<string, unknown>>;
}): ServerBlock | null {
  if (input.consents[input.hubCompanyId] === undefined) return "no-consent";
  if (input.companyAis[input.hubCompanyId] === undefined) return "no-ai-account";
  return null;
}

/** The sentence a colleague gets (mapped to Romanian in the app by its start). */
export const SERVER_BLOCK_MESSAGE: Record<ServerBlock, string> = {
  "no-consent":
    "The company server is not set up yet: an owner or an admin must confirm which AI account and which connections it uses for the company.",
  "no-ai-account":
    "The company has no AI account yet: an owner or an admin must choose it in Team > AI account.",
};

/** Claude Code's tool prefix for a server: `mcp__<name with anything else as _>`. */
export function mcpRuleName(serverName: string): string {
  return `mcp__${serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** Zen's own servers (the app's tools, hosted company memory) are never denied. */
const ZEN_OWN_SERVERS = new Set(["t3-code", "zen-memory"]);

export interface CompanyChatMcpPolicy {
  readonly env: Readonly<Record<string, string>>;
  readonly deny: ReadonlyArray<string>;
}

/**
 * What a company chat's Claude process gets: every connector not shared is denied, and the
 * account's claude.ai connectors are turned off unless one of them was shared. `local` are the
 * server names in this machine's Claude config (user scope and this folder's local scope), so a
 * connector added after the confirmation is denied too.
 */
export function companyChatMcpPolicy(
  consent: ServerConsent | undefined,
  local: ReadonlyArray<string>,
): CompanyChatMcpPolicy {
  const shared = new Set(consent?.shared ?? []);
  const names = new Set<string>([...(consent?.seen ?? []).map((item) => item.name), ...local]);
  const deny = [...names]
    .filter((name) => !shared.has(name) && !ZEN_OWN_SERVERS.has(name))
    .map(mcpRuleName)
    .toSorted();
  const sharesAccountConnector = (consent?.seen ?? []).some(
    (item) =>
      shared.has(item.name) && (item.origin === "account" || item.name.startsWith("claude.ai ")),
  );
  return {
    env: sharesAccountConnector ? {} : { ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
    deny: [...new Set(deny)],
  };
}

/**
 * Server names in Claude Code's own config file (`~/.claude.json`, or the one under
 * CLAUDE_CONFIG_DIR): the user-scope `mcpServers` and the local-scope ones of `cwd`.
 */
export function claudeConfigServerNames(config: unknown, cwd: string | undefined): string[] {
  if (!isRecord(config)) return [];
  const names = new Set<string>();
  if (isRecord(config.mcpServers))
    for (const name of Object.keys(config.mcpServers)) names.add(name);
  if (cwd !== undefined && isRecord(config.projects)) {
    const clean = (path: string) => path.replace(/[\\/]+$/, "");
    for (const [folder, project] of Object.entries(config.projects)) {
      if (clean(folder) !== clean(cwd) || !isRecord(project) || !isRecord(project.mcpServers)) {
        continue;
      }
      for (const name of Object.keys(project.mcpServers)) names.add(name);
    }
  }
  return [...names].slice(0, MAX_CONNECTORS);
}

export function readClaudeConfigServerNames(
  cwd: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  const file = dir
    ? NodePath.join(dir, ".claude.json")
    : NodePath.join(NodeOS.homedir(), ".claude.json");
  try {
    return claudeConfigServerNames(JSON.parse(NodeFS.readFileSync(file, "utf8")), cwd);
  } catch {
    return [];
  }
}
