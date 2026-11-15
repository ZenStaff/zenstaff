// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the engine is plain async code; the sandbox test starts real processes.
// Zen Staff AI staff: the company "Aprobări" switch (outbound gate + no network for the shell of
// company agents) and @mention replies in the chat they came from. The network checks need no
// internet: a TCP server on this machine's loopback stands in for "outside".
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { StaffAgent, StaffApproval } from "@t3tools/contracts/zenStaff";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { findOnPath } from "../toolchains/probe.ts";
import {
  setZenThreadSettingsContributor,
  withZenToolchainEnv,
  withZenToolchainSettings,
} from "../toolchains/threadEnv.ts";
import { MENTION_TEXT, mentionTexts, threadLinkHref, type MentionPost } from "./mentionReply.ts";
import { setZenStaffResolver, withZenStaffMcp, withZenStaffToolGate } from "./staffMcp.ts";
import { StaffEngine, gatedRuntimeMode, type StaffDeps, type ThreadUsage } from "./staffEngine.ts";
import {
  isolationDenyRules,
  noNetworkBwrapArgs,
  planAgentShell,
  unixSocketSeccompFilter,
} from "./staffNetwork.ts";

const NOW = "2026-11-08T10:00:00.000Z";
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
  setZenStaffResolver(null);
  setZenThreadSettingsContributor("test-staff-network", null);
});

const tempDir = (prefix: string) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

