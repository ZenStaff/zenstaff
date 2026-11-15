// Zen Staff: the trust model's rules, pure. Office runs the runtime "auto" mode by default (safe
// actions alone, risky ones checked), never full access; the plain picker shows two choices and the
// rest under "Avansat". An Office install whose saved default is full access moves to "auto" once.
import type { RuntimeMode } from "@t3tools/contracts";

/** The default runtime mode of the Office edition. */
export const OFFICE_DEFAULT_RUNTIME_MODE: RuntimeMode = "auto";

/** The two choices the Office picker shows first, in order. */
export const OFFICE_PLAIN_RUNTIME_MODES: ReadonlyArray<RuntimeMode> = ["auto", "approval-required"];

/** Under "Avansat": never a default, full access last. */
export const OFFICE_ADVANCED_RUNTIME_MODES: ReadonlyArray<RuntimeMode> = [
  "auto-accept-edits",
  "full-access",
];

/** localStorage key: set once the Office default moved off full access on this device. */
export const OFFICE_RUNTIME_MIGRATION_KEY = "zen:office:runtime-mode-migrated";

/**
 * What the one-time Office migration does with the saved default: `null` when nothing changes
 * (already migrated, Code, or the default is not full access), else the new default.
 */
export function officeRuntimeModeMigration(input: {
  readonly edition: "office" | "code";
  readonly migrated: boolean;
  readonly defaultRuntimeMode: RuntimeMode;
}): RuntimeMode | null {
  if (input.edition !== "office" || input.migrated) return null;
  return input.defaultRuntimeMode === "full-access" ? OFFICE_DEFAULT_RUNTIME_MODE : null;
}
