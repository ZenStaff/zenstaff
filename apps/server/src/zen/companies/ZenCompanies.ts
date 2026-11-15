import {
  ZEN_COMPANIES_WS_METHODS,
  ZenCompaniesError,
  type ZenCompaniesListResult,
  type ZenCompany,
  type ZenCompanyAssignProjectInput,
  type ZenCompanyAssignThreadInput,
  type ZenCompanyCreateInput,
  type ZenCompanyDeleteInput,
  type ZenCompanyListMemoryInput,
  type ZenCompanyListMemoryResult,
  type ZenCompanyMemoryFile,
  type ZenCompanyReadMemoryInput,
  type ZenCompanyReadMemoryResult,
  type ZenCompanyUpdateInput,
  type ZenProjectCompany,
  type ZenThreadCompany,
} from "@t3tools/contracts/zenCompanies";
import * as HostProcess from "@t3tools/shared/HostProcess";
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

import * as ServerConfig from "../../config.ts";
import { setZenCompanyMemoryResolver } from "./companyMemory.ts";
import {
  STORE_FILE_VERSION,
  assignProject,
  assignThread,
  createCompany,
  deleteCompany,
  emptyState,
  isMarkdownFile,
  memoryDirectoryForProject,
  normalizeState,
  resolveCompanyMemoryDirectory,
  resolveMemoryFilePath,
  toCompany,
  toListResult,
  updateCompany,
  type CompaniesState,
  type StorePaths,
  type StoredCompany,
} from "./companiesStore.ts";

const MEMORY_FILE_LIMIT = 500;
const MEMORY_READ_BYTES = 1024 * 1024;

const StoredCompanySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.String,
  icon: Schema.String,
  memoryDirectory: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
