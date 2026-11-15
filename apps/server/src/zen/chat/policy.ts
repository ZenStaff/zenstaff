// @effect-diagnostics globalDate:off -- Pure date arithmetic on local wall-clock time.
// Zen Staff chat integrations: the rules, as pure functions. Which workspaces and channels may talk
// to a bot, which agent answers, who a platform user is in the company, whether a personal agent
// may run, who may approve, quiet hours and report schedules. engine.ts applies them.
import type {
  ZenChatAgent,
  ZenChatBinding,
  ZenChatConnection,
  ZenChatMember,
  ZenChatPlatform,
  ZenChatReport,
  ZenChatSettings,
} from "@t3tools/contracts/zenChat";

import type { ChatUser, InboundMessage } from "./model.ts";

export interface ChatConfig {
  readonly connections: ReadonlyArray<ZenChatConnection>;
  readonly agents: ReadonlyArray<ZenChatAgent>;
  readonly bindings: ReadonlyArray<ZenChatBinding>;
  readonly members: ReadonlyArray<ZenChatMember>;
  readonly reports: ReadonlyArray<ZenChatReport>;
  readonly settings: ZenChatSettings;
}

const DM_CHANNEL = "dm";

const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

// Who is this platform user in the company?

/**
 * The company member behind a platform user: an explicit identity link first, else the e-mail the
 * platform vouches for. Unknown people get null (they may not prompt or approve).
 */
export function memberFor(
  members: ReadonlyArray<ZenChatMember>,
  platform: ZenChatPlatform,
  workspaceId: string,
  user: ChatUser,
): ZenChatMember | null {
  const linked = members.find((member) =>
    member.identities.some(
      (identity) =>
        identity.platform === platform &&
        identity.userId === user.id &&
        (identity.workspaceId === "" || identity.workspaceId === workspaceId),
    ),
  );
  if (linked) return linked;
  const email = lower(user.email);
  if (email === "") return null;
  return members.find((member) => lower(member.email) === email) ?? null;
}

/** A member's identity on a platform (to send them a direct message). */
export function identityOf(
  member: ZenChatMember,
  platform: ZenChatPlatform,
  workspaceId: string,
): string | null {
  return (
    member.identities.find(
      (identity) =>
        identity.platform === platform &&
        (identity.workspaceId === "" || identity.workspaceId === workspaceId),
    )?.userId ?? null
  );
}

// Routing an inbound message

export type RouteDecision =
  | { readonly kind: "ignore"; readonly reason: string }
  | { readonly kind: "refuse"; readonly reason: string; readonly reply: RefusalReply | null }
  | {
      readonly kind: "agent";
      readonly agent: ZenChatAgent;
      readonly binding: ZenChatBinding;
      readonly member: ZenChatMember;
    };

export type RefusalReply =
  | "unknown-person"
  | "guest"
  | "personal-unavailable"
  | "personal-not-owner"
  | "no-agent"
  | "needs-runner";

export interface RouteContext {
  /** This machine is the company runner (company connections need it). */
  readonly isRunner: boolean;
  /** Personal agents whose owner's own machine is online and runs them on their own account. */
  readonly personalAgentAvailable: (agent: ZenChatAgent) => boolean;
}

function workspaceAllowed(connection: ZenChatConnection, workspaceId: string): boolean {
  return connection.workspaceAllowlist.some((allowed) => allowed === workspaceId);
}

export function bindingFor(
  config: ChatConfig,
  connectionId: string,
  channelId: string,
  channelType: InboundMessage["channelType"],
): ZenChatBinding | null {
  const bindings = config.bindings.filter((binding) => binding.connectionId === connectionId);
  if (channelType === "dm") {
    return bindings.find((binding) => binding.channelId === DM_CHANNEL) ?? null;
  }
  return bindings.find((binding) => binding.channelId === channelId) ?? null;
}

/**
 * Whether a message reaches an agent, and which. Order: the workspace allow-list, the channel
 * (bound or allow-listed), mention rules, the person, then company vs personal rules.
 */
export function routeInbound(
  config: ChatConfig,
  connection: ZenChatConnection,
  message: InboundMessage,
  context: RouteContext,
): RouteDecision {
  if (message.user.isBot) return { kind: "ignore", reason: "bot message" };
  if (!workspaceAllowed(connection, message.workspaceId)) {
    return { kind: "ignore", reason: "workspace not allow-listed" };
  }
  const binding = bindingFor(config, connection.id, message.channelId, message.channelType);
  if (binding === null) {
    return connection.channelAllowlist.includes(message.channelId) && message.mentioned
      ? { kind: "refuse", reason: "no agent bound", reply: "no-agent" }
      : { kind: "ignore", reason: "channel not bound" };
  }
  const addressed =
    message.channelType === "dm" ||
    message.mentioned ||
    message.command !== null ||
    binding.respondTo === "all";
  if (!addressed) return { kind: "ignore", reason: "not addressed to the bot" };
  const agent = config.agents.find((candidate) => candidate.id === binding.agentId);
  if (agent === undefined) return { kind: "refuse", reason: "agent missing", reply: "no-agent" };
  const member = memberFor(config.members, connection.platform, message.workspaceId, message.user);
  if (member === null) {
    return { kind: "refuse", reason: "unknown person", reply: "unknown-person" };
  }
  if (member.role === "guest") return { kind: "refuse", reason: "guest", reply: "guest" };
  if (agent.kind === "company") {
    // A company agent runs on the company AI account, which only the runner has.
    if (connection.scope !== "company" || !context.isRunner) {
      return { kind: "refuse", reason: "company agent off the runner", reply: "needs-runner" };
    }
    return { kind: "agent", agent, binding, member };
  }
  // Personal agent: only its owner, only in a DM, only on the owner's own machine and account.
  if (lower(member.email) !== lower(agent.ownerEmail)) {
    return {
      kind: "refuse",
      reason: "personal agent of someone else",
      reply: "personal-not-owner",
    };
  }
  if (message.channelType !== "dm") {
    return { kind: "refuse", reason: "personal agent outside a DM", reply: "personal-not-owner" };
  }
  if (!context.personalAgentAvailable(agent)) {
    return { kind: "refuse", reason: "owner's machine offline", reply: "personal-unavailable" };
  }
  return { kind: "agent", agent, binding, member };
}

