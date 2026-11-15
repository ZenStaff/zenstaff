// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Plain unit tests of the chat layer; no network.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ZEN_CHAT_DEFAULT_SETTINGS,
  type ZenChatAgent,
  type ZenChatConnection,
  type ZenChatMember,
} from "@t3tools/contracts/zenChat";
import { describe, expect, it } from "@effect/vitest";

import { ChatEngine, type AgentObservation, type AgentRuntime } from "./engine.ts";
import type {
  ConversationTarget,
  InboundMessage,
  OutboundMessage,
  PlatformClient,
} from "./model.ts";
import {
  approvalValue,
  authorizeApproval,
  conversationKey,
  inQuietHours,
  lastOccurrence,
  memberFor,
  parseApprovalValue,
  personalAgentRunsHere,
  reportDue,
  routeInbound,
  threadRootFor,
  type ChatConfig,
} from "./policy.ts";
import { AuditLog, EMPTY_RUNTIME, loadConfig, saveConfig, type RuntimeState } from "./store.ts";
import {
  chunkText,
  decodeSlackText,
  decodeTeamsText,
  formatFor,
  parseZenCommand,
  referencedFiles,
  safeFileName,
} from "./text.ts";

// Fixtures

const slack: ZenChatConnection = {
  id: "slack-1",
  platform: "slack",
  name: "Acme Slack",
  scope: "company",
  enabled: true,
  workspaceAllowlist: ["T1"],
  channelAllowlist: [],
  settings: { teamId: "T1" },
};

const agent: ZenChatAgent = {
  id: "agent-ana",
  name: "Ana (marketing)",
  kind: "company",
  managerEmail: "ion@acme.example",
  ownerEmail: null,
  projectId: "project-1",
  model: "claude-haiku-5-5",
  runtimeMode: "auto-accept-edits",
  instructions: "",
};

const personal: ZenChatAgent = {
  ...agent,
  id: "agent-maria",
  name: "Maria's assistant",
  kind: "personal",
  ownerEmail: "maria@acme.example",
};

const maria: ZenChatMember = {
  id: "m-maria",
  email: "maria@acme.example",
  name: "Maria",
  role: "member",
  identities: [{ platform: "slack", workspaceId: "T1", userId: "UMARIA" }],
};
const ion: ZenChatMember = {
  id: "m-ion",
  email: "ion@acme.example",
  name: "Ion",
  role: "admin",
  identities: [{ platform: "slack", workspaceId: "T1", userId: "UION" }],
};
const guest: ZenChatMember = {
  id: "m-g",
  email: "g@out.example",
  name: "G",
  role: "guest",
  identities: [{ platform: "slack", workspaceId: "T1", userId: "UGUEST" }],
};

const config = (overrides: Partial<ChatConfig> = {}): ChatConfig => ({
  connections: [slack],
  agents: [agent, personal],
  bindings: [
    {
      id: "b-sales",
      connectionId: "slack-1",
      channelId: "CSALES",
      channelName: "sales",
      agentId: agent.id,
      respondTo: "mention",
      posters: [],
    },
    {
      id: "b-dm",
      connectionId: "slack-1",
      channelId: "dm",
      channelName: "",
      agentId: personal.id,
      respondTo: "mention",
      posters: [],
    },
  ],
  members: [maria, ion, guest],
  reports: [],
  settings: ZEN_CHAT_DEFAULT_SETTINGS,
  ...overrides,
});

const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  type: "message",
  platform: "slack",
  workspaceId: "T1",
  channelId: "CSALES",
  channelType: "channel",
  threadId: null,
  messageId: "100.1",
  user: { id: "UMARIA", name: "maria" },
  text: "write the newsletter",
  mentioned: true,
  attachments: [],
  command: null,
  ...overrides,
});

const onRunner = { isRunner: true, personalAgentAvailable: () => false };

