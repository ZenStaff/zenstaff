// Zen Staff: the Office edition. An install runs as "code" (the full developer app) or "office"
// (workflow cards for non-technical staff, developer surfaces hidden). Workflows are folders
// with workflow.json + prompt.md; this file holds their format, the template rules shared by the
// server and the web preview, and the RPCs. See ZEN.md, "Office edition".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";

export const ZEN_OFFICE_WS_METHODS = {
  settings: "zen.office.settings",
  setEdition: "zen.office.setEdition",
  listWorkflows: "zen.office.listWorkflows",
  saveWorkflow: "zen.office.saveWorkflow",
  deleteWorkflow: "zen.office.deleteWorkflow",
  registry: "zen.office.registry",
  installPack: "zen.office.installPack",
  uninstallPack: "zen.office.uninstallPack",
  setRegistryUrl: "zen.office.setRegistryUrl",
  draftWorkflow: "zen.office.draftWorkflow",
  uploadInputFile: "zen.office.uploadInputFile",
  sampleMedia: "zen.office.sampleMedia",
  customPacks: "zen.office.customPacks",
  customizePack: "zen.office.customizePack",
  customDraft: "zen.office.customDraft",
  saveCustomDraft: "zen.office.saveCustomDraft",
  discardCustomDraft: "zen.office.discardCustomDraft",
  revertCustomPack: "zen.office.revertCustomPack",
  resolveCustomUpdate: "zen.office.resolveCustomUpdate",
  shareCustomPack: "zen.office.shareCustomPack",
  /** Chat-first task start and hiring setup (zenIntake.ts): one RPC, `{ op, input }`. */
  intake: "zen.office.intake",
  /** Community library (Bibliotecă): publish, my submissions, report (communityLibrary.ts). */
  library: "zen.office.library",
} as const;

export const ZenEdition = Schema.Literals(["office", "code"]);
export type ZenEdition = typeof ZenEdition.Type;
/** Existing installs keep the developer app. */
export const ZEN_DEFAULT_EDITION: ZenEdition = "code";

export const ZEN_WORKFLOW_CATEGORIES = [
  "design",
  "pr",
  "video",
  "social",
  "sales",
  "reports",
  "admin",
] as const;
export const ZenWorkflowCategory = Schema.Literals(ZEN_WORKFLOW_CATEGORIES);
export type ZenWorkflowCategory = typeof ZenWorkflowCategory.Type;

export const ZEN_WORKFLOW_INPUT_TYPES = ["text", "longtext", "select", "file", "url"] as const;
export const ZenWorkflowInputType = Schema.Literals(ZEN_WORKFLOW_INPUT_TYPES);
export type ZenWorkflowInputType = typeof ZenWorkflowInputType.Type;

/** Workflow and input ids: lowercase letters, digits and dashes (inputs may use underscores). */
const ZEN_WORKFLOW_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const ZEN_WORKFLOW_INPUT_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const ZenWorkflowInput = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  type: ZenWorkflowInputType,
  required: Schema.Boolean,
  options: Schema.optional(Schema.Array(Schema.String)),
  placeholder: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
});
export type ZenWorkflowInput = typeof ZenWorkflowInput.Type;

/** One input in another language; any field left out keeps the source text. */
export const ZenWorkflowInputTranslation = Schema.Struct({
  label: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
  /** Same length and order as the input's options; the translated text is what gets sent. */
  options: Schema.optional(Schema.Array(Schema.String)),
});
export type ZenWorkflowInputTranslation = typeof ZenWorkflowInputTranslation.Type;

/** A workflow's visible text in another language (key of `i18n`: a language code like "ro"). */
export const ZenWorkflowTranslation = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  /** By input id. */
  inputs: Schema.optional(Schema.Record(Schema.String, ZenWorkflowInputTranslation)),
});
export type ZenWorkflowTranslation = typeof ZenWorkflowTranslation.Type;

/** The content of workflow.json. */
export const ZenWorkflowManifest = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  category: ZenWorkflowCategory,
  /** A lucide icon name, such as "megaphone" or "file-text". */
  icon: Schema.String,
  inputs: Schema.Array(ZenWorkflowInput),
  /** What the person gets back, shown on the form ("A press release as press-release.md"). */
  output: Schema.String,
  version: Schema.String,
  author: Schema.String,
  /** Translations of the visible text, by language code. The prompt itself stays as written. */
  i18n: Schema.optional(Schema.Record(Schema.String, ZenWorkflowTranslation)),
  /**
   * The model this workflow runs with, such as "claude-haiku-5-5" or an alias ("haiku",
   * "sonnet", "opus"). Left out, the folder's default model is used.
   */
  model: Schema.optional(Schema.String),
});
export type ZenWorkflowManifest = typeof ZenWorkflowManifest.Type;

export const ZenWorkflowSource = Schema.Literals(["builtin", "user", "company"]);
export type ZenWorkflowSource = typeof ZenWorkflowSource.Type;

