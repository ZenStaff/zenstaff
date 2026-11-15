import { describe, expect, it } from "@effect/vitest";

import {
  MAX_THREAD_TAGS,
  assignProject,
  assignThread,
  companyOfProject,
  createCompany,
  deleteCompany,
  emptyState,
  memoryDirectoryForProject,
  normalizeState,
  resolveMemoryFilePath,
  slugify,
  toListResult,
  uniqueCompanyId,
  updateCompany,
} from "./companiesStore.ts";

const paths = { zenHome: "/home/alex/.zen", userHome: "/home/alex" };
const at = "2026-11-07T10:00:00.000Z";

const withCompany = (name: string, extra: { memoryDirectory?: string } = {}) => {
  const result = createCompany(emptyState(at), { name, ...extra }, paths, at);
  return result;
};

describe("companiesStore", () => {
  it("slugs names with diacritics and keeps ids unique", () => {
    expect(slugify("Livada Bunicii și Fiii SRL")).toBe("livada-bunicii-si-fiii-srl");
    expect(slugify("  !!! ")).toBe("company");
    expect(uniqueCompanyId("Acme", new Set(["acme", "acme-2"]))).toBe("acme-3");
    expect(uniqueCompanyId("Personal", new Set(["personal"]))).toBe("personal-2");
  });

  it("starts with Personal, which keeps Claude Code's own memory setting", () => {
    const state = emptyState(at);
    expect(state.companies.map((company) => company.id)).toEqual(["personal"]);
    expect(memoryDirectoryForProject(state, "project-1", paths)).toBeNull();
    const listed = toListResult(state, paths);
    expect(listed.companies[0]).toMatchObject({ isDefault: true, memoryDirectory: null });
  });

  it("gives a new company a default memory directory under the Zen home", () => {
    const { state, company } = withCompany("Acme Corp");
    expect(company.id).toBe("acme-corp");
    expect(company.memoryDirectory).toBeNull();
    const assigned = assignProject(state, "project-1", "acme-corp");
    expect(memoryDirectoryForProject(assigned, "project-1", paths)).toBe(
      "/home/alex/.zen/companies/acme-corp/memory",
    );
    expect(memoryDirectoryForProject(assigned, "project-2", paths)).toBeNull();
  });

  it("expands ~/ in a custom memory directory and refuses relative paths", () => {
    const { company } = withCompany("Beta", { memoryDirectory: "~/clients/beta/memory/" });
    expect(company.memoryDirectory).toBe("/home/alex/clients/beta/memory/");
    expect(() => withCompany("Gamma", { memoryDirectory: "memory" })).toThrow(/absolute/);
  });

  it("updates fields and returns to the default directory on an empty path", () => {
    const { state } = withCompany("Acme", { memoryDirectory: "/srv/acme" });
    const renamed = updateCompany(state, { id: "acme", name: "Acme SA", color: "#2563EB" }, paths);
    expect(renamed.company).toMatchObject({ id: "acme", name: "Acme SA", color: "#2563EB" });
    expect(renamed.company.memoryDirectory).toBe("/srv/acme");
    const reset = updateCompany(renamed.state, { id: "acme", memoryDirectory: "" }, paths);
    expect(reset.company.memoryDirectory).toBeNull();
    expect(() => updateCompany(state, { id: "missing", name: "X" }, paths)).toThrow(
      /no longer exists/,
    );
  });

  it("maps projects to companies; Personal assignments are not stored", () => {
    const { state } = withCompany("Acme");
    const assigned = assignProject(state, "p1", "acme");
    expect(assigned.projects).toEqual({ p1: "acme" });
    expect(companyOfProject(assigned, "p1").id).toBe("acme");
    expect(companyOfProject(assigned, "p2").id).toBe("personal");
    const back = assignProject(assigned, "p1", "personal");
    expect(back.projects).toEqual({});
    expect(() => assignProject(state, "p1", "nope")).toThrow(/no longer exists/);
  });

  it("returns a deleted company's projects to Personal and never deletes Personal", () => {
    const { state } = withCompany("Acme");
    const assigned = assignProject(assignProject(state, "p1", "acme"), "p2", "acme");
    const removed = deleteCompany(assigned, "acme");
    expect(removed.reassignedProjectCount).toBe(2);
    expect(removed.state.projects).toEqual({});
    expect(removed.state.companies.map((company) => company.id)).toEqual(["personal"]);
    expect(() => deleteCompany(state, "personal")).toThrow(/cannot be deleted/);
  });

  it("tags threads with a company, even one only another machine has; Personal clears it", () => {
    const { state } = withCompany("Acme");
    const tagged = assignThread(assignThread(state, "t1", "acme"), "t2", "horecaos");
    expect(tagged.threads).toEqual({ t1: "acme", t2: "horecaos" });
    expect(assignThread(tagged, "t1", "personal").threads).toEqual({ t2: "horecaos" });
    expect(() => assignThread(state, "t1", "Not A Slug")).toThrow(/not valid/);
    expect(toListResult(tagged, paths).threadCompanies).toEqual([
      { threadId: "t1", companyId: "acme" },
      { threadId: "t2", companyId: "horecaos" },
    ]);
    // Deleting a company clears its thread tags; the others stay.
    expect(deleteCompany(tagged, "acme").state.threads).toEqual({ t2: "horecaos" });
  });

  it("keeps only the newest thread tags past the cap", () => {
    let state = emptyState(at);
    const threads: Record<string, string> = {};
    for (let index = 0; index < MAX_THREAD_TAGS; index += 1) threads[`t${index}`] = "acme";
    state = { ...state, threads };
    const next = assignThread(state, "newest", "acme");
    expect(Object.keys(next.threads)).toHaveLength(MAX_THREAD_TAGS);
    expect(next.threads.newest).toBe("acme");
    expect(next.threads.t0).toBeUndefined();
  });

  it("repairs a loaded file: Personal is restored, dangling assignments dropped", () => {
    const repaired = normalizeState(
      {
        companies: [
          {
            id: "acme",
            name: "Acme",
            color: "#2563EB",
            icon: "building",
            memoryDirectory: null,
            createdAt: at,
          },
          {
            id: "acme",
            name: "Duplicate",
            color: "#2563EB",
            icon: "building",
            memoryDirectory: null,
            createdAt: at,
          },
        ],
        projects: { p1: "acme", p2: "gone", p3: "personal" },
        threads: { t1: "acme", t2: "other-machine", t3: "personal", t4: "Bad Id" },
      },
      at,
    );
    expect(repaired.companies.map((company) => company.name)).toEqual(["Personal", "Acme"]);
    expect(repaired.projects).toEqual({ p1: "acme" });
    expect(repaired.threads).toEqual({ t1: "acme", t2: "other-machine" });
    // Files written before thread tags existed have none.
    expect(normalizeState({ companies: [], projects: {} }, at).threads).toEqual({});
  });

  it("only resolves markdown files inside the memory directory", () => {
    expect(resolveMemoryFilePath("/m", "MEMORY.md")).toBe("/m/MEMORY.md");
    expect(resolveMemoryFilePath("/m", "notes/a.md")).toBe("/m/notes/a.md");
    expect(resolveMemoryFilePath("/m", "../secret.md")).toBeNull();
    expect(resolveMemoryFilePath("/m", "/etc/passwd.md")).toBeNull();
    expect(resolveMemoryFilePath("/m", "a.txt")).toBeNull();
  });
});
