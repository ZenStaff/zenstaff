// @effect-diagnostics nodeBuiltinImport:off globalDate:off - plain code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: the `access` block of workflow.json and the enterprise gate. An enterprise workflow
// runs only on the company's registered runner AND for a person an admin unlocked for that pack;
// the runner checks both itself (its own ledger and hub registration), never trusting a client.
import { zenHubBridge } from "../hub/hubBridge.ts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ZenWorkflowAccess,
  accessProblems,
  type ZenAccessLock,
  type ZenAccessView,
} from "@t3tools/contracts/zenToolchains";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const decodeAccess = Schema.decodeUnknownResult(ZenWorkflowAccess);

const STANDARD_ACCESS: ZenWorkflowAccess = { tier: "standard", stability: "stable" };

/** The access block of a workflow.json text, with its problems. Absent = standard. */
export function parseAccess(text: string | null): {
  readonly access: ZenWorkflowAccess;
  readonly problems: ReadonlyArray<string>;
} {
  if (text === null) return { access: STANDARD_ACCESS, problems: [] };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { access: STANDARD_ACCESS, problems: [] };
  }
  if (json.access === undefined) return { access: STANDARD_ACCESS, problems: [] };
  const decoded = decodeAccess(json.access);
  if (Result.isFailure(decoded)) {
    return {
      access: STANDARD_ACCESS,
      problems: [`access is not valid: ${decoded.failure.message}`],
    };
  }
  return { access: decoded.success, problems: accessProblems(decoded.success) };
}

export interface AccessGrant {
  readonly packId: string;
  /** Lowercased hub e-mail of the person, or "local" when no hub account is used. */
  readonly user: string;
  readonly grantedBy: string;
  readonly at: string;
}

export interface InstallApproval {
  readonly packId: string;
  readonly approvedBy: string;
  readonly at: string;
}

export interface AccessLedger {
  readonly grants: ReadonlyArray<AccessGrant>;
  readonly approvals: ReadonlyArray<InstallApproval>;
}

export interface RunnerStatus {
  /** This machine is the company's registered runner. */
  readonly isRunner: boolean;
  readonly source: "hub" | "local" | "none";
  /** The hub account signed in on this machine (who an admin action is recorded as). */
  readonly hubUser: string | null;
}

/**
 * Runner status from the hub file (`<state dir>/zen/hub.json`) and the local setting. A machine
 * signed in to a hub counts only when the hub registered it as the company runner; without any
 * hub, the local "company server" setting is accepted (weaker; ZEN.md lists it as a gap).
 */
export function runnerStatus(hubJson: string | null, localCompanyRunner: boolean): RunnerStatus {
  let hub: {
    hubUrl?: unknown;
    runnerCompanyId?: unknown;
    runnerCompanyIds?: unknown;
    session?: { user?: { email?: unknown } };
  } = {};
  try {
    hub = hubJson ? (JSON.parse(hubJson) as typeof hub) : {};
  } catch {
    hub = {};
  }
  const hubUser =
    typeof hub.session?.user?.email === "string" ? hub.session.user.email.toLowerCase() : null;
  const serves =
    (Array.isArray(hub.runnerCompanyIds) && hub.runnerCompanyIds.length > 0) ||
    (typeof hub.runnerCompanyId === "string" && hub.runnerCompanyId.length > 0);
  if (serves) {
    return { isRunner: true, source: "hub", hubUser };
  }
  if (typeof hub.hubUrl === "string" && hub.hubUrl.length > 0) {
    return { isRunner: false, source: "none", hubUser };
  }
  return localCompanyRunner
    ? { isRunner: true, source: "local", hubUser }
    : { isRunner: false, source: "none", hubUser };
}

export const normalizeUser = (user: string | null | undefined) =>
  user && user.trim().length > 0 ? user.trim().toLowerCase() : "local";

export const LOCK_MESSAGES = {
  needsRunner:
    "Your company needs a server for Enterprise workflows. They run only on the company's always-on server, never on a personal computer.",
  needsGrant: "Ask an admin to unlock this workflow for you.",
} as const;

