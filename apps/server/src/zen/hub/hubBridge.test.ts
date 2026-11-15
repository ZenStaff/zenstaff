// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";

import { effectiveLedger, writeLedger } from "../toolchains/access.ts";
import { withZenToolchainEnv, setZenThreadEnvContributor } from "../toolchains/threadEnv.ts";
import { isHubManager, setZenHubBridge, type ZenHubBridge } from "./hubBridge.ts";

const fakeBridge = (overrides: Partial<ZenHubBridge>): ZenHubBridge => ({
  roleForLocalCompany: () => undefined,
  memorySettings: () => null,
  setMemorySettings: async () => undefined,
  accessLedger: () => null,
  runnerRole: () => null,
  grant: async () => undefined,
  revoke: async () => undefined,
  approveInstall: async () => undefined,
  ...overrides,
});

afterEach(() => {
  setZenHubBridge(null);
  setZenThreadEnvContributor("test", null);
});

describe("hub bridge seams", () => {
  const file = NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-bridge-")),
    "ledger.json",
  );
  writeLedger(file, {
    grants: [
      { packId: "meta-ads-report", user: "local@acme.example", grantedBy: "local admin", at: "x" },
    ],
    approvals: [],
  });

  it("uses the local ledger without a hub, and only the hub's verified grants on a hub runner", () => {
    expect(effectiveLedger(file).grants[0]?.user).toBe("local@acme.example");
    setZenHubBridge(fakeBridge({ accessLedger: () => ({ grants: [], approvals: [] }) }));
    // The local file no longer unlocks anything: the hub is the source of truth.
    expect(effectiveLedger(file).grants).toEqual([]);
    setZenHubBridge(fakeBridge({ accessLedger: () => null }));
    expect(effectiveLedger(file).grants).toHaveLength(1);
  });

  it("only owners and admins manage", () => {
    expect(
      (["owner", "admin", "member", "guest", null, undefined] as const).map((role) =>
        isHubManager(role),
      ),
    ).toEqual([true, true, false, false, false, false]);
  });

  it("adds a contributor's variables to the thread process, given the project", () => {
    setZenThreadEnvContributor("test", (_thread, projectId) =>
      projectId === "project-company" ? { ANTHROPIC_API_KEY: "company-key" } : null,
    );
    expect(
      withZenToolchainEnv("t1", { HOME: "/h" }, null, "project-company").ANTHROPIC_API_KEY,
    ).toBe("company-key");
    expect(
      withZenToolchainEnv("t1", { HOME: "/h" }, null, "project-personal").ANTHROPIC_API_KEY,
    ).toBeUndefined();
    expect(withZenToolchainEnv("t1", { HOME: "/h" }).ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("company memory for Codex threads", () => {
  it("matches a working folder to the deepest project root", async () => {
    const { projectForCwd } = await import("../memory/companyMemoryMcp.ts");
    const roots = [
      { root: "/work/acme", projectId: "p-acme" },
      { root: "/work/acme/site", projectId: "p-site" },
      { root: "/work/acme-old", projectId: "p-old" },
    ];
    expect(projectForCwd("/work/acme/site/src", roots)).toBe("p-site");
    expect(projectForCwd("/work/acme/", roots)).toBe("p-acme");
    expect(projectForCwd("/work/acmex", roots)).toBeNull();
  });

  it("adds zen-memory to a Codex thread's config only for a company with memory", async () => {
    const memory = await import("../memory/companyMemoryMcp.ts");
    memory.setZenMemoryProjectByCwd((cwd) => (cwd.startsWith("/work/acme") ? "p-acme" : null));
    memory.setZenMemoryMcpResolver((projectId) =>
      projectId === "p-acme" ? { url: "http://127.0.0.1:9/mcp", token: "t" } : null,
    );
    const config: Readonly<Record<string, unknown>> = memory.withZenCompanyMemoryCodexConfig(
      "/work/acme",
      { model: "x" } as Readonly<Record<string, unknown>>,
    );
    expect(config["mcp_servers.zen-memory"]).toMatchObject({
      url: "http://127.0.0.1:9/mcp",
      http_headers: { Authorization: "Bearer t" },
    });
    expect(memory.withZenCompanyMemoryCodexConfig("/home/me", { model: "x" })).toEqual({
      model: "x",
    });
    memory.setZenMemoryProjectByCwd(null);
    memory.setZenMemoryMcpResolver(null);
  });
});
