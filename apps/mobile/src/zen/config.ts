// Zen Staff mobile (ZED-ZEN fork of T3 Code): app identity and every external service id, from
// `ZEN_*` env only, empty by default (feature off: no OTA, sign-in, relay, links, tracing).
// Upstream's T3 env names are scrubbed so upstream's .env.example cannot reach a Zen build.
// Pure and dependency-free: app.config.ts (Node) and the app (Metro) both import it. See ZEN.md.
import {
  ZEN_APP_BASE_NAME,
  ZEN_APP_SCHEME,
  ZEN_HUB_NAME,
  ZEN_PRIVACY_URL,
} from "../../../../packages/contracts/src/zen.ts";

export { ZEN_APP_BASE_NAME, ZEN_APP_SCHEME };

export type ZenMobileVariant = "development" | "preview" | "production";

/** Reverse-DNS id of the production app; dev and preview append `.dev` / `.preview` (upstream's pattern). */
export const ZEN_MOBILE_APP_ID = "ro.zedzen.zenstaff";
export const ZEN_MOBILE_SLUG = "zen-staff";
/** Visible name of the account/relay service (upstream: "T3 Connect"). Served by the Zen hub. */
export const ZEN_MOBILE_CONNECT_NAME = ZEN_HUB_NAME;

export const ZEN_MOBILE_VARIANTS = {
  development: {
    appName: `${ZEN_APP_BASE_NAME} Dev`,
    scheme: `${ZEN_APP_SCHEME}-dev`,
    bundleIdentifier: `${ZEN_MOBILE_APP_ID}.dev`,
  },
  preview: {
    appName: `${ZEN_APP_BASE_NAME} Preview`,
    scheme: `${ZEN_APP_SCHEME}-preview`,
    bundleIdentifier: `${ZEN_MOBILE_APP_ID}.preview`,
  },
  production: {
    appName: ZEN_APP_BASE_NAME,
    scheme: ZEN_APP_SCHEME,
    bundleIdentifier: ZEN_MOBILE_APP_ID,
  },
} as const satisfies Record<
  ZenMobileVariant,
  { appName: string; scheme: string; bundleIdentifier: string }
>;

/** Every scheme a Zen Staff mobile build registers: `zen://`, `zen-dev://`, `zen-preview://`. */
export const ZEN_MOBILE_SCHEMES = Object.values(ZEN_MOBILE_VARIANTS).map((v) => v.scheme);

/** Environment variables read by app.config.ts. Nothing else configures an external service. */
export const ZEN_MOBILE_ENV = {
  /** Expo account (or organization) that owns the EAS project. */
  expoOwner: "ZEN_EXPO_OWNER",
  /** EAS project id (UUID). Also enables OTA updates at https://u.expo.dev/<id>. */
  easProjectId: "ZEN_EAS_PROJECT_ID",
  /** "0" keeps OTA updates off even with an EAS project. */
  updatesEnabled: "ZEN_MOBILE_UPDATES_ENABLED",
  /** Apple Developer team id (10 characters) for signing, App Groups, push, passkeys. */
  appleTeamId: "ZEN_APPLE_TEAM_ID",
  /** Path to google-services.json (Firebase project for Android push). */
  androidGoogleServicesFile: "ZEN_ANDROID_GOOGLE_SERVICES_FILE",
  /** Zen hub base URL (https). The single setting the hub integration will use. */
  hubUrl: "ZEN_HUB_URL",
  /** Host whose https links open the app (universal links / Android App Links), e.g. app.example.com. */
  linksHost: "ZEN_MOBILE_LINKS_HOST",
  /** Upstream-protocol relay (apps/relay, infra/relay) if we self-host one; empty = no relay. */
  relayUrl: "ZEN_MOBILE_RELAY_URL",
  /** Clerk instance for that relay. All three must be set for sign-in to appear. */
  clerkPublishableKey: "ZEN_MOBILE_CLERK_PUBLISHABLE_KEY",
  clerkJwtTemplate: "ZEN_MOBILE_CLERK_JWT_TEMPLATE",
  /** Passkey / webcredentials domain; defaults to the Frontend API host encoded in the key. */
  clerkDomain: "ZEN_MOBILE_CLERK_DOMAIN",
  clerkGoogleWebClientId: "ZEN_MOBILE_CLERK_GOOGLE_WEB_CLIENT_ID",
  clerkGoogleIosClientId: "ZEN_MOBILE_CLERK_GOOGLE_IOS_CLIENT_ID",
  clerkGoogleAndroidClientId: "ZEN_MOBILE_CLERK_GOOGLE_ANDROID_CLIENT_ID",
  clerkGoogleIosUrlScheme: "ZEN_MOBILE_CLERK_GOOGLE_IOS_URL_SCHEME",
  /** OTLP traces endpoint (all three or tracing stays off). */
  tracesUrl: "ZEN_MOBILE_OTLP_TRACES_URL",
  tracesDataset: "ZEN_MOBILE_OTLP_TRACES_DATASET",
  tracesToken: "ZEN_MOBILE_OTLP_TRACES_TOKEN",
} as const;

