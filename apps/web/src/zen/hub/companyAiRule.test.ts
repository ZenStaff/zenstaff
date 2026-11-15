import { describe, expect, it } from "vite-plus/test";

import {
  companyAiModes,
  companyHasApiKey,
  initialCompanyAiMode,
  PROVIDER_CONSOLE,
  servesColleagues,
} from "./companyAiRule";
import { companyServerText } from "./companyServer.i18n";

const runner = (mode: "seat" | "api-key" | null) => ({
  id: "henv",
  name: "srv-birou",
  ownerName: "Alex",
  online: true,
  lastSeenAt: null,
  aiAccount: mode === null ? null : { provider: "claude" as const, mode, label: "x" },
});

describe("company server AI account rule", () => {
  it("invitations wait for a company API key on one of the servers", () => {
    expect(companyHasApiKey({ runners: [] })).toBe(false);
    expect(companyHasApiKey({ runners: [runner(null)] })).toBe(false);
    expect(companyHasApiKey({ runners: [runner("seat")] })).toBe(false);
    expect(companyHasApiKey({ runners: [runner("seat"), runner("api-key")] })).toBe(true);
  });

  it("offers a personal subscription only while the owner is alone", () => {
    expect(companyAiModes(1)).toEqual(["api-key", "seat"]);
    expect(companyAiModes(2)).toEqual(["api-key"]);
    expect(initialCompanyAiMode(null, 1)).toBe("api-key");
    expect(initialCompanyAiMode({ mode: "seat" }, 1)).toBe("seat");
    expect(initialCompanyAiMode({ mode: "seat" }, 3)).toBe("api-key");
  });

  it("serves colleagues only on the company key", () => {
    expect(servesColleagues({ mode: "api-key" })).toBe(true);
    expect(servesColleagues({ mode: "seat" })).toBe(false);
    expect(servesColleagues(null)).toBe(false);
  });

  it("links each provider's console and says it plainly in Romanian", () => {
    expect(PROVIDER_CONSOLE.claude).toMatch(/^https:\/\/console\.anthropic\.com\//);
    expect(PROVIDER_CONSOLE.codex).toMatch(/^https:\/\/platform\.openai\.com\//);
    expect(companyServerText.ro.modeSoloWarning).toBe(
      "Doar pentru tine. Colegii lucrează cu contul lor de AI; ca serverul să lucreze și pentru ei, adaugă o cheie API a firmei.",
    );
    expect(companyServerText.ro.addCompanyKey).toBe("Adaugă cheia API a firmei");
    expect(companyServerText.ro.inviteNoKey).toBe(
      "Colegii lucrează pe calculatorul lor, cu contul lor de AI. Pentru angajați AI comuni, pe serverul firmei, adaugă o cheie API a firmei.",
    );
  });
});
