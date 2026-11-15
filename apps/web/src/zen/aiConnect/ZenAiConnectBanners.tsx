// Zen Staff "Conectează-ți AI-ul" in upstream's chat banners (Office): a provider that is not
// installed or not signed in shows "Connect your AI" instead of upstream's "sign in via the CLI"
// banner, and a thread error that means the same gets the button next to it. Upstream files call
// these with one line each (ProviderStatusBanner.tsx, ThreadErrorBanner.tsx). ZEN.md.
import type { ServerProvider } from "@t3tools/contracts";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { aiAccountFromProvider } from "../aiAccount/aiAccountModel";
import { useZenText } from "../i18n/zenI18n";
import { useZenOffice } from "../office/useZenEdition";
import { ZenAiConnectButton } from "./AiConnectPanel";
import { aiConnectText } from "./aiConnect.i18n";
import { isAiNotConnectedError } from "./aiConnectClient";

const CONNECTABLE = new Set(["claudeAgent", "codex", "antigravity"]);

/** Whether Office replaces upstream's provider banner for this status. */
function zenAiConnectReplacesBanner(status: ServerProvider | null): boolean {
  if (!status || !CONNECTABLE.has(String(status.driver)) || status.status === "disabled")
    return false;
  const state = aiAccountFromProvider(status).state;
  return state === "not-installed" || state === "signed-out";
}

/** Office: the "Connect your AI" banner for a provider that is not connected, else null. */
export function useZenAiConnectProviderBanner(status: ServerProvider | null): ReactNode {
  const office = useZenOffice();
  const t = useZenText(aiConnectText);
  if (!office || !status || !zenAiConnectReplacesBanner(status)) return null;
  const service = aiAccountFromProvider(status).service;
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[calc(100%-2rem)] pt-3">
      <Alert
        variant="warning"
        surface="glass"
        controlAlignment="first-line"
        data-zen-ai-connect-chat
      >
        <CircleAlertIcon />
        <AlertTitle>{t.notConnected(service)}</AlertTitle>
        <AlertDescription>
          <div className="flex flex-col gap-2">
            <p>{t.notConnectedBody}</p>
            <div className="flex justify-end">
              <ZenAiConnectButton size="xs" />
            </div>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

/** Office: "Connect your AI" next to a thread error that means the AI is not signed in. */
export function ZenAiConnectErrorAction(props: { readonly error: string | null }) {
  const office = useZenOffice();
  if (!office || !isAiNotConnectedError(props.error)) return null;
  return <ZenAiConnectButton size="sm" />;
}
