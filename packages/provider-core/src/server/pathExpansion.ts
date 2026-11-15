// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { zenTypedPath } from "@t3tools/contracts/zen";

// Spawned processes lack shell expansion and would treat literal ~/ paths as relative.
export function expandHomePath(input: string, home: string): string {
  // Zen: `~//srv/x` and `~/~/x` (a path typed after the dialog's `~/`) mean `/srv/x`, `~/x`.
  const value = zenTypedPath(input);
  if (!value) return value;
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return NodePath.join(home, value.slice(2));
  }
  return value;
}

const HOME_PATH_VARIABLES = new Set(["CODEX_HOME", "CLAUDE_CONFIG_DIR", "GROK_HOME"]);

export function expandHomeVariable(name: string, value: string, home: string): string {
  return HOME_PATH_VARIABLES.has(name) ? expandHomePath(value, home) : value;
}
