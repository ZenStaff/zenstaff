import { describe, expect, it } from "vite-plus/test";

import { effectiveEdition, getZenEdition, applyDeviceEdition } from "../office/editionStore";
import { getZenLocale, resolveZenLocale, setZenLocalePreference } from "../i18n/zenI18n";
import {
  getZenAccountPreferences,
  registerZenAccountPreferences,
  type ZenAccountPreferences,
} from "./accountPreferences";

function fakeAccount(initial: ZenAccountPreferences) {
  let value = initial;
  const listeners = new Set<() => void>();
  const writes: ZenAccountPreferences[] = [];
  return {
    writes,
    set(next: ZenAccountPreferences) {
      value = next;
      for (const listener of listeners) listener();
    },
    source: {
      id: "test-hub",
      read: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      write: (change: ZenAccountPreferences) => {
        writes.push(change);
        value = { ...value, ...change };
      },
    },
  };
}

describe("edition and language per person (hub account seam)", () => {
  it("rules: account first, then device, then server/browser", () => {
    expect(effectiveEdition("code", "code", "office")).toBe("office");
    expect(effectiveEdition("office", "code", null)).toBe("office");
    expect(effectiveEdition(null, null, null)).toBe("code");
    expect(resolveZenLocale("en", ["en-US"], "ro")).toBe("ro");
    expect(resolveZenLocale("auto", ["ro-RO"], null)).toBe("ro");
  });

  it("stays per device until an account registers, then follows the account", async () => {
    applyDeviceEdition("code");
    setZenLocalePreference("en");
    expect(getZenAccountPreferences()).toEqual({});
    expect(getZenEdition()).toBe("code");

    const account = fakeAccount({ edition: "office", locale: "ro" });
    const unregister = registerZenAccountPreferences(account.source);
    expect(getZenEdition()).toBe("office");
    expect(getZenLocale()).toBe("ro");

    // Another device changed the account's language.
    account.set({ edition: "office", locale: "en" });
    expect(getZenLocale()).toBe("en");

    // A choice made here is saved to the account too.
    applyDeviceEdition("code");
    await Promise.resolve();
    await Promise.resolve();
    expect(account.writes).toContainEqual({ edition: "code" });
    expect(getZenEdition()).toBe("code");

    // Signed out: the device value is the fallback again.
    unregister();
    setZenLocalePreference("ro");
    expect(getZenLocale()).toBe("ro");
    expect(getZenAccountPreferences()).toEqual({});
  });
});
