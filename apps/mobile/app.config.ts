import type { ExpoConfig } from "expo/config";

import { BRAND_ASSET_PATHS } from "../../scripts/lib/brand-assets.ts";
import { loadRepoEnv } from "../../scripts/lib/public-config.ts";
import { ZEN_APP_BASE_NAME, ZEN_BRAND_COLORS } from "../../packages/contracts/src/zen.ts";
import {
  resolveZenMobileConfig,
  scrubUpstreamMobileEnv,
  zenMobileExtra,
} from "./src/zen/config.ts";

type AppVariant = "development" | "preview" | "production";

const repoEnv = loadRepoEnv();
// Zen Staff: upstream's service env (T3 Clerk, relay, tracing) never reaches the build.
scrubUpstreamMobileEnv(repoEnv);
Object.assign(process.env, repoEnv);
scrubUpstreamMobileEnv(process.env);
// Expo's TypeScript setup otherwise installs `typescript` on every start; we typecheck with tsrs.
process.env.EXPO_NO_TYPESCRIPT_SETUP = "1";

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);
const isIosPersonalTeamBuild = repoEnv.T3CODE_IOS_PERSONAL_TEAM === "1";
const runtimeVersionPolicy =
  process.env.MOBILE_VERSION_POLICY ??
  (APP_VARIANT === "development" ? "appVersion" : "fingerprint");

const personalTeamBundleIdentifier = repoEnv.T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID?.trim();
const IOS_BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

// Compiled into the native project. Without a relay, Observe's native side could dispatch to
// Expo's own ingest before observe.ts turns it off; `.invalid` never resolves (RFC 6761).
const zen = resolveZenMobileConfig(repoEnv, APP_VARIANT);
const observeEndpointUrl = zen.relayUrl
  ? new URL("/v1/mobile/observe", zen.relayUrl).toString()
  : "https://observe.invalid";
// Zen Staff: expo-observe's Android module throws at startup when `extra.eas.projectId` is missing
// ("Project ID is required ..."), so the JS bundle never registers (iOS tolerates it). Without an
// EAS project we write the nil UUID: Observe initialises, its endpoint is `observe.invalid` and
// observe.ts keeps dispatching off; updates stay off because they read ZEN_EAS_PROJECT_ID only.
const ZEN_EAS_PROJECT_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

const fromRepoRoot = (relativePath: string) => `../../${relativePath}`;
const androidAdaptiveForeground = fromRepoRoot("assets/zen/zen-android-foreground-432.png");
// Zen Staff: icons and splash from assets/zen (scripts/zen-export-brand-icons.ts); upstream's
// Icon Composer projects and apps/mobile/assets/android-* still hold T3 art.
const ZEN_ASSETS = {
  appIcon: fromRepoRoot(BRAND_ASSET_PATHS.productionIosIconPng),
  iosIcon: fromRepoRoot(BRAND_ASSET_PATHS.productionIosIconPng),
  splashIcon: fromRepoRoot("assets/zen/zen-universal-1024.png"),
  androidAdaptiveForeground,
  androidAdaptiveBackgroundColor: ZEN_BRAND_COLORS.navy,
  androidAdaptiveBackgroundImage: undefined,
  androidSplashIcon: fromRepoRoot("assets/zen/zen-android-splash-1152.png"),
  androidMonochromeIcon: fromRepoRoot("assets/zen/zen-android-monochrome-432.png"),
  androidNotificationIcon: fromRepoRoot("assets/zen/zen-android-notification-96.png"),
  androidNotificationColor: ZEN_BRAND_COLORS.vermilion,
  // The splash is the navy app icon on navy (light and dark), like the Android 12+ splash.
  splashBackgroundColor: ZEN_BRAND_COLORS.navy,
} as const;

if (
  isIosPersonalTeamBuild &&
  (!personalTeamBundleIdentifier ||
    !IOS_BUNDLE_IDENTIFIER_PATTERN.test(personalTeamBundleIdentifier))
) {
  throw new Error(
    "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS identifier such as com.example.t3code when T3CODE_IOS_PERSONAL_TEAM=1.",
  );
}

// Zen Staff: names, schemes and ids from src/zen/config.ts (ro.zedzen.zenstaff[.dev|.preview]).
const VARIANT_CONFIG = {
  development: { ...zenIdentity("development"), assets: ZEN_ASSETS },
  preview: { ...zenIdentity("preview"), assets: ZEN_ASSETS },
  production: { ...zenIdentity("production"), assets: ZEN_ASSETS },
} as const;

