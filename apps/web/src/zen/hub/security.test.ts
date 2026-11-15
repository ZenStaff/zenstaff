// Hub v9 in the app: what the Team page shows for a role, the role grid, and the follow loop.
import { zenHubAccessOfRole, zenHubCan, type ZenHubAccess } from "@t3tools/contracts/zenHub";
import { describe, expect, it } from "vite-plus/test";

import { togglePermission } from "./CompanyRoles";
import { companyGates } from "./permissionGates";
import { nextSince } from "./RunnerFollowView";

const member = (
  permissions: ReadonlyArray<string>,
  scoped: ZenHubAccess["scoped"] = [],
): ZenHubAccess => ({
  role: "member",
  customRoleId: "role_x",
  permissions,
  scoped,
});

describe("permission gating in the app (hub v9)", () => {
  it("hides what the role cannot do, and shows it when the role can", () => {
    const accounting = companyGates(member(["facturare:vede", "echipa:vede"]), "member");
    expect(accounting).toMatchObject({
      invite: false,
      giveTasks: false,
      followOwn: false,
      agentsMaySend: false,
      seeTeam: true,
    });
    const sales = companyGates(
      member(["angajati:creeaza", "chats:urmareste", "echipa:creeaza"]),
      "member",
    );
    expect(sales).toMatchObject({
      invite: true,
      giveTasks: true,
      followOwn: true,
      agentsMaySend: false,
      editRoles: false,
    });
    // A role scoped to one project still shows "give a task"; the runner checks the project.
    expect(
      companyGates(
        member([], [{ permission: "angajati:creeaza", kind: "project", id: "p" }]),
        "member",
      ).giveTasks,
    ).toBe(true);
  });

  it("owners and admins see everything; guests never give tasks", () => {
    const owner = companyGates(zenHubAccessOfRole("owner"), "owner");
    expect(Object.values(owner).every(Boolean)).toBe(true);
    expect(companyGates(member(["angajati:creeaza"]), "guest").giveTasks).toBe(false);
  });

  it("falls back to the old rule with an older hub (no access)", () => {
    expect(companyGates(null, "member")).toMatchObject({
      invite: false,
      editRoles: false,
      giveTasks: true,
    });
    expect(companyGates(null, "admin")).toMatchObject({ invite: true, editRoles: true });
    expect(zenHubCan(zenHubAccessOfRole("member"), "angajati:trimite")).toBe(true);
    expect(zenHubCan(zenHubAccessOfRole("guest"), "angajati:creeaza")).toBe(false);
  });

  it("edits the grid one permission at a time, sorted and without duplicates", () => {
    expect(togglePermission(["chats:vede"], "facturare:vede", true)).toEqual([
      "chats:vede",
      "facturare:vede",
    ]);
    expect(togglePermission(["chats:vede", "facturare:vede"], "chats:vede", false)).toEqual([
      "facturare:vede",
    ]);
    expect(togglePermission(["chats:vede"], "chats:vede", true)).toEqual(["chats:vede"]);
  });

  it("follows the runner thread from the last version seen", () => {
    const answer = {
      readOnly: true as const,
      run: { title: "x", status: "running" },
      snapshot: { version: "v2" } as never,
    };
    expect(nextSince(null, answer)).toBe("v2");
    expect(nextSince("v1", null)).toBe("v1");
  });
});
