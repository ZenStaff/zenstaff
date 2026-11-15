// Zen Staff: the chat's client approval links above the composer (Trimis -> Văzut -> Aprobat /
// Modificări cerute), the client's comment with "Trimite agentului", copy and withdraw, and a toast
// when a client opens or answers. Rendered by ZenConnectDock (Zen file), no upstream hook.
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  CheckIcon,
  CircleIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  Link2OffIcon,
  MessageSquareWarningIcon,
  SendIcon,
  VideoIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { cn, newMessageId } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { hubErrorMessage, useHubCall } from "../hub/hubClient";
import { useZenText } from "../i18n/zenI18n";
import { approvalsText } from "./approvals.i18n";
import {
  type ApprovalItem,
  type ApprovalStatus,
  approvalSteps,
  cardStatus,
  newStatuses,
} from "./approvalsModel";
import { refreshThreadApprovals, useThreadApprovals } from "./approvalsState";

/** Statuses seen in this app session, per link (so a toast fires once per change). */
const seen = new Map<string, ApprovalStatus>();

export function ZenApprovalDock(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
}) {
  const t = useZenText(approvalsText);
  const data = useThreadApprovals(props.environmentId, props.threadId);
  const items = data?.items ?? [];
  const first = useRef(true);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- announces a client's view or answer once, when the polled status changes
  useEffect(() => {
    if (data === null) return;
    const known = first.current
      ? new Map(
          items.flatMap((item) =>
            item.approval === null
              ? []
              : [[item.record.id, item.record.lastStatus as ApprovalStatus] as const],
          ),
        )
      : seen;
    first.current = false;
    for (const { item, status } of newStatuses(known, items)) {
      const words =
        status === "approved"
          ? t.noticeApproved(item.record.clientName, item.record.title)
          : status === "changes"
            ? t.noticeChanges(item.record.clientName, item.record.title)
            : status === "viewed"
              ? t.noticeViewed(item.record.clientName, item.record.title)
              : null;
      if (words !== null) {
        toastManager.add({ type: status === "changes" ? "warning" : "success", title: words });
      }
    }
    for (const item of items) {
      if (item.approval !== null) seen.set(item.record.id, item.approval.status);
    }
  }, [data, items, t]);

  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-zen-approval-dock>
      {items.slice(-3).map((item) => (
        <ApprovalCard
          key={item.record.id}
          environmentId={props.environmentId}
          threadId={props.threadId}
          item={item}
          offline={data?.offline === true}
        />
      ))}
    </div>
  );
}

function useSendToThread(environmentId: EnvironmentId, threadId: string) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId as never));
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (text: string): Promise<boolean> => {
    const result = await startTurn({
      environmentId,
      input: {
        threadId: threadId as never,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        ...(shell?.runtimeMode ? { runtimeMode: shell.runtimeMode } : {}),
        interactionMode: shell?.interactionMode ?? "default",
        createdAt: new Date().toISOString(),
      } as never,
    });
    return result._tag === "Success";
  };
}

function KindIcon({ kind }: { readonly kind: string | undefined }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  if (kind === "image") return <ImageIcon className={className} aria-hidden />;
  if (kind === "video") return <VideoIcon className={className} aria-hidden />;
  return <FileTextIcon className={className} aria-hidden />;
}

function Step(props: {
  readonly done: boolean;
  readonly label: string;
  readonly tone?: "ok" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        props.done ? "text-foreground" : "text-muted-foreground",
        props.done && props.tone === "warn" && "text-warning-foreground",
        props.done && props.tone === "ok" && "text-success-foreground",
      )}
    >
      {props.done ? (
        <CheckIcon className="size-3.5" aria-hidden />
      ) : (
        <CircleIcon className="size-3" aria-hidden />
      )}
      {props.label}
    </span>
  );
}

function ApprovalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly item: ApprovalItem;
  readonly offline: boolean;
}) {
  const t = useZenText(approvalsText);
  const { call } = useHubCall();
  const send = useSendToThread(props.environmentId, props.threadId);
  const [busy, setBusy] = useState(false);
  const [forwarded, setForwarded] = useState(false);
  const { record, approval } = props.item;
  const status = cardStatus(props.item);
  const steps = approvalSteps(approval?.status ?? "sent");
  const headline =
    status === "approved"
      ? t.statusApproved
      : status === "changes"
        ? t.statusChanges
        : status === "viewed"
          ? t.statusViewed
          : status === "sent"
            ? t.statusSent
            : status === "closed"
              ? t.statusClosed
              : t.statusUnknown;

  const forward = async () => {
    if (approval === null || approval.comment === null) return;
    setBusy(true);
    const sent = await send(t.changesMessage(record.title, record.clientName, approval.comment));
    setBusy(false);
    if (sent) setForwarded(true);
    else toastManager.add({ type: "error", title: t.tryAgain });
  };

  const revoke = async () => {
    setBusy(true);
    await call("approval.revoke", { id: record.id })
      .then(() => toastManager.add({ type: "success", title: t.revoked }))
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: t.failed,
          description: hubErrorMessage(cause, t.tryAgain),
        }),
      );
    refreshThreadApprovals(props.environmentId, props.threadId);
    setBusy(false);
  };

  const copy = () => {
    void navigator.clipboard
      .writeText(record.url)
      .then(() => toastManager.add({ type: "success", title: t.copied }))
      .catch(() => undefined);
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 text-sm shadow-xs",
        status === "changes" && "border-warning",
        status === "approved" && "border-success",
      )}
      data-zen-approval-card={status}
    >
      <div className="flex items-start gap-2">
        <KindIcon kind={record.files[0]?.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="min-w-0 truncate font-medium">
              {t.cardTitle(record.clientName)}: {record.title}
            </span>
            <span
              className={cn(
                "shrink-0 font-medium text-xs",
                status === "approved" && "text-success-foreground",
                status === "changes" && "text-warning-foreground",
              )}
              data-zen-approval-status
            >
              {headline}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <Step done label={t.stepSent} />
            <Step done={steps.viewed} label={t.stepViewed} />
            <Step
              done={steps.answered !== null}
              label={
                steps.answered === "approved"
                  ? t.statusApproved
                  : steps.answered === "changes"
                    ? t.statusChanges
                    : t.stepAnswered
              }
              tone={steps.answered === "changes" ? "warn" : "ok"}
            />
          </div>
          {props.offline ? <p className="mt-1 text-muted-foreground text-xs">{t.offline}</p> : null}
        </div>
      </div>
      {status === "changes" && approval?.comment ? (
        <div className="mt-2 rounded-lg border-warning border-l-2 bg-muted/40 px-3 py-2">
          <p className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
            <MessageSquareWarningIcon className="size-3.5" aria-hidden />
            {t.clientWrote(approval.decidedByName)}
          </p>
          <p className="mt-1 whitespace-pre-wrap" data-zen-approval-comment>
            {approval.comment}
          </p>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {status === "changes" && approval?.comment ? (
          <Button
            size="sm"
            disabled={busy || forwarded}
            onClick={() => void forward()}
            data-zen-approval-forward
          >
            {forwarded ? <CheckIcon className="size-3.5" /> : <SendIcon className="size-3.5" />}
            {forwarded ? t.sentToAgent : t.sendToAgent}
          </Button>
        ) : null}
        {approval?.active === true ? (
          <>
            <Button size="sm" variant="outline" onClick={copy}>
              <CopyIcon className="size-3.5" />
              {t.copy}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void revoke()}>
              <Link2OffIcon className="size-3.5" />
              {t.revoke}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
