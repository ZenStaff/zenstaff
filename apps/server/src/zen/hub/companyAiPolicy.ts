// A company server runs colleagues' work only on a company API key (Anthropic, OpenAI), never on
// one person's subscription (personal plans cannot serve a team); the server's own signed-in
// person may still use it alone. Pure, tested. ZEN.md, "Company server AI account".

export type CompanyAiMode = "seat" | "api-key" | null;

/** What a colleague sees when the company server has no company API key. */
export const COMPANY_API_KEY_REQUIRED =
  "Serverul firmei lucrează pentru colegi doar cu o cheie API a firmei (Anthropic sau OpenAI), nu cu abonamentul personal al cuiva. Cere unui administrator s-o adauge în Echipă > firmă > Cont AI.";

/** Ops of the company relay that only read (list, follow); every other one starts work. */
const READ_ONLY_COMPANY_OPS = new Set(["staff.list", "staff.follow"]);

/** Whether a relayed request makes the server's AI do work. */
export function startsCompanyWork(input: {
  readonly op: string;
  /** "company" for the AI staff relay, "chat" for a shared chat. */
  readonly via: "company" | "chat";
}): boolean {
  if (input.via === "company") return !READ_ONLY_COMPANY_OPS.has(input.op);
  return input.op === "thread.prompt";
}

/**
 * Null when the server may do this work; otherwise the reason. The person signed in on the server
 * (its owner) may always use it; anyone else needs the company API key.
 */
export function companyWorkRefusal(input: {
  readonly mode: CompanyAiMode;
  readonly actorUserId: string;
  readonly ownerUserId: string | null;
}): string | null {
  if (input.mode === "api-key") return null;
  if (input.ownerUserId !== null && input.actorUserId === input.ownerUserId) return null;
  return COMPANY_API_KEY_REQUIRED;
}

/** The variables a company chat's agent gets for the company key (never shown anywhere). */
export function companyKeyEnv(
  account: { readonly provider: "claude" | "codex"; readonly mode: "seat" | "api-key" } | undefined,
  key: string | null,
): Record<string, string> | null {
  if (account === undefined || account.mode !== "api-key" || key === null) return null;
  return account.provider === "codex" ? { OPENAI_API_KEY: key } : { ANTHROPIC_API_KEY: key };
}
