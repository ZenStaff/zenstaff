// Zen Staff chat integrations (web): pure helpers for the setup page. Validation, labels and
// grouping live here so they are tested without React.
import {
  ZEN_CHAT_PLATFORM_INFO,
  type ZenChatAgent,
  type ZenChatBinding,
  type ZenChatConnectionState,
  type ZenChatConnectionView,
  type ZenChatMember,
  type ZenChatPlatform,
  type ZenChatReport,
} from "@t3tools/contracts/zenChat";

export type ChatTab =
  | "connections"
  | "agents"
  | "channels"
  | "people"
  | "reports"
  | "settings"
  | "approvals"
  | "activity";

export const CHAT_TABS: ReadonlyArray<ChatTab> = [
  "connections",
  "agents",
  "channels",
  "people",
  "reports",
  "settings",
  "approvals",
  "activity",
];

export const isChatTab = (value: unknown): value is ChatTab =>
  typeof value === "string" && (CHAT_TABS as ReadonlyArray<string>).includes(value);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

export const isEmail = (value: string) => EMAIL_PATTERN.test(value.trim());
export const isTime = (value: string) => TIME_PATTERN.test(value.trim());

/** "a, b\nc" -> ["a", "b", "c"] (trimmed, no empties, no duplicates). */
export function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter((item) => item !== ""),
    ),
  ];
}

export const formatList = (items: ReadonlyArray<string>) => items.join(", ");

export type ValidationProblem =
  | "name"
  | "workspace"
  | "setting"
  | "email"
  | "manager"
  | "owner"
  | "project"
  | "connection"
  | "channel"
  | "agent"
  | "prompt"
  | "days"
  | "time"
  | "identity";

export interface ConnectionDraft {
  readonly platform: ZenChatPlatform;
  readonly name: string;
  readonly workspaceAllowlist: ReadonlyArray<string>;
  readonly settings: Readonly<Record<string, string>>;
}

/** Problems with a connection form; empty = can be saved. */
export function validateConnection(draft: ConnectionDraft): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (draft.name.trim() === "") problems.push("name");
  if (draft.workspaceAllowlist.length === 0) problems.push("workspace");
  const missing = ZEN_CHAT_PLATFORM_INFO[draft.platform].settings.some(
    (setting) => setting.required && (draft.settings[setting.id] ?? "").trim() === "",
  );
  if (missing) problems.push("setting");
  return problems;
}

export function validateAgent(
  agent: Pick<ZenChatAgent, "name" | "kind" | "managerEmail" | "ownerEmail" | "projectId">,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (agent.name.trim() === "") problems.push("name");
  if (!isEmail(agent.managerEmail)) problems.push("manager");
  if (agent.kind === "personal" && !isEmail(agent.ownerEmail ?? "")) problems.push("owner");
  if (agent.projectId.trim() === "") problems.push("project");
  return problems;
}

export function validateBinding(
  binding: Pick<ZenChatBinding, "connectionId" | "channelId" | "agentId">,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (binding.connectionId === "") problems.push("connection");
  if (binding.channelId.trim() === "") problems.push("channel");
  if (binding.agentId === "") problems.push("agent");
  return problems;
}

export function validateMember(
  member: Pick<ZenChatMember, "email" | "identities">,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (!isEmail(member.email)) problems.push("email");
  if (member.identities.some((identity) => identity.userId.trim() === "")) {
    problems.push("identity");
  }
  return problems;
}

export function validateReport(
  report: Pick<ZenChatReport, "name" | "agentId" | "bindingId" | "prompt" | "days" | "time">,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (report.name.trim() === "") problems.push("name");
  if (report.agentId === "") problems.push("agent");
  if (report.bindingId === "") problems.push("channel");
  if (report.prompt.trim() === "") problems.push("prompt");
  if (report.days.length === 0) problems.push("days");
  if (!isTime(report.time)) problems.push("time");
  return problems;
}

