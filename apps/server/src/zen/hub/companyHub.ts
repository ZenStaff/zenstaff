// @effect-diagnostics nodeBuiltinImport:off globalDate:off extendsNativeError:off -- Promise boundary of the hub client (called from its sync timer and the runner socket).
// Zen Staff hub v6: company-level objects on this machine (see companySync.ts for the rules).
//
// - AI staff: an admin (or an agent's manager) publishes a profile sealed to every company runner
//   and signed by this device. The company runner verifies and applies new versions on each sync
//   (its duties are scheduled there); every other member's machine keeps a copy that follows the
//   hub, read through the runner (`staff.list`), and sends tasks to it (`staff.task`).
// - Company packs: an admin installs a marketplace pack for everyone; each machine installs or
//   updates it on sync and reports its status (Enterprise packs: only the company runner).
//
// Plain async code with its outside world injected by ZenHub.ts.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  zenHubAccessOfRole,
  zenHubCan,
  zenHubCanSomewhere,
  type ZenHubAccess,
} from "@t3tools/contracts/zenHub";

import {
  zenPackHubPort,
  zenStaffHubPort,
  type CompanyHubBridge,
  type HubStaffApply,
  type PackHubPort,
  type StaffHubPort,
} from "./companyPorts.ts";
import {
  companyScope,
  packStatement,
  planPackSync,
  staffSealContext,
  staffStatement,
  toHubProfile,
  verifyCompanyPacks,
  verifyStaffRecords,
  type HubCompanyPack,
  type HubStaffProfile,
  type HubStaffRecord,
  type PackSyncState,
} from "./companySync.ts";
import type { HubRole } from "./hubBridge.ts";
import {
  newNonce,
  open,
  responseMessage,
  seal,
  sealContext,
  signRequest,
  signText,
  statementMessage,
  verifyText,
  type DeviceIdentity,
} from "./hubCrypto.ts";
import { isRunnerOf, type HubState } from "./hubState.ts";
import type { RelayFrame } from "./hubTransport.ts";
import { RunnerRequestError } from "./hubTransport.ts";
import { checkRunnerKeys, withPinnedDevice, type PinnedDevice } from "./relayTrust.ts";

type Input = Record<string, unknown>;
type RunnerKeys = { readonly signPublicKey: string; readonly boxPublicKey: string };

const isRecord = (value: unknown): value is Input =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Ops a member's device may send to the company runner through the hub. */
const COMPANY_RELAY_OPS = new Set(["staff.list", "staff.task", "staff.run", "staff.follow"]);

/**
 * Hub v9: what each op needs from the asker's role. The hub checks it first; the runner checks
 * again with the access the hub sent (or the built-in defaults of the role an older hub knows).
 */
const OP_PERMISSIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "staff.list": ["angajati:vede"],
  "staff.run": ["angajati:vede"],
  "staff.task": ["angajati:creeaza"],
  "staff.follow": ["chats:urmareste", "chats:urmareste-toate"],
};

/** The asker's access in the frame's company: from the hub (v9) or from the synced role. */
export function frameAccess(
  frame: { readonly actorAccess?: ZenHubAccess | null },
  role: HubRole | undefined,
): ZenHubAccess | null {
  if (frame.actorAccess != null) return frame.actorAccess;
  return role === undefined ? null : zenHubAccessOfRole(role);
}

/** Runner-side permission check of one company relay op (pure, tested). */
export function authorizeCompanyOp(op: string, access: ZenHubAccess | null): string | null {
  if (access === null || access.role === "guest")
    return "Only the company's members use its AI staff.";
  const needs = OP_PERMISSIONS[op];
  if (needs === undefined) return "Unknown request.";
  if (!needs.some((permission) => zenHubCanSomewhere(access, permission))) {
    return `Your role does not allow this (${needs[0]!.replace(":", ": ")}).`;
  }
  return null;
}

/**
 * Hub v9, runner side of `staff.task` for one agent: may this person give it a task (the agent's
 * hub project decides for a project-scoped role), and with which permissions does the run go
 * (company-wide ones plus those scoped to the agent's project; null = no extra limit).
 */
export function staffTaskScope(
  access: ZenHubAccess | null,
  hubProjectId: string | null,
): { readonly refusal: string | null; readonly permissions: ReadonlyArray<string> | null } {
  if (access === null)
    return { refusal: "Only the company's members use its AI staff.", permissions: null };
  if (access.role === "owner" || access.role === "admin")
    return { refusal: null, permissions: null };
  const scope = { projectId: hubProjectId };
  if (!zenHubCan(access, "angajati:creeaza", scope)) {
    return {
      refusal:
        hubProjectId === null
          ? "Your role gives tasks only to AI staff of your projects (angajati: creeaza)."
          : "Your role does not allow tasks for this AI employee's project (angajati: creeaza).",
      permissions: null,
    };
  }
  const scoped = access.scoped
    .filter(
      (grant) => grant.kind === "project" && hubProjectId !== null && grant.id === hubProjectId,
    )
    .map((grant) => grant.permission);
  return { refusal: null, permissions: [...new Set([...access.permissions, ...scoped])] };
}

