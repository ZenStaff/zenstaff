// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - tests of the plain async toolchain core.
// Zen Staff: unattended scheduled workflow runs (ZEN.md, "Scheduled workflows"). A scheduled run
// whose prompt names a workflow with an `unattended` block runs in dontAsk mode with only that
// workflow's declared commands allowed; everything else is denied, nothing waits for approval.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import {
  parseZenScheduledWorkflowMarker,
  unattendedProblems,
  zenScheduledWorkflowMarker,
} from "@t3tools/contracts/zenToolchains";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { claudeRuntimeQueryPolicyForRuntimePolicy } from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import { ToolchainManager } from "./manager.ts";
import { unattendedPermissionRules } from "./sandbox.ts";
import {
  resolveZenUnattendedTurn,
  withZenToolchainEnv,
  withZenToolchainSettings,
  withZenUnattendedPolicy,
  type ZenUnattendedTurn,
} from "./threadEnv.ts";
import { parseUnattended } from "./workflowRequirements.ts";

const SHIPPED_PACKS = NodePath.join(import.meta.dirname, "..", "workflows", "packs");

const policy = (runtimeMode: "approval-required" | "auto-accept-edits" | "full-access") =>
  claudeRuntimeQueryPolicyForRuntimePolicy(
    ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
      runtimeMode,
      interactionMode: "default",
      cwd: "/work",
    }),
  );

it("marks a scheduled prompt with a workflow line and reads it back", () => {
  const prompt = `${zenScheduledWorkflowMarker("website-change-watcher")}\nRun the check.`;
  assert.equal(parseZenScheduledWorkflowMarker(prompt), "website-change-watcher");
  assert.equal(parseZenScheduledWorkflowMarker("Run [zen-workflow: x-y] inline"), null);
  assert.equal(parseZenScheduledWorkflowMarker("[zen-workflow: ../etc]"), null);
  assert.equal(parseZenScheduledWorkflowMarker("Run the check."), null);
});

it("refuses admin rights, installers, shells and unknown agent tools", () => {
  assert.deepEqual(unattendedProblems({ commands: ["curl", "python3"], tools: ["WebFetch"] }), []);
  const problems = unattendedProblems({
    commands: ["sudo", "bash", "npx", "rm -rf", "curl"],
    tools: ["Bash", "WebSearch"],
  });
  assert.equal(problems.length, 5);
  assert.isTrue(problems.some((problem) => problem.includes('"sudo"')));
  assert.isTrue(problems.some((problem) => problem.includes('"rm -rf"')));
  assert.isTrue(problems.some((problem) => problem.includes('"Bash"')));
  const parsed = parseUnattended(JSON.stringify({ id: "x", unattended: { commands: ["su"] } }));
  assert.equal(parsed.unattended, null);
  assert.equal(parsed.problems.length, 1);
  assert.deepEqual(parseUnattended(JSON.stringify({ id: "x" })), {
    unattended: null,
    problems: [],
  });
});

it("allows only the declared commands, file work in the task folder and declared tools", () => {
  const rules = unattendedPermissionRules({
    commands: ["curl", "python3"],
    agentTools: ["WebFetch"],
    shimDir: "/zen/toolchains/.threads/t-1/bin",
    taskDir: "/work/acme",
    workflowDir: "/zen/workflows/website-change-watcher",
    toolAllow: ["Bash(ffmpeg:*)"],
  });
  assert.includeMembers(rules.allow, [
    "Bash(curl:*)",
    "Bash(python3:*)",
    "Bash(/zen/toolchains/.threads/t-1/bin/curl:*)",
    "Bash(ffmpeg:*)",
    "Read(//work/acme/**)",
    "Edit(//work/acme/**)",
    "Read(//zen/workflows/website-change-watcher/**)",
    "WebFetch",
  ]);
  // A declared download command is lifted from the deny list; installers stay denied.
  assert.notInclude(rules.deny, "Bash(curl:*)");
  assert.includeMembers(rules.deny, [
    "Bash(wget:*)",
    "Bash(sudo:*)",
    "Bash(npx:*)",
    "Bash(pip install:*)",
  ]);
  assert.isFalse(rules.allow.some((rule) => rule === "Bash" || rule.startsWith("Bash(*")));
});

