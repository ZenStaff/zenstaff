// Zen Staff: the hub (accounts, companies, invitations, runner relay, chat sharing). See
// docs/zen-hub.md. One RPC carries every hub operation as `{ op, input }`, so upstream files only
// gain one entry; the server validates each op's input itself.
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "./auth.ts";

export const ZEN_HUB_WS_METHODS = {
  call: "zen.hub.call",
} as const;

const ZEN_HUB_OPS = [
  "status",
  "signIn.start",
  "signIn.verify",
  "signIn.poll",
  "signOut",
  "profile.setName",
  "company.create",
  "company.link",
  "company.get",
  "invite.create",
  "invite.accept",
  "invite.revoke",
  "member.setRole",
  // Hub v9 roles: list (catalog, roles, who holds which), save, delete, give a custom role.
  "roles.list",
  "roles.save",
  "roles.delete",
  "member.setAccess",
  "member.remove",
  "runner.set",
  "shares.list",
  "share.create",
  "share.revoke",
  "share.get",
  "share.view",
  "share.comment",
  "share.prompt",
  "share.copy",
  "handover.create",
  "handover.accept",
  "handover.decline",
  // v2: sign-in methods, two-factor, sessions and devices.
  "signIn.providers",
  "signIn.oauth",
  "twoFactor.status",
  "twoFactor.setup",
  "twoFactor.enable",
  "twoFactor.verify",
  "twoFactor.disable",
  "twoFactor.recoveryCodes",
  "sessions.list",
  "sessions.revoke",
  "devices.list",
  "devices.approve",
  "devices.trusted",
  "devices.untrust",
  // First-device trust: approve or reject a device waiting on this runner.
  "devices.decide",
  // v2: the hub as source of truth for roles, grants and settings.
  "preferences.get",
  "preferences.set",
  "grants.list",
  "grants.set",
  "grants.revoke",
  "settings.get",
  "settings.set",
  // v13: hosted company memory (owner/admin turns it on; each machine gets its own key).
  "memoryHosted.activate",
  // v17: memory zones, rules, and the person's own memory ("Memoria mea").
  "memoryHosted.rules",
  "memoryHosted.zones",
  "memoryHosted.zone",
  "memoryPersonal.get",
  "memoryPersonal.activate",
  "memoryPersonal.removeKey",
  "memoryPersonal.forgetCompany",
  "memoryPersonal.delete",
  "audit.list",
  "academy.progress.get",
  "academy.progress.set",
  "academy.signals.get",
  "academy.signals.push",
  "notifications.list",
  "notifications.read",
  "runner.aiAccount.get",
  "runner.aiAccount.set",
  // Review P0-6: what a company server may use for colleagues (AI account, shared connectors).
  "runner.consent.get",
  "runner.consent.set",
  // v3: passkeys (the ceremonies run on the hub's own pages).
  "signIn.passkey",
  "passkeys.list",
  "passkeys.register",
  "passkeys.remove",
  // v6: packs installed for the whole company (AI staff sync rides on zen.staff.call).
  "companyPacks.list",
  "companyPacks.install",
  "companyPacks.remove",
  "companyPacks.hide",
  "companyPacks.sync",
  // Hub v9: the runner thread of a task I gave, read-only (steps, files, status).
  "staff.follow",
  // Client approval links: send a deliverable to a client without an account, read the answers.
  "approval.create",
  "approval.list",
  "approval.revoke",
] as const;
export type ZenHubOp = (typeof ZEN_HUB_OPS)[number];

export const ZenHubCallInput = Schema.Struct({
  op: Schema.Literals(ZEN_HUB_OPS),
  input: Schema.Unknown,
});
export type ZenHubCallInput = typeof ZenHubCallInput.Type;

