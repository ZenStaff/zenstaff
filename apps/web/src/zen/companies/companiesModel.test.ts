import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { ZenCompaniesListResult, ZenCompany } from "@t3tools/contracts/zenCompanies";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCompanyIndex,
  companyOfProject,
  companyOfThread,
  companySettledShelfScope,
  companyTagForNewThread,
  effectiveCompanyId,
  filterProjectGroupsByCompany,
  filterThreadsByCompany,
  sharedCompanyOf,
  THREAD_CREATE_COMMAND_LABEL,
  THREAD_START_TURN_COMMAND_LABEL,
  threadCreatedByCommand,
} from "./companiesModel";

const LOCAL = "env-local" as EnvironmentId;
const REMOTE = "env-remote" as EnvironmentId;
const project = (id: string) => id as ProjectId;

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

const list = (
  companies: ReadonlyArray<ZenCompany>,
  assignments: Record<string, string>,
  threadTags: Record<string, string> = {},
): ZenCompaniesListResult => ({
  companies,
  projectCompanies: Object.entries(assignments).map(([projectId, companyId]) => ({
    projectId: project(projectId),
    companyId,
  })),
  threadCompanies: Object.entries(threadTags).map(([threadId, companyId]) => ({
    threadId: threadId as ThreadId,
    companyId,
  })),
  defaultCompanyId: "personal",
});

const personal = company("personal", "Personal", true);
const acme = company("acme", "Acme");
const beta = company("beta", "Beta");

const index = buildCompanyIndex([
  { environmentId: LOCAL, data: list([personal, beta, acme], { p1: "acme", p2: "beta" }) },
  { environmentId: REMOTE, data: list([personal, acme], { p1: "acme", r9: "acme" }) },
]);

describe("buildCompanyIndex", () => {
  it("merges companies by id, Personal first, then by name", () => {
    expect(index.companies.map((entry) => entry.id)).toEqual(["personal", "acme", "beta"]);
    expect(index.ready).toBe(true);
  });

  it("keeps assignments per environment; unassigned projects are Personal", () => {
    expect(companyOfProject(index, LOCAL, "p1")).toBe("acme");
    expect(companyOfProject(index, LOCAL, "p2")).toBe("beta");
    expect(companyOfProject(index, REMOTE, "p2")).toBe("personal");
    expect(companyOfProject(index, REMOTE, "r9")).toBe("acme");
  });

  it("is not ready until every environment answered", () => {
    const partial = buildCompanyIndex([
      { environmentId: LOCAL, data: list([personal, acme], {}) },
      { environmentId: REMOTE, data: null },
    ]);
    expect(partial.ready).toBe(false);
    expect(effectiveCompanyId("beta", partial)).toBe("beta");
    expect(effectiveCompanyId("beta", index)).toBe("beta");
    expect(effectiveCompanyId("gone", index)).toBeNull();
    expect(effectiveCompanyId(null, index)).toBeNull();
  });
});

describe("filters", () => {
  const threads = [
    { id: "t1", environmentId: LOCAL, projectId: "p1" },
    { id: "t2", environmentId: LOCAL, projectId: "p2" },
    { id: "t3", environmentId: LOCAL, projectId: "p3" },
    { id: "t4", environmentId: REMOTE, projectId: "r9" },
  ];

  it("returns the same list for all companies", () => {
    expect(filterThreadsByCompany(threads, null, index)).toBe(threads);
  });

  it("keeps the company's threads across environments", () => {
    expect(filterThreadsByCompany(threads, "acme", index).map((thread) => thread.id)).toEqual([
      "t1",
      "t4",
    ]);
    expect(filterThreadsByCompany(threads, "personal", index).map((thread) => thread.id)).toEqual([
      "t3",
    ]);
  });

  it("keeps a grouped project when any member belongs to the company", () => {
    const groups = [
      {
        key: "g1",
        memberProjectRefs: [
          { environmentId: LOCAL, projectId: "p3" },
          { environmentId: REMOTE, projectId: "r9" },
        ],
      },
      { key: "g2", memberProjectRefs: [{ environmentId: LOCAL, projectId: "p2" }] },
    ];
    expect(filterProjectGroupsByCompany(groups, "acme", index).map((group) => group.key)).toEqual([
      "g1",
    ]);
    expect(
      filterProjectGroupsByCompany(groups, "personal", index).map((group) => group.key),
    ).toEqual(["g1"]);
    expect(filterProjectGroupsByCompany(groups, null, index)).toBe(groups);
  });

  it("reports a shared company only when all members agree", () => {
    expect(
      sharedCompanyOf(
        [
          { environmentId: LOCAL, id: "p1" },
          { environmentId: REMOTE, id: "p1" },
        ],
        index,
      ),
    ).toBe("acme");
    expect(
      sharedCompanyOf(
        [
          { environmentId: LOCAL, id: "p1" },
          { environmentId: LOCAL, id: "p2" },
        ],
        index,
      ),
    ).toBeNull();
  });
});

