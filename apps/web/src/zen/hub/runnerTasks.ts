// Zen Staff: the tasks I gave the company's AI staff that run on the company server, kept on this
// device so "Urmărește live" stays reachable after the task dialog closes (review 0.2.3, P1-19).
// Only ids and a title: the content stays sealed on the server. Pure rules + localStorage.
import { useSyncExternalStore } from "react";

export interface RunnerTask {
  /** Local company id (the staff context's). */
  readonly companyId: string;
  readonly staffId: string;
  readonly runId: string;
  readonly agentName: string;
  readonly title: string;
  readonly startedAt: string;
}

const KEY = "zen:runner-tasks";
const MAX = 20;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const isTask = (value: unknown): value is RunnerTask => {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Record<string, unknown>;
  return ["companyId", "staffId", "runId", "agentName", "title", "startedAt"].every(
    (key) => typeof task[key] === "string",
  );
};

/** Newest first, at most 20, nothing older than a week, one entry per run. */
export function rememberRunnerTask(
  list: ReadonlyArray<RunnerTask>,
  task: RunnerTask,
  now: number,
): RunnerTask[] {
  return [task, ...list.filter((item) => item.runId !== task.runId)]
    .filter((item) => now - Date.parse(item.startedAt) < KEEP_MS)
    .slice(0, MAX);
}

export function parseRunnerTasks(raw: string | null): RunnerTask[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTask).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

let cache: { readonly raw: string | null; readonly tasks: RunnerTask[] } | null = null;
const listeners = new Set<() => void>();

function read(): RunnerTask[] {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    raw = null;
  }
  if (cache === null || cache.raw !== raw) cache = { raw, tasks: parseRunnerTasks(raw) };
  return cache.tasks;
}

export function addRunnerTask(task: RunnerTask): void {
  const next = rememberRunnerTask(read(), task, Date.now());
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private window: the list lives until the page closes.
    cache = { raw: JSON.stringify(next), tasks: next };
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: ReadonlyArray<RunnerTask> = [];

/** My tasks on the company server for that local company, newest first. */
export function useRunnerTasks(companyId: string | null): ReadonlyArray<RunnerTask> {
  const all = useSyncExternalStore(subscribe, read, () => EMPTY as RunnerTask[]);
  return companyId === null ? EMPTY : all.filter((task) => task.companyId === companyId);
}
