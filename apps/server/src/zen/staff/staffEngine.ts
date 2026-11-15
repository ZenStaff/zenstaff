// @effect-diagnostics nodeBuiltinImport:off globalDate:off extendsNativeError:off - plain async code behind a promise boundary (wrapped by ZenStaff.ts).
// Zen Staff AI staff: the engine behind `zen.staff.call`. Plain async code with its outside
// world injected (threads, launches, the model, scheduled tasks), so tests drive it with fakes.
// State lives per company in `<state dir>/zen/staff/<company id>.json` (mode 0600).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  StaffAgent,
  StaffApproval,
  StaffAssignee,
  StaffBoardColumn,
  StaffCard,
  StaffCompanyAccount,
  StaffHubInfo,
  StaffHubLink,
  StaffHuman,
  StaffLocale,
  StaffMentionReply,
  StaffOutboundKind,
  StaffOverview,
  StaffRoleTemplate,
  StaffSettings,
  StaffTaskRun,
  ZenStaffOp,
} from "@t3tools/contracts/zenStaff";
import { zenHubCan, type ZenHubAccess } from "@t3tools/contracts/zenHub";

import {
  zenCompanyHubBridge,
  type CompanyHubBridge,
  type HubStaffApply,
} from "../hub/companyPorts.ts";
import {
  fromHubProfile,
  hubUserOfManager,
  managerIdOfHubUser,
  toHubProfile,
  type HubStaffProfile,
} from "../hub/companySync.ts";
import { runnerStatus } from "../toolchains/access.ts";
import {
  discoverRepeatedWork,
  estimateTask,
  evaluateMonth,
  weekStart,
  weeklyReportText,
  type DiscoveryItem,
  type DiscoveryWorkflow,
} from "./analytics.ts";
import {
  checkerAiPrompt,
  extractPriceLines,
  mergeCheckerResult,
  parseAiFindings,
  runCheckerRules,
} from "./checker.ts";
import {
  HR_QUESTIONS,
  fallbackHrDraft,
  hrDraftPrompt,
  improvePrompt,
  panelPrompt,
  parseHrDraft,
  parseImprove,
  parsePanel,
  parsePersonas,
  personasPrompt,
} from "./prompts.ts";
import { mentionTexts, type MentionPhase, type MentionPost } from "./mentionReply.ts";
import { ROLE_CATALOG, findRoleTemplate } from "./roleCatalog.ts";
import {
  DEFAULT_COLUMNS,
  DEFAULT_SETTINGS,
  PERSONAL_COMPANY_ID,
  StaffInputError,
  agentFromTemplate,
  agentStatus,
  budgetBlock,
  buildAgentBrief,
  emptyStaffState,
  evaluatePlacement,
  findMentionedAgents,
  foldText,
  classifyOutboundTool,
  gateToolCall,
  isId,
  isRecord,
  normalizeAgentInput,
  optNumber,
  optStr,
  parseAgentMarker,
  resolveTaskModel,
  str,
  strList,
  type GateAllowance,
  type GateDecision,
  type PlacementContext,
  type StaffState,
} from "./staffModel.ts";

export interface ModelChoice {
  readonly instanceId: string;
  readonly model: string;
}

export interface ThreadInfo {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly active: boolean;
  readonly createdAtMs: number;
  readonly modelSelection: ModelChoice | null;
  readonly runtimeMode: string | null;
}

export interface ThreadUsage {
  readonly status: "running" | "completed" | "failed" | "interrupted";
  readonly durationMs: number | null;
  readonly tokens: number | null;
  readonly firstUserText: string | null;
  readonly minutesSpan: number | null;
  /** What the agent waits for in its own chat (tool approvals the provider asked for). */
  readonly pendingRequests?: ReadonlyArray<string>;
  /** The agent's last finished answer (an @mention's reply when it recorded no result). */
  readonly lastAnswer?: string | null;
}

export interface StaffDeps {
  readonly stateDir: string;
  readonly zenHome: string;
  readonly now: () => Date;
  readonly threads: (threadIds: ReadonlyArray<string> | null) => Promise<ReadonlyArray<ThreadInfo>>;
  readonly usage: (threadId: string) => Promise<ThreadUsage | null>;
  readonly launch: (input: {
    readonly threadId: string;
    readonly projectId: string;
    readonly title: string;
    readonly modelSelection: ModelChoice;
    readonly runtimeMode: string;
    readonly text: string;
  }) => Promise<void>;
  readonly send: (input: {
    readonly threadId: string;
    readonly projectId: string;
    readonly text: string;
    readonly key: string;
  }) => Promise<void>;
  readonly generate: (prompt: string) => Promise<string>;
  readonly providerAvailable: (instanceId: string) => Promise<boolean>;
  readonly upsertDuty: (input: {
    readonly taskId: string | null;
    readonly title: string;
    readonly prompt: string;
    readonly weekday: number;
    readonly time: string;
    readonly projectId: string;
    readonly modelSelection: ModelChoice;
    readonly runtimeMode: string;
    readonly limits: {
      readonly maxRunsPerDay: number | null;
      readonly maxMinutes: number | null;
      readonly quiet: { start: string; end: string } | null;
    };
  }) => Promise<string>;
  readonly deleteDuty: (taskId: string) => Promise<void>;
  readonly workflows: () => ReadonlyArray<DiscoveryWorkflow & { readonly name: string }>;
  /** Hub v6: company objects (defaults to the bridge ZenHub installs; tests pass a fake). */
  readonly companyHub?: () => CompanyHubBridge | null;
  /** Dev fixture (`ZEN_STAFF_FAKE_HISTORY`): extra past requests for discovery screenshots. */
  readonly extraHistory?: () => ReadonlyArray<DiscoveryItem>;
  readonly log?: (message: string, detail?: unknown) => void;
  /** Writes (or updates) an @mention's reply in the chat it came from, and relays it. */
  readonly postMention?: (post: MentionPost) => Promise<void>;
  /** A project's folder (files an @mention's reply may attach). */
  readonly projectRoot?: (projectId: string) => Promise<string | null>;
}

/**
 * The runtime mode an agent's thread starts in. While "Aprobări" is on, full access becomes
 * auto-accept-edits: in bypass mode Claude Code never asks the permission callback, so the
 * outbound gate would not see connector calls.
 */
export function gatedRuntimeMode(mode: string, approvals: boolean): string {
  return approvals && mode === "full-access" ? "auto-accept-edits" : mode;
}

/**
 * Hub v9: whether the person who gave the task may have agents send anything out. Absent
 * permissions (local tasks, owners and admins, older hubs) put no extra limit.
 */
/**
 * Hub v9: "angajați AI: administrează" for the whole company, or for the agent's hub project.
 * Owners and admins are checked by the caller; this is for members with a custom or scoped role.
 */
function mayAdministerStaff(
  access: ZenHubAccess | null | undefined,
  hubProjectId: string | null,
): boolean {
  return zenHubCan(access, "angajati:administreaza", { projectId: hubProjectId });
}

/**
 * Hub v9: who decides a company agent's approvals on the runner: owners, admins and roles with
 * "angajați AI: aprobă" (for the company or the agent's project). An older hub (no access, only
 * the role) keeps the built-in rule: owners and admins.
 */
function mayApproveStaff(
  link: { readonly role: string | null; readonly access?: ZenHubAccess | null },
  hubProjectId: string | null,
): boolean {
  if (link.role === "owner" || link.role === "admin") return true;
  if (link.role !== "member") return false;
  return zenHubCan(link.access ?? null, "angajati:aproba", { projectId: hubProjectId });
}

function starterMaySend(starterPermissions: ReadonlyArray<string> | undefined | null): boolean {
  return starterPermissions == null || starterPermissions.includes("angajati:trimite");
}

/** The line of a message that names the agent (chat integrations wrap the person's text). */
function mentionTitle(text: string, agentName: string): string {
  const folded = foldText(`@${agentName}`);
  const line = text.split("\n").find((candidate) => foldText(candidate).includes(folded)) ?? text;
  return line.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Files attached to a mention's reply: at most 10, each up to 25 MB, inside the agent's folder. */
const MENTION_FILES_MAX = 10;
const MENTION_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** Status updates while working: at most one every 5 s per task (approvals and the end at once). */
const MENTION_UPDATE_EVERY_MS = 5_000;
/** A mention given to an agent on the company runner is followed for at most 12 hours. */
const REMOTE_MENTION_MAX_MS = 12 * 60 * 60 * 1000;

interface RemoteMention {
  readonly companyId: string;
  readonly staffId: string;
  readonly runId: string;
  readonly runnerThreadId: string;
  readonly replyTo: StaffMentionReply;
  readonly title: string;
  readonly locale: StaffLocale;
  readonly startedAt: string;
}

const OUTBOUND_KINDS = new Set(["send", "publish", "pay", "delete", "other"]);

/** A phase as the runner sent it (`staff.run`): checked field by field, null when unusable. */
function parseRemotePhase(value: unknown): MentionPhase | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  const text = (field: unknown, max: number) =>
    typeof field === "string" ? field.slice(0, max) : "";
  switch (value.kind) {
    case "working":
      return {
        kind: "working",
        minutes:
          typeof value.minutes === "number" && Number.isFinite(value.minutes)
            ? Math.max(0, Math.floor(value.minutes))
            : 0,
      };
    case "waiting-approval":
      return {
        kind: "waiting-approval",
        action:
          typeof value.action === "string" && OUTBOUND_KINDS.has(value.action)
            ? (value.action as StaffOutboundKind)
            : "other",
        target: text(value.target, 300),
        manager: typeof value.manager === "string" ? value.manager.slice(0, 120) : null,
      };
    case "waiting-request":
      return { kind: "waiting-request", prompt: text(value.prompt, 600) };
    case "done":
      return {
        kind: "done",
        summary: text(value.summary, 1_500),
        explainToBoss: Array.isArray(value.explainToBoss)
          ? value.explainToBoss
              .filter((line): line is string => typeof line === "string")
              .slice(0, 3)
              .map((line) => line.slice(0, 400))
          : [],
        fileNames: Array.isArray(value.fileNames)
          ? value.fileNames
              .filter((name): name is string => typeof name === "string")
              .slice(0, MENTION_FILES_MAX)
              .map((name) => NodePath.basename(name).slice(0, 200))
          : [],
      };
    case "failed":
      return { kind: "failed" };
    default:
      return null;
  }
}

export type StaffErrorReason =
  | "invalid-input"
  | "not-found"
  | "needs-company-account"
  | "needs-runner"
  | "forbidden"
  | "unavailable";

