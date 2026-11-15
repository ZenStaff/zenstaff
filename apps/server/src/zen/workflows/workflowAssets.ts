// Zen Staff: the shipped Office workflows at runtime. From source: the folder next to this module.
// Packaged builds (bundle, SEA, desktop) have no such folder, so embeddedAssets.gen.ts is written
// once to `<zen home>/caches/zen-workflows/<hash>/` and read from there. ZEN.md, "Office edition".
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import { ZEN_WORKFLOW_ASSETS, ZEN_WORKFLOW_ASSETS_HASH } from "./embeddedAssets.gen.ts";

const COMPLETE_MARKER = ".complete";

/** The folder next to this module when running from source, else undefined. */
const sourceDir = (): string | undefined => {
  const dir: unknown = import.meta.dirname;
  return typeof dir === "string" && dir.length > 0 ? dir : undefined;
};

/**
 * One copy at a time in this process: Office, Toolchains and Connectors all resolve the folder at
 * the same first start after an update. In 0.2.4 they raced; on Windows one call removed another's
 * finished copy and its rename was refused (EPERM), so Zen Office had no library until a restart.
 */
const materializeLock = Semaphore.makeUnsafe(1);

/** Writes the embedded files into `<cacheRoot>/<hash>/` (once) and returns that folder. */
export const materializeEmbeddedAssets = Effect.fn("ZenWorkflowAssets.materialize")(function* (
  cacheRoot: string,
  files: Readonly<Record<string, string>> = ZEN_WORKFLOW_ASSETS,
  hash: string = ZEN_WORKFLOW_ASSETS_HASH,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(cacheRoot, hash);
  const marker = path.join(target, COMPLETE_MARKER);
  const complete = fs.exists(marker).pipe(Effect.orElseSucceed(() => false));
  if (yield* complete) return target;
  return yield* materializeLock.withPermits(1)(
    Effect.gen(function* () {
      if (yield* complete) return target;
      yield* fs.makeDirectory(cacheRoot, { recursive: true });
      // Write into a fresh folder, then rename, so a crash never leaves a half-written copy in use.
      const staging = yield* fs.makeTempDirectory({ directory: cacheRoot, prefix: `.${hash}-` });
      for (const [relative, content] of Object.entries(files)) {
        const file = path.join(staging, ...relative.split("/"));
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, content);
      }
      yield* fs.writeFileString(path.join(staging, COMPLETE_MARKER), `${hash}\n`);
      // Another process (a second window, the CLI) may have finished meanwhile: never remove a
      // complete copy, only a half-written one.
      if (!(yield* complete)) {
        yield* fs.remove(target, { recursive: true }).pipe(Effect.ignore);
      }
      const moved = yield* fs.rename(staging, target).pipe(Effect.result);
      if (moved._tag === "Failure") {
        yield* fs.remove(staging, { recursive: true }).pipe(Effect.ignore);
        // Another process won the race: use its copy once complete (Windows can be slow here).
        let ready = yield* complete;
        for (let attempt = 0; !ready && attempt < 20; attempt++) {
          yield* Effect.sleep("100 millis");
          ready = yield* complete;
        }
        if (!ready) return yield* moved.failure;
      }
      // Copies from older app versions are no longer read.
      const names = yield* fs.readDirectory(cacheRoot).pipe(Effect.orElseSucceed(() => []));
      for (const name of names) {
        if (name !== hash && !name.startsWith(".")) {
          yield* fs.remove(path.join(cacheRoot, name), { recursive: true }).pipe(Effect.ignore);
        }
      }
      return target;
    }),
  );
});

/**
 * The folder holding builtin/, packs/ and registry.json: next to this module when it has a
 * registry.json (running from source), else the embedded copy under `<baseDir>/caches`.
 */
export const resolveWorkflowAssetsDir = Effect.fn("ZenWorkflowAssets.resolve")(function* (
  baseDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const here = sourceDir();
  if (here !== undefined) {
    const hasRegistry = yield* fs.exists(path.join(here, "registry.json"));
    const hasBuiltin = yield* fs.exists(path.join(here, "builtin"));
    if (hasRegistry && hasBuiltin) return here;
  }
  return yield* materializeEmbeddedAssets(path.join(baseDir, "caches", "zen-workflows"));
});
