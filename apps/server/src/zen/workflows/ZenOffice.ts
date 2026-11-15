// Zen Staff: the Office edition on the server. Keeps the edition switch in a zen_* SQLite table
// (created here, not by upstream migrations), lists workflows from the built-in, company and user
// folders, saves custom ones, and installs marketplace packs into the user folder, from the
// bundled registry or a remote one (remoteRegistry.ts). ZEN.md, "Office edition".
import {
  ZEN_DEFAULT_EDITION,
  ZEN_OFFICE_WS_METHODS,
  ZenEdition,
  ZenOfficeError,
  ZenRegistryIndex,
  ZEN_INPUT_FILE_MAX_BYTES,
  validateWorkflow,
  type ZenCustomDraftReview,
  type ZenCustomPackView,
  type ZenCustomPacksInput,
  type ZenCustomTargetInput,
  type ZenCustomThreadStart,
  type ZenCustomizePackInput,
  type ZenResolveCustomUpdateInput,
  type ZenResolveCustomUpdateResult,
  type ZenShareCustomPackInput,
  type ZenIntakeCallInput,
  type ZenLibraryCallInput,
  type ZenDeleteWorkflowInput,
  type ZenDraftWorkflowInput,
  type ZenListWorkflowsInput,
  type ZenMarketplace,
  type ZenMarketplaceSourceKind,
  type ZenOfficeSettings,
  type ZenRegistryEntry,
  type ZenSaveWorkflowInput,
  type ZenSetRegistryUrlInput,
  type ZenSampleMedia,
  type ZenSampleMediaInput,
  type ZenUploadInputFileInput,
  type ZenUploadedInputFile,
  type ZenWorkflow,
  type ZenWorkflowDraft,
  type ZenWorkflowIdInput,
  type ZenInstallPackInput,
  type ZenWorkflowCustomization,
  type ZenWorkflowList,
} from "@t3tools/contracts/zenOffice";
import { ZEN_PACKS_REGISTRY_URL, ZEN_REGISTRY_PUBLIC_KEY } from "@t3tools/contracts/zenReleases";
import { ProviderInstanceId, ThreadId, type ModelSelection } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import {
  ZEN_WORKFLOW_DRAFT_MODEL,
  basicDraft,
  buildDraftPrompt,
  draftMessageText,
  parseDraftReply,
  type DraftMessage,
} from "./workflowDraft.ts";
import {
  archiveFormat,
  fetchLimited,
  mergeRegistryEntries,
  verifyRegistrySignature,
  normalizeRegistryUrl,
  packFilesAtRoot,
  readTarGz,
  readZip,
  REMOTE_REGISTRY_LIMITS,
  resolveDownloadUrl,
  verifySha256,
  type MergedRegistryEntry,
} from "./remoteRegistry.ts";
import {
  ENTERPRISE_INSTALL_REFUSAL,
  zenPackInstallRefusal,
  zenPackIsEnterprise,
} from "../toolchains/access.ts";
import { setZenPackHubPort, zenCompanyHubBridge } from "../hub/companyPorts.ts";
import { makeCustomPacks } from "./customPackStore.ts";
import { listZenConnections, registerZenGatewayTools } from "../connectors/extraTools.ts";
import { IntakeEngine, IntakeError } from "../intake/intakeEngine.ts";
import type { FolderFiles } from "./customPacks.ts";
import { resolveWorkflowAssetsDir } from "./workflowAssets.ts";
import { CommunityLibrary, LibraryError, mergeCommunityEntries } from "./communityLibrary.ts";
import { zenHubBridge } from "../hub/hubBridge.ts";
import {
  installPackFolder,
  loadWorkflowDir,
  marketplaceView,
  mergeWorkflows,
  packWorkflowIds,
  parseRegistry,
  sampleEntryFor,
  sampleMimeType,
  workflowBelongsToPack,
  writeWorkflowFolder,
} from "./workflowStore.ts";

/** Shipped next to this file: built-in workflows, the marketplace index and its packs. */
const BUILTIN_WORKFLOWS_DIR = "builtin";
const REGISTRY_FILE = "registry.json";

export interface ZenOfficeOptions {
  /**
   * Folder holding builtin/, packs/ and registry.json. Defaults to this module's folder from
   * source, or the embedded copy in packaged builds (workflowAssets.ts).
   */
  readonly assetsDir?: string;
  /** The bundled marketplace index. Defaults to registry.json in `assetsDir`. */
  readonly registryPath?: string;
  /** The remote registry used when none is saved in settings. Defaults to `ZEN_REGISTRY_URL`. */
  readonly defaultRegistryUrl?: string | null;
  /** How long a fetched remote index is reused before fetching again (default 60 s). */
  readonly remoteRegistryTtlMs?: number;
  /** The registry signing key (SPKI DER, base64); tests sign with their own. */
  readonly registryPublicKey?: string;
  /**
   * The hub whose community library is merged into the store. Defaults to the hub bridge (the
   * signed-in hub, else the hosted one); `ZEN_LIBRARY=0` turns the library off. Tests set it.
   */
  readonly libraryHubUrl?: string | null;
  /**
   * The workflows folder of a company, or null. Defaults to `<zen home>/companies/<id>/workflows`,
   * next to the company's default memory folder (ZEN.md, Companies).
   */
  readonly companyWorkflowsDir?: (companyId: string) => Effect.Effect<string | null>;
}

