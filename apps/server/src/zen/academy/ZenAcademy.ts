// Zen Staff: the Academy on the server. Lists lessons from the built-in folder and the selected
// company's `<zen home>/companies/<id>/academy/`, and prepares practice folders for "Try it".
// Progress and learning signals stay on the device (web). ZEN.md, "Academy".
import {
  ZEN_ACADEMY_WS_METHODS,
  ZenAcademyError,
  type ZenAcademyExercise,
  type ZenAcademyExerciseInput,
  type ZenAcademyLessonList,
  type ZenAcademyListInput,
} from "@t3tools/contracts/zenAcademy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import { materializeEmbeddedAssets } from "../workflows/workflowAssets.ts";
import { ZEN_ACADEMY_LESSON_ASSETS, ZEN_ACADEMY_LESSONS_HASH } from "./embeddedLessons.gen.ts";
import { copyExerciseFiles, loadLessonDir, mergeLessons } from "./lessonStore.ts";

/** Built-in lessons ship next to this file; the server build copies them to dist/zen-academy/. */
const BUILTIN_LESSONS_DIR = "lessons";
const PACKAGED_LESSONS_DIR = "zen-academy";
/** Problem reported when no built-in lesson loads (the web shows it on the Academy page). */
export const BUILTIN_MISSING_MESSAGE =
  "The built-in lessons could not be read on this computer. Restart the app; if it stays empty, reinstall it.";

export interface ZenAcademyOptions {
  /** Folder holding the built-in lessons. Defaults to the first of `builtinLessonCandidates`. */
  readonly builtinDir?: string;
  /** A company's lessons folder, or null. Defaults to `<zen home>/companies/<id>/academy`. */
  readonly companyLessonsDir?: (companyId: string) => Effect.Effect<string | null>;
}

export class ZenAcademy extends Context.Service<
  ZenAcademy,
  {
    readonly list: (
      input: ZenAcademyListInput,
    ) => Effect.Effect<ZenAcademyLessonList, ZenAcademyError>;
    readonly prepareExercise: (
      input: ZenAcademyExerciseInput,
    ) => Effect.Effect<ZenAcademyExercise, ZenAcademyError>;
  }
>()("t3/zen/academy/ZenAcademy") {}

const fail = (reason: ZenAcademyError["reason"], detail: string) =>
  new ZenAcademyError({ reason, detail });
const isZenAcademyError = Schema.is(ZenAcademyError);

