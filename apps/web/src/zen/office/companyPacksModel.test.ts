import { describe, expect, it } from "vite-plus/test";

import { companyPacksText } from "./companyPacks.i18n";
import {
  companyPackControl,
  companyPackRows,
  companyPackSummary,
  type CompanyPacksView,
} from "./companyPacksModel";

const view = (role: CompanyPacksView["role"]): CompanyPacksView => ({
  companyId: "co_bistro",
  role,
  isRunner: false,
  packs: [
    {
      packId: "website-health",
      version: "1.2.0",
      enterprise: false,
      settings: {},
      updatedByName: "Alex",
      updatedAt: "2026-11-08T09:00:00.000Z",
      verified: true,
    },
    {
      packId: "meta-ads",
      version: "0.3.0",
      enterprise: true,
      settings: {},
      updatedByName: "Alex",
      updatedAt: "2026-11-08T09:00:00.000Z",
      verified: true,
    },
  ],
  refused: [],
  hidden: ["meta-ads"],
  status: [
    {
      packId: "website-health",
      environmentId: "e1",
      environmentName: "Laptop",
      userName: "Maria",
      state: "installed",
      version: "1.2.0",
      error: null,
      hidden: false,
      runner: false,
      updatedAt: "2026-11-08T09:01:00.000Z",
    },
    {
      packId: "website-health",
      environmentId: "e2",
      environmentName: "PC birou",
      userName: "Ion",
      state: "installed",
      version: "1.1.0",
      error: null,
      hidden: false,
      runner: false,
      updatedAt: "2026-11-08T09:01:00.000Z",
    },
    {
      packId: "website-health",
      environmentId: "e3",
      environmentName: "Server",
      userName: "Alex",
      state: "failed",
      version: null,
      error: "No space left",
      hidden: false,
      runner: true,
      updatedAt: "2026-11-08T09:01:00.000Z",
    },
    {
      packId: "meta-ads",
      environmentId: "e1",
      environmentName: "Laptop",
      userName: "Maria",
      state: "runner-only",
      version: null,
      error: null,
      hidden: true,
      runner: false,
      updatedAt: "2026-11-08T09:01:00.000Z",
    },
  ],
});

describe("company packs on the marketplace", () => {
  it("admins install for the company; a company pack can be hidden, not uninstalled", () => {
    expect(companyPackControl(view("admin"), "review-replies")).toMatchObject({
      managed: false,
      canInstall: true,
    });
    expect(companyPackControl(view("member"), "review-replies")).toMatchObject({
      managed: false,
      canInstall: false,
    });
    expect(companyPackControl(view("member"), "meta-ads")).toMatchObject({
      managed: true,
      enterprise: true,
      hidden: true,
      canRemove: false,
    });
    expect(companyPackControl(view("owner"), "website-health")).toMatchObject({
      managed: true,
      hidden: false,
      canRemove: true,
    });
    expect(companyPackControl(null, "website-health")).toMatchObject({
      managed: false,
      canInstall: false,
    });
  });

  it("lists problems first and flags computers on an older version", () => {
    const rows = companyPackRows(view("admin"), "website-health");
    expect(rows.map((row) => [row.person, row.state, row.behind])).toEqual([
      ["Alex", "failed", null],
      ["Ion", "installed", "1.1.0"],
      ["Maria", "installed", null],
    ]);
    expect(rows[0]!.runner).toBe(true);
    expect(companyPackSummary(view("admin"), "website-health")).toEqual({
      total: 3,
      installed: 1,
      failed: 1,
    });
  });

  it("has the same strings in both languages, Romanian with ș and ț (no cedillas)", () => {
    expect(Object.keys(companyPacksText.ro).toSorted()).toEqual(
      Object.keys(companyPacksText.en).toSorted(),
    );
    const all =
      JSON.stringify(companyPacksText.ro) +
      companyPacksText.ro.installForCompanyConfirm("Sănătatea site-ului", "Bistro");
    expect(all).not.toMatch(/[şţŞŢ]/);
    expect(companyPacksText.ro.installForCompany).toBe("Instalează pentru firmă");
    expect(companyPacksText.ro.states["runner-only"]).toBe("Doar pe serverul firmei");
  });
});
