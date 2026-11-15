// Zen Staff: reading and writing workflow folders (workflow.json + prompt.md + optional SKILL.md
// and assets/). Parsing and merging are pure so tests cover them without a disk. See ZEN.md,
// "Office edition".
import {
  ZenRegistryIndex,
  ZenWorkflowManifest,
  validateWorkflow,
  type ZenMarketplace,
  type ZenMarketplaceSourceKind,
  type ZenRegistryEntry,
  type ZenWorkflow,
  type ZenWorkflowProblem,
  type ZenWorkflowSource,
} from "@t3tools/contracts/zenOffice";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { parseAccess } from "../toolchains/access.ts";
import { CUSTOM_MARKER_FILE, parseCustomMarker } from "./customPacks.ts";

const WORKFLOW_FILE = "workflow.json";
const PROMPT_FILE = "prompt.md";
const SKILL_FILE = "SKILL.md";
/**
 * In SKILL.md, replaced with the workflow folder's absolute path when it loads, so the guidance
 * can point the agent at reference files shipped next to it ("read
 * {{workflow_folder}}/references/checks.md"). The agent works in the person's folder, not here.
 */
const WORKFLOW_FOLDER_TOKEN = "{{workflow_folder}}";
/** Written into a user folder installed from the marketplace. */
const PACK_MARKER_FILE = ".zen-pack.json";

const decodeManifest = Schema.decodeUnknownResult(Schema.fromJsonString(ZenWorkflowManifest));
const decodeRegistry = Schema.decodeUnknownResult(Schema.fromJsonString(ZenRegistryIndex));
const PackMarker = Schema.Struct({ packId: Schema.String, version: Schema.String });
const decodePackMarker = Schema.decodeUnknownOption(Schema.fromJsonString(PackMarker));

export interface WorkflowFolderFiles {
  readonly folderName: string;
  readonly workflowJson: string | null;
  readonly prompt: string | null;
  readonly skill: string | null;
  readonly packMarker: string | null;
  /** `.zen-custom.json` of a customized copy (customPacks.ts). */
  readonly customMarker?: string | null;
}

export type ParsedWorkflow =
  | { readonly _tag: "ok"; readonly workflow: ZenWorkflow }
  | { readonly _tag: "problem"; readonly problem: ZenWorkflowProblem };

const problem = (location: string, message: string): ParsedWorkflow => ({
  _tag: "problem",
  problem: { location, message },
});

/** Turns a folder's files into a workflow, or a plain-language reason it cannot load. */
export function parseWorkflowFolder(
  files: WorkflowFolderFiles,
  source: ZenWorkflowSource,
): ParsedWorkflow {
  const location = files.folderName;
  if (files.workflowJson === null) return problem(location, `${WORKFLOW_FILE} is missing.`);
  if (files.prompt === null) return problem(location, `${PROMPT_FILE} is missing.`);
  const decoded = decodeManifest(files.workflowJson);
  if (Result.isFailure(decoded)) {
    return problem(location, `${WORKFLOW_FILE} is not valid: ${decoded.failure.message}`);
  }
  const manifest = decoded.success;
  const problems = validateWorkflow(manifest, files.prompt);
  // Zen toolchains: a pack whose access block is wrong (read-only with write scopes) fails.
  problems.push(...parseAccess(files.workflowJson).problems);
  if (manifest.id !== files.folderName) {
    problems.push(`The folder is "${files.folderName}" but the id is "${manifest.id}".`);
  }
  if (problems.length > 0) return problem(location, problems.join(" "));
  const marker = files.packMarker === null ? null : decodePackMarker(files.packMarker);
  const packId = marker && marker._tag === "Some" ? marker.value.packId : null;
  const customization = parseCustomMarker(files.customMarker ?? null);
  return {
    _tag: "ok",
    workflow: {
      manifest,
      prompt: files.prompt,
      skill: files.skill,
      source,
      packId,
      // Your own and your company's workflows are edited in the app; installed packs are not
      // (they are changed by prompt: "Personalizează", customPacks.ts).
      editable:
        (source === "user" || source === "company") && packId === null && customization === null,
      ...(customization ? { customization } : {}),
    },
  };
}

