// Zen Staff: which feed this desktop updates from (never upstream's app-update.yml GitHub feed).
// Channel: saved choice (zen-updates.json), else the build's app-update.yml URL, else Stable; a
// managed policy with `limits.updates.allowNightly: false` pins Stable. ZEN.md, "Updates".
import {
  isZenReleaseChannel,
  normalizeZenReleasesBaseUrl,
  resolveZenUpdateMode,
  ZEN_DEFAULT_RELEASE_CHANNEL,
  ZEN_UPDATE_OFF_REASONS,
  zenReleaseChannelFromFeedUrl,
  zenReleaseFeedUrl,
  zenReleasePlatform,
  type ZenInstallKind,
  type ZenReleaseChannel,
  type ZenUpdateMode,
} from "@t3tools/contracts/zenReleases";

export const ZEN_UPDATES_SETTINGS_FILE = "zen-updates.json";

/** electron-updater's download cache folder (upstream: "t3code-updater"). */
export const ZEN_UPDATER_CACHE_DIR_NAME = "zenstaff-updater";

export type ZenUpdaterEdition = "office" | "code" | "unknown";

/**
 * The User-Agent of update checks and downloads on our feed, so the feed's counter (the
 * zen-releases-counter Worker) can tell which versions check, on which system and edition:
 * `ZenStaff/0.2.4 (win; x64; office)`. Nothing else: no install id, no user, no machine name.
 * electron-updater's own default is the bare `electron-builder`.
 */
export function zenUpdaterUserAgent(input: {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly edition: ZenUpdaterEdition;
}): string {
  const os =
    input.platform === "win32"
      ? "win"
      : input.platform === "darwin"
        ? "mac"
        : input.platform === "linux"
          ? "linux"
          : "other";
  const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(input.version)
    ? input.version
    : "0.0.0";
  const arch = /^[a-z0-9_]{1,16}$/.test(input.arch) ? input.arch : "other";
  return `ZenStaff/${version} (${os}; ${arch}; ${input.edition})`;
}

export interface ZenFeedResolution {
  readonly base: string;
  readonly channel: ZenReleaseChannel;
  readonly channelPinned: boolean;
  readonly mode: ZenUpdateMode;
  readonly installKind: ZenInstallKind;
  /** The generic feed URL, or null when this install takes no updates. */
  readonly feedUrl: string | null;
  /** Why updates are off for this install, when `mode` is "off". */
  readonly offReason: string | null;
}

export function parseZenUpdatesSettings(raw: string | null | undefined): {
  readonly channel: ZenReleaseChannel | null;
} {
  if (!raw) return { channel: null };
  try {
    const parsed = JSON.parse(raw) as { channel?: unknown };
    return { channel: isZenReleaseChannel(parsed?.channel) ? parsed.channel : null };
  } catch {
    return { channel: null };
  }
}

export function encodeZenUpdatesSettings(channel: ZenReleaseChannel): string {
  return `${JSON.stringify({ channel }, null, 2)}\n`;
}

export function resolveZenFeed(input: {
  readonly baseUrl: string | undefined;
  readonly platform: NodeJS.Platform;
  readonly appImage: boolean;
  readonly packageType: string | null;
  /** The user's saved choice (zen-updates.json). */
  readonly savedChannel: ZenReleaseChannel | null;
  /** `url` from the build's app-update.yml. */
  readonly bakedFeedUrl: string | undefined;
  /** Managed policy: prereleases off pins Stable. */
  readonly pinStable: boolean;
  readonly macAutoUpdateEnabled?: boolean;
}): ZenFeedResolution {
  const base = normalizeZenReleasesBaseUrl(input.baseUrl);
  const channelPinned = input.pinStable;
  const channel: ZenReleaseChannel = channelPinned
    ? "stable"
    : (input.savedChannel ??
      zenReleaseChannelFromFeedUrl(input.bakedFeedUrl, base) ??
      ZEN_DEFAULT_RELEASE_CHANNEL);
  const { mode, installKind } = resolveZenUpdateMode({
    platform: input.platform,
    appImage: input.appImage,
    packageType: input.packageType,
    ...(input.macAutoUpdateEnabled === undefined
      ? {}
      : { macAutoUpdateEnabled: input.macAutoUpdateEnabled }),
  });
  const platform = zenReleasePlatform(input.platform);
  const feedUrl =
    mode === "off" || platform === null ? null : zenReleaseFeedUrl(base, channel, platform);
  const offReason =
    mode !== "off"
      ? null
      : installKind === "mac"
        ? ZEN_UPDATE_OFF_REASONS.mac
        : ZEN_UPDATE_OFF_REASONS.other;
  return { base, channel, channelPinned, mode, installKind, feedUrl, offReason };
}
