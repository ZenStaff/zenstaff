#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - One-off codegen script.
// Zen Staff: embeds the Office built-in workflows, packs and registry.json into
// apps/server/src/zen/workflows/embeddedAssets.gen.ts so packaged builds carry them
// and the toolchain catalog into toolchains/catalogAssets.gen.ts
// (run: vp run --filter @t3tools/scripts zen:workflows). A server test fails when it is stale.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  collectCatalogAssets,
  collectWorkflowAssets,
  renderEmbeddedAssetsModule,
  renderEmbeddedCatalogModule,
} from "./lib/zen-workflow-assets.ts";
import { syncPremiumKit } from "./lib/zen-premium-kit.ts";

const dir = NodePath.join(import.meta.dirname, "..", "apps", "server", "src", "zen", "workflows");
// The video and design packs carry a copy of the premium kit; refresh the copies first.
const synced = syncPremiumKit(dir);
const files = collectWorkflowAssets(dir);
const target = NodePath.join(dir, "embeddedAssets.gen.ts");
NodeFS.writeFileSync(target, renderEmbeddedAssetsModule(files));
// The repo formatter picks quote styles; run it so the committed file is already formatted.
// `vp` is on PATH when this runs as the package script; the shell finds vp.cmd on Windows.
NodeChildProcess.execSync(`vp fmt ${JSON.stringify(target)}`, {
  cwd: NodePath.join(import.meta.dirname, ".."),
  stdio: "ignore",
});
console.log(`Premium kit copied into ${synced.length} packs`);
console.log(`Embedded ${Object.keys(files).length} workflow files into ${target}`);

// The toolchain catalog (tools, lockfiles, hashed requirements, shipped advisories) as well.
const catalogDir = NodePath.join(dir, "..", "toolchains", "catalog");
const catalogFiles = collectCatalogAssets(catalogDir);
const catalogTarget = NodePath.join(dir, "..", "toolchains", "catalogAssets.gen.ts");
NodeFS.writeFileSync(catalogTarget, renderEmbeddedCatalogModule(catalogFiles));
NodeChildProcess.execSync(`vp fmt ${JSON.stringify(catalogTarget)}`, {
  cwd: NodePath.join(import.meta.dirname, ".."),
  stdio: "ignore",
});
console.log(`Embedded ${Object.keys(catalogFiles).length} catalog files into ${catalogTarget}`);
