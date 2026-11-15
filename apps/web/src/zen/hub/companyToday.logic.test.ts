import { describe, expect, it } from "vite-plus/test";

import { zenMessagesFor } from "../i18n/zenI18n";
import { companyTodayText } from "./companyToday.i18n";
import {
  deriveCompanyToday,
  hubAppUrl,
  isHubAppUrl,
  localCompanyOf,
  pickCompanyTodayCompany,
  showCompanyToday,
  type CompanyTodayHubStatus,
  type CompanyTodaySources,
} from "./companyToday.logic";

const status: CompanyTodayHubStatus = {
  hubUrl: "https://zenhub.zed-zen.com",
  signedIn: true,
  companies: [
    { id: "hub-a", name: "Alpha" },
    { id: "hub-b", name: "Beta" },
  ],
  links: { "local-b": "hub-b" },
  twoFactor: { gate: "ok" },
  environments: [
    { id: "e1", online: true },
    { id: "e2", online: false },
    { id: "e3", online: true },
  ],
};

const sources = (over: Partial<CompanyTodaySources> = {}): CompanyTodaySources => ({
  status,
  hubCompanyId: "hub-b",
  localCompanyId: "local-b",
  threads: [
    {
      environmentId: "env",
      id: "t1",
      hasPendingApprovals: true,
      archivedAt: null,
      companyId: "local-b",
    },
    {
      environmentId: "env",
      id: "t2",
      hasPendingApprovals: true,
      archivedAt: null,
      companyId: "personal",
    },
    {
      environmentId: "env",
      id: "t3",
      hasPendingApprovals: true,
      archivedAt: "2026-11-01",
      companyId: "local-b",
    },
    {
      environmentId: "env",
      id: "t4",
      hasPendingApprovals: false,
      archivedAt: null,
      companyId: "local-b",
    },
  ],
  staff: {
    agents: [
      { id: "a1", name: "Zed", role: "Sales", status: "idle" },
      { id: "a2", name: "Ana", role: "Support", status: "working" },
      { id: "a3", name: "Bob", role: "Ads", status: "waiting-approval" },
      { id: "a4", name: "Cid", role: "Ops", status: "working" },
    ],
    approvals: [{ status: "pending" }, { status: "approved" }, { status: "pending" }],
  },
  messageApprovals: 1,
  trustedDevices: { canDecide: true, devices: [{ pending: true }, { pending: false }, {}] },
  runners: [
    { name: "Old laptop", online: false },
    { name: "Office PC", online: true },
  ],
  packStatus: [
    {
      packId: "seo",
      environmentId: "e1",
      environmentName: "PC",
      userName: "Ana",
      state: "failed",
      error: "No disk",
    },
    {
      packId: "seo",
      environmentId: "e2",
      environmentName: "Mac",
      userName: "Bob",
      state: "installed",
      error: null,
    },
    {
      packId: "ads",
      environmentId: "e2",
      environmentName: "Mac",
      userName: "Bob",
      state: "failed",
      error: null,
    },
    {
      packId: "crm",
      environmentId: "e3",
      environmentName: "Srv",
      userName: "Cid",
      state: "runner-only",
      error: null,
    },
  ],
  ...over,
});

describe("showCompanyToday", () => {
  it("needs a signed-in person past the two-factor gate in at least one hub company", () => {
    expect(showCompanyToday(null)).toBe(false);
    expect(showCompanyToday(status)).toBe(true);
    expect(showCompanyToday({ ...status, signedIn: false })).toBe(false);
    expect(showCompanyToday({ ...status, twoFactor: { gate: "verify" } })).toBe(false);
    expect(showCompanyToday({ ...status, twoFactor: null })).toBe(true);
    expect(showCompanyToday({ ...status, companies: [] })).toBe(false);
  });
});

describe("pickCompanyTodayCompany", () => {
  it("prefers the picked one, then the sidebar's linked company, then any linked, then the first", () => {
    expect(pickCompanyTodayCompany(status, null, "hub-a")).toBe("hub-a");
    expect(pickCompanyTodayCompany(status, null, "gone")).toBe("hub-b");
    expect(
      pickCompanyTodayCompany({ ...status, links: { x: "hub-a", y: "hub-b" } }, "y", null),
    ).toBe("hub-b");
    expect(pickCompanyTodayCompany(status, "personal", null)).toBe("hub-b");
    expect(pickCompanyTodayCompany({ ...status, links: {} }, null, null)).toBe("hub-a");
    expect(pickCompanyTodayCompany({ ...status, links: { z: "left-company" } }, "z", null)).toBe(
      "hub-a",
    );
    expect(pickCompanyTodayCompany({ companies: [], links: {} }, null, null)).toBeNull();
  });

  it("finds the local company linked to a hub company", () => {
    expect(localCompanyOf({ b: "hub-b", a: "hub-b", c: "hub-c" }, "hub-b")).toBe("a");
    expect(localCompanyOf({ b: "hub-b" }, "hub-a")).toBeNull();
  });
});

