import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  auditMessage,
  lessonEditions,
  lessonVisibleIn,
  localized,
  practiceFileName,
  validateLesson,
  type ZenLesson,
  type ZenLessonManifest,
} from "@t3tools/contracts/zenAcademy";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  copyExerciseFiles,
  isSafeRelativePath,
  loadLessonDir,
  mergeLessons,
  parseLessonFolder,
} from "./lessonStore.ts";

const manifest = (overrides: Partial<ZenLessonManifest> = {}): ZenLessonManifest => ({
  id: "office-sample",
  track: "office",
  order: 10,
  title: { en: "Sample", ro: "Exemplu" },
  summary: { en: "A sample lesson.", ro: "O lecție de probă." },
  minutes: 3,
  level: "beginner",
  tags: ["sample"],
  ...overrides,
});

const files = (overrides: Partial<Parameters<typeof parseLessonFolder>[0]> = {}) => ({
  folderName: "office-sample",
  lessonJson: JSON.stringify(manifest()),
  en: "## Hello\n\nText.",
  ro: "## Salut\n\nText.",
  any: null,
  exerciseFiles: [],
  ...overrides,
});

const BUILTIN_DIR = new URL("./lessons", import.meta.url).pathname;

describe("parseLessonFolder", () => {
  it("loads a valid folder", () => {
    const parsed = parseLessonFolder(files(), "builtin");
    expect(parsed._tag).toBe("ok");
    if (parsed._tag === "ok") {
      expect(parsed.lesson.body.ro).toContain("Salut");
      expect(parsed.lesson.source).toBe("builtin");
    }
  });

  it("explains missing files, bad JSON and a folder/id mismatch", () => {
    expect(parseLessonFolder(files({ lessonJson: null }), "builtin")).toMatchObject({
      _tag: "problem",
      problem: { message: "lesson.json is missing." },
    });
    const bad = parseLessonFolder(files({ lessonJson: "{" }), "builtin");
    expect(bad._tag === "problem" && bad.problem.message).toMatch(/not valid/);
    const wrongTrack = parseLessonFolder(
      files({ lessonJson: JSON.stringify({ ...manifest(), track: "sales" }) }),
      "builtin",
    );
    expect(wrongTrack._tag).toBe("problem");
    const mismatch = parseLessonFolder(files({ folderName: "other" }), "builtin");
    expect(mismatch._tag === "problem" && mismatch.problem.message).toMatch(/folder is "other"/);
    const noBody = parseLessonFolder(files({ en: null, ro: null }), "builtin");
    expect(noBody._tag === "problem" && noBody.problem.message).toMatch(/lesson text/);
  });

  it("uses lesson.md for a single-language company lesson", () => {
    const parsed = parseLessonFolder(
      files({
        en: null,
        ro: null,
        any: "Cum facem aici.",
        lessonJson: JSON.stringify(manifest({ title: "Onboarding", summary: "Cum lucrăm." })),
      }),
      "company",
    );
    expect(parsed._tag).toBe("ok");
    if (parsed._tag === "ok") {
      expect(localized(parsed.lesson.body, "en")).toBe("Cum facem aici.");
      expect(localized(parsed.lesson.manifest.title, "ro")).toBe("Onboarding");
    }
  });
});

describe("validateLesson", () => {
  it("accepts the sample and rejects bad fields", () => {
    expect(validateLesson(manifest(), { en: "x" })).toEqual([]);
    expect(validateLesson(manifest({ id: "Bad Id" }), { en: "x" }).join(" ")).toMatch(/id/);
    expect(validateLesson(manifest({ minutes: 0 }), { en: "x" }).join(" ")).toMatch(/minutes/);
    expect(validateLesson(manifest({ tags: ["Not OK"] }), { en: "x" }).join(" ")).toMatch(/tag/);
    expect(validateLesson(manifest({ title: { en: " " } }), { en: "x" }).join(" ")).toMatch(
      /title/,
    );
  });

  it("checks Try it actions", () => {
    const audit = manifest({
      tryIt: { kind: "audit", command: "/security-audit", fallback: "" },
    });
    const problems = validateLesson(audit, { en: "x" }).join(" ");
    expect(problems).toMatch(/command name/);
    expect(problems).toMatch(/fallback/);
    const practice = manifest({ tryIt: { kind: "prompt", prompt: "Do it", exercise: true } });
    expect(validateLesson(practice, { en: "x" }).join(" ")).toMatch(/no exercise/);
    expect(validateLesson(practice, { en: "x" }, ["notes.md"])).toEqual([]);
  });
});