describe("formatting", () => {
  it("turns Markdown into Slack mrkdwn without touching code", () => {
    const out = formatFor(
      "slack",
      "# Title\n**bold** and *italic* ~~old~~ [site](https://x.example) `a<b`\n- item\n```\nif (a < b) **x**\n```",
    );
    expect(out).toContain("*Title*");
    expect(out).toContain("*bold* and _italic_ ~old~ <https://x.example|site> `a&lt;b`");
    expect(out).toContain("• item");
    expect(out).toContain("```\nif (a &lt; b) **x**\n```");
  });

  it("escapes Telegram HTML and keeps links", () => {
    const out = formatFor("telegram", "**Preț** <5 lei> & [link](https://a.ro?x=1&y=2) `x<y`");
    expect(out).toBe(
      '<b>Preț</b> &lt;5 lei&gt; &amp; <a href="https://a.ro?x=1&amp;y=2">link</a> <code>x&lt;y</code>',
    );
  });

  it("uses WhatsApp markup and plain links", () => {
    expect(formatFor("whatsapp", "**Total** [aici](https://a.ro)")).toBe(
      "*Total* aici (https://a.ro)",
    );
  });

  it("keeps only the title of embedded local files (they are uploaded)", () => {
    expect(formatFor("discord", "Here: ![chart](/tmp/x/chart.png) done")).toBe(
      "Here: [chart] done",
    );
    expect(
      referencedFiles(
        "![chart](/tmp/x/chart.png) and [report](/tmp/x/r.pdf) but `![no](/etc/passwd)` and [web](https://a.ro)",
      ),
    ).toEqual([
      { path: "/tmp/x/chart.png", title: "chart" },
      { path: "/tmp/x/r.pdf", title: "report" },
    ]);
  });
});

describe("chunking", () => {
  it("keeps short answers whole", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits at paragraph boundaries within the limit", () => {
    const text = Array.from(
      { length: 30 },
      (_, index) => `Paragraph ${index} ${"word ".repeat(20)}`,
    ).join("\n\n");
    const chunks = chunkText(text, 500);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim());
  });

  it("closes and reopens a code block cut in two", () => {
    const code = `\`\`\`\n${Array.from({ length: 80 }, (_, index) => `line ${index}`).join("\n")}\n\`\`\``;
    const chunks = chunkText(`Intro\n\n${code}`, 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(300);
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
    }
  });

  it("does the same with Telegram <pre>", () => {
    const pre = `<pre>${"x\n".repeat(400)}</pre>`;
    const chunks = chunkText(pre, 200, "telegram");
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
      expect(chunk.split("<pre>").length).toBe(chunk.split("</pre>").length);
    }
  });
});

describe("inbound decoding", () => {
  it("decodes Slack mentions, channels and links", () => {
    expect(
      decodeSlackText("<@UBOT> see <https://a.ro|this> in <#C1|sales> &amp; <@U2>", "UBOT", {
        U2: "Ion",
      }),
    ).toBe("see this (https://a.ro) in #sales & @Ion");
  });

  it("removes the Teams bot mention and HTML", () => {
    expect(decodeTeamsText("<at>Zen</at> hi <b>there</b><br>bye &amp; <at>Ion</at>", "Zen")).toBe(
      "hi there\nbye & @Ion",
    );
  });

  it("recognizes /zen commands", () => {
    expect(parseZenCommand("/zen status")).toEqual({ args: "status" });
    expect(parseZenCommand("/zen@ZenBot write a post")).toEqual({ args: "write a post" });
    expect(parseZenCommand("zen please")).toBeNull();
    expect(parseZenCommand("/zenith")).toBeNull();
  });

  it("makes safe file names", () => {
    expect(safeFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeFileName("a<b>:c?.pdf")).toBe("abc.pdf");
    expect(safeFileName("")).toBe("file");
  });
});

