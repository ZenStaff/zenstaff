#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - One-off codegen script.
// Zen Staff: embeds the built-in Academy lessons into
// apps/server/src/zen/academy/embeddedLessons.gen.ts so packaged builds carry them, whatever the
// installer does with loose files (run: vp run --filter @t3tools/scripts zen:academy). A server
// test fails when it is stale. ZEN.md, "Academy".
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { collectAcademyAssets, renderEmbeddedLessonsModule } from "./lib/zen-academy-assets.ts";

const dir = NodePath.join(import.meta.dirname, "..", "apps", "server", "src", "zen", "academy");
const files = collectAcademyAssets(dir);
const target = NodePath.join(dir, "embeddedLessons.gen.ts");
NodeFS.writeFileSync(target, renderEmbeddedLessonsModule(files));
NodeChildProcess.execSync(`vp fmt ${JSON.stringify(target)}`, {
  cwd: NodePath.join(import.meta.dirname, ".."),
  stdio: "ignore",
});
console.log(`Embedded ${Object.keys(files).length} lesson files into ${target}`);
