// Zen Staff chat imports: ChatGPT / Claude.ai / Gemini export conversations (parsed in the
// browser) become read-only archived threads, continued in a new chat from a summary, and
// optionally summarized into company memory (opt-in, previewed). ChatGPT and Claude.ai projects
// become folders with AGENTS.md, knowledge files and memory. See ZEN.md, "Chat imports".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { NonNegativeInt, ProjectId, ThreadId } from "./baseSchemas.ts";

export const ZEN_IMPORTS_WS_METHODS = {
  create: "zen.imports.create",
  list: "zen.imports.list",
  continueThread: "zen.imports.continue",
  memoryPreview: "zen.imports.memoryPreview",
  memorySend: "zen.imports.memorySend",
  createProject: "zen.imports.createProject",
  saveMemory: "zen.imports.saveMemory",
} as const;

export const ZenImportSource = Schema.Literals(["chatgpt", "claude", "gemini"]);
export type ZenImportSource = typeof ZenImportSource.Type;

/** Limits the server enforces; the web splits bigger selections into several calls. */
export const ZEN_IMPORT_LIMITS = {
  conversationsPerCall: 50,
  messagesPerConversation: 5_000,
  charsPerMessage: 200_000,
  /** A project's knowledge files: each, all of them together, and how many. */
  charsPerProjectFile: 2_000_000,
  charsPerProjectFiles: 3_500_000,
  filesPerProject: 200,
  charsPerInstructions: 200_000,
  charsPerMemory: 200_000,
} as const;

export const ZenImportedMessage = Schema.Struct({
  /** `tool` = a tool call or its result (code interpreter, browsing, artifacts...). */
  role: Schema.Literals(["user", "assistant", "tool"]),
  text: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
  toolName: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});
export type ZenImportedMessage = typeof ZenImportedMessage.Type;

export const ZenImportedConversation = Schema.Struct({
  /** The export's own id for the conversation, used to import it only once. */
  externalId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
  title: Schema.String.check(Schema.isMaxLength(500)),
  createdAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  messages: Schema.Array(ZenImportedMessage).check(
    Schema.isMaxLength(ZEN_IMPORT_LIMITS.messagesPerConversation),
  ),
  /** Starred in the source app: the imported thread is pinned. */
  starred: Schema.optional(Schema.Boolean),
});
export type ZenImportedConversation = typeof ZenImportedConversation.Type;

export const ZenImportsCreateInput = Schema.Struct({
  projectId: ProjectId,
  source: ZenImportSource,
  conversations: Schema.Array(ZenImportedConversation).check(
    Schema.isMaxLength(ZEN_IMPORT_LIMITS.conversationsPerCall),
  ),
});
export type ZenImportsCreateInput = typeof ZenImportsCreateInput.Type;

export const ZenImportsCreateResult = Schema.Struct({
  created: Schema.Array(Schema.Struct({ externalId: Schema.String, threadId: ThreadId })),
  /** Already imported on this environment (the existing thread is returned). */
  existing: Schema.Array(Schema.Struct({ externalId: Schema.String, threadId: ThreadId })),
  /** Nothing usable in it (no user or assistant text). */
  empty: Schema.Array(Schema.String),
});
export type ZenImportsCreateResult = typeof ZenImportsCreateResult.Type;

export const ZenImportedThread = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: ZenImportSource,
  externalId: Schema.String,
  title: Schema.String,
  messageCount: NonNegativeInt,
  createdAt: Schema.NullOr(Schema.String),
  importedAt: Schema.String,
  /** The threads started from it with "Continue in a new chat". */
  continuedIn: Schema.Array(ThreadId),
  /** Status of "Send the useful parts to company memory", if it was used. */
  memory: Schema.NullOr(Schema.String),
});
export type ZenImportedThread = typeof ZenImportedThread.Type;

export const ZenImportsListResult = Schema.Struct({
  threads: Schema.Array(ZenImportedThread),
});
export type ZenImportsListResult = typeof ZenImportsListResult.Type;

export const ZenImportsContinueInput = Schema.Struct({ threadId: ThreadId });
export type ZenImportsContinueInput = typeof ZenImportsContinueInput.Type;

