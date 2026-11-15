// @effect-diagnostics globalDate:off - pure date math on epoch milliseconds, local week boundaries.
// Zen Staff AI staff: the numbers. Discovery of repeated work in local thread history (labels
// and counts only), the monthly evaluation per agent, and the cost/time estimate shown before a
// task starts. Pure functions; the service feeds them thread shells and stored runs.
import type {
  StaffAgent,
  StaffApproval,
  StaffDiscoveryResult,
  StaffDiscoverySuggestion,
  StaffEstimate,
  StaffEvaluation,
  StaffEvaluationRow,
  StaffRating,
  StaffSettings,
  StaffTaskRun,
} from "@t3tools/contracts/zenStaff";

import { foldText, monthKey } from "./staffModel.ts";

// Discovery.

export interface DiscoveryItem {
  readonly threadId: string;
  readonly createdAtMs: number;
  /** The first request of the thread; only its words are used, never stored. */
  readonly text: string;
  readonly person: string;
  /** Time the person spent on it (first message to last answer), minutes. */
  readonly minutes: number | null;
}

export interface DiscoveryWorkflow {
  readonly id: string;
  readonly names: ReadonlyArray<string>;
}

const STOPWORDS = new Set(
  (
    "the and for with from this that what your you are our can please make write about into have has will " +
    "need want give some them they their there here then than when which who how all any each more most " +
    "despre si sau din pentru care este sunt acest aceasta asta este fie la pe cu de ca sa se le lui lor mai " +
    "foarte doar dar daca cand unde cum ce cine fa scrie te rog vreau avem am ai are fi un una unei unui " +
    "ale alea acum azi maine ieri saptamana saptamanii zi zile luna lunii toate tot toti nou noi noua " +
    "not given answer documents language person write english romana romanian folder file files task"
  ).split(" "),
);

export function discoveryTokens(text: string): string[] {
  const words = foldText(text.slice(0, 2_000))
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  // A crude stem keeps "facturi"/"facturile" or "posts"/"postari" together.
  return [...new Set(words.map((word) => word.slice(0, 7)))];
}

/** Stem -> the word as the person wrote it (lowercase, with diacritics), for readable labels. */
function displayWords(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text
    .slice(0, 2_000)
    .toLowerCase()
    .split(/[^\p{L}]+/u)) {
    const folded = foldText(raw);
    if (folded.length < 4 || STOPWORDS.has(folded)) continue;
    const stem = folded.slice(0, 7);
    if (!out.has(stem)) out.set(stem, raw);
  }
  return out;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const TEMPLATE_KEYWORDS: ReadonlyArray<{
  readonly id: string;
  readonly words: ReadonlyArray<string>;
}> = [
  {
    id: "junior-accountant",
    words: ["factur", "invoice", "furnizo", "supplie", "plati", "scadent"],
  },
  { id: "customer-support-reviews", words: ["recenzi", "review", "reclama", "complai"] },
  { id: "horeca-reservations", words: ["rezerva", "booking", "reserva", "masa"] },
  { id: "social-media-manager", words: ["postar", "posts", "faceboo", "instagr", "social"] },
  { id: "report-analyst", words: ["raport", "report", "vanzari", "sales", "cifre", "kpis"] },
  { id: "seo-content", words: ["google", "articol", "article", "search", "cautari"] },
  { id: "video-reels", words: ["video", "reels", "clipul", "filmar", "subtitr"] },
  { id: "sales-assistant", words: ["oferta", "offer", "client", "propuner", "proposa", "leads"] },
  { id: "pr-communication", words: ["comunic", "press", "presa", "jurnali"] },
  { id: "admin-assistant", words: ["sedint", "meeting", "minute", "tradu", "transla", "contrac"] },
];

