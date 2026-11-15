// Zen Staff: Office chat timeline. Each run of tool work becomes one summary entry before upstream
// builds rows ("Worked on 3 files", OfficeTimelineRows.tsx); provider hook messages are dropped.
// Pure, so tests cover it without React. ZEN.md, "What Office hides".
import type { TimelineEntry, WorkLogEntry } from "../../session-logic";

/** Id prefix of the summary entries, so the row renderer can recognise them. */
export const OFFICE_WORK_SUMMARY_PREFIX = "zen-office-work:";

/** Hook output from the provider's own config (Claude Code: "Stop says: ...", "SessionStart:compact says: ..."). */
const HOOK_MESSAGE = /^[A-Za-z]+(?::[A-Za-z_-]+)? says:/;

export function isProviderHookMessage(entry: WorkLogEntry): boolean {
  if (entry.command !== undefined) return false;
  return (
    HOOK_MESSAGE.test(entry.label.trim()) ||
    HOOK_MESSAGE.test((entry.detail ?? "").trim()) ||
    HOOK_MESSAGE.test((entry.toolTitle ?? "").trim())
  );
}

/** Work an Office person should not see row by row. Errors, questions and approvals stay. */
function isOfficeFoldedWork(entry: WorkLogEntry): boolean {
  if (entry.tone === "error" || entry.itemType === "error") return false;
  if (entry.questionAnswer !== undefined) return false;
  if (
    entry.itemType === "approval_request" ||
    entry.itemType === "user_input_request" ||
    entry.itemType === "todo_list" ||
    entry.itemType === "system_notice" ||
    entry.itemType === "notification" ||
    entry.itemType === "compaction" ||
    entry.sourceActivityKind === "context-compaction" ||
    entry.sourceActivityKind === "runtime.error"
  ) {
    return false;
  }
  // Reasoning folds in too; while it runs the summary reads "Working…".
  if (entry.itemType === "reasoning" || entry.tone === "thinking") return true;
  return (
    entry.itemType === "command_execution" ||
    entry.itemType === "file_change" ||
    entry.itemType === "file_search" ||
    entry.itemType === "web_search" ||
    entry.itemType === "dynamic_tool" ||
    entry.tone === "tool" ||
    entry.command !== undefined ||
    entry.requestKind !== undefined ||
    (entry.changedFiles?.length ?? 0) > 0
  );
}

export interface OfficeWorkSummaryData {
  readonly zenOfficeWork: ReadonlyArray<WorkLogEntry>;
}

export function officeWorkEntries(entry: WorkLogEntry): ReadonlyArray<WorkLogEntry> | null {
  if (!entry.id.startsWith(OFFICE_WORK_SUMMARY_PREFIX)) return null;
  const data = entry.toolData as Partial<OfficeWorkSummaryData> | undefined;
  return data?.zenOfficeWork ?? [];
}

type WorkTimelineEntry = Extract<TimelineEntry, { kind: "work" }>;

function summaryEntry(first: WorkTimelineEntry, work: ReadonlyArray<WorkLogEntry>): TimelineEntry {
  const id = `${OFFICE_WORK_SUMMARY_PREFIX}${first.id}`;
  const active = work.some((entry) => entry.toolLifecycleStatus === "inProgress");
  const entry: WorkLogEntry = {
    id,
    createdAt: first.entry.createdAt,
    runId: first.entry.runId ?? null,
    label: "Work summary",
    tone: "info",
    // A notice is never grouped with neighbours, so upstream gives it a row of its own.
    itemType: "system_notice",
    toolLifecycleStatus: active ? "inProgress" : "completed",
    toolData: { zenOfficeWork: work } satisfies OfficeWorkSummaryData,
  };
  return { ...first, id, entry };
}

/**
 * Office timeline entries: each run of folded work (same run and attempt, nothing else between)
 * becomes one summary entry at the position of its first entry; hook messages are dropped.
 * Returns the same array when nothing changes.
 */