describe("routing", () => {
  it("maps platform users to members by identity, then by verified e-mail", () => {
    expect(memberFor([maria], "slack", "T1", { id: "UMARIA", name: "x" })?.email).toBe(
      "maria@acme.example",
    );
    expect(memberFor([maria], "slack", "T2", { id: "UMARIA", name: "x" })).toBeNull();
    expect(
      memberFor([maria], "slack", "T9", { id: "U?", name: "x", email: "MARIA@acme.example" })?.id,
    ).toBe("m-maria");
    expect(memberFor([maria], "telegram", "telegram", { id: "UMARIA", name: "x" })).toBeNull();
  });

  it("sends a mention in a bound channel to its company agent on the runner", () => {
    const decision = routeInbound(config(), slack, message(), onRunner);
    expect(decision.kind).toBe("agent");
    if (decision.kind === "agent") expect(decision.agent.id).toBe(agent.id);
  });

  it("ignores other workspaces, unbound channels, bots and messages not addressed to the bot", () => {
    expect(routeInbound(config(), slack, message({ workspaceId: "T2" }), onRunner)).toMatchObject({
      kind: "ignore",
    });
    expect(routeInbound(config(), slack, message({ channelId: "COTHER" }), onRunner)).toMatchObject(
      { kind: "ignore" },
    );
    expect(
      routeInbound(
        config(),
        slack,
        message({ user: { id: "UB", name: "b", isBot: true } }),
        onRunner,
      ),
    ).toMatchObject({ kind: "ignore" });
    expect(routeInbound(config(), slack, message({ mentioned: false }), onRunner)).toMatchObject({
      kind: "ignore",
    });
  });

  it("refuses unknown people and guests", () => {
    expect(
      routeInbound(config(), slack, message({ user: { id: "UNEW", name: "n" } }), onRunner),
    ).toMatchObject({ kind: "refuse", reply: "unknown-person" });
    expect(
      routeInbound(config(), slack, message({ user: { id: "UGUEST", name: "g" } }), onRunner),
    ).toMatchObject({ kind: "refuse", reply: "guest" });
  });

  it("never runs a company agent off the runner", () => {
    expect(
      routeInbound(config(), slack, message(), { ...onRunner, isRunner: false }),
    ).toMatchObject({ kind: "refuse", reply: "needs-runner" });
    expect(
      routeInbound(config(), { ...slack, scope: "personal" }, message(), onRunner),
    ).toMatchObject({ kind: "refuse", reply: "needs-runner" });
  });

  it("allows a personal agent only for its owner, in a DM, on the owner's own machine", () => {
    const dm = message({ channelId: "DMARIA", channelType: "dm", mentioned: true });
    expect(routeInbound(config(), slack, dm, onRunner)).toMatchObject({
      kind: "refuse",
      reply: "personal-unavailable",
    });
    expect(
      routeInbound(config(), slack, dm, { ...onRunner, personalAgentAvailable: () => true }),
    ).toMatchObject({ kind: "agent" });
    expect(
      routeInbound(
        config(),
        slack,
        { ...dm, user: { id: "UION", name: "ion" } },
        { ...onRunner, personalAgentAvailable: () => true },
      ),
    ).toMatchObject({
      kind: "refuse",
      reply: "personal-not-owner",
    });
    expect(personalAgentRunsHere(personal, { isRunner: false, owner: "maria@acme.example" })).toBe(
      true,
    );
    expect(personalAgentRunsHere(personal, { isRunner: true, owner: "maria@acme.example" })).toBe(
      false,
    );
    expect(personalAgentRunsHere(personal, { isRunner: false, owner: "ion@acme.example" })).toBe(
      false,
    );
  });

  it("keys one conversation per platform thread and agent", () => {
    const root = threadRootFor(message(), true);
    expect(root).toBe("100.1");
    expect(threadRootFor(message({ threadId: "99.0" }), true)).toBe("99.0");
    expect(threadRootFor(message({ channelType: "dm" }), true)).toBeNull();
    expect(threadRootFor(message({ platform: "whatsapp" }), true)).toBeNull();
    expect(
      conversationKey({
        connectionId: "c",
        workspaceId: "w",
        channelId: "ch",
        threadRoot: root,
        agentId: "a",
      }),
    ).toBe("c|w|ch|100.1|a");
  });
});

