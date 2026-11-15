// Review 0.2.3 fixes in Office, rendered in Romanian, light and dark: the grey line for an AI
// assistant that is not installed (P1-7) and the note above the subscription limits (P1-12).
import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { setZenLocalePreference } from "../i18n/zenI18n";
import { OfficeProviderNotice } from "./OfficeProviderNotice";
import { ZenOfficeUsageNote } from "./ZenOfficeUsageNote";
import "../../index.css";

const codex = {
  instanceId: "codex",
  driver: "codex",
  displayName: "Codex",
  installed: false,
  enabled: true,
  status: "error",
  message: "Could not start Codex CLI (`codex`). Check Settings → Providers → Codex → Binary path.",
  auth: { status: "unknown" },
} as unknown as ServerProvider;

describe("Office review fixes", () => {
  it.each([false, true])("reads calm and Romanian (dark: %s)", async (dark) => {
    setZenLocalePreference("ro");
    document.documentElement.classList.toggle("dark", dark);
    await using _cleanup = {
      [Symbol.asyncDispose]: async () => {
        setZenLocalePreference("auto");
        document.documentElement.classList.remove("dark");
      },
    };
    await page.viewport(900, 360);
    await using _screen = await render(
      <div className="min-h-screen bg-background p-6 text-foreground">
        <div className="flex max-w-3xl flex-col gap-6">
          <OfficeProviderNotice
            status={codex}
            onDismiss={() => undefined}
            onOpenProviderSetup={() => undefined}
          />
          <ZenOfficeUsageNote />
        </div>
      </div>,
    );
    await expect.element(page.getByText("ChatGPT nu e instalat pe acest calculator")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Instalează" })).toBeVisible();
    expect(page.getByText(/Codex CLI|Binary path/).elements()).toHaveLength(0);
    await expect
      .element(page.getByText(/linia verticală e cât a rămas din perioadă/))
      .toBeVisible();
    await page.screenshot({
      path: `__screens__/p1-7-12-office-${dark ? "dark" : "light"}.png`,
    });
  });
});
