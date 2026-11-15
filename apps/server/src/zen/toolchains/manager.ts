// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off extendsNativeError:off processEnvInEffect:off - plain async code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: the toolchain manager, owner of `<zen home>/toolchains/` (one folder per
// <id>/<version>, .cache/ for verified downloads and package caches, .threads/<thread>/bin for
// launchers, state.json, advisories.json). ZEN.md, "Toolchains for workflows".
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ZEN_DEFAULT_TOOLCHAIN_SETTINGS,
  parseZenScheduledWorkflowMarker,
  type ZenAccessOverview,
  type ZenAccessView,
  type ZenAdvisoryFile,
  type ZenConnectorCatalogEntry,
  type ZenInstallJob,
  type ZenInstalledToolchain,
  type ZenMachineProbe,
  type ZenPrepareThreadInput,
  type ZenPreparedThread,
  type ZenToolchainOverview,
  type ZenToolchainRef,
  type ZenToolchainSettings,
  type ZenWorkflowCompatibility,
  type ZenWorkflowRequires,
  type ZenWorkflowStatusSummary,
  type ZenWorkflowTarget,
} from "@t3tools/contracts/zenToolchains";

import {
  blockReason,
  blockedCount,
  mergeBlockLists,
  parseAdvisoryFile,
  type BlockList,
} from "./advisories.ts";
import { parseCatalogEntry, parseConnectors, type CatalogEntry } from "./catalog.ts";
import {
  evaluateWorkflow,
  toolchainReferences,
  type Evaluation,
  type InstalledToolchainRef,
} from "./evaluate.ts";
import {
  MARKER_FILE,
  installToolchain,
  runProcess,
  verifyToolchain,
  type ProcessRunner,
  type ToolchainMarker,
} from "./installer.ts";
import { findOnPath, probeMachine } from "./probe.ts";
import { jobText, toolName, type ZenToolchainLocale } from "./messages.ts";
import { compareVersions } from "./versions.ts";
import { isValidMirrorSetting, resolveMirrorBases } from "./mirror.ts";
import {
  detectSystemTools,
  realDetectDeps,
  type SystemDetection,
  type SystemToolchain,
} from "./systemTools.ts";
import {
  shimFiles,
  unattendedPermissionRules,
  workflowPermissionRules,
  type SandboxPolicy,
} from "./sandbox.ts";
import {
  setZenToolchainThreadResolver,
  setZenUnattendedResolver,
  type ZenThreadToolchain,
  type ZenUnattendedTurn,
  type ZenUnattendedTurnInput,
} from "./threadEnv.ts";
import {
  LOCK_MESSAGES,
  accessView,
  effectiveLedger,
  enterpriseLock,
  logSecretUse,
  normalizeUser,
  readLedger,
  runnerStatus,
  setZenAccessLedgerFile,
  writeLedger,
  type RunnerStatus,
} from "./access.ts";
import { startCredentialProxy, type RunningProxy } from "./credentialProxy.ts";
import { zenCompanyHubBridge } from "../hub/companyPorts.ts";
import { isHubManager, zenHubBridge } from "../hub/hubBridge.ts";
import { SecretVault } from "./vault.ts";
import {
  loadPackRequirements,
  loadPackRequirementsAll,
  loadWorkflowRequirements,
  type WorkflowRequirementsEntry,
} from "./workflowRequirements.ts";

export type FailureReason =
  | "invalid"
  | "not-found"
  | "blocked"
  | "not-ready"
  | "unavailable"
  | "io";

