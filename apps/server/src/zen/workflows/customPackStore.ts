// Zen Staff: customized packs on disk. A copy lives in the person's or the company's workflows
// folder under its workflow id, with `.zen-custom.json` and the original in `.zen-custom/base/`;
// changes happen in `<dir>/.zen-custom-drafts/<id>/` and are saved only after review. ZEN.md,
// "Customized packs".
import {
  ZenOfficeError,
  type ZenCustomDraftReview,
  type ZenCustomPackView,
  type ZenCustomScope,
  type ZenCustomThreadStart,
  type ZenCustomUpdateChoice,
  type ZenResolveCustomUpdateResult,
  type ZenWorkflowCustomization,
} from "@t3tools/contracts/zenOffice";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  CHECKS_FILE,
  CUSTOM_BACKUPS_DIR,
  CUSTOM_BACKUPS_KEPT,
  CUSTOM_DRAFTS_DIR,
  CUSTOM_MARKER_FILE,
  CUSTOM_META_DIR,
  asText,
  conflictFilesOf,
  customIdFor,
  customThreadMessage,
  customThreadTitle,
  draftChanges,
  folderDiff,
  guardedChanges,
  hasConflictMarkers,
  isPackContent,
  jsonStringField,
  mergeFolders,
  parseChecks,
  parseCustomMarker,
  updateOffered,
  type FolderFiles,
} from "./customPacks.ts";
import { parseWorkflowFolder } from "./workflowStore.ts";

const PACK_MARKER_FILE = ".zen-pack.json";
const BASE_DIR = `${CUSTOM_META_DIR}/base`;
const MERGE_REPORT = `${CUSTOM_META_DIR}/merge-report.json`;
/** A pack folder larger than this is not copied (packs are scripts and templates, not media). */
const MAX_FILES = 3000;
const MAX_BYTES = 200 * 1024 * 1024;

const fail = (reason: ZenOfficeError["reason"], detail: string) =>
  new ZenOfficeError({ reason, detail });
const isOfficeError = Schema.is(ZenOfficeError);

type Origin = ZenWorkflowCustomization["origin"];

export interface CustomTarget {
  readonly workflowId: string;
  readonly companyId?: string | null | undefined;
}

export interface CustomPackDeps {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly userDir: string;
  readonly builtinDir: string;
  /** The company's workflows folder, or null when the id is not valid. */
  readonly companyDir: (companyId: string) => Effect.Effect<string | null>;
  /** The newest version we ship of an original (registry entry, or the built-in's manifest). */
  readonly latestVersion: (origin: Origin) => Effect.Effect<string | null, ZenOfficeError>;
  /** Reads the newest original of this workflow (staged first when it comes from a remote). */
  readonly readLatestOriginal: (
    origin: Origin,
    read: (folder: string) => Effect.Effect<FolderFiles, ZenOfficeError>,
  ) => Effect.Effect<FolderFiles, ZenOfficeError>;
}

interface Target {
  readonly dir: string;
  readonly scope: ZenCustomScope;
  readonly companyId: string | null;
}

const prettyJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Any disk failure becomes a plain "io" error that says what was being done. */
const io =
  (action: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ZenOfficeError, R> =>
    effect.pipe(
      Effect.mapError((error) =>
        isOfficeError(error)
          ? error
          : fail(
              "io",
              `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
            ),
      ),
    );

export function makeCustomPacks(deps: CustomPackDeps) {
  const { fs, path } = deps;
  const readOptional = (file: string) =>
    fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const targetOf = Effect.fn("ZenCustomPacks.target")(function* (
    companyId: string | null | undefined,
  ) {
    if (!companyId) return { dir: deps.userDir, scope: "user", companyId: null } satisfies Target;
    const dir = yield* deps.companyDir(companyId);
    if (dir === null) {
      return yield* fail("invalid", "This company's workflows folder is not known.");
    }
    return { dir, scope: "company", companyId } satisfies Target;
  });
  const mine: Target = { dir: deps.userDir, scope: "user", companyId: null };

  const activeFolder = (target: Target, id: string) => path.join(target.dir, id);
  const draftFolder = (target: Target, id: string) => path.join(target.dir, CUSTOM_DRAFTS_DIR, id);
  const markerOf = (folder: string) =>
    readOptional(path.join(folder, CUSTOM_MARKER_FILE)).pipe(Effect.map(parseCustomMarker));

  /** Pack content of a folder (relative path -> bytes), without markers, meta, renders. */
  const readTree = Effect.fn("ZenCustomPacks.readTree")(function* (root: string) {
    const files = new Map<string, Uint8Array>();
    if (!(yield* exists(root))) return files as FolderFiles;
    let bytes = 0;
    const pending: Array<{ readonly dir: string; readonly prefix: string }> = [
      { dir: root, prefix: "" },
    ];
    while (pending.length > 0) {
      const { dir, prefix } = pending.pop()!;
      const names = yield* fs.readDirectory(dir);
      for (const name of names.toSorted()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        if (!isPackContent(relative)) continue;
        const full = path.join(dir, name);
        const info = yield* fs.stat(full);
        if (info.type === "Directory") pending.push({ dir: full, prefix: relative });
        else if (info.type === "File") {
          if (files.size >= MAX_FILES || bytes > MAX_BYTES) {
            return yield* fail("invalid", "This pack folder is too large to customize.");
          }
          const data = yield* fs.readFile(full);
          bytes += data.byteLength;
          files.set(relative, data);
        }
      }
    }
    return files as FolderFiles;
  }, io("read the pack folder"));

  const writeTree = Effect.fn("ZenCustomPacks.writeTree")(function* (
    root: string,
    files: Iterable<readonly [string, Uint8Array]>,
  ) {
    yield* fs.makeDirectory(root, { recursive: true });
    for (const [relative, data] of files) {
      const target = path.join(root, ...relative.split("/"));
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFile(target, data);
    }
  }, io("write the pack folder"));

  /** Copies a folder aside before it is replaced; keeps the last few per workflow. */
  const backup = Effect.fn("ZenCustomPacks.backup")(function* (target: Target, id: string) {
    const folder = activeFolder(target, id);
    if (!(yield* exists(folder))) return;
    const root = path.join(target.dir, CUSTOM_BACKUPS_DIR);
    yield* fs.makeDirectory(root, { recursive: true });
    const stamp = (yield* now).replace(/[:.]/g, "-");
    yield* fs.copy(folder, path.join(root, `${id}-${stamp}`), { overwrite: true });
    const kept = (yield* fs.readDirectory(root))
      .filter((name) => name.startsWith(`${id}-`))
      .toSorted();
    for (const old of kept.slice(0, Math.max(0, kept.length - CUSTOM_BACKUPS_KEPT))) {
      yield* fs.remove(path.join(root, old), { recursive: true }).pipe(Effect.ignore);
    }
  }, io("keep a backup"));

  const writeMarker = (folder: string, marker: ZenWorkflowCustomization) =>
    fs
      .writeFileString(path.join(folder, CUSTOM_MARKER_FILE), prettyJson(marker))
      .pipe(io("write the customization marker"));
  const writePackMarker = (folder: string, origin: Origin, version: string) =>
    origin.kind === "pack"
      ? fs
          .writeFileString(
            path.join(folder, PACK_MARKER_FILE),
            prettyJson({ packId: origin.packId, version }),
          )
          .pipe(io("write the pack marker"))
      : Effect.void;
  const removeFolder = (folder: string) =>
    fs.remove(folder, { recursive: true }).pipe(Effect.ignore);
  const manifestField = (folder: string, key: string) =>
    readOptional(path.join(folder, "workflow.json")).pipe(
      Effect.map((text) => jsonStringField(text, key)),
    );

  const viewOf = Effect.fn("ZenCustomPacks.view")(function* (target: Target, id: string) {
    const active = yield* markerOf(activeFolder(target, id));
    const draft = yield* markerOf(draftFolder(target, id));
    const marker = draft ?? active;
    if (marker === null) return null;
    const latest = active
      ? yield* deps.latestVersion(active.origin).pipe(Effect.orElseSucceed(() => null))
      : null;
    const name = yield* manifestField(
      draft ? draftFolder(target, id) : activeFolder(target, id),
      "name",
    );
    return {
      workflowId: id,
      name: name ?? id,
      customId: marker.customId,
      scope: target.scope,
      companyId: target.companyId,
      status: active ? "active" : "draft",
      hasActive: active !== null,
      hasDraft: draft !== null,
      origin: (active ?? marker).origin,
      updateAvailable: active ? updateOffered(active, latest) : null,
      draftFolder: draft ? draftFolder(target, id) : null,
      merge: draft?.merge ?? null,
      revision: active?.revision ?? 0,
      request: marker.request,
    } satisfies ZenCustomPackView;
  });

  const listIn = Effect.fn("ZenCustomPacks.listIn")(function* (target: Target) {
    const names = new Set<string>();
    for (const dir of [target.dir, path.join(target.dir, CUSTOM_DRAFTS_DIR)]) {
      const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
      for (const name of entries) {
        if (name.startsWith(".")) continue;
        if (yield* exists(path.join(dir, name, CUSTOM_MARKER_FILE))) names.add(name);
      }
    }
    const views: ZenCustomPackView[] = [];
    for (const name of [...names].toSorted()) {
      const view = yield* viewOf(target, name);
      if (view) views.push(view);
    }
    return views;
  });

  /** Every customized copy the person sees: their own, then the company's. */
  const list = Effect.fn("ZenCustomPacks.list")(function* (companyId: string | null | undefined) {
    const own = yield* listIn(mine);
    if (!companyId) return own;
    const company = yield* targetOf(companyId).pipe(Effect.option);
    return company._tag === "Some" ? [...own, ...(yield* listIn(company.value))] : own;
  }, io("list the customized packs"));

  /**
   * The folder a new customization starts from and the original behind it. An existing copy in
   * the same place is changed further (its base stays); otherwise the original: the pack
   * installed in the person's folder (or the base of their own copy), else the built-in.
   */
  const startingPoint = Effect.fn("ZenCustomPacks.startingPoint")(function* (
    target: Target,
    id: string,
  ) {
    const own = activeFolder(target, id);
    const ownMarker = yield* markerOf(own);
    if (ownMarker) {
      return {
        source: own,
        base: path.join(own, BASE_DIR),
        origin: ownMarker.origin,
        previous: ownMarker as ZenWorkflowCustomization | null,
      };
    }
    const userFolder = path.join(deps.userDir, id);
    const userMarker = yield* markerOf(userFolder);
    if (userMarker) {
      // The company's copy starts from the original behind the person's own copy.
      const base = path.join(userFolder, BASE_DIR);
      return { source: base, base, origin: userMarker.origin, previous: null };
    }
    const installed = yield* readOptional(path.join(userFolder, PACK_MARKER_FILE));
    if (installed !== null) {
      const origin: Origin = {
        packId: jsonStringField(installed, "packId") ?? id,
        workflowId: id,
        version: (yield* manifestField(userFolder, "version")) ?? "0.0.0",
        kind: "pack",
      };
      return { source: userFolder, base: userFolder, origin, previous: null };
    }
    const builtin = path.join(deps.builtinDir, id);
    if (yield* exists(path.join(builtin, "workflow.json"))) {
      const origin: Origin = {
        packId: id,
        workflowId: id,
        version: (yield* manifestField(builtin, "version")) ?? "0.0.0",
        kind: "builtin",
      };
      return { source: builtin, base: builtin, origin, previous: null };
    }
    return yield* fail(
      "not-found",
      "Only a pack from the marketplace or a workflow that comes with the app can be customized. Install the pack first.",
    );
  });

  const threadStart = Effect.fn("ZenCustomPacks.threadStart")(function* (
    target: Target,
    id: string,
    input: { readonly request: string | null; readonly locale: string | undefined },
  ) {
    const view = yield* viewOf(target, id);
    const folder = draftFolder(target, id);
    const marker = yield* markerOf(folder);
    if (!view || !marker) return yield* fail("io", "The draft was not created.");
    const reportFile = path.join(folder, MERGE_REPORT);
    const merge = marker.merge
      ? {
          ...marker.merge,
          conflictFiles: conflictFilesOf(yield* readOptional(reportFile)),
          reportFile,
        }
      : undefined;
    return {
      pack: view,
      draftFolder: folder,
      title: customThreadTitle(view.name, merge !== undefined, input.locale),
      message: customThreadMessage({
        workflowName: view.name,
        workflowId: id,
        customId: marker.customId,
        scope: target.scope,
        draftFolder: folder,
        request: input.request,
        locale: input.locale,
        ...(merge ? { merge } : {}),
      }),
    } satisfies ZenCustomThreadStart;
  });

  /** "Personalizează": a draft copy for the agent thread (an open draft is reused). */
  const customize = Effect.fn("ZenCustomPacks.customize")(function* (
    input: CustomTarget & {
      readonly request?: string | undefined;
      readonly locale?: string | undefined;
    },
  ) {
    const target = yield* targetOf(input.companyId);
    const id = input.workflowId;
    const draft = draftFolder(target, id);
    const request = input.request?.trim() ? input.request.trim() : null;
    const open = yield* markerOf(draft);
    if (open) {
      // Same draft, a new request: the thread continues on what is already changed, and the
      // checks must run again.
      if (request) yield* writeMarker(draft, { ...open, request, updatedAt: yield* now });
      yield* fs.remove(path.join(draft, CHECKS_FILE)).pipe(Effect.ignore);
      return yield* threadStart(target, id, { request, locale: input.locale });
    }
    const start = yield* startingPoint(target, id);
    const content = yield* readTree(start.source);
    const base = yield* readTree(start.base);
    if (!content.has("workflow.json")) {
      return yield* fail("not-found", "This workflow's folder could not be read.");
    }
    yield* removeFolder(draft);
    yield* writeTree(draft, content);
    yield* writeTree(path.join(draft, BASE_DIR), base);
    yield* writePackMarker(draft, start.origin, start.origin.version);
    yield* writeMarker(draft, {
      customId: customIdFor(id, target.scope),
      scope: target.scope,
      companyId: target.companyId,
      origin: start.origin,
      revision: start.previous?.revision ?? 0,
      request,
      declinedVersion: start.previous?.declinedVersion ?? null,
      merge: null,
      updatedAt: yield* now,
    });
    return yield* threadStart(target, id, { request, locale: input.locale });
  }, io("start the customization"));

  const reviewOf = Effect.fn("ZenCustomPacks.reviewOf")(function* (target: Target, id: string) {
    const folder = draftFolder(target, id);
    const marker = yield* markerOf(folder);
    const view = yield* viewOf(target, id);
    if (!marker || !view) return yield* fail("not-found", "There is no draft to review.");
    const draft = yield* readTree(folder);
    const active = activeFolder(target, id);
    const before = (yield* markerOf(active))
      ? yield* readTree(active)
      : yield* readTree(path.join(folder, BASE_DIR));
    const files = draftChanges(before, draft);
    const { diff, truncated } = folderDiff(before, draft);
    const checks = parseChecks(yield* readOptional(path.join(folder, CHECKS_FILE)));
    const text = (file: string) => {
      const bytes = draft.get(file);
      return bytes === undefined ? null : asText(bytes);
    };
    const blockers: string[] = [];
    const parsed = parseWorkflowFolder(
      {
        folderName: id,
        workflowJson: text("workflow.json"),
        prompt: text("prompt.md"),
        skill: text("SKILL.md"),
        packMarker: null,
      },
      target.scope,
    );
    if (parsed._tag === "problem") {
      blockers.push(`The draft does not load: ${parsed.problem.message}`);
    }
    const baseManifest = yield* readOptional(path.join(folder, BASE_DIR, "workflow.json"));
    const draftManifest = text("workflow.json");
    if (baseManifest !== null && draftManifest !== null) {
      const changed = guardedChanges(baseManifest, draftManifest);
      if (changed.length > 0) {
        blockers.push(
          `These workflow.json settings must stay as in the original: ${changed.join(", ")}.`,
        );
      }
    }
    const conflicted = [...draft.entries()]
      .filter(([, bytes]) => {
        const value = asText(bytes);
        return value !== null && hasConflictMarkers(value);
      })
      .map(([file]) => file);
    if (conflicted.length > 0) {
      blockers.push(`Conflicts are still marked in: ${conflicted.join(", ")}.`);
    }
    if (files.length === 0 && !marker.merge) blockers.push("Nothing has changed yet.");
    if (checks === null) blockers.push("The pack's checks have not run on this draft yet.");
    else if (!checks.passed) {
      blockers.push(`The pack's checks failed${checks.summary ? `: ${checks.summary}` : "."}`);
    }
    return {
      pack: view,
      files,
      diff,
      diffTruncated: truncated,
      checks,
      blockers,
    } satisfies ZenCustomDraftReview;
  });

  const review = Effect.fn("ZenCustomPacks.review")(function* (input: CustomTarget) {
    return yield* reviewOf(yield* targetOf(input.companyId), input.workflowId);
  }, io("review the draft"));

  /** "Save my version": the reviewed draft replaces the copy in use (or the original). */
  const save = Effect.fn("ZenCustomPacks.save")(function* (input: CustomTarget) {
    const target = yield* targetOf(input.companyId);
    const id = input.workflowId;
    const checked = yield* reviewOf(target, id);
    if (checked.blockers.length > 0) return yield* fail("invalid", checked.blockers.join(" "));
    const draft = draftFolder(target, id);
    const marker = yield* markerOf(draft);
    if (!marker) return yield* fail("not-found", "There is no draft to save.");
    const active = activeFolder(target, id);
    yield* backup(target, id);
    yield* removeFolder(active);
    yield* writeMarker(draft, {
      ...marker,
      revision: marker.revision + 1,
      merge: null,
      declinedVersion: marker.merge ? null : marker.declinedVersion,
      updatedAt: yield* now,
    });
    yield* fs.remove(path.join(draft, MERGE_REPORT)).pipe(Effect.ignore);
    yield* fs.rename(draft, active);
    const view = yield* viewOf(target, id);
    if (!view) return yield* fail("io", "The copy was saved but did not load again.");
    return view;
  }, io("save the customized pack"));

  const discard = Effect.fn("ZenCustomPacks.discard")(function* (input: CustomTarget) {
    const target = yield* targetOf(input.companyId);
    const folder = draftFolder(target, input.workflowId);
    if (!(yield* markerOf(folder))) return yield* fail("not-found", "There is no draft.");
    yield* fs.remove(folder, { recursive: true });
    return {};
  }, io("discard the draft"));

  /** Puts an original back in the person's folder, as a plain installed pack. */
  const restoreOriginal = Effect.fn("ZenCustomPacks.restoreOriginal")(function* (
    id: string,
    files: FolderFiles,
    origin: Origin,
    version: string,
  ) {
    const folder = path.join(deps.userDir, id);
    yield* removeFolder(folder);
    yield* writeTree(folder, files);
    yield* writePackMarker(folder, origin, version);
  });

  /** "Back to the original": the copy is set aside (backup) and the original is used again. */
  const revert = Effect.fn("ZenCustomPacks.revert")(function* (input: CustomTarget) {
    const target = yield* targetOf(input.companyId);
    const id = input.workflowId;
    const active = activeFolder(target, id);
    const marker = yield* markerOf(active);
    if (!marker) return yield* fail("not-found", "This workflow has no customized copy.");
    const base = yield* readTree(path.join(active, BASE_DIR));
    yield* backup(target, id);
    yield* removeFolder(draftFolder(target, id));
    yield* fs.remove(active, { recursive: true });
    const restoreHere =
      marker.origin.kind === "pack" &&
      base.has("workflow.json") &&
      (target.scope === "user" || !(yield* exists(path.join(deps.userDir, id))));
    if (restoreHere) yield* restoreOriginal(id, base, marker.origin, marker.origin.version);
    return {};
  }, io("go back to the original"));

  /** Keep mine / Take new / Merge, when we ship a newer version of the original. */
  const resolveUpdate = Effect.fn("ZenCustomPacks.resolveUpdate")(function* (
    input: CustomTarget & {
      readonly choice: ZenCustomUpdateChoice;
      readonly locale?: string | undefined;
    },
  ) {
    const target = yield* targetOf(input.companyId);
    const id = input.workflowId;
    const active = activeFolder(target, id);
    const marker = yield* markerOf(active);
    if (!marker) return yield* fail("not-found", "This workflow has no customized copy.");
    const latest = updateOffered(marker, yield* deps.latestVersion(marker.origin));
    if (latest === null) return yield* fail("invalid", "There is no newer version to take.");
    if (input.choice === "keep") {
      yield* writeMarker(active, { ...marker, declinedVersion: latest, updatedAt: yield* now });
      return { choice: input.choice, thread: null } satisfies ZenResolveCustomUpdateResult;
    }
    const theirs = yield* deps.readLatestOriginal(marker.origin, readTree);
    if (!theirs.has("workflow.json")) {
      return yield* fail("unavailable", "The new version could not be read.");
    }
    if (input.choice === "take") {
      yield* backup(target, id);
      yield* removeFolder(draftFolder(target, id));
      yield* fs.remove(active, { recursive: true });
      const userIsPlain = !(yield* markerOf(path.join(deps.userDir, id)));
      if (marker.origin.kind === "pack" && (target.scope === "user" || userIsPlain)) {
        yield* restoreOriginal(id, theirs, marker.origin, latest);
      }
      return { choice: input.choice, thread: null } satisfies ZenResolveCustomUpdateResult;
    }
    // Merge: base -> ours -> theirs into a draft; the agent resolves what is left and checks.
    const base = yield* readTree(path.join(active, BASE_DIR));
    const ours = yield* readTree(active);
    const merged = mergeFolders(base.size > 0 ? base : theirs, ours, theirs);
    const draft = draftFolder(target, id);
    yield* removeFolder(draft);
    yield* writeTree(
      draft,
      merged.flatMap((file) => (file.bytes ? [[file.path, file.bytes] as const] : [])),
    );
    yield* writeTree(path.join(draft, BASE_DIR), theirs);
    const origin: Origin = { ...marker.origin, version: latest };
    yield* writePackMarker(draft, origin, latest);
    yield* writeMarker(draft, {
      ...marker,
      origin,
      merge: { from: marker.origin.version, to: latest },
      updatedAt: yield* now,
    });
    yield* fs.writeFileString(
      path.join(draft, MERGE_REPORT),
      prettyJson(
        merged
          .filter((file) => file.outcome !== "unchanged")
          .map((file) => ({ path: file.path, outcome: file.outcome, conflicts: file.conflicts })),
      ),
    );
    return {
      choice: input.choice,
      thread: yield* threadStart(target, id, { request: null, locale: input.locale }),
    } satisfies ZenResolveCustomUpdateResult;
  }, io("update the customized pack"));

  /** Moves the person's own copy to the company: everyone there uses it, the person included. */
  const share = Effect.fn("ZenCustomPacks.share")(function* (input: {
    readonly workflowId: string;
    readonly companyId: string;
  }) {
    const company = yield* targetOf(input.companyId);
    const id = input.workflowId;
    const source = activeFolder(mine, id);
    const marker = yield* markerOf(source);
    if (!marker) return yield* fail("not-found", "You have no customized copy of this workflow.");
    yield* backup(company, id);
    const destination = activeFolder(company, id);
    yield* removeFolder(destination);
    yield* fs.copy(source, destination, { overwrite: true });
    yield* writeMarker(destination, {
      ...marker,
      customId: customIdFor(id, "company"),
      scope: "company",
      companyId: input.companyId,
      updatedAt: yield* now,
    });
    // The person's folder goes back to the original; the company's copy wins over it.
    const base = yield* readTree(path.join(source, BASE_DIR));
    yield* backup(mine, id);
    yield* fs.remove(source, { recursive: true });
    if (marker.origin.kind === "pack" && base.has("workflow.json")) {
      yield* restoreOriginal(id, base, marker.origin, marker.origin.version);
    }
    const view = yield* viewOf(company, id);
    if (!view) return yield* fail("io", "The company copy did not load.");
    return view;
  }, io("share the customized pack"));

  /** Workflow ids in `dir` that are customized copies (an install must not overwrite them). */
  const customizedIn = Effect.fn("ZenCustomPacks.customizedIn")(function* (
    dir: string,
    ids: ReadonlyArray<string>,
  ) {
    const found = new Set<string>();
    for (const id of ids) {
      if (yield* markerOf(path.join(dir, id))) found.add(id);
    }
    return found as ReadonlySet<string>;
  });

  /** Keeps the person's customized copy aside before it is removed with its pack. */
  const backupUserCopy = (id: string) => backup(mine, id).pipe(Effect.ignore);

  return {
    list,
    customize,
    review,
    save,
    discard,
    revert,
    resolveUpdate,
    share,
    customizedIn,
    backupUserCopy,
  };
}

export type CustomPacks = ReturnType<typeof makeCustomPacks>;
