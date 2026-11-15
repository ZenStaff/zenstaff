// @effect-diagnostics nodeBuiltinImport:off -- Pure helpers shared by the hub service and its tests (hashing only).
// Zen Staff hub: company-level objects (hub v6). Pure rules shared by the service (ZenHub.ts) and
// the tests:
//
// - AI staff synced through the hub. The editor's app seals the profile to each company runner's
//   box key and signs a statement (the same bytes as the hub's routes/companyObjects.ts). A runner
//   applies a version only when the statement matches the record, is signed by a device it trusts
//   for that person, the person is an owner/admin (or the agent's manager changing an agent it
//   already manages), and the version is newer than the one it applied. The hub never sees a
//   profile in clear and cannot forge, roll back or move one.
// - Packs installed for the whole company: an admin's signed statement (pack id, version,
//   settings, Enterprise flag); every member's app and the runner install it on sync.
import * as NodeCrypto from "node:crypto";

import { zenHubCan, type ZenHubAccess } from "@t3tools/contracts/zenHub";
import type { StaffAgent } from "@t3tools/contracts/zenStaff";

import type { HubRole } from "./hubBridge.ts";
import { canonicalJson, sealContext, statementMessage, verifyText } from "./hubCrypto.ts";
import {
  isApprovedPin,
  trustDevice,
  withPinnedDevice,
  type PinnedDevice,
  type RelayDevice,
  type TrustStore,
} from "./relayTrust.ts";

/** The scope company relay requests are signed and sealed for (the share relay uses share ids). */
export const companyScope = (hubCompanyId: string) => `company:${hubCompanyId}`;

/** AAD of one sealed profile: bound to the company, the agent and the version. */
export const staffSealContext = (
  hubCompanyId: string,
  environmentId: string,
  staffId: string,
  version: number,
) =>
  sealContext(
    "staff.profile",
    companyScope(hubCompanyId),
    `${environmentId}:${staffId}:${version}`,
    "request",
  );

export const sealedDigest = (sealed: Readonly<Record<string, string>>) =>
  NodeCrypto.createHash("sha256").update(canonicalJson(sealed)).digest("base64url");

export function staffStatement(input: {
  readonly companyId: string;
  readonly staffId: string;
  readonly version: number;
  readonly managerUserId: string | null;
  readonly deleted: boolean;
  readonly sealed: Readonly<Record<string, string>>;
  readonly by: string;
  readonly ts: number;
}) {
  return {
    action: "staff.put",
    companyId: input.companyId,
    staffId: input.staffId,
    version: input.version,
    managerUserId: input.managerUserId,
    deleted: input.deleted,
    sealedSha256: sealedDigest(input.sealed),
    by: input.by,
    ts: input.ts,
  };
}

export function packStatement(input: {
  readonly companyId: string;
  readonly packId: string;
  readonly version: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly enterprise: boolean;
  readonly by: string;
  readonly ts: number;
}) {
  return {
    action: "company-pack",
    companyId: input.companyId,
    packId: input.packId,
    version: input.version,
    settings: input.settings,
    enterprise: input.enterprise,
    by: input.by,
    ts: input.ts,
  };
}

/** What the hub hands back for a signed record (staff or pack). */
export interface HubSigned {
  readonly statement: string;
  readonly signature: string;
  readonly signerKeyId: string;
  readonly signerPublicKey: string | null;
  readonly signerBoxPublicKey?: string | null;
  readonly signerCerts?: RelayDevice["certs"];
  readonly updatedBy: string;
  readonly updatedByName?: string;
  readonly updatedAt: string;
}

export interface HubStaffRecord extends HubSigned {
  readonly staffId: string;
  readonly version: number;
  readonly managerUserId: string | null;
  readonly sealed: Readonly<Record<string, string>>;
  readonly deletedAt: string | null;
  /** Hub v9: the hub project the agent belongs to (metadata; null: the whole company). */
  readonly projectId?: string | null;
}

export interface HubCompanyPack extends HubSigned {
  readonly packId: string;
  readonly version: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly enterprise: boolean;
}

type SignerCheck =
  | { readonly ok: true; readonly pin: PinnedDevice | null }
  | { readonly ok: false; readonly reason: string; readonly pin: PinnedDevice | null };

/**
 * Is the statement signed by a device this machine trusts for `userId`? First use pins the device
 * as pending (the runner's owner approves it) and a pending device cannot change anything.
 */