/** The enterprise gate. Null means the workflow may run here for this person. */
export function enterpriseLock(input: {
  readonly packId: string;
  readonly access: ZenWorkflowAccess;
  readonly problems: ReadonlyArray<string>;
  readonly runner: RunnerStatus;
  readonly user: string | null | undefined;
  readonly ledger: AccessLedger;
  readonly hasSecret: (secretId: string) => boolean;
}): ZenAccessLock | null {
  if (input.problems.length > 0) return { code: "invalid", message: input.problems.join(" ") };
  if (input.access.tier !== "enterprise") return null;
  if (!input.runner.isRunner) return { code: "needs-runner", message: LOCK_MESSAGES.needsRunner };
  const user = normalizeUser(input.user);
  const granted = input.ledger.grants.some(
    (grant) => grant.packId === input.packId && grant.user === user,
  );
  if (!granted) return { code: "needs-grant", message: LOCK_MESSAGES.needsGrant };
  const missing = (input.access.secrets ?? []).filter((secret) => !input.hasSecret(secret.id));
  if (missing.length > 0) {
    return {
      code: "needs-secret",
      message: `Ask an admin to add the ${missing.map((secret) => secret.label).join(", ")} on the company server.`,
    };
  }
  return null;
}

export function accessView(
  access: ZenWorkflowAccess,
  lock: ZenAccessLock | null,
  hasSecret: (secretId: string) => boolean,
): ZenAccessView {
  return {
    tier: access.tier,
    stability: access.stability ?? "stable",
    secrets: (access.secrets ?? []).map((secret) => ({
      id: secret.id,
      label: secret.label,
      provider: secret.provider,
      readOnly: secret.readOnly,
      stored: hasSecret(secret.id),
    })),
    lock,
  };
}

export function readLedger(file: string): AccessLedger {
  try {
    const raw = JSON.parse(NodeFS.readFileSync(file, "utf8")) as Partial<AccessLedger>;
    return { grants: raw.grants ?? [], approvals: raw.approvals ?? [] };
  } catch {
    return { grants: [], approvals: [] };
  }
}

export function writeLedger(file: string, ledger: AccessLedger): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

/** One line per use of a credential: workflow, person, thread, time. */
export function logSecretUse(
  file: string,
  entry: {
    readonly workflowId: string;
    readonly user: string;
    readonly threadId: string;
    readonly secretId: string;
    readonly kind: "prepared" | "proxy";
    readonly host?: string;
  },
): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  NodeFS.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, {
    mode: 0o600,
  });
}

/**
 * The ledger that decides: on a company runner signed in to a hub, the hub's grants (each one
 * verified on this machine, see zen/hub/relayTrust.ts) of the company the run is for; otherwise
 * the local ledger file.
 */
export function effectiveLedger(file: string, localCompanyId?: string | null): AccessLedger {
  return zenHubBridge()?.accessLedger(localCompanyId) ?? readLedger(file);
}

let ledgerFile: string | null = null;

/** Set by ToolchainManager so ZenOffice can ask before installing a pack. */
export function setZenAccessLedgerFile(file: string | null): void {
  ledgerFile = file;
}

export const ENTERPRISE_INSTALL_REFUSAL =
  "This Enterprise workflow needs a company admin's approval before it is installed.";

/** Whether a pack folder's workflow.json declares the enterprise tier (hub v6 company packs). */
export function zenPackIsEnterprise(packFolder: string): boolean {
  try {
    return (
      parseAccess(NodeFS.readFileSync(NodePath.join(packFolder, "workflow.json"), "utf8")).access
        .tier === "enterprise"
    );
  } catch {
    return false;
  }
}

/**
 * Called by ZenOffice before a marketplace pack is copied: an invalid access block, or an
 * enterprise pack no admin approved yet, is refused with a plain reason. On a server that serves
 * several companies the approval must be the company's own (`scope`: the hub company of a company
 * pack, or the local company the marketplace works for); another company's never counts.
 */
export function zenPackInstallRefusal(
  packId: string,
  packFolder: string,
  scope: { readonly hubCompanyId?: string | null; readonly localCompanyId?: string | null } = {},
): string | null {
  let text: string | null;
  try {
    text = NodeFS.readFileSync(NodePath.join(packFolder, "workflow.json"), "utf8");
  } catch {
    return null;
  }
  const { access, problems } = parseAccess(text);
  if (problems.length > 0) return `This pack is not valid: ${problems.join(" ")}`;
  if (access.tier !== "enterprise") return null;
  const onHub = zenHubBridge()?.installApproved?.(packId, scope) ?? null;
  if (onHub !== null) return onHub ? null : ENTERPRISE_INSTALL_REFUSAL;
  const ledger = ledgerFile
    ? effectiveLedger(ledgerFile, scope.localCompanyId)
    : { grants: [], approvals: [] };
  return ledger.approvals.some((approval) => approval.packId === packId)
    ? null
    : ENTERPRISE_INSTALL_REFUSAL;
}
