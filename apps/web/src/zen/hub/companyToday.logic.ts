// Zen Staff: "Your company today" (Office home, Team page). Pure: which hub company the card is
// about and every number on it, only from ops the app already has (hub status, company.get,
// companyPacks.list, devices.trusted; chat status; staff overview; thread shells).

export type CompanyTodayStaffStatus = "working" | "idle" | "waiting-approval" | "paused";

/** What the card needs from hub `status`. */
export interface CompanyTodayHubStatus {
  readonly hubUrl: string | null;
  readonly signedIn: boolean;
  readonly companies: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Local company id -> hub company id. */
  readonly links: Readonly<Record<string, string>>;
  readonly twoFactor?: { readonly gate: "ok" | "enroll" | "verify" } | null;
  readonly environments?: ReadonlyArray<{ readonly id: string; readonly online: boolean }>;
}

/** Shown only to someone signed in, past the two-factor gate, and in at least one hub company. */
export function showCompanyToday(status: CompanyTodayHubStatus | null): boolean {
  if (status === null || !status.signedIn) return false;
  if (status.twoFactor != null && status.twoFactor.gate !== "ok") return false;
  return status.companies.length > 0;
}

/**
 * The hub company the card is about: the one the person picked, else the one the sidebar's local
 * company is linked to, else the first linked one, else the first company they belong to.
 */
export function pickCompanyTodayCompany(
  status: Pick<CompanyTodayHubStatus, "companies" | "links">,
  activeLocalCompanyId: string | null,
  chosenHubCompanyId: string | null,
): string | null {
  const member = new Set(status.companies.map((company) => company.id));
  if (chosenHubCompanyId !== null && member.has(chosenHubCompanyId)) return chosenHubCompanyId;
  const active = activeLocalCompanyId === null ? undefined : status.links[activeLocalCompanyId];
  if (active !== undefined && member.has(active)) return active;
  const linked = Object.values(status.links).find((hubId) => member.has(hubId));
  return linked ?? status.companies[0]?.id ?? null;
}

/** The local company (companies feature) linked to a hub company, if this machine has one. */
export function localCompanyOf(
  links: Readonly<Record<string, string>>,
  hubCompanyId: string,
): string | null {
  const found = Object.entries(links)
    .filter(([, hubId]) => hubId === hubCompanyId)
    .map(([localId]) => localId)
    .toSorted();
  return found[0] ?? null;
}

/**
 * The hub's web app for the "Open in browser" link: `<hub url>/app`, and only over https (or http
 * on this machine), without credentials, query or fragment. Null for anything else.
 */
