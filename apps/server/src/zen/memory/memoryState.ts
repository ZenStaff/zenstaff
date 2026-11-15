// @effect-diagnostics nodeBuiltinImport:off processEnvInEffect:off - plain sync file code, wrapped by ZenMemory.ts.
// Zen Staff company memory: what is kept on this machine, in `<state dir>/zen/memory.json`
// (mode 600). Per company: the server URL and the "save conversations" switch (the API key is in
// the vault, never here). Per thread: "don't save this chat" and the last saved message. And the
// queue of summaries waiting to be sent.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ZenMemoryLastSave } from "@t3tools/contracts/zenMemory";

import type { QueuedEpisode } from "./memoryQueue.ts";

export interface CompanyMemoryConfig {
  readonly url: string | null;
  readonly saveConversations: boolean;
  /** When the company was first connected; older conversations are never back-filled. */
  readonly connectedAt?: string | undefined;
  readonly lastSave: ZenMemoryLastSave | null;
}

export interface ThreadMemoryState {
  readonly skip: boolean;
  /** The last message covered by a summary the server received. */
  readonly lastMessageId: string | null;
  readonly lastSave: ZenMemoryLastSave | null;
  /** When the thread's last summary was queued (ISO); the next one waits ZEN_MEMORY_MIN_INTERVAL_MINUTES. */
  readonly lastEpisodeAt?: string | undefined;
}

export interface MemoryState {
  readonly version: 1;
  readonly companies: Readonly<Record<string, CompanyMemoryConfig>>;
  readonly threads: Readonly<Record<string, ThreadMemoryState>>;
  readonly queue: ReadonlyArray<QueuedEpisode>;
  /** companyId -> epoch ms: a 429 holds the company's queue until then. */
  readonly holds: Readonly<Record<string, number>>;
}

const emptyMemoryState = (): MemoryState => ({
  version: 1,
  companies: {},
  threads: {},
  queue: [],
  holds: {},
});

export const DEFAULT_COMPANY_CONFIG: CompanyMemoryConfig = {
  url: null,
  saveConversations: true,
  lastSave: null,
};

export const DEFAULT_THREAD_STATE: ThreadMemoryState = {
  skip: false,
  lastMessageId: null,
  lastSave: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lastSaveOf(raw: unknown): ZenMemoryLastSave | null {
  if (!isRecord(raw) || typeof raw.at !== "string" || typeof raw.status !== "string") return null;
  return {
    at: raw.at,
    status: raw.status,
    detail: typeof raw.detail === "string" ? raw.detail : null,
  };
}

/** Reads whatever is on disk into a valid state; unknown or broken parts are dropped. */
export function normalizeMemoryState(raw: unknown): MemoryState {
  if (!isRecord(raw)) return emptyMemoryState();
  const companies: Record<string, CompanyMemoryConfig> = {};
  if (isRecord(raw.companies)) {
    for (const [id, value] of Object.entries(raw.companies)) {
      if (!isRecord(value)) continue;
      companies[id] = {
        url: typeof value.url === "string" ? value.url : null,
        saveConversations: value.saveConversations !== false,
        ...(typeof value.connectedAt === "string" ? { connectedAt: value.connectedAt } : {}),
        lastSave: lastSaveOf(value.lastSave),
      };
    }
  }
  const threads: Record<string, ThreadMemoryState> = {};
  if (isRecord(raw.threads)) {
    for (const [id, value] of Object.entries(raw.threads)) {
      if (!isRecord(value)) continue;
      threads[id] = {
        skip: value.skip === true,
        lastMessageId: typeof value.lastMessageId === "string" ? value.lastMessageId : null,
        lastSave: lastSaveOf(value.lastSave),
        ...(typeof value.lastEpisodeAt === "string" ? { lastEpisodeAt: value.lastEpisodeAt } : {}),
      };
    }
  }
  const queue = Array.isArray(raw.queue)
    ? raw.queue.filter(
        (item): item is QueuedEpisode =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.companyId === "string" &&
          typeof item.threadId === "string" &&
          typeof item.lastMessageId === "string" &&
          isRecord(item.body) &&
          typeof item.attempts === "number" &&
          typeof item.enqueuedAt === "number" &&
          typeof item.notBefore === "number",
      )
    : [];
  const holds: Record<string, number> = {};
  if (isRecord(raw.holds)) {
    for (const [id, value] of Object.entries(raw.holds)) {
      if (typeof value === "number") holds[id] = value;
    }
  }
  return { version: 1, companies, threads, queue, holds };
}

export function loadMemoryState(file: string): MemoryState {
  try {
    return normalizeMemoryState(JSON.parse(NodeFS.readFileSync(file, "utf8")));
  } catch {
    return emptyMemoryState();
  }
}

export function saveMemoryState(file: string, state: MemoryState): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
  NodeFS.chmodSync(file, 0o600);
}

