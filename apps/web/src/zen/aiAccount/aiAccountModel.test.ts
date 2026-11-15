import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  aiAccountFromProvider,
  aiAccountSignature,
  aiAccountTitle,
  aiAccountsOf,
  classifyAiAccount,
  companyAccountCheck,
  unconfirmedAccounts,
} from "./aiAccountModel";

const provider = (overrides: Record<string, unknown>): ServerProvider =>
  ({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    displayName: "Claude",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    ...overrides,
  }) as unknown as ServerProvider;

describe("classifyAiAccount", () => {
  it("tells personal plans from company plans and API keys", () => {
    expect(classifyAiAccount({ type: "max", label: "Claude Max Subscription" })).toBe("personal");
    expect(classifyAiAccount({ type: "pro", label: "Claude Pro Subscription" })).toBe("personal");
    expect(classifyAiAccount({ type: "team", label: "Claude Team Subscription" })).toBe("company");
    expect(classifyAiAccount({ type: "enterprise", label: "Claude Enterprise Subscription" })).toBe(
      "company",
    );
    expect(classifyAiAccount({ type: "apiKey", label: "Claude API Key" })).toBe("api");
    expect(classifyAiAccount({ type: "bedrock", label: "Amazon Bedrock" })).toBe("api");
    expect(classifyAiAccount({ type: "chatgpt", label: "ChatGPT Plus Subscription" })).toBe(
      "personal",
    );
    expect(classifyAiAccount({ type: "chatgpt", label: "ChatGPT Business Subscription" })).toBe(
      "company",
    );
    expect(classifyAiAccount({ type: "chatgpt" })).toBe("unknown");
    expect(classifyAiAccount({})).toBe("unknown");
  });
});

describe("AI accounts on this computer", () => {
  const claude = provider({
    auth: {
      status: "authenticated",
      email: "alex@firma.example",
      type: "max",
      label: "Claude Max Subscription",
    },
  });
  const codexSignedOut = provider({
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    auth: { status: "unauthenticated" },
  });

  it("reads the email, plan and state from the provider snapshot", () => {
    const account = aiAccountFromProvider(claude);
    expect(account).toMatchObject({
      service: "Claude",
      email: "alex@firma.example",
      plan: "Claude Max",
      kind: "personal",
      state: "signed-in",
    });
    expect(aiAccountTitle(account)).toBe("Claude alex@firma.example (Claude Max)");
    expect(aiAccountFromProvider(codexSignedOut)).toMatchObject({
      service: "ChatGPT",
      state: "signed-out",
      kind: "unknown",
    });
    expect(aiAccountFromProvider(provider({ installed: false, status: "error" })).state).toBe(
      "not-installed",
    );
  });

  it("never treats a found login as confirmed", () => {
    const accounts = aiAccountsOf([codexSignedOut, claude]);
    expect(accounts.map((account) => account.service)).toEqual(["Claude", "ChatGPT"]);
    expect(unconfirmedAccounts(accounts, new Set()).map((account) => account.service)).toEqual([
      "Claude",
    ]);
    const confirmed = new Set([aiAccountSignature(accounts[0]!)]);
    expect(unconfirmedAccounts(accounts, confirmed)).toEqual([]);
    // Another login on the same provider asks again.
    const other = aiAccountsOf([
      provider({
        auth: {
          status: "authenticated",
          email: "alt@firma.example",
          label: "Claude Max Subscription",
        },
      }),
    ]);
    expect(unconfirmedAccounts(other, confirmed)).toHaveLength(1);
  });

  it("warns or blocks a personal account for company agents", () => {
    const personal = aiAccountFromProvider(claude);
    const team = aiAccountFromProvider(
      provider({
        auth: { status: "authenticated", type: "team", label: "Claude Team Subscription" },
      }),
    );
    expect(companyAccountCheck(personal, false)).toBe("warn-personal");
    expect(companyAccountCheck(personal, true)).toBe("blocked-personal");
    expect(companyAccountCheck(team, true)).toBe("ok");
    expect(companyAccountCheck(null, false)).toBe("missing");
  });
});