describe("editions and audit messages", () => {
  it("shows Office lessons in both editions and Code lessons only in Code", () => {
    expect(lessonEditions(manifest())).toEqual(["office", "code"]);
    expect(lessonVisibleIn(manifest({ track: "code" }), "office")).toBe(false);
    expect(lessonVisibleIn(manifest({ track: "code" }), "code")).toBe(true);
    expect(lessonVisibleIn(manifest({ editions: ["office"] }), "code")).toBe(false);
  });

  it("uses the slash command when installed, else the fallback prompt", () => {
    const tryIt = {
      kind: "audit" as const,
      command: "rls-audit",
      args: "Static review only.",
      fallback: { en: "Review the RLS policies.", ro: "Verifică politicile RLS." },
    };
    expect(auditMessage(tryIt, ["security-audit", "rls-audit"], "en")).toEqual({
      text: "/rls-audit Static review only.",
      usedCommand: true,
    });
    expect(auditMessage(tryIt, ["security-audit"], "ro")).toEqual({
      text: "Verifică politicile RLS.",
      usedCommand: false,
    });
  });
});

describe("practice files", () => {
  it("renames dot. and .sample files and refuses unsafe paths", () => {
    expect(practiceFileName("dot.env")).toBe(".env");
    expect(practiceFileName("src/app.ts.sample")).toBe("src/app.ts");
    expect(practiceFileName("dot.gitignore")).toBe(".gitignore");
    expect(practiceFileName("notes.md")).toBe("notes.md");
    expect(isSafeRelativePath("src/app.ts")).toBe(true);
    expect(isSafeRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("/abs")).toBe(false);
  });
});

it("mergeLessons lets a company lesson replace a built-in one and sorts by track and order", () => {
  const lesson = (
    id: string,
    track: "office" | "code",
    order: number,
    source: ZenLesson["source"],
  ): ZenLesson => ({
    manifest: manifest({ id, track, order }),
    body: { en: source },
    source,
    exerciseFiles: [],
  });
  const merged = mergeLessons([
    [
      lesson("code-a", "code", 10, "builtin"),
      lesson("office-b", "office", 20, "builtin"),
      lesson("office-a", "office", 10, "builtin"),
    ],
    [lesson("office-b", "office", 20, "company")],
  ]);
  expect(merged.map((item) => item.manifest.id)).toEqual(["office-a", "office-b", "code-a"]);
  expect(merged[1]!.source).toBe("company");
});

it.layer(NodeServices.layer)("lesson folders", (it) => {
  it.effect("every shipped lesson loads, in both languages, with a Try it", () =>
    Effect.gen(function* () {
      const { lessons, problems } = yield* loadLessonDir(BUILTIN_DIR, "builtin");
      expect(problems).toEqual([]);
      const office = lessons.filter((lesson) => lesson.manifest.track === "office");
      const code = lessons.filter((lesson) => lesson.manifest.track === "code");
      expect(office.length).toBeGreaterThanOrEqual(10);
      expect(code.length).toBeGreaterThanOrEqual(10);
      for (const lesson of lessons) {
        expect(lesson.body.en?.length ?? 0, lesson.manifest.id).toBeGreaterThan(500);
        expect(lesson.body.ro?.length ?? 0, lesson.manifest.id).toBeGreaterThan(500);
        expect(localized(lesson.manifest.title, "ro")).not.toBe(
          localized(lesson.manifest.title, "en"),
        );
        // Romanian uses comma-below letters, never the cedilla look-alikes.
        expect(
          `${lesson.body.ro}${JSON.stringify(lesson.manifest)}`,
          lesson.manifest.id,
        ).not.toMatch(/[şţŞŢ]/);
        expect(lesson.manifest.id.startsWith(`${lesson.manifest.track}-`)).toBe(true);
      }
      expect(
        code.filter((lesson) => lesson.manifest.tryIt?.kind === "audit").length,
      ).toBeGreaterThanOrEqual(6);
    }),
  );

  it.effect("copies practice files, renaming and keeping existing ones", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "zen-academy-" });
      const lesson = path.join(root, "lesson");
      yield* fs.makeDirectory(path.join(lesson, "exercise", "src"), { recursive: true });
      yield* fs.writeFileString(path.join(lesson, "exercise", "dot.env"), "KEY=1\n");
      yield* fs.writeFileString(path.join(lesson, "exercise", "src", "app.ts.sample"), "x\n");
      const target = path.join(root, "practice");
      const first = yield* copyExerciseFiles(
        lesson,
        ["dot.env", "src/app.ts.sample", "../escape"],
        target,
      );
      expect(first).toEqual([".env", "src/app.ts"]);
      yield* fs.writeFileString(path.join(target, ".env"), "KEY=changed\n");
      const second = yield* copyExerciseFiles(lesson, ["dot.env", "src/app.ts.sample"], target);
      expect(second).toEqual([]);
      expect(yield* fs.readFileString(path.join(target, ".env"))).toBe("KEY=changed\n");
    }).pipe(Effect.scoped),
  );
});
