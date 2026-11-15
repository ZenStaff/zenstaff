// Hub v9: what the Team page shows for my role. The hub and the runner check every action again;
// this only hides or disables what would be refused. Older hubs send no access: the old rule
// (owners and admins manage) applies.
import {
  zenHubCan,
  zenHubCanSomewhere,
  type ZenHubAccess,
  type ZenHubRole,
} from "@t3tools/contracts/zenHub";

export interface CompanyGates {
  readonly invite: boolean;
  readonly editRoles: boolean;
  readonly seeTeam: boolean;
  readonly giveTasks: boolean;
  readonly followOwn: boolean;
  readonly agentsMaySend: boolean;
  readonly manageMemory: boolean;
  readonly manageDevices: boolean;
}

export function companyGates(
  access: ZenHubAccess | null | undefined,
  role: ZenHubRole,
): CompanyGates {
  const manager = role === "owner" || role === "admin";
  if (access === null || access === undefined) {
    return {
      invite: manager,
      editRoles: manager,
      seeTeam: true,
      giveTasks: role !== "guest",
      followOwn: role !== "guest",
      agentsMaySend: role !== "guest",
      manageMemory: manager,
      manageDevices: manager,
    };
  }
  return {
    invite: zenHubCan(access, "echipa:creeaza"),
    editRoles: manager,
    seeTeam: zenHubCan(access, "echipa:vede"),
    giveTasks: role !== "guest" && zenHubCanSomewhere(access, "angajati:creeaza"),
    followOwn:
      role !== "guest" &&
      (zenHubCan(access, "chats:urmareste") || zenHubCan(access, "chats:urmareste-toate")),
    agentsMaySend: zenHubCan(access, "angajati:trimite"),
    manageMemory: manager && zenHubCan(access, "memorie:administreaza"),
    manageDevices: manager && zenHubCan(access, "dispozitive:administreaza"),
  };
}