/** A customized copy outranks a plain one: the person's own copy, then the company's. */
const customRank = (workflow: ZenWorkflow) =>
  workflow.customization === undefined ? 0 : workflow.customization.scope === "user" ? 2 : 1;

/**
 * Merges sources in order; a later one replaces an earlier workflow with the same id
 * (built-in, then company, then user), except that a customized copy is never replaced by a
 * plain one (the company's copy of a pack wins over the original installed in the user folder).
 * Sorted by category, then name.
 */
export function mergeWorkflows(
  lists: ReadonlyArray<ReadonlyArray<ZenWorkflow>>,
): ReadonlyArray<ZenWorkflow> {
  const byId = new Map<string, ZenWorkflow>();
  for (const list of lists) {
    for (const workflow of list) {
      const current = byId.get(workflow.manifest.id);
      if (current && customRank(current) > customRank(workflow)) continue;
      byId.set(workflow.manifest.id, workflow);
    }
  }
  return [...byId.values()].toSorted(
    (left, right) =>
      left.manifest.category.localeCompare(right.manifest.category) ||
      left.manifest.name.localeCompare(right.manifest.name),
  );
}

export function parseRegistry(
  text: string,
): { readonly entries: ReadonlyArray<ZenRegistryEntry> } | { readonly error: string } {
  const decoded = decodeRegistry(text);
  if (Result.isFailure(decoded)) return { error: `The library index is not valid.` };
  return { entries: decoded.success.entries };
}

/** Marks each registry entry installed or not, from the workflows that loaded. */
export function marketplaceView(
  source: string,
  entries: ReadonlyArray<ZenRegistryEntry>,
  builtin: ReadonlyArray<ZenWorkflow>,
  user: ReadonlyArray<ZenWorkflow>,
  meta: {
    readonly sourceKind: ZenMarketplaceSourceKind;
    readonly notice: string | null;
  } = { sourceKind: "local", notice: null },
): ZenMarketplace {
  return {
    source,
    sourceKind: meta.sourceKind,
    notice: meta.notice,
    entries: entries.map((entry) => {
      if (entry.kind === "builtin") {
        const found = builtin.find((workflow) => workflow.manifest.id === entry.id);
        return {
          entry,
          installed: found !== undefined,
          installedVersion: found?.manifest.version ?? null,
        };
      }
      const installed = user.find((workflow) => workflowBelongsToPack(workflow, entry));
      return {
        entry,
        installed: installed !== undefined,
        installedVersion: installed?.manifest.version ?? null,
      };
    }),
  };
}

/** The workflow ids a registry entry installs: its `workflows`, or the entry itself. */
export function packWorkflowIds(entry: Pick<ZenRegistryEntry, "id" | "workflows">) {
  return entry.workflows && entry.workflows.length > 0 ? entry.workflows : [entry.id];
}

/**
 * Whether an installed workflow came from this pack. A workflow installed before its pack was
 * regrouped (its own id as pack id, now one of the pack's workflows) still counts, so the
 * marketplace shows the new pack as installed and uninstalling it removes the old copy too.
 */
export function workflowBelongsToPack(
  workflow: Pick<ZenWorkflow, "packId" | "manifest">,
  entry: Pick<ZenRegistryEntry, "id" | "workflows">,
): boolean {
  if (workflow.packId === null) return false;
  if (workflow.packId === entry.id) return true;
  return (
    (entry.workflows ?? []).includes(workflow.manifest.id) &&
    workflow.packId === workflow.manifest.id
  );
}

/** The registry entry whose sample a pack or one of its workflows shows, or null. */
export function sampleEntryFor<T extends Pick<ZenRegistryEntry, "id" | "workflows" | "sample">>(
  entries: ReadonlyArray<T>,
  id: string,
): T | null {
  return (
    entries.find((entry) => entry.sample && entry.id === id) ??
    entries.find((entry) => entry.sample && (entry.workflows ?? []).includes(id)) ??
    null
  );
}

