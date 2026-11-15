import { zenHubAccessOfRole, type ZenHubAccess } from "@t3tools/contracts/zenHub";
import type { StaffAgent, StaffOverview } from "@t3tools/contracts/zenStaff";
import { describe, expect, it } from "vite-plus/test";

import { staffHubText } from "./staffHub.i18n";
import {
  canDeleteStaffAgent,
  canEditStaffAgent,
  canGiveStaffTask,
  canPublishStaffAgent,
} from "./StaffHubControls";

const hubLink = (managerUserId: string | null): NonNullable<StaffAgent["hub"]> => ({
  companyId: "co_bistro",
  staffId: "s-1",
  version: 3,
  managerUserId,
  updatedBy: "Alex",
  updatedAt: "2026-11-08T09:00:00.000Z",
  source: "mirror",
});

const overview = (role: "owner" | "admin" | "member" | "guest" | null, myUserId = "u_maria") =>
  ({
    hub:
      role === null
        ? null
        : {
            hubCompanyId: "co_bistro",
            role,
            myUserId,
            canAdminister: role === "owner" || role === "admin",
            syncedAt: null,
            problem: null,
            refused: [],
          },
  }) as unknown as StaffOverview;

const agent = (hub: StaffAgent["hub"]) =>
  ({ id: "a", name: "Ioana", ...(hub ? { hub } : {}) }) as unknown as StaffAgent;

describe("company AI staff on the AI staff page", () => {
  it("owners and admins publish, edit and delete; the manager edits; other members only give tasks", () => {
    expect(canPublishStaffAgent(overview("admin"), agent(undefined))).toBe(true);
    expect(canPublishStaffAgent(overview("member"), agent(undefined))).toBe(false);
    expect(canPublishStaffAgent(overview(null), agent(undefined))).toBe(false);
    expect(canPublishStaffAgent(overview("owner"), agent(hubLink(null)))).toBe(false);
    expect(canEditStaffAgent(overview("owner"), agent(hubLink(null)))).toBe(true);
    expect(canEditStaffAgent(overview("member"), agent(hubLink("u_maria")))).toBe(true);
    expect(canEditStaffAgent(overview("member"), agent(hubLink("u_ion")))).toBe(false);
    expect(canEditStaffAgent(overview(null), agent(hubLink("u_maria")))).toBe(false);
    expect(canDeleteStaffAgent(overview("member"), agent(hubLink("u_maria")))).toBe(false);
    expect(canDeleteStaffAgent(overview("admin"), agent(hubLink("u_maria")))).toBe(true);
    // A local agent stays editable as before.
    expect(canEditStaffAgent(overview(null), agent(undefined))).toBe(true);
  });

  it("hub v9: disables giving a task to a company agent for roles without angajati:creeaza", () => {
    const custom = (permissions: ReadonlyArray<string>): ZenHubAccess => ({
      ...zenHubAccessOfRole("member"),
      permissions,
    });
    const company = agent(hubLink(null));
    // "Contabilitate": sees the AI staff, gives them nothing.
    expect(canGiveStaffTask(overview("member"), company, custom(["angajati:vede"]))).toBe(false);
    expect(
      canGiveStaffTask(overview("member"), company, custom(["angajati:vede", "angajati:creeaza"])),
    ).toBe(true);
    // Guests never; owners and admins always; an older hub (no access): the built-in role.
    expect(canGiveStaffTask(overview("guest"), company, null)).toBe(false);
    expect(canGiveStaffTask(overview("owner"), company, zenHubAccessOfRole("owner"))).toBe(true);
    expect(canGiveStaffTask(overview("member"), company, null)).toBe(true);
    // A local agent, or a role this machine does not know yet: the server decides.
    expect(canGiveStaffTask(overview("member"), agent(undefined), custom([]))).toBe(true);
    expect(canGiveStaffTask(overview(null), company, custom([]))).toBe(true);
    expect(staffHubText.ro.noTaskPermission).toContain("Angajați AI: creează");
    expect(staffHubText.en.noTaskPermission).toContain("AI staff: create");
  });

  it("hub v9: a project-scoped role gives tasks to and manages only that project's agents", () => {
    const scoped = (grants: ReadonlyArray<[string, string]>): ZenHubAccess => ({
      ...zenHubAccessOfRole("member"),
      permissions: ["angajati:vede"],
      scoped: grants.map(([permission, id]) => ({ permission, kind: "project", id })),
    });
    const inSite = { ...agent(hubLink(null)), hubProjectId: "p-site" } as StaffAgent;
    const wholeCompany = agent(hubLink(null));
    const access = scoped([
      ["angajati:creeaza", "p-site"],
      ["angajati:administreaza", "p-site"],
    ]);
    const withAccess = (role: "member" | "owner") =>
      ({
        hub: {
          ...(overview(role).hub as object),
          canAdminister: role === "owner",
          access,
        },
      }) as unknown as StaffOverview;
    // Tasks: the site agent yes, the whole company's agent no.
    expect(canGiveStaffTask(withAccess("member"), inSite, access)).toBe(true);
    expect(canGiveStaffTask(withAccess("member"), wholeCompany, access)).toBe(false);
    expect(
      canGiveStaffTask(
        withAccess("member"),
        { ...inSite, hubProjectId: "p-shop" } as StaffAgent,
        access,
      ),
    ).toBe(false);
    // "administrează" in p-site: edit and delete the site agent only.
    expect(canEditStaffAgent(withAccess("member"), inSite)).toBe(true);
    expect(canDeleteStaffAgent(withAccess("member"), inSite)).toBe(true);
    expect(canEditStaffAgent(withAccess("member"), wholeCompany)).toBe(false);
    expect(canDeleteStaffAgent(withAccess("member"), wholeCompany)).toBe(false);
    // Publishing a local agent of that project.
    const localInSite = { id: "l", name: "Dan", projectId: "p-site" } as unknown as StaffAgent;
    expect(canPublishStaffAgent(withAccess("member"), localInSite)).toBe(true);
    expect(
      canPublishStaffAgent(withAccess("member"), {
        ...localInSite,
        projectId: "p-shop",
      } as StaffAgent),
    ).toBe(false);
  });

  it("has every string in Romanian, with ș and ț and plain office words", () => {
    expect(Object.keys(staffHubText.ro).toSorted()).toEqual(
      Object.keys(staffHubText.en).toSorted(),
    );
    expect(Object.keys(staffHubText.ro.reasons).toSorted()).toEqual(
      Object.keys(staffHubText.en.reasons).toSorted(),
    );
    const text =
      JSON.stringify(staffHubText.ro) +
      staffHubText.ro.publishConfirm("Ioana") +
      staffHubText.ro.sentToRunner("Ioana");
    expect(text).not.toMatch(/[şţŞŢ]/);
    expect(staffHubText.ro.publish).toBe("Publică pentru firmă");
    expect(staffHubText.ro.badge(3)).toBe("Al firmei · v3");
  });
});