function makeEngine(overrides: Partial<StaffDeps> = {}) {
  const root = tempDir("zen-staff-am-");
  const stateDir = NodePath.join(root, "state");
  const projectDir = NodePath.join(root, "project");
  NodeFS.mkdirSync(NodePath.join(stateDir, "zen"), { recursive: true });
  NodeFS.mkdirSync(projectDir, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(stateDir, "zen", "companies.json"),
    JSON.stringify({
      version: 1,
      companies: [
        {
          id: "acme",
          name: "Acme",
          color: "#2F6F5E",
          icon: "store",
          memoryDirectory: null,
          createdAt: NOW,
        },
      ],
      projects: { p1: "acme" },
    }),
  );
  // The company runner switch (toolchains state) lets company agents run here.
  NodeFS.mkdirSync(NodePath.join(root, "toolchains"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(root, "toolchains", "state.json"),
    JSON.stringify({ settings: { companyRunner: true } }),
  );
  const launches: Array<{ threadId: string; text: string }> = [];
  const posts: MentionPost[] = [];
  let usage: ThreadUsage = {
    status: "running",
    durationMs: null,
    tokens: null,
    firstUserText: null,
    minutesSpan: null,
    pendingRequests: [],
    lastAnswer: null,
  };
  let nowMs = Date.parse(NOW);
  const deps: StaffDeps = {
    stateDir,
    zenHome: root,
    now: () => new Date(nowMs),
    threads: async (ids) =>
      (ids ?? []).map((id) => ({
        id,
        projectId: "p1",
        title: "Planificare săptămână",
        active: true,
        createdAtMs: Date.parse(NOW),
        modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
        runtimeMode: "auto-accept-edits",
      })),
    usage: async () => usage,
    launch: async (input) => {
      launches.push(input);
    },
    send: async () => undefined,
    generate: async () => "[]",
    providerAvailable: async (id) => id === "claude-company",
    upsertDuty: async () => "task-1",
    deleteDuty: async () => undefined,
    workflows: () => [],
    postMention: async (post) => {
      posts.push(post);
    },
    projectRoot: async () => projectDir,
    ...overrides,
  };
  const engine = new StaffEngine(deps);
  return {
    engine,
    launches,
    posts,
    projectDir,
    setUsage: (next: Partial<ThreadUsage>) => {
      usage = { ...usage, ...next };
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const defaults = {
  modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  runtimeMode: "auto-accept-edits",
  projectId: "p1",
};

async function companySetup(engine: StaffEngine) {
  await engine.call("settings.save", {
    companyId: "acme",
    settings: {
      companyAccount: {
        kind: "team-seat",
        providerInstanceId: "claude-company",
        model: "claude-haiku-5-5",
        label: "Acme Team",
      },
    },
  });
  const maria = (await engine.call("human.save", {
    companyId: "acme",
    human: { name: "Maria", title: "Owner" },
  })) as { id: string };
  const company = (await engine.call("agent.hire", {
    companyId: "acme",
    templateId: "social-media-manager",
    kind: "company",
    managerId: maria.id,
    locale: "ro",
    defaults,
  })) as StaffAgent;
  const personal = (await engine.call("agent.hire", {
    companyId: "acme",
    templateId: "admin-assistant",
    kind: "personal",
    managerId: maria.id,
    locale: "ro",
    defaults,
  })) as StaffAgent;
  return { company, personal };
}

async function startTask(engine: StaffEngine, agentId: string) {
  return (await engine.call("task.start", {
    companyId: "acme",
    agentId,
    text: "Trimite newsletterul săptămânii",
    locale: "ro",
    defaults,
  })) as { threadId: string };
}

// The real sandbox (Linux with a bubblewrap that can create namespaces here).
const bwrap = HostProcess.Platform.defaultValue() === "linux" ? findOnPath("bwrap") : null;
const bwrapUsable =
  bwrap !== null &&
  NodeChildProcess.spawnSync(
    bwrap,
    [
      "--unshare-user",
      "--unshare-net",
      "--ro-bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "true",
    ],
    { stdio: "ignore" },
  ).status === 0;
const curl = findOnPath("curl");

// The "outside" server runs in its own process: the shell runs with spawnSync, which blocks
// this process's event loop.
let server: NodeChildProcess.ChildProcess | null = null;
let port = 0;
beforeAll(async () => {
  server = NodeChildProcess.spawn(
    process.execPath,
    [
      "-e",
      'const s=require("net").createServer(c=>c.end("HTTP/1.1 200 OK\\r\\nContent-Length: 7\\r\\nConnection: close\\r\\n\\r\\noutside"));s.listen(0,"127.0.0.1",()=>console.log(s.address().port))',
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  port = await new Promise<number>((resolve) => {
    server!.stdout!.once("data", (chunk: Buffer) => resolve(Number(String(chunk).trim())));
  });
});
afterAll(() => {
  server?.kill();
});

/** Runs a command line the way Claude Code's Bash tool does: `<shell> -c <command>`. */
function runInShell(env: NodeJS.ProcessEnv, cwd: string, command: string) {
  const shell = env.CLAUDE_CODE_SHELL ?? "/bin/bash";
  return NodeChildProcess.spawnSync(shell, ["-c", command], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
}

/** The engine wired to the adapter hooks the way ZenStaff.ts wires them. */
function installHooks(engine: StaffEngine, shellRoot: string) {
  setZenStaffResolver({
    mcpFor: (threadId) =>
      engine.isAgentThread(threadId) ? { url: "http://127.0.0.1:1/mcp", token: "t" } : null,
    gate: (threadId, toolName) => engine.gate(threadId, toolName),
    shellOffline: (threadId) => engine.shellWithoutNetwork(threadId),
  });
  setZenThreadSettingsContributor("test-staff-network", (threadId, cwd) => {
    if (!engine.shellWithoutNetwork(threadId)) return null;
    const plan = planAgentShell({
      platform: "linux",
      arch: HostProcess.Architecture.defaultValue(),
      threadId,
      projectDir: cwd ?? "",
      shellRoot,
      sandboxProgram: bwrap,
      bash: cwd === undefined ? null : "/bin/bash",
      writableDirs: ["/tmp"],
      homeDir: NodeOS.homedir(),
    });
    return { env: plan.env, deny: plan.deny };
  });
}

describe("Aprobări: outbound gate and the agent's shell", () => {
  it("isolates company agent threads only, and only while the switch is on", async () => {
    const { engine } = makeEngine();
    const { company, personal } = await companySetup(engine);
    const companyTask = await startTask(engine, company.id);
    const personalTask = await startTask(engine, personal.id);
    expect(engine.shellWithoutNetwork(companyTask.threadId)).toBe(true);
    expect(engine.shellWithoutNetwork(personalTask.threadId)).toBe(false);
    expect(engine.shellWithoutNetwork("an-ordinary-chat")).toBe(false);
    // The connector send still waits for the manager.
    expect(engine.gate(companyTask.threadId, "mcp__gmail__send_email")).toMatchObject({
      behavior: "deny",
      action: "send",
    });
    await engine.call("settings.save", { companyId: "acme", settings: { approvals: false } });
    expect(engine.shellWithoutNetwork(companyTask.threadId)).toBe(false);
    expect(engine.gate(companyTask.threadId, "mcp__gmail__send_email").behavior).toBe("pass");
    await engine.call("settings.save", { companyId: "acme", settings: { approvals: true } });
    expect(engine.shellWithoutNetwork(companyTask.threadId)).toBe(true);
  });

  it("never starts an agent in full access while the switch is on (the gate would be skipped)", async () => {
    expect(gatedRuntimeMode("full-access", true)).toBe("auto-accept-edits");
    expect(gatedRuntimeMode("full-access", false)).toBe("full-access");
    expect(gatedRuntimeMode("approval-required", true)).toBe("approval-required");
    const launched: string[] = [];
    const { engine } = makeEngine({
      launch: async (input) => {
        launched.push(input.runtimeMode);
      },
    });
    const { company } = await companySetup(engine);
    await engine.call("task.start", {
      companyId: "acme",
      agentId: company.id,
      text: "x",
      locale: "ro",
      defaults: { ...defaults, runtimeMode: "full-access" },
    });
    expect(launched).toEqual(["auto-accept-edits"]);
  });

  it("tells a company agent its terminal has no internet", async () => {
    const { engine, launches } = makeEngine();
    const { company, personal } = await companySetup(engine);
    await startTask(engine, company.id);
    await startTask(engine, personal.id);
    expect(launches[0]!.text).toContain("nu au internet");
    expect(launches[1]!.text).not.toContain("nu au internet");
  });

  it("restarts the agent's session when the switch changes (part of the MCP options)", async () => {
    const { engine } = makeEngine();
    const { company } = await companySetup(engine);
    const { threadId } = await startTask(engine, company.id);
    installHooks(engine, tempDir("zen-shell-"));
    const header = () =>
      (
        withZenStaffMcp(threadId, {} as { mcpServers?: Record<string, unknown> }).mcpServers![
          "zen-staff"
        ] as {
          headers: Record<string, string>;
        }
      ).headers["X-Zen-Shell-Network"];
    expect(header()).toBe("off");
    await engine.call("settings.save", { companyId: "acme", settings: { approvals: false } });
    expect(header()).toBe("on");
  });

  it("asks the manager before a connector send in an isolated thread (the adapter's gate)", async () => {
    const { engine } = makeEngine();
    const { company } = await companySetup(engine);
    const { threadId } = await startTask(engine, company.id);
    installHooks(engine, tempDir("zen-shell-"));
    let askedAdapter = 0;
    const gated = withZenStaffToolGate(
      threadId,
      async (_tool: string, _input: Record<string, unknown>, _options: { toolUseID?: string }) => {
        askedAdapter += 1;
        return { behavior: "allow" };
      },
    );
    const denied = (await gated(
      "mcp__gmail__send_email",
      { to: "x@y.example" },
      {
        toolUseID: "u1",
      },
    )) as { behavior: string; message: string };
    expect(denied.behavior).toBe("deny");
    expect(denied.message).toMatch(/staff_request_approval/);
    expect(askedAdapter).toBe(0);
    await engine.call("settings.save", { companyId: "acme", settings: { approvals: false } });
    await gated("mcp__gmail__send_email", { to: "x@y.example" }, { toolUseID: "u2" });
    expect(askedAdapter).toBe(1);
  });

  it("adds the shell and the deny rules to the session settings and environment", async () => {
    const { engine, projectDir } = makeEngine();
    const { company, personal } = await companySetup(engine);
    const companyTask = await startTask(engine, company.id);
    const personalTask = await startTask(engine, personal.id);
    const shellRoot = tempDir("zen-shell-");
    installHooks(engine, shellRoot);
    const settings = withZenToolchainSettings(companyTask.threadId, {}, null, projectDir) as {
      env: Record<string, string>;
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["WebFetch", "PowerShell"]));
    expect(settings.env.ZEN_AGENT_NETWORK).toBe("off");
    expect(withZenToolchainSettings(personalTask.threadId, {}, null, projectDir)).toEqual({});
    const env = withZenToolchainEnv(
      companyTask.threadId,
      { PATH: "/usr/bin:/bin" },
      null,
      "p1",
      projectDir,
    );
    expect(env.ZEN_AGENT_NETWORK).toBe("off");
    if (bwrapUsable) {
      expect(env.CLAUDE_CODE_SHELL).toBe(NodePath.join(shellRoot, companyTask.threadId, "bash"));
      expect(settings.env.CLAUDE_CODE_SHELL).toBe(env.CLAUDE_CODE_SHELL);
    }
    // Without the folder the shell is denied (fail closed).
    const blind = withZenToolchainSettings(companyTask.threadId, {}, null, undefined) as {
      permissions: { deny: string[] };
    };
    expect(blind.permissions.deny).toEqual(expect.arrayContaining(["Bash", "Monitor"]));
  });

  it("denies the shell where no sandbox exists (Windows, no bubblewrap)", () => {
    const projectDir = tempDir("zen-proj-");
    for (const platform of ["win32", "linux"] as const) {
      const plan = planAgentShell({
        platform,
        arch: "x64",
        threadId: "t1",
        projectDir,
        shellRoot: tempDir("zen-shell-"),
        sandboxProgram: null,
        bash: platform === "win32" ? null : "/bin/bash",
        writableDirs: [],
        homeDir: null,
      });
      expect(plan.isolation).toBe("deny-shell");
      expect(plan.shellPath).toBeNull();
      expect(plan.deny).toEqual(
        expect.arrayContaining(["Bash", "Monitor", "PowerShell", "WebFetch"]),
      );
    }
  });

  it("builds the bubblewrap command and the seccomp filter", () => {
    const args = noNetworkBwrapArgs({
      sandboxProgram: "/usr/bin/bwrap",
      bash: "/bin/bash",
      projectDir: "/srv/acme",
      writableDirs: ["/tmp"],
      seccompFile: null,
      homeDir: "/home/zen",
    });
    expect(args).toEqual(expect.arrayContaining(["--unshare-net", "--unshare-user", "--cap-drop"]));
    expect(args.join(" ")).toContain("--ro-bind / /");
    expect(args.join(" ")).toContain("--bind-try /srv/acme /srv/acme");
    expect(args.join(" ")).toContain("--ro-bind-try /srv/acme/.claude /srv/acme/.claude");
    expect(args.join(" ")).toContain("--ro-bind-try /srv/acme/.git/hooks /srv/acme/.git/hooks");
    expect(args.join(" ")).toContain("--setenv ZEN_TOOL_SANDBOXED bwrap");
    expect(isolationDenyRules("/srv/acme", false)).toContain("Edit(//srv/acme/.claude/**)");
    const filter = unixSocketSeccompFilter("x64")!;
    expect(filter.length % 8).toBe(0);
    expect(filter.length / 8).toBe(14);
    expect(unixSocketSeccompFilter("arm64")).not.toBeNull();
    expect(unixSocketSeccompFilter("ia32")).toBeNull();
  });

  it.skipIf(!bwrapUsable || curl === null)(
    "curl from a company agent's shell cannot reach anything; with the switch off it can",
    async () => {
      const { engine, projectDir } = makeEngine();
      const { company, personal } = await companySetup(engine);
      const companyTask = await startTask(engine, company.id);
      const personalTask = await startTask(engine, personal.id);
      installHooks(engine, tempDir("zen-shell-"));
      const base = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: NodeOS.homedir() };
      const fetchOutside = `${curl} -sS -m 5 http://127.0.0.1:${port}/`;
      const envFor = (threadId: string) =>
        withZenToolchainEnv(threadId, { ...base }, null, "p1", projectDir);

      const isolated = runInShell(envFor(companyTask.threadId), projectDir, fetchOutside);
      expect(isolated.status).not.toBe(0);
      expect(isolated.stdout).not.toContain("outside");

      // The other ways out are closed too: Unix sockets (docker.sock, tmux...), other folders,
      // the project's Claude Code settings; work in the project folder still works.
      const probes = runInShell(
        envFor(companyTask.threadId),
        projectDir,
        [
          "echo ok > result.txt && echo write-project",
          "echo x > .claude/settings.json 2>/dev/null || echo claude-settings-readonly",
          `echo x > ${JSON.stringify(NodePath.join(NodeOS.homedir(), ".zen-test-escape"))} 2>/dev/null || echo home-readonly`,
          `${process.execPath} -e "require('net').connect('/run/does-not-matter').on('error', e => console.log('unix-' + e.code))"`,
          "echo $ZEN_AGENT_NETWORK",
        ].join("; "),
      );
      expect(probes.stdout).toContain("write-project");
      expect(probes.stdout).toContain("claude-settings-readonly");
      expect(probes.stdout).toContain("home-readonly");
      expect(probes.stdout).toMatch(/unix-E(PERM|ACCES)/);
      expect(probes.stdout).toContain("off");
      expect(NodeFS.readFileSync(NodePath.join(projectDir, "result.txt"), "utf8")).toBe("ok\n");

      // A personal agent's thread is unchanged.
      const open = runInShell(envFor(personalTask.threadId), projectDir, fetchOutside);
      expect(open.stdout).toContain("outside");

      // The company switches "Aprobări" off: the company agent's shell has its network again.
      await engine.call("settings.save", { companyId: "acme", settings: { approvals: false } });
      const restored = runInShell(envFor(companyTask.threadId), projectDir, fetchOutside);
      expect(restored.stdout).toContain("outside");
    },
  );
});

describe("@mention replies in the original chat", () => {
  async function mention() {
    const setup = makeEngine();
    const { company } = await companySetup(setup.engine);
    await setup.engine.onUserMessage({
      id: "m1",
      threadId: "chat-1",
      text: `[You are the chat assistant]\nMaria in Slack #sales:\n@${company.name} pregătește postarea de vineri`,
      scheduledTaskId: null,
      createdBy: "user",
    });
    const threadId = setup.launches[0]!.threadId;
    await setup.engine.mentionsPosted();
    return { ...setup, company, threadId };
  }

  it("shows the agent working in the chat, with a link to the full work", async () => {
    const { posts, threadId, company } = await mention();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      originThreadId: "chat-1",
      agentThreadId: threadId,
      final: false,
      agentName: company.name,
    });
    expect(posts[0]!.markdown).toContain(`**${company.name}** lucrează…`);
    expect(posts[0]!.markdown).toContain(`[Deschide lucrul complet](${threadLinkHref(threadId)})`);
    expect(posts[0]!.platformMarkdown).toContain("Deschide lucrul complet: chatul");
    // The task is named after the line with the mention (chat integrations wrap the text).
    expect(posts[0]!.agentThreadTitle).toBe(
      `${company.name}: @${company.name} pregătește postarea de vineri`,
    );
  });

  it("surfaces the agent's approval requests, then the result with files", async () => {
    const { engine, posts, threadId, projectDir, setUsage, advance } = await mention();
    const tools = engine.toolsFor(threadId)!;
    await tools.call("staff_request_approval", {
      action: "publish",
      target: "Facebook",
      content: "Vineri: ciorbă de burtă",
    });
    await engine.mentionsPosted();
    expect(posts.at(-1)!.markdown).toContain(
      "așteaptă aprobarea lui Maria: publicare către Facebook",
    );
    expect(posts.at(-1)!.key).toBe(posts[0]!.key);

    const overview = (await engine.call("overview", { companyId: "acme", locale: "ro" })) as {
      approvals: StaffApproval[];
    };
    await engine.call("approval.decide", {
      companyId: "acme",
      approvalId: overview.approvals[0]!.id,
      decision: "approve",
      locale: "ro",
    });
    await engine.mentionsPosted();
    expect(posts.at(-1)!.markdown).toContain("lucrează…");

    // A tool approval the provider asks for in the agent's own chat shows up too.
    advance(6_000);
    setUsage({ pendingRequests: ["node publish.js"] });
    await engine.onRunUpdated(threadId, false, true);
    expect(posts.at(-1)!.markdown).toContain(
      "așteaptă o aprobare în chatul sarcinii: node publish.js",
    );
    setUsage({ pendingRequests: [] });

    NodeFS.writeFileSync(NodePath.join(projectDir, "postare.png"), "png-bytes");
    const outside = NodePath.join(tempDir("zen-outside-"), "secret.txt");
    NodeFS.writeFileSync(outside, "secret");
    await tools.call("staff_record_result", {
      summary: "Postarea de vineri e gata și publicată.",
      explain_to_boss: [
        "Am folosit meniul din memorie.",
        "Prețurile verificate.",
        "Publicat la 12:00.",
      ],
      files: ["postare.png", outside, "../escape.txt"],
    });
    setUsage({ status: "completed", lastAnswer: "Gata." });
    await engine.onRunUpdated(threadId, true);
    const final = posts.at(-1)!;
    expect(final.final).toBe(true);
    expect(final.markdown).toContain("Postarea de vineri e gata și publicată.");
    expect(final.markdown).toContain("- Am folosit meniul din memorie.");
    expect(final.markdown).toContain("Fișiere: postare.png");
    expect(final.files).toEqual([NodeFS.realpathSync(NodePath.join(projectDir, "postare.png"))]);
    expect(final.platformMarkdown).toContain("Fișiere: postare.png");
  });

  it("falls back to the agent's last answer, and says when it did not finish", async () => {
    const first = await mention();
    first.setUsage({ status: "completed", lastAnswer: "Am pregătit trei variante." });
    await first.engine.onRunUpdated(first.threadId, true);
    expect(first.posts.at(-1)!.markdown).toContain("Am pregătit trei variante.");

    const second = await mention();
    second.setUsage({ status: "failed" });
    await second.engine.onRunUpdated(second.threadId, true);
    expect(second.posts.at(-1)!.markdown).toContain("nu a terminat sarcina");
    expect(second.posts.at(-1)!.final).toBe(true);
  });

  it("posts only changes, and status updates at most every few seconds", async () => {
    const { engine, posts, threadId, advance } = await mention();
    await engine.onRunUpdated(threadId, false);
    expect(posts).toHaveLength(1);
    advance(6 * 60_000);
    await engine.onRunUpdated(threadId, false);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.markdown).toContain("lucrează… (6 min)");
  });

  it("writes the texts in English too", () => {
    const texts = mentionTexts({
      locale: "en",
      agentName: "Ana",
      role: "Reservations",
      phase: {
        kind: "done",
        summary: "Booked 4 tables.",
        explainToBoss: ["Friday 19:00"],
        fileNames: [],
      },
      agentThreadId: "t-1",
      agentThreadTitle: "Ana: bookings",
    });
    expect(texts.markdown).toContain("**Ana** (Reservations): Booked 4 tables.");
    expect(texts.markdown).toContain(`[${MENTION_TEXT.en.openWork}](t3-thread://v1/t-1)`);
    expect(texts.platformMarkdown).toContain('the chat "Ana: bookings" in Zen Staff');
  });
});