export class StaffError extends Error {
  readonly reason: StaffErrorReason;
  constructor(reason: StaffErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

interface LaunchDefaults {
  readonly modelSelection: ModelChoice | null;
  readonly runtimeMode: string;
  readonly projectId: string | null;
}

const MAX_APPROVALS = 500;
const MAX_RUNS = 2_000;
const ALLOWANCE_MS = 2 * 60 * 60 * 1000;

const localeOf = (input: unknown): StaffLocale =>
  isRecord(input) && input.locale === "en" ? "en" : "ro";
const COMPANY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readJson(file: string): unknown {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

function normalizeState(raw: unknown): StaffState {
  const base = emptyStaffState();
  if (!isRecord(raw) || raw.version !== 1) return base;
  const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const settings = isRecord(raw.settings) ? raw.settings : {};
  return {
    version: 1,
    agents: array<StaffAgent>(raw.agents),
    humans: array<StaffHuman>(raw.humans),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(settings as Partial<StaffSettings>),
      brand: {
        ...DEFAULT_SETTINGS.brand,
        ...(isRecord(settings.brand) ? (settings.brand as Partial<StaffSettings["brand"]>) : {}),
      },
    },
    columns:
      array<StaffBoardColumn>(raw.columns).length > 0
        ? array<StaffBoardColumn>(raw.columns)
        : base.columns,
    cards: array<StaffCard>(raw.cards),
    approvals: array<StaffApproval>(raw.approvals),
    ratings: array(raw.ratings),
    runs: array<StaffTaskRun>(raw.runs),
    corrections: array(raw.corrections),
    proposals: array(raw.proposals),
    reports: array(raw.reports),
    personas: array(raw.personas),
  };
}

const newId = (prefix: string) => `${prefix}-${NodeCrypto.randomUUID().slice(0, 8)}`;

function slug(text: string): string {
  return (
    foldText(text)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "agent"
  );
}

const AGENT_STATUSES = new Set(["working", "idle", "waiting-approval", "paused"]);
const isAgentStatus = (value: string): value is StaffOverview["agents"][number]["status"] =>
  AGENT_STATUSES.has(value);

/** The language a hub profile was written in (its duties' briefs use it). */
const profileLocale = (profile: HubStaffProfile): StaffLocale =>
  /[ăâîșț]/i.test(`${profile.role} ${profile.instructions}`) ? "ro" : "en";

export class StaffEngine {
  private readonly states = new Map<string, StaffState>();
  /** threadId -> agent; rebuilt from stored runs at start. */
  private readonly agentThreads = new Map<
    string,
    { agentId: string; companyId: string; projectId: string; locale: StaffLocale }
  >();
  private readonly allowances = new Map<string, GateAllowance[]>();
  private readonly handledMessages = new Set<string>();
  private readonly launchDefaults = new Map<string, LaunchDefaults>();
  /** Hub agents copied from the company runner: their status there (`<company>:<agent>`). */
  private readonly remoteStatus = new Map<string, StaffOverview["agents"][number]["status"]>();
  /** @mention replies: the last text posted per task (key), and when, to post only changes. */
  private readonly mentionPosted = new Map<string, { text: string; at: number }>();
  /** Mention posts started without waiting (task start, approvals). */
  private readonly mentionWork = new Set<Promise<void>>();
  /** @mentions of hub agents that run on the company runner: followed through `staff.run`. */
  private readonly remoteMentions = new Map<string, RemoteMention>();
  private pollingRemote = false;
  private readonly staffDir: string;

  private readonly deps: StaffDeps;

  constructor(deps: StaffDeps) {
    this.deps = deps;
    this.staffDir = NodePath.join(deps.stateDir, "zen", "staff");
    for (const companyId of this.companyIdsOnDisk()) {
      const state = this.load(companyId);
      for (const run of state.runs) {
        this.agentThreads.set(run.threadId, {
          agentId: run.agentId,
          companyId,
          projectId: "",
          locale: "ro",
        });
      }
    }
  }

  // Storage.

  private companyIdsOnDisk(): string[] {
    try {
      return NodeFS.readdirSync(this.staffDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .filter((name) => COMPANY_ID.test(name));
    } catch {
      return [];
    }
  }

  private fileOf(companyId: string): string {
    return NodePath.join(this.staffDir, `${companyId}.json`);
  }

  load(companyId: string): StaffState {
    if (!COMPANY_ID.test(companyId)) throw new StaffError("invalid-input", "Unknown company.");
    let state = this.states.get(companyId);
    if (state === undefined) {
      state = normalizeState(readJson(this.fileOf(companyId)));
      this.states.set(companyId, state);
    }
    return state;
  }

  private save(companyId: string, next: StaffState): StaffState {
    const trimmed: StaffState = {
      ...next,
      approvals: next.approvals.slice(-MAX_APPROVALS),
      runs: next.runs.slice(-MAX_RUNS),
      corrections: next.corrections.slice(-500),
      reports: next.reports.slice(-200),
      ratings: next.ratings.slice(-2_000),
    };
    writeJsonAtomic(this.fileOf(companyId), trimmed);
    this.states.set(companyId, trimmed);
    return trimmed;
  }

  private update(companyId: string, change: (current: StaffState) => StaffState): StaffState {
    return this.save(companyId, change(this.load(companyId)));
  }

  private companies(): {
    names: Record<string, string>;
    projects: Record<string, string>;
    memoryDirs: Record<string, string | null>;
  } {
    const raw = readJson(NodePath.join(this.deps.stateDir, "zen", "companies.json"));
    const names: Record<string, string> = { [PERSONAL_COMPANY_ID]: "Personal" };
    const memoryDirs: Record<string, string | null> = {};
    const projects: Record<string, string> = {};
    if (isRecord(raw)) {
      for (const company of Array.isArray(raw.companies) ? raw.companies : []) {
        if (isRecord(company) && typeof company.id === "string") {
          names[company.id] = typeof company.name === "string" ? company.name : company.id;
          const custom =
            typeof company.memoryDirectory === "string" ? company.memoryDirectory : null;
          memoryDirs[company.id] =
            custom !== null
              ? custom.replace(/^~(?=\/|$)/, NodeOS.homedir())
              : company.id === PERSONAL_COMPANY_ID
                ? null
                : NodePath.join(this.deps.zenHome, "companies", company.id, "memory");
        }
      }
      if (isRecord(raw.projects)) {
        for (const [projectId, companyId] of Object.entries(raw.projects)) {
          if (typeof companyId === "string") projects[projectId] = companyId;
        }
      }
    }
    return { names, projects, memoryDirs };
  }

  private runner(companyId: string) {
    const hubText = (() => {
      try {
        return NodeFS.readFileSync(NodePath.join(this.deps.stateDir, "zen", "hub.json"), "utf8");
      } catch {
        return null;
      }
    })();
    const toolchains = readJson(NodePath.join(this.deps.zenHome, "toolchains", "state.json"));
    const localSwitch =
      isRecord(toolchains) &&
      isRecord(toolchains.settings) &&
      toolchains.settings.companyRunner === true;
    const status = runnerStatus(hubText, localSwitch);
    const hub = (() => {
      try {
        return hubText ? (JSON.parse(hubText) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    })();
    const links = isRecord(hub.links) ? (hub.links as Record<string, unknown>) : {};
    const hubCompanyId = typeof links[companyId] === "string" ? (links[companyId] as string) : null;
    // Registered with the hub: this machine runs the companies it was registered for (hub v9:
    // possibly several; hub.json from before keeps one `runnerCompanyId`).
    const served = Array.isArray(hub.runnerCompanyIds)
      ? (hub.runnerCompanyIds as ReadonlyArray<unknown>)
      : [hub.runnerCompanyId];
    const isRunner =
      status.source === "hub"
        ? hubCompanyId !== null && served.includes(hubCompanyId)
        : status.isRunner;
    const session = isRecord(hub.session) && isRecord(hub.session.user) ? hub.session.user : null;
    const hubName =
      session !== null && typeof session.name === "string" && session.name.trim() !== ""
        ? session.name
        : null;
    return { isRunner, source: status.source, hubCompanyId, hubUser: status.hubUser, hubName };
  }

  private me(companyId: string): string {
    const runner = this.runner(companyId);
    if (runner.hubName) return runner.hubName;
    try {
      return NodeOS.userInfo().username;
    } catch {
      return "me";
    }
  }

  private async placementContext(
    companyId: string,
    locale: StaffLocale,
  ): Promise<PlacementContext> {
    const state = this.load(companyId);
    const runner = this.runner(companyId);
    const account = state.settings.companyAccount;
    const available =
      account === null
        ? false
        : await this.deps.providerAvailable(account.providerInstanceId).catch(() => false);
    return {
      companyId,
      isRunner: runner.isRunner,
      companyAccount: account,
      companyAccountAvailable: available,
      locale,
    };
  }

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  // Dispatch.

  async call(op: ZenStaffOp, input: unknown): Promise<unknown> {
    try {
      return await this.dispatch(op, input);
    } catch (cause) {
      if (cause instanceof StaffError) throw cause;
      if (cause instanceof StaffInputError) throw new StaffError("invalid-input", cause.message);
      this.deps.log?.("AI staff operation failed", { op, cause: String(cause) });
      throw new StaffError(
        "unavailable",
        cause instanceof Error ? cause.message : "The operation failed.",
      );
    }
  }

  private async dispatch(op: ZenStaffOp, input: unknown): Promise<unknown> {
    if (op === "catalog") return { roles: ROLE_CATALOG, questions: HR_QUESTIONS };
    const companyId = str(input, "companyId", 64);
    this.load(companyId);
    const locale = localeOf(input);
    switch (op) {
      case "overview":
        return this.overview(companyId, locale);
      case "agent.save":
        return this.saveAgent(
          companyId,
          isRecord(input) ? input.agent : null,
          locale,
          this.defaultsOf(input),
        );
      case "agent.delete":
        return this.deleteAgent(companyId, str(input, "agentId", 80));
      case "agent.hire":
        return this.hire(companyId, input, locale);
      case "hr.draft":
        return this.hrDraft(input, locale);
      case "human.save":
        return this.saveHuman(companyId, input);
      case "human.delete":
        return this.deleteHuman(companyId, str(input, "humanId", 80));
      case "settings.save":
        return this.saveSettings(companyId, input);
      case "task.start":
        return this.startTask(companyId, input, locale);
      case "task.estimate": {
        const agent = this.agentOf(companyId, str(input, "agentId", 80));
        const state = this.load(companyId);
        return estimateTask({
          agent,
          runs: state.runs,
          titleHint: optStr(input, "title", 200),
          settings: state.settings,
        });
      }
      case "board.save":
        return this.saveColumns(companyId, input);
      case "card.save":
        return this.saveCard(companyId, input);
      case "card.delete":
        this.update(companyId, (state) => ({
          ...state,
          cards: state.cards.filter((card) => card.id !== str(input, "cardId", 80)),
        }));
        return { ok: true };
      case "approval.decide":
        return this.decideApproval(companyId, input, locale);
      case "rating.add":
        return this.addRating(companyId, input);
      case "evaluation":
        return this.evaluation(companyId, optStr(input, "month", 7));
      case "improve.propose":
        return this.proposeImprovement(companyId, str(input, "agentId", 80), locale);
      case "improve.decide":
        return this.decideImprovement(
          companyId,
          str(input, "proposalId", 80),
          isRecord(input) && input.approve === true,
        );
      case "report.weekly":
        return this.weeklyReports(
          companyId,
          optStr(input, "agentId", 80),
          locale,
          this.deps.now().getTime(),
        );
      case "discovery.run":
        return this.discovery(companyId);
      case "checker.run": {
        const action = parseAction(isRecord(input) ? input.action : null);
        return this.check(
          companyId,
          str(input, "content", 20_000),
          action,
          str(input, "target", 300, ""),
          locale,
          isRecord(input) && input.ai === false ? false : null,
        );
      }
      case "personas.build":
        return this.buildPersonas(
          companyId,
          str(input, "sources", 60_000, ""),
          optNumber(isRecord(input) ? input.count : null, 3, 10) ?? 6,
          locale,
        );
      case "personas.ask":
        return this.askPanel(companyId, str(input, "question", 4_000), locale);
      case "agent.publish":
        return this.publishAgent(
          companyId,
          str(input, "agentId", 80),
          locale,
          this.defaultsOf(input),
        );
      default:
        throw new StaffError("invalid-input", `Unknown operation ${op}.`);
    }
  }

  private defaultsOf(input: unknown): LaunchDefaults {
    const raw = isRecord(input) && isRecord(input.defaults) ? input.defaults : {};
    const selection = isRecord(raw.modelSelection) ? raw.modelSelection : null;
    return {
      modelSelection:
        selection !== null &&
        typeof selection.instanceId === "string" &&
        typeof selection.model === "string"
          ? { instanceId: selection.instanceId, model: selection.model }
          : null,
      runtimeMode: typeof raw.runtimeMode === "string" ? raw.runtimeMode : "auto-accept-edits",
      projectId: typeof raw.projectId === "string" && raw.projectId !== "" ? raw.projectId : null,
    };
  }

  private agentOf(companyId: string, agentId: string): StaffAgent {
    const agent = this.load(companyId).agents.find((candidate) => candidate.id === agentId);
    if (agent === undefined)
      throw new StaffError("not-found", "This AI employee no longer exists.");
    return agent;
  }

  // Overview, agents and people.

  async overview(companyId: string, locale: StaffLocale): Promise<StaffOverview> {
    let state = this.load(companyId);
    const me = this.me(companyId);
    if (state.humans.length === 0) {
      state = this.update(companyId, (current) => ({
        ...current,
        columns: current.cards.length === 0 ? DEFAULT_COLUMNS[locale] : current.columns,
        humans: [
          {
            id: "owner",
            name: me,
            email: null,
            title: locale === "ro" ? "Manager" : "Manager",
            managerId: null,
            source: "local",
          },
        ],
      }));
    }
    await this.refreshRuns(companyId);
    state = this.load(companyId);
    const runningThreads = state.runs
      .filter((run) => run.status === "running")
      .map((run) => run.threadId);
    const infos =
      runningThreads.length === 0 ? [] : await this.deps.threads(runningThreads).catch(() => []);
    const active = new Set(infos.filter((info) => info.active).map((info) => info.id));
    const runner = this.runner(companyId);
    const context = await this.placementContext(companyId, locale);
    return {
      companyId,
      companyName: this.companies().names[companyId] ?? companyId,
      agents: state.agents.map((agent) => ({
        ...agent,
        status:
          this.remoteStatus.get(`${companyId}:${agent.id}`) ??
          agentStatus({
            paused: agent.paused,
            activeThreads: state.runs.filter(
              (run) => run.agentId === agent.id && active.has(run.threadId),
            ).length,
            pendingApprovals: state.approvals.filter(
              (approval) => approval.agentId === agent.id && approval.status === "pending",
            ).length,
          }),
      })),
      humans: state.humans,
      settings: state.settings,
      columns: state.columns,
      cards: state.cards,
      approvals: state.approvals.toReversed().slice(0, 200),
      runs: state.runs.toReversed().slice(0, 300),
      proposals: state.proposals.toReversed().slice(0, 50),
      reports: state.reports.toReversed().slice(0, 50),
      personas: state.personas,
      runner: {
        isRunner: runner.isRunner,
        source: runner.source,
        hubCompanyId: runner.hubCompanyId,
        hubUser: runner.hubUser,
      },
      companyPlacement: evaluatePlacement("company", context),
      me,
      hub: this.hubInfo(companyId),
    };
  }

  async saveAgent(
    companyId: string,
    raw: unknown,
    locale: StaffLocale,
    defaults: LaunchDefaults,
  ): Promise<StaffAgent> {
    const state = this.load(companyId);
    const existing =
      isRecord(raw) && isId(raw.id)
        ? (state.agents.find((agent) => agent.id === raw.id) ?? null)
        : null;
    const id =
      existing?.id ??
      `${slug(isRecord(raw) && typeof raw.name === "string" ? raw.name : "agent")}-${NodeCrypto.randomUUID().slice(0, 4)}`;
    if (existing?.hub !== undefined)
      return this.saveHubAgent(
        companyId,
        existing as StaffAgent & { readonly hub: StaffHubLink },
        raw,
        locale,
        defaults,
      );
    const agent = normalizeAgentInput(raw, existing, { id, companyId, now: this.nowIso() });
    await this.assertPlaceable(agent, companyId, locale);
    if (
      agent.managerId !== null &&
      !agent.managerId.startsWith("hub-") &&
      !state.humans.some((human) => human.id === agent.managerId)
    ) {
      throw new StaffError(
        "invalid-input",
        locale === "ro" ? "Managerul ales nu mai există." : "The chosen manager no longer exists.",
      );
    }
    const synced = await this.syncDuties(companyId, existing, agent, defaults, locale);
    this.update(companyId, (current) => ({
      ...current,
      agents:
        existing === null
          ? [...current.agents, synced]
          : current.agents.map((item) => (item.id === synced.id ? synced : item)),
    }));
    return synced;
  }

  private async assertPlaceable(
    agent: Pick<StaffAgent, "kind">,
    companyId: string,
    locale: StaffLocale,
  ): Promise<void> {
    if (agent.kind !== "company") return;
    const placement = evaluatePlacement("company", await this.placementContext(companyId, locale));
    if (!placement.ok) {
      throw new StaffError(
        placement.missing.includes("company-account") ? "needs-company-account" : "needs-runner",
        placement.message,
      );
    }
  }

  /** Recurring duties become upstream scheduled tasks (with Zen limits) on this machine. */
  private async syncDuties(
    companyId: string,
    previous: StaffAgent | null,
    agent: StaffAgent,
    defaults: LaunchDefaults,
    locale: StaffLocale,
  ): Promise<StaffAgent> {
    for (const old of previous?.duties ?? []) {
      if (old.scheduledTaskId !== null && !agent.duties.some((duty) => duty.id === old.id)) {
        await this.deps.deleteDuty(old.scheduledTaskId).catch(() => undefined);
      }
    }
    if (agent.duties.length === 0) return agent;
    const projectId = agent.projectId ?? defaults.projectId;
    const context = await this.placementContext(companyId, locale);
    const model = resolveTaskModel(agent.kind, defaults.modelSelection, context);
    if (projectId === null || !model.ok) return agent;
    const state = this.load(companyId);
    const manager = state.humans.find((human) => human.id === agent.managerId)?.name ?? null;
    const workflows = this.workflowNames(agent.workflows);
    const quiet =
      agent.workingHours === null
        ? null
        : { start: agent.workingHours.end, end: agent.workingHours.start };
    const duties = [];
    for (const duty of agent.duties) {
      const prompt = buildAgentBrief({
        agent,
        managerName: manager,
        workflowNames: workflows,
        task: duty.prompt,
        teachMe: false,
        locale,
      });
      try {
        const taskId = await this.deps.upsertDuty({
          taskId: duty.scheduledTaskId,
          title: `${agent.name}: ${duty.title}`,
          prompt,
          weekday: duty.weekday,
          time: duty.time,
          projectId,
          modelSelection: model.selection,
          runtimeMode: gatedRuntimeMode(defaults.runtimeMode, state.settings.approvals),
          limits: {
            maxRunsPerDay: agent.limits.maxRunsPerDay,
            maxMinutes: agent.limits.maxMinutesPerRun,
            quiet,
          },
        });
        duties.push({ ...duty, scheduledTaskId: taskId });
      } catch (cause) {
        this.deps.log?.("AI staff duty could not be scheduled", {
          agent: agent.id,
          cause: String(cause),
        });
        duties.push(duty);
      }
    }
    return { ...agent, duties };
  }

  private workflowNames(ids: ReadonlyArray<string>): string[] {
    const known = this.deps.workflows();
    return ids.map((id) => {
      const workflow = known.find((item) => item.id === id);
      return workflow ? `${workflow.name} (${id})` : id;
    });
  }

  async deleteAgent(companyId: string, agentId: string): Promise<{ ok: true }> {
    const agent = this.agentOf(companyId, agentId);
    if (agent.hub !== undefined) await this.deleteHubAgent(companyId, agent);
    for (const duty of agent.duties) {
      if (duty.scheduledTaskId !== null)
        await this.deps.deleteDuty(duty.scheduledTaskId).catch(() => undefined);
    }
    this.update(companyId, (state) => ({
      ...state,
      agents: state.agents.filter((item) => item.id !== agentId),
      cards: state.cards.map((card) =>
        card.assignee?.kind === "agent" && card.assignee.id === agentId
          ? { ...card, assignee: null }
          : card,
      ),
    }));
    return { ok: true };
  }

  async hire(companyId: string, input: unknown, locale: StaffLocale): Promise<StaffAgent> {
    const template = findRoleTemplate(str(input, "templateId", 80));
    if (template === undefined)
      throw new StaffError("not-found", "This role is not in the catalog.");
    const kind =
      isRecord(input) && input.kind === "personal"
        ? "personal"
        : isRecord(input) && input.kind === "company"
          ? "company"
          : template.suggestedKind;
    const state = this.load(companyId);
    const managerId = optStr(input, "managerId", 80) ?? state.humans[0]?.id ?? null;
    const draft = agentFromTemplate(template, {
      id: "new",
      companyId,
      now: this.nowIso(),
      locale,
      kind,
      name: optStr(input, "name", 60),
      managerId,
      owner: kind === "personal" ? this.me(companyId) : null,
      projectId: optStr(input, "projectId", 200),
    });
    const { id: _ignored, ...rest } = draft;
    // Chat-first hiring: the employee waits (paused, no duties scheduled yet) until the person
    // approves the profile its setup chat proposes (zen/intake, "hire_propose").
    const setup = isRecord(input) && input.setup === true;
    return this.saveAgent(
      companyId,
      {
        ...rest,
        ...(setup ? { paused: true, duties: [] } : {}),
        origin: isRecord(input) && input.origin === "discovery" ? "discovery" : "catalog",
      },
      locale,
      this.defaultsOf(input),
    );
  }

  async hrDraft(input: unknown, locale: StaffLocale) {
    const answers = (isRecord(input) && Array.isArray(input.answers) ? input.answers : []).flatMap(
      (item) => {
        if (!isRecord(item)) return [];
        const answer = typeof item.answer === "string" ? item.answer.trim().slice(0, 2_000) : "";
        const id = typeof item.id === "string" ? item.id : "";
        const question =
          HR_QUESTIONS[locale].find((entry) => entry.id === id)?.question ??
          (typeof item.question === "string" ? item.question : id);
        return answer === "" ? [] : [{ id, question, answer }];
      },
    );
    if (answers.length === 0)
      throw new StaffError(
        "invalid-input",
        locale === "ro" ? "Răspunde măcar la o întrebare." : "Answer at least one question.",
      );
    const workflows = this.deps.workflows();
    const connectors = [...new Set(ROLE_CATALOG.flatMap((role) => role.connectors))];
    try {
      const raw = await this.deps.generate(
        hrDraftPrompt({
          answers,
          locale,
          workflows: workflows.map((item) => ({ id: item.id, name: item.name })),
          connectors,
        }),
      );
      const draft = parseHrDraft(raw, { workflows: workflows.map((item) => item.id), connectors });
      if (draft !== null) return { draft, source: "ai" as const };
    } catch (cause) {
      this.deps.log?.("AI staff HR draft fell back to the catalog", { cause: String(cause) });
    }
    return { draft: fallbackHrDraft(answers, locale), source: "catalog" as const };
  }

  saveHuman(companyId: string, input: unknown): StaffHuman {
    const raw = isRecord(input) ? input.human : null;
    if (!isRecord(raw)) throw new StaffError("invalid-input", "Missing the person.");
    const name = str(raw, "name", 80);
    if (name === "") throw new StaffError("invalid-input", "Give the person a name.");
    const state = this.load(companyId);
    const id =
      isId(raw.id) && state.humans.some((human) => human.id === raw.id)
        ? raw.id
        : newId(slug(name));
    const human: StaffHuman = {
      id,
      name,
      email: optStr(raw, "email", 254),
      title: str(raw, "title", 120, ""),
      managerId: isId(raw.managerId) && raw.managerId !== id ? raw.managerId : null,
      source: raw.source === "hub" ? "hub" : "local",
    };
    this.update(companyId, (current) => ({
      ...current,
      humans: current.humans.some((item) => item.id === id)
        ? current.humans.map((item) => (item.id === id ? human : item))
        : [...current.humans, human],
    }));
    return human;
  }

  deleteHuman(companyId: string, humanId: string): { ok: true } {
    this.update(companyId, (state) => ({
      ...state,
      humans: state.humans
        .filter((human) => human.id !== humanId)
        .map((human) => (human.managerId === humanId ? { ...human, managerId: null } : human)),
      agents: state.agents.map((agent) =>
        agent.managerId === humanId ? { ...agent, managerId: null } : agent,
      ),
    }));
    return { ok: true };
  }

  saveSettings(companyId: string, input: unknown): StaffSettings {
    const raw = isRecord(input) && isRecord(input.settings) ? input.settings : {};
    const current = this.load(companyId).settings;
    let companyAccount: StaffCompanyAccount | null = current.companyAccount;
    if ("companyAccount" in raw) {
      const account = raw.companyAccount;
      if (account === null) companyAccount = null;
      else if (isRecord(account)) {
        const kind =
          account.kind === "team-seat" ||
          account.kind === "enterprise-seat" ||
          account.kind === "api-key"
            ? account.kind
            : null;
        const instance = str(account, "providerInstanceId", 80);
        const model = str(account, "model", 120);
        if (kind === null || instance === "" || model === "")
          throw new StaffError(
            "invalid-input",
            "Choose the account kind, the assistant and the model.",
          );
        if (companyId === PERSONAL_COMPANY_ID)
          throw new StaffError("forbidden", "Personal has no company account.");
        companyAccount = {
          kind,
          providerInstanceId: instance,
          model,
          label: str(account, "label", 120, ""),
        };
      }
    }
    const brandRaw = isRecord(raw.brand) ? raw.brand : null;
    const settings: StaffSettings = {
      companyAccount,
      discoveryOptIn:
        typeof raw.discoveryOptIn === "boolean" ? raw.discoveryOptIn : current.discoveryOptIn,
      checkerAi: typeof raw.checkerAi === "boolean" ? raw.checkerAi : current.checkerAi,
      approvals: typeof raw.approvals === "boolean" ? raw.approvals : current.approvals,
      brand:
        brandRaw === null
          ? current.brand
          : {
              tone: str(brandRaw, "tone", 2_000, ""),
              bannedWords: strList(brandRaw.bannedWords, 100, 60),
              prices: (Array.isArray(brandRaw.prices) ? brandRaw.prices : [])
                .slice(0, 300)
                .flatMap((entry) => {
                  if (!isRecord(entry)) return [];
                  const item = typeof entry.item === "string" ? entry.item.trim().slice(0, 80) : "";
                  const price = optNumber(entry.price, 0, 10_000_000);
                  return item === "" || price === null ? [] : [{ item, price }];
                }),
            },
      pricePerMillionTokens:
        "pricePerMillionTokens" in raw
          ? optNumber(raw.pricePerMillionTokens, 0, 10_000)
          : current.pricePerMillionTokens,
      currency:
        typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency)
          ? raw.currency
          : current.currency,
      ...(typeof raw.blockPersonalAccounts === "boolean"
        ? { blockPersonalAccounts: raw.blockPersonalAccounts }
        : current.blockPersonalAccounts === undefined
          ? {}
          : { blockPersonalAccounts: current.blockPersonalAccounts }),
    };
    this.update(companyId, (state) => ({ ...state, settings }));
    return settings;
  }

  // Tasks.

  async startTask(
    companyId: string,
    input: unknown,
    locale: StaffLocale,
  ): Promise<{ threadId: string; runId: string; onRunner?: true }> {
    const agent = this.agentOf(companyId, str(input, "agentId", 80));
    const defaults = this.defaultsOf(input);
    const text = str(input, "text", 20_000);
    if (text === "")
      throw new StaffError("invalid-input", locale === "ro" ? "Scrie sarcina." : "Write the task.");
    return this.start({
      companyId,
      agent,
      text,
      title: optStr(input, "title", 120),
      cardId: optStr(input, "cardId", 80),
      teachMe: isRecord(input) && input.teachMe === true,
      projectId: optStr(input, "projectId", 200) ?? agent.projectId ?? defaults.projectId,
      defaults,
      locale,
      origin: optStr(input, "cardId", 80) !== null ? "card" : "task",
      context: null,
    });
  }

  private async start(input: {
    readonly companyId: string;
    readonly agent: StaffAgent;
    readonly text: string;
    readonly title: string | null;
    readonly cardId: string | null;
    readonly teachMe: boolean;
    readonly projectId: string | null;
    readonly defaults: LaunchDefaults;
    readonly locale: StaffLocale;
    readonly origin: StaffTaskRun["origin"];
    readonly context: string | null;
    readonly replyTo?: StaffMentionReply | null;
    /** Company runner: the hub user who gave the task (`startFromHub`). */
    readonly requestedBy?: string | null;
    /** Hub v9: that person's permissions (members and guests); the agent never does more. */
    readonly starterPermissions?: ReadonlyArray<string> | null;
  }): Promise<{ threadId: string; runId: string; onRunner?: true }> {
    const { agent, companyId, locale } = input;
    // A company agent kept on the hub runs on the company runner, whoever gives the task.
    if (agent.hub?.source === "mirror") return this.taskOnRunner(input);
    if (agent.paused)
      throw new StaffError(
        "forbidden",
        locale === "ro" ? `${agent.name} e în pauză.` : `${agent.name} is paused.`,
      );
    const state = this.load(companyId);
    const blocked = budgetBlock(agent, state.runs, this.nowIso(), locale);
    if (blocked !== null) throw new StaffError("forbidden", blocked);
    const model = resolveTaskModel(
      agent.kind,
      input.defaults.modelSelection,
      await this.placementContext(companyId, locale),
    );
    if (!model.ok) {
      throw new StaffError(
        model.placement.missing.includes("company-account")
          ? "needs-company-account"
          : model.placement.missing.includes("runner")
            ? "needs-runner"
            : "forbidden",
        model.placement.message,
      );
    }
    if (input.projectId === null) {
      throw new StaffError(
        "invalid-input",
        locale === "ro" ? "Alege dosarul în care lucrează." : "Choose the folder it works in.",
      );
    }
    const manager = state.humans.find((human) => human.id === agent.managerId)?.name ?? null;
    const message = buildAgentBrief({
      agent,
      managerName: manager,
      workflowNames: this.workflowNames(agent.workflows),
      task: input.text,
      teachMe: input.teachMe,
      locale,
      context: input.context,
      shellOffline:
        (agent.kind === "company" && state.settings.approvals) ||
        !starterMaySend(input.starterPermissions),
    });
    const threadId = NodeCrypto.randomUUID();
    const title = `${agent.name}: ${input.title ?? input.text.split("\n")[0]!.slice(0, 60)}`;
    const run: StaffTaskRun = {
      id: newId("run"),
      agentId: agent.id,
      threadId,
      cardId: input.cardId,
      title: input.title ?? input.text.split("\n")[0]!.slice(0, 80),
      origin: input.origin,
      teachMe: input.teachMe,
      startedAt: this.nowIso(),
      endedAt: null,
      status: "running",
      durationMs: null,
      tokens: null,
      trail: null,
      replyTo: input.replyTo ?? null,
      ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
      ...(input.starterPermissions == null
        ? {}
        : { starterPermissions: [...input.starterPermissions] }),
    };
    // Registered before the launch, so the agent's first turn already has the zen-staff tools.
    this.agentThreads.set(threadId, {
      agentId: agent.id,
      companyId,
      projectId: input.projectId,
      locale,
    });
    this.launchDefaults.set(companyId, { ...input.defaults, projectId: input.projectId });
    try {
      await this.deps.launch({
        threadId,
        projectId: input.projectId,
        title,
        modelSelection: model.selection,
        // A starter who may not send keeps the gate on even with "Aprobări" off.
        runtimeMode: gatedRuntimeMode(
          input.defaults.runtimeMode,
          state.settings.approvals || !starterMaySend(input.starterPermissions),
        ),
        text: message,
      });
    } catch (cause) {
      this.agentThreads.delete(threadId);
      throw new StaffError(
        "unavailable",
        cause instanceof Error ? cause.message : "The task did not start.",
      );
    }
    this.update(companyId, (current) => ({
      ...current,
      runs: [...current.runs, run],
      cards:
        input.cardId === null
          ? current.cards
          : current.cards.map((card) =>
              card.id === input.cardId
                ? {
                    ...card,
                    threadId,
                    columnId: nextColumn(current.columns, card.columnId, "draft"),
                    updatedAt: this.nowIso(),
                  }
                : card,
            ),
    }));
    if (run.replyTo) this.updateMentionLater(threadId);
    return { threadId, runId: run.id };
  }

  /** Brings running task records up to date (status, duration, tokens) from their threads. */
  private async refreshRuns(companyId: string): Promise<void> {
    const state = this.load(companyId);
    const stale = state.runs.filter(
      (run) => run.status === "running" || (run.status === "completed" && run.tokens === null),
    );
    if (stale.length === 0) return;
    const updates = new Map<string, ThreadUsage>();
    for (const run of stale.slice(-50)) {
      const usage = await this.deps.usage(run.threadId).catch(() => null);
      if (usage !== null) updates.set(run.id, usage);
    }
    if (updates.size === 0) return;
    const before = this.load(companyId).runs;
    const after = this.update(companyId, (current) => ({
      ...current,
      runs: current.runs.map((run) => {
        const usage = updates.get(run.id);
        if (usage === undefined) return run;
        return {
          ...run,
          status: usage.status,
          endedAt: usage.status === "running" ? null : (run.endedAt ?? this.nowIso()),
          durationMs: usage.durationMs,
          tokens: usage.tokens,
        };
      }),
    }));
    this.reportFinishedRuns(companyId, before, after);
  }

  /**
   * Hub v9: a company agent's task that ended on this runner goes to the company's audit log as
   * `runner.task.finish` (ids and the final state only), once, when it leaves "running".
   */
  private reportFinishedRuns(
    companyId: string,
    before: ReadonlyArray<StaffTaskRun>,
    after: StaffState,
  ): void {
    const wasRunning = new Set(
      before.filter((run) => run.status === "running").map((run) => run.id),
    );
    const finished = after.runs.filter((run) => wasRunning.has(run.id) && run.status !== "running");
    if (finished.length === 0) return;
    const bridge = this.hub();
    const link = bridge?.link(companyId) ?? null;
    if (bridge === null || link === null || bridge.reportAudit === undefined) return;
    const events = finished.flatMap((run) => {
      const agent = after.agents.find((item) => item.id === run.agentId);
      if (agent?.hub?.source !== "runner") return [];
      return [
        {
          action: "runner.task.finish",
          actorUserId: run.requestedBy ?? null,
          staffId: agent.hub.staffId,
          runId: run.id,
          threadId: run.threadId,
          status: run.status,
        },
      ];
    });
    if (events.length > 0) bridge.reportAudit(link.hubCompanyId, events);
  }

  // Board.

  saveColumns(companyId: string, input: unknown): ReadonlyArray<StaffBoardColumn> {
    const raw = isRecord(input) && Array.isArray(input.columns) ? input.columns : [];
    const columns = raw.slice(0, 12).flatMap((column, index) => {
      if (!isRecord(column)) return [];
      const title = str(column, "title", 60, "");
      if (title === "") return [];
      return [{ id: isId(column.id) ? column.id : `col-${index + 1}-${slug(title)}`, title }];
    });
    if (columns.length < 2)
      throw new StaffError("invalid-input", "A board needs at least two steps.");
    this.update(companyId, (state) => ({
      ...state,
      columns,
      cards: state.cards.map((card) =>
        columns.some((column) => column.id === card.columnId)
          ? card
          : { ...card, columnId: columns[0]!.id },
      ),
    }));
    return columns;
  }

  saveCard(companyId: string, input: unknown): StaffCard {
    const raw = isRecord(input) && isRecord(input.card) ? input.card : null;
    if (raw === null) throw new StaffError("invalid-input", "Missing the card.");
    const state = this.load(companyId);
    const existing = isId(raw.id) ? (state.cards.find((card) => card.id === raw.id) ?? null) : null;
    const columnId =
      isId(raw.columnId) && state.columns.some((column) => column.id === raw.columnId)
        ? raw.columnId
        : (existing?.columnId ?? state.columns[0]!.id);
    const assignee = parseAssignee(raw.assignee, state);
    const now = this.nowIso();
    const moved =
      existing !== null &&
      (existing.columnId !== columnId || !sameAssignee(existing.assignee, assignee));
    const handoffs =
      assignee !== null && (existing === null || moved)
        ? [
            ...(existing?.handoffs ?? []),
            {
              from: existing?.assignee ?? null,
              to: assignee,
              columnId,
              at: now,
              note: str(raw, "note", 500, ""),
            },
          ]
        : (existing?.handoffs ?? []);
    const card: StaffCard = {
      id: existing?.id ?? newId("card"),
      title: str(raw, "title", 200),
      description: str(raw, "description", 8_000, ""),
      columnId,
      assignee,
      projectId: optStr(raw, "projectId", 200) ?? existing?.projectId ?? null,
      threadId: existing?.threadId ?? null,
      handoffs,
      origin: existing?.origin ?? "board",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (card.title === "") throw new StaffError("invalid-input", "Give the card a title.");
    this.update(companyId, (current) => ({
      ...current,
      cards:
        existing === null
          ? [...current.cards, card]
          : current.cards.map((item) => (item.id === card.id ? card : item)),
    }));
    return card;
  }

  // Approvals and the gate.

  gate(threadId: string, toolName: string): GateDecision {
    const owner = this.agentThreads.get(threadId);
    if (owner === undefined) return { behavior: "pass" };
    const state = this.load(owner.companyId);
    // Hub v9: the agent runs with the permissions of the person who gave the task, never more.
    // Without "Angajați AI: trimite" nothing goes out, approvals on or off, approved or not.
    const run = state.runs.findLast((item) => item.threadId === threadId);
    if (!starterMaySend(run?.starterPermissions)) {
      const action = classifyOutboundTool(toolName);
      if (action !== null) {
        return {
          behavior: "deny",
          action,
          message: `"${toolName}" is an outbound action (${action}). The person who gave this task may not have agents send anything out (permission "angajati:trimite"). Do not retry and do not ask for approval: finish with a draft they can send themselves.`,
        };
      }
    }
    // "Aprobări" off for the company: no gate (and the shell keeps its network).
    if (!state.settings.approvals) return { behavior: "pass" };
    const allowances = this.allowances.get(threadId) ?? [];
    const decision = gateToolCall(toolName, allowances, this.deps.now().getTime());
    this.allowances.set(threadId, allowances);
    return decision;
  }

  isAgentThread(threadId: string): boolean {
    return this.agentThreads.has(threadId);
  }

  /**
   * Whether the thread's shell must run without network: a company agent's thread while the
   * company's "Aprobări" switch is on. Personal agents and every other thread are unchanged.
   */
  shellWithoutNetwork(threadId: string): boolean {
    const owner = this.agentThreads.get(threadId);
    if (owner === undefined) return false;
    const state = this.load(owner.companyId);
    // Hub v9: a starter who may not send: no network either (no curl around the gate).
    if (
      !starterMaySend(state.runs.findLast((item) => item.threadId === threadId)?.starterPermissions)
    )
      return true;
    if (!state.settings.approvals) return false;
    return state.agents.find((agent) => agent.id === owner.agentId)?.kind === "company";
  }

  async requestApproval(
    threadId: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const owner = this.agentThreads.get(threadId);
    if (owner === undefined) throw new Error("This chat is not an AI staff task.");
    const action = parseAction(args.action);
    const target = typeof args.target === "string" ? args.target.trim().slice(0, 300) : "";
    const content = typeof args.content === "string" ? args.content.slice(0, 20_000) : "";
    if (content.trim() === "") throw new Error("Give the exact content to approve.");
    const state = this.load(owner.companyId);
    const locale: StaffLocale = owner.locale;
    const run = state.runs.findLast((item) => item.threadId === threadId);
    // Nobody can approve more than the person who gave the task may do.
    if (!starterMaySend(run?.starterPermissions)) {
      throw new Error(
        'The person who gave this task may not have agents send anything out (permission "angajati:trimite"). Finish with a draft instead.',
      );
    }
    const checker = await this.check(owner.companyId, content, action, target, locale, null);
    const approval: StaffApproval = {
      id: newId("appr"),
      agentId: owner.agentId,
      threadId,
      cardId: run?.cardId ?? null,
      action,
      target,
      content,
      reason: typeof args.reason === "string" ? args.reason.trim().slice(0, 500) : "",
      status: "pending",
      checker,
      decidedBy: null,
      decidedAt: null,
      decisionNote: "",
      createdAt: this.nowIso(),
    };
    this.update(owner.companyId, (current) => ({
      ...current,
      approvals: [...current.approvals, approval],
      cards: current.cards.map((card) =>
        card.id === approval.cardId
          ? {
              ...card,
              columnId: nextColumn(current.columns, card.columnId, "review"),
              updatedAt: this.nowIso(),
            }
          : card,
      ),
    }));
    const agent = state.agents.find((item) => item.id === owner.agentId);
    const manager =
      state.humans.find((human) => human.id === agent?.managerId)?.name ?? "the manager";
    const issues = checker.findings.filter((finding) => finding.severity !== "low");
    this.updateMentionLater(threadId);
    return [
      `Approval requested (${approval.id}). ${manager} decides in the AI staff approvals inbox.`,
      issues.length > 0
        ? `The checker found ${issues.length} issue(s) the manager will see: ${issues.map((finding) => finding.message).join(" | ")}. You may send a corrected request now instead.`
        : "The checker found no issues.",
      "Do not carry out the action yet. End your turn; you will get a message when it is decided.",
    ].join("\n");
  }

  async decideApproval(
    companyId: string,
    input: unknown,
    locale: StaffLocale,
  ): Promise<StaffApproval> {
    const approvalId = str(input, "approvalId", 80);
    const approve = isRecord(input) && input.decision === "approve";
    const note = str(input, "note", 2_000, "");
    const by = optStr(input, "by", 120) ?? this.me(companyId);
    const state = this.load(companyId);
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (approval === undefined)
      throw new StaffError("not-found", "This approval no longer exists.");
    if (approval.status !== "pending")
      throw new StaffError(
        "invalid-input",
        locale === "ro" ? "Cererea a fost deja decisă." : "This was already decided.",
      );
    if (!approve && note === "")
      throw new StaffError(
        "invalid-input",
        locale === "ro"
          ? "Spune pe scurt de ce respingi, ca agentul să învețe."
          : "Say briefly why, so the agent learns.",
      );
    // Hub v9: on the company runner, a company agent's actions are decided only by a role with
    // "angajați AI: aprobă" (for the company or the agent's project); owners and admins have it.
    const approvalAgent = state.agents.find((item) => item.id === approval.agentId);
    if (approvalAgent?.hub?.source === "runner") {
      const runnerLink = this.hub()?.link(companyId) ?? null;
      if (runnerLink !== null && !mayApproveStaff(runnerLink, approvalAgent.hubProjectId ?? null)) {
        throw new StaffError(
          "forbidden",
          locale === "ro"
            ? "Rolul tău nu poate aproba acțiunile angajaților AI ai firmei (Angajați AI: aprobă)."
            : "Your role cannot approve the company AI staff's actions (AI staff: approve).",
        );
      }
    }
    const decided: StaffApproval = {
      ...approval,
      status: approve ? "approved" : "rejected",
      decidedBy: by,
      decidedAt: this.nowIso(),
      decisionNote: note,
    };
    this.update(companyId, (current) => ({
      ...current,
      approvals: current.approvals.map((item) => (item.id === approvalId ? decided : item)),
      corrections: approve
        ? current.corrections
        : [
            ...current.corrections,
            {
              agentId: approval.agentId,
              kind: "rejection" as const,
              text: `${approval.action} to ${approval.target}: ${note}`,
              at: this.nowIso(),
            },
          ],
    }));
    // Hub v9: a decision on a company agent goes to the company's audit log (metadata only).
    const decidedAgent = state.agents.find((item) => item.id === approval.agentId);
    const link =
      decidedAgent?.hub?.source === "runner" ? (this.hub()?.link(companyId) ?? null) : null;
    if (link !== null && decidedAgent?.hub !== undefined) {
      this.hub()?.reportAudit?.(link.hubCompanyId, [
        {
          action: "approval.decided",
          actorUserId: link.userId,
          staffId: decidedAgent.hub.staffId,
          runId: state.runs.findLast((item) => item.threadId === approval.threadId)?.id ?? null,
          decision: approve ? "approved" : "rejected",
          kind: approval.action,
        },
      ]);
    }
    if (approval.threadId !== null) {
      if (approve) {
        const list = this.allowances.get(approval.threadId) ?? [];
        list.push({
          approvalId,
          action: approval.action,
          expiresAt: this.deps.now().getTime() + ALLOWANCE_MS,
          remaining: 1,
        });
        this.allowances.set(approval.threadId, list);
      }
      const owner = this.agentThreads.get(approval.threadId);
      const projectId =
        owner?.projectId ||
        (await this.deps.threads([approval.threadId]).catch(() => []))[0]?.projectId;
      if (projectId) {
        const text = approve
          ? locale === "ro"
            ? `${by} a aprobat cererea ${approvalId} (${approval.action} către ${approval.target}).${note ? ` Notă: ${note}` : ""}\nFă acum exact acțiunea aprobată, cu conținutul aprobat, apoi apelează staff_record_result.`
            : `${by} approved ${approvalId} (${approval.action} to ${approval.target}).${note ? ` Note: ${note}` : ""}\nCarry out exactly the approved action with the approved content now, then call staff_record_result.`
          : locale === "ro"
            ? `${by} a respins cererea ${approvalId}: ${note}\nNu face acțiunea. Corectează după observație și cere din nou aprobarea dacă e cazul.`
            : `${by} rejected ${approvalId}: ${note}\nDo not carry it out. Fix it as asked and request approval again if needed.`;
        await this.deps
          .send({
            threadId: approval.threadId,
            projectId,
            text,
            key: `${approvalId}:${decided.status}`,
          })
          .catch((cause) => {
            this.deps.log?.("AI staff could not tell the agent about a decision", {
              approvalId,
              cause: String(cause),
            });
          });
      }
      this.updateMentionLater(approval.threadId);
    }
    return decided;
  }

  recordResult(threadId: string, args: Readonly<Record<string, unknown>>): string {
    const owner = this.agentThreads.get(threadId);
    if (owner === undefined) throw new Error("This chat is not an AI staff task.");
    const lines = (value: unknown, max: number) => strList(value, max, 600);
    const trail = {
      summary: typeof args.summary === "string" ? args.summary.trim().slice(0, 4_000) : "",
      explainToBoss: lines(args.explain_to_boss, 3),
      sources: lines(args.sources, 50),
      filesRead: lines(args.files_read, 100),
      steps: lines(args.steps, 50),
      assumptions: lines(args.assumptions, 30),
      files: strList(args.files, MENTION_FILES_MAX, 1_000),
      at: this.nowIso(),
    };
    const state = this.load(owner.companyId);
    const last = state.runs.findLastIndex((run) => run.threadId === threadId);
    const found = last !== -1;
    if (found) {
      this.update(owner.companyId, (current) => ({
        ...current,
        runs: current.runs.map((run, index) => (index === last ? { ...run, trail } : run)),
      }));
    }
    return found
      ? "Recorded. Your manager sees it under the task."
      : "No task record was found for this chat.";
  }

  async handoff(threadId: string, args: Readonly<Record<string, unknown>>): Promise<string> {
    const owner = this.agentThreads.get(threadId);
    if (owner === undefined) throw new Error("This chat is not an AI staff task.");
    const state = this.load(owner.companyId);
    const run = state.runs.findLast((item) => item.threadId === threadId);
    const card = state.cards.find((item) => item.id === run?.cardId || item.threadId === threadId);
    if (card === undefined) return "This task has no card on the board; tell the person instead.";
    const name = foldText(typeof args.to === "string" ? args.to.trim() : "");
    const agent = state.agents.find((item) => foldText(item.name) === name);
    const human = state.humans.find(
      (item) => foldText(item.name) === name || foldText(item.name).split(" ")[0] === name,
    );
    const to: StaffAssignee | null = agent
      ? { kind: "agent", id: agent.id }
      : human
        ? { kind: "human", id: human.id }
        : null;
    if (to === null)
      return `Nobody called "${String(args.to)}" works here. Names: ${[...state.agents, ...state.humans].map((item) => item.name).join(", ")}.`;
    const note = typeof args.note === "string" ? args.note.slice(0, 500) : "";
    const columnId = nextColumn(state.columns, card.columnId, null);
    this.update(owner.companyId, (current) => ({
      ...current,
      cards: current.cards.map((item) =>
        item.id === card.id
          ? {
              ...item,
              assignee: to,
              columnId,
              updatedAt: this.nowIso(),
              handoffs: [
                ...item.handoffs,
                { from: card.assignee, to, columnId, at: this.nowIso(), note },
              ],
            }
          : item,
      ),
    }));
    if (agent !== undefined) {
      const defaults = this.launchDefaults.get(owner.companyId);
      if (defaults !== undefined) {
        const summary = run?.trail?.summary ?? note;
        await this.start({
          companyId: owner.companyId,
          agent,
          text: `${card.title}\n\n${card.description}`.trim(),
          title: card.title,
          cardId: card.id,
          teachMe: false,
          projectId: card.projectId ?? defaults.projectId,
          defaults,
          locale: "ro",
          origin: "card",
          context: `Handed over from the previous step. ${summary}`.slice(0, 4_000),
        }).catch((cause) =>
          this.deps.log?.("AI staff handoff did not start", { cause: String(cause) }),
        );
      }
    }
    return `Handed over to ${agent?.name ?? human!.name}.`;
  }

  // Events: run updates, @mentions and duties.

  async onRunUpdated(threadId: string, terminal: boolean, waiting = false): Promise<void> {
    const owner = this.agentThreads.get(threadId);
    if (owner === undefined) return;
    if (!terminal) {
      await this.updateMention(threadId, waiting);
      return;
    }
    const usage = await this.deps.usage(threadId).catch(() => null);
    if (usage === null) return;
    const before = this.load(owner.companyId).runs;
    const after = this.update(owner.companyId, (state) => ({
      ...state,
      runs: state.runs.map((run) =>
        run.threadId === threadId
          ? {
              ...run,
              status: usage.status,
              endedAt: usage.status === "running" ? null : this.nowIso(),
              durationMs: usage.durationMs,
              tokens: usage.tokens,
            }
          : run,
      ),
    }));
    this.reportFinishedRuns(owner.companyId, before, after);
    await this.updateMention(threadId, true, usage);
  }

  // @mention replies.

  private updateMentionLater(threadId: string): void {
    const work = this.updateMention(threadId, true).finally(() => this.mentionWork.delete(work));
    this.mentionWork.add(work);
  }

  /** Resolves once the mention posts started so far are written (tests, shutdown). */
  async mentionsPosted(): Promise<void> {
    await Promise.all(this.mentionWork);
  }

  /** The files a finished task attaches: listed by the agent, inside its folder, within limits. */
  private async mentionFiles(projectId: string, listed: ReadonlyArray<string>): Promise<string[]> {
    if (listed.length === 0 || projectId === "") return [];
    const root = await this.deps.projectRoot?.(projectId).catch(() => null);
    if (!root) return [];
    let realRoot: string;
    try {
      realRoot = NodeFS.realpathSync(root);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of listed.slice(0, MENTION_FILES_MAX)) {
      try {
        const real = NodeFS.realpathSync(NodePath.resolve(realRoot, entry));
        if (!real.startsWith(`${realRoot}${NodePath.sep}`)) continue;
        const stat = NodeFS.statSync(real);
        if (!stat.isFile() || stat.size === 0 || stat.size > MENTION_FILE_MAX_BYTES) continue;
        if (!files.includes(real)) files.push(real);
      } catch {
        // A file that is not there is left out; the summary still names it.
      }
    }
    return files;
  }

  /**
   * Posts the current state of an @mention task in the chat it came from (one message per task,
   * updated): working, waiting for an approval, the result, or that it did not finish.
   */
  private async updateMention(
    threadId: string,
    immediate: boolean,
    knownUsage?: ThreadUsage | null,
  ): Promise<void> {
    const owner = this.agentThreads.get(threadId);
    if (this.deps.postMention === undefined || owner === undefined) return;
    const state = this.load(owner.companyId);
    const run = state.runs.findLast((item) => item.threadId === threadId);
    if (!run?.replyTo) return;
    const key = `mention:${run.id}`;
    if (!this.mentionDue(key, immediate)) return;
    const agent = state.agents.find((item) => item.id === run.agentId);
    if (agent === undefined) return;
    const { phase, files } = await this.mentionPhase(
      threadId,
      owner.projectId,
      state,
      run,
      knownUsage,
    );
    await this.postMentionPhase({
      key,
      companyId: owner.companyId,
      locale: owner.locale,
      agent,
      phase,
      files,
      originThreadId: run.replyTo.threadId,
      agentThreadId: threadId,
      agentThreadTitle: `${agent.name}: ${run.title}`.slice(0, 120),
      onRunner: false,
    });
  }

  private mentionDue(key: string, immediate: boolean): boolean {
    const last = this.mentionPosted.get(key);
    return (
      immediate ||
      last === undefined ||
      this.deps.now().getTime() - last.at >= MENTION_UPDATE_EVERY_MS
    );
  }

  /** Where a task stands, for its @mention reply (here, or on the runner for `staff.run`). */
  private async mentionPhase(
    threadId: string,
    projectId: string,
    state: StaffState,
    run: StaffTaskRun,
    knownUsage?: ThreadUsage | null,
  ): Promise<{ phase: MentionPhase; files: string[] }> {
    const agent = state.agents.find((item) => item.id === run.agentId);
    const pending = state.approvals.findLast(
      (item) => item.threadId === threadId && item.status === "pending",
    );
    const usage =
      knownUsage !== undefined ? knownUsage : await this.deps.usage(threadId).catch(() => null);
    if (pending !== undefined) {
      return {
        phase: {
          kind: "waiting-approval",
          action: pending.action,
          target: pending.target,
          manager: state.humans.find((human) => human.id === agent?.managerId)?.name ?? null,
        },
        files: [],
      };
    }
    if ((usage?.pendingRequests ?? []).length > 0) {
      return { phase: { kind: "waiting-request", prompt: usage!.pendingRequests![0]! }, files: [] };
    }
    if (usage === null || usage.status === "running") {
      const nowMs = this.deps.now().getTime();
      return {
        phase: {
          kind: "working",
          minutes: Math.max(0, Math.floor((nowMs - Date.parse(run.startedAt)) / 60_000)),
        },
        files: [],
      };
    }
    if (usage.status === "completed") {
      const files = await this.mentionFiles(projectId, run.trail?.files ?? []);
      return {
        phase: {
          kind: "done",
          summary: run.trail?.summary || (usage.lastAnswer ?? "").trim().slice(0, 1_500),
          explainToBoss: run.trail?.explainToBoss ?? [],
          fileNames: files.map((file) => NodePath.basename(file)),
        },
        files,
      };
    }
    return { phase: { kind: "failed" }, files: [] };
  }

  /** Writes (or updates) the one message of an @mention task in the chat it came from. */
  private async postMentionPhase(input: {
    readonly key: string;
    readonly companyId: string;
    readonly locale: StaffLocale;
    readonly agent: StaffAgent;
    readonly phase: MentionPhase;
    readonly files: ReadonlyArray<string>;
    readonly originThreadId: string;
    readonly agentThreadId: string;
    readonly agentThreadTitle: string;
    readonly onRunner: boolean;
  }): Promise<void> {
    const post = this.deps.postMention;
    if (post === undefined) return;
    const { agent, phase, key } = input;
    const texts = mentionTexts({
      locale: input.locale,
      agentName: agent.name,
      role: agent.role,
      phase,
      agentThreadId: input.agentThreadId,
      agentThreadTitle: input.agentThreadTitle,
      onRunner: input.onRunner,
    });
    const fingerprint = `${texts.markdown}\n${input.files.join("\n")}`;
    if (this.mentionPosted.get(key)?.text === fingerprint) return;
    this.mentionPosted.set(key, { text: fingerprint, at: this.deps.now().getTime() });
    if (this.mentionPosted.size > 2_000) {
      const oldest = this.mentionPosted.keys().next().value;
      if (oldest !== undefined) this.mentionPosted.delete(oldest);
    }
    await post({
      originThreadId: input.originThreadId,
      agentThreadId: input.agentThreadId,
      agentThreadTitle: input.agentThreadTitle,
      key,
      agentName: agent.name,
      companyId: input.companyId,
      markdown: texts.markdown,
      platformMarkdown: texts.platformMarkdown,
      files: [...input.files],
      final: phase.kind === "done" || phase.kind === "failed",
    }).catch((cause) =>
      this.deps.log?.("AI staff could not post a mention reply", { cause: String(cause) }),
    );
  }

  /**
   * A member's machine: brings the replies of @mentions given to hub agents up to date from the
   * company runner (`staff.run`). Called every 15 s by ZenStaff.ts; ends a mention when it is
   * done, failed, or 12 hours old.
   */
  async pollRemoteMentions(): Promise<void> {
    if (this.pollingRemote) return;
    this.pollingRemote = true;
    try {
      await this.pollRemoteMentionsOnce();
    } finally {
      this.pollingRemote = false;
    }
  }

  private async pollRemoteMentionsOnce(): Promise<void> {
    for (const [key, item] of this.remoteMentions) {
      const nowMs = this.deps.now().getTime();
      if (nowMs - Date.parse(item.startedAt) > REMOTE_MENTION_MAX_MS) {
        this.remoteMentions.delete(key);
        continue;
      }
      const bridge = this.hub();
      const agent = this.load(item.companyId).agents.find(
        (candidate) => candidate.hub?.staffId === item.staffId,
      );
      if (bridge === null || agent === undefined) {
        this.remoteMentions.delete(key);
        continue;
      }
      let phase: MentionPhase;
      try {
        const answer = await bridge.staffRun({
          localCompanyId: item.companyId,
          staffId: item.staffId,
          runId: item.runId,
        });
        const parsed = parseRemotePhase(answer.phase);
        if (parsed === null) continue;
        phase = parsed;
      } catch {
        // Runner offline or busy: the last post stays; try again on the next round.
        continue;
      }
      if (phase.kind === "done" || phase.kind === "failed") this.remoteMentions.delete(key);
      await this.postMentionPhase({
        key,
        companyId: item.companyId,
        locale: item.locale,
        agent,
        phase,
        files: [],
        originThreadId: item.replyTo.threadId,
        agentThreadId: item.runnerThreadId,
        agentThreadTitle: item.title,
        onRunner: true,
      });
    }
  }

  /** Runner: where a task given through the hub stands, for the member who gave it (`staff.run`). */
  async runForHub(input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly runId: string;
    readonly actorUserId: string;
  }): Promise<{ phase: MentionPhase }> {
    const state = this.load(input.localCompanyId);
    const agent = state.agents.find((item) => item.hub?.staffId === input.staffId);
    const run = state.runs.find((item) => item.id === input.runId);
    if (
      agent === undefined ||
      agent.hub?.source !== "runner" ||
      run === undefined ||
      run.agentId !== agent.id ||
      (run.requestedBy ?? null) !== input.actorUserId
    ) {
      throw new StaffError("not-found", "This task is not on the company runner.");
    }
    const projectId = this.agentThreads.get(run.threadId)?.projectId ?? agent.projectId ?? "";
    const { phase } = await this.mentionPhase(run.threadId, projectId, state, run);
    return { phase };
  }

  /** A user message: registers scheduled duty threads, and hands `@Agent` requests to agents. */
  async onUserMessage(message: {
    readonly id: string;
    readonly threadId: string;
    readonly text: string;
    readonly scheduledTaskId: string | null;
    readonly createdBy: string;
  }): Promise<void> {
    if (this.handledMessages.has(message.id)) return;
    this.handledMessages.add(message.id);
    if (this.handledMessages.size > 5_000) this.handledMessages.clear();
    const marker = parseAgentMarker(message.text);
    if (marker !== null) {
      if (this.agentThreads.has(message.threadId)) return;
      const state =
        this.states.has(marker.companyId) || this.companyIdsOnDisk().includes(marker.companyId)
          ? this.load(marker.companyId)
          : null;
      const agent = state?.agents.find((item) => item.id === marker.agentId);
      if (state === null || agent === undefined) return;
      const info = (await this.deps.threads([message.threadId]).catch(() => []))[0];
      this.agentThreads.set(message.threadId, {
        agentId: agent.id,
        companyId: marker.companyId,
        projectId: info?.projectId ?? "",
        locale: /[ăâîșț]/i.test(message.text) ? "ro" : "en",
      });
      const duty = agent.duties.find(
        (item) => item.scheduledTaskId !== null && item.scheduledTaskId === message.scheduledTaskId,
      );
      this.update(marker.companyId, (current) => ({
        ...current,
        runs: [
          ...current.runs,
          {
            id: newId("run"),
            agentId: agent.id,
            threadId: message.threadId,
            cardId: null,
            title:
              duty?.title ??
              (message.text.split("Task:").at(-1) ?? "").trim().split("\n")[0]!.slice(0, 80),
            origin: message.scheduledTaskId !== null ? "duty" : "task",
            teachMe: false,
            startedAt: this.nowIso(),
            endedAt: null,
            status: "running",
            durationMs: null,
            tokens: null,
            trail: null,
          },
        ],
      }));
      return;
    }
    if (
      message.createdBy !== "user" ||
      this.agentThreads.has(message.threadId) ||
      !message.text.includes("@")
    )
      return;
    const info = (await this.deps.threads([message.threadId]).catch(() => []))[0];
    if (info === undefined) return;
    const companyId = this.companies().projects[info.projectId] ?? PERSONAL_COMPANY_ID;
    if (!this.companyIdsOnDisk().includes(companyId)) return;
    const state = this.load(companyId);
    for (const agent of findMentionedAgents(message.text, state.agents)) {
      const now = this.nowIso();
      const card: StaffCard = {
        id: newId("card"),
        title: mentionTitle(message.text, agent.name),
        description: message.text.slice(0, 4_000),
        columnId: state.columns[0]!.id,
        assignee: { kind: "agent", id: agent.id },
        projectId: info.projectId,
        threadId: null,
        handoffs: [
          {
            from: null,
            to: { kind: "agent", id: agent.id },
            columnId: state.columns[0]!.id,
            at: now,
            note: `@${agent.name} in "${info.title}"`,
          },
        ],
        origin: "mention",
        createdAt: now,
        updatedAt: now,
      };
      this.update(companyId, (current) => ({ ...current, cards: [...current.cards, card] }));
      await this.start({
        companyId,
        agent,
        text: message.text,
        title: card.title.slice(0, 80),
        cardId: card.id,
        teachMe: false,
        projectId: info.projectId,
        defaults: {
          modelSelection: info.modelSelection,
          runtimeMode: info.runtimeMode ?? "auto-accept-edits",
          projectId: info.projectId,
        },
        locale: /[ăâîșț]/i.test(message.text) ? "ro" : "en",
        origin: "mention",
        context: `Asked in the chat "${info.title}" (thread ${info.id}). Your result is posted back in that chat: record it with staff_record_result (with the files you made for the person).`,
        replyTo: { threadId: info.id, title: info.title },
      }).catch((cause) =>
        this.deps.log?.("AI staff mention did not start", {
          agent: agent.id,
          cause: String(cause),
        }),
      );
    }
  }

  // Ratings, evaluation, self-improvement, weekly reports.

  addRating(companyId: string, input: unknown) {
    const agent = this.agentOf(companyId, str(input, "agentId", 80));
    const thumbs: "up" | "down" | null =
      isRecord(input) && (input.thumbs === "up" || input.thumbs === "down") ? input.thumbs : null;
    const scoreRaw = optNumber(isRecord(input) ? input.score : null, 1, 5);
    const score = scoreRaw === null ? null : Math.round(scoreRaw);
    if (thumbs === null && score === null)
      throw new StaffError("invalid-input", "Give a thumb or a score.");
    const comment = str(input, "comment", 2_000, "");
    const rating = {
      id: newId("rate"),
      agentId: agent.id,
      threadId: optStr(input, "threadId", 120),
      by: optStr(input, "by", 120) ?? this.me(companyId),
      thumbs,
      score,
      comment,
      at: this.nowIso(),
    };
    const negative = thumbs === "down" || (score !== null && score <= 2);
    this.update(companyId, (state) => ({
      ...state,
      ratings: [...state.ratings, rating],
      corrections:
        negative && comment !== ""
          ? [
              ...state.corrections,
              { agentId: agent.id, kind: "rating" as const, text: comment, at: rating.at },
            ]
          : state.corrections,
    }));
    return rating;
  }

  async evaluation(companyId: string, month: string | null) {
    await this.refreshRuns(companyId);
    const state = this.load(companyId);
    const key = month !== null && /^\d{4}-\d{2}$/.test(month) ? month : this.nowIso().slice(0, 7);
    return evaluateMonth({
      month: key,
      agents: state.agents,
      runs: state.runs,
      approvals: state.approvals,
      ratings: state.ratings,
      settings: state.settings,
    });
  }

  async proposeImprovement(companyId: string, agentId: string, locale: StaffLocale) {
    const agent = this.agentOf(companyId, agentId);
    const state = this.load(companyId);
    const since = state.proposals.findLast((item) => item.agentId === agentId)?.createdAt ?? "";
    const corrections = state.corrections.filter(
      (item) => item.agentId === agentId && item.at > since,
    );
    if (corrections.length === 0) {
      throw new StaffError(
        "invalid-input",
        locale === "ro"
          ? "Nu există corecturi noi de la ultima propunere."
          : "No new corrections since the last proposal.",
      );
    }
    const raw = await this.deps.generate(
      improvePrompt({
        agentName: agent.name,
        role: agent.role,
        instructions: agent.instructions,
        corrections,
        locale,
      }),
    );
    const parsed = parseImprove(raw);
    if (parsed === null)
      throw new StaffError(
        "unavailable",
        locale === "ro"
          ? "Modelul nu a dat o propunere validă. Încearcă din nou."
          : "The model gave no usable proposal. Try again.",
      );
    const proposal = {
      id: newId("prop"),
      agentId,
      proposed: parsed.instructions,
      changes: parsed.changes,
      basedOn: corrections.length,
      status: "pending" as const,
      createdAt: this.nowIso(),
    };
    this.update(companyId, (current) => ({
      ...current,
      proposals: [...current.proposals, proposal],
    }));
    return proposal;
  }

  decideImprovement(companyId: string, proposalId: string, approve: boolean) {
    const state = this.load(companyId);
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (proposal === undefined || proposal.status !== "pending")
      throw new StaffError("not-found", "This proposal is no longer open.");
    this.update(companyId, (current) => ({
      ...current,
      proposals: current.proposals.map((item) =>
        item.id === proposalId
          ? { ...item, status: approve ? ("approved" as const) : ("rejected" as const) }
          : item,
      ),
      agents: approve
        ? current.agents.map((agent) =>
            agent.id === proposal.agentId
              ? {
                  ...agent,
                  instructions: proposal.proposed,
                  instructionsVersion: agent.instructionsVersion + 1,
                  updatedAt: this.nowIso(),
                }
              : agent,
          )
        : current.agents,
    }));
    return { ok: true };
  }

  weeklyReports(companyId: string, agentId: string | null, locale: StaffLocale, nowMs: number) {
    const state = this.load(companyId);
    const start = weekStart(nowMs);
    const agents = state.agents.filter((agent) => agentId === null || agent.id === agentId);
    const reports = agents.map((agent) => ({
      id: newId("report"),
      agentId: agent.id,
      managerId: agent.managerId,
      weekStart: new Date(start).toISOString(),
      text: weeklyReportText({
        agent,
        weekStartMs: start,
        runs: state.runs,
        approvals: state.approvals,
        ratings: state.ratings,
        locale,
      }),
      createdAt: this.nowIso(),
    }));
    this.update(companyId, (current) => ({
      ...current,
      reports: [
        ...current.reports.filter(
          (report) =>
            !reports.some(
              (item) => item.agentId === report.agentId && item.weekStart === report.weekStart,
            ),
        ),
        ...reports,
      ],
    }));
    return reports;
  }

  /** Mondays after 08:00: last week's report for every agent that has none yet. */
  autoWeeklyReports(): void {
    const now = this.deps.now();
    if (now.getDay() !== 1 || now.getHours() < 8) return;
    const lastWeek = weekStart(now.getTime()) - 3 * 24 * 60 * 60 * 1000;
    for (const companyId of this.companyIdsOnDisk()) {
      const state = this.load(companyId);
      const iso = new Date(weekStart(lastWeek)).toISOString();
      const missing = state.agents.filter(
        (agent) =>
          !state.reports.some((report) => report.agentId === agent.id && report.weekStart === iso),
      );
      for (const agent of missing) this.weeklyReports(companyId, agent.id, "ro", lastWeek);
    }
  }

  // Discovery, checker, personas.

  async discovery(companyId: string) {
    const state = this.load(companyId);
    if (!state.settings.discoveryOptIn) {
      throw new StaffError(
        "forbidden",
        'Turn on "Find repeated work" in AI staff > Settings first.',
      );
    }
    const { projects } = this.companies();
    const all = await this.deps.threads(null);
    const sinceMs = this.deps.now().getTime() - 120 * 24 * 60 * 60 * 1000;
    const mine = all
      .filter(
        (thread) =>
          (projects[thread.projectId] ?? PERSONAL_COMPANY_ID) === companyId &&
          thread.createdAtMs >= sinceMs &&
          !this.agentThreads.has(thread.id),
      )
      .toSorted((left, right) => right.createdAtMs - left.createdAtMs)
      .slice(0, 400);
    const me = this.me(companyId);
    const items: DiscoveryItem[] = [];
    for (const thread of mine) {
      const usage = await this.deps.usage(thread.id).catch(() => null);
      const text = usage?.firstUserText ?? thread.title;
      if (!text || parseAgentMarker(text) !== null) continue;
      const author = /^([^\n(]{2,60}) \([^)\s]+@[^)\s]+\):\n/.exec(text);
      items.push({
        threadId: thread.id,
        createdAtMs: thread.createdAtMs,
        text: author ? text.slice(author[0].length) : text,
        person: author?.[1]?.trim() ?? me,
        minutes: usage?.minutesSpan ?? null,
      });
    }
    return discoverRepeatedWork(
      [...items, ...(this.deps.extraHistory?.() ?? [])],
      this.deps.workflows(),
    );
  }

  private memoryText(companyId: string): string {
    const dir = this.companies().memoryDirs[companyId];
    if (!dir) return "";
    let out = "";
    try {
      for (const name of NodeFS.readdirSync(dir)) {
        if (!name.endsWith(".md")) continue;
        out += `\n# ${name}\n${NodeFS.readFileSync(NodePath.join(dir, name), "utf8").slice(0, 20_000)}`;
        if (out.length > 60_000) break;
      }
    } catch {
      return out;
    }
    return out;
  }

  async check(
    companyId: string,
    content: string,
    action: StaffOutboundKind,
    target: string,
    locale: StaffLocale,
    aiOverride: boolean | null,
  ) {
    const state = this.load(companyId);
    const input = {
      content,
      action,
      target,
      brand: state.settings.brand,
      memoryPrices: extractPriceLines(this.memoryText(companyId)),
      locale,
    };
    const rules = runCheckerRules(input);
    const useAi = aiOverride ?? state.settings.checkerAi;
    let ai = null;
    if (useAi) {
      try {
        ai = parseAiFindings(await this.deps.generate(checkerAiPrompt(input)));
      } catch (cause) {
        this.deps.log?.("AI staff checker AI pass skipped", { cause: String(cause) });
      }
    }
    return mergeCheckerResult(rules, ai, this.nowIso());
  }

  async buildPersonas(companyId: string, sources: string, count: number, locale: StaffLocale) {
    const memory = this.memoryText(companyId);
    if (sources.trim() === "" && memory.trim() === "") {
      throw new StaffError(
        "invalid-input",
        locale === "ro"
          ? "Lipește recenzii, un export CRM sau notițe despre clienți."
          : "Paste reviews, a CRM export or notes about customers.",
      );
    }
    const raw = await this.deps.generate(
      personasPrompt({
        companyName: this.companies().names[companyId] ?? companyId,
        sources,
        memory,
        count,
        locale,
      }),
    );
    const personas = parsePersonas(raw, newId("persona"));
    if (personas.length === 0)
      throw new StaffError(
        "unavailable",
        locale === "ro"
          ? "Modelul nu a dat persoane valide. Încearcă din nou."
          : "The model gave no usable personas. Try again.",
      );
    this.update(companyId, (state) => ({ ...state, personas }));
    return personas;
  }

  async askPanel(companyId: string, question: string, locale: StaffLocale) {
    const personas = this.load(companyId).personas;
    if (personas.length === 0)
      throw new StaffError(
        "invalid-input",
        locale === "ro"
          ? "Construiește întâi panelul de clienți."
          : "Build the customer panel first.",
      );
    const answers = parsePanel(
      await this.deps.generate(panelPrompt({ personas, question, locale })),
    );
    if (answers.length === 0)
      throw new StaffError(
        "unavailable",
        locale === "ro"
          ? "Panelul nu a răspuns. Încearcă din nou."
          : "The panel did not answer. Try again.",
      );
    return { question, answers };
  }

  /** The `zen-staff` MCP backend for one agent thread, or null. */

  // Hub v6: AI staff as a company object. The profile lives on the hub (sealed to the company
  // runners, signed by the editor); the runner runs the agent and its duties, every other member's
  // machine keeps a copy that follows the hub and sends tasks to the runner.

  private hub(): CompanyHubBridge | null {
    return (this.deps.companyHub ?? zenCompanyHubBridge)();
  }

  private hubInfo(companyId: string): StaffHubInfo | null {
    const bridge = this.hub();
    const link = bridge?.link(companyId) ?? null;
    if (bridge === null || link === null) return null;
    return {
      hubCompanyId: link.hubCompanyId,
      role: link.role,
      myUserId: link.userId,
      canAdminister:
        link.role === "owner" ||
        link.role === "admin" ||
        (link.role === "member" && zenHubCan(link.access ?? null, "angajati:administreaza")),
      access: link.access ?? null,
      ...bridge.staffSync(companyId),
    };
  }

  private hubLinkOrFail(companyId: string, locale: StaffLocale) {
    const bridge = this.hub();
    const link = bridge?.link(companyId) ?? null;
    if (bridge === null || link === null) {
      throw new StaffError(
        "forbidden",
        locale === "ro"
          ? "Firma nu e legată de o firmă din hub. Leag-o din pagina Echipă, apoi încearcă din nou."
          : "This company is not linked to a hub company. Link it on the Team page, then try again.",
      );
    }
    return { bridge, link };
  }

  private hubAdminOrFail(
    link: { readonly role: string | null; readonly access?: ZenHubAccess | null },
    locale: StaffLocale,
    what: "publish" | "create" | "delete",
    /** The agent's hub project: a role with "angajati:administreaza" there may do it too. */
    hubProjectId: string | null = null,
  ) {
    if (link.role === "owner" || link.role === "admin") return;
    if (link.role === "member" && mayAdministerStaff(link.access, hubProjectId)) return;
    const text = {
      publish: {
        ro: "Doar proprietarii și administratorii firmei pot publica un angajat AI pentru firmă.",
        en: "Only the company's owners and admins can publish an AI employee to the company.",
      },
      create: {
        ro: "Doar proprietarii și administratorii firmei pot adăuga angajați AI ai firmei.",
        en: "Only the company's owners and admins can add company AI employees.",
      },
      delete: {
        ro: "Doar proprietarii și administratorii firmei pot concedia un angajat AI al firmei.",
        en: "Only the company's owners and admins can remove a company AI employee.",
      },
    }[what];
    throw new StaffError("forbidden", text[locale]);
  }

  private managerNameOf(companyId: string, managerId: string | null): string | null {
    if (managerId === null) return null;
    return this.load(companyId).humans.find((human) => human.id === managerId)?.name ?? null;
  }

  /** Runner: the folder a hub agent works in when it has none here (the company's first one). */
  private fallbackProject(companyId: string): string | null {
    const projects = this.companies().projects;
    return Object.keys(projects).find((projectId) => projects[projectId] === companyId) ?? null;
  }

  private runnerDefaults(companyId: string): LaunchDefaults {
    return (
      this.launchDefaults.get(companyId) ?? {
        modelSelection: null,
        runtimeMode: "auto-accept-edits",
        projectId: this.fallbackProject(companyId),
      }
    );
  }

  /** Removes this machine's scheduled tasks of an agent (its duties run on the runner now). */
  private async dropDuties(agent: StaffAgent): Promise<StaffAgent> {
    for (const duty of agent.duties) {
      if (duty.scheduledTaskId !== null) {
        await this.deps.deleteDuty(duty.scheduledTaskId).catch(() => undefined);
      }
    }
    return { ...agent, duties: agent.duties.map((duty) => ({ ...duty, scheduledTaskId: null })) };
  }

  private replaceAgent(companyId: string, agent: StaffAgent) {
    this.update(companyId, (current) => ({
      ...current,
      agents: current.agents.some((item) => item.id === agent.id)
        ? current.agents.map((item) => (item.id === agent.id ? agent : item))
        : [...current.agents, agent],
    }));
  }

  /** "Publish to company": the local agent becomes a company object; the copy follows the hub. */
  async publishAgent(
    companyId: string,
    agentId: string,
    locale: StaffLocale,
    defaults: LaunchDefaults,
  ): Promise<StaffAgent> {
    const agent = this.agentOf(companyId, agentId);
    if (agent.hub !== undefined) {
      throw new StaffError(
        "invalid-input",
        locale === "ro"
          ? "Angajatul e deja al firmei."
          : "This AI employee already belongs to the company.",
      );
    }
    const { bridge, link } = this.hubLinkOrFail(companyId, locale);
    // Hub v9: published from a project, the agent belongs to that hub project (scoped roles);
    // without one it is the whole company's.
    const hubProjectId = agent.hubProjectId ?? agent.projectId ?? null;
    this.hubAdminOrFail(link, locale, "publish", hubProjectId);
    // The manager must be a hub person; a local one (or nobody) becomes the person publishing.
    const managerUserId = hubUserOfManager(agent.managerId) ?? link.userId;
    const managerId = managerIdOfHubUser(managerUserId);
    const staffId = `s-${NodeCrypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const shaped: StaffAgent = {
      ...agent,
      kind: "company",
      owner: null,
      managerId,
      hubProjectId,
    };
    const saved = await bridge.publishStaff({
      localCompanyId: companyId,
      staffId,
      agent: shaped,
      managerUserId,
      managerName: this.managerNameOf(companyId, agent.managerId) ?? this.me(companyId),
      baseVersion: 0,
    });
    const hubLink: StaffHubLink = {
      companyId: link.hubCompanyId,
      staffId,
      version: saved.version,
      managerUserId,
      updatedBy: this.me(companyId),
      updatedAt: saved.updatedAt,
      source: link.isRunner ? "runner" : "mirror",
    };
    let next: StaffAgent = { ...shaped, hub: hubLink };
    next = link.isRunner
      ? await this.syncDuties(companyId, agent, next, defaults, locale)
      : await this.dropDuties(next);
    this.replaceAgent(companyId, next);
    void bridge.syncNow().catch(() => undefined);
    return next;
  }

  /** Saving a hub agent: owners/admins, or its manager; the hub keeps the newest version. */
  private async saveHubAgent(
    companyId: string,
    existing: StaffAgent & { readonly hub: StaffHubLink },
    raw: unknown,
    locale: StaffLocale,
    defaults: LaunchDefaults,
  ): Promise<StaffAgent> {
    const { bridge, link } = this.hubLinkOrFail(companyId, locale);
    const owner = link.role === "owner" || link.role === "admin";
    const hubProjectId = existing.hubProjectId ?? null;
    // Hub v9: "angajați AI: administrează" for the company, or for this agent's project.
    const administers =
      owner || (link.role === "member" && mayAdministerStaff(link.access, hubProjectId));
    const manages = link.role === "member" && existing.hub.managerUserId === link.userId;
    if (!administers && !manages) {
      throw new StaffError(
        "forbidden",
        locale === "ro"
          ? "Doar proprietarii, administratorii, managerul angajatului și rolurile cu „Angajați AI: administrează” îi pot schimba fișa."
          : "Only owners, admins, the agent's manager and roles with “AI staff: manage” can change its profile.",
      );
    }
    const normalized = normalizeAgentInput(
      { ...(isRecord(raw) ? raw : {}), kind: "company" },
      existing,
      { id: existing.id, companyId, now: this.nowIso() },
    );
    // A manager cannot hand the agent to someone else; an admin picks any hub person.
    const managerUserId = administers
      ? (hubUserOfManager(normalized.managerId) ?? existing.hub.managerUserId)
      : existing.hub.managerUserId;
    const agent: StaffAgent = {
      ...normalized,
      kind: "company",
      owner: null,
      projectId: normalized.projectId ?? existing.projectId,
      managerId: managerIdOfHubUser(managerUserId),
      // The hub project stays (a scoped role cannot move an agent out of its project).
      hubProjectId,
    };
    const saved = await bridge.publishStaff({
      localCompanyId: companyId,
      staffId: existing.hub.staffId,
      agent,
      managerUserId,
      managerName: this.managerNameOf(companyId, agent.managerId),
      baseVersion: existing.hub.version,
    });
    let next: StaffAgent = {
      ...agent,
      hub: {
        ...existing.hub,
        version: saved.version,
        managerUserId,
        updatedBy: this.me(companyId),
        updatedAt: saved.updatedAt,
      },
    };
    next =
      existing.hub.source === "runner"
        ? await this.syncDuties(companyId, existing, next, defaults, locale)
        : { ...next, duties: next.duties.map((duty) => ({ ...duty, scheduledTaskId: null })) };
    this.replaceAgent(companyId, next);
    void bridge.syncNow().catch(() => undefined);
    return next;
  }

  private async deleteHubAgent(companyId: string, agent: StaffAgent): Promise<void> {
    const { bridge, link } = this.hubLinkOrFail(companyId, "ro");
    this.hubAdminOrFail(link, "ro", "delete", agent.hubProjectId ?? null);
    await bridge.publishStaff({
      localCompanyId: companyId,
      staffId: agent.hub!.staffId,
      agent: null,
      managerUserId: agent.hub!.managerUserId,
      managerName: null,
      baseVersion: agent.hub!.version,
    });
    void bridge.syncNow().catch(() => undefined);
  }

  /** A member's machine: the task goes to the company runner, which starts the agent's thread. */
  private async taskOnRunner(input: {
    readonly companyId: string;
    readonly agent: StaffAgent;
    readonly text: string;
    readonly title: string | null;
    readonly locale: StaffLocale;
    readonly replyTo?: StaffMentionReply | null;
  }): Promise<{ threadId: string; runId: string; onRunner?: true }> {
    const { bridge } = this.hubLinkOrFail(input.companyId, input.locale);
    try {
      const sent = await bridge.sendStaffTask({
        localCompanyId: input.companyId,
        staffId: input.agent.hub!.staffId,
        text: input.text,
        title: input.title,
      });
      // An @mention here: the reply in this chat follows the run on the runner (`staff.run`).
      if (input.replyTo && sent.runId !== "") {
        const key = `mention:${sent.runId}`;
        const item: RemoteMention = {
          companyId: input.companyId,
          staffId: input.agent.hub!.staffId,
          runId: sent.runId,
          runnerThreadId: sent.threadId,
          replyTo: input.replyTo,
          title:
            `${input.agent.name}: ${input.title ?? input.text.split("\n")[0]!.slice(0, 80)}`.slice(
              0,
              120,
            ),
          locale: input.locale,
          startedAt: this.nowIso(),
        };
        this.remoteMentions.set(key, item);
        const work = this.postMentionPhase({
          key,
          companyId: item.companyId,
          locale: item.locale,
          agent: input.agent,
          phase: { kind: "working", minutes: 0 },
          files: [],
          originThreadId: item.replyTo.threadId,
          agentThreadId: item.runnerThreadId,
          agentThreadTitle: item.title,
          onRunner: true,
        }).finally(() => this.mentionWork.delete(work));
        this.mentionWork.add(work);
      }
      // The thread lives on the runner: this machine cannot open it.
      return { ...sent, onRunner: true };
    } catch (cause) {
      throw new StaffError(
        "needs-runner",
        input.locale === "ro"
          ? `Sarcina nu a ajuns la serverul firmei: ${cause instanceof Error ? cause.message : String(cause)}`
          : `The task did not reach the company runner: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  /** Hub port: applies verified profiles (runner: schedules duties; copy: no duties here). */
  async applyHub(input: {
    readonly localCompanyId: string;
    readonly hubCompanyId: string;
    readonly source: "runner" | "mirror";
    readonly items: ReadonlyArray<HubStaffApply & { readonly status?: string }>;
    readonly complete: boolean;
  }): Promise<void> {
    const companyId = input.localCompanyId;
    const state = this.load(companyId);
    const byStaff = new Map(
      state.agents.flatMap((agent) => (agent.hub ? [[agent.hub.staffId, agent] as const] : [])),
    );
    const keep = new Set(input.items.map((item) => item.staffId));
    const defaults = this.runnerDefaults(companyId);
    const results: StaffAgent[] = [];
    const removed: StaffAgent[] = [];
    for (const item of input.items) {
      const existing = byStaff.get(item.staffId) ?? null;
      if (item.deleted || item.profile === null) {
        if (existing !== null) removed.push(existing);
        continue;
      }
      const hubLink: StaffHubLink = {
        companyId: input.hubCompanyId,
        staffId: item.staffId,
        version: item.version,
        managerUserId: item.managerUserId,
        updatedBy: item.updatedBy,
        updatedAt: item.updatedAt,
        source: input.source,
      };
      const shaped = fromHubProfile(item.profile, {
        localCompanyId: companyId,
        existing,
        fallbackProjectId: input.source === "runner" ? this.fallbackProject(companyId) : null,
        hub: hubLink,
      });
      // Checked like any saved profile (lengths, lists, times); the hub's version wins.
      const normalized = normalizeAgentInput(shaped, existing, {
        id: shaped.id,
        companyId,
        now: this.nowIso(),
      });
      let agent: StaffAgent = {
        ...normalized,
        kind: "company",
        owner: null,
        projectId: shaped.projectId,
        // Hub v9: the agent's hub project, from the signed profile (absent: the whole company).
        hubProjectId: typeof shaped.hubProjectId === "string" ? shaped.hubProjectId : null,
        managerId: managerIdOfHubUser(item.managerUserId),
        instructionsVersion: item.profile.instructionsVersion,
        createdAt: item.profile.createdAt,
        updatedAt: item.updatedAt,
        hub: hubLink,
      };
      if (input.source === "runner") {
        agent = await this.syncDuties(
          companyId,
          existing,
          agent,
          defaults,
          profileLocale(item.profile),
        );
      } else {
        if (existing !== null) await this.dropDuties(existing);
        agent = {
          ...agent,
          duties: agent.duties.map((duty) => ({ ...duty, scheduledTaskId: null })),
        };
        if (item.status !== undefined && isAgentStatus(item.status)) {
          this.remoteStatus.set(`${companyId}:${agent.id}`, item.status);
        }
      }
      results.push(agent);
    }
    if (input.complete) {
      for (const [staffId, agent] of byStaff) if (!keep.has(staffId)) removed.push(agent);
    }
    for (const agent of removed) {
      for (const duty of agent.duties) {
        if (duty.scheduledTaskId !== null)
          await this.deps.deleteDuty(duty.scheduledTaskId).catch(() => undefined);
      }
      this.remoteStatus.delete(`${companyId}:${agent.id}`);
    }
    if (results.length === 0 && removed.length === 0) return;
    const removedIds = new Set(removed.map((agent) => agent.id));
    this.update(companyId, (current) => {
      let agents = current.agents.filter((agent) => !removedIds.has(agent.id));
      for (const agent of results) {
        agents = agents.some((item) => item.id === agent.id)
          ? agents.map((item) => (item.id === agent.id ? agent : item))
          : [...agents, agent];
      }
      return {
        ...current,
        agents,
        cards: current.cards.map((card) =>
          card.assignee?.kind === "agent" && removedIds.has(card.assignee.id)
            ? { ...card, assignee: null }
            : card,
        ),
      };
    });
  }

  /** Hub port: what this machine applied, per hub agent. */
  appliedHub(
    companyId: string,
  ): Record<
    string,
    { version: number; managerUserId: string | null; hubProjectId: string | null }
  > {
    if (!COMPANY_ID.test(companyId)) return {};
    return Object.fromEntries(
      this.load(companyId).agents.flatMap((agent) =>
        agent.hub
          ? [
              [
                agent.hub.staffId,
                {
                  version: agent.hub.version,
                  managerUserId: agent.hub.managerUserId,
                  hubProjectId: agent.hubProjectId ?? null,
                },
              ],
            ]
          : [],
      ),
    );
  }

  /** Hub port (runner): the company's hub agents with their status, for members' copies. */
  async listHubForMembers(companyId: string) {
    const overview = await this.overview(companyId, "ro");
    return overview.agents.flatMap((agent) => {
      if (agent.hub === undefined) return [];
      const { status, ...plain } = agent;
      return [
        {
          staffId: agent.hub.staffId,
          version: agent.hub.version,
          managerUserId: agent.hub.managerUserId,
          updatedBy: agent.hub.updatedBy,
          updatedAt: agent.hub.updatedAt,
          profile: toHubProfile(plain, {
            staffId: agent.hub.staffId,
            managerName: this.managerNameOf(companyId, agent.managerId),
          }),
          status,
        },
      ];
    });
  }

  /** Hub port (runner): a task a member gave through the hub. */
  async startFromHub(input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly text: string;
    readonly title: string | null;
    readonly actor: { readonly name: string; readonly email: string; readonly userId?: string };
    readonly starterPermissions?: ReadonlyArray<string> | null;
    readonly scope?: (hubProjectId: string | null) => {
      readonly refusal: string | null;
      readonly permissions: ReadonlyArray<string> | null;
    };
  }): Promise<{ threadId: string; runId: string }> {
    const companyId = input.localCompanyId;
    const agent = this.load(companyId).agents.find((item) => item.hub?.staffId === input.staffId);
    if (agent === undefined || agent.hub?.source !== "runner") {
      throw new StaffError("not-found", "This AI employee is not on the company runner yet.");
    }
    // Hub v9: a role scoped to a project gives tasks only to that project's agents.
    const scoped = input.scope?.(agent.hubProjectId ?? null) ?? null;
    if (scoped?.refusal != null) throw new StaffError("forbidden", scoped.refusal);
    const starterPermissions =
      scoped === null ? (input.starterPermissions ?? null) : scoped.permissions;
    const text = input.text.trim().slice(0, 20_000);
    if (text === "") throw new StaffError("invalid-input", "Write the task.");
    const defaults = this.runnerDefaults(companyId);
    const locale = /[ăâîșț]/i.test(text) ? "ro" : "en";
    return this.start({
      companyId,
      agent,
      // The agent (and whoever reads the chat on the runner) sees who asked.
      text: `${input.actor.name} (${input.actor.email}):\n${text}`,
      // The thread and the run are named after the task, not after who sent it.
      title: input.title ?? text.split("\n")[0]!.slice(0, 80),
      cardId: null,
      teachMe: false,
      projectId: agent.projectId ?? defaults.projectId,
      defaults,
      locale,
      origin: "task",
      context: null,
      requestedBy: input.actor.userId ?? null,
      starterPermissions,
    });
  }

  /**
   * Runner, hub v9 (`staff.follow`): the thread a task given through the hub started, for a
   * read-only live view. The person who gave it, or someone allowed to follow every runner thread.
   */
  async followForHub(input: {
    readonly localCompanyId: string;
    readonly staffId: string;
    readonly runId: string;
    readonly actorUserId: string;
    readonly all: boolean;
  }): Promise<{ threadId: string; title: string; status: string; phase: MentionPhase }> {
    const state = this.load(input.localCompanyId);
    const agent = state.agents.find((item) => item.hub?.staffId === input.staffId);
    const run = state.runs.find((item) => item.id === input.runId);
    if (
      agent === undefined ||
      agent.hub?.source !== "runner" ||
      run === undefined ||
      run.agentId !== agent.id ||
      (!input.all && (run.requestedBy ?? null) !== input.actorUserId)
    ) {
      throw new StaffError("not-found", "This task is not on the company runner.");
    }
    const projectId = this.agentThreads.get(run.threadId)?.projectId ?? agent.projectId ?? "";
    const { phase } = await this.mentionPhase(run.threadId, projectId, state, run);
    return { threadId: run.threadId, title: run.title, status: run.status, phase };
  }

  toolsFor(threadId: string) {
    const owner = this.agentThreads.get(threadId);
    if (owner === undefined) return null;
    return {
      instructions:
        "AI staff tools of Zen Staff. Before any outbound action (send, publish, pay, delete) call staff_request_approval and end your turn; at the end of every task call staff_record_result; to pass a board card to a colleague call staff_handoff.",
      call: async (tool: string, args: Readonly<Record<string, unknown>>) => {
        switch (tool) {
          case "staff_request_approval":
            return this.requestApproval(threadId, args);
          case "staff_record_result":
            return this.recordResult(threadId, args);
          case "staff_handoff":
            return this.handoff(threadId, args);
          default:
            throw new Error(`Unknown tool ${tool}`);
        }
      },
    };
  }

  /** For tests and the catalog page. */
  static catalog(): ReadonlyArray<StaffRoleTemplate> {
    return ROLE_CATALOG;
  }
}

function parseAction(value: unknown): StaffOutboundKind {
  return value === "send" || value === "publish" || value === "pay" || value === "delete"
    ? value
    : "other";
}

function parseAssignee(value: unknown, state: StaffState): StaffAssignee | null {
  if (!isRecord(value)) return null;
  if (value.kind === "agent" && state.agents.some((agent) => agent.id === value.id))
    return { kind: "agent", id: value.id as string };
  if (value.kind === "human" && state.humans.some((human) => human.id === value.id))
    return { kind: "human", id: value.id as string };
  return null;
}

function sameAssignee(left: StaffAssignee | null, right: StaffAssignee | null): boolean {
  return left?.kind === right?.kind && left?.id === right?.id;
}

/** The column with this id when it exists and comes later; else the next one (or the same). */
function nextColumn(
  columns: ReadonlyArray<StaffBoardColumn>,
  current: string,
  preferred: string | null,
): string {
  const index = columns.findIndex((column) => column.id === current);
  const preferredIndex =
    preferred === null ? -1 : columns.findIndex((column) => column.id === preferred);
  if (preferredIndex !== -1) return preferredIndex > index ? columns[preferredIndex]!.id : current;
  return columns[Math.min(columns.length - 1, index + 1)]?.id ?? current;
}
