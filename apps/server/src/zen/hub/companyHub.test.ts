// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Test harness: temp folders and two machines in one process.
// Hub v6: AI staff synced through the hub and packs installed for the whole company.
// Pure rules (companySync.ts) and the whole flow with two machines in one process: the company
// runner (Alex, owner) and a member's laptop (Maria), talking to an in-memory hub that keeps only
// what the real hub keeps (ciphertext, versions, signed statements) and routes the company relay.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { StaffAgent } from "@t3tools/contracts/zenStaff";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { MentionPost } from "../staff/mentionReply.ts";
import { StaffEngine, type StaffDeps, type ThreadUsage } from "../staff/staffEngine.ts";
import { makeCompanyHub, type CompanyHub } from "./companyHub.ts";
import type { CompanyHubBridge, PackHubPort, StaffHubPort } from "./companyPorts.ts";
import {
  companyScope,
  fromHubProfile,
  packStatement,
  planPackSync,
  sealedDigest,
  staffSealContext,
  staffAdministration,
  staffStatement,
  toHubProfile,
  verifyCompanyPacks,
  verifyStaffRecords,
  type HubCompanyPack,
  type HubStaffRecord,
} from "./companySync.ts";
import {
  canonicalJson,
  newDeviceIdentity,
  open,
  seal,
  signText,
  statementMessage,
  verifyText,
  type DeviceIdentity,
} from "./hubCrypto.ts";
import type { ZenHubAccess } from "@t3tools/contracts/zenHub";
import { authorizeCompanyOp, frameAccess, staffTaskScope } from "./companyHub.ts";
import { emptyHubState, withRunnerCompanies, type HubState } from "./hubState.ts";
import type { RelayFrame } from "./hubTransport.ts";
import {
  parseServerConfirmation,
  SERVER_BLOCK_MESSAGE,
  serverBlockFor,
  type ServerConsents,
} from "./serverConsent.ts";
import {
  emptyTrustStore,
  verifyRelayRequest,
  withApprovedDevice,
  withPinnedDevice,
  type TrustStore,
} from "./relayTrust.ts";

const HUB = "co_bistro";
const NOW = "2026-11-08T09:00:00.000Z";
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const trustWith = (userId: string, device: DeviceIdentity): TrustStore =>
  withPinnedDevice(emptyTrustStore(), userId, {
    keyId: device.keyId,
    signPublicKey: device.signPublicKey,
    boxPublicKey: device.boxPublicKey,
    via: "approved",
    at: NOW,
  });

function signedRecord(
  device: DeviceIdentity,
  input: {
    by: string;
    staffId: string;
    version: number;
    managerUserId: string | null;
    sealed: Record<string, string>;
    deleted?: boolean;
  },
): HubStaffRecord {
  const statement = staffStatement({
    companyId: HUB,
    ...input,
    deleted: input.deleted ?? false,
    ts: 1,
  });
  return {
    staffId: input.staffId,
    version: input.version,
    managerUserId: input.managerUserId,
    sealed: input.sealed,
    deletedAt: input.deleted ? NOW : null,
    statement: canonicalJson(statement),
    signature: signText(device, statementMessage(statement)),
    signerKeyId: device.keyId,
    signerPublicKey: device.signPublicKey,
    signerBoxPublicKey: device.boxPublicKey,
    updatedBy: input.by,
    updatedAt: NOW,
  };
}

