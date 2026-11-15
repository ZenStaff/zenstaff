// Zen Staff: where the tool catalog lives at runtime. From source: ./catalog next to this module.
// Packaged builds (server bundle, SEA, desktop) have no such folder, so catalogAssets.gen.ts is
// written once to `<zen home>/caches/zen-toolchain-catalog/<hash>/`, like the Office workflows.
// ZEN.md, "Toolchains for workflows".
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { materializeEmbeddedAssets } from "../workflows/workflowAssets.ts";
import { ZEN_TOOLCHAIN_CATALOG_ASSETS, ZEN_TOOLCHAIN_CATALOG_HASH } from "./catalogAssets.gen.ts";

/** Writes the embedded catalog into `<cacheRoot>/<hash>/` (once) and returns that folder. */
export const materializeEmbeddedCatalog = (cacheRoot: string) =>
  materializeEmbeddedAssets(cacheRoot, ZEN_TOOLCHAIN_CATALOG_ASSETS, ZEN_TOOLCHAIN_CATALOG_HASH);

/**
 * The folder holding tools/, connectors.json, advisories.json, npm/ and pip/: ./catalog when it
 * exists (running from source), else the embedded copy under `<baseDir>/caches`.
 */
export const resolveToolchainCatalogDir = Effect.fn("ZenToolchains.resolveCatalog")(function* (
  baseDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const here: unknown = import.meta.dirname;
  if (typeof here === "string" && here.length > 0) {
    const source = path.join(here, "catalog");
    if (yield* fs.exists(path.join(source, "tools", "ffmpeg.json"))) return source;
  }
  return yield* materializeEmbeddedCatalog(path.join(baseDir, "caches", "zen-toolchain-catalog"));
});