function checkSigner(
  trust: TrustStore,
  userId: string,
  record: HubSigned,
  statement: Record<string, unknown>,
  nowIso: string,
  /** Member machines: the first device seen for an admin is trusted (later ones must be vouched). */
  firstUseOk = false,
): SignerCheck {
  if (record.signerPublicKey === null)
    return { ok: false, reason: "the signing device is gone", pin: null };
  const known = trust.devices[userId]?.find((item) => item.keyId === record.signerKeyId);
  const decision = trustDevice(
    trust,
    {
      userId,
      keyId: record.signerKeyId,
      signPublicKey: record.signerPublicKey,
      boxPublicKey: known?.boxPublicKey ?? record.signerBoxPublicKey ?? "",
      certs: record.signerCerts ?? [],
    },
    nowIso,
  );
  if (known !== undefined && known.signPublicKey !== record.signerPublicKey) {
    return { ok: false, reason: "the signing device's key changed", pin: null };
  }
  if (known === undefined && !decision.ok) return { ok: false, reason: decision.reason, pin: null };
  let pin = decision.ok ? decision.pin : null;
  if (firstUseOk && pin !== null && !isApprovedPin(pin)) {
    const { state: _pending, ...approved } = pin;
    pin = approved;
  }
  const effective = pin ?? (decision.ok ? decision.device : known);
  if (effective !== undefined && !isApprovedPin(effective)) {
    return { ok: false, reason: "the signing device is waiting for approval on this machine", pin };
  }
  if (
    !verifyText(record.signerPublicKey, statementMessage(statement), record.signature) ||
    canonicalJson(statement) !== record.statement
  ) {
    return { ok: false, reason: "the signature is not valid", pin: null };
  }
  return { ok: true, pin };
}