export const ZenImportsContinueResult = Schema.Struct({
  threadId: ThreadId,
  /** `model` = Haiku wrote the summary; `excerpt` = the model was not there, so the first and
   *  latest messages were carried over instead. */
  summary: Schema.Literals(["model", "excerpt"]),
});
export type ZenImportsContinueResult = typeof ZenImportsContinueResult.Type;

export const ZenImportsMemoryInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});
export type ZenImportsMemoryInput = typeof ZenImportsMemoryInput.Type;

export const ZenImportsMemoryItem = Schema.Struct({
  threadId: ThreadId,
  /**
   * ready = a summary waits for confirmation; nothing = no business content; skipped = small
   * talk or too short; off = the company has no memory or saving is turned off; queued = sent to
   * the queue; failed = could not be summarized.
   */
  status: Schema.Literals(["ready", "nothing", "skipped", "off", "queued", "failed"]),
  companyId: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  /** What was redacted before the summary was made (kinds, not values). */
  redacted: Schema.Array(Schema.String),
  detail: Schema.NullOr(Schema.String),
});
export type ZenImportsMemoryItem = typeof ZenImportsMemoryItem.Type;

export const ZenImportsMemoryResult = Schema.Struct({
  items: Schema.Array(ZenImportsMemoryItem),
});
export type ZenImportsMemoryResult = typeof ZenImportsMemoryResult.Type;

/** Projects can be recreated from ChatGPT and Claude.ai exports (Gemini has none). */
export const ZenImportProjectSource = Schema.Literals(["chatgpt", "claude"]);
export type ZenImportProjectSource = typeof ZenImportProjectSource.Type;

/** Where imported projects go: a folder named `baseFolderName` inside the chosen folder. */
const ZenImportBase = {
  /** The folder picked on the import page; the base folder is created inside it. */
  folderProjectId: ProjectId,
  baseFolderName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  source: ZenImportProjectSource,
  /** Language of the headings written into AGENTS.md / MEMORIE.md. */
  language: Schema.Literals(["en", "ro"]),
};

export const ZenImportedProjectFile = Schema.Struct({
  /** The file name from the export: untrusted, sanitized by the server. */
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  content: Schema.String.check(Schema.isMaxLength(ZEN_IMPORT_LIMITS.charsPerProjectFile)),
});
export type ZenImportedProjectFile = typeof ZenImportedProjectFile.Type;

export const ZenImportedProject = Schema.Struct({
  externalId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  description: Schema.String.check(Schema.isMaxLength(20_000)),
  instructions: Schema.String.check(Schema.isMaxLength(ZEN_IMPORT_LIMITS.charsPerInstructions)),
  memory: Schema.NullOr(Schema.String.check(Schema.isMaxLength(ZEN_IMPORT_LIMITS.charsPerMemory))),
  files: Schema.Array(ZenImportedProjectFile).check(
    Schema.isMaxLength(ZEN_IMPORT_LIMITS.filesPerProject),
  ),
});
export type ZenImportedProject = typeof ZenImportedProject.Type;

export const ZenImportsCreateProjectInput = Schema.Struct({
  ...ZenImportBase,
  project: ZenImportedProject,
});
export type ZenImportsCreateProjectInput = typeof ZenImportsCreateProjectInput.Type;

export const ZenImportsCreateProjectResult = Schema.Struct({
  projectId: ProjectId,
  folder: Schema.String,
  /** The project was imported before: its folder and Zen project were reused. */
  reused: Schema.Boolean,
  /** Files written now, relative to the project folder. */
  written: Schema.Array(Schema.String),
  /** Files already there (never overwritten: the person may have edited them). */
  kept: Schema.Array(Schema.String),
  skipped: Schema.Array(Schema.Struct({ name: Schema.String, reason: Schema.String })),
});
export type ZenImportsCreateProjectResult = typeof ZenImportsCreateProjectResult.Type;

export const ZenImportsSaveMemoryInput = Schema.Struct({
  ...ZenImportBase,
  memory: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(ZEN_IMPORT_LIMITS.charsPerMemory),
  ),
});
export type ZenImportsSaveMemoryInput = typeof ZenImportsSaveMemoryInput.Type;

export const ZenImportsSaveMemoryResult = Schema.Struct({
  path: Schema.String,
  /** False when the file was already there (kept as it is). */
  written: Schema.Boolean,
});
export type ZenImportsSaveMemoryResult = typeof ZenImportsSaveMemoryResult.Type;

