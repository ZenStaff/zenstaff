import {
  ClaudeSettings,
  CodexSettings,
  ProviderInstanceId,
  ThreadId,
  resolveProviderInstanceEnabled,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import {
  ZEN_CLI_SESSIONS_WS_METHODS,
  ZenCliSessionsError,
  type ZenCliSession,
  type ZenCliSessionOrigin,
  type ZenCliSessionProvider,
  type ZenCliSessionsListInput,
  type ZenCliSessionsListResult,
  type ZenCliSessionsResumeInput,
  type ZenCliSessionsResumeResult,
} from "@t3tools/contracts/zenCliSessions";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as CliSessionImport from "./CliSessionImport.ts";
import { FullHistory } from "./historyParser.ts";
import {
  LineSplitter,
  RecentMessages,
  cloneDigest,
  compileQuery,
  consumeLine,
  emptyDigest,
  matchSession,
  resolveOrigin,
  resolveTitle,
  type SessionDigest,
} from "./transcriptParser.ts";

const READ_CHUNK_BYTES = 1024 * 1024;
const PARSE_CONCURRENCY = 4;
const STAT_CONCURRENCY = 32;
/** Requests inside this window reuse the last directory walk. */
const REFRESH_INTERVAL_MS = 3_000;
const OWNERSHIP_INTERVAL_MS = 3_000;
const PERSIST_INTERVAL_MS = 5 * 60_000;
const DEFAULT_LIST_LIMIT = 200;
const INDEX_FILE_VERSION = 1;
const RESUME_MESSAGE_LIMIT = 40;
const RESUME_MESSAGE_CHARS = 200_000;

interface IndexEntry {
  readonly filePath: string;
  readonly provider: ZenCliSessionProvider;
  readonly providerInstanceId: ProviderInstanceId;
  readonly size: number;
  readonly mtimeMs: number;
  readonly inode: string | null;
  readonly device: number;
  readonly birthtimeMs: number | null;
  /** Bytes parsed so far, always at a line boundary. */
  readonly offset: number;
  readonly digest: SessionDigest;
}

interface Source {
  readonly provider: ZenCliSessionProvider;
  readonly providerInstanceId: ProviderInstanceId;
  readonly homePath: string;
}

const PersistedIndex = Schema.Struct({
  version: Schema.Literal(INDEX_FILE_VERSION),
  entries: Schema.Array(Schema.Unknown),
});
const decodePersistedIndex = Schema.decodeUnknownOption(Schema.fromJsonString(PersistedIndex));
const encodePersistedIndex = Schema.encodeEffect(Schema.fromJsonString(PersistedIndex));
const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);

function isIndexEntry(value: unknown): value is IndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<IndexEntry>;
  return (
    typeof entry.filePath === "string" &&
    (entry.provider === "claudeAgent" || entry.provider === "codex") &&
    typeof entry.providerInstanceId === "string" &&
    typeof entry.size === "number" &&
    typeof entry.mtimeMs === "number" &&
    typeof entry.offset === "number" &&
    typeof entry.digest === "object" &&
    entry.digest !== null &&
    typeof entry.digest.userText?.head === "string"
  );
}

const isZenCliSessionsError = Schema.is(ZenCliSessionsError);

const fail = (
  operation: ZenCliSessionsError["operation"],
  reason: ZenCliSessionsError["reason"],
  detail: string,
) => new ZenCliSessionsError({ operation, reason, detail });

export class ZenCliSessions extends Context.Service<
  ZenCliSessions,
  {
    readonly list: (
      input: ZenCliSessionsListInput,
    ) => Effect.Effect<ZenCliSessionsListResult, ZenCliSessionsError>;
    readonly resume: (
      input: ZenCliSessionsResumeInput,
    ) => Effect.Effect<ZenCliSessionsResumeResult, ZenCliSessionsError>;
  }
