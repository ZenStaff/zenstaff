// Zen Staff: "Hire your AI staff". AI employees (agents) with a profile, a manager who approves
// their outbound actions, a mixed human + agent task board, evaluations and a quality layer.
// See ZEN.md ("AI staff"). Like the hub, one RPC carries every operation as `{ op, input }`, so
// upstream files gain one entry each; the server validates each op's input itself.
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "./auth.ts";
import type { ZenHubAccess } from "./zenHub.ts";

export const ZEN_STAFF_WS_METHODS = {
  call: "zen.staff.call",
} as const;

const ZEN_STAFF_OPS = [
  "overview",
  "catalog",
  "agent.save",
  "agent.delete",
  "agent.hire",
  "hr.draft",
  "human.save",
  "human.delete",
  "settings.save",
  "task.start",
  "task.estimate",
  "board.save",
  "card.save",
  "card.delete",
  "approval.decide",
  "rating.add",
  "evaluation",
  "improve.propose",
  "improve.decide",
  "report.weekly",
  "discovery.run",
  "checker.run",
  "personas.build",
  "personas.ask",
  // Hub v6: AI staff as a company object (see ZEN.md, "AI staff synced through the hub").
  "agent.publish",
] as const;
export type ZenStaffOp = (typeof ZEN_STAFF_OPS)[number];

export const ZenStaffCallInput = Schema.Struct({
  op: Schema.Literals(ZEN_STAFF_OPS),
  input: Schema.Unknown,
});
export type ZenStaffCallInput = typeof ZenStaffCallInput.Type;