export class ZenImportsError extends Schema.TaggedError<ZenImportsError>()("ZenImportsError", {
  reason: Schema.Literals(["not-found", "invalid-input", "unavailable"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const errors = Schema.Union([ZenImportsError, EnvironmentAuthorizationError]);

const ZenImportsCreateRpc = Rpc.make(ZEN_IMPORTS_WS_METHODS.create, {
  payload: ZenImportsCreateInput,
  success: ZenImportsCreateResult,
  error: errors,
});
const ZenImportsListRpc = Rpc.make(ZEN_IMPORTS_WS_METHODS.list, {
  payload: Schema.Struct({}),
  success: ZenImportsListResult,
  error: errors,
});
const ZenImportsContinueRpc = Rpc.make(ZEN_IMPORTS_WS_METHODS.continueThread, {
  payload: ZenImportsContinueInput,
  success: ZenImportsContinueResult,
  error: errors,
});
const ZenImportsMemoryPreviewRpc = Rpc.make(ZEN_IMPORTS_WS_METHODS.memoryPreview, {
  payload: ZenImportsMemoryInput,
  success: ZenImportsMemoryResult,
  error: errors,
});
const ZenImportsMemorySendRpc = Rpc.make(ZEN_IMPORTS_WS_METHODS.memorySend, {
  payload: ZenImportsMemoryInput,
  success: ZenImportsMemoryResult,
  error: errors,
});

const ZenImportsCreateProjectRpc = Rpc.make(ZEN_IMPORTS_WS_METHODS.createProject, {
  payload: ZenImportsCreateProjectInput,
  success: ZenImportsCreateProjectResult,
  error: errors,
});
const ZenImportsSaveMemoryRpc = Rpc.make(ZEN_IMPORTS_WS_METHODS.saveMemory, {
  payload: ZenImportsSaveMemoryInput,
  success: ZenImportsSaveMemoryResult,
  error: errors,
});

/** Spread into `WsRpcGroup` (rpc.ts). */
export const ZEN_IMPORTS_RPCS = [
  ZenImportsCreateRpc,
  ZenImportsListRpc,
  ZenImportsContinueRpc,
  ZenImportsMemoryPreviewRpc,
  ZenImportsMemorySendRpc,
  ZenImportsCreateProjectRpc,
  ZenImportsSaveMemoryRpc,
] as const;

export const ZEN_IMPORTS_RPC_SCOPES = {
  [ZEN_IMPORTS_WS_METHODS.create]: AuthOrchestrationOperateScope,
  [ZEN_IMPORTS_WS_METHODS.list]: AuthOrchestrationReadScope,
  [ZEN_IMPORTS_WS_METHODS.continueThread]: AuthOrchestrationOperateScope,
  [ZEN_IMPORTS_WS_METHODS.memoryPreview]: AuthOrchestrationOperateScope,
  [ZEN_IMPORTS_WS_METHODS.memorySend]: AuthOrchestrationOperateScope,
  [ZEN_IMPORTS_WS_METHODS.createProject]: AuthOrchestrationOperateScope,
  [ZEN_IMPORTS_WS_METHODS.saveMemory]: AuthOrchestrationOperateScope,
} as const;

export const ZEN_IMPORTS_RPC_AGGREGATES = {
  [ZEN_IMPORTS_WS_METHODS.create]: "zen",
  [ZEN_IMPORTS_WS_METHODS.list]: "zen",
  [ZEN_IMPORTS_WS_METHODS.continueThread]: "zen",
  [ZEN_IMPORTS_WS_METHODS.memoryPreview]: "zen",
  [ZEN_IMPORTS_WS_METHODS.memorySend]: "zen",
  [ZEN_IMPORTS_WS_METHODS.createProject]: "zen",
  [ZEN_IMPORTS_WS_METHODS.saveMemory]: "zen",
} as const;

/** Import thread ids carry their source, so any client can tell an archived import apart. */
export const ZEN_IMPORT_THREAD_PREFIX = "zen-import:";

export function zenImportSourceOfThread(threadId: string): ZenImportSource | null {
  if (!threadId.startsWith(ZEN_IMPORT_THREAD_PREFIX)) return null;
  const source = threadId.slice(ZEN_IMPORT_THREAD_PREFIX.length).split(":")[0];
  return source === "chatgpt" || source === "claude" || source === "gemini" ? source : null;
}