>()("t3/zen/cliSessions/ZenCliSessions") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const importer = yield* CliSessionImport.CliSessionImport;
  const homeDir = yield* HostProcess.HomeDirectory;
  const hostEnvironment = yield* HostProcess.Environment;

  const indexFile = path.join(serverConfig.stateDir, "zen", "cli-sessions-index.json");
  const entries = new Map<string, IndexEntry>();
  const refreshLock = yield* Semaphore.make(1);
  let refreshedAt: number | null = null;
  let indexedAt = 0;
  let loaded = false;
  let dirty = false;
  let persistedAt = 0;
  let owners: ReadonlyMap<string, ThreadId> = new Map();
  let ownersAt: number | null = null;

  const resolveHome = (
    configured: string,
    environmentHome: string | undefined,
    fallback: string,
  ) => {
    const explicit = configured.trim();
    if (explicit.length > 0) return path.resolve(expandHomePath(explicit, homeDir));
    const fromEnvironment = environmentHome?.trim() ?? "";
    if (fromEnvironment.length > 0) return path.resolve(expandHomePath(fromEnvironment, homeDir));
    return path.join(homeDir, fallback);
  };

  // Same homes the provider instances run with, so sessions resume on the instance that wrote them.
  const resolveSources = Effect.fn("ZenCliSessions.resolveSources")(function* () {
    const settings = yield* serverSettings.getSettings.pipe(Effect.option);
    const instances = Option.match(settings, {
      onNone: () => [] as Array<[string, ProviderInstanceConfig]>,
      onSome: (value) => Object.entries(value.providerInstances),
    });
    const sources: Array<Source> = [];
    const seen = new Set<string>();
    for (const provider of ["claudeAgent", "codex"] as const) {
      const configured = instances.filter(
        ([, instance]) => instance.driver === provider && resolveProviderInstanceEnabled(instance),
      );
      if (!configured.some(([id]) => id === provider)) {
        configured.unshift([provider, { driver: provider } as ProviderInstanceConfig]);
      }
      for (const [instanceId, instance] of configured) {
        const variable = provider === "claudeAgent" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
        const environmentHome =
          instance.environment?.findLast((entry) => entry.name === variable)?.value ??
          hostEnvironment[variable];
        const homePath =
          provider === "claudeAgent"
            ? resolveHome(
                Option.match(decodeClaudeSettings(instance.config ?? {}), {
                  onNone: () => "",
                  onSome: (config) => config.homePath,
                }),
                typeof environmentHome === "string" ? environmentHome : undefined,
                ".claude",
              )
            : resolveHome(
                Option.match(decodeCodexSettings(instance.config ?? {}), {
                  onNone: () => "",
                  onSome: (config) => config.homePath,
                }),
                typeof environmentHome === "string" ? environmentHome : undefined,
                ".codex",
              );
        const key = `${provider}:${homePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sources.push({
          provider,
          providerInstanceId: ProviderInstanceId.make(instanceId),
          homePath,
        });
      }
    }
    return sources;
  });

  const listDirectory = (directory: string, recursive = false) =>
    fileSystem
      .readDirectory(directory, { recursive })
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

  const discover = Effect.fn("ZenCliSessions.discover")(function* (sources: ReadonlyArray<Source>) {
    const found: Array<{ readonly filePath: string; readonly source: Source }> = [];
    for (const source of sources) {
      if (source.provider === "claudeAgent") {
        const projectsDir = path.join(source.homePath, "projects");
        const projectDirs = yield* listDirectory(projectsDir);
        const listings = yield* Effect.forEach(
          projectDirs,
          (name) =>
            listDirectory(path.join(projectsDir, name)).pipe(
              Effect.map((files) => ({ dir: path.join(projectsDir, name), files })),
            ),
          { concurrency: STAT_CONCURRENCY },
        );
        // Only direct children: subagent transcripts live in `<session>/subagents/`.
        for (const { dir, files } of listings) {
          for (const file of files) {
            if (file.endsWith(".jsonl")) found.push({ filePath: path.join(dir, file), source });
          }
        }
      } else {
        const sessionsDir = path.join(source.homePath, "sessions");
        for (const file of yield* listDirectory(sessionsDir, true)) {
          if (file.endsWith(".jsonl"))
            found.push({ filePath: path.join(sessionsDir, file), source });
        }
      }
    }
    return found;
  });

  /** Streams `filePath` from `start` to `end` through `onLine`; returns bytes consumed up to the last full line. */
  const streamLines = Effect.fn("ZenCliSessions.streamLines")(function* (
    filePath: string,
    start: number,
    end: number,
    onLine: (line: string, oversized: boolean) => void,
  ) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(filePath, { flag: "r" });
        const splitter = new LineSplitter(onLine);
        const buffer = new Uint8Array(READ_CHUNK_BYTES);
        let position = start;
        while (position < end) {
          const read = yield* file.read(
            buffer.subarray(0, Math.min(READ_CHUNK_BYTES, end - position)),
            {
              position: BigInt(position),
            },
          );
          if (read <= 0) break;
          splitter.push(buffer.subarray(0, read));
          position += read;
        }
        return splitter.completedBytes;
      }),
    );
  });

  const indexFileEntry = Effect.fn("ZenCliSessions.indexFile")(function* (
    filePath: string,
    source: Source,
    info: FileSystem.File.Info,
    cached: IndexEntry | undefined,
  ) {
    const size = Number(info.size);
    const mtimeMs = Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() });
    const inode = Option.match(info.ino, { onNone: () => null, onSome: String });
    const birthtimeMs = Option.match(info.birthtime, {
      onNone: () => null,
      onSome: (date) => date.getTime(),
    });
    if (cached !== undefined && cached.size === size && cached.mtimeMs === mtimeMs) return cached;
    // Transcripts are append-only: when one only grew, parse just the new lines.
    const append =
      cached !== undefined &&
      cached.provider === source.provider &&
      cached.inode === inode &&
      size >= cached.offset &&
      size > cached.size;
    const digest = append ? cloneDigest(cached.digest) : emptyDigest(source.provider);
    const start = append ? cached.offset : 0;
    const consumed = yield* streamLines(filePath, start, size, (line, oversized) =>
      consumeLine(digest, line, oversized),
    );
    return {
      filePath,
      provider: source.provider,
      providerInstanceId: source.providerInstanceId,
      size,
      mtimeMs,
      inode,
      device: Number(info.dev),
      birthtimeMs,
      offset: start + consumed,
      digest,
    } satisfies IndexEntry;
  });

  const loadPersisted = Effect.fn("ZenCliSessions.loadPersisted")(function* () {
    loaded = true;
    const text = yield* fileSystem.readFileString(indexFile).pipe(Effect.option);
    if (Option.isNone(text)) return;
    const persisted = decodePersistedIndex(text.value);
    if (Option.isNone(persisted)) return;
    for (const entry of persisted.value.entries) {
      if (isIndexEntry(entry)) entries.set(entry.filePath, entry);
    }
  });

  const persist = Effect.fn("ZenCliSessions.persist")(
    function* (force: boolean) {
      const now = yield* Clock.currentTimeMillis;
      if (!dirty || (!force && now - persistedAt < PERSIST_INTERVAL_MS)) return;
      dirty = false;
      persistedAt = now;
      const directory = path.dirname(indexFile);
      const temporary = `${indexFile}.${process.pid}.tmp`;
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      // Transcripts hold client data: the index stays readable only by the server's user.
      const contents = yield* encodePersistedIndex({
        version: INDEX_FILE_VERSION,
        entries: [...entries.values()],
      });
      yield* fileSystem.writeFileString(temporary, contents, { mode: 0o600 });
      yield* fileSystem.rename(temporary, indexFile);
    },
    (effect) => Effect.ignore(effect),
  );

  const refresh = Effect.fn("ZenCliSessions.refresh")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (refreshedAt !== null && now - refreshedAt < REFRESH_INTERVAL_MS) return;
    if (!loaded) yield* loadPersisted();
    const sources = yield* resolveSources();
    const found = yield* discover(sources);
    const seen = new Set<string>();
    let changed = false;
    const stats = yield* Effect.forEach(
      found,
      ({ filePath, source }) =>
        fileSystem.stat(filePath).pipe(
          Effect.map((info) => ({ filePath, source, info })),
          Effect.option,
        ),
      { concurrency: STAT_CONCURRENCY },
    );
    yield* Effect.forEach(
      stats,
      (stat) =>
        Effect.gen(function* () {
          if (Option.isNone(stat) || stat.value.info.type !== "File") return;
          const { filePath, source, info } = stat.value;
          if (seen.has(filePath)) return;
          seen.add(filePath);
          const cached = entries.get(filePath);
          const next = yield* indexFileEntry(filePath, source, info, cached).pipe(Effect.option);
          if (Option.isSome(next) && next.value !== cached) {
            entries.set(filePath, next.value);
            changed = true;
          }
        }),
      { concurrency: PARSE_CONCURRENCY, discard: true },
    );
    for (const filePath of entries.keys()) {
      if (!seen.has(filePath)) {
        entries.delete(filePath);
        changed = true;
      }
    }
    const finishedAt = yield* Clock.currentTimeMillis;
    refreshedAt = finishedAt;
    if (changed || indexedAt === 0) indexedAt = finishedAt;
    dirty ||= changed;
    yield* persist(false);
  });

  // Sessions this environment already runs as threads: Claude/Codex session ids are the provider
  // threads' native ids, for threads started here and for imported ones alike.
  const refreshOwners = Effect.fn("ZenCliSessions.refreshOwners")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (ownersAt !== null && now - ownersAt < OWNERSHIP_INTERVAL_MS) return owners;
    const rows = yield* sql<{
      readonly threadId: string;
      readonly driver: string;
      readonly nativeId: string;
    }>`
      SELECT
        provider_threads.thread_id AS "threadId",
        provider_threads.driver AS "driver",
        json_extract(provider_threads.payload_json, '$.nativeThreadRef.nativeId') AS "nativeId"
      FROM orchestration_v2_projection_provider_threads AS provider_threads
      JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = provider_threads.thread_id
      WHERE provider_threads.driver IN ('claudeAgent', 'codex')
        AND threads.deleted_at IS NULL
        AND json_extract(provider_threads.payload_json, '$.nativeThreadRef.nativeId') IS NOT NULL
    `.pipe(Effect.orElseSucceed(() => []));
    owners = new Map(
      rows.map((row) => [`${row.driver}:${row.nativeId}`, ThreadId.make(row.threadId)]),
    );
    ownersAt = now;
    return owners;
  });

  const sessionIdOf = (entry: IndexEntry) =>
    entry.digest.sessionId ??
    (entry.provider === "claudeAgent" ? path.basename(entry.filePath, ".jsonl") : null);

  const toSession = (
    entry: IndexEntry,
    sessionId: string,
    owner: ThreadId | null,
  ): ZenCliSession => ({
    provider: entry.provider,
    providerInstanceId: entry.providerInstanceId,
    sessionId,
    title: resolveTitle(entry.digest),
    cwd: entry.digest.cwd,
    gitBranch: entry.digest.gitBranch,
    origin: resolveOrigin(entry.provider, entry.digest.client),
    client: entry.digest.client,
    messageCount: entry.digest.userMessages + entry.digest.assistantMessages,
    startedAt: entry.digest.startedAt,
    lastActivityAt: DateTime.formatIso(DateTime.makeUnsafe(entry.mtimeMs)),
    sizeBytes: entry.size,
    threadId: owner,
  });

  const list = Effect.fn("ZenCliSessions.list")(
    function* (input: ZenCliSessionsListInput) {
      yield* refreshLock.withPermits(1)(refresh());
      const ownedBy = yield* refreshOwners();
      const origins = new Set<ZenCliSessionOrigin>(input.origins ?? ["terminal", "app", "other"]);
      const query = input.query === undefined ? null : compileQuery(input.query);
      const titleHits: Array<{ entry: IndexEntry; session: ZenCliSession }> = [];
      const contentHits: Array<{ entry: IndexEntry; session: ZenCliSession }> = [];
      for (const entry of entries.values()) {
        const sessionId = sessionIdOf(entry);
        if (sessionId === null || entry.digest.excluded) continue;
        // Metadata-only transcripts (a session opened and closed without a prompt) are noise.
        if (entry.digest.userMessages === 0) continue;
        const owner = ownedBy.get(`${entry.provider}:${sessionId}`) ?? null;
        if (owner !== null && input.includeOwned !== true) continue;
        const session = toSession(entry, sessionId, owner);
        if (!origins.has(session.origin)) continue;
        if (query === null) {
          titleHits.push({ entry, session });
          continue;
        }
        const match = matchSession(
          query,
          { title: session.title, cwd: session.cwd, sessionId },
          entry.digest,
        );
        if (match === null) continue;
        if (match.kind === "title") titleHits.push({ entry, session });
        else contentHits.push({ entry, session: { ...session, snippet: match.snippet } });
      }
      const byRecent = (left: { entry: IndexEntry }, right: { entry: IndexEntry }) =>
        right.entry.mtimeMs - left.entry.mtimeMs;
      const ranked = [...titleHits.sort(byRecent), ...contentHits.sort(byRecent)];
      return {
        sessions: ranked.slice(0, input.limit ?? DEFAULT_LIST_LIMIT).map(({ session }) => session),
        matchedCount: ranked.length,
        indexedCount: entries.size,
        indexedAt: DateTime.formatIso(DateTime.makeUnsafe(indexedAt)),
      } satisfies ZenCliSessionsListResult;
    },
    Effect.mapError((cause) =>
      isZenCliSessionsError(cause)
        ? cause
        : fail("list", "unavailable", "Could not read the terminal sessions on this machine."),
    ),
  );

  const resume = Effect.fn("ZenCliSessions.resume")(
    function* (input: ZenCliSessionsResumeInput) {
      yield* refreshLock.withPermits(1)(refresh());
      const entry = [...entries.values()]
        .filter(
          (candidate) =>
            candidate.provider === input.provider && sessionIdOf(candidate) === input.sessionId,
        )
        .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
      if (entry === undefined) {
        return yield* fail(
          "resume",
          "session-not-found",
          "This session is no longer on this machine.",
        );
      }
      const owner = (yield* refreshOwners()).get(`${entry.provider}:${input.sessionId}`);
      const cwd = entry.digest.cwd;
      if (
        cwd === null ||
        !(yield* fileSystem.exists(cwd).pipe(Effect.orElseSucceed(() => false)))
      ) {
        return yield* fail(
          "resume",
          "missing-directory",
          cwd === null
            ? "The session does not record its working directory."
            : `The session's folder ${cwd} no longer exists.`,
        );
      }
      // Import shows the whole conversation, tool calls included; "recent" keeps the old shape.
      const full = input.history !== "recent" ? new FullHistory(entry.provider) : null;
      const recent = new RecentMessages(entry.provider, {
        limit: RESUME_MESSAGE_LIMIT,
        maxChars: RESUME_MESSAGE_CHARS,
      });
      yield* streamLines(entry.filePath, 0, entry.size, (line, oversized) =>
        full !== null ? full.consume(line, oversized) : recent.consume(line, oversized),
      ).pipe(
        Effect.mapError(() =>
          fail("resume", "unavailable", "Could not read the session transcript."),
        ),
      );
      const history = full !== null ? full.result() : recentHistory(recent);
      const imported = yield* importer.importSession({
        provider: entry.provider,
        providerInstanceId: entry.providerInstanceId,
        sessionId: input.sessionId,
        ownerThreadId: owner ?? null,
        cwd,
        title: resolveTitle(entry.digest),
        model: entry.digest.model,
        startedAt: entry.digest.startedAt,
        lastActivityMs: entry.mtimeMs,
        entries: history.entries,
        omittedMessageCount: history.omitted,
        transcript: {
          filePath: entry.filePath,
          size: entry.size,
          mtimeMs: entry.mtimeMs,
          inode: entry.inode,
          device: entry.device,
          birthtimeMs: entry.birthtimeMs,
        },
      });
      // The next list must show the new owner instead of a cached snapshot.
      ownersAt = null;
      return imported;
    },
    Effect.mapError((cause) =>
      isZenCliSessionsError(cause)
        ? cause
        : fail("resume", "unavailable", "Could not resume this session."),
    ),
  );

  yield* Effect.addFinalizer(() => persist(true));

  return ZenCliSessions.of({ list, resume });
});

function recentHistory(recent: RecentMessages) {
  const { messages, omitted } = recent.messages();
  return {
    entries: messages.map((message) => ({ kind: "message" as const, ...message })),
    omitted,
  };
}

export const layer = Layer.effect(ZenCliSessions, make);

/**
 * RPC handlers for ws.ts, kept here so the upstream file only spreads them in. The service is
 * optional so upstream's ws tests, which build their own handler context, need no Zen mock.
 */
export const wsHandlers = (service: Option.Option<ZenCliSessions["Service"]>) => {
  const unavailable = (operation: ZenCliSessionsError["operation"]) =>
    Effect.fail(
      fail(operation, "unavailable", "Terminal sessions are not available on this server."),
    );
  return {
    [ZEN_CLI_SESSIONS_WS_METHODS.list]: (input: ZenCliSessionsListInput) =>
      Option.isSome(service) ? service.value.list(input) : unavailable("list"),
    [ZEN_CLI_SESSIONS_WS_METHODS.resume]: (input: ZenCliSessionsResumeInput) =>
      Option.isSome(service) ? service.value.resume(input) : unavailable("resume"),
  };
};