/**
 * A company-owned (or personal) copy of a shipped pack or built-in, changed by prompt. It keeps
 * the workflow id, so it is used instead of the original everywhere (Office home, scheduled
 * runs); `origin` is what it was made from, for updates and "back to the original". ZEN.md,
 * "Customized packs".
 */
export const ZenCustomScope = Schema.Literals(["user", "company"]);
export type ZenCustomScope = typeof ZenCustomScope.Type;
export const ZenWorkflowCustomization = Schema.Struct({
  /** `<workflow id>@firma` for the company's copy, `<workflow id>@personal` for one person's. */
  customId: Schema.String,
  scope: ZenCustomScope,
  companyId: Schema.NullOr(Schema.String),
  origin: Schema.Struct({
    /** The marketplace pack (registry entry id), or the workflow id for a built-in. */
    packId: Schema.String,
    workflowId: Schema.String,
    /** The version of the original the copy is based on (the merge base). */
    version: Schema.String,
    kind: Schema.Literals(["pack", "builtin"]),
  }),
  /** Saved changes so far (1 after the first save). */
  revision: Schema.Number,
  /** The last change asked for, in the person's words. */
  request: Schema.NullOr(Schema.String),
  /** A newer original the person chose to ignore ("Keep mine"); not offered again. */
  declinedVersion: Schema.NullOr(Schema.String),
  /** Set on a draft that merges a new version of the original into the copy. */
  merge: Schema.optional(Schema.NullOr(Schema.Struct({ from: Schema.String, to: Schema.String }))),
  updatedAt: Schema.String,
});
export type ZenWorkflowCustomization = typeof ZenWorkflowCustomization.Type;

export const ZenWorkflow = Schema.Struct({
  manifest: ZenWorkflowManifest,
  /** prompt.md, a template with {{input_id}} placeholders. */
  prompt: Schema.String,
  /** SKILL.md when the folder has one; added to the message as guidance. */
  skill: Schema.NullOr(Schema.String),
  source: ZenWorkflowSource,
  /** Marketplace pack id when the folder was installed from the marketplace. */
  packId: Schema.NullOr(Schema.String),
  editable: Schema.Boolean,
  /** Set when this is a customized copy of a pack or built-in (used instead of the original). */
  customization: Schema.optional(ZenWorkflowCustomization),
});
export type ZenWorkflow = typeof ZenWorkflow.Type;

export const ZenWorkflowProblem = Schema.Struct({
  /** Folder name or path of the workflow that did not load. */
  location: Schema.String,
  message: Schema.String,
});
export type ZenWorkflowProblem = typeof ZenWorkflowProblem.Type;

export const ZenOfficeSettings = Schema.Struct({
  edition: ZenEdition,
  /** `<zen home>/workflows`, where custom and installed workflows are saved. */
  userWorkflowsDir: Schema.String,
  /**
   * The marketplace index URL in use (the saved setting, else `ZEN_REGISTRY_URL`); null means
   * only the registry bundled with the app.
   */
  registryUrl: Schema.NullOr(Schema.String),
});
export type ZenOfficeSettings = typeof ZenOfficeSettings.Type;

