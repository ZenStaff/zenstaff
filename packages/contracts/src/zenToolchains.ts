// Zen Staff: toolchains for workflows. workflow.json may carry an optional `requires` block; the
// server checks it against the machine, installs tools from declarative catalog recipes into
// `<zen home>/toolchains/<id>/<version>/` and hands a workflow thread its tools. The Office manifest
// schema is unchanged (it ignores `requires`). ZEN.md, "Toolchains for workflows".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";

export const ZEN_TOOLCHAINS_WS_METHODS = {
  probe: "zen.toolchains.probe",
  checkWorkflows: "zen.toolchains.checkWorkflows",
  checkWorkflow: "zen.toolchains.checkWorkflow",
  install: "zen.toolchains.install",
  job: "zen.toolchains.job",
  cancel: "zen.toolchains.cancel",
  overview: "zen.toolchains.overview",
  verify: "zen.toolchains.verify",
  remove: "zen.toolchains.remove",
  cleanup: "zen.toolchains.cleanup",
  setSettings: "zen.toolchains.setSettings",
  prepareThread: "zen.toolchains.prepareThread",
  access: "zen.toolchains.access",
  setSecret: "zen.toolchains.setSecret",
  removeSecret: "zen.toolchains.removeSecret",
  grant: "zen.toolchains.grant",
  revoke: "zen.toolchains.revoke",
  approveInstall: "zen.toolchains.approveInstall",
} as const;

const ZEN_TOOLCHAIN_OS = ["linux", "windows", "macos"] as const;
export const ZenToolchainOs = Schema.Literals(ZEN_TOOLCHAIN_OS);
export type ZenToolchainOs = typeof ZenToolchainOs.Type;
const ZEN_TOOLCHAIN_ARCH = ["x64", "arm64"] as const;
export const ZenToolchainArch = Schema.Literals(ZEN_TOOLCHAIN_ARCH);
export type ZenToolchainArch = typeof ZenToolchainArch.Type;

export const ZenToolRequirement = Schema.Struct({
  /** A catalog tool id, such as "ffmpeg" or "remotion". */
  id: Schema.String,
  /** A version range: "*", ">=8", "^4.0.500", "~3.12", ">=6 <9", "1.2.x || >=2". */
  version: Schema.optional(Schema.String),
  /** Optional tools are installed when possible; their absence never blocks the workflow. */
  optional: Schema.optional(Schema.Boolean),
  /** What the workflow uses it for, in plain words ("renders the video"). */
  purpose: Schema.optional(Schema.String),
});
export type ZenToolRequirement = typeof ZenToolRequirement.Type;

export const ZenConnectorRequirement = Schema.Struct({
  /** A connector id, such as "elevenlabs". */
  id: Schema.String,
  optional: Schema.optional(Schema.Boolean),
  purpose: Schema.optional(Schema.String),
});
export type ZenConnectorRequirement = typeof ZenConnectorRequirement.Type;

export const ZenGpuRequirement = Schema.Struct({
  /** true: the workflow cannot run without it. false: it only runs faster with one. */
  required: Schema.Boolean,
  vendor: Schema.optional(Schema.Literals(["nvidia", "amd", "apple", "intel", "any"])),
  minVramGb: Schema.optional(Schema.Number),
  api: Schema.optional(Schema.Literals(["cuda", "metal", "any"])),
});
export type ZenGpuRequirement = typeof ZenGpuRequirement.Type;

export const ZenHardwareRequirement = Schema.Struct({
  minRamGb: Schema.optional(Schema.Number),
  /** Free disk on the zen home volume needed while running (installs are counted on top). */
  minFreeDiskGb: Schema.optional(Schema.Number),
  minCpuCores: Schema.optional(Schema.Number),
  gpu: Schema.optional(ZenGpuRequirement),
  os: Schema.optional(Schema.Array(ZenToolchainOs)),
  arch: Schema.optional(Schema.Array(ZenToolchainArch)),
});
export type ZenHardwareRequirement = typeof ZenHardwareRequirement.Type;

export const ZenRunTimeEstimate = Schema.Struct({
  /** One unit of work in plain words: "a 30-second video", "one hour of audio". */
  unit: Schema.String,
  /** Seconds per unit on the reference machine (referenceCpuCores, no GPU). */
  seconds: Schema.Number,
  referenceCpuCores: Schema.optional(Schema.Number),
  /** Seconds per unit with a matching GPU, when the workflow uses one. */
  gpuSeconds: Schema.optional(Schema.Number),
  /** Above this estimate the check says "works but slow". Default 900 (15 minutes). */
  slowAfterSeconds: Schema.optional(Schema.Number),
});
export type ZenRunTimeEstimate = typeof ZenRunTimeEstimate.Type;

