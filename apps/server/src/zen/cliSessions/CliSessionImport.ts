import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  TurnItemId,
  isRuntimeModeAbove,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import {
  ZenCliSessionsError,
  type ZenCliSessionProvider,
  type ZenCliSessionsResumeResult,
} from "@t3tools/contracts/zenCliSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionRuntime from "../../persistence/ProviderSessionRuntime.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { commandOf, fileEditOf, searchOf, type HistoryEntry } from "./historyParser.ts";

// Same ids as upstream's onboarding import (AgentSessionImporter), so either path finds the
// other's thread instead of importing a session twice.
const IMPORT_EVENT_PREFIX = "agent-session-import:v2";

export interface CliSessionImportInput {
  readonly provider: ZenCliSessionProvider;
  readonly providerInstanceId: ProviderInstanceId;
  readonly sessionId: string;
  readonly ownerThreadId: ThreadId | null;
  readonly cwd: string;
  readonly title: string;
  readonly model: string | null;
  readonly startedAt: string | null;
  readonly lastActivityMs: number;
  /** Messages and tool calls in order (tool calls only with a full import). */
  readonly entries: ReadonlyArray<HistoryEntry>;
  readonly omittedMessageCount: number;
  readonly transcript: {
    readonly filePath: string;
    readonly size: number;
    readonly mtimeMs: number;
    readonly inode: string | null;
    readonly device: number;
    readonly birthtimeMs: number | null;
  };
}

const isZenCliSessionsError = Schema.is(ZenCliSessionsError);

const failResume = (reason: ZenCliSessionsError["reason"], detail: string) =>
  new ZenCliSessionsError({ operation: "resume", reason, detail });

function safeDate(value: string | null, fallbackMs: number): DateTime.Utc {
  const parsed = value === null ? Option.none() : DateTime.make(value);
  return Option.getOrElse(parsed, () => DateTime.makeUnsafe(fallbackMs));
}

export function importedThreadId(providerInstanceId: string, sessionId: string): ThreadId {
  return ThreadId.make(`import:${providerInstanceId}:${sessionId}`);
}

type TurnItemBase = {
  readonly id: TurnItemId;
  readonly threadId: ThreadId;
  readonly runId: null;
  readonly nodeId: null;
  readonly providerThreadId: null;
  readonly providerTurnId: null;
  readonly nativeItemRef: null;
  readonly parentItemId: null;
  readonly status: "completed";
  readonly title: null;
  readonly ordinal: number;
  readonly startedAt: DateTime.Utc;
  readonly completedAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
};

/** A tool call from the transcript as the turn item the live adapters would have written. */
function toolTurnItem(
  entry: Extract<HistoryEntry, { kind: "tool" }>,
  base: TurnItemBase,
): OrchestrationV2TurnItem {
  const output = entry.output ?? undefined;
  const command = commandOf(entry.name, entry.input);
  if (command !== null) {
    return {
      ...base,
      type: "command_execution",
      input: command,
      ...(output === undefined ? {} : { output }),
      ...(entry.isError ? { outputIndicatesFailure: true } : {}),
    };
  }
  const edit = fileEditOf(entry.name, entry.input);
  if (edit !== null) {
    return { ...base, type: "file_change", ...edit };
  }
  const search = searchOf(entry.name, entry.input);
  if (search !== null) {
    return search.kind === "file"
      ? { ...base, type: "file_search", pattern: search.pattern }
      : { ...base, type: "web_search", patterns: [search.pattern] };
  }
  return {
    ...base,
    type: "dynamic_tool",
    toolName: entry.name.trim() === "" ? null : entry.name,
    input: entry.input ?? null,
    ...(output === undefined ? {} : { output }),
  };
}

