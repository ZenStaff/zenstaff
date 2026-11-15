// Zen Staff Academy: sidebar footer button, command palette entry and the Settings toggle
// "Help improve the Academy". Registered through ZenEntryPoints.tsx.
import type { useNavigate } from "@tanstack/react-router";
import { GraduationCapIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import {
  clearAcademySignals,
  collectAcademySignals,
  setHelpImproveAcademy,
  useAcademySignals,
} from "./signals";
import { academyStrings, useAcademyStrings } from "./academy.i18n";

export function academyCommandPaletteItem(
  navigate: ReturnType<typeof useNavigate>,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:zen-academy",
    searchTerms: [
      "academy",
      "academie",
      "learn",
      "lessons",
      "lectii",
      "training",
      "security",
      "tips",
    ],
    title: academyStrings().paletteOpen,
    icon: <GraduationCapIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/academy", search: {} });
    },
  };
}

/** Settings > General: "Help improve the Academy" (off by default). */
export function ZenAcademySettingsSection() {
  const strings = useAcademyStrings();
  const { optedIn, signals } = useAcademySignals();
  const topics = Object.keys(signals.topics).length;
  const searches = Object.keys(signals.noResultSearches).length;
  const sum = (counts: Readonly<Record<string, number>>) =>
    Object.values(counts).reduce((total, count) => total + count, 0);
  const failed = sum(signals.failedTasks);
  const corrected = sum(signals.correctedTasks);
  return (
    <SettingsSection id="zen-academy" title={strings.settingsTitle}>
      <SettingsRow
        title={strings.helpImproveTitle}
        description={strings.helpImproveDescription}
        status={
          optedIn ? (
            <span className="flex items-center gap-2">
              {strings.helpImproveCounted(topics, searches)}
              {failed + corrected > 0 ? ` ${strings.helpImproveOutcomes(failed, corrected)}` : null}
              {topics + searches + failed + corrected > 0 ? (
                <Button size="micro" variant="ghost" onClick={clearAcademySignals}>
                  {strings.clearSignals}
                </Button>
              ) : null}
            </span>
          ) : undefined
        }
        control={
          <Switch
            checked={optedIn}
            onCheckedChange={(checked) => setHelpImproveAcademy(Boolean(checked))}
            aria-label={strings.helpImproveTitle}
          />
        }
      >
        {optedIn ? (
          <details className="px-4 pb-3 text-muted-foreground text-xs sm:px-5">
            <summary className="cursor-pointer">{strings.signalsPreview}</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 font-mono">
              {JSON.stringify(collectAcademySignals(), null, 2)}
            </pre>
          </details>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}
