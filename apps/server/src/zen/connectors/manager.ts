// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off extendsNativeError:off globalTimers:off - plain async code that runs outside the Effect runtime (wrapped by ZenConnectors.ts).
// Zen Staff connectors: catalog, connect requests (the cards), the person's provider connections
// (read from `claude mcp list`), sign-ins through Claude Code, support requests and enterprise
// grants. Zen stores only what it needs to show cards and requests:
//   <zen home>/connectors/requests.json   cards per thread (app, state)
//   <zen home>/connectors/support.json    "Ask ZED-ZEN to set this up" requests
//   <zen home>/connectors/grants.json     enterprise connectors unlocked per person
// Never a key, token, password, code or sign-in link. ZEN.md, "Connectors".
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  catalogEntryForServer,
  choosePath,
  claudeMcpAddArgs,
  connectorEntryProblems,
  manualMcpCommand,
  searchConnectors,
  type ZenConnectRequestView,
  type ZenConnectionScope,
  type ZenConnectionView,
  type ZenConnectorCategory,
  type ZenConnectorEntry,
  type ZenConnectorPathKind,
  type ZenConnectorsOverview,
  type ZenLoginView,
  type ZenPathContext,
  type ZenProviderServer,
  type ZenSupportRequestView,
} from "@t3tools/contracts/zenConnectors";

import { runnerStatus } from "../toolchains/access.ts";
import { loadWorkflowRequirements } from "../toolchains/workflowRequirements.ts";
import { BUILTIN_CONNECTOR_FILES } from "./catalog/index.ts";
import {
  LoginSessions,
  claudeVersion,
  listServers,
  type ClaudeCliOptions,
  type RunClaude,
} from "./claudeCli.ts";

export class ConnectorFailure extends Error {
  readonly reason:
    | "invalid-input"
    | "not-found"
    | "forbidden"
    | "needs-runner"
    | "no-provider"
    | "failed"
    | "unavailable";
  constructor(reason: ConnectorFailure["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface ConnectorsOptions {
  readonly zenHome: string;
  readonly stateDir: string;
  /** Folder with the shipped workflows (`builtin/`), for "used by". */
  readonly workflowsAssetsDir: string | null;
  readonly cli: ClaudeCliOptions;
  readonly run: RunClaude;
  /** Folder Claude Code commands run in (user-scope servers do not depend on it). */
  readonly cwd: string;
  /** `user` (default) or `local` (ZEN_CONNECT_MCP_SCOPE; local = only the folder Zen runs in). */
  readonly mcpScope: "user" | "local";
  readonly entries?: ReadonlyArray<ZenConnectorEntry>;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
  /** Called when connections change, so threads restart with the new MCP config. */
  readonly onChange?: () => void;
  readonly browserAvailable?: boolean;
}

interface RequestRecord extends ZenConnectRequestView {
  readonly messageId: string | null;
}

interface SupportRecord extends ZenSupportRequestView {}

interface Grant {
  readonly appId: string;
  readonly user: string;
  readonly grantedBy: string;
  readonly at: string;
}

const CACHE_MS = 20_000;

/** Loads and validates the shipped catalog; invalid entries are skipped with their reasons. */
export function loadCatalog(raw: ReadonlyArray<unknown> = BUILTIN_CONNECTOR_FILES): {
  readonly entries: ReadonlyArray<ZenConnectorEntry>;
  readonly problems: ReadonlyArray<string>;
} {
  const entries: ZenConnectorEntry[] = [];
  const problems: string[] = [];
  for (const item of raw) {
    const found = connectorEntryProblems(item);
    if (found.length > 0) problems.push(...found);
    else entries.push(item as ZenConnectorEntry);
  }
  return { entries, problems };
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  NodeFS.renameSync(temporary, file);
}

const SERVER_NAME = /^[a-z][a-z0-9-]{1,40}$/;
const CUSTOM_HOST = /^[a-z0-9.-]+$/;

/** A server name for a custom MCP address ("mcp.deepwiki.com" -> "deepwiki"). */
export function serverNameForUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^(?:www|mcp|api)\./, "");
  const base = host.split(".")[0] ?? "mcp";
  const name = base
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-")
    .replace(/^[^a-z]+/, "");
  return SERVER_NAME.test(name)
    ? name
    : `mcp-${NodeCrypto.createHash("sha256").update(url).digest("hex").slice(0, 6)}`;
}

