import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import {
  collectWorkflowAssets,
  hashWorkflowAssets,
} from "../../../../../scripts/lib/zen-workflow-assets.ts";
import { ZEN_WORKFLOW_ASSETS, ZEN_WORKFLOW_ASSETS_HASH } from "./embeddedAssets.gen.ts";
import { materializeEmbeddedAssets, resolveWorkflowAssetsDir } from "./workflowAssets.ts";
import { loadWorkflowDir, packWorkflowIds, parseRegistry } from "./workflowStore.ts";

const REGENERATE = "Run `vp run --filter @t3tools/scripts zen:workflows` and commit the result.";

it("embeddedAssets.gen.ts matches builtin/, packs/ and registry.json", () => {
  const onDisk = collectWorkflowAssets(import.meta.dirname);
  expect(Object.keys(ZEN_WORKFLOW_ASSETS).toSorted(), REGENERATE).toEqual(
    Object.keys(onDisk).toSorted(),
  );
  for (const [key, value] of Object.entries(onDisk)) {
    expect(ZEN_WORKFLOW_ASSETS[key], `${key} is out of date. ${REGENERATE}`).toBe(value);
  }
  expect(ZEN_WORKFLOW_ASSETS_HASH, REGENERATE).toBe(hashWorkflowAssets(onDisk));
});

it.layer(NodeServices.layer)("workflow assets at runtime", (it) => {
  it.effect("uses the source folder when running from source", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-assets-src-" });
      expect(yield* resolveWorkflowAssetsDir(baseDir)).toBe(import.meta.dirname);
    }),
  );

  it.effect("writes the embedded copy once and every workflow loads from it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "zen-assets-embedded-" });
      yield* fs.makeDirectory(path.join(root, "old-version"));
      const dir = yield* materializeEmbeddedAssets(root);
      expect(dir).toBe(path.join(root, ZEN_WORKFLOW_ASSETS_HASH));
      expect(yield* fs.exists(path.join(root, "old-version"))).toBe(false);
      const builtin = yield* loadWorkflowDir(path.join(dir, "builtin"), "builtin");
      expect(builtin.problems).toEqual([]);
      expect(builtin.workflows).toHaveLength(7);
      const registry = parseRegistry(yield* fs.readFileString(path.join(dir, "registry.json")));
      if ("error" in registry) throw new Error(registry.error);
      const packEntries = registry.entries.filter((entry) => entry.kind === "pack");
      const ids: string[] = [];
      for (const entry of packEntries) {
        // A pack of several workflows has one sub-folder per workflow.
        const folder = entry.workflows
          ? path.join(dir, "packs", entry.id)
          : path.join(dir, "packs");
        const loaded = yield* loadWorkflowDir(folder, "user");
        ids.push(
          ...loaded.workflows
            .map((item) => item.manifest.id)
            .filter((id) => packWorkflowIds(entry).includes(id)),
        );
      }
      expect(ids.toSorted()).toEqual(packEntries.flatMap(packWorkflowIds).toSorted());
      // A second call reuses the folder.
      yield* fs.writeFileString(path.join(dir, "marker.txt"), "kept");
      expect(yield* materializeEmbeddedAssets(root)).toBe(dir);
      expect(yield* fs.exists(path.join(dir, "marker.txt"))).toBe(true);
    }),
  );

  // 0.2.4 on Windows: Office, Toolchains and Connectors all wrote the new copy at the same first
  // start; one rename failed with EPERM and Zen Office kept a missing folder until a restart.
  it.effect("parallel first starts all get the same complete folder", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "zen-assets-race-" });
      const dirs = yield* Effect.all(
        Array.from({ length: 6 }, () => materializeEmbeddedAssets(root)),
        { concurrency: "unbounded" },
      );
      const target = path.join(root, ZEN_WORKFLOW_ASSETS_HASH);
      expect(dirs).toEqual(Array.from({ length: 6 }, () => target));
      expect(yield* fs.exists(path.join(target, "registry.json"))).toBe(true);
      expect(yield* fs.exists(path.join(target, ".complete"))).toBe(true);
      expect((yield* fs.readDirectory(root)).filter((name) => name.startsWith("."))).toEqual([]);
    }),
  );

  it.effect("parallel first starts work when folders cannot be replaced, as on Windows", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "zen-assets-eperm-" });
      const target = path.join(root, ZEN_WORKFLOW_ASSETS_HASH);
      const refused = (pathOrDescriptor: string) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "rename",
            pathOrDescriptor,
          }),
        );
      // Windows: a folder with a file still open (antivirus, indexer, another reader) is only
      // partly removed, and a rename onto an existing folder is refused.
      const windowsLike = FileSystem.FileSystem.of({
        ...fs,
        remove: (target, options) =>
          path.basename(target) === ZEN_WORKFLOW_ASSETS_HASH
            ? fs
                .remove(path.join(target, ".complete"))
                .pipe(Effect.ignore, Effect.andThen(refused(target)))
            : fs.remove(target, options),
        rename: (from, to) =>
          fs
            .exists(to)
            .pipe(Effect.flatMap((exists) => (exists ? refused(from) : fs.rename(from, to)))),
      });
      const dirs = yield* Effect.all(
        Array.from({ length: 4 }, () => materializeEmbeddedAssets(root)),
        { concurrency: "unbounded" },
      ).pipe(Effect.provideService(FileSystem.FileSystem, windowsLike));
      expect(dirs).toEqual(Array.from({ length: 4 }, () => target));
      expect(yield* fs.exists(path.join(target, ".complete"))).toBe(true);
      expect(yield* fs.exists(path.join(target, "registry.json"))).toBe(true);
    }),
  );
});
