// Zen Staff Academy: lesson progress (done / not done) per device in localStorage. Pure helpers
// are tested; the store is thin. Hub seams: `AcademyProgressSource` (others' progress, read-only)
// and `AcademyProgressSync` (this person's progress across devices, registerAcademyProgressSync).
import type { ZenAcademyTrack } from "@t3tools/contracts/zenAcademy";
import { useSyncExternalStore } from "react";

export interface AcademyProgressRecord {
  /** ISO time the lesson was marked done. */
  readonly doneAt: string;
}

/** lesson id -> record. A missing id is "not done". */
export type AcademyProgress = Readonly<Record<string, AcademyProgressRecord>>;

export interface AcademyProgressEvent {
  readonly lessonId: string;
  readonly done: boolean;
  readonly at: string;
}

/** The seam the hub fills later: progress of other people, read-only. */
export interface AcademyProgressSource {
  readonly id: string;
  readonly label: string;
  readonly read: () => Promise<ReadonlyArray<{ person: string; progress: AcademyProgress }>>;
}

/**
 * The seam the hub fills: this person's progress kept with their account, so it follows them
 * across devices. Without one (today) progress stays on the device.
 */
export interface AcademyProgressSync {
  readonly id: string;
  /** Sends one local change to the account. Failures are the sync's to retry. */
  readonly push: (event: AcademyProgressEvent) => void | Promise<void>;
  /** The account's progress; merged into the device's when the sync is registered. */
  readonly pull: () => Promise<AcademyProgress>;
}

export const EMPTY_PROGRESS: AcademyProgress = {};

/** Done on either side stays done; the earlier "done at" wins. */
export function mergeProgress(local: AcademyProgress, remote: AcademyProgress): AcademyProgress {
  const changes = Object.entries(remote).filter(
    ([id, record]) => !local[id] || record.doneAt < local[id].doneAt,
  );
  if (changes.length === 0) return local;
  const merged: Record<string, AcademyProgressRecord> = { ...local };
  for (const [id, record] of changes) merged[id] = { doneAt: record.doneAt };
  return merged;
}

export function setLessonDone(
  progress: AcademyProgress,
  lessonId: string,
  done: boolean,
  at: string,
): AcademyProgress {
  if (done) {
    if (progress[lessonId]) return progress;
    return { ...progress, [lessonId]: { doneAt: at } };
  }
  if (!progress[lessonId]) return progress;
  const { [lessonId]: _removed, ...rest } = progress;
  return rest;
}

export function isLessonDone(progress: AcademyProgress, lessonId: string): boolean {
  return progress[lessonId] !== undefined;
}

/** Done / total for the lessons of one track (only lessons that exist count). */
export function trackProgress(
  progress: AcademyProgress,
  lessons: ReadonlyArray<{
    readonly manifest: { readonly id: string; readonly track: ZenAcademyTrack };
  }>,
  track: ZenAcademyTrack,
): { readonly done: number; readonly total: number; readonly percent: number } {
  const inTrack = lessons.filter((lesson) => lesson.manifest.track === track);
  const done = inTrack.filter((lesson) => isLessonDone(progress, lesson.manifest.id)).length;
  const total = inTrack.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Reads stored progress, dropping anything malformed. */
export function parseProgress(raw: string | null): AcademyProgress {
  if (!raw) return EMPTY_PROGRESS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_PROGRESS;
    const out: Record<string, AcademyProgressRecord> = {};
    for (const [id, record] of Object.entries(value)) {
      if (
        typeof record === "object" &&
        record !== null &&
        typeof (record as { doneAt?: unknown }).doneAt === "string"
      ) {
        out[id] = { doneAt: (record as { doneAt: string }).doneAt };
      }
    }
    return out;
  } catch {
    return EMPTY_PROGRESS;
  }
}

// Store (per device).

const PROGRESS_KEY = "zen:academy:progress";
const listeners = new Set<() => void>();

function readStored(): AcademyProgress {
  try {
    return parseProgress(globalThis.localStorage?.getItem(PROGRESS_KEY) ?? null);
  } catch {
    return EMPTY_PROGRESS;
  }
}

let current: AcademyProgress = readStored();

export function getAcademyProgress(): AcademyProgress {
  return current;
}

function store(next: AcademyProgress): void {
  current = next;
  try {
    globalThis.localStorage?.setItem(PROGRESS_KEY, JSON.stringify(current));
  } catch {
    // Progress still shows for this session.
  }
  for (const listener of listeners) listener();
}

let sync: AcademyProgressSync | null = null;

type ProgressSink = (event: AcademyProgressEvent) => void;
let progressSink: ProgressSink | null = null;

/** The hub's team progress: every lesson marked here is also reported there (hub/HubSync.tsx). */
export function setAcademyProgressSink(sink: ProgressSink | null): void {
  progressSink = sink;
}

export function markLesson(lessonId: string, done: boolean): void {
  const at = new Date().toISOString();
  const next = setLessonDone(current, lessonId, done, at);
  if (next === current) return;
  progressSink?.({ lessonId, done, at });
  store(next);
  if (sync) {
    const target = sync;
    void Promise.resolve()
      .then(() => target.push({ lessonId, done, at }))
      .catch(() => undefined);
  }
}

/**
 * Registers the account sync (the hub calls this after sign-in). Pulls the account's progress and
 * merges it in; returns a function that unregisters. One sync at a time; a new one replaces it.
 */
export function registerAcademyProgressSync(next: AcademyProgressSync): () => void {
  sync = next;
  void next
    .pull()
    .then((remote) => {
      if (sync !== next) return;
      const merged = mergeProgress(current, remote);
      if (merged !== current) store(merged);
    })
    .catch(() => undefined);
  return () => {
    if (sync === next) sync = null;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAcademyProgress(): AcademyProgress {
  return useSyncExternalStore(subscribe, getAcademyProgress, getAcademyProgress);
}
