import type { ZenConnectorEntry } from "@t3tools/contracts/zenConnectors";
import { describe, expect, it } from "vite-plus/test";

import { connectorsText } from "./connectors.i18n";
import {
  intentForMessage,
  isCallbackAddress,
  looksLikeKey,
  shownPath,
  type AgentAppView,
} from "./connectState";

const entry = (id: string, name: string, category: ZenConnectorEntry["category"]) =>
  ({ id, name, category, aliases: [name.toLowerCase()] }) as unknown as ZenConnectorEntry;
const entries = [entry("gmail", "Gmail", "email"), entry("smartbill", "SmartBill", "invoicing")];

describe("connect dock", () => {
  it("looks at each finished message once", () => {
    const seen = new Set<string>();
    const message = { id: "m1", text: "conectează-mi Gmail", streaming: false };
    expect(intentForMessage(message, seen, entries)?.appId).toBe("gmail");
    seen.add("m1");
    expect(intentForMessage(message, seen, entries)).toBeNull();
    expect(intentForMessage({ ...message, id: "m2", streaming: true }, seen, entries)).toBeNull();
    expect(
      intentForMessage({ id: "m3", text: "scrie un email", streaming: false }, seen, entries),
    ).toBeNull();
    expect(intentForMessage(message, new Set(), [])).toBeNull();
  });

  it("shows the picked path only when it is available", () => {
    const app: AgentAppView = {
      id: "gmail",
      name: "Gmail",
      connected: false,
      connections: [],
      bestPath: "native",
      paths: [
        { kind: "native", available: true, blocked: null },
        { kind: "local-mcp", available: false, blocked: "no-claude" },
        { kind: "csv", available: true, blocked: null },
      ],
      tier: "standard",
      lock: null,
    };
    expect(shownPath(app, null)).toBe("native");
    expect(shownPath(app, "csv")).toBe("csv");
    expect(shownPath(app, "local-mcp")).toBe("native");
  });

  it("the paste-back box only takes Claude Code's localhost callback", () => {
    expect(isCallbackAddress("http://localhost:50540/callback?code=abc&state=xyz")).toBe(true);
    expect(isCallbackAddress("https://accounts.google.com/o/oauth2/auth?state=x")).toBe(false);
    expect(isCallbackAddress("sk_live_1234567890abcdef")).toBe(false);
  });

  it("refuses keys in the request to ZED-ZEN", () => {
    expect(looksLikeKey("cheia api: abcdef123456")).toBe(true);
    expect(looksLikeKey("sk_live_abcdefghijk123")).toBe(true);
    expect(looksLikeKey("Vrem rapoartele lunare")).toBe(false);
  });

  it("has Romanian for every string", () => {
    expect(Object.keys(connectorsText.ro).toSorted()).toEqual(
      Object.keys(connectorsText.en).toSorted(),
    );
    expect(connectorsText.ro.cardTitle("Gmail")).toBe("Conectează Gmail");
  });
});