/** `companyId` is a seam for company workflows; servers without companies ignore it. */
export const ZenListWorkflowsInput = Schema.Struct({
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenListWorkflowsInput = typeof ZenListWorkflowsInput.Type;

export const ZenWorkflowList = Schema.Struct({
  workflows: Schema.Array(ZenWorkflow),
  problems: Schema.Array(ZenWorkflowProblem),
});
export type ZenWorkflowList = typeof ZenWorkflowList.Type;

export const ZenSaveWorkflowInput = Schema.Struct({
  manifest: ZenWorkflowManifest,
  prompt: Schema.String,
  /** Set when an existing user workflow is renamed to a new id. */
  previousId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Saves into this company's workflows folder instead of the person's own. */
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenSaveWorkflowInput = typeof ZenSaveWorkflowInput.Type;

export const ZenWorkflowIdInput = Schema.Struct({ id: Schema.String });
export type ZenWorkflowIdInput = typeof ZenWorkflowIdInput.Type;

/** Deletes one of the person's own workflows, or a company's when `companyId` is set. */
export const ZenDeleteWorkflowInput = Schema.Struct({
  id: Schema.String,
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenDeleteWorkflowInput = typeof ZenDeleteWorkflowInput.Type;

/** "Save this as a workflow": a finished thread becomes a draft for the editor. */
export const ZenDraftWorkflowInput = Schema.Struct({
  threadId: Schema.String,
  /** The person's language; the visible text of the draft is written in it. */
  locale: Schema.String,
});
export type ZenDraftWorkflowInput = typeof ZenDraftWorkflowInput.Type;

export const ZenWorkflowDraft = Schema.Struct({
  manifest: ZenWorkflowManifest,
  prompt: Schema.String,
  /** ai = written by the model from the conversation; basic = built from the first message. */
  method: Schema.Literals(["ai", "basic"]),
});
export type ZenWorkflowDraft = typeof ZenWorkflowDraft.Type;

/** A file chosen for a `file` input, copied into the work folder before the task starts. */
export const ZenUploadInputFileInput = Schema.Struct({
  /** The work folder (the project the task runs in). */
  cwd: Schema.String,
  fileName: Schema.String,
  /** The file's bytes, base64. */
  dataBase64: Schema.String,
});
export type ZenUploadInputFileInput = typeof ZenUploadInputFileInput.Type;

export const ZenUploadedInputFile = Schema.Struct({
  /** Relative to the work folder, such as "inputs/brief.pdf"; this is the input's answer. */
  relativePath: Schema.String,
  absolutePath: Schema.String,
  bytes: Schema.Number,
});
export type ZenUploadedInputFile = typeof ZenUploadedInputFile.Type;

/** A pack's (or a workflow's pack's) sample, ready to play: `url` is https or a data URL. */
export const ZenSampleMediaInput = Schema.Struct({ id: Schema.String });
export type ZenSampleMediaInput = typeof ZenSampleMediaInput.Type;
export const ZenSampleMedia = Schema.NullOr(
  Schema.Struct({
    kind: Schema.Literals(["video", "audio"]),
    url: Schema.String,
    caption: Schema.NullOr(Schema.String),
    i18n: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ caption: Schema.String }))),
  }),
);
export type ZenSampleMedia = typeof ZenSampleMedia.Type;

/** The largest file a `file` input accepts (the bytes travel over the app's connection). */
export const ZEN_INPUT_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const ZenRegistryEntryKind = Schema.Literals(["builtin", "pack", "coming_soon"]);
export type ZenRegistryEntryKind = typeof ZenRegistryEntryKind.Type;

/** A pack archive on a remote registry. Checked against `sha256` before anything is extracted. */
export const ZenRegistryDownload = Schema.Struct({
  url: Schema.String,
  /** Hex SHA-256 of the archive file. */
  sha256: Schema.String,
  format: Schema.optional(Schema.Literals(["tar.gz", "zip"])),
  size: Schema.optional(Schema.Number),
});
export type ZenRegistryDownload = typeof ZenRegistryDownload.Type;

/**
 * A showcase sample on a pack: a short video or audio WE produced (with a professional voice), shown
 * on the marketplace card and the workflow form. `src` is an https URL or a path relative to the
 * registry file; a missing file shows nothing.
 */
export const ZenRegistrySample = Schema.Struct({
  src: Schema.String,
  kind: Schema.Literals(["video", "audio"]),
  caption: Schema.optional(Schema.String),
  /** Captions in other languages, by language code. */
  i18n: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ caption: Schema.String }))),
});
export type ZenRegistrySample = typeof ZenRegistrySample.Type;

/**
 * Credit for a community pack from the hub's library (`/v1/library/catalog`): who made it, how many
 * installed it, the "Verificat de Zen" badge. Community packs are free, never Enterprise, never
 * carry secrets. ZEN.md, "Community library".
 */
export const ZenCommunityInfo = Schema.Struct({
  slug: Schema.String,
  origin: Schema.Literal("community"),
  verified: Schema.Boolean,
  featured: Schema.Boolean,
  installs: Schema.Number,
  licence: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
  changelog: Schema.optional(Schema.String),
  sampleOutput: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** Public page https://<hub>/p/<slug>, for "Trimite unui coleg". */
  shareUrl: Schema.optional(Schema.String),
  /** Images of the result (absolute URLs once the app merged the catalog). */
  screenshots: Schema.optional(Schema.Array(Schema.String)),
  author: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        slug: Schema.String,
        name: Schema.String,
        company: Schema.optional(Schema.NullOr(Schema.String)),
        url: Schema.optional(Schema.String),
      }),
    ),
  ),
});
export type ZenCommunityInfo = typeof ZenCommunityInfo.Type;

/** One entry of the marketplace index (registry.json). */
export const ZenRegistryEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  category: ZenWorkflowCategory,
  icon: Schema.String,
  version: Schema.String,
  author: Schema.String,
  kind: ZenRegistryEntryKind,
  tags: Schema.optional(Schema.Array(Schema.String)),
  /** For packs: the folder, relative to the registry file. */
  path: Schema.optional(Schema.String),
  /** For packs on a remote registry: the archive to download (url may be relative to the index). */
  download: Schema.optional(ZenRegistryDownload),
  /**
   * A pack of several workflows: their ids, each a sub-folder of the pack folder (or archive).
   * Left out, the pack folder is itself one workflow whose id is the entry id.
   */
  workflows: Schema.optional(Schema.Array(Schema.String)),
  /** A showcase sample made with a professional voice; packs without one show nothing. */
  sample: Schema.optional(ZenRegistrySample),
  /** Name and description in other languages, by language code. */
  i18n: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
      }),
    ),
  ),
  /** Set on packs from the community library (the hub); absent on Zen Staff's own. */
  community: Schema.optional(ZenCommunityInfo),
});
export type ZenRegistryEntry = typeof ZenRegistryEntry.Type;

