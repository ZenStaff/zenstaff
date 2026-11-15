import { describe, expect, it } from "@effect/vitest";

import {
  normalizePasskeys,
  passkeyId,
  passkeyLabel,
  passkeyLanguage,
  passkeyPageUrl,
} from "./hubPasskeys.ts";

const TOKEN = "pkl_1NCe2z2Tlvj8JU00lynfzTJ6Nr5hNfVih6vZ3OMucFA";

describe("passkey pages opened in the browser", () => {
  it("accepts only the hub's own passkey page, over https or on this machine", () => {
    expect(passkeyPageUrl(`https://hub.example.com/v1/passkeys/login?t=${TOKEN}`, "login")).toBe(
      `https://hub.example.com/v1/passkeys/login?t=${TOKEN}`,
    );
    expect(passkeyPageUrl(`http://localhost:8787/v1/passkeys/login?t=${TOKEN}`, "login")).not.toBe(
      null,
    );
    expect(
      passkeyPageUrl(`https://hub.example.com/prefix/v1/passkeys/login?t=${TOKEN}`, "login"),
    ).not.toBe(null);
    for (const bad of [
      `http://hub.example.com/v1/passkeys/login?t=${TOKEN}`,
      `javascript:alert(1)//v1/passkeys/login?t=${TOKEN}`,
      `file:///v1/passkeys/login?t=${TOKEN}`,
      `https://user:pass@hub.example.com/v1/passkeys/login?t=${TOKEN}`,
      `https://hub.example.com/v1/passkeys/register?t=${TOKEN}`,
      `https://hub.example.com/v1/auth/link?t=${TOKEN}`,
      "https://hub.example.com/v1/passkeys/login?t=short",
      "https://hub.example.com/v1/passkeys/login",
      42,
      null,
    ]) {
      expect(passkeyPageUrl(bad, "login")).toBe(null);
    }
  });
});

describe("passkey inputs", () => {
  it("keeps ids to the hub's format and labels short", () => {
    expect(passkeyId("pk_AbC123_-xyz")).toBe("pk_AbC123_-xyz");
    expect(passkeyId("../sessions/x")).toBe(null);
    expect(passkeyId("pk_a/b")).toBe(null);
    expect(passkeyLabel("  My   laptop ", "box")).toBe("My laptop");
    expect(passkeyLabel("", "box")).toBe("Passkey on box");
    expect(passkeyLabel("x".repeat(500), "box")).toHaveLength(120);
    expect(passkeyLanguage("ro")).toBe("ro");
    expect(passkeyLanguage("de")).toBe("en");
  });

  it("normalizes the hub's passkey list and drops malformed rows", () => {
    const listed = normalizePasskeys({
      passkeys: [
        {
          id: "pk_0123456789ab",
          label: "Laptop",
          createdAt: "2026-11-08T00:00:00.000Z",
          lastUsedAt: null,
          transports: ["internal", 3],
          backedUp: true,
          deviceType: "multiDevice",
        },
        { id: "nope", label: "x", createdAt: "x" },
        "garbage",
        null,
      ],
    });
    expect(listed).toEqual([
      {
        id: "pk_0123456789ab",
        label: "Laptop",
        createdAt: "2026-11-08T00:00:00.000Z",
        lastUsedAt: null,
        transports: ["internal"],
        backedUp: true,
        deviceType: "multiDevice",
      },
    ]);
    expect(normalizePasskeys(null)).toEqual([]);
  });
});
