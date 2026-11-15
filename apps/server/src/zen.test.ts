import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as T3ProjectFileLoader from "./project/T3ProjectFileLoader.ts";
import { preferZenProjectFile } from "./zen.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(T3ProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const setup = Effect.fn("setup")(function* (files: Record<string, string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-project-file-" });
  for (const [name, contents] of Object.entries(files)) {
    yield* fileSystem.writeFileString(path.join(cwd, name), contents).pipe(Effect.orDie);
  }
  return { cwd, fileSystem, path };
});

it.layer(layerTest)("Zen project file", (it) => {
  describe("T3ProjectFileLoader", () => {
    it.effect("reads zen.json before t3.json", () =>
      Effect.gen(function* () {
        const { cwd } = yield* setup({
          "zen.json": JSON.stringify({ iconPath: "zen.svg" }),
          "t3.json": JSON.stringify({ iconPath: "t3.svg" }),
        });
        const loaded = yield* (yield* T3ProjectFileLoader.T3ProjectFileLoader).load(cwd);
        expect(Option.getOrUndefined(loaded)?.iconPath).toBe("zen.svg");
      }),
    );

    it.effect("falls back to t3.json without zen.json", () =>
      Effect.gen(function* () {
        const { cwd } = yield* setup({ "t3.json": JSON.stringify({ iconPath: "t3.svg" }) });
        const loaded = yield* (yield* T3ProjectFileLoader.T3ProjectFileLoader).load(cwd);
        expect(Option.getOrUndefined(loaded)?.iconPath).toBe("t3.svg");
      }),
    );
  });

  describe("preferZenProjectFile", () => {
    it.effect("redirects client t3.json requests only when zen.json exists", () =>
      Effect.gen(function* () {
        const withZen = yield* setup({ "zen.json": "{}" });
        const withoutZen = yield* setup({});
        const redirected = yield* preferZenProjectFile(withZen.fileSystem, withZen.path, {
          cwd: withZen.cwd,
          relativePath: "t3.json",
        });
        const kept = yield* preferZenProjectFile(withoutZen.fileSystem, withoutZen.path, {
          cwd: withoutZen.cwd,
          relativePath: "t3.json",
        });
        const other = yield* preferZenProjectFile(withZen.fileSystem, withZen.path, {
          cwd: withZen.cwd,
          relativePath: "package.json",
        });
        expect([redirected.relativePath, kept.relativePath, other.relativePath]).toEqual([
          "zen.json",
          "t3.json",
          "package.json",
        ]);
      }),
    );
  });
});
