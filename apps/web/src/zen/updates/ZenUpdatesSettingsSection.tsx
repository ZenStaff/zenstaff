// Zen Staff: Settings > General > Updates. Our feed's channel (Stable/Beta), "Check now", the
// current version, the last check, and on deb/rpm a link to the new package. Upstream's
// latest/nightly "Update track" row is hidden in the desktop app (SettingsPanels.tsx).
import type { DesktopUpdateState } from "@t3tools/contracts";
import type { ZenReleaseChannel } from "@t3tools/contracts/zenReleases";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { toastManager } from "../../components/ui/toast";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { updatesText } from "./updates.i18n";
import { zenChannelLabel, zenLastCheckLine, zenUpdateStatusLine } from "./zenUpdates";

/** The desktop app shows our Updates section instead of upstream's update track row. */
export const ZEN_OWNS_DESKTOP_UPDATE_SETTINGS = true;

export function ZenUpdatesSettingsSection() {
  const state = useDesktopUpdateState();
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  if (!bridge || !state?.zen) return null;
  return <UpdatesSection state={state} />;
}

function UpdatesSection({ state }: { readonly state: DesktopUpdateState }) {
  const t = useZenText(updatesText);
  const locale = useZenLocale();
  const [busy, setBusy] = useState(false);
  const zen = state.zen!;
  const bridge = window.desktopBridge!;
  const canCheck =
    state.enabled &&
    state.status !== "disabled" &&
    state.status !== "checking" &&
    state.status !== "downloading";
  const manualUrl =
    zen.mode === "manual" && state.status === "available" ? zen.manualDownloadUrl : null;

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: failure,
        description: error instanceof Error ? error.message : undefined,
      });
    }
    // No `finally`: React Compiler does not lower try/finally (reactCompilerCoverage.test.ts);
    // the catch above swallows every error, so this line always runs.
    setBusy(false);
  };

  return (
    <SettingsSection id="zen-updates" title={t.section}>
      <SettingsRow
        title={t.versionTitle}
        description={`${zenUpdateStatusLine(state, t)} ${zenLastCheckLine(state, t, locale)}`}
        status={<span className="font-mono text-xs">{state.currentVersion}</span>}
        control={
          manualUrl ? (
            <Button size="sm" variant="outline" onClick={() => void bridge.openExternal(manualUrl)}>
              {t.downloadNew}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={!canCheck || busy}
              onClick={() => void run(() => bridge.checkForUpdate(), t.couldNotCheck)}
            >
              {state.status === "checking" ? t.checking : t.checkNow}
            </Button>
          )
        }
      />
      <SettingsRow
        title={t.channelTitle}
        description={zen.channelPinned ? t.channelPinned : t.channelDescription}
        control={
          <Select
            value={zen.channel}
            onValueChange={(value) => {
              const next = value as ZenReleaseChannel;
              if (next === zen.channel || !bridge.setZenUpdateChannel) return;
              void run(() => bridge.setZenUpdateChannel!(next), t.couldNotSwitch);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-40"
              aria-label={t.channelTitle}
              disabled={zen.channelPinned || busy || !bridge.setZenUpdateChannel}
            >
              <SelectValue>{zenChannelLabel(t, zen.channel)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="stable">
                {t.stable}
              </SelectItem>
              <SelectItem hideIndicator value="beta">
                {t.beta}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