export const ZenWorkflowAlternative = Schema.Struct({
  id: Schema.String,
  /** lighter: a smaller variant or model; connector: a cloud service does the heavy part. */
  kind: Schema.Literals(["lighter", "connector"]),
  label: Schema.String,
  description: Schema.optional(Schema.String),
  /** Tool swaps for this variant: { "whisper-model-small": "whisper-model-tiny" }. */
  replaceTools: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Tools this variant does not need. */
  dropTools: Schema.optional(Schema.Array(Schema.String)),
  /** Hardware for this variant; replaces the workflow's own block when set. */
  hardware: Schema.optional(ZenHardwareRequirement),
  /** For kind "connector": the connector id that replaces the local work. */
  connector: Schema.optional(Schema.String),
  /** Added to the workflow message when this variant is chosen. */
  promptNote: Schema.optional(Schema.String),
});
export type ZenWorkflowAlternative = typeof ZenWorkflowAlternative.Type;

export const ZenRunsBest = Schema.Literals(["local", "server", "either"]);
export type ZenRunsBest = typeof ZenRunsBest.Type;

export const ZenWorkflowRequires = Schema.Struct({
  tools: Schema.optional(Schema.Array(ZenToolRequirement)),
  connectors: Schema.optional(Schema.Array(ZenConnectorRequirement)),
  hardware: Schema.optional(ZenHardwareRequirement),
  runsBest: Schema.optional(ZenRunsBest),
  runTime: Schema.optional(ZenRunTimeEstimate),
  /** The tools need the internet while the workflow runs (downloads, APIs). Default false. */
  network: Schema.optional(Schema.Boolean),
  alternatives: Schema.optional(Schema.Array(ZenWorkflowAlternative)),
});
export type ZenWorkflowRequires = typeof ZenWorkflowRequires.Type;

/** A credential an enterprise workflow needs. The value lives only in the runner's vault. */
export const ZenSecretRequirement = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  /** Who issues it: "meta", "google", "elevenlabs"... */
  provider: Schema.String,
  scopes: Schema.Array(Schema.String),
  /** The workflow only reads; any write-like scope then fails validation. */
  readOnly: Schema.Boolean,
  /** API hosts the credential proxy may reach with it (egress allowlist). */
  apiHosts: Schema.optional(Schema.Array(Schema.String)),
  /** How the proxy sends it: a header template, "Authorization: Bearer {secret}" by default. */
  header: Schema.optional(Schema.String),
});
export type ZenSecretRequirement = typeof ZenSecretRequirement.Type;

/** The `access` block of workflow.json (optional; absent = standard, stable, no secrets). */
export const ZenWorkflowAccess = Schema.Struct({
  /** enterprise: external credentials or write access to company accounts. */
  tier: Schema.Literals(["standard", "enterprise"]),
  secrets: Schema.optional(Schema.Array(ZenSecretRequirement)),
  /** beta packs are hidden in the marketplace unless "Show beta" is on. */
  stability: Schema.optional(Schema.Literals(["stable", "beta"])),
});
export type ZenWorkflowAccess = typeof ZenWorkflowAccess.Type;

const READ_SCOPE =
  /(^|[._:/-])(read|readonly|read_only|view|list|get|search|insights|basic|profile|email|openid)($|[._:/-])/i;
const WRITE_SCOPE =
  /(^|[._:/-])(write|create|update|delete|remove|manage|management|admin|publish|post|posts|send|edit|modify|full|all|upload)($|[._:/-])|^\*$/i;

/**
 * Whether an OAuth-style scope only reads. "...readonly" scopes read; otherwise write words win
 * over read words, and a scope with neither (such as Google's ".../auth/drive") is not read-only.
 */
export function isReadOnlyScope(scope: string): boolean {
  if (/(^|[._:/-])(readonly|read_only|read-only)$/i.test(scope)) return true;
  if (WRITE_SCOPE.test(scope)) return false;
  return READ_SCOPE.test(scope);
}

/** Plain-language problems in an access block; empty means valid. */
export function accessProblems(access: ZenWorkflowAccess): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const secret of access.secrets ?? []) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(secret.id)) {
      problems.push(`Secret "${secret.label}": the id uses a-z, 0-9 or _.`);
    }
    if (ids.has(secret.id)) problems.push(`Two secrets use the id "${secret.id}".`);
    ids.add(secret.id);
    if (secret.readOnly) {
      const wide = secret.scopes.filter((scope) => !isReadOnlyScope(scope));
      if (wide.length > 0) {
        problems.push(
          `Secret "${secret.label}" says read-only but asks for ${wide.join(", ")}, which can change data.`,
        );
      }
    }
    for (const host of secret.apiHosts ?? []) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) problems.push(`"${host}" is not a host name.`);
    }
  }
  if (access.tier === "standard" && (access.secrets ?? []).length > 0) {
    problems.push("A workflow that needs credentials is enterprise tier.");
  }
  return problems;
}

/**
 * The `unattended` block of workflow.json (optional): what a scheduled run of this workflow may do
 * with nobody watching. Only these commands (plus the commands of its `requires` tools) and these
 * agent tools are allowed; everything else is denied instead of asked. ZEN.md, "Scheduled
 * workflows".
 */