export function suggestTemplate(tokens: ReadonlyArray<string>): string | null {
  let best: { id: string; score: number } | null = null;
  for (const template of TEMPLATE_KEYWORDS) {
    const score = tokens.filter((token) =>
      template.words.some((word) => token.startsWith(word) || word.startsWith(token)),
    ).length;
    if (score > 0 && (best === null || score > best.score)) best = { id: template.id, score };
  }
  return best?.id ?? null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday-based week index, so occurrences in the same calendar week count once. */
function weekIndex(ms: number): number {
  // 1970-01-05 was a Monday.
  return Math.floor((ms - Date.UTC(1970, 0, 5)) / WEEK_MS);
}

/** 1 = Monday ... 7 = Sunday, in the server's local time. */
function isoWeekday(ms: number): number {
  const day = new Date(ms).getDay();
  return day === 0 ? 7 : day;
}

function detectWorkflow(text: string, workflows: ReadonlyArray<DiscoveryWorkflow>): string | null {
  const firstLine = foldText(text.split("\n").find((line) => line.trim() !== "") ?? "").trim();
  if (firstLine === "") return null;
  for (const workflow of workflows) {
    if (workflow.names.some((name) => foldText(name).trim() === firstLine)) return workflow.id;
  }
  return null;
}

/**
 * Groups similar requests (same workflow, or overlapping words) per person and keeps the ones
 * that repeat: at least 3 times in at least 3 different weeks (or 4+ in 2 weeks). Only the top
 * words, counts, days and durations come out; the requests themselves do not.
 */
export function discoverRepeatedWork(
  items: ReadonlyArray<DiscoveryItem>,
  workflows: ReadonlyArray<DiscoveryWorkflow>,
  options: { readonly threshold?: number } = {},
): StaffDiscoveryResult {
  const threshold = options.threshold ?? 0.3;
  interface Cluster {
    person: string;
    workflowId: string | null;
    seed: Set<string>;
    counts: Map<string, number>;
    words: Map<string, Map<string, number>>;
    members: Array<{ ms: number; minutes: number | null; tokens: Set<string> }>;
  }
  const clusters: Cluster[] = [];
  const sorted = items.toSorted((left, right) => left.createdAtMs - right.createdAtMs);
  for (const item of sorted) {
    const tokens = new Set(discoveryTokens(item.text));
    const workflowId = detectWorkflow(item.text, workflows);
    if (tokens.size === 0 && workflowId === null) continue;
    let target: Cluster | undefined;
    let bestScore = 0;
    for (const cluster of clusters) {
      if (cluster.person !== item.person) continue;
      if (workflowId !== null || cluster.workflowId !== null) {
        if (workflowId !== cluster.workflowId) continue;
        // Same workflow: also require some overlap when both have words, so two different
        // uses of a general workflow do not merge.
        const last = cluster.members.at(-1)!.tokens;
        const score = Math.max(jaccard(tokens, cluster.seed), jaccard(tokens, last));
        if (score >= threshold / 2 || tokens.size === 0 || cluster.seed.size === 0) {
          if (score >= bestScore) {
            bestScore = score;
            target = cluster;
          }
        }
        continue;
      }
      const last = cluster.members.at(-1)!.tokens;
      const score = Math.max(jaccard(tokens, cluster.seed), jaccard(tokens, last));
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        target = cluster;
      }
    }
    if (target === undefined) {
      target = {
        person: item.person,
        workflowId,
        seed: tokens,
        counts: new Map(),
        words: new Map(),
        members: [],
      };
      clusters.push(target);
    }
    target.members.push({ ms: item.createdAtMs, minutes: item.minutes, tokens });
    for (const token of tokens) target.counts.set(token, (target.counts.get(token) ?? 0) + 1);
    for (const [stem, word] of displayWords(item.text)) {
      const forms = target.words.get(stem) ?? new Map<string, number>();
      forms.set(word, (forms.get(word) ?? 0) + 1);
      target.words.set(stem, forms);
    }
  }

  const suggestions: StaffDiscoverySuggestion[] = [];
  for (const cluster of clusters) {
    const count = cluster.members.length;
    const weeks = new Set(cluster.members.map((member) => weekIndex(member.ms))).size;
    if (count < 3 || (weeks < 3 && !(count >= 4 && weeks >= 2))) continue;
    const first = cluster.members[0]!.ms;
    const last = cluster.members.at(-1)!.ms;
    const spanWeeks = Math.max(1, Math.round((last - first) / WEEK_MS) + 1);
    const perWeek = count / spanWeeks;
    const coverage = weeks / spanWeeks;
    const cadence: StaffDiscoverySuggestion["cadence"] =
      perWeek > 1.5
        ? "several-per-week"
        : coverage >= 0.6
          ? "weekly"
          : spanWeeks >= 8 && count / (spanWeeks / 4.33) >= 0.7
            ? "monthly"
            : "irregular";
    const dayCounts = new Map<number, number>();
    for (const member of cluster.members) {
      const day = isoWeekday(member.ms);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
    const [topDay, topCount] = [...dayCounts.entries()].toSorted(
      (left, right) => right[1] - left[1],
    )[0]!;
    const weekday = topCount / count >= 0.6 ? topDay : null;
    const durations = cluster.members
      .map((member) => member.minutes)
      .filter((value): value is number => value !== null && value > 0);
    const minutesEach = Math.round(
      Math.min(
        240,
        Math.max(
          5,
          durations.length === 0
            ? 30
            : durations.reduce((sum, value) => sum + value, 0) / durations.length,
        ),
      ),
    );
    const perMonth =
      cadence === "monthly" ? count / (spanWeeks / 4.33) : Math.max(perWeek, coverage) * 4.33;
    const label = [...cluster.counts.entries()]
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([token]) => {
        const forms = cluster.words.get(token);
        return forms === undefined
          ? token
          : [...forms.entries()].toSorted((left, right) => right[1] - left[1])[0]![0];
      })
      .join(" · ");
    const tokens = [...cluster.counts.keys()];
    suggestions.push({
      id: `${cluster.person}:${cluster.workflowId ?? label}`
        .replace(/[^A-Za-z0-9_:.·-]/g, "-")
        .slice(0, 120),
      label: label || cluster.workflowId || "",
      person: cluster.person,
      count,
      weeks,
      cadence,
      weekday,
      minutesEach,
      hoursPerMonth: Math.round(((perMonth * minutesEach) / 60) * 10) / 10,
      workflowId: cluster.workflowId,
      suggestedTemplateId: suggestTemplate(tokens),
      proposal: cluster.workflowId === null ? "workflow" : "agent",
    });
  }
  const ordered = suggestions.toSorted((left, right) => right.hoursPerMonth - left.hoursPerMonth);
  const times = sorted.map((item) => item.createdAtMs);
  return {
    analyzedThreads: items.length,
    fromDate: times.length === 0 ? null : new Date(Math.min(...times)).toISOString(),
    toDate: times.length === 0 ? null : new Date(Math.max(...times)).toISOString(),
    suggestions: ordered,
    hoursPerMonth: Math.round(ordered.reduce((sum, item) => sum + item.hoursPerMonth, 0) * 10) / 10,
  };
}