/** Thread, history and provider-thread events for a transcript that continues on resume. */
export function buildImportEvents(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly runtimeMode: OrchestrationV2AppThread["runtimeMode"];
  readonly providerThreadId: OrchestrationV2ProviderThread["id"];
  readonly session: CliSessionImportInput;
}): {
  readonly events: ReadonlyArray<OrchestrationV2DomainEvent>;
  readonly providerThread: OrchestrationV2ProviderThread;
} {
  const { session, threadId } = input;
  const driver = ProviderDriverKind.make(session.provider);
  const updatedAt = DateTime.makeUnsafe(session.lastActivityMs);
  const createdAt = safeDate(session.startedAt, session.lastActivityMs);
  const model = session.model ?? DEFAULT_MODEL_BY_PROVIDER[driver] ?? DEFAULT_MODEL;
  const appThread: OrchestrationV2AppThread = {
    createdBy: "system",
    creationSource: "server",
    id: threadId,
    projectId: input.projectId,
    title: session.title.trim() === "" ? "Terminal session" : session.title,
    providerInstanceId: session.providerInstanceId,
    modelSelection: { instanceId: session.providerInstanceId, model },
    runtimeMode: input.runtimeMode,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    linkedPullRequest: null,
    branchPullRequest: null,
    activeProviderThreadId: input.providerThreadId,
    historyOrigin: "v1_import",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt,
    updatedAt,
    archivedAt: null,
    settledOverride: "settled",
    settledAt: updatedAt,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  const providerThread: OrchestrationV2ProviderThread = {
    id: input.providerThreadId,
    driver,
    providerInstanceId: session.providerInstanceId,
    providerSessionId: null,
    appThreadId: threadId,
    ownerNodeId: null,
    // A strong native ref makes the adapter resume this session id instead of starting a new one.
    nativeThreadRef: { driver, nativeId: session.sessionId, strength: "strong" },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    createdAt,
    updatedAt,
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
  const notice: OrchestrationV2DomainEvent = {
    id: EventId.make(`${IMPORT_EVENT_PREFIX}:history-truncated:${threadId}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: createdAt,
    payload: {
      ...common,
      id: TurnItemId.make(`${IMPORT_EVENT_PREFIX}:history-truncated:${threadId}`),
      ordinal: 0,
      startedAt: createdAt,
      completedAt: createdAt,
      updatedAt: createdAt,
      type: "system_notice",
      message: `Continued from a terminal session. ${session.omittedMessageCount} earlier ${session.omittedMessageCount === 1 ? "entry is" : "entries are"} not shown here; the agent still has the full conversation.`,
    },
  };
  const messageEvents = session.entries.flatMap((entry, index) => {
    const suffix = String(index).padStart(6, "0");
    const turnItemId = TurnItemId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`);
    const at = safeDate(entry.timestamp, session.lastActivityMs);
    const item = {
      ...common,
      id: turnItemId,
      ordinal: index + 1,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
    };
    if (entry.kind === "tool") {
      return [
        {
          id: EventId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`),
          type: "turn-item.updated",
          threadId,
          occurredAt: at,
          payload: toolTurnItem(entry, item),
        } satisfies OrchestrationV2DomainEvent,
      ];
    }
    const message = entry;
    const messageId = MessageId.make(`${threadId}:${suffix}`);
    const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
      {
        id: EventId.make(`${IMPORT_EVENT_PREFIX}:message:${threadId}:${suffix}`),
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
        id: EventId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`),
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
    return events;
  });

  return {
    providerThread,
    events: [
      {
        id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${threadId}:created`),
        type: "thread.created",
        threadId,
        providerInstanceId: session.providerInstanceId,
        occurredAt: createdAt,
        payload: appThread,
      },
      ...(session.omittedMessageCount > 0 ? [notice] : []),
      ...messageEvents,
      {
        id: EventId.make(`${IMPORT_EVENT_PREFIX}:provider-thread:${input.providerThreadId}`),
        type: "provider-thread.updated",
        threadId,
        driver,
        providerInstanceId: session.providerInstanceId,
        occurredAt: updatedAt,
        payload: providerThread,
      },
    ],
  };
}

export class CliSessionImport extends Context.Service<
  CliSessionImport,
  {
    readonly importSession: (
      input: CliSessionImportInput,
    ) => Effect.Effect<ZenCliSessionsResumeResult, ZenCliSessionsError>;
  }
>()("t3/zen/cliSessions/CliSessionImport") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const runtimes = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const ceiling = settingsService.managedPolicy?.limits?.maxRuntimeMode;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;

  const existingThread = Effect.fn("CliSessionImport.existingThread")(function* (
    threadId: ThreadId,
  ) {
    const records = yield* Effect.option(orchestrator.getThreadRecords(threadId, []));
    if (Option.isNone(records)) return null;
    if (records.value.thread.deletedAt !== null) {
      return yield* failResume(
        "thread-deleted",
        "This session was resumed here before and that thread was deleted.",
      );
    }
    return { threadId, projectId: records.value.thread.projectId, created: false };
  });

  const ensureProject = Effect.fn("CliSessionImport.ensureProject")(function* (cwd: string) {
    const existing = yield* projects.getByWorkspaceRoot(cwd);
    if (Option.isSome(existing)) return existing.value;
    const id = yield* random.uuidV4();
    return yield* projects
      .bootstrap({
        commandId: CommandId.make(`zen-cli-session-project:${id}`),
        projectId: ProjectId.make(id),
        title: path.basename(cwd) || cwd,
        workspaceRoot: cwd,
      })
      .pipe(
        Effect.map(({ project }) => project),
        Effect.catchTags({
          ProjectConflictError: (conflict) =>
            projects.getById(conflict.conflictingProjectId).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(conflict),
                  onSome: Effect.succeed,
                }),
              ),
            ),
        }),
      );
  });

  const importSession = Effect.fn("CliSessionImport.importSession")(
    function* (session: CliSessionImportInput) {
      if (session.ownerThreadId !== null) {
        const owned = yield* existingThread(session.ownerThreadId);
        if (owned !== null) return owned;
      }
      const threadId = importedThreadId(session.providerInstanceId, session.sessionId);
      const previous = yield* existingThread(threadId);
      if (previous !== null) return previous;

      const project = yield* ensureProject(session.cwd);
      // Unlike upstream's bulk import (full access), a resumed session is one the user keeps
      // working in, so it starts like a new thread: Claude refuses bypass mode when run as root.
      const runtimeMode = yield* settingsService.getSettings.pipe(
        Effect.map((settings) => {
          const mode = resolveProjectSettings(settings, project.id, project).settings
            .defaultRuntimeMode;
          return ceiling !== undefined && isRuntimeModeAbove(mode, ceiling) ? ceiling : mode;
        }),
      );
      const driver = ProviderDriverKind.make(session.provider);
      const providerThreadId = idAllocator.derive.providerThread({
        driver,
        providerInstanceId: session.providerInstanceId,
        nativeThreadId: session.sessionId,
      });
      const { events, providerThread } = buildImportEvents({
        threadId,
        projectId: project.id,
        runtimeMode,
        providerThreadId,
        session,
      });
      const committed = yield* eventSink.write({ unlessNativeThreadOwned: providerThread, events });
      if (committed.length === 0) {
        return yield* failResume(
          "unavailable",
          "Another thread already continues this session. Refresh the list and open that thread.",
        );
      }
      yield* runtimes.upsert(
        {
          threadId,
          providerName: driver,
          providerInstanceId: session.providerInstanceId,
          adapterKey: driver,
          runtimeMode,
          status: "stopped",
          lastSeenAt: DateTime.formatIso(DateTime.makeUnsafe(session.lastActivityMs)),
          resumeCursor:
            session.provider === "claudeAgent"
              ? { threadId, resume: session.sessionId }
              : { threadId: session.sessionId },
          runtimePayload: { cwd: project.workspaceRoot },
        },
        { onConflict: "ignore" },
      );
      yield* runtimes
        .recordImportedTranscript({
          threadId,
          source: {
            provider: session.provider,
            providerInstanceId: session.providerInstanceId,
            providerSessionId: session.sessionId,
            filePath: session.transcript.filePath,
            size: session.transcript.size,
            mtimeMs: session.transcript.mtimeMs,
            device: session.transcript.device,
            inode: session.transcript.inode,
            birthtimeMs: session.transcript.birthtimeMs,
          },
        })
        .pipe(Effect.ignore);
      return {
        threadId,
        projectId: project.id,
        created: true,
        importedItems: session.entries.length,
      } satisfies ZenCliSessionsResumeResult;
    },
    Effect.mapError((cause) =>
      isZenCliSessionsError(cause)
        ? cause
        : failResume("unavailable", "Could not create a thread for this session."),
    ),
  );

  return CliSessionImport.of({ importSession });
});

export const layer = Layer.effect(CliSessionImport, make);
