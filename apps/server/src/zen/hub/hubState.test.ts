import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  authorizeRelayRequest,
  emptyHubState,
  normalizeHubState,
  normalizeHubUrl,
  runnerCompanyFor,
  runnerInstallApproved,
  runnerLedgerFor,
  runnerLedgerOfHub,
  threadKind,
  type HubState,
} from "./hubState.ts";
import { buildCopyEvents } from "./threadCopy.ts";

const state = (overrides: Partial<HubState> = {}): HubState => ({
  ...emptyHubState(),
  runnerCompanyIds: ["co_acme"],
  links: { acme: "co_acme" },
  shares: {
    sh_personal: { threadId: "t-personal", kind: "personal", companyId: "co_acme" },
    sh_company: { threadId: "t-company", kind: "company", companyId: "co_acme" },
    sh_handover: { threadId: "t-personal", kind: "handover", companyId: "co_acme" },
  },
  ...overrides,
});

const request = (op: string, shareId: string, threadId: string, companyId = "co_acme") => ({
  op,
  shareId,
  threadId,
  companyId,
});

describe("runner-side authorization (the hub is not trusted alone)", () => {
  it("serves only threads this machine shared, under that share id", () => {
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.view", "sh_personal", "t-personal"),
        "personal",
      ),
    ).toBeNull();
    // A hub asking for another thread under a real share id is refused.
    expect(
      authorizeRelayRequest(state(), request("thread.view", "sh_personal", "t-secret"), "personal"),
    ).not.toBeNull();
    // Unknown share ids are refused.
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.export", "sh_forged", "t-personal"),
        "personal",
      ),
    ).not.toBeNull();
    // Another company than the one it was shared with is refused.
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.view", "sh_personal", "t-personal", "co_other"),
        "personal",
      ),
    ).not.toBeNull();
  });

  it("never accepts a prompt for a personal chat", () => {
    for (const kind of ["personal", "company"] as const) {
      expect(
        authorizeRelayRequest(state(), request("thread.prompt", "sh_personal", "t-personal"), kind),
      ).not.toBeNull();
      expect(
        authorizeRelayRequest(state(), request("thread.prompt", "sh_handover", "t-personal"), kind),
      ).not.toBeNull();
    }
  });

  it("accepts prompts for company chats only while it is still a company chat on this runner", () => {
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.prompt", "sh_company", "t-company"),
        "company",
      ),
    ).toBeNull();
    // The project moved out of the linked company.
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.prompt", "sh_company", "t-company"),
        "personal",
      ),
    ).not.toBeNull();
    // The machine stopped being the company's runner.
    expect(
      authorizeRelayRequest(
        state({ runnerCompanyIds: [] }),
        request("thread.prompt", "sh_company", "t-company"),
        "company",
      ),
    ).not.toBeNull();
  });

  it("archives only on a real hand-over", () => {
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.handedOver", "sh_handover", "t-personal"),
        "personal",
      ),
    ).toBeNull();
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.handedOver", "sh_personal", "t-personal"),
        "personal",
      ),
    ).not.toBeNull();
    expect(
      authorizeRelayRequest(
        state(),
        request("thread.delete", "sh_company", "t-company"),
        "company",
      ),
    ).not.toBeNull();
  });
});

describe("thread kind", () => {
  it("is company only for a linked company whose runner is this machine", () => {
    const projectCompanies = { p1: "acme", p2: "other" };
    expect(
      threadKind({
        projectId: "p1",
        projectCompanies,
        links: { acme: "co_acme" },
        runnerCompanyIds: ["co_acme"],
      }).kind,
    ).toBe("company");
    expect(
      threadKind({
        projectId: "p1",
        projectCompanies,
        links: { acme: "co_acme" },
        runnerCompanyIds: [],
      }).kind,
    ).toBe("personal");
    expect(
      threadKind({
        projectId: "p2",
        projectCompanies,
        links: { acme: "co_acme" },
        runnerCompanyIds: ["co_acme"],
      }).kind,
    ).toBe("personal");
    expect(
      threadKind({ projectId: "p3", projectCompanies, links: {}, runnerCompanyIds: ["co_acme"] })
        .kind,
    ).toBe("personal");
  });
});