/** https, or plain http only to this machine (a local hub during development). */
export function isAdvisoriesUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export class ToolchainFailure extends Error {
  readonly reason: FailureReason;
  constructor(reason: FailureReason, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

export interface ManagerOptions {
  readonly zenHome: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Folder with tools/, connectors.json, advisories.json, npm/, pip/. */
  readonly catalogDir: string;
  /** Folder with builtin/ and registry.json (the Office workflows). */
  readonly workflowsAssetsDir: string;
  readonly fetch?: typeof fetch;
  readonly run?: ProcessRunner;
  /** Hub advisories file. ZEN_TOOLCHAIN_ADVISORIES_URL; none until the hub serves it. */
  readonly advisoriesUrl?: string | null;
  readonly downloadCacheDir?: string | null;
  /** Test hook: JSON overrides for the probe (ZEN_TOOLCHAIN_FAKE_PROBE). */
  readonly probeOverrideFile?: string | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly probeTtlMs?: number;
  /** Replaces the real probe (tests: no processes, no network). */
  readonly probeImpl?: typeof probeMachine;
  /** The server state dir: the hub file (`zen/hub.json`) says whether this is the company runner. */
  readonly stateDir?: string;
  /** Tests: a vault that never touches the OS keychain. */
  readonly vaultUseKeychain?: boolean;
  /** Replaces the detection of tools already on the computer (tests). */
  readonly detectSystem?: () => Promise<{
    detections: SystemDetection[];
    tools: SystemToolchain[];
  }>;
}

interface ThreadBinding {
  readonly workflowId: string;
  readonly preparedAt: string;
  readonly shimDir: string;
  readonly env: Record<string, string>;
  readonly permissions: { readonly allow: string[]; readonly deny: string[] };
  readonly uses: string[];
}

interface ManagerState {
  settings: ZenToolchainSettings;
  lastUsed: Record<string, string>;
  verify: Record<string, { ok: boolean; output: string; at: string }>;
  threads: Record<string, ThreadBinding>;
}

const emptyState = (): ManagerState => ({
  settings: { ...ZEN_DEFAULT_TOOLCHAIN_SETTINGS },
  lastUsed: {},
  verify: {},
  threads: {},
});

const keyOf = (toolId: string, version: string) => `${toolId}@${version}`;
const COMPANY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ZEN_TOOL_<NAME>: "whisper-python" -> ZEN_TOOL_WHISPER_PYTHON. */
export function toolEnvName(command: string): string {
  return `ZEN_TOOL_${command.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

interface Job {
  view: ZenInstallJob;
  readonly controller: AbortController;
  readonly key: string;
}

export class ToolchainManager {
  readonly root: string;
  readonly cacheDir: string;
  private readonly statePath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly run: ProcessRunner;
  private readonly now: () => Date;
  private tools = new Map<string, CatalogEntry>();
  private connectors = new Map<string, ZenConnectorCatalogEntry>();
  private catalogProblems: string[] = [];
  private shippedAdvisories: ZenAdvisoryFile | null = null;
  private pulledAdvisories: ZenAdvisoryFile | null = null;
  private blockList: BlockList = mergeBlockLists([], []);
  private state: ManagerState = emptyState();
  private probeCache: { at: number; probe: ZenMachineProbe } | null = null;
  private systemCache: {
    at: number;
    found: { detections: SystemDetection[]; tools: SystemToolchain[] };
  } | null = null;
  private probing: Promise<ZenMachineProbe> | null = null;
  private jobs = new Map<string, Job>();
  private installChain: Promise<void> = Promise.resolve();
  private timers: ReturnType<typeof setInterval>[] = [];
  private vaultInstance: SecretVault | null = null;
  /** Secret values for prepared threads (env fallback): memory only, never written to disk. */
  private secretEnv = new Map<string, Record<string, string>>();
  private proxies = new Map<string, RunningProxy>();

  private readonly options: ManagerOptions;

  constructor(options: ManagerOptions) {
    this.options = options;
    const env = options.env ?? process.env;
    this.root = NodePath.join(options.zenHome, "toolchains");
    this.cacheDir =
      options.downloadCacheDir ??
      env.ZEN_TOOLCHAIN_DOWNLOAD_CACHE ??
      NodePath.join(this.root, ".cache", "downloads");
    this.statePath = NodePath.join(this.root, "state.json");
    this.fetchImpl = options.fetch ?? fetch;
    this.run = options.run ?? runProcess;
    this.now = options.now ?? (() => new Date());
  }

  async init(): Promise<void> {
    const toolsDir = NodePath.join(this.options.catalogDir, "tools");
    for (const name of (
      await NodeFS.promises.readdir(toolsDir).catch(() => [] as string[])
    ).toSorted()) {
      if (!name.endsWith(".json")) continue;
      const parsed = parseCatalogEntry(
        await NodeFS.promises.readFile(NodePath.join(toolsDir, name), "utf8"),
      );
      if ("entry" in parsed) this.tools.set(parsed.entry.id, parsed.entry);
      else this.catalogProblems.push(`${name}: ${parsed.error}`);
    }
    const connectorsText = await NodeFS.promises
      .readFile(NodePath.join(this.options.catalogDir, "connectors.json"), "utf8")
      .catch(() => "{}");
    for (const connector of parseConnectors(connectorsText))
      this.connectors.set(connector.id, connector);
    this.shippedAdvisories = parseAdvisoryFile(
      await NodeFS.promises
        .readFile(NodePath.join(this.options.catalogDir, "advisories.json"), "utf8")
        .catch(() => ""),
    );
    this.pulledAdvisories = parseAdvisoryFile(
      await NodeFS.promises
        .readFile(NodePath.join(this.root, "advisories.json"), "utf8")
        .catch(() => ""),
    );
    this.rebuildBlockList();
    try {
      const saved = JSON.parse(
        await NodeFS.promises.readFile(this.statePath, "utf8"),
      ) as Partial<ManagerState>;
      this.state = {
        ...emptyState(),
        ...saved,
        settings: { ...ZEN_DEFAULT_TOOLCHAIN_SETTINGS, ...saved.settings },
      };
    } catch {
      this.state = emptyState();
    }
    await this.removeIncomplete();
    setZenAccessLedgerFile(this.ledgerFile);
    setZenToolchainThreadResolver((threadId) => this.resolveThread(threadId));
    setZenUnattendedResolver((input) => this.unattendedTurn(input));
  }

  /** Background upkeep: advisories, blocked-version updates, unused toolchains. */
  startBackground(): void {
    const tick = () => {
      void this.refreshAdvisories()
        .then(() => this.autoUpdateBlocked())
        .then(() => this.autoRemove())
        .catch(() => undefined);
    };
    setTimeout(tick, 5_000).unref?.();
    const timer = setInterval(tick, 12 * 60 * 60 * 1000);
    timer.unref?.();
    this.timers.push(timer);
  }

  dispose(): void {
    setZenAccessLedgerFile(null);
    for (const proxy of this.proxies.values()) void proxy.close();
    this.proxies.clear();
    for (const timer of this.timers) clearInterval(timer);
    for (const job of this.jobs.values()) job.controller.abort();
    setZenToolchainThreadResolver(null);
    setZenUnattendedResolver(null);
  }

  get catalog(): ReadonlyMap<string, CatalogEntry> {
    return this.tools;
  }

  get problems(): ReadonlyArray<string> {
    return this.catalogProblems;
  }

  private rebuildBlockList() {
    this.blockList = mergeBlockLists(this.tools.values(), [
      this.shippedAdvisories,
      this.pulledAdvisories,
    ]);
  }

  private async saveState(): Promise<void> {
    await NodeFS.promises.mkdir(this.root, { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await NodeFS.promises.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`);
    await NodeFS.promises.rename(temporary, this.statePath);
  }

  /** Folders without a marker are leftovers from an interrupted install. */
  private async removeIncomplete(): Promise<void> {
    for (const toolId of this.tools.keys()) {
      const dir = NodePath.join(this.root, toolId);
      for (const version of await NodeFS.promises.readdir(dir).catch(() => [] as string[])) {
        const folder = NodePath.join(dir, version);
        if (!NodeFS.existsSync(NodePath.join(folder, MARKER_FILE))) {
          const busy = [...this.jobs.values()].some((job) => job.view.state === "running");
          if (!busy)
            await NodeFS.promises
              .rm(folder, { recursive: true, force: true })
              .catch(() => undefined);
        }
      }
    }
  }

  async installed(): Promise<Array<InstalledToolchainRef & { marker: ToolchainMarker }>> {
    const out: Array<InstalledToolchainRef & { marker: ToolchainMarker }> = [];
    for (const toolId of await NodeFS.promises.readdir(this.root).catch(() => [] as string[])) {
      if (toolId.startsWith(".") || !this.tools.has(toolId)) continue;
      for (const version of await NodeFS.promises
        .readdir(NodePath.join(this.root, toolId))
        .catch(() => [] as string[])) {
        const dir = NodePath.join(this.root, toolId, version);
        try {
          const marker = JSON.parse(
            await NodeFS.promises.readFile(NodePath.join(dir, MARKER_FILE), "utf8"),
          ) as ToolchainMarker;
          if (marker.toolId !== toolId || marker.version !== version) continue;
          out.push({
            toolId,
            version,
            dir,
            bins: marker.bins,
            commands: marker.commands,
            env: marker.env,
            marker,
          });
        } catch {
          // not installed (yet)
        }
      }
    }
    return out;
  }

  async probe(refresh = false): Promise<ZenMachineProbe> {
    if (refresh) this.systemCache = null;
    const ttl = this.options.probeTtlMs ?? 10 * 60_000;
    if (!refresh && this.probeCache && Date.now() - this.probeCache.at < ttl) {
      return { ...this.probeCache.probe, companyRunner: this.runner().isRunner };
    }
    if (this.probing) return this.probing;
    const hosts = new Set<string>([
      "registry.npmjs.org",
      "pypi.org",
      "files.pythonhosted.org",
      "storage.googleapis.com",
    ]);
    for (const base of this.mirrorBases()) hosts.add(new URL(base).host);
    const pathNames = new Set<string>();
    for (const entry of this.tools.values()) {
      for (const name of entry.pathNames ?? []) pathNames.add(name);
      for (const version of entry.versions) {
        for (const recipe of version.recipes) {
          for (const step of recipe.steps)
            if (step.type === "download") hosts.add(new URL(step.url).host);
        }
      }
    }
    this.probing = (this.options.probeImpl ?? probeMachine)({
      zenHome: this.options.zenHome,
      installDir: this.root,
      downloadHosts: [...hosts].toSorted(),
      pathNames: [...pathNames].toSorted(),
      companyRunner: this.state.settings.companyRunner,
      platform: this.options.platform,
      arch: this.options.arch,
      overrideFile:
        this.options.probeOverrideFile ??
        (this.options.env ?? process.env).ZEN_TOOLCHAIN_FAKE_PROBE ??
        null,
    }).finally(() => {
      this.probing = null;
    });
    const probe = { ...(await this.probing), companyRunner: this.runner().isRunner };
    this.probeCache = { at: Date.now(), probe };
    return probe;
  }

  private workflowDirs(companyId: string | null | undefined): string[] {
    const dirs = [NodePath.join(this.options.workflowsAssetsDir, "builtin")];
    if (companyId && COMPANY_ID.test(companyId)) {
      dirs.push(NodePath.join(this.options.zenHome, "companies", companyId, "workflows"));
    }
    dirs.push(NodePath.join(this.options.zenHome, "workflows"));
    return dirs;
  }

  /** Workflows of every company, for reference counting. */
  private async allWorkflows(): Promise<WorkflowRequirementsEntry[]> {
    const companies = await NodeFS.promises
      .readdir(NodePath.join(this.options.zenHome, "companies"))
      .catch(() => [] as string[]);
    const dirs = [
      NodePath.join(this.options.workflowsAssetsDir, "builtin"),
      ...companies
        .filter((id) => COMPANY_ID.test(id))
        .map((id) => NodePath.join(this.options.zenHome, "companies", id, "workflows")),
      NodePath.join(this.options.zenHome, "workflows"),
    ];
    const all: WorkflowRequirementsEntry[] = [];
    for (const dir of dirs) all.push(...(await loadWorkflowRequirements([dir])).values());
    return all;
  }

  private async findWorkflow(target: ZenWorkflowTarget): Promise<WorkflowRequirementsEntry> {
    if (target.packId) {
      const pack = await loadPackRequirements(
        NodePath.join(this.options.workflowsAssetsDir, "registry.json"),
        target.packId,
      );
      if (pack) return pack;
    }
    const found = (await loadWorkflowRequirements(this.workflowDirs(target.companyId))).get(
      target.workflowId,
    );
    if (!found) throw new ToolchainFailure("not-found", "This task was not found.");
    return found;
  }

  private configuredConnectors(): Set<string> {
    const env = this.options.env ?? process.env;
    return new Set(
      [...this.connectors.values()]
        .filter((connector) => Boolean(env[connector.envVar]))
        .map((c) => c.id),
    );
  }

  async evaluate(
    workflowId: string,
    requires: ZenWorkflowRequires | null,
    alternativeId?: string | null,
    access?: ZenAccessView,
    locale?: ZenToolchainLocale,
    companyId?: string | null,
  ): Promise<Evaluation> {
    const [probe, installed, system] = await Promise.all([
      this.probe(),
      this.installed(),
      this.systemToolsFor(access, companyId ?? null),
    ]);
    return evaluateWorkflow({
      workflowId,
      requires,
      tools: this.tools,
      connectors: this.connectors,
      configuredConnectors: this.configuredConnectors(),
      probe,
      installed,
      blockList: this.blockList,
      alternativeId: alternativeId ?? null,
      system,
      mirrorHosts: this.mirrorBases().map((base) => new URL(base).host),
      ...(access ? { access } : {}),
      ...(locale ? { locale } : {}),
    });
  }

  private get accessDir() {
    return NodePath.join(this.root, "access");
  }

  private get ledgerFile() {
    return NodePath.join(this.accessDir, "ledger.json");
  }

  private get usageFile() {
    return NodePath.join(this.accessDir, "usage.log");
  }

  private get vault(): SecretVault {
    this.vaultInstance ??= new SecretVault(
      this.accessDir,
      this.options.platform,
      this.options.vaultUseKeychain ?? true,
    );
    return this.vaultInstance;
  }

  runner(): RunnerStatus {
    let hubJson: string | null = null;
    if (this.options.stateDir) {
      try {
        hubJson = NodeFS.readFileSync(
          NodePath.join(this.options.stateDir, "zen", "hub.json"),
          "utf8",
        );
      } catch {
        hubJson = null;
      }
    }
    return runnerStatus(hubJson, this.state.settings.companyRunner);
  }

  /** Secrets are kept only on a runner: elsewhere none is ever stored or read. */
  private hasSecret(workflowId: string, secretId: string): boolean {
    return this.runner().isRunner && this.vault.has(workflowId, secretId);
  }

  /**
   * The Enterprise gate for one person. On a runner serving several companies, `companyId` (the
   * local company the run is for) picks that company's grants; another company's never apply.
   */
  private accessFor(
    workflow: WorkflowRequirementsEntry,
    requester: string | null | undefined,
    companyId?: string | null,
  ) {
    const lock = enterpriseLock({
      packId: workflow.id,
      access: workflow.access,
      problems: workflow.accessProblems,
      runner: this.runner(),
      user: requester,
      ledger: effectiveLedger(this.ledgerFile, companyId),
      hasSecret: (id) => this.hasSecret(workflow.id, id),
    });
    return accessView(workflow.access, lock, (id) => this.hasSecret(workflow.id, id));
  }

  async checkWorkflow(target: ZenWorkflowTarget): Promise<ZenWorkflowCompatibility> {
    const workflow = await this.findWorkflow(target);
    const evaluation = await this.evaluate(
      workflow.id,
      workflow.requires,
      target.alternativeId,
      this.accessFor(workflow, target.requester, target.companyId),
      target.locale,
      target.companyId,
    );
    if (workflow.problem) {
      return {
        ...evaluation.compatibility,
        details: [
          { label: "requires", value: workflow.problem },
          ...evaluation.compatibility.details,
        ],
      };
    }
    return evaluation.compatibility;
  }

  async checkWorkflows(
    companyId: string | null | undefined,
    requester?: string | null,
    locale?: ZenToolchainLocale,
  ): Promise<ZenWorkflowStatusSummary[]> {
    const workflows = await loadWorkflowRequirements(this.workflowDirs(companyId));
    const out: ZenWorkflowStatusSummary[] = [];
    for (const workflow of workflows.values()) {
      const access = this.accessFor(workflow, requester, companyId);
      const { compatibility } = await this.evaluate(
        workflow.id,
        workflow.requires,
        null,
        access,
        locale,
        companyId,
      );
      out.push({
        access,
        workflowId: workflow.id,
        status: compatibility.status,
        headline: compatibility.headline,
        hasRequirements: compatibility.hasRequirements,
      });
    }
    return out;
  }

  job(jobId: string): ZenInstallJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new ToolchainFailure("not-found", "This setup is not running.");
    return job.view;
  }

  cancel(jobId: string): ZenInstallJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new ToolchainFailure("not-found", "This setup is not running.");
    job.controller.abort();
    return job.view;
  }

  async install(target: ZenWorkflowTarget): Promise<ZenInstallJob> {
    const workflow = await this.findWorkflow(target);
    const evaluation = await this.evaluate(
      workflow.id,
      workflow.requires,
      target.alternativeId,
      this.accessFor(workflow, target.requester, target.companyId),
      target.locale,
      target.companyId,
    );
    if (evaluation.compatibility.status === "not-compatible") {
      throw new ToolchainFailure("not-ready", evaluation.compatibility.headline);
    }
    const key = `${workflow.id}:${target.alternativeId ?? ""}`;
    const running = [...this.jobs.values()].find(
      (job) => job.key === key && job.view.state === "running",
    );
    if (running) return running.view;
    return this.startJob(key, workflow.id, evaluation, target.locale);
  }

  private startJob(
    key: string,
    workflowId: string,
    evaluation: Evaluation,
    locale?: ZenToolchainLocale,
  ): ZenInstallJob {
    const text = jobText(locale);
    const controller = new AbortController();
    const jobId = NodeCrypto.randomUUID();
    const job: Job = {
      key,
      controller,
      view: {
        jobId,
        workflowId,
        state: "running",
        message: evaluation.plan.length === 0 ? text.nothing : text.waiting,
        startedAt: this.now().toISOString(),
        finishedAt: null,
        steps: evaluation.plan.map((item) => ({
          toolId: item.entry.id,
          name: toolName(item.entry, locale),
          version: item.version,
          state: "waiting",
          bytes: 0,
          totalBytes: item.recipe.steps.reduce(
            (sum, step) => sum + (step.type === "download" ? step.size : 0),
            0,
          ),
          message: "",
        })),
      },
    };
    this.jobs.set(jobId, job);
    const update = (
      index: number,
      patch: Partial<ZenInstallJob["steps"][number]>,
      message?: string,
    ) => {
      const steps = job.view.steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
      job.view = { ...job.view, steps, ...(message === undefined ? {} : { message }) };
    };
    const finish = (state: ZenInstallJob["state"], message: string) => {
      job.view = { ...job.view, state, message, finishedAt: this.now().toISOString() };
      // Keep finished jobs for a while so the UI can read the result.
      setTimeout(() => this.jobs.delete(jobId), 30 * 60_000).unref?.();
    };
    const work = async () => {
      const probe = await this.probe();
      const os = probe.os === "other" ? "linux" : probe.os;
      let optionalFailures = 0;
      for (const [index, item] of evaluation.plan.entries()) {
        if (controller.signal.aborted) break;
        const existing = (await this.installed()).find(
          (tool) => tool.toolId === item.entry.id && tool.version === item.version,
        );
        if (existing) {
          update(index, { state: "done", message: text.already });
          continue;
        }
        update(index, { state: "downloading" }, text.settingUp(toolName(item.entry, locale)));
        try {
          const installed: InstalledToolchainRef[] = [
            ...(await this.installed()),
            ...evaluation.uses.flatMap((use) =>
              use.system
                ? this.systemCacheTools().filter(
                    (tool) => tool.toolId === use.toolId && tool.version === use.version,
                  )
                : [],
            ),
          ];
          await installToolchain(
            {
              root: this.root,
              cacheDir: this.cacheDir,
              catalogDir: this.options.catalogDir,
              os,
              signal: controller.signal,
              fetch: this.fetchImpl,
              run: this.run,
              mirrors: this.mirrorBases(),
              ...(locale ? { locale } : {}),
              onProgress: (progress) =>
                update(index, {
                  state: progress.state,
                  ...(progress.bytes === undefined ? {} : { bytes: progress.bytes }),
                  ...(progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes }),
                  ...(progress.message === undefined ? {} : { message: progress.message }),
                }),
              dependency: (toolId) =>
                installed
                  .filter(
                    (tool) =>
                      tool.toolId === toolId &&
                      blockReason(this.blockList, toolId, tool.version) === null,
                  )
                  .toSorted((left, right) => compareVersions(right.version, left.version))[0] ??
                null,
            },
            item.entry,
            item.version,
            item.recipe,
          );
          this.state.lastUsed[keyOf(item.entry.id, item.version)] = this.now().toISOString();
          update(index, { state: "done", message: text.installed });
        } catch (error) {
          const cancelled = controller.signal.aborted;
          const message = error instanceof Error ? error.message : String(error);
          update(index, { state: cancelled ? "cancelled" : "failed", message });
          if (cancelled) break;
          if (item.optional) {
            optionalFailures++;
            continue;
          }
          await this.saveState().catch(() => undefined);
          finish("failed", text.failed(toolName(item.entry, locale), message));
          return;
        }
      }
      await this.saveState().catch(() => undefined);
      if (controller.signal.aborted) {
        job.view = {
          ...job.view,
          steps: job.view.steps.map((step) =>
            step.state === "done" || step.state === "failed"
              ? step
              : { ...step, state: "cancelled" },
          ),
        };
        finish("cancelled", text.cancelled);
        return;
      }
      finish("done", optionalFailures > 0 ? text.readyOptional : text.ready);
    };
    // One install at a time: two workflows needing the same tool never race.
    this.installChain = this.installChain.then(() =>
      work().catch((error: unknown) =>
        finish("failed", error instanceof Error ? error.message : String(error)),
      ),
    );
    return job.view;
  }

  async overview(): Promise<ZenToolchainOverview> {
    const [installed, workflows, probe] = await Promise.all([
      this.installed(),
      this.allWorkflows(),
      this.probe(),
    ]);
    const refs = toolchainReferences(installed, workflows, this.tools, this.blockList);
    const list: ZenInstalledToolchain[] = installed
      .map((tool) => {
        const key = keyOf(tool.toolId, tool.version);
        const entry = this.tools.get(tool.toolId)!;
        return {
          toolId: tool.toolId,
          name: entry.name,
          version: tool.version,
          dir: tool.dir,
          sizeBytes: tool.marker.sizeBytes,
          installedAt: tool.marker.installedAt,
          lastUsedAt: this.state.lastUsed[key] ?? null,
          usedBy: refs.get(key) ?? [],
          blocked: blockReason(this.blockList, tool.toolId, tool.version),
          lastVerify: this.state.verify[key] ?? null,
          license: entry.license,
        };
      })
      .toSorted(
        (left, right) =>
          left.name.localeCompare(right.name) || right.version.localeCompare(left.version),
      );
    return {
      root: this.root,
      installed: list,
      settings: this.state.settings,
      totalBytes: list.reduce((sum, tool) => sum + tool.sizeBytes, 0),
      unusedCount: list.filter((tool) => tool.usedBy.length === 0).length,
      sandbox: probe.sandbox,
      advisories: {
        source: this.blockList.source,
        generatedAt: this.blockList.generatedAt,
        blockedCount: blockedCount(this.blockList),
      },
      systemTools: (await this.detectSystem()).detections.map((found) => {
        const blocked =
          found.accepted && found.version !== null
            ? blockReason(this.blockList, found.toolId, found.version)
            : null;
        return {
          toolId: found.toolId,
          name: this.tools.get(found.toolId)?.name ?? found.toolId,
          path: found.path,
          version: found.version,
          source: found.source,
          usable: found.accepted && blocked === null,
          reason: blocked ?? found.reason,
        };
      }),
    };
  }

  async verify(ref: ZenToolchainRef): Promise<ZenToolchainOverview> {
    const tool = (await this.installed()).find(
      (t) => t.toolId === ref.toolId && t.version === ref.version,
    );
    const entry = this.tools.get(ref.toolId);
    if (!tool || !entry) throw new ToolchainFailure("not-found", "This tool is not installed.");
    const probe = await this.probe();
    const result = await verifyToolchain(
      entry,
      tool.marker,
      tool.dir,
      this.run,
      AbortSignal.timeout(90_000),
      probe.os === "other" ? "linux" : probe.os,
    );
    this.state.verify[keyOf(ref.toolId, ref.version)] = { ...result, at: this.now().toISOString() };
    await this.saveState();
    return this.overview();
  }

  private async removeFolder(toolId: string, version: string): Promise<void> {
    const dir = NodePath.join(this.root, toolId, version);
    if (!dir.startsWith(this.root + NodePath.sep))
      throw new ToolchainFailure("invalid", "Bad tool.");
    // Drop the marker first: a half-removed folder is never seen as installed.
    await NodeFS.promises.rm(NodePath.join(dir, MARKER_FILE), { force: true });
    await NodeFS.promises.rm(dir, { recursive: true, force: true });
    delete this.state.lastUsed[keyOf(toolId, version)];
    delete this.state.verify[keyOf(toolId, version)];
  }

  async remove(ref: ZenToolchainRef): Promise<ZenToolchainOverview> {
    if ([...this.jobs.values()].some((job) => job.view.state === "running")) {
      throw new ToolchainFailure("unavailable", "Wait for the running setup to finish first.");
    }
    const tool = (await this.installed()).find(
      (t) => t.toolId === ref.toolId && t.version === ref.version,
    );
    if (!tool) throw new ToolchainFailure("not-found", "This tool is not installed.");
    await this.removeFolder(ref.toolId, ref.version);
    await this.saveState();
    return this.overview();
  }

  /** Removes toolchains no workflow uses (reference count zero). */
  async cleanup(): Promise<ZenToolchainOverview> {
    if ([...this.jobs.values()].some((job) => job.view.state === "running")) {
      throw new ToolchainFailure("unavailable", "Wait for the running setup to finish first.");
    }
    const overview = await this.overview();
    for (const tool of overview.installed.filter((t) => t.usedBy.length === 0)) {
      await this.removeFolder(tool.toolId, tool.version);
    }
    await this.saveState();
    return this.overview();
  }

  /** Removes toolchains not used for `autoRemoveDays` (0 = never). Returns what was removed. */
  async autoRemove(): Promise<string[]> {
    const days = this.state.settings.autoRemoveDays;
    if (!(days > 0)) return [];
    if ([...this.jobs.values()].some((job) => job.view.state === "running")) return [];
    const cutoff = this.now().getTime() - days * DAY_MS;
    const removed: string[] = [];
    for (const tool of await this.installed()) {
      const key = keyOf(tool.toolId, tool.version);
      const last = Date.parse(this.state.lastUsed[key] ?? tool.marker.installedAt);
      if (Number.isFinite(last) && last < cutoff) {
        await this.removeFolder(tool.toolId, tool.version);
        removed.push(key);
      }
    }
    // Launchers of old threads go too.
    for (const [threadId, binding] of Object.entries(this.state.threads)) {
      if (Date.parse(binding.preparedAt) < cutoff) {
        await NodeFS.promises
          .rm(NodePath.dirname(binding.shimDir), { recursive: true, force: true })
          .catch(() => undefined);
        delete this.state.threads[threadId];
      }
    }
    await this.saveState();
    return removed;
  }

  /** Usable tools on this computer for one run, after the person's and the admin's settings. */
  async systemToolsFor(
    access: ZenAccessView | undefined,
    companyId: string | null,
  ): Promise<SystemToolchain[]> {
    const settings = this.state.settings;
    if (settings.useSystemTools === false) return [];
    if (access?.tier === "enterprise") return [];
    if (settings.companyPinned && (companyId !== null || this.runner().isRunner)) return [];
    const pinned = new Set(settings.pinnedTools ?? []);
    return (await this.detectSystem()).tools.filter((tool) => !pinned.has(tool.toolId));
  }

  /** What was found on this computer (cached like the probe; refresh with the probe). */
  async detectSystem(refresh = false): Promise<{
    detections: SystemDetection[];
    tools: SystemToolchain[];
  }> {
    const ttl = this.options.probeTtlMs ?? 10 * 60_000;
    if (!refresh && this.systemCache && Date.now() - this.systemCache.at < ttl) {
      return this.systemCache.found;
    }
    // Tests that fake the probe get no real detection unless they pass one.
    const detect =
      this.options.detectSystem ??
      (this.options.probeImpl
        ? null
        : async () => {
            const os =
              this.options.platform === "win32"
                ? "windows"
                : this.options.platform === "darwin"
                  ? "macos"
                  : "linux";
            return detectSystemTools(
              realDetectDeps(os, this.options.env ?? process.env),
              this.tools,
            );
          });
    const found = detect
      ? await detect().catch(() => ({ detections: [], tools: [] }))
      : { detections: [], tools: [] };
    this.systemCache = { at: Date.now(), found };
    return found;
  }

  private systemCacheTools(): SystemToolchain[] {
    return this.systemCache?.found.tools ?? [];
  }

  /** Mirror bases tried before official URLs (mirror.ts): env, then Settings, then ours. */
  mirrorBases(): ReadonlyArray<string> {
    const env = this.options.env ?? process.env;
    return resolveMirrorBases(env.ZEN_TOOLS_MIRROR, this.state.settings.toolsMirror);
  }

  async setSettings(settings: ZenToolchainSettings): Promise<ZenToolchainOverview> {
    if ((settings.companyPinned ?? false) !== (this.state.settings.companyPinned ?? false)) {
      // Only the company's owners and admins (on a hub runner the hub's role decides).
      const bridge = zenHubBridge();
      if (bridge?.accessLedger() != null && !isHubManager(bridge.runnerRole())) {
        throw new ToolchainFailure("blocked", "Only the company's owners and admins can do this.");
      }
    }
    if ((settings.pinnedTools ?? []).some((id) => !this.tools.has(id))) {
      throw new ToolchainFailure("invalid", "Unknown tool in pinnedTools.");
    }
    if (settings.toolsMirror !== undefined && !isValidMirrorSetting(settings.toolsMirror)) {
      throw new ToolchainFailure(
        "invalid",
        'The mirror must be "default", "off" or an https address.',
      );
    }
    if (
      !Number.isInteger(settings.autoRemoveDays) ||
      settings.autoRemoveDays < 0 ||
      settings.autoRemoveDays > 3650
    ) {
      throw new ToolchainFailure("invalid", "Days must be a whole number from 0 to 3650.");
    }
    this.state.settings = { ...settings };
    await this.saveState();
    if (this.probeCache)
      this.probeCache = {
        ...this.probeCache,
        probe: { ...this.probeCache.probe, companyRunner: settings.companyRunner },
      };
    return this.overview();
  }

  async refreshAdvisories(): Promise<boolean> {
    const env = this.options.env ?? process.env;
    // Explicit setting first, then the signed-in hub (which publishes the night job's file).
    const url =
      this.options.advisoriesUrl ??
      env.ZEN_TOOLCHAIN_ADVISORIES_URL ??
      zenHubBridge()?.advisoriesUrl?.() ??
      null;
    if (!url || !isAdvisoriesUrl(url)) return false;
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return false;
      const text = await response.text();
      const parsed = parseAdvisoryFile(text);
      if (!parsed) return false;
      // Never go back in time (a stale mirror cannot unblock a version).
      if (this.pulledAdvisories && parsed.generatedAt < this.pulledAdvisories.generatedAt)
        return false;
      await NodeFS.promises.mkdir(this.root, { recursive: true });
      await NodeFS.promises.writeFile(NodePath.join(this.root, "advisories.json"), text);
      this.pulledAdvisories = parsed;
      this.rebuildBlockList();
      return true;
    } catch {
      return false;
    }
  }

  /** For use in tests and by the hub client: apply an advisories file directly. */
  applyAdvisories(file: ZenAdvisoryFile): void {
    this.pulledAdvisories = file;
    this.rebuildBlockList();
  }

  /**
   * Installs safe replacements for blocked toolchains that workflows still use, so the next run
   * does not wait. Workflows check again at start and refuse a blocked version anyway.
   */
  async autoUpdateBlocked(): Promise<string[]> {
    const started: string[] = [];
    const workflows = await this.allWorkflows();
    const installed = await this.installed();
    const blocked = installed.filter(
      (tool) => blockReason(this.blockList, tool.toolId, tool.version) !== null,
    );
    if (blocked.length === 0) return started;
    for (const workflow of workflows) {
      if (!workflow.requires) continue;
      const uses = new Set((workflow.requires.tools ?? []).map((tool) => tool.id));
      if (!blocked.some((tool) => uses.has(tool.toolId))) continue;
      const evaluation = await this.evaluate(workflow.id, workflow.requires);
      if (evaluation.compatibility.status !== "updating") continue;
      this.startJob(`${workflow.id}:auto`, workflow.id, {
        ...evaluation,
        plan: evaluation.plan.filter((item) => item.reason === "safety-update"),
      });
      started.push(workflow.id);
    }
    return started;
  }

  async prepareThread(input: ZenPrepareThreadInput): Promise<ZenPreparedThread> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.threadId))
      throw new ToolchainFailure("invalid", "Bad thread id.");
    const workflow = await this.findWorkflow(input);
    // The enterprise gate, checked here on the machine that runs the thread.
    const access = this.accessFor(workflow, input.requester, input.companyId);
    if (access.lock) {
      throw new ToolchainFailure(
        access.lock.code === "invalid" ? "invalid" : "blocked",
        access.lock.message,
      );
    }
    const secrets = await this.prepareSecrets(workflow, input);
    if (!workflow.requires) {
      if (secrets.lines.length === 0) return { appendix: "", env: {}, sandbox: "none" };
      const threadDir = NodePath.join(this.root, ".threads", input.threadId);
      await NodeFS.promises.mkdir(NodePath.join(threadDir, "bin"), { recursive: true });
      this.state.threads[input.threadId] = {
        workflowId: workflow.id,
        preparedAt: this.now().toISOString(),
        shimDir: NodePath.join(threadDir, "bin"),
        env: secrets.env,
        permissions: workflowPermissionRules([], NodePath.join(threadDir, "bin")),
        uses: [],
      };
      await this.saveState();
      return { appendix: ["---", ...secrets.lines].join("\n"), env: secrets.env, sandbox: "none" };
    }
    const evaluation = await this.evaluate(
      workflow.id,
      workflow.requires,
      input.alternativeId,
      access,
      input.locale,
      input.companyId,
    );
    const compatibility = evaluation.compatibility;
    if (compatibility.status === "not-compatible") {
      const blocked = compatibility.reasons.some((reason) => reason.code === "blocked");
      throw new ToolchainFailure(blocked ? "blocked" : "not-ready", compatibility.headline);
    }
    // Optional tools that are not installed are simply left out.
    const missingRequired = evaluation.plan.filter((item) => !item.optional);
    if (missingRequired.length > 0) {
      throw new ToolchainFailure(
        compatibility.status === "updating" ? "blocked" : "not-ready",
        compatibility.status === "updating"
          ? "A tool is being updated for safety. Run the setup first."
          : `Set up ${missingRequired.map((item) => item.entry.name).join(", ")} first.`,
      );
    }
    const probe = await this.probe();
    const installed = await this.installed();
    const system = await this.systemToolsFor(access, input.companyId ?? null);
    const uses: InstalledToolchainRef[] = evaluation.uses
      .map((use) =>
        (use.system ? system : installed).find(
          (tool) => tool.toolId === use.toolId && tool.version === use.version,
        ),
      )
      .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);
    for (const tool of uses) {
      const reason = blockReason(this.blockList, tool.toolId, tool.version);
      if (reason)
        throw new ToolchainFailure(
          "blocked",
          `${tool.toolId} ${tool.version} is blocked for safety: ${reason}`,
        );
    }

    const threadDir = NodePath.join(this.root, ".threads", input.threadId);
    const shimDir = NodePath.join(threadDir, "bin");
    await NodeFS.promises.rm(threadDir, { recursive: true, force: true });
    await NodeFS.promises.mkdir(shimDir, { recursive: true });
    const platform = probe.os === "windows" ? "windows" : probe.os === "macos" ? "macos" : "linux";
    const shimPath = (name: string) =>
      NodePath.join(shimDir, platform === "windows" ? `${name}.cmd` : name);
    const recipeEnv: Record<string, string> = {};
    for (const tool of uses) Object.assign(recipeEnv, tool.env);
    const commandNames: string[] = [];
    const toolVars: Record<string, string> = {};
    for (const tool of uses) {
      for (const name of Object.keys(tool.commands)) {
        commandNames.push(name);
        toolVars[toolEnvName(name)] = shimPath(name);
      }
    }
    // The credential proxy listens on 127.0.0.1, so a thread with credentials keeps loopback.
    const network = workflow.requires.network === true || secrets.network;
    const sandboxProgram =
      probe.sandbox === "bwrap"
        ? findOnPath("bwrap")
        : probe.sandbox === "sandbox-exec"
          ? "/usr/bin/sandbox-exec"
          : null;
    const policy: SandboxPolicy = {
      kind: sandboxProgram ? probe.sandbox : "none",
      platform,
      workDir: NodePath.resolve(input.cwd),
      // The launchers too, so one tool can call another ($ZEN_TOOL_FFMPEG from a node script).
      readOnlyDirs: [...new Set([...uses.map((tool) => tool.dir), workflow.folder, shimDir])],
      network,
      env: { ...recipeEnv, ...toolVars },
    };
    for (const tool of uses) {
      for (const [name, command] of Object.entries(tool.commands)) {
        for (const file of shimFiles({ name, command }, policy, sandboxProgram)) {
          await NodeFS.promises.writeFile(NodePath.join(shimDir, file.fileName), file.content, {
            mode: file.mode,
          });
        }
      }
    }
    const env: Record<string, string> = {
      ...recipeEnv,
      ...toolVars,
      ...secrets.env,
      ZEN_TOOLCHAINS_SANDBOX: policy.kind,
      ZEN_WORKFLOW_DIR: workflow.folder,
      ZEN_TASK_DIR: policy.workDir,
    };
    const permissions = workflowPermissionRules(commandNames, shimDir);
    const nowIso = this.now().toISOString();
    for (const tool of uses) this.state.lastUsed[keyOf(tool.toolId, tool.version)] = nowIso;
    this.state.threads[input.threadId] = {
      workflowId: workflow.id,
      preparedAt: nowIso,
      shimDir,
      env,
      permissions,
      uses: uses.map((tool) => keyOf(tool.toolId, tool.version)),
    };
    await this.saveState();

    const sandboxLine =
      policy.kind === "none"
        ? "These tools run without a sandbox on this computer; keep every file you write inside the task folder."
        : `These tools run in a sandbox (${policy.kind}): they can write only inside ${policy.workDir}${network ? "" : " and have no internet access"}.`;
    const appendix = [
      "---",
      "Tools prepared for this task. Use these exact commands (they are on PATH; the absolute paths are given in case PATH is not inherited). Do not install anything else and do not download programs.",
      ...commandNames.map((name) => `- ${name}: ${shimPath(name)} (also $${toolEnvName(name)})`),
      ...Object.entries(recipeEnv).map(([name, value]) => `- ${name}=${value}`),
      `- Workflow files (read only): ${workflow.folder} (also $ZEN_WORKFLOW_DIR)`,
      `- Task folder (write results here): ${policy.workDir}`,
      sandboxLine,
      ...secrets.lines,
    ].join("\n");
    return { appendix, env, sandbox: policy.kind };
  }

  /**
   * The rules of an unattended scheduled run: the prompt names the workflow
   * (`[zen-workflow: <id>]`), the workflow declares an `unattended` block and passes its access
   * gate. A workflow with tools gets the thread prepared first (launchers), like an Office start.
   * Null means a normal turn (the thread's own approval mode applies).
   */
  async unattendedTurn(input: ZenUnattendedTurnInput): Promise<ZenUnattendedTurn | null> {
    const workflowId = parseZenScheduledWorkflowMarker(input.prompt);
    if (workflowId === null || !input.cwd) return null;
    const workflow = (await this.allWorkflows()).findLast((entry) => entry.id === workflowId);
    if (!workflow?.unattended) return null;
    const companyId = companyOfWorkflowFolder(this.options.zenHome, workflow.folder);
    if (this.accessFor(workflow, null, companyId).lock) return null;
    if (workflow.requires && !this.state.threads[input.threadId]) {
      await this.prepareThread({
        workflowId,
        threadId: input.threadId,
        cwd: input.cwd,
        ...(companyId ? { companyId } : {}),
      });
    }
    const binding = this.state.threads[input.threadId] ?? null;
    const permissions = unattendedPermissionRules({
      commands: workflow.unattended.commands,
      agentTools: workflow.unattended.tools ?? [],
      shimDir: binding?.shimDir ?? null,
      taskDir: NodePath.resolve(input.cwd),
      workflowDir: workflow.folder,
      toolAllow: binding?.permissions.allow ?? [],
    });
    return {
      workflowId,
      env: {
        ...binding?.env,
        ...this.secretEnv.get(input.threadId),
        ZEN_WORKFLOW_DIR: workflow.folder,
        ZEN_TASK_DIR: NodePath.resolve(input.cwd),
      },
      pathFirst: binding?.shimDir ?? null,
      permissions,
    };
  }

  resolveThread(threadId: string): ZenThreadToolchain | null {
    const binding = this.state.threads[threadId];
    if (!binding) return null;
    return {
      env: { ...binding.env, ...this.secretEnv.get(threadId) },
      pathFirst: binding.shimDir,
      permissions: binding.permissions,
    };
  }

  /**
   * Credentials for an enterprise thread (on the runner; the gate already passed). A secret with
   * declared API hosts goes through the credential proxy: the thread sees only
   * ZEN_SECRET_<ID>_URL. Without hosts, the value is injected as ZEN_SECRET_<ID> into that
   * thread's process only (memory, never saved). Every use is logged.
   */
  private async prepareSecrets(
    workflow: WorkflowRequirementsEntry,
    input: ZenPrepareThreadInput,
  ): Promise<{ env: Record<string, string>; lines: string[]; network: boolean }> {
    const secrets = workflow.access.tier === "enterprise" ? (workflow.access.secrets ?? []) : [];
    if (secrets.length === 0) return { env: {}, lines: [], network: false };
    const user = normalizeUser(input.requester);
    const env: Record<string, string> = {};
    const hidden: Record<string, string> = {};
    const lines = [
      "Company credentials for this task (never print them, never write them to files):",
    ];
    const routed = secrets.filter((secret) => (secret.apiHosts ?? []).length > 0);
    await this.proxies.get(input.threadId)?.close();
    if (routed.length > 0) {
      const proxy = await startCredentialProxy(
        routed.map((secret) => ({
          secretId: secret.id,
          hosts: secret.apiHosts ?? [],
          header: secret.header ?? "Authorization: Bearer {secret}",
          value: () => this.vault.get(workflow.id, secret.id),
        })),
        (secretId, host) =>
          logSecretUse(this.usageFile, {
            workflowId: workflow.id,
            user,
            threadId: input.threadId,
            secretId,
            kind: "proxy",
            host,
          }),
      );
      this.proxies.set(input.threadId, proxy);
      for (const secret of routed) {
        const name = `ZEN_SECRET_${secret.id.toUpperCase()}_URL`;
        env[name] = `${proxy.url}/${secret.id}`;
        lines.push(
          `- ${secret.label}: call ${secret.apiHosts!.join(" or ")} through $${name} (for example $${name}/v1/...; add /@<host> after the id for another declared host). The key is added for you.`,
        );
      }
    }
    for (const secret of secrets.filter((candidate) => (candidate.apiHosts ?? []).length === 0)) {
      const value = this.vault.get(workflow.id, secret.id);
      if (value === null)
        throw new ToolchainFailure(
          "not-ready",
          `The ${secret.label} on this server cannot be read. Ask an admin to enter it again.`,
        );
      hidden[`ZEN_SECRET_${secret.id.toUpperCase()}`] = value;
      lines.push(
        `- ${secret.label}: in the environment variable $ZEN_SECRET_${secret.id.toUpperCase()}.`,
      );
    }
    for (const secret of secrets) {
      logSecretUse(this.usageFile, {
        workflowId: workflow.id,
        user,
        threadId: input.threadId,
        secretId: secret.id,
        kind: "prepared",
      });
    }
    this.secretEnv.set(input.threadId, hidden);
    return { env, lines, network: routed.length > 0 };
  }

  /**
   * Hub v9, one server for several companies: the Enterprise screen works on one served company
   * at a time (`companyId`, a hub company id; absent: the first one). Null: no hub here.
   */
  private hubScope(companyId?: string | null | undefined) {
    const bridge = zenHubBridge();
    const served = bridge?.servedCompanies?.() ?? [];
    if (bridge === null || bridge.accessLedger() === null || served.length === 0) return null;
    const chosen =
      companyId == null ? served[0]! : served.find((company) => company.id === companyId);
    if (chosen === undefined) {
      throw new ToolchainFailure("blocked", "This machine is not the server of that company.");
    }
    return {
      bridge,
      companyId: chosen.id,
      ledger: bridge.ledgerOfHubCompany?.(chosen.id) ?? { grants: [], approvals: [] },
      companies: served.map((company) => ({
        id: company.id,
        name: company.name,
        manager: isHubManager(company.role),
      })),
    };
  }

  async accessOverview(
    input: { readonly companyId?: string | null | undefined } = {},
  ): Promise<ZenAccessOverview> {
    const scope = this.hubScope(input.companyId);
    const workflows = await this.allWorkflows();
    const registry = await loadPackRequirementsAll(
      NodePath.join(this.options.workflowsAssetsDir, "registry.json"),
    );
    const byId = new Map<string, { entry: WorkflowRequirementsEntry; installed: boolean }>();
    for (const entry of registry) byId.set(entry.id, { entry, installed: false });
    for (const entry of workflows) byId.set(entry.id, { entry, installed: true });
    const ledger = scope?.ledger ?? effectiveLedger(this.ledgerFile);
    const runner = this.runner();
    let usage: ZenAccessOverview["usage"] = [];
    try {
      usage = NodeFS.readFileSync(this.usageFile, "utf8")
        .trim()
        .split("\n")
        .slice(-50)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as ZenAccessOverview["usage"][number]];
          } catch {
            return [];
          }
        })
        .toReversed();
    } catch {
      usage = [];
    }
    return {
      runner,
      keyStore: runner.isRunner ? this.vault.keyStore : "file",
      ...(scope === null ? {} : { companies: scope.companies, companyId: scope.companyId }),
      packs: [...byId.values()]
        .filter(({ entry }) => entry.access.tier === "enterprise")
        .map(({ entry, installed }) => ({
          workflowId: entry.id,
          name: entry.name,
          installed,
          approved: ledger.approvals.some((approval) => approval.packId === entry.id),
          access: this.accessFor(entry, runner.hubUser),
          grants: ledger.grants
            .filter((grant) => grant.packId === entry.id)
            .map(({ user, grantedBy, at }) => ({ user, grantedBy, at })),
        })),
      usage,
    };
  }

  private adminName(adminConfirmed: boolean, companyId?: string | null): string {
    if (!adminConfirmed) {
      throw new ToolchainFailure("invalid", "A company admin must confirm this.");
    }
    // On a hub runner the hub's role decides: owner or admin of the company the action is for
    // (each served company on its own, never the first one's role for another).
    const bridge = zenHubBridge();
    if (bridge?.accessLedger() != null && !isHubManager(bridge.runnerRole(companyId ?? null))) {
      throw new ToolchainFailure("blocked", "Only the company's owners and admins can do this.");
    }
    return this.runner().hubUser ?? "local admin";
  }

  /** The hub company a local company is linked to, when this server serves it (else null). */
  private linkedServedCompany(localCompanyId: string | null | undefined): string | null {
    if (localCompanyId == null) return null;
    const served = zenHubBridge()?.servedCompanies?.() ?? [];
    const linked = zenCompanyHubBridge()?.link(localCompanyId)?.hubCompanyId ?? null;
    if (linked === null) return null;
    if (!served.some((company) => company.id === linked)) {
      throw new ToolchainFailure("blocked", "This machine is not the server of that company.");
    }
    return linked;
  }

  /** On a hub runner, grants live on the hub (signed by this device); null means "use the file". */
  private hubGrants() {
    const bridge = zenHubBridge();
    return bridge !== null && bridge.accessLedger() !== null ? bridge : null;
  }

  async setSecret(input: {
    workflowId: string;
    secretId: string;
    value: string;
  }): Promise<ZenAccessOverview> {
    if (!this.runner().isRunner) {
      throw new ToolchainFailure("blocked", LOCK_MESSAGES.needsRunner);
    }
    const workflow = (await this.allWorkflows()).find((entry) => entry.id === input.workflowId);
    const secret = workflow?.access.secrets?.find((candidate) => candidate.id === input.secretId);
    if (!workflow || !secret)
      throw new ToolchainFailure("not-found", "This workflow does not use that credential.");
    if (input.value.trim().length === 0)
      throw new ToolchainFailure("invalid", "Paste the key first.");
    this.vault.set(workflow.id, secret.id, input.value.trim());
    return this.accessOverview();
  }

  async removeSecret(input: { workflowId: string; secretId: string }): Promise<ZenAccessOverview> {
    this.vault.remove(input.workflowId, input.secretId);
    return this.accessOverview();
  }

  async grant(input: {
    packId: string;
    user: string;
    adminConfirmed: boolean;
    companyId?: string | null | undefined;
  }): Promise<ZenAccessOverview> {
    const companyId = this.hubScope(input.companyId)?.companyId ?? null;
    const by = this.adminName(input.adminConfirmed, companyId);
    const user = normalizeUser(input.user);
    const hub = this.hubGrants();
    if (hub !== null) {
      await hub.grant({ packId: input.packId, user, companyId });
      return this.accessOverview({ companyId });
    }
    const ledger = readLedger(this.ledgerFile);
    if (!ledger.grants.some((grant) => grant.packId === input.packId && grant.user === user)) {
      writeLedger(this.ledgerFile, {
        ...ledger,
        grants: [
          ...ledger.grants,
          { packId: input.packId, user, grantedBy: by, at: this.now().toISOString() },
        ],
      });
    }
    return this.accessOverview();
  }

  async revoke(input: {
    packId: string;
    user: string;
    companyId?: string | null | undefined;
  }): Promise<ZenAccessOverview> {
    const user = normalizeUser(input.user);
    const hub = this.hubGrants();
    if (hub !== null) {
      const companyId = this.hubScope(input.companyId)?.companyId ?? null;
      this.adminName(true, companyId);
      await hub.revoke({ packId: input.packId, user, companyId });
      return this.accessOverview({ companyId });
    }
    const ledger = readLedger(this.ledgerFile);
    writeLedger(this.ledgerFile, {
      ...ledger,
      grants: ledger.grants.filter(
        (grant) => !(grant.packId === input.packId && grant.user === user),
      ),
    });
    return this.accessOverview();
  }

  async approveInstall(input: {
    packId: string;
    adminConfirmed: boolean;
    companyId?: string | null | undefined;
    localCompanyId?: string | null | undefined;
  }): Promise<ZenAccessOverview> {
    const hub = this.hubGrants();
    // The approval belongs to one company: the one asked for, else the marketplace company's
    // linked hub company, else the first one this server serves.
    const companyId =
      hub === null
        ? null
        : input.companyId != null
          ? (this.hubScope(input.companyId)?.companyId ?? null)
          : (this.hubScope(this.linkedServedCompany(input.localCompanyId))?.companyId ?? null);
    const by = this.adminName(input.adminConfirmed, companyId);
    if (hub !== null) {
      await hub.approveInstall({ packId: input.packId, companyId });
      return this.accessOverview({ companyId });
    }
    const ledger = readLedger(this.ledgerFile);
    if (!ledger.approvals.some((approval) => approval.packId === input.packId)) {
      writeLedger(this.ledgerFile, {
        ...ledger,
        approvals: [
          ...ledger.approvals,
          { packId: input.packId, approvedBy: by, at: this.now().toISOString() },
        ],
      });
    }
    return this.accessOverview();
  }
}

/** The company of a workflow folder under `<zen home>/companies/<id>/workflows`, else null. */
function companyOfWorkflowFolder(zenHome: string, folder: string): string | null {
  const relative = NodePath.relative(NodePath.join(zenHome, "companies"), folder);
  if (relative.startsWith("..") || NodePath.isAbsolute(relative)) return null;
  const [companyId, workflows] = relative.split(NodePath.sep);
  return companyId && workflows === "workflows" && COMPANY_ID.test(companyId) ? companyId : null;
}