describe("company staff rules", () => {
  const alex = newDeviceIdentity();
  const maria = newDeviceIdentity();
  const members = { u_alex: "owner", u_maria: "member", u_ion: "member" } as const;
  const base = {
    companyId: HUB,
    environmentId: "env-runner",
    members,
    nowIso: NOW,
  };

  it("accepts an admin's signed record sealed to this runner and skips what it already has", () => {
    const record = signedRecord(alex, {
      by: "u_alex",
      staffId: "s-1",
      version: 1,
      managerUserId: "u_maria",
      sealed: { "env-runner": "x" },
    });
    const trust = trustWith("u_alex", alex);
    const first = verifyStaffRecords({ ...base, records: [record], applied: {}, trust });
    expect(first.refused).toEqual([]);
    expect(first.accepted).toMatchObject([
      { staffId: "s-1", version: 1, sealed: "x", deleted: false },
    ]);
    const again = verifyStaffRecords({
      ...base,
      records: [record],
      applied: { "s-1": { version: 1, managerUserId: "u_maria" } },
      trust,
    });
    expect(again.accepted).toEqual([]);
    expect(again.refused).toEqual([]);
    const rollback = verifyStaffRecords({
      ...base,
      records: [record],
      applied: { "s-1": { version: 4, managerUserId: "u_maria" } },
      trust,
    });
    expect(rollback.refused[0]!.reason).toMatch(/older/);
  });

  it("refuses a record the hub changed, moved or sealed for someone else", () => {
    const trust = trustWith("u_alex", alex);
    const record = signedRecord(alex, {
      by: "u_alex",
      staffId: "s-1",
      version: 2,
      managerUserId: "u_maria",
      sealed: { "env-runner": "x" },
    });
    const swapped = { ...record, sealed: { "env-runner": "y" } };
    const bumped = { ...record, version: 3 };
    const other = signedRecord(alex, {
      by: "u_alex",
      staffId: "s-2",
      version: 1,
      managerUserId: null,
      sealed: { "env-old": "x" },
    });
    const result = verifyStaffRecords({
      ...base,
      records: [swapped, bumped, other],
      applied: {},
      trust,
    });
    expect(result.accepted).toEqual([]);
    expect(result.refused.map((item) => item.reason)).toEqual([
      "the statement does not match the record",
      "the statement does not match the record",
      expect.stringMatching(/not sealed to this machine/),
    ]);
  });

  it("lets the manager change an agent it manages; nobody else below admin", () => {
    const trust = withPinnedDevice(trustWith("u_alex", alex), "u_maria", {
      keyId: maria.keyId,
      signPublicKey: maria.signPublicKey,
      boxPublicKey: maria.boxPublicKey,
      via: "approved",
      at: NOW,
    });
    const applied = { "s-1": { version: 2, managerUserId: "u_maria" } };
    const edit = signedRecord(maria, {
      by: "u_maria",
      staffId: "s-1",
      version: 3,
      managerUserId: "u_maria",
      sealed: { "env-runner": "x" },
    });
    expect(verifyStaffRecords({ ...base, records: [edit], applied, trust }).accepted).toHaveLength(
      1,
    );
    // Not the manager (Ion), handing it over, deleting, or an agent this runner never had.
    const ion = signedRecord(maria, {
      by: "u_ion",
      staffId: "s-1",
      version: 3,
      managerUserId: "u_ion",
      sealed: { "env-runner": "x" },
    });
    const handOver = signedRecord(maria, {
      by: "u_maria",
      staffId: "s-1",
      version: 3,
      managerUserId: "u_ion",
      sealed: { "env-runner": "x" },
    });
    const del = signedRecord(maria, {
      by: "u_maria",
      staffId: "s-1",
      version: 3,
      managerUserId: "u_maria",
      sealed: {},
      deleted: true,
    });
    const fresh = signedRecord(maria, {
      by: "u_maria",
      staffId: "s-9",
      version: 1,
      managerUserId: "u_maria",
      sealed: { "env-runner": "x" },
    });
    for (const record of [ion, handOver, del, fresh]) {
      expect(
        verifyStaffRecords({ ...base, records: [record], applied, trust }).refused[0]!.reason,
      ).toMatch(/not an owner, an admin or the agent's manager/);
    }
  });

  it("hub v9: a role with angajati:administreaza edits, for the company or only its project", () => {
    const trust = withPinnedDevice(trustWith("u_alex", alex), "u_maria", {
      keyId: maria.keyId,
      signPublicKey: maria.signPublicKey,
      boxPublicKey: maria.boxPublicKey,
      via: "approved",
      at: NOW,
    });
    const scoped = (projectId: string): ZenHubAccess => ({
      role: "member",
      customRoleId: null,
      permissions: ["angajati:vede"],
      scoped: [{ permission: "angajati:administreaza", kind: "project", id: projectId }],
    });
    const companyWide: ZenHubAccess = {
      role: "member",
      customRoleId: "role_ops",
      permissions: ["angajati:vede", "angajati:administreaza"],
      scoped: [],
    };
    const edit = (projectId: string | null, extra: { deleted?: boolean } = {}) => ({
      ...signedRecord(maria, {
        by: "u_maria",
        staffId: "s-1",
        version: 3,
        managerUserId: null,
        sealed: extra.deleted ? {} : { "env-runner": "x" },
        ...extra,
      }),
      projectId,
    });
    const applied = (hubProjectId: string | null) => ({
      "s-1": { version: 2, managerUserId: null, hubProjectId },
    });
    const verify = (
      record: HubStaffRecord,
      access: ZenHubAccess | undefined,
      had: ReturnType<typeof applied> | Record<string, never>,
    ) =>
      verifyStaffRecords({
        ...base,
        records: [record],
        applied: had,
        trust,
        ...(access === undefined ? {} : { access: { u_maria: access } }),
      });
    // Company-wide: any agent, no project bound.
    const wide = verify(edit(null), companyWide, applied(null));
    expect(wide.refused).toEqual([]);
    expect(wide.accepted[0]!.requiredProject).toBeUndefined();
    // Scoped to p-site: an agent of p-site, which must stay in p-site (checked on the profile).
    const own = verify(edit("p-site"), scoped("p-site"), applied("p-site"));
    expect(own.accepted[0]!.requiredProject).toBe("p-site");
    // Another project's agent, moving one out of its project, or the whole company's: refused.
    for (const [record, had] of [
      [edit("p-shop"), applied("p-shop")],
      [edit("p-site"), applied("p-shop")],
      [edit(null), applied(null)],
      [edit("p-shop", { deleted: true }), applied("p-shop")],
    ] as const) {
      expect(verify(record, scoped("p-site"), had).refused[0]!.reason).toMatch(
        /nor allowed to manage AI staff/,
      );
    }
    // Deleting and creating in its own project are allowed.
    expect(
      verify(edit("p-site", { deleted: true }), scoped("p-site"), applied("p-site")).refused,
    ).toEqual([]);
    const created = {
      ...signedRecord(maria, {
        by: "u_maria",
        staffId: "s-1",
        version: 1,
        managerUserId: null,
        sealed: { "env-runner": "x" },
      }),
      projectId: "p-site",
    };
    expect(verify(created, scoped("p-site"), {}).accepted).toHaveLength(1);
    // Without access from the hub (older hub): the old rule.
    expect(verify(edit(null), undefined, applied(null)).refused).toHaveLength(1);
    expect(
      staffAdministration({
        role: "guest",
        access: companyWide,
        projectBefore: null,
        projectAfter: null,
        existed: true,
      }),
    ).toBeNull();
  });

  it("pins an unknown signer as pending and refuses its change until it is approved", () => {
    const record = signedRecord(alex, {
      by: "u_alex",
      staffId: "s-1",
      version: 1,
      managerUserId: null,
      sealed: { "env-runner": "x" },
    });
    const first = verifyStaffRecords({
      ...base,
      records: [record],
      applied: {},
      trust: emptyTrustStore(),
    });
    expect(first.refused[0]!.reason).toMatch(/waiting for approval/);
    expect(first.pins).toHaveLength(1);
    const pinned = withPinnedDevice(emptyTrustStore(), "u_alex", first.pins[0]!.device);
    const approved = withApprovedDevice(pinned, "u_alex", alex.keyId, "runner owner", NOW)!;
    expect(
      verifyStaffRecords({ ...base, records: [record], applied: {}, trust: approved }).accepted,
    ).toHaveLength(1);
  });

  it("binds a sealed profile to the company, the runner, the agent and the version", () => {
    const runner = newDeviceIdentity();
    const box = seal(
      runner.boxPublicKey,
      '{"name":"Maria"}',
      staffSealContext(HUB, "env-runner", "s-1", 2),
    );
    expect(open(runner, box, staffSealContext(HUB, "env-runner", "s-1", 2))).toBe(
      '{"name":"Maria"}',
    );
    expect(() => open(runner, box, staffSealContext(HUB, "env-runner", "s-1", 3))).toThrow();
    expect(() => open(runner, box, staffSealContext(HUB, "env-runner", "s-2", 2))).toThrow();
    expect(sealedDigest({ b: "2", a: "1" })).toBe(sealedDigest({ a: "1", b: "2" }));
    expect(companyScope(HUB)).toBe("company:co_bistro");
  });
});

describe("company pack rules", () => {
  const alex = newDeviceIdentity();
  const pack = (
    by: string,
    settings: Record<string, unknown> = {},
    enterprise = false,
  ): HubCompanyPack => {
    const statement = packStatement({
      companyId: HUB,
      packId: "website-health",
      version: "1.1.0",
      settings,
      enterprise,
      by,
      ts: 1,
    });
    return {
      packId: "website-health",
      version: "1.1.0",
      settings,
      enterprise,
      statement: canonicalJson(statement),
      signature: signText(alex, statementMessage(statement)),
      signerKeyId: alex.keyId,
      signerPublicKey: alex.signPublicKey,
      updatedBy: by,
      updatedAt: NOW,
    };
  };

  it("keeps packs an admin's trusted device signed; refuses members and changed settings", () => {
    const trust = trustWith("u_alex", alex);
    const members = { u_alex: "admin", u_maria: "member" } as const;
    const ok = verifyCompanyPacks({
      packs: [pack("u_alex", { language: "ro" })],
      companyId: HUB,
      members,
      trust,
      nowIso: NOW,
    });
    expect(ok.packs).toHaveLength(1);
    const tampered = { ...pack("u_alex", { language: "ro" }), settings: { language: "en" } };
    const byMember = pack("u_maria");
    const result = verifyCompanyPacks({
      packs: [tampered, byMember],
      companyId: HUB,
      members,
      trust,
      nowIso: NOW,
    });
    expect(result.packs).toEqual([]);
    expect(result.refused.map((item) => item.reason)).toEqual([
      "the statement does not match the pack",
      "installed by someone who is not an owner or admin",
    ]);
  });

  it("plans installs: Enterprise only on the runner, same version kept, failures retried later", () => {
    const packs = [
      { packId: "website-health", version: "1.1.0", enterprise: false },
      { packId: "review-replies", version: "2.0.0", enterprise: false },
      { packId: "meta-ads", version: "0.3.0", enterprise: true },
    ];
    const member = planPackSync({
      packs,
      installed: { "website-health": "1.1.0", "review-replies": "1.0.0" },
      isRunner: false,
      lastFailure: {},
      now: 0,
    });
    expect(member).toEqual([
      { kind: "report", packId: "website-health", state: "installed", version: "1.1.0" },
      { kind: "install", packId: "review-replies", version: "2.0.0" },
      { kind: "report", packId: "meta-ads", state: "runner-only", version: null },
    ]);
    const runner = planPackSync({
      packs,
      installed: {},
      isRunner: true,
      lastFailure: { "website-health": 1_000 },
      now: 60_000,
    });
    expect(runner.map((action) => `${action.kind}:${action.packId}`)).toEqual([
      "install:review-replies",
      "install:meta-ads",
    ]);
    const later = planPackSync({
      packs,
      installed: {},
      isRunner: true,
      lastFailure: { "website-health": 1_000 },
      now: 11 * 60_000,
    });
    expect(later[0]).toEqual({ kind: "install", packId: "website-health", version: "1.1.0" });
    // A customized copy stays: its version is reported, nothing is installed over it.
    const customized = planPackSync({
      packs,
      installed: { "website-health": "1.1.0", "review-replies": "1.0.0" },
      customized: new Set(["review-replies"]),
      isRunner: false,
      lastFailure: {},
      now: 0,
    });
    expect(customized[1]).toEqual({
      kind: "report",
      packId: "review-replies",
      state: "installed",
      version: "1.0.0",
    });
  });

  it("keeps machine-local fields when a profile comes back from the hub", () => {
    const agent = {
      id: "maria-1a2b",
      companyId: "bistro",
      name: "Maria",
      kind: "personal",
      owner: "alex",
      projectId: "p-alex",
      managerId: "hub-u_alex",
      duties: [
        {
          id: "d1",
          title: "Plan",
          prompt: "Plan",
          weekday: 1,
          time: "09:00",
          scheduledTaskId: "task-7",
        },
      ],
      instructions: "Scrie postări",
    } as unknown as StaffAgent;
    const profile = toHubProfile(agent, { staffId: "s-1", managerName: "Alex" });
    expect(profile).toMatchObject({ id: "s-1", kind: "company", managerName: "Alex" });
    expect(profile.duties[0]!.scheduledTaskId).toBeNull();
    expect("projectId" in profile || "owner" in profile || "companyId" in profile).toBe(false);
    const hub = {
      companyId: HUB,
      staffId: "s-1",
      version: 2,
      managerUserId: "u_alex",
      updatedBy: "Alex",
      updatedAt: NOW,
      source: "runner" as const,
    };
    const back = fromHubProfile(profile, {
      localCompanyId: "bistro-2",
      existing: { ...agent, companyId: "bistro-2", projectId: "p-runner" },
      fallbackProjectId: null,
      hub,
    });
    expect(back).toMatchObject({
      id: "maria-1a2b",
      companyId: "bistro-2",
      projectId: "p-runner",
      owner: null,
      kind: "company",
      hub,
    });
    expect(back.duties[0]!.scheduledTaskId).toBe("task-7");
    const copy = fromHubProfile(profile, {
      localCompanyId: "bistro",
      existing: null,
      fallbackProjectId: null,
      hub: { ...hub, source: "mirror" },
    });
    expect(copy.duties[0]!.scheduledTaskId).toBeNull();
  });
});

interface Machine {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly environmentId: string;
  readonly device: DeviceIdentity;
  readonly runnerKeys: DeviceIdentity;
  state: HubState;
  engine: StaffEngine;
  company: CompanyHub;
  readonly launches: Array<{
    threadId: string;
    text: string;
    projectId: string;
    runtimeMode?: string;
  }>;
  /** @mention replies written into this machine's chats. */
  readonly posts: MentionPost[];
  /** Thread status as the orchestrator would report it (absent = still starting). */
  readonly usage: Record<string, ThreadUsage>;
  readonly duties: Array<{ title: string; time: string }>;
  readonly deletedDuties: string[];
  readonly installed: Record<string, string | null>;
  readonly installCalls: string[];
  readonly approvals: string[];
  /** Hub v9: what this machine reported to the company's audit log. */
  readonly audit: Array<{ hubCompanyId: string; event: Readonly<Record<string, string | null>> }>;
  /** Review P0-6: the server's recorded choice (serverConsent.ts); empty = never confirmed. */
  consents: ServerConsents;
}

class FakeHub {
  roles: Record<string, "owner" | "admin" | "member" | "guest"> = {};
  /** Hub v9: what the hub would send as `actorAccess` (absent = an older hub). */
  access: Record<string, ZenHubAccess> = {};
  readonly machines = new Map<string, Machine>();
  staff = new Map<string, HubStaffRecord>();
  packs = new Map<string, HubCompanyPack>();
  readonly status = new Map<string, Record<string, unknown>>();
  runnerEnv = "env-runner";
  runnerOnline = true;
  readonly seen = new Set<string>();

  deviceOf(userId: string) {
    return [...this.machines.values()].find((machine) => machine.userId === userId)!.device;
  }

  call(machine: Machine) {
    return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const input = (body ?? {}) as Record<string, unknown>;
      const fail = (status: number, message: string) =>
        Object.assign(new Error(message), { status });
      const runner = this.machines.get(this.runnerEnv)!;
      const runners = [
        {
          id: this.runnerEnv,
          name: "Bistro server",
          online: this.runnerOnline,
          keys: {
            signPublicKey: runner.runnerKeys.signPublicKey,
            boxPublicKey: runner.runnerKeys.boxPublicKey,
          },
        },
      ];
      const signer = (record: { updatedBy: string }) => {
        const device = this.deviceOf(record.updatedBy);
        return {
          signerKeyId: device.keyId,
          signerPublicKey: device.signPublicKey,
          signerBoxPublicKey: device.boxPublicKey,
        };
      };
      let match: RegExpMatchArray | null;
      if (method === "GET" && path === `/v1/companies/${HUB}`) {
        return {
          // perms-fine: each member's access (team scopes per project), when the hub knows it.
          members: Object.entries(this.roles).map(([userId, role]) => ({
            userId,
            role,
            ...(this.access[userId] === undefined ? {} : { access: this.access[userId] }),
          })),
          runners,
        } as T;
      }
      if (method === "GET" && path === `/v1/companies/${HUB}/staff`) {
        return {
          staff: [...this.staff.values()],
          runners: runners.map((item) => ({ environmentId: item.id, keys: item.keys })),
        } as T;
      }
      if (method === "PUT" && (match = path.match(/^\/v1\/companies\/co_bistro\/staff\/(.+)$/))) {
        const staffId = decodeURIComponent(match[1]!);
        const existing = this.staff.get(staffId);
        const version = input.version as number;
        if (existing !== undefined && version <= existing.version) throw fail(409, "newer version");
        const deleted = input.deleted === true;
        const statement = staffStatement({
          companyId: HUB,
          staffId,
          version,
          managerUserId: (input.managerUserId as string | null) ?? null,
          deleted,
          sealed: input.sealed as Record<string, string>,
          by: machine.userId,
          ts: input.ts as number,
        });
        // The real hub checks the same bytes (routes/companyObjects.ts); so does this fake.
        if (
          !verifyText(
            machine.device.signPublicKey,
            statementMessage(statement),
            input.signature as string,
          )
        )
          throw fail(400, "bad signature");
        const record: HubStaffRecord = {
          staffId,
          version,
          // The hub keeps the agent's project as metadata (a deletion keeps the old one).
          projectId:
            input.projectId === undefined
              ? (existing?.projectId ?? null)
              : (input.projectId as string | null),
          managerUserId: (input.managerUserId as string | null) ?? null,
          sealed: input.sealed as Record<string, string>,
          deletedAt: deleted ? NOW : null,
          statement: canonicalJson(statement),
          signature: input.signature as string,
          ...signer({ updatedBy: machine.userId }),
          updatedBy: machine.userId,
          updatedByName: machine.name,
          updatedAt: NOW,
        };
        this.staff.set(staffId, record);
        return { staffId, version } as T;
      }
      if (method === "POST" && path === `/v1/companies/${HUB}/runner`) {
        if (!this.runnerOnline) throw fail(503, "The company runner is offline right now.");
        const frame: RelayFrame = {
          t: "req",
          id: "r1",
          op: input.op as string,
          shareId: companyScope(HUB),
          threadId: "",
          shareKind: "company",
          companyId: HUB,
          actor: { userId: machine.userId, email: machine.email, name: machine.name },
          ...(this.access[machine.userId] === undefined
            ? {}
            : { actorAccess: this.access[machine.userId] }),
          input: input.input,
          sig: input.sig as RelayFrame["sig"],
          device: {
            userId: machine.userId,
            keyId: machine.device.keyId,
            signPublicKey: machine.device.signPublicKey,
            boxPublicKey: machine.device.boxPublicKey,
          },
        } as RelayFrame;
        // What ZenHub.onRelayRequest does before handing a company request over.
        // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- the app signs with the real clock; only the 5-minute window is checked, no elapsed time is asserted.
        const decision = verifyRelayRequest(runner.state.trust, frame, Date.now(), (nonce) => {
          const used = this.seen.has(nonce);
          this.seen.add(nonce);
          return used;
        });
        if (!decision.ok) throw fail(403, decision.reason);
        if (decision.pin !== null)
          runner.state = {
            ...runner.state,
            trust: withPinnedDevice(runner.state.trust, machine.userId, decision.pin),
          };
        if (decision.device.state === "pending" && frame.op !== "staff.list")
          throw fail(403, "Waiting for approval of this device on the runner.");
        const result = await runner.company.handleRelay(frame, decision.device);
        return { environmentId: this.runnerEnv, result } as T;
      }
      if (method === "GET" && path === `/v1/companies/${HUB}/packs`) {
        return { packs: [...this.packs.values()], status: [...this.status.values()] } as T;
      }
      if (
        method === "PUT" &&
        (match = path.match(/^\/v1\/companies\/co_bistro\/packs\/([^/]+)$/))
      ) {
        const packId = decodeURIComponent(match[1]!);
        if (this.roles[machine.userId] !== "owner" && this.roles[machine.userId] !== "admin")
          throw fail(403, "admins only");
        const statement = packStatement({
          companyId: HUB,
          packId,
          version: input.version as string,
          settings: input.settings as Record<string, unknown>,
          enterprise: input.enterprise === true,
          by: machine.userId,
          ts: input.ts as number,
        });
        if (
          !verifyText(
            machine.device.signPublicKey,
            statementMessage(statement),
            input.signature as string,
          )
        )
          throw fail(400, "bad signature");
        this.packs.set(packId, {
          packId,
          version: input.version as string,
          settings: input.settings as Record<string, unknown>,
          enterprise: input.enterprise === true,
          statement: canonicalJson(statement),
          signature: input.signature as string,
          ...signer({ updatedBy: machine.userId }),
          updatedBy: machine.userId,
          updatedByName: machine.name,
          updatedAt: NOW,
        });
        return { packId } as T;
      }
      if (
        method === "POST" &&
        (match = path.match(/^\/v1\/companies\/co_bistro\/packs\/([^/]+)\/status$/))
      ) {
        this.status.set(`${match[1]}:${input.environmentId}`, {
          packId: match[1],
          userName: machine.name,
          ...input,
        });
        return { ok: true } as T;
      }
      throw fail(404, `${method} ${path}`);
    };
  }
}

