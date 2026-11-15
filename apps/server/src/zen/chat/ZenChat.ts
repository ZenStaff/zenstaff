// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off processEnvInEffect:off globalDate:off globalDateInEffect:off globalFetch:off -- Adapters and the engine are a promise boundary: sockets and timers call back outside any fiber.
// Zen Staff chat integrations service ("Integrări chat"). Runs the platform connections of this
// machine (company connections only on the company runner), keeps bot tokens in the toolchains
// vault, and implements the engine's AgentRuntime with the orchestrator: a chat conversation is a
// normal Zen thread of the agent's project. One RPC `zen.chat.call {op, input}`. See ZEN.md.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import {
  ZEN_CHAT_DEFAULT_MODEL,
  ZEN_EMAIL_PROVIDER_SECRETS,
  ZEN_CHAT_PLATFORM_INFO,
  ZEN_CHAT_PLATFORMS,
  ZEN_CHAT_WS_METHODS,
  ZenChatError,
  type ZenChatAgent,
  type ZenChatBinding,
  type ZenChatCallInput,
  type ZenChatConnection,
  type ZenChatConnectionState,
  type ZenChatConnectionView,
  type ZenChatMember,
  type ZenChatPlatform,
  type ZenChatReport,
  type ZenChatSettings,
  type ZenChatStatus,
} from "@t3tools/contracts/zenChat";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { readLedger, runnerStatus, writeLedger, type AccessLedger } from "../toolchains/access.ts";
import { SecretVault } from "../toolchains/vault.ts";
import { ADAPTERS, MANIFESTS } from "./adapters/index.ts";
import type { AdapterInstance } from "./adapters/types.ts";
import { ChatEngine, type AgentObservation, type AgentRuntime } from "./engine.ts";
import { emailProviderOf } from "./email/emailAdapter.ts";
import { watchedLabels } from "./email/emailPolicy.ts";
import type { RelayedRequest, RelayedResponse } from "./model.ts";
import { isValidTime, personalAgentRunsHere, type ChatConfig } from "./policy.ts";
import { setZenMentionRelay } from "../staff/mentionReply.ts";
import { setZenChatRelayHandler, webhookUrlFor } from "./relay.ts";
import {
  AuditLog,
  loadConfig,
  loadRuntime,
  pruneRuntime,
  saveConfig,
  saveRuntime,
  type RuntimeState,
} from "./store.ts";

const ACCESS_PACK = "chat-integrations";
const APPROVAL_KINDS = new Set([
  "command",
  "file-read",
  "file-change",
  "permission",
  "mcp-elicitation",
  "dynamic_tool_call",
]);

export class ZenChat extends Context.Service<
  ZenChat,
  {
    readonly call: (input: ZenChatCallInput) => Effect.Effect<unknown, ZenChatError>;
  }
>()("t3/zen/chat/ZenChat") {}

const isZenChatError = Schema.is(ZenChatError);
const fail = (reason: ZenChatError["reason"], detail: string) =>
  new ZenChatError({ reason, detail });

// Input validation (the RPC carries `unknown`)

