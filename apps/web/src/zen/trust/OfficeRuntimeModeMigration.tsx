// Zen Staff: moves an Office install whose saved default mode is full access to "auto" once, with
// a one-line notice. Mounted by ZenEditionRoot; Code is never touched. Waits for the server's own
// settings, so a default the person chose is never overwritten by the placeholder.
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { toastManager } from "../../components/ui/toast";
import { useUpdatePrimarySettings } from "../../hooks/useSettings";
import { primaryServerConfigAtom } from "../../state/server";
import { zenText } from "../i18n/zenI18n";
import { useZenEdition } from "../office/useZenEdition";
import { trustText } from "./trust.i18n";
import { OFFICE_RUNTIME_MIGRATION_KEY, officeRuntimeModeMigration } from "./trustModel";

function readMigrated(): boolean {
  try {
    return window.localStorage.getItem(OFFICE_RUNTIME_MIGRATION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMigrated() {
  try {
    window.localStorage.setItem(OFFICE_RUNTIME_MIGRATION_KEY, "1");
  } catch {
    // Private windows: the migration runs again next time, which only re-checks the default.
  }
}

export function OfficeRuntimeModeMigration() {
  const edition = useZenEdition();
  const config = useAtomValue(primaryServerConfigAtom);
  const defaultRuntimeMode = config?.settings.defaultRuntimeMode ?? null;
  const updateSettings = useUpdatePrimarySettings();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- one-time write of the server's default mode once its real settings have loaded in Office
  useEffect(() => {
    if (defaultRuntimeMode === null || edition !== "office") return;
    const migrated = readMigrated();
    const next = officeRuntimeModeMigration({ edition, migrated, defaultRuntimeMode });
    if (!migrated) writeMigrated();
    if (next === null) return;
    updateSettings({ defaultRuntimeMode: next });
    const t = zenText(trustText);
    toastManager.add({ type: "info", title: t.migratedTitle, description: t.migratedBody });
  }, [edition, defaultRuntimeMode, updateSettings]);
  return null;
}
