// @effect-diagnostics nodeBuiltinImport:off -- Test support: reads an optional private list synchronously, outside any Effect runtime.
// Names that shipped workflows, packs and lessons must never contain: our real clients and our own
// companies. The list is private (zen-names.private.txt next to this file, one regular expression
// per line); it is not part of the public repository, where only the generic checks run.
import * as NodeFS from "node:fs";

/** One case-insensitive pattern for every private name, or a pattern that matches nothing. */
export function privateNamesPattern(): RegExp {
  const file = new URL("./zen-names.private.txt", import.meta.url);
  if (!NodeFS.existsSync(file)) return /(?!)/;
  const lines = NodeFS.readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return lines.length === 0 ? /(?!)/ : new RegExp(lines.join("|"), "i");
}
