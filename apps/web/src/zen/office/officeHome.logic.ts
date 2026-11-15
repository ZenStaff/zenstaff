// Zen Staff Birou (Office home): the pure parts of the redesigned page. The greeting for the hour,
// the "Continuă" row (threads that wait for the person, are working, or were touched last), the
// first name for the greeting and a thread title from a free question. Tested in
// officeHome.logic.test.ts.

export type DayPart = "morning" | "day" | "evening";

/** 05:00-11:59 morning, 12:00-17:59 day, otherwise evening. */
export function dayPart(date: Date): DayPart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "day";
  return "evening";
}

/** The first word of a person's name, for "Bună ziua, Andrei." Emails and empty names give null. */
export function firstName(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed.includes("@")) return null;
  const first = trimmed.split(/\s+/)[0]!;
  return first.length > 24 ? null : first;
}

export type ContinueState = "needs-you" | "working" | "recent";

export interface ContinueThread {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly settled: boolean;
  readonly needsYou: boolean;
  readonly working: boolean;
}

export interface ContinueItem {
  readonly thread: ContinueThread;
  readonly state: ContinueState;
}

const STATE_ORDER: Record<ContinueState, number> = { "needs-you": 0, working: 1, recent: 2 };

/**
 * The "Continuă" row: open threads in the given folders, the ones waiting for the person first,
 * then the ones working, then the most recently touched; at most `limit`.
 */
export function continueItems(
  threads: ReadonlyArray<ContinueThread>,
  allowedProject: (environmentId: string, projectId: string) => boolean,
  limit = 4,
): ContinueItem[] {
  return threads
    .filter((thread) => thread.archivedAt === null && !thread.settled)
    .filter((thread) => allowedProject(thread.environmentId, thread.projectId))
    .map((thread): ContinueItem => ({
      thread,
      state: thread.needsYou ? "needs-you" : thread.working ? "working" : "recent",
    }))
    .toSorted(
      (left, right) =>
        STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
        right.thread.updatedAt.localeCompare(left.thread.updatedAt),
    )
    .slice(0, limit);
}

/** A thread title from a free question: the first line, at most 60 characters, cut at a word. */
export function askTitle(text: string): string {
  const line =
    text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