describe("hub v9: company runner rules and several companies on one machine", () => {
  it("refuses a member's prompt in a company chat on the runner; owners and admins write", () => {
    const prompt = (role: string) =>
      authorizeRelayRequest(
        state(),
        { ...request("thread.prompt", "sh_company", "t-company"), actorAccess: { role } },
        "company",
      );
    expect(prompt("member")).toMatch(/Members do not write chats on the company server/);
    expect(prompt("guest")).not.toBeNull();
    expect(prompt("owner")).toBeNull();
    expect(prompt("admin")).toBeNull();
    // Reading stays open: the member follows it.
    expect(
      authorizeRelayRequest(
        state(),
        { ...request("thread.view", "sh_company", "t-company"), actorAccess: { role: "member" } },
        "company",
      ),
    ).toBeNull();
  });

  it("serves the chats of every company it runs for, and only those", () => {
    const two = state({
      runnerCompanyIds: ["co_acme", "co_zed"],
      shares: {
        sh_a: { threadId: "t-a", kind: "company", companyId: "co_acme" },
        sh_z: { threadId: "t-z", kind: "company", companyId: "co_zed" },
      },
    });
    expect(
      authorizeRelayRequest(two, request("thread.prompt", "sh_z", "t-z", "co_zed"), "company"),
    ).toBeNull();
    // A share of one company asked for as the other: refused.
    expect(
      authorizeRelayRequest(two, request("thread.view", "sh_z", "t-z", "co_acme"), "company"),
    ).toMatch(/not shared with that company/);
    expect(
      threadKind({
        projectId: "p",
        projectCompanies: { p: "zed" },
        links: { zed: "co_zed" },
        runnerCompanyIds: ["co_acme", "co_zed"],
      }),
    ).toEqual({ kind: "company", hubCompanyId: "co_zed" });
  });

  it("moves a hub.json from before v9 (one runner company, one AI account) to the lists", () => {
    const legacy = normalizeHubState({
      version: 1,
      runnerCompanyId: "co_acme",
      companyAi: { provider: "claude", mode: "api-key", label: "Acme key" },
    });
    expect(legacy.runnerCompanyIds).toEqual(["co_acme"]);
    expect(legacy.runnerCompanyId).toBe("co_acme");
    expect(legacy.companyAis).toEqual({
      co_acme: { provider: "claude", mode: "api-key", label: "Acme key" },
    });
    const current = normalizeHubState({
      version: 1,
      runnerCompanyIds: ["co_a", "co_b", 7],
      companyAis: {
        co_a: { provider: "claude", mode: "seat", label: "A" },
        co_b: { provider: "x" },
      },
    });
    expect(current.runnerCompanyIds).toEqual(["co_a", "co_b"]);
    expect(Object.keys(current.companyAis)).toEqual(["co_a"]);
  });

  it("checks each company's runs against that company's Enterprise grants only", () => {
    const grant = (packId: string, user: string) => ({ packId, user, grantedBy: "a", at: "t" });
    const acme = { grants: [grant("meta-ads", "maria@acme.example")], approvals: [] };
    const zed = { grants: [grant("meta-ads", "ion@firma.example")], approvals: [] };
    const two = state({
      session: { token: "t", user: { id: "u_alex", email: "ana@firma.example", name: "Alex" } },
      runnerCompanyIds: ["co_acme", "co_zed"],
      links: { acme: "co_acme", zed: "co_zed", other: "co_other" },
      cache: { ...emptyHubState().cache, ledger: acme, ledgers: { co_acme: acme, co_zed: zed } },
    });
    expect(runnerLedgerFor(two, "acme")).toEqual(acme);
    // The second company's run gets its own grants, never the first company's.
    expect(runnerLedgerFor(two, "zed")).toEqual(zed);
    // A company this machine does not serve: no grant applies.
    expect(runnerLedgerFor(two, "other")).toEqual({ grants: [], approvals: [] });
    // No company (or an unlinked one): the first served company, as before.
    expect(runnerLedgerFor(two, null)).toEqual(acme);
    expect(runnerLedgerFor(two, "personal")).toEqual(acme);
    // A served company not synced yet: nothing granted (the first keeps its older cache).
    const unsynced = { ...two, cache: { ...two.cache, ledgers: { co_acme: acme } } };
    expect(runnerLedgerFor(unsynced, "zed")).toEqual({ grants: [], approvals: [] });
    expect(runnerLedgerFor({ ...unsynced, cache: { ...two.cache, ledgers: {} } }, "acme")).toEqual(
      acme,
    );
    // Not a runner, or signed out: the local ledger file decides.
    expect(runnerLedgerFor({ ...two, runnerCompanyIds: [] }, "acme")).toBeNull();
    expect(runnerLedgerFor({ ...two, session: null }, "acme")).toBeNull();
  });

  it("scopes an Enterprise install approval and the Enterprise screen to one served company", () => {
    const approval = (packId: string) => ({ packId, approvedBy: "a", at: "t" });
    const acme = { grants: [], approvals: [approval("meta-ads")] };
    const zed = { grants: [], approvals: [] };
    const two = state({
      session: { token: "t", user: { id: "u_alex", email: "ana@firma.example", name: "Alex" } },
      runnerCompanyIds: ["co_acme", "co_zed"],
      links: { acme: "co_acme", zed: "co_zed", other: "co_other" },
      cache: { ...emptyHubState().cache, ledger: acme, ledgers: { co_acme: acme, co_zed: zed } },
    });
    // Acme's approval installs the pack for Acme only, never for Zed.
    expect(runnerInstallApproved(two, "meta-ads", { hubCompanyId: "co_acme" })).toBe(true);
    expect(runnerInstallApproved(two, "meta-ads", { hubCompanyId: "co_zed" })).toBe(false);
    expect(runnerInstallApproved(two, "meta-ads", { localCompanyId: "zed" })).toBe(false);
    expect(runnerInstallApproved(two, "meta-ads", { localCompanyId: "acme" })).toBe(true);
    // A company this machine does not serve: refused (not mapped to the first one).
    expect(runnerInstallApproved(two, "meta-ads", { hubCompanyId: "co_other" })).toBe(false);
    expect(runnerInstallApproved(two, "meta-ads", { localCompanyId: "other" })).toBe(false);
    // Not a hub runner: the local ledger file decides.
    expect(runnerInstallApproved({ ...two, runnerCompanyIds: [] }, "meta-ads")).toBeNull();
    // The screen's company: the one asked for, the linked one, else the first.
    expect(runnerCompanyFor(two, { hubCompanyId: "co_zed" })).toBe("co_zed");
    expect(runnerCompanyFor(two, { hubCompanyId: "co_other" })).toBeNull();
    expect(runnerCompanyFor(two, { localCompanyId: "zed" })).toBe("co_zed");
    expect(runnerCompanyFor(two)).toBe("co_acme");
    expect(runnerLedgerOfHub(two, "co_zed")).toEqual(zed);
    expect(runnerLedgerOfHub(two, "co_other")).toEqual({ grants: [], approvals: [] });
  });
});

