// Zen Staff hub v6: seams between the hub service and the features whose objects become company
// level, so the services do not import each other. ZenStaff installs the staff port, ZenOffice the
// pack port, ZenHub the company bridge.
import type { ZenHubAccess } from "@t3tools/contracts/zenHub";
import type { StaffAgent } from "@t3tools/contracts/zenStaff";

import type { HubRole } from "./hubBridge.ts";
import type { HubStaffProfile } from "./companySync.ts";

export interface HubStaffApply {
  readonly staffId: string;
  readonly version: number;
  readonly deleted: boolean;
  /** Null for a deletion. */
  readonly profile: HubStaffProfile | null;
  readonly managerUserId: string | null;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export interface StaffHubPort {
  /** Applies verified hub records to the local company (`runner`: duties are scheduled here). */
  readonly apply: (input: {
    readonly localCompanyId: string;
    readonly hubCompanyId: string;
    readonly source: "runner" | "mirror";
    readonly items: ReadonlyArray<HubStaffApply>;
    /** mirror only: the full list, so agents the hub no longer has are removed here. */
    readonly complete: boolean;
  }) => Promise<void>;
  /** What this machine applied (runner: to refuse rollbacks and authorize managers). */
  readonly applied: (
    localCompanyId: string,
  ) => Readonly<
    Record<string, { version: number; managerUserId: string | null; hubProjectId?: string | null }>
  >;
  /** Runner: the company's hub agents, for members (`staff.list`). */
  readonly listForMembers: (localCompanyId: string) => Promise<
    ReadonlyArray<{
      readonly staffId: string;
      readonly version: number;
      readonly managerUserId: string | null;
      readonly updatedBy: string;
      readonly updatedAt: string;
      readonly profile: HubStaffProfile;
      readonly status: string;
    }>
  >;
  /** Runner: a task a member gave through the hub (`staff.task`). */
  readonly startFromHub: (input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly text: string;
    readonly title: string | null;
    readonly actor: { readonly name: string; readonly email: string; readonly userId?: string };
    /** Hub v9: the giver's permissions (null = owner/admin or an older hub: no extra limit). */
    readonly starterPermissions?: ReadonlyArray<string> | null;
    /**
     * Hub v9: checked with the agent's hub project before anything starts; a refusal stops the
     * task, and `permissions` (when given) replaces `starterPermissions` for the run.
     */
    readonly scope?: (hubProjectId: string | null) => {
      readonly refusal: string | null;
      readonly permissions: ReadonlyArray<string> | null;
    };
  }) => Promise<{ readonly threadId: string; readonly runId: string }>;
  /**
   * Hub v9, `staff.follow`: the run's thread for a read-only live view. Only the person who gave
   * the task, or someone allowed to follow every runner thread (`all`).
   */
  readonly followForHub?: (input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly runId: string;
    readonly actorUserId: string;
    readonly all: boolean;
  }) => Promise<{
    readonly threadId: string;
    readonly title: string;
    readonly status: string;
    readonly phase: unknown;
  }>;
  /** Runner: where a task given through the hub stands, for the member who gave it (`staff.run`). */
  readonly runForHub: (input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly runId: string;
    readonly actorUserId: string;
  }) => Promise<{ readonly phase: unknown }>;
}

export type PackInstallResult =
  | { readonly ok: true; readonly version: string | null }
  | { readonly ok: false; readonly enterprise: boolean; readonly error: string };

export interface PackHubPort {
  /** Pack id -> installed version (null when installed without a version). */
  readonly installed: () => Promise<Readonly<Record<string, string | null>>>;
  /** `hubCompanyId`: the company the pack is installed for (its install approval decides). */
  readonly install: (packId: string, hubCompanyId?: string) => Promise<PackInstallResult>;
  /**
   * Packs with a customized copy here ("Personalizează"): an install never overwrites it, so the
   * sync reports the copy's version instead of installing again on every round.
   */
  readonly customized?: () => Promise<ReadonlySet<string>>;
  /** What the marketplace knows about a pack: its version and whether it is Enterprise. */
  readonly describe: (
    packId: string,
  ) => Promise<{ readonly version: string; readonly enterprise: boolean } | null>;
}

/** What the features ask the hub about company objects. */
export interface CompanyHubBridge {
  /** The hub company a local company is linked to, with my role there; null when not linked. */
  readonly link: (localCompanyId: string) => {
    readonly hubCompanyId: string;
    readonly userId: string;
    readonly role: HubRole | null;
    readonly isRunner: boolean;
    /** Hub v9: my permissions there (team scopes expanded to projects); null: unknown. */
    readonly access?: ZenHubAccess | null;
  } | null;
  /** Seals and signs a profile (or a deletion) and saves it on the hub. */
  readonly publishStaff: (input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly agent: StaffAgent | null;
    readonly managerUserId: string | null;
    readonly managerName: string | null;
    /** The version this edit started from (the next one is higher; last writer wins). */
    readonly baseVersion: number;
  }) => Promise<{ readonly staffId: string; readonly version: number; readonly updatedAt: string }>;
  /** A task for a hub agent, sent to the company runner. */
  readonly sendStaffTask: (input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly text: string;
    readonly title: string | null;
  }) => Promise<{ readonly threadId: string; readonly runId: string }>;
  /** Hub v9: the runner thread of a task this person gave, read-only (steps, files, status). */
  readonly staffFollow?: (input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly runId: string;
    readonly since: string | null;
  }) => Promise<unknown>;
  /** Hub v9: metadata of work done on this runner, for the company's audit log on the hub. */
  readonly reportAudit?: (
    hubCompanyId: string,
    events: ReadonlyArray<Readonly<Record<string, string | null>>>,
  ) => void;
  /** Where a task this person sent to the runner stands (@mention replies follow it). */
  readonly staffRun: (input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly runId: string;
  }) => Promise<{ readonly phase: unknown }>;
  /** Sync state of the company's agents on this machine (for the AI staff page). */
  readonly staffSync: (localCompanyId: string) => {
    readonly syncedAt: string | null;
    readonly problem: string | null;
    readonly refused: ReadonlyArray<{ readonly staffId: string; readonly reason: string }>;
  };
  /** Asks for a sync now (after a change); resolves when it ran. */
  readonly syncNow: () => Promise<void>;
  /** Pack ids the company installs for everyone: members may hide them, not uninstall them. */
  readonly managedPackIds: () => ReadonlySet<string>;
  /** Company packs this person hid here: their workflows are not listed on the Office home. */
  readonly hiddenPackIds: () => ReadonlySet<string>;
}

let staffPort: StaffHubPort | null = null;
let packPort: PackHubPort | null = null;
let companyBridge: CompanyHubBridge | null = null;

export const setZenStaffHubPort = (next: StaffHubPort | null) => {
  staffPort = next;
};
export const zenStaffHubPort = () => staffPort;
export const setZenPackHubPort = (next: PackHubPort | null) => {
  packPort = next;
};
export const zenPackHubPort = () => packPort;
export const setZenCompanyHubBridge = (next: CompanyHubBridge | null) => {
  companyBridge = next;
};
export const zenCompanyHubBridge = () => companyBridge;