const asAcademyError =
  (action: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ZenAcademyError, R> =>
    effect.pipe(
      Effect.mapError((error) =>
        isZenAcademyError(error)
          ? error
          : fail(
              "io",
              `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
            ),
      ),
    );

const COMPANY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Where the built-in lessons can be: next to this module (running from source), in
 * `zen-academy/lessons` next to the bundled server (`apps/server/dist`, also used by the desktop
 * app), or next to a single-file executable.
 */
export function builtinLessonCandidates(
  path: Path.Path,
  moduleDir: string,
  execPath: string,
): ReadonlyArray<string> {
  return [
    path.join(moduleDir, BUILTIN_LESSONS_DIR),
    path.join(moduleDir, PACKAGED_LESSONS_DIR, BUILTIN_LESSONS_DIR),
    path.join(path.dirname(execPath), PACKAGED_LESSONS_DIR, BUILTIN_LESSONS_DIR),
  ];
}

/** True when `dir` holds at least one lesson folder whose lesson.json can be read. */
const hasReadableLessons = Effect.fn("ZenAcademy.hasReadableLessons")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
  for (const name of names.toSorted()) {
    if (name.startsWith(".")) continue;
    const json = yield* fs
      .readFileString(path.join(dir, name, "lesson.json"))
      .pipe(Effect.orElseSucceed(() => null));
    if (json !== null) return true;
  }
  return false;
});

/**
 * The first candidate whose lessons can be read, else the embedded lessons written once to
 * `<cacheRoot>/<hash>/lessons`. Existing is not enough: inside the Windows server.asar the folder
 * is visible but cannot be listed.
 */
export const resolveBuiltinLessonsDir = Effect.fn("ZenAcademy.resolveBuiltinDir")(function* (
  candidates: ReadonlyArray<string>,
  cacheRoot: string,
  embedded: {
    readonly files: Readonly<Record<string, string>>;
    readonly hash: string;
  } = { files: ZEN_ACADEMY_LESSON_ASSETS, hash: ZEN_ACADEMY_LESSONS_HASH },
) {
  const path = yield* Path.Path;
  for (const candidate of candidates) {
    if (yield* hasReadableLessons(candidate)) return candidate;
  }
  const target = yield* materializeEmbeddedAssets(cacheRoot, embedded.files, embedded.hash);
  return path.join(target, BUILTIN_LESSONS_DIR);
});

export const make = Effect.fn("ZenAcademy.make")(function* (options: ZenAcademyOptions = {}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const builtinDir =
    options.builtinDir ??
    (yield* Effect.gen(function* () {
      const candidates = builtinLessonCandidates(path, import.meta.dirname, process.execPath);
      return yield* resolveBuiltinLessonsDir(
        candidates,
        path.join(config.baseDir, "caches", "zen-academy"),
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.tapError((error) =>
          Effect.logWarning("Zen Academy: could not write the embedded lessons", error),
        ),
        Effect.orElseSucceed(() => candidates[0]!),
      );
    }));
  const practiceRoot = path.join(config.baseDir, "academy", "practice");

  const local = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const companyDir = Effect.fn("ZenAcademy.companyDir")(function* (
    companyId: string | null | undefined,
  ) {
    if (!companyId) return null;
    if (options.companyLessonsDir) return yield* options.companyLessonsDir(companyId);
    return COMPANY_ID.test(companyId)
      ? path.join(config.baseDir, "companies", companyId, "academy")
      : null;
  });

  const loadAll = Effect.fn("ZenAcademy.loadAll")(function* (companyId: string | null | undefined) {
    const builtin = yield* local(loadLessonDir(builtinDir, "builtin"));
    const dir = yield* companyDir(companyId);
    const company = dir
      ? yield* local(loadLessonDir(dir, "company"))
      : { lessons: [], problems: [] };
    return { builtin, company, companyDir: dir };
  });

  const list = (input: ZenAcademyListInput) =>
    loadAll(input.companyId).pipe(
      Effect.map(({ builtin, company }): ZenAcademyLessonList => ({
        lessons: mergeLessons([builtin.lessons, company.lessons]),
        problems: [
          // Say so instead of showing an empty page when the built-in lessons cannot be read.
          ...(builtin.lessons.length === 0 && builtin.problems.length === 0
            ? [{ location: "builtin", message: BUILTIN_MISSING_MESSAGE }]
            : []),
          ...builtin.problems,
          ...company.problems,
        ],
      })),
      asAcademyError("load the Academy lessons"),
    );

  const prepareExercise = Effect.fn("ZenAcademy.prepareExercise")(function* (
    input: ZenAcademyExerciseInput,
  ) {
    const all = yield* loadAll(input.companyId);
    const fromCompany = all.company.lessons.find((lesson) => lesson.manifest.id === input.lessonId);
    const lesson =
      fromCompany ?? all.builtin.lessons.find((lesson) => lesson.manifest.id === input.lessonId);
    if (!lesson) return yield* fail("not-found", "This lesson is not in the Academy.");
    if (lesson.exerciseFiles.length === 0) {
      return yield* fail("invalid", "This lesson has no practice files.");
    }
    const lessonFolder = path.join(
      fromCompany && all.companyDir ? all.companyDir : builtinDir,
      lesson.manifest.id,
    );
    // Company lessons get their own practice folder, so a company copy never mixes with ours.
    const target = path.join(
      practiceRoot,
      fromCompany && input.companyId
        ? `${input.companyId}--${lesson.manifest.id}`
        : lesson.manifest.id,
    );
    const created = yield* local(copyExerciseFiles(lessonFolder, lesson.exerciseFiles, target));
    return { path: target, created } satisfies ZenAcademyExercise;
  }, asAcademyError("prepare the practice folder"));

  return ZenAcademy.of({ list, prepareExercise });
});

export const layer = Layer.effect(ZenAcademy, make());

/** RPC handlers for ws.ts, kept here so the upstream file only spreads them in. */
export const wsHandlers = (service: Option.Option<ZenAcademy["Service"]>) => {
  const unavailable = Effect.fail(
    fail("unavailable", "The Academy is not available on this server."),
  );
  const call = <A>(run: (academy: ZenAcademy["Service"]) => Effect.Effect<A, ZenAcademyError>) =>
    Option.isSome(service) ? run(service.value) : unavailable;
  return {
    [ZEN_ACADEMY_WS_METHODS.list]: (input: ZenAcademyListInput) =>
      call((academy) => academy.list(input)),
    [ZEN_ACADEMY_WS_METHODS.prepareExercise]: (input: ZenAcademyExerciseInput) =>
      call((academy) => academy.prepareExercise(input)),
  };
};