export const ZenRegistryIndex = Schema.Struct({
  version: Schema.Number,
  entries: Schema.Array(ZenRegistryEntry),
});
export type ZenRegistryIndex = typeof ZenRegistryIndex.Type;

/** One customized copy (or a copy being changed), for the marketplace and the review dialog. */
export const ZenCustomPackView = Schema.Struct({
  workflowId: Schema.String,
  name: Schema.String,
  customId: Schema.String,
  scope: ZenCustomScope,
  companyId: Schema.NullOr(Schema.String),
  /** "active" = saved and used instead of the original; "draft" = being changed, not used yet. */
  status: Schema.Literals(["active", "draft"]),
  /** A saved copy exists (also while a draft is open). */
  hasActive: Schema.Boolean,
  hasDraft: Schema.Boolean,
  origin: ZenWorkflowCustomization.fields.origin,
  /** The newest version of the original we ship, when newer than the base and not declined. */
  updateAvailable: Schema.NullOr(Schema.String),
  /** The open draft's folder (the customization thread works there). */
  draftFolder: Schema.NullOr(Schema.String),
  /** The draft is a 3-way merge of a new version (from -> to). */
  merge: Schema.NullOr(Schema.Struct({ from: Schema.String, to: Schema.String })),
  revision: Schema.Number,
  request: Schema.NullOr(Schema.String),
});
export type ZenCustomPackView = typeof ZenCustomPackView.Type;