export class ZenHubError extends Schema.TaggedError<ZenHubError>()("ZenHubError", {
  reason: Schema.Literals([
    "not-signed-in",
    "invalid-input",
    "forbidden",
    "not-found",
    "offline",
    "unavailable",
    "two-factor-required",
    "two-factor-setup-required",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const ZenHubCallRpc = Rpc.make(ZEN_HUB_WS_METHODS.call, {
  payload: ZenHubCallInput,
  success: Schema.Unknown,
  error: Schema.Union([ZenHubError, EnvironmentAuthorizationError]),
});

/** Spread into `WsRpcGroup` (rpc.ts). */
export const ZEN_HUB_RPCS = [ZenHubCallRpc] as const;

export const ZEN_HUB_RPC_SCOPES = {
  [ZEN_HUB_WS_METHODS.call]: AuthOrchestrationOperateScope,
} as const;

export const ZEN_HUB_RPC_AGGREGATES = {
  [ZEN_HUB_WS_METHODS.call]: "zen",
} as const;

export type ZenHubRole = "owner" | "admin" | "member" | "guest";
export type ZenHubShareKind = "personal" | "company" | "handover";

export interface ZenHubUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface ZenHubStatus {
  readonly hubUrl: string | null;
  readonly signedIn: boolean;
  readonly pendingEmail: string | null;
  readonly user: ZenHubUser | null;
  readonly environment: {
    readonly id: string;
    readonly name: string;
    readonly connected: boolean;
  } | null;
  /** The first company this machine serves (kept for older screens); see `runnerCompanyIds`. */
  readonly runnerCompanyId: string | null;
  /** Hub v9: every hub company this machine is the runner of (one login, one service). */
  readonly runnerCompanyIds?: ReadonlyArray<string>;
  /** Local company id (companies feature) -> hub company id. */
  readonly links: Readonly<Record<string, string>>;
  readonly companies: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly role: ZenHubRole;
  }>;
  /** The signed-in person's machines on the hub; `online` while one holds its runner connection. */
  readonly environments?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly online: boolean;
  }>;
  readonly invites: ReadonlyArray<{
    readonly id: string;
    readonly role: ZenHubRole;
    readonly companyId: string;
    readonly companyName: string;
  }>;
  readonly error: string | null;
  /** v2: "ok", or what the person must do on this session before anything else. */
  readonly twoFactor?: ZenHubTwoFactorStatus | null;
  readonly preferences?: ZenHubPreferences | null;
  readonly unreadNotifications?: number;
  /** Sign-in methods the hub offers ("email", "google", "microsoft", "passkey"). */
  readonly signInMethods?: ReadonlyArray<string>;
  /** The AI account this machine uses for company agents, when it is a company runner. */
  readonly companyAi?: ZenHubAiAccount | null;
  /** Hub v9: the AI account of each company this machine serves (hub company id -> account). */
  readonly companyAis?: Readonly<Record<string, ZenHubAiAccount>>;
  /** Hub v9: what the signed-in person may do in each hub company (roles and permissions). */
  readonly access?: Readonly<Record<string, ZenHubAccess>>;
}

/**
 * Hub v9 roles: a permission is "<resource>:<action>" (resources chats, memorie, pachete,
 * angajati, facturare, echipa, dispozitive; actions vede, creeaza, aproba, trimite, administreaza)
 * or "chats:urmareste" / "chats:urmareste-toate" (follow runner threads read-only).
 */
export interface ZenHubAccess {
  readonly role: ZenHubRole;
  readonly customRoleId: string | null;
  readonly permissions: ReadonlyArray<string>;
  readonly scoped: ReadonlyArray<{
    readonly permission: string;
    readonly kind: "team" | "project";
    readonly id: string;
  }>;
}

/**
 * The same check as the hub's `rbac.can`: owners and admins can do everything; otherwise a
 * company-wide permission, or a scoped one for the given project / teams. `null` access (an
 * older hub, or not known yet) falls back to the built-in role defaults when a role is given.
 */
export function zenHubCan(
  access: ZenHubAccess | null | undefined,
  permission: string,
  scope: { readonly projectId?: string | null; readonly teamIds?: ReadonlyArray<string> } = {},
): boolean {
  if (access === null || access === undefined) return false;
  if (access.role === "owner" || access.role === "admin") return true;
  if (access.permissions.includes(permission)) return true;
  return access.scoped.some(
    (grant) =>
      grant.permission === permission &&
      ((grant.kind === "project" && scope.projectId != null && grant.id === scope.projectId) ||
        (grant.kind === "team" && (scope.teamIds ?? []).includes(grant.id))),
  );
}

/** Any grant of the permission, company-wide or scoped: for showing a button at all. */
export function zenHubCanSomewhere(
  access: ZenHubAccess | null | undefined,
  permission: string,
): boolean {
  return (
    zenHubCan(access, permission) ||
    (access?.scoped.some((grant) => grant.permission === permission) ?? false)
  );
}

/** The hub's built-in defaults, for a hub from before v9 (no `access` in its answers). */
const ZEN_HUB_DEFAULT_PERMISSIONS: Readonly<Record<"member" | "guest", ReadonlyArray<string>>> = {
  member: [
    "chats:vede",
    "chats:creeaza",
    "chats:trimite",
    "chats:urmareste",
    "memorie:vede",
    "memorie:creeaza",
    "pachete:vede",
    "angajati:vede",
    "angajati:creeaza",
    "angajati:trimite",
    "facturare:vede",
    "echipa:vede",
    "dispozitive:vede",
  ],
  guest: ["chats:vede"],
};

/** Access from a role alone (older hubs). */
export function zenHubAccessOfRole(role: ZenHubRole): ZenHubAccess {
  return {
    role,
    customRoleId: null,
    permissions: role === "owner" || role === "admin" ? [] : ZEN_HUB_DEFAULT_PERMISSIONS[role],
    scoped: [],
  };
}

export interface ZenHubTwoFactorStatus {
  readonly enabled: boolean;
  readonly required: boolean;
  readonly sessionVerified: boolean;
  readonly gate: "ok" | "enroll" | "verify";
  readonly recoveryCodesLeft: number;
}

export interface ZenHubPreferences {
  readonly edition: "office" | "code" | null;
  readonly language: "en" | "ro" | null;
  readonly notifyEmail: boolean;
}

export interface ZenHubAiAccount {
  readonly provider: "claude" | "codex";
  readonly mode: "seat" | "api-key";
  readonly label: string;
  /** Only on the runner itself: whether the company key is stored there. */
  readonly hasKey?: boolean;
}

export interface ZenHubSession {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly ip: string | null;
  readonly method: string;
  readonly twoFactor: boolean;
  readonly deviceKeyId: string | null;
  readonly current: boolean;
}

/** A passkey of the signed-in person (the hub keeps only its public key). */
export interface ZenHubPasskey {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly transports: ReadonlyArray<string>;
  /** Synced by the platform (iCloud Keychain, Google Password Manager) rather than one device. */
  readonly backedUp: boolean;
  readonly deviceType: string;
}

export interface ZenHubDevice {
  readonly keyId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly revoked: boolean;
  readonly certifiedBy: ReadonlyArray<string>;
  readonly current: boolean;
  /** What a runner's owner compares when they approve this device there. */
  readonly fingerprint?: string | null;
}

export interface ZenHubNotification {
  readonly id: string;
  /** "share", "comment", "handover", "handover.accepted", "handover.declined", "device", "grant". */
  readonly kind: string;
  readonly companyId: string | null;
  readonly shareId: string | null;
  /** Who did it (hub v4+). The app writes the text from kind + actor + share title. */
  readonly actorName?: string | null;
  /** Filled by this app from the runner when it can; the hub never has it. */
  readonly shareTitle?: string | null;
  /** Generic text from the hub (older rows may name the chat). */
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface ZenHubCompanyDetail {
  readonly company: { readonly id: string; readonly name: string };
  readonly role: ZenHubRole;
  readonly members: ReadonlyArray<{
    readonly userId: string;
    readonly email: string;
    readonly name: string;
    readonly role: ZenHubRole;
    readonly joinedAt: string;
    /** Hub v9: the company-wide custom role (replaces Membru / Invitat), and scoped roles. */
    readonly customRoleId?: string | null;
    readonly customRoleName?: string | null;
    readonly scopedRoles?: number;
  }>;
  /** Hub v9: my access in this company. */
  readonly access?: ZenHubAccess | null;
  readonly invites: ReadonlyArray<{
    readonly id: string;
    readonly email: string | null;
    readonly role: ZenHubRole;
    readonly createdAt: string;
  }>;
  readonly runners: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly ownerName: string;
    readonly online: boolean;
    readonly lastSeenAt: string | null;
    readonly aiAccount?: ZenHubAiAccount | null;
    /** Hub v9: how many companies this machine serves (one machine, several companies). */
    readonly companies?: number;
  }>;
  readonly settings?: {
    readonly memory: { readonly url: string | null; readonly saveConversations: boolean };
    /** Hub v13: hosted company memory (absent on older or self-hosted hubs without it). */
    readonly hosted?: {
      readonly available: boolean;
      readonly activated: boolean;
      readonly active: boolean;
      readonly url: string | null;
    };
  } | null;
}

/** Hub v9: `roles.list`. */
export interface ZenHubRolesList {
  readonly catalog: {
    readonly resources: ReadonlyArray<string>;
    readonly actions: ReadonlyArray<string>;
    readonly extras: ReadonlyArray<string>;
  };
  readonly roles: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly permissions: ReadonlyArray<string>;
    readonly builtin: ZenHubRole | null;
    readonly custom: boolean;
    readonly memberCount: number;
  }>;
  readonly members: ReadonlyArray<{
    readonly userId: string;
    readonly name: string;
    readonly email: string;
    readonly role: ZenHubRole;
    readonly customRoleId: string | null;
    readonly scoped: ReadonlyArray<{
      readonly roleId: string;
      readonly kind: "team" | "project";
      readonly id: string;
    }>;
  }>;
  readonly canEdit: boolean;
}

export interface ZenHubSharePermissions {
  readonly view: boolean;
  readonly comment: boolean;
  readonly prompt: boolean;
  readonly copy: boolean;
  readonly acceptHandover: boolean;
  readonly revoke: boolean;
}

export interface ZenHubShare {
  readonly id: string;
  /** Filled by this app from the owner's runner (empty when it is offline and not cached). */
  readonly title: string;
  /** The hub keeps only a title sealed to the owner's runner. */
  readonly titleSealed?: boolean;
  readonly kind: ZenHubShareKind;
  /** Only for shares of your own chats. */
  readonly threadId: string | null;
  readonly companyId: string;
  readonly companyName: string;
  readonly ownerName: string;
  readonly mine: boolean;
  readonly audienceName: string | null;
  readonly environmentName: string;
  readonly online: boolean;
  readonly handoverState: "pending" | "completed" | "declined" | null;
  readonly createdAt: string;
  readonly permissions: ZenHubSharePermissions;
}

export interface ZenHubComment {
  readonly id: string;
  readonly messageId: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly authorId: string;
  readonly authorName: string;
  /** Signed by a device the runner approved for the author (end-to-end comments). */
  readonly verified?: boolean;
  /** Written before comments were end-to-end encrypted (the hub saw it). */
  readonly legacy?: boolean;
}

/** `share.get`: the share, its comments (read through the runner) and what could not be read. */
export interface ZenHubShareDetail {
  readonly share: ZenHubShare;
  readonly comments: ReadonlyArray<ZenHubComment>;
  /** Encrypted comments not readable now (the owner's machine is offline). */
  readonly unreadableComments?: number;
}

export interface ZenHubThreadMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly streaming: boolean;
  /** Export only: the message's attachments (fetched one by one with `thread.attachment`). */
  readonly attachments?: ReadonlyArray<ZenHubExportAttachment>;
}