export class ConnectorsManager {
  private readonly options: ConnectorsOptions;
  readonly entries: ReadonlyArray<ZenConnectorEntry>;
  readonly catalogProblems: ReadonlyArray<string>;
  private readonly logins: LoginSessions;
  private cache: {
    at: number;
    servers: ReadonlyArray<ZenProviderServer>;
    error: string | null;
    version: string | null;
  } | null = null;
  private listing: Promise<void> | null = null;
  version = 1;

  constructor(options: ConnectorsOptions) {
    this.options = options;
    if (options.entries) {
      this.entries = options.entries;
      this.catalogProblems = [];
    } else {
      const loaded = loadCatalog();
      this.entries = loaded.entries;
      this.catalogProblems = loaded.problems;
    }
    this.logins = new LoginSessions(options.cli, () => this.changed(), options.fetch);
  }

  dispose() {
    this.logins.dispose();
  }

  private get dir() {
    return NodePath.join(this.options.zenHome, "connectors");
  }
  private get requestsFile() {
    return NodePath.join(this.dir, "requests.json");
  }
  private get supportFile() {
    return NodePath.join(this.dir, "support.json");
  }
  private get grantsFile() {
    return NodePath.join(this.dir, "grants.json");
  }
  private now() {
    return (this.options.now ?? (() => new Date()))();
  }

  private changed() {
    this.version += 1;
    this.cache = null;
    this.options.onChange?.();
  }

  entry(appId: string): ZenConnectorEntry {
    const entry = this.entries.find((candidate) => candidate.id === appId);
    if (!entry) throw new ConnectorFailure("not-found", `No connector "${appId}" in the catalog.`);
    return entry;
  }

  runner() {
    let hubJson: string | null = null;
    try {
      hubJson = NodeFS.readFileSync(
        NodePath.join(this.options.stateDir, "zen", "hub.json"),
        "utf8",
      );
    } catch {
      hubJson = null;
    }
    // The toolchains "company's always-on server" switch (read only).
    const toolchainState = readJson<{ settings?: { companyRunner?: boolean } }>(
      NodePath.join(this.options.zenHome, "toolchains", "state.json"),
      {},
    );
    return runnerStatus(hubJson, toolchainState.settings?.companyRunner === true);
  }

  private grants(): Grant[] {
    return readJson<{ grants?: Grant[] }>(this.grantsFile, {}).grants ?? [];
  }

  private requester(): string {
    return this.runner().hubUser ?? "local";
  }

  /** Why this person cannot use an enterprise connector here, or null. */
  enterpriseLock(entry: ZenConnectorEntry): string | null {
    if (entry.tier !== "enterprise") return null;
    if (!this.runner().isRunner) {
      return "This is an Enterprise connector: it runs only on the company's always-on server.";
    }
    const user = this.requester();
    return this.grants().some((grant) => grant.appId === entry.id && grant.user === user)
      ? null
      : "Ask an admin to unlock this connector for you.";
  }

  grant(input: { appId: string; user: string; adminConfirmed: boolean }) {
    this.entry(input.appId);
    if (!input.adminConfirmed)
      throw new ConnectorFailure("forbidden", "An admin must confirm this.");
    const user = input.user.trim().toLowerCase() || "local";
    const grants = this.grants().filter(
      (grant) => !(grant.appId === input.appId && grant.user === user),
    );
    grants.push({
      appId: input.appId,
      user,
      grantedBy: this.requester(),
      at: this.now().toISOString(),
    });
    writeJson(this.grantsFile, { grants });
  }

  revoke(input: { appId: string; user: string }) {
    const user = input.user.trim().toLowerCase();
    writeJson(this.grantsFile, {
      grants: this.grants().filter(
        (grant) => !(grant.appId === input.appId && grant.user === user),
      ),
    });
  }