describe("hub url and state", () => {
  it("requires https except on this machine", () => {
    expect(normalizeHubUrl("https://hub.example.com/")).toBe("https://hub.example.com");
    expect(normalizeHubUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(normalizeHubUrl("http://localhost:8787/")).toBe("http://localhost:8787");
    expect(normalizeHubUrl("http://hub.example.com")).toBeNull();
    expect(normalizeHubUrl("https://user:pw@hub.example.com")).toBeNull();
    expect(normalizeHubUrl("not a url")).toBeNull();
  });

  it("drops malformed share entries when loading", () => {
    const loaded = normalizeHubState({
      version: 1,
      shares: { ok: { threadId: "t", kind: "company", companyId: "c" }, bad: { threadId: 1 } },
      links: { a: "b", c: 3 },
    });
    expect(Object.keys(loaded.shares)).toEqual(["ok"]);
    expect(loaded.links).toEqual({ a: "b" });
    expect(normalizeHubState({ version: 2 })).toEqual(emptyHubState());
  });
});

describe("copied chat", () => {
  it("is a v1-import thread with run-less history and no provider thread", () => {
    const events = buildCopyEvents({
      threadId: ThreadId.make("copy-1"),
      projectId: ProjectId.make("p1"),
      modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" } as never,
      runtimeMode: "approval-required" as never,
      snapshot: {
        version: "v",
        title: "Pricing",
        kind: "personal",
        running: false,
        omittedMessageCount: 0,
        messages: [
          {
            id: "m1",
            role: "user",
            text: "Hi",
            createdAt: "2026-11-07T10:00:00.000Z",
            streaming: false,
          },
          {
            id: "m2",
            role: "assistant",
            text: "Hello",
            createdAt: "2026-11-07T10:00:05.000Z",
            streaming: false,
          },
          {
            id: "m3",
            role: "assistant",
            text: "partial",
            createdAt: "2026-11-07T10:00:06.000Z",
            streaming: true,
          },
        ],
      },
      fromName: "Alex",
      how: "copy",
      now: DateTime.makeUnsafe(Date.parse("2026-11-07T11:00:00.000Z")),
    });
    const created = events[0]!;
    expect(created.type).toBe("thread.created");
    if (created.type !== "thread.created") return;
    expect(created.payload.historyOrigin).toBe("v1_import");
    expect(created.payload.activeProviderThreadId).toBeNull();
    expect(events.some((event) => event.type === "provider-thread.updated")).toBe(false);
    // Streaming (unfinished) messages are not copied.
    expect(events.filter((event) => event.type === "message.updated")).toHaveLength(2);
    const notice = events[1]!;
    expect(notice.type === "turn-item.updated" && notice.payload.type === "system_notice").toBe(
      true,
    );
  });
});
