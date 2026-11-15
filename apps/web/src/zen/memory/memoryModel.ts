// Zen Staff company memory, web side: pure rules for the Memorie tab (promise groups, overdue
// highlight, dates, sources that can be opened here, quota bars). Tested in memoryModel.test.ts.
import type {
  ZenMemoryFact,
  ZenMemoryQuota,
  ZenMemorySettings,
  ZenMemorySource,
} from "@t3tools/contracts/zenMemory";

export type PromiseGroup = "open" | "overdue" | "done";
export const PROMISE_GROUPS: ReadonlyArray<PromiseGroup> = ["open", "overdue", "done"];

/** The section a promise belongs in; cancelled and superseded ones go with "done". */
export function promiseGroup(promise: ZenMemoryFact, today: string): PromiseGroup {
  const status = (promise.status ?? "open").toLowerCase();
  if (status === "done" || status === "cancelled" || status === "superseded") return "done";
  if (status === "overdue") return "overdue";
  if (promise.dueDate !== null && promise.dueDate.slice(0, 10) < today) return "overdue";
  return "open";
}

/** Promises by section: overdue first by oldest due date, open by nearest due date, done newest. */
export function groupPromises(
  promises: ReadonlyArray<ZenMemoryFact>,
  today: string,
): Readonly<Record<PromiseGroup, ReadonlyArray<ZenMemoryFact>>> {
  const groups: Record<PromiseGroup, ZenMemoryFact[]> = { open: [], overdue: [], done: [] };
  for (const promise of promises) groups[promiseGroup(promise, today)].push(promise);
  const byDue = (left: ZenMemoryFact, right: ZenMemoryFact) =>
    (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999");
  return {
    overdue: groups.overdue.toSorted(byDue),
    open: groups.open.toSorted(byDue),
    done: groups.done,
  };
}

export function isOverdue(promise: ZenMemoryFact, today: string): boolean {
  return promiseGroup(promise, today) === "overdue";
}

/** YYYY-MM-DD in local time. */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "14 nov. 2026" / "Nov 14, 2026" for a date or ISO time; the raw text when it does not parse. */
export function formatMemoryDate(value: string | null, locale: "en" | "ro"): string | null {
  if (value === null) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale === "ro" ? "ro-RO" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "14 nov., 18:30" / "Nov 14, 6:30 PM" for an ISO time (a retry time, a reset time). */
export function formatMemoryDateTime(value: string, locale: "en" | "ro"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "ro" ? "ro-RO" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface SourceLink {
  readonly source: ZenMemorySource;
  /** The local thread to open, when this machine has it. */
  readonly local: { readonly environmentId: string; readonly threadId: string } | null;
}

/** Each source with the local thread it came from, when that thread exists on this machine. */
export function sourceLinks(
  fact: ZenMemoryFact,
  localThreads: ReadonlyMap<string, string>,
): ReadonlyArray<SourceLink> {
  return fact.sources.map((source) => {
    const environmentId = source.threadId === null ? undefined : localThreads.get(source.threadId);
    return {
      source,
      local:
        environmentId === undefined || source.threadId === null
          ? null
          : { environmentId, threadId: source.threadId },
    };
  });
}

/** Share of a quota used, 0-100 (0 when unlimited). */
export function quotaPercent(quota: ZenMemoryQuota): number {
  if (quota.limit <= 0) return 0;
  return Math.min(100, Math.round((quota.used / quota.limit) * 100));
}

export type ConnectionState = "personal" | "not-set" | "connected" | "saving-off";

export function connectionState(settings: ZenMemorySettings | null): ConnectionState {
  if (settings === null || !settings.available) return "personal";
  if (!settings.connected) return "not-set";
  return settings.saveConversations ? "connected" : "saving-off";
}

/** The entity a fact is mostly about (its counterparty first), for "Forget this". */
export function forgettableEntity(
  fact: ZenMemoryFact,
): { readonly id: string; readonly name: string } | null {
  return fact.object ?? fact.subject ?? null;
}