describe("approvals", () => {
  it("round-trips button values", () => {
    expect(parseApprovalValue(approvalValue("0123456789abcdef", "accept"))).toEqual({
      approvalId: "0123456789abcdef",
      decision: "accept",
    });
    expect(parseApprovalValue("zenapr:xyz:accept")).toBeNull();
    expect(parseApprovalValue("zenapr:0123456789abcdef:rm -rf")).toBeNull();
  });

  it("only the agent's manager may decide", () => {
    expect(
      authorizeApproval(config(), "slack", "T1", { id: "UION", name: "ion" }, agent),
    ).toMatchObject({ ok: true });
    expect(
      authorizeApproval(config(), "slack", "T1", { id: "UMARIA", name: "maria" }, agent),
    ).toMatchObject({ ok: false });
    expect(
      authorizeApproval(config(), "slack", "T1", { id: "UNKNOWN", name: "x" }, agent),
    ).toMatchObject({ ok: false });
    // An e-mail claim from another workspace's identity does not count without the platform's word.
    expect(
      authorizeApproval(config(), "slack", "T2", { id: "UION", name: "ion" }, agent),
    ).toMatchObject({ ok: false });
  });
});

describe("quiet hours and reports", () => {
  const at = (hhmm: string, day = 9) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2026, 10, day, h, m); // 9 Nov 2026 is a Monday.
  };
  const quiet = {
    ...ZEN_CHAT_DEFAULT_SETTINGS,
    quietHours: { enabled: true, start: "20:00", end: "08:00" },
  };

  it("wraps past midnight", () => {
    expect(inQuietHours(quiet, at("21:00"))).toBe(true);
    expect(inQuietHours(quiet, at("07:59"))).toBe(true);
    expect(inQuietHours(quiet, at("08:00"))).toBe(false);
    expect(inQuietHours(ZEN_CHAT_DEFAULT_SETTINGS, at("23:00"))).toBe(false);
  });

  it("finds the latest scheduled time and posts once", () => {
    const report = {
      id: "r",
      name: "Daily",
      agentId: agent.id,
      bindingId: "b-sales",
      prompt: "p",
      days: [1, 2, 3, 4, 5],
      time: "09:00",
      enabled: true,
      lastRunAt: null,
      lastStatus: null,
    };
    expect(lastOccurrence(report, at("10:00"))?.getDate()).toBe(9);
    expect(lastOccurrence(report, at("08:00"))?.getDate()).toBe(6); // Friday before.
    expect(reportDue(report, ZEN_CHAT_DEFAULT_SETTINGS, at("09:01"))).toBe(true);
    expect(
      reportDue(
        { ...report, lastRunAt: at("09:01").toISOString() },
        ZEN_CHAT_DEFAULT_SETTINGS,
        at("09:30"),
      ),
    ).toBe(false);
    expect(reportDue(report, ZEN_CHAT_DEFAULT_SETTINGS, at("13:00"))).toBe(false); // Past the grace.
    expect(reportDue({ ...report, time: "21:00" }, quiet, at("21:05"))).toBe(false); // Waits in quiet hours.
    expect(reportDue({ ...report, days: [0] }, ZEN_CHAT_DEFAULT_SETTINGS, at("09:01"))).toBe(false);
  });
});

// The engine, end to end with a fake platform and a fake agent

interface Posted {
  readonly target: ConversationTarget;
  readonly message: OutboundMessage;
  readonly id: string;
  readonly direct?: string;
}

