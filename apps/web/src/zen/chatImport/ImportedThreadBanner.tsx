// Zen Staff chat imports: the notice above the composer of an imported chat. Imported chats are
// read-only archives, so the composer is hidden here and "Continue in a new chat" starts a
// normal chat whose context is a summary of this one. Hook: ChatView.tsx.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { zenImportSourceOfThread, type ZenImportSource } from "@t3tools/contracts/zenImports";
import { useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { ArchiveIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { toastManager } from "../../components/ui/toast";
import { useAtomCommand } from "../../state/use-atom-command";
import { useZenText } from "../i18n/zenI18n";
import { chatImportText } from "./chatImport.i18n";
import { continueImport } from "./chatImportState";

const SOURCE_KEY = {
  chatgpt: "sourceChatgpt",
  claude: "sourceClaude",
  gemini: "sourceGemini",
} as const satisfies Record<ZenImportSource, keyof typeof chatImportText.en>;

// Everything after the banner in the chat column is the composer: an archive takes no messages.
const HIDE_COMPOSER = "[data-zen-import-banner] ~ * { display: none !important; }";

export function ZenImportedThreadBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const t = useZenText(chatImportText);
  const navigate = useNavigate();
  const continueThread = useAtomCommand(continueImport, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const source = zenImportSourceOfThread(props.threadId);
  if (source === null) return null;

  const onContinue = async () => {
    setBusy(true);
    const outcome = await continueThread({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    });
    setBusy(false);
    if (outcome._tag !== "Success") {
      const error = Cause.squash(outcome.cause);
      toastManager.add({
        type: "error",
        title: t.continueFailed,
        description: error instanceof Error ? error.message : t.continueFailed,
      });
      return;
    }
    if (outcome.value.summary === "excerpt")
      toastManager.add({ type: "info", title: t.continuedExcerpt });
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: props.environmentId, threadId: outcome.value.threadId },
    });
  };

  return (
    <div data-zen-import-banner className="px-3 pb-3">
      <style>{HIDE_COMPOSER}</style>
      <Alert variant="info">
        <ArchiveIcon />
        <AlertTitle>{t.bannerTitle(t[SOURCE_KEY[source]])}</AlertTitle>
        <AlertDescription>{t.bannerBody}</AlertDescription>
        <AlertAction>
          <Button size="sm" disabled={busy} onClick={() => void onContinue()}>
            {busy ? <Spinner /> : null}
            {busy ? t.continuing : t.continueInNewChat}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
