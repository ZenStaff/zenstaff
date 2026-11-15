import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ProjectId, ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { ZEN_DEFAULT_GLOBAL_LIMITS } from "@t3tools/contracts/zenScheduledLimits";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import * as ZenScheduledLimits from "./ZenScheduledLimits.ts";

const START = "2026-09-09T12:00:00.000Z";

const insertTask = (sql: SqlClient.SqlClient, id: string, next: string) =>
  sql`INSERT INTO scheduled_tasks ${sql.insert({
    task_id: id,
    title: `task ${id}`,
    prompt: "Run task",
    enabled: 1,
    schedule_json: '{"type":"interval","everyMs":3600000}',
    project_id: "project:test",
    thread_id: null,
    workspace_strategy_json: '{"type":"root"}',
    model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
    runtime_mode: "full-access",
    interaction_mode: "default",
    created_by: "user",
    creation_source: "web",
    created_at: START,
    updated_at: START,
    next_run_at: next,
    last_run_at: null,
    last_run_status: "never",
    last_run_error: null,
    run_count: 0,
  })}`;

interface FakeRun {
  id: string;
  userMessageId: string;
  status: string;
  startedAt: DateTime.Utc | null;
  completedAt: DateTime.Utc | null;
}

/** Thread runs the fake orchestrator reports, keyed by thread id. */
const makeWorld = () => {
  const runs = new Map<string, FakeRun>();
  const launched: Array<string> = [];
  const interrupted: Array<string> = [];
  let nextThread = 0;
  const layer = Layer.mergeAll(
    ManagedPolicy.layerTest(),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          const threadId = `thread-${nextThread++}`;
          launched.push(input.title);
          runs.set(threadId, {
            id: `run-${threadId}`,
            userMessageId: input.initialMessage?.messageId ?? "",
            status: "running",
            startedAt: DateTime.makeUnsafe(START),
            completedAt: null,
          });
          return { threadId: ThreadId.make(threadId) } as never;
        }),
    }),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      isScratchProject: () => Effect.succeed(false),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadRecords: ((threadId: string) =>
        Effect.sync(() => {
          const run = runs.get(threadId);
          return {
            thread: { projectId: "project:test", deletedAt: null },
            runs: run === undefined ? [] : [run],
            attempts: [{ id: `att-${threadId}`, runId: run?.id }],
            providerTurns: [
              {
                runAttemptId: `att-${threadId}`,
                turnTokenUsage: {
                  usageScope: "main_agent",
                  usageStatus: "complete",
                  hasSubagents: false,
                  inputTokens: 1200,
                  outputTokens: 300,
                },
              },
            ],
          };
        })) as never,
      interruptThread: ((input: { threadId: string }) =>
        Effect.sync(() => {
          interrupted.push(input.threadId);
          const run = runs.get(input.threadId);
          if (run !== undefined) {
            run.status = "interrupted";
            run.completedAt = DateTime.makeUnsafe(START);
          }
          return {};
        })) as never,
    }),
    Layer.mock(SecretRequests.SecretRequests)({}),
    NodeCrypto.layer,
    Scheduler.layer,
  );
  const services = Layer.provideMerge(
    ScheduledTaskService.layer,
    Layer.provideMerge(ZenScheduledLimits.layer, layer),
  );
  return { runs, launched, interrupted, services };
};

/** Lets forked scheduler passes finish; they only touch in-memory SQLite and fakes. */
const settle = Effect.gen(function* () {
  for (let index = 0; index < 50; index++) yield* Effect.yieldNow;
});

const tick = (duration: "6 seconds" | "5 seconds" | "11 minutes" | "61 minutes") =>
  TestClock.adjust(duration).pipe(Effect.andThen(settle));

const events = (sql: SqlClient.SqlClient) =>
  sql<{
    task_id: string;
    kind: string;
    reason: string | null;
    state: string | null;
    input_tokens: number | null;
    repeats: number;
  }>`SELECT task_id, kind, reason, state, input_tokens, repeats
     FROM zen_scheduled_run_events ORDER BY id`;

