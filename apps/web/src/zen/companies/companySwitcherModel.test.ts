import type { ZenCompany } from "@t3tools/contracts/zenCompanies";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSwitcherRows,
  normalizeCompanyName,
  shownCompanyName,
  type SwitcherHubCompany,
  type SwitcherRow,
} from "./companySwitcherModel";

const company = (id: string, name: string, isDefault = false): ZenCompany => ({
  id,
  name,
  color: "#2563EB",
  icon: "building",
  memoryDirectory: isDefault ? null : `/zen/companies/${id}/memory`,
  customMemoryDirectory: null,
  isDefault,
  createdAt: "2026-11-07T10:00:00.000Z",
});

const hub = (id: string, name: string, role = "owner"): SwitcherHubCompany => ({ id, name, role });

const personal = company("personal", "Personal", true);

const summary = (rows: ReadonlyArray<SwitcherRow>) =>
  rows.map((row) =>
    row.kind === "hub-only"
      ? `hub-only:${row.hubCompany.name}`
      : row.kind === "matched"
        ? `matched:${row.company.id}~${row.hubCompany.id}${row.canLink ? "" : ":no-link"}`
        : row.kind === "linked"
          ? `linked:${row.company.id}=${row.hubCompany.id}`
          : `local:${row.company.id}`,
  );

