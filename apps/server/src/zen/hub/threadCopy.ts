// Zen Staff hub: "Continue on my side" / "Hand over" copy a chat in as a v1-import-shaped thread
// (run-less history, no provider thread); `prepareLegacyImport` gives it to THIS machine's agent.
// Attachments come along within the copy limits (stored like upstream uploads); files over the
// limits are listed by name and size in the copied message instead.
import {
  type ChatAttachment,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type ProjectId,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type { ZenHubExportAttachment, ZenHubThreadSnapshot } from "@t3tools/contracts/zenHub";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const COPY_EVENT_PREFIX = "zen-hub-copy:v1";

/**
 * Copy limits. A shared view inlines media up to 3 MB each and 8 MB per view; a copy keeps files
 * for good, so it allows more: 5 MB per file (one sealed relay frame stays well under the hub's
 * 16 MB), 20 MB and 40 files per copy, newest first.
 */
export const COPY_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const COPY_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
export const COPY_MAX_FILES = 40;

export interface CopyPlanEntry {
  readonly messageId: string;
  readonly attachment: ZenHubExportAttachment;
}

/** Which attachments a copy fetches (within the limits, newest first) and which it only lists. */
export function planCopyAttachments(messages: ZenHubThreadSnapshot["messages"]): {
  readonly fetch: ReadonlyArray<CopyPlanEntry>;
  readonly listed: ReadonlyArray<CopyPlanEntry>;
} {
  const fetch: Array<CopyPlanEntry> = [];
  const listed: Array<CopyPlanEntry> = [];
  let total = 0;
  for (const message of messages.filter((item) => !item.streaming).toReversed()) {
    for (const attachment of message.attachments ?? []) {
      const entry = { messageId: message.id, attachment };
      const size = attachment.sizeBytes;
      if (
        size <= 0 ||
        size > COPY_FILE_MAX_BYTES ||
        total + size > COPY_TOTAL_MAX_BYTES ||
        fetch.length >= COPY_MAX_FILES
      ) {
        listed.push(entry);
        continue;
      }
      total += size;
      fetch.push(entry);
    }
  }
  return { fetch: fetch.toReversed(), listed: listed.toReversed() };
}

/** "12.4 MB", "830 KB", "512 B". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

type CopyLanguage = "en" | "ro";

const COPY_TEXT = {
  en: {
    olderOne: " 1 older message was not copied.",
    olderMany: (count: number) => ` ${count} older messages were not copied.`,
    handover: (from: string) => `Handed over by ${from}. It now runs here, on your own account.`,
    copy: (from: string) =>
      `Copied from ${from}'s chat. It continues here, on your own account; theirs is unchanged.`,
    someListed: " Some files were too large to copy; they are listed by name and size.",
    notCopied: "Not copied (over the size limits):",
  },
  ro: {
    olderOne: " 1 mesaj mai vechi nu a fost copiat.",
    olderMany: (count: number) => ` ${count} mesaje mai vechi nu au fost copiate.`,
    handover: (from: string) => `Predat de ${from}. Acum rulează aici, pe contul tău.`,
    copy: (from: string) =>
      `Copiat din chatul lui ${from}. Continuă aici, pe contul tău; al lui rămâne neschimbat.`,
    someListed: " Unele fișiere erau prea mari ca să fie copiate; sunt trecute cu nume și mărime.",
    notCopied: "Necopiate (peste limitele de mărime):",
  },
} as const;

function at(value: string, fallback: DateTime.Utc): DateTime.Utc {
  return Option.getOrElse(DateTime.make(value), () => fallback);
}

export function buildCopyEvents(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: OrchestrationV2AppThread["runtimeMode"];
  readonly snapshot: ZenHubThreadSnapshot;
  readonly fromName: string;
  readonly how: "copy" | "handover";
  readonly now: DateTime.Utc;
  /** Source attachment id -> the attachment stored on this machine for the copy. */
  readonly copied?: ReadonlyMap<string, ChatAttachment>;
  readonly language?: CopyLanguage;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const { threadId, snapshot, now } = input;
  const text = COPY_TEXT[input.language ?? "en"];
  const copied = input.copied ?? new Map<string, ChatAttachment>();
  const messages = snapshot.messages.filter((message) => !message.streaming);
  const createdAt = messages.length > 0 ? at(messages[0]!.createdAt, now) : now;
  const appThread: OrchestrationV2AppThread = {
    createdBy: "user",
    creationSource: "server",
    id: threadId,
    projectId: input.projectId,
    title: snapshot.title.trim() === "" ? "Shared chat" : snapshot.title,
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    linkedPullRequest: null,
    branchPullRequest: null,
    activeProviderThreadId: null,
    historyOrigin: "v1_import",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  const common = {
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    status: "completed" as const,
    title: null,
  };
  const omitted =
    snapshot.omittedMessageCount === 0
      ? ""
      : snapshot.omittedMessageCount === 1
        ? text.olderOne
        : text.olderMany(snapshot.omittedMessageCount);
  const anyListed = messages.some((message) =>
    (message.attachments ?? []).some((attachment) => !copied.has(attachment.id)),
  );
  const noticeText = `${input.how === "handover" ? text.handover(input.fromName) : text.copy(input.fromName)}${omitted}${anyListed ? text.someListed : ""}`;
  const notice: OrchestrationV2DomainEvent = {
    id: EventId.make(`${COPY_EVENT_PREFIX}:notice:${threadId}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: createdAt,
    payload: {
      ...common,
      id: TurnItemId.make(`${COPY_EVENT_PREFIX}:notice:${threadId}`),
      ordinal: 0,
      startedAt: createdAt,
      completedAt: createdAt,
      updatedAt: createdAt,
      type: "system_notice",
      message: noticeText,
    },
  };
  const messageEvents = messages.flatMap((message, index) => {
    const suffix = String(index).padStart(6, "0");
    const messageId = MessageId.make(`${threadId}:${suffix}`);
    const turnItemId = TurnItemId.make(`${COPY_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`);
    const when = at(message.createdAt, now);
    const attachments = (message.attachments ?? []).flatMap((attachment) => {
      const stored = copied.get(attachment.id);
      return stored === undefined ? [] : [stored];
    });
    const listed = (message.attachments ?? []).filter((attachment) => !copied.has(attachment.id));
    const body =
      listed.length === 0
        ? message.text
        : `${message.text}${message.text.trim() === "" ? "" : "\n\n"}${text.notCopied} ${listed
            .map((attachment) => `${attachment.name} (${formatSize(attachment.sizeBytes)})`)
            .join(", ")}`;
    const item = {
      ...common,
      id: turnItemId,
      ordinal: index + 1,
      startedAt: when,
      completedAt: when,
      updatedAt: when,
    };
    const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
      {
        id: EventId.make(`${COPY_EVENT_PREFIX}:message:${threadId}:${suffix}`),
        type: "message.updated",
        threadId,
        occurredAt: when,
        payload: {
          createdBy: message.role === "user" ? "user" : "agent",
          creationSource: "server",
          id: messageId,
          threadId,
          runId: null,
          nodeId: null,
          role: message.role,
          text: body,
          attachments,
          streaming: false,
          createdAt: when,
          updatedAt: when,
        },
      },
      {
        id: EventId.make(`${COPY_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: when,
        payload:
          message.role === "user"
            ? {
                ...item,
                createdBy: "user",
                creationSource: "server",
                type: "user_message",
                messageId,
                inputIntent: "turn_start",
                text: body,
                attachments,
              }
            : {
                ...item,
                type: "assistant_message",
                messageId,
                text: body,
                streaming: false,
              },
      },
    ];
    return events;
  });
  return [
    {
      id: EventId.make(`${COPY_EVENT_PREFIX}:thread:${threadId}:created`),
      type: "thread.created",
      threadId,
      providerInstanceId: input.modelSelection.instanceId,
      occurredAt: createdAt,
      payload: appThread,
    },
    notice,
    ...messageEvents,
  ];
}
