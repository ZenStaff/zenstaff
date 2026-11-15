// Hub v9: follow, read-only and live, the company-server thread a task of mine started
// (`staff.follow`, sealed end to end like a shared chat). Steps, files and status; no composer and
// no way to write into it (decision 08.11.2026: members do not chat on the company server).
import type { ZenHubThreadSnapshot } from "@t3tools/contracts/zenHub";
import { useEffect, useState } from "react";

import ChatMarkdown from "../../components/ChatMarkdown";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";
import { useZenText } from "../i18n/zenI18n";
import { hubErrorMessage, useHubCall } from "./hubClient";
import { securityText } from "./security.i18n";
import { SharedAttachments, SharedWorkRow } from "./SharedRows";

interface FollowAnswer {
  readonly readOnly: true;
  readonly run: { readonly title: string; readonly status: string };
  readonly snapshot: ZenHubThreadSnapshot;
}

/** The follow loop's next `since`: the last version seen, so the runner long-polls (pure). */
export function nextSince(previous: string | null, answer: FollowAnswer | null): string | null {
  return answer?.snapshot.version ?? previous;
}

export function RunnerFollowView(props: {
  readonly companyId: string;
  readonly staffId: string;
  readonly runId: string;
}) {
  const t = useZenText(securityText);
  const { call } = useHubCall();
  const [answer, setAnswer] = useState<FollowAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps a long-poll connection to the company runner open while the view is mounted and stops it on unmount.
  useEffect(() => {
    let stopped = false;
    let since: string | null = null;
    const loop = async () => {
      while (!stopped) {
        try {
          const next = await call<FollowAnswer>("staff.follow", {
            companyId: props.companyId,
            staffId: props.staffId,
            runId: props.runId,
            ...(since === null ? {} : { since }),
          });
          if (stopped) return;
          const unchanged = since !== null && next.snapshot.version === since;
          if (!unchanged) setAnswer(next);
          setError(null);
          since = nextSince(since, next);
          // Done: one last view, then stop following.
          if (next.run.status !== "running" && !next.snapshot.running) return;
          // The runner long-polls; never ask again in a tight loop if it answers at once.
          await new Promise((resolve) => setTimeout(resolve, unchanged ? 3_000 : 1_000));
        } catch (cause) {
          if (stopped) return;
          setError(hubErrorMessage(cause, t.followFailed));
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }, [call, props.companyId, props.staffId, props.runId, t.followFailed]);

  const rows =
    answer?.snapshot.rows ??
    answer?.snapshot.messages.map((message) => ({
      ...message,
      kind: "message" as const,
      attachments: [],
    })) ??
    [];
  return (
    <div className="flex flex-col gap-3" data-testid="runner-follow">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{t.followTitle(answer?.run.title ?? "")}</span>
        {answer !== null ? (
          <Badge variant={answer.run.status === "running" ? "default" : "outline"}>
            {t.followStatus[answer.run.status] ?? answer.run.status}
          </Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">{t.followReadOnly}</p>
      {error !== null ? <p className="text-destructive text-sm">{error}</p> : null}
      <ol
        className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto"
        data-testid="runner-follow-rows"
      >
        {rows.map((message) =>
          message.kind === "work" ? (
            <SharedWorkRow key={message.id} digest={message.digest} steps={message.steps} />
          ) : (
            <li
              key={message.id}
              data-role={message.role}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-3 text-sm",
                message.role === "user" ? "self-end bg-muted/60 max-w-[85%]" : "bg-card",
              )}
            >
              {message.role === "assistant" ? (
                <ChatMarkdown text={message.text} cwd={undefined} parseRawHtml={false} />
              ) : (
                <div className="whitespace-pre-wrap break-words">{message.text}</div>
              )}
              <SharedAttachments attachments={message.attachments} />
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
