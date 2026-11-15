// Zen Staff: scheduled task limits. ScheduledTaskService asks `gate` before each run; a scheduler
// source follows dispatched agent runs to free slots, stop overlong runs and record tokens.
// Config and history live in zen_* SQLite tables created here, not upstream migrations (ZEN.md).
import { CommandId, ScheduledTaskId, ThreadId, type ScheduledTask } from "@t3tools/contracts";
import {
  ZEN_DEFAULT_GLOBAL_LIMITS,
  ZEN_NO_TASK_LIMITS,
  ZEN_SCHEDULED_LIMITS_WS_METHODS,
  ZenGlobalLimits,
  ZenScheduledLimitsError,
  ZenTaskLimits,
  type ZenRunEvent,
  type ZenRunEventKind,
  type ZenRunState,
  type ZenRunTrigger,
  type ZenScheduledLimitsOverview,
  type ZenScheduledLimitsOverviewInput,
  type ZenScheduledTaskUsage,
  type ZenSetGlobalLimitsInput,
  type ZenSetTaskLimitsInput,
} from "@t3tools/contracts/zenScheduledLimits";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import {
  decideAdmission,
  durationExceeded,
  findDispatchedRun,
  localDayKey,
  maxDurationMs,
  minuteOfDay,
  sumRunTokens,
  terminalRunState,
} from "./limitsPolicy.ts";

/** A reserved slot that never reported its dispatch (the run failed before it) is released. */
const RESERVATION_TTL_MS = 2 * 60_000;
/** A dispatched run whose thread never shows it is given up on after this long. */
const LOST_AFTER_MS = 24 * 60 * 60_000;
const EVENT_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 60 * 60_000;
const RECENT_EVENTS = 50;
const WEBHOOK_QUEUE_POLL = "5 seconds";
/** Due tasks ask again every scheduler tick (5 s); one that stopped asking left the queue. */
const QUEUE_STALE_MS = 30_000;
const ACTIVE_STATES = ["dispatched", "running", "stopping"] as const;

export type ZenGate =
  | {
      readonly _tag: "run";
      /** Reports the dispatch; never fails. `threadId` is null when it failed. */
      readonly started: (input: {
        readonly threadId: ThreadId | null;
        readonly messageId: string;
        readonly error: string | null;
      }) => Effect.Effect<void>;
    }
  | { readonly _tag: "skip"; readonly reason: string }
  | { readonly _tag: "queue"; readonly reason: string };

type GateTask = Pick<ScheduledTask, "id" | "projectId">;

interface EventRow {
  readonly id: number;
  readonly task_id: string;
  readonly kind: string;
  readonly trigger: string;
  readonly at: string;
  readonly local_day: string;
  readonly reason: string | null;
  readonly thread_id: string | null;
  readonly project_id: string | null;
  readonly message_id: string | null;
  readonly run_id: string | null;
  readonly state: string | null;
  readonly work_started_at: string | null;
  readonly ended_at: string | null;
  readonly duration_ms: number | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly repeats: number;
}

interface TaskRow {
  readonly task_id: string;
  readonly title: string;
  readonly enabled: number;
  readonly schedule_json: string;
  readonly next_run_at: string | null;
  readonly last_run_at: string | null;
  readonly last_run_status: string;
  readonly last_run_error: string | null;
}

const decodeTaskLimits = Schema.decodeUnknownOption(Schema.fromJsonString(ZenTaskLimits));
const decodeGlobalLimits = Schema.decodeUnknownOption(Schema.fromJsonString(ZenGlobalLimits));
const encodeTaskLimits = Schema.encodeSync(Schema.fromJsonString(ZenTaskLimits));
const encodeGlobalLimits = Schema.encodeSync(Schema.fromJsonString(ZenGlobalLimits));
const decodeScheduleType = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ type: Schema.String })),
);

interface Instant {
  readonly ms: number;
  readonly iso: string;
  /** Server local day, YYYY-MM-DD. */
  readonly day: string;
  readonly minuteOfDay: number;
}

const isoOf = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

/** Times in server local time, the zone upstream's fixed-time schedules use. */
const instantOf = (ms: number): Instant => {
  const parts = DateTime.toParts(
    DateTime.makeZonedUnsafe(ms, { timeZone: DateTime.zoneMakeLocal() }),
  );
  return { ms, iso: isoOf(ms), day: localDayKey(parts), minuteOfDay: minuteOfDay(parts) };
};