export function officeTimelineEntries(
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyArray<TimelineEntry> {
  const result: TimelineEntry[] = [];
  let changed = false;
  let bucket: WorkTimelineEntry[] = [];
  // Finished runs of plain steps ("Worked through 1 step") say nothing on their own: they join
  // the run's previous summary, or wait for its next one, and are dropped when the run has none.
  const summaries = new Map<
    string,
    { readonly index: number; readonly first: WorkTimelineEntry; work: WorkLogEntry[] }
  >();
  const waitingByRun = new Map<string, WorkLogEntry[]>();
  const flush = () => {
    if (bucket.length === 0) return;
    const first = bucket[0]!;
    const run = `${first.entry.runId ?? ""}\0${first.attempt?.id ?? ""}`;
    const work = bucket.map((item) => item.entry);
    bucket = [];
    if (isQuietWork(work)) {
      const previous = summaries.get(run);
      if (previous) {
        previous.work = [...previous.work, ...work];
        result[previous.index] = summaryEntry(previous.first, previous.work);
      } else {
        waitingByRun.set(run, [...(waitingByRun.get(run) ?? []), ...work]);
      }
      return;
    }
    const all = [...(waitingByRun.get(run) ?? []), ...work];
    waitingByRun.delete(run);
    summaries.set(run, { index: result.length, first, work: all });
    result.push(summaryEntry(first, all));
  };
  for (const timelineEntry of entries) {
    if (timelineEntry.kind === "work") {
      if (isProviderHookMessage(timelineEntry.entry)) {
        changed = true;
        continue;
      }
      if (isOfficeFoldedWork(timelineEntry.entry)) {
        const head = bucket[0];
        if (
          head &&
          ((head.entry.runId ?? null) !== (timelineEntry.entry.runId ?? null) ||
            head.attempt?.id !== timelineEntry.attempt?.id)
        ) {
          flush();
        }
        bucket.push(timelineEntry);
        changed = true;
        continue;
      }
    }
    flush();
    result.push(timelineEntry);
  }
  flush();
  return changed ? result : entries;
}

/** Finished work that is only plain steps: no files, no searches, nothing failed. */
function isQuietWork(work: ReadonlyArray<WorkLogEntry>): boolean {
  const digest = digestOfficeWork(work);
  return (
    !digest.active &&
    digest.failed === 0 &&
    digest.changedFiles.length === 0 &&
    digest.readFiles.length === 0 &&
    digest.webSearches === 0
  );
}

// The summary line and its list.

export interface OfficeWorkDigest {
  /** Files changed or created, by name, in first-touched order. */
  readonly changedFiles: ReadonlyArray<string>;
  /** Files only read. */
  readonly readFiles: ReadonlyArray<string>;
  readonly webSearches: number;
  /** Everything else (commands, other tools). */
  readonly otherSteps: number;
  readonly active: boolean;
  readonly failed: number;
  /** The path behind each file name above, as the tool reported it (absolute or relative). */
  readonly filePaths: Readonly<Record<string, string>>;
}

/**
 * The path the Files panel opens: workspace-relative inside the folder as spelled, otherwise the
 * absolute path as a host file. Agents report symlink-resolved paths, so a symlinked home never
 * matched the folder's spelling. Null for an empty path or the folder itself.
 */
export function officeWorkspaceRelativePath(
  path: string,
  workspaceRoot: string | undefined,
): string | null {
  const normalized = path.trim().replaceAll("\\", "/");
  if (normalized.length === 0) return null;
  const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  if (!isAbsolute) return normalized.replace(/^\.\//, "");
  const hostPath = path.trim();
  if (!workspaceRoot) return hostPath;
  const root = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  const caseInsensitive = /^[A-Za-z]:\//.test(root);
  const head = caseInsensitive
    ? normalized.slice(0, root.length).toLowerCase()
    : normalized.slice(0, root.length);
  const rootKey = caseInsensitive ? root.toLowerCase() : root;
  if (head !== rootKey || normalized[root.length] !== "/") return hostPath;
  const relative = normalized.slice(root.length + 1);
  return relative.length > 0 ? relative : null;
}

function fileName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).at(-1);
  return name && name.length > 0 ? name : trimmed;
}

function readPath(entry: WorkLogEntry): string | null {
  if (entry.viewedImagePath) return entry.viewedImagePath;
  if (entry.requestKind !== "file-read") return null;
  const detail = entry.detail?.trim();
  return detail && /[\\/.]/.test(detail) && !detail.includes("\n") ? detail : null;
}

export function digestOfficeWork(work: ReadonlyArray<WorkLogEntry>): OfficeWorkDigest {
  const changed: string[] = [];
  const read: string[] = [];
  const filePaths: Record<string, string> = {};
  let webSearches = 0;
  let otherSteps = 0;
  let failed = 0;
  let active = false;
  for (const entry of work) {
    if (entry.toolLifecycleStatus === "inProgress") active = true;
    if (entry.itemType === "reasoning" || entry.tone === "thinking") continue;
    if (entry.toolLifecycleStatus === "failed") failed += 1;
    const files = entry.changedFiles ?? [];
    if (files.length > 0) {
      for (const file of files) {
        const name = fileName(file);
        if (!changed.includes(name)) changed.push(name);
        filePaths[name] ??= file;
      }
      continue;
    }
    if (entry.itemType === "web_search") {
      webSearches += 1;
      continue;
    }
    const path = readPath(entry);
    if (path !== null) {
      const name = fileName(path);
      if (!read.includes(name) && !changed.includes(name)) read.push(name);
      filePaths[name] ??= path;
      continue;
    }
    otherSteps += 1;
  }
  return {
    changedFiles: changed,
    readFiles: read.filter((name) => !changed.includes(name)),
    webSearches,
    otherSteps,
    active,
    failed,
    filePaths,
  };
}
