// Team > company > Server and Cont AI, rendered with fixed hub answers per computer: an owner picks
// the company server (this PC or srv-birou) and its AI account there; a member only reads. Screenshots
// (light and dark) go to __screens__/ (copied to screens/cont-ai/, see ZEN.md).
import type { ZenHubCompanyDetail, ZenHubStatus } from "@t3tools/contracts/zenHub";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { setZenLocalePreference } from "../i18n/zenI18n";
import "../../index.css";

const COMPANY = "co_mz";
const me = { id: "u_alex", email: "ana@firma.example", name: "Ana Pop" };
const companies = [{ id: COMPANY, name: "Meniul Zilei", role: "owner" as const }];

const status = (input: {
  hubEnvironment: { id: string; name: string };
  serves?: boolean;
  companyAi?: ZenHubStatus["companyAis"];
}): ZenHubStatus => ({
  hubUrl: "https://zenhub.zed-zen.com",
  signedIn: true,
  pendingEmail: null,
  user: me,
  environment: { ...input.hubEnvironment, connected: true },
  runnerCompanyId: input.serves ? COMPANY : null,
  runnerCompanyIds: input.serves ? [COMPANY] : [],
  links: {},
  companies,
  invites: [],
  error: null,
  ...(input.companyAi ? { companyAis: input.companyAi } : {}),
});

const detail = (
  runners: ZenHubCompanyDetail["runners"],
  role: "owner" | "member" = "owner",
  members: ZenHubCompanyDetail["members"] = [],
) =>
  ({
    company: { id: COMPANY, name: "Meniul Zilei" },
    role,
    members,
    invites: [],
    runners,
  }) as unknown as ZenHubCompanyDetail;

const officeRunner = (aiAccount: ZenHubCompanyDetail["runners"][number]["aiAccount"] = null) => ({
  id: "henv-srv-birou",
  name: "srv-birou",
  ownerName: "Ana Pop",
  online: true,
  lastSeenAt: null,
  aiAccount,
  companies: 5,
});

let statuses: Record<string, ZenHubStatus> = {};
/** What each computer recorded with "Am înțeles" (runner.consent.get), per company. */
let consents: Record<string, Record<string, unknown>> = {};
const calls: Array<{ environmentId: string; op: string; input: Record<string, unknown> }> = [];

vi.mock("./hubClient", () => ({
  hubErrorMessage: (error: unknown, fallback = "x") =>
    error instanceof Error ? error.message : fallback,
  useHubQuery: (environmentId: string, op: string) => ({
    data:
      op === "runner.consent.get"
        ? { consents: consents[environmentId] ?? {} }
        : (statuses[environmentId] ?? null),
    error: null,
    refresh: () => undefined,
  }),
  useHubCallOn:
    (environmentId: string) =>
    async (op: string, input: Record<string, unknown> = {}) => {
      calls.push({ environmentId, op, input });
      return {};
    },
}));

vi.mock("../aiAccount/AiAccountPanel", () => ({
  useAiAccounts: () => ({
    loading: false,
    accounts: [
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        service: "Claude",
        email: "ana@firma.example",
        plan: "Claude Max",
        kind: "personal",
        state: "signed-in",
      },
    ],
  }),
}));

vi.mock("../connectors/connectorsClient", () => ({
  useConnectorsQuery: () => ({ data: { connections: [] }, error: null, refresh: () => undefined }),
}));

vi.mock("../../state/environments", () => ({
  useConnectedEnvironmentIds: () => ["env-pc", "env-srv-birou"],
  useEnvironments: () => ({
    environments: [
      { environmentId: "env-pc", label: "PC-ul lui Alex" },
      { environmentId: "env-srv-birou", label: "srv-birou" },
    ],
  }),
}));

const { CompanyAiSection, CompanyServerSection } = await import("./CompanyServer");

const romanian = () => {
  setZenLocalePreference("ro");
  return { [Symbol.dispose]: () => setZenLocalePreference("auto") };
};
const dark = (on: boolean) => document.documentElement.classList.toggle("dark", on);
/** A fresh call log, and light mode back after the test. */
const fresh = () => {
  calls.splice(0);
  consents = {};
  return { [Symbol.dispose]: () => void dark(false) };
};

const pcStatus = status({ hubEnvironment: { id: "henv-pc", name: "PC-ul lui Alex" } });

