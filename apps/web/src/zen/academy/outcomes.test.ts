import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_PROGRESS,
  getAcademyProgress,
  isLessonDone,
  markLesson,
  mergeProgress,
  registerAcademyProgressSync,
  setLessonDone,
  type AcademyProgress,
  type AcademyProgressEvent,
} from "./progress";
import { addOutcomes, emptySignals, topicLabelsFor } from "./signals";
import {
  EMPTY_OUTCOME_TRACKER,
  observeOutcomes,
  parseOutcomeTracker,
  type OutcomeThread,
} from "./taskOutcomes";

const thread = (
  id: string,
  runId: string,
  status: string,
  title = "Raport Excel",
): OutcomeThread => ({
  id,
  title,
  latestRun: { runId, status },
});

describe("failed and heavily corrected task signals", () => {
  it("counts a failed run once, with topic labels only", () => {
    const first = observeOutcomes(
      EMPTY_OUTCOME_TRACKER,
      [thread("t1", "r1", "failed")],
      topicLabelsFor,
      1,
    );
    expect(first.events).toEqual([
      { kind: "failed", threadId: "t1", labels: ["spreadsheets", "reports"] },
    ]);
    const again = observeOutcomes(first.tracker, [thread("t1", "r1", "failed")], topicLabelsFor, 2);
    expect(again.events).toEqual([]);
    expect(again.tracker).toBe(first.tracker);
  });

  it("counts a task corrected more than 3 times once", () => {
    let tracker = EMPTY_OUTCOME_TRACKER;
    const events = [];
    for (let run = 1; run <= 6; run++) {
      const result = observeOutcomes(
        tracker,
        [thread("t1", `r${run}`, "completed")],
        topicLabelsFor,
        run,
      );
      tracker = result.tracker;
      events.push(...result.events);
    }
    // Runs 1-4 = the first message and 3 corrections: not yet; the 5th run is the 4th correction.
    expect(events).toEqual([
      { kind: "corrected", threadId: "t1", labels: ["spreadsheets", "reports"] },
    ]);
  });

  it("does not count old history as new corrections when the app opens", () => {
    const result = observeOutcomes(
      EMPTY_OUTCOME_TRACKER,
      [thread("t1", "r9", "completed")],
      topicLabelsFor,
      1,
    );
    expect(result.events).toEqual([]);
  });

  it("labels a task with no known topic as other, and keeps no text", () => {
    const result = observeOutcomes(
      EMPTY_OUTCOME_TRACKER,
      [thread("t2", "r1", "failed", "Ion Popescu 0722 123 456")],
      topicLabelsFor,
      1,
    );
    expect(result.events[0]?.labels).toEqual(["other"]);
    expect(JSON.stringify(result.tracker)).not.toContain("Popescu");
  });

  it("adds outcomes to the signals and survives a reload", () => {
    const signals = addOutcomes(emptySignals("2026-11-07T00:00:00Z"), [
      { kind: "failed", threadId: "a", labels: ["reports"] },
      { kind: "corrected", threadId: "b", labels: ["reports", "email"] },
    ]);
    expect(signals.failedTasks).toEqual({ reports: 1 });
    expect(signals.correctedTasks).toEqual({ reports: 1, email: 1 });
    const tracker = observeOutcomes(
      EMPTY_OUTCOME_TRACKER,
      [thread("t1", "r1", "failed")],
      topicLabelsFor,
      1,
    ).tracker;
    expect(parseOutcomeTracker(JSON.stringify(tracker))).toEqual(tracker);
    expect(parseOutcomeTracker("not json")).toEqual(EMPTY_OUTCOME_TRACKER);
  });
});

describe("progress sync seam", () => {
  it("merges the account's progress: done anywhere stays done, the earlier date wins", () => {
    const local: AcademyProgress = setLessonDone(EMPTY_PROGRESS, "a", true, "2026-11-05T00:00:00Z");
    const remote: AcademyProgress = {
      a: { doneAt: "2026-11-01T00:00:00Z" },
      b: { doneAt: "2026-11-02T00:00:00Z" },
    };
    expect(mergeProgress(local, remote)).toEqual(remote);
    expect(mergeProgress(remote, local)).toBe(remote);
    expect(mergeProgress(local, {})).toBe(local);
  });
});

/** The sync runs on promise callbacks only; a few microtask turns let them finish. */
async function settleMicrotasks() {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

describe("progress sync registration", () => {
  it("pulls the account's progress in and pushes local changes", async () => {
    const pushed: AcademyProgressEvent[] = [];
    const unregister = registerAcademyProgressSync({
      id: "hub",
      pull: async () => ({ "first-steps": { doneAt: "2026-11-01T00:00:00Z" } }),
      push: (event) => {
        pushed.push(event);
      },
    });
    await settleMicrotasks();
    expect(isLessonDone(getAcademyProgress(), "first-steps")).toBe(true);
    markLesson("data-safety", true);
    await settleMicrotasks();
    expect(pushed.map((event) => [event.lessonId, event.done])).toEqual([["data-safety", true]]);
    unregister();
    markLesson("data-safety", false);
    await settleMicrotasks();
    expect(pushed).toHaveLength(1);
  });
});
