// Zen Staff: limits and budgets for scheduled tasks (runs per day, run duration, concurrency,
// quiet hours, a global daily cap and a pause switch). Stored outside upstream's schema, keyed
// by task id. See ZEN.md, "Scheduled task limits".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  IsoDateTime,
  NonNegativeInt,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ZEN_SCHEDULED_LIMITS_WS_METHODS = {
  overview: "zen.scheduledLimits.overview",
  setTaskLimits: "zen.scheduledLimits.setTaskLimits",
  setGlobalLimits: "zen.scheduledLimits.setGlobalLimits",
} as const;

export const ZenTimeOfDay = TrimmedNonEmptyString.check(
  Schema.isPattern(/^([01]?\d|2[0-3]):([0-5]\d)$/),
).annotate({ description: "Server local time as HH:MM." });

/** No run starts from `start` up to `end`; a window may wrap past midnight (22:00 to 07:00). */
export const ZenQuietHours = Schema.Struct({
  start: ZenTimeOfDay,
  end: ZenTimeOfDay,
});
export type ZenQuietHours = typeof ZenQuietHours.Type;

const RunsPerDay = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }));
const DurationMinutes = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 24 * 60 }));
const ConcurrentRuns = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));

/** Null means "no limit". */
export const ZenTaskLimits = Schema.Struct({
  maxRunsPerDay: Schema.NullOr(RunsPerDay),
  maxDurationMinutes: Schema.NullOr(DurationMinutes),
  quietHours: Schema.NullOr(ZenQuietHours),
});
export type ZenTaskLimits = typeof ZenTaskLimits.Type;

export const ZEN_NO_TASK_LIMITS: ZenTaskLimits = {
  maxRunsPerDay: null,
  maxDurationMinutes: null,
  quietHours: null,
};

export const ZenGlobalLimits = Schema.Struct({
  /** Scheduled and webhook runs are skipped while on. "Run now" still works. */
  pauseAll: Schema.Boolean,
  /** All scheduled and webhook runs of the day, across tasks. */
  maxRunsPerDay: Schema.NullOr(RunsPerDay),
  /** Agent runs started by tasks that may work at once; the rest wait in a queue. */
  maxConcurrentRuns: Schema.NullOr(ConcurrentRuns),
  /** Applies to tasks without their own max duration. */
  defaultMaxDurationMinutes: Schema.NullOr(DurationMinutes),
});
export type ZenGlobalLimits = typeof ZenGlobalLimits.Type;

export const ZEN_DEFAULT_GLOBAL_LIMITS: ZenGlobalLimits = {
  pauseAll: false,
  maxRunsPerDay: null,
  maxConcurrentRuns: null,
  defaultMaxDurationMinutes: null,
};

export const ZenRunTrigger = Schema.Literals(["scheduled", "manual", "webhook"]);
export type ZenRunTrigger = typeof ZenRunTrigger.Type;

/** `run`: dispatched to a thread. `skipped`: refused by a limit. `queued`: waited for a slot. */
export const ZenRunEventKind = Schema.Literals(["run", "skipped", "queued"]);
export type ZenRunEventKind = typeof ZenRunEventKind.Type;

export const ZenRunState = Schema.Literals([
  "dispatched",
  "running",
  "stopping",
  "completed",
  "failed",
  "stopped",
  "interrupted",
  "cancelled",
  "dispatch_failed",
  "lost",
]);
export type ZenRunState = typeof ZenRunState.Type;

