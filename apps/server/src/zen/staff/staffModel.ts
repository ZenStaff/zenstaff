// @effect-diagnostics extendsNativeError:off - input errors are mapped to ZenStaffError by the engine.
// Zen Staff AI staff: the pure model. Stored state and its normalization, the permission model
// (personal vs company agents, company account and runner), outbound-action classification and
// the tool gate, agent status, and the brief every agent task starts with. No I/O here.
import type {
  StaffAgent,
  StaffAgentKind,
  StaffAgentStatus,
  StaffApproval,
  StaffBoardColumn,
  StaffCard,
  StaffCompanyAccount,
  StaffHuman,
  StaffInstructionProposal,
  StaffLimits,
  StaffLocale,
  StaffOutboundKind,
  StaffPersona,
  StaffPlacement,
  StaffRating,
  StaffRoleTemplate,
  StaffSettings,
  StaffTaskRun,
  StaffWeeklyReport,
} from "@t3tools/contracts/zenStaff";

export const PERSONAL_COMPANY_ID = "personal";

/** A correction the manager or a colleague made: input of the self-improvement proposals. */
export interface StaffCorrection {
  readonly agentId: string;
  readonly kind: "rejection" | "rating";
  readonly text: string;
  readonly at: string;
}

export interface StaffState {
  readonly version: 1;
  readonly agents: ReadonlyArray<StaffAgent>;
  readonly humans: ReadonlyArray<StaffHuman>;
  readonly settings: StaffSettings;
  readonly columns: ReadonlyArray<StaffBoardColumn>;
  readonly cards: ReadonlyArray<StaffCard>;
  readonly approvals: ReadonlyArray<StaffApproval>;
  readonly ratings: ReadonlyArray<StaffRating>;
  readonly runs: ReadonlyArray<StaffTaskRun>;
  readonly corrections: ReadonlyArray<StaffCorrection>;
  readonly proposals: ReadonlyArray<StaffInstructionProposal>;
  readonly reports: ReadonlyArray<StaffWeeklyReport>;
  readonly personas: ReadonlyArray<StaffPersona>;
}

export const DEFAULT_COLUMNS: Readonly<Record<StaffLocale, ReadonlyArray<StaffBoardColumn>>> = {
  en: [
    { id: "todo", title: "To do" },
    { id: "draft", title: "Draft" },
    { id: "review", title: "Review" },
    { id: "done", title: "Done" },
  ],
  ro: [
    { id: "todo", title: "De făcut" },
    { id: "draft", title: "Ciornă" },
    { id: "review", title: "Verificare" },
    { id: "done", title: "Gata" },
  ],
};

export const DEFAULT_SETTINGS: StaffSettings = {
  companyAccount: null,
  discoveryOptIn: false,
  checkerAi: true,
  approvals: true,
  brand: { tone: "", bannedWords: [], prices: [] },
  pricePerMillionTokens: null,
  currency: "EUR",
};

const DEFAULT_LIMITS: StaffLimits = {
  maxRunsPerDay: 20,
  maxMinutesPerRun: 30,
  monthlyTokenBudget: null,
};

export function emptyStaffState(locale: StaffLocale = "ro"): StaffState {
  return {
    version: 1,
    agents: [],
    humans: [],
    settings: DEFAULT_SETTINGS,
    columns: DEFAULT_COLUMNS[locale],
    cards: [],
    approvals: [],
    ratings: [],
    runs: [],
    corrections: [],
    proposals: [],
    reports: [],
    personas: [],
  };
}

// Input helpers (the RPC carries unknown input; every op validates what it reads).

