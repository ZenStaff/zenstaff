// Zen Staff hub: a chat someone shared with you, live. Personal chats: watch and comment, then
// "Continue on my side". Company chats: write too. Messages come from the owner's machine through
// the hub; this view never talks to that machine directly.
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZenHubComment,
  ZenHubShareDetail,
  ZenHubThreadSnapshot,
} from "@t3tools/contracts/zenHub";
import { ArrowLeftIcon, CopyPlusIcon, LockIcon, MessageSquareIcon, SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import ChatMarkdown from "../../components/ChatMarkdown";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { hubText } from "./hub.i18n";
import { hubErrorMessage, useHubQuery, type HubCall } from "./hubClient";
import { useCopyTarget } from "./useCopyTarget";
import { SharedAttachments, SharedWorkRow } from "./SharedRows";

/** One comment; end-to-end comments are read through the owner's runner, which checks the signer. */
function CommentLine(props: { readonly comment: ZenHubComment }) {
  const t = useZenText(hubText);
  const { comment } = props;
  return (
    <div className="rounded-md bg-accent px-2 py-1 text-xs" data-testid="comment">
      <b>{comment.authorName}:</b> {comment.body}
      {comment.legacy === true ? (
        <span className="ml-1 text-muted-foreground">({t.commentLegacy})</span>
      ) : comment.verified === false ? (
        <span className="ml-1 text-muted-foreground" data-testid="comment-unverified">
          ({t.commentNotVerified})
        </span>
      ) : null}
    </div>
  );
}

export function SharedChatView(props: {
  readonly shareId: string;
  readonly call: HubCall;
  readonly environmentId: EnvironmentId;
  readonly onBack: () => void;
}) {
  const { shareId, call } = props;
  const t = useZenText(hubText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const chatUnreachable = t.chatUnreachable;
  const [snapshot, setSnapshot] = useState<ZenHubThreadSnapshot | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState(false);
  const target = useCopyTarget(props.environmentId);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Share details and comments: a live query, asked again every few seconds.
  const { data: detail, error: detailError } = useHubQuery<ZenHubShareDetail>(
    props.environmentId,
    "share.get",
    { shareId },
    { live: true },
  );
  const share = detail?.share ?? null;
  const comments = detail?.comments ?? [];
  const unreadable = detail?.unreadableComments ?? 0;

  // The chat itself: a long-poll that returns as soon as the owner's machine has something new.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps a long-poll connection to the owner's machine (through the hub) open while the chat is shown
  useEffect(() => {
    const live = { cancelled: false };
    let since: string | null = null;
    const loop = async () => {
      while (!live.cancelled) {
        try {
          const next: ZenHubThreadSnapshot = await call<ZenHubThreadSnapshot>("share.view", {
            shareId,
            ...(since === null ? {} : { since }),
          });
          if (live.cancelled) return;
          since = next.version;
          setSnapshot(next);
          setLiveError(null);
        } catch (cause) {
          if (live.cancelled) return;
          setLiveError(hubErrorMessage(cause, chatUnreachable));
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    };
    void loop();
    return () => {
      live.cancelled = true;
    };
  }, [call, shareId, chatUnreachable]);

  const messageCount = snapshot?.messages.length ?? 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the DOM to the newest message
  useEffect(() => {
    if (messageCount > 0) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount]);

  const sendPrompt = async () => {
    setBusy(true);
    try {
      await call("share.prompt", { shareId, text: draft });
      setDraft("");
      setBusy(false);
    } catch (cause) {
      toastManager.add({ type: "error", title: t.notSent, description: hubErrorMessage(cause) });
      setBusy(false);
    }
  };

  const sendComment = async (messageId: string | null) => {
    try {
      await call("share.comment", { shareId, body: commentText, messageId });
      setCommentText("");
      setCommentFor(null);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: t.commentNotSaved,
        description: hubErrorMessage(cause),
      });
    }
  };

  const continueOnMySide = async () => {
    if (target.selection === null) return;
    setBusy(true);
    try {
      const result = await call<{ threadId: string; attachmentsCopied?: number }>("share.copy", {
        shareId,
        ...target.selection,
        language: locale,
      });
      const files = result.attachmentsCopied ?? 0;
      toastManager.add({
        type: "success",
        title: t.copiedTitle,
        description: `${t.copiedHint}${files > 0 ? ` ${t.copiedFiles(files)}` : ""}`,
      });
      await target.openThread(navigate, result.threadId);
      setBusy(false);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: t.couldNotCopy,
        description: hubErrorMessage(cause),
      });
      setBusy(false);
    }
  };

  const commentsFor = (messageId: string | null) =>
    comments.filter((comment) => comment.messageId === messageId);
  const canPrompt = share?.permissions.prompt === true;

  return (
    <div className="flex flex-col gap-3" data-testid="shared-chat">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={props.onBack}>
          <ArrowLeftIcon />
          {t.back}
        </Button>
        <h2 className="flex-1 truncate font-medium" data-testid="shared-chat-title">
          {snapshot?.title || share?.title || t.untitledChat}
        </h2>
        {share !== null ? (
          <span className="text-muted-foreground text-sm">
            {share.ownerName} · {share.companyName} · {t.onMachine(share.environmentName)}
          </span>
        ) : null}
        {snapshot?.running ? <Badge variant="info">{t.agentWorking}</Badge> : null}
        <Badge variant={snapshot === null ? "outline" : "default"}>
          {snapshot === null ? t.connecting : t.live}
        </Badge>
      </div>

      {share !== null && !canPrompt ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
          data-testid="read-only-banner"
        >
          <LockIcon className="size-4" />
          <span className="flex-1">{t.readOnlyBanner(share.ownerName)}</span>
          {share.permissions.copy ? (
            <>
              {target.picker}
              <Button
                size="sm"
                disabled={busy || target.selection === null}
                onClick={() => void continueOnMySide()}
              >
                <CopyPlusIcon />
                {t.continueOnMySide}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {(liveError ?? detailError) !== null ? (
        <p className="text-destructive text-sm">{liveError ?? detailError}</p>
      ) : null}
      {snapshot !== null && snapshot.omittedMessageCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {t.olderOmitted(snapshot.omittedMessageCount)}
        </p>
      ) : null}

      <ol className="flex flex-col gap-3" data-testid="shared-messages">
        {(
          snapshot?.rows ??
          snapshot?.messages.map((message) => ({
            ...message,
            kind: "message" as const,
            attachments: [],
          })) ??
          []
        ).map((message) =>
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
                // A colleague's text: rendered as markdown, raw HTML off.
                <ChatMarkdown text={message.text} cwd={undefined} parseRawHtml={false} />
              ) : (
                <div className="whitespace-pre-wrap break-words">{message.text}</div>
              )}
              <SharedAttachments attachments={message.attachments} />
              {commentsFor(message.id).map((comment) => (
                <CommentLine key={comment.id} comment={comment} />
              ))}
              {share?.permissions.comment ? (
                commentFor === message.id ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendComment(message.id);
                    }}
                  >
                    <Input
                      aria-label={t.commentLabel}
                      autoFocus
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                    />
                    <Button type="submit" size="xs" disabled={commentText.trim() === ""}>
                      {t.postComment}
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="self-start text-muted-foreground text-xs hover:underline"
                    onClick={() => {
                      setCommentFor(message.id);
                      setCommentText("");
                    }}
                  >
                    <MessageSquareIcon className="mr-1 inline size-3" />
                    {t.commentAction}
                  </button>
                )
              ) : null}
            </li>
          ),
        )}
      </ol>
      {commentsFor(null).length > 0 ? (
        <div className="flex flex-col gap-1">
          {commentsFor(null).map((comment) => (
            <CommentLine key={comment.id} comment={comment} />
          ))}
        </div>
      ) : null}
      {unreadable > 0 ? (
        <p className="text-muted-foreground text-xs" data-testid="comments-unreadable">
          {t.unreadableComments(unreadable)}
        </p>
      ) : share?.permissions.comment ? (
        <p className="text-muted-foreground text-xs">{t.commentsEncrypted}</p>
      ) : null}
      <div ref={bottomRef} />

      {canPrompt ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendPrompt();
          }}
        >
          <Textarea
            aria-label={t.messageToAgent}
            placeholder={t.writeToAgent}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={busy || draft.trim() === ""}>
            <SendIcon />
            {t.send}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