// Monthly evaluation.

function tokenCost(
  tokens: number,
  settings: Pick<StaffSettings, "pricePerMillionTokens">,
): number | null {
  if (settings.pricePerMillionTokens === null) return null;
  return Math.round((tokens / 1_000_000) * settings.pricePerMillionTokens * 100) / 100;
}

export function evaluateMonth(input: {
  readonly month: string;
  readonly agents: ReadonlyArray<StaffAgent>;
  readonly runs: ReadonlyArray<StaffTaskRun>;
  readonly approvals: ReadonlyArray<StaffApproval>;
  readonly ratings: ReadonlyArray<StaffRating>;
  readonly settings: Pick<StaffSettings, "pricePerMillionTokens" | "currency">;
}): StaffEvaluation {
  const inMonth = (iso: string | null) => iso !== null && monthKey(iso) === input.month;
  const rows: StaffEvaluationRow[] = input.agents.map((agent) => {
    const runs = input.runs.filter((run) => run.agentId === agent.id && inMonth(run.startedAt));
    const done = runs.filter((run) => run.status === "completed");
    const failed = runs.filter((run) => run.status === "failed" || run.status === "interrupted");
    const tokens = runs.reduce((sum, run) => sum + (run.tokens ?? 0), 0);
    const minutesWorked = Math.round(
      runs.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) / 60_000,
    );
    const decided = input.approvals.filter(
      (approval) =>
        approval.agentId === agent.id &&
        approval.status !== "pending" &&
        inMonth(approval.decidedAt),
    );
    const approved = decided.filter((approval) => approval.status === "approved").length;
    const rejected = decided.filter((approval) => approval.status === "rejected").length;
    const ratings = input.ratings.filter(
      (rating) => rating.agentId === agent.id && inMonth(rating.at),
    );
    const scores = ratings
      .map((rating) => rating.score)
      .filter((score): score is number => score !== null);
    const minutesSaved = Math.max(0, done.length * agent.minutesPerTask - minutesWorked);
    return {
      agentId: agent.id,
      tasksDone: done.length,
      tasksFailed: failed.length,
      tokens,
      cost: tokenCost(tokens, input.settings),
      minutesWorked,
      minutesSaved,
      approvals: decided.length,
      approved,
      rejected,
      approvalRate: decided.length === 0 ? null : approved / decided.length,
      rejectionRate: decided.length === 0 ? null : rejected / decided.length,
      thumbsUp: ratings.filter((rating) => rating.thumbs === "up").length,
      thumbsDown: ratings.filter((rating) => rating.thumbs === "down").length,
      averageScore:
        scores.length === 0
          ? null
          : Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10,
      ratings: ratings.length,
      budgetUsed:
        agent.limits.monthlyTokenBudget === null ? null : tokens / agent.limits.monthlyTokenBudget,
    };
  });
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  return {
    month: input.month,
    currency: input.settings.currency,
    rows,
    totals: {
      tasksDone: rows.reduce((sum, row) => sum + row.tasksDone, 0),
      tokens: totalTokens,
      cost: tokenCost(totalTokens, input.settings),
      minutesSaved: rows.reduce((sum, row) => sum + row.minutesSaved, 0),
    },
  };
}

