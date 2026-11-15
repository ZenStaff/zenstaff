// Zen Staff chat integrations: the e-mail approvals tab. Every reply an agent drafts for the
// company mailbox (and every tool request of an e-mail run) waits here for the agent's manager,
// with the mail it answers, the checks' flags and the files; the manager may edit the text, then
// send it in the original thread or decline. Chat cards (Slack, Teams, Telegram) decide the same.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenChatEmailApprovalView, ZenChatStatus } from "@t3tools/contracts/zenChat";
import { MailIcon, PaperclipIcon, SendIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Textarea } from "../../components/ui/textarea";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { chatText } from "./chat.i18n";
import { useChatQuery, type ChatCall } from "./chatClient";
import { Section, notifyError, notifySuccess } from "./chatUi";

function ApprovalCard(props: {
  readonly approval: ZenChatEmailApprovalView;
  readonly hubUser: string | null;
  readonly call: ChatCall;
  readonly onDecided: () => void;
}) {
  const t = useZenText(chatText);
  const locale = useZenLocale();
  const { approval } = props;
  const [body, setBody] = useState(approval.body);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = approval.status === "pending";
  const mustConfirm = props.hubUser === null;
  const decide = async (decision: "accept" | "decline") => {
    setBusy(true);
    try {
      await props.call("approval.decide", {
        approvalId: approval.id,
        decision,
        ...(approval.kind === "email-reply" && body !== approval.body ? { body } : {}),
        ...(mustConfirm ? { managerConfirmed: true, managerEmail: approval.managerEmail } : {}),
      });
      notifySuccess(decision === "accept" ? t.emailSent : t.emailDeclined);
      props.onDecided();
    } catch (cause) {
      notifyError(t.emailDecline, cause);
    }
    setBusy(false);
  };
  return (
    <article
      className="flex flex-col gap-3 rounded-xl border p-4"
      data-email-approval={approval.status}
    >
      <header className="flex flex-wrap items-center gap-2">
        <MailIcon className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">{approval.agentName}</span>
        <Badge
          variant={pending ? "warning" : approval.status === "accepted" ? "success" : "outline"}
        >
          {t.emailStatus[approval.status] ?? approval.status}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {formatZenRelativeTime(locale, approval.createdAt)}
          {approval.decidedBy ? ` · ${t.emailDecidedBy(approval.decidedBy)}` : ""}
        </span>
      </header>
      {approval.flags.length > 0 ? (
        <div
          className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
          data-email-flags
        >
          <p className="flex items-center gap-1.5 font-medium text-destructive-foreground">
            <ShieldAlertIcon className="size-4" aria-hidden />
            {t.emailFlags}
          </p>
          <ul className="ms-5 list-disc text-xs">
            {approval.flags.map((flag) => (
              <li key={`${flag.kind}:${flag.evidence}`}>
                <span className="font-medium">{t.emailFlagKinds[flag.kind] ?? flag.kind}</span>
                {flag.evidence ? `: ${flag.evidence}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {approval.original ? (
        <details className="rounded-lg bg-muted/50 p-3 text-sm" open={pending}>
          <summary className="cursor-pointer text-muted-foreground text-xs">
            {t.emailOriginal(approval.original.from)} · {approval.original.subject}
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs">{approval.original.excerpt}</p>
        </details>
      ) : null}
      {approval.kind === "email-reply" ? (
        <div className="flex flex-col gap-2 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t.emailTo}</dt>
            <dd>{approval.to.join(", ")}</dd>
            {approval.cc.length > 0 ? (
              <>
                <dt className="text-muted-foreground">{t.emailCc}</dt>
                <dd>{approval.cc.join(", ")}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t.emailSubject}</dt>
            <dd>{approval.subject}</dd>
          </dl>
          <Textarea
            rows={Math.min(14, Math.max(5, body.split("\n").length + 1))}
            value={body}
            disabled={!pending || busy}
            onChange={(event) => setBody(event.target.value)}
            aria-label={t.emailSubject}
          />
          {approval.attachments.length > 0 ? (
            <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <PaperclipIcon className="size-3.5" aria-hidden />
              {t.emailFiles}: {approval.attachments.map((file) => file.name).join(", ")}
            </p>
          ) : null}
          {approval.sendResult ? (
            <p className="text-muted-foreground text-xs">{approval.sendResult}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground text-xs">{t.emailToolRequest}</p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
            {approval.body}
          </pre>
        </div>
      )}
      {pending ? (
        <div className="flex flex-wrap items-center gap-3">
          {mustConfirm ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              {t.emailIAmManager(approval.managerEmail)}
            </label>
          ) : null}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || (mustConfirm && !confirmed)}
            onClick={() => void decide("decline")}
          >
            <XIcon />
            {t.emailDecline}
          </Button>
          <Button
            size="sm"
            disabled={busy || (mustConfirm && !confirmed)}
            onClick={() => void decide("accept")}
            data-email-send
          >
            <SendIcon />
            {approval.kind === "email-reply" ? t.emailSendApproved : t.emailApproveTool}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function EmailApprovalsTab(props: {
  readonly environmentId: EnvironmentId;
  readonly status: ZenChatStatus;
  readonly call: ChatCall;
}) {
  const t = useZenText(chatText);
  const { data, error, refresh } = useChatQuery<ReadonlyArray<ZenChatEmailApprovalView>>(
    props.environmentId,
    "approval.list",
    { limit: 50 },
  );
  return (
    <Section
      title={t.emailApprovalsTitle}
      icon={<MailIcon className="size-4" />}
      actions={
        <Button size="xs" variant="outline" onClick={refresh}>
          {t.refresh}
        </Button>
      }
    >
      <p className="text-muted-foreground text-xs">{t.emailApprovalsHint}</p>
      {error !== null ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      {data === null || data.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {data === null ? t.loading : t.emailNoApprovals}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              hubUser={props.status.access.hubUser}
              call={props.call}
              onDecided={refresh}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
