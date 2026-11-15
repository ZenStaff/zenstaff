// Zen Staff: what the app shows about our own updates (desktop state `zen`, zenReleases.ts).
// Hooks into upstream: the sidebar update button's idle tooltip (desktopUpdate.logic.ts) and its
// download action (SidebarUpdatePill.tsx), which opens the package link on deb/rpm installs.
import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";

import { formatZenRelativeTime } from "../i18n/relativeTime";
import { getZenLocale, zenMessagesFor, type ZenLocale } from "../i18n/zenI18n";
import { updatesText } from "./updates.i18n";

type Text = (typeof updatesText)["en"];

export function zenChannelLabel(t: Text, channel: "stable" | "beta"): string {
  return channel === "beta" ? t.beta : t.stable;
}

/** One line on where updates stand, for Settings > Updates. */
export function zenUpdateStatusLine(state: DesktopUpdateState, t: Text): string {
  const zen = state.zen;
  if (!state.enabled || state.status === "disabled") return state.message?.trim() || t.off;
  const version = state.downloadedVersion ?? state.availableVersion ?? "";
  if (zen?.mode === "manual" && state.status === "available") return t.manual(version);
  switch (state.status) {
    case "checking":
      return t.checking;
    case "available":
      return t.available(version);
    case "downloading":
      return t.downloading(version, state.downloadPercent);
    case "downloaded":
      return t.downloaded(version);
    case "error":
      return state.downloadedVersion ? t.downloaded(state.downloadedVersion) : t.failed;
    default:
      return t.upToDate;
  }
}

export function zenLastCheckLine(state: DesktopUpdateState, t: Text, locale: ZenLocale): string {
  return state.checkedAt
    ? t.lastCheck(formatZenRelativeTime(locale, state.checkedAt))
    : t.neverChecked;
}

/**
 * The sidebar update button's tooltip when nothing is pending: the real state (version, channel,
 * last check) instead of upstream's "Updates unavailable". Null leaves upstream's tooltip.
 */
export function zenUpdateIdleTooltip(
  state: Pick<
    DesktopUpdateState,
    "enabled" | "status" | "message" | "currentVersion" | "checkedAt" | "zen"
  > | null,
  locale: ZenLocale = getZenLocale(),
): { title: string; detail: string | null } | null {
  if (!state?.zen || !state.enabled || state.status === "disabled") return null;
  const t = zenMessagesFor(updatesText, locale);
  const when = state.checkedAt ? formatZenRelativeTime(locale, state.checkedAt) : null;
  const title = state.status === "error" ? t.failed : state.checkedAt ? t.upToDate : t.idleTitle;
  return {
    title,
    detail: t.idleDetail(state.currentVersion, zenChannelLabel(t, state.zen.channel), when),
  };
}

/** deb/rpm installs: open the new package's download instead of downloading in place. */
export async function openZenManualDownload(
  bridge: Pick<DesktopBridge, "getUpdateState" | "openExternal">,
): Promise<boolean> {
  try {
    const state = await bridge.getUpdateState();
    const url = state.zen?.mode === "manual" ? state.zen.manualDownloadUrl : null;
    if (!url) return false;
    await bridge.openExternal(url);
    return true;
  } catch {
    return false;
  }
}

const DISMISSED_KEY = "zen:update-prompt-dismissed";

export function readDismissedUpdateVersion(): string | null {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeDismissedUpdateVersion(version: string): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, version);
  } catch {}
}

/** The prompt shows once per downloaded version, until the user picks an option. */
export function zenPromptVersion(
  state: DesktopUpdateState | null,
  dismissed: string | null,
): string | null {
  if (!state?.zen || state.zen.mode !== "auto" || state.status !== "downloaded") return null;
  const version = state.downloadedVersion;
  return version && version !== dismissed ? version : null;
}

/** Settings > About: the toast after a check that found nothing (upstream showed nothing). */
export function zenUpToDateTitle(): string {
  return zenMessagesFor(updatesText, getZenLocale()).upToDate;
}