export const ZenWorkflowUnattended = Schema.Struct({
  /** Program names, such as "curl" or "python3" (one word each). */
  commands: Schema.Array(Schema.String),
  /** Agent tools beyond file reading and editing in the task folder: "WebFetch", "WebSearch". */
  tools: Schema.optional(Schema.Array(Schema.String)),
});
export type ZenWorkflowUnattended = typeof ZenWorkflowUnattended.Type;

/** Agent tools a workflow may ask for in `unattended.tools`. */
const ZEN_UNATTENDED_AGENT_TOOLS = ["WebFetch", "WebSearch"] as const;

/**
 * Programs an unattended run never gets, even when declared: admin rights, system package
 * managers, installers and shells that would run anything. Downloads (curl, wget) are allowed
 * only when declared.
 */
const ZEN_UNATTENDED_FORBIDDEN_COMMANDS = new Set([
  "sudo",
  "su",
  "doas",
  "apt",
  "apt-get",
  "dnf",
  "yum",
  "pacman",
  "brew",
  "port",
  "choco",
  "winget",
  "scoop",
  "pipx",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "setcap",
  "bash",
  "sh",
  "zsh",
  "env",
  "eval",
  "exec",
  "xargs",
]);

const UNATTENDED_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** Plain-language problems in an unattended block; empty means valid. */
export function unattendedProblems(block: ZenWorkflowUnattended): string[] {
  const problems: string[] = [];
  for (const command of block.commands) {
    if (!UNATTENDED_COMMAND.test(command)) problems.push(`"${command}" is not a program name.`);
    else if (ZEN_UNATTENDED_FORBIDDEN_COMMANDS.has(command)) {
      problems.push(`"${command}" cannot run unattended (admin rights, installers or shells).`);
    }
  }
  const tools = new Set<string>(ZEN_UNATTENDED_AGENT_TOOLS);
  for (const tool of block.tools ?? []) {
    if (!tools.has(tool))
      problems.push(`"${tool}" is not an agent tool an unattended run can use.`);
  }
  return problems;
}

/**
 * The line that marks a scheduled task's prompt as a run of a workflow. A scheduled run whose
 * prompt has it runs unattended with that workflow's `unattended` rules. Put it on its own line.
 */
export function zenScheduledWorkflowMarker(workflowId: string): string {
  return `[zen-workflow: ${workflowId}]`;
}

const MARKER = /^[ \t]*\[zen-workflow:[ \t]*([a-z0-9][a-z0-9-]{1,63})[ \t]*\][ \t]*$/m;

/** The workflow id a scheduled prompt names with `zenScheduledWorkflowMarker`, or null. */
export function parseZenScheduledWorkflowMarker(prompt: string): string | null {
  return MARKER.exec(prompt)?.[1] ?? null;
}

/** Where to read about the always-on company server. */
export const ZEN_COMPANY_SERVER_URL = "https://zed-zen.com/zen-staff/server";

export const ZenToolLicense = Schema.Struct({
  spdx: Schema.String,
  name: Schema.String,
  url: Schema.String,
  /** free: any company may use it; conditions: free with rules; paid: a paid license may apply. */
  commercialUse: Schema.Literals(["free", "conditions", "paid"]),
  /** Shown to the user in plain words before install. */
  note: Schema.String,
  /** The same note in Romanian. */
  noteRo: Schema.optional(Schema.String),
});
export type ZenToolLicense = typeof ZenToolLicense.Type;

/**
 * Install steps: only these declarative steps exist, a recipe cannot run a script. Downloads are
 * pinned by sha256, npm runs `ci --ignore-scripts`, pip is wheels-only with hashes.
 */
export const ZenRecipeDownloadStep = Schema.Struct({
  type: Schema.Literal("download"),
  url: Schema.String,
  sha256: Schema.String,
  /** Bytes, for progress and the size shown before install. */
  size: Schema.Number,
  archive: Schema.optional(Schema.Literals(["tar.gz", "tar.xz", "zip", "gz", "none"])),
  /** For archives: paths inside the archive to keep, relative after stripComponents. */
  files: Schema.optional(Schema.Array(Schema.String)),
  stripComponents: Schema.optional(Schema.Number),
  /** For "gz"/"none": the file name in the toolchain folder. For archives: a subfolder. */
  dest: Schema.optional(Schema.String),
  executable: Schema.optional(Schema.Boolean),
});
export const ZenRecipeNpmStep = Schema.Struct({
  type: Schema.Literal("npm"),
  /** Catalog-relative folder holding package.json and package-lock.json. */
  lockfileDir: Schema.String,
});
export const ZenRecipeUvPythonStep = Schema.Struct({
  type: Schema.Literal("uvPython"),
  python: Schema.String,
});
export const ZenRecipeVenvStep = Schema.Struct({
  type: Schema.Literal("venv"),
  /** Catalog tool id whose python the venv uses. */
  pythonTool: Schema.String,
});
export const ZenRecipePipStep = Schema.Struct({
  type: Schema.Literal("pip"),
  /** Catalog-relative requirements file with `--hash` pins (uv pip compile --generate-hashes). */
  requirements: Schema.String,
});
export const ZenRecipeRemotionBrowserStep = Schema.Struct({
  type: Schema.Literal("remotionBrowser"),
});
export const ZenRecipeStep = Schema.Union([
  ZenRecipeDownloadStep,
  ZenRecipeNpmStep,
  ZenRecipeUvPythonStep,
  ZenRecipeVenvStep,
  ZenRecipePipStep,
  ZenRecipeRemotionBrowserStep,
]);
export type ZenRecipeStep = typeof ZenRecipeStep.Type;

