// Zen Staff Academy: "this task went badly" signals from thread outcomes, labels only.
// Failed = a run ended "failed"; heavily corrected = more than 3 follow-ups after the first
// message (more than 4 runs). Pure; signals.ts feeds it the thread shells it sees.

/** The part of a thread shell the tracker reads. */
export interface OutcomeThread {
  readonly id: string;
  readonly title: string;
  readonly latestRun: { readonly runId: string; readonly status: string } | null;
}

interface TrackedThread {
  readonly lastRunId: string;
  /** Distinct runs seen for this thread (the first observation counts as 1). */
  readonly runs: number;
  readonly failedRuns: ReadonlyArray<string>;
  readonly corrected: boolean;
  readonly seenAt: number;
}

export interface OutcomeTracker {
  readonly threads: Readonly<Record<string, TrackedThread>>;
}

export const EMPTY_OUTCOME_TRACKER: OutcomeTracker = { threads: {} };

/** More than this many follow-up messages in one task = "heavily corrected". */
const HEAVY_CORRECTION_FOLLOW_UPS = 3;
const MAX_TRACKED_THREADS = 300;

export interface OutcomeEvent {
  readonly kind: "failed" | "corrected";
  readonly threadId: string;
  /** Topic labels of the thread title ("other" when none matched). */
  readonly labels: ReadonlyArray<string>;
}

/**
 * Compares the shells with what was seen before and returns the new events. A failed run counts
 * once; a thread is "corrected" once. Threads seen for the first time start at their current run,
 * so opening the app does not count old history as new corrections.
 */
export function observeOutcomes(
  tracker: OutcomeTracker,
  threads: ReadonlyArray<OutcomeThread>,
  labelsFor: (title: string) => ReadonlyArray<string>,
  now: number,
): { readonly tracker: OutcomeTracker; readonly events: ReadonlyArray<OutcomeEvent> } {
  const next: Record<string, TrackedThread> = { ...tracker.threads };
  const events: OutcomeEvent[] = [];
  let changed = false;
  const labels = (title: string) => {
    const found = labelsFor(title);
    return found.length > 0 ? found : ["other"];
  };
  for (const thread of threads) {
    const run = thread.latestRun;
    if (!run) continue;
    const before = next[thread.id];
    let entry: TrackedThread =
      before === undefined
        ? { lastRunId: run.runId, runs: 1, failedRuns: [], corrected: false, seenAt: now }
        : before.lastRunId === run.runId
          ? before
          : { ...before, lastRunId: run.runId, runs: before.runs + 1, seenAt: now };
    if (run.status === "failed" && !entry.failedRuns.includes(run.runId)) {
      entry = { ...entry, failedRuns: [...entry.failedRuns, run.runId].slice(-5) };
      events.push({ kind: "failed", threadId: thread.id, labels: labels(thread.title) });
    }
    if (!entry.corrected && entry.runs - 1 > HEAVY_CORRECTION_FOLLOW_UPS) {
      entry = { ...entry, corrected: true };
      events.push({ kind: "corrected", threadId: thread.id, labels: labels(thread.title) });
    }
    if (entry !== before) {
      next[thread.id] = entry;
      changed = true;
    }
  }
  if (!changed) return { tracker, events };
  const ids = Object.keys(next);
  if (ids.length > MAX_TRACKED_THREADS) {
    ids
      .toSorted((a, b) => next[a]!.seenAt - next[b]!.seenAt)
      .slice(0, ids.length - MAX_TRACKED_THREADS)
      .forEach((id) => delete next[id]);
  }
  return { tracker: { threads: next }, events };
}

export function parseOutcomeTracker(raw: string | null): OutcomeTracker {
  if (!raw) return EMPTY_OUTCOME_TRACKER;
  try {
    const value = JSON.parse(raw) as { threads?: unknown };
    if (typeof value.threads !== "object" || value.threads === null) return EMPTY_OUTCOME_TRACKER;
    const threads: Record<string, TrackedThread> = {};
    for (const [id, item] of Object.entries(value.threads as Record<string, unknown>)) {
      const t = item as Partial<TrackedThread>;
      if (typeof t.lastRunId !== "string" || typeof t.runs !== "number") continue;
      threads[id] = {
        lastRunId: t.lastRunId,
        runs: t.runs,
        failedRuns: Array.isArray(t.failedRuns)
          ? t.failedRuns.filter((v): v is string => typeof v === "string")
          : [],
        corrected: t.corrected === true,
        seenAt: typeof t.seenAt === "number" ? t.seenAt : 0,
      };
    }
    return { threads };
  } catch {
    return EMPTY_OUTCOME_TRACKER;
  }
}
