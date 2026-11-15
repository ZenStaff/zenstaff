import { describe, expect, it } from "vite-plus/test";

import type { AiAccount } from "../aiAccount/aiAccountModel";
import {
  initialServerChoice,
  serverAccountOptions,
  serverChoiceReady,
  serverConfirmPayload,
  serverSeatAccount,
  serverSetupConnectors,
} from "./serverSetup.logic";

const account = (overrides: Partial<AiAccount>): AiAccount => ({
  instanceId: "claudeAgent",
  driver: "claudeAgent",
  service: "Claude",
  email: "ion@mail.example",
  plan: "Claude Max",
  kind: "personal",
  state: "signed-in",
  ...overrides,
});

const CONNECTORS = serverSetupConnectors([
  { name: "claude.ai Salarizare", origin: "account", appName: null },
  { name: "claude.ai Trello", origin: "account", appName: "Trello" },
  { name: "t3-code", origin: "user", appName: null },
]);

describe("company server confirmation (review P0-6)", () => {
  it("lists the machine's connections without Zen's own tools, by their plain name", () => {
    expect(CONNECTORS.map((item) => item.label)).toEqual(["Salarizare", "Trello"]);
  });

  it("shares nothing by default and never preselects a personal subscription", () => {
    const personal = initialServerChoice(account({}));
    expect(personal.account).toBeNull();
    expect(personal.shared.size).toBe(0);
    expect(personal.acknowledged).toBe(false);
    expect(initialServerChoice(account({ kind: "company", plan: "Claude Team" })).account).toBe(
      "seat",
    );
    expect(initialServerChoice(null).account).toBeNull();
  });

  it("needs an account and the explicit 'I understand'", () => {
    const choice = initialServerChoice(account({ kind: "company" }));
    expect(serverChoiceReady(choice, false)).toBe(false);
    expect(serverChoiceReady({ ...choice, acknowledged: true }, false)).toBe(true);
    expect(serverChoiceReady({ ...choice, account: null, acknowledged: true }, false)).toBe(false);
    const key = { ...choice, account: "api-key" as const, acknowledged: true };
    expect(serverChoiceReady(key, false)).toBe(false);
    expect(serverChoiceReady(key, true)).toBe(true);
    expect(serverChoiceReady({ ...key, apiKey: "sk-ant-x" }, false)).toBe(true);
  });

  it("sends the account it named, the personal flag and only the ticked connections", () => {
    const seat = account({});
    const payload = serverConfirmPayload({
      choice: {
        account: "seat",
        provider: "claude",
        apiKey: "",
        apiKeyName: "",
        shared: new Set(["claude.ai Trello"]),
        acknowledged: true,
      },
      seat,
      connectors: CONNECTORS,
      apiKeyDefaultName: "Cheia API a firmei",
    });
    expect(payload).toEqual({
      acknowledged: true,
      account: {
        provider: "claude",
        mode: "seat",
        label: "Claude ion@mail.example (Claude Max)",
        personal: true,
      },
      seen: [
        { name: "claude.ai Salarizare", origin: "account" },
        { name: "claude.ai Trello", origin: "account" },
      ],
      shared: ["claude.ai Trello"],
    });
  });

  it("sends a company API key with its name, and nothing without the acknowledgement", () => {
    const base = {
      account: "api-key" as const,
      provider: "claude" as const,
      apiKey: " sk-ant-1 ",
      apiKeyName: "",
      shared: new Set<string>(),
      acknowledged: true,
    };
    const payload = serverConfirmPayload({
      choice: base,
      seat: null,
      connectors: CONNECTORS,
      apiKeyDefaultName: "Cheia API a firmei",
    });
    expect(payload?.account).toEqual({
      provider: "claude",
      mode: "api-key",
      label: "Cheia API a firmei",
      personal: false,
      apiKey: "sk-ant-1",
    });
    expect(
      serverConfirmPayload({
        choice: { ...base, acknowledged: false },
        seat: null,
        connectors: CONNECTORS,
        apiKeyDefaultName: "x",
      }),
    ).toBeNull();
  });

  it("picks Claude's login first, then ChatGPT's", () => {
    const codex = account({ driver: "codex", instanceId: "codex", service: "ChatGPT" });
    expect(serverSeatAccount([codex, account({})])?.driver).toBe("claudeAgent");
    expect(serverSeatAccount([codex])?.driver).toBe("codex");
    expect(serverSeatAccount([account({ state: "signed-out" })])).toBeNull();
  });

  it("with colleagues, offers only a company API key (any provider); alone, the login too", () => {
    const seat = account({ kind: "company", plan: "Claude Team" });
    expect(serverAccountOptions(seat, 1)).toEqual(["seat", "api-key"]);
    expect(serverAccountOptions(seat, 3)).toEqual(["api-key"]);
    expect(serverAccountOptions(null, 1)).toEqual(["api-key"]);
    const team = initialServerChoice(seat, 3);
    expect(team.account).toBe("api-key");
    expect(serverChoiceReady({ ...team, account: "seat", acknowledged: true }, true, 3)).toBe(
      false,
    );
    expect(serverChoiceReady({ ...team, acknowledged: true }, true, 3)).toBe(true);
    const payload = serverConfirmPayload({
      choice: { ...team, provider: "codex", apiKey: "sk-openai", acknowledged: true },
      seat,
      connectors: [],
      apiKeyDefaultName: "Cheie API a firmei",
    });
    expect(payload).toMatchObject({
      account: { provider: "codex", mode: "api-key", apiKey: "sk-openai" },
    });
  });
});