export class CompanyHubError extends Error {
  readonly reason: "invalid-input" | "forbidden" | "unavailable" | "not-found";
  constructor(reason: CompanyHubError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

/** What this machine keeps about company objects (`<state dir>/zen/hub-company.json`). */
export interface CompanyFile {
  readonly version: 1;
  /** Verified company packs per hub company (members may hide them, not uninstall them). */
  readonly packs: Readonly<Record<string, ReadonlyArray<CompanyPackView>>>;
  readonly packRefused: Readonly<Record<string, ReadonlyArray<{ packId: string; reason: string }>>>;
  /** Company packs this person hid on this machine. */
  readonly hidden: ReadonlyArray<string>;
  /** Last status reported to the hub per `<hub company>:<pack>`, to report changes only. */
  readonly reported: Readonly<Record<string, string>>;
  /** Staff sync state per local company. */
  readonly staff: Readonly<
    Record<
      string,
      {
        readonly syncedAt: string | null;
        readonly problem: string | null;
        readonly refused: ReadonlyArray<{ staffId: string; reason: string }>;
      }
    >
  >;
}

export interface CompanyPackView {
  readonly packId: string;
  readonly version: string;
  readonly enterprise: boolean;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly updatedByName: string;
  readonly updatedAt: string;
}

const emptyFile = (): CompanyFile => ({
  version: 1,
  packs: {},
  packRefused: {},
  hidden: [],
  reported: {},
  staff: {},
});

function readCompanyFile(file: string): CompanyFile {
  try {
    const raw = JSON.parse(NodeFS.readFileSync(file, "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== 1) return emptyFile();
    const base = emptyFile();
    return {
      version: 1,
      packs: isRecord(raw.packs) ? (raw.packs as CompanyFile["packs"]) : base.packs,
      packRefused: isRecord(raw.packRefused) ? (raw.packRefused as CompanyFile["packRefused"]) : {},
      hidden: Array.isArray(raw.hidden)
        ? raw.hidden.filter((item): item is string => typeof item === "string")
        : [],
      reported: isRecord(raw.reported) ? (raw.reported as CompanyFile["reported"]) : {},
      staff: isRecord(raw.staff) ? (raw.staff as CompanyFile["staff"]) : {},
    };
  } catch {
    return emptyFile();
  }
}

function writeCompanyFile(file: string, value: CompanyFile): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

export interface CompanyHubDeps {
  readonly file: string;
  readonly state: () => HubState;
  readonly update: (change: (current: HubState) => HubState) => Promise<void>;
  readonly hub: <T>(method: string, path: string, body?: unknown, timeoutMs?: number) => Promise<T>;
  readonly ensureDevice: () => Promise<DeviceIdentity>;
  readonly runnerIdentity: () => DeviceIdentity | null;
  /** Signs and saves the Enterprise "install" approval (the runner's ledger needs it). */
  readonly approveInstall: (hubCompanyId: string, packId: string) => Promise<void>;
  readonly log: (line: string) => void;
  readonly now?: () => number;
  /** Hub v9 (`staff.follow`): the run thread's view, long-polled like a shared chat's. */
  readonly snapshotThread?: (threadId: string, since: string | null) => Promise<unknown>;
  /** Hub v9: metadata of work on this runner for the company's audit log (best effort). */
  readonly reportAudit?: (
    hubCompanyId: string,
    events: ReadonlyArray<Readonly<Record<string, string | null>>>,
  ) => void;
  /** Tests run two machines in one process; the app uses the ports the services install. */
  readonly staffPort?: () => StaffHubPort | null;
  readonly packPort?: () => PackHubPort | null;
  /**
   * Why this server may not start work for colleagues of that company yet (no recorded choice of
   * AI account and connections, or no company AI account; serverConsent.ts). Null: it may.
   */
  readonly serverBlock?: (hubCompanyId: string) => string | null;
}

interface CompanyDetail {
  readonly members: ReadonlyArray<{
    userId: string;
    role: HubRole;
    name?: string;
    email?: string;
    /** Hub v9 (`wave/perms-fine`): each member's permissions, team scopes expanded to projects. */
    access?: ZenHubAccess | null;
  }>;
  readonly runners: ReadonlyArray<{
    id: string;
    name: string;
    online: boolean;
    keys: RunnerKeys | null;
  }>;
}

interface MemberStaffItem {
  readonly staffId: string;
  readonly version: number;
  readonly managerUserId: string | null;
  readonly updatedBy: string;
  readonly updatedAt: string;
  readonly profile: HubStaffProfile;
  readonly status: string;
}

const enc = encodeURIComponent;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A sealed profile must at least look like one (the staff engine checks every field again). */
function parseProfile(text: string): HubStaffProfile | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value) || typeof value.name !== "string" || !Array.isArray(value.duties)) {
      return null;
    }
    return value as unknown as HubStaffProfile;
  } catch {
    return null;
  }
}

