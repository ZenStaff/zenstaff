import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ZenCompaniesListResult, ZenCompany } from "@t3tools/contracts/zenCompanies";
import { describe, expect, it } from "vite-plus/test";

import { buildCompanyIndex } from "../companies/companiesModel";
import {
  buildPinnedProjectChips,
  nextScopeForChip,
  orderPinnedProjects,
  pinTimeOf,
  reorderPinnedKeys,
  visibleChipCount,
  type PinnableProjectGroup,
  type PinnedStripThread,
} from "./pinnedProjectsModel";

const LOCAL = "env-local" as EnvironmentId;
const REMOTE = "env-remote" as EnvironmentId;

const group = (
  key: string,
  options: {
    pinnedAt?: ReadonlyArray<string | null>;
    archived?: boolean;
    refs?: ReadonlyArray<[string, string]>;
    name?: string;
  } = {},
): PinnableProjectGroup => {
  const pinnedAt = options.pinnedAt ?? [null];
  return {
    projectKey: key,
    displayName: options.name ?? key.toUpperCase(),
    pinned: pinnedAt.some((value) => value !== null),
    archived: options.archived ?? false,
    memberProjects: pinnedAt.map((value) => ({ pinnedAt: value })),
    memberProjectRefs: (options.refs ?? [[LOCAL, key]]).map(([environmentId, projectId]) => ({
      environmentId,
      projectId,
    })),
  };
};

type Thread = PinnedStripThread & { readonly working?: boolean };
let threadSeq = 0;
const thread = (
  projectId: string,
  options: { env?: string; settled?: boolean; archived?: boolean; working?: boolean } = {},
): Thread => ({
  environmentId: options.env ?? LOCAL,
  id: `t${(threadSeq += 1)}`,
  projectId,
  archivedAt: options.archived ? "2026-11-07T00:00:00.000Z" : null,
  settledOverride: options.settled ? "settled" : null,
  working: options.working ?? false,
});
const isWorking = (entry: Thread) => entry.working === true;

const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-02T10:00:00.000Z";
const T3 = "2026-11-03T10:00:00.000Z";

