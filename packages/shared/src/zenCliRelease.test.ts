// Zen Staff: CLI archives come from the ZenStaff/zenstaff GitHub releases, never upstream's
// (pingdotgg/t3code). See ZEN.md "CLI command".
import { ZEN_CLI_RELEASES_REPO } from "@t3tools/contracts/zen";
import { describe, expect, it } from "vite-plus/test";

import {
  CLI_RELEASES_PAGE_URL,
  cliArchiveFileName,
  cliReleaseAssetUrl,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
} from "./cliRelease.ts";

describe("Zen CLI releases", () => {
  it("reads ZenStaff/zenstaff", () => {
    expect(ZEN_CLI_RELEASES_REPO).toBe("ZenStaff/zenstaff");
    expect(CLI_RELEASES_PAGE_URL).toBe("https://github.com/ZenStaff/zenstaff/releases");
    expect(cliReleaseIndexPageUrl(2)).toBe(
      "https://api.github.com/repos/ZenStaff/zenstaff/releases?per_page=100&page=2",
    );
  });

  it("downloads the archives and SHA256SUMS of tag v<version>", () => {
    expect(cliReleaseDownloadBaseUrl("0.2.8")).toBe(
      "https://github.com/ZenStaff/zenstaff/releases/download/v0.2.8",
    );
    expect(cliReleaseAssetUrl("0.2.8", cliArchiveFileName("0.2.8", "linux-x64"))).toBe(
      "https://github.com/ZenStaff/zenstaff/releases/download/v0.2.8/t3-0.2.8-linux-x64.tar.gz",
    );
    expect(cliReleaseAssetUrl("0.2.8", cliArchiveFileName("0.2.8", "win32-x64"))).toBe(
      "https://github.com/ZenStaff/zenstaff/releases/download/v0.2.8/t3-0.2.8-win32-x64.zip",
    );
    expect(cliReleaseAssetUrl("0.2.8", "SHA256SUMS")).toBe(
      "https://github.com/ZenStaff/zenstaff/releases/download/v0.2.8/SHA256SUMS",
    );
  });

  it("still lets a mirror (T3CODE_RELEASE_BASE_URL) replace the repo", () => {
    expect(cliReleaseAssetUrl("0.2.8", "SHA256SUMS", "https://mirror.example/zs/")).toBe(
      "https://mirror.example/zs/v0.2.8/SHA256SUMS",
    );
  });
});