function fakeClient(): PlatformClient & {
  posted: Posted[];
  updates: Array<{ id: string; text: string }>;
  answers: string[];
} {
  const posted: Posted[] = [];
  const updates: Array<{ id: string; text: string }> = [];
  const answers: string[] = [];
  let counter = 0;
  return {
    platform: "slack",
    posted,
    updates,
    answers,
    async post(target, message) {
      const id = `m${++counter}`;
      posted.push({ target, message, id });
      return { messageId: id };
    },
    async update(_target, id, message) {
      updates.push({ id, text: message.text });
    },
    async directMessage(_workspace, userId, message) {
      const id = `m${++counter}`;
      posted.push({
        target: { workspaceId: "T1", channelId: `D-${userId}`, threadId: null },
        message,
        id,
        direct: userId,
      });
      return { channelId: `D-${userId}`, messageId: id };
    },
    async answer(_event, text) {
      answers.push(text);
    },
  };
}

function fakeRuntime() {
  const threads = new Map<string, { messages: string[]; observation: AgentObservation }>();
  const responses: Array<{ threadId: string; requestId: string; decision: string }> = [];
  let counter = 0;
  const runtime: AgentRuntime = {
    async start({ text }) {
      const threadId = `thread-${++counter}`;
      threads.set(threadId, {
        messages: [text],
        observation: { exists: true, running: true, replies: [], approvals: [], failed: false },
      });
      return { threadId, messageId: `${threadId}-u1` };
    },
    async send({ threadId, text }) {
      const thread = threads.get(threadId)!;
      thread.messages.push(text);
      thread.observation = {
        exists: true,
        running: true,
        replies: [],
        approvals: [],
        failed: false,
      };
      return { messageId: `${threadId}-u${thread.messages.length}` };
    },
    async observe(threadId) {
      return (
        threads.get(threadId)?.observation ?? {
          exists: false,
          running: false,
          replies: [],
          approvals: [],
          failed: false,
        }
      );
    },
    async respond(threadId, requestId, decision) {
      responses.push({ threadId, requestId, decision });
    },
    async projectRoot() {
      return null;
    },
  };
  return { runtime, threads, responses };
}

function makeEngine(chatConfig: ChatConfig = config()) {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-chat-"));
  let state: RuntimeState = EMPTY_RUNTIME;
  const { runtime, threads, responses } = fakeRuntime();
  const client = fakeClient();
  const audit = new AuditLog(NodePath.join(dir, "audit.log"));
  const engine = new ChatEngine({
    config: () => chatConfig,
    runtime,
    state: () => state,
    setState: (change) => {
      state = change(state);
    },
    audit,
    context: () => onRunner,
    inboxDir: NodePath.join(dir, "inbox"),
  });
  engine.registerClient("slack-1", client);
  return { engine, client, threads, responses, audit, state: () => state, dir };
}

