// Zen Staff: pure rules for scheduled task limits. No Effect services, so every rule is unit
// tested in limitsPolicy.test.ts. See ZEN.md, "Scheduled task limits".
import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
} from "@t3tools/contracts";
import type {
  ZenGlobalLimits,
  ZenQuietHours,
  ZenRunState,
  ZenRunTrigger,
  ZenTaskLimits,
} from "@t3tools/contracts/zenScheduledLimits";

export type Admission =
  | { readonly _tag: "run" }
  | { readonly _tag: "skip"; readonly reason: string }
  | { readonly _tag: "queue"; readonly reason: string };

export interface AdmissionInput {
  readonly trigger: ZenRunTrigger;
  readonly limits: ZenTaskLimits;
  readonly globals: ZenGlobalLimits;
  /** Minutes since local midnight on the server. */
  readonly minuteOfDay: number;
  /** Runs this task started today (any trigger). */
  readonly taskRunsToday: number;
  /** Scheduled and webhook runs started today across all tasks. */
  readonly totalRunsToday: number;
  /** Task runs whose agent is still working, plus reserved slots. */
  readonly activeRuns: number;
  /** Queued tasks that have waited longer; they get free slots first (FIFO). */
  readonly queuedAhead: number;
}

function parseTimeOfDay(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** `start` is inclusive, `end` exclusive; a window wraps past midnight when end < start. */
export function isInQuietHours(quiet: ZenQuietHours | null, minuteOfDay: number): boolean {
  if (quiet === null) return false;
  const start = parseTimeOfDay(quiet.start);
  const end = parseTimeOfDay(quiet.end);
  if (start === null || end === null || start === end) return false;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Decides whether a task run may start now. "Run now" (manual) always starts: the user asked
 * for it. Skips come before the queue so a run that may not start at all never holds a place.
 */
export function decideAdmission(input: AdmissionInput): Admission {
  if (input.trigger === "manual") return { _tag: "run" };
  const { limits, globals } = input;
  if (globals.pauseAll) {
    return { _tag: "skip", reason: "All scheduled agents are paused." };
  }
  if (isInQuietHours(limits.quietHours, input.minuteOfDay)) {
    return {
      _tag: "skip",
      reason: `Quiet hours, ${limits.quietHours?.start} to ${limits.quietHours?.end}.`,
    };
  }
  if (limits.maxRunsPerDay !== null && input.taskRunsToday >= limits.maxRunsPerDay) {
    return {
      _tag: "skip",
      reason: `Daily limit reached: ${plural(input.taskRunsToday, "run")} today, limit ${limits.maxRunsPerDay}.`,
    };
  }
  if (globals.maxRunsPerDay !== null && input.totalRunsToday >= globals.maxRunsPerDay) {
    return {
      _tag: "skip",
      reason: `Global daily cap reached: ${plural(input.totalRunsToday, "scheduled run")} today, cap ${globals.maxRunsPerDay}.`,
    };
  }
  const max = globals.maxConcurrentRuns;
  if (max !== null && input.activeRuns + input.queuedAhead >= max) {
    return {
      _tag: "queue",
      reason:
        input.activeRuns >= max
          ? `Waiting for a free slot: ${input.activeRuns} of ${max} scheduled runs are working.`
          : `Waiting for a free slot: ${plural(input.queuedAhead, "queued task")} ahead.`,
    };
  }
  return { _tag: "run" };
}

export function maxDurationMs(limits: ZenTaskLimits, globals: ZenGlobalLimits): number | null {
  const minutes = limits.maxDurationMinutes ?? globals.defaultMaxDurationMinutes;
  return minutes === null ? null : minutes * 60_000;
}

export function durationExceeded(
  workStartedAtMs: number | null,
  nowMs: number,
  limitMs: number | null,
): boolean {
  return limitMs !== null && workStartedAtMs !== null && nowMs - workStartedAtMs > limitMs;
}

/** Local calendar day as YYYY-MM-DD, from zone-adjusted `DateTime.toParts` (month 1-12). */
export function localDayKey(parts: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function minuteOfDay(parts: { readonly hour: number; readonly minute: number }): number {
  return parts.hour * 60 + parts.minute;
}

type RunLike = Pick<OrchestrationV2Run, "status">;

/** Zen run state for an orchestration run; null while it has not ended. */
export function terminalRunState(run: RunLike): ZenRunState | null {
  switch (run.status) {
    case "completed":
      return "completed";
    case "failed":
    case "rolled_back":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

/** The run a task dispatch created: the one answering the task's message id. */
export function findDispatchedRun<R extends Pick<OrchestrationV2Run, "userMessageId">>(
  runs: ReadonlyArray<R>,
  messageId: string,
): R | undefined {
  return runs.find((run) => run.userMessageId === messageId);
}

/**
 * Sums the main-agent token usage the provider reported for one run, over all its attempts.
 * Null when no turn of the run reported usage.
 */
export function sumRunTokens(
  runId: string,
  attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "runId">>,
  turns: ReadonlyArray<Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "turnTokenUsage">>,
): { readonly inputTokens: number; readonly outputTokens: number } | null {
  const attemptIds = new Set(
    attempts.filter((attempt) => attempt.runId === runId).map((attempt) => attempt.id as string),
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;
  for (const turn of turns) {
    if (turn.runAttemptId === null || !attemptIds.has(turn.runAttemptId)) continue;
    const usage = turn.turnTokenUsage;
    if (usage === undefined || usage.localCommand === true) continue;
    found = true;
    inputTokens += (usage.inputTokens ?? 0) + (usage.otherUsage?.inputTokens ?? 0);
    outputTokens += (usage.outputTokens ?? 0) + (usage.otherUsage?.outputTokens ?? 0);
  }
  return found ? { inputTokens, outputTokens } : null;
}
