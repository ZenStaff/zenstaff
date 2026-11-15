import type { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  ZEN_DEFAULT_GLOBAL_LIMITS,
  ZEN_NO_TASK_LIMITS,
  type ZenGlobalLimits,
  type ZenTaskLimits,
} from "@t3tools/contracts/zenScheduledLimits";

import {
  decideAdmission,
  durationExceeded,
  findDispatchedRun,
  isInQuietHours,
  localDayKey,
  maxDurationMs,
  minuteOfDay,
  sumRunTokens,
  terminalRunState,
  type AdmissionInput,
} from "./limitsPolicy.ts";

const base = (
  overrides: Partial<Omit<AdmissionInput, "limits" | "globals">> & {
    limits?: Partial<ZenTaskLimits>;
    globals?: Partial<ZenGlobalLimits>;
  } = {},
): AdmissionInput => ({
  trigger: "scheduled",
  minuteOfDay: 12 * 60,
  taskRunsToday: 0,
  totalRunsToday: 0,
  activeRuns: 0,
  queuedAhead: 0,
  ...overrides,
  limits: { ...ZEN_NO_TASK_LIMITS, ...overrides.limits },
  globals: { ...ZEN_DEFAULT_GLOBAL_LIMITS, ...overrides.globals },
});

describe("isInQuietHours", () => {
  it("covers a same-day window, start inclusive and end exclusive", () => {
    const quiet = { start: "09:00", end: "17:30" };
    expect(isInQuietHours(quiet, 9 * 60 - 1)).toBe(false);
    expect(isInQuietHours(quiet, 9 * 60)).toBe(true);
    expect(isInQuietHours(quiet, 17 * 60 + 29)).toBe(true);
    expect(isInQuietHours(quiet, 17 * 60 + 30)).toBe(false);
  });

  it("wraps past midnight", () => {
    const quiet = { start: "22:00", end: "07:00" };
    expect(isInQuietHours(quiet, 23 * 60)).toBe(true);
    expect(isInQuietHours(quiet, 0)).toBe(true);
    expect(isInQuietHours(quiet, 6 * 60 + 59)).toBe(true);
    expect(isInQuietHours(quiet, 7 * 60)).toBe(false);
    expect(isInQuietHours(quiet, 21 * 60 + 59)).toBe(false);
  });

  it("treats no window, an empty window or bad times as never quiet", () => {
    expect(isInQuietHours(null, 0)).toBe(false);
    expect(isInQuietHours({ start: "08:00", end: "08:00" }, 8 * 60)).toBe(false);
    expect(isInQuietHours({ start: "25:00", end: "08:00" }, 60)).toBe(false);
  });
});

describe("decideAdmission", () => {
  it("runs when no limit applies", () => {
    expect(decideAdmission(base())).toEqual({ _tag: "run" });
  });

  it("always runs a manual run, even paused and over every limit", () => {
    expect(
      decideAdmission(
        base({
          trigger: "manual",
          globals: { pauseAll: true, maxRunsPerDay: 1, maxConcurrentRuns: 1 },
          limits: { maxRunsPerDay: 1, quietHours: { start: "00:00", end: "23:59" } },
          taskRunsToday: 5,
          totalRunsToday: 5,
          activeRuns: 5,
        }),
      ),
    ).toEqual({ _tag: "run" });
  });

  it("skips everything while paused", () => {
    const decision = decideAdmission(base({ globals: { pauseAll: true } }));
    expect(decision).toEqual({ _tag: "skip", reason: "All scheduled agents are paused." });
  });

  it("skips in quiet hours with the window in the reason", () => {
    const decision = decideAdmission(
      base({ minuteOfDay: 23 * 60, limits: { quietHours: { start: "22:00", end: "07:00" } } }),
    );
    expect(decision).toEqual({ _tag: "skip", reason: "Quiet hours, 22:00 to 07:00." });
  });

  it("skips at the task's daily limit, not below it", () => {
    expect(decideAdmission(base({ limits: { maxRunsPerDay: 3 }, taskRunsToday: 2 }))._tag).toBe(
      "run",
    );
    expect(decideAdmission(base({ limits: { maxRunsPerDay: 3 }, taskRunsToday: 3 }))).toEqual({
      _tag: "skip",
      reason: "Daily limit reached: 3 runs today, limit 3.",
    });
  });

  it("skips at the global daily cap", () => {
    expect(decideAdmission(base({ globals: { maxRunsPerDay: 10 }, totalRunsToday: 10 }))).toEqual({
      _tag: "skip",
      reason: "Global daily cap reached: 10 scheduled runs today, cap 10.",
    });
  });

  it("queues instead of failing when every slot is busy", () => {
    expect(decideAdmission(base({ globals: { maxConcurrentRuns: 2 }, activeRuns: 1 }))._tag).toBe(
      "run",
    );
    expect(decideAdmission(base({ globals: { maxConcurrentRuns: 2 }, activeRuns: 2 }))).toEqual({
      _tag: "queue",
      reason: "Waiting for a free slot: 2 of 2 scheduled runs are working.",
    });
  });

  it("gives a free slot to tasks that queued earlier", () => {
    expect(
      decideAdmission(base({ globals: { maxConcurrentRuns: 2 }, activeRuns: 1, queuedAhead: 1 })),
    ).toEqual({ _tag: "queue", reason: "Waiting for a free slot: 1 queued task ahead." });
    expect(
      decideAdmission(base({ globals: { maxConcurrentRuns: 3 }, activeRuns: 1, queuedAhead: 1 }))
        ._tag,
    ).toBe("run");
  });

  it("prefers a skip over the queue so a run that cannot start never waits", () => {
    const decision = decideAdmission(
      base({
        globals: { maxConcurrentRuns: 1 },
        limits: { maxRunsPerDay: 1 },
        taskRunsToday: 1,
        activeRuns: 1,
      }),
    );
    expect(decision._tag).toBe("skip");
  });

  it("applies limits to webhook runs too", () => {
    expect(decideAdmission(base({ trigger: "webhook", globals: { pauseAll: true } }))._tag).toBe(
      "skip",
    );
  });
});