export const ZenToolRecipe = Schema.Struct({
  os: ZenToolchainOs,
  arch: ZenToolchainArch,
  /** tested: installed and verified on this OS/arch by us; untested: written from the docs. */
  status: Schema.Literals(["tested", "untested"]),
  steps: Schema.Array(ZenRecipeStep),
  /** Commands the tool provides: name -> path inside the toolchain folder. */
  bin: Schema.Record(Schema.String, Schema.String),
  /** Extra variables for the workflow; `${dir}` is the toolchain folder. */
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Bytes on disk once installed (approximate). */
  installedSize: Schema.Number,
});
export type ZenToolRecipe = typeof ZenToolRecipe.Type;

export const ZenToolDependency = Schema.Struct({ id: Schema.String, version: Schema.String });

export const ZenToolVersion = Schema.Struct({
  version: Schema.String,
  released: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(ZenToolDependency)),
  recipes: Schema.Array(ZenToolRecipe),
});
export type ZenToolVersion = typeof ZenToolVersion.Type;

export const ZenBlockedVersion = Schema.Struct({
  /** An exact version or a range (">=1.0 <1.2.3"). */
  version: Schema.String,
  reason: Schema.String,
  advisories: Schema.optional(Schema.Array(Schema.String)),
});
export type ZenBlockedVersion = typeof ZenBlockedVersion.Type;

export const ZenOsvPackage = Schema.Struct({ ecosystem: Schema.String, name: Schema.String });

/**
 * An NVD product for tools OSV.dev does not cover (FFmpeg, Node.js, Chromium): the CPE 2.3
 * `vendor:product` prefix ("cpe:2.3:a:ffmpeg:ffmpeg") and, when the product's version differs
 * from the tool's (Playwright 1.65.1 ships Chrome 159.0.8154.6), the component version per tool
 * version.
 */
export const ZenNvdProduct = Schema.Struct({
  cpe: Schema.String,
  label: Schema.optional(Schema.String),
  versions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export const ZenToolCatalogEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The name in Romanian (plain words for the Preparing dialog). */
  nameRo: Schema.optional(Schema.String),
  /** One plain sentence for the Preparing step. */
  description: Schema.String,
  homepage: Schema.String,
  kind: Schema.Literals(["binary", "runtime", "npm", "python", "model"]),
  license: ZenToolLicense,
  /** Parses files or pages from outside (video, web pages, documents): sandbox it, prefer a server. */
  untrustedInput: Schema.Boolean,
  verify: Schema.Struct({
    bin: Schema.String,
    args: Schema.Array(Schema.String),
    /** A regular expression the output must match. */
    expect: Schema.String,
  }),
  /** Names to look for on the system PATH (reported by the probe; never used by workflows). */
  pathNames: Schema.optional(Schema.Array(Schema.String)),
  minSafeVersion: Schema.optional(Schema.String),
  blockedVersions: Schema.optional(Schema.Array(ZenBlockedVersion)),
  /** OSV.dev packages the hub scanner queries for this tool's versions. */
  osv: Schema.optional(Schema.Array(ZenOsvPackage)),
  /** NVD (CPE) products the scanner queries when OSV.dev has no ecosystem for the tool. */
  nvd: Schema.optional(Schema.Array(ZenNvdProduct)),
  versions: Schema.Array(ZenToolVersion),
});
export type ZenToolCatalogEntry = typeof ZenToolCatalogEntry.Type;

export const ZenConnectorCatalogEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  /** The connector is set up when this variable is present for the server. */
  envVar: Schema.String,
});
export type ZenConnectorCatalogEntry = typeof ZenConnectorCatalogEntry.Type;

/** advisories.json: blocked versions published by the hub scanner (or shipped as a fallback). */
export const ZenAdvisoryFile = Schema.Struct({
  version: Schema.Number,
  generatedAt: Schema.String,
  source: Schema.String,
  tools: Schema.Record(
    Schema.String,
    Schema.Struct({
      minSafeVersion: Schema.optional(Schema.String),
      blockedVersions: Schema.Array(ZenBlockedVersion),
    }),
  ),
});
export type ZenAdvisoryFile = typeof ZenAdvisoryFile.Type;

