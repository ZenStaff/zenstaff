import { describe, expect, it } from "vite-plus/test";

import {
  clerkFrontendApiHost,
  readZenMobileExtra,
  resolveZenMobileConfig,
  scrubUpstreamMobileEnv,
  zenAppLinkPrefixes,
  zenMobileExtra,
} from "./config";

// Upstream's public ids from its .env.example; none may reach a Zen build.
const UPSTREAM_ENV = {
  T3CODE_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudDMuY29kZXMk",
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudDMuY29kZXMk",
  T3CODE_CLERK_JWT_TEMPLATE: "t3-relay",
  T3CODE_RELAY_URL: "https://relay.t3.codes",
  EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
};

describe("resolveZenMobileConfig", () => {
  it("uses Zen ids per variant", () => {
    expect(resolveZenMobileConfig({}, "production")).toMatchObject({
      appName: "Zen Staff",
      scheme: "zen",
      bundleIdentifier: "ro.zedzen.zenstaff",
    });
    expect(resolveZenMobileConfig({}, "development")).toMatchObject({
      scheme: "zen-dev",
      bundleIdentifier: "ro.zedzen.zenstaff.dev",
    });
    expect(resolveZenMobileConfig({}, "preview").bundleIdentifier).toBe(
      "ro.zedzen.zenstaff.preview",
    );
  });

  it("turns every service off by default and ignores upstream env names", () => {
    const config = resolveZenMobileConfig(UPSTREAM_ENV, "production");
    expect(config).toMatchObject({
      expoOwner: null,
      easProjectId: null,
      updatesUrl: null,
      appleTeamId: null,
      hubUrl: null,
      linksHost: null,
      relayUrl: null,
      clerk: { publishableKey: null, jwtTemplate: null, domain: null },
      tracing: { url: null, dataset: null, token: null },
    });
    expect(JSON.stringify(config)).not.toMatch(/t3\.codes|axiom/);
  });

  it("reads our own services from ZEN_* env", () => {
    const config = resolveZenMobileConfig(
      {
        ZEN_EAS_PROJECT_ID: "11111111-2222-3333-4444-555555555555",
        ZEN_HUB_URL: "https://hub.zed-zen.com",
        ZEN_MOBILE_LINKS_HOST: "https://app.zed-zen.com/",
        ZEN_MOBILE_RELAY_URL: "https://relay.zed-zen.com",
        ZEN_MOBILE_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsuemVkLXplbi5jb20k",
        ZEN_MOBILE_CLERK_JWT_TEMPLATE: "zen-relay",
      },
      "production",
    );
    expect(config.updatesUrl).toBe("https://u.expo.dev/11111111-2222-3333-4444-555555555555");
    expect(config.hubUrl).toBe("https://hub.zed-zen.com/");
    expect(config.linksHost).toBe("app.zed-zen.com");
    expect(config.relayUrl).toBe("https://relay.zed-zen.com/");
    expect(config.clerk.domain).toBe("clerk.zed-zen.com");
  });

  it("keeps the relay off without a Clerk key, and rejects plain http", () => {
    expect(
      resolveZenMobileConfig({ ZEN_MOBILE_RELAY_URL: "https://relay.zed-zen.com" }, "production")
        .relayUrl,
    ).toBeNull();
    expect(
      resolveZenMobileConfig({ ZEN_HUB_URL: "http://hub.zed-zen.com" }, "production").hubUrl,
    ).toBeNull();
  });
});

describe("runtime extra", () => {
  it("round-trips through expoConfig.extra.zen and builds link prefixes", () => {
    const config = resolveZenMobileConfig(
      { ZEN_MOBILE_LINKS_HOST: "app.zed-zen.com" },
      "production",
    );
    const runtime = readZenMobileExtra({ zen: zenMobileExtra(config) });
    expect(zenAppLinkPrefixes(runtime)).toEqual([
      "zen-dev://",
      "zen-preview://",
      "zen://",
      "https://app.zed-zen.com",
    ]);
    // Expo serializes null as {}; that must read back as unset.
    expect(readZenMobileExtra({ zen: { hubUrl: {}, linksUrl: {} } })).toMatchObject({
      hubUrl: null,
      linksUrl: null,
    });
  });
});

it("scrubs upstream env names in place", () => {
  const env: Record<string, string | undefined> = { ...UPSTREAM_ENV, KEEP: "1" };
  scrubUpstreamMobileEnv(env);
  expect(env).toEqual({ KEEP: "1" });
});

it("decodes the Clerk Frontend API host", () => {
  expect(clerkFrontendApiHost("pk_live_Y2xlcmsudDMuY29kZXMk")).toBe("clerk.t3.codes");
  expect(clerkFrontendApiHost("not-a-key")).toBeNull();
});