const REGISTRY: Record<string, { version: string; enterprise: boolean }> = {
  "website-health": { version: "1.1.0", enterprise: false },
  "meta-ads": { version: "0.3.0", enterprise: true },
};

function machine(
  hub: FakeHub,
  input: { userId: string; email: string; name: string; environmentId: string; runner: boolean },
): Machine {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-company-"));
  temps.push(root);
  const stateDir = NodePath.join(root, "state");
  NodeFS.mkdirSync(NodePath.join(stateDir, "zen"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(stateDir, "zen", "companies.json"),
    JSON.stringify({
      version: 1,
      companies: [{ id: "bistro", name: "Bistro", memoryDirectory: null }],
      projects: { [`p-${input.name}`]: "bistro" },
    }),
  );
  // What the staff engine reads from hub.json: the link, the runner registration, the person.
  NodeFS.writeFileSync(
    NodePath.join(stateDir, "zen", "hub.json"),
    JSON.stringify({
      version: 1,
      hubUrl: "https://hub.test",
      links: { bistro: HUB },
      runnerCompanyId: input.runner ? HUB : null,
      session: { user: { id: input.userId, email: input.email, name: input.name } },
    }),
  );
  const device = newDeviceIdentity();
  const runnerKeys = newDeviceIdentity();
  const self: Partial<Machine> &
    Pick<
      Machine,
      | "launches"
      | "posts"
      | "usage"
      | "duties"
      | "deletedDuties"
      | "installed"
      | "installCalls"
      | "approvals"
      | "audit"
    > = {
    ...input,
    device,
    runnerKeys,
    launches: [],
    posts: [],
    usage: {},
    duties: [],
    deletedDuties: [],
    installed: {},
    installCalls: [],
    approvals: [],
    audit: [],
    consents: {},
  };
  const m = self as Machine;
  m.state = {
    ...emptyHubState(),
    hubUrl: "https://hub.test",
    session: { token: "t", user: { id: input.userId, email: input.email, name: input.name } },
    environment: {
      id: input.environmentId,
      credential: "c",
      name: input.name,
      userId: input.userId,
      keys: runnerKeys,
    },
    ...withRunnerCompanies(input.runner ? [HUB] : []),
    links: { bistro: HUB },
    device,
    trust: trustWith(input.userId, device),
    cache: { roles: {}, settings: {}, ledger: null, ledgerRefused: [] },
  };
  let taskCount = 0;
  const bridge = (): CompanyHubBridge => ({ ...m.company.bridge, syncNow: async () => undefined });
  const deps: StaffDeps = {
    stateDir,
    zenHome: root,
    now: () => new Date(NOW),
    threads: async (ids) =>
      (ids ?? []).map((id) => ({
        id,
        projectId: `p-${input.name}`,
        title: "Chat",
        active: false,
        createdAtMs: 0,
        modelSelection: null,
        runtimeMode: "auto-accept-edits",
      })),
    usage: async (threadId) => m.usage[threadId] ?? null,
    launch: async (launch) => {
      m.launches.push(launch);
    },
    postMention: async (post) => {
      m.posts.push(post);
    },
    send: async () => undefined,
    generate: async () => "[]",
    providerAvailable: async (id) => id === "claude-company",
    upsertDuty: async (duty) => {
      m.duties.push({ title: duty.title, time: duty.time });
      return duty.taskId ?? `task-${++taskCount}`;
    },
    deleteDuty: async (taskId) => {
      m.deletedDuties.push(taskId);
    },
    workflows: () => [],
    companyHub: bridge,
  };
  m.engine = new StaffEngine(deps);
  const staffPort: StaffHubPort = {
    apply: (item) => m.engine.applyHub(item),
    applied: (local) => m.engine.appliedHub(local),
    listForMembers: (local) => m.engine.listHubForMembers(local),
    startFromHub: (task) => m.engine.startFromHub(task),
    runForHub: (task) => m.engine.runForHub(task),
    followForHub: (task) => m.engine.followForHub(task),
  };
  const packPort: PackHubPort = {
    installed: async () => ({ ...m.installed }),
    install: async (packId) => {
      m.installCalls.push(packId);
      m.installed[packId] = REGISTRY[packId]!.version;
      return { ok: true, version: REGISTRY[packId]!.version };
    },
    describe: async (packId) => REGISTRY[packId] ?? null,
  };
  m.company = makeCompanyHub({
    file: NodePath.join(stateDir, "zen", "hub-company.json"),
    state: () => m.state,
    update: async (change) => {
      m.state = change(m.state);
    },
    hub: hub.call(m),
    ensureDevice: async () => device,
    runnerIdentity: () => runnerKeys,
    approveInstall: async (_company, packId) => {
      m.approvals.push(packId);
    },
    log: () => undefined,
    staffPort: () => staffPort,
    packPort: () => packPort,
    snapshotThread: async (threadId, since) => ({ threadId, version: "v1", since }),
    reportAudit: (hubCompanyId, events) => {
      for (const event of events) m.audit.push({ hubCompanyId, event });
    },
    serverBlock: (hubCompanyId) => {
      const blocked = serverBlockFor({
        hubCompanyId,
        consents: m.consents,
        companyAis: m.state.companyAis,
      });
      return blocked === null ? null : SERVER_BLOCK_MESSAGE[blocked];
    },
  });
  hub.machines.set(input.environmentId, m);
  return m;
}

/** The owner confirmed the company server's AI account and shared no connector (P0-6). */
function confirmServer(m: Machine) {
  const account = { provider: "claude", mode: "seat", label: "Bistro Team" } as const;
  m.consents = {
    [HUB]: parseServerConfirmation(
      { acknowledged: true, account, seen: [], shared: [] },
      new Date(NOW),
      m.userId,
    )!,
  };
  m.state = { ...m.state, companyAis: { ...m.state.companyAis, [HUB]: account } };
}

function setRoles(hub: FakeHub, roles: FakeHub["roles"]) {
  hub.roles = roles;
  for (const m of hub.machines.values()) {
    m.state = { ...m.state, cache: { ...m.state.cache, roles: { [HUB]: roles[m.userId]! } } };
  }
}

const approveOnRunner = (runner: Machine, other: Machine) => {
  runner.state = {
    ...runner.state,
    trust: withApprovedDevice(
      withPinnedDevice(runner.state.trust, other.userId, {
        keyId: other.device.keyId,
        signPublicKey: other.device.signPublicKey,
        boxPublicKey: other.device.boxPublicKey,
        via: "first-use",
        at: NOW,
        state: "pending",
      }),
      other.userId,
      other.device.keyId,
      runner.name,
      NOW,
    )!,
  };
};

describe("company AI staff and packs end to end (runner + member laptop)", () => {
  const setup = async () => {
    const hub = new FakeHub();
    const runner = machine(hub, {
      userId: "u_alex",
      email: "alex@bistro.test",
      name: "Alex",
      environmentId: "env-runner",
      runner: true,
    });
    const laptop = machine(hub, {
      userId: "u_maria",
      email: "maria@bistro.test",
      name: "Maria",
      environmentId: "env-maria",
      runner: false,
    });
    setRoles(hub, { u_alex: "owner", u_maria: "member" });
    confirmServer(runner);
    // The runner has the company AI account (AI staff > Settings) so company agents run there.
    await runner.engine.call("settings.save", {
      companyId: "bistro",
      settings: {
        companyAccount: {
          kind: "team-seat",
          providerInstanceId: "claude-company",
          model: "claude-haiku-5-5",
          label: "Bistro Team",
        },
      },
    });
    // A local agent from before the hub, with a duty on Monday morning.
    const local = (await runner.engine.call("agent.save", {
      companyId: "bistro",
      locale: "ro",
      defaults: {
        modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
        runtimeMode: "auto-accept-edits",
        projectId: "p-Alex",
      },
      agent: {
        name: "Ioana",
        role: "Social media",
        instructions: "Scrie postări pentru Bistro, în română.",
        kind: "personal",
        managerId: null,
        duties: [
          {
            id: "d-monday",
            title: "Planul săptămânii",
            prompt: "Fă planul de postări.",
            weekday: 1,
            time: "09:00",
          },
        ],
      },
    })) as StaffAgent;
    return { hub, runner, laptop, local };
  };

  it("publishes a local agent to the company: sealed on the hub, run by the runner, copied to members", async () => {
    const { hub, runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    expect(published).toMatchObject({
      kind: "company",
      managerId: "hub-u_alex",
      hub: { companyId: HUB, version: 1, source: "runner" },
    });
    // The duty is scheduled on the runner with the company account.
    expect(published.duties[0]!.scheduledTaskId).not.toBeNull();
    // The hub keeps ciphertext only: no name, no job description.
    const record = hub.staff.get(published.hub!.staffId)!;
    expect(JSON.stringify(record)).not.toMatch(/Ioana|Bistro, în română/);
    expect(Object.keys(record.sealed)).toEqual(["env-runner"]);

    // The runner's own sync skips its own version; Maria's laptop reads the copy through it.
    await runner.company.sync();
    expect(runner.engine.load("bistro").agents).toHaveLength(1);
    await laptop.company.sync();
    const copy = laptop.engine.load("bistro").agents[0]!;
    expect(copy).toMatchObject({
      name: "Ioana",
      kind: "company",
      hub: { staffId: published.hub!.staffId, version: 1, source: "mirror" },
    });
    expect(copy.duties[0]!.scheduledTaskId).toBeNull();
    expect(laptop.duties).toEqual([]);
    const overview = await laptop.engine.overview("bistro", "ro");
    expect(overview.hub).toMatchObject({
      hubCompanyId: HUB,
      role: "member",
      canAdminister: false,
      problem: null,
    });

    // Maria gives Ioana a task from her laptop: it starts on the company runner, once the runner
    // approved her laptop (a first device may only read until then).
    await expect(
      laptop.engine.call("task.start", {
        companyId: "bistro",
        agentId: copy.id,
        text: "Ceva",
        locale: "ro",
      }),
    ).rejects.toThrow(/Waiting for approval/);
    approveOnRunner(runner, laptop);
    const started = (await laptop.engine.call("task.start", {
      companyId: "bistro",
      agentId: copy.id,
      text: "Scrie postarea de vineri.",
      locale: "ro",
    })) as { threadId: string };
    expect(laptop.launches).toEqual([]);
    expect(runner.launches).toHaveLength(1);
    expect(runner.launches[0]!.threadId).toBe(started.threadId);
    expect(runner.launches[0]!.text).toContain("Maria (maria@bistro.test):");
    expect(runner.launches[0]!.text).toContain("Scrie postarea de vineri.");
    expect((runner.launches[0] as { title?: string }).title).toBe(
      "Ioana: Scrie postarea de vineri.",
    );
  });

  it("only owners, admins and the manager edit; the manager's change reaches the runner once its device is approved", async () => {
    const { hub, runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await laptop.company.sync();
    const copy = laptop.engine.load("bistro").agents[0]!;
    // Maria is not the manager yet: refused on her machine (and the hub would refuse it too).
    await expect(
      laptop.engine.call("agent.save", {
        companyId: "bistro",
        agent: { ...copy, role: "Altceva" },
      }),
    ).rejects.toMatchObject({ reason: "forbidden" });
    // Alex (owner) makes Maria the manager.
    await runner.engine.call("agent.save", {
      companyId: "bistro",
      agent: { ...published, managerId: "hub-u_maria" },
      locale: "ro",
    });
    expect(hub.staff.get(published.hub!.staffId)!.version).toBe(2);
    await laptop.company.sync();
    const managed = laptop.engine.load("bistro").agents[0]!;
    expect(managed.hub).toMatchObject({ version: 2, managerUserId: "u_maria" });
    // Maria changes the job description; she cannot hand Ioana to someone else.
    const saved = (await laptop.engine.call("agent.save", {
      companyId: "bistro",
      agent: {
        ...managed,
        instructions: "Scrie postări scurte.",
        duties: [
          {
            id: "d-monday",
            title: "Planul săptămânii",
            prompt: "Fă planul.",
            weekday: 1,
            time: "08:30",
          },
        ],
        managerId: "hub-u_alex",
      },
    })) as StaffAgent;
    expect(saved.hub).toMatchObject({ version: 3, managerUserId: "u_maria" });
    // Maria's device was pinned pending on the runner by her first request: the change waits.
    await runner.company.sync();
    expect(runner.engine.load("bistro").agents[0]!.hub!.version).toBe(2);
    const waiting = await runner.engine.overview("bistro", "ro");
    expect(waiting.hub!.refused[0]!.reason).toMatch(/waiting for approval/);
    approveOnRunner(runner, laptop);
    await runner.company.sync();
    const applied = runner.engine.load("bistro").agents[0]!;
    expect(applied).toMatchObject({
      instructions: "Scrie postări scurte.",
      hub: { version: 3, managerUserId: "u_maria", source: "runner" },
    });
    // The duty moved to 08:30 on the runner, under the same scheduled task.
    expect(runner.duties.at(-1)).toEqual({ title: "Ioana: Planul săptămânii", time: "08:30" });
    expect(applied.duties[0]!.scheduledTaskId).toBe(published.duties[0]!.scheduledTaskId);
  });

  it("refuses a hub that rolls a profile back or swaps it, and removes a deleted agent everywhere", async () => {
    const { hub, runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await runner.engine.call("agent.save", {
      companyId: "bistro",
      agent: { ...published, role: "Social media & PR" },
      locale: "ro",
    });
    const staffId = published.hub!.staffId;
    const v2 = hub.staff.get(staffId)!;
    // A compromised hub serves version 1 again, then a v3 with v2's ciphertext under a new number.
    hub.staff.set(staffId, { ...v2, version: 1 });
    await runner.company.sync();
    expect(runner.engine.load("bistro").agents[0]!.role).toBe("Social media & PR");
    hub.staff.set(staffId, { ...v2, version: 3 });
    await runner.company.sync();
    expect((await runner.engine.overview("bistro", "ro")).hub!.refused[0]!.reason).toBe(
      "the statement does not match the record",
    );
    hub.staff.set(staffId, v2);
    // Deleting is for owners/admins; it reaches the laptop's copy too.
    await laptop.company.sync();
    expect(laptop.engine.load("bistro").agents).toHaveLength(1);
    await runner.engine.call("agent.delete", { companyId: "bistro", agentId: published.id });
    expect(runner.deletedDuties).toContain(published.duties[0]!.scheduledTaskId);
    expect(hub.staff.get(staffId)!.deletedAt).not.toBeNull();
    await laptop.company.sync();
    expect(laptop.engine.load("bistro").agents).toEqual([]);
  });

  it("tells a member when the company runner is offline and keeps the last copy", async () => {
    const { hub, runner, laptop, local } = await setup();
    await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    });
    await laptop.company.sync();
    hub.runnerOnline = false;
    await laptop.company.sync();
    const overview = await laptop.engine.overview("bistro", "ro");
    expect(overview.agents).toHaveLength(1);
    expect(overview.hub!.problem).toMatch(/offline/);
    await expect(
      laptop.engine.call("task.start", {
        companyId: "bistro",
        agentId: overview.agents[0]!.id,
        text: "Ceva",
        locale: "ro",
      }),
    ).rejects.toMatchObject({ reason: "needs-runner" });
  });

  it("runs a member's @mention on the runner under Aprobări and replies in the member's chat", async () => {
    const { runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await laptop.company.sync();
    approveOnRunner(runner, laptop);
    // Maria writes "@Ioana ..." in a chat of the company's folder on her laptop.
    await laptop.engine.onUserMessage({
      id: "msg-1",
      threadId: "chat-maria",
      text: "@Ioana scrie trei idei de postări pentru weekend",
      scheduledTaskId: null,
      createdBy: "user",
    });
    await laptop.engine.mentionsPosted();
    expect(laptop.launches).toEqual([]);
    expect(runner.launches).toHaveLength(1);
    const runnerThread = runner.launches[0]!.threadId;
    // The hub agent is a company agent on the runner: Aprobări (on by default) applies there:
    // never full access, the shell without network, outbound calls through the gate.
    expect(runner.engine.load("bistro").settings.approvals).toBe(true);
    expect(runner.launches[0]!.runtimeMode).not.toBe("full-access");
    expect(runner.engine.shellWithoutNetwork(runnerThread)).toBe(true);
    // The runner's run remembers who asked; nobody posts into a chat that only Maria has.
    const run = runner.engine.load("bistro").runs.find((item) => item.threadId === runnerThread)!;
    expect(run).toMatchObject({ requestedBy: "u_maria", replyTo: null });
    expect(runner.posts).toEqual([]);

    // Maria's chat gets "lucrează…" right away, with where the full work is.
    expect(laptop.posts).toHaveLength(1);
    expect(laptop.posts[0]).toMatchObject({
      originThreadId: "chat-maria",
      agentThreadId: runnerThread,
      key: `mention:${run.id}`,
      final: false,
    });
    expect(laptop.posts[0]!.markdown).toContain("**Ioana** lucrează…");
    expect(laptop.posts[0]!.markdown).toContain("serverul firmei");
    expect(laptop.posts[0]!.markdown).not.toContain("t3-thread://");

    // The agent finishes on the runner; the next poll brings the result into Maria's chat.
    await runner.engine.toolsFor(runnerThread)!.call("staff_record_result", {
      summary: "Trei idei: brunch, terasă, desert.",
      explain_to_boss: ["Gata pentru weekend", "Fără costuri", "Postez după aprobare"],
      files: [],
    });
    runner.usage[runnerThread] = {
      status: "completed",
      durationMs: 60_000,
      tokens: 1_000,
      firstUserText: null,
      minutesSpan: 1,
    };
    await laptop.engine.pollRemoteMentions();
    expect(laptop.posts).toHaveLength(2);
    expect(laptop.posts[1]).toMatchObject({ key: `mention:${run.id}`, final: true, files: [] });
    expect(laptop.posts[1]!.markdown).toContain("Trei idei: brunch, terasă, desert.");
    expect(laptop.posts[1]!.platformMarkdown).toContain("- Fără costuri");
    // Done: no more polls for it.
    await laptop.engine.pollRemoteMentions();
    expect(laptop.posts).toHaveLength(2);

    // Only the member who gave the task reads its status on the runner.
    await expect(
      runner.engine.runForHub({
        localCompanyId: "bistro",
        staffId: published.hub!.staffId,
        runId: run.id,
        actorUserId: "u_alex",
      }),
    ).rejects.toThrow(/not on the company runner/);
  });

  const member = (permissions: ReadonlyArray<string>): ZenHubAccess => ({
    role: "member",
    customRoleId: "role_test",
    permissions,
    scoped: [],
  });

  it("runs the agent with the permissions of the member who gave the task: no sending without it, even with Aprobări off", async () => {
    const { hub, runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await laptop.company.sync();
    approveOnRunner(runner, laptop);
    await runner.engine.call("settings.save", {
      companyId: "bistro",
      settings: { approvals: false },
    });
    expect(runner.engine.load("bistro").settings.approvals).toBe(false);
    const staffId = published.hub!.staffId;
    // Maria's role gives tasks to AI staff but has no "Angajați AI: trimite".
    hub.access.u_maria = member(["angajati:vede", "angajati:creeaza", "chats:urmareste"]);
    await laptop.company.bridge.sendStaffTask({
      localCompanyId: "bistro",
      staffId,
      text: "Trimite oferta pe e-mail la client",
      title: null,
    });
    const restricted = runner.launches.at(-1)!;
    const run = runner.engine
      .load("bistro")
      .runs.find((item) => item.threadId === restricted.threadId)!;
    expect(run.starterPermissions).toEqual([
      "angajati:vede",
      "angajati:creeaza",
      "chats:urmareste",
    ]);
    // Approvals are off, yet the gate stays on for this thread and refuses every outbound call.
    expect(restricted.runtimeMode).not.toBe("full-access");
    const denied = runner.engine.gate(restricted.threadId, "mcp__gmail__send_email");
    expect(denied.behavior).toBe("deny");
    expect(denied.behavior === "deny" ? denied.message : "").toContain("angajati:trimite");
    expect(runner.engine.gate(restricted.threadId, "mcp__gmail__search_threads").behavior).toBe(
      "pass",
    );
    expect(runner.engine.shellWithoutNetwork(restricted.threadId)).toBe(true);
    // Nobody can approve more than the giver may do.
    await expect(
      runner.engine.toolsFor(restricted.threadId)!.call("staff_request_approval", {
        action: "send",
        target: "client@firma.example",
        content: "Oferta",
      }),
    ).rejects.toThrow(/angajati:trimite/);

    // With "trimite" (the built-in Membru), the same task may send: approvals are off.
    hub.access.u_maria = member([
      "angajati:vede",
      "angajati:creeaza",
      "angajati:trimite",
      "chats:urmareste",
    ]);
    await laptop.company.bridge.sendStaffTask({
      localCompanyId: "bistro",
      staffId,
      text: "Trimite oferta",
      title: null,
    });
    const allowed = runner.launches.at(-1)!;
    expect(runner.engine.gate(allowed.threadId, "mcp__gmail__send_email").behavior).toBe("pass");
    expect(runner.engine.shellWithoutNetwork(allowed.threadId)).toBe(false);

    // Without "Angajați AI: creează" the runner refuses the task itself.
    hub.access.u_maria = member(["angajati:vede"]);
    const before = runner.launches.length;
    await expect(
      laptop.company.bridge.sendStaffTask({
        localCompanyId: "bistro",
        staffId,
        text: "x",
        title: null,
      }),
    ).rejects.toThrow(/angajati: creeaza/);
    expect(runner.launches).toHaveLength(before);
  });

  it("hub v9: an agent published from a project belongs to it; a role scoped there gives it tasks, not others", async () => {
    const { hub, runner, laptop, local } = await setup();
    // Ioana works in the site project; Radu is the whole company's.
    await runner.engine.call("agent.save", {
      companyId: "bistro",
      agent: { ...local, projectId: "p-site" },
    });
    const ioana = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    expect(ioana.hubProjectId).toBe("p-site");
    expect(hub.staff.get(ioana.hub!.staffId)!.projectId).toBe("p-site");
    const radu = (await runner.engine.call("agent.save", {
      companyId: "bistro",
      agent: { name: "Radu", role: "Contabil", kind: "personal", managerId: null },
    })) as StaffAgent;
    const raduHub = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: radu.id,
      locale: "ro",
    })) as StaffAgent;
    expect(raduHub.hubProjectId ?? null).toBeNull();
    await laptop.company.sync();
    approveOnRunner(runner, laptop);
    // Maria may give tasks (and send) only in the site project.
    hub.access.u_maria = {
      ...member(["angajati:vede", "chats:urmareste"]),
      scoped: [
        { permission: "angajati:creeaza", kind: "project", id: "p-site" },
        { permission: "angajati:trimite", kind: "project", id: "p-site" },
      ],
    };
    await laptop.company.bridge.sendStaffTask({
      localCompanyId: "bistro",
      staffId: ioana.hub!.staffId,
      text: "Scrie postarea",
      title: null,
    });
    const run = runner.engine
      .load("bistro")
      .runs.find((item) => item.threadId === runner.launches.at(-1)!.threadId)!;
    // The run gets her permissions that hold in that project.
    expect(run.starterPermissions).toEqual([
      "angajati:vede",
      "chats:urmareste",
      "angajati:creeaza",
      "angajati:trimite",
    ]);
    const before = runner.launches.length;
    await expect(
      laptop.company.bridge.sendStaffTask({
        localCompanyId: "bistro",
        staffId: raduHub.hub!.staffId,
        text: "Fă balanța",
        title: null,
      }),
    ).rejects.toThrow(/angajati: creeaza/);
    // Moved to another project on the hub? The runner reads the project from its own copy.
    hub.access.u_maria = {
      ...member(["angajati:vede"]),
      scoped: [{ permission: "angajati:creeaza", kind: "project", id: "p-shop" }],
    };
    await expect(
      laptop.company.bridge.sendStaffTask({
        localCompanyId: "bistro",
        staffId: ioana.hub!.staffId,
        text: "x",
        title: null,
      }),
    ).rejects.toThrow(/angajati: creeaza/);
    expect(runner.launches).toHaveLength(before);
  });

  it("hub v9: angajati:administreaza edits company agents on the member's machine and the runner applies it", async () => {
    const { hub, runner, laptop, local } = await setup();
    await runner.engine.call("agent.save", {
      companyId: "bistro",
      agent: { ...local, projectId: "p-site" },
    });
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await laptop.company.sync();
    approveOnRunner(runner, laptop);
    const copy = laptop.engine.load("bistro").agents[0]!;
    expect(copy.hubProjectId).toBe("p-site");
    const giveMaria = (access: ZenHubAccess) => {
      hub.access.u_maria = access;
      laptop.state = {
        ...laptop.state,
        cache: { ...laptop.state.cache, access: { [HUB]: access } },
      };
    };
    // Scoped to another project: refused on her machine.
    giveMaria({
      ...member(["angajati:vede"]),
      scoped: [{ permission: "angajati:administreaza", kind: "project", id: "p-shop" }],
    });
    expect((await laptop.engine.overview("bistro", "ro")).hub!.canAdminister).toBe(false);
    await expect(
      laptop.engine.call("agent.save", { companyId: "bistro", agent: { ...copy, role: "Altul" } }),
    ).rejects.toMatchObject({ reason: "forbidden" });
    // Scoped to the agent's project: she edits it (not its manager), and the runner applies it.
    giveMaria({
      ...member(["angajati:vede"]),
      scoped: [{ permission: "angajati:administreaza", kind: "project", id: "p-site" }],
    });
    const saved = (await laptop.engine.call("agent.save", {
      companyId: "bistro",
      agent: { ...copy, instructions: "Postări scurte, cu prețuri." },
    })) as StaffAgent;
    expect(saved.hubProjectId).toBe("p-site");
    await runner.company.sync();
    const applied = runner.engine.load("bistro").agents[0]!;
    expect(applied).toMatchObject({
      instructions: "Postări scurte, cu prețuri.",
      hubProjectId: "p-site",
      hub: { version: published.hub!.version + 1 },
    });
    // A hub that moves the record's project to one she administers changes nothing.
    giveMaria({
      ...member(["angajati:vede"]),
      scoped: [{ permission: "angajati:administreaza", kind: "project", id: "p-shop" }],
    });
    const record = hub.staff.get(published.hub!.staffId)!;
    hub.staff.set(published.hub!.staffId, { ...record, projectId: "p-shop" });
    await runner.company.sync();
    expect(runner.engine.load("bistro").agents[0]!.hub!.version).toBe(published.hub!.version + 1);
  });

  it("hub v9: on the runner, a company agent's approvals need angajati:aproba", async () => {
    const { runner, local } = await setup();
    await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    });
    const started = (await runner.engine.call("task.start", {
      companyId: "bistro",
      agentId: runner.engine.load("bistro").agents[0]!.id,
      text: "Trimite oferta",
      locale: "ro",
      defaults: {
        modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
        runtimeMode: "auto-accept-edits",
        projectId: "p-Alex",
      },
    })) as { threadId: string };
    await runner.engine.toolsFor(started.threadId)!.call("staff_request_approval", {
      action: "send",
      target: "client@firma.example",
      content: "Oferta",
    });
    const approvalId = runner.engine.load("bistro").approvals[0]!.id;
    // The runner's person is only a member without "aprobă": refused.
    runner.state = {
      ...runner.state,
      cache: {
        ...runner.state.cache,
        roles: { [HUB]: "member" },
        access: { [HUB]: member(["angajati:vede", "angajati:creeaza"]) },
      },
    };
    await expect(
      runner.engine.call("approval.decide", {
        companyId: "bistro",
        approvalId,
        decision: "approve",
      }),
    ).rejects.toThrow(/angajati: aproba|Angajați AI: aprobă/);
    // With "aprobă" the decision goes through.
    runner.state = {
      ...runner.state,
      cache: {
        ...runner.state.cache,
        access: { [HUB]: member(["angajati:vede", "angajati:aproba"]) },
      },
    };
    const decided = (await runner.engine.call("approval.decide", {
      companyId: "bistro",
      approvalId,
      decision: "approve",
    })) as { status: string };
    expect(decided.status).toBe("approved");
  });

  it("refuses a colleague's task until the owner confirmed the server's AI account (P0-6)", async () => {
    const { runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await laptop.company.sync();
    approveOnRunner(runner, laptop);
    const staffId = published.hub!.staffId;
    const give = () =>
      laptop.company.bridge.sendStaffTask({
        localCompanyId: "bistro",
        staffId,
        text: "Fă planul săptămânii",
        title: null,
      });

    // A server made before the confirmation existed: nothing runs on the owner's login.
    const confirmed = runner.consents;
    runner.consents = {};
    const before = runner.launches.length;
    await expect(give()).rejects.toThrow(/company server is not set up yet/);
    expect(runner.launches).toHaveLength(before);

    // Confirmed, but the company AI account is "Nesetat": still refused.
    runner.consents = confirmed;
    const { [HUB]: _gone, ...otherAccounts } = runner.state.companyAis;
    runner.state = { ...runner.state, companyAis: otherAccounts };
    await expect(give()).rejects.toThrow(/company has no AI account yet/);
    expect(runner.launches).toHaveLength(before);

    // Both recorded: the task runs.
    confirmServer(runner);
    await give();
    expect(runner.launches).toHaveLength(before + 1);
  });

  it("reports a hub task's start and finish to the company's audit log, ids only, once", async () => {
    const { runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await laptop.company.sync();
    approveOnRunner(runner, laptop);
    const staffId = published.hub!.staffId;
    const task = await laptop.company.bridge.sendStaffTask({
      localCompanyId: "bistro",
      staffId,
      text: "Scrie oferta pentru clientul Popescu",
      title: null,
    });
    const threadId = runner.launches.at(-1)!.threadId;
    expect(runner.audit.map((item) => item.event.action)).toEqual(["runner.task.start"]);
    // Still running: nothing more.
    await runner.engine.onRunUpdated(threadId, false);
    expect(runner.audit).toHaveLength(1);
    runner.usage[threadId] = {
      status: "failed",
      durationMs: 1_000,
      tokens: 10,
      firstUserText: null,
      minutesSpan: null,
    };
    await runner.engine.onRunUpdated(threadId, true);
    expect(runner.audit.at(-1)).toEqual({
      hubCompanyId: HUB,
      event: {
        action: "runner.task.finish",
        actorUserId: "u_maria",
        staffId,
        runId: task.runId,
        threadId,
        status: "failed",
      },
    });
    // Metadata only: the task text never goes to the hub, and a second update reports nothing.
    expect(JSON.stringify(runner.audit)).not.toContain("Popescu");
    await runner.engine.onRunUpdated(threadId, true);
    expect(runner.audit.filter((item) => item.event.action === "runner.task.finish")).toHaveLength(
      1,
    );
    // The member's laptop never reports work it did not do.
    expect(laptop.audit).toEqual([]);
  });

  it("lets the member follow her task's runner thread read-only, and nobody else's", async () => {
    const { hub, runner, laptop, local } = await setup();
    const published = (await runner.engine.call("agent.publish", {
      companyId: "bistro",
      agentId: local.id,
      locale: "ro",
    })) as StaffAgent;
    await laptop.company.sync();
    approveOnRunner(runner, laptop);
    const staffId = published.hub!.staffId;
    const task = await laptop.company.bridge.sendStaffTask({
      localCompanyId: "bistro",
      staffId,
      text: "Fă planul săptămânii",
      title: null,
    });
    const followed = (await laptop.company.bridge.staffFollow!({
      localCompanyId: "bistro",
      staffId,
      runId: task.runId,
      since: null,
    })) as { readOnly: boolean; run: { status: string }; snapshot: { threadId: string } };
    expect(followed.readOnly).toBe(true);
    expect(followed.run.status).toBe("running");
    expect(followed.snapshot.threadId).toBe(runner.launches.at(-1)!.threadId);
    // Someone else's run: refused unless the role follows every runner thread.
    await expect(
      runner.engine.followForHub({
        localCompanyId: "bistro",
        staffId,
        runId: task.runId,
        actorUserId: "u_ion",
        all: false,
      }),
    ).rejects.toThrow(/not on the company runner/);
    await expect(
      runner.engine.followForHub({
        localCompanyId: "bistro",
        staffId,
        runId: task.runId,
        actorUserId: "u_ion",
        all: true,
      }),
    ).resolves.toMatchObject({ threadId: runner.launches.at(-1)!.threadId });
    // A role without "urmărește" cannot follow at all.
    hub.access.u_maria = member(["angajati:vede", "angajati:creeaza"]);
    await expect(
      laptop.company.bridge.staffFollow!({
        localCompanyId: "bistro",
        staffId,
        runId: task.runId,
        since: null,
      }),
    ).rejects.toThrow(/chats: urmareste/);
  });

  it("installs a pack for the whole company: members install it, Enterprise stays on the runner", async () => {
    const { hub, runner, laptop } = await setup();
    await expect(
      laptop.company.op("companyPacks.install", { companyId: HUB, packId: "website-health" }),
    ).rejects.toThrow(/owners and admins/);
    await runner.company.op("companyPacks.install", {
      companyId: HUB,
      packId: "website-health",
      settings: { language: "ro" },
    });
    await runner.company.op("companyPacks.install", { companyId: HUB, packId: "meta-ads" });
    // Enterprise: the install approval the runner's ledger needs is signed too.
    expect(runner.approvals).toEqual(["meta-ads"]);
    await runner.company.sync();
    await laptop.company.sync();
    expect(runner.installCalls.toSorted()).toEqual(["meta-ads", "website-health"]);
    expect(laptop.installCalls).toEqual(["website-health"]);
    const status = (key: string) =>
      hub.status.get(key) as { state: string; version: string | null; hidden: boolean };
    expect(status("website-health:env-maria")).toMatchObject({
      state: "installed",
      version: "1.1.0",
      hidden: false,
    });
    expect(status("meta-ads:env-maria")).toMatchObject({ state: "runner-only" });
    expect(status("meta-ads:env-runner")).toMatchObject({ state: "installed", version: "0.3.0" });
    // Members cannot uninstall a company pack, only hide it.
    expect([...laptop.company.bridge.managedPackIds()].toSorted()).toEqual([
      "meta-ads",
      "website-health",
    ]);
    await laptop.company.op("companyPacks.hide", { packId: "website-health", hidden: true });
    await laptop.company.sync();
    expect(laptop.company.bridge.hiddenPackIds().has("website-health")).toBe(true);
    expect(status("website-health:env-maria").hidden).toBe(true);
    // A second sync installs nothing again.
    await laptop.company.sync();
    expect(laptop.installCalls).toEqual(["website-health"]);
    const listed = (await runner.company.op("companyPacks.list", { companyId: HUB })) as {
      packs: Array<{ packId: string; verified: boolean }>;
      status: unknown[];
    };
    expect(listed.packs.map((pack) => [pack.packId, pack.verified])).toEqual([
      ["website-health", true],
      ["meta-ads", true],
    ]);
    expect(listed.status).toHaveLength(4);
  });
});

describe("company relay permissions on the runner (hub v9)", () => {
  const access = (
    role: ZenHubAccess["role"],
    permissions: ReadonlyArray<string>,
  ): ZenHubAccess => ({
    role,
    customRoleId: null,
    permissions,
    scoped: [],
  });
  it("checks each op against the asker's access; owners and admins pass; guests never", () => {
    const tasksOnly = access("member", ["angajati:vede", "angajati:creeaza"]);
    expect(authorizeCompanyOp("staff.list", tasksOnly)).toBeNull();
    expect(authorizeCompanyOp("staff.task", tasksOnly)).toBeNull();
    expect(authorizeCompanyOp("staff.follow", tasksOnly)).toMatch(/urmareste/);
    expect(authorizeCompanyOp("staff.task", access("member", ["angajati:vede"]))).toMatch(
      /creeaza/,
    );
    expect(authorizeCompanyOp("staff.list", access("guest", ["angajati:vede"]))).toMatch(/members/);
    expect(authorizeCompanyOp("staff.follow", access("admin", []))).toBeNull();
    expect(authorizeCompanyOp("staff.delete", access("owner", []))).toBe("Unknown request.");
    // A scoped grant counts for showing and asking; the agent's own project is checked by the engine.
    expect(
      authorizeCompanyOp("staff.task", {
        ...access("member", ["angajati:vede"]),
        scoped: [{ permission: "angajati:creeaza", kind: "project", id: "p-site" }],
      }),
    ).toBeNull();
  });
  it("hub v9: a role scoped to a project gives tasks only to that project's agents", () => {
    const scoped: ZenHubAccess = {
      ...access("member", ["angajati:vede"]),
      scoped: [
        { permission: "angajati:creeaza", kind: "project", id: "p-site" },
        { permission: "angajati:trimite", kind: "project", id: "p-site" },
        { permission: "angajati:trimite", kind: "project", id: "p-shop" },
      ],
    };
    expect(staffTaskScope(scoped, "p-site")).toEqual({
      refusal: null,
      permissions: ["angajati:vede", "angajati:creeaza", "angajati:trimite"],
    });
    expect(staffTaskScope(scoped, "p-shop").refusal).toMatch(/angajati: creeaza/);
    // A company-wide agent needs a company-wide grant.
    expect(staffTaskScope(scoped, null).refusal).toMatch(/your projects/);
    expect(staffTaskScope(access("member", ["angajati:creeaza"]), null)).toEqual({
      refusal: null,
      permissions: ["angajati:creeaza"],
    });
    expect(staffTaskScope(access("owner", []), "p-shop")).toEqual({
      refusal: null,
      permissions: null,
    });
    expect(staffTaskScope(null, null).refusal).toMatch(/members/);
  });

  it("uses the hub's access when sent, else the built-in defaults of the synced role (older hubs)", () => {
    expect(frameAccess({ actorAccess: access("member", ["chats:vede"]) }, "admin")!.role).toBe(
      "member",
    );
    const fallback = frameAccess({}, "member")!;
    expect(fallback.permissions).toContain("angajati:trimite");
    expect(fallback.permissions).toContain("chats:urmareste");
    expect(frameAccess({}, undefined)).toBeNull();
  });
});
