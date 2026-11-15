// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off globalDate:off processEnvInEffect:off tryCatchInEffectGen:off effectFnOpportunity:off -- The staff engine is a promise boundary: MCP calls, the adapter gate and timers call back outside any fiber.
// Zen Staff AI staff: the service. Wires the engine (staffEngine.ts) to upstream's threads
// (launch, send, records, domain events), the text model (Haiku through TextGeneration),
// scheduled tasks and Zen's scheduled limits; starts the `zen-staff` MCP server and installs
// the adapter hooks (staffMcp.ts). One RPC, `zen.staff.call`. See ZEN.md, "AI staff".
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  type ChatAttachment,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  TurnItemId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
  type RuntimeMode,
} from "@t3tools/contracts";
import { resolveProjectProviderInstanceEnabled } from "@t3tools/contracts/settings";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  ZEN_STAFF_WS_METHODS,
  ZenStaffError,
  type ZenStaffCallInput,
} from "@t3tools/contracts/zenStaff";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import { forkParked } from "../../serverActivation.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { mimeFromName } from "../chat/text.ts";
import { storeCopiedAttachment } from "../hub/copyAttachments.ts";
import { sumRunTokens } from "../scheduledLimits/limitsPolicy.ts";
import { findOnPath } from "../toolchains/probe.ts";
import { setZenThreadSettingsContributor, zenThreadToolchain } from "../toolchains/threadEnv.ts";
import * as ZenScheduledLimits from "../scheduledLimits/ZenScheduledLimits.ts";
import registry from "../workflows/registry.json" with { type: "json" };
import { ZEN_WORKFLOW_ASSETS } from "../workflows/embeddedAssets.gen.ts";
import { relayMention, type MentionPost } from "./mentionReply.ts";
import { STAFF_MODEL } from "./prompts.ts";
import { setZenStaffResolver, startStaffMcpServer } from "./staffMcp.ts";
import type { DiscoveryItem } from "./analytics.ts";
import { setZenStaffHubPort } from "../hub/companyPorts.ts";
import { StaffEngine, StaffError, type ThreadInfo, type ThreadUsage } from "./staffEngine.ts";
import { planAgentShell, type AgentShellPlan } from "./staffNetwork.ts";

/** Provider requests a person answers (tool approvals), as the chat integrations list them. */
const APPROVAL_REQUEST_KINDS = new Set([
  "command",
  "file-read",
  "file-change",
  "permission",
  "mcp-elicitation",
  "dynamic_tool_call",
]);

export class ZenStaff extends Context.Service<
  ZenStaff,
  {
    readonly call: (input: ZenStaffCallInput) => Effect.Effect<unknown, ZenStaffError>;
  }
>()("t3/zen/staff/ZenStaff") {}

const toZenStaffError = (cause: unknown): ZenStaffError =>
  cause instanceof StaffError
    ? new ZenStaffError({ reason: cause.reason, detail: cause.message })
    : new ZenStaffError({
        reason: "unavailable",
        detail: cause instanceof Error ? cause.message : "The AI staff request failed.",
      });

interface RegistryWorkflowEntry {
  readonly id: string;
  readonly name: string;
  readonly kind?: string;
  readonly path?: string;
  /** A pack of several workflows: the ids of its member workflows (each runs on its own). */
  readonly workflows?: ReadonlyArray<string>;
  readonly i18n?: { readonly ro?: { readonly name?: string } };
}

function workflowNames(entry: Pick<RegistryWorkflowEntry, "name" | "i18n">): string[] {
  return [entry.name, ...(entry.i18n?.ro?.name ? [entry.i18n.ro.name] : [])];
}

/** A pack member's own name, from its bundled workflow.json (the pack's name if unreadable). */
function packMember(entry: RegistryWorkflowEntry, id: string) {
  try {
    const raw = ZEN_WORKFLOW_ASSETS[`${entry.path ?? `packs/${entry.id}`}/${id}/workflow.json`];
    const member = raw === undefined ? null : (JSON.parse(raw) as Partial<RegistryWorkflowEntry>);
    if (member && typeof member.name === "string") {
      return {
        id,
        name: member.name,
        names: workflowNames({ name: member.name, ...(member.i18n ? { i18n: member.i18n } : {}) }),
      };
    }
  } catch {
    // Falls back to the pack's name below.
  }
  return { id, name: entry.name, names: workflowNames(entry) };
}

