import { describe, expect, it } from "vite-plus/test";

import { ZEN_NAV_MAX_PRIMARY, ZEN_NAV_ROUTES, zenNavLayout, zenNavPageForPath } from "./navModel";

describe("zenNavLayout", () => {
  it("keeps Office to five labeled pages and the rest in More", () => {
    const office = zenNavLayout("office");
    expect(office.primary).toEqual(["office", "staff", "marketplace", "academy", "hub"]);
    expect(office.more).toEqual(["connections", "chatIntegrations", "chatImport", "companies"]);
    // Developer pages never show in Office.
    expect([...office.primary, ...office.more]).not.toContain("terminalSessions");
    expect([...office.primary, ...office.more]).not.toContain("limits");
  });

  it("moves the Office home and the developer pages to More in Code", () => {
    const code = zenNavLayout("code");
    expect(code.primary).not.toContain("office");
    expect(code.more).toEqual(
      expect.arrayContaining(["office", "terminalSessions", "limits", "connections"]),
    );
  });

  it("lists every page once and never more primary rows than the limit", () => {
    for (const edition of ["office", "code"] as const) {
      const { primary, more } = zenNavLayout(edition);
      expect(primary.length).toBeLessThanOrEqual(ZEN_NAV_MAX_PRIMARY);
      const all = [...primary, ...more];
      expect(new Set(all).size).toBe(all.length);
    }
    const code = zenNavLayout("code");
    expect(new Set([...code.primary, ...code.more])).toEqual(new Set(Object.keys(ZEN_NAV_ROUTES)));
  });
});

describe("zenNavPageForPath", () => {
  it("marks the page a route belongs to", () => {
    expect(zenNavPageForPath("/office")).toBe("office");
    expect(zenNavPageForPath("/workflow-editor")).toBe("office");
    expect(zenNavPageForPath("/staff")).toBe("staff");
    expect(zenNavPageForPath("/academy")).toBe("academy");
    expect(zenNavPageForPath("/chat-integrations")).toBe("chatIntegrations");
    expect(zenNavPageForPath("/officer")).toBeNull();
    expect(zenNavPageForPath("/")).toBeNull();
  });
});