export class ZenOffice extends Context.Service<
  ZenOffice,
  {
    readonly settings: Effect.Effect<ZenOfficeSettings, ZenOfficeError>;
    readonly setEdition: (input: {
      readonly edition: ZenEdition;
    }) => Effect.Effect<ZenOfficeSettings, ZenOfficeError>;
    readonly listWorkflows: (
      input: ZenListWorkflowsInput,
    ) => Effect.Effect<ZenWorkflowList, ZenOfficeError>;
    readonly saveWorkflow: (
      input: ZenSaveWorkflowInput,
    ) => Effect.Effect<ZenWorkflow, ZenOfficeError>;
    readonly deleteWorkflow: (input: ZenDeleteWorkflowInput) => Effect.Effect<{}, ZenOfficeError>;
    readonly registry: Effect.Effect<ZenMarketplace, ZenOfficeError>;
    readonly installPack: (
      input: ZenInstallPackInput,
    ) => Effect.Effect<ZenMarketplace, ZenOfficeError>;
    readonly uninstallPack: (
      input: ZenWorkflowIdInput,
    ) => Effect.Effect<ZenMarketplace, ZenOfficeError>;
    readonly setRegistryUrl: (
      input: ZenSetRegistryUrlInput,
    ) => Effect.Effect<ZenOfficeSettings, ZenOfficeError>;
    /** "Save this as a workflow": a draft for the editor from a thread's conversation. */
    readonly draftWorkflow: (
      input: ZenDraftWorkflowInput,
    ) => Effect.Effect<ZenWorkflowDraft, ZenOfficeError>;
    /** A pack's showcase sample, ready to play, or null when it has none (or the file is missing). */
    readonly sampleMedia: (
      input: ZenSampleMediaInput,
    ) => Effect.Effect<ZenSampleMedia, ZenOfficeError>;
    /** Copies a file chosen for a `file` input into `<work folder>/inputs/`. */
    readonly uploadInputFile: (
      input: ZenUploadInputFileInput,
    ) => Effect.Effect<ZenUploadedInputFile, ZenOfficeError>;
    /** Customized packs (customPackStore.ts): the person's own copies, then the company's. */
    readonly customPacks: (
      input: ZenCustomPacksInput,
    ) => Effect.Effect<ReadonlyArray<ZenCustomPackView>, ZenOfficeError>;
    /** "Personalizează": a draft copy and the first message of the thread that changes it. */
    readonly customizePack: (
      input: ZenCustomizePackInput,
    ) => Effect.Effect<ZenCustomThreadStart, ZenOfficeError>;
    readonly customDraft: (
      input: ZenCustomTargetInput,
    ) => Effect.Effect<ZenCustomDraftReview, ZenOfficeError>;
    readonly saveCustomDraft: (
      input: ZenCustomTargetInput,
    ) => Effect.Effect<ZenCustomPackView, ZenOfficeError>;
    readonly discardCustomDraft: (input: ZenCustomTargetInput) => Effect.Effect<{}, ZenOfficeError>;
    readonly revertCustomPack: (input: ZenCustomTargetInput) => Effect.Effect<{}, ZenOfficeError>;
    readonly resolveCustomUpdate: (
      input: ZenResolveCustomUpdateInput,
    ) => Effect.Effect<ZenResolveCustomUpdateResult, ZenOfficeError>;
    /**
     * Company-wide custom pack: moves the person's copy to the company folder. The hub's
     * company-wide installs read `<company>/workflows/<id>/.zen-custom.json` (scope "company").
     */
    readonly shareCustomPack: (
      input: ZenShareCustomPackInput,
    ) => Effect.Effect<ZenCustomPackView, ZenOfficeError>;
    /** Chat-first task start and hiring setup (zen/intake/intakeEngine.ts). */
    readonly intake: (input: ZenIntakeCallInput) => Effect.Effect<unknown, ZenOfficeError>;
    readonly library: (input: ZenLibraryCallInput) => Effect.Effect<unknown, ZenOfficeError>;
  }
>()("t3/zen/workflows/ZenOffice") {}

const fail = (reason: ZenOfficeError["reason"], detail: string) =>
  new ZenOfficeError({ reason, detail });
const isZenOfficeError = Schema.is(ZenOfficeError);
const decodeEdition = Schema.decodeUnknownOption(Schema.fromJsonString(ZenEdition));
const RegistryUrlSetting = Schema.NullOr(Schema.String);
const decodeRegistryUrl = Schema.decodeUnknownOption(Schema.fromJsonString(RegistryUrlSetting));
const encodeRegistryUrl = Schema.encodeSync(Schema.fromJsonString(RegistryUrlSetting));
/** The last remote index that loaded, kept so the marketplace still opens when offline. */
const CachedRegistry = Schema.Struct({
  sourceUrl: Schema.String,
  fetchedAt: Schema.String,
  index: ZenRegistryIndex,
});
const encodeCachedRegistry = Schema.encodeSync(Schema.fromJsonString(CachedRegistry));
const decodeCachedRegistry = Schema.decodeUnknownOption(Schema.fromJsonString(CachedRegistry));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

interface LoadedRegistry {
  readonly source: string;
  readonly sourceKind: ZenMarketplaceSourceKind;
  readonly notice: string | null;
  readonly entries: ReadonlyArray<MergedRegistryEntry>;
  /** The URL relative download addresses resolve against, when entries came from a remote. */
  readonly remoteBase: string | null;
}