it("switches a turn to dontAsk only when unattended rules apply", () => {
  const unattended: ZenUnattendedTurn = {
    workflowId: "w",
    env: { ZEN_TASK_DIR: "/work" },
    pathFirst: null,
    permissions: { allow: ["Bash(curl:*)"], deny: ["Bash(sudo:*)"] },
  };
  for (const mode of ["approval-required", "auto-accept-edits", "full-access"] as const) {
    const base = policy(mode);
    assert.deepEqual(withZenUnattendedPolicy(null, base), base);
    const next = withZenUnattendedPolicy(unattended, base);
    assert.equal(next.permissionMode, "dontAsk");
    assert.isFalse(next.installPermissionCallback);
    assert.isUndefined(next.allowDangerouslySkipPermissions);
  }
  const plan = { permissionMode: "plan", installPermissionCallback: true } as const;
  assert.deepEqual(withZenUnattendedPolicy(unattended, plan), plan);

  const settings = withZenToolchainSettings(
    "t-x",
    { permissions: { allow: ["Read"] } } as {
      permissions: { allow: string[]; deny?: string[] };
      env?: Record<string, string>;
    },
    unattended,
  );
  assert.deepEqual(settings, {
    permissions: { allow: ["Read", "Bash(curl:*)"], deny: ["Bash(sudo:*)"] },
    env: { ZEN_TASK_DIR: "/work" },
  });
  const env = withZenToolchainEnv("t-x", { PATH: "/usr/bin" }, unattended);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.ZEN_TASK_DIR, "/work");
});

it("ships the website change watcher with a valid unattended block", () => {
  const text = NodeFS.readFileSync(
    NodePath.join(SHIPPED_PACKS, "website-change-watcher", "workflow.json"),
    "utf8",
  );
  const parsed = parseUnattended(text);
  assert.deepEqual(parsed.problems, []);
  assert.includeMembers([...(parsed.unattended?.commands ?? [])], ["curl", "python3"]);
  const skill = NodeFS.readFileSync(
    NodePath.join(SHIPPED_PACKS, "website-change-watcher", "SKILL.md"),
    "utf8",
  );
  assert.include(skill, zenScheduledWorkflowMarker("website-change-watcher"));
});

// The manager and the dispatch path.

const makeHome = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-unattended-"));
  const assets = NodePath.join(root, "assets");
  const writeWorkflow = (dir: string, manifest: Record<string, unknown>) => {
    NodeFS.mkdirSync(dir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, "workflow.json"), JSON.stringify(manifest));
  };
  writeWorkflow(NodePath.join(assets, "builtin", "watch"), {
    id: "watch",
    name: "Watch",
    unattended: { commands: ["curl", "python3"], tools: ["WebFetch"] },
  });
  writeWorkflow(NodePath.join(assets, "builtin", "plain"), { id: "plain", name: "Plain" });
  writeWorkflow(NodePath.join(root, "home", "companies", "acme", "workflows", "acme-watch"), {
    id: "acme-watch",
    name: "Acme watch",
    unattended: { commands: ["curl"] },
  });
  NodeFS.mkdirSync(NodePath.join(assets, "catalog", "tools"), { recursive: true });
  const work = NodePath.join(root, "work");
  NodeFS.mkdirSync(work, { recursive: true });
  const manager = new ToolchainManager({
    zenHome: NodePath.join(root, "home"),
    platform: "linux",
    arch: "x64",
    catalogDir: NodePath.join(assets, "catalog"),
    workflowsAssetsDir: assets,
    env: {},
    fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
  });
  return { root, manager, work };
};