type Json = Record<string, unknown>;
const asInput = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};
const text = (input: Json, key: string, max: number, required = true): string => {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw fail("invalid-input", `${key} is required.`);
    return "";
  }
  if (typeof value !== "string" || value.length > max)
    throw fail("invalid-input", `${key} is not valid.`);
  return value.trim();
};
const list = (value: unknown, max: number, itemMax = 200): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max)
    throw fail("invalid-input", "A list is not valid.");
  return value
    .map((item) => {
      if (typeof item !== "string" || item.length > itemMax)
        throw fail("invalid-input", "A list item is not valid.");
      return item.trim();
    })
    .filter((item) => item !== "");
};
const newId = (prefix: string) => `${prefix}-${NodeCrypto.randomBytes(5).toString("hex")}`;
const idOf = (input: Json, prefix: string): string => {
  const value = input.id;
  if (value === undefined || value === null || value === "") return newId(prefix);
  if (typeof value !== "string" || !/^[a-z0-9-]{1,64}$/.test(value))
    throw fail("invalid-input", "id is not valid.");
  return value;
};
const email = (value: string, key: string) => {
  if (value !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw fail("invalid-input", `${key} must be an e-mail address.`);
  return value.toLowerCase();
};
const platformOf = (value: unknown): ZenChatPlatform => {
  if (typeof value !== "string" || !(ZEN_CHAT_PLATFORMS as ReadonlyArray<string>).includes(value)) {
    throw fail("invalid-input", "Unknown platform.");
  }
  return value as ZenChatPlatform;
};

function parseConnection(raw: Json): ZenChatConnection {
  const platform = platformOf(raw.platform);
  const info = ZEN_CHAT_PLATFORM_INFO[platform];
  const settingsIn = asInput(raw.settings);
  const settings: Record<string, string> = {};
  for (const setting of info.settings) {
    const value = text(settingsIn, setting.id, 300, false);
    if (setting.options !== undefined && value !== "" && !setting.options.includes(value))
      throw fail("invalid-input", `${setting.id} is not one of ${setting.options.join(", ")}.`);
    if (value !== "") settings[setting.id] = value;
  }
  if (platform === "email") {
    settings.provider ??= "imap";
    const address = email(settings.address ?? "", "address");
    if (address !== "") settings.address = address;
  }
  const language = text(settingsIn, "language", 4, false);
  if (language === "ro" || language === "en") settings.language = language;
  const scope = raw.scope === "personal" ? "personal" : "company";
  return {
    id: idOf(raw, platform),
    platform,
    name: text(raw, "name", 80),
    scope,
    enabled: raw.enabled !== false,
    workspaceAllowlist: list(raw.workspaceAllowlist, 50),
    channelAllowlist: list(raw.channelAllowlist, 200),
    settings,
  };
}

function parseAgent(raw: Json): ZenChatAgent {
  const kind = raw.kind === "personal" ? "personal" : "company";
  const runtimeMode =
    raw.runtimeMode === "approval-required" || raw.runtimeMode === "auto"
      ? raw.runtimeMode
      : "auto-accept-edits";
  const ownerEmail = email(text(raw, "ownerEmail", 200, kind === "personal"), "ownerEmail");
  return {
    id: idOf(raw, "agent"),
    name: text(raw, "name", 80),
    kind,
    managerEmail: email(text(raw, "managerEmail", 200), "managerEmail"),
    ownerEmail: kind === "personal" ? ownerEmail : null,
    projectId: text(raw, "projectId", 200),
    model: text(raw, "model", 100, false) || ZEN_CHAT_DEFAULT_MODEL,
    runtimeMode,
    instructions: text(raw, "instructions", 4000, false),
  };
}

function parseBinding(raw: Json, config: ChatConfig): ZenChatBinding {
  const connectionId = text(raw, "connectionId", 64);
  const agentId = text(raw, "agentId", 64);
  if (!config.connections.some((connection) => connection.id === connectionId))
    throw fail("not-found", "Unknown connection.");
  if (!config.agents.some((agent) => agent.id === agentId))
    throw fail("not-found", "Unknown agent.");
  const posters = list(raw.posters, 50, 64).filter((id) =>
    config.agents.some((agent) => agent.id === id),
  );
  return {
    id: idOf(raw, "binding"),
    connectionId,
    channelId: text(raw, "channelId", 200),
    channelName: text(raw, "channelName", 120, false),
    agentId,
    respondTo: raw.respondTo === "all" ? "all" : "mention",
    posters,
  };
}

function parseMember(raw: Json): ZenChatMember {
  const role =
    raw.role === "owner" || raw.role === "admin" || raw.role === "guest" ? raw.role : "member";
  const identities = Array.isArray(raw.identities) ? raw.identities.slice(0, 20).map(asInput) : [];
  return {
    id: idOf(raw, "member"),
    email: email(text(raw, "email", 200), "email"),
    name: text(raw, "name", 120, false),
    role,
    identities: identities.map((identity) => ({
      platform: platformOf(identity.platform),
      workspaceId: text(identity, "workspaceId", 200, false),
      userId: text(identity, "userId", 200),
    })),
  };
}

function parseReport(
  raw: Json,
  config: ChatConfig,
  previous: ZenChatReport | undefined,
): ZenChatReport {
  const time = text(raw, "time", 5);
  if (!isValidTime(time)) throw fail("invalid-input", "time must be HH:MM.");
  const days = Array.isArray(raw.days)
    ? [
        ...new Set(
          raw.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6),
        ),
      ].toSorted()
    : [];
  if (days.length === 0) throw fail("invalid-input", "Pick at least one day.");
  const agentId = text(raw, "agentId", 64);
  const bindingId = text(raw, "bindingId", 64);
  if (!config.agents.some((agent) => agent.id === agentId))
    throw fail("not-found", "Unknown agent.");
  if (!config.bindings.some((binding) => binding.id === bindingId))
    throw fail("not-found", "Unknown channel.");
  return {
    id: idOf(raw, "report"),
    name: text(raw, "name", 120),
    agentId,
    bindingId,
    prompt: text(raw, "prompt", 4000),
    days,
    time,
    enabled: raw.enabled !== false,
    lastRunAt: previous?.lastRunAt ?? null,
    lastStatus: previous?.lastStatus ?? null,
  };
}