describe("engine", () => {
  it("answers a mention in its thread, then continues the same Zen thread on a reply", async () => {
    const { engine, client, threads, state } = makeEngine();
    await engine.handleEvent("slack-1", message());
    expect(client.posted[0]!.message.text).toBe("_Working on it..._");
    const [threadId, thread] = [...threads.entries()][0]!;
    expect(thread.messages[0]).toContain("You are Ana (marketing)");
    expect(thread.messages[0]).toContain(
      "Maria (maria@acme.example) in Slack #sales:\nwrite the newsletter",
    );

    thread.observation = {
      exists: true,
      running: false,
      replies: [{ id: "a1", text: "**Done**: newsletter drafted." }],
      approvals: [],
      failed: false,
    };
    await engine.tick();
    expect(client.updates).toEqual([{ id: "m1", text: "*Done*: newsletter drafted." }]);
    expect(state().follows[threadId]).toBeUndefined();

    // A reply in the thread without a mention continues the conversation.
    await engine.handleEvent(
      "slack-1",
      message({ messageId: "100.5", threadId: "100.1", mentioned: false, text: "shorter please" }),
    );
    expect(threads.size).toBe(1);
    expect(threads.get(threadId)!.messages[1]).toContain("shorter please");
    expect(threads.get(threadId)!.messages[1]).not.toContain("You are Ana");
  });

  it("chunks long answers and redacts secrets on the way out", async () => {
    const { engine, client, threads } = makeEngine();
    await engine.handleEvent("slack-1", message());
    const thread = [...threads.values()][0]!;
    const long = `${"Line of the report.\n\n".repeat(400)}The key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789`;
    thread.observation = {
      exists: true,
      running: false,
      replies: [{ id: "a1", text: long }],
      approvals: [],
      failed: false,
    };
    await engine.tick();
    const texts = [
      ...client.updates.map((update) => update.text),
      ...client.posted.slice(1).map((post) => post.message.text),
    ];
    expect(texts.length).toBeGreaterThan(2);
    for (const piece of texts) expect(piece.length).toBeLessThanOrEqual(3500);
    expect(texts.join("")).not.toContain("sk-ant-api03");
  });

  it("tells the manager there is something to approve in the app, with no approve action", async () => {
    const { engine, client, threads, responses, state, audit } = makeEngine();
    await engine.handleEvent("slack-1", message({ text: "send the newsletter" }));
    const [, thread] = [...threads.entries()][0]!;
    thread.observation = {
      exists: true,
      running: true,
      replies: [],
      approvals: [
        { requestId: "req-1", kind: "command", prompt: "node send-newsletter.js --to customers" },
      ],
      failed: false,
    };
    await engine.tick();
    const card = client.posted.find((post) => post.direct === "UION")!;
    expect(card.message.text).toContain("node send-newsletter.js");
    expect(card.message.text).toContain("You have something to approve in Zen Staff");
    expect(card.message.buttons ?? []).toEqual([]);
    expect(
      client.posted.some((post) => post.message.text.includes("Waiting for approval from Ion")),
    ).toBe(true);
    // A second tick does not ask twice.
    await engine.tick();
    expect(client.posted.filter((post) => post.direct === "UION")).toHaveLength(1);
    // A button from an older card (or a forged click) decides nothing, even from the manager.
    const id = Object.keys(state().approvals)[0]!;
    await engine.handleEvent("slack-1", {
      type: "action" as const,
      platform: "slack" as const,
      workspaceId: "T1",
      channelId: "D-UION",
      threadId: null,
      messageId: card.id,
      user: { id: "UION", name: "ion" },
      value: approvalValue(id, "accept"),
    });
    expect(responses).toHaveLength(0);
    expect(Object.values(state().approvals)[0]).toMatchObject({ status: "pending" });
    expect(client.answers.at(-1)).toBe(
      "You have something to approve in Zen Staff: open To approve in the app.",
    );
    expect(
      audit.read(20).some((entry) => entry.outcome === "refused: approvals only in the app"),
    ).toBe(true);
  });

  it("puts the notice in the thread when the manager has no identity on the platform", async () => {
    const { engine, client, threads, responses } = makeEngine(
      config({ members: [maria, { ...ion, identities: [] }] }),
    );
    await engine.handleEvent("slack-1", message());
    const thread = [...threads.values()][0]!;
    thread.observation = {
      exists: true,
      running: true,
      replies: [],
      approvals: [{ requestId: "r", kind: "command", prompt: "rm old.txt" }],
      failed: false,
    };
    await engine.tick();
    const card = client.posted.find((post) => post.message.text.includes("rm old.txt"))!;
    expect(card.target.channelId).toBe("CSALES");
    expect(card.message.text).toContain("Only Ion can approve it, in Zen Staff (To approve).");
    expect(card.message.buttons ?? []).toEqual([]);
    expect(responses).toHaveLength(0);
  });

  it("answers refusals and /zen status, and logs metadata only", async () => {
    const { engine, client, audit } = makeEngine();
    await engine.handleEvent("slack-1", message({ user: { id: "UNEW", name: "x" } }));
    expect(client.posted.at(-1)!.message.text).toContain("Slack id: UNEW");
    await engine.handleEvent("slack-1", message({ text: "/zen status", mentioned: false }));
    expect(client.posted.at(-1)!.message.text).toContain("*Ana (marketing)* answers here.");
    const entries = audit.read(10);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of entries) expect(entry.text).toBeUndefined();
    expect(entries.some((entry) => entry.outcome === "refused: unknown person")).toBe(true);
  });

  it("anchors a slash command task in a new thread", async () => {
    const { engine, client, threads } = makeEngine();
    await engine.handleEvent(
      "slack-1",
      message({ messageId: "", mentioned: true, text: "/zen plan the launch" }),
    );
    expect(client.posted[0]!.message.text).toBe("*Maria:* plan the launch");
    expect(client.posted[1]!.target.threadId).toBe("m1");
    expect([...threads.values()][0]!.messages[0]).toContain("plan the launch");
  });

  it("posts a scheduled report to its channel when the agent may post there", async () => {
    const report = {
      id: "r1",
      name: "Daily sales",
      agentId: agent.id,
      bindingId: "b-sales",
      prompt: "Summarise today",
      days: [0, 1, 2, 3, 4, 5, 6],
      time: "09:00",
      enabled: true,
      lastRunAt: null,
      lastStatus: null,
    };
    const runs: string[] = [];
    const { engine, client, threads } = makeEngine(config({ reports: [report] }));
    (
      engine as unknown as { deps: { onReportRun: (id: string, status: string) => void } }
    ).deps.onReportRun = (_id, status) => runs.push(status);
    expect(await engine.runReport("r1")).toBe("running");
    const thread = [...threads.values()][0]!;
    expect(thread.messages[0]).toContain('scheduled report "Daily sales"');
    thread.observation = {
      exists: true,
      running: false,
      replies: [{ id: "a1", text: "Sales: 12 orders" }],
      approvals: [],
      failed: false,
    };
    await engine.tick();
    expect(client.posted.at(-1)!.target).toMatchObject({ channelId: "CSALES", threadId: null });
    expect(client.posted.at(-1)!.message.proactive).toBe(true);
    expect(runs).toEqual(["running", "posted"]);
  });
});

