import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  collectAcademyAssets,
  hashAcademyAssets,
} from "../../../../../scripts/lib/zen-academy-assets.ts";
import * as ServerConfig from "../../config.ts";
import { ZEN_ACADEMY_LESSON_ASSETS, ZEN_ACADEMY_LESSONS_HASH } from "./embeddedLessons.gen.ts";
import { loadLessonDir } from "./lessonStore.ts";
import * as ZenAcademy from "./ZenAcademy.ts";

const REGENERATE = "Run `vp run --filter @t3tools/scripts zen:academy` and commit the result.";

it("embeddedLessons.gen.ts matches lessons/", () => {
  const onDisk = collectAcademyAssets(import.meta.dirname);
  expect(Object.keys(ZEN_ACADEMY_LESSON_ASSETS).toSorted(), REGENERATE).toEqual(
    Object.keys(onDisk).toSorted(),
  );
  for (const [key, value] of Object.entries(onDisk)) {
    expect(ZEN_ACADEMY_LESSON_ASSETS[key], `${key} is out of date. ${REGENERATE}`).toBe(value);
  }
  expect(ZEN_ACADEMY_LESSONS_HASH, REGENERATE).toBe(hashAcademyAssets(onDisk));
});

it.layer(NodeServices.layer)("ZenAcademy", (it) => {
  it.effect("lists built-in lessons, adds company lessons and prepares practice folders", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-academy-home-" });
      const academy = yield* ZenAcademy.make().pipe(
        Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)),
      );

      const builtin = yield* academy.list({});
      expect(builtin.problems).toEqual([]);
      expect(builtin.lessons.every((lesson) => lesson.source === "builtin")).toBe(true);
      const count = builtin.lessons.length;
      expect(count).toBeGreaterThanOrEqual(20);

      // A company "how we do X here" lesson and one that replaces a built-in lesson.
      const companyDir = path.join(baseDir, "companies", "acme", "academy");
      const own = path.join(companyDir, "office-acme-invoices");
      yield* fs.makeDirectory(path.join(own, "exercise"), { recursive: true });
      yield* fs.writeFileString(
        path.join(own, "lesson.json"),
        JSON.stringify({
          id: "office-acme-invoices",
          track: "office",
          title: "Cum emitem facturi la Acme",
          summary: "Pașii noștri.",
          minutes: 3,
          level: "beginner",
          tags: ["invoices"],
          tryIt: { kind: "prompt", prompt: "Citește nota și rezumă pașii.", exercise: true },
        }),
      );
      yield* fs.writeFileString(
        path.join(own, "lesson.md"),
        "## Pași\n\nFacturile se emit vinerea.",
      );
      yield* fs.writeFileString(path.join(own, "exercise", "nota.md"), "Factura 12\n");
      const broken = path.join(companyDir, "broken");
      yield* fs.makeDirectory(broken, { recursive: true });
      yield* fs.writeFileString(path.join(broken, "lesson.json"), "{");

      const withCompany = yield* academy.list({ companyId: "acme" });
      expect(withCompany.lessons).toHaveLength(count + 1);
      expect(
        withCompany.lessons.find((lesson) => lesson.manifest.id === "office-acme-invoices")?.source,
      ).toBe("company");
      expect(withCompany.problems.map((problem) => problem.location)).toEqual(["company: broken"]);
      // Another company does not see Acme's lessons; bad ids never reach the disk.
      expect((yield* academy.list({ companyId: "other" })).lessons).toHaveLength(count);
      expect((yield* academy.list({ companyId: "../etc" })).lessons).toHaveLength(count);

      const prepared = yield* academy.prepareExercise({
        lessonId: "office-acme-invoices",
        companyId: "acme",
      });
      expect(prepared.path).toBe(
        path.join(baseDir, "academy", "practice", "acme--office-acme-invoices"),
      );
      expect(prepared.created).toEqual(["nota.md"]);

      const secrets = yield* academy.prepareExercise({ lessonId: "code-secrets" });
      expect(secrets.created).toContain(".env");
      expect(yield* fs.exists(path.join(secrets.path, ".env"))).toBe(true);

      const missing = yield* academy.prepareExercise({ lessonId: "nope" }).pipe(Effect.flip);
      expect(missing.reason).toBe("not-found");
    }).pipe(Effect.scoped),
  );

  it.effect("finds the packaged lessons folder next to the bundle", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const candidates = ZenAcademy.builtinLessonCandidates(path, "/app/dist", "/opt/zen/t3");
      expect(candidates).toEqual([
        "/app/dist/lessons",
        "/app/dist/zen-academy/lessons",
        "/opt/zen/zen-academy/lessons",
      ]);
    }),
  );

  it.effect("packaged builds fall back to the embedded lessons when no folder can be read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-academy-packaged-" });
      // Windows server.asar: the folder is there but its lessons cannot be read.
      const visibleButEmpty = path.join(baseDir, "server.asar", "dist", "zen-academy", "lessons");
      yield* fs.makeDirectory(path.join(visibleButEmpty, "office-first-steps"), {
        recursive: true,
      });
      const candidates = [
        path.join(baseDir, "missing", "lessons"),
        visibleButEmpty,
        path.join(baseDir, "next-to-exe", "zen-academy", "lessons"),
      ];
      const cacheRoot = path.join(baseDir, "caches", "zen-academy");
      const dir = yield* ZenAcademy.resolveBuiltinLessonsDir(candidates, cacheRoot);
      expect(dir).toBe(path.join(cacheRoot, ZEN_ACADEMY_LESSONS_HASH, "lessons"));
      const loaded = yield* loadLessonDir(dir, "builtin");
      expect(loaded.problems).toEqual([]);
      expect(loaded.lessons.length).toBeGreaterThanOrEqual(20);
      // Written once; a second start reuses the copy.
      expect(yield* ZenAcademy.resolveBuiltinLessonsDir(candidates, cacheRoot)).toBe(dir);

      // A readable folder (source checkout, Linux/macOS app.asar) still wins.
      expect(
        yield* ZenAcademy.resolveBuiltinLessonsDir(
          [path.join(import.meta.dirname, "lessons")],
          cacheRoot,
        ),
      ).toBe(path.join(import.meta.dirname, "lessons"));
    }).pipe(Effect.scoped),
  );

  it.effect("reports a problem instead of an empty Academy when no lesson loads", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-academy-empty-" });
      const emptyDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-academy-nolessons-" });
      const academy = yield* ZenAcademy.make({ builtinDir: emptyDir }).pipe(
        Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)),
      );
      const list = yield* academy.list({});
      expect(list.lessons).toEqual([]);
      expect(list.problems).toEqual([
        { location: "builtin", message: ZenAcademy.BUILTIN_MISSING_MESSAGE },
      ]);
    }).pipe(Effect.scoped),
  );
});
