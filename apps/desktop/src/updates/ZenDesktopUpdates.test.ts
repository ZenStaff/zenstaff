// Zen Staff: the desktop updater reads our feed (releases.zed-zen.com), never upstream's.
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DesktopUpdates from "./DesktopUpdates.ts";
import { flushCallbacks, makeHarness, type UpdatesHarnessOptions } from "./updatesTestHarness.ts";
import { resolveZenFeed, parseZenUpdatesSettings, zenUpdaterUserAgent } from "./zenUpdateFeed.ts";

const zenHarness = (options: UpdatesHarnessOptions = {}) =>
  makeHarness({ ...options, env: { T3CODE_DESKTOP_MOCK_UPDATES: "false", ...options.env } });

const UPSTREAM_APP_UPDATE_YML =
  "provider: github\nowner: pingdotgg\nrepo: t3code\nupdaterCacheDirName: t3code-updater\n";

const feedUrlsOf = (harness: ReturnType<typeof makeHarness>) =>
  harness.feedUrls().map((feed) => (feed as { url?: string }).url);

describe("Zen Staff update feed", () => {
  it("resolves the channel: saved choice, then the build's feed, then Stable", () => {
    const base = {
      baseUrl: undefined,
      platform: "win32" as const,
      appImage: false,
      packageType: null,
      pinStable: false,
    };
    assert.equal(
      resolveZenFeed({ ...base, savedChannel: null, bakedFeedUrl: undefined }).feedUrl,
      "https://releases.zed-zen.com/stable/win",
    );
    assert.equal(
      resolveZenFeed({
        ...base,
        savedChannel: null,
        bakedFeedUrl: "https://releases.zed-zen.com/beta/win",
      }).channel,
      "beta",
    );
    assert.equal(
      resolveZenFeed({
        ...base,
        savedChannel: "stable",
        bakedFeedUrl: "https://releases.zed-zen.com/beta/win",
      }).channel,
      "stable",
    );
    // Upstream's GitHub feed in app-update.yml never picks anything.
    assert.equal(
      resolveZenFeed({
        ...base,
        savedChannel: null,
        bakedFeedUrl: "https://github.com/pingdotgg/t3code",
      }).channel,
      "stable",
    );
    // A managed policy without prereleases pins Stable over a saved Beta.
    const pinned = resolveZenFeed({
      ...base,
      savedChannel: "beta",
      bakedFeedUrl: undefined,
      pinStable: true,
    });
    assert.equal(pinned.channel, "stable");
    assert.equal(pinned.channelPinned, true);
    // The base moves with ZEN_RELEASES_BASE_URL (releases.zenstaff.ai later).
    assert.equal(
      resolveZenFeed({
        ...base,
        baseUrl: "https://releases.zenstaff.ai/",
        savedChannel: "beta",
        bakedFeedUrl: undefined,
      }).feedUrl,
      "https://releases.zenstaff.ai/beta/win",
    );
  });

  it("maps install kinds to auto, manual and off", () => {
    const linux = (appImage: boolean, packageType: string | null) =>
      resolveZenFeed({
        baseUrl: undefined,
        platform: "linux",
        appImage,
        packageType,
        savedChannel: null,
        bakedFeedUrl: undefined,
        pinStable: false,
      });
    assert.equal(linux(true, null).mode, "auto");
    assert.equal(linux(true, null).feedUrl, "https://releases.zed-zen.com/stable/linux");
    assert.equal(linux(false, "deb").mode, "manual");
    assert.equal(linux(false, "rpm").mode, "manual");
    assert.equal(linux(false, null).mode, "off");
    const mac = resolveZenFeed({
      baseUrl: undefined,
      platform: "darwin",
      appImage: false,
      packageType: null,
      savedChannel: null,
      bakedFeedUrl: undefined,
      pinStable: false,
    });
    assert.equal(mac.mode, "off");
    assert.equal(mac.feedUrl, null);
    assert.match(mac.offReason ?? "", /signed/);
  });

  it("ignores a malformed zen-updates.json", () => {
    assert.equal(parseZenUpdatesSettings("{").channel, null);
    assert.equal(parseZenUpdatesSettings('{"channel":"nightly"}').channel, null);
    assert.equal(parseZenUpdatesSettings('{"channel":"beta"}').channel, "beta");
  });

  it.effect("Windows reads our feed, never app-update.yml's GitHub feed", () => {
    const harness = zenHarness({
      platform: "win32",
      files: { "app-update.yml": UPSTREAM_APP_UPDATE_YML },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const state = yield* updates.getState;
        assert.equal(state.enabled, true);
        assert.equal(state.status, "idle");
        assert.deepEqual(feedUrlsOf(harness), ["https://releases.zed-zen.com/stable/win"]);
        assert.equal(state.zen?.channel, "stable");
        assert.equal(state.zen?.mode, "auto");
        assert.equal(state.zen?.installOnQuit, false);
        for (const feed of harness.feedUrls()) {
          assert.notMatch(JSON.stringify(feed), /github|t3code|pingdotgg/);
        }
        // app-update.yml says "t3code-updater"; downloads must not share T3 Code's cache.
        assert.deepEqual(harness.updaterCacheDirNames(), ["zenstaff-updater"]);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it("the feed's User-Agent carries version, OS, arch and edition, nothing else", () => {
    assert.equal(
      zenUpdaterUserAgent({ version: "0.2.4", platform: "win32", arch: "x64", edition: "office" }),
      "ZenStaff/0.2.4 (win; x64; office)",
    );
    assert.equal(
      zenUpdaterUserAgent({
        version: "0.2.4",
        platform: "linux",
        arch: "arm64",
        edition: "unknown",
      }),
      "ZenStaff/0.2.4 (linux; arm64; unknown)",
    );
    // Odd values never reach the header as free text.
    assert.equal(
      zenUpdaterUserAgent({ version: "dev build", platform: "aix", arch: "x 64", edition: "code" }),
      "ZenStaff/0.0.0 (other; other; code)",
    );
  });

  it.effect("checks on our feed send the Zen User-Agent; the edition updates it", () => {
    const harness = zenHarness({ platform: "win32", appVersion: "0.2.4" });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.deepEqual(harness.requestHeaders(), [
          { "User-Agent": "ZenStaff/0.2.4 (win; x64; unknown)" },
        ]);
        yield* updates.setZenEdition("office");
        yield* updates.setZenEdition("office");
        assert.deepEqual(harness.requestHeaders().at(-1), {
          "User-Agent": "ZenStaff/0.2.4 (win; x64; office)",
        });
        assert.equal(harness.requestHeaders().length, 2);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("a mirror from a managed policy keeps electron-updater's own User-Agent", () => {
    const harness = zenHarness({
      platform: "win32",
      files: { "app-update.yml": UPSTREAM_APP_UPDATE_YML },
      policy: {
        mode: "auto",
        feedUrl: "https://mirror.example/zen",
        allowNightly: true,
        message: "Managed by ACME.",
      },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        yield* updates.setZenEdition("code");
        assert.deepEqual(harness.requestHeaders(), []);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("a build published to Beta defaults to Beta", () => {
    const harness = zenHarness({
      platform: "win32",
      files: {
        "app-update.yml": "provider: generic\nurl: https://releases.zed-zen.com/beta/win\n",
      },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.equal((yield* updates.getState).zen?.channel, "beta");
        assert.deepEqual(feedUrlsOf(harness), ["https://releases.zed-zen.com/beta/win"]);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("downloads a found update in the background and installs it on quit", () => {
    const harness: ReturnType<typeof makeHarness> = zenHarness({
      platform: "win32",
      checkForUpdates: Effect.sync(() => harness.emit("update-available", { version: "1.2.4" })),
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const result = yield* updates.check("web-ui");
        assert.equal(result.checked, true);
        // The background download is forked; let it run.
        for (let i = 0; i < 20 && harness.downloadCount() === 0; i++) yield* flushCallbacks;
        assert.equal(harness.downloadCount(), 1);
        assert.equal(harness.autoInstallOnAppQuit(), false);
        harness.emit("update-downloaded", { version: "1.2.4" });
        for (let i = 0; i < 5; i++) yield* flushCallbacks;
        const state = yield* updates.getState;
        assert.equal(state.status, "downloaded");
        assert.equal(state.zen?.installOnQuit, true);
        assert.equal(harness.autoInstallOnAppQuit(), true);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("deb installs check but link to the package instead of downloading", () => {
    const harness = zenHarness({ platform: "linux", packageType: "deb\n" });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.equal((yield* updates.getState).zen?.mode, "manual");
        harness.emit("update-available", {
          version: "1.2.4",
          files: [{ url: "Zen-Staff-1.2.4-x86_64.AppImage" }, { url: "Zen-Staff-1.2.4-amd64.deb" }],
        });
        yield* flushCallbacks;
        const state = yield* updates.getState;
        assert.equal(state.status, "available");
        assert.equal(
          state.zen?.manualDownloadUrl,
          "https://releases.zed-zen.com/stable/linux/Zen-Staff-1.2.4-amd64.deb",
        );
        const download = yield* updates.download;
        assert.equal(download.accepted, false);
        assert.equal(harness.downloadCount(), 0);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("macOS stays off until the app is signed", () => {
    const harness = zenHarness({ platform: "darwin" });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const state = yield* updates.getState;
        assert.equal(state.status, "disabled");
        assert.match(state.message ?? "", /signed/);
        assert.equal(harness.feedUrls().length, 0);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("switching to Beta saves the choice, moves the feed and checks", () => {
    const harness = zenHarness({ platform: "win32" });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const before = harness.checkCount();
        const state = yield* updates.setZenChannel("beta");
        assert.equal(state.zen?.channel, "beta");
        assert.equal(feedUrlsOf(harness).at(-1), "https://releases.zed-zen.com/beta/win");
        assert.equal(harness.checkCount(), before + 1);
        assert.deepEqual(
          [...harness.writtenFiles.values()].map((v) => JSON.parse(v)),
          [{ channel: "beta" }],
        );
        assert.equal(harness.autoInstallOnAppQuit(), false);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("a managed policy without prereleases pins Stable", () => {
    const harness = zenHarness({
      platform: "win32",
      files: { "zen-updates.json": '{"channel":"beta"}' },
      policy: {
        mode: "auto",
        feedUrl: undefined,
        allowNightly: false,
        message: "Managed by ACME.",
      },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const state = yield* updates.setZenChannel("beta");
        assert.equal(state.zen?.channel, "stable");
        assert.equal(state.zen?.channelPinned, true);
        assert.deepEqual(feedUrlsOf(harness), ["https://releases.zed-zen.com/stable/win"]);
      }),
    ).pipe(Effect.provide(harness.layer));
  });
});