const SAMPLE_MIME: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

/** The media type of a sample file, or null when it is not a supported video or audio file. */
export function sampleMimeType(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return SAMPLE_MIME[extension] ?? null;
}

/** SKILL.md with {{workflow_folder}} pointing at the folder it was read from. */
export function resolveSkillFolder(skill: string | null, folder: string): string | null {
  return skill === null ? null : skill.replaceAll(WORKFLOW_FOLDER_TOKEN, folder);
}

/** Pretty JSON for files people may open and edit by hand. */
function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const readOptional = (fs: FileSystem.FileSystem, path: string) =>
  fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));

/** Every workflow folder directly under `dir`. A missing dir is an empty list. */
export const loadWorkflowDir = Effect.fn("ZenWorkflows.loadDir")(function* (
  dir: string,
  source: ZenWorkflowSource,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workflows: ZenWorkflow[] = [];
  const problems: ZenWorkflowProblem[] = [];
  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
  for (const name of names.toSorted()) {
    if (name.startsWith(".")) continue;
    const folder = path.join(dir, name);
    const info = yield* fs.stat(folder).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "Directory") continue;
    const parsed = parseWorkflowFolder(
      {
        folderName: name,
        workflowJson: yield* readOptional(fs, path.join(folder, WORKFLOW_FILE)),
        prompt: yield* readOptional(fs, path.join(folder, PROMPT_FILE)),
        skill: resolveSkillFolder(yield* readOptional(fs, path.join(folder, SKILL_FILE)), folder),
        packMarker: yield* readOptional(fs, path.join(folder, PACK_MARKER_FILE)),
        customMarker: yield* readOptional(fs, path.join(folder, CUSTOM_MARKER_FILE)),
      },
      source,
    );
    if (parsed._tag === "ok") workflows.push(parsed.workflow);
    else problems.push({ ...parsed.problem, location: `${source}: ${parsed.problem.location}` });
  }
  return { workflows, problems };
});

/** Writes workflow.json and prompt.md into `<dir>/<id>/`, keeping any SKILL.md and assets. */
export const writeWorkflowFolder = Effect.fn("ZenWorkflows.writeFolder")(function* (
  dir: string,
  manifest: ZenWorkflowManifest,
  prompt: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(dir, manifest.id);
  yield* fs.makeDirectory(folder, { recursive: true });
  yield* fs.writeFileString(path.join(folder, WORKFLOW_FILE), prettyJson(manifest));
  yield* fs.writeFileString(
    path.join(folder, PROMPT_FILE),
    prompt.endsWith("\n") ? prompt : `${prompt}\n`,
  );
  return folder;
});

/**
 * Copies a pack into `dir` and marks each copy as installed from the marketplace. A one-workflow
 * pack folder becomes `<dir>/<entry id>/`; a pack with `workflows` has one sub-folder per
 * workflow, each copied to `<dir>/<workflow id>/`. Returns the folders written.
 */
export const installPackFolder = Effect.fn("ZenWorkflows.installPack")(function* (
  packFolder: string,
  dir: string,
  entry: Pick<ZenRegistryEntry, "id" | "version" | "workflows">,
  /** Workflow ids left as they are (customized copies, customPackStore.ts). */
  skip: ReadonlySet<string> = new Set(),
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(dir, { recursive: true });
  const multi = entry.workflows !== undefined && entry.workflows.length > 0;
  const targets: string[] = [];
  for (const id of packWorkflowIds(entry)) {
    if (skip.has(id)) continue;
    const target = path.join(dir, id);
    yield* fs.remove(target, { recursive: true }).pipe(Effect.ignore);
    yield* fs.copy(multi ? path.join(packFolder, id) : packFolder, target, { overwrite: true });
    yield* fs.writeFileString(
      path.join(target, PACK_MARKER_FILE),
      prettyJson({ packId: entry.id, version: entry.version }),
    );
    targets.push(target);
  }
  return targets;
});