export const ZenGpuInfo = Schema.Struct({
  vendor: Schema.Literals(["nvidia", "amd", "apple", "intel", "other"]),
  name: Schema.String,
  vramGb: Schema.NullOr(Schema.Number),
  cuda: Schema.NullOr(Schema.String),
  metal: Schema.Boolean,
  driver: Schema.NullOr(Schema.String),
});
export type ZenGpuInfo = typeof ZenGpuInfo.Type;

export const ZenSandboxKind = Schema.Literals(["bwrap", "sandbox-exec", "none"]);
export type ZenSandboxKind = typeof ZenSandboxKind.Type;

export const ZenMachineProbe = Schema.Struct({
  probedAt: Schema.String,
  durationMs: Schema.Number,
  os: Schema.Literals(["linux", "windows", "macos", "other"]),
  arch: Schema.Literals(["x64", "arm64", "other"]),
  osVersion: Schema.String,
  hostname: Schema.String,
  cpuModel: Schema.String,
  cpuCores: Schema.Number,
  totalRamGb: Schema.Number,
  freeRamGb: Schema.Number,
  zenHome: Schema.String,
  installDir: Schema.String,
  installDirWritable: Schema.Boolean,
  freeDiskGb: Schema.NullOr(Schema.Number),
  gpus: Schema.Array(ZenGpuInfo),
  toolsOnPath: Schema.Record(Schema.String, Schema.String),
  network: Schema.Array(
    Schema.Struct({
      host: Schema.String,
      reachable: Schema.Boolean,
      ms: Schema.NullOr(Schema.Number),
    }),
  ),
  sandbox: ZenSandboxKind,
  /** This machine is marked as the company's always-on server (Settings > Tools). */
  companyRunner: Schema.Boolean,
});
export type ZenMachineProbe = typeof ZenMachineProbe.Type;

export const ZenAccessLock = Schema.Struct({
  code: Schema.Literals(["needs-grant", "needs-runner", "needs-secret", "invalid"]),
  message: Schema.String,
});
export type ZenAccessLock = typeof ZenAccessLock.Type;

export const ZenAccessView = Schema.Struct({
  tier: Schema.Literals(["standard", "enterprise"]),
  stability: Schema.Literals(["stable", "beta"]),
  secrets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      provider: Schema.String,
      readOnly: Schema.Boolean,
      stored: Schema.Boolean,
    }),
  ),
  /** Why an enterprise workflow cannot run here for this person, or null. */
  lock: Schema.NullOr(ZenAccessLock),
});
export type ZenAccessView = typeof ZenAccessView.Type;

export const ZenToolchainStatus = Schema.Literals([
  /** Nothing to do. */
  "ready",
  /** Tools to install first. */
  "needs-install",
  /** An installed version is blocked for safety and a safe one will be installed. */
  "updating",
  /** Runs here, but slowly. */
  "slow",
  /** Cannot run on this machine. */
  "not-compatible",
]);
export type ZenToolchainStatus = typeof ZenToolchainStatus.Type;

export const ZenInstallItem = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  version: Schema.String,
  downloadBytes: Schema.Number,
  diskBytes: Schema.Number,
  seconds: Schema.Number,
  reason: Schema.Literals(["missing", "safety-update", "dependency"]),
  optional: Schema.Boolean,
  recipeStatus: Schema.Literals(["tested", "untested"]),
  license: ZenToolLicense,
  untrustedInput: Schema.Boolean,
});
export type ZenInstallItem = typeof ZenInstallItem.Type;

export const ZenCompatReason = Schema.Struct({
  code: Schema.String,
  /** Plain words for Office users. */
  message: Schema.String,
  /** Technical detail for the Details expander. */
  detail: Schema.String,
});
export type ZenCompatReason = typeof ZenCompatReason.Type;

export const ZenCompatAlternative = Schema.Struct({
  kind: Schema.Literals(["lighter", "connector"]),
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  /** The variant itself fits this machine (lighter) or the connector is set up (connector). */
  available: Schema.Boolean,
  status: Schema.NullOr(ZenToolchainStatus),
});
export type ZenCompatAlternative = typeof ZenCompatAlternative.Type;

export const ZenToolUse = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  version: Schema.NullOr(Schema.String),
  dir: Schema.NullOr(Schema.String),
  bins: Schema.Record(Schema.String, Schema.String),
  optional: Schema.Boolean,
  /** Already on the computer (not installed by Zen, not checksum-pinned). */
  system: Schema.optional(Schema.Boolean),
  /** Where it was found: "PATH", "Homebrew", "winget"… */
  systemSource: Schema.optional(Schema.String),
});
export type ZenToolUse = typeof ZenToolUse.Type;

