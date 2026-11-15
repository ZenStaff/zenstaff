// @effect-diagnostics globalDate:off -- Pure helpers over plain timestamps.
// Zen Staff hub: what a runner trusts, decided on the runner. Pure functions over plain records.
//
// The hub authenticates people, but a runner does not take its word for who asked: each relay
// request must carry a signature from the asking person's device, and the device must be one this
// runner already pinned for that person (first use), or one approved by such a device (a
// cross-signature made on the person's own machine). A compromised hub can route and refuse, but
// it cannot forge a prompt as someone this runner knows, and it cannot read sealed content.
//
// First use is confirmed out of band: a person's first device key is pinned as "pending" and can
// only read (live view, title and comments) until the runner's owner or a company owner/admin
// approves it on this machine (Team > Account, with the key fingerprint), or until one of that
// person's approved devices cross-signs it. Pins made before this rule have no state and count as
// approved.
import {
  canonicalJson,
  deviceCertMessage,
  fingerprintOf,
  keyIdOf,
  requestMessage,
  SIGNATURE_MAX_SKEW_MS,
  statementMessage,
  verifyText,
  type RequestSignature,
} from "./hubCrypto.ts";

export interface PinnedDevice {
  readonly keyId: string;
  readonly signPublicKey: string;
  readonly boxPublicKey: string;
  /** "first-use": the first device seen for that person; "approved": cross-signed by a pinned one. */
  readonly via: "own" | "first-use" | "approved";
  readonly at: string;
  readonly label?: string;
  /** "pending": pinned on first use, read-only until approved. Absent: approved (older pins too). */
  readonly state?: "pending";
  /** When and by whom a pending pin was approved on this runner. */
  readonly approvedAt?: string;
  readonly approvedBy?: string;
}

/** A pin that may do everything its share allows (not only read). */
export const isApprovedPin = (device: PinnedDevice): boolean => device.state !== "pending";

/** At most this many devices of one person wait for approval on a runner. */
export const MAX_PENDING_PER_PERSON = 5;

/** What an unapproved device may still do: read the chat, its title and comments. */
const PENDING_ALLOWED_OPS = new Set(["thread.view", "thread.meta", "staff.list"]);

export const PENDING_DEVICE_REFUSAL =
  "Waiting for approval of this device on the runner. Until its owner (or a company owner or admin) approves it there, you can only read this chat.";

/** Null when the op may go ahead for this device; the refusal otherwise. */
export function pendingRefusal(device: PinnedDevice, op: string): string | null {
  return isApprovedPin(device) || PENDING_ALLOWED_OPS.has(op) ? null : PENDING_DEVICE_REFUSAL;
}

export interface TrustStore {
  /** Hub user id -> devices this runner accepts requests from. */
  readonly devices: Readonly<Record<string, ReadonlyArray<PinnedDevice>>>;
  /** Key ids signed out on the hub (never accepted again, even with a certificate). */
  readonly revoked: ReadonlyArray<string>;
  /** Key ids rejected on this runner while pending (never pinned again here). */
  readonly rejected?: ReadonlyArray<string>;
  /** Hub environment id -> the runner keys this machine pinned when it first talked to it. */
  readonly runners: Readonly<
    Record<
      string,
      { readonly signPublicKey: string; readonly boxPublicKey: string; readonly at: string }
    >
  >;
}

export const emptyTrustStore = (): TrustStore => ({
  devices: {},
  revoked: [],
  rejected: [],
  runners: {},
});

export interface RelayDevice {
  readonly userId: string;
  readonly keyId: string;
  readonly signPublicKey: string;
  readonly boxPublicKey: string;
  readonly certs?: ReadonlyArray<{
    readonly signerKeyId: string;
    readonly signerPublicKey: string;
    readonly signature: string;
  }>;
}