/** Which agents may post in a channel: the answering one plus the listed posters. */
export function postingAgents(
  binding: ZenChatBinding,
  agents: ReadonlyArray<ZenChatAgent>,
): ZenChatAgent[] {
  return agents.filter(
    (agent) => agent.id === binding.agentId || binding.posters.includes(agent.id),
  );
}

/** Bindings a report may target: the report's agent must be allowed to post there. */
export function reportTargets(
  bindings: ReadonlyArray<ZenChatBinding>,
  agentId: string,
): ZenChatBinding[] {
  return bindings.filter(
    (binding) =>
      binding.channelId !== "dm" &&
      (binding.agentId === agentId || binding.posters.includes(agentId)),
  );
}

export function groupBindingsByConnection(
  bindings: ReadonlyArray<ZenChatBinding>,
  connections: ReadonlyArray<ZenChatConnectionView>,
): Array<{ connection: ZenChatConnectionView; bindings: ZenChatBinding[] }> {
  return connections.map((connection) => ({
    connection,
    bindings: bindings.filter((binding) => binding.connectionId === connection.id),
  }));
}

export type StateTone = "ok" | "wait" | "error" | "off";

export function stateTone(state: ZenChatConnectionState): StateTone {
  switch (state) {
    case "connected":
      return "ok";
    case "connecting":
    case "waiting-relay":
      return "wait";
    case "error":
    case "locked":
      return "error";
    default:
      return "off";
  }
}

/** Secrets still missing before a connection can start. */
export function missingSecrets(connection: ZenChatConnectionView): string[] {
  return ZEN_CHAT_PLATFORM_INFO[connection.platform].secrets
    .filter((secret) => !secret.label.includes("optional"))
    .filter((secret) => connection.secretsStored[secret.id] !== true)
    .map((secret) => secret.id);
}

/** Wizard step to resume at: 1 create app, 2 secrets, 3 allow-list, 4 test. */
export function wizardStartStep(connection: ZenChatConnectionView | null): 1 | 2 | 3 | 4 {
  if (connection === null) return 1;
  if (missingSecrets(connection).length > 0) return 2;
  if (connection.workspaceAllowlist.length === 0) return 3;
  return 4;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "Mon-Fri 09:00", "Every day 08:30", "Mon, Wed 17:00" in the given day names (index = getDay()). */
export function scheduleLabel(
  days: ReadonlyArray<number>,
  time: string,
  names: {
    readonly days: ReadonlyArray<string>;
    readonly everyDay: string;
    readonly weekdays: string;
  },
): string {
  const set = new Set(days);
  let label: string;
  if (set.size === 7) label = names.everyDay;
  else if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day))) label = names.weekdays;
  else
    label = DAY_ORDER.filter((day) => set.has(day))
      .map((day) => names.days[day] ?? String(day))
      .join(", ");
  return `${label} ${time}`;
}

export const ORDERED_DAYS = DAY_ORDER;

/** Members from the hub, by e-mail, that are not in the list yet. */
export function membersToImport(
  existing: ReadonlyArray<ZenChatMember>,
  hubMembers: ReadonlyArray<{ email: string; name: string; role: ZenChatMember["role"] }>,
): Array<Omit<ZenChatMember, "id">> {
  const known = new Set(existing.map((member) => member.email.trim().toLowerCase()));
  const seen = new Set<string>();
  const result: Array<Omit<ZenChatMember, "id">> = [];
  for (const member of hubMembers) {
    const email = member.email.trim().toLowerCase();
    if (email === "" || known.has(email) || seen.has(email)) continue;
    seen.add(email);
    result.push({ email, name: member.name, role: member.role, identities: [] });
  }
  return result;
}

/** "slack · T0123" identity chips. */
export function identityLabel(identity: ZenChatMember["identities"][number]): string {
  const name = ZEN_CHAT_PLATFORM_INFO[identity.platform].name;
  return identity.workspaceId === ""
    ? `${name}: ${identity.userId}`
    : `${name} (${identity.workspaceId}): ${identity.userId}`;
}