export function hubAppUrl(hubUrl: string | null): string | null {
  if (hubUrl === null || hubUrl.length > 300) return null;
  let url: URL;
  try {
    url = new URL(hubUrl.trim());
  } catch {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username !== "" || url.password !== "") return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}/app`;
}

/** Whether `url` is exactly the hub's own /app address (the only page the card opens). */
export function isHubAppUrl(url: string, hubUrl: string | null): boolean {
  const expected = hubAppUrl(hubUrl);
  return expected !== null && url === expected;
}

export interface CompanyTodayThread {
  readonly environmentId: string;
  readonly id: string;
  readonly hasPendingApprovals: boolean;
  readonly archivedAt: string | null;
  /** The local company of the thread's project. */
  readonly companyId: string;
}

export interface CompanyTodaySources {
  readonly status: CompanyTodayHubStatus;
  readonly hubCompanyId: string;
  /** The linked local company, or null when this machine has none for the hub company. */
  readonly localCompanyId: string | null;
  /** null while loading. */
  readonly threads: ReadonlyArray<CompanyTodayThread> | null;
  /** AI staff `overview`; null while loading, undefined when there is no linked local company. */
  readonly staff:
    | {
        readonly agents: ReadonlyArray<{
          readonly id: string;
          readonly name: string;
          readonly role: string;
          readonly status: CompanyTodayStaffStatus;
        }>;
        readonly approvals: ReadonlyArray<{ readonly status: string }>;
      }
    | null
    | undefined;
  /** Chat integrations `status.pendingApprovals`; null while loading or unavailable. */
  readonly messageApprovals: number | null;
  /** Hub `devices.trusted`; null while loading. */
  readonly trustedDevices: {
    readonly canDecide?: boolean;
    readonly devices: ReadonlyArray<{ readonly pending?: boolean }>;
  } | null;
  /** Hub `company.get` runners; null while loading. */
  readonly runners: ReadonlyArray<{ readonly name: string; readonly online: boolean }> | null;
  /** Hub `companyPacks.list` status rows; null while loading. */
  readonly packStatus: ReadonlyArray<{
    readonly packId: string;
    readonly environmentId: string;
    readonly environmentName: string;
    readonly userName: string;
    readonly state: string;
    readonly error: string | null;
  }> | null;
}

export interface CompanyTodayView {
  readonly approvals: {
    /** null until every source has answered once. */
    readonly total: number | null;
    /** Chats on this machine waiting for an approval (the first one is the link). */
    readonly chats: number | null;
    readonly firstChat: { readonly environmentId: string; readonly threadId: string } | null;
    /** Outbound actions of AI staff waiting for their manager. */
    readonly staff: number | null;
    /** E-mail replies and tool requests of chat integrations. */
    readonly messages: number | null;
    /** New devices of colleagues waiting for this runner's approval (only when you decide). */
    readonly devices: number | null;
  };
  /** null while loading; "unlinked" when no local company is linked to the hub company. */
  readonly staff:
    | {
        readonly agents: ReadonlyArray<{
          readonly id: string;
          readonly name: string;
          readonly role: string;
          readonly status: CompanyTodayStaffStatus;
        }>;
        readonly working: number;
        readonly total: number;
      }
    | "unlinked"
    | null;
  /** The person's machines on the hub; null when the hub did not say. */
  readonly devices: { readonly online: number; readonly total: number } | null;
  /** The company runner: null while loading, "none" when the company has no runner. */
  readonly runner: { readonly name: string; readonly online: boolean } | "none" | null;
  readonly packIssues: ReadonlyArray<{
    readonly key: string;
    readonly packId: string;
    readonly machine: string;
    readonly person: string;
    readonly error: string | null;
  }> | null;
  readonly appUrl: string | null;
}

const STATUS_ORDER: Readonly<Record<CompanyTodayStaffStatus, number>> = {
  "waiting-approval": 0,
  working: 1,
  idle: 2,
  paused: 3,
};

export function deriveCompanyToday(sources: CompanyTodaySources): CompanyTodayView {
  const pendingChats =
    sources.threads === null
      ? null
      : sources.threads
          .filter((thread) => thread.hasPendingApprovals && thread.archivedAt === null)
          .filter(
            (thread) =>
              sources.localCompanyId === null || thread.companyId === sources.localCompanyId,
          );
  const staffApprovals =
    sources.staff === undefined
      ? 0
      : sources.staff === null
        ? null
        : sources.staff.approvals.filter((approval) => approval.status === "pending").length;
  const devices =
    sources.trustedDevices === null
      ? null
      : sources.trustedDevices.canDecide === true
        ? sources.trustedDevices.devices.filter((device) => device.pending === true).length
        : 0;
  const messages = sources.messageApprovals;
  const parts = [pendingChats?.length ?? null, staffApprovals, messages, devices];
  const total = parts.some((part) => part === null)
    ? null
    : parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);

  const staff =
    sources.staff === undefined
      ? ("unlinked" as const)
      : sources.staff === null
        ? null
        : {
            agents: sources.staff.agents.toSorted(
              (left, right) =>
                STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
                left.name.localeCompare(right.name),
            ),
            working: sources.staff.agents.filter((agent) => agent.status === "working").length,
            total: sources.staff.agents.length,
          };

  const environments = sources.status.environments;
  const runner =
    sources.runners === null
      ? null
      : sources.runners.length === 0
        ? ("none" as const)
        : (sources.runners.find((item) => item.online) ?? sources.runners[0]!);

  return {
    approvals: {
      total,
      chats: pendingChats?.length ?? null,
      firstChat:
        pendingChats?.[0] === undefined
          ? null
          : { environmentId: pendingChats[0].environmentId, threadId: pendingChats[0].id },
      staff: staffApprovals,
      messages,
      devices,
    },
    staff,
    devices:
      environments === undefined
        ? null
        : {
            online: environments.filter((item) => item.online).length,
            total: environments.length,
          },
    runner:
      runner === null || runner === "none" ? runner : { name: runner.name, online: runner.online },
    packIssues:
      sources.packStatus === null
        ? null
        : sources.packStatus
            .filter((row) => row.state === "failed")
            .map((row) => ({
              key: `${row.packId}:${row.environmentId}`,
              packId: row.packId,
              machine: row.environmentName,
              person: row.userName,
              error: row.error,
            })),
    appUrl: hubAppUrl(sources.status.hubUrl),
  };
}