const StoreFile = Schema.Struct({
  version: Schema.Literal(STORE_FILE_VERSION),
  companies: Schema.Array(StoredCompanySchema),
  projects: Schema.Record(Schema.String, Schema.String),
  /** Added in 0.2.7; files written before have none. */
  threads: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const decodeStoreFile = Schema.decodeUnknownOption(Schema.fromJsonString(StoreFile));
const encodeStoreFile = Schema.encodeEffect(Schema.fromJsonString(StoreFile));

const isZenCompaniesError = Schema.is(ZenCompaniesError);
const fail = (reason: ZenCompaniesError["reason"], detail: string) =>
  new ZenCompaniesError({ reason, detail });

const fromStoreError = (cause: unknown) =>
  isZenCompaniesError(cause)
    ? cause
    : fail("unavailable", "Could not save companies on this machine.");

export class ZenCompanies extends Context.Service<
  ZenCompanies,
  {
    readonly list: () => Effect.Effect<ZenCompaniesListResult, ZenCompaniesError>;
    readonly create: (input: ZenCompanyCreateInput) => Effect.Effect<ZenCompany, ZenCompaniesError>;
    readonly update: (input: ZenCompanyUpdateInput) => Effect.Effect<ZenCompany, ZenCompaniesError>;
    readonly remove: (
      input: ZenCompanyDeleteInput,
    ) => Effect.Effect<{ readonly reassignedProjectCount: number }, ZenCompaniesError>;
    readonly assignProject: (
      input: ZenCompanyAssignProjectInput,
    ) => Effect.Effect<ZenProjectCompany, ZenCompaniesError>;
    readonly assignThread: (
      input: ZenCompanyAssignThreadInput,
    ) => Effect.Effect<ZenThreadCompany, ZenCompaniesError>;
    readonly listMemory: (
      input: ZenCompanyListMemoryInput,
    ) => Effect.Effect<ZenCompanyListMemoryResult, ZenCompaniesError>;
    readonly readMemory: (
      input: ZenCompanyReadMemoryInput,
    ) => Effect.Effect<ZenCompanyReadMemoryResult, ZenCompaniesError>;
    /** Claude Code's memory directory for a project, or null to keep Claude Code's own. */
    readonly memoryDirectoryForProject: (projectId: string) => string | null;
  }
>()("t3/zen/companies/ZenCompanies") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const userHome = yield* HostProcess.HomeDirectory;

  const storeFile = path.join(serverConfig.stateDir, "zen", "companies.json");
  const paths: StorePaths = { zenHome: serverConfig.baseDir, userHome };
  const writeLock = yield* Semaphore.make(1);
  const nowIso = Effect.map(Clock.currentTimeMillis, (millis) =>
    DateTime.formatIso(DateTime.makeUnsafe(millis)),
  );

  const loadedText = yield* fileSystem.readFileString(storeFile).pipe(Effect.option);
  const decoded = Option.flatMap(loadedText, decodeStoreFile);
  const startedAt = yield* nowIso;
  let state: CompaniesState = Option.isSome(decoded)
    ? normalizeState(decoded.value, startedAt)
    : emptyState(startedAt);

  const persist = Effect.fn("ZenCompanies.persist")(function* (next: CompaniesState) {
    const directory = path.dirname(storeFile);
    const temporary = `${storeFile}.${process.pid}.tmp`;
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    const contents = yield* encodeStoreFile({
      version: STORE_FILE_VERSION,
      companies: next.companies,
      projects: next.projects,
      threads: next.threads,
    });
    yield* fileSystem.writeFileString(temporary, contents, { mode: 0o600 });
    yield* fileSystem.rename(temporary, storeFile);
    state = next;
  });

  const ensureMemoryDirectory = (company: StoredCompany) => {
    const directory = resolveCompanyMemoryDirectory(company, paths);
    return directory === null
      ? Effect.void
      : fileSystem.makeDirectory(directory, { recursive: true }).pipe(Effect.ignore);
  };

  /** Runs a pure store change under the write lock and saves it. */
  const mutate = <A>(change: (current: CompaniesState) => { state: CompaniesState; value: A }) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const result = yield* Effect.try({ try: () => change(state), catch: fromStoreError });
        yield* persist(result.state).pipe(Effect.mapError(fromStoreError));
        return result.value;
      }),
    );

  const requireCompany = (companyId: string) => {
    const company = state.companies.find((candidate) => candidate.id === companyId);
    return company === undefined
      ? Effect.fail(fail("not-found", "This company no longer exists."))
      : Effect.succeed(company);
  };

  const memoryDirectoryOf = Effect.fn("ZenCompanies.memoryDirectoryOf")(function* (
    companyId: string,
  ) {
    const company = yield* requireCompany(companyId);
    return resolveCompanyMemoryDirectory(company, paths);
  });

  const list = () => Effect.sync(() => toListResult(state, paths));

  const create = Effect.fn("ZenCompanies.create")(function* (input: ZenCompanyCreateInput) {
    const createdAt = yield* nowIso;
    const company = yield* mutate((current) => {
      const result = createCompany(current, input, paths, createdAt);
      return { state: result.state, value: result.company };
    });
    yield* ensureMemoryDirectory(company);
    return toCompany(company, paths);
  });

  const update = Effect.fn("ZenCompanies.update")(function* (input: ZenCompanyUpdateInput) {
    const company = yield* mutate((current) => {
      const result = updateCompany(current, input, paths);
      return { state: result.state, value: result.company };
    });
    yield* ensureMemoryDirectory(company);
    return toCompany(company, paths);
  });

  const remove = (input: ZenCompanyDeleteInput) =>
    mutate((current) => {
      const result = deleteCompany(current, input.id);
      return {
        state: result.state,
        value: { reassignedProjectCount: result.reassignedProjectCount },
      };
    });

  const assign = (input: ZenCompanyAssignProjectInput) =>
    mutate((current) => ({
      state: assignProject(current, input.projectId, input.companyId),
      value: { projectId: input.projectId, companyId: input.companyId } as ZenProjectCompany,
    }));

  const tagThread = (input: ZenCompanyAssignThreadInput) =>
    mutate((current) => ({
      state: assignThread(current, input.threadId, input.companyId),
      value: { threadId: input.threadId, companyId: input.companyId } as ZenThreadCompany,
    }));

  const listMemory = Effect.fn("ZenCompanies.listMemory")(
    function* (input: ZenCompanyListMemoryInput) {
      const directory = yield* memoryDirectoryOf(input.companyId);
      if (directory === null) return { directory: null, exists: false, files: [] };
      const exists = yield* fileSystem.exists(directory).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return { directory, exists: false, files: [] };
      const names = yield* fileSystem.readDirectory(directory, { recursive: true });
      const markdown = names
        .filter((name) => isMarkdownFile(name))
        .slice(0, MEMORY_FILE_LIMIT)
        .toSorted();
      const files = yield* Effect.forEach(
        markdown,
        (name) =>
          fileSystem.stat(path.join(directory, name)).pipe(
            Effect.map((info): ZenCompanyMemoryFile | null =>
              info.type !== "File"
                ? null
                : ({
                    relativePath: name.split(path.sep).join("/"),
                    sizeBytes: Number(info.size),
                    modifiedAt: DateTime.formatIso(
                      DateTime.makeUnsafe(
                        Option.match(info.mtime, {
                          onNone: () => 0,
                          onSome: (mtime) => mtime.getTime(),
                        }),
                      ),
                    ),
                  } as ZenCompanyMemoryFile),
            ),
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: 16 },
      );
      // MEMORY.md is Claude Code's index; it comes first, the rest by name.
      const present = files
        .filter((file): file is ZenCompanyMemoryFile => file !== null)
        .toSorted((left, right) =>
          left.relativePath === "MEMORY.md"
            ? -1
            : right.relativePath === "MEMORY.md"
              ? 1
              : left.relativePath.localeCompare(right.relativePath),
        );
      return { directory, exists: true, files: present };
    },
    Effect.mapError((cause) =>
      isZenCompaniesError(cause)
        ? cause
        : fail("unavailable", "Could not list this company's memory files."),
    ),
  );

  const readMemory = Effect.fn("ZenCompanies.readMemory")(
    function* (input: ZenCompanyReadMemoryInput) {
      const directory = yield* memoryDirectoryOf(input.companyId);
      const target =
        directory === null ? null : resolveMemoryFilePath(directory, input.relativePath);
      if (directory === null || target === null) {
        return yield* fail("file-not-found", "This memory file is not available.");
      }
      // A symlink inside the directory must not read files outside it.
      const realDirectory = yield* fileSystem.realPath(directory);
      const realTarget = yield* fileSystem
        .realPath(target)
        .pipe(Effect.mapError(() => fail("file-not-found", "This memory file no longer exists.")));
      const relative = path.relative(realDirectory, realTarget);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return yield* fail("file-not-found", "This memory file is not available.");
      }
      const bytes = yield* fileSystem.readFile(realTarget);
      const truncated = bytes.byteLength > MEMORY_READ_BYTES;
      const content = new TextDecoder().decode(
        truncated ? bytes.subarray(0, MEMORY_READ_BYTES) : bytes,
      );
      return { relativePath: input.relativePath, content, truncated };
    },
    Effect.mapError((cause) =>
      isZenCompaniesError(cause) ? cause : fail("unavailable", "Could not read this memory file."),
    ),
  );

  const resolveForProject = (projectId: string) =>
    memoryDirectoryForProject(state, projectId, paths);

  setZenCompanyMemoryResolver(resolveForProject);
  yield* Effect.addFinalizer(() => Effect.sync(() => setZenCompanyMemoryResolver(null)));

  return ZenCompanies.of({
    list,
    create,
    update,
    remove,
    assignProject: assign,
    assignThread: tagThread,
    listMemory,
    readMemory,
    memoryDirectoryForProject: resolveForProject,
  });
});