export const ZenMarketplaceEntry = Schema.Struct({
  entry: ZenRegistryEntry,
  /** Built-ins are always installed; packs when their folder is in the user dir. */
  installed: Schema.Boolean,
  installedVersion: Schema.NullOr(Schema.String),
  /** A community pack installed here that the library took down: the reason, shown as a warning. */
  withdrawn: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenMarketplaceEntry = typeof ZenMarketplaceEntry.Type;

export const ZenMarketplaceSourceKind = Schema.Literals(["local", "remote", "cache"]);
export type ZenMarketplaceSourceKind = typeof ZenMarketplaceSourceKind.Type;

export const ZenMarketplace = Schema.Struct({
  /** Where the index came from: the bundled file path or the remote URL. */
  source: Schema.String,
  /** local = bundled index only; remote = fetched just now; cache = the last saved remote copy. */
  sourceKind: ZenMarketplaceSourceKind,
  /** A plain-language warning to show, e.g. the remote could not be reached. */
  notice: Schema.NullOr(Schema.String),
  entries: Schema.Array(ZenMarketplaceEntry),
  /** The community library on the hub: where it came from and whether it answered. */
  community: Schema.optional(
    Schema.Struct({
      source: Schema.NullOr(Schema.String),
      available: Schema.Boolean,
      notice: Schema.NullOr(Schema.String),
    }),
  ),
});
export type ZenMarketplace = typeof ZenMarketplace.Type;

export const ZenCustomPacksInput = Schema.Struct({
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenCustomPacksInput = typeof ZenCustomPacksInput.Type;

/** Which copy an action targets: the company's when `companyId` is set, else the person's own. */
export const ZenCustomTargetInput = Schema.Struct({
  workflowId: Schema.String,
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenCustomTargetInput = typeof ZenCustomTargetInput.Type;

export const ZenCustomizePackInput = Schema.Struct({
  workflowId: Schema.String,
  /** The company's copy when set (shared with everyone in it), else the person's own. */
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
  /** What the person wants changed, in their words (may be empty: the thread asks). */
  request: Schema.optional(Schema.String),
  /** The app's language; the thread answers in it. */
  locale: Schema.optional(Schema.String),
});
export type ZenCustomizePackInput = typeof ZenCustomizePackInput.Type;

/** What the web needs to open the customization (or merge) thread on the draft folder. */
export const ZenCustomThreadStart = Schema.Struct({
  pack: ZenCustomPackView,
  draftFolder: Schema.String,
  title: Schema.String,
  /** The first message of the thread (instructions for the agent). */
  message: Schema.String,
});
export type ZenCustomThreadStart = typeof ZenCustomThreadStart.Type;

export const ZenCustomDraftFile = Schema.Struct({
  path: Schema.String,
  change: Schema.Literals(["added", "removed", "changed", "conflict"]),
});
export type ZenCustomDraftFile = typeof ZenCustomDraftFile.Type;

/** The review of a draft before it is saved: the diff and whatever still blocks saving. */
export const ZenCustomDraftReview = Schema.Struct({
  pack: ZenCustomPackView,
  files: Schema.Array(ZenCustomDraftFile),
  /** Unified diff from the copy in use (or the original) to the draft. */
  diff: Schema.String,
  diffTruncated: Schema.Boolean,
  /** What the agent recorded after running the pack's checks, or null when it did not. */
  checks: Schema.NullOr(
    Schema.Struct({
      passed: Schema.Boolean,
      summary: Schema.String,
      commands: Schema.Array(Schema.String),
    }),
  ),
  /** Plain reasons the draft cannot be saved yet (empty = ready). */
  blockers: Schema.Array(Schema.String),
});
export type ZenCustomDraftReview = typeof ZenCustomDraftReview.Type;

export const ZenCustomUpdateChoice = Schema.Literals(["keep", "take", "merge"]);
export type ZenCustomUpdateChoice = typeof ZenCustomUpdateChoice.Type;
export const ZenResolveCustomUpdateInput = Schema.Struct({
  workflowId: Schema.String,
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
  choice: ZenCustomUpdateChoice,
  locale: Schema.optional(Schema.String),
});
export type ZenResolveCustomUpdateInput = typeof ZenResolveCustomUpdateInput.Type;

export const ZenResolveCustomUpdateResult = Schema.Struct({
  choice: ZenCustomUpdateChoice,
  /** For "merge": the thread to open on the merged draft. */
  thread: Schema.NullOr(ZenCustomThreadStart),
});
export type ZenResolveCustomUpdateResult = typeof ZenResolveCustomUpdateResult.Type;

/** Moves a person's customized copy to the company, so everyone in it uses the same one. */
export const ZenShareCustomPackInput = Schema.Struct({
  workflowId: Schema.String,
  companyId: Schema.String,
});
export type ZenShareCustomPackInput = typeof ZenShareCustomPackInput.Type;

export class ZenOfficeError extends Schema.TaggedError<ZenOfficeError>()("ZenOfficeError", {
  reason: Schema.Literals(["invalid", "not-found", "conflict", "unavailable", "io"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const errors = Schema.Union([ZenOfficeError, EnvironmentAuthorizationError]);

export const ZenOfficeSettingsRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.settings, {
  payload: Schema.Struct({}),
  success: ZenOfficeSettings,
  error: errors,
});
export const ZenOfficeSetEditionRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.setEdition, {
  payload: Schema.Struct({ edition: ZenEdition }),
  success: ZenOfficeSettings,
  error: errors,
});
export const ZenOfficeListWorkflowsRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.listWorkflows, {
  payload: ZenListWorkflowsInput,
  success: ZenWorkflowList,
  error: errors,
});
export const ZenOfficeSaveWorkflowRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.saveWorkflow, {
  payload: ZenSaveWorkflowInput,
  success: ZenWorkflow,
  error: errors,
});
export const ZenOfficeDeleteWorkflowRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.deleteWorkflow, {
  payload: ZenDeleteWorkflowInput,
  success: Schema.Struct({}),
  error: errors,
});
export const ZenOfficeRegistryRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.registry, {
  payload: Schema.Struct({}),
  success: ZenMarketplace,
  error: errors,
});
/**
 * Installs a marketplace pack. `companyId` (local company) scopes an Enterprise pack's install
 * approval to that company's hub company on a server that serves several.
 */
export const ZenInstallPackInput = Schema.Struct({
  id: Schema.String,
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenInstallPackInput = typeof ZenInstallPackInput.Type;
export const ZenOfficeInstallPackRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.installPack, {
  payload: ZenInstallPackInput,
  success: ZenMarketplace,
  error: errors,
});
export const ZenOfficeUninstallPackRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.uninstallPack, {
  payload: ZenWorkflowIdInput,
  success: ZenMarketplace,
  error: errors,
});

export const ZenSetRegistryUrlInput = Schema.Struct({ url: Schema.NullOr(Schema.String) });
export type ZenSetRegistryUrlInput = typeof ZenSetRegistryUrlInput.Type;
export const ZenOfficeSetRegistryUrlRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.setRegistryUrl, {
  payload: ZenSetRegistryUrlInput,
  success: ZenOfficeSettings,
  error: errors,
});

const ZenOfficeDraftWorkflowRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.draftWorkflow, {
  payload: ZenDraftWorkflowInput,
  success: ZenWorkflowDraft,
  error: errors,
});
const ZenOfficeUploadInputFileRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.uploadInputFile, {
  payload: ZenUploadInputFileInput,
  success: ZenUploadedInputFile,
  error: errors,
});
const ZenOfficeSampleMediaRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.sampleMedia, {
  payload: ZenSampleMediaInput,
  success: ZenSampleMedia,
  error: errors,
});
const ZenOfficeCustomPacksRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.customPacks, {
  payload: ZenCustomPacksInput,
  success: Schema.Array(ZenCustomPackView),
  error: errors,
});
const ZenOfficeCustomizePackRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.customizePack, {
  payload: ZenCustomizePackInput,
  success: ZenCustomThreadStart,
  error: errors,
});
const ZenOfficeCustomDraftRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.customDraft, {
  payload: ZenCustomTargetInput,
  success: ZenCustomDraftReview,
  error: errors,
});
const ZenOfficeSaveCustomDraftRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.saveCustomDraft, {
  payload: ZenCustomTargetInput,
  success: ZenCustomPackView,
  error: errors,
});
const ZenOfficeDiscardCustomDraftRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.discardCustomDraft, {
  payload: ZenCustomTargetInput,
  success: Schema.Struct({}),
  error: errors,
});
const ZenOfficeRevertCustomPackRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.revertCustomPack, {
  payload: ZenCustomTargetInput,
  success: Schema.Struct({}),
  error: errors,
});
const ZenOfficeResolveCustomUpdateRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.resolveCustomUpdate, {
  payload: ZenResolveCustomUpdateInput,
  success: ZenResolveCustomUpdateResult,
  error: errors,
});
const ZenOfficeShareCustomPackRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.shareCustomPack, {
  payload: ZenShareCustomPackInput,
  success: ZenCustomPackView,
  error: errors,
});
/** Chat-first task start (`zenIntake.ts`): the server checks each op's input itself. */
export const ZenIntakeCallInput = Schema.Struct({
  op: Schema.Literals([
    "workflow.start",
    "hire.start",
    "hire.folder",
    "state",
    "chips.clear",
    "schedule.result",
    "hire.approved",
  ]),
  input: Schema.Unknown,
});
export type ZenIntakeCallInput = typeof ZenIntakeCallInput.Type;
const ZenOfficeIntakeRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.intake, {
  payload: ZenIntakeCallInput,
  success: Schema.Unknown,
  error: errors,
});
/** Community library calls: `{ op, input }` (communityLibrary.ts on the server). */
export const ZenLibraryCallInput = Schema.Struct({
  op: Schema.Literals(["sources", "mine", "publish", "report"]),
  input: Schema.Unknown,
});
export type ZenLibraryCallInput = typeof ZenLibraryCallInput.Type;
const ZenOfficeLibraryRpc = Rpc.make(ZEN_OFFICE_WS_METHODS.library, {
  payload: ZenLibraryCallInput,
  success: Schema.Unknown,
  error: errors,
});
/** RPCs added after the first nine; rpc.ts spreads this list into WsRpcGroup. */
export const ZEN_OFFICE_EXTRA_RPCS = [
  ZenOfficeDraftWorkflowRpc,
  ZenOfficeUploadInputFileRpc,
  ZenOfficeSampleMediaRpc,
  ZenOfficeCustomPacksRpc,
  ZenOfficeCustomizePackRpc,
  ZenOfficeCustomDraftRpc,
  ZenOfficeSaveCustomDraftRpc,
  ZenOfficeDiscardCustomDraftRpc,
  ZenOfficeRevertCustomPackRpc,
  ZenOfficeResolveCustomUpdateRpc,
  ZenOfficeShareCustomPackRpc,
  ZenOfficeIntakeRpc,
  ZenOfficeLibraryRpc,
] as const;