  async providerServers(refresh = false) {
    if (!refresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    this.listing ??= (async () => {
      const version = await claudeVersion(this.options.run, this.options.cwd);
      const listed =
        version === null
          ? { servers: [], error: "Claude Code was not found on this computer." }
          : await listServers(this.options.run, this.options.cwd);
      this.cache = { at: Date.now(), servers: listed.servers, error: listed.error, version };
    })().finally(() => {
      this.listing = null;
    });
    await this.listing;
    return this.cache!;
  }

  private async usedBy(): Promise<Map<string, string[]>> {
    const dirs: string[] = [];
    if (this.options.workflowsAssetsDir)
      dirs.push(NodePath.join(this.options.workflowsAssetsDir, "builtin"));
    for (const company of await NodeFS.promises
      .readdir(NodePath.join(this.options.zenHome, "companies"))
      .catch(() => [] as string[])) {
      dirs.push(NodePath.join(this.options.zenHome, "companies", company, "workflows"));
    }
    dirs.push(NodePath.join(this.options.zenHome, "workflows"));
    const map = new Map<string, string[]>();
    const add = (appId: string, name: string) => {
      const list = map.get(appId) ?? [];
      if (!list.includes(name)) list.push(name);
      map.set(appId, list);
    };
    const workflows = await loadWorkflowRequirements(dirs).catch(() => new Map());
    for (const workflow of workflows.values()) {
      for (const connector of workflow.requires?.connectors ?? []) {
        const entry = this.entries.find(
          (candidate) => candidate.id === connector.id || candidate.aliases.includes(connector.id),
        );
        if (entry) add(entry.id, workflow.name);
      }
      for (const secret of workflow.access.secrets ?? []) {
        const entry = this.entries.find(
          (candidate) =>
            candidate.id === secret.provider ||
            candidate.aliases.includes(secret.provider.toLowerCase()),
        );
        if (entry) add(entry.id, workflow.name);
      }
    }
    return map;
  }

  async connections(refresh = false): Promise<ReadonlyArray<ZenConnectionView>> {
    const state = await this.providerServers(refresh);
    const usedBy = await this.usedBy();
    const runner = this.runner();
    return state.servers.map((server): ZenConnectionView => {
      const entry = catalogEntryForServer(server, this.entries);
      const path = entry?.paths.find(
        (candidate) => candidate.kind === (server.origin === "account" ? "native" : "local-mcp"),
      );
      return {
        name: server.name,
        target: server.target,
        origin: server.origin,
        health: server.health,
        detail: server.detail.slice(0, 200),
        appId: entry?.id ?? null,
        appName: entry?.name ?? null,
        scope: runner.isRunner ? "company" : "personal",
        access: path?.access.read ?? entry?.paths[0]?.access.read ?? null,
        tier: entry?.tier ?? null,
        usedBy: entry ? (usedBy.get(entry.id) ?? []) : [],
        checkedAt: new Date(state.at).toISOString(),
        removable: server.origin === "local",
      };
    });
  }

  async connectionsFor(appId: string, refresh = false): Promise<ReadonlyArray<ZenConnectionView>> {
    return (await this.connections(refresh)).filter((connection) => connection.appId === appId);
  }

  async pathContext(scope: ZenConnectionScope): Promise<ZenPathContext> {
    const state = await this.providerServers();
    return {
      claudeCli: state.version !== null,
      hasAutomation: state.servers.some(
        (server) =>
          server.health === "connected" &&
          catalogEntryForServer(server, this.entries)?.category === "automation",
      ),
      browserAvailable: this.options.browserAvailable ?? true,
      scope,
      isRunner: this.runner().isRunner,
    };
  }

  async overview(refresh = false): Promise<ZenConnectorsOverview> {
    const state = await this.providerServers(refresh);
    const runner = this.runner();
    return {
      connections: await this.connections(false),
      provider: {
        claudeCli: state.version !== null,
        version: state.version,
        error: state.error,
        checkedAt: new Date(state.at).toISOString(),
      },
      support: this.support(),
      isRunner: runner.isRunner,
      runnerSource: runner.source,
      hubUser: runner.hubUser,
      grants: this.grants().map((grant) => ({ appId: grant.appId, user: grant.user })),
      mcpScope: this.options.mcpScope,
    };
  }

  private requests(): RequestRecord[] {
    return readJson<{ requests?: RequestRecord[] }>(this.requestsFile, {}).requests ?? [];
  }

  private saveRequests(requests: RequestRecord[]) {
    // Keep the file small: the last 200 cards.
    writeJson(this.requestsFile, { requests: requests.slice(-200) });
  }

  listRequests(threadId: string): ReadonlyArray<ZenConnectRequestView> {
    return this.requests()
      .filter((request) => request.threadId === threadId && request.state !== "dismissed")
      .map(({ messageId: _messageId, ...view }) => view);
  }

  createRequest(input: {
    threadId: string;
    appId?: string | null;
    category?: ZenConnectorCategory | null;
    candidates?: ReadonlyArray<string>;
    preferredKind?: ZenConnectorPathKind | null;
    scope?: ZenConnectionScope | null;
    source: "chat" | "agent";
    messageId?: string | null;
    customUrl?: string | null;
  }): ZenConnectRequestView {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(input.threadId))
      throw new ConnectorFailure("invalid-input", "Bad thread id.");
    const appId = input.appId ?? null;
    if (appId !== null) this.entry(appId);
    const candidates = (input.candidates ?? []).filter((id) =>
      this.entries.some((entry) => entry.id === id),
    );
    if (appId === null && candidates.length === 0 && !input.customUrl) {
      throw new ConnectorFailure(
        "invalid-input",
        "Name an app from the catalog or an MCP address.",
      );
    }
    let customUrl: string | null = null;
    if (input.customUrl) {
      customUrl = checkCustomUrl(input.customUrl);
    }
    const requests = this.requests();
    const same = requests.find(
      (request) =>
        request.threadId === input.threadId &&
        ((input.messageId && request.messageId === input.messageId) ||
          (request.state === "open" &&
            request.appId === appId &&
            request.customUrl === customUrl &&
            (input.scope == null || request.scope === input.scope) &&
            JSON.stringify(request.candidates) === JSON.stringify(candidates))),
    );
    if (same) {
      const { messageId: _messageId, ...view } = same;
      return view;
    }
    const entry = appId ? this.entry(appId) : null;
    const record: RequestRecord = {
      id: NodeCrypto.randomUUID(),
      threadId: input.threadId,
      appId,
      category: input.category ?? null,
      candidates,
      preferredKind: input.preferredKind ?? null,
      // Company apps open as company connections where that is possible (on the runner).
      scope:
        input.scope ??
        (entry?.defaultScope === "company" && this.runner().isRunner ? "company" : "personal"),
      source: input.source,
      state: "open",
      customUrl,
      createdAt: this.now().toISOString(),
      messageId: input.messageId ?? null,
    };
    requests.push(record);
    this.saveRequests(requests);
    const { messageId: _messageId, ...view } = record;
    return view;
  }

