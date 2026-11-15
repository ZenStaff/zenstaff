// Zen Staff: "Save this as a workflow" in the chat header (Office only). Asks the server for a
// draft of the conversation (Haiku generalizes it into questions and instructions), then opens the
// workflow editor prefilled with it. Hooked into ChatHeader.tsx next to the memory toggle.
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BookmarkPlusIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useAtomCommand } from "../../state/use-atom-command";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeChatText } from "./officeChat.i18n";
import { draftOfficeWorkflow } from "./officeState";
import { stashWorkflowDraft } from "./officeWorkflowTools";
import { useZenOffice } from "./useZenEdition";

export function ZenSaveAsWorkflowButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
}) {
  const office = useZenOffice();
  const t = useZenText(officeChatText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const draft = useAtomCommand(draftOfficeWorkflow, { label: t.saveAsWorkflow });
  if (!office) return null;
  const run = async () => {
    setBusy(true);
    const result = await draft({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, locale },
    });
    setBusy(false);
    if (result._tag !== "Success") return;
    stashWorkflowDraft(result.value);
    if (result.value.method === "basic") toastManager.add({ type: "info", title: t.draftBasic });
    void navigate({ to: "/workflow-editor", search: { zenDraft: "thread" } });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={busy ? t.draftingWorkflow : t.saveAsWorkflow}
            disabled={busy}
            data-zen-save-as-workflow
            onClick={() => void run()}
            className="shrink-0"
          />
        }
      >
        {busy ? (
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
        ) : (
          <BookmarkPlusIcon aria-hidden className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-72">
        <span className="font-medium">{busy ? t.draftingWorkflow : t.saveAsWorkflow}</span>
        <br />
        {t.saveAsWorkflowHint}
      </TooltipPopup>
    </Tooltip>
  );
}