// Estimate before a task starts.

const DEFAULT_AGENT_MINUTES = 6;
const DEFAULT_TOKENS = 60_000;

function median(values: ReadonlyArray<number>): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * From the agent's last finished tasks (the same workflow first, when one is named), else the
 * agent's role, else a default. Minutes are the agent's working time; `humanMinutes` is what the
 * same task takes a person (the role's estimate).
 */
export function estimateTask(input: {
  readonly agent: Pick<StaffAgent, "id" | "minutesPerTask">;
  readonly runs: ReadonlyArray<StaffTaskRun>;
  readonly titleHint?: string | null;
  readonly settings: Pick<StaffSettings, "pricePerMillionTokens" | "currency">;
}): StaffEstimate {
  const finished = input.runs
    .filter(
      (run) =>
        run.agentId === input.agent.id && run.status === "completed" && run.durationMs !== null,
    )
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  const hint = input.titleHint ? foldText(input.titleHint) : null;
  const similar =
    hint === null
      ? []
      : finished.filter(
          (run) => foldText(run.title).includes(hint) || hint.includes(foldText(run.title)),
        );
  const sample = (similar.length >= 2 ? similar : finished).slice(0, 10);
  if (sample.length > 0) {
    const minutes = Math.max(1, Math.round(median(sample.map((run) => run.durationMs! / 60_000))));
    const withTokens = sample.filter((run) => run.tokens !== null);
    const tokens =
      withTokens.length === 0
        ? DEFAULT_TOKENS
        : Math.round(median(withTokens.map((run) => run.tokens!)));
    return {
      basis: "history",
      samples: sample.length,
      minutes,
      tokens,
      cost: tokenCost(tokens, input.settings),
      currency: input.settings.currency,
      humanMinutes: input.agent.minutesPerTask,
    };
  }
  return {
    basis: input.agent.minutesPerTask > 0 ? "template" : "default",
    samples: 0,
    minutes: DEFAULT_AGENT_MINUTES,
    tokens: DEFAULT_TOKENS,
    cost: tokenCost(DEFAULT_TOKENS, input.settings),
    currency: input.settings.currency,
    humanMinutes: input.agent.minutesPerTask,
  };
}

/** The weekly report an agent sends its manager (plain text, in the person's language). */
export function weeklyReportText(input: {
  readonly agent: Pick<StaffAgent, "id" | "name" | "role" | "objectives">;
  readonly weekStartMs: number;
  readonly runs: ReadonlyArray<StaffTaskRun>;
  readonly approvals: ReadonlyArray<StaffApproval>;
  readonly ratings: ReadonlyArray<StaffRating>;
  readonly locale: "en" | "ro";
}): string {
  const from = input.weekStartMs;
  const to = from + WEEK_MS;
  const inWeek = (iso: string | null) =>
    iso !== null && Date.parse(iso) >= from && Date.parse(iso) < to;
  const runs = input.runs.filter((run) => run.agentId === input.agent.id && inWeek(run.startedAt));
  const done = runs.filter((run) => run.status === "completed");
  const approvals = input.approvals.filter(
    (approval) => approval.agentId === input.agent.id && inWeek(approval.createdAt),
  );
  const pending = approvals.filter((approval) => approval.status === "pending").length;
  const rejected = approvals.filter((approval) => approval.status === "rejected");
  const ratings = input.ratings.filter(
    (rating) => rating.agentId === input.agent.id && inWeek(rating.at),
  );
  const scores = ratings
    .map((rating) => rating.score)
    .filter((score): score is number => score !== null);
  const tokens = runs.reduce((sum, run) => sum + (run.tokens ?? 0), 0);
  const ro = input.locale === "ro";
  const day = new Date(from).toISOString().slice(0, 10);
  const lines = [
    ro
      ? `Raport săptămânal: ${input.agent.name} (${input.agent.role}), săptămâna din ${day}`
      : `Weekly report: ${input.agent.name} (${input.agent.role}), week of ${day}`,
    "",
    ro
      ? `Sarcini terminate: ${done.length} din ${runs.length}.`
      : `Tasks finished: ${done.length} of ${runs.length}.`,
    ...done
      .slice(0, 8)
      .map(
        (run) =>
          `- ${run.title}${run.trail?.explainToBoss[0] ? `: ${run.trail.explainToBoss[0]}` : ""}`,
      ),
    ro
      ? `Aprobări cerute: ${approvals.length} (${pending} în așteptare, ${rejected.length} respinse).`
      : `Approvals asked: ${approvals.length} (${pending} pending, ${rejected.length} rejected).`,
    ...rejected
      .slice(0, 3)
      .map(
        (approval) =>
          `- ${ro ? "Respins" : "Rejected"}: ${approval.decisionNote || approval.target}`,
      ),
    scores.length > 0
      ? ro
        ? `Nota medie de la colegi: ${(scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)} din 5 (${scores.length} note).`
        : `Average colleague score: ${(scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)} of 5 (${scores.length} ratings).`
      : ro
        ? "Nicio notă de la colegi săptămâna asta."
        : "No colleague ratings this week.",
    ro
      ? `Tokeni folosiți: ${tokens.toLocaleString("ro-RO")}.`
      : `Tokens used: ${tokens.toLocaleString("en-US")}.`,
  ];
  if (input.agent.objectives.length > 0) {
    lines.push(
      "",
      ro ? "Obiective:" : "Objectives:",
      ...input.agent.objectives.map(
        (objective) => `- ${objective.title}${objective.target ? ` (${objective.target})` : ""}`,
      ),
    );
  }
  return lines.join("\n");
}

/** Monday 00:00 (server local time) of the week that contains `ms`. */
export function weekStart(ms: number): number {
  const date = new Date(ms);
  const day = date.getDay() === 0 ? 7 : date.getDay();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (day - 1));
  return date.getTime();
}
