// Zen Staff sidebar "My workflows" (Fluxurile mele): which workflows the section lists and in what
// order, how pins and the run log change, which workflows repeat on a schedule, and the command
// palette's workflow groups. Pure; tested in myWorkflowsModel.test.ts. ZEN.md, "Sidebar navigation".
import { parseZenScheduledWorkflowMarker } from "@t3tools/contracts/zenToolchains";

/** Rows the section shows before "All" (the rest are on the Office home). */
export const MY_WORKFLOWS_LIMIT = 5;
/** Workflows the run log remembers (the least recently used fall off). */
export const MY_WORKFLOWS_RUN_LOG_LIMIT = 50;
/** Pins kept at most. */
const MY_WORKFLOWS_PIN_LIMIT = 30;

export interface MyWorkflowSource {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** Installed for the whole company or owned by it. */
  readonly company: boolean;
}

export interface MyWorkflowRun {
  readonly count: number;
  /** ISO time of the latest start. */
  readonly lastAt: string;
}

export type MyWorkflowRuns = Readonly<Record<string, MyWorkflowRun>>;

export interface MyWorkflowRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly pinned: boolean;
  readonly company: boolean;
  readonly scheduled: boolean;
  /** Starts recorded on this device (0 for a pin never run). */
  readonly runs: number;
}

export interface MyWorkflowsList {
  readonly rows: ReadonlyArray<MyWorkflowRow>;
  /** Pinned or used workflows that did not fit under the limit. */
  readonly hidden: number;
}

/** Used workflows, most starts first, the latest start breaking ties, then the id. */
function byUse(runs: MyWorkflowRuns) {
  return (left: string, right: string) => {
    const a = runs[left]!;
    const b = runs[right]!;
    if (a.count !== b.count) return b.count - a.count;
    if (a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
    return left < right ? -1 : left > right ? 1 : 0;
  };
}

/**
 * Pinned workflows in pin order, then the most used ones, each once, at most `limit`. Pins and runs
 * of workflows that are not on this machine (or not in the chosen company) are left out.
 */
export function buildMyWorkflows(input: {
  readonly workflows: ReadonlyArray<MyWorkflowSource>;
  readonly pins: ReadonlyArray<string>;
  readonly runs: MyWorkflowRuns;
  readonly scheduled: ReadonlySet<string>;
  readonly limit?: number;
}): MyWorkflowsList {
  const limit = input.limit ?? MY_WORKFLOWS_LIMIT;
  const known = new Map<string, MyWorkflowSource>();
  for (const workflow of input.workflows) {
    if (!known.has(workflow.id)) known.set(workflow.id, workflow);
  }
  const pinned = [...new Set(input.pins)].filter((id) => known.has(id));
  const pinnedSet = new Set(pinned);
  const used = Object.keys(input.runs)
    .filter((id) => known.has(id) && !pinnedSet.has(id) && (input.runs[id]?.count ?? 0) > 0)
    .toSorted(byUse(input.runs));
  const ids = [...pinned, ...used];
  const rows = ids.slice(0, Math.max(0, limit)).map((id): MyWorkflowRow => {
    const workflow = known.get(id)!;
    return {
      id,
      name: workflow.name,
      icon: workflow.icon,
      pinned: pinnedSet.has(id),
      company: workflow.company,
      scheduled: input.scheduled.has(id),
      runs: input.runs[id]?.count ?? 0,
    };
  });
  return { rows, hidden: ids.length - rows.length };
}

/** Pins with `id` added at the end, or removed when it was pinned. */
export function togglePin(pins: ReadonlyArray<string>, id: string): ReadonlyArray<string> {
  if (pins.includes(id)) return pins.filter((pin) => pin !== id);
  return [...pins, id].slice(-MY_WORKFLOWS_PIN_LIMIT);
}

/** Pins with every id in `ids` pinned (when `pinned`) or unpinned; a pack pins all of its own. */
export function setPins(
  pins: ReadonlyArray<string>,
  ids: ReadonlyArray<string>,
  pinned: boolean,
): ReadonlyArray<string> {
  if (!pinned) return pins.filter((pin) => !ids.includes(pin));
  const added = ids.filter((id) => !pins.includes(id));
  return [...pins, ...added].slice(-MY_WORKFLOWS_PIN_LIMIT);
}

/** The run log after `id` started at `at`; keeps the most recently used entries only. */
export function recordRun(runs: MyWorkflowRuns, id: string, at: string): MyWorkflowRuns {
  const next: Record<string, MyWorkflowRun> = {
    ...runs,
    [id]: { count: (runs[id]?.count ?? 0) + 1, lastAt: at },
  };
  const ids = Object.keys(next);
  if (ids.length <= MY_WORKFLOWS_RUN_LOG_LIMIT) return next;
  const keep = ids
    .toSorted((left, right) => (next[left]!.lastAt < next[right]!.lastAt ? 1 : -1))
    .slice(0, MY_WORKFLOWS_RUN_LOG_LIMIT);
  return Object.fromEntries(keep.map((key) => [key, next[key]!]));
}

/** Workflow ids that an enabled scheduled task repeats (its prompt has the workflow marker). */
export function scheduledWorkflowIds(
  tasks: ReadonlyArray<{ readonly prompt: string; readonly enabled: boolean }>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.enabled) continue;
    const id = parseZenScheduledWorkflowMarker(task.prompt);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** Stored pins, ignoring anything that is not a list of ids. */
export function parsePins(raw: string | null | undefined): ReadonlyArray<string> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id !== ""))];
  } catch {
    return [];
  }
}

/** Stored run log, keeping only well-formed entries. */
export function parseRuns(raw: string | null | undefined): MyWorkflowRuns {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const runs: Record<string, MyWorkflowRun> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const { count, lastAt } = value as { count?: unknown; lastAt?: unknown };
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      if (typeof lastAt !== "string") continue;
      runs[id] = { count: Math.floor(count), lastAt };
    }
    return runs;
  } catch {
    return {};
  }
}

export interface PaletteWorkflowGroups {
  /** Pinned, then used (the sidebar's order, no limit). */
  readonly mine: ReadonlyArray<MyWorkflowSource>;
  /** Every other workflow, by name. */
  readonly rest: ReadonlyArray<MyWorkflowSource>;
}

/** The command palette's "Start a workflow" list: the person's own first, then the rest by name. */
export function paletteWorkflowGroups(input: {
  readonly workflows: ReadonlyArray<MyWorkflowSource>;
  readonly pins: ReadonlyArray<string>;
  readonly runs: MyWorkflowRuns;
  readonly locale?: string;
}): PaletteWorkflowGroups {
  const { rows } = buildMyWorkflows({
    workflows: input.workflows,
    pins: input.pins,
    runs: input.runs,
    scheduled: new Set(),
    limit: Number.POSITIVE_INFINITY,
  });
  const mineIds = new Set(rows.map((row) => row.id));
  const byId = new Map(input.workflows.map((workflow) => [workflow.id, workflow]));
  const seen = new Set<string>();
  const rest = input.workflows
    .filter((workflow) => {
      if (mineIds.has(workflow.id) || seen.has(workflow.id)) return false;
      seen.add(workflow.id);
      return true;
    })
    .toSorted((left, right) => left.name.localeCompare(right.name, input.locale));
  return { mine: rows.map((row) => byId.get(row.id)!), rest };
}