/**
 * Settings > environment "Check for updates" reads upstream's GitHub releases (pingdotgg/t3code)
 * and would offer to install T3 Code. Off until Zen Staff publishes its own server releases.
 */
export const ZEN_MOBILE_SERVER_RELEASE_CHECK = false;

/** Settings > Legal (upstream: t3.codes/legal and its policies). ZED-ZEN's own pages. */
export const ZEN_MOBILE_LEGAL_URL = "https://zed-zen.com/ro/termeni";
export const ZEN_MOBILE_PRIVACY_URL = "https://zed-zen.com/ro/confidentialitate";
export const ZEN_MOBILE_SECURITY_URL = ZEN_PRIVACY_URL;

/**
 * Upstream env names that would carry T3's public ids (see upstream `.env.example`) into the
 * build: the Expo config, the Clerk config plugin, and Babel's `EXPO_PUBLIC_*` inlining.
 */
export const ZEN_MOBILE_SCRUBBED_UPSTREAM_ENV = [
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_JWT_TEMPLATE",
  "VITE_CLERK_JWT_TEMPLATE",
  "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
  "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME",
  "T3CODE_RELAY_URL",
  "VITE_T3CODE_RELAY_URL",
  "T3CODE_HOSTED_APP_URL",
  "T3CODE_MOBILE_OTLP_TRACES_URL",
  "T3CODE_MOBILE_OTLP_TRACES_DATASET",
  "T3CODE_MOBILE_OTLP_TRACES_TOKEN",
  "EXPO_PUBLIC_OTLP_TRACES_URL",
  "EXPO_PUBLIC_OTLP_TRACES_DATASET",
  "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
  "EXPO_PUBLIC_MARKETING_SITE_URL",
  "T3CODE_ANDROID_GOOGLE_SERVICES_FILE",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

/** Removes upstream's service env names in place (process.env and the loaded repo env). */
export function scrubUpstreamMobileEnv(env: Record<string, string | undefined>): void {
  for (const key of ZEN_MOBILE_SCRUBBED_UPSTREAM_ENV) delete env[key];
}

function read(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostName(value: string | null): string | null {
  if (!value) return null;
  const host = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host.toLowerCase() : null;
}

/** Frontend API host encoded in a Clerk publishable key (`pk_live_<base64("host$")>`). */
export function clerkFrontendApiHost(publishableKey: string | null): string | null {
  const encoded = publishableKey?.match(/^pk_(?:live|test)_(.+)$/)?.[1];
  if (!encoded) return null;
  try {
    return hostName(atob(encoded).replace(/\$$/, ""));
  } catch {
    return null;
  }
}

export interface ZenMobileConfig {
  readonly variant: ZenMobileVariant;
  readonly appName: string;
  readonly scheme: string;
  readonly bundleIdentifier: string;
  readonly slug: string;
  readonly expoOwner: string | null;
  readonly easProjectId: string | null;
  readonly updatesUrl: string | null;
  readonly appleTeamId: string | null;
  readonly androidGoogleServicesFile: string | null;
  readonly hubUrl: string | null;
  readonly linksHost: string | null;
  readonly relayUrl: string | null;
  readonly clerk: {
    readonly publishableKey: string | null;
    readonly jwtTemplate: string | null;
    readonly domain: string | null;
    readonly googleWebClientId: string | null;
    readonly googleIosClientId: string | null;
    readonly googleAndroidClientId: string | null;
    readonly googleIosUrlScheme: string | null;
  };
  readonly tracing: {
    readonly url: string | null;
    readonly dataset: string | null;
    readonly token: string | null;
  };
}

export function resolveZenMobileConfig(env: Env, variant: ZenMobileVariant): ZenMobileConfig {
  const identity = ZEN_MOBILE_VARIANTS[variant];
  const easProjectId = read(env, ZEN_MOBILE_ENV.easProjectId);
  const updatesOff = read(env, ZEN_MOBILE_ENV.updatesEnabled) === "0";
  // Clerk without a relay (or a relay without Clerk) is useless: keep both or neither.
  const relayUrl = httpsUrl(read(env, ZEN_MOBILE_ENV.relayUrl));
  const publishableKey = relayUrl ? read(env, ZEN_MOBILE_ENV.clerkPublishableKey) : null;
  return {
    variant,
    ...identity,
    slug: ZEN_MOBILE_SLUG,
    expoOwner: read(env, ZEN_MOBILE_ENV.expoOwner),
    easProjectId,
    updatesUrl: easProjectId && !updatesOff ? `https://u.expo.dev/${easProjectId}` : null,
    appleTeamId: read(env, ZEN_MOBILE_ENV.appleTeamId),
    androidGoogleServicesFile: read(env, ZEN_MOBILE_ENV.androidGoogleServicesFile),
    hubUrl: httpsUrl(read(env, ZEN_MOBILE_ENV.hubUrl)),
    linksHost: hostName(read(env, ZEN_MOBILE_ENV.linksHost)),
    relayUrl: publishableKey ? relayUrl : null,
    clerk: {
      publishableKey,
      jwtTemplate: publishableKey ? read(env, ZEN_MOBILE_ENV.clerkJwtTemplate) : null,
      domain: publishableKey
        ? (hostName(read(env, ZEN_MOBILE_ENV.clerkDomain)) ?? clerkFrontendApiHost(publishableKey))
        : null,
      googleWebClientId: read(env, ZEN_MOBILE_ENV.clerkGoogleWebClientId),
      googleIosClientId: read(env, ZEN_MOBILE_ENV.clerkGoogleIosClientId),
      googleAndroidClientId: read(env, ZEN_MOBILE_ENV.clerkGoogleAndroidClientId),
      googleIosUrlScheme: read(env, ZEN_MOBILE_ENV.clerkGoogleIosUrlScheme),
    },
    tracing: {
      url: httpsUrl(read(env, ZEN_MOBILE_ENV.tracesUrl)),
      dataset: read(env, ZEN_MOBILE_ENV.tracesDataset),
      token: read(env, ZEN_MOBILE_ENV.tracesToken),
    },
  };
}

/** What the running app reads back from `expoConfig.extra.zen`. */
export interface ZenMobileRuntimeConfig {
  readonly hubUrl: string | null;
  readonly linksUrl: string | null;
}

export function zenMobileExtra(config: ZenMobileConfig): ZenMobileRuntimeConfig {
  return {
    hubUrl: config.hubUrl,
    linksUrl: config.linksHost ? `https://${config.linksHost}` : null,
  };
}

export function readZenMobileExtra(extra: unknown): ZenMobileRuntimeConfig {
  const zen: Record<string, unknown> =
    typeof extra === "object" && extra !== null && "zen" in extra
      ? ((extra as { zen?: Record<string, unknown> }).zen ?? {})
      : {};
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    hubUrl: httpsUrl(text(zen.hubUrl)),
    linksUrl: httpsUrl(text(zen.linksUrl))?.replace(/\/$/, "") ?? null,
  };
}

/** Deep-link prefixes the app accepts: its own schemes and, when configured, the links host. */
export function zenAppLinkPrefixes(runtime: ZenMobileRuntimeConfig): string[] {
  return [
    ...ZEN_MOBILE_SCHEMES.map((scheme) => `${scheme}://`),
    ...(runtime.linksUrl ? [runtime.linksUrl] : []),
  ];
}