export const ZEN_OFFICE_RPC_SCOPES = {
  [ZEN_OFFICE_WS_METHODS.settings]: AuthOrchestrationReadScope,
  [ZEN_OFFICE_WS_METHODS.setEdition]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.listWorkflows]: AuthOrchestrationReadScope,
  [ZEN_OFFICE_WS_METHODS.saveWorkflow]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.deleteWorkflow]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.registry]: AuthOrchestrationReadScope,
  [ZEN_OFFICE_WS_METHODS.installPack]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.uninstallPack]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.setRegistryUrl]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.draftWorkflow]: AuthOrchestrationReadScope,
  [ZEN_OFFICE_WS_METHODS.uploadInputFile]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.sampleMedia]: AuthOrchestrationReadScope,
  [ZEN_OFFICE_WS_METHODS.customPacks]: AuthOrchestrationReadScope,
  [ZEN_OFFICE_WS_METHODS.customizePack]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.customDraft]: AuthOrchestrationReadScope,
  [ZEN_OFFICE_WS_METHODS.saveCustomDraft]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.discardCustomDraft]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.revertCustomPack]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.resolveCustomUpdate]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.shareCustomPack]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.intake]: AuthOrchestrationOperateScope,
  [ZEN_OFFICE_WS_METHODS.library]: AuthOrchestrationOperateScope,
} as const;

/** Every Office RPC under the "zen" span aggregate (RpcInstrumentation names every method). */
export const ZEN_OFFICE_RPC_AGGREGATES = Object.fromEntries(
  Object.values(ZEN_OFFICE_WS_METHODS).map((method) => [method, "zen"]),
) as { readonly [K in (typeof ZEN_OFFICE_WS_METHODS)[keyof typeof ZEN_OFFICE_WS_METHODS]]: "zen" };