describe("buildSwitcherRows", () => {
  it("shows only local companies when not signed in, even with stale links", () => {
    const rows = buildSwitcherRows({
      localCompanies: [personal, company("zedzen", "ZEDZEN"), company("as", "as")],
      links: { zedzen: "h-zedzen" },
      hubCompanies: [hub("h-zedzen", "ZEDZEN"), hub("h-mz", "Meniul Zilei")],
      signedIn: false,
    });
    expect(summary(rows)).toEqual(["local:personal", "local:as", "local:zedzen"]);
  });

  it("marks a local company linked to a hub company the person belongs to", () => {
    const rows = buildSwitcherRows({
      localCompanies: [personal, company("zedzen", "ZEDZEN")],
      links: { zedzen: "h-zedzen" },
      hubCompanies: [hub("h-zedzen", "ZEDZEN")],
      signedIn: true,
    });
    expect(summary(rows)).toEqual(["local:personal", "linked:zedzen=h-zedzen"]);
  });

  it("lists hub companies with no local company and no same-name match", () => {
    const rows = buildSwitcherRows({
      localCompanies: [personal],
      links: {},
      hubCompanies: [hub("h-mz", "Meniul Zilei"), hub("h-horeca", "HoReCaOS")],
      signedIn: true,
    });
    expect(summary(rows)).toEqual(["local:personal", "hub-only:HoReCaOS", "hub-only:Meniul Zilei"]);
    expect(rows[1]).toMatchObject({ key: "hub:h-horeca" });
  });

  it("shows ONE row for an unlinked same-name local company (case and diacritics), never two", () => {
    const rows = buildSwitcherRows({
      localCompanies: [
        personal,
        company("zedzen", "ZedZen"),
        company("romania-transparenta", "romania  transparenta"),
      ],
      links: {},
      hubCompanies: [hub("h-zedzen", "ZEDZEN"), hub("h-rt", "România Transparentă")],
      signedIn: true,
    });
    expect(summary(rows)).toEqual([
      "local:personal",
      "matched:romania-transparenta~h-rt",
      "matched:zedzen~h-zedzen",
    ]);
  });

  it("merges Alex's switcher: five hub companies and the same five local ones, one row each", () => {
    const names = ["HoReCaOS", "Meniul Zilei", "Romania Transparenta", "ZEDZEN", "Zen Staff"];
    const local = ["HoReCaOS", "Meniul Zilei", "România Transparentă", "ZEDZEN", "Zen Staff"];
    const rows = buildSwitcherRows({
      localCompanies: [
        personal,
        company("as", "as"),
        ...local.map((name, index) => company(`l${index}`, name)),
      ],
      links: { l3: "h3" },
      hubCompanies: names.map((name, index) =>
        hub(`h${index}`, name, index === 1 ? "member" : "owner"),
      ),
      signedIn: true,
    });
    expect(summary(rows)).toEqual([
      "local:personal",
      "matched:l0~h0",
      "matched:l1~h1:no-link",
      "matched:l2~h2",
      "linked:l3=h3",
      "matched:l4~h4",
      "local:as",
    ]);
    const names2 = rows.map((row) =>
      row.kind === "hub-only" ? row.hubCompany.name : row.company.name,
    );
    expect(new Set(names2.map(normalizeCompanyName)).size).toBe(names2.length);
  });

  it("never matches Personal, an already linked company, or one local company to two hub companies", () => {
    const rows = buildSwitcherRows({
      localCompanies: [personal, company("acme", "Acme"), company("zen", "Zen Staff")],
      links: { zen: "h-zen" },
      hubCompanies: [
        hub("h-personal", "Personal"),
        hub("h-zen", "Zen Staff"),
        hub("h-zen-2", "Zen Staff"),
        hub("h-acme-1", "ACME"),
        hub("h-acme-2", "Acme"),
      ],
      signedIn: true,
    });
    const hubRows = rows.filter((row) => row.kind === "hub-only" || row.kind === "matched");
    const matches = hubRows
      .map((row) => [row.hubCompany.id, row.kind === "matched" ? row.company.id : null])
      .toSorted((left, right) => String(left[0]).localeCompare(String(right[0])));
    expect(matches).toEqual([
      ["h-acme-1", "acme"],
      ["h-acme-2", null],
      ["h-personal", null],
      ["h-zen-2", null],
    ]);
  });

  it("keeps companies that exist only on this machine as local", () => {
    const rows = buildSwitcherRows({
      localCompanies: [company("as", "as"), personal],
      links: {},
      hubCompanies: [],
      signedIn: true,
    });
    expect(summary(rows)).toEqual(["local:personal", "local:as"]);
  });

  it("turns a removed or left hub company back into a local one and drops its hub row", () => {
    const before = buildSwitcherRows({
      localCompanies: [personal, company("zedzen", "ZEDZEN")],
      links: { zedzen: "h-zedzen" },
      hubCompanies: [hub("h-zedzen", "ZEDZEN"), hub("h-mz", "Meniul Zilei")],
      signedIn: true,
    });
    expect(summary(before)).toEqual([
      "local:personal",
      "hub-only:Meniul Zilei",
      "linked:zedzen=h-zedzen",
    ]);
    const after = buildSwitcherRows({
      localCompanies: [personal, company("zedzen", "ZEDZEN")],
      links: { zedzen: "h-zedzen" },
      hubCompanies: [],
      signedIn: true,
    });
    expect(summary(after)).toEqual(["local:personal", "local:zedzen"]);
  });
});

describe("normalizeCompanyName", () => {
  it("folds case, diacritics (comma and cedilla) and spacing", () => {
    expect(normalizeCompanyName("  Ștefan  Țară ")).toBe("stefan tara");
    expect(normalizeCompanyName("Ştefan Ţară")).toBe("stefan tara");
  });
});

describe("shownCompanyName (review P1-5: one company, one name)", () => {
  it("shows the team's name for a linked company and the local name otherwise", () => {
    const casa = company("casa", "Casa Verde");
    const other = company("salon", "Salon Iris");
    const rows = buildSwitcherRows({
      localCompanies: [personal, casa, other],
      links: { casa: "h-iris" },
      hubCompanies: [hub("h-iris", "Florăria Iris")],
      signedIn: true,
    });
    expect(shownCompanyName(rows, casa)).toBe("Florăria Iris");
    expect(shownCompanyName(rows, other)).toBe("Salon Iris");
  });
});