export class StaffInputError extends Error {}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function str(input: unknown, key: string, max: number, fallback?: string): string {
  const value = isRecord(input) ? input[key] : undefined;
  if (typeof value !== "string") {
    if (fallback !== undefined) return fallback;
    throw new StaffInputError(`Missing ${key}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new StaffInputError(`${key} is too long (max ${max}).`);
  return trimmed;
}

export function optStr(input: unknown, key: string, max: number): string | null {
  const value = isRecord(input) ? input[key] : undefined;
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new StaffInputError(`${key} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new StaffInputError(`${key} is too long (max ${max}).`);
  return trimmed === "" ? null : trimmed;
}

export function strList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed === "" || trimmed.length > maxLength || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function optNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export const isId = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value);

/** Validates an agent edit from the profile form; keeps stored fields the form does not send. */
export function normalizeAgentInput(
  raw: unknown,
  existing: StaffAgent | null,
  context: { readonly id: string; readonly companyId: string; readonly now: string },
): StaffAgent {
  if (!isRecord(raw)) throw new StaffInputError("Missing the agent.");
  const name = str(raw, "name", 60);
  if (name === "") throw new StaffInputError("Give the agent a name.");
  const kind: StaffAgentKind = raw.kind === "company" ? "company" : "personal";
  const memory = isRecord(raw.memory) ? raw.memory : {};
  const hours = isRecord(raw.workingHours) ? raw.workingHours : null;
  const days = hours
    ? strList(
        (Array.isArray(hours.days) ? hours.days : []).map((day) => String(day)),
        7,
        1,
      )
        .map(Number)
        .filter((day) => day >= 1 && day <= 7)
        .toSorted()
    : [];
  const workingHours =
    hours && days.length > 0 && TIME.test(String(hours.start)) && TIME.test(String(hours.end))
      ? { days, start: String(hours.start), end: String(hours.end) }
      : null;
  const limitsRaw = isRecord(raw.limits) ? raw.limits : {};
  const limits: StaffLimits = {
    maxRunsPerDay: optNumber(limitsRaw.maxRunsPerDay, 1, 500),
    maxMinutesPerRun: optNumber(limitsRaw.maxMinutesPerRun, 1, 600),
    monthlyTokenBudget: optNumber(limitsRaw.monthlyTokenBudget, 1000, 1_000_000_000),
  };
  const duties = (Array.isArray(raw.duties) ? raw.duties : []).slice(0, 10).flatMap((duty) => {
    if (!isRecord(duty)) return [];
    const title = str(duty, "title", 120, "");
    const prompt = str(duty, "prompt", 4000, "");
    const weekday = optNumber(duty.weekday, 1, 7);
    const time = typeof duty.time === "string" && TIME.test(duty.time) ? duty.time : null;
    if (title === "" || prompt === "" || weekday === null || time === null) return [];
    const previous = existing?.duties.find((item) => item.id === duty.id);
    return [
      {
        id: isId(duty.id) ? duty.id : `duty-${context.id}-${title.length}-${weekday}-${time}`,
        title,
        prompt,
        weekday: Math.round(weekday),
        time,
        scheduledTaskId: previous?.scheduledTaskId ?? null,
      },
    ];
  });
  const objectives = (Array.isArray(raw.objectives) ? raw.objectives : [])
    .slice(0, 10)
    .flatMap((objective, index) => {
      if (!isRecord(objective)) return [];
      const title = str(objective, "title", 200, "");
      if (title === "") return [];
      return [
        {
          id: isId(objective.id) ? objective.id : `objective-${index + 1}`,
          title,
          target: str(objective, "target", 200, ""),
        },
      ];
    });
  const instructions = str(raw, "instructions", 12_000, "");
  const instructionsChanged = existing !== null && existing.instructions !== instructions;
  return {
    id: context.id,
    companyId: context.companyId,
    name,
    color:
      typeof raw.color === "string" && COLOR.test(raw.color)
        ? raw.color
        : (existing?.color ?? "#2F6F5E"),
    icon: str(raw, "icon", 40, existing?.icon ?? "bot"),
    role: str(raw, "role", 120, ""),
    instructions,
    workflows: strList(raw.workflows, 40, 80),
    connectors: strList(raw.connectors, 40, 80),
    memory: { read: memory.read !== false, write: memory.write === true },
    workingHours,
    duties,
    limits,
    managerId: isId(raw.managerId) ? raw.managerId : null,
    objectives,
    kind,
    owner: optStr(raw, "owner", 254) ?? existing?.owner ?? null,
    projectId: optStr(raw, "projectId", 200),
    templateId: optStr(raw, "templateId", 80) ?? existing?.templateId ?? null,
    origin:
      raw.origin === "catalog" || raw.origin === "conversation" || raw.origin === "discovery"
        ? raw.origin
        : (existing?.origin ?? "manual"),
    minutesPerTask: optNumber(raw.minutesPerTask, 1, 24 * 60) ?? existing?.minutesPerTask ?? 30,
    paused: raw.paused === true,
    instructionsVersion:
      (existing?.instructionsVersion ?? 0) + (existing === null || instructionsChanged ? 1 : 0),
    createdAt: existing?.createdAt ?? context.now,
    updatedAt: context.now,
  };
}

/** A new agent from a catalog role, in the person's language. */
export function agentFromTemplate(
  template: StaffRoleTemplate,
  input: {
    readonly id: string;
    readonly companyId: string;
    readonly now: string;
    readonly locale: StaffLocale;
    readonly kind: StaffAgentKind;
    readonly name?: string | null;
    readonly managerId: string | null;
    readonly owner: string | null;
    readonly projectId: string | null;
  },
): StaffAgent {
  const t = (text: { readonly en: string; readonly ro: string }) => text[input.locale];
  return {
    id: input.id,
    companyId: input.companyId,
    name: input.name?.trim() || t(template.name),
    color: template.color,
    icon: template.icon,
    role: t(template.role),
    instructions: t(template.instructions),
    workflows: [...template.workflows],
    connectors: [...template.connectors],
    memory: { read: true, write: input.kind === "company" },
    workingHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
    duties: template.duties.map((duty, index) => ({
      id: `duty-${input.id}-${index + 1}`,
      title: t(duty.title),
      prompt: t(duty.prompt),
      weekday: duty.weekday,
      time: duty.time,
      scheduledTaskId: null,
    })),
    limits: DEFAULT_LIMITS,
    managerId: input.managerId,
    objectives: template.objectives.map((objective, index) => ({
      id: `objective-${index + 1}`,
      title: t(objective),
      target: "",
    })),
    kind: input.kind,
    owner: input.owner,
    projectId: input.projectId,
    templateId: template.id,
    origin: "catalog",
    minutesPerTask: template.minutesPerTask,
    paused: false,
    instructionsVersion: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

// Permission model.

export interface PlacementContext {
  readonly companyId: string;
  /** This machine is the company's runner (hub registration, or the local switch without a hub). */
  readonly isRunner: boolean;
  readonly companyAccount: StaffCompanyAccount | null;
  /** The company account's provider instance exists and is enabled on this machine. */
  readonly companyAccountAvailable: boolean;
  readonly locale: StaffLocale;
}

const PLACEMENT_TEXT = {
  en: {
    ok: "Ready.",
    personalCompany:
      "Personal has no company account or server. Company agents belong to a company: pick or create one.",
    account:
      "Set the company's AI account first (a Team or Enterprise seat, or the company's API key) in AI staff > Settings. A company agent never runs on someone's personal subscription.",
    accountMissing:
      "The company's AI account is set, but its assistant is not available on this machine. Check Settings > AI assistants on the company server.",
    runner:
      "Company agents run on the company's always-on server (the company runner). Make a machine the company runner on the Team page, or open Zen Staff on that server.",
    personalOnRunner:
      "A personal agent uses the person's own AI account on their own machine, not the company account.",
  },
  ro: {
    ok: "Gata.",
    personalCompany:
      "Personal nu are cont de companie sau server. Agenții de companie aparțin unei companii: alege sau creează una.",
    account:
      "Setează întâi contul AI al companiei (un loc Team sau Enterprise, ori cheia API a companiei) în Angajați AI > Setări. Un agent de companie nu rulează niciodată pe abonamentul personal al cuiva.",
    accountMissing:
      "Contul AI al companiei e setat, dar asistentul lui nu e disponibil pe această mașină. Verifică Setări > Asistenți AI pe serverul companiei.",
    runner:
      "Agenții de companie lucrează pe serverul companiei, pornit mereu (runnerul companiei). Fă o mașină runnerul companiei din pagina Echipă sau deschide Zen Staff pe acel server.",
    personalOnRunner:
      "Un agent personal folosește contul AI al persoanei, pe mașina ei, nu contul companiei.",
  },
} as const;

/**
 * Can an agent of this kind be hired or started here? Personal agents always can (they use the
 * person's own account on this machine). Company agents need a company (not Personal), the
 * company's AI account and this machine to be the company runner. Every missing piece is named.
 */
export function evaluatePlacement(kind: StaffAgentKind, context: PlacementContext): StaffPlacement {
  const text = PLACEMENT_TEXT[context.locale];
  if (kind === "personal") return { ok: true, missing: [], message: text.ok };
  if (context.companyId === PERSONAL_COMPANY_ID) {
    return { ok: false, missing: ["company-account", "runner"], message: text.personalCompany };
  }
  const missing: Array<"company-account" | "runner"> = [];
  const messages: string[] = [];
  if (context.companyAccount === null) {
    missing.push("company-account");
    messages.push(text.account);
  } else if (context.isRunner && !context.companyAccountAvailable) {
    missing.push("company-account");
    messages.push(text.accountMissing);
  }
  if (!context.isRunner) {
    missing.push("runner");
    messages.push(text.runner);
  }
  return missing.length === 0
    ? { ok: true, missing: [], message: text.ok }
    : { ok: false, missing, message: messages.join(" ") };
}

/**
 * The model a task runs with. Company agents always use the company account (whatever the
 * person picked); personal agents use the person's choice, and never the company account.
 */
export function resolveTaskModel<
  Selection extends { readonly instanceId: string; readonly model: string },
>(
  kind: StaffAgentKind,
  requested: Selection | null,
  context: PlacementContext,
):
  | {
      readonly ok: true;
      readonly selection: { readonly instanceId: string; readonly model: string };
    }
  | { readonly ok: false; readonly placement: StaffPlacement } {
  const placement = evaluatePlacement(kind, context);
  if (!placement.ok) return { ok: false, placement };
  if (kind === "company") {
    const account = context.companyAccount!;
    return {
      ok: true,
      selection: { instanceId: account.providerInstanceId, model: account.model },
    };
  }
  if (requested === null) {
    return {
      ok: false,
      placement: {
        ok: false,
        missing: [],
        message:
          context.locale === "ro"
            ? "Niciun asistent AI nu e configurat pe această mașină."
            : "No AI assistant is set up on this machine.",
      },
    };
  }
  if (
    context.companyAccount !== null &&
    requested.instanceId === context.companyAccount.providerInstanceId
  ) {
    return {
      ok: false,
      placement: {
        ok: false,
        missing: ["personal-on-runner"],
        message: PLACEMENT_TEXT[context.locale].personalOnRunner,
      },
    };
  }
  return { ok: true, selection: { instanceId: requested.instanceId, model: requested.model } };
}

// Outbound actions and the tool gate.

const DRAFT_LIKE =
  /(draft|preview|get|list|read|search|fetch|find|lookup|query|check|status|describe|count|view|download|export)/;
const PAY = /(pay|payment|charge|refund|transfer|payout|invoice_send|send_invoice|capture)/;
const DELETE = /(delete|trash|remove|destroy|erase|purge|cancel|unpublish|revoke|archive)/;
const PUBLISH =
  /(publish|post|schedule|boost|create_ad|create_campaign|activate|go_live|tweet|upload)/;
const SEND = /(send|reply|forward|respond|comment|message|invite|share|notify|email|sms)/;

/** Our own tools (approvals, trail) are never outbound. */
export const STAFF_MCP_SERVER_NAME = "zen-staff";

/**
 * Which outbound action a tool call is, from its name, or null for reads, drafts and local work.
 * MCP tools (`mcp__<server>__<tool>`) are the customer's connectors; built-in tools are local
 * (files, shell) and follow the thread's own runtime approvals.
 */
export function classifyOutboundTool(toolName: string): StaffOutboundKind | null {
  if (!toolName.startsWith("mcp__")) return null;
  const parts = toolName.split("__");
  if (parts[1] === STAFF_MCP_SERVER_NAME) return null;
  const tool = (parts.slice(2).join("__") || "").toLowerCase();
  if (tool === "") return null;
  const words = tool.replace(/[^a-z0-9]+/g, "_");
  if (PAY.test(words)) return "pay";
  if (DELETE.test(words)) return "delete";
  // A draft or a read that merely mentions "post" or "message" is not outbound.
  const firstWord = words.split("_")[0] ?? "";
  if (DRAFT_LIKE.test(firstWord) || /draft/.test(words)) return null;
  if (PUBLISH.test(words)) return "publish";
  if (SEND.test(words)) return "send";
  if (/^(create|update|set|modify|edit|write|add|apply|execute|run)/.test(firstWord))
    return "other";
  return null;
}

/** One approved action an agent thread may now carry out (consumed by the first matching call). */
export interface GateAllowance {
  readonly approvalId: string;
  readonly action: StaffOutboundKind;
  readonly expiresAt: number;
  remaining: number;
}

export type GateDecision =
  | { readonly behavior: "pass" }
  | { readonly behavior: "allow"; readonly approvalId: string }
  | { readonly behavior: "deny"; readonly message: string; readonly action: StaffOutboundKind };

/**
 * The tool gate for agent threads: an outbound connector call passes only with an approval the
 * manager gave for that kind of action (or "other" approvals for "other"), within its time.
 */
export function gateToolCall(
  toolName: string,
  allowances: Array<GateAllowance>,
  nowMs: number,
): GateDecision {
  const action = classifyOutboundTool(toolName);
  if (action === null) return { behavior: "pass" };
  const index = allowances.findIndex(
    (allowance) =>
      allowance.expiresAt > nowMs &&
      allowance.remaining > 0 &&
      (allowance.action === action || allowance.action === "other" || action === "other"),
  );
  if (index === -1) {
    return {
      behavior: "deny",
      action,
      message: `"${toolName}" is an outbound action (${action}). Agents do not ${action} on their own: call staff_request_approval with the exact content and target, end your turn, and continue when your manager approves.`,
    };
  }
  const allowance = allowances[index]!;
  allowance.remaining -= 1;
  if (allowance.remaining <= 0) allowances.splice(index, 1);
  return { behavior: "allow", approvalId: allowance.approvalId };
}

// Status, budget and the task brief.

export function agentStatus(input: {
  readonly paused: boolean;
  readonly activeThreads: number;
  readonly pendingApprovals: number;
}): StaffAgentStatus {
  if (input.paused) return "paused";
  if (input.pendingApprovals > 0) return "waiting-approval";
  if (input.activeThreads > 0) return "working";
  return "idle";
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function tokensThisMonth(
  runs: ReadonlyArray<StaffTaskRun>,
  agentId: string,
  nowIso: string,
): number {
  const month = monthKey(nowIso);
  return runs
    .filter((run) => run.agentId === agentId && monthKey(run.startedAt) === month)
    .reduce((sum, run) => sum + (run.tokens ?? 0), 0);
}

export function budgetBlock(
  agent: StaffAgent,
  runs: ReadonlyArray<StaffTaskRun>,
  nowIso: string,
  locale: StaffLocale,
): string | null {
  const budget = agent.limits.monthlyTokenBudget;
  if (budget !== null && tokensThisMonth(runs, agent.id, nowIso) >= budget) {
    return locale === "ro"
      ? `${agent.name} a folosit tot bugetul de tokeni pe luna asta. Mărește bugetul din profil sau așteaptă luna următoare.`
      : `${agent.name} has used this month's token budget. Raise it in the profile or wait for next month.`;
  }
  const perDay = agent.limits.maxRunsPerDay;
  if (perDay !== null) {
    const today = nowIso.slice(0, 10);
    const count = runs.filter(
      (run) => run.agentId === agent.id && run.startedAt.slice(0, 10) === today,
    ).length;
    if (count >= perDay) {
      return locale === "ro"
        ? `${agent.name} a ajuns la limita de ${perDay} sarcini pe zi.`
        : `${agent.name} reached the limit of ${perDay} tasks a day.`;
    }
  }
  return null;
}

const STAFF_MARKER = "Zen Staff agent";

/** The first lines of the marker, parsed back when a scheduled duty or a reload sees the thread. */
export function parseAgentMarker(
  text: string,
): { readonly agentId: string; readonly companyId: string } | null {
  const match = /\[Zen Staff agent ([A-Za-z0-9_-]{1,80}) @ ([a-z0-9-]{1,64})\]/.exec(
    text.slice(0, 600),
  );
  return match === null ? null : { agentId: match[1]!, companyId: match[2]! };
}

function agentMarker(agent: Pick<StaffAgent, "id" | "companyId">): string {
  return `[${STAFF_MARKER} ${agent.id} @ ${agent.companyId}]`;
}

/** The message an agent's task starts with: who it is, what it may use, and the house rules. */
export function buildAgentBrief(input: {
  readonly agent: StaffAgent;
  readonly managerName: string | null;
  readonly workflowNames: ReadonlyArray<string>;
  readonly task: string;
  readonly teachMe: boolean;
  readonly locale: StaffLocale;
  readonly context?: string | null;
  /** The company's "Aprobări" switch is on and this is a company agent: its shell has no network. */
  readonly shellOffline?: boolean;
}): string {
  const { agent } = input;
  const ro = input.locale === "ro";
  const lines: string[] = [agentMarker(agent)];
  lines.push(
    ro
      ? `Ești ${agent.name}, ${agent.role || "angajat AI"} (agent ${agent.kind === "company" ? "de companie" : "personal"}).`
      : `You are ${agent.name}, ${agent.role || "an AI employee"} (${agent.kind} agent).`,
  );
  if (agent.instructions)
    lines.push("", ro ? "Fișa postului:" : "Job description:", agent.instructions);
  if (input.workflowNames.length > 0) {
    lines.push(
      "",
      (ro ? "Fluxuri de lucru pe care le poți folosi: " : "Workflows you may use: ") +
        input.workflowNames.join(", ") +
        ".",
    );
  }
  lines.push(
    "",
    agent.connectors.length > 0
      ? (ro
          ? "Conexiuni permise (în conturile clientului): "
          : "Allowed connections (in the customer's own accounts): ") +
          agent.connectors.join(", ") +
          (ro ? ". Nu folosi alte conexiuni." : ". Do not use other connections.")
      : ro
        ? "Nu ai conexiuni externe: lucrezi doar cu fișierele din dosar."
        : "You have no external connections: work only with the files in the folder.",
  );
  lines.push(
    agent.memory.read
      ? ro
        ? "Poți citi memoria companiei; verifică prețuri, date și promisiuni acolo."
        : "You may read company memory; check prices, dates and promises there."
      : ro
        ? "Nu folosi memoria companiei pentru această sarcină."
        : "Do not use company memory for this task.",
  );
  if (!agent.memory.write) {
    lines.push(
      ro
        ? "Nu salva nimic nou în memoria companiei."
        : "Do not save anything new to company memory.",
    );
  }
  lines.push(
    "",
    ro ? "Reguli:" : "Rules:",
    ro
      ? `- Orice acțiune spre exterior (trimitere, publicare, plată, ștergere) are nevoie de aprobarea managerului${input.managerName ? ` (${input.managerName})` : ""}: pregătește conținutul exact, apelează staff_request_approval cu acțiunea, destinatarul și textul, apoi oprește-te. Continui doar după ce primești aprobarea.`
      : `- Every outbound action (send, publish, pay, delete) needs your manager's approval${input.managerName ? ` (${input.managerName})` : ""}: prepare the exact content, call staff_request_approval with the action, target and text, then stop. Continue only after the approval arrives.`,
    ...(input.shellOffline
      ? [
          ro
            ? "- Comenzile tale din terminal nu au internet (curl, scripturi, git push nu ies din firmă). Ce trebuie să plece spre exterior pleacă doar prin conexiunile permise, cu aprobarea managerului."
            : "- Your terminal commands have no internet (curl, scripts, git push cannot leave the company). Anything that goes outside goes only through your allowed connections, with your manager's approval.",
        ]
      : []),
    ro
      ? "- La final apelează staff_record_result: rezumat, 3 rânduri „pe înțelesul șefului”, surse, fișiere citite, pași, presupuneri și fișierele făcute pentru persoană."
      : '- At the end call staff_record_result: summary, 3 lines "explain to my boss", sources, files read, steps, assumptions and the files you made for the person.',
    ro
      ? "- Când lipsește o informație esențială, spune ce lipsește; nu inventa."
      : "- When something essential is missing, say what is missing; do not invent it.",
  );
  if (input.teachMe) {
    lines.push(
      ro
        ? "- Mod „Învață-mă”: explică pe scurt, în cuvinte simple, ce faci la fiecare pas și de ce, ca persoana să poată face singură data viitoare."
        : '- "Teach me" mode: briefly explain in plain words what you do at each step and why, so the person can do it alone next time.',
    );
  }
  if (input.context) lines.push("", ro ? "Context:" : "Context:", input.context);
  lines.push("", ro ? "Sarcina:" : "Task:", input.task);
  lines.push(
    "",
    ro
      ? "Răspunde și scrie documentele în limba română."
      : "Answer and write the documents in English.",
  );
  return lines.join("\n");
}

/** Plain-word folding used by mention matching and discovery. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Agents named with `@Name` in a message (longest names first, word boundary after). */
export function findMentionedAgents<Agent extends Pick<StaffAgent, "id" | "name" | "paused">>(
  text: string,
  agents: ReadonlyArray<Agent>,
): Agent[] {
  let folded = foldText(text);
  const found: Agent[] = [];
  for (const agent of agents.toSorted((left, right) => right.name.length - left.name.length)) {
    if (agent.paused) continue;
    const name = foldText(agent.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^a-z0-9_])@${name}(?![a-z0-9_])`, "g");
    if (!pattern.test(folded)) continue;
    found.push(agent);
    // "@Ana Maria" must not also count as "@Ana".
    folded = folded.replace(pattern, (match) => " ".repeat(match.length));
  }
  return found;
}
