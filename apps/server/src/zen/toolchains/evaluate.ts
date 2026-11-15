// Zen Staff: is this workflow ready on this machine? Pure: requires + catalog + probe + installed
// toolchains + block list in, the compatibility shown to the person and the install plan out.
import {
  type ZenAccessView,
  formatBytes,
  type ZenCompatAlternative,
  type ZenCompatReason,
  type ZenConnectorCatalogEntry,
  type ZenGpuInfo,
  type ZenHardwareRequirement,
  type ZenInstallItem,
  type ZenMachineProbe,
  type ZenToolRecipe,
  type ZenToolRequirement,
  type ZenToolUse,
  type ZenToolVersion,
  type ZenToolchainArch,
  type ZenToolchainOs,
  type ZenToolchainStatus,
  type ZenWorkflowCompatibility,
  type ZenWorkflowRequires,
} from "@t3tools/contracts/zenToolchains";

import { blockReason, type BlockList } from "./advisories.ts";
import {
  recipeDownloadBytes,
  recipeFor,
  recipeInstallSeconds,
  type CatalogEntry,
} from "./catalog.ts";
import {
  evalText,
  setupPurpose,
  toolName,
  type EvalText,
  type ZenToolchainLocale,
} from "./messages.ts";
import { compareVersions, satisfiesRange } from "./versions.ts";

export interface InstalledToolchainRef {
  readonly toolId: string;
  readonly version: string;
  readonly dir: string;
  /** The recipe's bin map, recorded at install time. */
  readonly bins: Readonly<Record<string, string>>;
  /** name -> argv prefix (script bins run through their runtime). */
  readonly commands: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly env: Readonly<Record<string, string>>;
}

export interface EvaluationInput {
  readonly workflowId: string;
  readonly requires: ZenWorkflowRequires | null;
  readonly tools: ReadonlyMap<string, CatalogEntry>;
  readonly connectors: ReadonlyMap<string, ZenConnectorCatalogEntry>;
  readonly configuredConnectors: ReadonlySet<string>;
  readonly probe: ZenMachineProbe;
  readonly installed: ReadonlyArray<InstalledToolchainRef>;
  readonly blockList: BlockList;
  readonly alternativeId?: string | null;
  /** Assumed download speed for install time estimates. Default 4 MB/s. */
  readonly bytesPerSecond?: number;
  /** Language of the plain sentences. Default English. */
  readonly locale?: ZenToolchainLocale;
  /** Usable tools already on the computer (systemTools.ts); used when no Zen copy fits. */
  readonly system?: ReadonlyArray<InstalledToolchainRef & { readonly source: string }>;
  /** Hosts of the tool mirrors tried first (mirror.ts): one reachable mirror covers every file. */
  readonly mirrorHosts?: ReadonlyArray<string>;
  /** The access view (tier, secrets, enterprise lock); standard when absent. */
  readonly access?: ZenAccessView;
}

const STANDARD_VIEW: ZenAccessView = {
  tier: "standard",
  stability: "stable",
  secrets: [],
  lock: null,
};

export interface PlannedInstall {
  readonly entry: CatalogEntry;
  readonly version: string;
  readonly recipe: ZenToolRecipe;
  readonly reason: ZenInstallItem["reason"];
  readonly optional: boolean;
}

export interface Evaluation {
  readonly compatibility: ZenWorkflowCompatibility;
  /** Dependencies first. */
  readonly plan: ReadonlyArray<PlannedInstall>;
  /** Toolchains this workflow uses when it runs (installed or about to be). */
  readonly uses: ReadonlyArray<ToolUseRef>;
}

export interface ToolUseRef {
  readonly toolId: string;
  readonly version: string;
  readonly optional: boolean;
  /** Found on the computer, not installed by Zen (outside the pinned supply chain). */
  readonly system?: boolean;
}

const OS_NAMES: Record<string, string> = {
  linux: "Linux",
  windows: "Windows",
  macos: "macOS",
  other: "this system",
};
const VENDOR_NAMES: Record<string, string> = {
  nvidia: "NVIDIA",
  amd: "AMD",
  apple: "Apple",
  intel: "Intel",
  any: "",
  other: "",
};

