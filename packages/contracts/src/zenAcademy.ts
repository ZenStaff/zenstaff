// Zen Staff: the Academy. Short lessons in two tracks (Office: how to do X with AI staff; Code:
// security and working safely with coding agents), shipped built-in and per company. Lessons are
// folders (lesson.json + en.md / ro.md + optional exercise/); this file holds their format, the
// pure rules shared by the server and the web, and the RPCs. See ZEN.md, "Academy".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import type { ZenEdition } from "./zenOffice.ts";

export const ZEN_ACADEMY_WS_METHODS = {
  list: "zen.academy.list",
  prepareExercise: "zen.academy.prepareExercise",
} as const;

const ZEN_ACADEMY_LOCALES = ["en", "ro"] as const;
export const ZenAcademyLocale = Schema.Literals(ZEN_ACADEMY_LOCALES);
export type ZenAcademyLocale = typeof ZenAcademyLocale.Type;

export const ZenAcademyTrack = Schema.Literals(["office", "code"]);
export type ZenAcademyTrack = typeof ZenAcademyTrack.Type;

export const ZenAcademyLevel = Schema.Literals(["beginner", "intermediate", "advanced"]);
export type ZenAcademyLevel = typeof ZenAcademyLevel.Type;

/** A text in one language (company lessons may use one) or per locale. */
export const ZenLocalizedText = Schema.Union([
  Schema.String,
  Schema.Struct({ en: Schema.optional(Schema.String), ro: Schema.optional(Schema.String) }),
]);
export type ZenLocalizedText = typeof ZenLocalizedText.Type;

