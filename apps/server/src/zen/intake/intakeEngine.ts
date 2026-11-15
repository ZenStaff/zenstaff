// @effect-diagnostics nodeBuiltinImport:off globalDate:off extendsNativeError:off - plain async code over small owner-only JSON files (wrapped by ZenOffice.ts).
// Zen Staff chat-first task start (ZEN.md, "Chat-first task start"). A workflow card opens a chat:
// `workflow.start` builds the first message (the workflow's questions as the agent's checklist,
// what the company profile, memory, folder, last run and connections already say) and remembers
// the thread. The agent asks only for what is missing, shows quick replies with `intake_ask`,
// and calls `intake_ready` with the answers, which returns the workflow's own message to run in
// the same turn; `intake_schedule` turns "every week?" into a scheduled task (saved by the web,
// which already knows how). The same chat sets up a new AI employee (`hire.start`,
// `hire_propose`; the web saves the approved profile through `zen.staff.call`).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  buildHireSetupMessage,
  buildIntakeMessage,
  checkIntakeValues,
  extractLinks,
  normalizeChips,
  normalizeHireProposal,
  normalizeScheduleRequest,
  prefillIntake,
  intakeRunFolder,
  type HireConnection,
  type HireProposal,
  type IntakeChipsView,
  type IntakeFacts,
  type IntakeLocale,
  type IntakeRecentFile,
  type IntakeScheduleRequest,
  type IntakeSuggestion,
  type IntakeThreadView,
} from "@t3tools/contracts/zenIntake";
import {
  buildWorkflowMessage,
  localizeWorkflowManifest,
  type ZenWorkflow,
  type ZenWorkflowInput,
} from "@t3tools/contracts/zenOffice";

import { ZEN_PERSONAL_COMPANY_ID } from "@t3tools/contracts/zenCompanies";
import type { GatewayTool } from "../connectors/gateway.ts";
import type { ZenConnectionSummary } from "../connectors/extraTools.ts";
import { findRoleTemplate } from "../staff/roleCatalog.ts";

export class IntakeError extends Error {
  readonly reason: "invalid" | "not-found";
  constructor(reason: "invalid" | "not-found", message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface IntakeEngineDeps {
  /** The server state folder; intake keeps `zen/intake/threads.json` there. */
  readonly stateDir: string;
  /** The Zen home: company folders (profile, memory) live under `companies/<id>/`. */
  readonly zenHome: string;
  /** Defaults to the clock; tests pass a fixed date. */
  readonly now?: () => Date;
  /** Every workflow the Office home lists for a company (null = the person's own). */
  readonly listWorkflows: (companyId: string | null) => Promise<ReadonlyArray<ZenWorkflow>>;
  readonly connections: () => Promise<ReadonlyArray<ZenConnectionSummary>>;
  /** Codex's config file (MCP servers), default `~/.codex/config.toml`. */
  readonly codexConfigPath?: string;
  /** Where hired employees get their folders (tests); default `~/Zen Staff`. */
  readonly staffRoot?: string;
}

interface StoredIntake extends IntakeThreadView {
  readonly cwd: string;
  /** The toolchain lines the web prepared for this thread (added to the workflow message). */
  readonly appendix: string;
  readonly createdAt: string;
}

interface StoredState {
  readonly threads: Record<string, StoredIntake>;
  /** `<company>:<workflow>` -> the answers of the last run. */
  readonly last: Record<string, { readonly values: Record<string, string>; readonly at: string }>;
}

const MAX_THREADS = 400;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (input: unknown, key: string, max = 400): string => {
  const value = isRecord(input) ? input[key] : undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new IntakeError("invalid", `${key} is missing.`);
  }
  return value.trim().slice(0, max);
};
const optStr = (input: unknown, key: string, max = 400): string | null => {
  const value = isRecord(input) ? input[key] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : null;
};
const localeOf = (input: unknown): IntakeLocale =>
  isRecord(input) && input.locale === "en" ? "en" : "ro";
const COMPANY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const companyOf = (input: unknown): string | null => {
  const value = optStr(input, "companyId", 64);
  return value !== null && COMPANY_ID.test(value) ? value : null;
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file: string, max: number): string | null {
  try {
    const text = NodeFS.readFileSync(file, "utf8").trim();
    if (text === "") return null;
    return text.length > max ? `${text.slice(0, max)}\n[...]` : text;
  } catch {
    return null;
  }
}

function writePrivate(file: string, text: string) {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, text, { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "inputs-cache", "dist", "build"]);

/** The newest files in a folder and its direct sub-folders (no hidden ones), newest first. */
export function recentFiles(cwd: string, limit = 8): ReadonlyArray<IntakeRecentFile> {
  const found: { name: string; mtime: number }[] = [];
  const visit = (dir: string, prefix: string, depth: number) => {
    let entries: NodeFS.Dirent[];
    try {
      entries = NodeFS.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.slice(0, 500)) {
      if (entry.name.startsWith(".")) continue;
      const full = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 1 && !SKIPPED_FOLDERS.has(entry.name)) {
          visit(full, `${prefix}${entry.name}/`, depth + 1);
        }
      } else if (entry.isFile()) {
        try {
          found.push({ name: `${prefix}${entry.name}`, mtime: NodeFS.statSync(full).mtimeMs });
        } catch {
          // A file that vanished while listing is simply left out.
        }
      }
    }
  };
  visit(cwd, "", 0);
  return found
    .toSorted((left, right) => right.mtime - left.mtime)
    .slice(0, limit)
    .map((file) => ({ name: file.name, modifiedAt: new Date(file.mtime).toISOString() }));
}