export interface CompaniesFileView {
  readonly names: Readonly<Record<string, string>>;
  readonly projects: Readonly<Record<string, string>>;
}

/** The companies feature's `companies.json`: company names and the project -> company map. */
export function readCompaniesFile(file: string): CompaniesFileView {
  try {
    const raw = JSON.parse(NodeFS.readFileSync(file, "utf8")) as unknown;
    if (!isRecord(raw)) return { names: {}, projects: {} };
    const names: Record<string, string> = {};
    if (Array.isArray(raw.companies)) {
      for (const company of raw.companies) {
        if (isRecord(company) && typeof company.id === "string") {
          names[company.id] = typeof company.name === "string" ? company.name : company.id;
        }
      }
    }
    const projects: Record<string, string> = {};
    if (isRecord(raw.projects)) {
      for (const [projectId, companyId] of Object.entries(raw.projects)) {
        if (typeof companyId === "string") projects[projectId] = companyId;
      }
    }
    return { names, projects };
  } catch {
    return { names: {}, projects: {} };
  }
}

/**
 * Settle delay: how long a thread stays quiet after a completed run before it is summarized.
 * Every summary costs the memory server a full extraction (~10-20 LLM calls), so a pause for
 * reading or testing must not make one: 20 minutes, not 3. Measured on a heavy day (16 h, 349
 * runs in 30 threads): 3 min made 131 summaries, 20 min + the interval below about 30.
 */
export function settleDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const seconds = Number(env.ZEN_MEMORY_SETTLE_SECONDS);
  return Number.isFinite(seconds) && seconds >= 1 ? seconds * 1000 : 20 * 60_000;
}

/** At most one summary per thread in this window (0 = no limit); the next one covers everything since. */
export function minIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(env.ZEN_MEMORY_MIN_INTERVAL_MINUTES);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : 3 * 60 * 60_000;
}

/**
 * When a settled thread may be summarized: now (null) or the epoch ms to wait for. A thread waits
 * while its last summary is younger than `intervalMs`, unless the new part is already large (the
 * transcript sent to the summarizer is capped; waiting longer would drop its oldest messages).
 */
export function nextSummaryAt(
  thread: { readonly lastEpisodeAt?: string | undefined },
  newTranscriptChars: number,
  now: number,
  intervalMs: number,
  largeChars: number,
): number | null {
  if (intervalMs <= 0 || thread.lastEpisodeAt === undefined) return null;
  if (newTranscriptChars >= largeChars) return null;
  const last = Date.parse(thread.lastEpisodeAt);
  if (!Number.isFinite(last)) return null;
  const due = last + intervalMs;
  return due > now ? due : null;
}

/** Catch-up after a restart (settle timers live in memory): recent threads finished since connecting. */
export function threadsToCatchUp(
  threads: ReadonlyArray<{
    readonly id: string;
    readonly companyId: string;
    readonly latestRunCompletedAt: number | null;
  }>,
  connectedAt: (companyId: string) => number | null,
  now: number,
  windowMs = 7 * 24 * 60 * 60_000,
): ReadonlyArray<string> {
  return threads
    .filter((thread) => {
      const since = connectedAt(thread.companyId);
      const completed = thread.latestRunCompletedAt;
      return (
        since !== null && completed !== null && completed >= since && now - completed <= windowMs
      );
    })
    .map((thread) => thread.id);
}