/** Any non-Office failure (disk, SQLite) becomes a plain "io" error with its message. */
const asOfficeError =
  (action: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ZenOfficeError, R> =>
    effect.pipe(
      Effect.mapError((error) =>
        isZenOfficeError(error)
          ? error
          : fail(
              "io",
              `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
            ),
      ),
    );

const COMPANY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Files chosen for `file` inputs land here, inside the work folder. */
const UPLOAD_FOLDER = "inputs";
/** A bundled sample travels as a data URL, so it stays small. */
const SAMPLE_MAX_BYTES = 15 * 1024 * 1024;

/** A file name that is safe to write: no folders, no control characters, not hidden. */
export function safeUploadName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : null;
}

function splitExtension(name: string): { readonly stem: string; readonly extension: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : { stem: name, extension: "" };
}
const encodeEdition = Schema.encodeSync(Schema.fromJsonString(ZenEdition));

/** A pack marker (`.zen-pack.json`) this app wrote, or null. */
function packMarkerOf(text: string): { packId: string; version: string | null } | null {
  try {
    const marker = JSON.parse(text) as { packId?: unknown; version?: unknown };
    return typeof marker.packId === "string"
      ? {
          packId: marker.packId,
          version: typeof marker.version === "string" ? marker.version : null,
        }
      : null;
  } catch {
    return null;
  }
}

export const make = Effect.fn("ZenOffice.make")(function* (options: ZenOfficeOptions = {}) {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const writeLock = yield* Semaphore.make(1);
  // Optional: present in the app (runtimeLayer provides them), absent in unit tests.
  const orchestrator = yield* Effect.serviceOption(Orchestrator.OrchestratorV2);
  const textGeneration = yield* Effect.serviceOption(TextGeneration.TextGeneration);

  const local0 = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
  const assetsDir =
    options.assetsDir ??
    (yield* local0(resolveWorkflowAssetsDir(config.baseDir)).pipe(
      // A refused rename at first start must not leave the library empty until a restart.
      Effect.retry({ times: 3, schedule: Schedule.spaced("250 millis") }),
      Effect.tapError((error) =>
        Effect.logWarning("Zen Office: the shipped workflows could not be prepared", error),
      ),
      Effect.orElseSucceed(() => path.join(config.baseDir, "caches", "zen-workflows", "missing")),
    ));
  const builtinDir = path.join(assetsDir, BUILTIN_WORKFLOWS_DIR);
  const registryPath = options.registryPath ?? path.join(assetsDir, REGISTRY_FILE);
  const userDir = path.join(config.baseDir, "workflows");
  const hiddenPack = (packId: string | null | undefined) =>
    packId !== null &&
    packId !== undefined &&
    zenCompanyHubBridge()?.hiddenPackIds().has(packId) === true;

  /** The folder helpers need FileSystem and Path; the service provides its own. */
  const local = local0;
  const registryCacheFile = path.join(config.baseDir, "caches", "zen-registry", "registry.json");
  const stagingRoot = path.join(config.baseDir, "caches", "zen-pack-staging");
  // Setting > env ZEN_REGISTRY_URL > our signed registry (ZEN_PACKS_REGISTRY_URL). Unit tests never
  // reach the network: under Vitest the default is "bundled only" unless a test names a URL.
  const envRegistryUrl =
    options.defaultRegistryUrl !== undefined
      ? options.defaultRegistryUrl
      : (Option.getOrNull(yield* Config.String("ZEN_REGISTRY_URL").pipe(Config.option)) ??
        (Option.isNone(yield* Config.String("VITEST").pipe(Config.option))
          ? ZEN_PACKS_REGISTRY_URL
          : null));
  const registryPublicKey =
    options.registryPublicKey ??
    Option.getOrNull(yield* Config.String("ZEN_REGISTRY_PUBLIC_KEY").pipe(Config.option)) ??
    ZEN_REGISTRY_PUBLIC_KEY;
  const defaultRegistryUrl = (() => {
    const normalized = normalizeRegistryUrl(envRegistryUrl);
    return "ok" in normalized ? normalized.ok : null;
  })();
  const remoteTtlMs = options.remoteRegistryTtlMs ?? 60_000;
  let remoteMemo: {
    readonly url: string;
    readonly at: number;
    readonly entries: ReadonlyArray<ZenRegistryEntry>;
  } | null = null;

  yield* sql`
    CREATE TABLE IF NOT EXISTS zen_office_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  const readEdition = sql<{ value_json: string }>`
    SELECT value_json FROM zen_office_settings WHERE key = 'edition'
  `.pipe(
    NodeSqliteClient.readOnly,
    Effect.map((rows) =>
      rows[0] === undefined
        ? ZEN_DEFAULT_EDITION
        : Option.getOrElse(decodeEdition(rows[0].value_json), () => ZEN_DEFAULT_EDITION),
    ),
  );

  /** The saved registry URL: a row with null means "bundled only"; no row means the default. */
  const readRegistryUrl = sql<{ value_json: string }>`
    SELECT value_json FROM zen_office_settings WHERE key = 'registry_url'
  `.pipe(
    NodeSqliteClient.readOnly,
    Effect.map((rows) => {
      if (rows[0] === undefined) return defaultRegistryUrl;
      return Option.getOrElse(decodeRegistryUrl(rows[0].value_json), () => defaultRegistryUrl);
    }),
  );

  const settings = Effect.all([readEdition, readRegistryUrl]).pipe(
    Effect.map(([edition, registryUrl]): ZenOfficeSettings => ({
      edition,
      userWorkflowsDir: userDir,
      registryUrl,
    })),
    asOfficeError("read Office settings"),
  );

  const setRegistryUrl = Effect.fn("ZenOffice.setRegistryUrl")(function* (
    input: ZenSetRegistryUrlInput,
  ) {
    const normalized = normalizeRegistryUrl(input.url);
    if ("error" in normalized) return yield* fail("invalid", normalized.error);
    const at = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
        INSERT INTO zen_office_settings (key, value_json, updated_at)
        VALUES ('registry_url', ${encodeRegistryUrl(normalized.ok)}, ${at})
        ON CONFLICT (key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `;
    remoteMemo = null;
    return yield* settings;
  }, asOfficeError("save the registry address"));

  const setEdition = Effect.fn("ZenOffice.setEdition")(function* (input: {
    readonly edition: ZenEdition;
  }) {
    const at = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
        INSERT INTO zen_office_settings (key, value_json, updated_at)
        VALUES ('edition', ${encodeEdition(input.edition)}, ${at})
        ON CONFLICT (key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `;
    return yield* settings;
  }, asOfficeError("save the edition"));

  /** A company's workflows folder, or null when the company id is not valid. */
  const companyDirOf = (companyId: string | null | undefined): Effect.Effect<string | null> =>
    !companyId
      ? Effect.succeed(null)
      : options.companyWorkflowsDir
        ? options.companyWorkflowsDir(companyId)
        : Effect.succeed(
            COMPANY_ID.test(companyId)
              ? path.join(config.baseDir, "companies", companyId, "workflows")
              : null,
          );

  const loadAll = Effect.fn("ZenOffice.loadAll")(function* (companyId: string | null | undefined) {
    const builtin = yield* local(loadWorkflowDir(builtinDir, "builtin"));
    const companyDir = yield* companyDirOf(companyId);
    const company = companyDir
      ? yield* local(loadWorkflowDir(companyDir, "company"))
      : { workflows: [], problems: [] };
    const user = yield* local(loadWorkflowDir(userDir, "user"));
    return { builtin, company, user };
  });

  const listWorkflows = (input: ZenListWorkflowsInput) =>
    loadAll(input.companyId).pipe(
      Effect.map(({ builtin, company, user }): ZenWorkflowList => ({
        workflows: mergeWorkflows([
          builtin.workflows,
          company.workflows,
          // Hub v6: company packs this person hid are installed but not listed.
          user.workflows.filter((workflow) => !hiddenPack(workflow.packId)),
        ]),
        problems: [...builtin.problems, ...company.problems, ...user.problems],
      })),
      asOfficeError("load workflows"),
    );

  const userWorkflow = (id: string) =>
    local(loadWorkflowDir(userDir, "user")).pipe(
      Effect.map(({ workflows }) => workflows.find((workflow) => workflow.manifest.id === id)),
    );

  /** Where a save or delete goes: the person's folder, or the company's when one is given. */
  const targetOf = Effect.fn("ZenOffice.targetOf")(function* (
    companyId: string | null | undefined,
  ) {
    if (!companyId) return { dir: userDir, source: "user" as const };
    const dir = yield* companyDirOf(companyId);
    if (dir === null)
      return yield* fail("invalid", "This company's workflows folder is not known.");
    return { dir, source: "company" as const };
  });
  const workflowIn =
    (target: { readonly dir: string; readonly source: "user" | "company" }) => (id: string) =>
      local(loadWorkflowDir(target.dir, target.source)).pipe(
        Effect.map(({ workflows }) => workflows.find((workflow) => workflow.manifest.id === id)),
      );

  const saveUnlocked = Effect.fn("ZenOffice.saveWorkflow")(function* (input: ZenSaveWorkflowInput) {
    const problems = validateWorkflow(input.manifest, input.prompt);
    if (problems.length > 0) return yield* fail("invalid", problems.join(" "));
    const target = yield* targetOf(input.companyId);
    const find = workflowIn(target);
    const id = input.manifest.id;
    const existing = yield* find(id);
    const renamedFrom = input.previousId && input.previousId !== id ? input.previousId : null;
    if (existing && (renamedFrom !== null || input.previousId == null)) {
      return yield* fail("conflict", `A workflow with the id "${id}" already exists.`);
    }
    if (existing?.packId) {
      return yield* fail("conflict", "Installed library workflows cannot be edited.");
    }
    if (renamedFrom !== null) {
      const previous = yield* find(renamedFrom);
      if (previous?.editable) {
        // Keep SKILL.md and assets: move the folder, then rewrite its files.
        yield* fs.rename(path.join(target.dir, renamedFrom), path.join(target.dir, id));
      }
    }
    yield* local(writeWorkflowFolder(target.dir, input.manifest, input.prompt));
    const saved = yield* find(id);
    if (!saved) return yield* fail("io", "The workflow was saved but did not load again.");
    return saved;
  });
  const saveWorkflow = (input: ZenSaveWorkflowInput) =>
    writeLock.withPermits(1)(saveUnlocked(input)).pipe(asOfficeError("save the workflow"));

  const deleteUnlocked = Effect.fn("ZenOffice.deleteWorkflow")(function* (
    input: ZenDeleteWorkflowInput,
  ) {
    const target = yield* targetOf(input.companyId);
    const existing = yield* workflowIn(target)(input.id);
    if (!existing?.editable) {
      return yield* fail("not-found", "Only your own workflows can be deleted.");
    }
    yield* fs.remove(path.join(target.dir, existing.manifest.id), { recursive: true });
    return {};
  });
  const deleteWorkflow = (input: ZenDeleteWorkflowInput) =>
    writeLock.withPermits(1)(deleteUnlocked(input)).pipe(asOfficeError("delete the workflow"));

  const readRegistry = fs.readFileString(registryPath).pipe(
    Effect.mapError(() => fail("unavailable", "The library index could not be read.")),
    Effect.flatMap((text) => {
      const parsed = parseRegistry(text);
      return "error" in parsed
        ? Effect.fail(fail("unavailable", parsed.error))
        : Effect.succeed(parsed.entries);
    }),
  );

  const fetchRemoteIndex = Effect.fn("ZenOffice.fetchRemoteRegistry")(function* (url: string) {
    const now = yield* Clock.currentTimeMillis;
    if (remoteMemo && remoteMemo.url === url && now - remoteMemo.at < remoteTtlMs) {
      return remoteMemo.entries;
    }
    const bytes = yield* Effect.tryPromise({
      try: () =>
        fetchLimited(url, {
          timeoutMs: REMOTE_REGISTRY_LIMITS.indexTimeoutMs,
          maxBytes: REMOTE_REGISTRY_LIMITS.indexBytes,
        }),
      catch: (error) => fail("unavailable", messageOf(error)),
    });
    // The index counts only with its detached signature (`<index>.sig`) from our key.
    const signature = yield* Effect.tryPromise({
      try: () =>
        fetchLimited(`${url}.sig`, {
          timeoutMs: REMOTE_REGISTRY_LIMITS.indexTimeoutMs,
          maxBytes: 4_096,
        }),
      catch: () => null,
    }).pipe(
      Effect.map((sig) => new TextDecoder().decode(sig)),
      Effect.orElseSucceed(() => null),
    );
    if (!verifyRegistrySignature(bytes, signature, registryPublicKey)) {
      return yield* fail("unavailable", "its signature is missing or not valid");
    }
    const parsed = parseRegistry(new TextDecoder().decode(bytes));
    if ("error" in parsed) return yield* fail("unavailable", "its index is not valid");
    remoteMemo = { url, at: now, entries: parsed.entries };
    const cached = {
      sourceUrl: url,
      fetchedAt: DateTime.formatIso(yield* DateTime.now),
      index: { version: 1, entries: parsed.entries },
    };
    yield* fs
      .makeDirectory(path.dirname(registryCacheFile), { recursive: true })
      .pipe(
        Effect.andThen(fs.writeFileString(registryCacheFile, encodeCachedRegistry(cached))),
        Effect.ignore,
      );
    return parsed.entries;
  });

  const readRegistryCache = (url: string) =>
    fs.readFileString(registryCacheFile).pipe(
      Effect.map((text) => Option.getOrNull(decodeCachedRegistry(text))),
      Effect.orElseSucceed(() => null),
      Effect.map((cached) => (cached && cached.sourceUrl === url ? cached : null)),
    );

  /** The bundled index, merged with the remote one when a registry URL is set. */
  const loadRegistry = Effect.gen(function* () {
    // Never a blank Library: without the bundled index, show the remote packs (or nothing) with a
    // notice instead of failing the whole page.
    const local = yield* readRegistry.pipe(Effect.result);
    if (local._tag === "Failure") {
      yield* Effect.logWarning("Zen Office: the bundled library index could not be read", {
        path: registryPath,
        detail: local.failure.detail,
      });
    }
    const localEntries = local._tag === "Success" ? local.success : [];
    const localNotice =
      local._tag === "Success"
        ? null
        : "The workflows that come with the app could not be read. Restart Zen Staff to see them again.";
    // One notice at a time (the web app translates whole server sentences).
    const withLocalNotice = (notice: string | null) => localNotice ?? notice;
    const url = yield* readRegistryUrl;
    const bundled = (notice: string | null): LoadedRegistry => ({
      source: registryPath,
      sourceKind: "local",
      notice: withLocalNotice(notice),
      entries: localEntries.map((entry) => ({ entry, origin: "local" as const })),
      remoteBase: null,
    });
    if (url === null) return bundled(null);
    const fetched = yield* fetchRemoteIndex(url).pipe(Effect.result);
    if (fetched._tag === "Success") {
      return {
        source: url,
        sourceKind: "remote",
        notice: localNotice,
        entries: mergeRegistryEntries(localEntries, fetched.success),
        remoteBase: url,
      } satisfies LoadedRegistry;
    }
    const reason = fetched.failure.detail;
    const cached = yield* readRegistryCache(url);
    if (cached) {
      const day = cached.fetchedAt.slice(0, 10);
      return {
        source: url,
        sourceKind: "cache",
        notice: withLocalNotice(
          `The library at ${hostOf(url)} could not be reached (${reason}). Showing the copy saved on ${day}.`,
        ),
        entries: mergeRegistryEntries(localEntries, cached.index.entries),
        remoteBase: url,
      } satisfies LoadedRegistry;
    }
    return bundled(
      `The library at ${hostOf(url)} could not be reached (${reason}). Only the workflows that come with the app are shown.`,
    );
  });

  // The community library (communityLibrary.ts): free packs from the hub, after ours.
  const libraryOff =
    Option.getOrNull(yield* Config.String("ZEN_LIBRARY").pipe(Config.option)) === "0";
  const library = new CommunityLibrary({
    hubUrl: () =>
      libraryOff
        ? null
        : options.libraryHubUrl !== undefined
          ? options.libraryHubUrl
          : (zenHubBridge()?.library?.hubUrl() ?? null),
    token: () => zenHubBridge()?.library?.token() ?? null,
    userId: () => zenHubBridge()?.library?.userId() ?? null,
    sign: async (message) => {
      const bridge = zenHubBridge()?.library;
      if (bridge === undefined) throw new LibraryError("not-signed-in", "Sign in to a hub first.");
      return bridge.sign(message);
    },
    cacheFile: path.join(config.baseDir, "caches", "zen-library", "catalog.json"),
    sources: (companyId) =>
      runPromise(
        Effect.gen(function* () {
          const { user, company } = yield* loadAll(companyId);
          const companyDir = yield* companyDirOf(companyId);
          return [
            ...user.workflows.map((workflow) => ({
              workflow,
              dir: path.join(userDir, workflow.manifest.id),
            })),
            ...(companyDir === null
              ? []
              : company.workflows.map((workflow) => ({
                  workflow,
                  dir: path.join(companyDir, workflow.manifest.id),
                }))),
          ];
        }),
      ),
    reservedIds: () =>
      runPromise(
        Effect.gen(function* () {
          const entries = yield* readRegistry.pipe(Effect.orElseSucceed(() => []));
          const { builtin } = yield* loadAll(null);
          return new Set([
            ...entries.flatMap((entry) => [entry.id, ...(entry.workflows ?? [])]),
            ...builtin.workflows.map((workflow) => workflow.manifest.id),
          ]);
        }),
      ),
  });

  /** The registry (bundled + remote) with the community library after it. */
  const loadCatalog = Effect.gen(function* () {
    const loaded = yield* loadRegistry;
    const community = yield* Effect.promise(() => library.load());
    return {
      loaded: {
        ...loaded,
        entries: mergeCommunityEntries(loaded.entries, community.catalog.entries, (entry) => ({
          entry,
          origin: "community" as const,
        })),
      },
      community,
    };
  });

  const registry = Effect.all([loadCatalog, loadAll(null)]).pipe(
    Effect.map(([{ loaded, community }, { builtin, user }]) => {
      const view = marketplaceView(
        loaded.source,
        loaded.entries.map((item) => item.entry),
        builtin.workflows,
        user.workflows,
        { sourceKind: loaded.sourceKind, notice: loaded.notice },
      );
      // Packs the library took down: installed copies stay, with the reason as a warning.
      const withdrawn = new Map(community.catalog.withdrawn.map((item) => [item.id, item.reason]));
      const entries = view.entries.map((item) =>
        withdrawn.has(item.entry.id)
          ? { ...item, withdrawn: withdrawn.get(item.entry.id) ?? "" }
          : item,
      );
      for (const [id, reason] of withdrawn) {
        const entry = community.known[id];
        if (entry === undefined || entries.some((item) => item.entry.id === id)) continue;
        const installed = user.workflows.find((workflow) => workflowBelongsToPack(workflow, entry));
        if (installed === undefined) continue;
        entries.push({
          entry,
          installed: true,
          installedVersion: installed.manifest.version,
          withdrawn: reason ?? "",
        });
      }
      return {
        ...view,
        entries,
        community: {
          source: community.catalogUrl,
          available: community.available,
          notice: community.notice,
        },
      };
    }),
    asOfficeError("load the library"),
  );

  /** Downloads, checks and unpacks a remote pack into a staging folder named after its id. */
  const stageRemotePack = Effect.fn("ZenOffice.stageRemotePack")(function* (
    entry: ZenRegistryEntry,
    remoteBase: string,
    staging: string,
  ) {
    const download = entry.download!;
    const resolved = resolveDownloadUrl(remoteBase, download.url);
    if ("error" in resolved) return yield* fail("invalid", resolved.error);
    const bytes = yield* Effect.tryPromise({
      try: () =>
        fetchLimited(resolved.ok, {
          timeoutMs: REMOTE_REGISTRY_LIMITS.archiveTimeoutMs,
          maxBytes: REMOTE_REGISTRY_LIMITS.archiveBytes,
        }),
      catch: (error) =>
        fail("unavailable", `The pack could not be downloaded: ${messageOf(error)}`),
    });
    if (!verifySha256(bytes, download.sha256)) {
      return yield* fail(
        "invalid",
        "The downloaded pack does not match its checksum, so nothing was installed.",
      );
    }
    const read =
      archiveFormat(download) === "zip"
        ? yield* Effect.promise(() => readZip(bytes))
        : readTarGz(bytes);
    if ("error" in read) return yield* fail("invalid", read.error);
    const multi = entry.workflows !== undefined && entry.workflows.length > 0;
    const rooted = packFilesAtRoot(read.ok, multi ? entry.workflows : undefined);
    if ("error" in rooted) return yield* fail("invalid", rooted.error);
    const folder = path.join(staging, entry.id);
    for (const file of rooted.ok) {
      const target = path.join(folder, ...file.path.split("/"));
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFile(target, file.data);
    }
    const loaded = yield* local(loadWorkflowDir(multi ? folder : staging, "user"));
    for (const id of packWorkflowIds(entry)) {
      if (!loaded.workflows.some((candidate) => candidate.manifest.id === id)) {
        const reason = loaded.problems[0]?.message ?? "it has no workflow.json.";
        return yield* fail("invalid", `The pack is not a valid workflow: ${reason}`);
      }
    }
    return folder;
  });

  const installUnlocked = Effect.fn("ZenOffice.installPack")(function* (
    input: ZenInstallPackInput & { readonly hubCompanyId?: string },
  ) {
    const { loaded, community } = yield* loadCatalog;
    const found = loaded.entries.find((candidate) => candidate.entry.id === input.id);
    if (!found) return yield* fail("not-found", "This pack is not in the library.");
    const { entry, origin } = found;
    if (entry.kind === "builtin")
      return yield* fail("invalid", "This workflow is already included.");
    // Community packs download from the hub's catalog address (their urls are absolute already).
    const remoteBase = origin === "community" ? community.catalogUrl : loaded.remoteBase;
    const remote =
      (origin === "remote" || origin === "community") && entry.download !== undefined && remoteBase;
    if (entry.kind === "coming_soon" || (!remote && (origin !== "local" || !entry.path))) {
      return yield* fail("unavailable", "This pack is not available yet.");
    }
    const allIds = packWorkflowIds(entry);
    // A customized copy is never overwritten by an install or update: the person chooses
    // Keep mine / Take new / Merge for it (resolveCustomUpdate).
    const customized = yield* custom.customizedIn(userDir, allIds);
    const ids = allIds.filter((id) => !customized.has(id));
    for (const id of ids) {
      const own = yield* userWorkflow(id);
      if (own && own.packId === null) {
        return yield* fail("conflict", `You already have your own workflow with the id "${id}".`);
      }
    }
    const removeInstalled = Effect.forEach(
      ids,
      (id) => fs.remove(path.join(userDir, id), { recursive: true }).pipe(Effect.ignore),
      { discard: true },
    );
    if (remote) {
      yield* fs.makeDirectory(stagingRoot, { recursive: true });
      const staging = yield* fs.makeTempDirectory({ directory: stagingRoot, prefix: "pack-" });
      yield* stageRemotePack(entry, remote, staging).pipe(
        Effect.flatMap((folder) => local(installPackFolder(folder, userDir, entry, customized))),
        Effect.ensuring(fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
      );
    } else {
      const packFolder = path.resolve(path.dirname(registryPath), entry.path!);
      yield* local(installPackFolder(packFolder, userDir, entry, customized));
    }
    for (const id of ids) {
      // Zen toolchains: enterprise packs need an admin's approval; invalid access blocks fail.
      // The approval must be this company's (a company pack's hub company, or the marketplace's).
      const refusal = zenPackInstallRefusal(entry.id, path.join(userDir, id), {
        hubCompanyId: input.hubCompanyId ?? null,
        localCompanyId: input.companyId ?? null,
      });
      if (refusal) {
        yield* removeInstalled;
        return yield* fail("invalid", refusal);
      }
      const installed = yield* userWorkflow(id);
      if (!installed) {
        yield* removeInstalled;
        return yield* fail("invalid", "The pack was copied but is not a valid workflow.");
      }
    }
    // Credit for the author: the hub counts one install per person.
    if (origin === "community") yield* Effect.sync(() => void library.countInstall(entry));
  });
  const installPack = (input: ZenInstallPackInput & { readonly hubCompanyId?: string }) =>
    writeLock
      .withPermits(1)(installUnlocked(input))
      .pipe(Effect.andThen(registry), asOfficeError("install the pack"));

  const uninstallUnlocked = Effect.fn("ZenOffice.uninstallPack")(function* (
    input: ZenWorkflowIdInput,
  ) {
    if (zenCompanyHubBridge()?.managedPackIds().has(input.id)) {
      return yield* fail(
        "conflict",
        "An admin installed this pack for the whole company, so it stays installed. You can hide it instead.",
      );
    }
    const loaded = yield* loadCatalog.pipe(
      Effect.map((catalog) => catalog.loaded),
      Effect.orElseSucceed(() => null),
    );
    const entry = loaded?.entries.find((candidate) => candidate.entry.id === input.id)?.entry ?? {
      id: input.id,
    };
    const { workflows } = yield* local(loadWorkflowDir(userDir, "user"));
    const installed = workflows.filter((workflow) => workflowBelongsToPack(workflow, entry));
    if (installed.length === 0) return yield* fail("not-found", "This pack is not installed.");
    for (const workflow of installed) {
      // A customized copy is kept aside (backups) before it goes with its pack.
      if (workflow.customization) yield* custom.backupUserCopy(workflow.manifest.id);
      yield* fs.remove(path.join(userDir, workflow.manifest.id), { recursive: true });
    }
  });
  const uninstallPack = (input: ZenWorkflowIdInput) =>
    writeLock
      .withPermits(1)(uninstallUnlocked(input))
      .pipe(Effect.andThen(registry), asOfficeError("uninstall the pack"));

  const threadMessages = Effect.fn("ZenOffice.threadMessages")(function* (threadId: string) {
    if (Option.isNone(orchestrator)) {
      return yield* fail("unavailable", "Threads cannot be read on this server.");
    }
    const records = yield* orchestrator.value
      .getThreadRecords(ThreadId.make(threadId), ["messages"])
      .pipe(Effect.mapError(() => fail("not-found", "This task could not be found.")));
    const messages: DraftMessage[] = records.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role === "user" ? ("user" as const) : ("assistant" as const),
        text: message.role === "user" ? draftMessageText(message.text) : message.text,
      }));
    return { title: records.thread.title, messages };
  });

  const generateDraft = (prompt: string) =>
    Option.isNone(textGeneration)
      ? Effect.succeed(null)
      : Effect.scoped(
          Effect.gen(function* () {
            // The model runs in an empty folder: the draft must not read any project.
            const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "zen-workflow-draft-" });
            const generated = yield* textGeneration.value.generateTranscriptionPostProcessing({
              cwd,
              prompt,
              modelSelection: {
                instanceId: ProviderInstanceId.make("claudeAgent"),
                model: ZEN_WORKFLOW_DRAFT_MODEL,
              } as ModelSelection,
            });
            return generated.transcription;
          }),
        ).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Zen Office: the workflow draft model failed", error),
          ),
          Effect.orElseSucceed(() => null),
        );

  const draftWorkflow = Effect.fn("ZenOffice.draftWorkflow")(function* (
    input: ZenDraftWorkflowInput,
  ) {
    const { title, messages } = yield* threadMessages(input.threadId);
    if (!messages.some((message) => message.role === "user" && message.text.trim())) {
      return yield* fail("invalid", "This task has no message to learn from yet.");
    }
    const reply = yield* generateDraft(buildDraftPrompt(messages, input.locale));
    const drafted = reply === null ? null : parseDraftReply(reply);
    return drafted
      ? ({ ...drafted, method: "ai" } satisfies ZenWorkflowDraft)
      : ({
          ...basicDraft(messages, title, input.locale),
          method: "basic",
        } satisfies ZenWorkflowDraft);
  }, asOfficeError("draft the workflow"));

  const uploadInputFile = Effect.fn("ZenOffice.uploadInputFile")(function* (
    input: ZenUploadInputFileInput,
  ) {
    const name = safeUploadName(input.fileName);
    if (name === null) return yield* fail("invalid", "The file needs a name.");
    if (!path.isAbsolute(input.cwd)) return yield* fail("invalid", "The work folder is not known.");
    const info = yield* fs
      .stat(input.cwd)
      .pipe(Effect.mapError(() => fail("not-found", "The work folder does not exist.")));
    if (info.type !== "Directory")
      return yield* fail("invalid", "The work folder is not a folder.");
    // Base64 is 4 characters per 3 bytes; refuse before decoding anything too large.
    if (input.dataBase64.length > Math.ceil(ZEN_INPUT_FILE_MAX_BYTES / 3) * 4 + 4) {
      return yield* fail("invalid", "The file is larger than 25 MB.");
    }
    const bytes = Buffer.from(input.dataBase64, "base64");
    if (bytes.byteLength > ZEN_INPUT_FILE_MAX_BYTES) {
      return yield* fail("invalid", "The file is larger than 25 MB.");
    }
    const folder = path.join(input.cwd, UPLOAD_FOLDER);
    yield* fs.makeDirectory(folder, { recursive: true });
    const { stem, extension } = splitExtension(name);
    let fileName = name;
    for (let n = 2; yield* fs.exists(path.join(folder, fileName)); n++) {
      fileName = `${stem}-${n}${extension}`;
    }
    const absolutePath = path.join(folder, fileName);
    yield* fs.writeFile(absolutePath, bytes);
    return {
      relativePath: `${UPLOAD_FOLDER}/${fileName}`,
      absolutePath,
      bytes: bytes.byteLength,
    } satisfies ZenUploadedInputFile;
  }, asOfficeError("copy the file"));

  const sampleMedia = Effect.fn("ZenOffice.sampleMedia")(function* (input: ZenSampleMediaInput) {
    const loaded = yield* loadRegistry;
    const found = sampleEntryFor(
      loaded.entries.map((item) => ({ ...item.entry, origin: item.origin })),
      input.id,
    );
    const sample = found?.sample;
    if (!found || !sample) return null;
    const base = {
      kind: sample.kind,
      caption: sample.caption ?? null,
      ...(sample.i18n ? { i18n: sample.i18n } : {}),
    };
    if (/^https:\/\//i.test(sample.src)) return { ...base, url: sample.src };
    if (found.origin === "remote" && loaded.remoteBase) {
      const resolved = resolveDownloadUrl(loaded.remoteBase, sample.src);
      return "ok" in resolved ? { ...base, url: resolved.ok } : null;
    }
    // A bundled sample: a file next to the registry, at most 15 MB, sent as a data URL.
    const root = path.dirname(registryPath);
    const file = path.resolve(root, sample.src);
    const mime = sampleMimeType(file);
    if (!mime || !file.startsWith(root + path.sep)) return null;
    const info = yield* fs.stat(file).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "File") return null;
    if (Number(info.value.size) > SAMPLE_MAX_BYTES) return null;
    const bytes = yield* fs.readFile(file);
    return { ...base, url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
  }, asOfficeError("load the sample"));

  // Hub v6: packs installed for the whole company (zen/hub/companyHub.ts installs them on sync).
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  setZenPackHubPort({
    // The pack's own version, from the marker install writes next to each of its workflows (a
    // pack's workflows keep their own manifest versions).
    installed: () =>
      runPromise(
        Effect.gen(function* () {
          const names = yield* fs.readDirectory(userDir).pipe(Effect.orElseSucceed(() => []));
          const versions: Record<string, string | null> = {};
          for (const name of names) {
            const text = yield* fs
              .readFileString(path.join(userDir, name, ".zen-pack.json"))
              .pipe(Effect.orElseSucceed(() => null));
            const marker = text === null ? null : packMarkerOf(text);
            if (marker !== null) versions[marker.packId] = marker.version;
          }
          return versions;
        }),
      ),
    customized: () =>
      runPromise(
        Effect.gen(function* () {
          const names = yield* fs.readDirectory(userDir).pipe(Effect.orElseSucceed(() => []));
          const found = new Set<string>();
          for (const name of names) {
            const text = yield* fs
              .readFileString(path.join(userDir, name, ".zen-pack.json"))
              .pipe(Effect.orElseSucceed(() => null));
            const marker = text === null ? null : packMarkerOf(text);
            if (marker === null) continue;
            const customized = yield* fs
              .exists(path.join(userDir, name, ".zen-custom.json"))
              .pipe(Effect.orElseSucceed(() => false));
            if (customized) found.add(marker.packId);
          }
          return found as ReadonlySet<string>;
        }),
      ),
    install: (packId, hubCompanyId) =>
      runPromise(
        installPack({ id: packId, ...(hubCompanyId === undefined ? {} : { hubCompanyId }) }).pipe(
          Effect.map((view) => ({
            ok: true as const,
            version: view.entries.find((item) => item.entry.id === packId)?.entry.version ?? null,
          })),
          Effect.catchTags({
            ZenOfficeError: (error) =>
              Effect.succeed({
                ok: false as const,
                enterprise: error.detail === ENTERPRISE_INSTALL_REFUSAL,
                error: error.detail,
              }),
          }),
        ),
      ),
    describe: (packId) =>
      runPromise(
        loadCatalog.pipe(
          Effect.map(({ loaded }) => {
            const found = loaded.entries.find((item) => item.entry.id === packId);
            if (found === undefined || found.entry.kind === "builtin") return null;
            if (found.entry.kind === "coming_soon") return null;
            // A bundled pack says in its workflow.json whether it is Enterprise; a remote one is
            // checked when it is downloaded (the runner-only rule applies then).
            const folder =
              found.origin === "local" && found.entry.path
                ? path.resolve(path.dirname(registryPath), found.entry.path)
                : null;
            const folders =
              folder === null
                ? []
                : found.entry.workflows && found.entry.workflows.length > 0
                  ? found.entry.workflows.map((id) => path.join(folder, id))
                  : [folder];
            return {
              version: found.entry.version,
              enterprise: folders.some((item) => zenPackIsEnterprise(item)),
            };
          }),
          Effect.orElseSucceed(() => null),
        ),
      ),
  });

  /** The registry entry an original comes from (packs), with where its files are. */
  const originalEntry = Effect.fn("ZenOffice.originalEntry")(function* (packId: string) {
    const loaded = yield* loadRegistry;
    const found = loaded.entries.find((candidate) => candidate.entry.id === packId);
    return found ? { ...found, remoteBase: loaded.remoteBase } : null;
  });
  const builtinVersion = (id: string) =>
    local(loadWorkflowDir(builtinDir, "builtin")).pipe(
      Effect.map(
        ({ workflows }) =>
          workflows.find((workflow) => workflow.manifest.id === id)?.manifest.version ?? null,
      ),
    );
  /** The newest original of a workflow, read through `read` (a remote pack is staged first). */
  const readLatestOriginal = Effect.fn("ZenOffice.readLatestOriginal")(function* (
    origin: ZenWorkflowCustomization["origin"],
    read: (folder: string) => Effect.Effect<FolderFiles, ZenOfficeError>,
  ) {
    if (origin.kind === "builtin") return yield* read(path.join(builtinDir, origin.workflowId));
    const found = yield* originalEntry(origin.packId);
    if (!found || found.entry.kind !== "pack") {
      return yield* fail("unavailable", "The new version is not in the library.");
    }
    const { entry } = found;
    const multi = entry.workflows !== undefined && entry.workflows.length > 0;
    const inPack = (folder: string) => (multi ? path.join(folder, origin.workflowId) : folder);
    if (found.origin === "remote" && entry.download !== undefined && found.remoteBase) {
      yield* fs.makeDirectory(stagingRoot, { recursive: true });
      const staging = yield* fs.makeTempDirectory({ directory: stagingRoot, prefix: "pack-" });
      return yield* stageRemotePack(entry, found.remoteBase, staging).pipe(
        Effect.flatMap((folder) => read(inPack(folder))),
        Effect.ensuring(fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
      );
    }
    if (found.origin !== "local" || !entry.path) {
      return yield* fail("unavailable", "The new version is not available yet.");
    }
    return yield* read(inPack(path.resolve(path.dirname(registryPath), entry.path)));
  }, asOfficeError("read the new version"));
  const custom = makeCustomPacks({
    fs,
    path,
    userDir,
    builtinDir,
    companyDir: (companyId) => companyDirOf(companyId),
    latestVersion: (origin) =>
      origin.kind === "builtin"
        ? builtinVersion(origin.workflowId).pipe(asOfficeError("read the built-in workflow"))
        : originalEntry(origin.packId).pipe(
            Effect.map((found) => found?.entry.version ?? null),
            asOfficeError("read the library"),
          ),
    readLatestOriginal,
  });
  const locked = writeLock.withPermits(1);

  const customPacks = Effect.fn("ZenOffice.customPacks")(function* (input: ZenCustomPacksInput) {
    return yield* custom.list(input.companyId);
  });
  const customizePack = Effect.fn("ZenOffice.customizePack")(function* (
    input: ZenCustomizePackInput,
  ) {
    return yield* locked(custom.customize(input));
  });
  const customDraft = Effect.fn("ZenOffice.customDraft")(function* (input: ZenCustomTargetInput) {
    return yield* custom.review(input);
  });
  const saveCustomDraft = Effect.fn("ZenOffice.saveCustomDraft")(function* (
    input: ZenCustomTargetInput,
  ) {
    return yield* locked(custom.save(input));
  });
  const discardCustomDraft = Effect.fn("ZenOffice.discardCustomDraft")(function* (
    input: ZenCustomTargetInput,
  ) {
    return yield* locked(custom.discard(input));
  });
  const revertCustomPack = Effect.fn("ZenOffice.revertCustomPack")(function* (
    input: ZenCustomTargetInput,
  ) {
    return yield* locked(custom.revert(input));
  });
  const resolveCustomUpdate = Effect.fn("ZenOffice.resolveCustomUpdate")(function* (
    input: ZenResolveCustomUpdateInput,
  ) {
    return yield* locked(custom.resolveUpdate(input));
  });
  const shareCustomPack = Effect.fn("ZenOffice.shareCustomPack")(function* (
    input: ZenShareCustomPackInput,
  ) {
    return yield* locked(custom.share(input));
  });

  // Chat-first task start: plain async engine over small files; its agent tools ride on zen-connect.
  const services = yield* Effect.context<never>();
  const intakeEngine = new IntakeEngine({
    stateDir: config.stateDir,
    zenHome: config.baseDir,
    listWorkflows: async (companyId) =>
      (await Effect.runPromiseWith(services)(listWorkflows({ companyId }))).workflows,
    connections: listZenConnections,
  });
  const unregisterIntakeTools = registerZenGatewayTools("intake", intakeEngine.tools());
  yield* Effect.addFinalizer(() => Effect.sync(unregisterIntakeTools));
  const intake = (input: ZenIntakeCallInput) =>
    Effect.tryPromise({
      try: () => intakeEngine.call(input.op, input.input),
      catch: (cause) =>
        cause instanceof IntakeError
          ? fail(cause.reason, cause.message)
          : fail("io", cause instanceof Error ? cause.message : String(cause)),
    });

  const libraryCall = (input: ZenLibraryCallInput) =>
    Effect.tryPromise({
      try: () => library.call(input.op, input.input),
      catch: (cause) =>
        cause instanceof LibraryError
          ? fail(cause.reason === "not-signed-in" ? "unavailable" : cause.reason, cause.message)
          : fail("io", cause instanceof Error ? cause.message : String(cause)),
    });

  return ZenOffice.of({
    intake,
    library: libraryCall,
    customPacks,
    customizePack,
    customDraft,
    saveCustomDraft,
    discardCustomDraft,
    revertCustomPack,
    resolveCustomUpdate,
    shareCustomPack,
    sampleMedia,
    draftWorkflow,
    uploadInputFile,
    settings,
    setEdition,
    listWorkflows,
    saveWorkflow,
    deleteWorkflow,
    registry,
    installPack,
    uninstallPack,
    setRegistryUrl,
  });
});