describe("No project chats per company", () => {
  // "scratch" is each machine's No project home; nobody assigns it to a company.
  const tagged = buildCompanyIndex([
    {
      environmentId: LOCAL,
      data: list([personal, acme, beta], { p1: "acme" }, { "s-acme": "acme", "s-gone": "gone" }),
    },
    // The remote machine (a company server) has no "beta" company of its own; its tag still counts.
    { environmentId: REMOTE, data: list([personal], {}, { "r-beta": "beta", "p1-beta": "beta" }) },
  ]);
  const threads = [
    { id: "s-acme", environmentId: LOCAL, projectId: "scratch" },
    { id: "s-plain", environmentId: LOCAL, projectId: "scratch" },
    { id: "s-gone", environmentId: LOCAL, projectId: "scratch" },
    { id: "r-beta", environmentId: REMOTE, projectId: "scratch" },
    { id: "r-plain", environmentId: REMOTE, projectId: "scratch" },
    { id: "p1-acme", environmentId: LOCAL, projectId: "p1" },
    // Tags are per machine: the same id on the other machine is a different thread.
    { id: "s-acme", environmentId: REMOTE, projectId: "scratch" },
  ];
  const ids = (companyId: string | null) =>
    filterThreadsByCompany(threads, companyId, tagged).map(
      (thread) => `${thread.environmentId}/${thread.id}`,
    );

  it("shows a chat started under a company in that company only, on any machine", () => {
    expect(ids("acme")).toEqual(["env-local/s-acme", "env-local/p1-acme"]);
    expect(ids("beta")).toEqual(["env-remote/r-beta"]);
  });

  it("keeps untagged No project chats, and tags of unknown companies, in Personal", () => {
    expect(ids("personal")).toEqual([
      "env-local/s-plain",
      "env-local/s-gone",
      "env-remote/r-plain",
      "env-remote/s-acme",
    ]);
  });

  it("shows everything for all companies", () => {
    expect(ids(null)).toHaveLength(threads.length);
  });

  it("keeps the No project home in every company, so folder mode can list its chats", () => {
    const groups = [
      { key: "scratch", isScratch: true as const, memberProjectRefs: [] },
      { key: "p1", memberProjectRefs: [{ environmentId: LOCAL, projectId: "p1" }] },
    ];
    expect(filterProjectGroupsByCompany(groups, "beta", tagged).map((g) => g.key)).toEqual([
      "scratch",
    ]);
    expect(filterProjectGroupsByCompany(groups, "acme", tagged).map((g) => g.key)).toEqual([
      "scratch",
      "p1",
    ]);
  });

  it("lets a project's company win over a thread tag", () => {
    const index = buildCompanyIndex([
      { environmentId: LOCAL, data: list([personal, acme, beta], { p1: "acme" }, { t: "beta" }) },
    ]);
    expect(companyOfThread(index, { id: "t", environmentId: LOCAL, projectId: "p1" })).toBe("acme");
    expect(companyOfThread(index, { id: "t", environmentId: LOCAL, projectId: "scratch" })).toBe(
      "beta",
    );
  });

  it("keeps a tag while the companies are still loading, so the list does not jump", () => {
    const loading = buildCompanyIndex([
      { environmentId: LOCAL, data: list([personal], {}, { t: "acme" }) },
      { environmentId: REMOTE, data: null },
    ]);
    expect(companyOfThread(loading, { id: "t", environmentId: LOCAL, projectId: "scratch" })).toBe(
      "acme",
    );
  });

  it("reads servers that send no thread tags (before 0.2.7)", () => {
    const old = buildCompanyIndex([
      {
        environmentId: LOCAL,
        data: { companies: [personal, acme], projectCompanies: [], defaultCompanyId: "personal" },
      },
    ]);
    expect(companyOfThread(old, { id: "t", environmentId: LOCAL, projectId: "scratch" })).toBe(
      "personal",
    );
  });
});