describe("store", () => {
  it("keeps the configuration owner-only", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-chat-store-"));
    const file = NodePath.join(dir, "chat", "chat.json");
    saveConfig(file, config());
    expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadConfig(file).bindings).toHaveLength(2);
    expect(loadConfig(NodePath.join(dir, "missing.json")).connections).toEqual([]);
  });
});

describe("AI staff @mention replies", () => {
  it("posts the mentioned agent's status in the conversation's thread, edits it, then the result", async () => {
    const { engine, client, threads, state } = makeEngine();
    await engine.handleEvent("slack-1", message({ text: "@Victor check the invoices" }));
    const [threadId] = [...threads.keys()];
    const conversation = Object.values(state().conversations).find(
      (record) => record.threadId === threadId,
    )!;
    const before = client.posted.length;
    const post = {
      originThreadId: threadId!,
      key: "mention:run-1",
      agentName: "Victor",
      files: [],
    };
    await engine.relayMention({ ...post, platformMarkdown: "**Victor** lucrează…", final: false });
    expect(client.posted.length).toBe(before + 1);
    const status = client.posted.at(-1)!;
    expect(status.target).toMatchObject({
      channelId: conversation.target.channelId,
      threadId: conversation.target.threadId,
    });
    expect(status.message.text).toBe("*Victor* lucrează…");
    await engine.relayMention({
      ...post,
      platformMarkdown: "**Victor**: 3 facturi verificate.",
      final: true,
    });
    expect(client.updates.at(-1)).toEqual({
      id: status.id,
      text: "*Victor*: 3 facturi verificate.",
    });
    expect(client.posted.length).toBe(before + 1);
    // Another chat's mention is not ours.
    await engine.relayMention({
      ...post,
      originThreadId: "some-office-chat",
      key: "mention:run-2",
      platformMarkdown: "x",
      final: true,
    });
    expect(client.posted.length).toBe(before + 1);
  });
});
