// Zen Staff hub: what other Zen features ask the hub, without importing the hub service. ZenHub
// installs the bridge at startup; with no hub (or before sign-in) every answer is "not governed by
// a hub" and the features keep their local behaviour.
export type HubRole = "owner" | "admin" | "member" | "guest";

export interface HubAccessLedger {
  readonly grants: ReadonlyArray<{ packId: string; user: string; grantedBy: string; at: string }>;
  readonly approvals: ReadonlyArray<{ packId: string; approvedBy: string; at: string }>;
}

export interface ZenHubBridge {
  /**
   * The signed-in person's hub role in the hub company linked to this local company; `undefined`
   * when the local company is not linked to a hub company (local rules apply).
   */
  readonly roleForLocalCompany: (localCompanyId: string) => HubRole | null | undefined;
  /** Company memory address and save switch set on the hub, or null when the hub has none. */
  readonly memorySettings: (
    localCompanyId: string,
  ) => { readonly url: string | null; readonly saveConversations: boolean } | null;
  readonly setMemorySettings: (
    localCompanyId: string,
    settings: { readonly url: string | null; readonly saveConversations: boolean },
  ) => Promise<void>;
  /** Hosted company memory offered by the hub for the linked hub company (hub v13), or null. */
  readonly hostedMemory?: (localCompanyId: string) => HostedMemoryStatus | null;
  /** Owners/admins: turn on the hosted memory of the linked hub company. */
  readonly activateHostedMemory?: (
    localCompanyId: string,
    saveConversations: boolean,
  ) => Promise<void>;
  /** This machine's own memory key for the linked hub company (shown once by the hub). */
  readonly issueMemoryKey?: (
    localCompanyId: string,
  ) => Promise<{ readonly url: string; readonly apiKey: string; readonly keyId: string }>;
  /** The signed-in person's own memory on the hub (hub v17), or null (no hub / older hub). */
  readonly personalMemory?: () => PersonalMemoryStatus | null;
  /** Turns on the person's own memory on the hub (once). */
  readonly activatePersonalMemory?: () => Promise<PersonalMemoryStatus>;
  /** This device's key for the person's own memory (shown once by the hub). */
  readonly issuePersonalMemoryKey?: () => Promise<{
    readonly url: string;
    readonly apiKey: string;
    readonly keyId: string;
  }>;
  /** The signed-in hub user id (keys of the person's company and personal memory belong to it). */
  readonly hubUserId?: () => string | null;
  /**
   * The runner's verified Enterprise ledger from the hub for the hub company a local company is
   * linked to (each served company has its own; no company: the first served); null when this
   * machine is not a hub runner.
   */
  readonly accessLedger: (localCompanyId?: string | null) => HubAccessLedger | null;
  /**
   * The signed-in person's role in a company this machine runs for (`hubCompanyId`; absent: the
   * first one). Null when not a runner of it.
   */
  readonly runnerRole: (hubCompanyId?: string | null) => HubRole | null;
  /**
   * Hub v9, one server for several companies: the companies this machine serves, with their
   * names and my role, for the Enterprise screen's company picker.
   */
  readonly servedCompanies?: () => ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly role: HubRole | null;
  }>;
  /** The verified ledger of one served company (`null` when this machine does not serve it). */
  readonly ledgerOfHubCompany?: (hubCompanyId: string) => HubAccessLedger | null;
  /**
   * Whether an Enterprise pack may be installed for this company (its own admins' approval
   * only); null when this machine is not a hub runner (the local ledger file decides).
   */
  readonly installApproved?: (
    packId: string,
    scope: { readonly hubCompanyId?: string | null; readonly localCompanyId?: string | null },
  ) => boolean | null;
  /** `companyId` (hub company id): which served company; absent: the first one. */
  readonly grant: (input: {
    readonly packId: string;
    readonly user: string;
    readonly companyId?: string | null;
  }) => Promise<void>;
  readonly revoke: (input: {
    readonly packId: string;
    readonly user: string;
    readonly companyId?: string | null;
  }) => Promise<void>;
  readonly approveInstall: (input: {
    readonly packId: string;
    readonly companyId?: string | null;
  }) => Promise<void>;
  /** The signed-in hub's toolchain advisories file (`/v1/toolchains/advisories`), or null. */
  readonly advisoriesUrl?: () => string | null;
  /** The community library on the hub (communityLibrary.ts): address, session and device signing. */
  readonly library?: {
    /** The signed-in hub, else the default hosted hub (the catalog is public). */
    readonly hubUrl: () => string | null;
    readonly token: () => string | null;
    readonly userId: () => string | null;
    /** Signs a statement message with this machine's hub device key. */
    readonly sign: (message: string) => Promise<string>;
  };
}

export interface PersonalMemoryStatus {
  readonly available: boolean;
  readonly active: boolean;
  readonly url: string | null;
}

export interface HostedMemoryStatus {
  readonly available: boolean;
  readonly activated: boolean;
  readonly active: boolean;
  readonly url: string | null;
}

let bridge: ZenHubBridge | null = null;

export function setZenHubBridge(next: ZenHubBridge | null): void {
  bridge = next;
}

export function zenHubBridge(): ZenHubBridge | null {
  return bridge;
}

export const isHubManager = (role: HubRole | null | undefined) =>
  role === "owner" || role === "admin";