describe("durations", () => {
  it("uses the task's limit, then the global default", () => {
    expect(maxDurationMs(ZEN_NO_TASK_LIMITS, ZEN_DEFAULT_GLOBAL_LIMITS)).toBeNull();
    expect(
      maxDurationMs(ZEN_NO_TASK_LIMITS, {
        ...ZEN_DEFAULT_GLOBAL_LIMITS,
        defaultMaxDurationMinutes: 30,
      }),
    ).toBe(30 * 60_000);
    expect(
      maxDurationMs(
        { ...ZEN_NO_TASK_LIMITS, maxDurationMinutes: 5 },
        { ...ZEN_DEFAULT_GLOBAL_LIMITS, defaultMaxDurationMinutes: 30 },
      ),
    ).toBe(5 * 60_000);
  });

  it("is exceeded only past the limit, and only once work started", () => {
    expect(durationExceeded(0, 60_000, 60_000)).toBe(false);
    expect(durationExceeded(0, 60_001, 60_000)).toBe(true);
    expect(durationExceeded(null, 10_000_000, 60_000)).toBe(false);
    expect(durationExceeded(0, 10_000_000, null)).toBe(false);
  });
});

describe("local time helpers", () => {
  it("formats the local day and the minute of day", () => {
    expect(localDayKey({ year: 2026, month: 3, day: 7 })).toBe("2026-03-07");
    expect(minuteOfDay({ hour: 13, minute: 5 })).toBe(785);
  });
});

describe("runs", () => {
  it("maps terminal statuses and leaves active ones open", () => {
    expect(terminalRunState({ status: "completed" })).toBe("completed");
    expect(terminalRunState({ status: "rolled_back" })).toBe("failed");
    expect(terminalRunState({ status: "interrupted" })).toBe("interrupted");
    expect(terminalRunState({ status: "cancelled" })).toBe("cancelled");
    expect(terminalRunState({ status: "running" })).toBeNull();
    expect(terminalRunState({ status: "queued" })).toBeNull();
  });

  it("finds the run that answers the task's message", () => {
    const runs = [
      { id: "a", userMessageId: "m-1" },
      { id: "b", userMessageId: "m-2" },
    ] as never as ReadonlyArray<{ id: string; userMessageId: MessageId }>;
    expect(findDispatchedRun(runs, "m-2")?.id).toBe("b");
    expect(findDispatchedRun(runs, "m-3")).toBeUndefined();
  });

  it("sums token usage over every attempt of the run, skipping other runs", () => {
    const attempts = [
      { id: "att-1", runId: "run-1" },
      { id: "att-2", runId: "run-1" },
      { id: "att-3", runId: "run-2" },
    ] as never;
    const usage = (inputTokens: number, outputTokens: number, extra: object = {}) => ({
      usageScope: "main_agent" as const,
      usageStatus: "complete" as const,
      hasSubagents: false,
      inputTokens,
      outputTokens,
      ...extra,
    });
    const turns = [
      { runAttemptId: "att-1", turnTokenUsage: usage(100, 10) },
      {
        runAttemptId: "att-2",
        turnTokenUsage: usage(50, 5, { otherUsage: { inputTokens: 7, outputTokens: 3 } }),
      },
      { runAttemptId: "att-2", turnTokenUsage: usage(999, 999, { localCommand: true }) },
      { runAttemptId: "att-3", turnTokenUsage: usage(1000, 1000) },
      { runAttemptId: null, turnTokenUsage: usage(1, 1) },
      { runAttemptId: "att-1" },
    ] as never;
    expect(sumRunTokens("run-1", attempts, turns)).toEqual({ inputTokens: 157, outputTokens: 18 });
    expect(sumRunTokens("run-3", attempts, turns)).toBeNull();
  });
});