export class ZenStaffError extends Schema.TaggedError<ZenStaffError>()("ZenStaffError", {
  reason: Schema.Literals([
    "invalid-input",
    "not-found",
    "needs-company-account",
    "needs-runner",
    "forbidden",
    "unavailable",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const ZenStaffCallRpc = Rpc.make(ZEN_STAFF_WS_METHODS.call, {
  payload: ZenStaffCallInput,
  success: Schema.Unknown,
  error: Schema.Union([ZenStaffError, EnvironmentAuthorizationError]),
});

/** Spread into `WsRpcGroup` (rpc.ts). */
export const ZEN_STAFF_RPCS = [ZenStaffCallRpc] as const;

export const ZEN_STAFF_RPC_SCOPES = {
  [ZEN_STAFF_WS_METHODS.call]: AuthOrchestrationOperateScope,
} as const;

export const ZEN_STAFF_RPC_AGGREGATES = {
  [ZEN_STAFF_WS_METHODS.call]: "zen",
} as const;

// Shapes shared by the server and the web (plain TypeScript; the server normalizes stored data).

export type StaffLocale = "en" | "ro";
export type StaffText = { readonly en: string; readonly ro: string };

/** personal = the person's own AI account on their machine; company = the company runner. */
export type StaffAgentKind = "personal" | "company";

export interface StaffWorkingHours {
  /** 1 = Monday ... 7 = Sunday. */
  readonly days: ReadonlyArray<number>;
  /** "HH:MM", server local time. */
  readonly start: string;
  readonly end: string;
}

/** A recurring duty, built on an upstream scheduled task (with Zen's scheduled limits). */
export interface StaffDuty {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  /** 1 = Monday ... 7 = Sunday. */
  readonly weekday: number;
  /** "HH:MM". */
  readonly time: string;
  /** The upstream scheduled task, once created on this machine. */
  readonly scheduledTaskId: string | null;
}

export interface StaffLimits {
  readonly maxRunsPerDay: number | null;
  readonly maxMinutesPerRun: number | null;
  /** Tokens per calendar month; the agent is paused for new tasks past it. */
  readonly monthlyTokenBudget: number | null;
}

export interface StaffObjective {
  readonly id: string;
  readonly title: string;
  readonly target: string;
}

export interface StaffAgent {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  /** Initials tile color; the avatar is the agent's initials (no images, no emoji). */
  readonly color: string;
  /** A lucide icon name shown next to the role. */
  readonly icon: string;
  readonly role: string;
  /** The job description: instructions the agent gets with every task. */
  readonly instructions: string;
  readonly workflows: ReadonlyArray<string>;
  readonly connectors: ReadonlyArray<string>;
  readonly memory: { readonly read: boolean; readonly write: boolean };
  readonly workingHours: StaffWorkingHours | null;
  readonly duties: ReadonlyArray<StaffDuty>;
  readonly limits: StaffLimits;
  /** A human id (StaffHuman.id) who approves outbound actions. */
  readonly managerId: string | null;
  readonly objectives: ReadonlyArray<StaffObjective>;
  readonly kind: StaffAgentKind;
  /** The person whose machine and AI account a personal agent uses. */
  readonly owner: string | null;
  /** Default folder (project) the agent works in. */
  readonly projectId: string | null;
  /**
   * Hub v9 roles scoped to a project: the hub project this company agent belongs to (set when it
   * is published from a project; kept in the sealed profile). Null or absent: the whole company.
   */
  readonly hubProjectId?: string | null;
  readonly templateId: string | null;
  readonly origin: "catalog" | "conversation" | "discovery" | "manual";
  /** Minutes a person needs for one task of this agent (time-saved estimate). */
  readonly minutesPerTask: number;
  readonly paused: boolean;
  readonly instructionsVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set when the agent is a company object kept on the hub; the local copy follows the hub. */
  readonly hub?: StaffHubLink;
}

export interface StaffHubLink {
  /** The hub company. */
  readonly companyId: string;
  readonly staffId: string;
  readonly version: number;
  /** The hub person who manages the agent (may change its profile). */
  readonly managerUserId: string | null;
  /** Who saved this version, and when. */
  readonly updatedBy: string;
  readonly updatedAt: string;
  /** runner: this machine is the company runner and runs it; mirror: a copy that follows the hub. */
  readonly source: "runner" | "mirror";
}

/** The overview's view of the hub for this company (hub v6). */
export interface StaffHubInfo {
  readonly hubCompanyId: string;
  readonly role: "owner" | "admin" | "member" | "guest" | null;
  readonly myUserId: string;
  /** Owners and admins: publish, create and delete company agents. */
  readonly canAdminister: boolean;
  /** Hub v9: my permissions in this company (project-scoped checks per agent); null: unknown. */
  readonly access?: ZenHubAccess | null;
  /** When this machine last synced the company's agents (null: never). */
  readonly syncedAt: string | null;
  /** Why the last sync did not reach the runner or the hub, in plain words. */
  readonly problem: string | null;
  /** Hub records this machine refused, with the reason. */
  readonly refused: ReadonlyArray<{ readonly staffId: string; readonly reason: string }>;
}

export interface StaffHuman {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly title: string;
  readonly managerId: string | null;
  /** hub = a hub member of the linked company (read-only here); local = added on this machine. */
  readonly source: "hub" | "local";
}

export type StaffCompanyAccountKind = "team-seat" | "enterprise-seat" | "api-key";

/**
 * The company's AI account on the runner. Zen Staff never stores the key or the login itself:
 * this names the provider instance on the runner that is signed in to the company account.
 */
export interface StaffCompanyAccount {
  readonly kind: StaffCompanyAccountKind;
  readonly providerInstanceId: string;
  readonly model: string;
  readonly label: string;
}

export interface StaffBrandBook {
  readonly tone: string;
  readonly bannedWords: ReadonlyArray<string>;
  readonly prices: ReadonlyArray<{ readonly item: string; readonly price: number }>;
}

export interface StaffSettings {
  readonly companyAccount: StaffCompanyAccount | null;
  readonly discoveryOptIn: boolean;
  /** Run the checker (and its AI pass) on every approval. */
  readonly checkerAi: boolean;
  /**
   * "Aprobări" (default on): company agents' outbound connector calls wait for the manager, and
   * their shell runs without network, so nothing leaves the company without approval. Off: no
   * gate and the shell has the machine's network.
   */
  readonly approvals: boolean;
  readonly brand: StaffBrandBook;
  /** Money per million tokens, only when the company pays per token (API key). */
  readonly pricePerMillionTokens: number | null;
  readonly currency: string;
  /** Admin choice: company agents may not use a personal subscription (Free/Pro/Max/Plus). */
  readonly blockPersonalAccounts?: boolean;
}

export interface StaffBoardColumn {
  readonly id: string;
  readonly title: string;
}

export interface StaffAssignee {
  readonly kind: "human" | "agent";
  readonly id: string;
}

export interface StaffHandoff {
  readonly from: StaffAssignee | null;
  readonly to: StaffAssignee;
  readonly columnId: string;
  readonly at: string;
  readonly note: string;
}

export interface StaffResultTrail {
  readonly summary: string;
  /** Three short lines for a manager. */
  readonly explainToBoss: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<string>;
  readonly filesRead: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<string>;
  readonly assumptions: ReadonlyArray<string>;
  /** Files the agent made for the person (paths inside its folder), attached to the reply. */
  readonly files?: ReadonlyArray<string>;
  readonly at: string;
}

/** Where an @mention's answer goes back to: the chat the person wrote in. */
export interface StaffMentionReply {
  readonly threadId: string;
  readonly title: string;
}

export interface StaffCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly columnId: string;
  readonly assignee: StaffAssignee | null;
  readonly projectId: string | null;
  readonly threadId: string | null;
  readonly handoffs: ReadonlyArray<StaffHandoff>;
  readonly origin: "board" | "mention" | "duty";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type StaffOutboundKind = "send" | "publish" | "pay" | "delete" | "other";

export type StaffFindingSeverity = "high" | "medium" | "low";

export interface StaffCheckerFinding {
  readonly rule: string;
  readonly severity: StaffFindingSeverity;
  readonly message: string;
  /** The text the finding is about (highlighted in the approval). */
  readonly excerpt: string;
  readonly source: "rules" | "ai";
}

export interface StaffCheckerResult {
  readonly status: "ok" | "issues";
  readonly findings: ReadonlyArray<StaffCheckerFinding>;
  readonly aiChecked: boolean;
  readonly at: string;
}

export interface StaffApproval {
  readonly id: string;
  readonly agentId: string;
  readonly threadId: string | null;
  readonly cardId: string | null;
  readonly action: StaffOutboundKind;
  /** Where it goes: a recipient, a page, a payee. */
  readonly target: string;
  readonly content: string;
  readonly reason: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly checker: StaffCheckerResult | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string;
  readonly createdAt: string;
}

export interface StaffRating {
  readonly id: string;
  readonly agentId: string;
  readonly threadId: string | null;
  readonly by: string;
  readonly thumbs: "up" | "down" | null;
  readonly score: number | null;
  readonly comment: string;
  readonly at: string;
}

export interface StaffTaskRun {
  readonly id: string;
  readonly agentId: string;
  readonly threadId: string;
  readonly cardId: string | null;
  readonly title: string;
  readonly origin: "task" | "mention" | "duty" | "card";
  readonly teachMe: boolean;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: "running" | "completed" | "failed" | "interrupted";
  readonly durationMs: number | null;
  readonly tokens: number | null;
  readonly trail: StaffResultTrail | null;
  /** An @mention: the chat the request came from, which gets the status and the result. */
  readonly replyTo?: StaffMentionReply | null;
  /** Company runner: the hub user who gave this task through the hub (only they read its status). */
  readonly requestedBy?: string | null;
  /**
   * Hub v9: the company-wide permissions of the person who gave the task, when that person is a
   * member or guest (owners and admins: absent = everything). The agent never does more: without
   * "angajati:trimite" every outbound call is refused, whatever the approvals switch says.
   */
  readonly starterPermissions?: ReadonlyArray<string>;
}

export interface StaffInstructionProposal {
  readonly id: string;
  readonly agentId: string;
  readonly proposed: string;
  readonly changes: ReadonlyArray<string>;
  readonly basedOn: number;
  readonly status: "pending" | "approved" | "rejected";
  readonly createdAt: string;
}

export interface StaffWeeklyReport {
  readonly id: string;
  readonly agentId: string;
  readonly managerId: string | null;
  readonly weekStart: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface StaffPersona {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly cares: ReadonlyArray<string>;
  readonly objections: ReadonlyArray<string>;
}

export type StaffAgentStatus = "working" | "idle" | "waiting-approval" | "paused";

/** Why an agent can or cannot be placed (hired or started) here. */
export interface StaffPlacement {
  readonly ok: boolean;
  readonly missing: ReadonlyArray<"company-account" | "runner" | "personal-on-runner">;
  readonly message: string;
}

export interface StaffOverview {
  readonly companyId: string;
  readonly companyName: string;
  readonly agents: ReadonlyArray<StaffAgent & { readonly status: StaffAgentStatus }>;
  readonly humans: ReadonlyArray<StaffHuman>;
  readonly settings: StaffSettings;
  readonly columns: ReadonlyArray<StaffBoardColumn>;
  readonly cards: ReadonlyArray<StaffCard>;
  readonly approvals: ReadonlyArray<StaffApproval>;
  readonly runs: ReadonlyArray<StaffTaskRun>;
  readonly proposals: ReadonlyArray<StaffInstructionProposal>;
  readonly reports: ReadonlyArray<StaffWeeklyReport>;
  readonly personas: ReadonlyArray<StaffPersona>;
  readonly runner: {
    readonly isRunner: boolean;
    readonly source: "hub" | "local" | "none";
    readonly hubCompanyId: string | null;
    readonly hubUser: string | null;
  };
  /** What creating a company agent here needs. */
  readonly companyPlacement: StaffPlacement;
  readonly me: string;
  /** Null when this company is not linked to a hub company (or nobody is signed in). */
  readonly hub?: StaffHubInfo | null;
}

export interface StaffRoleTemplate {
  readonly id: string;
  readonly name: StaffText;
  readonly role: StaffText;
  readonly summary: StaffText;
  readonly instructions: StaffText;
  readonly icon: string;
  readonly color: string;
  readonly workflows: ReadonlyArray<string>;
  readonly connectors: ReadonlyArray<string>;
  readonly objectives: ReadonlyArray<StaffText>;
  readonly duties: ReadonlyArray<{
    readonly title: StaffText;
    readonly prompt: StaffText;
    readonly weekday: number;
    readonly time: string;
  }>;
  readonly minutesPerTask: number;
  readonly suggestedKind: StaffAgentKind;
}

export interface StaffEstimate {
  readonly basis: "history" | "template" | "default";
  readonly samples: number;
  readonly minutes: number;
  readonly tokens: number;
  readonly cost: number | null;
  readonly currency: string;
  readonly humanMinutes: number;
}

export interface StaffEvaluationRow {
  readonly agentId: string;
  readonly tasksDone: number;
  readonly tasksFailed: number;
  readonly tokens: number;
  readonly cost: number | null;
  readonly minutesWorked: number;
  readonly minutesSaved: number;
  readonly approvals: number;
  readonly approved: number;
  readonly rejected: number;
  readonly approvalRate: number | null;
  readonly rejectionRate: number | null;
  readonly thumbsUp: number;
  readonly thumbsDown: number;
  readonly averageScore: number | null;
  readonly ratings: number;
  readonly budgetUsed: number | null;
}

export interface StaffEvaluation {
  readonly month: string;
  readonly currency: string;
  readonly rows: ReadonlyArray<StaffEvaluationRow>;
  readonly totals: {
    readonly tasksDone: number;
    readonly tokens: number;
    readonly cost: number | null;
    readonly minutesSaved: number;
  };
}

export interface StaffDiscoverySuggestion {
  readonly id: string;
  /** Top words of the requests (labels only, never the prompts). */
  readonly label: string;
  readonly person: string;
  readonly count: number;
  readonly weeks: number;
  readonly cadence: "weekly" | "several-per-week" | "monthly" | "irregular";
  /** 1 = Monday ... 7 = Sunday, when one day dominates. */
  readonly weekday: number | null;
  readonly minutesEach: number;
  readonly hoursPerMonth: number;
  readonly workflowId: string | null;
  readonly suggestedTemplateId: string | null;
  readonly proposal: "workflow" | "agent";
}

export interface StaffDiscoveryResult {
  readonly analyzedThreads: number;
  readonly fromDate: string | null;
  readonly toDate: string | null;
  readonly suggestions: ReadonlyArray<StaffDiscoverySuggestion>;
  readonly hoursPerMonth: number;
}