export function makeCompanyHub(deps: CompanyHubDeps) {
  const now = deps.now ?? (() => Date.now());
  const staffPortOf = deps.staffPort ?? zenStaffHubPort;
  const packPortOf = deps.packPort ?? zenPackHubPort;
  let file = readCompanyFile(deps.file);
  const members = new Map<string, Record<string, HubRole>>();
  /** Hub v9: members' permissions per company (absent from an older hub: role defaults). */
  const memberAccess = new Map<string, Record<string, ZenHubAccess>>();
  const membersFetchedAt = new Map<string, number>();
  const packFailures: Record<string, number> = {};

  const save = (change: (current: CompanyFile) => CompanyFile) => {
    file = change(file);
    writeCompanyFile(deps.file, file);
  };

  const session = () => {
    const current = deps.state().session;
    if (current === null) throw new CompanyHubError("forbidden", "Sign in to a hub first.");
    return current;
  };

  const localsOf = (hubCompanyId: string) =>
    Object.entries(deps.state().links)
      .filter(([, linked]) => linked === hubCompanyId)
      .map(([local]) => local);

  const roleIn = (hubCompanyId: string): HubRole | null =>
    deps.state().cache.roles[hubCompanyId] ?? null;

  const isAdmin = (role: HubRole | null) => role === "owner" || role === "admin";

  const pinTrust = async (pins: ReadonlyArray<{ userId: string; device: PinnedDevice }>) => {
    if (pins.length === 0) return;
    await deps.update((current) => {
      let trust = current.trust;
      for (const pin of pins) trust = withPinnedDevice(trust, pin.userId, pin.device);
      return { ...current, trust };
    });
  };

  /** A runner's keys, pinned on first use; refused when they changed. */
  const pinnedRunner = async (
    environmentId: string,
    keys: RunnerKeys | null,
  ): Promise<RunnerKeys> => {
    const checked = checkRunnerKeys(
      deps.state().trust,
      environmentId,
      keys,
      new Date(now()).toISOString(),
    );
    if (!checked.ok) throw new CompanyHubError("forbidden", checked.reason);
    const pin = checked.pin;
    if (pin !== null) {
      await deps.update((current) => ({
        ...current,
        trust: { ...current.trust, runners: { ...current.trust.runners, [environmentId]: pin } },
      }));
    }
    return deps.state().trust.runners[environmentId] ?? keys!;
  };

  const companyDetail = async (hubCompanyId: string) => {
    const detail = await deps.hub<CompanyDetail>("GET", `/v1/companies/${enc(hubCompanyId)}`);
    members.set(
      hubCompanyId,
      Object.fromEntries(detail.members.map((member) => [member.userId, member.role])),
    );
    memberAccess.set(
      hubCompanyId,
      Object.fromEntries(
        detail.members.flatMap((member) =>
          member.access == null ? [] : [[member.userId, member.access] as const],
        ),
      ),
    );
    return detail;
  };

  /** One signed, sealed request to the company runner; its answer must be signed by that runner. */
  const companyRelay = async (hubCompanyId: string, op: string, plain: Input): Promise<unknown> => {
    const device = await deps.ensureDevice();
    const user = session().user;
    const detail = await companyDetail(hubCompanyId);
    const runner = detail.runners.find((item) => item.online && item.keys !== null);
    if (runner === undefined) {
      throw new CompanyHubError(
        "unavailable",
        detail.runners.length === 0
          ? "The company has no runner yet. An owner or admin makes one machine the company runner on the Team page."
          : "The company runner is offline right now. Its owner should open Zen Staff on it.",
      );
    }
    const keys = await pinnedRunner(runner.id, runner.keys);
    const scope = companyScope(hubCompanyId);
    const nonce = newNonce();
    const wire = {
      sealed: seal(
        keys.boxPublicKey,
        JSON.stringify(plain),
        sealContext(op, scope, nonce, "request"),
      ),
    };
    const sig = signRequest(
      device,
      { op, shareId: scope, userId: user.id, payload: wire },
      now(),
      nonce,
    );
    const answer = await deps.hub<{ environmentId: string; result: unknown }>(
      "POST",
      `/v1/companies/${enc(hubCompanyId)}/runner`,
      {
        op,
        input: wire,
        sig,
        environmentId: runner.id,
        // Hub v9: a task names its agent in clear (the text stays sealed) so the hub can refuse
        // a role scoped to another project; the runner checks it again on the signed profile.
        ...(op === "staff.task" && typeof plain.staffId === "string"
          ? { staffId: plain.staffId }
          : {}),
      },
      65_000,
    );
    const result = isRecord(answer.result) ? answer.result : {};
    if (typeof result.sealed !== "string" || typeof result.sig !== "string") {
      throw new CompanyHubError("unavailable", "The company runner answered without encryption.");
    }
    if (
      !verifyText(
        keys.signPublicKey,
        responseMessage({ op, shareId: scope, nonce, sealed: result.sealed }),
        result.sig,
      )
    ) {
      throw new CompanyHubError("forbidden", "The answer was not signed by the company runner.");
    }
    return JSON.parse(open(device, result.sealed, sealContext(op, scope, nonce, "response")));
  };

  /** Null when the request may go ahead on this runner. */
  const authorize = (frame: RelayFrame): string | null => {
    const state = deps.state();
    if (!COMPANY_RELAY_OPS.has(frame.op)) return "Unknown request.";
    if (!isRunnerOf(state, frame.companyId)) {
      return "This machine is not the runner of that company.";
    }
    if (frame.shareId !== companyScope(frame.companyId)) return "Unknown request.";
    const known = members.get(frame.companyId);
    if (known === undefined)
      return "The company runner has not synced with the hub yet. Try again in a minute.";
    const role = known[frame.actor.userId];
    if (role === undefined) return "Only the company's members use its AI staff.";
    return authorizeCompanyOp(frame.op, frameAccess(frame, role));
  };

  const answer = async (frame: RelayFrame, input: Input): Promise<unknown> => {
    const port = staffPortOf();
    const local = localsOf(frame.companyId)[0];
    if (port === null || local === undefined) {
      throw new RunnerRequestError(503, "AI staff is not available on the company runner.");
    }
    if (frame.op === "staff.list") return { agents: await port.listForMembers(local) };
    const staffId = typeof input.staffId === "string" ? input.staffId : "";
    const access = frameAccess(frame, members.get(frame.companyId)?.[frame.actor.userId]);
    if (frame.op === "staff.follow") {
      // Read-only: the run's thread (steps, files, status), never a composer.
      if (port.followForHub === undefined || deps.snapshotThread === undefined) {
        throw new RunnerRequestError(503, "Following a task is not available on this runner yet.");
      }
      try {
        const target = await port.followForHub({
          localCompanyId: local,
          staffId,
          runId: typeof input.runId === "string" ? input.runId.slice(0, 80) : "",
          actorUserId: frame.actor.userId,
          all: zenHubCan(access, "chats:urmareste-toate"),
        });
        const since = typeof input.since === "string" ? input.since.slice(0, 200) : null;
        const snapshot = await deps.snapshotThread(target.threadId, since);
        return {
          run: { title: target.title, status: target.status, phase: target.phase },
          snapshot,
          readOnly: true,
        };
      } catch (cause) {
        if (cause instanceof RunnerRequestError) throw cause;
        throw new RunnerRequestError(404, messageOf(cause));
      }
    }
    if (frame.op === "staff.run") {
      try {
        return await port.runForHub({
          localCompanyId: local,
          staffId,
          runId: typeof input.runId === "string" ? input.runId.slice(0, 80) : "",
          actorUserId: frame.actor.userId,
        });
      } catch (cause) {
        throw new RunnerRequestError(404, messageOf(cause));
      }
    }
    // A task runs on the company's AI account: never before the owner chose it (review P0-6).
    const blocked = deps.serverBlock?.(frame.companyId) ?? null;
    if (blocked !== null) throw new RunnerRequestError(409, blocked);
    const text = typeof input.text === "string" ? input.text : "";
    const title =
      typeof input.title === "string" && input.title.trim() !== ""
        ? input.title.slice(0, 120)
        : null;
    try {
      // The agent runs with the giver's permissions, never more (owners and admins: no limit).
      const started = await port.startFromHub({
        localCompanyId: local,
        staffId,
        text,
        title,
        actor: { name: frame.actor.name, email: frame.actor.email, userId: frame.actor.userId },
        starterPermissions:
          access === null || access.role === "owner" || access.role === "admin"
            ? null
            : access.permissions,
        // Hub v9: a role scoped to a project gives tasks only to that project's agents, and the
        // run gets the permissions that hold there.
        scope: (hubProjectId) => staffTaskScope(access, hubProjectId),
      });
      deps.reportAudit?.(frame.companyId, [
        {
          action: "runner.task.start",
          actorUserId: frame.actor.userId,
          staffId,
          runId: started.runId,
          trigger: "hub",
        },
      ]);
      return started;
    } catch (cause) {
      throw new RunnerRequestError(409, messageOf(cause));
    }
  };

  /**
   * Runner: one company request, already checked by `verifyRelayRequest` (the device is one this
   * runner trusts for the person). Opens the sealed input and answers sealed to that device,
   * signed by this runner.
   */
  const handleRelay = async (
    frame: RelayFrame,
    device: { readonly boxPublicKey: string },
  ): Promise<{ sealed: string; sig: string }> => {
    // Members change on the hub between syncs: look again (at most every 30 s) for someone unknown.
    const known = members.get(frame.companyId);
    if (
      isRunnerOf(deps.state(), frame.companyId) &&
      (known === undefined || known[frame.actor.userId] === undefined) &&
      now() - (membersFetchedAt.get(frame.companyId) ?? 0) > 30_000
    ) {
      membersFetchedAt.set(frame.companyId, now());
      await companyDetail(frame.companyId).catch(() => undefined);
    }
    const refusal = authorize(frame);
    if (refusal !== null) throw new RunnerRequestError(403, refusal);
    const keys = deps.runnerIdentity();
    const sig = frame.sig;
    const sealedInput = asRecord(frame.input).sealed;
    if (keys === null || sig === undefined || typeof sealedInput !== "string") {
      throw new RunnerRequestError(400, "This request must be end-to-end encrypted.");
    }
    let input: Input;
    try {
      input = asRecord(
        JSON.parse(
          open(keys, sealedInput, sealContext(frame.op, frame.shareId, sig.nonce, "request")),
        ),
      );
    } catch {
      throw new RunnerRequestError(400, "The request could not be decrypted on this machine.");
    }
    const result = await answer(frame, input);
    const box = seal(
      device.boxPublicKey,
      JSON.stringify(result),
      sealContext(frame.op, frame.shareId, sig.nonce, "response"),
    );
    return {
      sealed: box,
      sig: signText(
        keys,
        responseMessage({ op: frame.op, shareId: frame.shareId, nonce: sig.nonce, sealed: box }),
      ),
    };
  };

  const publishStaff: CompanyHubBridge["publishStaff"] = async (input) => {
    const hubCompanyId = deps.state().links[input.localCompanyId];
    if (hubCompanyId === undefined)
      throw new CompanyHubError("forbidden", "This company is not linked to a hub company.");
    const user = session().user;
    const device = await deps.ensureDevice();
    const attempt = async () => {
      const listed = await deps.hub<{
        staff: ReadonlyArray<HubStaffRecord>;
        runners: ReadonlyArray<{ environmentId: string; keys: RunnerKeys | null }>;
      }>("GET", `/v1/companies/${enc(hubCompanyId)}/staff`);
      const current = listed.staff.find((item) => item.staffId === input.staffId);
      // Last writer wins: the next version after whatever the hub has now.
      const version = Math.max(current?.version ?? 0, input.baseVersion) + 1;
      const sealed: Record<string, string> = {};
      if (input.agent !== null) {
        const profile = toHubProfile(input.agent, {
          staffId: input.staffId,
          managerName: input.managerName,
        });
        for (const runner of listed.runners) {
          if (runner.keys === null) continue;
          const keys = await pinnedRunner(runner.environmentId, runner.keys);
          sealed[runner.environmentId] = seal(
            keys.boxPublicKey,
            JSON.stringify(profile),
            staffSealContext(hubCompanyId, runner.environmentId, input.staffId, version),
          );
        }
        if (Object.keys(sealed).length === 0) {
          throw new CompanyHubError(
            "unavailable",
            "The company has no runner with encryption keys yet. Make one machine the company runner on the Team page and open Zen Staff on it.",
          );
        }
      }
      const ts = now();
      const statement = staffStatement({
        companyId: hubCompanyId,
        staffId: input.staffId,
        version,
        managerUserId: input.managerUserId,
        deleted: input.agent === null,
        sealed,
        by: user.id,
        ts,
      });
      await deps.hub("PUT", `/v1/companies/${enc(hubCompanyId)}/staff/${enc(input.staffId)}`, {
        version,
        managerUserId: input.managerUserId,
        sealed,
        deleted: input.agent === null,
        // Hub v9: the agent's hub project, so the hub checks scoped roles (a deletion keeps it).
        ...(input.agent === null ? {} : { projectId: input.agent.hubProjectId ?? null }),
        ts,
        signature: signText(device, statementMessage(statement)),
      });
      return { staffId: input.staffId, version, updatedAt: new Date(ts).toISOString() };
    };
    try {
      return await attempt();
    } catch (error) {
      // Someone saved at the same moment: take the next version again (last writer wins).
      if ((error as { status?: number }).status === 409) return attempt();
      throw error;
    }
  };

  const sendStaffTask: CompanyHubBridge["sendStaffTask"] = async (input) => {
    const hubCompanyId = deps.state().links[input.localCompanyId];
    if (hubCompanyId === undefined)
      throw new CompanyHubError("forbidden", "This company is not linked to a hub company.");
    const answer = asRecord(
      await companyRelay(hubCompanyId, "staff.task", {
        staffId: input.staffId,
        text: input.text,
        title: input.title,
      }),
    );
    return {
      threadId: typeof answer.threadId === "string" ? answer.threadId : "",
      runId: typeof answer.runId === "string" ? answer.runId : "",
    };
  };

  const staffFollow: NonNullable<CompanyHubBridge["staffFollow"]> = async (input) => {
    const hubCompanyId = deps.state().links[input.localCompanyId];
    if (hubCompanyId === undefined)
      throw new CompanyHubError("forbidden", "This company is not linked to a hub company.");
    return companyRelay(hubCompanyId, "staff.follow", {
      staffId: input.staffId,
      runId: input.runId,
      ...(input.since === null ? {} : { since: input.since }),
    });
  };

  const staffRun: CompanyHubBridge["staffRun"] = async (input) => {
    const hubCompanyId = deps.state().links[input.localCompanyId];
    if (hubCompanyId === undefined)
      throw new CompanyHubError("forbidden", "This company is not linked to a hub company.");
    const answer = asRecord(
      await companyRelay(hubCompanyId, "staff.run", { staffId: input.staffId, runId: input.runId }),
    );
    return { phase: answer.phase ?? null };
  };

  const setStaffSync = (local: string, value: CompanyFile["staff"][string]) =>
    save((current) => ({ ...current, staff: { ...current.staff, [local]: value } }));

  /** Runner: verify the hub's records, open the ones sealed to this machine, apply new versions. */
  const syncRunnerStaff = async (hubCompanyId: string, records: ReadonlyArray<HubStaffRecord>) => {
    const port = staffPortOf();
    const keys = deps.runnerIdentity();
    const environment = deps.state().environment;
    if (port === null || keys === null || environment === null) return;
    for (const local of localsOf(hubCompanyId)) {
      const verified = verifyStaffRecords({
        records,
        companyId: hubCompanyId,
        environmentId: environment.id,
        members: members.get(hubCompanyId) ?? {},
        access: memberAccess.get(hubCompanyId) ?? {},
        applied: port.applied(local),
        trust: deps.state().trust,
        nowIso: new Date(now()).toISOString(),
      });
      await pinTrust(verified.pins);
      const refused = [...verified.refused];
      const items: HubStaffApply[] = [];
      for (const item of verified.accepted) {
        if (item.deleted || item.sealed === null) {
          items.push({ ...item, profile: null });
          continue;
        }
        let profile: HubStaffProfile | null = null;
        try {
          profile = parseProfile(
            open(
              keys,
              item.sealed,
              staffSealContext(hubCompanyId, environment.id, item.staffId, item.version),
            ),
          );
        } catch {
          profile = null;
        }
        if (profile === null) {
          refused.push({
            staffId: item.staffId,
            reason: "the profile could not be opened on this machine",
          });
          continue;
        }
        // An editor allowed only for one project may not put the agent anywhere else.
        if (
          item.requiredProject !== undefined &&
          (profile.hubProjectId ?? null) !== item.requiredProject
        ) {
          refused.push({
            staffId: item.staffId,
            reason: "the editor may manage AI staff only in another project",
          });
          continue;
        }
        items.push({ ...item, profile });
      }
      if (items.length > 0) {
        await port.apply({
          localCompanyId: local,
          hubCompanyId,
          source: "runner",
          items,
          complete: false,
        });
        deps.log(`zen hub: applied ${items.length} AI staff change(s) from the hub`);
      }
      if (refused.length > 0)
        deps.log(
          `zen hub: refused ${refused.length} AI staff record(s): ${refused.map((item) => item.reason).join("; ")}`,
        );
      setStaffSync(local, { syncedAt: new Date(now()).toISOString(), problem: null, refused });
    }
  };

  /** Member: a copy of the company's agents, read through the company runner. */
  const syncMemberStaff = async (hubCompanyId: string, records: ReadonlyArray<HubStaffRecord>) => {
    const port = staffPortOf();
    if (port === null) return;
    const live = records.filter((record) => record.deletedAt === null);
    for (const local of localsOf(hubCompanyId)) {
      const applied = port.applied(local);
      if (live.length === 0) {
        if (Object.keys(applied).length > 0) {
          await port.apply({
            localCompanyId: local,
            hubCompanyId,
            source: "mirror",
            items: [],
            complete: true,
          });
        }
        setStaffSync(local, {
          syncedAt: new Date(now()).toISOString(),
          problem: null,
          refused: [],
        });
        continue;
      }
      try {
        const answer = asRecord(await companyRelay(hubCompanyId, "staff.list", {}));
        const listed = (
          Array.isArray(answer.agents) ? answer.agents : []
        ) as ReadonlyArray<MemberStaffItem>;
        const onHub = new Map(live.map((record) => [record.staffId, record.version]));
        // Only agents the hub lists, at the version the hub has (the runner may lag a minute).
        const items = listed
          .filter((item) => isRecord(item) && onHub.has(item.staffId) && isRecord(item.profile))
          .map((item) => ({
            staffId: item.staffId,
            version: item.version,
            deleted: false,
            profile: item.profile,
            managerUserId: item.managerUserId,
            updatedBy: item.updatedBy,
            updatedAt: item.updatedAt,
            status: item.status,
          }));
        await port.apply({
          localCompanyId: local,
          hubCompanyId,
          source: "mirror",
          items,
          complete: true,
        });
        const behind = items.filter((item) => item.version < (onHub.get(item.staffId) ?? 0)).length;
        setStaffSync(local, {
          syncedAt: new Date(now()).toISOString(),
          problem:
            behind > 0
              ? "The company runner has not picked up the latest changes yet; they show here after its next sync."
              : null,
          refused: [],
        });
      } catch (error) {
        setStaffSync(local, {
          syncedAt: file.staff[local]?.syncedAt ?? null,
          problem: `${messageOf(error)} The last copy is shown.`,
          refused: [],
        });
      }
    }
  };

  const report = async (
    hubCompanyId: string,
    packId: string,
    state: PackSyncState,
    version: string | null,
    error: string | null,
  ) => {
    const environment = deps.state().environment;
    if (environment === null) return;
    const hidden = file.hidden.includes(packId);
    const key = `${hubCompanyId}:${packId}`;
    const value = JSON.stringify({ state, version, error, hidden });
    if (file.reported[key] === value) return;
    await deps.hub("POST", `/v1/companies/${enc(hubCompanyId)}/packs/${enc(packId)}/status`, {
      environmentId: environment.id,
      state,
      version,
      error: error === null ? null : error.slice(0, 480),
      hidden,
    });
    save((current) => ({ ...current, reported: { ...current.reported, [key]: value } }));
  };

  const syncPacks = async (hubCompanyId: string) => {
    const listed = await deps.hub<{ packs: ReadonlyArray<HubCompanyPack> }>(
      "GET",
      `/v1/companies/${enc(hubCompanyId)}/packs`,
    );
    const verified = verifyCompanyPacks({
      packs: listed.packs,
      companyId: hubCompanyId,
      members: members.get(hubCompanyId) ?? {},
      trust: deps.state().trust,
      nowIso: new Date(now()).toISOString(),
      // A pack is a marketplace entry, not code from the hub: members trust an admin's first device.
      firstUseOk: !isRunnerOf(deps.state(), hubCompanyId),
    });
    await pinTrust(verified.pins);
    save((current) => ({
      ...current,
      packs: {
        ...current.packs,
        [hubCompanyId]: verified.packs.map((pack) => ({
          packId: pack.packId,
          version: pack.version,
          enterprise: pack.enterprise,
          settings: pack.settings,
          updatedByName: pack.updatedByName ?? "",
          updatedAt: pack.updatedAt,
        })),
      },
      packRefused: { ...current.packRefused, [hubCompanyId]: verified.refused },
    }));
    const port = packPortOf();
    if (port === null || deps.state().environment === null) return;
    const isRunner = isRunnerOf(deps.state(), hubCompanyId);
    const plan = planPackSync({
      packs: verified.packs,
      installed: await port.installed(),
      customized: (await port.customized?.().catch(() => null)) ?? undefined,
      isRunner,
      lastFailure: packFailures,
      now: now(),
    });
    for (const action of plan) {
      if (action.kind === "report") {
        await report(hubCompanyId, action.packId, action.state, action.version, null);
        continue;
      }
      await report(hubCompanyId, action.packId, "installing", null, null);
      const result = await port.install(action.packId, hubCompanyId).catch((error: unknown) => ({
        ok: false as const,
        enterprise: false,
        error: messageOf(error),
      }));
      if (result.ok) {
        delete packFailures[action.packId];
        await report(hubCompanyId, action.packId, "installed", result.version, null);
        deps.log(`zen hub: installed the company pack ${action.packId}`);
      } else if (result.enterprise && !isRunner) {
        await report(hubCompanyId, action.packId, "runner-only", null, null);
      } else {
        packFailures[action.packId] = now();
        await report(hubCompanyId, action.packId, "failed", null, result.error);
        deps.log(`zen hub: could not install the company pack ${action.packId}: ${result.error}`);
      }
    }
  };

  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  /** One sync at a time; a request during a sync runs once more right after it. */
  const sync = (): Promise<void> => {
    if (running !== null) {
      queued ??= running.then(() => {
        queued = null;
        return sync();
      });
      return queued;
    }
    running = (async () => {
      const state = deps.state();
      if (state.session === null) return;
      for (const hubCompanyId of new Set(Object.values(state.links))) {
        const role = roleIn(hubCompanyId);
        if (role === null) continue;
        try {
          await companyDetail(hubCompanyId);
          await syncPacks(hubCompanyId).catch((error: unknown) =>
            deps.log(`zen hub: company packs sync failed: ${messageOf(error)}`),
          );
          if (role === "guest") continue;
          const listed = await deps.hub<{ staff: ReadonlyArray<HubStaffRecord> }>(
            "GET",
            `/v1/companies/${enc(hubCompanyId)}/staff`,
          );
          if (isRunnerOf(deps.state(), hubCompanyId))
            await syncRunnerStaff(hubCompanyId, listed.staff);
          else await syncMemberStaff(hubCompanyId, listed.staff);
        } catch (error) {
          deps.log(`zen hub: company sync failed: ${messageOf(error)}`);
          for (const local of localsOf(hubCompanyId)) {
            setStaffSync(local, {
              syncedAt: file.staff[local]?.syncedAt ?? null,
              problem: `The hub could not be reached (${messageOf(error)}). The last copy is shown.`,
              refused: file.staff[local]?.refused ?? [],
            });
          }
        }
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };

  const hubCompanyOf = (input: Input): string => {
    if (typeof input.companyId === "string" && input.companyId !== "") return input.companyId;
    const local = typeof input.localCompanyId === "string" ? input.localCompanyId : "";
    const linked = deps.state().links[local];
    if (linked === undefined)
      throw new CompanyHubError("invalid-input", "This company is not linked to a hub company.");
    return linked;
  };

  const op = async (name: string, input: Input): Promise<unknown> => {
    switch (name) {
      case "companyPacks.list": {
        const hubCompanyId = hubCompanyOf(input);
        const answer = await deps.hub<{
          packs: ReadonlyArray<HubCompanyPack>;
          status: ReadonlyArray<Record<string, unknown>>;
        }>("GET", `/v1/companies/${enc(hubCompanyId)}/packs`);
        return {
          companyId: hubCompanyId,
          role: roleIn(hubCompanyId),
          isRunner: isRunnerOf(deps.state(), hubCompanyId),
          packs: answer.packs.map((pack) => ({
            packId: pack.packId,
            version: pack.version,
            enterprise: pack.enterprise,
            settings: pack.settings,
            updatedByName: pack.updatedByName ?? "",
            updatedAt: pack.updatedAt,
            verified: (file.packs[hubCompanyId] ?? []).some(
              (item) => item.packId === pack.packId && item.version === pack.version,
            ),
          })),
          refused: file.packRefused[hubCompanyId] ?? [],
          status: answer.status,
          hidden: file.hidden,
        };
      }
      case "companyPacks.install": {
        const hubCompanyId = hubCompanyOf(input);
        if (!isAdmin(roleIn(hubCompanyId)))
          throw new CompanyHubError(
            "forbidden",
            "Only the company's owners and admins install packs for everyone.",
          );
        const packId = typeof input.packId === "string" ? input.packId : "";
        const port = packPortOf();
        const described = port === null ? null : await port.describe(packId);
        if (described === null)
          throw new CompanyHubError("not-found", "This pack is not in the library.");
        const settings = isRecord(input.settings) ? input.settings : {};
        const device = await deps.ensureDevice();
        const ts = now();
        const statement = packStatement({
          companyId: hubCompanyId,
          packId,
          version: described.version,
          settings,
          enterprise: described.enterprise,
          by: session().user.id,
          ts,
        });
        await deps.hub("PUT", `/v1/companies/${enc(hubCompanyId)}/packs/${enc(packId)}`, {
          version: described.version,
          settings,
          enterprise: described.enterprise,
          ts,
          signature: signText(device, statementMessage(statement)),
        });
        // Enterprise: the runner installs it only with an admin's install approval in its ledger.
        if (described.enterprise) await deps.approveInstall(hubCompanyId, packId);
        void sync().catch(() => undefined);
        return { packId, version: described.version, enterprise: described.enterprise };
      }
      case "companyPacks.remove": {
        const hubCompanyId = hubCompanyOf(input);
        const packId = typeof input.packId === "string" ? input.packId : "";
        await deps.hub("DELETE", `/v1/companies/${enc(hubCompanyId)}/packs/${enc(packId)}`);
        save((current) => ({
          ...current,
          packs: {
            ...current.packs,
            [hubCompanyId]: (current.packs[hubCompanyId] ?? []).filter(
              (item) => item.packId !== packId,
            ),
          },
        }));
        return { ok: true };
      }
      case "companyPacks.hide": {
        const packId = typeof input.packId === "string" ? input.packId : "";
        const hidden = input.hidden === true;
        save((current) => ({
          ...current,
          hidden: hidden
            ? [...new Set([...current.hidden, packId])]
            : current.hidden.filter((item) => item !== packId),
        }));
        void sync().catch(() => undefined);
        return { hidden: file.hidden };
      }
      case "companyPacks.sync":
        await sync();
        return { ok: true };
      default:
        throw new CompanyHubError("invalid-input", `Unknown operation ${name}.`);
    }
  };

  const bridge: Omit<CompanyHubBridge, "syncNow"> = {
    link: (localCompanyId) => {
      const state = deps.state();
      const hubCompanyId = state.links[localCompanyId];
      if (hubCompanyId === undefined || state.session === null) return null;
      return {
        hubCompanyId,
        userId: state.session.user.id,
        role: state.cache.roles[hubCompanyId] ?? null,
        isRunner: isRunnerOf(state, hubCompanyId),
        access:
          state.cache.access?.[hubCompanyId] ??
          (state.cache.roles[hubCompanyId] === undefined
            ? null
            : zenHubAccessOfRole(state.cache.roles[hubCompanyId]!)),
      };
    },
    publishStaff,
    sendStaffTask,
    staffRun,
    staffFollow,
    ...(deps.reportAudit === undefined ? {} : { reportAudit: deps.reportAudit }),
    staffSync: (localCompanyId) =>
      file.staff[localCompanyId] ?? { syncedAt: null, problem: null, refused: [] },
    managedPackIds: () => {
      const linked = new Set(Object.values(deps.state().links));
      return new Set(
        Object.entries(file.packs).flatMap(([hubCompanyId, packs]) =>
          linked.has(hubCompanyId) ? packs.map((pack) => pack.packId) : [],
        ),
      );
    },
    hiddenPackIds: () => new Set(file.hidden),
  };

  return {
    sync,
    op,
    authorize,
    handleRelay,
    bridge,
  };
}

const asRecord = (value: unknown): Input => (isRecord(value) ? value : {});

export type CompanyHub = ReturnType<typeof makeCompanyHub>;
