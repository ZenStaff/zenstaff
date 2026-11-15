// Team > company > Server and Cont AI: which of my computers can be the company server, and the
// plain Office words (no "runner", no "seat").
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import { describe, expect, it } from "vite-plus/test";

import { companyServerText } from "./companyServer.i18n";
import { machineState } from "./CompanyServer";

const status = (overrides: Partial<ZenHubStatus> = {}): ZenHubStatus => ({
  hubUrl: "https://zenhub.zed-zen.com",
  signedIn: true,
  pendingEmail: null,
  user: { id: "u_alex", email: "ana@firma.example", name: "Alex" },
  environment: { id: "henv-srv-birou", name: "srv-birou", connected: true },
  runnerCompanyId: null,
  runnerCompanyIds: [],
  links: {},
  companies: [{ id: "co_mz", name: "Meniul Zilei", role: "owner" }],
  invites: [],
  error: null,
  ...overrides,
});

describe("company server choice", () => {
  const input = { companyId: "co_mz", myUserId: "u_alex" };
  it("offers a computer signed in with my account where I own or run the company", () => {
    expect(machineState(status(), input)).toEqual({
      kind: "ready",
      serves: false,
      hubEnvironmentId: "henv-srv-birou",
    });
    expect(machineState(status({ runnerCompanyIds: ["co_hc", "co_mz"] }), input)).toMatchObject({
      serves: true,
    });
    // An older status with only the first company.
    expect(
      machineState(
        status({ runnerCompanyId: "co_mz", runnerCompanyIds: undefined as never }),
        input,
      ),
    ).toMatchObject({ serves: true });
  });
  it("explains why a computer cannot be chosen", () => {
    expect(machineState(null, input).kind).toBe("checking");
    expect(machineState(status({ signedIn: false, user: null }), input).kind).toBe("not-signed-in");
    expect(
      machineState(status({ user: { id: "u_ion", email: "i@x", name: "Ion" } }), input).kind,
    ).toBe("other-account");
    expect(
      machineState(status({ companies: [{ id: "co_mz", name: "MZ", role: "member" }] }), input)
        .kind,
    ).toBe("no-access");
    expect(machineState(status({ companies: [] }), input).kind).toBe("no-access");
  });
  it("speaks plain Romanian: no runner, no seat", () => {
    // Values only (the keys are code: `seat` is the stored mode, never shown).
    const words = Object.values(companyServerText.ro)
      .flatMap((value) =>
        typeof value === "function"
          ? [(value as (name: string) => string)("srv-birou")]
          : typeof value === "object"
            ? Object.values(value)
            : [value],
      )
      .join(" | ");
    expect(words).not.toMatch(/runner|seat/i);
    expect(companyServerText.ro.makeServer).toBe("Fă-l serverul firmei");
    expect(companyServerText.ro.chooseTitle).toBe("Alege serverul firmei");
    expect(companyServerText.ro.modeServer).toBe("Abonamentul meu (doar pentru mine)");
    expect(companyServerText.ro.modeKey).toBe("Cheie API a firmei");
  });
});