describe("company server and AI account", () => {
  it("an owner without a server chooses one of their computers from Cont AI", async () => {
    using _ro = romanian();
    using _fresh = fresh();
    statuses = {
      "env-pc": pcStatus,
      "env-srv-birou": status({ hubEnvironment: { id: "henv-srv-birou", name: "srv-birou" } }),
    };
    await page.viewport(1000, 820);
    await using _screen = await render(
      <div className="bg-background p-6" style={{ maxWidth: 900 }}>
        <CompanyAiSection
          companyId={COMPANY}
          status={pcStatus}
          detail={detail([])}
          manager
          environmentId={"env-pc" as never}
          reload={() => undefined}
        />
      </div>,
    );
    await expect
      .element(page.getByText("Contul AI al firmei se alege pe serverul firmei", { exact: false }))
      .toBeVisible();
    await expect.element(page.getByText("Firma nu are încă un server.")).toBeVisible();
    await expect.element(page.getByText("Alege serverul firmei")).toBeVisible();
    // The personal PC says it must stay on; the server only that it must stay connected.
    await expect
      .element(page.getByText(/Pe un laptop sau PC personal, angajații AI se opresc/))
      .toBeVisible();
    // No jargon in the Office text.
    expect(document.body.textContent).not.toMatch(/runner|seat/i);
    await page.screenshot({ path: "__screens__/cont-ai-fara-server-light.png" });
    dark(true);
    await page.screenshot({ path: "__screens__/cont-ai-fara-server-dark.png" });
    dark(false);
    const buttons = page.getByRole("button", { name: "Fă-l serverul firmei" });
    expect(buttons.elements()).toHaveLength(2);
    await buttons.nth(1).click();
    // It asks first (AI account, connections, "Am înțeles"); nothing changes before that.
    await expect.element(page.getByTestId("server-setup-dialog")).toBeVisible();
    expect(calls).toEqual([]);
  });

  it("with srv-birou as the company server, the owner picks the AI account right there", async () => {
    using _ro = romanian();
    using _fresh = fresh();
    statuses = {
      "env-pc": pcStatus,
      "env-srv-birou": status({
        hubEnvironment: { id: "henv-srv-birou", name: "srv-birou" },
        serves: true,
        companyAi: { [COMPANY]: { provider: "claude", mode: "seat", label: "Contul serverului" } },
      }),
    };
    await page.viewport(1000, 720);
    await using _screen = await render(
      <div className="bg-background p-6" style={{ maxWidth: 900 }}>
        <CompanyAiSection
          companyId={COMPANY}
          status={pcStatus}
          detail={detail([
            officeRunner({ provider: "claude", mode: "seat", label: "Contul serverului" }),
          ])}
          manager
          environmentId={"env-pc" as never}
          reload={() => undefined}
        />
      </div>,
    );
    await expect.element(page.getByText("Pe srv-birou")).toBeVisible();
    await expect.element(page.getByTestId("ai-account-form")).toBeVisible();
    expect(page.getByTestId("manage-on-server").elements()[0]).not.toBeVisible();
    await page.screenshot({ path: "__screens__/cont-ai-server-light.png" });
    dark(true);
    await page.screenshot({ path: "__screens__/cont-ai-server-dark.png" });
    dark(false);
    await page.getByRole("radio", { name: "Cheie API a firmei" }).click();
    await page.getByRole("textbox", { name: "Cheie API" }).fill("sk-ant-test");
    await page.getByRole("button", { name: "Salvează" }).click();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      environmentId: "env-srv-birou",
      op: "runner.aiAccount.set",
      input: {
        hubCompanyId: COMPANY,
        account: {
          provider: "claude",
          mode: "api-key",
          label: "Contul serverului",
          apiKey: "sk-ant-test",
        },
      },
    });
  });

  it("a member sees the server and its account, with nothing to click", async () => {
    using _ro = romanian();
    using _fresh = fresh();
    statuses = { "env-pc": pcStatus };
    await page.viewport(1000, 520);
    await using _screen = await render(
      <div className="bg-background p-6" style={{ maxWidth: 900 }}>
        <CompanyAiSection
          companyId={COMPANY}
          status={pcStatus}
          detail={detail(
            [officeRunner({ provider: "claude", mode: "api-key", label: "Cheia firmei" })],
            "member",
          )}
          manager={false}
          environmentId={"env-pc" as never}
          reload={() => undefined}
        />
      </div>,
    );
    await expect.element(page.getByText("Cont: Cheia firmei")).toBeVisible();
    await expect
      .element(
        page.getByText("Doar proprietarii și administratorii schimbă serverul și contul AI."),
      )
      .toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
    await page.screenshot({ path: "__screens__/cont-ai-membru-light.png" });
    dark(true);
    await page.screenshot({ path: "__screens__/cont-ai-membru-dark.png" });
  });

  it("the Server tab lists the company server and lets the owner change it", async () => {
    using _ro = romanian();
    using _fresh = fresh();
    statuses = {
      "env-pc": pcStatus,
      "env-srv-birou": status({
        hubEnvironment: { id: "henv-srv-birou", name: "srv-birou" },
        serves: true,
      }),
    };
    await page.viewport(1000, 760);
    await using _screen = await render(
      <div className="bg-background p-6" style={{ maxWidth: 900 }}>
        <CompanyServerSection
          companyId={COMPANY}
          status={pcStatus}
          detail={detail([officeRunner()])}
          manager
          environmentId={"env-pc" as never}
          reload={() => undefined}
        />
      </div>,
    );
    await expect
      .element(
        page.getByText("Serverul firmei e calculatorul pe care lucrează angajații AI", {
          exact: false,
        }),
      )
      .toBeVisible();
    await expect.element(page.getByText("servește 5 firme")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Nu mai e serverul firmei" }))
      .toBeVisible();
    expect(document.body.textContent).not.toMatch(/runner|seat/i);
    await page.screenshot({ path: "__screens__/server-light.png" });
    dark(true);
    await page.screenshot({ path: "__screens__/server-dark.png" });
  });

  it("the Server tab for a member: status only", async () => {
    using _ro = romanian();
    using _fresh = fresh();
    statuses = { "env-pc": pcStatus };
    await page.viewport(1000, 420);
    await using _screen = await render(
      <div className="bg-background p-6" style={{ maxWidth: 900 }}>
        <CompanyServerSection
          companyId={COMPANY}
          status={pcStatus}
          detail={detail([], "member")}
          manager={false}
          environmentId={"env-pc" as never}
          reload={() => undefined}
        />
      </div>,
    );
    await expect
      .element(
        page.getByText("Firma nu are încă un server. Îl alege un proprietar sau un administrator."),
      )
      .toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
    await page.screenshot({ path: "__screens__/server-membru-light.png" });
    dark(true);
    await page.screenshot({ path: "__screens__/server-membru-dark.png" });
  });

  it("with colleagues, the company server takes only a company API key", async () => {
    using _ro = romanian();
    using _fresh = fresh();
    const seat = { provider: "claude" as const, mode: "seat" as const, label: "Abonamentul meu" };
    statuses = {
      "env-pc": pcStatus,
      "env-srv-birou": status({
        hubEnvironment: { id: "henv-srv-birou", name: "srv-birou" },
        serves: true,
        companyAi: { [COMPANY]: seat },
      }),
    };
    // Confirmed with "Am înțeles" before colleagues joined (on the owner's subscription).
    consents = {
      "env-srv-birou": {
        [COMPANY]: {
          account: { provider: "claude", mode: "seat", label: "Abonamentul meu", personal: true },
          shared: [],
          confirmedAt: "2026-11-08T10:00:00.000Z",
        },
      },
    };
    const team = [
      { userId: "u_alex", email: me.email, name: me.name, role: "owner", joinedAt: "" },
      { userId: "u_maria", email: "maria@x", name: "Maria", role: "member", joinedAt: "" },
    ] as unknown as ZenHubCompanyDetail["members"];
    await page.viewport(1000, 900);
    await using _screen = await render(
      <div className="bg-background p-6" style={{ maxWidth: 900 }}>
        <CompanyServerSection
          companyId={COMPANY}
          status={pcStatus}
          detail={detail([officeRunner(seat)], "owner", team)}
          manager
          environmentId={"env-pc" as never}
          reload={() => undefined}
        />
      </div>,
    );
    // The server is chosen, but it waits for the company key before colleagues can use it.
    await expect.element(page.getByTestId("server-key-step")).toBeVisible();
    await expect
      .element(page.getByText(/Colegii nu-l pot folosi încă: adaugă cheia API a firmei/))
      .toBeVisible();
    // No personal subscription to choose once there are colleagues; a console link instead.
    expect(page.getByRole("radio").elements()).toHaveLength(0);
    await expect.element(page.getByTestId("provider-console")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/runner|seat/i);
    await page.screenshot({ path: "__screens__/server-cheie-firma-light.png" });
    await page.getByRole("textbox", { name: "Cheie API" }).fill("sk-ant-firma");
    await page.getByRole("button", { name: "Salvează" }).click();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.input).toMatchObject({
      hubCompanyId: COMPANY,
      account: { provider: "claude", mode: "api-key", apiKey: "sk-ant-firma" },
    });
  });

  it("alone, the owner may keep the subscription, with the warning", async () => {
    using _ro = romanian();
    using _fresh = fresh();
    const seat = { provider: "claude" as const, mode: "seat" as const, label: "Abonamentul meu" };
    statuses = {
      "env-pc": pcStatus,
      "env-srv-birou": status({
        hubEnvironment: { id: "henv-srv-birou", name: "srv-birou" },
        serves: true,
        companyAi: { [COMPANY]: seat },
      }),
    };
    const alone = [
      { userId: "u_alex", email: me.email, name: me.name, role: "owner", joinedAt: "" },
    ] as unknown as ZenHubCompanyDetail["members"];
    await using _screen = await render(
      <div className="bg-background p-6" style={{ maxWidth: 900 }}>
        <CompanyAiSection
          companyId={COMPANY}
          status={pcStatus}
          detail={detail([officeRunner(seat)], "owner", alone)}
          manager
          environmentId={"env-pc" as never}
          reload={() => undefined}
        />
      </div>,
    );
    await expect
      .element(page.getByRole("radio", { name: "Abonamentul meu (doar pentru mine)" }))
      .toBeVisible();
    await expect
      .element(
        page
          .getByText(
            "Doar pentru tine. Colegii lucrează cu contul lor de AI; ca serverul să lucreze și pentru ei, adaugă o cheie API a firmei.",
          )
          .first(),
      )
      .toBeVisible();
    await expect.element(page.getByTestId("not-for-colleagues")).toBeVisible();
  });
});