describe("companySettledShelfScope", () => {
  const groups = [
    {
      isScratch: true as const,
      memberProjectRefs: [
        { environmentId: LOCAL, projectId: "scratch" },
        { environmentId: REMOTE, projectId: "scratch-r" },
      ],
    },
    {
      memberProjectRefs: [
        { environmentId: LOCAL, projectId: "p1" },
        { environmentId: REMOTE, projectId: "p1" },
      ],
    },
    { memberProjectRefs: [{ environmentId: LOCAL, projectId: "p2" }] },
    { memberProjectRefs: [{ environmentId: LOCAL, projectId: "p3" }] },
  ];
  const keys = (set: ReadonlySet<string> | null) => (set === null ? null : [...set].toSorted());

  it("reads every project for all companies", () => {
    const scope = companySettledShelfScope(groups, null, index);
    expect(scope.projectKeys).toBeNull();
    expect(scope.uncounted.size).toBe(0);
  });

  it("reads only the company's projects plus the No project homes, which it does not count", () => {
    const scope = companySettledShelfScope(groups, "acme", index);
    expect(keys(scope.projectKeys)).toEqual([
      "env-local:p1",
      "env-local:scratch",
      "env-remote:p1",
      "env-remote:scratch-r",
    ]);
    expect(keys(scope.uncounted)).toEqual(["env-local:scratch", "env-remote:scratch-r"]);
  });

  it("counts the No project homes for Personal, where their chats live", () => {
    const scope = companySettledShelfScope(groups, "personal", index);
    expect(keys(scope.projectKeys)).toEqual([
      "env-local:p3",
      "env-local:scratch",
      "env-remote:scratch-r",
    ]);
    expect(scope.uncounted.size).toBe(0);
  });
});

describe("tagging new chats", () => {
  it("tags only No project chats started while a company other than Personal is chosen", () => {
    expect(companyTagForNewThread({ selectedCompanyId: "acme", projectIsScratch: true })).toBe(
      "acme",
    );
    expect(
      companyTagForNewThread({ selectedCompanyId: "acme", projectIsScratch: false }),
    ).toBeNull();
    expect(
      companyTagForNewThread({ selectedCompanyId: "personal", projectIsScratch: true }),
    ).toBeNull();
    expect(companyTagForNewThread({ selectedCompanyId: null, projectIsScratch: true })).toBeNull();
  });

  it("reads the new thread from thread.create and from a first turn with a bootstrap", () => {
    expect(
      threadCreatedByCommand(THREAD_CREATE_COMMAND_LABEL, { threadId: "t1", projectId: "p" }),
    ).toEqual({ threadId: "t1", projectId: "p" });
    expect(
      threadCreatedByCommand(THREAD_START_TURN_COMMAND_LABEL, {
        threadId: "t2",
        message: { text: "hi" },
        bootstrap: { createThread: { projectId: "scratch" } },
      }),
    ).toEqual({ threadId: "t2", projectId: "scratch" });
  });

  it("ignores turns in existing threads and other commands", () => {
    expect(
      threadCreatedByCommand(THREAD_START_TURN_COMMAND_LABEL, {
        threadId: "t2",
        message: { text: "again" },
      }),
    ).toBeNull();
    expect(
      threadCreatedByCommand("environment-data:commands:thread:archive", {
        threadId: "t3",
        projectId: "p",
      }),
    ).toBeNull();
    expect(threadCreatedByCommand(THREAD_CREATE_COMMAND_LABEL, undefined)).toBeNull();
  });
});
