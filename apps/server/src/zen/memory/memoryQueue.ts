// Zen Staff company memory: the send queue's rules (pure). A summary is queued, then sent; a 429
// holds the whole company until Retry-After; network errors and 5xx back off; a rejection that
// will not change (bad key, invalid body, too long) drops the item with a visible status.
import type { EpisodeBody, MemoryCallResult } from "./memoryClient.ts";

export interface QueuedEpisode {
  readonly id: string;
  readonly companyId: string;
  readonly threadId: string;
  /** The last message the summary covers; becomes the thread's save point once sent. */
  readonly lastMessageId: string;
  readonly body: EpisodeBody;
  readonly attempts: number;
  readonly enqueuedAt: number;
  /** Epoch ms before which the item is not sent. */
  readonly notBefore: number;
  /** Kinds of secret removed before sending, shown with the save status. */
  readonly redacted?: ReadonlyArray<string>;
  /** v4: a company chat sent with the starter's personal key, so personal parts go to their memory. */
  readonly withPersonal?: boolean;
  /** Held by a quota (429): kept until the quota resets (a month at most), not MAX_AGE_MS. */
  readonly quotaHeld?: boolean;
}

/** Backoff after a network error or a 5xx, by attempt (the last value repeats). */
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000] as const;
/** Network/server failures before an item is dropped (about a day with the backoff above). */
export const MAX_ATTEMPTS = 30;
/** A 429 without a usable hint waits this long. */
const DEFAULT_QUOTA_WAIT_MS = 15 * 60_000;
/** Items older than this are dropped (the conversation is long gone). */
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** An item waiting for a quota reset is kept this long (the monthly token quota resets on the 1st). */
const MAX_QUOTA_AGE_MS = 40 * 24 * 60 * 60_000;

const maxAgeOf = (item: QueuedEpisode) => (item.quotaHeld === true ? MAX_QUOTA_AGE_MS : MAX_AGE_MS);

export type SendDecision =
  | { readonly action: "done"; readonly status: string; readonly detail: string | null }
  | {
      readonly action: "retry";
      readonly item: QueuedEpisode;
      readonly detail: string;
      /** 429: the company's other items wait too. */
      readonly holdCompanyUntil: number | null;
    }
  | { readonly action: "drop"; readonly status: "failed"; readonly detail: string };

export function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1)]!;
}

/** What to do with an item after one send attempt. */
export function afterSend(
  item: QueuedEpisode,
  outcome: MemoryCallResult<unknown>,
  now: number,
): SendDecision {
  if (outcome.ok) {
    const body = outcome.value as { status?: unknown; reason?: unknown } | null;
    const status = typeof body?.status === "string" ? body.status : "accepted";
    const reason = typeof body?.reason === "string" ? body.reason : null;
    return { action: "done", status, detail: reason };
  }
  if (outcome.kind === "quota") {
    const until = now + Math.max(outcome.retryAfterMs ?? DEFAULT_QUOTA_WAIT_MS, 1_000);
    // A quota wait is not a failed attempt: the summary is kept until the quota resets.
    return {
      action: "retry",
      item: { ...item, notBefore: until, quotaHeld: true },
      detail: outcome.detail,
      holdCompanyUntil: until,
    };
  }
  if (outcome.kind === "network" || outcome.kind === "server") {
    const attempts = item.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      return { action: "drop", status: "failed", detail: outcome.detail };
    }
    return {
      action: "retry",
      item: { ...item, attempts, notBefore: now + backoffMs(attempts) },
      detail: outcome.detail,
      holdCompanyUntil: null,
    };
  }
  // unauthorized, too-large, invalid, not-found: sending again gives the same answer.
  return { action: "drop", status: "failed", detail: outcome.detail };
}

/** Items to send now, oldest first, skipping companies on hold and expired items. */
export function dueItems(
  queue: ReadonlyArray<QueuedEpisode>,
  now: number,
  holds: Readonly<Record<string, number>>,
): ReadonlyArray<QueuedEpisode> {
  return queue
    .filter((item) => item.notBefore <= now && (holds[item.companyId] ?? 0) <= now)
    .filter((item) => now - item.enqueuedAt <= maxAgeOf(item))
    .toSorted((left, right) => left.enqueuedAt - right.enqueuedAt);
}

export function expiredItems(
  queue: ReadonlyArray<QueuedEpisode>,
  now: number,
): ReadonlyArray<QueuedEpisode> {
  return queue.filter((item) => now - item.enqueuedAt > maxAgeOf(item));
}

/** Adds an item, replacing a queued one for the same thread (the newer summary covers more). */
export function enqueue(
  queue: ReadonlyArray<QueuedEpisode>,
  item: QueuedEpisode,
): ReadonlyArray<QueuedEpisode> {
  return [...queue.filter((queued) => queued.threadId !== item.threadId), item];
}

/** The earliest time anything in the queue can be sent, or null when it is empty. */
export function nextWakeAt(
  queue: ReadonlyArray<QueuedEpisode>,
  holds: Readonly<Record<string, number>>,
): number | null {
  let earliest: number | null = null;
  for (const item of queue) {
    const at = Math.max(item.notBefore, holds[item.companyId] ?? 0);
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}