function parseSettings(raw: Json): ZenChatSettings {
  const quiet = asInput(raw.quietHours);
  const start = text(quiet, "start", 5, false) || "20:00";
  const end = text(quiet, "end", 5, false) || "08:00";
  if (!isValidTime(start) || !isValidTime(end))
    throw fail("invalid-input", "Quiet hours must be HH:MM.");
  const maxMb = Number(raw.maxAttachmentMb ?? 20);
  return {
    quietHours: { enabled: quiet.enabled === true, start, end },
    logContent: raw.logContent === true,
    maxAttachmentMb: Number.isFinite(maxMb) ? Math.min(100, Math.max(1, Math.round(maxMb))) : 20,
  };
}

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const services = yield* Effect.context<never>();
  const runPromise = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(services)(effect);

  const zenDir = NodePath.join(serverConfig.stateDir, "zen");
  const chatDir = NodePath.join(zenDir, "chat");
  const configFile = NodePath.join(chatDir, "chat.json");
  const runtimeFile = NodePath.join(chatDir, "runtime.json");
  const accessDir = NodePath.join(serverConfig.baseDir, "toolchains", "access");
  const ledgerFile = NodePath.join(accessDir, "ledger.json");
  // The toolchains vault (enterprise secrets): bot tokens are stored under `chat:<connection id>`.
  const vault = new SecretVault(accessDir, yield* HostProcess.Platform, true);
  const audit = new AuditLog(NodePath.join(chatDir, "audit.log"));
  const log = (message: string) => void runPromise(Effect.logInfo(message));

  let config: ChatConfig = loadConfig(configFile);
  let runtimeState: RuntimeState = pruneRuntime(loadRuntime(runtimeFile), new Date());
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistRuntime = () => {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        saveRuntime(runtimeFile, runtimeState);
      } catch (error) {
        log(`chat: could not save runtime state: ${String(error)}`);
      }
    }, 300);
  };
  const updateConfig = (change: (current: ChatConfig) => ChatConfig) => {
    config = change(config);
    saveConfig(configFile, config);
  };

  // Machine identity: is this the company runner, and whose machine is it?
  const machine = () => {
    let hubJson: string | null = null;
    let toolchainState: { settings?: { companyRunner?: unknown } } = {};
    try {
      hubJson = NodeFS.readFileSync(NodePath.join(zenDir, "hub.json"), "utf8");
    } catch {
      hubJson = null;
    }
    try {
      toolchainState = JSON.parse(
        NodeFS.readFileSync(
          NodePath.join(serverConfig.baseDir, "toolchains", "state.json"),
          "utf8",
        ),
      ) as typeof toolchainState;
    } catch {
      toolchainState = {};
    }
    const status = runnerStatus(hubJson, toolchainState.settings?.companyRunner === true);
    let hub: { hubUrl?: unknown; environment?: { id?: unknown } } = {};
    try {
      hub = hubJson ? (JSON.parse(hubJson) as typeof hub) : {};
    } catch {
      hub = {};
    }
    return {
      ...status,
      hubUrl: typeof hub.hubUrl === "string" ? hub.hubUrl : null,
      environmentId: typeof hub.environment?.id === "string" ? hub.environment.id : null,
      owner: status.hubUser ?? process.env.ZEN_CHAT_MACHINE_OWNER ?? null,
    };
  };

  // The agent side: chat conversations are ordinary threads of the agent's project.

  const modelSelection = (agent: ZenChatAgent): ModelSelection =>
    ({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: agent.model || ZEN_CHAT_DEFAULT_MODEL,
    }) as ModelSelection;

  const agentRuntime: AgentRuntime = {
    async start({ agent, title, text: body }) {
      const id = NodeCrypto.randomUUID();
      const messageId = `zen-chat-message:${id}`;
      const launched = await runPromise(
        threadLaunch.launch({
          commandId: CommandId.make(`zen-chat:start:${id}`),
          projectId: ProjectId.make(agent.projectId),
          title: title.slice(0, 120),
          modelSelection: modelSelection(agent),
          runtimeMode: agent.runtimeMode,
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: { messageId: MessageId.make(messageId), text: body, attachments: [] },
          createdBy: "user",
          creationSource: "server",
        }),
      );
      return { threadId: launched.threadId, messageId };
    },
    async send({ threadId, text: body }) {
      const shell = await runPromise(orchestrator.getThreadShell(ThreadId.make(threadId)));
      if (shell === null) throw new Error("thread is gone");
      const id = NodeCrypto.randomUUID();
      const messageId = `zen-chat-message:${id}`;
      await runPromise(
        threadManagement.sendToThread({
          projectId: shell.projectId,
          commandId: CommandId.make(`zen-chat:send:${id}`),
          threadId: ThreadId.make(threadId),
          messageId: MessageId.make(messageId),
          text: body,
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "server",
        }),
      );
      return { messageId };
    },
    async observe(threadId, afterMessageId): Promise<AgentObservation> {
      const records = await runPromise(
        orchestrator
          .getThreadRecords(ThreadId.make(threadId), [
            "messages",
            "runs",
            "runtimeRequests",
            "turnItems",
          ])
          .pipe(
            Effect.asSome,
            Effect.orElseSucceed(() => Option.none()),
          ),
      );
      if (Option.isNone(records) || records.value.thread.deletedAt !== null) {
        return { exists: false, running: false, replies: [], approvals: [], failed: false };
      }
      const { messages, runs, runtimeRequests, turnItems } = records.value;
      const ordered = messages.toSorted(
        (left, right) =>
          DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
      );
      const start = ordered.findIndex((message) => message.id === afterMessageId);
      const after = start === -1 ? [] : ordered.slice(start + 1);
      // Replies up to the next person's message (a queued follow-up gets its own follow).
      const nextUser = after.findIndex((message) => message.role === "user");
      const window = nextUser === -1 ? after : after.slice(0, nextUser);
      const replies = window
        .filter(
          (message) =>
            message.role === "assistant" &&
            !message.streaming &&
            message.text.trim() !== "" &&
            // An @mentioned AI staff agent's reply is relayed by relayMention, not as an answer.
            !String(message.id).startsWith("zen-staff-mention:"),
        )
        .map((message) => ({ id: message.id, text: message.text }));
      const userMessage = start === -1 ? undefined : ordered[start];
      const run =
        runs.find((candidate) => candidate.id === userMessage?.runId) ??
        runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
      const running =
        run === undefined || start === -1
          ? true
          : !ThreadManagementService.isTerminalRunStatus(run.status);
      const prompts = new Map<string, string>();
      for (const item of turnItems) {
        if (item.type !== "approval_request") continue;
        prompts.set(
          item.requestId,
          [item.prompt, item.reason].filter((part) => part && part.trim() !== "").join("\n"),
        );
      }
      const approvals = runtimeRequests
        .filter(
          (request) =>
            request.status === "pending" &&
            APPROVAL_KINDS.has(request.kind) &&
            request.responseCapability.type === "live",
        )
        .map((request) => ({
          requestId: request.id,
          kind: request.kind,
          prompt: prompts.get(request.id) ?? request.kind,
        }));
      return {
        exists: true,
        running,
        replies,
        approvals,
        failed:
          run !== undefined &&
          (run.status === "failed" || run.status === "interrupted" || run.status === "cancelled"),
      };
    },
    async respond(threadId, requestId, decision) {
      await runPromise(
        threadManagement.dispatch({
          type: "runtime-request.respond",
          commandId: CommandId.make(`zen-chat:approval:${NodeCrypto.randomUUID()}`),
          threadId: ThreadId.make(threadId),
          requestId: RuntimeRequestId.make(requestId),
          decision,
        }),
      );
    },
    async projectRoot(projectId) {
      const row = await runPromise(
        projects.get(ProjectId.make(projectId)).pipe(Effect.orElseSucceed(() => Option.none())),
      );
      return Option.isSome(row) ? row.value.workspaceRoot : null;
    },
  };

  const engine = new ChatEngine({
    config: () => config,
    runtime: agentRuntime,
    state: () => runtimeState,
    setState: (change) => {
      runtimeState = change(runtimeState);
      persistRuntime();
    },
    audit,
    context: () => {
      const current = machine();
      return {
        isRunner: current.isRunner,
        personalAgentAvailable: (agent) => personalAgentRunsHere(agent, current),
      };
    },
    inboxDir: NodePath.join(chatDir, "inbox"),
    log,
    onReportRun: (reportId, status, at) =>
      updateConfig((current) => ({
        ...current,
        reports: current.reports.map((report) =>
          report.id === reportId ? { ...report, lastRunAt: at, lastStatus: status } : report,
        ),
      })),
  });

  // Connections

  const live = new Map<
    string,
    {
      adapter: AdapterInstance;
      state: ZenChatConnectionState;
      detail: string | null;
      lastEventAt: string | null;
    }
  >();
  const vaultScope = (connectionId: string) => `chat:${connectionId}`;
  const apiBaseFor = (platform: ZenChatPlatform): string | null => {
    const value = process.env[`ZEN_CHAT_${platform.toUpperCase()}_API_URL`];
    return value && /^https?:\/\//.test(value) ? value.replace(/\/$/, "") : null;
  };
  const lockOf = (connection: ZenChatConnection): string | null => {
    const current = machine();
    if (connection.scope === "company" && !current.isRunner) {
      return "Company chat connections run only on the company's always-on server (Settings > Tools, or the hub's runner switch).";
    }
    const required =
      connection.platform === "email"
        ? ZEN_EMAIL_PROVIDER_SECRETS[emailProviderOf(connection)]
        : null;
    const missing = ZEN_CHAT_PLATFORM_INFO[connection.platform].secrets.filter(
      (secret) =>
        (required === null ? !/optional/i.test(secret.label) : required.includes(secret.id)) &&
        !vault.has(vaultScope(connection.id), secret.id),
    );
    if (missing.length > 0) return `Add the ${missing.map((secret) => secret.label).join(", ")}.`;
    if (connection.platform === "email" && !connection.settings.address)
      return "Add the mailbox address.";
    return null;
  };

  const stopConnection = (connectionId: string) => {
    const running = live.get(connectionId);
    if (running) running.adapter.stop();
    live.delete(connectionId);
    engine.unregisterClient(connectionId);
  };

  const startConnection = (connection: ZenChatConnection) => {
    stopConnection(connection.id);
    if (!connection.enabled) return;
    const lock = lockOf(connection);
    if (lock !== null) {
      live.set(connection.id, {
        adapter: {
          client: { platform: connection.platform, post: async () => ({ messageId: "" }) },
          start() {},
          stop() {},
          test: async () => ({ ok: false, detail: lock }),
        },
        state: "locked",
        detail: lock,
        lastEventAt: null,
      });
      return;
    }
    const entry = {
      adapter: null as unknown as AdapterInstance,
      state: "connecting" as ZenChatConnectionState,
      detail: null as string | null,
      lastEventAt: null as string | null,
    };
    entry.adapter = ADAPTERS[connection.platform]({
      connection,
      secret: (secretId) => vault.get(vaultScope(connection.id), secretId),
      emit: async (event) => {
        entry.lastEventAt = new Date().toISOString();
        await engine.handleEvent(connection.id, event);
      },
      setStatus: (state, detail) => {
        entry.state = state;
        entry.detail = detail;
      },
      log,
      fetch: globalThis.fetch,
      WebSocket: globalThis.WebSocket,
      apiBase: apiBaseFor(connection.platform),
      now: () => Date.now(),
      watchedLabels: () => watchedLabels(config.bindings, connection.id),
    });
    live.set(connection.id, entry);
    engine.registerClient(connection.id, entry.adapter.client);
    entry.adapter.start();
  };

  const startAll = () => {
    for (const connection of config.connections) {
      try {
        startConnection(connection);
      } catch (error) {
        log(`chat: ${connection.id} did not start: ${String(error)}`);
      }
    }
  };

  setZenChatRelayHandler(
    async (connectionId: string, request: RelayedRequest): Promise<RelayedResponse> => {
      const running = live.get(connectionId);
      if (
        running === undefined ||
        running.adapter.handleWebhook === undefined ||
        running.state === "locked"
      ) {
        return { status: 404, body: "unknown connection" };
      }
      return running.adapter.handleWebhook(request);
    },
  );

  startAll();
  let ticking = false;
  const tick = setInterval(
    () => {
      if (ticking) return;
      ticking = true;
      void engine
        .tick()
        .catch((error) => log(`chat: tick failed: ${String(error)}`))
        .finally(() => {
          ticking = false;
        });
    },
    Number(process.env.ZEN_CHAT_TICK_MS ?? 1000),
  );

  // AI staff agents @mentioned in a conversation answer back in it (staff/mentionReply.ts).
  setZenMentionRelay("zen-chat", (post) => engine.relayMention(post));

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      clearInterval(tick);
      setZenMentionRelay("zen-chat", null);
      for (const connectionId of Array.from(live.keys())) stopConnection(connectionId);
      setZenChatRelayHandler(null);
      try {
        saveRuntime(runtimeFile, runtimeState);
      } catch {
        // Best effort on shutdown.
      }
    }),
  );

  // RPC

  const ledger = (): AccessLedger => readLedger(ledgerFile);
  const chatGrants = () => ledger().grants.filter((grant) => grant.packId === ACCESS_PACK);
  /**
   * Enterprise tier: integrations are managed on the runner by people an admin unlocked (grants in
   * the runner's ledger, packId "chat-integrations"). Without any grant yet, the first admin who
   * confirms becomes the first grant. Without a hub, the machine's own user manages it.
   */
  const mayManage = (hubUser: string | null) => {
    const grants = chatGrants();
    return (
      hubUser === null || grants.length === 0 || grants.some((grant) => grant.user === hubUser)
    );
  };
  const requireManager = () => {
    const current = machine();
    if (!mayManage(current.hubUser)) {
      throw fail(
        "forbidden",
        "Ask an admin to unlock chat integrations for you on the company server.",
      );
    }
    if (current.hubUser !== null && chatGrants().length === 0) {
      const existing = ledger();
      writeLedger(ledgerFile, {
        ...existing,
        grants: [
          ...existing.grants,
          {
            packId: ACCESS_PACK,
            user: current.hubUser,
            grantedBy: current.hubUser,
            at: new Date().toISOString(),
          },
        ],
      });
    }
  };
  const access = () => {
    const current = machine();
    const grants = chatGrants();
    return {
      isRunner: current.isRunner,
      runnerSource: current.source,
      hubUser: current.hubUser,
      canManage: mayManage(current.hubUser),
      grants: grants.map((grant) => ({
        user: grant.user,
        grantedBy: grant.grantedBy,
        at: grant.at,
      })),
      lock: current.isRunner
        ? null
        : "This machine is not the company's always-on server: company connections stay off here. Personal connections work for their owner only.",
    };
  };

  const view = (connection: ZenChatConnection): ZenChatConnectionView => {
    const running = live.get(connection.id);
    const current = machine();
    return {
      ...connection,
      secretsStored: Object.fromEntries(
        ZEN_CHAT_PLATFORM_INFO[connection.platform].secrets.map((secret) => [
          secret.id,
          vault.has(vaultScope(connection.id), secret.id),
        ]),
      ),
      state: running?.state ?? "stopped",
      detail: running?.detail ?? null,
      lastEventAt: running?.lastEventAt ?? null,
      webhookUrl:
        ZEN_CHAT_PLATFORM_INFO[connection.platform].transport === "hub-relay"
          ? webhookUrlFor(current.hubUrl, current.environmentId, connection.id)
          : null,
    };
  };

  const status = (): ZenChatStatus => ({
    access: access(),
    vaultKeyStore: vault.keyStore,
    connections: config.connections.map(view),
    agents: config.agents,
    bindings: config.bindings,
    members: config.members,
    reports: config.reports,
    settings: config.settings,
    pendingApprovals: engine.pendingApprovals(),
    conversations: Object.keys(runtimeState.conversations).length,
  });

  const upsert = <T extends { id: string }>(items: ReadonlyArray<T>, item: T) =>
    items.some((existing) => existing.id === item.id)
      ? items.map((existing) => (existing.id === item.id ? item : existing))
      : [...items, item];

  const requireAdmin = (input: Json) => {
    if (input.adminConfirmed !== true)
      throw fail("forbidden", "Only an admin of the company may do this. Confirm you are one.");
  };

  const run = async (op: ZenChatCallInput["op"], rawInput: unknown): Promise<unknown> => {
    const input = asInput(rawInput);
    if (
      op !== "status" &&
      op !== "manifest" &&
      op !== "audit.list" &&
      op !== "connection.test" &&
      op !== "approval.list" &&
      op !== "approval.decide"
    )
      requireManager();
    switch (op) {
      case "status":
        return status();
      case "connection.save": {
        const connection = parseConnection(asInput(input.connection));
        updateConfig((current) => ({
          ...current,
          connections: upsert(current.connections, connection),
        }));
        startConnection(connection);
        return view(connection);
      }
      case "connection.remove": {
        const id = text(input, "id", 64);
        stopConnection(id);
        for (const secret of Object.values(ZEN_CHAT_PLATFORM_INFO).flatMap(
          (info) => info.secrets,
        )) {
          vault.remove(vaultScope(id), secret.id);
        }
        updateConfig((current) => {
          const bindingIds = new Set(
            current.bindings
              .filter((binding) => binding.connectionId === id)
              .map((binding) => binding.id),
          );
          return {
            ...current,
            connections: current.connections.filter((connection) => connection.id !== id),
            bindings: current.bindings.filter((binding) => !bindingIds.has(binding.id)),
            reports: current.reports.filter((report) => !bindingIds.has(report.bindingId)),
          };
        });
        return { ok: true };
      }
      case "connection.setSecret": {
        requireAdmin(input);
        const connectionId = text(input, "connectionId", 64);
        const connection = config.connections.find((candidate) => candidate.id === connectionId);
        if (connection === undefined) throw fail("not-found", "Unknown connection.");
        const secretId = text(input, "secretId", 64);
        if (
          !ZEN_CHAT_PLATFORM_INFO[connection.platform].secrets.some(
            (secret) => secret.id === secretId,
          ) &&
          secretId !== "webhookSecret"
        ) {
          throw fail("invalid-input", "Unknown secret for this platform.");
        }
        const value = text(input, "value", 20_000);
        vault.set(vaultScope(connectionId), secretId, value);
        audit.write({
          at: new Date().toISOString(),
          direction: "system",
          platform: connection.platform,
          connectionId,
          kind: "secret-stored",
          workspaceId: null,
          channelId: null,
          userId: null,
          memberEmail: machine().hubUser,
          agentId: null,
          threadId: null,
          chars: 0,
          attachments: 0,
          outcome: secretId,
        });
        startConnection(connection);
        return view(connection);
      }
      case "connection.removeSecret": {
        const connectionId = text(input, "connectionId", 64);
        const connection = config.connections.find((candidate) => candidate.id === connectionId);
        if (connection === undefined) throw fail("not-found", "Unknown connection.");
        vault.remove(vaultScope(connectionId), text(input, "secretId", 64));
        startConnection(connection);
        return view(connection);
      }
      case "connection.test": {
        const connectionId = text(input, "connectionId", 64);
        const running = live.get(connectionId);
        if (running === undefined) throw fail("not-found", "This connection is not running.");
        return running.adapter.test();
      }
      case "connection.restart": {
        const connection = config.connections.find(
          (candidate) => candidate.id === text(input, "connectionId", 64),
        );
        if (connection === undefined) throw fail("not-found", "Unknown connection.");
        startConnection(connection);
        return view(connection);
      }
      case "agent.save": {
        const agent = parseAgent(asInput(input.agent));
        updateConfig((current) => ({ ...current, agents: upsert(current.agents, agent) }));
        return agent;
      }
      case "agent.remove": {
        const id = text(input, "id", 64);
        updateConfig((current) => ({
          ...current,
          agents: current.agents.filter((agent) => agent.id !== id),
          bindings: current.bindings
            .filter((binding) => binding.agentId !== id)
            .map((binding) => ({
              ...binding,
              posters: binding.posters.filter((poster) => poster !== id),
            })),
          reports: current.reports.filter((report) => report.agentId !== id),
        }));
        return { ok: true };
      }
      case "binding.save": {
        const binding = parseBinding(asInput(input.binding), config);
        updateConfig((current) => ({ ...current, bindings: upsert(current.bindings, binding) }));
        return binding;
      }
      case "binding.remove": {
        const id = text(input, "id", 64);
        updateConfig((current) => ({
          ...current,
          bindings: current.bindings.filter((binding) => binding.id !== id),
          reports: current.reports.filter((report) => report.bindingId !== id),
        }));
        return { ok: true };
      }
      case "member.save": {
        const member = parseMember(asInput(input.member));
        updateConfig((current) => ({
          ...current,
          members: upsert(
            current.members.filter(
              (existing) => existing.id === member.id || existing.email !== member.email,
            ),
            member,
          ),
        }));
        return member;
      }
      case "member.remove": {
        const id = text(input, "id", 64);
        updateConfig((current) => ({
          ...current,
          members: current.members.filter((member) => member.id !== id),
        }));
        return { ok: true };
      }
      case "report.save": {
        const raw = asInput(input.report);
        const previous = config.reports.find((report) => report.id === raw.id);
        const report = parseReport(raw, config, previous);
        updateConfig((current) => ({ ...current, reports: upsert(current.reports, report) }));
        return report;
      }
      case "report.remove": {
        const id = text(input, "id", 64);
        updateConfig((current) => ({
          ...current,
          reports: current.reports.filter((report) => report.id !== id),
        }));
        return { ok: true };
      }
      case "report.runNow":
        return { status: await engine.runReport(text(input, "id", 64)) };
      case "settings.save": {
        const settings = parseSettings(asInput(input.settings));
        updateConfig((current) => ({ ...current, settings }));
        return settings;
      }
      case "access.grant": {
        requireAdmin(input);
        const user = email(text(input, "user", 200), "user");
        const current = ledger();
        writeLedger(ledgerFile, {
          ...current,
          grants: [
            ...current.grants.filter(
              (grant) => !(grant.packId === ACCESS_PACK && grant.user === user),
            ),
            {
              packId: ACCESS_PACK,
              user,
              grantedBy: machine().hubUser ?? "local",
              at: new Date().toISOString(),
            },
          ],
        });
        return access();
      }
      case "access.revoke": {
        const user = email(text(input, "user", 200), "user");
        const current = ledger();
        writeLedger(ledgerFile, {
          ...current,
          grants: current.grants.filter(
            (grant) => !(grant.packId === ACCESS_PACK && grant.user === user),
          ),
        });
        return access();
      }
      case "manifest": {
        const platform = platformOf(input.platform);
        const connectionId = typeof input.connectionId === "string" ? input.connectionId : null;
        const connection =
          config.connections.find((candidate) => candidate.id === connectionId) ?? null;
        const current = machine();
        return MANIFESTS[platform]({
          connection,
          appName: connection?.name || "Zen Staff",
          webhookUrl: connection
            ? webhookUrlFor(current.hubUrl, current.environmentId, connection.id)
            : null,
        });
      }
      case "approval.list":
        return engine.emailApprovals(Math.min(200, Math.max(1, Number(input.limit ?? 50) || 50)));
      case "approval.decide": {
        // The manager decides here: the signed-in hub user, or (without a hub) the person at this
        // machine confirming they are that manager.
        const approvalId = text(input, "approvalId", 64);
        const decision = input.decision === "accept" ? "accept" : "decline";
        const hubUser = machine().hubUser;
        const by =
          hubUser ??
          (input.managerConfirmed === true
            ? email(text(input, "managerEmail", 200), "managerEmail")
            : "");
        if (by === "")
          throw fail(
            "forbidden",
            "Only the agent's manager can decide. Confirm you are the manager.",
          );
        const body =
          input.body === undefined || input.body === null ? null : text(input, "body", 100_000);
        const result = await engine.decideFromPage({ approvalId, decision, by, body });
        if (!result.ok) throw fail("forbidden", result.detail);
        return result;
      }
      case "audit.list": {
        const limit = Math.min(500, Math.max(1, Number(input.limit ?? 100) || 100));
        return audit.read(limit);
      }
      default:
        throw fail("invalid-input", "Unknown operation.");
    }
  };

  const call = (input: ZenChatCallInput) =>
    Effect.tryPromise({
      try: () => run(input.op, input.input),
      catch: (cause) =>
        isZenChatError(cause)
          ? cause
          : fail(
              "unavailable",
              cause instanceof Error ? cause.message : "Chat integrations failed.",
            ),
    });

  return ZenChat.of({ call });
});

export const layer = Layer.effect(ZenChat, make);

/** RPC handler for ws.ts; the service is optional so upstream ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenChat["Service"]>) => ({
  [ZEN_CHAT_WS_METHODS.call]: (input: ZenChatCallInput) =>
    Option.isSome(service)
      ? service.value.call(input)
      : Effect.fail(fail("unavailable", "Chat integrations are not available on this server.")),
});