export const ZenWorkflowCompatibility = Schema.Struct({
  workflowId: Schema.String,
  hasRequirements: Schema.Boolean,
  status: ZenToolchainStatus,
  /** One plain sentence. */
  headline: Schema.String,
  reasons: Schema.Array(ZenCompatReason),
  install: Schema.Array(ZenInstallItem),
  downloadBytes: Schema.Number,
  diskBytes: Schema.Number,
  installSeconds: Schema.Number,
  /** "about 12 min for a 30-second video on this computer". */
  runEstimate: Schema.NullOr(Schema.String),
  runEstimateSeconds: Schema.NullOr(Schema.Number),
  licenseNotes: Schema.Array(
    Schema.Struct({
      toolId: Schema.String,
      name: Schema.String,
      commercialUse: Schema.Literals(["free", "conditions", "paid"]),
      note: Schema.String,
      url: Schema.String,
    }),
  ),
  connectors: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      configured: Schema.Boolean,
      optional: Schema.Boolean,
      purpose: Schema.NullOr(Schema.String),
    }),
  ),
  alternatives: Schema.Array(ZenCompatAlternative),
  /** Tools that read files or pages from outside; the UI recommends the company server. */
  untrustedInputTools: Schema.Array(Schema.String),
  runsBest: ZenRunsBest,
  tools: Schema.Array(ZenToolUse),
  /** Technical facts for the Details expander. */
  details: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  machine: Schema.Struct({ hostname: Schema.String, companyRunner: Schema.Boolean }),
  access: ZenAccessView,
});
export type ZenWorkflowCompatibility = typeof ZenWorkflowCompatibility.Type;

export const ZenWorkflowStatusSummary = Schema.Struct({
  access: ZenAccessView,
  workflowId: Schema.String,
  status: ZenToolchainStatus,
  headline: Schema.String,
  hasRequirements: Schema.Boolean,
});
export type ZenWorkflowStatusSummary = typeof ZenWorkflowStatusSummary.Type;

export const ZenInstallJobStepState = Schema.Literals([
  "waiting",
  "downloading",
  "installing",
  "verifying",
  "done",
  "failed",
  "cancelled",
]);
export const ZenInstallJob = Schema.Struct({
  jobId: Schema.String,
  workflowId: Schema.String,
  state: Schema.Literals(["running", "done", "failed", "cancelled"]),
  message: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  steps: Schema.Array(
    Schema.Struct({
      toolId: Schema.String,
      name: Schema.String,
      version: Schema.String,
      state: ZenInstallJobStepState,
      bytes: Schema.Number,
      totalBytes: Schema.Number,
      message: Schema.String,
    }),
  ),
});
export type ZenInstallJob = typeof ZenInstallJob.Type;

export const ZenInstalledToolchain = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  version: Schema.String,
  dir: Schema.String,
  sizeBytes: Schema.Number,
  installedAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  /** Workflows (by name) that need this toolchain: the reference count is its length. */
  usedBy: Schema.Array(Schema.String),
  blocked: Schema.NullOr(Schema.String),
  lastVerify: Schema.NullOr(
    Schema.Struct({ ok: Schema.Boolean, output: Schema.String, at: Schema.String }),
  ),
  license: ZenToolLicense,
});
export type ZenInstalledToolchain = typeof ZenInstalledToolchain.Type;

export const ZenToolchainSettings = Schema.Struct({
  /** Remove toolchains not used for this many days. 0 = never. */
  autoRemoveDays: Schema.Number,
  /** This machine is the company's always-on server. */
  companyRunner: Schema.Boolean,
  /**
   * Where pinned downloads come from first: "default" (tools.zed-zen.com), "off" (official URLs
   * only) or an https mirror base. The ZEN_TOOLS_MIRROR env wins over it. Optional for old state.
   */
  toolsMirror: Schema.optional(Schema.String),
  /** Use tools already installed on the computer when they fit (default on). */
  useSystemTools: Schema.optional(Schema.Boolean),
  /** Tools for which the person chose "use the Zen version". */
  pinnedTools: Schema.optional(Schema.Array(Schema.String)),
  /** Set by a company admin: company workflows and the company server use Zen versions only. */
  companyPinned: Schema.optional(Schema.Boolean),
});
export type ZenToolchainSettings = typeof ZenToolchainSettings.Type;

export const ZEN_DEFAULT_TOOLCHAIN_SETTINGS: ZenToolchainSettings = {
  autoRemoveDays: 60,
  companyRunner: false,
  toolsMirror: "default",
  useSystemTools: true,
  pinnedTools: [],
  companyPinned: false,
};

export const ZenToolchainOverview = Schema.Struct({
  root: Schema.String,
  installed: Schema.Array(ZenInstalledToolchain),
  settings: ZenToolchainSettings,
  totalBytes: Schema.Number,
  unusedCount: Schema.Number,
  sandbox: ZenSandboxKind,
  advisories: Schema.Struct({
    source: Schema.String,
    generatedAt: Schema.NullOr(Schema.String),
    blockedCount: Schema.Number,
  }),
  /** Tools found on the computer; `usable` ones may replace a download (range permitting). */
  systemTools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        toolId: Schema.String,
        name: Schema.String,
        path: Schema.String,
        version: Schema.NullOr(Schema.String),
        source: Schema.String,
        usable: Schema.Boolean,
        reason: Schema.NullOr(Schema.String),
      }),
    ),
  ),
});
export type ZenToolchainOverview = typeof ZenToolchainOverview.Type;

