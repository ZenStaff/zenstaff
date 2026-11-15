// Zen Staff Academy on the web: RPC atoms and the pure helpers the page and tests share.
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  ZEN_ACADEMY_WS_METHODS,
  lessonVisibleIn,
  localized,
  tracksForEdition,
  type ZenAcademyLocale,
  type ZenAcademyTrack,
  type ZenLesson,
} from "@t3tools/contracts/zenAcademy";
import type { ZenEdition } from "@t3tools/contracts/zenOffice";

import { connectionAtomRuntime } from "../../connection/runtime";
import { matchesSearch } from "../office/officeState";

export const academyLessons = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-academy:lessons",
  tag: ZEN_ACADEMY_WS_METHODS.list,
  staleTimeMs: 10_000,
  idleTtlMs: 300_000,
});

export const prepareAcademyExercise = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-academy:prepare-exercise",
  tag: ZEN_ACADEMY_WS_METHODS.prepareExercise,
});

/** listLessons input: the selected company adds its own lessons (null = built-in only). */
export function lessonsInput(companyId: string | null): { readonly companyId: string | null } {
  return { companyId };
}

/** Lessons the edition shows, grouped by track in display order. */
export function lessonsByTrack(
  lessons: ReadonlyArray<ZenLesson>,
  edition: ZenEdition,
): ReadonlyArray<{ readonly track: ZenAcademyTrack; readonly lessons: ReadonlyArray<ZenLesson> }> {
  return tracksForEdition(edition)
    .map((track) => ({
      track,
      lessons: lessons.filter(
        (lesson) => lesson.manifest.track === track && lessonVisibleIn(lesson.manifest, edition),
      ),
    }))
    .filter((group) => group.lessons.length > 0);
}

/** Search over title, summary, tags and body in the reader's language (accent-insensitive). */
export function searchLessons(
  lessons: ReadonlyArray<ZenLesson>,
  query: string,
  locale: ZenAcademyLocale,
): ReadonlyArray<ZenLesson> {
  if (query.trim().length === 0) return lessons;
  return lessons.filter((lesson) =>
    matchesSearch(query, [
      localized(lesson.manifest.title, locale),
      localized(lesson.manifest.summary, locale),
      localized(lesson.manifest.title, locale === "en" ? "ro" : "en"),
      lesson.manifest.tags.join(" "),
      localized(lesson.body, locale),
    ]),
  );
}

/** The next lesson in the same track after `lessonId`, for the reader's "Next lesson". */
export function nextLesson(lessons: ReadonlyArray<ZenLesson>, lessonId: string): ZenLesson | null {
  const index = lessons.findIndex((lesson) => lesson.manifest.id === lessonId);
  if (index < 0) return null;
  const track = lessons[index]!.manifest.track;
  return lessons.slice(index + 1).find((lesson) => lesson.manifest.track === track) ?? null;
}