const parseStatement = (text: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const isManagerRole = (role: HubRole | undefined) => role === "owner" || role === "admin";

/** What this runner applied last for an agent (to authorize managers and refuse rollbacks). */
export interface AppliedStaff {
  readonly version: number;
  readonly managerUserId: string | null;
  /** The hub project of the applied profile (null or absent: the whole company). */
  readonly hubProjectId?: string | null;
}

export interface VerifiedStaff {
  /** Records to apply: newer than what this machine has, with the ciphertext sealed to it. */
  readonly accepted: ReadonlyArray<{
    readonly staffId: string;
    readonly version: number;
    readonly deleted: boolean;
    readonly managerUserId: string | null;
    readonly sealed: string | null;
    readonly updatedBy: string;
    readonly updatedByName: string;
    readonly updatedAt: string;
    /**
     * Set when the editor may change it only through "angajati:administreaza" scoped to a
     * project: the opened profile must belong to this project (null: the whole company), or it
     * is refused (the hub's project metadata is not signed).
     */
    readonly requiredProject?: string | null;
  }>;
  readonly refused: ReadonlyArray<{ readonly staffId: string; readonly reason: string }>;
  readonly pins: ReadonlyArray<{ readonly userId: string; readonly device: PinnedDevice }>;
}

/**
 * Hub v9: may this person change an agent through "angajati:administreaza" (full members only;
 * owners, admins and the manager have their own rules)? Company-wide: anything. Scoped: only an
 * agent of that project, before and after the change. Returns how it is allowed, or null.
 */
export function staffAdministration(input: {
  readonly role: HubRole | undefined;
  readonly access: ZenHubAccess | null | undefined;
  readonly projectBefore: string | null | undefined;
  readonly projectAfter: string | null;
  readonly existed: boolean;
}): "company" | "project" | null {
  if (input.role !== "member" || input.access == null) return null;
  if (zenHubCan(input.access, "angajati:administreaza")) return "company";
  const inProject = (projectId: string | null | undefined) =>
    projectId != null && zenHubCan(input.access, "angajati:administreaza", { projectId });
  if (!inProject(input.projectAfter)) return null;
  if (input.existed && !inProject(input.projectBefore)) return null;
  return "project";
}

/** The runner's (or a member's) check of the hub's staff list. */
export function verifyStaffRecords(input: {
  readonly records: ReadonlyArray<HubStaffRecord>;
  readonly companyId: string;
  readonly environmentId: string;
  readonly members: Readonly<Record<string, HubRole>>;
  /** Hub v9: each member's permissions (from the hub); absent for an older hub. */
  readonly access?: Readonly<Record<string, ZenHubAccess>>;
  readonly applied: Readonly<Record<string, AppliedStaff>>;
  readonly trust: TrustStore;
  readonly nowIso: string;
}): VerifiedStaff {
  let trust = input.trust;
  const accepted: Array<VerifiedStaff["accepted"][number]> = [];
  const refused: Array<VerifiedStaff["refused"][number]> = [];
  const pins: Array<VerifiedStaff["pins"][number]> = [];
  for (const record of input.records) {
    const refuse = (reason: string) => refused.push({ staffId: record.staffId, reason });
    const previous = input.applied[record.staffId];
    if (previous !== undefined && record.version <= previous.version) {
      if (record.version < previous.version) refuse("older than the version this machine has");
      continue;
    }
    const statement = parseStatement(record.statement);
    const deleted = record.deletedAt !== null;
    if (
      statement === null ||
      statement.action !== "staff.put" ||
      statement.companyId !== input.companyId ||
      statement.staffId !== record.staffId ||
      statement.version !== record.version ||
      statement.managerUserId !== record.managerUserId ||
      statement.deleted !== deleted ||
      statement.by !== record.updatedBy ||
      statement.sealedSha256 !== sealedDigest(record.sealed)
    ) {
      refuse("the statement does not match the record");
      continue;
    }
    const by = record.updatedBy;
    const managerEdit =
      input.members[by] === "member" &&
      previous !== undefined &&
      previous.managerUserId === by &&
      record.managerUserId === by &&
      !deleted;
    // Hub v9: "angajați AI: administrează" (for the company, or for the agent's project before
    // and after the change) also edits, creates and removes agents.
    const administration =
      isManagerRole(input.members[by]) || managerEdit
        ? null
        : staffAdministration({
            role: input.members[by],
            access: input.access?.[by],
            projectBefore: previous?.hubProjectId ?? null,
            projectAfter: record.projectId ?? null,
            existed: previous !== undefined,
          });
    if (!isManagerRole(input.members[by]) && !managerEdit && administration === null) {
      refuse(
        "changed by someone who is not an owner, an admin or the agent's manager, nor allowed to manage AI staff",
      );
      continue;
    }
    const signer = checkSigner(trust, by, record, statement, input.nowIso);
    if (signer.pin !== null) {
      pins.push({ userId: by, device: signer.pin });
      trust = withPinnedDevice(trust, by, signer.pin);
    }
    if (!signer.ok) {
      refuse(signer.reason);
      continue;
    }
    const sealed = record.sealed[input.environmentId] ?? null;
    if (!deleted && sealed === null) {
      refuse("it was not sealed to this machine (saved before it became the company runner)");
      continue;
    }
    accepted.push({
      staffId: record.staffId,
      version: record.version,
      deleted,
      managerUserId: record.managerUserId,
      sealed,
      updatedBy: by,
      updatedByName: record.updatedByName ?? "",
      updatedAt: record.updatedAt,
      ...(administration === "project" ? { requiredProject: record.projectId ?? null } : {}),
    });
  }
  return { accepted, refused, pins };
}

export interface VerifiedPacks {
  readonly packs: ReadonlyArray<HubCompanyPack>;
  readonly refused: ReadonlyArray<{ readonly packId: string; readonly reason: string }>;
  readonly pins: ReadonlyArray<{ readonly userId: string; readonly device: PinnedDevice }>;
}

/** Company packs whose statement an owner/admin's trusted device signed for this company. */
export function verifyCompanyPacks(input: {
  readonly packs: ReadonlyArray<HubCompanyPack>;
  readonly companyId: string;
  readonly members: Readonly<Record<string, HubRole>>;
  readonly trust: TrustStore;
  readonly nowIso: string;
  /** Not the company runner: see `checkSigner`. */
  readonly firstUseOk?: boolean;
}): VerifiedPacks {
  let trust = input.trust;
  const packs: Array<HubCompanyPack> = [];
  const refused: Array<VerifiedPacks["refused"][number]> = [];
  const pins: Array<VerifiedPacks["pins"][number]> = [];
  for (const pack of input.packs) {
    const refuse = (reason: string) => refused.push({ packId: pack.packId, reason });
    const statement = parseStatement(pack.statement);
    if (
      statement === null ||
      statement.action !== "company-pack" ||
      statement.companyId !== input.companyId ||
      statement.packId !== pack.packId ||
      statement.version !== pack.version ||
      statement.enterprise !== pack.enterprise ||
      statement.by !== pack.updatedBy ||
      canonicalJson(statement.settings ?? {}) !== canonicalJson(pack.settings)
    ) {
      refuse("the statement does not match the pack");
      continue;
    }
    if (!isManagerRole(input.members[pack.updatedBy])) {
      refuse("installed by someone who is not an owner or admin");
      continue;
    }
    const signer = checkSigner(
      trust,
      pack.updatedBy,
      pack,
      statement,
      input.nowIso,
      input.firstUseOk === true,
    );
    if (signer.pin !== null) {
      const pin = signer.pin;
      pins.push({ userId: pack.updatedBy, device: pin });
      trust = withPinnedDevice(trust, pack.updatedBy, pin);
    }
    if (!signer.ok) {
      refuse(signer.reason);
      continue;
    }
    packs.push(pack);
  }
  return { packs, refused, pins };
}

export type PackSyncState = "installing" | "installed" | "failed" | "runner-only";

export type PackAction =
  | { readonly kind: "install"; readonly packId: string; readonly version: string }
  | {
      readonly kind: "report";
      readonly packId: string;
      readonly state: PackSyncState;
      readonly version: string | null;
    };

/**
 * What this machine does for each company pack: an Enterprise pack installs only on the company
 * runner (secrets stay there); others install when missing or at another version. A failed install
 * is retried after `retryMs`.
 */
export function planPackSync(input: {
  readonly packs: ReadonlyArray<Pick<HubCompanyPack, "packId" | "version" | "enterprise">>;
  readonly installed: Readonly<Record<string, string | null>>;
  readonly isRunner: boolean;
  readonly lastFailure: Readonly<Record<string, number>>;
  readonly now: number;
  readonly retryMs?: number;
  /** Packs customized on this machine: kept as they are (their version is reported). */
  readonly customized?: ReadonlySet<string> | undefined;
}): ReadonlyArray<PackAction> {
  const retryMs = input.retryMs ?? 10 * 60_000;
  return input.packs.flatMap((pack): ReadonlyArray<PackAction> => {
    const have = input.installed[pack.packId];
    if (pack.enterprise && !input.isRunner) {
      return [{ kind: "report", packId: pack.packId, state: "runner-only", version: have ?? null }];
    }
    if (have !== undefined && have !== null && have === pack.version) {
      return [{ kind: "report", packId: pack.packId, state: "installed", version: have }];
    }
    // A customized copy is never overwritten by an install: report what is there instead of
    // installing again on every sync. The person takes the new version on the card (Keep/Take/Merge).
    if (have !== undefined && input.customized?.has(pack.packId) === true) {
      return [{ kind: "report", packId: pack.packId, state: "installed", version: have }];
    }
    const failedAt = input.lastFailure[pack.packId];
    if (failedAt !== undefined && input.now - failedAt < retryMs) return [];
    return [{ kind: "install", packId: pack.packId, version: pack.version }];
  });
}

/** What travels sealed: the profile without anything that only means something on one machine. */
export type HubStaffProfile = Omit<StaffAgent, "companyId" | "owner" | "projectId" | "hub"> & {
  readonly managerName: string | null;
};

const MAX_PROFILE_TEXT = 40_000;

/** Local agent -> sealed profile. The manager is the hub person (`hub-<userId>`) or nobody. */
export function toHubProfile(
  agent: StaffAgent,
  input: { readonly staffId: string; readonly managerName: string | null },
): HubStaffProfile {
  const { companyId: _company, owner: _owner, projectId: _project, hub: _hub, ...rest } = agent;
  return {
    ...rest,
    id: input.staffId,
    kind: "company",
    instructions: agent.instructions.slice(0, MAX_PROFILE_TEXT),
    duties: agent.duties.map((duty) => ({ ...duty, scheduledTaskId: null })),
    managerName: input.managerName,
  };
}

/**
 * The hub person behind a staff manager id. The web lists hub members as people with the id
 * `hub-<userId>` (hub ids are already base64url, so nothing is replaced).
 */
export const hubUserOfManager = (managerId: string | null): string | null =>
  managerId !== null && managerId.startsWith("hub-") && managerId.length > 4
    ? managerId.slice(4)
    : null;

export const managerIdOfHubUser = (userId: string | null): string | null =>
  userId === null ? null : `hub-${userId}`;

/** Sealed profile -> local agent; keeps what is local to this machine (folder, scheduled tasks). */
export function fromHubProfile(
  profile: HubStaffProfile,
  input: {
    readonly localCompanyId: string;
    readonly existing: StaffAgent | null;
    readonly fallbackProjectId: string | null;
    readonly hub: NonNullable<StaffAgent["hub"]>;
  },
): StaffAgent {
  const { managerName: _name, ...rest } = profile;
  const existing = input.existing;
  return {
    ...rest,
    id: existing?.id ?? profile.id,
    companyId: input.localCompanyId,
    kind: "company",
    owner: null,
    projectId: existing?.projectId ?? input.fallbackProjectId,
    duties: profile.duties.map((duty) => ({
      ...duty,
      scheduledTaskId:
        input.hub.source === "runner"
          ? (existing?.duties.find((item) => item.id === duty.id)?.scheduledTaskId ?? null)
          : null,
    })),
    hub: input.hub,
  };
}
