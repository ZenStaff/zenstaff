// Zen Staff: Claude Code / Codex sessions started outside the app (in a terminal), listed per
// environment so they can be found, searched and resumed. See ZEN.md.
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ZEN_CLI_SESSIONS_WS_METHODS = {
  list: "zen.cliSessions.list",
  resume: "zen.cliSessions.resume",
} as const;

export const ZenCliSessionProvider = Schema.Literals(["claudeAgent", "codex"]);
export type ZenCliSessionProvider = typeof ZenCliSessionProvider.Type;

/** Who started the session: a terminal CLI, this app, or another client (IDE, SDK, `-p` scripts). */
export const ZenCliSessionOrigin = Schema.Literals(["terminal", "app", "other"]);
export type ZenCliSessionOrigin = typeof ZenCliSessionOrigin.Type;

export const ZenCliSession = Schema.Struct({
  provider: ZenCliSessionProvider,
  providerInstanceId: ProviderInstanceId,
  sessionId: TrimmedNonEmptyString,
  title: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  gitBranch: Schema.NullOr(Schema.String),
  origin: ZenCliSessionOrigin,
  /** Raw client name from the transcript (`cli`, `sdk-cli`, `codex_cli_rs`...). */
  client: Schema.NullOr(Schema.String),
  messageCount: NonNegativeInt,
  startedAt: Schema.NullOr(IsoDateTime),
  lastActivityAt: IsoDateTime,
  sizeBytes: NonNegativeInt,
  /** The thread that already owns this session on this environment, if any. */
  threadId: Schema.NullOr(ThreadId),
  /** Short context around the first content match, for searches that did not match the title. */
  snippet: Schema.optional(Schema.String),
});
export type ZenCliSession = typeof ZenCliSession.Type;

export const ZenCliSessionsListInput = Schema.Struct({
  query: Schema.optional(Schema.String),
  origins: Schema.optional(Schema.Array(ZenCliSessionOrigin)),
  includeOwned: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
});
export type ZenCliSessionsListInput = typeof ZenCliSessionsListInput.Type;

export const ZenCliSessionsListResult = Schema.Struct({
  sessions: Schema.Array(ZenCliSession),
  /** Sessions matching the filters and query, before `limit`. */
  matchedCount: NonNegativeInt,
  indexedCount: NonNegativeInt,
  indexedAt: IsoDateTime,
});
export type ZenCliSessionsListResult = typeof ZenCliSessionsListResult.Type;

export const ZenCliSessionsResumeInput = Schema.Struct({
  provider: ZenCliSessionProvider,
  sessionId: TrimmedNonEmptyString,
  /**
   * `full` (default) imports the whole history, tool calls included, as the thread's timeline;
   * `recent` keeps only the first prompt and the latest messages. Either way the agent continues
   * the real session (native resume), so it keeps its own context.
   */
  history: Schema.optional(Schema.Literals(["full", "recent"])),
});
export type ZenCliSessionsResumeInput = typeof ZenCliSessionsResumeInput.Type;

export const ZenCliSessionsResumeResult = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  created: Schema.Boolean,
  /** Timeline entries written (messages and tool calls); absent when the thread existed. */
  importedItems: Schema.optional(NonNegativeInt),
});
export type ZenCliSessionsResumeResult = typeof ZenCliSessionsResumeResult.Type;

export class ZenCliSessionsError extends Schema.TaggedError<ZenCliSessionsError>()(
  "ZenCliSessionsError",
  {
    operation: Schema.Literals(["list", "resume"]),
    reason: Schema.Literals([
      "session-not-found",
      "missing-directory",
      "thread-deleted",
      "unavailable",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ZenCliSessionsListRpc = Rpc.make(ZEN_CLI_SESSIONS_WS_METHODS.list, {
  payload: ZenCliSessionsListInput,
  success: ZenCliSessionsListResult,
  error: Schema.Union([ZenCliSessionsError, EnvironmentAuthorizationError]),
});

export const ZenCliSessionsResumeRpc = Rpc.make(ZEN_CLI_SESSIONS_WS_METHODS.resume, {
  payload: ZenCliSessionsResumeInput,
  success: ZenCliSessionsResumeResult,
  error: Schema.Union([ZenCliSessionsError, EnvironmentAuthorizationError]),
});

export const ZEN_CLI_SESSIONS_RPC_SCOPES = {
  [ZEN_CLI_SESSIONS_WS_METHODS.list]: AuthOrchestrationReadScope,
  [ZEN_CLI_SESSIONS_WS_METHODS.resume]: AuthOrchestrationOperateScope,
} as const;