it.effect("pause all skips due runs, records why and schedules the next one", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* TestClock.setTime(Date.parse(START) + 1_000);
    yield* insertTask(sql, "paused", START);
    const world = makeWorld();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(world.services);
        const limits = Context.get(context, ZenScheduledLimits.ZenScheduledLimits);
        yield* limits.setGlobalLimits({
          globals: { ...ZEN_DEFAULT_GLOBAL_LIMITS, pauseAll: true },
        });
        yield* tick("6 seconds");
        const overview = yield* limits.overview({});
        assert.equal(overview.skipsToday, 1);
        assert.equal(overview.tasks[0]?.lastSkip?.reason, "All scheduled agents are paused.");
      }),
    );
    assert.deepEqual(world.launched, []);
    const rows = yield* events(sql);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.kind, "skipped");
    const [task] = yield* sql<{ next_run_at: string; last_run_status: string }>`
      SELECT next_run_at, last_run_status FROM scheduled_tasks WHERE task_id = 'paused'`;
    assert.isTrue((task?.next_run_at ?? "") > START, "the skipped run is rescheduled");
    assert.equal(task?.last_run_status, "never");
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("queues a run while every slot is busy and starts it once the slot frees", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* TestClock.setTime(Date.parse(START) + 1_000);
    yield* insertTask(sql, "a-first", START);
    yield* insertTask(sql, "b-second", START);
    const world = makeWorld();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(world.services);
        const limits = Context.get(context, ZenScheduledLimits.ZenScheduledLimits);
        yield* limits.setGlobalLimits({
          globals: { ...ZEN_DEFAULT_GLOBAL_LIMITS, maxConcurrentRuns: 1 },
        });
        yield* tick("6 seconds");
        assert.deepEqual(world.launched, ["task a-first"]);
        let overview = yield* limits.overview({});
        assert.equal(overview.activeRuns, 1);
        assert.equal(overview.queuedTasks, 1);
        const second = overview.tasks.find((task) => task.taskId === "b-second");
        assert.isNotNull(second?.queuedSince);

        // Still busy on the next poll: no second launch and no duplicate queue event.
        yield* tick("5 seconds");
        assert.deepEqual(world.launched, ["task a-first"]);

        const run = world.runs.get("thread-0");
        assert.isDefined(run);
        run!.status = "completed";
        run!.completedAt = DateTime.makeUnsafe(Date.parse(START) + 60_000);
        // The slot is free now, but a task that was not waiting cannot jump the queue.
        yield* limits.watch;
        const latecomer = yield* limits.gate(
          { id: ScheduledTaskId.make("c-latecomer"), projectId: ProjectId.make("project:test") },
          "scheduled",
        );
        assert.deepEqual(latecomer, {
          _tag: "queue",
          reason: "Waiting for a free slot: 1 queued task ahead.",
        });
        yield* tick("5 seconds");
        yield* tick("5 seconds");
        assert.deepEqual(world.launched, ["task a-first", "task b-second"]);
        overview = yield* limits.overview({});
        assert.equal(overview.queuedTasks, 0);
        assert.equal(overview.runsToday, 2);
        assert.equal(overview.inputTokensToday, 1200);
      }),
    );
    const rows = yield* events(sql);
    assert.deepEqual(
      rows.map((row) => [row.task_id, row.kind]),
      [
        ["a-first", "run"],
        ["b-second", "queued"],
        ["c-latecomer", "queued"],
        ["b-second", "run"],
      ],
    );
    assert.equal(rows[0]?.state, "completed");
    assert.equal(rows[0]?.input_tokens, 1200);
    assert.match(rows[1]?.reason ?? "", /1 of 1 scheduled runs/);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("stops a run that works past its max duration", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* TestClock.setTime(Date.parse(START) + 1_000);
    yield* insertTask(sql, "slow", START);
    const world = makeWorld();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(world.services);
        const limits = Context.get(context, ZenScheduledLimits.ZenScheduledLimits);
        yield* limits.setTaskLimits({
          taskId: ScheduledTaskId.make("slow"),
          limits: { maxRunsPerDay: null, maxDurationMinutes: 10, quietHours: null },
        });
        yield* tick("6 seconds");
        assert.deepEqual(world.launched, ["task slow"]);
        assert.deepEqual(world.interrupted, []);
        yield* tick("11 minutes");
        yield* tick("5 seconds");
        assert.deepEqual(world.interrupted, ["thread-0"]);
      }),
    );
    const rows = yield* events(sql);
    assert.equal(rows[0]?.state, "stopped");
    assert.equal(rows[0]?.reason, "Stopped after the 10 min max duration.");
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("enforces the per-task daily limit and folds repeated skips into one row", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* TestClock.setTime(Date.parse(START) + 1_000);
    yield* insertTask(sql, "capped", START);
    const world = makeWorld();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(world.services);
        const limits = Context.get(context, ZenScheduledLimits.ZenScheduledLimits);
        const service = Context.get(context, ScheduledTaskService.ScheduledTaskService);
        yield* limits.setTaskLimits({
          taskId: ScheduledTaskId.make("capped"),
          limits: { maxRunsPerDay: 1, maxDurationMinutes: null, quietHours: null },
        });
        yield* tick("6 seconds");
        assert.deepEqual(world.launched, ["task capped"]);
        // The hourly task comes due twice more; both runs are refused with the same reason.
        yield* tick("61 minutes");
        yield* tick("61 minutes");
        assert.deepEqual(world.launched, ["task capped"]);
        const overview = yield* limits.overview({});
        assert.equal(overview.tasks[0]?.runsToday, 1);
        assert.equal(overview.tasks[0]?.skipsToday, 2);
        // "Run now" is the user's explicit request and is never refused.
        const manual = yield* service.runNow({ id: ScheduledTaskId.make("capped") });
        assert.isNotNull(manual.threadId);
      }),
    );
    const rows = yield* events(sql);
    const skips = rows.filter((row) => row.kind === "skipped");
    assert.equal(skips.length, 1);
    assert.equal(skips[0]?.repeats, 1);
    assert.equal(skips[0]?.reason, "Daily limit reached: 1 run today, limit 1.");
    assert.equal(rows.filter((row) => row.kind === "run").length, 2);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
