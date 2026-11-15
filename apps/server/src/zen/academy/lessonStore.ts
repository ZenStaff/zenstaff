// Zen Staff: reading Academy lesson folders (lesson.json + en.md / ro.md or lesson.md + optional
// exercise/). Same approach as the Office workflow folders: parsing and merging are pure so tests
// cover them without a disk. See ZEN.md, "Academy".
import {
  ZenLessonManifest,
  practiceFileName,
  sortLessons,
  validateLesson,
  type ZenLesson,
  type ZenLessonProblem,
  type ZenLessonSource,
} from "@t3tools/contracts/zenAcademy";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const LESSON_FILE = "lesson.json";
const EXERCISE_DIR = "exercise";
/** Bounds for a practice folder; lessons ship small text files. */
const MAX_EXERCISE_FILES = 40;
const MAX_EXERCISE_DEPTH = 4;

const decodeManifest = Schema.decodeUnknownResult(Schema.fromJsonString(ZenLessonManifest));

export interface LessonFolderFiles {
  readonly folderName: string;
  readonly lessonJson: string | null;
  readonly en: string | null;
  readonly ro: string | null;
  /** lesson.md: the body for a single-language lesson (company lessons). */
  readonly any: string | null;
  readonly exerciseFiles: ReadonlyArray<string>;
}

export type ParsedLesson =
  | { readonly _tag: "ok"; readonly lesson: ZenLesson }
  | { readonly _tag: "problem"; readonly problem: ZenLessonProblem };

const problem = (location: string, message: string): ParsedLesson => ({
  _tag: "problem",
  problem: { location, message },
});

/** Turns a folder's files into a lesson, or a plain-language reason it cannot load. */
export function parseLessonFolder(files: LessonFolderFiles, source: ZenLessonSource): ParsedLesson {
  const location = files.folderName;
  if (files.lessonJson === null) return problem(location, `${LESSON_FILE} is missing.`);
  const decoded = decodeManifest(files.lessonJson);
  if (Result.isFailure(decoded)) {
    return problem(location, `${LESSON_FILE} is not valid: ${decoded.failure.message}`);
  }
  const manifest = decoded.success;
  const en = files.en ?? files.any ?? undefined;
  const ro = files.ro ?? files.any ?? undefined;
  const body = { ...(en !== undefined ? { en } : {}), ...(ro !== undefined ? { ro } : {}) };
  const problems = validateLesson(manifest, body, files.exerciseFiles);
  if (manifest.id !== files.folderName) {
    problems.push(`The folder is "${files.folderName}" but the id is "${manifest.id}".`);
  }
  if (problems.length > 0) return problem(location, problems.join(" "));
  return {
    _tag: "ok",
    lesson: { manifest, body, source, exerciseFiles: [...files.exerciseFiles] },
  };
}

/**
 * Merges sources in order; a later one replaces an earlier lesson with the same id (built-in,
 * then company: a company can rewrite a built-in lesson its own way). Sorted for display.
 */
export function mergeLessons(
  lists: ReadonlyArray<ReadonlyArray<ZenLesson>>,
): ReadonlyArray<ZenLesson> {
  const byId = new Map<string, ZenLesson>();
  for (const list of lists) for (const lesson of list) byId.set(lesson.manifest.id, lesson);
  return sortLessons([...byId.values()]);
}

/** A practice file path that stays inside the practice folder. */
export function isSafeRelativePath(relative: string): boolean {
  if (relative.length === 0 || relative.length > 200) return false;
  if (relative.startsWith("/") || relative.includes("\\") || /^[a-zA-Z]:/.test(relative)) {
    return false;
  }
  return relative.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

const readOptional = (fs: FileSystem.FileSystem, path: string) =>
  fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));

/** Relative paths of every file under `dir` (sorted, bounded). A missing dir is empty. */
const listFilesRecursive = Effect.fn("ZenAcademy.listFiles")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const out: string[] = [];
  // Breadth-first over folders; each entry is (absolute folder, relative prefix, depth).
  const queue: Array<readonly [string, string, number]> = [[dir, "", 0]];
  while (queue.length > 0 && out.length < MAX_EXERCISE_FILES) {
    const [folder, prefix, depth] = queue.shift()!;
    const names = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => [] as string[]));
    for (const name of names.toSorted()) {
      if (name === ".DS_Store" || name === ".git") continue;
      const full = path.join(folder, name);
      const info = yield* fs.stat(full).pipe(Effect.option);
      if (info._tag === "None") continue;
      const relative = prefix ? `${prefix}/${name}` : name;
      if (info.value.type === "Directory") {
        if (depth < MAX_EXERCISE_DEPTH) queue.push([full, relative, depth + 1]);
      } else if (info.value.type === "File" && out.length < MAX_EXERCISE_FILES) out.push(relative);
    }
  }
  out.sort();
  return out;
});

/** Every lesson folder directly under `dir`. A missing dir is an empty list. */
export const loadLessonDir = Effect.fn("ZenAcademy.loadDir")(function* (
  dir: string,
  source: ZenLessonSource,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lessons: ZenLesson[] = [];
  const problems: ZenLessonProblem[] = [];
  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
  for (const name of names.toSorted()) {
    if (name.startsWith(".")) continue;
    const folder = path.join(dir, name);
    const info = yield* fs.stat(folder).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "Directory") continue;
    const parsed = parseLessonFolder(
      {
        folderName: name,
        lessonJson: yield* readOptional(fs, path.join(folder, LESSON_FILE)),
        en: yield* readOptional(fs, path.join(folder, "en.md")),
        ro: yield* readOptional(fs, path.join(folder, "ro.md")),
        any: yield* readOptional(fs, path.join(folder, "lesson.md")),
        exerciseFiles: yield* listFilesRecursive(path.join(folder, EXERCISE_DIR)),
      },
      source,
    );
    if (parsed._tag === "ok") lessons.push(parsed.lesson);
    else problems.push({ ...parsed.problem, location: `${source}: ${parsed.problem.location}` });
  }
  return { lessons, problems };
});

/**
 * Copies a lesson's exercise/ files into `target`. Files that already exist are kept (the person
 * may have worked on them); returns the files written now.
 */
export const copyExerciseFiles = Effect.fn("ZenAcademy.copyExercise")(function* (
  lessonFolder: string,
  files: ReadonlyArray<string>,
  target: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const created: string[] = [];
  yield* fs.makeDirectory(target, { recursive: true });
  for (const relative of files) {
    if (!isSafeRelativePath(relative)) continue;
    const name = practiceFileName(relative);
    const destination = path.join(target, ...name.split("/"));
    if (yield* fs.exists(destination)) continue;
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    yield* fs.copyFile(path.join(lessonFolder, EXERCISE_DIR, ...relative.split("/")), destination);
    created.push(name);
  }
  return created;
});