describe("pinTimeOf", () => {
  it("takes the earliest pin among checkouts and ignores unpinned ones", () => {
    expect(pinTimeOf(group("a", { pinnedAt: [T3, null, T2] }))).toBe(Date.parse(T2));
    expect(pinTimeOf(group("a"))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("orderPinnedProjects", () => {
  const groups = [
    group("c", { pinnedAt: [T3] }),
    group("u"),
    group("a", { pinnedAt: [T1] }),
    group("arch", { pinnedAt: [T1], archived: true }),
    group("b", { pinnedAt: [T2] }),
  ];

  it("keeps pinned, open groups, oldest pin first", () => {
    expect(orderPinnedProjects(groups, []).map((entry) => entry.projectKey)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("puts dragged keys first in their order, the rest by pin time", () => {
    expect(orderPinnedProjects(groups, ["c", "gone"]).map((entry) => entry.projectKey)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("breaks pin-time ties by name", () => {
    const tied = [
      group("y", { pinnedAt: [T1], name: "Zeta" }),
      group("x", { pinnedAt: [T1], name: "Alpha" }),
    ];
    expect(orderPinnedProjects(tied, []).map((entry) => entry.displayName)).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });
});

describe("reorderPinnedKeys", () => {
  it("moves a key to the target's position", () => {
    expect(reorderPinnedKeys(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(reorderPinnedKeys(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("ignores unknown keys and self drops", () => {
    expect(reorderPinnedKeys(["a", "b"], "z", "a")).toEqual(["a", "b"]);
    expect(reorderPinnedKeys(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});

describe("buildPinnedProjectChips", () => {
  const groups = [
    group("a", {
      pinnedAt: [T1],
      refs: [
        [LOCAL, "a"],
        [REMOTE, "a2"],
      ],
    }),
    group("b", { pinnedAt: [T2] }),
    group("c"),
  ];
  const threads = [
    thread("a"),
    thread("a", { working: true }),
    thread("a2", { env: REMOTE, working: true }),
    thread("a", { settled: true }),
    thread("a", { archived: true }),
    thread("b", { settled: true }),
    thread("c"),
  ];

  it("counts open and working threads across a group's checkouts", () => {
    const chips = buildPinnedProjectChips({
      groups,
      threads,
      customOrder: [],
      scopeKeys: ["b"],
      isWorking,
    });
    expect(
      chips.map(({ projectKey, openCount, workingCount, selected }) => ({
        projectKey,
        openCount,
        workingCount,
        selected,
      })),
    ).toEqual([
      { projectKey: "a", openCount: 3, workingCount: 2, selected: false },
      { projectKey: "b", openCount: 0, workingCount: 0, selected: true },
    ]);
  });

  it("is empty when nothing is pinned", () => {
    expect(
      buildPinnedProjectChips({
        groups: [group("c")],
        threads,
        customOrder: [],
        scopeKeys: [],
        isWorking,
      }),
    ).toEqual([]);
  });
});

describe("buildPinnedProjectChips with a company", () => {
  const company = (id: string, isDefault = false): ZenCompany => ({
    id,
    name: id,
    color: "#2563EB",
    icon: "building",
    memoryDirectory: null,
    customMemoryDirectory: null,
    isDefault,
    createdAt: "2026-11-07T10:00:00.000Z",
  });
  const list = (assignments: Record<string, string>): ZenCompaniesListResult => ({
    companies: [company("personal", true), company("acme"), company("beta")],
    projectCompanies: Object.entries(assignments).map(([projectId, companyId]) => ({
      projectId: projectId as ProjectId,
      companyId,
    })),
    defaultCompanyId: "personal",
  });
  const index = buildCompanyIndex([
    { environmentId: LOCAL, data: list({ a: "acme", b: "beta" }) },
    { environmentId: REMOTE, data: list({ m: "acme" }) },
  ]);
  const groups = [
    group("a", { pinnedAt: [T1] }),
    group("b", { pinnedAt: [T2] }),
    group("p", { pinnedAt: [T3] }),
    // One checkout in Acme (remote), one Personal (local): the group stays under Acme.
    group("m", {
      pinnedAt: [T3, null],
      refs: [
        [REMOTE, "m"],
        [LOCAL, "m"],
      ],
    }),
  ];
  const threads = [thread("a"), thread("b"), thread("m", { env: REMOTE }), thread("m")];
  const keysFor = (companyId: string | null) =>
    buildPinnedProjectChips({
      groups,
      threads,
      customOrder: [],
      scopeKeys: [],
      isWorking,
      company: { companyId, index },
    }).map((chip) => `${chip.projectKey}:${chip.openCount}`);

  it("shows only the selected company's pinned projects and threads", () => {
    expect(keysFor("acme")).toEqual(["a:1", "m:1"]);
    expect(keysFor("beta")).toEqual(["b:1"]);
    expect(keysFor("personal")).toEqual(["m:1", "p:0"]);
  });

  it("shows every pinned project for all companies", () => {
    expect(keysFor(null)).toEqual(["a:1", "b:1", "m:2", "p:0"]);
  });
});

describe("nextScopeForChip", () => {
  it("scopes to the chip, and a second click clears", () => {
    expect(nextScopeForChip([], "a", false)).toEqual(["a"]);
    expect(nextScopeForChip(["b"], "a", false)).toEqual(["a"]);
    expect(nextScopeForChip(["a"], "a", false)).toEqual([]);
    expect(nextScopeForChip(["a", "b"], "a", false)).toEqual(["a"]);
  });

  it("Shift+click adds or removes the chip", () => {
    expect(nextScopeForChip(["b"], "a", true)).toEqual(["b", "a"]);
    expect(nextScopeForChip(["a", "b"], "a", true)).toEqual(["b"]);
  });
});

describe("visibleChipCount", () => {
  it("shows every chip when they fit", () => {
    expect(
      visibleChipCount({ chipWidths: [50, 50, 50], available: 158, gap: 4, overflowWidth: 30 }),
    ).toBe(3);
  });

  it("keeps room for +N when they do not", () => {
    // 30 (+N) + 4 + 50 + 4 + 50 = 138 fits in 150; a third chip does not.
    expect(
      visibleChipCount({ chipWidths: [50, 50, 50], available: 150, gap: 4, overflowWidth: 30 }),
    ).toBe(2);
  });

  it("always shows at least one chip", () => {
    expect(
      visibleChipCount({ chipWidths: [120, 50], available: 60, gap: 4, overflowWidth: 30 }),
    ).toBe(1);
    expect(visibleChipCount({ chipWidths: [], available: 60, gap: 4, overflowWidth: 30 })).toBe(0);
  });
});
