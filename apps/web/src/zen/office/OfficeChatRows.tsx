// Zen Staff: Office wording inside two upstream chat rows. A pending approval says in plain words
// what the assistant wants to do, with the raw command behind "Details"; a workflow's first
// message shows the person's answers, with the English instructions behind "Details". Hooked
// into TimelinePendingApprovalRow.tsx and TimelineUserMessageRow.tsx (ZEN.md, "What Office hides").
import { splitWorkflowMessage } from "@t3tools/contracts/zenOffice";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useZenText } from "../i18n/zenI18n";
import { trustText } from "../trust/trust.i18n";
import {
  describeApproval,
  isInFolderApprovalAction,
  isRiskyApprovalAction,
} from "./officeApprovals";
import { officeChatText } from "./officeChat.i18n";
import { useZenOffice } from "./useZenEdition";

function DetailsToggle(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly label?: string;
}) {
  const t = useZenText(officeChatText);
  return (
    <button
      type="button"
      aria-expanded={props.open}
      onClick={props.onToggle}
      className="inline-flex items-center gap-0.5 text-muted-foreground text-xs hover:text-foreground"
      data-zen-no-translate
    >
      <ChevronRightIcon
        aria-hidden
        className={
          props.open ? "size-3 rotate-90 transition-transform" : "size-3 transition-transform"
        }
      />
      {props.open ? t.hideDetails : (props.label ?? t.details)}
    </button>
  );
}

/**
 * The label of a pending approval row. In Code it is upstream's raw detail (`children`); in
 * Office a sentence such as "Check the website example.com", with the raw text under Details.
 */
export function ZenOfficeApprovalLabel(props: {
  readonly approval: { readonly requestKind: string; readonly detail?: string | undefined };
  readonly children: ReactNode;
}) {
  const office = useZenOffice();
  const t = useZenText(officeChatText);
  const trust = useZenText(trustText);
  const [open, setOpen] = useState(false);
  if (!office) return props.children;
  const described = describeApproval(props.approval);
  const sentence = t.approval[described.action](described.subject);
  const risky = isRiskyApprovalAction(described.action);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-zen-office-approval={described.action}>
      <span className="text-muted-foreground text-xs" data-zen-no-translate>
        {t.approvalAsks}
      </span>
      <span className="min-w-0 text-foreground text-sm wrap-anywhere" data-zen-no-translate>
        {sentence}
        {described.steps > 1 ? (
          <span className="text-muted-foreground"> ({t.approvalMoreSteps(described.steps)})</span>
        ) : null}
      </span>
      {risky ? (
        <span className="inline-flex items-center gap-1 text-warning text-xs" data-zen-no-translate>
          <TriangleAlertIcon aria-hidden className="size-3 shrink-0" />
          {t.approvalRisky}
        </span>
      ) : null}
      <span className="text-muted-foreground text-xs" data-zen-no-translate>
        {isInFolderApprovalAction(described.action) ? trust.approvalStepRule : trust.approvalRule}
      </span>
      {props.approval.detail ? (
        <div className="flex flex-col gap-1">
          <DetailsToggle open={open} onToggle={() => setOpen((value) => !value)} />
          {open ? props.children : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Upstream's collapsible user message, with `text` reduced to the person's answers when the
 * message started an Office workflow. `details` renders the hidden instructions on demand.
 */
export function useZenOfficeUserMessage<T extends { readonly text: string }>(
  props: T,
): T & { readonly zenDetails: ReactNode } {
  const office = useZenOffice();
  const split = office ? splitWorkflowMessage(props.text) : null;
  if (split === null) return { ...props, zenDetails: null };
  return {
    ...props,
    text: split.summary,
    zenDetails: <ZenOfficeInstructionsDetails instructions={split.instructions} />,
  };
}

function ZenOfficeInstructionsDetails(props: { readonly instructions: string }) {
  const t = useZenText(officeChatText);
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 flex flex-col gap-1" data-zen-workflow-instructions>
      <DetailsToggle open={open} onToggle={() => setOpen((value) => !value)} />
      {open ? (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs" data-zen-no-translate>
            {t.instructionsShown}
          </span>
          <pre
            className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 font-sans text-xs leading-5"
            data-zen-no-translate
          >
            {props.instructions}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
