// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - tests of the plain enterprise access code.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  accessProblems,
  isReadOnlyScope,
  type ZenMachineProbe,
  type ZenWorkflowAccess,
} from "@t3tools/contracts/zenToolchains";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  LOCK_MESSAGES,
  enterpriseLock,
  parseAccess,
  runnerStatus,
  setZenAccessLedgerFile,
  zenPackInstallRefusal,
} from "./access.ts";
import { headerFor, proxyTarget, startCredentialProxy } from "./credentialProxy.ts";
import { setZenHubBridge } from "../hub/hubBridge.ts";
import { ToolchainManager } from "./manager.ts";
import { SecretVault } from "./vault.ts";

const temporary: string[] = [];
const tempDir = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-access-"));
  temporary.push(dir);
  return dir;
};
afterEach(() => {
  setZenAccessLedgerFile(null);
  for (const dir of temporary.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const metaAccess = (readOnly: boolean, scopes: string[]): ZenWorkflowAccess => ({
  tier: "enterprise",
  stability: "beta",
  secrets: [
    {
      id: "meta_token",
      label: "Meta page token",
      provider: "meta",
      scopes,
      readOnly,
      apiHosts: ["graph.facebook.com"],
    },
  ],
});

describe("access block validation", () => {
  it("classifies scopes", () => {
    for (const scope of [
      "ads_read",
      "instagram_basic",
      "pages_read_engagement",
      "https://www.googleapis.com/auth/drive.readonly",
      "read:org",
    ]) {
      expect(isReadOnlyScope(scope), scope).toBe(true);
    }
    for (const scope of [
      "pages_manage_posts",
      "ads_management",
      "https://www.googleapis.com/auth/drive",
      "repo",
      "write:org",
      "*",
      "chat:write",
    ]) {
      expect(isReadOnlyScope(scope), scope).toBe(false);
    }
  });

  it("fails a pack that says read-only but asks for write scopes", () => {
    expect(accessProblems(metaAccess(true, ["pages_read_engagement"]))).toEqual([]);
    expect(
      accessProblems(metaAccess(true, ["pages_read_engagement", "pages_manage_posts"])),
    ).toEqual([
      'Secret "Meta page token" says read-only but asks for pages_manage_posts, which can change data.',
    ]);
    expect(accessProblems(metaAccess(false, ["pages_manage_posts"]))).toEqual([]);
    expect(accessProblems({ ...metaAccess(false, []), tier: "standard" })).toEqual([
      "A workflow that needs credentials is enterprise tier.",
    ]);
  });

  it("reads the block from workflow.json, defaulting to standard", () => {
    expect(parseAccess(JSON.stringify({ id: "x" })).access).toEqual({
      tier: "standard",
      stability: "stable",
    });
    expect(parseAccess(JSON.stringify({ access: { tier: "gold" } })).problems[0]).toContain(
      "access is not valid",
    );
    expect(
      parseAccess(JSON.stringify({ access: metaAccess(true, ["ads_management"]) })).problems,
    ).toHaveLength(1);
  });
});

describe("enterprise gate", () => {
  const ledger = {
    grants: [
      { packId: "meta-report", user: "ana@acme.example", grantedBy: "boss@acme.example", at: "x" },
    ],
    approvals: [],
  };
  const runner = runnerStatus(
    JSON.stringify({
      hubUrl: "https://hub",
      runnerCompanyId: "c1",
      session: { user: { email: "Srv@Acme.example" } },
    }),
    false,
  );
  const laptop = runnerStatus(
    JSON.stringify({ hubUrl: "https://hub", runnerCompanyId: null }),
    true,
  );
  const base = {
    packId: "meta-report",
    access: metaAccess(true, ["ads_read"]),
    problems: [],
    ledger,
    hasSecret: () => true,
  };

  it("knows a runner from the hub file; a laptop on a hub is never one, even with the local switch", () => {
    expect(runner).toEqual({ isRunner: true, source: "hub", hubUser: "srv@acme.example" });
    expect(laptop.isRunner).toBe(false);
    expect(runnerStatus(null, true)).toMatchObject({ isRunner: true, source: "local" });
    expect(runnerStatus(null, false).isRunner).toBe(false);
  });

  it("needs both the runner and a per-pack grant", () => {
    expect(enterpriseLock({ ...base, runner, user: "ANA@acme.example" })).toBeNull();
    expect(enterpriseLock({ ...base, runner: laptop, user: "ana@acme.example" })).toEqual({
      code: "needs-runner",
      message: LOCK_MESSAGES.needsRunner,
    });
    expect(enterpriseLock({ ...base, runner, user: "ion@acme.example" })).toEqual({
      code: "needs-grant",
      message: LOCK_MESSAGES.needsGrant,
    });
    // A grant for another pack is not enough.
    expect(
      enterpriseLock({ ...base, packId: "other", runner, user: "ana@acme.example" })?.code,
    ).toBe("needs-grant");
    expect(
      enterpriseLock({ ...base, runner, user: "ana@acme.example", hasSecret: () => false }),
    ).toEqual({
      code: "needs-secret",
      message: "Ask an admin to add the Meta page token on the company server.",
    });
    expect(
      enterpriseLock({ ...base, access: { tier: "standard" }, runner: laptop, user: null }),
    ).toBeNull();
    expect(
      enterpriseLock({ ...base, problems: ["bad"], runner, user: "ana@acme.example" })?.code,
    ).toBe("invalid");
  });

  it("refuses to install an enterprise pack before an admin approves it", () => {
    const dir = tempDir();
    const pack = NodePath.join(dir, "meta-report");
    NodeFS.mkdirSync(pack);
    NodeFS.writeFileSync(
      NodePath.join(pack, "workflow.json"),
      JSON.stringify({ id: "meta-report", access: metaAccess(true, ["ads_read"]) }),
    );
    const ledgerFile = NodePath.join(dir, "ledger.json");
    setZenAccessLedgerFile(ledgerFile);
    expect(zenPackInstallRefusal("meta-report", pack)).toContain(
      "needs a company admin's approval",
    );
    NodeFS.writeFileSync(
      ledgerFile,
      JSON.stringify({
        grants: [],
        approvals: [{ packId: "meta-report", approvedBy: "boss", at: "x" }],
      }),
    );
    expect(zenPackInstallRefusal("meta-report", pack)).toBeNull();
    NodeFS.writeFileSync(
      NodePath.join(pack, "workflow.json"),
      JSON.stringify({ id: "meta-report", access: metaAccess(true, ["ads_management"]) }),
    );
    expect(zenPackInstallRefusal("meta-report", pack)).toContain("This pack is not valid");
  });

  it("on a server for several companies, only that company's install approval counts", () => {
    const dir = tempDir();
    const pack = NodePath.join(dir, "meta-report");
    NodeFS.mkdirSync(pack);
    NodeFS.writeFileSync(
      NodePath.join(pack, "workflow.json"),
      JSON.stringify({ id: "meta-report", access: metaAccess(true, ["ads_read"]) }),
    );
    // A local ledger that approves it must not matter on a hub server.
    const ledgerFile = NodePath.join(dir, "ledger.json");
    NodeFS.writeFileSync(
      ledgerFile,
      JSON.stringify({
        grants: [],
        approvals: [{ packId: "meta-report", approvedBy: "x", at: "t" }],
      }),
    );
    setZenAccessLedgerFile(ledgerFile);
    const approvedBy: Record<string, ReadonlyArray<string>> = {
      co_acme: ["meta-report"],
      co_zed: [],
    };
    const links: Record<string, string> = { acme: "co_acme", zed: "co_zed" };
    setZenHubBridge({
      roleForLocalCompany: () => "owner",
      memorySettings: () => null,
      setMemorySettings: async () => undefined,
      accessLedger: () => ({ grants: [], approvals: [] }),
      runnerRole: () => "owner",
      // As ZenHub's runnerInstallApproved: the asked company, the linked one, else the first.
      installApproved: (packId, scope) => {
        const company =
          scope.hubCompanyId ?? (scope.localCompanyId ? links[scope.localCompanyId] : "co_acme");
        return company === undefined ? false : (approvedBy[company] ?? []).includes(packId);
      },
      grant: async () => undefined,
      revoke: async () => undefined,
      approveInstall: async () => undefined,
    });
    try {
      // Acme approved it: Acme's company pack and Acme's marketplace install it.
      expect(zenPackInstallRefusal("meta-report", pack, { hubCompanyId: "co_acme" })).toBeNull();
      expect(zenPackInstallRefusal("meta-report", pack, { localCompanyId: "acme" })).toBeNull();
      // Acme's approval does not install it for Zed, whatever the local ledger says.
      expect(zenPackInstallRefusal("meta-report", pack, { hubCompanyId: "co_zed" })).toContain(
        "needs a company admin's approval",
      );
      expect(zenPackInstallRefusal("meta-report", pack, { localCompanyId: "zed" })).toContain(
        "needs a company admin's approval",
      );
    } finally {
      setZenHubBridge(null);
    }
  });
});

describe("vault and credential proxy", () => {
  it("encrypts values in a mode 600 file", () => {
    const dir = tempDir();
    const vault = new SecretVault(dir, "linux", false);
    vault.set("meta-report", "meta_token", "EAAB-secret-value");
    expect(vault.get("meta-report", "meta_token")).toBe("EAAB-secret-value");
    const text = NodeFS.readFileSync(NodePath.join(dir, "vault.json"), "utf8");
    expect(text).not.toContain("EAAB-secret-value");
    expect(NodeFS.statSync(NodePath.join(dir, "vault.json")).mode & 0o777).toBe(0o600);
    expect(NodeFS.statSync(NodePath.join(dir, "vault.key")).mode & 0o777).toBe(0o600);
    expect(vault.keyStore).toBe("file");
    // A tampered entry reads as missing, never as garbage.
    const tampered = JSON.parse(text);
    tampered.entries["meta-report/meta_token"].data = Buffer.from("x").toString("base64");
    NodeFS.writeFileSync(NodePath.join(dir, "vault.json"), JSON.stringify(tampered));
    expect(new SecretVault(dir, "linux", false).get("meta-report", "meta_token")).toBeNull();
  });

  it("routes only to declared hosts and adds the header", async () => {
    const routes = [
      {
        secretId: "meta_token",
        hosts: ["graph.facebook.com"],
        header: "Authorization: Bearer {secret}",
        value: () => "s3cret",
      },
    ];
    expect(proxyTarget(routes, "/meta_token/v21.0/me")).toMatchObject({
      url: "https://graph.facebook.com/v21.0/me",
    });
    expect(proxyTarget(routes, "/meta_token/@evil.example/x")).toEqual({
      refused: "evil.example is not one of the hosts this workflow declared.",
    });
    expect(proxyTarget(routes, "/other/x")).toHaveProperty("refused");
    expect(headerFor("xi-api-key: {secret}", "k")).toEqual(["xi-api-key", "k"]);
    const used: string[] = [];
    const proxy = await startCredentialProxy(routes, (id) => used.push(id));
    try {
      const refused = await fetch(`${proxy.url}/meta_token/@evil.example/steal`);
      expect(refused.status).toBe(403);
      expect(used).toEqual([]);
    } finally {
      await proxy.close();
    }
  });
});

describe("enterprise threads in the manager", () => {
  const probe = (zenHome: string): ZenMachineProbe => ({
    probedAt: "x",
    durationMs: 1,
    os: "linux",
    arch: "x64",
    osVersion: "6",
    hostname: "h",
    cpuModel: "c",
    cpuCores: 8,
    totalRamGb: 16,
    freeRamGb: 8,
    zenHome,
    installDir: NodePath.join(zenHome, "toolchains"),
    installDirWritable: true,
    freeDiskGb: 100,
    gpus: [],
    toolsOnPath: {},
    network: [],
    sandbox: "none",
    companyRunner: false,
  });

  const setup = (hub: object | null) => {
    const root = tempDir();
    const assets = NodePath.join(root, "assets");
    const flow = NodePath.join(assets, "builtin", "meta-report");
    NodeFS.mkdirSync(flow, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(flow, "workflow.json"),
      JSON.stringify({
        id: "meta-report",
        name: "Meta report",
        access: {
          tier: "enterprise",
          secrets: [
            {
              id: "meta_token",
              label: "Meta page token",
              provider: "meta",
              scopes: ["ads_read"],
              readOnly: true,
              apiHosts: ["graph.facebook.com"],
            },
            {
              id: "sheet_key",
              label: "Sheets key",
              provider: "google",
              scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
              readOnly: true,
            },
          ],
        },
      }),
    );
    const catalog = NodePath.join(root, "catalog");
    NodeFS.mkdirSync(NodePath.join(catalog, "tools"), { recursive: true });
    const stateDir = NodePath.join(root, "state");
    if (hub) {
      NodeFS.mkdirSync(NodePath.join(stateDir, "zen"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(stateDir, "zen", "hub.json"), JSON.stringify(hub));
    }
    const zenHome = NodePath.join(root, "home");
    const manager = new ToolchainManager({
      zenHome,
      stateDir,
      platform: "linux",
      arch: "x64",
      catalogDir: catalog,
      workflowsAssetsDir: assets,
      env: {},
      vaultUseKeychain: false,
      probeImpl: async () => probe(zenHome),
    });
    return { manager, zenHome, work: root };
  };

  it("refuses a laptop, even for the admin who unlocked the pack", async () => {
    const { manager, work } = setup({
      hubUrl: "https://hub",
      runnerCompanyId: null,
      session: { user: { email: "boss@acme.example" } },
    });
    await manager.init();
    await manager.grant({ packId: "meta-report", user: "boss@acme.example", adminConfirmed: true });
    const check = await manager.checkWorkflow({
      workflowId: "meta-report",
      requester: "boss@acme.example",
    });
    expect(check.access.lock?.code).toBe("needs-runner");
    await expect(
      manager.setSecret({ workflowId: "meta-report", secretId: "meta_token", value: "x" }),
    ).rejects.toThrow(/needs a server/);
    await expect(
      manager.prepareThread({
        workflowId: "meta-report",
        threadId: "t1",
        cwd: work,
        requester: "boss@acme.example",
      }),
    ).rejects.toMatchObject({ reason: "blocked" });
    manager.dispose();
  });

  it("on the runner: needs a grant, then gives the thread a proxy URL and keeps values out of the reply", async () => {
    const { manager, zenHome, work } = setup({
      hubUrl: "https://hub",
      runnerCompanyId: "c1",
      session: { user: { email: "srv@acme.example" } },
    });
    await manager.init();
    await manager.setSecret({
      workflowId: "meta-report",
      secretId: "meta_token",
      value: "EAAB-meta",
    });
    await manager.setSecret({
      workflowId: "meta-report",
      secretId: "sheet_key",
      value: "AIza-sheet",
    });
    await expect(
      manager.prepareThread({
        workflowId: "meta-report",
        threadId: "t2",
        cwd: work,
        requester: "ana@acme.example",
      }),
    ).rejects.toThrow(LOCK_MESSAGES.needsGrant);
    await expect(
      manager.grant({ packId: "meta-report", user: "ana@acme.example", adminConfirmed: false }),
    ).rejects.toThrow(/admin must confirm/);
    await manager.grant({ packId: "meta-report", user: "Ana@Acme.example", adminConfirmed: true });
    const prepared = await manager.prepareThread({
      workflowId: "meta-report",
      threadId: "t2",
      cwd: work,
      requester: "ana@acme.example",
    });
    expect(prepared.env.ZEN_SECRET_META_TOKEN_URL).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/meta_token$/,
    );
    expect(JSON.stringify(prepared)).not.toContain("EAAB-meta");
    expect(JSON.stringify(prepared)).not.toContain("AIza-sheet");
    // The fallback value reaches only the thread's process, never the saved state.
    expect(manager.resolveThread("t2")?.env.ZEN_SECRET_SHEET_KEY).toBe("AIza-sheet");
    expect(
      NodeFS.readFileSync(NodePath.join(zenHome, "toolchains", "state.json"), "utf8"),
    ).not.toContain("AIza-sheet");
    const log = NodeFS.readFileSync(
      NodePath.join(zenHome, "toolchains", "access", "usage.log"),
      "utf8",
    );
    expect(log).toContain('"user":"ana@acme.example"');
    expect(log).not.toContain("EAAB-meta");
    const overview = await manager.accessOverview();
    expect(overview.packs[0]).toMatchObject({
      workflowId: "meta-report",
      grants: [{ user: "ana@acme.example", grantedBy: "srv@acme.example" }],
    });
    manager.dispose();
  });
  it("on a runner serving several companies, a run uses only its own company's grants", async () => {
    const { manager, work } = setup({
      hubUrl: "https://hub",
      runnerCompanyId: "co_acme",
      runnerCompanyIds: ["co_acme", "co_zed"],
      session: { user: { email: "srv@firma.example" } },
    });
    await manager.init();
    const grant = (user: string) => ({ packId: "meta-report", user, grantedBy: "a", at: "t" });
    const ledgers: Record<string, { grants: ReturnType<typeof grant>[]; approvals: [] }> = {
      acme: { grants: [grant("ana@acme.example")], approvals: [] },
      zed: { grants: [grant("ion@firma.example")], approvals: [] },
    };
    setZenHubBridge({
      roleForLocalCompany: () => "owner",
      memorySettings: () => null,
      setMemorySettings: async () => undefined,
      // As ZenHub's runnerLedgerFor: the linked company's ledger, the first one without a company.
      accessLedger: (localCompanyId) => ledgers[localCompanyId ?? "acme"] ?? ledgers.acme!,
      runnerRole: () => "owner",
      grant: async () => undefined,
      revoke: async () => undefined,
      approveInstall: async () => undefined,
    });
    try {
      const check = (requester: string, companyId: string) =>
        manager
          .checkWorkflow({ workflowId: "meta-report", requester, companyId })
          .then((result) => result.access.lock?.code ?? null);
      expect(await check("ana@acme.example", "acme")).not.toBe("needs-grant");
      expect(await check("ion@firma.example", "zed")).not.toBe("needs-grant");
      // Ana's grant at Acme does not open the pack for a Zed run, and the other way round.
      expect(await check("ana@acme.example", "zed")).toBe("needs-grant");
      expect(await check("ion@firma.example", "acme")).toBe("needs-grant");
      await expect(
        manager.prepareThread({
          workflowId: "meta-report",
          threadId: "t-zed",
          cwd: work,
          requester: "ana@acme.example",
          companyId: "zed",
        }),
      ).rejects.toThrow(LOCK_MESSAGES.needsGrant);
    } finally {
      setZenHubBridge(null);
    }
    manager.dispose();
  });

  it("the server's Enterprise screen works on one served company at a time", async () => {
    const { manager } = setup({
      hubUrl: "https://hub",
      runnerCompanyId: "co_acme",
      runnerCompanyIds: ["co_acme", "co_zed"],
      session: { user: { email: "srv@firma.example" } },
    });
    await manager.init();
    const grant = (user: string) => ({ packId: "meta-report", user, grantedBy: "a", at: "t" });
    const ledgers: Record<string, { grants: ReturnType<typeof grant>[]; approvals: [] }> = {
      co_acme: { grants: [grant("ana@acme.example")], approvals: [] },
      co_zed: { grants: [grant("ion@firma.example")], approvals: [] },
    };
    // Owner at Acme, only a member at Zed.
    const roles: Record<string, "owner" | "member"> = { co_acme: "owner", co_zed: "member" };
    const calls: Array<{ op: string; companyId: string | null | undefined }> = [];
    setZenHubBridge({
      roleForLocalCompany: () => "owner",
      memorySettings: () => null,
      setMemorySettings: async () => undefined,
      accessLedger: () => ledgers.co_acme!,
      runnerRole: (hubCompanyId) => roles[hubCompanyId ?? "co_acme"] ?? null,
      servedCompanies: () => [
        { id: "co_acme", name: "Acme", role: "owner" },
        { id: "co_zed", name: "Zed", role: "member" },
      ],
      ledgerOfHubCompany: (hubCompanyId) => ledgers[hubCompanyId] ?? null,
      grant: async (input) => void calls.push({ op: "grant", companyId: input.companyId }),
      revoke: async (input) => void calls.push({ op: "revoke", companyId: input.companyId }),
      approveInstall: async (input) =>
        void calls.push({ op: "approveInstall", companyId: input.companyId }),
    });
    try {
      const first = await manager.accessOverview();
      expect(first.companyId).toBe("co_acme");
      expect(first.companies?.map((company) => [company.name, company.manager])).toEqual([
        ["Acme", true],
        ["Zed", false],
      ]);
      expect(first.packs[0]?.grants.map((item) => item.user)).toEqual(["ana@acme.example"]);
      const zed = await manager.accessOverview({ companyId: "co_zed" });
      expect(zed.companyId).toBe("co_zed");
      expect(zed.packs[0]?.grants.map((item) => item.user)).toEqual(["ion@firma.example"]);
      // Acting for Acme goes to Acme; for Zed the role at Zed decides (a member is refused).
      await manager.grant({
        packId: "meta-report",
        user: "maria@acme.example",
        adminConfirmed: true,
        companyId: "co_acme",
      });
      await expect(
        manager.grant({
          packId: "meta-report",
          user: "maria@firma.example",
          adminConfirmed: true,
          companyId: "co_zed",
        }),
      ).rejects.toThrow("Only the company's owners and admins");
      await expect(
        manager.approveInstall({
          packId: "meta-report",
          adminConfirmed: true,
          companyId: "co_zed",
        }),
      ).rejects.toThrow("Only the company's owners and admins");
      // A company this server does not serve is refused, never mapped to the first one.
      await expect(manager.accessOverview({ companyId: "co_other" })).rejects.toThrow(
        "not the server of that company",
      );
      expect(calls).toEqual([{ op: "grant", companyId: "co_acme" }]);
    } finally {
      setZenHubBridge(null);
    }
    manager.dispose();
  });
});
