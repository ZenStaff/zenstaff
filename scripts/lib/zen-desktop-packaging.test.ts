import { describe, expect, it } from "vite-plus/test";

import { ZEN_LINUX_EXECUTABLE_NAME, ZEN_LINUX_WM_CLASS } from "@t3tools/contracts/zen";

import { applyZenDesktopPackaging } from "./zen-desktop-packaging.ts";

describe("applyZenDesktopPackaging (Linux)", () => {
  it("matches StartupWMClass to the window class the app sets, not the binary name", () => {
    const config: Record<string, unknown> = { linux: {} };
    applyZenDesktopPackaging(config, "linux", "/repo");
    const linux = config.linux as {
      executableName: string;
      desktop: { entry: Record<string, string> };
    };
    expect(linux.executableName).toBe(ZEN_LINUX_EXECUTABLE_NAME);
    expect(linux.desktop.entry.StartupWMClass).toBe(ZEN_LINUX_WM_CLASS);
    expect(ZEN_LINUX_WM_CLASS).toBe("ro.zedzen.ZenStaff");
  });

  it("names the release AppImage Zen-Staff-<version>-<arch>, which the feed aliases expect", () => {
    const config: Record<string, unknown> = {
      linux: {},
      appImage: { artifactName: "T3-Code-${arch}.${ext}" },
    };
    applyZenDesktopPackaging(config, "linux", "/repo");
    expect((config.appImage as { artifactName: string }).artifactName).toBe(
      "Zen-Staff-${version}-${arch}.${ext}",
    );
  });
});