  updateRequest(
    id: string,
    patch: Partial<Pick<RequestRecord, "state" | "appId" | "scope" | "preferredKind">>,
  ) {
    const requests = this.requests();
    const index = requests.findIndex((request) => request.id === id);
    if (index < 0) throw new ConnectorFailure("not-found", "This card is gone.");
    if (patch.appId) this.entry(patch.appId);
    requests[index] = { ...requests[index]!, ...patch };
    this.saveRequests(requests);
    const { messageId: _messageId, ...view } = requests[index]!;
    return view;
  }

  private scopeCheck(entry: ZenConnectorEntry | null, scope: ZenConnectionScope) {
    if (entry) {
      const lock = this.enterpriseLock(entry);
      if (lock)
        throw new ConnectorFailure(this.runner().isRunner ? "forbidden" : "needs-runner", lock);
    }
    if (scope === "company" && !this.runner().isRunner) {
      throw new ConnectorFailure(
        "needs-runner",
        "Company connections are added on the company's always-on server, not on a personal computer.",
      );
    }
  }

  /**
   * Adds the app's MCP server to the person's Claude Code (`claude mcp add`) and, when it signs in
   * with OAuth, starts Claude Code's own sign-in. Returns the sign-in to show on the card.
   */
  async add(input: {
    appId?: string | null;
    customUrl?: string | null;
    scope?: ZenConnectionScope | null;
    requestId?: string | null;
  }): Promise<{
    readonly server: string;
    readonly login: ZenLoginView | null;
    readonly alreadyAdded: boolean;
  }> {
    const entry = input.appId ? this.entry(input.appId) : null;
    const scope = input.scope ?? entry?.defaultScope ?? "personal";
    this.scopeCheck(entry, scope);
    let args: ReadonlyArray<string>;
    let server: string;
    let oauth: boolean;
    if (entry) {
      const path = entry.paths.find((candidate) => candidate.kind === "local-mcp");
      if (!path?.mcp)
        throw new ConnectorFailure(
          "invalid-input",
          `${entry.name} cannot be added to Claude Code from here.`,
        );
      if (path.mcp.auth === "env") {
        throw new ConnectorFailure(
          "invalid-input",
          `This one needs your own key; run it yourself: ${manualMcpCommand(entry, path.mcp)}`,
        );
      }
      args = claudeMcpAddArgs(entry, path.mcp, this.options.mcpScope);
      server = path.mcp.serverName ?? entry.id;
      oauth = path.mcp.auth === "oauth";
    } else if (input.customUrl) {
      const url = checkCustomUrl(input.customUrl);
      server = serverNameForUrl(url);
      args = ["mcp", "add", "--transport", "http", "--scope", this.options.mcpScope, server, url];
      oauth = true;
    } else {
      throw new ConnectorFailure("invalid-input", "Name an app or an MCP address.");
    }
    const before = await this.serverStatus(server);
    let alreadyAdded = before.exists;
    if (!before.exists) {
      const result = await this.options.run(args, { cwd: this.options.cwd, timeoutMs: 60_000 });
      const text = `${result.stdout}\n${result.stderr}`;
      if (result.code !== 0 && !/already exists/i.test(text)) {
        throw new ConnectorFailure(
          "failed",
          `Claude Code could not add it: ${text.trim().split("\n").at(-1) ?? "unknown error"}`,
        );
      }
      alreadyAdded = /already exists/i.test(text);
      this.changed();
    }
    const after = await this.serverStatus(server);
    let login: ZenLoginView | null = null;
    if (oauth && after.health === "needs-auth") {
      const started = this.logins.start(server, this.options.cwd);
      // Wait briefly for Claude Code to print its link, so the card shows it at once.
      login = (await this.logins.whenReady(started.id, 20_000)) ?? started;
    }
    if (input.requestId && after.health === "connected")
      this.updateRequest(input.requestId, { state: "connected" });
    return { server, login, alreadyAdded };
  }

