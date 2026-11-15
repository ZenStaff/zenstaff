// @effect-diagnostics nodeBuiltinImport:off - checks the generated catalog module against the files on disk.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  collectCatalogAssets,
  hashWorkflowAssets,
} from "../../../../../scripts/lib/zen-workflow-assets.ts";
import { parseAdvisoryFile } from "./advisories.ts";
import { ZEN_TOOLCHAIN_CATALOG_ASSETS, ZEN_TOOLCHAIN_CATALOG_HASH } from "./catalogAssets.gen.ts";
import { materializeEmbeddedCatalog, resolveToolchainCatalogDir } from "./catalogAssets.ts";
import { parseCatalogEntry, parseConnectors } from "./catalog.ts";

const REGENERATE = "Run `vp run --filter @t3tools/scripts zen:workflows` and commit the result.";

it("catalogAssets.gen.ts matches catalog/", () => {
  const onDisk = collectCatalogAssets(`${import.meta.dirname}/catalog`);
  expect(Object.keys(ZEN_TOOLCHAIN_CATALOG_ASSETS).toSorted(), REGENERATE).toEqual(
    Object.keys(onDisk).toSorted(),
  );
  for (const [key, value] of Object.entries(onDisk)) {
    expect(ZEN_TOOLCHAIN_CATALOG_ASSETS[key], `${key} is out of date. ${REGENERATE}`).toBe(value);
  }
  expect(ZEN_TOOLCHAIN_CATALOG_HASH, REGENERATE).toBe(hashWorkflowAssets(onDisk));
});

it.layer(NodeServices.layer)("toolchain catalog at runtime", (it) => {
  it.effect("uses the source folder when running from source", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-catalog-src-" });
      expect(yield* resolveToolchainCatalogDir(baseDir)).toBe(`${import.meta.dirname}/catalog`);
    }),
  );

  it.effect("the embedded copy has every tool, connector, lockfile and the advisories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "zen-catalog-embedded-" });
      const dir = yield* materializeEmbeddedCatalog(root);
      expect(dir).toBe(path.join(root, ZEN_TOOLCHAIN_CATALOG_HASH));
      const tools = NodeFS.readdirSync(path.join(dir, "tools")).filter((name) =>
        name.endsWith(".json"),
      );
      expect(tools.length).toBeGreaterThanOrEqual(16);
      for (const name of tools) {
        const parsed = parseCatalogEntry(
          NodeFS.readFileSync(path.join(dir, "tools", name), "utf8"),
        );
        expect("entry" in parsed, name).toBe(true);
      }
      expect(
        parseConnectors(NodeFS.readFileSync(path.join(dir, "connectors.json"), "utf8")).length,
      ).toBeGreaterThan(0);
      expect(
        parseAdvisoryFile(NodeFS.readFileSync(path.join(dir, "advisories.json"), "utf8")),
      ).not.toBeNull();
      expect(
        NodeFS.existsSync(path.join(dir, "npm", "remotion-4.0.541", "package-lock.json")),
      ).toBe(true);
      expect(NodeFS.existsSync(path.join(dir, "pip", "faster-whisper-1.2.1.txt"))).toBe(true);
      // A second call reuses the finished copy.
      expect(yield* materializeEmbeddedCatalog(root)).toBe(dir);
    }),
  );
});
