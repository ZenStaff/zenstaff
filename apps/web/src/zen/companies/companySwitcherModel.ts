// Pure rows of the sidebar company switcher: this machine's companies merged with the hub
// companies the signed-in person belongs to. Tested in companySwitcherModel.test.ts.
import type { ZenCompany } from "@t3tools/contracts/zenCompanies";

export interface SwitcherHubCompany {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export interface SwitcherInput {
  /** This machine's companies (merged across environments), Personal included. */
  readonly localCompanies: ReadonlyArray<ZenCompany>;
  /** Local company id -> hub company id (the hub status `links`). */
  readonly links: Readonly<Record<string, string>>;
  /** Hub companies the person belongs to right now. */
  readonly hubCompanies: ReadonlyArray<SwitcherHubCompany>;
  readonly signedIn: boolean;
}

export type SwitcherRow =
  /** A local company linked to a hub company the person still belongs to. */
  | {
      readonly kind: "linked";
      readonly key: string;
      readonly company: ZenCompany;
      readonly hubCompany: SwitcherHubCompany;
    }
  /**
   * A local company and a hub company that are not linked yet but have the same name (case,
   * diacritics and spacing ignored): ONE row, with a "Leagă" action for owners and admins.
   */
  | {
      readonly kind: "matched";
      readonly key: string;
      readonly company: ZenCompany;
      readonly hubCompany: SwitcherHubCompany;
      /** Owner or admin of the hub company: may link it to the local one. */
      readonly canLink: boolean;
    }
  /** A hub company with no local company on this machine yet. */
  | {
      readonly kind: "hub-only";
      readonly key: string;
      readonly hubCompany: SwitcherHubCompany;
    }
  /** A company only on this machine (also one whose hub company was removed or left). */
  | { readonly kind: "local"; readonly key: string; readonly company: ZenCompany };

export const HUB_ROW_PREFIX = "hub:";

/** One company, one name: a company linked to the team shows the team's name (review P1-5). */
export function shownCompanyName(
  rows: ReadonlyArray<SwitcherRow>,
  company: { readonly id: string; readonly name: string },
): string {
  for (const row of rows) {
    if (row.kind === "linked" && row.company.id === company.id) return row.hubCompany.name;
  }
  return company.name;
}

/** Case-, diacritics- and spacing-insensitive name ("România" = "romania"; ș and its cedilla twin both become s). */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

const byName = (left: { readonly name: string }, right: { readonly name: string }) =>
  left.name.localeCompare(right.name);

/**
 * One row per company. Personal first, then the hub companies (linked, same-name matches and
 * hub-only, by name), then the companies that exist only on this machine. Signed out, every
 * company is a plain local row.
 */
export function buildSwitcherRows(input: SwitcherInput): ReadonlyArray<SwitcherRow> {
  const hubById = new Map(
    (input.signedIn ? input.hubCompanies : []).map((company) => [company.id, company]),
  );
  const personal: SwitcherRow[] = [];
  const hubRows: Array<Extract<SwitcherRow, { kind: "linked" | "matched" | "hub-only" }>> = [];
  const localRows: Array<Extract<SwitcherRow, { kind: "local" }>> = [];
  const linkedHubIds = new Set<string>();

  for (const company of input.localCompanies) {
    const hubId = input.links[company.id];
    const hubCompany = hubId === undefined ? undefined : hubById.get(hubId);
    if (hubCompany !== undefined) {
      linkedHubIds.add(hubCompany.id);
      const row = { kind: "linked", key: company.id, company, hubCompany } as const;
      if (company.isDefault) personal.push(row);
      else hubRows.push(row);
      continue;
    }
    const row = { kind: "local", key: company.id, company } as const;
    if (company.isDefault) personal.push(row);
    else localRows.push(row);
  }

  // Unlinked local companies by normalized name; each can be offered to one hub company only.
  const candidates = new Map<string, ZenCompany>();
  for (const row of localRows.toSorted((left, right) => byName(left.company, right.company))) {
    const name = normalizeCompanyName(row.company.name);
    if (!candidates.has(name)) candidates.set(name, row.company);
  }
  // Hub companies with the same name: the first by id gets the match, so it is stable.
  const unlinkedHub = [...hubById.values()]
    .filter((hubCompany) => !linkedHubIds.has(hubCompany.id))
    .map((hubCompany) => ({ hubCompany, name: normalizeCompanyName(hubCompany.name) }))
    .toSorted((left, right) =>
      left.name === right.name
        ? left.hubCompany.id.localeCompare(right.hubCompany.id)
        : left.name.localeCompare(right.name),
    );
  const matchedLocalIds = new Set<string>();
  for (const { hubCompany, name } of unlinkedHub) {
    const match = candidates.get(name) ?? null;
    if (match !== null) {
      candidates.delete(name);
      matchedLocalIds.add(match.id);
      hubRows.push({
        kind: "matched",
        key: match.id,
        company: match,
        hubCompany,
        canLink: hubCompany.role === "owner" || hubCompany.role === "admin",
      });
      continue;
    }
    hubRows.push({ kind: "hub-only", key: `${HUB_ROW_PREFIX}${hubCompany.id}`, hubCompany });
  }

  const rowName = (row: SwitcherRow) => (row.kind === "hub-only" ? row.hubCompany : row.company);
  return [
    ...personal,
    ...hubRows.toSorted((left, right) => byName(rowName(left), rowName(right))),
    ...localRows
      .filter((row) => !matchedLocalIds.has(row.company.id))
      .toSorted((left, right) => byName(left.company, right.company)),
  ];
}
