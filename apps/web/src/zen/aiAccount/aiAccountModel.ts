// Zen Staff: which AI account a provider on this computer is signed in to (from the provider
// snapshot upstream already reads: Claude's initialize result, Codex's account/read), whether it is
// a personal subscription or a company one, and whether this device confirmed using it. Pure;
// aiAccountModel.test.ts. ZEN.md, "AI account".
import type { ServerProvider } from "@t3tools/contracts";

/** personal: Free/Pro/Max/Plus...; company: Team/Business/Enterprise/Edu; api: an API key or cloud. */
export type AiAccountKind = "personal" | "company" | "api" | "unknown";

export interface AiAccount {
  readonly instanceId: string;
  readonly driver: string;
  /** "Claude", "ChatGPT" or the provider's own name. */
  readonly service: string;
  readonly email: string | null;
  /** The plan as the provider names it ("Claude Max Subscription" -> "Claude Max"). */
  readonly plan: string | null;
  readonly kind: AiAccountKind;
  readonly state: "signed-in" | "signed-out" | "not-installed" | "checking" | "disabled";
}

const COMPANY_PLAN = /\b(team|business|enterprise|edu)\b/i;
const API_TYPES = new Set(["apikey", "bedrock", "amazonbedrock", "customendpoint"]);

export function classifyAiAccount(auth: {
  readonly type?: string | undefined;
  readonly label?: string | undefined;
}): AiAccountKind {
  const type = auth.type?.toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (API_TYPES.has(type)) return "api";
  // Antigravity (Google): its auth methods are the type.
  if (type === "oauthpersonal") return "personal";
  if (type === "oauthbusiness") return "company";
  if (type === "geminiapikey" || type === "agentplatform") return "api";
  const words = `${auth.type ?? ""} ${auth.label ?? ""}`;
  if (/api key|bedrock|custom api endpoint/i.test(words)) return "api";
  if (COMPANY_PLAN.test(words) || /claude(team|enterprise)/i.test(type)) return "company";
  if (/\b(free|pro|max|ultra|plus|go)\b|subscription/i.test(words) || type === "chatgpt")
    return words.trim() === "chatgpt" ? "unknown" : "personal";
  return "unknown";
}

function serviceName(provider: ServerProvider): string {
  const driver = String(provider.driver);
  if (driver === "claudeAgent") return "Claude";
  if (driver === "codex") return "ChatGPT";
  if (driver === "antigravity") return "Google (Gemini)";
  return provider.displayName ?? driver;
}

function planName(label: string | undefined): string | null {
  if (!label) return null;
  return label.replace(/\s+Subscription$/i, "").trim() || null;
}

export function aiAccountFromProvider(provider: ServerProvider): AiAccount {
  const auth = provider.auth;
  const state: AiAccount["state"] =
    !provider.enabled || provider.status === "disabled"
      ? "disabled"
      : !provider.installed
        ? provider.auth.status === "unknown" && provider.status === "warning"
          ? "checking"
          : "not-installed"
        : auth.status === "authenticated"
          ? "signed-in"
          : auth.status === "unauthenticated"
            ? "signed-out"
            : "checking";
  return {
    instanceId: String(provider.instanceId),
    driver: String(provider.driver),
    service: serviceName(provider),
    email: auth.email ?? null,
    plan: planName(auth.label),
    kind: auth.status === "authenticated" ? classifyAiAccount(auth) : "unknown",
    state,
  };
}

/** The AI accounts worth showing: Claude, ChatGPT and Google first, then any other signed-in provider. */
export function aiAccountsOf(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): ReadonlyArray<AiAccount> {
  const accounts = (providers ?? []).map(aiAccountFromProvider);
  const rank = (account: AiAccount) =>
    account.driver === "claudeAgent"
      ? 0
      : account.driver === "codex"
        ? 1
        : account.driver === "antigravity"
          ? 2
          : 3;
  return accounts
    .filter((account) => rank(account) < 2 || account.state === "signed-in")
    .toSorted((a, b) => rank(a) - rank(b));
}

/** What a confirmation is tied to: another login on the same provider asks again. */
export function aiAccountSignature(account: AiAccount): string {
  return `${account.instanceId}|${account.email ?? ""}|${account.plan ?? ""}`;
}

/** "Claude alex@firma.example (Claude Max)" style parts, for sentences. */
export function aiAccountTitle(account: AiAccount): string {
  const who = account.email ? ` ${account.email}` : "";
  const plan = account.plan ? ` (${account.plan})` : "";
  return `${account.service}${who}${plan}`;
}

/**
 * Accounts that are signed in but not confirmed on this device: the person is asked before Zen
 * uses them, instead of Zen picking up whatever CLI login it finds.
 */
export function unconfirmedAccounts(
  accounts: ReadonlyArray<AiAccount>,
  confirmed: ReadonlySet<string>,
): ReadonlyArray<AiAccount> {
  return accounts.filter(
    (account) => account.state === "signed-in" && !confirmed.has(aiAccountSignature(account)),
  );
}

/** A company agent on a personal subscription: warn, or refuse when the admin blocked it. */
export function companyAccountCheck(
  account: AiAccount | null,
  blockPersonal: boolean,
): "ok" | "warn-personal" | "blocked-personal" | "missing" {
  if (account === null || account.state !== "signed-in") return "missing";
  if (account.kind !== "personal") return "ok";
  return blockPersonal ? "blocked-personal" : "warn-personal";
}
