import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { getDesktopUpdateIdleTooltip } from "../../components/desktopUpdate.logic";
import { zenMessagesFor } from "../i18n/zenI18n";
import { updatesText } from "./updates.i18n";
import {
  openZenManualDownload,
  zenPromptVersion,
  zenUpdateIdleTooltip,
  zenUpdateStatusLine,
} from "./zenUpdates";

const base: DesktopUpdateState = {
  enabled: true,
  status: "up-to-date",
  channel: "latest",
  currentVersion: "0.2.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
  zen: {
    channel: "beta",
    channelPinned: false,
    mode: "auto",
    installKind: "nsis",
    feedUrl: "https://releases.zed-zen.com/beta/win",
    manualDownloadUrl: null,
    installOnQuit: false,
  },
};

describe("Zen Staff updates", () => {
  it("replaces 'Updates unavailable' with the real state", () => {
    const tooltip = getDesktopUpdateIdleTooltip(base);
    expect(tooltip.title).not.toBe("Updates unavailable");
    expect(zenUpdateIdleTooltip(base, "ro")?.detail).toBe("0.2.0, canal Beta.");
    expect(zenUpdateIdleTooltip(base, "en")?.detail).toBe("0.2.0, Beta channel.");
    // Without our feed (older desktop) upstream's tooltip stays.
    const { zen: _zen, ...upstream } = base;
    expect(zenUpdateIdleTooltip(upstream, "en")).toBeNull();
  });

  it("says what is happening, in Romanian too", () => {
    const ro = zenMessagesFor(updatesText, "ro");
    expect(zenUpdateStatusLine(base, ro)).toBe("Zen Staff e la zi.");
    expect(
      zenUpdateStatusLine({ ...base, status: "downloaded", downloadedVersion: "0.2.1" }, ro),
    ).toContain("se instalează când închizi");
    const manual = {
      ...base,
      status: "available" as const,
      availableVersion: "0.2.1",
      zen: { ...base.zen!, mode: "manual" as const, installKind: "deb" as const },
    };
    expect(zenUpdateStatusLine(manual, ro)).toContain(".deb/.rpm");
  });

  it("prompts once per downloaded version, only for in-place updates", () => {
    const downloaded = { ...base, status: "downloaded" as const, downloadedVersion: "0.2.1" };
    expect(zenPromptVersion(downloaded, null)).toBe("0.2.1");
    expect(zenPromptVersion(downloaded, "0.2.1")).toBeNull();
    expect(zenPromptVersion(base, null)).toBeNull();
    expect(
      zenPromptVersion({ ...downloaded, zen: { ...base.zen!, mode: "manual" } }, null),
    ).toBeNull();
  });

  it("deb/rpm downloads open the package link", async () => {
    const url = "https://releases.zed-zen.com/stable/linux/Zen-Staff-0.2.1-amd64.deb";
    const openExternal = vi.fn(async () => true);
    const manual = await openZenManualDownload({
      getUpdateState: async () => ({
        ...base,
        zen: { ...base.zen!, mode: "manual", installKind: "deb", manualDownloadUrl: url },
      }),
      openExternal,
    });
    expect(manual).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(url);
    const auto = await openZenManualDownload({
      getUpdateState: async () => base,
      openExternal,
    });
    expect(auto).toBe(false);
  });
});