function zenIdentity(variant: AppVariant) {
  const { appName, scheme, bundleIdentifier } = resolveZenMobileConfig(repoEnv, variant);
  return {
    appName,
    scheme,
    iosBundleIdentifier: bundleIdentifier,
    androidPackage: bundleIdentifier,
  };
}

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    case undefined:
      return "production";
    default:
      throw new Error("APP_VARIANT must be development, preview, or production.");
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];
// Copied thread links open the app only from a host we own (ZEN_MOBILE_LINKS_HOST), whose
// .well-known files must list every variant's identifiers. Unset: no universal/App Links.
const HOSTED_APP_HOST = zen.linksHost;
const associatedDomains = [
  ...(zen.clerk.domain
    ? [`applinks:${zen.clerk.domain}`, `webcredentials:${zen.clerk.domain}`]
    : []),
  ...(HOSTED_APP_HOST ? [`applinks:${HOSTED_APP_HOST}`] : []),
];
const iosBundleIdentifier = isIosPersonalTeamBuild
  ? personalTeamBundleIdentifier!
  : variant.iosBundleIdentifier;

const dmSansFonts = {
  regular: "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf",
  medium: "@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf",
  bold: "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf",
} as const;

const widgetsPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-widgets",
  {
    bundleIdentifier: `${iosBundleIdentifier}.widgets`,
    groupIdentifier: `group.${iosBundleIdentifier}`,
    enablePushNotifications: true,
    // Frequent updates need the iOS entitlement to avoid early throttling.
    frequentUpdates: true,
    enableAndroid: true,
    widgets: [
      {
        name: "SubscriptionUsage",
        displayName: "Subscription usage",
        description: `Subscription quotas from your connected ${ZEN_APP_BASE_NAME} environments.`,
        ios: {
          configuration: {
            title: "Subscription usage",
            description:
              "Both shows Session and Weekly when available. The Lock Screen shows the tightest selected limit.",
            parameters: {
              codexPeriod: {
                title: "Codex limits",
                type: "enum",
                default: "auto",
                values: [
                  { name: "Both", value: "auto" },
                  { name: "Session", value: "session" },
                  { name: "Weekly", value: "weekly" },
                ],
              },
              claudePeriod: {
                title: "Claude limits",
                type: "enum",
                default: "auto",
                values: [
                  { name: "Both", value: "auto" },
                  { name: "Session", value: "session" },
                  { name: "Weekly", value: "weekly" },
                ],
              },
            },
          },
          supportedFamilies: [
            "systemSmall",
            "systemMedium",
            "systemLarge",
            "systemExtraLarge",
            "accessoryRectangular",
          ],
        },
        android: {
          minWidth: 250,
          minHeight: 180,
          targetCellWidth: 4,
          targetCellHeight: 3,
          resizeMode: "both",
          // The embedded layout renders before first launch; publishing replaces it with stored props.
          initialLayout: "./src/widgets/SubscriptionUsage.android.tsx",
        },
      },
      {
        name: "AgentActivity",
        displayName: "Agent Activity",
        description: `Shows the current state of active ${ZEN_APP_BASE_NAME} agents.`,
        android: null,
        ios: {
          supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
          // Embeds the layout so the gallery preview and a new widget render
          // before the app has run once; the app replaces it on publish.
          initialLayout: "./src/widgets/AgentActivityWidget.tsx",
        },
      },
    ],
  },
];

const sharingPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-sharing",
  {
    ios: {
      // Personal Teams cannot sign App Groups or extension targets; keep local builds usable.
      enabled: !isIosPersonalTeamBuild,
      extensionBundleIdentifier: `${iosBundleIdentifier}.sharing`,
      appGroupId: `group.${iosBundleIdentifier}`,
      activationRule: {
        supportsText: true,
        supportsWebUrlWithMaxCount: 1,
        supportsImageWithMaxCount: 8,
        supportsMovieWithMaxCount: 8,
        supportsFileWithMaxCount: 8,
      },
    },
    android: {
      enabled: true,
      singleShareMimeTypes: ["*/*"],
      multipleShareMimeTypes: ["*/*"],
    },
  },
];

// Match iOS PostScript names on Android so RN and the native composer share fonts before runtime loading.

