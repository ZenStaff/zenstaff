// Zen Staff installer identity: build-desktop-artifact.ts passes its electron-builder config
// through `applyZenDesktopPackaging` and takes `ZEN_STAGE_PACKAGE_METADATA` for the staged app.
// Signing/notarization env: ZEN.md "Desktop packaging".
import {
  ZEN_APP_BASE_NAME,
  ZEN_APP_ID,
  ZEN_LINUX_EXECUTABLE_NAME,
  ZEN_LINUX_WM_CLASS,
  ZEN_PRODUCT_URL,
  ZEN_PUBLISHER_NAME,
} from "@t3tools/contracts/zen";
import {
  isZenReleaseChannel,
  ZEN_DEFAULT_RELEASE_CHANNEL,
  ZEN_RELEASE_CHANNEL_ENV,
  ZEN_RELEASES_BASE_URL_ENV,
  zenReleaseFeedUrl,
  type ZenReleaseChannel,
} from "@t3tools/contracts/zenReleases";

/** Maintainer field of deb/rpm packages (needs an e-mail address). */
export const ZEN_PACKAGE_MAINTAINER = `${ZEN_PUBLISHER_NAME} <support@zenstaff.app>`;
export const ZEN_METAINFO_PATH = "assets/zen/linux/ro.zedzen.zenstaff.metainfo.xml";
const DESCRIPTION = `${ZEN_APP_BASE_NAME} is ${ZEN_PUBLISHER_NAME}'s desktop app for AI staff and coding agents, based on the open-source T3 Code. Work with your existing agent subscriptions, run ready-made workflows, review changes, and connect from desktop, web, or mobile.`;

/** Overrides upstream's description/homepage/author ("T3 Tools") in the staged package.json. */
export const ZEN_STAGE_PACKAGE_METADATA = {
  description: DESCRIPTION,
  homepage: ZEN_PRODUCT_URL,
  author: ZEN_PUBLISHER_NAME,
} as const;

type Config = Record<string, unknown>;
const section = (config: Config, key: string): Config | undefined => {
  const value = config[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Config)
    : undefined;
};

/** Rewrites "T3 Code" in user-visible strings electron-builder copies into Info.plist etc. */
const renameStrings = (record: Config | undefined) => {
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") record[key] = value.replaceAll("T3 Code", ZEN_APP_BASE_NAME);
  }
};

export function applyZenDesktopPackaging(
  config: Config,
  platform: "mac" | "linux" | "win",
  repoRoot: string,
): Config {
  const join = (...parts: Array<string>) => [repoRoot, ...parts].join("/");
  config.appId = ZEN_APP_ID;
  config.productName ??= ZEN_APP_BASE_NAME;
  config.artifactName = "Zen-Staff-${version}-${arch}.${ext}";
  config.copyright = `Copyright © ${ZEN_PUBLISHER_NAME}. Based on T3 Code (MIT).`;

  if (platform === "mac") {
    const mac = section(config, "mac");
    renameStrings(mac ? section(mac, "extendInfo") : undefined);
    if (mac) {
      mac.extendInfo = {
        ...section(mac, "extendInfo"),
        NSHumanReadableCopyright: config.copyright,
      };
      // Signing and notarization stay upstream's and env-driven (ZEN.md "Desktop packaging").
    }
    const dmg = section(config, "dmg");
    if (dmg && typeof dmg.title === "string")
      dmg.title = dmg.title.replaceAll("T3 Code", ZEN_APP_BASE_NAME);
  }

  if (platform === "linux") {
    const linux = section(config, "linux");
    if (linux) {
      linux.executableName = ZEN_LINUX_EXECUTABLE_NAME;
      linux.maintainer = ZEN_PACKAGE_MAINTAINER;
      linux.vendor = ZEN_PUBLISHER_NAME;
      linux.synopsis = "AI staff and coding agents on your desktop";
      linux.description = DESCRIPTION;
      linux.desktop = {
        entry: {
          Name: ZEN_APP_BASE_NAME,
          Comment: "AI staff and coding agents on your desktop",
          // The running window's class (setDesktopName), not the binary name.
          StartupWMClass: ZEN_LINUX_WM_CLASS,
          Keywords: "AI;agents;Claude;Codex;office;code;",
        },
      };
    }
    // Upstream names the release AppImage without a version (T3-Code-<arch>, in-place updates);
    // our feed keeps Zen-Staff-<version>-<arch>: immutable caching and the landing's fixed aliases.
    const appImage = section(config, "appImage");
    if (appImage) appImage.artifactName = config.artifactName;
    const fpm = [
      `${join(ZEN_METAINFO_PATH)}=/usr/share/metainfo/ro.zedzen.zenstaff.metainfo.xml`,
      `${join("LICENSE")}=/usr/share/doc/${ZEN_LINUX_EXECUTABLE_NAME}/copyright`,
    ];
    const deb = section(config, "deb") ?? {};
    config.deb = { ...deb, packageName: ZEN_LINUX_EXECUTABLE_NAME, fpm };
    config.rpm = {
      packageName: ZEN_LINUX_EXECUTABLE_NAME,
      fpm,
      depends: ["libsecret", "libnotify", "libXScrnSaver", "libXtst", "xdg-utils", "nss", "gtk3"],
    };
  }

  if (platform === "win") {
    // Apps & features shows the publisher from `author`. electron-builder 26 rejects
    // `win.publisherName`; once signed, the name goes under win.signtoolOptions/azureSignOptions.
    const nsis = section(config, "nsis");
    if (nsis) {
      nsis.shortcutName = ZEN_APP_BASE_NAME;
      nsis.uninstallDisplayName = ZEN_APP_BASE_NAME;
    }
  }
  return config;
}

// Our feed for release builds: electron-builder writes latest*.yml + .blockmap and bakes the URL
// (the build's default channel, ZEN_RELEASE_CHANNEL) into app-update.yml. No publisherName: Windows
// builds are unsigned, and electron-updater verifies signatures only when app-update.yml names one.
const ZEN_UPDATER_CACHE_DIR_NAME = "zenstaff-updater";

export function zenDesktopPublishConfig(
  platform: "mac" | "linux" | "win",
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  readonly provider: "generic";
  readonly url: string;
  readonly channel: "latest";
  readonly updaterCacheDirName: string;
} {
  return {
    provider: "generic",
    url: zenReleaseFeedUrl(env[ZEN_RELEASES_BASE_URL_ENV] ?? "", zenBuildChannel(env), platform),
    channel: "latest",
    // Not upstream's "t3code-updater": an installed T3 Code must never see our downloads.
    updaterCacheDirName: ZEN_UPDATER_CACHE_DIR_NAME,
  };
}

export function zenBuildChannel(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ZenReleaseChannel {
  const raw = env[ZEN_RELEASE_CHANNEL_ENV]?.trim();
  if (raw === undefined || raw === "") return ZEN_DEFAULT_RELEASE_CHANNEL;
  if (!isZenReleaseChannel(raw)) {
    throw new Error(`${ZEN_RELEASE_CHANNEL_ENV} must be "stable" or "beta", got "${raw}".`);
  }
  return raw;
}