/**
 * A personal agent may run on this machine only when this machine belongs to its owner and is not
 * a company runner (whose provider account is the company's). Anything else needs the owner's own
 * machine, reached through the hub (not built yet: `PersonalAgentRelay` seam), so it is
 * unavailable.
 */
export function personalAgentRunsHere(
  agent: ZenChatAgent,
  machine: { readonly isRunner: boolean; readonly owner: string | null },
): boolean {
  return (
    agent.kind === "personal" &&
    !machine.isRunner &&
    machine.owner !== null &&
    lower(machine.owner) === lower(agent.ownerEmail)
  );
}

/** May this agent post (reports, notifications) in this bound channel? */
export function mayPost(binding: ZenChatBinding, agentId: string): boolean {
  return binding.agentId === agentId || binding.posters.includes(agentId);
}

// Approvals

export type ApprovalDecision = "accept" | "decline";

const APPROVAL_VALUE = /^zenapr:([a-f0-9]{16}):(accept|decline)$/;

export function approvalValue(approvalId: string, decision: ApprovalDecision): string {
  return `zenapr:${approvalId}:${decision}`;
}

export function parseApprovalValue(
  value: string,
): { readonly approvalId: string; readonly decision: ApprovalDecision } | null {
  const match = APPROVAL_VALUE.exec(value);
  return match ? { approvalId: match[1]!, decision: match[2] as ApprovalDecision } : null;
}

/**
 * Only the agent's manager decides. The clicking platform user must map to a member whose e-mail
 * is the agent's manager; nobody else (not even an admin) approves through chat.
 */
export function authorizeApproval(
  config: ChatConfig,
  platform: ZenChatPlatform,
  workspaceId: string,
  user: ChatUser,
  agent: ZenChatAgent | undefined,
):
  | { readonly ok: true; readonly member: ZenChatMember }
  | { readonly ok: false; readonly reason: string } {
  if (agent === undefined) return { ok: false, reason: "This agent no longer exists." };
  const member = memberFor(config.members, platform, workspaceId, user);
  if (member === null)
    return { ok: false, reason: "Your account is not linked to a company member." };
  if (lower(member.email) !== lower(agent.managerEmail)) {
    return { ok: false, reason: `Only ${agent.managerEmail} can approve this.` };
  }
  return { ok: true, member };
}

// Quiet hours and reports

const minutesOf = (hhmm: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

export const isValidTime = (hhmm: string) => minutesOf(hhmm) !== null;

/** Inside quiet hours (local time; the window may wrap past midnight). */
export function inQuietHours(settings: ZenChatSettings, now: Date): boolean {
  if (!settings.quietHours.enabled) return false;
  const start = minutesOf(settings.quietHours.start);
  const end = minutesOf(settings.quietHours.end);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** The latest scheduled time of a report at or before `now` (looks back up to 7 days). */
export function lastOccurrence(
  report: Pick<ZenChatReport, "days" | "time">,
  now: Date,
): Date | null {
  const minutes = minutesOf(report.time);
  if (minutes === null || report.days.length === 0) return null;
  for (let back = 0; back <= 7; back++) {
    const day = new Date(now);
    day.setDate(now.getDate() - back);
    day.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (day.getTime() > now.getTime()) continue;
    if (report.days.includes(day.getDay())) return day;
  }
  return null;
}

/**
 * A report is due when its latest scheduled time passed after its last run, at most `graceMs` ago
 * (a server that was off for a day does not post yesterday's report), and not in quiet hours
 * (it waits; the grace counts from the scheduled time, so set reports outside quiet hours).
 */
export function reportDue(
  report: ZenChatReport,
  settings: ZenChatSettings,
  now: Date,
  graceMs = 3 * 60 * 60 * 1000,
): boolean {
  if (!report.enabled) return false;
  const occurrence = lastOccurrence(report, now);
  if (occurrence === null) return false;
  if (now.getTime() - occurrence.getTime() > graceMs) return false;
  const lastRun = report.lastRunAt === null ? 0 : Date.parse(report.lastRunAt);
  if (Number.isFinite(lastRun) && lastRun >= occurrence.getTime()) return false;
  return !inQuietHours(settings, now);
}

// Conversations

/**
 * The key of a platform conversation: one Zen thread per platform thread (or per DM, or per
 * top-level message that starts a thread). The agent is part of the key, so rebinding a channel
 * to another agent starts fresh threads.
 */
export function conversationKey(input: {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly threadRoot: string | null;
  readonly agentId: string;
}): string {
  return [
    input.connectionId,
    input.workspaceId,
    input.channelId,
    input.threadRoot ?? "-",
    input.agentId,
  ].join("|");
}

/**
 * Where an answer goes and which thread it belongs to. Threaded platforms answer in the thread of
 * the message (a top-level mention starts one). DMs and WhatsApp are one running conversation.
 */
export function threadRootFor(
  message: Pick<InboundMessage, "threadId" | "messageId" | "channelType" | "platform">,
  threaded: boolean,
): string | null {
  if (!threaded || message.platform === "whatsapp") return null;
  if (message.threadId !== null) return message.threadId;
  if (message.channelType === "dm") return null;
  return message.messageId;
}
