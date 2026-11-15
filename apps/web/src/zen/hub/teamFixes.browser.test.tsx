// Review 0.2.3 fixes, rendered in Romanian, light and dark: the company server confirmation
// (P0-6), the pending confirmation on an older server, "Ce văd proprietarii despre tine" (P1-20)
// and "Sarcinile tale pe serverul firmei" (P1-19). Fixed answers stand in for the server.
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { setZenLocalePreference } from "../i18n/zenI18n";
import "../../index.css";

vi.mock("../aiAccount/AiAccountPanel", () => ({
  useAiAccounts: () => ({
    loading: false,
    accounts: [
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        service: "Claude",
        email: "ion@mail.example",
        plan: "Claude Max",
        kind: "personal",
        state: "signed-in",
      },
    ],
  }),
}));

vi.mock("../connectors/connectorsClient", () => ({
  useConnectorsQuery: () => ({
    data: {
      connections: [
        { name: "claude.ai Salarizare", origin: "account", appName: null },
        { name: "claude.ai Facebook", origin: "account", appName: "Facebook" },
        { name: "claude.ai Trello", origin: "account", appName: "Trello" },
        { name: "t3-code", origin: "user", appName: null },
      ],
    },
    error: null,
    refresh: () => undefined,
  }),
}));

vi.mock("./hubClient", () => ({
  hubErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "x"),
  useHubCall: () => ({ environmentId: "env", call: async () => ({}) }),
}));

const { ServerSetupDialog } = await import("./ServerSetupDialog");
const { ServerConsentRow } = await import("./ServerConsentRow");
const { WhatOwnersSee } = await import("./WhatOwnersSee");
const { MyRunnerTasks } = await import("./MyRunnerTasks");

/** Kept next to the test like the other hub screens (copied to the review folder by hand). */
const SHOTS = "__screens__";
const shoot = true;

const romanian = () => {
  setZenLocalePreference("ro");
  return { [Symbol.dispose]: () => setZenLocalePreference("auto") };
};

const themed = (dark: boolean) => {
  document.documentElement.classList.toggle("dark", dark);
  return { [Symbol.dispose]: () => document.documentElement.classList.remove("dark") };
};

const Frame = (props: { readonly children: ReactNode; readonly width?: number }) => (
  <div className="min-h-screen bg-background p-6 text-foreground">
    <div style={{ maxWidth: props.width ?? 760 }}>{props.children}</div>
  </div>
);

describe("company server confirmation (P0-6)", () => {
  it.each([false, true])(
    "asks before the server goes live, shares nothing by default (dark: %s)",
    async (dark) => {
      using _ro = romanian();
      using _theme = themed(dark);
      await page.viewport(900, 1100);
      const calls: Array<{ op: string; input: Record<string, unknown> }> = [];
      await using _screen = await render(
        <ServerSetupDialog
          environmentId={"env" as never}
          companyId="hub-iris"
          companyName="Florăria Iris"
          mode="enable"
          hasStoredKey={false}
          memberCount={1}
          call={
            (async (op: string, input: Record<string, unknown>) => {
              calls.push({ op, input });
              return {};
            }) as never
          }
          onClose={() => undefined}
          onDone={() => undefined}
        />,
      );
      await expect
        .element(page.getByText("Fă din acest calculator serverul firmei Florăria Iris"))
        .toBeVisible();
      await expect.element(page.getByTestId("server-setup-personal-warning")).toBeVisible();
      await expect.element(page.getByTestId("server-setup-choose")).toBeVisible();
      for (const name of ["claude.ai Salarizare", "claude.ai Facebook", "claude.ai Trello"]) {
        await expect.element(page.getByTestId(`server-setup-connector-${name}`)).not.toBeChecked();
      }
      expect(page.getByText("t3-code").elements()).toHaveLength(0);
      await expect.element(page.getByText(/modul „Automat”/)).toBeVisible();
      await expect.element(page.getByText(/așteaptă „Aprobă” în „De aprobat”/)).toBeVisible();
      await expect.element(page.getByTestId("server-setup-submit")).toBeDisabled();
      if (shoot)
        await page.screenshot({
          path: `${SHOTS}/p0-6-server-dialog-${dark ? "dark" : "light"}.png`,
        });

      // Choosing the account alone is not enough: "Am înțeles" is required too.
      await page.getByTestId("server-setup-seat").click();
      await expect.element(page.getByTestId("server-setup-submit")).toBeDisabled();
      await page.getByTestId("server-setup-connector-claude.ai Trello").click();
      await page.getByTestId("server-setup-acknowledge").click();
      await expect.element(page.getByTestId("server-setup-submit")).toBeEnabled();
      await page.getByTestId("server-setup-submit").click();
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.op).toBe("runner.set");
      const confirm = calls[0]!.input.confirm as Record<string, unknown>;
      expect(confirm.shared).toEqual(["claude.ai Trello"]);
      expect(confirm.account).toMatchObject({ mode: "seat", personal: true });
    },
  );

  it("warns on a server made before the confirmation existed", async () => {
    using _ro = romanian();
    await page.viewport(800, 300);
    await using _screen = await render(
      <Frame>
        <ServerConsentRow consent={null} loaded onConfirm={() => undefined} />
      </Frame>,
    );
    await expect.element(page.getByText("Confirmă ce folosește serverul firmei")).toBeVisible();
    if (shoot) await page.screenshot({ path: `${SHOTS}/p0-6-server-pending-light.png` });
  });
});

describe("member experience (P1-19, P1-20)", () => {
  it.each([false, true])(
    "shows what owners see and my tasks on the company server (dark: %s)",
    async (dark) => {
      using _ro = romanian();
      using _theme = themed(dark);
      // Stored as the task dialog leaves it (the list itself prunes by age, runnerTasks.test.ts).
      localStorage.setItem(
        "zen:runner-tasks",
        JSON.stringify([
          {
            companyId: "florarie",
            staffId: "s1",
            runId: "run-1",
            agentName: "Ioana",
            title: "Oferta pentru nunta de sâmbătă",
            startedAt: "2026-11-08T10:00:00.000Z",
          },
        ]),
      );
      await page.viewport(900, 900);
      await using _screen = await render(
        <Frame width={820}>
          <div className="flex flex-col gap-6">
            <MyRunnerTasks companyId="florarie" />
            <WhatOwnersSee />
          </div>
        </Frame>,
      );
      await expect.element(page.getByText("Sarcinile tale pe serverul firmei")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Urmărește live" })).toBeVisible();
      await expect
        .element(page.getByText("Ce văd proprietarii și administratorii firmei despre tine"))
        .toBeVisible();
      await expect.element(page.getByText(/Chaturile tale personale/)).toBeVisible();
      if (shoot)
        await page.screenshot({ path: `${SHOTS}/p1-19-20-member-${dark ? "dark" : "light"}.png` });
    },
  );
});