export const ZenRunEvent = Schema.Struct({
  id: NonNegativeInt,
  taskId: ScheduledTaskId,
  kind: ZenRunEventKind,
  trigger: ZenRunTrigger,
  at: IsoDateTime,
  reason: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(ThreadId),
  state: Schema.NullOr(ZenRunState),
  endedAt: Schema.NullOr(IsoDateTime),
  durationMs: Schema.NullOr(NonNegativeInt),
  inputTokens: Schema.NullOr(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  /** Times the same skip repeated that day after this one (`at` is the latest). */
  repeats: NonNegativeInt,
});
export type ZenRunEvent = typeof ZenRunEvent.Type;

export const ZenScheduledTaskUsage = Schema.Struct({
  taskId: ScheduledTaskId,
  title: Schema.String,
  enabled: Schema.Boolean,
  /** `interval`, `fixed_time`, `once` or `webhook`. */
  scheduleType: Schema.String,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  /** Upstream's status: never, running, succeeded (dispatched) or failed. */
  lastRunStatus: Schema.String,
  lastRunError: Schema.NullOr(Schema.String),
  limits: ZenTaskLimits,
  runsToday: NonNegativeInt,
  skipsToday: NonNegativeInt,
  activeRuns: NonNegativeInt,
  queuedSince: Schema.NullOr(IsoDateTime),
  inputTokensToday: NonNegativeInt,
  outputTokensToday: NonNegativeInt,
  lastRun: Schema.NullOr(ZenRunEvent),
  lastSkip: Schema.NullOr(ZenRunEvent),
});
export type ZenScheduledTaskUsage = typeof ZenScheduledTaskUsage.Type;

export const ZenScheduledLimitsOverviewInput = Schema.Struct({});
export type ZenScheduledLimitsOverviewInput = typeof ZenScheduledLimitsOverviewInput.Type;

export const ZenScheduledLimitsOverview = Schema.Struct({
  generatedAt: IsoDateTime,
  /** Server local day (YYYY-MM-DD) the "today" counters use. */
  localDay: Schema.String,
  timeZone: Schema.String,
  globals: ZenGlobalLimits,
  runsToday: NonNegativeInt,
  skipsToday: NonNegativeInt,
  activeRuns: NonNegativeInt,
  queuedTasks: NonNegativeInt,
  inputTokensToday: NonNegativeInt,
  outputTokensToday: NonNegativeInt,
  tasks: Schema.Array(ZenScheduledTaskUsage),
  /** Latest events across tasks, newest first. */
  recent: Schema.Array(ZenRunEvent),
});
export type ZenScheduledLimitsOverview = typeof ZenScheduledLimitsOverview.Type;

export const ZenSetTaskLimitsInput = Schema.Struct({
  taskId: ScheduledTaskId,
  limits: ZenTaskLimits,
});
export type ZenSetTaskLimitsInput = typeof ZenSetTaskLimitsInput.Type;

export const ZenSetGlobalLimitsInput = Schema.Struct({
  globals: ZenGlobalLimits,
});
export type ZenSetGlobalLimitsInput = typeof ZenSetGlobalLimitsInput.Type;

export class ZenScheduledLimitsError extends Schema.TaggedError<ZenScheduledLimitsError>()(
  "ZenScheduledLimitsError",
  {
    reason: Schema.Literals(["task-not-found", "invalid", "unavailable"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const errors = Schema.Union([ZenScheduledLimitsError, EnvironmentAuthorizationError]);

export const ZenScheduledLimitsOverviewRpc = Rpc.make(ZEN_SCHEDULED_LIMITS_WS_METHODS.overview, {
  payload: ZenScheduledLimitsOverviewInput,
  success: ZenScheduledLimitsOverview,
  error: errors,
});

export const ZenScheduledLimitsSetTaskRpc = Rpc.make(
  ZEN_SCHEDULED_LIMITS_WS_METHODS.setTaskLimits,
  {
    payload: ZenSetTaskLimitsInput,
    success: ZenScheduledLimitsOverview,
    error: errors,
  },
);

export const ZenScheduledLimitsSetGlobalRpc = Rpc.make(
  ZEN_SCHEDULED_LIMITS_WS_METHODS.setGlobalLimits,
  {
    payload: ZenSetGlobalLimitsInput,
    success: ZenScheduledLimitsOverview,
    error: errors,
  },
);

export const ZEN_SCHEDULED_LIMITS_RPC_SCOPES = {
  [ZEN_SCHEDULED_LIMITS_WS_METHODS.overview]: AuthOrchestrationReadScope,
  [ZEN_SCHEDULED_LIMITS_WS_METHODS.setTaskLimits]: AuthOrchestrationOperateScope,
  [ZEN_SCHEDULED_LIMITS_WS_METHODS.setGlobalLimits]: AuthOrchestrationOperateScope,
} as const;
