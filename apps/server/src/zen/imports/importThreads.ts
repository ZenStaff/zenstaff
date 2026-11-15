// @effect-diagnostics nodeBuiltinImport:off -- a stable hash for thread ids.
// Zen Staff chat imports: the events that make an imported conversation a thread, and the
// thread "Continue in a new chat" starts from it. Both are shaped like upstream's v1 import
// (run-less history, no provider thread), so the first message of a continuation hands the
// history to this machine's agent through `prepareLegacyImport`.
import * as NodeCrypto from "node:crypto";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type ProjectId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import {
  ZEN_IMPORT_LIMITS,
  ZEN_IMPORT_THREAD_PREFIX,
  type ZenImportSource,
  type ZenImportedConversation,
  type ZenImportedMessage,
} from "@t3tools/contracts/zenImports";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const EVENT_PREFIX = "zen-chat-import:v1";

const SOURCE_NAMES: Record<ZenImportSource, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude.ai",
  gemini: "Gemini",
};

/** Same conversation, same thread id: importing an export twice does not duplicate it. */
export function importThreadId(source: ZenImportSource, externalId: string): ThreadId {
  const digest = NodeCrypto.createHash("sha256").update(externalId).digest("hex").slice(0, 24);
  return ThreadId.make(`${ZEN_IMPORT_THREAD_PREFIX}${source}:${digest}`);
}

function when(value: string | null, fallback: DateTime.Utc): DateTime.Utc {
  if (value === null) return fallback;
  return Option.getOrElse(DateTime.make(value), () => fallback);
}

const cut = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

/** Messages worth a timeline row: text of user, assistant and tool entries. */
export function usableMessages(
  messages: ReadonlyArray<ZenImportedMessage>,
): ReadonlyArray<ZenImportedMessage> {
  return messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => ({ ...message, text: cut(message.text, ZEN_IMPORT_LIMITS.charsPerMessage) }));
}

function appThreadOf(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: OrchestrationV2AppThread["runtimeMode"];
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
  readonly archivedAt: DateTime.Utc | null;
}): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "server",
    id: input.threadId,
    projectId: input.projectId,
    title: input.title,
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
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: input.threadId,
    },
    forkedFrom: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    archivedAt: input.archivedAt,
    settledOverride: "settled",
    settledAt: input.updatedAt,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function historyEvents(
  threadId: ThreadId,
  messages: ReadonlyArray<ZenImportedMessage>,
  fallback: DateTime.Utc,
  firstOrdinal: number,
): ReadonlyArray<OrchestrationV2DomainEvent> {
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
  return messages.flatMap((message, index): ReadonlyArray<OrchestrationV2DomainEvent> => {
    const suffix = String(index).padStart(6, "0");
    const at = when(message.createdAt, fallback);
    const turnItemId = TurnItemId.make(`${EVENT_PREFIX}:turn-item:${threadId}:${suffix}`);
    const item = {
      ...common,
      id: turnItemId,
      ordinal: firstOrdinal + index,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
    };
    const itemEventId = EventId.make(`${EVENT_PREFIX}:turn-item:${threadId}:${suffix}`);
    if (message.role === "tool") {
      // Code interpreter runs, browsing, canvases: folded in the timeline like live tool calls.
      return [
        {
          id: itemEventId,
          type: "turn-item.updated",
          threadId,
          occurredAt: at,
          payload: {
            ...item,
            type: "dynamic_tool",
            toolName: message.toolName?.trim() ? message.toolName.trim() : "tool",
            input: null,
            output: message.text,
          },
        },
      ];
    }
    const messageId = MessageId.make(`${threadId}:${suffix}`);
    return [
      {
        id: EventId.make(`${EVENT_PREFIX}:message:${threadId}:${suffix}`),
        type: "message.updated",
        threadId,
        occurredAt: at,
        payload: {
          createdBy: message.role === "user" ? "user" : "agent",
          creationSource: "server",
          id: messageId,
          threadId,
          runId: null,
          nodeId: null,
          role: message.role,
          text: message.text,
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      },
      {
        id: itemEventId,
        type: "turn-item.updated",
        threadId,
        occurredAt: at,
        payload:
          message.role === "user"
            ? {
                ...item,
                createdBy: "user",
                creationSource: "server",
                type: "user_message",
                messageId,
                inputIntent: "turn_start",
                text: message.text,
                attachments: [],
              }
            : {
                ...item,
                type: "assistant_message",
                messageId,
                text: message.text,
                streaming: false,
              },
      },
    ];
  });
}

function noticeEvent(
  threadId: ThreadId,
  at: DateTime.Utc,
  message: string,
): OrchestrationV2DomainEvent {
  const id = `${EVENT_PREFIX}:notice:${threadId}`;
  return {
    id: EventId.make(id),
    type: "turn-item.updated",
    threadId,
    occurredAt: at,
    payload: {
      id: TurnItemId.make(id),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      status: "completed",
      title: null,
      ordinal: 0,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
      type: "system_notice",
      message,
    },
  };
}

/** An imported conversation as an archived, read-only thread. */
export function buildImportedThreadEvents(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly source: ZenImportSource;
  readonly conversation: ZenImportedConversation;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: OrchestrationV2AppThread["runtimeMode"];
  readonly now: DateTime.Utc;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const { threadId, conversation, now } = input;
  const messages = usableMessages(conversation.messages);
  const createdAt = when(conversation.createdAt ?? messages[0]?.createdAt ?? null, now);
  const updatedAt = when(conversation.updatedAt ?? messages.at(-1)?.createdAt ?? null, createdAt);
  const title =
    conversation.title.trim() === ""
      ? `${SOURCE_NAMES[input.source]} chat`
      : conversation.title.trim();
  return [
    {
      id: EventId.make(`${EVENT_PREFIX}:thread:${threadId}:created`),
      type: "thread.created",
      threadId,
      providerInstanceId: input.modelSelection.instanceId,
      occurredAt: createdAt,
      payload: appThreadOf({
        threadId,
        projectId: input.projectId,
        title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        createdAt,
        updatedAt,
        // Not archived: upstream does not open archived threads. It is settled, and the web hides
        // its composer (ImportedThreadBanner), so it reads as an archive and is continued in a
        // new chat.
        archivedAt: null,
      }),
    },
    noticeEvent(
      threadId,
      createdAt,
      `Imported from ${SOURCE_NAMES[input.source]}${conversation.model ? ` (${conversation.model})` : ""}. This imported copy is read-only; use "Continue in a new chat" to keep working on it.`,
    ),
    ...historyEvents(threadId, messages, createdAt, 1),
  ];
}

// ─── Continue in a new chat ─────────────────────────────────────────────────

export interface ContinuationMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string | null;
}