const fail = (reason: ZenScheduledLimitsError["reason"], detail: string) =>
  new ZenScheduledLimitsError({ reason, detail });
const isZenScheduledLimitsError = Schema.is(ZenScheduledLimitsError);

const EVENT_KINDS: ReadonlyArray<string> = ["run", "skipped", "queued"];
const TRIGGERS: ReadonlyArray<string> = ["scheduled", "manual", "webhook"];
const STATES: ReadonlyArray<string> = [
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
];

const countSkips = (rows: ReadonlyArray<EventRow>) =>
  rows.reduce((sum, row) => (row.kind === "skipped" ? sum + 1 + row.repeats : sum), 0);

function toRunEvent(row: EventRow): ZenRunEvent {
  return {
    id: row.id,
    taskId: ScheduledTaskId.make(row.task_id),
    kind: (EVENT_KINDS.includes(row.kind) ? row.kind : "run") as ZenRunEventKind,
    trigger: (TRIGGERS.includes(row.trigger) ? row.trigger : "scheduled") as ZenRunTrigger,
    at: row.at,
    reason: row.reason,
    threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
    state: row.state !== null && STATES.includes(row.state) ? (row.state as ZenRunState) : null,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    repeats: row.repeats,
  };
}

export class ZenScheduledLimits extends Context.Service<
  ZenScheduledLimits,
  {
    /** Decides a run; for "run" it holds a concurrency slot until `started` reports. */
    readonly gate: (task: GateTask, trigger: ZenRunTrigger) => Effect.Effect<ZenGate>;
    /** Whether a task waits for a slot; its due run must not be dropped as missed. */
    readonly isQueued: (taskId: ScheduledTaskId) => Effect.Effect<boolean>;
    /** Follows running agent runs; the scheduler calls it every tick. */
    readonly watch: Effect.Effect<void>;
    readonly overview: (
      input: ZenScheduledLimitsOverviewInput,
    ) => Effect.Effect<ZenScheduledLimitsOverview, ZenScheduledLimitsError>;
    readonly setTaskLimits: (
      input: ZenSetTaskLimitsInput,
    ) => Effect.Effect<ZenScheduledLimitsOverview, ZenScheduledLimitsError>;
    readonly setGlobalLimits: (
      input: ZenSetGlobalLimitsInput,
    ) => Effect.Effect<ZenScheduledLimitsOverview, ZenScheduledLimitsError>;
  }
>()("t3/zen/scheduledLimits/ZenScheduledLimits") {}

