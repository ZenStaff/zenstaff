// Zen Staff first run: the pure parts (who gives the company interview, the hub of an invitation
// link, the two colleagues offered). ZEN.md, "First run".
import { suggestStaffRoles, type OnboardingAnswers } from "@t3tools/contracts/zenCompanies";
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";

/**
 * True when the company's interview is not this person's to give: a company linked to a hub
 * company where they are a member or a guest (the owner's interview, never the employee's), or a
 * first run of someone who only belongs to other people's companies.
 */
export function interviewBelongsToSomeoneElse(
  hub: Pick<ZenHubStatus, "signedIn" | "links" | "companies"> | null,
  localCompanyId: string,
  reason: "first-run" | "new-company",
): boolean {
  if (hub === null || !hub.signedIn) return false;
  const roleOf = (hubCompanyId: string | undefined) =>
    hub.companies.find((company) => company.id === hubCompanyId)?.role ?? null;
  const linked = roleOf(hub.links[localCompanyId]);
  if (linked !== null) return linked === "member" || linked === "guest";
  if (reason !== "first-run" || hub.companies.length === 0) return false;
  return hub.companies.every((company) => company.role === "member" || company.role === "guest");
}

/** The hub an invitation link points at ("https://zenhub.zed-zen.com/invite#inv_..."), or null. */
export function hubOfInviteLink(link: string): string | null {
  const trimmed = link.trim();
  if (!/#/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.pathname.endsWith("/invite") || url.hash.length < 2) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The two roles offered on the first run: the interview's suggestion order, first two. */
export function firstRunRoles(answers: OnboardingAnswers): string[] {
  return suggestStaffRoles(answers).slice(0, 2);
}