/** Messages copied word for word after the summary, so the latest exchange is exact. */
export const CONTINUATION_TAIL = 6;
const TAIL_CHARS = 4_000;
const TRANSCRIPT_CHARS = 60_000;

/** The transcript Haiku summarizes: start and end kept when the chat is long. */
export function continuationTranscript(messages: ReadonlyArray<ContinuationMessage>): string {
  const lines = messages.map(
    (message) => `${message.role === "user" ? "User" : "Assistant"}: ${cut(message.text, 3_000)}`,
  );
  const full = lines.join("\n\n");
  if (full.length <= TRANSCRIPT_CHARS) return full;
  const head = full.slice(0, TRANSCRIPT_CHARS / 3);
  const tail = full.slice(full.length - (TRANSCRIPT_CHARS * 2) / 3);
  return `${head}\n\n[... middle of the conversation left out ...]\n\n${tail}`;
}

export function continuationPrompt(title: string, source: ZenImportSource, transcript: string) {
  return [
    `Below is a conversation the user had in ${SOURCE_NAMES[source]}, titled "${title}".`,
    "They want to continue it with a new assistant who has not seen it.",
    "Write a compact briefing (at most 400 words) in the conversation's own language:",
    "- what the user was trying to do, and for whom;",
    "- facts, numbers, names, decisions and constraints that were settled;",
    "- what was produced (drafts, code, lists), briefly;",
    "- what was still open or the next step.",
    "Do not invent anything. Do not address the user. Output only the briefing.",
    "",
    "<conversation>",
    transcript,
    "</conversation>",
  ].join("\n");
}

/** Without the model: the first request and the latest messages, word for word. */
export function excerptSummary(messages: ReadonlyArray<ContinuationMessage>): string {
  const first = messages.find((message) => message.role === "user");
  return first === undefined
    ? "The imported conversation had no request from the user."
    : `The conversation started with this request:\n\n${cut(first.text, TAIL_CHARS)}`;
}

export function buildContinuationEvents(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly source: ZenImportSource;
  readonly title: string;
  readonly summary: string;
  readonly messages: ReadonlyArray<ContinuationMessage>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: OrchestrationV2AppThread["runtimeMode"];
  readonly now: DateTime.Utc;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const { threadId, now } = input;
  const tail = input.messages.slice(-CONTINUATION_TAIL).map((message) => ({
    role: message.role,
    text: cut(message.text, TAIL_CHARS),
    createdAt: message.createdAt,
  }));
  const omitted = input.messages.length - tail.length;
  const summaryMessage: ZenImportedMessage = {
    role: "assistant",
    text: `Summary of the earlier ${SOURCE_NAMES[input.source]} conversation "${input.title}"${omitted > 0 ? ` (${omitted} earlier messages summarized)` : ""}:\n\n${input.summary.trim()}`,
    createdAt: tail[0]?.createdAt ?? null,
  };
  return [
    {
      id: EventId.make(`${EVENT_PREFIX}:thread:${threadId}:created`),
      type: "thread.created",
      threadId,
      providerInstanceId: input.modelSelection.instanceId,
      occurredAt: now,
      payload: appThreadOf({
        threadId,
        projectId: input.projectId,
        title: input.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      }),
    },
    noticeEvent(
      threadId,
      now,
      `Continued from the imported ${SOURCE_NAMES[input.source]} chat "${input.title}". The assistant gets the summary and the latest messages below as context.`,
    ),
    ...historyEvents(threadId, [summaryMessage, ...tail], now, 1),
  ];
}
