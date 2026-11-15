// @effect-diagnostics nodeBuiltinImport:off globalDateInEffect:off -- the index is a small JSON file written synchronously.
// Zen Staff chat imports: creates the archived threads, continues them in a new chat and hands
// imported chats to company memory on request. The export files are parsed in the browser; this
// service receives the normalized conversations. ChatGPT / Claude.ai projects become folders
// (importProjects.ts) registered as Zen projects. Index: `<state dir>/zen/chat-imports.json`.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_MODEL,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  isRuntimeModeAbove,
  type ModelSelection,
} from "@t3tools/contracts";
import { ZEN_MEMORY_SUMMARY_MODEL, type ZenMemoryError } from "@t3tools/contracts/zenMemory";
import {
  ZEN_IMPORT_LIMITS,
  ZEN_IMPORTS_WS_METHODS,
  ZenImportsError,
  zenImportSourceOfThread,
  type ZenImportSource,
  type ZenImportedThread,
  type ZenImportsContinueInput,
  type ZenImportsContinueResult,
  type ZenImportsCreateProjectInput,
  type ZenImportsCreateProjectResult,
  type ZenImportsCreateInput,
  type ZenImportsCreateResult,
  type ZenImportsListResult,
  type ZenImportsMemoryInput,
  type ZenImportsMemoryItem,
  type ZenImportsMemoryResult,
  type ZenImportsSaveMemoryInput,
  type ZenImportsSaveMemoryResult,
} from "@t3tools/contracts/zenImports";
import { redactSensitive } from "@t3tools/contracts/zenSecrets";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../../config.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import type * as ZenMemory from "../memory/ZenMemory.ts";
import {
  buildContinuationEvents,
  buildImportedThreadEvents,
  continuationPrompt,
  continuationTranscript,
  excerptSummary,
  importThreadId,
  usableMessages,
  type ContinuationMessage,
} from "./importThreads.ts";
import {
  chooseProjectFolder,
  ensureBaseFolder,
  writeGlobalMemory,
  writeImportedProject,
} from "./importProjects.ts";

export class ZenImports extends Context.Service<
  ZenImports,
  {
    readonly create: (
      input: ZenImportsCreateInput,
    ) => Effect.Effect<ZenImportsCreateResult, ZenImportsError>;
    readonly list: Effect.Effect<ZenImportsListResult, ZenImportsError>;
    readonly continueThread: (
      input: ZenImportsContinueInput,
    ) => Effect.Effect<ZenImportsContinueResult, ZenImportsError>;
    /** A ChatGPT / Claude.ai project as a folder + Zen project (reused on re-import). */
    readonly createProject: (
      input: ZenImportsCreateProjectInput,
    ) => Effect.Effect<ZenImportsCreateProjectResult, ZenImportsError>;
    /** The account-wide memory of the source app as `MEMORIE-<source>.md`. */
    readonly saveMemory: (
      input: ZenImportsSaveMemoryInput,
    ) => Effect.Effect<ZenImportsSaveMemoryResult, ZenImportsError>;
    /** Records the memory status shown on the import page. */
    readonly noteMemory: (threadId: string, status: string) => Effect.Effect<void>;
  }
>()("t3/zen/imports/ZenImports") {}

const fail = (reason: ZenImportsError["reason"], detail: string) =>
  new ZenImportsError({ reason, detail });

interface IndexEntry {
  readonly threadId: string;
  readonly projectId: string;
  readonly source: ZenImportSource;
  readonly externalId: string;
  readonly title: string;
  readonly messageCount: number;
  readonly createdAt: string | null;
  readonly importedAt: string;
  readonly continuedIn: ReadonlyArray<string>;
  readonly memory: string | null;
}

/** An imported project, keyed `<source>:<externalId>`, so a re-import reuses its folder. */
interface ProjectIndexEntry {
  readonly projectId: string;
  readonly folder: string;
  readonly name: string;
  readonly importedAt: string;
}

