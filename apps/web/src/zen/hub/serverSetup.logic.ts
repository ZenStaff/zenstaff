// Zen Staff: the "make this computer the company server" confirmation (review 0.2.3, P0-6). Pure:
// which AI account the dialog offers, what is shared by default (nothing personal) and the
// `confirm` block the server records (apps/server/src/zen/hub/serverConsent.ts). Tests:
// serverSetup.logic.test.ts.
import type { AiAccount } from "../aiAccount/aiAccountModel";
import { aiAccountTitle } from "../aiAccount/aiAccountModel";

export interface ServerSetupConnector {
  readonly name: string;
  readonly origin: string;
  /** What people call it ("Trello"), or the server name. */
  readonly label: string;
}

export type ServerAccountChoice = "seat" | "api-key";

export interface ServerSetupChoice {
  readonly account: ServerAccountChoice | null;
  /** The company API key's provider (Anthropic for Claude, OpenAI for Codex). */
  readonly provider: "claude" | "codex";
  readonly apiKey: string;
  readonly apiKeyName: string;
  readonly shared: ReadonlySet<string>;
  readonly acknowledged: boolean;
}

/** The provider login the server would use for the company: Claude first, then ChatGPT. */
export function serverSeatAccount(accounts: ReadonlyArray<AiAccount>): AiAccount | null {
  return (
    accounts.find((account) => account.driver === "claudeAgent" && account.state === "signed-in") ??
    accounts.find((account) => account.driver === "codex" && account.state === "signed-in") ??
    null
  );
}

/**
 * What the company server may run on: a company API key always; the server's own login (a
 * subscription) only while the company has a single member, the owner (companyAiRule.ts).
 */
export function serverAccountOptions(
  seat: AiAccount | null,
  memberCount: number,
): ReadonlyArray<ServerAccountChoice> {
  return seat !== null && memberCount <= 1 ? ["seat", "api-key"] : ["api-key"];
}

/**
 * With colleagues the company API key is preselected (the only option); alone, nothing is
 * preselected when the only login is a personal subscription: the owner chooses.
 */
export function initialServerChoice(seat: AiAccount | null, memberCount = 1): ServerSetupChoice {
  return {
    account:
      memberCount > 1 ? "api-key" : seat !== null && seat.kind !== "personal" ? "seat" : null,
    provider: seat?.driver === "codex" ? "codex" : "claude",
    apiKey: "",
    apiKeyName: "",
    // Review P0-6: no connector is shared until the owner ticks it.
    shared: new Set(),
    acknowledged: false,
  };
}

/** Connectors from the Connections overview, without Zen's own tools. */
export function serverSetupConnectors(
  connections: ReadonlyArray<{
    readonly name: string;
    readonly origin: string;
    readonly appName: string | null;
  }>,
): ServerSetupConnector[] {
  const own = new Set(["t3-code", "zen-memory"]);
  return connections
    .filter((connection) => !own.has(connection.name))
    .map((connection) => ({
      name: connection.name,
      origin: connection.origin,
      label: connection.appName ?? connection.name.replace(/^claude\.ai\s+/, ""),
    }));
}

export function serverChoiceReady(
  choice: ServerSetupChoice,
  hasStoredKey: boolean,
  memberCount = 1,
): boolean {
  if (!choice.acknowledged || choice.account === null) return false;
  if (choice.account === "seat" && memberCount > 1) return false;
  if (choice.account === "api-key") return choice.apiKey.trim() !== "" || hasStoredKey;
  return true;
}

/** The `confirm` block of `runner.set` / `runner.consent.set`. */
export function serverConfirmPayload(input: {
  readonly choice: ServerSetupChoice;
  readonly seat: AiAccount | null;
  readonly connectors: ReadonlyArray<ServerSetupConnector>;
  readonly apiKeyDefaultName: string;
}): Record<string, unknown> | null {
  const { choice, seat } = input;
  if (choice.account === null || !choice.acknowledged) return null;
  const seen = input.connectors.map((connector) => ({
    name: connector.name,
    origin: connector.origin,
  }));
  const shared = input.connectors
    .map((connector) => connector.name)
    .filter((name) => choice.shared.has(name));
  if (choice.account === "seat") {
    if (seat === null) return null;
    return {
      acknowledged: true,
      account: {
        provider: seat.driver === "codex" ? "codex" : "claude",
        mode: "seat",
        label: aiAccountTitle(seat).slice(0, 80),
        personal: seat.kind === "personal",
      },
      seen,
      shared,
    };
  }
  const key = choice.apiKey.trim();
  return {
    acknowledged: true,
    account: {
      provider: choice.provider,
      mode: "api-key",
      label: (choice.apiKeyName.trim() || input.apiKeyDefaultName).slice(0, 80),
      personal: false,
      ...(key === "" ? {} : { apiKey: key }),
    },
    seen,
    shared,
  };
}

/** The confirmation the server recorded, as `runner.consent.get` returns it. */
export interface RecordedServerConsent {
  readonly account: {
    readonly provider: string;
    readonly mode: "seat" | "api-key";
    readonly label: string;
    readonly personal: boolean;
  };
  readonly shared: ReadonlyArray<string>;
  readonly confirmedAt: string;
}
