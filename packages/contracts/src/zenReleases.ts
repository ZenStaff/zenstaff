// Zen Staff: our desktop update feed, `<base>/<channel>/<platform>/latest*.yml` (electron-updater
// generic provider), written by scripts/zen-publish-release.ts to R2 `zen-releases`. The base URL
// lives only here (override: ZEN_RELEASES_BASE_URL). ZEN.md, "Updates and telemetry".
import * as Schema from "effect/Schema";

/** Public base of the feed (R2 bucket `zen-releases` behind a Cloudflare custom domain). */
const ZEN_RELEASES_BASE_URL = "https://releases.zed-zen.com";
/** Env override of the base, read by the desktop at runtime and by the build/publish scripts. */
export const ZEN_RELEASES_BASE_URL_ENV = "ZEN_RELEASES_BASE_URL";
/**
 * The remote pack registry (new packs without an app release): index + Ed25519 signature on the
 * same host, written by scripts/zen-publish-packs.ts. Setting > env ZEN_REGISTRY_URL > this.
 */
export const ZEN_PACKS_REGISTRY_URL = `${ZEN_RELEASES_BASE_URL}/packs/registry.json`;
/**
 * Public key (SPKI DER, base64) that signs the pack registry index (`registry.json.sig`). The
 * private key never leaves the publishing machine. Env ZEN_REGISTRY_PUBLIC_KEY replaces it (a
 * self-hosted registry, the dev fixture). ZEN.md, "Remote registry".
 */
export const ZEN_REGISTRY_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAIiV5c8XJklDpM+oE33Xttp0jaHMrpZ9kjq6veIUTzc8=";
/** Env that picks the channel a build defaults to (baked into its app-update.yml). */
export const ZEN_RELEASE_CHANNEL_ENV = "ZEN_RELEASE_CHANNEL";

const ZEN_RELEASE_CHANNELS = ["stable", "beta"] as const;
export type ZenReleaseChannel = (typeof ZEN_RELEASE_CHANNELS)[number];
export const ZenReleaseChannelSchema = Schema.Literals(ZEN_RELEASE_CHANNELS);
export const ZEN_DEFAULT_RELEASE_CHANNEL: ZenReleaseChannel = "stable";

export type ZenReleasePlatform = "win" | "linux" | "mac";

/**
 * macOS updates need a signed (and notarized) app: Squirrel.Mac refuses unsigned bundles. The
 * feed and code are wired; flip this once a Developer ID build exists (ZEN.md).
 */
const ZEN_MAC_AUTO_UPDATE_ENABLED = false;

export function isZenReleaseChannel(value: unknown): value is ZenReleaseChannel {
  return (
    typeof value === "string" && (ZEN_RELEASE_CHANNELS as ReadonlyArray<string>).includes(value)
  );
}

export function zenReleasePlatform(platform: string): ZenReleasePlatform | null {
  if (platform === "win32" || platform === "win") return "win";
  if (platform === "linux") return "linux";
  if (platform === "darwin" || platform === "mac") return "mac";
  return null;
}

/** An https base without a trailing slash; anything else falls back to the default. */
export function normalizeZenReleasesBaseUrl(raw: string | undefined | null): string {
  const value = raw?.trim().replace(/\/+$/u, "");
  if (!value) return ZEN_RELEASES_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) {
      return ZEN_RELEASES_BASE_URL;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return ZEN_RELEASES_BASE_URL;
  }
}

/** The electron-updater generic feed URL of one channel and platform. */
export function zenReleaseFeedUrl(
  base: string,
  channel: ZenReleaseChannel,
  platform: ZenReleasePlatform,
): string {
  return `${normalizeZenReleasesBaseUrl(base)}/${channel}/${platform}`;
}

/** The channel of a feed URL under `base` (from a build's app-update.yml), else null. */
export function zenReleaseChannelFromFeedUrl(
  feedUrl: string | undefined | null,
  base: string,
): ZenReleaseChannel | null {
  if (!feedUrl) return null;
  const prefix = `${normalizeZenReleasesBaseUrl(base)}/`;
  const value = feedUrl.trim().replace(/\/+$/u, "");
  if (!value.startsWith(prefix)) return null;
  const channel = value.slice(prefix.length).split("/")[0];
  return isZenReleaseChannel(channel) ? channel : null;
}

/** The feed file electron-updater reads (channel "latest") for a platform and arch. */
export function zenFeedFileName(platform: ZenReleasePlatform, arch = "x64"): string {
  if (platform === "mac") return "latest-mac.yml";
  if (platform === "linux") return arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
  return "latest.yml";
}

/** How this install takes updates: in place, a download link (deb/rpm), or not at all. */
export type ZenUpdateMode = "auto" | "manual" | "off";
export type ZenInstallKind = "nsis" | "appimage" | "deb" | "rpm" | "mac" | "other";

export const ZenUpdateInfoSchema = Schema.Struct({
  channel: ZenReleaseChannelSchema,
  /** A managed policy keeps this machine on Stable. */
  channelPinned: Schema.Boolean,
  mode: Schema.Literals(["auto", "manual", "off"]),
  installKind: Schema.Literals(["nsis", "appimage", "deb", "rpm", "mac", "other"]),
  feedUrl: Schema.NullOr(Schema.String),
  /** deb/rpm: where to download the new version by hand. */
  manualDownloadUrl: Schema.NullOr(Schema.String),
  /** A downloaded update installs when the app quits. */
  installOnQuit: Schema.Boolean,
});
export type ZenUpdateInfo = typeof ZenUpdateInfoSchema.Type;

/** Resolves the update mode of a packaged install. */
export function resolveZenUpdateMode(input: {
  readonly platform: string;
  readonly appImage: boolean;
  readonly packageType: string | null;
  readonly macAutoUpdateEnabled?: boolean;
}): { readonly mode: ZenUpdateMode; readonly installKind: ZenInstallKind } {
  if (input.platform === "win32") return { mode: "auto", installKind: "nsis" };
  if (input.platform === "darwin") {
    return {
      mode: (input.macAutoUpdateEnabled ?? ZEN_MAC_AUTO_UPDATE_ENABLED) ? "auto" : "off",
      installKind: "mac",
    };
  }
  if (input.platform === "linux") {
    if (input.appImage) return { mode: "auto", installKind: "appimage" };
    if (input.packageType === "deb") return { mode: "manual", installKind: "deb" };
    if (input.packageType === "rpm") return { mode: "manual", installKind: "rpm" };
  }
  return { mode: "off", installKind: "other" };
}

export const ZEN_UPDATE_OFF_REASONS = {
  mac: "Automatic updates on macOS need a signed build; install new versions manually for now.",
  other:
    "Automatic updates need the Windows installer, the AppImage, or the .deb/.rpm package; install new versions manually.",
} as const;

/** From an update's `files` list, the package a deb/rpm user downloads by hand. */
export function zenManualDownloadUrl(
  feedUrl: string,
  files: ReadonlyArray<{ readonly url: string }> | undefined,
  installKind: ZenInstallKind,
): string {
  const extension = installKind === "rpm" ? ".rpm" : installKind === "deb" ? ".deb" : ".AppImage";
  const match =
    files?.find((file) => file.url.endsWith(extension)) ??
    files?.find((file) => file.url.endsWith(".AppImage"));
  if (!match) return feedUrl;
  // Feed entries are relative names; never follow an absolute URL to another host.
  if (/^[a-z]+:/iu.test(match.url) || match.url.startsWith("/")) return feedUrl;
  return `${feedUrl}/${match.url.split("/").map(encodeURIComponent).join("/")}`;
}