interface Index {
  readonly threads: Record<string, IndexEntry>;
  readonly projects: Record<string, ProjectIndexEntry>;
}

const isObject = (value: unknown): value is Record<string, never> =>
  typeof value === "object" && value !== null;

function loadIndex(file: string): Index {
  try {
    const raw = JSON.parse(NodeFS.readFileSync(file, "utf8")) as {
      threads?: unknown;
      projects?: unknown;
    };
    return {
      threads: isObject(raw.threads) ? (raw.threads as Record<string, IndexEntry>) : {},
      projects: isObject(raw.projects) ? (raw.projects as Record<string, ProjectIndexEntry>) : {},
    };
  } catch {
    return { threads: {}, projects: {} };
  }
}

function saveIndex(file: string, index: Index): void {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${NodeCrypto.randomBytes(4).toString("hex")}.tmp`;
  NodeFS.writeFileSync(temp, JSON.stringify({ version: 1, ...index }), { mode: 0o600 });
  NodeFS.renameSync(temp, file);
}

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectService.ProjectService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const ceiling = settingsService.managedPolicy?.limits?.maxRuntimeMode;
  const indexFile = NodePath.join(serverConfig.stateDir, "zen", "chat-imports.json");
  const loaded = loadIndex(indexFile);
  let index = loaded.threads;
  let projectIndex = loaded.projects;
  const persist = () => saveIndex(indexFile, { threads: index, projects: projectIndex });
  const updateIndex = (
    change: (current: Record<string, IndexEntry>) => Record<string, IndexEntry>,
  ) => {
    index = change(index);
    persist();
  };

  const projectDefaults = Effect.fn("ZenImports.projectDefaults")(function* (projectId: ProjectId) {
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError(() => fail("unavailable", "The folder could not be read.")));
    if (Option.isNone(project))
      return yield* fail("not-found", "That folder is not on this machine.");
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => fail("unavailable", "The settings could not be read.")),
    );
    const resolved = resolveProjectSettings(settings, project.value.id, project.value).settings;
    const mode = resolved.defaultRuntimeMode;
    const runtimeMode = ceiling !== undefined && isRuntimeModeAbove(mode, ceiling) ? ceiling : mode;
    const modelSelection: ModelSelection = resolved.defaultModelSelection ?? {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("claudeAgent")] ?? DEFAULT_MODEL,
    };
    return { project: project.value, runtimeMode, modelSelection };
  });

  const threadExists = (threadId: ThreadId) =>
    orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.map((records) => records.thread.deletedAt === null),
      Effect.orElseSucceed(() => false),
    );

  const create = Effect.fn("ZenImports.create")(function* (input: ZenImportsCreateInput) {
    const defaults = yield* projectDefaults(input.projectId);
    const created: Array<{ externalId: string; threadId: ThreadId }> = [];
    const existing: Array<{ externalId: string; threadId: ThreadId }> = [];
    const empty: Array<string> = [];
    for (const conversation of input.conversations) {
      const threadId = importThreadId(input.source, conversation.externalId);
      if (yield* threadExists(threadId)) {
        existing.push({ externalId: conversation.externalId, threadId });
        continue;
      }
      const messages = usableMessages(conversation.messages);
      if (!messages.some((message) => message.role !== "tool")) {
        empty.push(conversation.externalId);
        continue;
      }
      const now = DateTime.makeUnsafe(Date.now());
      yield* eventSink
        .write({
          events: buildImportedThreadEvents({
            threadId,
            projectId: defaults.project.id,
            source: input.source,
            conversation,
            modelSelection: defaults.modelSelection,
            runtimeMode: defaults.runtimeMode,
            now,
          }),
        })
        .pipe(Effect.mapError(() => fail("unavailable", "The chat could not be saved.")));
      created.push({ externalId: conversation.externalId, threadId });
      if (conversation.starred === true) {
        // Starred in ChatGPT / Claude.ai: pinned here, through the normal pin command.
        yield* orchestrator
          .dispatch({
            type: "thread.pin",
            commandId: CommandId.make(`zen-import:pin:${threadId}`),
            threadId,
          })
          .pipe(Effect.ignore);
      }
      const previous = index[threadId];
      updateIndex((current) => ({
        ...current,
        [threadId]: {
          threadId,
          projectId: defaults.project.id,
          source: input.source,
          externalId: conversation.externalId,
          title: conversation.title,
          messageCount: messages.length,
          createdAt: conversation.createdAt,
          importedAt: DateTime.formatIso(now),
          continuedIn: previous?.continuedIn ?? [],
          memory: previous?.memory ?? null,
        },
      }));
    }
    return { created, existing, empty } satisfies ZenImportsCreateResult;
  });

  const list = Effect.gen(function* () {
    const threads: Array<ZenImportedThread> = [];
    for (const entry of Object.values(index)) {
      // A thread deleted in the app drops out of the list (its index row stays for dedupe).
      if (!(yield* threadExists(ThreadId.make(entry.threadId)))) continue;
      threads.push({
        threadId: ThreadId.make(entry.threadId),
        projectId: entry.projectId as ProjectId,
        source: entry.source,
        externalId: entry.externalId,
        title: entry.title,
        messageCount: entry.messageCount,
        createdAt: entry.createdAt,
        importedAt: entry.importedAt,
        continuedIn: entry.continuedIn.map((id) => ThreadId.make(id)),
        memory: entry.memory,
      });
    }
    threads.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
    return { threads } satisfies ZenImportsListResult;
  });

  const summarize = (prompt: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        // Providers run in a working directory; the summary must not read a checkout.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-import-" });
        const generated = yield* textGeneration.generateTranscriptionPostProcessing({
          cwd,
          prompt,
          modelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: ZEN_MEMORY_SUMMARY_MODEL,
          } as ModelSelection,
        });
        return generated.transcription.trim();
      }),
    );

  const continueThread = Effect.fn("ZenImports.continueThread")(function* (
    input: ZenImportsContinueInput,
  ) {
    const source = zenImportSourceOfThread(input.threadId);
    if (source === null) return yield* fail("invalid-input", "This chat was not imported.");
    const records = yield* orchestrator
      .getThreadRecords(input.threadId, ["messages"])
      .pipe(Effect.mapError(() => fail("not-found", "The imported chat is no longer here.")));
    const { thread } = records;
    const defaults = yield* projectDefaults(thread.projectId);
    const messages: ReadonlyArray<ContinuationMessage> = records.messages
      .filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") && message.text.trim() !== "",
      )
      .toSorted(
        (left, right) =>
          DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
      )
      .map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        text: message.text,
        createdAt: DateTime.formatIso(message.createdAt),
      }));
    // Secrets pasted into the old chat are not carried into a prompt.
    const transcript = redactSensitive(continuationTranscript(messages)).text;
    const generated = yield* summarize(continuationPrompt(thread.title, source, transcript)).pipe(
      Effect.map((text) => (text.length > 0 ? redactSensitive(text).text : null)),
      Effect.orElseSucceed(() => null),
    );
    const threadId = ThreadId.make(NodeCrypto.randomUUID());
    yield* eventSink
      .write({
        events: buildContinuationEvents({
          threadId,
          projectId: thread.projectId,
          source,
          title: thread.title,
          summary: generated ?? excerptSummary(messages),
          messages,
          modelSelection: defaults.modelSelection,
          runtimeMode: defaults.runtimeMode,
          now: DateTime.makeUnsafe(Date.now()),
        }),
      })
      .pipe(Effect.mapError(() => fail("unavailable", "The new chat could not be created.")));
    const entry = index[input.threadId];
    if (entry !== undefined) {
      updateIndex((current) => ({
        ...current,
        [input.threadId]: { ...entry, continuedIn: [...entry.continuedIn, threadId] },
      }));
    }
    return {
      threadId,
      summary: generated === null ? "excerpt" : "model",
    } satisfies ZenImportsContinueResult;
  });

  const anchorRoot = Effect.fn("ZenImports.anchorRoot")(function* (folderProjectId: ProjectId) {
    const project = yield* projects
      .getById(folderProjectId)
      .pipe(Effect.mapError(() => fail("unavailable", "The folder could not be read.")));
    if (Option.isNone(project))
      return yield* fail("not-found", "That folder is not on this machine.");
    return project.value.workspaceRoot;
  });

  const writeFiles = <A>(write: () => A) =>
    Effect.try({
      try: write,
      catch: (cause) =>
        fail(
          "invalid-input",
          cause instanceof Error ? cause.message : "The files could not be written.",
        ),
    });

  const today = DateTime.now.pipe(Effect.map((now) => DateTime.formatIso(now).slice(0, 10)));

  /** Same pattern as resuming a terminal session: reuse a project on that folder, or add one. */
  const ensureProject = Effect.fn("ZenImports.ensureProject")(function* (
    folder: string,
    title: string,
  ) {
    const existing = yield* projects
      .getByWorkspaceRoot(folder)
      .pipe(Effect.mapError(() => fail("unavailable", "The projects could not be read.")));
    if (Option.isSome(existing)) return existing.value.id;
    const id = NodeCrypto.randomUUID();
    return yield* projects
      .bootstrap({
        commandId: CommandId.make(`zen-import-project:${id}`),
        projectId: ProjectId.make(id),
        title,
        workspaceRoot: folder,
      })
      .pipe(
        Effect.map(({ project }) => project.id),
        Effect.catchTags({
          ProjectConflictError: (conflict) => Effect.succeed(conflict.conflictingProjectId),
        }),
        Effect.mapError(() => fail("unavailable", "The project could not be added.")),
      );
  });

  const createProject = Effect.fn("ZenImports.createProject")(function* (
    input: ZenImportsCreateProjectInput,
  ) {
    const total = input.project.files.reduce((sum, file) => sum + file.content.length, 0);
    if (total > ZEN_IMPORT_LIMITS.charsPerProjectFiles + ZEN_IMPORT_LIMITS.charsPerProjectFile) {
      return yield* fail("invalid-input", "The project's files are too large to send at once.");
    }
    const root = yield* anchorRoot(input.folderProjectId);
    const key = `${input.source}:${input.project.externalId}`;
    const previous = projectIndex[key];
    const base = yield* writeFiles(() => ensureBaseFolder(root, input.baseFolderName));
    const { folder, reused } = yield* writeFiles(() =>
      chooseProjectFolder({
        base,
        name: input.project.name,
        previousFolder: previous?.folder ?? null,
      }),
    );
    const date = yield* today;
    const outcome = yield* writeFiles(() =>
      writeImportedProject({
        base,
        folder,
        source: input.source,
        language: input.language,
        project: input.project,
        date,
      }),
    );
    const projectId = yield* ensureProject(folder, input.project.name.trim());
    projectIndex = {
      ...projectIndex,
      [key]: {
        projectId,
        folder,
        name: input.project.name,
        importedAt: previous?.importedAt ?? DateTime.formatIso(DateTime.makeUnsafe(Date.now())),
      },
    };
    persist();
    return {
      projectId,
      folder,
      reused,
      written: outcome.written,
      kept: outcome.kept,
      skipped: outcome.skipped,
    } satisfies ZenImportsCreateProjectResult;
  });

  const saveMemory = Effect.fn("ZenImports.saveMemory")(function* (
    input: ZenImportsSaveMemoryInput,
  ) {
    const root = yield* anchorRoot(input.folderProjectId);
    const base = yield* writeFiles(() => ensureBaseFolder(root, input.baseFolderName));
    const date = yield* today;
    return yield* writeFiles(() =>
      writeGlobalMemory({
        base,
        source: input.source,
        language: input.language,
        memory: input.memory,
        date,
      }),
    );
  });

  const noteMemory = (threadId: string, status: string) =>
    Effect.sync(() => {
      const entry = index[threadId];
      if (entry === undefined) return;
      updateIndex((current) => ({ ...current, [threadId]: { ...entry, memory: status } }));
    });

  return ZenImports.of({ create, list, continueThread, createProject, saveMemory, noteMemory });
});

export const layer = Layer.effect(ZenImports, make);

const memoryUnavailable = (threadId: ThreadId): ZenImportsMemoryItem => ({
  threadId,
  status: "off",
  companyId: null,
  summary: null,
  redacted: [],
  detail: "Company memory is not available on this server.",
});

/**
 * RPC handlers for ws.ts. Company memory is reached through the ZenMemory service ws.ts already
 * holds, so its summary, redaction, queue and per-company switch are the ones regular chats use.
 */
export const wsHandlers = (
  service: Option.Option<ZenImports["Service"]>,
  memory: Option.Option<ZenMemory.ZenMemory["Service"]>,
) => {
  const unavailable = Effect.fail(
    fail("unavailable", "Chat imports are not available on this server."),
  );
  const call = <A>(task: (imports: ZenImports["Service"]) => Effect.Effect<A, ZenImportsError>) =>
    Option.isSome(service) ? task(service.value) : unavailable;
  const eachThread = (
    input: ZenImportsMemoryInput,
    step: (
      memory: ZenMemory.ZenMemory["Service"],
      threadId: ThreadId,
    ) => Effect.Effect<Omit<ZenImportsMemoryItem, "threadId">, ZenMemoryError>,
  ): Effect.Effect<ZenImportsMemoryResult, ZenImportsError> =>
    call((imports) =>
      Effect.forEach(input.threadIds, (threadId) => {
        if (zenImportSourceOfThread(threadId) === null) {
          return Effect.fail(fail("invalid-input", "Only imported chats are sent from here."));
        }
        if (Option.isNone(memory)) return Effect.succeed(memoryUnavailable(threadId));
        return step(memory.value, threadId).pipe(
          Effect.map((item) => ({ ...item, threadId })),
          Effect.catch((cause) =>
            Effect.succeed({
              threadId,
              status: "failed" as const,
              companyId: null,
              summary: null,
              redacted: [],
              detail: cause.message,
            }),
          ),
          Effect.tap((item) =>
            item.status === "queued" ? imports.noteMemory(threadId, "queued") : Effect.void,
          ),
        );
      }).pipe(Effect.map((items) => ({ items }))),
    );
  return {
    [ZEN_IMPORTS_WS_METHODS.create]: (input: ZenImportsCreateInput) =>
      call((imports) => imports.create(input)),
    [ZEN_IMPORTS_WS_METHODS.list]: () => call((imports) => imports.list),
    [ZEN_IMPORTS_WS_METHODS.continueThread]: (input: ZenImportsContinueInput) =>
      call((imports) => imports.continueThread(input)),
    [ZEN_IMPORTS_WS_METHODS.createProject]: (input: ZenImportsCreateProjectInput) =>
      call((imports) => imports.createProject(input)),
    [ZEN_IMPORTS_WS_METHODS.saveMemory]: (input: ZenImportsSaveMemoryInput) =>
      call((imports) => imports.saveMemory(input)),
    [ZEN_IMPORTS_WS_METHODS.memoryPreview]: (input: ZenImportsMemoryInput) =>
      eachThread(input, (zenMemory, threadId) => zenMemory.previewImported(threadId)),
    [ZEN_IMPORTS_WS_METHODS.memorySend]: (input: ZenImportsMemoryInput) =>
      eachThread(input, (zenMemory, threadId) => zenMemory.sendImported(threadId)),
  };
};