export const layer = Layer.effect(ZenCompanies, make);

/**
 * RPC handlers for ws.ts, kept here so the upstream file only spreads them in. The service is
 * optional so upstream's ws tests, which build their own handler context, need no Zen mock.
 */
export const wsHandlers = (service: Option.Option<ZenCompanies["Service"]>) => {
  const run = <A>(
    use: (companies: ZenCompanies["Service"]) => Effect.Effect<A, ZenCompaniesError>,
  ) =>
    Option.isSome(service)
      ? use(service.value)
      : Effect.fail(fail("unavailable", "Companies are not available on this server."));
  return {
    [ZEN_COMPANIES_WS_METHODS.list]: () => run((companies) => companies.list()),
    [ZEN_COMPANIES_WS_METHODS.create]: (input: ZenCompanyCreateInput) =>
      run((companies) => companies.create(input)),
    [ZEN_COMPANIES_WS_METHODS.update]: (input: ZenCompanyUpdateInput) =>
      run((companies) => companies.update(input)),
    [ZEN_COMPANIES_WS_METHODS.delete]: (input: ZenCompanyDeleteInput) =>
      run((companies) => companies.remove(input)),
    [ZEN_COMPANIES_WS_METHODS.assignProject]: (input: ZenCompanyAssignProjectInput) =>
      run((companies) => companies.assignProject(input)),
    [ZEN_COMPANIES_WS_METHODS.assignThread]: (input: ZenCompanyAssignThreadInput) =>
      run((companies) => companies.assignThread(input)),
    [ZEN_COMPANIES_WS_METHODS.listMemory]: (input: ZenCompanyListMemoryInput) =>
      run((companies) => companies.listMemory(input)),
    [ZEN_COMPANIES_WS_METHODS.readMemory]: (input: ZenCompanyReadMemoryInput) =>
      run((companies) => companies.readMemory(input)),
  };
};
