// Zen Staff: "Keep this change in the pack?" above the composer, when the person's message asks
// to change a pack ("la reels vreau voce și muzica mai încet"). It opens the "Personalizează"
// dialog with the message as the request; detection is customizeIntent (no model). Rendered by
// ZenConnectDock. ZEN.md, "Customized packs".
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { localizeWorkflowManifest } from "@t3tools/contracts/zenOffice";
import { AsyncResult } from "effect/reactivity";
import { WandSparklesIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { CustomizeDialog } from "./CustomPacks";
import { customPacksText } from "./customPacks.i18n";
import { customizeIntent, threadWorkflowId } from "./customPacksState";
import { officeWorkflows } from "./officeState";
import { useOfficeCompany } from "./useOfficeCompany";

export interface CustomizeChatMessage {
  readonly id: string;
  readonly text: string;
  readonly streaming?: boolean;
  /** The thread's first message (a workflow message names the workflow that ran). */
  readonly firstText?: string | null;
  readonly isFirst?: boolean;
  /** When it was sent (epoch ms), for the intake quick replies. */
  readonly createdAtMs?: number | null;
}

export function ZenCustomizeChatCard(props: {
  readonly environmentId: EnvironmentId;
  readonly message: CustomizeChatMessage | null;
}) {
  const t = useZenText(customPacksText);
  const locale = useZenLocale();
  const { workflowsInput } = useOfficeCompany();
  const result = useAtomValue(
    officeWorkflows({ environmentId: props.environmentId, input: workflowsInput }),
  );
  const workflows = AsyncResult.isSuccess(result) ? result.value.workflows : null;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<{ readonly id: string; readonly request: string } | null>(null);
  const message = props.message;
  const intent =
    workflows === null || message === null || message.streaming
      ? null
      : customizeIntent({
          text: message.text,
          isFirstMessage: message.isFirst ?? false,
          threadWorkflowId: threadWorkflowId(message.firstText ?? null, workflows),
          workflows,
        });
  const workflow = intent
    ? workflows?.find((candidate) => candidate.manifest.id === intent.workflowId)
    : undefined;
  const name = workflow ? localizeWorkflowManifest(workflow.manifest, locale).name : "";

  if (open) {
    return (
      <CustomizeDialog
        environmentId={props.environmentId}
        workflowId={open.id}
        name={name}
        initialRequest={open.request}
        onClose={() => {
          setOpen(null);
          if (message) setDismissed((current) => new Set([...current, message.id]));
        }}
      />
    );
  }
  if (!intent || !workflow || !message || dismissed.has(message.id)) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
      data-zen-customize-card={intent.workflowId}
    >
      <WandSparklesIcon className="size-4 shrink-0 text-primary" />
      <div className="min-w-48 flex-1">
        <p className="font-medium text-sm">{t.chatCardTitle(name)}</p>
        <p className="text-muted-foreground text-xs">{t.chatCardBody}</p>
      </div>
      <div className="flex gap-1.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setDismissed((current) => new Set([...current, message.id]))}
        >
          {t.notNow}
        </Button>
        <Button
          size="xs"
          onClick={() => setOpen({ id: intent.workflowId, request: intent.request })}
        >
          {t.chatCardAction}
        </Button>
      </div>
    </div>
  );
}