export const ZenToolchainRef = Schema.Struct({ toolId: Schema.String, version: Schema.String });
export type ZenToolchainRef = typeof ZenToolchainRef.Type;

/** Which workflow: by id (from the lists the Office shows), or a marketplace pack before install. */
export const ZenWorkflowTarget = Schema.Struct({
  workflowId: Schema.String,
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
  packId: Schema.optional(Schema.NullOr(Schema.String)),
  alternativeId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Language of the plain sentences ("en" default, "ro"). */
  locale: Schema.optional(Schema.Literals(["en", "ro"])),
  /** Who starts it (hub e-mail), for enterprise grants; the runner checks its own ledger. */
  requester: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ZenWorkflowTarget = typeof ZenWorkflowTarget.Type;

export const ZenPrepareThreadInput = Schema.Struct({
  ...ZenWorkflowTarget.fields,
  threadId: Schema.String,
  /** The folder the workflow runs in (the project root); tools may write only there. */
  cwd: Schema.String,
});
export type ZenPrepareThreadInput = typeof ZenPrepareThreadInput.Type;

export const ZenPreparedThread = Schema.Struct({
  /** Appended to the workflow message: absolute tool paths and the sandbox rules. */
  appendix: Schema.String,
  env: Schema.Record(Schema.String, Schema.String),
  sandbox: ZenSandboxKind,
});
export type ZenPreparedThread = typeof ZenPreparedThread.Type;

export class ZenToolchainError extends Schema.TaggedError<ZenToolchainError>()(
  "ZenToolchainError",
  {
    reason: Schema.Literals(["invalid", "not-found", "blocked", "not-ready", "unavailable", "io"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const errors = Schema.Union([ZenToolchainError, EnvironmentAuthorizationError]);

const ZenToolchainsProbeRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.probe, {
  payload: Schema.Struct({ refresh: Schema.optional(Schema.Boolean) }),
  success: ZenMachineProbe,
  error: errors,
});
const ZenToolchainsCheckWorkflowsRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.checkWorkflows, {
  payload: Schema.Struct({
    companyId: Schema.optional(Schema.NullOr(Schema.String)),
    requester: Schema.optional(Schema.NullOr(Schema.String)),
    locale: Schema.optional(Schema.Literals(["en", "ro"])),
  }),
  success: Schema.Array(ZenWorkflowStatusSummary),
  error: errors,
});
const ZenToolchainsCheckWorkflowRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.checkWorkflow, {
  payload: ZenWorkflowTarget,
  success: ZenWorkflowCompatibility,
  error: errors,
});
const ZenToolchainsInstallRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.install, {
  payload: ZenWorkflowTarget,
  success: ZenInstallJob,
  error: errors,
});
const ZenToolchainsJobRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.job, {
  payload: Schema.Struct({ jobId: Schema.String }),
  success: ZenInstallJob,
  error: errors,
});
const ZenToolchainsCancelRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.cancel, {
  payload: Schema.Struct({ jobId: Schema.String }),
  success: ZenInstallJob,
  error: errors,
});
const ZenToolchainsOverviewRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.overview, {
  payload: Schema.Struct({}),
  success: ZenToolchainOverview,
  error: errors,
});
const ZenToolchainsVerifyRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.verify, {
  payload: ZenToolchainRef,
  success: ZenToolchainOverview,
  error: errors,
});
const ZenToolchainsRemoveRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.remove, {
  payload: ZenToolchainRef,
  success: ZenToolchainOverview,
  error: errors,
});
const ZenToolchainsCleanupRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.cleanup, {
  payload: Schema.Struct({}),
  success: ZenToolchainOverview,
  error: errors,
});
const ZenToolchainsSetSettingsRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.setSettings, {
  payload: ZenToolchainSettings,
  success: ZenToolchainOverview,
  error: errors,
});
const ZenToolchainsPrepareThreadRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.prepareThread, {
  payload: ZenPrepareThreadInput,
  success: ZenPreparedThread,
  error: errors,
});