const config: ExpoConfig = {
  name: variant.appName,
  slug: zen.slug,
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: repoEnv.T3CODE_MOBILE_VERSION ?? "2.3.0",
  runtimeVersion: {
    // Skip costly fingerprinting on dev launches; preview and production OTAs require matching native projects.
    policy: runtimeVersionPolicy,
  },
  orientation: "portrait",
  icon: variant.assets.appIcon,
  userInterfaceStyle: "automatic",
  updates: {
    // Zen Staff: OTA only from our own EAS project (ZEN_EAS_PROJECT_ID); none by default.
    enabled: zen.updatesUrl !== null,
    ...(zen.updatesUrl ? { url: zen.updatesUrl } : {}),
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
  },
  ios: {
    icon: variant.assets.iosIcon,
    supportsTablet: true,
    requireFullScreen: process.env.T3_SHOWCASE_CAPTURE_BUILD === "1",
    bundleIdentifier: iosBundleIdentifier,
    // Avoid Personal Team fallback: it cannot sign App Groups, Apple sign-in or push entitlements.
    ...(zen.appleTeamId ? { appleTeamId: zen.appleTeamId } : {}),
    ...(associatedDomains.length > 0 ? { associatedDomains } : {}),
    entitlements: {
      "keychain-access-groups": [`$(AppIdentifierPrefix)${variant.iosBundleIdentifier}`],
    },
    infoPlist: {
      UISupportedInterfaceOrientations: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription: `Allow ${ZEN_APP_BASE_NAME} to connect to ${ZEN_APP_BASE_NAME} servers on your local network or tailnet.`,
      NSPhotoLibraryAddUsageDescription: `Allow ${ZEN_APP_BASE_NAME} to save images to your photo library.`,
      // System picture in picture needs background audio to start and survive outside the app.
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
      // Capture builds disable multitasking because iPadOS otherwise ignores orientation requests.
      ...(process.env.T3_SHOWCASE_CAPTURE_BUILD === "1"
        ? {
            "UISupportedInterfaceOrientations~ipad": [
              "UIInterfaceOrientationPortrait",
              "UIInterfaceOrientationPortraitUpsideDown",
              "UIInterfaceOrientationLandscapeLeft",
              "UIInterfaceOrientationLandscapeRight",
            ],
          }
        : {}),
    },
  },
  android: {
    icon: variant.assets.appIcon,
    package: variant.androidPackage,
    ...(zen.androidGoogleServicesFile ? { googleServicesFile: zen.androidGoogleServicesFile } : {}),
    adaptiveIcon: {
      backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
      ...(variant.assets.androidAdaptiveBackgroundImage
        ? { backgroundImage: variant.assets.androidAdaptiveBackgroundImage }
        : {}),
      foregroundImage: variant.assets.androidAdaptiveForeground,
      monochromeImage: variant.assets.androidMonochromeIcon,
    },
    // JS back dispatch needs RN's Android 16 shim and withAndroidPredictiveBackCompat on Android 13-15.
    predictiveBackGestureEnabled: true,
    // expo-sensors declares this for its pedometer, which the app does not use.
    blockedPermissions: ["android.permission.ACTIVITY_RECOGNITION"],
    intentFilters: HOSTED_APP_HOST
      ? [
          {
            action: "VIEW",
            autoVerify: true,
            data: [{ scheme: "https", host: HOSTED_APP_HOST, pathPrefix: "/threads/" }],
            category: ["BROWSABLE", "DEFAULT"],
          },
        ]
      : [],
  },
  web: {
    favicon: variant.assets.appIcon,
  },
  plugins: [
    "expo-asset",
    [
      "expo-font",
      {
        ios: {
          fonts: [dmSansFonts.regular, dmSansFonts.medium, dmSansFonts.bold],
        },
        android: {
          fonts: [
            {
              fontFamily: "DMSans-Regular",
              fontDefinitions: [{ path: dmSansFonts.regular, weight: 400 }],
            },
            {
              fontFamily: "DMSans-Medium",
              fontDefinitions: [{ path: dmSansFonts.medium, weight: 500 }],
            },
            {
              fontFamily: "DMSans-Bold",
              fontDefinitions: [{ path: dmSansFonts.bold, weight: 700 }],
            },
          ],
        },
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    ...(isIosPersonalTeamBuild
      ? [sharingPlugin]
      : ["./plugins/withShareExtensionDisplayName.cjs", sharingPlugin]),
    [
      "expo-notifications",
      {
        icon: variant.assets.androidNotificationIcon,
        color: variant.assets.androidNotificationColor,
        mode: APP_VARIANT === "development" ? "development" : "production",
      },
    ],
    // Gate Clerk here: withoutIosPersonalTeamCapabilities runs too early to strip its entitlement.
    [
      "@clerk/expo",
      {
        theme: "./clerk-theme.json",
        // Zen Staff: no Sign in with Apple entitlement unless our own Clerk instance is configured.
        appleSignIn: !isIosPersonalTeamBuild && zen.clerk.publishableKey !== null,
      },
    ],
    "expo-web-browser",
    [
      "expo-quick-actions",
      {
        androidIcons: {
          shortcut_icon: {
            foregroundImage: variant.assets.androidAdaptiveForeground,
            backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
            ...(variant.assets.androidAdaptiveBackgroundImage
              ? { backgroundImage: variant.assets.androidAdaptiveBackgroundImage }
              : {}),
          },
        },
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: `Allow ${ZEN_APP_BASE_NAME} to use your microphone for voice input.`,
        recordAudioAndroid: true,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: `Allow ${ZEN_APP_BASE_NAME} to access your camera so you can scan pairing QR codes.`,
        microphonePermission: false,
        barcodeScannerEnabled: true,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: false,
        // `false` makes this plugin add RECORD_AUDIO to blockedPermissions, breaking Android dictation.
        microphonePermission: `Allow ${ZEN_APP_BASE_NAME} to use your microphone for voice input.`,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: variant.assets.splashIcon,
        resizeMode: "contain",
        backgroundColor: variant.assets.splashBackgroundColor,
        imageWidth: 220,
        dark: {
          image: variant.assets.splashIcon,
          backgroundColor: variant.assets.splashBackgroundColor,
        },
        android: {
          // Android 12+ masks the central two thirds of the 288dp canvas; adaptive layers avoid clipped corners.
          image: variant.assets.androidSplashIcon,
          imageWidth: 288,
          dark: { image: variant.assets.androidSplashIcon },
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          // SDK 58 lacks Kotlin 2.3's runtime-inert annotation. R8 needs explicit InputMerger constructors for widgets.
          extraProguardRules: [
            "-dontwarn kotlin.MustUseReturnValues",
            "-keep class * extends androidx.work.InputMerger { <init>(); }",
          ].join("\n"),
        },
        ios: {
          deploymentTarget: "18.0",
          // AppCheckCore 11.3+ includes Swift and needs module maps for these Objective-C dependencies.
          extraPods: [
            { name: "GoogleUtilities", modular_headers: true },
            { name: "RecaptchaInterop", modular_headers: true },
          ],
        },
      },
    ],
    "./plugins/withIosCocoaPodsUuidCache.cjs",
    // Compile out the unused pedometer to avoid an iOS motion purpose string.
    ["expo-sensors", { motionPermission: false }],
    // Mods run in reverse order; expo-widgets must create and wipe the target before assets are added.
    ...(!isIosPersonalTeamBuild ? ["./plugins/withWidgetLogoAsset.cjs", widgetsPlugin] : []),
    "./plugins/withAndroidNetworkSecurityConfig.cjs",
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidInputBackground.cjs",
    "./plugins/withAndroidModernPopupMenu.cjs",
    "./plugins/withAndroidModernAlertDialog.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
    // MainActivity mods run in reverse order; extend the tablet-orientation override.
    "./plugins/withAndroidWindowDisplayMetrics.cjs",
    "./plugins/withAndroidTabletOrientation.cjs",
    ...(isIosPersonalTeamBuild ? ["./plugins/withoutIosPersonalTeamCapabilities.cjs"] : []),
  ],
  extra: {
    appVariant: APP_VARIANT,
    secretsFeatureEnabled: ["1", "true"].includes(
      process.env.T3CODE_FEATURE_SECRETS?.trim().toLowerCase() ?? "",
    ),
    iosPersonalTeamBuild: isIosPersonalTeamBuild,
    // Zen Staff: every service value below comes from src/zen/config.ts (ZEN_* env, empty default).
    zen: zenMobileExtra(zen),
    relay: {
      url: zen.relayUrl,
    },
    clerk: {
      publishableKey: zen.clerk.publishableKey,
      jwtTemplate: zen.clerk.jwtTemplate,
    },
    // Clerk reads these exact names at prebuild. Omit unset values: manifest null becomes truthy {}.
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: zen.clerk.googleWebClientId ?? undefined,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: zen.clerk.googleIosClientId ?? undefined,
    EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID: zen.clerk.googleAndroidClientId ?? undefined,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: zen.clerk.googleIosUrlScheme ?? undefined,
    observability: {
      tracesUrl: zen.tracing.url,
      tracesDataset: zen.tracing.dataset,
      tracesToken: zen.tracing.token,
    },
    eas: {
      projectId: zen.easProjectId ?? ZEN_EAS_PROJECT_ID_PLACEHOLDER,
      observe: { endpointUrl: observeEndpointUrl },
    },
  },
  ...(zen.expoOwner ? { owner: zen.expoOwner } : {}),
  experiments: {
    // Metro only runs babel-plugin-react-compiler when this is set; see src/reactCompilerCoverage.test.ts.
    reactCompiler: true,
  },
};

export default config;