// Template rules (pure; the server renders nothing, but both sides validate and the web renders).
//
//   {{id}}             the input's value
//   {{#id}}...{{/id}}  kept only when the input has a value
//   {{^id}}...{{/id}}  kept only when the input is empty

const PLACEHOLDER = /\{\{\s*([#^/]?)\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Every input id the template refers to, in first-use order. */
export function templatePlaceholders(template: string): ReadonlyArray<string> {
  const seen: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const id = match[2]!;
    if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}

/** Problems in a template's sections: unclosed, stray or crossed `{{#x}}`/`{{/x}}` tags. */
export function templateSectionProblems(template: string): ReadonlyArray<string> {
  const problems: string[] = [];
  const open: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const [, sigil, id] = match;
    if (sigil === "#" || sigil === "^") open.push(id!);
    else if (sigil === "/") {
      const last = open.pop();
      if (last === undefined) problems.push(`"{{/${id}}}" closes a section that was never opened.`);
      else if (last !== id) problems.push(`"{{/${id}}}" closes "${last}", which is still open.`);
    }
  }
  for (const id of open) problems.push(`"{{#${id}}}" is never closed with "{{/${id}}}".`);
  return problems;
}

const hasValue = (value: string | undefined) => value !== undefined && value.trim().length > 0;

/** Fills the template. Missing values render as "(not given)"; sections follow the rules above. */
export function renderWorkflowTemplate(
  template: string,
  values: Readonly<Record<string, string | undefined>>,
): string {
  let text = template;
  // Innermost sections first, so nested ones resolve; bounded to stop on malformed input.
  const section =
    /\{\{\s*([#^])\s*([a-z][a-z0-9_]*)\s*\}\}((?:(?!\{\{\s*[#^])[\s\S])*?)\{\{\s*\/\s*\2\s*\}\}/;
  for (let guard = 0; guard < 200; guard++) {
    const match = section.exec(text);
    if (!match) break;
    const [whole, sigil, id, body] = match;
    const keep = sigil === "#" ? hasValue(values[id!]) : !hasValue(values[id!]);
    text =
      text.slice(0, match.index) + (keep ? body! : "") + text.slice(match.index + whole.length);
  }
  text = text.replace(PLACEHOLDER, (whole, sigil: string, id: string) => {
    if (sigil) return "";
    const value = values[id];
    return hasValue(value) ? value!.trim() : "(not given)";
  });
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

const LANGUAGE_LINE_START = "Language: the person using this works in ";
const GUIDANCE_START = "\n---\nGuidance for this task:";

/** English names of the languages the app speaks, for the instruction sent to the agent. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: "English", ro: "Romanian" };

/**
 * The line that makes the agent answer in the person's language. Prompts stay English inside;
 * the answer and the documents follow the app's language unless the form names another one.
 */
function workflowLanguageInstruction(locale: string): string {
  const language = LANGUAGE_NAMES[locale] ?? locale;
  return `${LANGUAGE_LINE_START}${language}. Always answer them in ${language}, in plain words, and write the documents in ${language} too, unless the answers above ask for another language for the documents.`;
}

/**
 * The message a workflow sends: the filled template, the language line when `locale` is given,
 * then SKILL.md as guidance when present.
 */
export function buildWorkflowMessage(
  workflow: Pick<ZenWorkflow, "prompt" | "skill">,
  values: Readonly<Record<string, string | undefined>>,
  options: {
    readonly locale?: string;
    /**
     * Shown first, so the chat bubble opens with the person's own words: the workflow name and
     * the answers as they saw them (in their language). The English instructions follow.
     */
    readonly summary?: {
      readonly title: string;
      readonly answers: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    };
  } = {},
): string {
  const instructions = renderWorkflowTemplate(workflow.prompt, values);
  const answered = options.summary?.answers.filter((answer) => answer.value.trim()) ?? [];
  const rendered = options.summary
    ? [
        options.summary.title,
        "",
        ...answered.map((answer) =>
          /[?:]$/.test(answer.label.trim())
            ? `${answer.label.trim()} ${answer.value.trim()}`
            : `${answer.label.trim()}: ${answer.value.trim()}`,
        ),
        "",
        "---",
        "",
        instructions,
      ].join("\n")
    : instructions;
  const body = options.locale
    ? `${rendered}\n\n${workflowLanguageInstruction(options.locale)}`
    : rendered;
  const skill = workflow.skill?.trim();
  return skill ? `${body}\n\n---\nGuidance for this task:\n\n${skill}` : body;
}

/**
 * A workflow's first message split into what the person wrote (the name and their answers) and
 * the instructions for the agent, or null when `text` is not a workflow message. Recognised by
 * the summary separator followed by the language line or the guidance block that
 * `buildWorkflowMessage` always adds, so threads started before this helper existed split too.
 */
export function splitWorkflowMessage(
  text: string,
): { readonly summary: string; readonly instructions: string } | null {
  const separator = text.indexOf("\n\n---\n\n");
  if (separator <= 0) return null;
  const rest = text.slice(separator);
  if (!rest.includes(`\n${LANGUAGE_LINE_START}`) && !rest.includes(GUIDANCE_START)) return null;
  const summary = text.slice(0, separator).trim();
  if (summary.length === 0 || summary.length > 8_000) return null;
  return { summary, instructions: text.slice(separator + 7).trim() };
}

/** The manifest with its visible text in `locale`, falling back to the source text. */
export function localizeWorkflowManifest(
  manifest: ZenWorkflowManifest,
  locale: string,
): ZenWorkflowManifest {
  const translation = manifest.i18n?.[locale];
  if (!translation) return manifest;
  const pick = (value: string | undefined, fallback: string) =>
    value !== undefined && value.trim().length > 0 ? value : fallback;
  return {
    ...manifest,
    name: pick(translation.name, manifest.name),
    description: pick(translation.description, manifest.description),
    output: pick(translation.output, manifest.output),
    inputs: manifest.inputs.map((input) => {
      const t = translation.inputs?.[input.id];
      if (!t) return input;
      const options =
        input.options && t.options && t.options.length === input.options.length
          ? t.options.map((option, index) => pick(option, input.options![index]!))
          : input.options;
      const placeholder = t.placeholder ?? input.placeholder;
      const help = t.help ?? input.help;
      return {
        ...input,
        label: pick(t.label, input.label),
        ...(options ? { options } : {}),
        ...(placeholder !== undefined ? { placeholder } : {}),
        ...(help !== undefined ? { help } : {}),
      };
    }),
  };
}

/** A marketplace entry's name and description in `locale`, falling back to the source text. */
export function localizeRegistryEntry<
  T extends Pick<ZenRegistryEntry, "name" | "description" | "i18n">,
>(entry: T, locale: string): T {
  const translation = entry.i18n?.[locale];
  if (!translation) return entry;
  return {
    ...entry,
    name: translation.name?.trim() ? translation.name : entry.name,
    description: translation.description?.trim() ? translation.description : entry.description,
  };
}

/** The required inputs that have no value. */
export function missingRequiredInputs(
  manifest: Pick<ZenWorkflowManifest, "inputs">,
  values: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<ZenWorkflowInput> {
  return manifest.inputs.filter((input) => input.required && !hasValue(values[input.id]));
}

/** Checks a workflow beyond its schema. Returns plain-language problems; empty means valid. */
export function validateWorkflow(manifest: ZenWorkflowManifest, prompt: string): string[] {
  const problems: string[] = [];
  if (!ZEN_WORKFLOW_ID_PATTERN.test(manifest.id)) {
    problems.push("The id uses 2 to 64 lowercase letters, digits or dashes.");
  }
  if (manifest.name.trim().length === 0) problems.push("Give the workflow a name.");
  if (manifest.name.length > 80) problems.push("Keep the name under 80 characters.");
  if (manifest.description.length > 400)
    problems.push("Keep the description under 400 characters.");
  if (!/^[a-z0-9-]{1,40}$/.test(manifest.icon)) problems.push("The icon is a lucide icon name.");
  if (manifest.version.trim().length === 0) problems.push("Set a version, such as 1.0.0.");
  if (manifest.inputs.length > 20) problems.push("Use at most 20 inputs.");
  if (manifest.model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(manifest.model)) {
    problems.push("The model is a model name such as claude-haiku-5-5, or haiku, sonnet or opus.");
  }
  const ids = new Set<string>();
  for (const input of manifest.inputs) {
    const name = input.label.trim() || input.id;
    if (!ZEN_WORKFLOW_INPUT_ID_PATTERN.test(input.id)) {
      problems.push(`Input "${name}": the id starts with a letter and uses a-z, 0-9 or _.`);
    }
    if (ids.has(input.id)) problems.push(`Two inputs use the id "${input.id}".`);
    ids.add(input.id);
    if (input.label.trim().length === 0) problems.push(`Input "${input.id}" needs a label.`);
    if (input.type === "select" && (input.options ?? []).filter((o) => o.trim()).length < 2) {
      problems.push(`Input "${name}" is a choice list; give it at least two options.`);
    }
  }
  if (prompt.trim().length === 0) problems.push("Write the prompt template.");
  if (prompt.length > 40_000) problems.push("Keep the prompt under 40,000 characters.");
  for (const id of templatePlaceholders(prompt)) {
    if (!ids.has(id)) problems.push(`The prompt uses {{${id}}}, but no input has that id.`);
  }
  problems.push(...templateSectionProblems(prompt));
  return problems;
}

/** A workflow id from a name: "Weekly report!" -> "weekly-report". */
export function workflowIdFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : `workflow-${slug || "new"}`;
}