const ensureSchema = Effect.fn("ZenScheduledLimits.ensureSchema")(function* (
  sql: SqlClient.SqlClient,
) {
  yield* sql`
      CREATE TABLE IF NOT EXISTS zen_scheduled_task_limits (
        task_id TEXT PRIMARY KEY,
        limits_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
  yield* sql`
      CREATE TABLE IF NOT EXISTS zen_scheduled_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
  yield* sql`
      CREATE TABLE IF NOT EXISTS zen_scheduled_run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        trigger TEXT NOT NULL,
        at TEXT NOT NULL,
        local_day TEXT NOT NULL,
        reason TEXT,
        thread_id TEXT,
        project_id TEXT,
        message_id TEXT,
        run_id TEXT,
        state TEXT,
        work_started_at TEXT,
        ended_at TEXT,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        repeats INTEGER NOT NULL DEFAULT 0
      )
    `;
  yield* sql`
      CREATE INDEX IF NOT EXISTS zen_scheduled_run_events_day
      ON zen_scheduled_run_events (local_day, task_id)
    `;
  yield* sql`
      CREATE INDEX IF NOT EXISTS zen_scheduled_run_events_state
      ON zen_scheduled_run_events (state)
    `;
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const admitLock = yield* Semaphore.make(1);

  yield* ensureSchema(sql);

  /** Reservation id -> expiry (ms). Slots held between `gate` and `started`. */
  const reservations = new Map<number, number>();
  let nextReservation = 0;
  /** Task id -> since (ISO) for tasks waiting on a concurrency slot. */
  const queued = new Map<string, { readonly since: string; seenAt: number }>();
  /** Queued tasks that asked again recently and waited longer than `since`, in queue order. */
  const queuedAhead = (taskId: string, since: string, nowMs: number) => {
    let ahead = 0;
    for (const [id, entry] of queued) {
      if (nowMs - entry.seenAt > QUEUE_STALE_MS) queued.delete(id);
      else if (id !== taskId && (entry.since < since || (entry.since === since && id < taskId))) {
        ahead++;
      }
    }
    return ahead;
  };
  let prunedAt = 0;

  const now = Clock.currentTimeMillis.pipe(Effect.map(instantOf));

  const readGlobals = sql<{ value_json: string }>`
    SELECT value_json FROM zen_scheduled_settings WHERE key = 'globals'
  `.pipe(
    NodeSqliteClient.readOnly,
    Effect.map((rows) =>
      rows[0] === undefined
        ? ZEN_DEFAULT_GLOBAL_LIMITS
        : Option.getOrElse(decodeGlobalLimits(rows[0].value_json), () => ZEN_DEFAULT_GLOBAL_LIMITS),
    ),
  );

  const readAllTaskLimits = sql<{ task_id: string; limits_json: string }>`
    SELECT task_id, limits_json FROM zen_scheduled_task_limits
  `.pipe(
    NodeSqliteClient.readOnly,
    Effect.map(
      (rows) =>
        new Map(
          rows.map((row) => [
            row.task_id,
            Option.getOrElse(decodeTaskLimits(row.limits_json), () => ZEN_NO_TASK_LIMITS),
          ]),
        ),
    ),
  );

  const readTaskLimits = (taskId: string) =>
    sql<{ limits_json: string }>`
      SELECT limits_json FROM zen_scheduled_task_limits WHERE task_id = ${taskId}
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) =>
        rows[0] === undefined
          ? ZEN_NO_TASK_LIMITS
          : Option.getOrElse(decodeTaskLimits(rows[0].limits_json), () => ZEN_NO_TASK_LIMITS),
      ),
    );

  const liveReservations = (nowMs: number) => {
    for (const [id, expiresAt] of reservations) {
      if (expiresAt <= nowMs) reservations.delete(id);
    }
    return reservations.size;
  };

  const insertEvent = (event: {
    readonly taskId: string;
    readonly kind: ZenRunEventKind;
    readonly trigger: ZenRunTrigger;
    readonly at: Instant;
    readonly reason: string | null;
    readonly threadId?: string | null;
    readonly projectId?: string | null;
    readonly messageId?: string | null;
    readonly state?: ZenRunState | null;
  }) =>
    sql`INSERT INTO zen_scheduled_run_events ${sql.insert({
      task_id: event.taskId,
      kind: event.kind,
      trigger: event.trigger,
      at: event.at.iso,
      local_day: event.at.day,
      reason: event.reason,
      thread_id: event.threadId ?? null,
      project_id: event.projectId ?? null,
      message_id: event.messageId ?? null,
      state: event.state ?? null,
      ended_at: event.state === "dispatch_failed" ? event.at.iso : null,
    })}`;

  const admit = (task: GateTask, trigger: ZenRunTrigger) =>
    admitLock.withPermits(1)(
      Effect.gen(function* () {
        const at = yield* now;
        const day = at.day;
        const [limits, globals] = yield* Effect.all([readTaskLimits(task.id), readGlobals]);
        const [counts] = yield* sql<{ task_runs: number; total_runs: number; active: number }>`
          SELECT
            COALESCE(SUM(CASE WHEN kind = 'run' AND local_day = ${day} AND task_id = ${task.id}
              THEN 1 ELSE 0 END), 0) AS task_runs,
            COALESCE(SUM(CASE WHEN kind = 'run' AND local_day = ${day} THEN 1 ELSE 0 END), 0)
              AS total_runs,
            COALESCE(SUM(CASE WHEN kind = 'run' AND state IN ${sql.in(ACTIVE_STATES)}
              THEN 1 ELSE 0 END), 0) AS active
          FROM zen_scheduled_run_events
        `.pipe(NodeSqliteClient.readOnly);
        const admission = decideAdmission({
          trigger,
          limits,
          globals,
          minuteOfDay: at.minuteOfDay,
          taskRunsToday: counts?.task_runs ?? 0,
          totalRunsToday: counts?.total_runs ?? 0,
          activeRuns: (counts?.active ?? 0) + liveReservations(at.ms),
          queuedAhead: queuedAhead(task.id, queued.get(task.id)?.since ?? at.iso, at.ms),
        });
        if (admission._tag === "queue") {
          const entry = queued.get(task.id);
          if (entry !== undefined) entry.seenAt = at.ms;
          else {
            queued.set(task.id, { since: at.iso, seenAt: at.ms });
            yield* insertEvent({
              taskId: task.id,
              kind: "queued",
              trigger,
              at,
              reason: admission.reason,
            });
          }
          return { admission, reservation: null };
        }
        queued.delete(task.id);
        if (admission._tag === "skip") {
          // The same skip again the same day (a paused interval task) bumps one row.
          const [last] = yield* sql<{
            id: number;
            kind: string;
            reason: string | null;
            local_day: string;
          }>`
            SELECT id, kind, reason, local_day FROM zen_scheduled_run_events
            WHERE task_id = ${task.id} ORDER BY id DESC LIMIT 1
          `;
          if (
            last !== undefined &&
            last.kind === "skipped" &&
            last.reason === admission.reason &&
            last.local_day === at.day
          ) {
            yield* sql`
              UPDATE zen_scheduled_run_events SET repeats = repeats + 1, at = ${at.iso}
              WHERE id = ${last.id}
            `;
            return { admission, reservation: null };
          }
          yield* insertEvent({
            taskId: task.id,
            kind: "skipped",
            trigger,
            at,
            reason: admission.reason,
          });
          yield* Effect.logInfo("Scheduled task run skipped by a Zen limit", {
            taskId: task.id,
            reason: admission.reason,
          });
          return { admission, reservation: null };
        }
        const reservation = nextReservation++;
        reservations.set(reservation, at.ms + RESERVATION_TTL_MS);
        return { admission, reservation };
      }),
    );

  const started =
    (task: GateTask, trigger: ZenRunTrigger, reservation: number) =>
    (input: {
      readonly threadId: ThreadId | null;
      readonly messageId: string;
      readonly error: string | null;
    }) =>
      Effect.gen(function* () {
        const at = yield* now;
        yield* insertEvent({
          taskId: task.id,
          kind: "run",
          trigger,
          at,
          reason: input.error,
          threadId: input.threadId,
          projectId: task.projectId,
          messageId: input.messageId,
          state: input.threadId === null ? "dispatch_failed" : "dispatched",
        });
      }).pipe(
        Effect.ensuring(Effect.sync(() => reservations.delete(reservation))),
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not record a scheduled task run", { taskId: task.id, cause }),
        ),
      );

  const gateOnce = (task: GateTask, trigger: ZenRunTrigger): Effect.Effect<ZenGate> =>
    admit(task, trigger).pipe(
      Effect.map(({ admission, reservation }): ZenGate => {
        if (admission._tag !== "run" || reservation === null) return admission as ZenGate;
        return { _tag: "run", started: started(task, trigger, reservation) };
      }),
      // A broken limits store must not stop scheduled work: run without limits and log it.
      Effect.catchCause((cause) =>
        Effect.logWarning("Zen scheduled limits unavailable; running without limits", {
          taskId: task.id,
          cause,
        }).pipe(Effect.as<ZenGate>({ _tag: "run", started: () => Effect.void })),
      ),
    );

  // Webhook deliveries have no due time to come back to, so they wait here for a slot.
  const gate: ZenScheduledLimits["Service"]["gate"] = (task, trigger) =>
    trigger !== "webhook"
      ? gateOnce(task, trigger)
      : Effect.gen(function* () {
          while (true) {
            const decision = yield* gateOnce(task, trigger);
            if (decision._tag !== "queue") return decision;
            yield* Effect.sleep(WEBHOOK_QUEUE_POLL);
          }
        });

  const isQueued: ZenScheduledLimits["Service"]["isQueued"] = (taskId) =>
    Effect.sync(() => queued.has(taskId));

  const updateEvent = (id: number, fields: Record<string, string | number | null>) =>
    sql`UPDATE zen_scheduled_run_events SET ${sql.update(fields)} WHERE id = ${id}`;

  const follow = Effect.fn("ZenScheduledLimits.follow")(
    function* (row: EventRow, nowMs: number, globals: ZenGlobalLimits) {
      const ageMs = nowMs - Date.parse(row.at);
      const giveUp = (reason: string) =>
        updateEvent(row.id, {
          state: "lost",
          reason,
          ended_at: isoOf(nowMs),
        });
      if (row.thread_id === null || row.message_id === null) {
        return yield* giveUp("The run has no thread to follow.");
      }
      const threadId = ThreadId.make(row.thread_id);
      const records = yield* Effect.result(threads.getThreadRecords(threadId, ["runs"]));
      if (records._tag === "Failure") {
        if (ageMs > LOST_AFTER_MS) yield* giveUp("The thread could not be read.");
        return;
      }
      const projection = records.success;
      if (projection.thread.deletedAt !== null) {
        return yield* giveUp("The thread was deleted.");
      }
      const run = findDispatchedRun(projection.runs, row.message_id);
      if (run === undefined) {
        if (ageMs > LOST_AFTER_MS) yield* giveUp("The run never started in its thread.");
        return;
      }
      const workStarted =
        run.status === "queued" || run.status === "preparing"
          ? null
          : (run.workStartedAt ?? run.startedAt);
      const workStartedMs = workStarted === null ? null : DateTime.toEpochMillis(workStarted);
      const terminal = terminalRunState(run);
      if (terminal !== null) {
        const usage = yield* threads.getThreadRecords(threadId, ["attempts", "providerTurns"]).pipe(
          Effect.map((records) => sumRunTokens(run.id, records.attempts, records.providerTurns)),
          Effect.orElseSucceed(() => null),
        );
        const endedMs = run.completedAt === null ? nowMs : DateTime.toEpochMillis(run.completedAt);
        return yield* updateEvent(row.id, {
          state: row.state === "stopping" ? "stopped" : terminal,
          run_id: run.id,
          work_started_at: workStartedMs === null ? null : isoOf(workStartedMs),
          ended_at: isoOf(endedMs),
          duration_ms: workStartedMs === null ? null : Math.max(0, endedMs - workStartedMs),
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: usage?.outputTokens ?? null,
        });
      }
      if (row.state === "stopping") return;
      const limits = yield* readTaskLimits(row.task_id);
      const limitMs = maxDurationMs(limits, globals);
      if (durationExceeded(workStartedMs, nowMs, limitMs)) {
        const minutes = Math.round((limitMs ?? 0) / 60_000);
        const reason = `Stopped after the ${minutes} min max duration.`;
        yield* updateEvent(row.id, { state: "stopping", run_id: run.id, reason });
        yield* threads
          .interruptThread({
            projectId: projection.thread.projectId,
            commandId: CommandId.make(`zen-limit-stop:${run.id}`),
            threadId,
            runId: run.id,
            reason,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not stop a scheduled run over its max duration", {
                taskId: row.task_id,
                threadId,
                cause,
              }),
            ),
          );
        yield* Effect.logInfo("Stopped a scheduled run over its max duration", {
          taskId: row.task_id,
          threadId,
          minutes,
        });
        return;
      }
      if (row.state !== "running" || row.run_id === null) {
        yield* updateEvent(row.id, {
          state: "running",
          run_id: run.id,
          work_started_at: workStartedMs === null ? null : isoOf(workStartedMs),
        });
      }
    },
    (effect, row) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not follow a scheduled task run", { eventId: row.id, cause }),
        ),
      ),
  );

  const prune = Effect.fn("ZenScheduledLimits.prune")(function* (nowMs: number) {
    if (nowMs - prunedAt < PRUNE_INTERVAL_MS) return;
    prunedAt = nowMs;
    const cutoff = instantOf(nowMs - EVENT_RETENTION_DAYS * 24 * 60 * 60_000).day;
    yield* sql`
        DELETE FROM zen_scheduled_run_events
        WHERE local_day < ${cutoff} AND (state IS NULL OR state NOT IN ${sql.in(ACTIVE_STATES)})
      `;
    yield* sql`
        DELETE FROM zen_scheduled_task_limits
        WHERE task_id NOT IN (SELECT task_id FROM scheduled_tasks WHERE task_id IS NOT NULL)
      `;
  });

  const watch: ZenScheduledLimits["Service"]["watch"] = Effect.gen(function* () {
    const at = yield* now;
    const nowMs = at.ms;
    yield* prune(nowMs);
    const rows = yield* sql<EventRow>`
      SELECT * FROM zen_scheduled_run_events
      WHERE kind = 'run' AND state IN ${sql.in(ACTIVE_STATES)}
      ORDER BY id
    `.pipe(NodeSqliteClient.readOnly);
    if (rows.length === 0) return;
    const globals = yield* readGlobals;
    yield* Effect.forEach(rows, (row) => follow(row, nowMs, globals), { discard: true });
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Zen scheduled limits watch failed", { cause })),
  );

  const buildOverview = Effect.gen(function* () {
    const at = yield* now;
    const day = at.day;
    const globals = yield* readGlobals;
    const limitsByTask = yield* readAllTaskLimits;
    const tasks = yield* sql<TaskRow>`
      SELECT task_id, title, enabled, schedule_json, next_run_at, last_run_at, last_run_status,
        last_run_error
      FROM scheduled_tasks WHERE task_id IS NOT NULL
      ORDER BY title COLLATE NOCASE, task_id
    `.pipe(NodeSqliteClient.readOnly);
    const today = yield* sql<EventRow>`
      SELECT * FROM zen_scheduled_run_events WHERE local_day = ${day}
    `.pipe(NodeSqliteClient.readOnly);
    const latest = yield* sql<EventRow>`
      SELECT * FROM zen_scheduled_run_events WHERE id IN (
        SELECT MAX(id) FROM zen_scheduled_run_events WHERE kind IN ('run', 'skipped')
        GROUP BY task_id, kind
      )
    `.pipe(NodeSqliteClient.readOnly);
    const active = yield* sql<{ task_id: string; count: number }>`
      SELECT task_id, COUNT(*) AS count FROM zen_scheduled_run_events
      WHERE kind = 'run' AND state IN ${sql.in(ACTIVE_STATES)}
      GROUP BY task_id
    `.pipe(NodeSqliteClient.readOnly);
    const recent = yield* sql<EventRow>`
      SELECT * FROM zen_scheduled_run_events ORDER BY id DESC LIMIT ${RECENT_EVENTS}
    `.pipe(NodeSqliteClient.readOnly);

    // A task paused, deleted or rescheduled while it waited is no longer in the queue.
    for (const taskId of queued.keys()) {
      const task = tasks.find((row) => row.task_id === taskId);
      if (
        task === undefined ||
        task.enabled !== 1 ||
        task.next_run_at === null ||
        task.next_run_at > at.iso
      ) {
        queued.delete(taskId);
      }
    }
    const activeByTask = new Map(active.map((row) => [row.task_id, row.count]));
    const usage: Array<ZenScheduledTaskUsage> = tasks.map((task) => {
      const events = today.filter((row) => row.task_id === task.task_id);
      const runs = events.filter((row) => row.kind === "run");
      const lastRun = latest.find((row) => row.task_id === task.task_id && row.kind === "run");
      const lastSkip = latest.find((row) => row.task_id === task.task_id && row.kind === "skipped");
      return {
        taskId: ScheduledTaskId.make(task.task_id),
        title: task.title,
        enabled: task.enabled === 1,
        scheduleType: Option.match(decodeScheduleType(task.schedule_json), {
          onNone: () => "unknown",
          onSome: (schedule) => schedule.type,
        }),
        nextRunAt: task.next_run_at,
        lastRunAt: task.last_run_at,
        lastRunStatus: task.last_run_status,
        lastRunError: task.last_run_error,
        limits: limitsByTask.get(task.task_id) ?? ZEN_NO_TASK_LIMITS,
        runsToday: runs.length,
        skipsToday: countSkips(events),
        activeRuns: activeByTask.get(task.task_id) ?? 0,
        queuedSince: queued.get(task.task_id)?.since ?? null,
        inputTokensToday: runs.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
        outputTokensToday: runs.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
        lastRun: lastRun === undefined ? null : toRunEvent(lastRun),
        lastSkip: lastSkip === undefined ? null : toRunEvent(lastSkip),
      };
    });
    const runsToday = today.filter((row) => row.kind === "run");
    return {
      generatedAt: at.iso,
      localDay: day,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      globals,
      runsToday: runsToday.length,
      skipsToday: countSkips(today),
      activeRuns: active.reduce((sum, row) => sum + row.count, 0),
      queuedTasks: queued.size,
      inputTokensToday: runsToday.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
      outputTokensToday: runsToday.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
      tasks: usage,
      recent: recent.map(toRunEvent),
    } satisfies ZenScheduledLimitsOverview;
  });

  const unavailable = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((cause) =>
        isZenScheduledLimitsError(cause)
          ? cause
          : fail("unavailable", "Could not read the scheduled task limits."),
      ),
    );

  const overview: ZenScheduledLimits["Service"]["overview"] = () => unavailable(buildOverview);

  const setTaskLimits: ZenScheduledLimits["Service"]["setTaskLimits"] = (input) =>
    unavailable(
      Effect.gen(function* () {
        const exists = yield* sql`
          SELECT 1 FROM scheduled_tasks WHERE task_id = ${input.taskId}
        `.pipe(NodeSqliteClient.readOnly);
        if (exists.length === 0) {
          return yield* fail("task-not-found", "This scheduled task no longer exists.");
        }
        const at = yield* now;
        yield* sql`
          INSERT INTO zen_scheduled_task_limits (task_id, limits_json, updated_at)
          VALUES (${input.taskId}, ${encodeTaskLimits(input.limits)}, ${at.iso})
          ON CONFLICT (task_id) DO UPDATE SET
            limits_json = excluded.limits_json,
            updated_at = excluded.updated_at
        `;
        return yield* buildOverview;
      }),
    );

  const setGlobalLimits: ZenScheduledLimits["Service"]["setGlobalLimits"] = (input) =>
    unavailable(
      Effect.gen(function* () {
        const at = yield* now;
        yield* sql`
          INSERT INTO zen_scheduled_settings (key, value_json, updated_at)
          VALUES ('globals', ${encodeGlobalLimits(input.globals)}, ${at.iso})
          ON CONFLICT (key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `;
        return yield* buildOverview;
      }),
    );

  return ZenScheduledLimits.of({
    gate,
    isQueued,
    watch,
    overview,
    setTaskLimits,
    setGlobalLimits,
  });
});

/** The service plus its scheduler source that follows running agent runs. */
export const layer = Layer.effect(
  ZenScheduledLimits,
  Effect.gen(function* () {
    const service = yield* make;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("zen-scheduled-limits", service.watch);
    return service;
  }),
);

/**
 * What ScheduledTaskService calls. The service is optional, so upstream's scheduled task tests,
 * which build the service without Zen layers, run with no limits.
 */
export const hooks = (service: Option.Option<ZenScheduledLimits["Service"]>) => ({
  gate: (task: GateTask, trigger: ZenRunTrigger): Effect.Effect<ZenGate> =>
    Option.isSome(service)
      ? service.value.gate(task, trigger)
      : Effect.succeed({ _tag: "run", started: () => Effect.void }),
  isQueued: (taskId: ScheduledTaskId): Effect.Effect<boolean> =>
    Option.isSome(service) ? service.value.isQueued(taskId) : Effect.succeed(false),
});

/** RPC handlers for ws.ts, kept here so the upstream file only spreads them in. */
export const wsHandlers = (service: Option.Option<ZenScheduledLimits["Service"]>) => {
  const unavailable = Effect.fail(
    fail("unavailable", "Scheduled task limits are not available on this server."),
  );
  return {
    [ZEN_SCHEDULED_LIMITS_WS_METHODS.overview]: (input: ZenScheduledLimitsOverviewInput) =>
      Option.isSome(service) ? service.value.overview(input) : unavailable,
    [ZEN_SCHEDULED_LIMITS_WS_METHODS.setTaskLimits]: (input: ZenSetTaskLimitsInput) =>
      Option.isSome(service) ? service.value.setTaskLimits(input) : unavailable,
    [ZEN_SCHEDULED_LIMITS_WS_METHODS.setGlobalLimits]: (input: ZenSetGlobalLimitsInput) =>
      Option.isSome(service) ? service.value.setGlobalLimits(input) : unavailable,
  };
};