const STATUS_RANK: Record<ZenToolchainStatus, number> = {
  ready: 0,
  slow: 1,
  "needs-install": 2,
  updating: 3,
  "not-compatible": 4,
};
const worst = (left: ZenToolchainStatus, right: ZenToolchainStatus) =>
  STATUS_RANK[right] > STATUS_RANK[left] ? right : left;

const gb = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} GB`;

/** Applies a declared alternative (lighter variant or connector) to the requirements. */
function applyAlternative(
  requires: ZenWorkflowRequires,
  alternativeId: string | null | undefined,
): ZenWorkflowRequires {
  if (!alternativeId) return requires;
  const alternative = requires.alternatives?.find((candidate) => candidate.id === alternativeId);
  if (!alternative) return requires;
  const dropped = new Set(alternative.dropTools ?? []);
  const swaps = alternative.replaceTools ?? {};
  const tools = (requires.tools ?? [])
    .filter((tool) => !dropped.has(tool.id))
    .map((tool) => (swaps[tool.id] ? { ...tool, id: swaps[tool.id]!, version: undefined } : tool));
  const connectors =
    alternative.kind === "connector" && alternative.connector
      ? [
          ...(requires.connectors ?? []).filter((c) => c.id !== alternative.connector),
          { id: alternative.connector, optional: false },
        ]
      : requires.connectors;
  return {
    ...requires,
    tools,
    ...(connectors ? { connectors } : {}),
    hardware: alternative.hardware ?? requires.hardware,
    runTime: alternative.kind === "connector" ? undefined : requires.runTime,
    alternatives: [],
  };
}

function matchingGpu(
  gpus: ReadonlyArray<ZenGpuInfo>,
  need: NonNullable<ZenHardwareRequirement["gpu"]>,
): ZenGpuInfo | null {
  return (
    gpus.find((gpu) => {
      if (need.vendor && need.vendor !== "any" && gpu.vendor !== need.vendor) return false;
      if (need.api === "cuda" && gpu.cuda === null) return false;
      if (need.api === "metal" && !gpu.metal) return false;
      if (need.minVramGb !== undefined && (gpu.vramGb ?? 0) < need.minVramGb) return false;
      return true;
    }) ?? null
  );
}

function describeGpuNeed(t: EvalText, need: NonNullable<ZenHardwareRequirement["gpu"]>): string {
  const vendor = need.vendor && need.vendor !== "any" ? (VENDOR_NAMES[need.vendor] ?? "") : "";
  return t.gpuNeed(vendor, need.minVramGb);
}

function describeGpus(gpus: ReadonlyArray<ZenGpuInfo>): string {
  if (gpus.length === 0) return "none";
  return gpus.map((gpu) => `${gpu.name}${gpu.vramGb ? ` (${gb(gpu.vramGb)})` : ""}`).join(", ");
}

/** Recipe steps that run another toolchain's binary (installer.ts `need`). */
const STEP_TOOLS: Readonly<Record<string, { readonly id: string; readonly version: string }>> = {
  venv: { id: "uv", version: ">=0.13" },
  pip: { id: "uv", version: ">=0.13" },
  uvPython: { id: "uv", version: ">=0.13" },
  npm: { id: "node", version: ">=20" },
  remotionBrowser: { id: "node", version: ">=20" },
};

/**
 * `dependsOn` plus the tools its recipe steps run. A python venv/pip recipe needs uv even when
 * its python comes from the system (a system python has no catalog version, so python's own
 * `dependsOn: uv` is never reached): without this, uv was never planned and the install failed
 * with "uv must be installed first".
 */
function versionDependencies(
  version: ZenToolVersion | undefined,
): ReadonlyArray<{ readonly id: string; readonly version: string }> {
  if (!version) return [];
  const listed = version.dependsOn ?? [];
  const ids = new Set(listed.map((dependency) => dependency.id));
  const implicit: { id: string; version: string }[] = [];
  for (const recipe of version.recipes) {
    for (const step of recipe.steps) {
      const tool = STEP_TOOLS[step.type];
      if (!tool || ids.has(tool.id)) continue;
      ids.add(tool.id);
      implicit.push(tool);
    }
  }
  return [...listed, ...implicit];
}

/** The tool versions and recipes for one requirement, dependencies resolved recursively. */
interface ToolResolution {
  readonly status: ZenToolchainStatus;
  readonly reasons: ZenCompatReason[];
  readonly plan: PlannedInstall[];
  readonly uses: ToolUseRef[];
}

function resolveTool(
  input: EvaluationInput,
  requirement: ZenToolRequirement,
  os: ZenToolchainOs,
  arch: ZenToolchainArch,
  depth: number,
  asDependency: boolean,
): ToolResolution {
  const optional = requirement.optional === true;
  const t = evalText(input.locale ?? "en");
  const entry = input.tools.get(requirement.id);
  const fail = (code: string, message: string, detail: string): ToolResolution => ({
    status: optional ? "ready" : "not-compatible",
    reasons: [{ code: optional ? `optional-${code}` : code, message, detail }],
    plan: [],
    uses: [],
  });
  if (!entry) {
    return fail(
      "unknown-tool",
      t.unknownTool(requirement.id),
      `Tool "${requirement.id}" is not in the catalog.`,
    );
  }
  if (depth > 6) return fail("dependency-loop", t.brokenList, "Dependency depth > 6.");
  const range = requirement.version;
  const installed = input.installed
    .filter((tool) => tool.toolId === entry.id && satisfiesRange(tool.version, range))
    .toSorted((left, right) => compareVersions(right.version, left.version));
  const installedSafe = installed.filter(
    (tool) => blockReason(input.blockList, entry.id, tool.version) === null,
  );
  const candidates = entry.versions
    .filter((version) => satisfiesRange(version.version, range))
    .filter((version) => recipeFor(version, os, arch) !== null)
    .toSorted((left, right) => compareVersions(right.version, left.version));
  const safeCandidates = candidates.filter(
    (version) => blockReason(input.blockList, entry.id, version.version) === null,
  );

  const systemSafe = (input.system ?? [])
    .filter(
      (tool) =>
        tool.toolId === entry.id &&
        satisfiesRange(tool.version, range) &&
        blockReason(input.blockList, entry.id, tool.version) === null,
    )
    .toSorted((left, right) => compareVersions(right.version, left.version));

  let chosenVersion: string;
  let fromSystem = false;
  let ownPlan: PlannedInstall | null = null;
  const reasons: ZenCompatReason[] = [];
  let status: ZenToolchainStatus = "ready";
  if (installedSafe.length > 0) {
    chosenVersion = installedSafe[0]!.version;
  } else if (systemSafe.length > 0) {
    chosenVersion = systemSafe[0]!.version;
    fromSystem = true;
  } else if (safeCandidates.length > 0) {
    const version = safeCandidates[0]!;
    chosenVersion = version.version;
    const safety = installed.length > 0;
    ownPlan = {
      entry,
      version: version.version,
      recipe: recipeFor(version, os, arch)!,
      reason: safety ? "safety-update" : asDependency ? "dependency" : "missing",
      optional,
    };
    status = safety ? "updating" : "needs-install";
    if (safety) {
      const old = installed[0]!;
      reasons.push({
        code: "safety-update",
        message: t.safetyUpdate(toolName(entry, input.locale), old.version, version.version),
        detail: blockReason(input.blockList, entry.id, old.version) ?? "",
      });
    }
  } else if (candidates.length > 0 || installed.length > 0) {
    const version = installed[0]?.version ?? candidates[0]!.version;
    return fail(
      "blocked",
      t.blocked(toolName(entry, input.locale)),
      `${entry.id}@${version}: ${blockReason(input.blockList, entry.id, version) ?? "blocked"}`,
    );
  } else {
    const anyVersion = entry.versions.some((version) => satisfiesRange(version.version, range));
    return fail(
      "no-recipe",
      anyVersion
        ? t.noRecipe(toolName(entry, input.locale), os, arch)
        : t.noVersion(toolName(entry, input.locale)),
      `${entry.id} ${range ?? "*"}: no recipe for ${os}/${arch}.`,
    );
  }

  const plan: PlannedInstall[] = [];
  const uses: ToolUseRef[] = [
    { toolId: entry.id, version: chosenVersion, optional, ...(fromSystem ? { system: true } : {}) },
  ];
  const versionEntry = entry.versions.find((version) => version.version === chosenVersion);
  for (const dependency of versionDependencies(versionEntry)) {
    const resolved = resolveTool(
      input,
      { id: dependency.id, version: dependency.version, optional },
      os,
      arch,
      depth + 1,
      true,
    );
    status = worst(status, resolved.status);
    reasons.push(...resolved.reasons);
    plan.push(...resolved.plan);
    uses.push(...resolved.uses);
  }
  if (ownPlan) plan.push(ownPlan);
  return { status, reasons, plan, uses };
}

function dedupePlan(plan: ReadonlyArray<PlannedInstall>): PlannedInstall[] {
  const seen = new Map<string, PlannedInstall>();
  for (const item of plan) {
    const key = `${item.entry.id}@${item.version}`;
    const existing = seen.get(key);
    // A tool needed by a required tool is required, whatever the optional flag said first.
    if (!existing) seen.set(key, item);
    else if (existing.optional && !item.optional) seen.set(key, { ...existing, optional: false });
  }
  return [...seen.values()];
}

function emptyCompatibility(input: EvaluationInput): ZenWorkflowCompatibility {
  return {
    workflowId: input.workflowId,
    hasRequirements: false,
    status: "ready",
    headline: evalText(input.locale ?? "en").ready,
    reasons: [],
    install: [],
    downloadBytes: 0,
    diskBytes: 0,
    installSeconds: 0,
    runEstimate: null,
    runEstimateSeconds: null,
    licenseNotes: [],
    connectors: [],
    alternatives: [],
    untrustedInputTools: [],
    runsBest: "either",
    tools: [],
    details: [],
    machine: { hostname: input.probe.hostname, companyRunner: input.probe.companyRunner },
    access: input.access ?? STANDARD_VIEW,
  };
}

export function evaluateWorkflow(input: EvaluationInput): Evaluation {
  if (input.requires === null)
    return { compatibility: emptyCompatibility(input), plan: [], uses: [] };
  const requires = applyAlternative(input.requires, input.alternativeId);
  const probe = input.probe;
  const reasons: ZenCompatReason[] = [];
  let status: ZenToolchainStatus = "ready";
  const t = evalText(input.locale ?? "en");
  const block = (code: string, message: string, detail: string) => {
    reasons.push({ code, message, detail });
    status = "not-compatible";
  };

  // Platform.
  const hardware = requires.hardware ?? {};
  if (probe.os === "other" || probe.arch === "other") {
    block("platform", t.platform, `os=${probe.os} arch=${probe.arch}`);
  }
  if (hardware.os && probe.os !== "other" && !hardware.os.includes(probe.os)) {
    block(
      "os",
      t.onlyOs(hardware.os, probe.os),
      `requires.hardware.os=${hardware.os.join(",")} probe.os=${probe.os}`,
    );
  }
  if (hardware.arch && probe.arch !== "other" && !hardware.arch.includes(probe.arch)) {
    block(
      "arch",
      t.arch(probe.arch),
      `requires.hardware.arch=${hardware.arch.join(",")} probe.arch=${probe.arch}`,
    );
  }
  if (hardware.minRamGb !== undefined && probe.totalRamGb < hardware.minRamGb) {
    block(
      "ram",
      t.ram(hardware.minRamGb, Math.round(probe.totalRamGb * 10) / 10),
      `minRamGb=${hardware.minRamGb} totalRamGb=${probe.totalRamGb}`,
    );
  }
  if (hardware.minCpuCores !== undefined && probe.cpuCores < hardware.minCpuCores) {
    block(
      "cpu",
      t.cpu(hardware.minCpuCores, probe.cpuCores),
      `minCpuCores=${hardware.minCpuCores} cpuCores=${probe.cpuCores}`,
    );
  }
  const gpuNeed = hardware.gpu;
  const gpu = gpuNeed ? matchingGpu(probe.gpus, gpuNeed) : null;
  if (gpuNeed?.required && gpu === null) {
    block(
      "gpu",
      t.gpu(describeGpuNeed(t, gpuNeed), probe.gpus.length === 0 ? null : describeGpus(probe.gpus)),
      `gpu=${JSON.stringify(gpuNeed)} probe.gpus=${JSON.stringify(probe.gpus)}`,
    );
  }

  // Tools.
  const os = probe.os === "other" ? "linux" : probe.os;
  const arch = probe.arch === "other" ? "x64" : probe.arch;
  let plan: PlannedInstall[] = [];
  const uses: ToolUseRef[] = [];
  if (probe.os !== "other" && probe.arch !== "other") {
    for (const requirement of requires.tools ?? []) {
      const resolved = resolveTool(input, requirement, os, arch, 0, false);
      if (resolved.status === "not-compatible") status = "not-compatible";
      else status = worst(status, resolved.status);
      reasons.push(...resolved.reasons);
      plan.push(...resolved.plan);
      uses.push(...resolved.uses);
    }
  }
  plan = dedupePlan(plan);
  const uniqueUses = [
    ...new Map(uses.map((use) => [`${use.toolId}@${use.version}`, use])).values(),
  ];

  // Install size, disk and network.
  const bytesPerSecond = input.bytesPerSecond ?? 4 * 1024 * 1024;
  const downloadBytes = plan.reduce((sum, item) => sum + recipeDownloadBytes(item.recipe), 0);
  const diskBytes = plan.reduce((sum, item) => sum + item.recipe.installedSize, 0);
  const installSeconds = plan.reduce(
    (sum, item) => sum + recipeInstallSeconds(item.recipe, bytesPerSecond),
    0,
  );
  const needDiskGb = (hardware.minFreeDiskGb ?? 0) + diskBytes / 1024 ** 3;
  if (probe.freeDiskGb !== null && needDiskGb > 0 && probe.freeDiskGb < needDiskGb) {
    block(
      "disk",
      t.disk(Math.ceil(needDiskGb * 10) / 10, Math.floor(probe.freeDiskGb * 10) / 10),
      `minFreeDiskGb=${hardware.minFreeDiskGb ?? 0} install=${formatBytes(diskBytes)} freeDiskGb=${probe.freeDiskGb}`,
    );
  }
  if (plan.length > 0 && !probe.installDirWritable) {
    block("install-dir", t.installDir, `installDir=${probe.installDir} not writable`);
  }
  if (plan.length > 0) {
    const hosts = new Set(
      plan.flatMap((item) =>
        item.recipe.steps.flatMap((step) =>
          step.type === "download" ? [new URL(step.url).host] : [],
        ),
      ),
    );
    const mirrorHosts = new Set(input.mirrorHosts ?? []);
    const mirrorUp = probe.network.some((host) => mirrorHosts.has(host.host) && host.reachable);
    const offline = probe.network.filter((host) => hosts.has(host.host) && !host.reachable);
    if (offline.length > 0 && !mirrorUp) {
      reasons.push({
        code: "network",
        message: t.network,
        detail: `unreachable: ${offline.map((host) => host.host).join(", ")}`,
      });
    }
  }

  const connectors = (requires.connectors ?? []).map((requirement) => {
    const known = input.connectors.get(requirement.id);
    const configured = input.configuredConnectors.has(requirement.id);
    const name = known?.name ?? requirement.id;
    if (!configured && !requirement.optional) {
      block(
        "connector",
        t.connector(name),
        `connector ${requirement.id} (${known?.envVar ?? "unknown variable"}) is not set up`,
      );
    } else if (!configured) {
      reasons.push({
        code: "optional-connector",
        message: t.optionalConnector(name, requirement.purpose),
        detail: `optional connector ${requirement.id} not set up (${known?.envVar ?? "?"})`,
      });
    }
    return {
      id: requirement.id,
      name,
      configured,
      optional: requirement.optional === true,
      purpose: requirement.purpose ?? null,
    };
  });

  // Run time.
  let runEstimate: string | null = null;
  let runEstimateSeconds: number | null = null;
  if (requires.runTime && status !== "not-compatible") {
    const runTime = requires.runTime;
    const gpuFast = gpuNeed !== undefined && gpu !== null && runTime.gpuSeconds !== undefined;
    const reference = runTime.referenceCpuCores ?? 8;
    let seconds = gpuFast
      ? runTime.gpuSeconds!
      : runTime.seconds * Math.max(0.5, reference / Math.max(1, probe.cpuCores));
    if (hardware.minRamGb !== undefined && probe.totalRamGb < hardware.minRamGb * 1.5)
      seconds *= 1.25;
    runEstimateSeconds = Math.round(seconds);
    runEstimate = t.runEstimate(t.duration(seconds), runTime.unit);
    if (seconds > (runTime.slowAfterSeconds ?? 900)) {
      status = worst(status, "slow");
      reasons.push({
        code: "slow",
        message: t.slow(runEstimate),
        detail: `estimate=${Math.round(seconds)}s cores=${probe.cpuCores} gpu=${gpuFast ? gpu?.name : "not used"}`,
      });
    }
  }

  // Alternatives, only when the task cannot run here as it is (or runs slowly), and only the
  // ones the workflow declares.
  const alternatives: ZenCompatAlternative[] = [];
  if ((status === "not-compatible" || status === "slow") && !input.alternativeId) {
    for (const alternative of input.requires.alternatives ?? []) {
      const variant = evaluateWorkflow({ ...input, alternativeId: alternative.id }).compatibility;
      if (alternative.kind === "lighter" && variant.status === "not-compatible") continue;
      const connector = alternative.connector ? input.connectors.get(alternative.connector) : null;
      const configured = alternative.connector
        ? input.configuredConnectors.has(alternative.connector)
        : true;
      alternatives.push({
        kind: alternative.kind,
        id: alternative.id,
        label: alternative.label,
        description:
          alternative.description ??
          (alternative.kind === "connector"
            ? t.connectorAlternative(connector?.name ?? alternative.connector ?? "")
            : t.lighterAlternative),
        available: alternative.kind === "connector" ? configured : true,
        status: variant.status,
      });
    }
  }

  if (plan.length > 0 && (status === "ready" || status === "slow")) status = "needs-install";

  const toolUses: ZenToolUse[] = uniqueUses.map((use) => {
    const entry = input.tools.get(use.toolId);
    const installed = (use.system ? (input.system ?? []) : input.installed).find(
      (tool) => tool.toolId === use.toolId && tool.version === use.version,
    );
    const source = use.system
      ? (input.system ?? []).find(
          (tool) => tool.toolId === use.toolId && tool.version === use.version,
        )?.source
      : undefined;
    const planned = plan.find(
      (item) => item.entry.id === use.toolId && item.version === use.version,
    );
    return {
      toolId: use.toolId,
      name: entry ? toolName(entry, input.locale) : use.toolId,
      version: use.version,
      dir: installed?.dir ?? null,
      bins: installed?.bins ?? planned?.recipe.bin ?? {},
      optional: use.optional,
      ...(use.system ? { system: true, systemSource: source ?? "" } : {}),
    };
  });
  const usedEntries = [
    ...new Map(
      uniqueUses.flatMap((use) => {
        const entry = input.tools.get(use.toolId);
        return entry ? [[entry.id, entry] as const] : [];
      }),
    ).values(),
  ];
  const install: ZenInstallItem[] = plan.map((item) => ({
    toolId: item.entry.id,
    name: toolName(item.entry, input.locale),
    version: item.version,
    downloadBytes: recipeDownloadBytes(item.recipe),
    diskBytes: item.recipe.installedSize,
    seconds: recipeInstallSeconds(item.recipe, bytesPerSecond),
    reason: item.reason,
    optional: item.optional,
    recipeStatus: item.recipe.status,
    license: item.entry.license,
    untrustedInput: item.entry.untrustedInput,
  }));

  const headline = headlineFor(
    t,
    status,
    reasons,
    install,
    downloadBytes,
    installSeconds,
    runEstimate,
  );
  const details = [
    {
      label: "Computer",
      value: `${probe.hostname} (${OS_NAMES[probe.os]} ${probe.osVersion}, ${probe.arch})`,
    },
    { label: "Processor", value: `${probe.cpuModel}, ${probe.cpuCores} cores` },
    { label: "Memory", value: `${gb(probe.totalRamGb)} total, ${gb(probe.freeRamGb)} free` },
    { label: "Free disk", value: probe.freeDiskGb === null ? "unknown" : gb(probe.freeDiskGb) },
    { label: "Graphics", value: describeGpus(probe.gpus) },
    { label: "Tools folder", value: probe.installDir },
    { label: "Sandbox", value: probe.sandbox },
    ...toolUses.map((tool) => ({
      label: tool.name,
      value: tool.dir
        ? `${tool.version} at ${tool.dir}${tool.system ? ` (already on this computer, ${tool.systemSource}; not checksum-pinned)` : ""}`
        : `${tool.version}: will be installed (${plan.find((item) => item.entry.id === tool.toolId)?.recipe.status ?? "?"} recipe)`,
    })),
    ...plan.flatMap((item) =>
      item.recipe.steps.flatMap((step) =>
        step.type === "download"
          ? [
              {
                label: `Download for ${item.entry.name}`,
                value: `${step.url} sha256 ${step.sha256}`,
              },
            ]
          : [{ label: `Step for ${item.entry.name}`, value: step.type }],
      ),
    ),
    ...reasons.map((reason) => ({ label: reason.code, value: reason.detail })),
  ];

  return {
    compatibility: {
      workflowId: input.workflowId,
      hasRequirements: true,
      status,
      headline,
      reasons,
      install,
      downloadBytes,
      diskBytes,
      installSeconds,
      runEstimate,
      runEstimateSeconds,
      licenseNotes: usedEntries.map((entry) => ({
        toolId: entry.id,
        name: toolName(entry, input.locale),
        commercialUse: entry.license.commercialUse,
        note:
          input.locale === "ro" && entry.license.noteRo ? entry.license.noteRo : entry.license.note,
        url: entry.license.url,
      })),
      connectors,
      alternatives,
      untrustedInputTools: usedEntries
        .filter((entry) => entry.untrustedInput)
        .map((entry) => toolName(entry, input.locale)),
      runsBest: requires.runsBest ?? "either",
      tools: toolUses,
      details,
      machine: { hostname: probe.hostname, companyRunner: probe.companyRunner },
      access: input.access ?? STANDARD_VIEW,
    },
    plan,
    uses: uniqueUses,
  };
}

function headlineFor(
  t: EvalText,
  status: ZenToolchainStatus,
  reasons: ReadonlyArray<ZenCompatReason>,
  install: ReadonlyArray<ZenInstallItem>,
  downloadBytes: number,
  installSeconds: number,
  runEstimate: string | null,
): string {
  switch (status) {
    case "ready":
      return t.ready;
    case "slow":
      return t.readySlow(runEstimate);
    case "needs-install": {
      const names = install.map((item) => item.name).join(", ");
      return t.needsInstall(
        names,
        formatBytes(downloadBytes),
        t.duration(installSeconds),
        setupPurpose(install.map((item) => item.toolId)),
      );
    }
    case "updating":
      return t.updating;
    case "not-compatible": {
      const first = reasons.find(
        (reason) => !reason.code.startsWith("optional") && reason.code !== "network",
      );
      return first ? first.message : t.cannotRun;
    }
  }
}

/**
 * Reference counts for cleanup: which workflows use each installed toolchain (the version the
 * workflow would run with, and its dependencies). Key: "toolId@version".
 */
export function toolchainReferences(
  installed: ReadonlyArray<InstalledToolchainRef>,
  workflows: ReadonlyArray<{
    readonly name: string;
    readonly requires: ZenWorkflowRequires | null;
  }>,
  tools: ReadonlyMap<string, CatalogEntry>,
  blockList: BlockList,
): Map<string, string[]> {
  const refs = new Map<string, string[]>(
    installed.map((tool) => [`${tool.toolId}@${tool.version}`, []]),
  );
  const visit = (toolId: string, range: string | undefined, workflow: string, depth: number) => {
    if (depth > 6) return;
    const matching = installed
      .filter((tool) => tool.toolId === toolId && satisfiesRange(tool.version, range))
      .toSorted((left, right) => {
        const leftSafe = blockReason(blockList, toolId, left.version) === null ? 1 : 0;
        const rightSafe = blockReason(blockList, toolId, right.version) === null ? 1 : 0;
        return rightSafe - leftSafe || compareVersions(right.version, left.version);
      });
    const chosen = matching[0];
    if (!chosen) return;
    const key = `${chosen.toolId}@${chosen.version}`;
    const list = refs.get(key)!;
    if (!list.includes(workflow)) list.push(workflow);
    const version = tools.get(toolId)?.versions.find((v) => v.version === chosen.version);
    for (const dependency of versionDependencies(version)) {
      visit(dependency.id, dependency.version, workflow, depth + 1);
    }
  };
  for (const workflow of workflows) {
    const requires = workflow.requires;
    if (!requires) continue;
    const ids = new Set<string>();
    for (const tool of requires.tools ?? []) {
      ids.add(tool.id);
      visit(tool.id, tool.version, workflow.name, 0);
    }
    // Lighter variants keep their tools too.
    for (const alternative of requires.alternatives ?? []) {
      for (const replacement of Object.values(alternative.replaceTools ?? {})) {
        if (!ids.has(replacement)) visit(replacement, undefined, workflow.name, 0);
      }
    }
  }
  return refs;
}