export interface ZenHubExportAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly kind: "image" | "audio" | "video" | "file";
}

export interface ZenHubAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly kind: "image" | "audio" | "video" | "file";
  /** Inline content for images, audio and video within the view's size budget; else null. */
  readonly dataUrl: string | null;
}

/** The Office timeline's digest of a stretch of tool work. */
export interface ZenHubWorkDigest {
  readonly changedFiles: ReadonlyArray<string>;
  readonly readFiles: ReadonlyArray<string>;
  readonly webSearches: number;
  readonly otherSteps: number;
  readonly active: boolean;
  readonly failed: number;
}

export interface ZenHubWorkStep {
  readonly type: string;
  readonly title: string;
  readonly status: "running" | "done" | "failed";
}

export type ZenHubThreadRow =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly createdAt: string;
      readonly streaming: boolean;
      readonly attachments: ReadonlyArray<ZenHubAttachment>;
    }
  | {
      readonly kind: "work";
      readonly id: string;
      readonly digest: ZenHubWorkDigest;
      readonly steps: ReadonlyArray<ZenHubWorkStep>;
    };

/** What a runner sends for a shared chat: a live view or a full copy. */
export interface ZenHubThreadSnapshot {
  readonly version: string;
  readonly title: string;
  readonly kind: ZenHubShareKind;
  readonly running: boolean;
  readonly messages: ReadonlyArray<ZenHubThreadMessage>;
  readonly omittedMessageCount: number;
  /** v2 live view: messages with attachments and folded tool rows, in order. */
  readonly rows?: ReadonlyArray<ZenHubThreadRow>;
}