const WORKFLOWS = (registry as { entries: ReadonlyArray<RegistryWorkflowEntry> }).entries
  // "Coming soon" entries cannot run yet, so agents are never given them.
  .filter((entry) => entry.kind !== "coming_soon")
  // A pack of several workflows is given to agents as its member workflows.
  .flatMap((entry) =>
    entry.workflows !== undefined && entry.workflows.length > 0
      ? entry.workflows.map((id) => packMember(entry, id))
      : [{ id: entry.id, name: entry.name, names: workflowNames(entry) }],
  );

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const scheduledLimits = yield* ZenScheduledLimits.ZenScheduledLimits;
  const fileSystem = yield* FileSystem.FileSystem;
  const eventSink = yield* EventSink.EventSinkV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const toMs = (value: DateTime.Utc | null | undefined) =>
    value === null || value === undefined ? null : DateTime.toEpochMillis(value);

  const threads = async (
    threadIds: ReadonlyArray<string> | null,
  ): Promise<ReadonlyArray<ThreadInfo>> => {
    const snapshot = await runPromise(
      orchestrator.getShellSnapshot(
        threadIds === null ? undefined : { threadIds: threadIds.map((id) => ThreadId.make(id)) },
      ),
    );
    return snapshot.threads.map((shell) => {
      const record = shell as unknown as {
        createdAt?: DateTime.Utc;
        modelSelection?: { instanceId: string; model: string };
      };
      return {
        id: String(shell.id),
        projectId: String(shell.projectId),
        title: shell.title,
        active: shell.activeRunId !== null,
        createdAtMs: toMs(record.createdAt) ?? 0,
        modelSelection: record.modelSelection
          ? {
              instanceId: String(record.modelSelection.instanceId),
              model: record.modelSelection.model,
            }
          : null,
        runtimeMode: shell.runtimeMode,
      };
    });
  };

  const usage = async (threadId: string): Promise<ThreadUsage | null> => {
    const records = await runPromise(
      orchestrator
        .getThreadRecords(ThreadId.make(threadId), [
          "runs",
          "attempts",
          "providerTurns",
          "messages",
          "runtimeRequests",
          "turnItems",
        ])
        .pipe(
          Effect.asSome,
          Effect.orElseSucceed(() => Option.none()),
        ),
    );
    if (Option.isNone(records)) return null;
    const { runs, attempts, providerTurns, messages, runtimeRequests, turnItems } = records.value;
    if (runs.length === 0) return null;
    let tokens: number | null = null;
    let durationMs = 0;
    let firstStart: number | null = null;
    let lastEnd: number | null = null;
    for (const run of runs) {
      const sum = sumRunTokens(run.id, attempts, providerTurns);
      if (sum !== null) tokens = (tokens ?? 0) + sum.inputTokens + sum.outputTokens;
      const start = toMs(run.workStartedAt ?? run.startedAt);
      const end = toMs(run.completedAt);
      if (start !== null && end !== null) durationMs += Math.max(0, end - start);
      if (start !== null) firstStart = firstStart === null ? start : Math.min(firstStart, start);
      if (end !== null) lastEnd = lastEnd === null ? end : Math.max(lastEnd, end);
    }
    const latest = ThreadManagementService.latestRun({ runs });
    const status: ThreadUsage["status"] =
      latest === undefined ||
      ThreadManagementService.isActiveRun(latest) ||
      latest.status === "queued"
        ? "running"
        : latest.status === "completed"
          ? "completed"
          : latest.status === "failed"
            ? "failed"
            : "interrupted";
    const firstUser = messages.find((message) => message.role === "user");
    const prompts = new Map<string, string>();
    for (const item of turnItems) {
      if (item.type !== "approval_request") continue;
      prompts.set(
        item.requestId,
        [item.prompt, item.reason].filter((part) => part && part.trim() !== "").join(": "),
      );
    }
    const pendingRequests = runtimeRequests
      .filter((request) => request.status === "pending" && APPROVAL_REQUEST_KINDS.has(request.kind))
      .map((request) => prompts.get(request.id) ?? request.kind);
    const lastAnswer =
      messages.findLast(
        (message) =>
          message.role === "assistant" && !message.streaming && message.text.trim() !== "",
      )?.text ?? null;
    return {
      pendingRequests,
      lastAnswer,
      status,
      durationMs: durationMs > 0 ? durationMs : null,
      tokens,
      firstUserText: firstUser?.text ?? null,
      minutesSpan:
        firstStart !== null && lastEnd !== null
          ? Math.round((lastEnd - firstStart) / 60_000)
          : null,
    };
  };

  const generate = (prompt: string) =>
    runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "zen-staff-" });
          const generated = yield* textGeneration.generateTranscriptionPostProcessing({
            cwd,
            prompt,
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: STAFF_MODEL,
            } as ModelSelection,
          });
          return generated.transcription;
        }),
      ),
    );

  // @mention replies: one assistant message per task in the chat the mention came from (written
  // straight into the thread, so no turn starts there), updated in place; chat integrations relay
  // it to Slack, Teams, ... A chat shared through the hub shows it like any other message.
  const mentionOrdinals = new Map<string, number>();
  let mentionWrites = 0;
  const mentionAttachments = new Map<string, ReadonlyArray<ChatAttachment>>();
  const attachFiles = (threadId: string, files: ReadonlyArray<string>): ChatAttachment[] =>
    files.flatMap((file) => {
      try {
        const bytes = NodeFS.readFileSync(file);
        const name = NodePath.basename(file);
        const mimeType = mimeFromName(name);
        const stored = storeCopiedAttachment({
          attachmentsDir: serverConfig.attachmentsDir,
          threadId,
          source: {
            id: name,
            name,
            mimeType,
            sizeBytes: bytes.byteLength,
            kind: mimeType.startsWith("image/") ? "image" : "file",
          },
          bytes,
        });
        return stored === null ? [] : [stored];
      } catch {
        return [];
      }
    });
  const postMention = async (post: MentionPost): Promise<void> => {
    const threadId = ThreadId.make(post.originThreadId);
    const shell = await runPromise(orchestrator.getThreadShell(threadId));
    if (shell === null) return;
    let ordinal = mentionOrdinals.get(post.key);
    if (ordinal === undefined) {
      const records = await runPromise(
        orchestrator.getThreadRecords(threadId, ["turnItems"]).pipe(
          Effect.asSome,
          Effect.orElseSucceed(() => Option.none()),
        ),
      );
      ordinal = Option.isNone(records)
        ? 1
        : records.value.turnItems.reduce((max, item) => Math.max(max, item.ordinal + 1), 1);
      mentionOrdinals.set(post.key, ordinal);
    }
    let attachments = mentionAttachments.get(post.key) ?? [];
    if (post.final && post.files.length > 0 && attachments.length === 0) {
      attachments = attachFiles(post.originThreadId, post.files);
      mentionAttachments.set(post.key, attachments);
    }
    const now = DateTime.makeUnsafe(Date.now());
    const messageId = MessageId.make(`zen-staff-mention:${post.key}`);
    const itemId = TurnItemId.make(`zen-staff-mention:${post.key}`);
    mentionWrites += 1;
    const eventSuffix = `${post.key}:${Date.now()}:${mentionWrites}`;
    const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
      {
        id: EventId.make(`zen-staff-mention:message:${eventSuffix}`),
        type: "message.updated",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "agent",
          creationSource: "server",
          id: messageId,
          threadId,
          runId: null,
          nodeId: null,
          role: "assistant",
          text: post.markdown,
          attachments,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        id: EventId.make(`zen-staff-mention:turn-item:${eventSuffix}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: now,
        payload: {
          threadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          status: "completed",
          title: null,
          id: itemId,
          ordinal,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "assistant_message",
          messageId,
          text: post.markdown,
          streaming: false,
        },
      },
    ];
    await runPromise(eventSink.write({ events }).pipe(Effect.orDie));
    await relayMention(post);
  };

  const engine = new StaffEngine({
    stateDir: serverConfig.stateDir,
    zenHome: serverConfig.baseDir,
    now: () => new Date(),
    threads,
    usage,
    launch: (input) =>
      runPromise(
        threadLaunch
          .launch({
            commandId: CommandId.make(`zen-staff:launch:${input.threadId}`),
            threadId: ThreadId.make(input.threadId),
            projectId: ProjectId.make(input.projectId),
            title: input.title,
            modelSelection: {
              instanceId: ProviderInstanceId.make(input.modelSelection.instanceId),
              model: input.modelSelection.model,
            } as ModelSelection,
            runtimeMode: input.runtimeMode as RuntimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            workspaceStrategy: { type: "root" },
            initialMessage: {
              messageId: MessageId.make(`zen-staff-message:${input.threadId}`),
              text: input.text,
              attachments: [],
            },
            createdBy: "user",
            creationSource: "server",
          })
          .pipe(Effect.asVoid),
      ),
    send: (input) =>
      runPromise(
        threadManagement
          .sendToThread({
            projectId: ProjectId.make(input.projectId),
            commandId: CommandId.make(`zen-staff:send:${input.key}`),
            threadId: ThreadId.make(input.threadId),
            messageId: MessageId.make(`zen-staff-message:${input.key}`),
            text: input.text,
            attachments: [],
            mode: "queue",
            createdBy: "user",
            creationSource: "server",
          })
          .pipe(Effect.asVoid),
      ),
    generate,
    providerAvailable: (instanceId) =>
      runPromise(
        serverSettings.getSettings.pipe(
          Effect.map((settings) =>
            resolveProjectProviderInstanceEnabled(
              settings,
              null,
              ProviderInstanceId.make(instanceId),
            ),
          ),
          Effect.orElseSucceed(() => false),
        ),
      ),
    upsertDuty: async (input) => {
      const weekday = input.weekday === 7 ? 0 : input.weekday;
      const result = await runPromise(
        scheduledTasks.upsert({
          ...(input.taskId === null ? {} : { id: ScheduledTaskId.make(input.taskId) }),
          title: input.title,
          prompt: input.prompt,
          enabled: true,
          schedule: { type: "fixed_time", timeOfDay: input.time, weekdays: [weekday] },
          projectId: ProjectId.make(input.projectId),
          threadId: null,
          workspaceStrategy: { type: "root" },
          modelSelection: {
            instanceId: ProviderInstanceId.make(input.modelSelection.instanceId),
            model: input.modelSelection.model,
          } as ModelSelection,
          runtimeMode: input.runtimeMode as RuntimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        }),
      );
      const taskId = String(result.task.id);
      await runPromise(
        scheduledLimits
          .setTaskLimits({
            taskId: ScheduledTaskId.make(taskId),
            limits: {
              maxRunsPerDay:
                input.limits.maxRunsPerDay === null ? null : Math.round(input.limits.maxRunsPerDay),
              maxDurationMinutes:
                input.limits.maxMinutes === null ? null : Math.round(input.limits.maxMinutes),
              quietHours: input.limits.quiet,
            },
          })
          .pipe(Effect.ignore),
      );
      return taskId;
    },
    deleteDuty: (taskId) =>
      runPromise(scheduledTasks.delete({ id: ScheduledTaskId.make(taskId) }).pipe(Effect.asVoid)),
    workflows: () => WORKFLOWS,
    extraHistory: () => {
      const file = process.env.ZEN_STAFF_FAKE_HISTORY;
      if (!file) return [];
      try {
        return JSON.parse(NodeFS.readFileSync(file, "utf8")) as ReadonlyArray<DiscoveryItem>;
      } catch {
        return [];
      }
    },
    log: (message, detail) =>
      void runPromise(Effect.logWarning(message, detail)).catch(() => undefined),
    postMention,
    projectRoot: async (projectId) => {
      const row = await runPromise(
        projects.get(ProjectId.make(projectId)).pipe(Effect.orElseSucceed(() => Option.none())),
      );
      return Option.isSome(row) ? row.value.workspaceRoot : null;
    },
  });

  // Company agents' shell without network while "Aprobări" is on (staffNetwork.ts). The plan is
  // built when Claude Code starts for the thread; without a known folder the shell is denied.
  const shellRoot = NodePath.join(serverConfig.stateDir, "zen", "staff", "shell");
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const planCache = new Map<string, { plan: AgentShellPlan; at: number }>();
  const shellPlan = (threadId: string, cwd: string | undefined): AgentShellPlan | null => {
    if (!engine.shellWithoutNetwork(threadId)) return null;
    const cacheKey = `${threadId}\0${cwd ?? ""}`;
    const cached = planCache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.at < 10_000) return cached.plan;
    const toolchainEnv = zenThreadToolchain(threadId)?.env ?? {};
    const writableDirs = [
      ...(platform === "win32" ? [] : ["/tmp", "/var/tmp"]),
      ...[toolchainEnv.ZEN_TASK_DIR].filter((dir): dir is string => typeof dir === "string"),
    ];
    let plan: AgentShellPlan;
    try {
      plan = planAgentShell({
        platform,
        arch,
        threadId,
        projectDir: cwd ?? "",
        shellRoot,
        sandboxProgram: platform === "linux" ? findOnPath("bwrap") : null,
        bash:
          cwd === undefined || platform === "win32"
            ? null
            : NodeFS.existsSync("/bin/bash")
              ? "/bin/bash"
              : findOnPath("bash"),
        writableDirs,
        homeDir: NodeOS.homedir(),
      });
    } catch {
      plan = planAgentShell({
        platform,
        arch,
        threadId,
        projectDir: cwd ?? "",
        shellRoot,
        sandboxProgram: null,
        bash: null,
        writableDirs,
        homeDir: null,
      });
    }
    planCache.set(cacheKey, { plan, at: Date.now() });
    if (planCache.size > 500) planCache.delete(planCache.keys().next().value!);
    return plan;
  };
  setZenThreadSettingsContributor("zen-staff-network", (threadId, cwd) => {
    const plan = shellPlan(threadId, cwd);
    return plan === null ? null : { env: plan.env, deny: plan.deny };
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => setZenThreadSettingsContributor("zen-staff-network", null)),
  );

  const mcp = yield* Effect.promise(() =>
    startStaffMcpServer(
      (threadId) => engine.toolsFor(threadId),
      Number(process.env.ZEN_STAFF_MCP_PORT ?? 0) || 0,
    ),
  );
  setZenStaffResolver({
    mcpFor: (threadId) =>
      engine.isAgentThread(threadId)
        ? { url: mcp.urlFor(threadId), token: mcp.tokenFor(threadId) }
        : null,
    gate: (threadId, toolName) => engine.gate(threadId, toolName),
    shellOffline: (threadId) => engine.shellWithoutNetwork(threadId),
  });
  // Hub v6: verified company profiles come in from ZenHub; relayed tasks start here (runner).
  setZenStaffHubPort({
    apply: (input) => engine.applyHub(input),
    applied: (localCompanyId) => engine.appliedHub(localCompanyId),
    listForMembers: (localCompanyId) => engine.listHubForMembers(localCompanyId),
    startFromHub: (input) => engine.startFromHub(input),
    runForHub: (input) => engine.runForHub(input),
    followForHub: (input) => engine.followForHub(input),
  });
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      setZenStaffHubPort(null);
      setZenStaffResolver(null);
      await mcp.close();
    }),
  );

  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
      if (event.type === "run.updated") {
        const status = event.payload.status;
        const terminal =
          status === "completed" ||
          status === "failed" ||
          status === "cancelled" ||
          status === "interrupted";
        return Effect.promise(() =>
          engine
            .onRunUpdated(String(event.threadId), terminal, status === "waiting")
            .catch(() => undefined),
        );
      }
      // A tool approval the agent asked for in its own chat shows in an @mention's reply.
      if (event.type === "runtime-request.updated") {
        return Effect.promise(() =>
          engine.onRunUpdated(String(event.threadId), false, true).catch(() => undefined),
        );
      }
      if (
        event.type === "message.updated" &&
        event.payload.role === "user" &&
        !event.payload.streaming
      ) {
        const payload = event.payload;
        return Effect.promise(() =>
          engine
            .onUserMessage({
              id: String(payload.id),
              threadId: String(payload.threadId),
              text: payload.text,
              scheduledTaskId:
                payload.scheduledTaskId === undefined ? null : String(payload.scheduledTaskId),
              createdBy: payload.createdBy,
            })
            .catch(() => undefined),
        );
      }
      return Effect.void;
    }),
  );
  // Weekly reports to managers (Mondays after 08:00, server time).
  const reportTimer = setInterval(
    () => {
      try {
        engine.autoWeeklyReports();
      } catch {
        // Next hour.
      }
    },
    60 * 60 * 1000,
  );
  reportTimer.unref?.();
  yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(reportTimer)));
  // @mentions given to hub agents that run on the company runner: their replies follow the runner.
  const mentionTimer = setInterval(() => {
    void engine.pollRemoteMentions().catch(() => undefined);
  }, 15_000);
  mentionTimer.unref?.();
  yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(mentionTimer)));

  // Keep the state folder private even if it was created by hand.
  try {
    NodeFS.mkdirSync(NodePath.join(serverConfig.stateDir, "zen", "staff"), {
      recursive: true,
      mode: 0o700,
    });
  } catch {
    // Created on first save.
  }

  return ZenStaff.of({
    call: (input) =>
      Effect.tryPromise({ try: () => engine.call(input.op, input.input), catch: toZenStaffError }),
  });
});

export const layer = Layer.effect(ZenStaff, make);

/** RPC handlers for ws.ts; the service is optional so upstream ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenStaff["Service"]>) => ({
  [ZEN_STAFF_WS_METHODS.call]: (input: ZenStaffCallInput) =>
    Option.isSome(service)
      ? service.value.call(input)
      : Effect.fail(
          new ZenStaffError({
            reason: "unavailable",
            detail: "AI staff is not available on this server.",
          }),
        ),
});