export const ZenAccessOverview = Schema.Struct({
  runner: Schema.Struct({
    isRunner: Schema.Boolean,
    source: Schema.Literals(["hub", "local", "none"]),
    hubUser: Schema.NullOr(Schema.String),
  }),
  keyStore: Schema.Literals(["keychain", "file"]),
  /**
   * Hub v9, one server for several companies: the hub companies this server serves (the screen
   * picks one) and the one this overview is for. Absent without a hub.
   */
  companies: Schema.optional(
    Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String, manager: Schema.Boolean }),
    ),
  ),
  companyId: Schema.optional(Schema.NullOr(Schema.String)),
  packs: Schema.Array(
    Schema.Struct({
      workflowId: Schema.String,
      name: Schema.String,
      installed: Schema.Boolean,
      approved: Schema.Boolean,
      access: ZenAccessView,
      grants: Schema.Array(
        Schema.Struct({ user: Schema.String, grantedBy: Schema.String, at: Schema.String }),
      ),
    }),
  ),
  /** The newest credential uses (never values). */
  usage: Schema.Array(
    Schema.Struct({
      at: Schema.String,
      workflowId: Schema.String,
      user: Schema.String,
      secretId: Schema.String,
      kind: Schema.String,
    }),
  ),
});
export type ZenAccessOverview = typeof ZenAccessOverview.Type;

const ZenToolchainsAccessRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.access, {
  payload: Schema.Struct({
    /** Hub company id (one server, several companies); absent: the first company it serves. */
    companyId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  success: ZenAccessOverview,
  error: errors,
});
const ZenToolchainsSetSecretRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.setSecret, {
  payload: Schema.Struct({
    workflowId: Schema.String,
    secretId: Schema.String,
    value: Schema.String,
  }),
  success: ZenAccessOverview,
  error: errors,
});
const ZenToolchainsRemoveSecretRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.removeSecret, {
  payload: Schema.Struct({ workflowId: Schema.String, secretId: Schema.String }),
  success: ZenAccessOverview,
  error: errors,
});
const ZenToolchainsGrantRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.grant, {
  payload: Schema.Struct({
    packId: Schema.String,
    user: Schema.String,
    adminConfirmed: Schema.Boolean,
    /** Hub company id (one server, several companies); absent: the first company it serves. */
    companyId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  success: ZenAccessOverview,
  error: errors,
});
const ZenToolchainsRevokeRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.revoke, {
  payload: Schema.Struct({
    packId: Schema.String,
    user: Schema.String,
    /** Hub company id (one server, several companies); absent: the first company it serves. */
    companyId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  success: ZenAccessOverview,
  error: errors,
});
const ZenToolchainsApproveInstallRpc = Rpc.make(ZEN_TOOLCHAINS_WS_METHODS.approveInstall, {
  payload: Schema.Struct({
    packId: Schema.String,
    adminConfirmed: Schema.Boolean,
    /** Hub company id (one server, several companies); absent: the first company it serves. */
    companyId: Schema.optional(Schema.NullOr(Schema.String)),
    /** The marketplace's company (local id): its linked hub company approves the install. */
    localCompanyId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  success: ZenAccessOverview,
  error: errors,
});

export const ZEN_TOOLCHAINS_RPCS = [
  ZenToolchainsProbeRpc,
  ZenToolchainsCheckWorkflowsRpc,
  ZenToolchainsCheckWorkflowRpc,
  ZenToolchainsInstallRpc,
  ZenToolchainsJobRpc,
  ZenToolchainsCancelRpc,
  ZenToolchainsOverviewRpc,
  ZenToolchainsVerifyRpc,
  ZenToolchainsRemoveRpc,
  ZenToolchainsCleanupRpc,
  ZenToolchainsSetSettingsRpc,
  ZenToolchainsPrepareThreadRpc,
  ZenToolchainsAccessRpc,
  ZenToolchainsSetSecretRpc,
  ZenToolchainsRemoveSecretRpc,
  ZenToolchainsGrantRpc,
  ZenToolchainsRevokeRpc,
  ZenToolchainsApproveInstallRpc,
] as const;

const read = AuthOrchestrationReadScope;
const operate = AuthOrchestrationOperateScope;
export const ZEN_TOOLCHAINS_RPC_SCOPES = {
  [ZEN_TOOLCHAINS_WS_METHODS.probe]: read,
  [ZEN_TOOLCHAINS_WS_METHODS.checkWorkflows]: read,
  [ZEN_TOOLCHAINS_WS_METHODS.checkWorkflow]: read,
  [ZEN_TOOLCHAINS_WS_METHODS.install]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.job]: read,
  [ZEN_TOOLCHAINS_WS_METHODS.cancel]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.overview]: read,
  [ZEN_TOOLCHAINS_WS_METHODS.verify]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.remove]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.cleanup]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.setSettings]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.prepareThread]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.access]: read,
  [ZEN_TOOLCHAINS_WS_METHODS.setSecret]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.removeSecret]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.grant]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.revoke]: operate,
  [ZEN_TOOLCHAINS_WS_METHODS.approveInstall]: operate,
} as const;

export const ZEN_TOOLCHAINS_RPC_AGGREGATES = Object.fromEntries(
  Object.values(ZEN_TOOLCHAINS_WS_METHODS).map((method) => [method, "zen"]),
) as {
  readonly [K in (typeof ZEN_TOOLCHAINS_WS_METHODS)[keyof typeof ZEN_TOOLCHAINS_WS_METHODS]]: "zen";
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}