  /** Starts Claude Code's sign-in again for a server that needs it. */
  login(server: string): ZenLoginView {
    if (!/^[A-Za-z0-9 ._:-]{1,80}$/.test(server))
      throw new ConnectorFailure("invalid-input", "Bad server name.");
    return this.logins.start(server, this.options.cwd);
  }

  loginStatus(id: string): ZenLoginView {
    const view = this.logins.status(id);
    if (!view) throw new ConnectorFailure("not-found", "This sign-in is no longer running.");
    return view;
  }

  async finishLogin(id: string, redirectUrl: string): Promise<ZenLoginView> {
    try {
      return await this.logins.complete(id, redirectUrl);
    } catch (error) {
      throw new ConnectorFailure(
        "invalid-input",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Checks whether the app is now visible to the agent, and closes the card when it is. */
  async verify(input: {
    appId?: string | null;
    server?: string | null;
    requestId?: string | null;
  }) {
    const connections = await this.connections(true);
    const found = connections.filter(
      (connection) =>
        (input.appId && connection.appId === input.appId) ||
        (input.server && connection.name === input.server),
    );
    const connected = found.find((connection) => connection.health === "connected") ?? null;
    if (connected && input.requestId) {
      this.updateRequest(input.requestId, { state: "connected" });
      this.changed();
    }
    return { connected, found };
  }

  /** One server's state from `claude mcp get` (health-checks only that server). */
  async serverStatus(name: string): Promise<{
    readonly exists: boolean;
    readonly health: ZenProviderServer["health"];
    readonly status: string;
  }> {
    const result = await this.options.run(["mcp", "get", name], {
      cwd: this.options.cwd,
      timeoutMs: 60_000,
    });
    if (result.code !== 0) return { exists: false, health: "unknown", status: "" };
    const status = /Status:\s*(.+)/.exec(result.stdout)?.[1]?.trim() ?? "";
    const health: ZenProviderServer["health"] =
      /✔|✓/.test(status) || /^connected/i.test(status)
        ? "connected"
        : /needs auth/i.test(status)
          ? "needs-auth"
          : /✘|✗|fail/i.test(status)
            ? "failed"
            : /pending/i.test(status)
              ? "pending"
              : status.startsWith("!") && /connected/i.test(status)
                ? "connected"
                : "unknown";
    return { exists: true, health, status };
  }

  async test(name: string) {
    if (!/^[A-Za-z0-9 ._:-]{1,80}$/.test(name))
      throw new ConnectorFailure("invalid-input", "Bad server name.");
    const state = await this.serverStatus(name);
    this.cache = null;
    if (!state.exists)
      return {
        ok: false,
        health: "unknown" as const,
        message: "Claude Code no longer has this connection.",
      };
    return {
      ok: state.health === "connected",
      health: state.health,
      message: state.status.slice(0, 300),
    };
  }

  async remove(name: string) {
    const server = (await this.providerServers()).servers.find(
      (candidate) => candidate.name === name,
    );
    if (!server) throw new ConnectorFailure("not-found", "This connection is not in Claude Code.");
    if (server.origin !== "local") {
      throw new ConnectorFailure(
        "forbidden",
        server.origin === "account"
          ? "This connector lives in your claude.ai account: remove it in claude.ai > Settings > Connectors."
          : "This server comes from a Claude Code plugin; remove the plugin there.",
      );
    }
    const result = await this.options.run(["mcp", "remove", name], {
      cwd: this.options.cwd,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) {
      throw new ConnectorFailure(
        "failed",
        `${result.stderr || result.stdout}`.trim().split("\n").at(-1) ?? "Could not remove it.",
      );
    }
    this.changed();
  }

  support(): ReadonlyArray<ZenSupportRequestView> {
    return readJson<{ requests?: SupportRecord[] }>(this.supportFile, {}).requests ?? [];
  }

  createSupport(input: {
    appId: string;
    note?: string;
    contact?: string | null;
    threadId?: string | null;
  }) {
    const entry = this.entry(input.appId);
    const note = (input.note ?? "").slice(0, 2000);
    // A support note is free text: refuse anything that looks like a secret.
    if (looksLikeSecret(note)) {
      throw new ConnectorFailure(
        "invalid-input",
        "Please do not put passwords or keys in the note; ZED-ZEN never asks for them.",
      );
    }
    const record: SupportRecord = {
      id: NodeCrypto.randomUUID(),
      appId: entry.id,
      appName: entry.name,
      note,
      contact: input.contact?.slice(0, 200) ?? null,
      threadId: input.threadId ?? null,
      createdAt: this.now().toISOString(),
      // Seam: the hub will accept these (op "support.create") and e-mail ZED-ZEN.
      delivery: "local",
    };
    writeJson(this.supportFile, { requests: [...this.support(), record].slice(-500) });
    return record;
  }

  async describe(entry: ZenConnectorEntry, scope?: ZenConnectionScope) {
    const context = await this.pathContext(scope ?? entry.defaultScope ?? "personal");
    const choice = choosePath(entry, context);
    const connections = await this.connectionsFor(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      connected: connections.some((connection) => connection.health === "connected"),
      connections: connections.map((connection) => ({
        name: connection.name,
        health: connection.health,
      })),
      bestPath: choice.chosen?.kind ?? null,
      paths: choice.options.map((option) => ({
        kind: option.kind,
        available: option.available,
        blocked: option.block,
      })),
      tier: entry.tier,
      lock: this.enterpriseLock(entry),
    };
  }

  async findForAgent(query: string) {
    const found = searchConnectors(query, this.entries).slice(0, 5);
    return Promise.all(found.map((entry) => this.describe(entry)));
  }
}

export function checkCustomUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConnectorFailure("invalid-input", "That is not a web address.");
  }
  if (url.protocol !== "https:")
    throw new ConnectorFailure("invalid-input", "MCP addresses must start with https://.");
  if (url.username || url.password)
    throw new ConnectorFailure("invalid-input", "The address must not contain a login.");
  if (
    !CUSTOM_HOST.test(url.hostname) ||
    /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
  ) {
    throw new ConnectorFailure("invalid-input", "Use a public MCP address.");
  }
  // An address with a key in it (?key=, ?token=) would put a credential through Zen.
  for (const key of url.searchParams.keys()) {
    if (/key|token|secret|auth|password|sig/i.test(key)) {
      throw new ConnectorFailure(
        "invalid-input",
        "That address contains a key; add it in claude.ai or ask ZED-ZEN.",
      );
    }
  }
  return url.toString();
}

/** Strings that look like credentials (API keys, tokens, JWTs, long random strings). */
export function looksLikeSecret(text: string): boolean {
  return (
    /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/.test(text) ||
    /\b(?:ghp|gho|github_pat|xox[abprs]|shpat|ntn|pat-[a-z]{2}\d|zzk)_?[A-Za-z0-9_-]{12,}/.test(
      text,
    ) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(text) ||
    /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{32,}\b/.test(
      text,
    ) ||
    /\b[a-f0-9]{40,}\b/.test(text) ||
    /(?:parola|password|parolă|api key|cheia api)\s*[:=]\s*\S{6,}/i.test(text)
  );
}