describe("hubAppUrl", () => {
  it("is the hub's own /app address over https or loopback http", () => {
    expect(hubAppUrl("https://zenhub.zed-zen.com")).toBe("https://zenhub.zed-zen.com/app");
    expect(hubAppUrl("https://zenhub.zed-zen.com/")).toBe("https://zenhub.zed-zen.com/app");
    expect(hubAppUrl("https://example.com/hub/")).toBe("https://example.com/hub/app");
    expect(hubAppUrl("http://localhost:8787")).toBe("http://localhost:8787/app");
    expect(hubAppUrl("http://zenhub.zed-zen.com")).toBeNull();
    expect(hubAppUrl("https://user:pw@hub.example.com")).toBeNull();
    expect(hubAppUrl("javascript:alert(1)")).toBeNull();
    expect(hubAppUrl("not a url")).toBeNull();
    expect(hubAppUrl(null)).toBeNull();
  });

  it("opens only that exact address", () => {
    const hub = "https://zenhub.zed-zen.com";
    expect(isHubAppUrl("https://zenhub.zed-zen.com/app", hub)).toBe(true);
    expect(isHubAppUrl("https://zenhub.zed-zen.com/app/../v1", hub)).toBe(false);
    expect(isHubAppUrl("https://evil.example/app", hub)).toBe(false);
    expect(isHubAppUrl("https://zenhub.zed-zen.com/app", null)).toBe(false);
  });
});

describe("deriveCompanyToday", () => {
  it("adds up what waits for approval and links the first chat", () => {
    const view = deriveCompanyToday(sources());
    expect(view.approvals).toEqual({
      total: 5,
      chats: 1,
      firstChat: { environmentId: "env", threadId: "t1" },
      staff: 2,
      messages: 1,
      devices: 1,
    });
  });

  it("counts every chat when no local company is linked, and no staff approvals", () => {
    const view = deriveCompanyToday(sources({ localCompanyId: null, staff: undefined }));
    expect(view.approvals.chats).toBe(2);
    expect(view.approvals.staff).toBe(0);
    expect(view.staff).toBe("unlinked");
    expect(view.approvals.total).toBe(4);
  });

  it("counts devices only for someone who decides on this runner", () => {
    const view = deriveCompanyToday(
      sources({ trustedDevices: { canDecide: false, devices: [{ pending: true }] } }),
    );
    expect(view.approvals.devices).toBe(0);
  });

  it("keeps the total unknown until every source answered", () => {
    expect(deriveCompanyToday(sources({ messageApprovals: null })).approvals.total).toBeNull();
    expect(deriveCompanyToday(sources({ staff: null })).approvals.total).toBeNull();
    expect(deriveCompanyToday(sources({ trustedDevices: null })).approvals.total).toBeNull();
    expect(deriveCompanyToday(sources({ threads: null })).approvals.total).toBeNull();
  });

  it("orders AI staff by what needs attention and counts who works", () => {
    const view = deriveCompanyToday(sources());
    expect(view.staff).not.toBe("unlinked");
    const staff = view.staff as Exclude<typeof view.staff, "unlinked" | null>;
    expect(staff.agents.map((agent) => agent.name)).toEqual(["Bob", "Ana", "Cid", "Zed"]);
    expect(staff.working).toBe(2);
    expect(staff.total).toBe(4);
    expect(deriveCompanyToday(sources({ staff: null })).staff).toBeNull();
  });

  it("counts the person's devices online and finds the company server", () => {
    const view = deriveCompanyToday(sources());
    expect(view.devices).toEqual({ online: 2, total: 3 });
    expect(view.runner).toEqual({ name: "Office PC", online: true });
    const { environments: _dropped, ...withoutEnvironments } = status;
    const older = deriveCompanyToday(sources({ status: withoutEnvironments }));
    expect(older.devices).toBeNull();
    expect(deriveCompanyToday(sources({ runners: [] })).runner).toBe("none");
    expect(deriveCompanyToday(sources({ runners: null })).runner).toBeNull();
    expect(
      deriveCompanyToday(sources({ runners: [{ name: "Old laptop", online: false }] })).runner,
    ).toEqual({ name: "Old laptop", online: false });
  });

  it("lists packs that failed to install, with the machine and the error", () => {
    const view = deriveCompanyToday(sources());
    expect(view.packIssues).toEqual([
      { key: "seo:e1", packId: "seo", machine: "PC", person: "Ana", error: "No disk" },
      { key: "ads:e2", packId: "ads", machine: "Mac", person: "Bob", error: null },
    ]);
    expect(deriveCompanyToday(sources({ packStatus: null })).packIssues).toBeNull();
    expect(view.appUrl).toBe("https://zenhub.zed-zen.com/app");
  });
});

describe("companyTodayText", () => {
  it("has every string in Romanian", () => {
    const en = zenMessagesFor(companyTodayText, "en");
    const ro = companyTodayText.ro as Record<string, unknown>;
    for (const key of Object.keys(en)) expect(ro[key], key).toBeDefined();
    expect(zenMessagesFor(companyTodayText, "ro").title).toBe("Firma ta azi");
    expect(en.title).toBe("Your company today");
  });
});