it.effect("resolves unattended rules for marked scheduled runs only", () =>
  Effect.gen(function* () {
    const { root, manager, work } = makeHome();
    try {
      yield* Effect.promise(() => manager.init());
      const marked = `${zenScheduledWorkflowMarker("watch")}\nRun the check.`;
      const turn = yield* Effect.promise(() =>
        manager.unattendedTurn({
          threadId: "t-1",
          scheduledTaskId: "task-1",
          prompt: marked,
          cwd: work,
        }),
      );
      assert.equal(turn?.workflowId, "watch");
      assert.include(turn?.permissions.allow ?? [], "Bash(curl:*)");
      assert.include(turn?.permissions.allow ?? [], `Edit(/${work}/**)`);
      assert.equal(turn?.env.ZEN_TASK_DIR, work);
      // A company workflow is found too.
      const company = yield* Effect.promise(() =>
        manager.unattendedTurn({
          threadId: "t-2",
          scheduledTaskId: "task-2",
          prompt: zenScheduledWorkflowMarker("acme-watch"),
          cwd: work,
        }),
      );
      assert.equal(company?.workflowId, "acme-watch");
      // No block, unknown workflow, no marker: a normal turn.
      for (const prompt of [
        zenScheduledWorkflowMarker("plain"),
        zenScheduledWorkflowMarker("missing"),
        "Run the check.",
      ]) {
        assert.isNull(
          yield* Effect.promise(() =>
            manager.unattendedTurn({ threadId: "t", scheduledTaskId: "s", prompt, cwd: work }),
          ),
        );
      }

      // The adapter hook: only messages the scheduler wrote count.
      const turnInput = (scheduledTaskId: string | undefined) => ({
        appThread: { id: "t-1" },
        message: { text: marked, scheduledTaskId },
        runtimePolicy: { cwd: work },
      });
      assert.isNull(yield* resolveZenUnattendedTurn(turnInput(undefined)));
      const resolved = yield* resolveZenUnattendedTurn(turnInput("task-1"));
      assert.equal(resolved?.workflowId, "watch");
    } finally {
      manager.dispose();
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }),
);

const START = "2026-09-09T12:00:00.000Z";

it.effect("a scheduled workflow run reaches the agent as an unattended dontAsk turn", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* TestClock.setTime(Date.parse(START) + 1_000);
    const prompt = `${zenScheduledWorkflowMarker("watch")}\nRun the website check.`;
    for (const [id, threadId] of [
      ["new-thread", null],
      ["bound", "thread-bound"],
    ] as const) {
      yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
        task_id: id,
        title: `task ${id}`,
        prompt,
        enabled: 1,
        schedule_json: '{"type":"interval","everyMs":3600000}',
        project_id: "project:test",
        thread_id: threadId,
        workspace_strategy_json: '{"type":"root"}',
        model_selection_json: '{"instanceId":"claudeAgent","model":"claude-haiku-5-5"}',
        runtime_mode: "auto-accept-edits",
        interaction_mode: "default",
        created_by: "agent",
        creation_source: "mcp",
        created_at: START,
        updated_at: START,
        next_run_at: START,
        last_run_at: null,
        last_run_status: "never",
        last_run_error: null,
        run_count: 0,
      })}`;
    }
    const messages: Array<{
      threadId: string;
      scheduledTaskId: string | undefined;
      text: string;
    }> = [];
    // Both tasks dispatched: the scheduler's pass is asynchronous (SQL reads), so wait for it.
    const bothSent = yield* Deferred.make<void>();
    const sent = () => (messages.length >= 2 ? Deferred.doneUnsafe(bothSent, Effect.void) : false);
    const layer = Layer.mergeAll(
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: (input) =>
          Effect.sync(() => {
            messages.push({
              threadId: "thread-new",
              scheduledTaskId: input.initialMessage?.scheduledTaskId,
              text: input.initialMessage?.text ?? "",
            });
            sent();
            return { threadId: ThreadId.make("thread-new") } as never;
          }),
      }),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        // Nothing queued on the bound thread (recurring tasks skip a busy thread since 0.2.8).
        getThreadRecords: (() => Effect.succeed({ runs: [], messages: [] })) as never,
        sendToThread: ((input: { threadId: string; scheduledTaskId?: string; text: string }) =>
          Effect.sync(() => {
            messages.push({
              threadId: input.threadId,
              scheduledTaskId: input.scheduledTaskId,
              text: input.text,
            });
            sent();
            return {} as never;
          })) as never,
      }),
      Layer.mock(SecretRequests.SecretRequests)({}),
      NodeCrypto.layer,
      Scheduler.layer,
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(Layer.provideMerge(ScheduledTaskService.layer, layer));
        yield* TestClock.adjust("6 seconds");
        yield* Deferred.await(bothSent);
      }),
    );
    assert.deepEqual(messages.map((message) => message.threadId).toSorted(), [
      "thread-bound",
      "thread-new",
    ]);

    // Each dispatched message becomes the provider turn's message (scheduledTaskId + text).
    const { root, manager, work } = makeHome();
    yield* Effect.promise(() => manager.init());
    try {
      for (const message of messages) {
        assert.isString(message.scheduledTaskId);
        const unattended = yield* resolveZenUnattendedTurn({
          appThread: { id: message.threadId },
          message: { text: message.text, scheduledTaskId: message.scheduledTaskId },
          runtimePolicy: { cwd: work },
        });
        assert.equal(unattended?.workflowId, "watch");
        const queryPolicy = withZenUnattendedPolicy(unattended, policy("auto-accept-edits"));
        assert.equal(queryPolicy.permissionMode, "dontAsk");
        assert.isFalse(queryPolicy.installPermissionCallback);
        const settings = withZenToolchainSettings<{
          permissions?: { allow?: string[]; deny?: string[] };
        }>(message.threadId, {}, unattended);
        assert.include(settings?.permissions?.allow ?? [], "Bash(python3:*)");
        assert.include(settings?.permissions?.deny ?? [], "Bash(sudo:*)");
      }
    } finally {
      manager.dispose();
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
