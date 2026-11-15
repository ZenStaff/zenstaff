// The company server serves colleagues only on a company API key; the owner alone may use their
// own subscription. Invitations need no key: colleagues work with their own AI account on their
// own computer. Pure, tested. ZEN.md, "Company server AI account".
import type { ZenHubAiAccount, ZenHubCompanyDetail } from "@t3tools/contracts/zenHub";

export type CompanyAiMode = ZenHubAiAccount["mode"];

/** Whether one of the company's servers runs on a company API key. */
export function companyHasApiKey(detail: Pick<ZenHubCompanyDetail, "runners">): boolean {
  return detail.runners.some((runner) => runner.aiAccount?.mode === "api-key");
}

/** The ways the company AI can be paid: a personal subscription only while the owner is alone. */
export function companyAiModes(memberCount: number): ReadonlyArray<CompanyAiMode> {
  return memberCount <= 1 ? ["api-key", "seat"] : ["api-key"];
}

/** What the form starts on: the current choice when it is still allowed, else the company key. */
export function initialCompanyAiMode(
  current: Pick<ZenHubAiAccount, "mode"> | null | undefined,
  memberCount: number,
): CompanyAiMode {
  const mode = current?.mode ?? "api-key";
  return companyAiModes(memberCount).includes(mode) ? mode : "api-key";
}

/** Colleagues can work on the server: only with the company key. */
export function servesColleagues(account: Pick<ZenHubAiAccount, "mode"> | null | undefined) {
  return account?.mode === "api-key";
}

/** Where each provider makes API keys (and sets a monthly spend limit). */
export const PROVIDER_CONSOLE: Readonly<Record<ZenHubAiAccount["provider"], string>> = {
  claude: "https://console.anthropic.com/settings/keys",
  codex: "https://platform.openai.com/api-keys",
};