/** MCP server names in a Codex config.toml (`[mcp_servers.<name>]`). */
export function codexMcpServers(toml: string): ReadonlyArray<string> {
  const names: string[] = [];
  for (const match of toml.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)) {
    const name = match[1] ?? match[2];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

const ORIGIN_LABEL: Readonly<Record<string, string>> = {
  local: "Claude Code",
  account: "AI account connector",
  plugin: "Claude Code plugin",
};

export class IntakeEngine {
  private cache: StoredState | null = null;
  private readonly deps: IntakeEngineDeps;

  private readonly now: () => Date;

  constructor(deps: IntakeEngineDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
  }

  private get file(): string {
    return NodePath.join(this.deps.stateDir, "zen", "intake", "threads.json");
  }

  private load(): StoredState {
    if (this.cache) return this.cache;
    const raw = readJson(this.file);
    this.cache = {
      threads:
        isRecord(raw) && isRecord(raw.threads) ? (raw.threads as StoredState["threads"]) : {},
      last: isRecord(raw) && isRecord(raw.last) ? (raw.last as StoredState["last"]) : {},
    };
    return this.cache;
  }

  private save(next: StoredState) {
    const ids = Object.keys(next.threads);
    let threads = next.threads;
    if (ids.length > MAX_THREADS) {
      const keep = ids
        .toSorted((a, b) => (next.threads[b]!.createdAt > next.threads[a]!.createdAt ? 1 : -1))
        .slice(0, MAX_THREADS);
      threads = Object.fromEntries(keep.map((id) => [id, next.threads[id]!]));
    }
    this.cache = { ...next, threads };
    writePrivate(this.file, JSON.stringify(this.cache, null, 2));
  }

  private thread(threadId: string): StoredIntake | null {
    return this.load().threads[threadId] ?? null;
  }

  private updateThread(threadId: string, change: (current: StoredIntake) => StoredIntake) {
    const state = this.load();
    const current = state.threads[threadId];
    if (!current) return;
    this.save({ ...state, threads: { ...state.threads, [threadId]: change(current) } });
  }

  // What the app knows.

  /** Facts from the company's interview answers, profile and memory. */
  facts(companyId: string | null): {
    readonly facts: IntakeFacts;
    readonly profileExcerpt: string | null;
    readonly memoryExcerpt: string | null;
  } {
    const id = companyId ?? "personal";
    const onboarding = readJson(
      NodePath.join(this.deps.stateDir, "zen", "onboarding", `${id}.json`),
    );
    const answers =
      isRecord(onboarding) && isRecord(onboarding.answers)
        ? onboarding.answers
        : ({} as Record<string, unknown>);
    const text = (key: string) =>
      typeof answers[key] === "string" && (answers[key] as string).trim() !== ""
        ? (answers[key] as string).trim()
        : null;
    const companyFolder = NodePath.join(this.deps.zenHome, "companies", id);
    const profileExcerpt = readText(NodePath.join(companyFolder, "company-profile.md"), 1_500);
    const memoryDir = this.memoryDirectory(id) ?? NodePath.join(companyFolder, "memory");
    const memoryExcerpt = readText(NodePath.join(memoryDir, "MEMORY.md"), 1_200);
    const website = text("website");
    const links = extractLinks(`${profileExcerpt ?? ""}\n${memoryExcerpt ?? ""}`).filter(
      (link) =>
        website === null ||
        !link.startsWith(website.replace(/\/+$/, "")) ||
        link.length > website.length + 1,
    );
    const address = /(?:^|\n)\s*(?:adresa|address)\s*[:-]\s*([^\n]{5,160})/i.exec(
      `${profileExcerpt ?? ""}\n${memoryExcerpt ?? ""}`,
    )?.[1];
    return {
      facts: {
        companyName: text("companyName"),
        tones: Array.isArray(answers.tones)
          ? answers.tones.filter((tone): tone is string => typeof tone === "string")
          : [],
        toneNotes: text("toneNotes"),
        website,
        customers: text("customers"),
        sells: text("sells"),
        prices: text("prices"),
        links,
        address: address?.trim() ?? null,
      },
      profileExcerpt,
      memoryExcerpt,
    };
  }

  private memoryDirectory(companyId: string): string | null {
    const raw = readJson(NodePath.join(this.deps.stateDir, "zen", "companies.json"));
    if (!isRecord(raw) || !Array.isArray(raw.companies)) return null;
    const company = raw.companies.find((item) => isRecord(item) && item.id === companyId);
    return isRecord(company) && typeof company.memoryDirectory === "string"
      ? company.memoryDirectory
      : null;
  }

  /** Connections in Claude Code, the AI account, Codex: "Meta (Claude Code)". */
  async connectionList(): Promise<ReadonlyArray<HireConnection>> {
    const out: HireConnection[] = [];
    for (const connection of await this.deps.connections()) {
      if (connection.health === "failed" || connection.health === "needs-auth") continue;
      out.push({
        name: connection.app ?? connection.name,
        where: ORIGIN_LABEL[connection.origin] ?? "Claude Code",
      });
    }
    const codexToml = readText(
      this.deps.codexConfigPath ?? NodePath.join(NodeOS.homedir(), ".codex", "config.toml"),
      200_000,
    );
    for (const name of codexToml ? codexMcpServers(codexToml) : []) {
      if (!out.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        out.push({ name, where: "Codex" });
      }
    }
    return out.slice(0, 30);
  }

  private async workflowOf(companyId: string | null, workflowId: string): Promise<ZenWorkflow> {
    const workflows = await this.deps.listWorkflows(companyId);
    const workflow = workflows.find((item) => item.manifest.id === workflowId);
    if (!workflow)
      throw new IntakeError("not-found", `The workflow "${workflowId}" is not available.`);
    return workflow;
  }

  // RPC.

  async call(op: string, input: unknown): Promise<unknown> {
    switch (op) {
      case "workflow.start":
        return this.startWorkflow(input);
      case "hire.start":
        return this.startHire(input);
      case "hire.folder":
        return this.hireFolder(input);
      case "state":
        return this.view(str(input, "threadId", 200));
      case "chips.clear": {
        this.updateThread(str(input, "threadId", 200), (current) => ({ ...current, chips: null }));
        return { ok: true };
      }
      case "schedule.result": {
        const ok = isRecord(input) && input.ok === true;
        this.updateThread(str(input, "threadId", 200), (current) =>
          current.schedule
            ? {
                ...current,
                schedule: {
                  ...current.schedule,
                  state: ok ? "saved" : "failed",
                  detail: optStr(input, "detail", 300),
                },
              }
            : current,
        );
        return this.view(str(input, "threadId", 200));
      }
      case "hire.approved": {
        this.updateThread(str(input, "threadId", 200), (current) => ({
          ...current,
          proposalState: current.proposal ? "approved" : current.proposalState,
        }));
        return this.view(str(input, "threadId", 200));
      }
      default:
        throw new IntakeError("invalid", `Unknown intake operation "${op}".`);
    }
  }

  view(threadId: string): IntakeThreadView | null {
    const stored = this.thread(threadId);
    if (!stored) return null;
    const { cwd: _cwd, appendix: _appendix, createdAt: _createdAt, ...view } = stored;
    return view;
  }

  async startWorkflow(input: unknown): Promise<{
    readonly message: string;
    readonly title: string;
    readonly suggestions: Readonly<Record<string, IntakeSuggestion>>;
  }> {
    const threadId = str(input, "threadId", 200);
    const workflowId = str(input, "workflowId", 64);
    const companyId = companyOf(input);
    const cwd = str(input, "cwd", 2_000);
    const locale = localeOf(input);
    const workflow = await this.workflowOf(companyId, workflowId);
    const localized = localizeWorkflowManifest(workflow.manifest, locale);
    const { facts, profileExcerpt, memoryExcerpt } = this.facts(companyId);
    const last = this.load().last[`${companyId ?? "personal"}:${workflowId}`] ?? null;
    const suggestions = {
      ...prefillIntake({
        inputs: localized.inputs,
        facts,
        previous: last?.values ?? null,
        locale,
      }),
      ...givenAnswers(input, localized.inputs, locale),
    };
    const connections = (await this.connectionList()).map((item) => `${item.name} (${item.where})`);
    const message = buildIntakeMessage({
      workflow,
      localized,
      locale,
      context: {
        suggestions,
        facts,
        profileExcerpt,
        memoryExcerpt,
        recentFiles: recentFiles(cwd),
        previousAt: last?.at ?? null,
        connections,
        folderName: optStr(input, "folderName", 200) ?? NodePath.basename(cwd),
      },
    });
    const now = this.now().toISOString();
    const state = this.load();
    this.save({
      ...state,
      threads: {
        ...state.threads,
        [threadId]: {
          threadId,
          kind: "workflow",
          workflowId,
          companyId,
          projectId: optStr(input, "projectId", 200),
          locale,
          suggestions,
          chips: null,
          launched: null,
          schedule: null,
          agentId: null,
          proposal: null,
          proposalState: "none",
          cwd,
          appendix: optStr(input, "appendix", 20_000) ?? "",
          createdAt: now,
        },
      },
    });
    return { message, title: localized.name, suggestions };
  }

  async startHire(input: unknown): Promise<{ readonly message: string; readonly title: string }> {
    const threadId = str(input, "threadId", 200);
    const companyId = companyOf(input);
    const cwd = str(input, "cwd", 2_000);
    const locale = localeOf(input);
    const agent = isRecord(input) && isRecord(input.agent) ? input.agent : null;
    if (agent === null) throw new IntakeError("invalid", "agent is missing.");
    const agentId = str(agent, "id", 80);
    const name = str(agent, "name", 60);
    const role = optStr(agent, "role", 120) ?? name;
    const template = findRoleTemplate(optStr(agent, "templateId", 80) ?? "");
    // A company role hired in Personal: the chat offers the person's companies first.
    const companyChoice =
      (companyId === null || companyId === ZEN_PERSONAL_COMPANY_ID) &&
      template?.suggestedKind === "company" &&
      agent.kind !== "company";
    const workflows = await this.deps.listWorkflows(companyId);
    const { facts } = this.facts(companyId);
    const message = buildHireSetupMessage({
      agentId,
      locale,
      context: {
        agentName: name,
        role,
        templateInstructions:
          template?.instructions[locale] ?? optStr(agent, "instructions", 8_000) ?? "",
        workflows: workflows.map((item) => ({
          id: item.manifest.id,
          name: localizeWorkflowManifest(item.manifest, locale).name,
        })),
        roleWorkflows: template?.workflows ?? [],
        roleConnectors: template?.connectors ?? [],
        roleDuties:
          template?.duties.map((duty) => ({
            title: duty.title[locale],
            prompt: duty.prompt[locale],
            weekday: duty.weekday,
            time: duty.time,
          })) ?? [],
        connections: await this.connectionList(),
        facts,
        recentFiles: recentFiles(cwd, 6),
        kind: agent.kind === "company" ? "company" : "personal",
        managerName: optStr(input, "managerName", 80),
        approvalsRequired: isRecord(input) && input.approvalsRequired === true,
        companyAccount: optStr(input, "companyAccount", 120),
        folderName: optStr(input, "folderName", 200) ?? NodePath.basename(cwd),
        companyChoice,
      },
    });
    const now = this.now().toISOString();
    const state = this.load();
    this.save({
      ...state,
      threads: {
        ...state.threads,
        [threadId]: {
          threadId,
          kind: "hire",
          workflowId: null,
          companyId,
          projectId: optStr(input, "projectId", 200),
          locale,
          suggestions: {},
          chips: null,
          launched: null,
          schedule: null,
          agentId,
          proposal: null,
          proposalState: "none",
          templateId: optStr(agent, "templateId", 80),
          companyChoice,
          cwd,
          appendix: "",
          createdAt: now,
        },
      },
    });
    return {
      message,
      title: locale === "ro" ? `Angajare: ${name}` : `Hiring: ${name}`,
    };
  }

  /**
   * The employee's own working folder, `~/Zen Staff/<Company>/<Role>` (created when missing), so
   * hiring never offers an internal chat folder. Names are kept readable; only characters no file
   * system accepts are replaced.
   */
  hireFolder(input: unknown): { readonly path: string } {
    const company = safeFolderPart(optStr(input, "companyName", 120) ?? "Personal", "Personal");
    const role = safeFolderPart(str(input, "role", 120), "Angajat");
    const root = this.deps.staffRoot ?? NodePath.join(NodeOS.homedir(), "Zen Staff");
    const path = NodePath.join(root, company, role);
    NodeFS.mkdirSync(path, { recursive: true });
    return { path };
  }

  // Agent tools.

  private requireThread(threadId: string): StoredIntake {
    const stored = this.thread(threadId);
    if (!stored) {
      throw new Error(
        "This chat is not a task being prepared from a card, so there is nothing to start. Just help the person here.",
      );
    }
    return stored;
  }

  async ask(threadId: string, args: Record<string, unknown>): Promise<string> {
    this.requireThread(threadId);
    const options = normalizeChips(args.options ?? args.choices);
    if (options.length < 2) throw new Error("Give 2 to 6 short choices in options.");
    const chips: IntakeChipsView = {
      id: `${this.now().getTime().toString(36)}-${NodeCrypto.randomUUID().slice(0, 4)}`,
      field: typeof args.field === "string" ? args.field.slice(0, 40) : null,
      question: typeof args.question === "string" ? args.question.trim().slice(0, 300) : "",
      options,
      askedAt: this.now().getTime(),
    };
    this.updateThread(threadId, (current) => ({ ...current, chips }));
    return "The choices are shown as buttons. Now write the question itself as the last text of this message (text written before this call is folded away in the app), then end your turn and wait for the answer (typed, spoken or a button).";
  }

  async ready(threadId: string, args: Record<string, unknown>): Promise<string> {
    const stored = this.requireThread(threadId);
    if (stored.kind !== "workflow" || stored.workflowId === null) {
      throw new Error("This chat sets up an AI employee; use hire_propose instead.");
    }
    const workflow = await this.workflowOf(stored.companyId, stored.workflowId);
    const localized = localizeWorkflowManifest(workflow.manifest, stored.locale);
    const checked = checkIntakeValues({
      manifest: workflow.manifest,
      localized,
      raw: isRecord(args.values) ? args.values : args,
    });
    if (checked.missing.length > 0) {
      throw new Error(
        `Still missing: ${checked.missing.join(", ")}. Ask the person for it (one question), then call intake_ready again with every value.`,
      );
    }
    const now = this.now();
    const folder = intakeRunFolder({
      date: now.toISOString().slice(0, 10),
      localized,
      values: checked.values,
    });
    const message = buildWorkflowMessage(workflow, checked.values, { locale: stored.locale });
    const runFolder = NodePath.join(stored.cwd, folder);
    const state = this.load();
    const key = `${stored.companyId ?? "personal"}:${stored.workflowId}`;
    this.save({
      threads: {
        ...state.threads,
        [threadId]: {
          ...stored,
          chips: null,
          launched: { values: checked.values, folder, at: now.toISOString() },
        },
      },
      last: { ...state.last, [key]: { values: checked.values, at: now.toISOString() } },
    });
    const summary = localized.inputs
      .filter((field) => checked.values[field.id])
      .map((field) => `${field.label} ${checked.values[field.id]}`)
      .join("; ");
    return [
      `Saved (${summary}). The app shows the person a "Starting with" card with these answers.`,
      `Run folder: ${runFolder}. Create it and save every file you make there (where the instructions below say "this folder", use the run folder for new files; you may still read material anywhere in ${stored.cwd}).`,
      "Start your reply with one short line in the person's language, then do the task now, in this same turn, following these instructions:",
      "",
      "---",
      "",
      stored.appendix ? `${message}\n\n${stored.appendix}` : message,
    ].join("\n");
  }

  async schedule(threadId: string, args: Record<string, unknown>): Promise<string> {
    const stored = this.requireThread(threadId);
    if (stored.launched === null) {
      throw new Error("Run the task first (intake_ready), then offer to repeat it.");
    }
    const parsed = normalizeScheduleRequest(args);
    if ("error" in parsed) throw new Error(parsed.error);
    const request: IntakeScheduleRequest = { ...parsed, state: "pending", detail: null };
    this.updateThread(threadId, (current) => ({ ...current, schedule: request }));
    return "The app saves the schedule now (Settings > Scheduled tasks) and shows a confirmation card. Tell the person in one sentence when it will run; each run uses the same answers.";
  }

  async propose(threadId: string, args: Record<string, unknown>): Promise<string> {
    const stored = this.requireThread(threadId);
    if (stored.kind !== "hire") throw new Error("This chat runs a task; use intake_ready instead.");
    const workflows = await this.deps.listWorkflows(stored.companyId);
    const normalized = normalizeHireProposal(args, {
      workflows: workflows.map((item) => item.manifest.id),
    });
    if ("error" in normalized) throw new Error(normalized.error);
    const proposal: HireProposal = normalized.proposal;
    this.updateThread(threadId, (current) => ({
      ...current,
      chips: null,
      proposal,
      proposalState: "pending",
    }));
    return "The person now sees a summary of the profile changes with Approve. Tell them to check it; you become active once they approve. If they ask for changes, call hire_propose again with the whole updated proposal.";
  }

  tools(): ReadonlyArray<GatewayTool> {
    const run =
      (method: (threadId: string, args: Record<string, unknown>) => Promise<string>) =>
      (threadId: string, args: Record<string, unknown>) =>
        method.call(this, threadId, args);
    return [
      {
        name: "intake_ask",
        description:
          "While preparing a task or setting up an AI employee in this chat: show quick-reply buttons (2-6 short choices). Call this first, then write the question as the last text of your message and end your turn.",
        inputSchema: {
          type: "object",
          properties: {
            field: { type: "string", description: "The checklist item id the question is for." },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
          },
          required: ["options"],
        },
        readOnly: false,
        run: run(this.ask),
      },
      {
        name: "intake_ready",
        description:
          "When every required checklist item of the task being prepared in this chat has an answer: give all values (item id -> answer). Returns the task's full instructions, which you then follow right away in the same turn.",
        inputSchema: {
          type: "object",
          properties: {
            values: {
              type: "object",
              description: "Checklist item id -> the answer (for choices, the choice text).",
              additionalProperties: { type: "string" },
            },
          },
          required: ["values"],
        },
        readOnly: false,
        run: run(this.ready),
      },
      {
        name: "intake_schedule",
        description:
          "After the task ran and the person said yes to repeating it: schedule it with the same answers.",
        inputSchema: {
          type: "object",
          properties: {
            frequency: { type: "string", enum: ["daily", "weekly"] },
            weekday: { type: "string", description: "For weekly: monday ... sunday." },
            time: { type: "string", description: "HH:MM, 24-hour." },
          },
          required: ["frequency", "time"],
        },
        readOnly: false,
        run: run(this.schedule),
      },
      {
        name: "hire_propose",
        description:
          "At the end of an AI employee's setup chat: propose the profile (job description, workflows, connectors, duties, where it publishes, approvals, what it must never do). The person approves it in the app.",
        inputSchema: {
          type: "object",
          properties: {
            instructions: { type: "string" },
            workflows: { type: "array", items: { type: "string" } },
            connectors: { type: "array", items: { type: "string" } },
            duties: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  prompt: { type: "string" },
                  weekday: { type: "number", description: "1 = Monday ... 7 = Sunday" },
                  time: { type: "string", description: "HH:MM" },
                },
                required: ["title", "prompt", "weekday", "time"],
              },
            },
            publishes_to: { type: "array", items: { type: "string" } },
            approvals: { type: "string" },
            limits: {
              type: "string",
              description: "How much it may do or spend per day or week, what to ask first.",
            },
            never: { type: "array", items: { type: "string" } },
            name: {
              type: "string",
              description: "Only when the person chose another name for the employee.",
            },
          },
          required: ["instructions"],
        },
        readOnly: false,
        run: run(this.propose),
      },
    ];
  }
}

/**
 * Answers the app already has for this run (the onboarding hand-over's sample answers), offered to
 * the agent as known instead of opening a form with them. Only the workflow's own text inputs and
 * choices; never a file.
 */
function givenAnswers(
  input: unknown,
  inputs: ReadonlyArray<ZenWorkflowInput>,
  locale: IntakeLocale,
): Record<string, IntakeSuggestion> {
  const known = isRecord(input) && isRecord(input.known) ? input.known : null;
  if (known === null) return {};
  const out: Record<string, IntakeSuggestion> = {};
  for (const field of inputs) {
    const value = known[field.id];
    if (typeof value !== "string" || value.trim() === "" || field.type === "file") continue;
    out[field.id] = {
      value: value.trim().slice(0, 2_000),
      source: "app",
      why:
        locale === "ro"
          ? "ce ai spus la început, în interviu"
          : "what you said in the first interview",
    };
  }
  return out;
}

/** One folder name from a company or role name: readable, without characters no OS accepts. */
function safeFolderPart(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
    .trim();
  return cleaned === "" ? fallback : cleaned;
}