const LocalizedValues = Schema.Struct({
  en: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  ro: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

/** Pages a lesson may open. */
const ZEN_ACADEMY_OPEN_TARGETS = [
  "/office",
  "/workflow-editor",
  "/marketplace",
  "/library",
  "/companies",
  "/limits",
  "/settings",
] as const;
export const ZenAcademyOpenTarget = Schema.Literals(ZEN_ACADEMY_OPEN_TARGETS);
export type ZenAcademyOpenTarget = typeof ZenAcademyOpenTarget.Type;

/** What "Try it" does. */
export const ZenAcademyTryIt = Schema.Union([
  /** Starts an Office workflow with example answers. */
  Schema.Struct({
    kind: Schema.Literal("workflow"),
    workflow: Schema.String,
    exercise: Schema.optional(Schema.Boolean),
    values: Schema.optional(LocalizedValues),
  }),
  /** Sends a prompt to the agent. */
  Schema.Struct({
    kind: Schema.Literal("prompt"),
    exercise: Schema.optional(Schema.Boolean),
    prompt: ZenLocalizedText,
  }),
  /** Runs an audit command (a Claude Code slash command or skill), or the fallback prompt. */
  Schema.Struct({
    kind: Schema.Literal("audit"),
    command: Schema.String,
    args: Schema.optional(Schema.String),
    exercise: Schema.optional(Schema.Boolean),
    fallback: ZenLocalizedText,
  }),
  /** Opens a page of the app. */
  Schema.Struct({ kind: Schema.Literal("open"), to: ZenAcademyOpenTarget }),
]);
export type ZenAcademyTryIt = typeof ZenAcademyTryIt.Type;

/** The content of lesson.json. */
export const ZenLessonManifest = Schema.Struct({
  id: Schema.String,
  track: ZenAcademyTrack,
  order: Schema.optional(Schema.Number),
  title: ZenLocalizedText,
  summary: ZenLocalizedText,
  minutes: Schema.Number,
  level: ZenAcademyLevel,
  tags: Schema.Array(Schema.String),
  /** Editions that show the lesson. Default: Office track in both, Code track in Code only. */
  editions: Schema.optional(Schema.Array(Schema.Literals(["office", "code"]))),
  version: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  tryIt: Schema.optional(ZenAcademyTryIt),
});
export type ZenLessonManifest = typeof ZenLessonManifest.Type;

export const ZenLessonSource = Schema.Literals(["builtin", "company"]);
export type ZenLessonSource = typeof ZenLessonSource.Type;

export const ZenLesson = Schema.Struct({
  manifest: ZenLessonManifest,
  /** Body per locale (en.md, ro.md); `lesson.md` fills any locale without its own file. */
  body: Schema.Struct({ en: Schema.optional(Schema.String), ro: Schema.optional(Schema.String) }),
  source: ZenLessonSource,
  /** File names in exercise/ (copied into the practice folder by prepareExercise). */
  exerciseFiles: Schema.Array(Schema.String),
});
export type ZenLesson = typeof ZenLesson.Type;

export const ZenLessonProblem = Schema.Struct({
  location: Schema.String,
  message: Schema.String,
});
export type ZenLessonProblem = typeof ZenLessonProblem.Type;

export const ZenAcademyListInput = Schema.Struct({
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenAcademyListInput = typeof ZenAcademyListInput.Type;

export const ZenAcademyLessonList = Schema.Struct({
  lessons: Schema.Array(ZenLesson),
  problems: Schema.Array(ZenLessonProblem),
});
export type ZenAcademyLessonList = typeof ZenAcademyLessonList.Type;

export const ZenAcademyExerciseInput = Schema.Struct({
  lessonId: Schema.String,
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenAcademyExerciseInput = typeof ZenAcademyExerciseInput.Type;

export const ZenAcademyExercise = Schema.Struct({
  /** Absolute path of the practice folder, `<zen home>/academy/practice/<lesson id>`. */
  path: Schema.String,
  /** Files written now; files already there (the person may have changed them) are kept. */
  created: Schema.Array(Schema.String),
});
export type ZenAcademyExercise = typeof ZenAcademyExercise.Type;

export class ZenAcademyError extends Schema.TaggedError<ZenAcademyError>()("ZenAcademyError", {
  reason: Schema.Literals(["invalid", "not-found", "unavailable", "io"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const errors = Schema.Union([ZenAcademyError, EnvironmentAuthorizationError]);

const ZenAcademyListRpc = Rpc.make(ZEN_ACADEMY_WS_METHODS.list, {
  payload: ZenAcademyListInput,
  success: ZenAcademyLessonList,
  error: errors,
});
const ZenAcademyPrepareExerciseRpc = Rpc.make(ZEN_ACADEMY_WS_METHODS.prepareExercise, {
  payload: ZenAcademyExerciseInput,
  success: ZenAcademyExercise,
  error: errors,
});

export const ZEN_ACADEMY_RPCS = [ZenAcademyListRpc, ZenAcademyPrepareExerciseRpc] as const;

export const ZEN_ACADEMY_RPC_SCOPES = {
  [ZEN_ACADEMY_WS_METHODS.list]: AuthOrchestrationReadScope,
  [ZEN_ACADEMY_WS_METHODS.prepareExercise]: AuthOrchestrationOperateScope,
} as const;

/** Observability aggregate for each method (RpcInstrumentation.ts must name every RPC). */
export const ZEN_ACADEMY_RPC_AGGREGATES = {
  [ZEN_ACADEMY_WS_METHODS.list]: "zen",
  [ZEN_ACADEMY_WS_METHODS.prepareExercise]: "zen",
} as const;

// Pure rules shared by the server (validation) and the web (display).

const LESSON_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const COMMAND_NAME = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** The text for `locale`, falling back to the other locale, then "". */
export function localized(text: ZenLocalizedText | undefined, locale: ZenAcademyLocale): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  const other: ZenAcademyLocale = locale === "en" ? "ro" : "en";
  return text[locale] ?? text[other] ?? "";
}

/** The lesson body for `locale`, falling back to the other one. */
export function lessonBody(lesson: Pick<ZenLesson, "body">, locale: ZenAcademyLocale): string {
  return localized(lesson.body, locale);
}

/** The editions that show a lesson (Office track: both; Code track: Code only). */
export function lessonEditions(manifest: ZenLessonManifest): ReadonlyArray<ZenEdition> {
  if (manifest.editions && manifest.editions.length > 0) return manifest.editions;
  return manifest.track === "office" ? ["office", "code"] : ["code"];
}

/** Tracks shown in an edition: Office shows only the Office track, Code shows both. */
export function tracksForEdition(edition: ZenEdition): ReadonlyArray<ZenAcademyTrack> {
  return edition === "office" ? ["office"] : ["office", "code"];
}

export function lessonVisibleIn(manifest: ZenLessonManifest, edition: ZenEdition): boolean {
  return (
    tracksForEdition(edition).includes(manifest.track) && lessonEditions(manifest).includes(edition)
  );
}

/** Whether the lesson's Try it needs the practice folder. */
export function tryItUsesExercise(tryIt: ZenAcademyTryIt | undefined): boolean {
  return tryIt !== undefined && tryIt.kind !== "open" && tryIt.exercise === true;
}

/**
 * The name a practice file gets in the practice folder. A path segment starting with `dot.` starts
 * with `.` instead (`dot.env` -> `.env`), because the repo ignores `.env*` files; a trailing
 * `.sample` is dropped (`app.ts.sample` -> `app.ts`), so the repo's typecheck, lint and knip skip
 * the deliberately insecure practice code.
 */
export function practiceFileName(relative: string): string {
  return relative
    .split("/")
    .map((part) => (part.startsWith("dot.") && part.length > 4 ? `.${part.slice(4)}` : part))
    .map((part) => (part.endsWith(".sample") && part.length > 7 ? part.slice(0, -7) : part))
    .join("/");
}

/** Checks a lesson beyond its schema. Returns plain-language problems; empty means valid. */
export function validateLesson(
  manifest: ZenLessonManifest,
  body: { readonly en?: string | undefined; readonly ro?: string | undefined },
  exerciseFiles: ReadonlyArray<string> = [],
): string[] {
  const problems: string[] = [];
  if (!LESSON_ID.test(manifest.id)) {
    problems.push("The id uses 2 to 64 lowercase letters, digits or dashes.");
  }
  for (const [field, text] of [
    ["title", manifest.title],
    ["summary", manifest.summary],
  ] as const) {
    const values = typeof text === "string" ? [text] : [text.en, text.ro];
    if (!values.some((value) => value !== undefined && value.trim().length > 0)) {
      problems.push(`Give the lesson a ${field}.`);
    }
    if (values.some((value) => (value?.length ?? 0) > (field === "title" ? 100 : 300))) {
      problems.push(`The ${field} is too long.`);
    }
  }
  if (!Number.isFinite(manifest.minutes) || manifest.minutes < 1 || manifest.minutes > 30) {
    problems.push("minutes is between 1 and 30.");
  }
  if (manifest.tags.length > 12) problems.push("Use at most 12 tags.");
  for (const tag of manifest.tags) {
    if (!TAG.test(tag)) problems.push(`The tag "${tag}" uses lowercase letters, digits or dashes.`);
  }
  if (!(body.en?.trim() || body.ro?.trim())) {
    problems.push("Write the lesson text (en.md, ro.md or lesson.md).");
  }
  if ((body.en?.length ?? 0) > 60_000 || (body.ro?.length ?? 0) > 60_000) {
    problems.push("Keep the lesson text under 60,000 characters.");
  }
  const tryIt = manifest.tryIt;
  if (tryIt?.kind === "workflow" && !LESSON_ID.test(tryIt.workflow)) {
    problems.push("tryIt.workflow is a workflow id.");
  }
  if (tryIt?.kind === "prompt" && localized(tryIt.prompt, "en").trim().length === 0) {
    problems.push("tryIt.prompt is empty.");
  }
  if (tryIt?.kind === "audit") {
    if (!COMMAND_NAME.test(tryIt.command)) {
      problems.push("tryIt.command is a command name without the slash, such as security-audit.");
    }
    if (localized(tryIt.fallback, "en").trim().length === 0) {
      problems.push("tryIt.fallback is the prompt used when the command is not installed.");
    }
  }
  if (tryItUsesExercise(tryIt) && exerciseFiles.length === 0) {
    problems.push("tryIt uses the practice folder, but the lesson has no exercise/ files.");
  }
  return problems;
}

/** Sorts lessons by track, then order, then title. */
export function sortLessons<T extends Pick<ZenLesson, "manifest">>(
  lessons: ReadonlyArray<T>,
  locale: ZenAcademyLocale = "en",
): ReadonlyArray<T> {
  const trackRank = (track: ZenAcademyTrack) => (track === "office" ? 0 : 1);
  return [...lessons].sort(
    (left, right) =>
      trackRank(left.manifest.track) - trackRank(right.manifest.track) ||
      (left.manifest.order ?? 1000) - (right.manifest.order ?? 1000) ||
      localized(left.manifest.title, locale).localeCompare(localized(right.manifest.title, locale)),
  );
}

/**
 * The message an audit Try it sends: `/<command> <args>` when the agent has that command or
 * skill, otherwise the fallback prompt (a full audit instruction in plain words).
 */
export function auditMessage(
  tryIt: Extract<ZenAcademyTryIt, { kind: "audit" }>,
  availableCommands: ReadonlyArray<string>,
  locale: ZenAcademyLocale,
): { readonly text: string; readonly usedCommand: boolean } {
  const installed = availableCommands.some(
    (name) => name.replace(/^\//, "").toLowerCase() === tryIt.command.toLowerCase(),
  );
  if (installed) {
    const args = tryIt.args?.trim();
    return { text: args ? `/${tryIt.command} ${args}` : `/${tryIt.command}`, usedCommand: true };
  }
  return { text: localized(tryIt.fallback, locale).trim(), usedCommand: false };
}
