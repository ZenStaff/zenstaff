// "Conectează-ți AI-ul" cards rendered in each state, light and dark, in Romanian. The account
// detection is stubbed (the states the provider snapshot would produce after a real sign-in);
// screenshots land in __screens__/ for ZEN.md "Connect your AI".
import type { AiConnectJob } from "@t3tools/contracts/zenCompanies";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { AiAccount } from "../aiAccount/aiAccountModel";
import { setZenLocalePreference } from "../i18n/zenI18n";
import { ConnectCard } from "./AiConnectPanel";
import { type CardView, progressFromJob } from "./aiConnectFlow.logic";
import "../../index.css";

const account = (service: string, email: string, plan: string): AiAccount => ({
  instanceId: service,
  driver: service,
  service,
  email,
  plan,
  kind: "personal",
  state: "signed-in",
});

const job = (patch: Partial<AiConnectJob>): AiConnectJob => ({
  id: "j",
  provider: "codex",
  mode: "connect",
  phase: "running",
  step: "download",
  done: [],
  skipped: [],
  attempt: 1,
  loginUrl: null,
  acceptsCode: false,
  codeSubmitted: false,
  binaryPath: null,
  binaryOnPath: false,
  error: null,
  log: "",
  startedAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
  ...patch,
});

const views: ReadonlyArray<{ service: "claude" | "codex" | "google"; view: CardView }> = [
  {
    service: "claude",
    view: { kind: "in-use", account: account("Claude", "ana@firma.example", "Claude Pro") },
  },
  {
    service: "codex",
    view: { kind: "found", account: account("ChatGPT", "ana@firma.example", "ChatGPT Plus") },
  },
  {
    service: "google",
    view: {
      kind: "failed",
      code: "network",
      detail: "The installer could not be downloaded. Check the internet connection.",
      log: "Downloading https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.4.5-linux-x86_64.zip\nfetch failed",
    },
  },
];

function Cards(props: { readonly dark: boolean; readonly extra?: CardView }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex max-w-xl flex-col gap-2 p-6 text-foreground">
        {views.map(({ service, view }) => (
          <ConnectCard
            key={service}
            service={service}
            view={view}
            error={null}
            onConnect={vi.fn()}
            onOtherAccount={vi.fn()}
            onCancel={vi.fn()}
            onSubmit={async () => undefined}
          />
        ))}
        {props.extra ? (
          <ConnectCard
            service="codex"
            view={props.extra}
            error={null}
            onConnect={vi.fn()}
            onOtherAccount={vi.fn()}
            onCancel={vi.fn()}
            onSubmit={async () => undefined}
          />
        ) : null}
      </div>
    </div>
  );
}

describe("Connect your AI cards", () => {
  it.each([false, true])(
    "shows the confirmed, found and failed states (dark: %s)",
    async (dark) => {
      setZenLocalePreference("ro");
      document.documentElement.classList.toggle("dark", dark);
      await page.viewport(720, 760);
      await using _screen = await render(
        <Cards
          dark={dark}
          extra={{
            kind: "working",
            progress: progressFromJob(job({ step: "download", attempt: 2 }))!,
          }}
        />,
      );
      await expect
        .element(page.getByText("Gata: lucrăm pe contul tău Claude Pro (ana@firma.example)"))
        .toBeVisible();
      await expect
        .element(
          page.getByText("Conectat: ChatGPT Plus (ana@firma.example). Lucrăm pe acest cont?"),
        )
        .toBeVisible();
      await expect.element(page.getByRole("button", { name: "Da, folosește-l" })).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Încearcă din nou" })).toBeVisible();
      await expect.element(page.getByText("Încerc din nou (încercarea 2)…")).toBeVisible();
      await page.getByRole("button", { name: "Vezi detalii" }).click();
      await expect.element(page.getByText(/fetch failed/)).toBeVisible();
      await page.screenshot({
        path: `__screens__/ai-connect-states-${dark ? "dark" : "light"}.png`,
      });
      setZenLocalePreference("auto");
      document.documentElement.classList.remove("dark");
    },
  );
});