export const layer = Layer.effect(ZenOffice, make());

/** RPC handlers for ws.ts, kept here so the upstream file only spreads them in. */
export const wsHandlers = (service: Option.Option<ZenOffice["Service"]>) => {
  const unavailable = Effect.fail(
    fail("unavailable", "The Office edition is not available on this server."),
  );
  const call = <A>(run: (office: ZenOffice["Service"]) => Effect.Effect<A, ZenOfficeError>) =>
    Option.isSome(service) ? run(service.value) : unavailable;
  return {
    [ZEN_OFFICE_WS_METHODS.settings]: (_input: {}) => call((office) => office.settings),
    [ZEN_OFFICE_WS_METHODS.setEdition]: (input: { readonly edition: ZenEdition }) =>
      call((office) => office.setEdition(input)),
    [ZEN_OFFICE_WS_METHODS.listWorkflows]: (input: ZenListWorkflowsInput) =>
      call((office) => office.listWorkflows(input)),
    [ZEN_OFFICE_WS_METHODS.saveWorkflow]: (input: ZenSaveWorkflowInput) =>
      call((office) => office.saveWorkflow(input)),
    [ZEN_OFFICE_WS_METHODS.deleteWorkflow]: (input: ZenDeleteWorkflowInput) =>
      call((office) => office.deleteWorkflow(input)),
    [ZEN_OFFICE_WS_METHODS.registry]: (_input: {}) => call((office) => office.registry),
    [ZEN_OFFICE_WS_METHODS.installPack]: (input: ZenInstallPackInput) =>
      // Only what the app may say: a company pack's hub company is set by the hub sync alone.
      call((office) =>
        office.installPack({
          id: input.id,
          ...(input.companyId == null ? {} : { companyId: input.companyId }),
        }),
      ),
    [ZEN_OFFICE_WS_METHODS.uninstallPack]: (input: ZenWorkflowIdInput) =>
      call((office) => office.uninstallPack(input)),
    [ZEN_OFFICE_WS_METHODS.setRegistryUrl]: (input: ZenSetRegistryUrlInput) =>
      call((office) => office.setRegistryUrl(input)),
    [ZEN_OFFICE_WS_METHODS.draftWorkflow]: (input: ZenDraftWorkflowInput) =>
      call((office) => office.draftWorkflow(input)),
    [ZEN_OFFICE_WS_METHODS.uploadInputFile]: (input: ZenUploadInputFileInput) =>
      call((office) => office.uploadInputFile(input)),
    [ZEN_OFFICE_WS_METHODS.sampleMedia]: (input: ZenSampleMediaInput) =>
      call((office) => office.sampleMedia(input)),
    [ZEN_OFFICE_WS_METHODS.customPacks]: (input: ZenCustomPacksInput) =>
      call((office) => office.customPacks(input)),
    [ZEN_OFFICE_WS_METHODS.customizePack]: (input: ZenCustomizePackInput) =>
      call((office) => office.customizePack(input)),
    [ZEN_OFFICE_WS_METHODS.customDraft]: (input: ZenCustomTargetInput) =>
      call((office) => office.customDraft(input)),
    [ZEN_OFFICE_WS_METHODS.saveCustomDraft]: (input: ZenCustomTargetInput) =>
      call((office) => office.saveCustomDraft(input)),
    [ZEN_OFFICE_WS_METHODS.discardCustomDraft]: (input: ZenCustomTargetInput) =>
      call((office) => office.discardCustomDraft(input)),
    [ZEN_OFFICE_WS_METHODS.revertCustomPack]: (input: ZenCustomTargetInput) =>
      call((office) => office.revertCustomPack(input)),
    [ZEN_OFFICE_WS_METHODS.resolveCustomUpdate]: (input: ZenResolveCustomUpdateInput) =>
      call((office) => office.resolveCustomUpdate(input)),
    [ZEN_OFFICE_WS_METHODS.shareCustomPack]: (input: ZenShareCustomPackInput) =>
      call((office) => office.shareCustomPack(input)),
    [ZEN_OFFICE_WS_METHODS.intake]: (input: ZenIntakeCallInput) =>
      call((office) => office.intake(input)),
    [ZEN_OFFICE_WS_METHODS.library]: (input: ZenLibraryCallInput) =>
      call((office) => office.library(input)),
  };
};
