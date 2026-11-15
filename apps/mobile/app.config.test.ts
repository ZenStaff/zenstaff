import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "ro.zedzen.zenstaff"],
  ["development", "ro.zedzen.zenstaff.dev"],
  ["preview", "ro.zedzen.zenstaff.preview"],
  ["production", "ro.zedzen.zenstaff"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Zen Staff: upstream's app.t3.codes links (and its Apple team in .well-known) never apply;
  // links exist only when ZEN_MOBILE_LINKS_HOST is set.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains ?? []).not.toContain(`applinks:${host}`);
  expect(JSON.stringify(appleAppSiteAssociation)).not.toContain(identifier);
  expect(config.android?.intentFilters ?? []).toEqual([]);
  expect(assetLinks.map((link) => link.target.package_name)).not.toContain(identifier);
});

// Zen Staff: expo-observe on Android crashes the app at launch without extra.eas.projectId.
it("always sets an EAS project id, the nil UUID when ZEN_EAS_PROJECT_ID is unset", async () => {
  vi.stubEnv("ZEN_EAS_PROJECT_ID", "");
  const config = await loadConfig("production");
  expect(config.extra?.eas?.projectId).toBe("00000000-0000-0000-0000-000000000000");
  expect(config.updates?.enabled).toBe(false);
  expect(config.updates?.url).toBeUndefined();
});
