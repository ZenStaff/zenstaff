// Zen Staff hub v6: packs installed for the whole company, the pure part of the marketplace view.
// The server's `companyPacks.list` (zen/hub/companyHub.ts) answers with the company's packs, each
// machine's install status (admins see everyone, members themselves) and what this person hid.

export type CompanyPackState = "installing" | "installed" | "failed" | "runner-only";

export interface CompanyPacksView {
  readonly companyId: string;
  readonly role: "owner" | "admin" | "member" | "guest" | null;
  readonly isRunner: boolean;
  readonly packs: ReadonlyArray<{
    readonly packId: string;
    readonly version: string;
    readonly enterprise: boolean;
    readonly settings: Readonly<Record<string, unknown>>;
    readonly updatedByName: string;
    readonly updatedAt: string;
    readonly verified: boolean;
  }>;
  readonly refused: ReadonlyArray<{ readonly packId: string; readonly reason: string }>;
  readonly status: ReadonlyArray<{
    readonly packId: string;
    readonly environmentId: string;
    readonly environmentName: string;
    readonly userName: string;
    readonly state: CompanyPackState;
    readonly version: string | null;
    readonly error: string | null;
    readonly hidden: boolean;
    readonly runner: boolean;
    readonly updatedAt: string;
  }>;
  readonly hidden: ReadonlyArray<string>;
}

export const isCompanyAdmin = (view: CompanyPacksView | null) =>
  view !== null && (view.role === "owner" || view.role === "admin");

/** What a marketplace card shows for the company: installed for everyone, hidden, installable. */
export function companyPackControl(view: CompanyPacksView | null, packId: string) {
  const pack = view?.packs.find((item) => item.packId === packId) ?? null;
  return {
    managed: pack !== null,
    enterprise: pack?.enterprise === true,
    hidden: view?.hidden.includes(packId) === true,
    canInstall: pack === null && isCompanyAdmin(view),
    canRemove: pack !== null && isCompanyAdmin(view),
  };
}

export interface CompanyPackRow {
  readonly key: string;
  readonly person: string;
  readonly machine: string;
  readonly runner: boolean;
  readonly state: CompanyPackState;
  /** Installed, but not the version the company chose. */
  readonly behind: string | null;
  readonly version: string | null;
  readonly error: string | null;
  readonly hidden: boolean;
  readonly updatedAt: string;
}

const STATE_ORDER: Record<CompanyPackState, number> = {
  failed: 0,
  installing: 1,
  "runner-only": 2,
  installed: 3,
};

/** One row per computer for a pack: problems first, then by person. */
export function companyPackRows(
  view: CompanyPacksView,
  packId: string,
): ReadonlyArray<CompanyPackRow> {
  const wanted = view.packs.find((pack) => pack.packId === packId)?.version ?? null;
  return view.status
    .filter((row) => row.packId === packId)
    .map((row) => ({
      key: `${row.packId}:${row.environmentId}`,
      person: row.userName,
      machine: row.environmentName,
      runner: row.runner,
      state: row.state,
      behind:
        row.state === "installed" &&
        wanted !== null &&
        row.version !== null &&
        row.version !== wanted
          ? row.version
          : null,
      version: row.version,
      error: row.error,
      hidden: row.hidden,
      updatedAt: row.updatedAt,
    }))
    .toSorted(
      (left, right) =>
        STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
        left.person.localeCompare(right.person) ||
        left.machine.localeCompare(right.machine),
    );
}

/** "3 of 4 computers" style counts for a pack's summary line. */
export function companyPackSummary(view: CompanyPacksView, packId: string) {
  const rows = companyPackRows(view, packId);
  return {
    total: rows.length,
    installed: rows.filter((row) => row.state === "installed" && row.behind === null).length,
    failed: rows.filter((row) => row.state === "failed").length,
  };
}