export type TrustDecision =
  | { readonly ok: true; readonly device: PinnedDevice; readonly pin: PinnedDevice | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Is this device one we accept for that person? Pins it on first use (pending) or when approved
 * by a cross-signature from one of their approved devices. The decision's `device` may be pending:
 * callers check `pendingRefusal` before doing anything but reading.
 */
export function trustDevice(trust: TrustStore, device: RelayDevice, nowIso: string): TrustDecision {
  if (keyIdOf(device.signPublicKey) !== device.keyId)
    return { ok: false, reason: "The device key does not match its id." };
  if (trust.revoked.includes(device.keyId))
    return { ok: false, reason: "This device was signed out." };
  if ((trust.rejected ?? []).includes(device.keyId))
    return { ok: false, reason: "This device was rejected on the runner." };
  const pinned = trust.devices[device.userId] ?? [];
  const approved = pinned.filter(isApprovedPin);
  const message = deviceCertMessage({
    userId: device.userId,
    keyId: device.keyId,
    signPublicKey: device.signPublicKey,
    boxPublicKey: device.boxPublicKey,
  });
  // Only a signer this runner pinned AND approved counts, with the key it pinned (not the hub's).
  const certified = (device.certs ?? []).some((cert) => {
    const signer = approved.find((item) => item.keyId === cert.signerKeyId);
    return signer !== undefined && verifyText(signer.signPublicKey, message, cert.signature);
  });
  const known = pinned.find((item) => item.keyId === device.keyId);
  if (known !== undefined) {
    if (
      known.signPublicKey !== device.signPublicKey ||
      known.boxPublicKey !== device.boxPublicKey
    ) {
      return { ok: false, reason: "This device's keys changed. The request was refused." };
    }
    if (!isApprovedPin(known) && certified) {
      // Approved since: one of the person's approved devices vouched for it.
      const { state: _pending, ...rest } = known;
      const pin: PinnedDevice = { ...rest, via: "approved", approvedAt: nowIso };
      return { ok: true, device: pin, pin };
    }
    return { ok: true, device: known, pin: null };
  }
  const fresh = (via: PinnedDevice["via"]): PinnedDevice => ({
    keyId: device.keyId,
    signPublicKey: device.signPublicKey,
    boxPublicKey: device.boxPublicKey,
    via,
    at: nowIso,
  });
  if (certified) {
    const pin = fresh("approved");
    return { ok: true, device: pin, pin };
  }
  if (approved.length === 0) {
    // Nobody vouches for this person here yet: pin it, read-only, and ask for an approval.
    if (pinned.length >= MAX_PENDING_PER_PERSON) {
      return {
        ok: false,
        reason:
          "Too many devices of this person are waiting for approval on the runner. Approve or reject them there first.",
      };
    }
    const pin: PinnedDevice = { ...fresh("first-use"), state: "pending" };
    return { ok: true, device: pin, pin };
  }
  return {
    ok: false,
    reason:
      "This request comes from a new device that none of this person's known devices approved. Approve it from one of their other devices (Team > Account > Devices).",
  };
}

/** The runner owner (or a company owner/admin) approves a pending device on this machine. */
export function withApprovedDevice(
  trust: TrustStore,
  userId: string,
  keyId: string,
  approvedBy: string,
  nowIso: string,
): TrustStore | null {
  const devices = trust.devices[userId] ?? [];
  const target = devices.find((item) => item.keyId === keyId);
  if (target === undefined) return null;
  const { state: _pending, ...rest } = target;
  const next: PinnedDevice = { ...rest, approvedAt: nowIso, approvedBy };
  return {
    ...trust,
    devices: {
      ...trust.devices,
      [userId]: devices.map((item) => (item.keyId === keyId ? next : item)),
    },
  };
}

/** Rejects a pending device: unpinned, and never pinned again on this runner. */
export function withRejectedDevice(trust: TrustStore, userId: string, keyId: string): TrustStore {
  return {
    ...trust,
    rejected: [...new Set([...(trust.rejected ?? []), keyId])].slice(-1000),
    devices: {
      ...trust.devices,
      [userId]: (trust.devices[userId] ?? []).filter((item) => item.keyId !== keyId),
    },
  };
}

/** What the runner's Team page shows to compare with the person (same as the hub's e-mail). */
export const pinFingerprint = (device: PinnedDevice): string => fingerprintOf(device.signPublicKey);

/**
 * Checks a comment the hub handed over: signed by the author's device over its ciphertext
 * (`comment.add`). `verified` is true only for a device this runner approved for the author.
 */
export function verifyCommentSignature(
  trust: TrustStore,
  input: {
    readonly shareId: string;
    readonly authorId: string;
    readonly sealed: string;
    readonly sig: RequestSignature | undefined;
    readonly device: RelayDevice | undefined;
  },
  nowIso: string,
): { readonly ok: false } | { readonly ok: true; readonly verified: boolean } {
  const { sig, device } = input;
  if (sig === undefined || device === undefined) return { ok: false };
  if (device.userId !== input.authorId || device.keyId !== sig.keyId) return { ok: false };
  const message = requestMessage({
    op: "comment.add",
    shareId: input.shareId,
    userId: input.authorId,
    keyId: sig.keyId,
    ts: sig.ts,
    nonce: sig.nonce,
    payload: { sealed: input.sealed },
  });
  if (!verifyText(device.signPublicKey, message, sig.signature)) return { ok: false };
  const decision = trustDevice(trust, device, nowIso);
  return { ok: true, verified: decision.ok && isApprovedPin(decision.device) };
}

export interface RelayFrameLike {
  readonly op: string;
  readonly shareId: string;
  readonly actor: { readonly userId: string };
  readonly input: unknown;
  readonly sig?: RequestSignature | undefined;
  readonly device?: RelayDevice | undefined;
}

/**
 * Checks a relay request's signature and the device behind it. `seenNonce` returns true when the
 * nonce was used before (and records it).
 */
export function verifyRelayRequest(
  trust: TrustStore,
  frame: RelayFrameLike,
  now: number,
  seenNonce: (nonce: string) => boolean,
): TrustDecision {
  const { sig, device } = frame;
  if (sig === undefined || device === undefined) {
    return { ok: false, reason: "This request is not signed by the person's device." };
  }
  if (device.userId !== frame.actor.userId || sig.keyId !== device.keyId) {
    return { ok: false, reason: "The signature does not belong to the person who asked." };
  }
  if (Math.abs(now - sig.ts) > SIGNATURE_MAX_SKEW_MS)
    return { ok: false, reason: "The request is too old." };
  const message = requestMessage({
    op: frame.op,
    shareId: frame.shareId,
    userId: frame.actor.userId,
    keyId: sig.keyId,
    ts: sig.ts,
    nonce: sig.nonce,
    payload: frame.input,
  });
  if (!verifyText(device.signPublicKey, message, sig.signature)) {
    return { ok: false, reason: "The request signature is not valid." };
  }
  const decision = trustDevice(trust, device, new Date(now).toISOString());
  if (!decision.ok) return decision;
  if (seenNonce(sig.nonce)) return { ok: false, reason: "This request was already used." };
  return decision;
}

export function withPinnedDevice(
  trust: TrustStore,
  userId: string,
  device: PinnedDevice,
): TrustStore {
  const current = (trust.devices[userId] ?? []).filter((item) => item.keyId !== device.keyId);
  return { ...trust, devices: { ...trust.devices, [userId]: [...current, device] } };
}

export function withRevokedDevices(
  trust: TrustStore,
  userId: string,
  keyIds: ReadonlyArray<string>,
): TrustStore {
  if (keyIds.length === 0) return trust;
  return {
    ...trust,
    revoked: [...new Set([...trust.revoked, ...keyIds])].slice(-1000),
    devices: {
      ...trust.devices,
      [userId]: (trust.devices[userId] ?? []).filter((item) => !keyIds.includes(item.keyId)),
    },
  };
}

/** Client side: pin the runner's keys on first use; refuse when they change later. */
export function checkRunnerKeys(
  trust: TrustStore,
  environmentId: string,
  keys: { readonly signPublicKey: string; readonly boxPublicKey: string } | null,
  nowIso: string,
): { ok: true; pin: TrustStore["runners"][string] | null } | { ok: false; reason: string } {
  if (keys === null)
    return {
      ok: false,
      reason:
        "That machine has not published its encryption keys yet. Ask its owner to open Zen Staff.",
    };
  const pinned = trust.runners[environmentId];
  if (pinned === undefined) return { ok: true, pin: { ...keys, at: nowIso } };
  if (pinned.signPublicKey !== keys.signPublicKey || pinned.boxPublicKey !== keys.boxPublicKey) {
    return {
      ok: false,
      reason:
        "That machine's keys changed since you last used it. Ask its owner before you continue.",
    };
  }
  return { ok: true, pin: null };
}

export interface HubGrant {
  readonly id: string;
  readonly packId: string;
  readonly kind: "use" | "install";
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly grantedBy: string;
  readonly grantedByName: string;
  readonly statement: string;
  readonly signerKeyId: string;
  readonly signature: string;
  readonly signerPublicKey: string | null;
  readonly signerCerts?: RelayDevice["certs"];
  readonly createdAt: string;
}

export interface VerifiedLedger {
  readonly grants: ReadonlyArray<{ packId: string; user: string; grantedBy: string; at: string }>;
  readonly approvals: ReadonlyArray<{ packId: string; approvedBy: string; at: string }>;
  /** Grants that failed a check, with the reason (shown to the runner's owner). */
  readonly refused: ReadonlyArray<{ id: string; packId: string; reason: string }>;
  /** Admin devices seen for the first time while checking (to pin). */
  readonly pins: ReadonlyArray<{ userId: string; device: PinnedDevice }>;
}

/**
 * Turns the hub's grant list into the runner's ledger, keeping only grants whose statement is
 * signed by a device this runner trusts for that admin, who must manage the company (per the
 * hub's member list), and that name this company.
 */
export function verifyHubGrants(input: {
  readonly grants: ReadonlyArray<HubGrant>;
  readonly companyId: string;
  readonly managers: ReadonlySet<string>;
  readonly trust: TrustStore;
  readonly nowIso: string;
}): VerifiedLedger {
  let trust = input.trust;
  const grants: Array<VerifiedLedger["grants"][number]> = [];
  const approvals: Array<VerifiedLedger["approvals"][number]> = [];
  const refused: Array<VerifiedLedger["refused"][number]> = [];
  const pins: Array<VerifiedLedger["pins"][number]> = [];
  for (const grant of input.grants) {
    const refuse = (reason: string) => refused.push({ id: grant.id, packId: grant.packId, reason });
    let statement: Record<string, unknown>;
    try {
      statement = JSON.parse(grant.statement) as Record<string, unknown>;
    } catch {
      refuse("unreadable statement");
      continue;
    }
    if (
      statement.action !== "grant" ||
      statement.companyId !== input.companyId ||
      statement.packId !== grant.packId ||
      statement.kind !== grant.kind ||
      statement.grantedBy !== grant.grantedBy ||
      (grant.kind === "use" && statement.userEmail !== grant.userEmail)
    ) {
      refuse("the statement does not match the grant");
      continue;
    }
    if (!input.managers.has(grant.grantedBy)) {
      refuse("granted by someone who is not an owner or admin");
      continue;
    }
    if (grant.signerPublicKey === null) {
      refuse("the signing device is gone");
      continue;
    }
    const decision = trustDevice(
      trust,
      {
        userId: grant.grantedBy,
        keyId: grant.signerKeyId,
        signPublicKey: grant.signerPublicKey,
        // The box key is not part of a grant; only the signing key is compared below.
        boxPublicKey:
          trust.devices[grant.grantedBy]?.find((item) => item.keyId === grant.signerKeyId)
            ?.boxPublicKey ?? "",
        certs: grant.signerCerts ?? [],
      },
      input.nowIso,
    );
    const known = trust.devices[grant.grantedBy]?.find((item) => item.keyId === grant.signerKeyId);
    const signerOk =
      known !== undefined ? known.signPublicKey === grant.signerPublicKey : decision.ok;
    if (!signerOk) {
      refuse(decision.ok ? "the signing device's key changed" : decision.reason);
      continue;
    }
    // A grant changes what runs here: a device still waiting for approval cannot make one. It is
    // pinned (pending) so the runner's owner sees it and can approve it.
    const effective = decision.ok ? decision.device : known;
    if (effective !== undefined && !isApprovedPin(effective)) {
      if (known === undefined && decision.ok && decision.pin !== null) {
        pins.push({ userId: grant.grantedBy, device: decision.pin });
        trust = withPinnedDevice(trust, grant.grantedBy, decision.pin);
      }
      refuse("the signing device is waiting for approval on this runner");
      continue;
    }
    if (
      !verifyText(grant.signerPublicKey, statementMessage(statement), grant.signature) ||
      canonicalJson(statement) !== grant.statement
    ) {
      refuse("the signature is not valid");
      continue;
    }
    if (decision.ok && decision.pin !== null) {
      pins.push({ userId: grant.grantedBy, device: decision.pin });
      trust = withPinnedDevice(trust, grant.grantedBy, decision.pin);
    }
    if (grant.kind === "use" && grant.userEmail !== null) {
      grants.push({
        packId: grant.packId,
        user: grant.userEmail.toLowerCase(),
        grantedBy: grant.grantedByName,
        at: grant.createdAt,
      });
    } else if (grant.kind === "install") {
      approvals.push({
        packId: grant.packId,
        approvedBy: grant.grantedByName,
        at: grant.createdAt,
      });
    }
  }
  return { grants, approvals, refused, pins };
}
