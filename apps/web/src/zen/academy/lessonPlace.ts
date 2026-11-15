// Zen Staff Academy: where the person left off (the lesson and the step they last opened), for
// "Continuă de unde ai rămas" on the Academy index. Kept on the device; pure parts tested in
// lessonPlace.test.ts.
import { useSyncExternalStore } from "react";

export interface LessonPlace {
  readonly lessonId: string;
  /** 0-based step index; the quiz is the step after the last one. */
  readonly step: number;
  readonly steps: number;
  readonly at: string;
}

const PLACE_KEY = "zen:academy:place";
const listeners = new Set<() => void>();

export function parseLessonPlace(raw: string | null): LessonPlace | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LessonPlace> | null;
    if (
      value === null ||
      typeof value.lessonId !== "string" ||
      typeof value.step !== "number" ||
      typeof value.steps !== "number" ||
      typeof value.at !== "string" ||
      value.steps < 1 ||
      value.step < 0
    ) {
      return null;
    }
    return {
      lessonId: value.lessonId,
      step: Math.min(Math.floor(value.step), Math.floor(value.steps)),
      steps: Math.floor(value.steps),
      at: value.at,
    };
  } catch {
    return null;
  }
}

/**
 * The lesson to continue: the one last opened when it is not done yet, else the first lesson not
 * done (in display order). Null when everything is done.
 */
export function continueLesson<L extends { readonly manifest: { readonly id: string } }>(
  place: LessonPlace | null,
  lessons: ReadonlyArray<L>,
  isDone: (lessonId: string) => boolean,
): { readonly lesson: L; readonly place: LessonPlace | null } | null {
  if (place !== null && !isDone(place.lessonId)) {
    const lesson = lessons.find((candidate) => candidate.manifest.id === place.lessonId);
    if (lesson) return { lesson, place };
  }
  const next = lessons.find((candidate) => !isDone(candidate.manifest.id));
  return next ? { lesson: next, place: null } : null;
}

function readStored(): LessonPlace | null {
  try {
    return parseLessonPlace(globalThis.localStorage?.getItem(PLACE_KEY) ?? null);
  } catch {
    return null;
  }
}

let current: LessonPlace | null = readStored();

export function getLessonPlace(): LessonPlace | null {
  return current;
}

export function rememberLessonPlace(lessonId: string, step: number, steps: number): void {
  if (current?.lessonId === lessonId && current.step === step && current.steps === steps) return;
  current = { lessonId, step, steps, at: new Date().toISOString() };
  try {
    globalThis.localStorage?.setItem(PLACE_KEY, JSON.stringify(current));
  } catch {
    // Remembering the place is a convenience only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLessonPlace(): LessonPlace | null {
  return useSyncExternalStore(subscribe, getLessonPlace, getLessonPlace);
}
