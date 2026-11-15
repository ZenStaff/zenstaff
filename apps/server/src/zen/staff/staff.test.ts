// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the engine is plain async code; tests use temp folders.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  StaffAgent,
  StaffApproval,
  StaffRating,
  StaffTaskRun,
} from "@t3tools/contracts/zenStaff";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  discoverRepeatedWork,
  estimateTask,
  evaluateMonth,
  weeklyReportText,
  type DiscoveryItem,
} from "./analytics.ts";
import {
  extractPriceLines,
  mergeCheckerResult,
  parseAiFindings,
  runCheckerRules,
} from "./checker.ts";
import { fallbackHrDraft, parseHrDraft, parsePersonas } from "./prompts.ts";
import { ROLE_CATALOG } from "./roleCatalog.ts";
import {
  STAFF_MCP_TOOL_NAMES,
  handleStaffMcpMessage,
  setZenStaffResolver,
  withZenStaffMcp,
  withZenStaffToolGate,
} from "./staffMcp.ts";
import { StaffEngine, StaffError, type StaffDeps } from "./staffEngine.ts";
import {
  DEFAULT_SETTINGS,
  agentFromTemplate,
  agentStatus,
  budgetBlock,
  buildAgentBrief,
  classifyOutboundTool,
  evaluatePlacement,
  findMentionedAgents,
  gateToolCall,
  normalizeAgentInput,
  parseAgentMarker,
  resolveTaskModel,
  type GateAllowance,
  type PlacementContext,
} from "./staffModel.ts";

const NOW = "2026-11-06T10:00:00.000Z";

function agent(overrides: Partial<StaffAgent> = {}): StaffAgent {
  return {
    ...agentFromTemplate(ROLE_CATALOG[0]!, {
      id: "maria-1",
      companyId: "acme",
      now: NOW,
      locale: "ro",
      kind: "company",
      managerId: "owner",
      owner: null,
      projectId: "p1",
    }),
    ...overrides,
  };
}

const context = (overrides: Partial<PlacementContext> = {}): PlacementContext => ({
  companyId: "acme",
  isRunner: true,
  companyAccount: {
    kind: "team-seat",
    providerInstanceId: "claude-company",
    model: "claude-haiku-5-5",
    label: "Acme Team",
  },
  companyAccountAvailable: true,
  locale: "en",
  ...overrides,
});

describe("permission model", () => {
  it("lets personal agents run anywhere with the person's own account", () => {
    expect(
      evaluatePlacement("personal", context({ isRunner: false, companyAccount: null })).ok,
    ).toBe(true);
  });

  it("explains every missing piece for a company agent", () => {
    const none = evaluatePlacement(
      "company",
      context({ isRunner: false, companyAccount: null, companyAccountAvailable: false }),
    );
    expect(none.ok).toBe(false);
    expect(none.missing).toEqual(["company-account", "runner"]);
    expect(none.message).toMatch(/Team or Enterprise seat/);
    expect(none.message).toMatch(/company runner/);
    expect(evaluatePlacement("company", context({ isRunner: false })).missing).toEqual(["runner"]);
    expect(evaluatePlacement("company", context({ companyAccount: null })).missing).toEqual([
      "company-account",
    ]);
    const unavailable = evaluatePlacement("company", context({ companyAccountAvailable: false }));
    expect(unavailable.missing).toEqual(["company-account"]);
    expect(evaluatePlacement("company", context()).ok).toBe(true);
  });

  it("never places a company agent in Personal", () => {
    const placement = evaluatePlacement("company", context({ companyId: "personal" }));
    expect(placement.ok).toBe(false);
    expect(placement.message).toMatch(/Personal has no company account/);
  });

  it("speaks Romanian", () => {
    expect(
      evaluatePlacement("company", context({ companyAccount: null, locale: "ro" })).message,
    ).toMatch(/contul AI al companiei/);
  });

  it("runs company agents on the company account and personal agents never on it", () => {
    const personalChoice = { instanceId: "claudeAgent", model: "claude-haiku-5-5" };
    const company = resolveTaskModel("company", personalChoice, context());
    expect(company).toEqual({
      ok: true,
      selection: { instanceId: "claude-company", model: "claude-haiku-5-5" },
    });
    expect(resolveTaskModel("personal", personalChoice, context())).toEqual({
      ok: true,
      selection: personalChoice,
    });
    const misuse = resolveTaskModel(
      "personal",
      { instanceId: "claude-company", model: "x" },
      context(),
    );
    expect(misuse.ok).toBe(false);
    expect(misuse.ok ? [] : misuse.placement.missing).toEqual(["personal-on-runner"]);
    expect(resolveTaskModel("company", personalChoice, context({ isRunner: false })).ok).toBe(
      false,
    );
  });
});

describe("outbound gate", () => {
  it("classifies connector tools", () => {
    expect(classifyOutboundTool("mcp__claude_ai_Gmail__send_message")).toBe("send");
    expect(classifyOutboundTool("mcp__claude_ai_Gmail__create_draft")).toBeNull();
    expect(classifyOutboundTool("mcp__claude_ai_Gmail__search_threads")).toBeNull();
    expect(classifyOutboundTool("mcp__claude_ai_Gmail__trash_message")).toBe("delete");
    expect(classifyOutboundTool("mcp__claude_ai_HorecaOS__social_postare_programeaza")).toBe(
      "publish",
    );
    expect(classifyOutboundTool("mcp__claude_ai_HorecaOS__produs_modifica")).toBeNull();
    expect(classifyOutboundTool("mcp__claude_ai_HorecaOS__create_reservation")).toBe("other");
    expect(classifyOutboundTool("mcp__fb__ads_create_campaign")).toBe("publish");
    expect(classifyOutboundTool("mcp__stripe__create_refund")).toBe("pay");
    expect(classifyOutboundTool("mcp__wp__publish_post")).toBe("publish");
    expect(classifyOutboundTool("mcp__zen-staff__staff_request_approval")).toBeNull();
    expect(classifyOutboundTool("Bash")).toBeNull();
    expect(classifyOutboundTool("Write")).toBeNull();
  });

  it("denies without approval, allows once with it", () => {
    const allowances: GateAllowance[] = [];
    const denied = gateToolCall("mcp__gmail__send_message", allowances, 1_000);
    expect(denied.behavior).toBe("deny");
    allowances.push({ approvalId: "a1", action: "send", expiresAt: 10_000, remaining: 1 });
    expect(gateToolCall("mcp__gmail__trash_message", allowances, 1_000).behavior).toBe("deny");
    expect(gateToolCall("mcp__gmail__send_message", allowances, 1_000)).toEqual({
      behavior: "allow",
      approvalId: "a1",
    });
    expect(gateToolCall("mcp__gmail__send_message", allowances, 1_000).behavior).toBe("deny");
    allowances.push({ approvalId: "a2", action: "send", expiresAt: 500, remaining: 1 });
    expect(gateToolCall("mcp__gmail__send_message", allowances, 1_000).behavior).toBe("deny");
    expect(gateToolCall("mcp__gmail__list_labels", allowances, 1_000).behavior).toBe("pass");
  });

  it("wraps the adapter hooks only for agent threads", async () => {
    setZenStaffResolver({
      mcpFor: (threadId) =>
        threadId === "t-agent" ? { url: "http://127.0.0.1:1/mcp/t/t-agent", token: "tok" } : null,
      gate: (threadId, tool) =>
        threadId === "t-agent" ? gateToolCall(tool, [], 0) : { behavior: "pass" },
    });
    try {
      const base = { allowedTools: ["Read"], mcpServers: {} };
      expect(withZenStaffMcp("t-other", base)).toBe(base);
      const wrapped = withZenStaffMcp("t-agent", base);
      expect(wrapped.allowedTools).toContain("mcp__zen-staff__staff_request_approval");
      expect(Object.keys(wrapped.mcpServers ?? {})).toEqual(["zen-staff"]);
      const upstream = async (
        _tool: string,
        _input: Record<string, unknown>,
        _options: { toolUseID: string },
      ) => ({ behavior: "ask" });
      const gated = withZenStaffToolGate("t-agent", upstream);
      expect(await gated("mcp__gmail__send_message", {}, { toolUseID: "u1" })).toMatchObject({
        behavior: "deny",
        toolUseID: "u1",
      });
      expect(await gated("Read", {}, { toolUseID: "u2" })).toEqual({ behavior: "ask" });
      expect(
        await withZenStaffToolGate("t-other", upstream)(
          "mcp__gmail__send_message",
          {},
          { toolUseID: "u3" },
        ),
      ).toEqual({ behavior: "ask" });
    } finally {
      setZenStaffResolver(null);
    }
  });

  it("speaks MCP", async () => {
    const backend = { instructions: "x", call: async (tool: string) => `ran ${tool}` };
    const list = await handleStaffMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      backend,
    );
    const tools = (list!.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(STAFF_MCP_TOOL_NAMES);
    const call = await handleStaffMcpMessage(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "staff_record_result", arguments: {} },
      },
      backend,
    );
    expect(call?.result).toEqual({ content: [{ type: "text", text: "ran staff_record_result" }] });
    expect(
      await handleStaffMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, backend),
    ).toBeNull();
  });
});

describe("agent profile", () => {
  it("builds every catalog role in both languages, wired to shipped workflows", () => {
    expect(ROLE_CATALOG).toHaveLength(10);
    const registry = JSON.parse(
      NodeFS.readFileSync(NodePath.join(import.meta.dirname, "../workflows/registry.json"), "utf8"),
    ) as {
      entries: Array<{ id: string; kind?: string; workflows?: Array<string> }>;
    };
    // A pack of several workflows ships its member workflows.
    const shipped = new Set(
      registry.entries
        .filter((entry) => entry.kind !== "coming_soon")
        .flatMap((entry) => [entry.id, ...(entry.workflows ?? [])]),
    );
    for (const role of ROLE_CATALOG) {
      expect(role.workflows.length).toBeGreaterThan(0);
      for (const workflow of role.workflows)
        expect(shipped.has(workflow), `${role.id}: ${workflow}`).toBe(true);
      expect(role.instructions.ro).toMatch(/aprob/);
      expect(`${role.instructions.ro}${role.role.ro}${role.summary.ro}`).not.toMatch(/[şţŞŢ]/);
    }
  });

  it("validates the profile form", () => {
    const saved = normalizeAgentInput(
      {
        name: "  Ana ",
        kind: "company",
        role: "Recepție",
        instructions: "Răspunde la rezervări.",
        workflows: ["customer-reply", "customer-reply", ""],
        memory: { read: true, write: true },
        workingHours: { days: [5, 1, 9], start: "09:00", end: "17:00" },
        duties: [
          { title: "Lista", prompt: "Fă lista", weekday: 1, time: "09:30" },
          { title: "Bad", prompt: "x", weekday: 9, time: "25:00" },
        ],
        limits: { maxRunsPerDay: 5, monthlyTokenBudget: 200_000 },
        objectives: [{ title: "Răspuns în 30 min" }],
        managerId: "owner",
      },
      null,
      { id: "ana-1", companyId: "acme", now: NOW },
    );
    expect(saved.name).toBe("Ana");
    expect(saved.workflows).toEqual(["customer-reply"]);
    expect(saved.workingHours).toEqual({ days: [1, 5], start: "09:00", end: "17:00" });
    expect(saved.duties).toHaveLength(1);
    expect(saved.limits).toEqual({
      maxRunsPerDay: 5,
      maxMinutesPerRun: null,
      monthlyTokenBudget: 200_000,
    });
    expect(saved.instructionsVersion).toBe(1);
    const edited = normalizeAgentInput({ ...saved, instructions: "Nou." }, saved, {
      id: "ana-1",
      companyId: "acme",
      now: NOW,
    });
    expect(edited.instructionsVersion).toBe(2);
    expect(() =>
      normalizeAgentInput({ name: "" }, null, { id: "x", companyId: "acme", now: NOW }),
    ).toThrow();
  });

  it("writes the brief with the house rules and a marker", () => {
    const brief = buildAgentBrief({
      agent: agent(),
      managerName: "Alex",
      workflowNames: ["Social media post set"],
      task: "Postare de vineri",
      teachMe: true,
      locale: "ro",
    });
    expect(parseAgentMarker(brief)).toEqual({ agentId: "maria-1", companyId: "acme" });
    expect(brief).toMatch(/staff_request_approval/);
    expect(brief).toMatch(/Alex/);
    expect(brief).toMatch(/Învață-mă/);
    expect(brief.endsWith("Răspunde și scrie documentele în limba română.")).toBe(true);
  });

  it("finds @mentions", () => {
    const agents = [
      agent({ id: "a", name: "Ana" }),
      agent({ id: "b", name: "Ana Maria" }),
      agent({ id: "c", name: "Radu", paused: true }),
    ];
    expect(findMentionedAgents("@Ana Maria fă oferta", agents).map((item) => item.id)).toEqual([
      "b",
    ]);
    expect(findMentionedAgents("te rog @ana, vezi", agents).map((item) => item.id)).toEqual(["a"]);
    expect(findMentionedAgents("@Radu", agents)).toEqual([]);
    expect(findMentionedAgents("ana@firma.example", agents)).toEqual([]);
  });

  it("knows status and budget", () => {
    expect(agentStatus({ paused: false, activeThreads: 1, pendingApprovals: 1 })).toBe(
      "waiting-approval",
    );
    expect(agentStatus({ paused: false, activeThreads: 1, pendingApprovals: 0 })).toBe("working");
    expect(agentStatus({ paused: false, activeThreads: 0, pendingApprovals: 0 })).toBe("idle");
    const runs = [run({ tokens: 150_000 })];
    expect(
      budgetBlock(
        agent({
          limits: { maxRunsPerDay: null, maxMinutesPerRun: null, monthlyTokenBudget: 100_000 },
        }),
        runs,
        NOW,
        "en",
      ),
    ).toMatch(/budget/);
    expect(
      budgetBlock(
        agent({ limits: { maxRunsPerDay: 1, maxMinutesPerRun: null, monthlyTokenBudget: null } }),
        runs,
        NOW,
        "en",
      ),
    ).toMatch(/1 tasks a day/);
  });
});

function run(overrides: Partial<StaffTaskRun> = {}): StaffTaskRun {
  return {
    id: "r1",
    agentId: "maria-1",
    threadId: "t1",
    cardId: null,
    title: "Postări",
    origin: "task",
    teachMe: false,
    startedAt: NOW,
    endedAt: NOW,
    status: "completed",
    durationMs: 6 * 60_000,
    tokens: 40_000,
    trail: null,
    ...overrides,
  };
}

describe("discovery", () => {
  const DAY = 24 * 60 * 60 * 1000;
  // Friday 2026-09-04 10:00 local.
  const firstFriday = new Date(2026, 8, 4, 10, 0).getTime();

  it("finds a weekly repeated request and names its day, labels only", () => {
    const items: DiscoveryItem[] = [];
    for (let week = 0; week < 6; week++) {
      items.push({
        threadId: `inv-${week}`,
        createdAtMs: firstFriday + week * 7 * DAY,
        text: `Verifică facturile furnizorilor din săptămâna asta ${week % 2 === 0 ? "față de comenzi" : "și prețurile"} pentru Ana`,
        person: "Ana",
        minutes: 110 + week,
      });
    }
    items.push({
      threadId: "x1",
      createdAtMs: firstFriday + DAY,
      text: "Scrie un poem despre toamnă",
      person: "Ana",
      minutes: 5,
    });
    items.push({
      threadId: "x2",
      createdAtMs: firstFriday + 9 * DAY,
      text: "Tradu contractul de închiriere",
      person: "Ana",
      minutes: 20,
    });
    const result = discoverRepeatedWork(items, []);
    expect(result.analyzedThreads).toBe(8);
    expect(result.suggestions).toHaveLength(1);
    const [suggestion] = result.suggestions;
    expect(suggestion).toMatchObject({
      person: "Ana",
      count: 6,
      weeks: 6,
      cadence: "weekly",
      weekday: 5,
      proposal: "workflow",
      suggestedTemplateId: "junior-accountant",
    });
    expect(suggestion!.minutesEach).toBe(113);
    expect(suggestion!.hoursPerMonth).toBeGreaterThan(7);
    expect(suggestion!.label).toMatch(/factur/);
    expect(JSON.stringify(result)).not.toMatch(/comenzi/);
  });

  it("groups by workflow and needs enough weeks", () => {
    const workflows = [
      { id: "review-replies", names: ["Reply to reviews", "Răspunde la recenzii"] },
    ];
    const items: DiscoveryItem[] = [0, 1, 2, 3].map((week) => ({
      threadId: `r-${week}`,
      createdAtMs: firstFriday - 4 * DAY + week * 7 * DAY,
      text: `Răspunde la recenzii\n\nRecenzii: ${["pizza rece", "ospătar amabil", "zgomot", "parcare"][week]}`,
      person: "Ion",
      minutes: 30,
    }));
    const result = discoverRepeatedWork(items, workflows);
    expect(result.suggestions[0]).toMatchObject({
      workflowId: "review-replies",
      proposal: "agent",
      weekday: 1,
      count: 4,
    });
    expect(discoverRepeatedWork(items.slice(0, 2), workflows).suggestions).toEqual([]);
  });
});

describe("evaluation", () => {
  it("computes the month per agent", () => {
    const approvals: StaffApproval[] = [
      {
        id: "a1",
        agentId: "maria-1",
        threadId: "t1",
        cardId: null,
        action: "publish",
        target: "FB",
        content: "x",
        reason: "",
        status: "approved",
        checker: null,
        decidedBy: "Alex",
        decidedAt: NOW,
        decisionNote: "",
        createdAt: NOW,
      },
      {
        id: "a2",
        agentId: "maria-1",
        threadId: "t1",
        cardId: null,
        action: "publish",
        target: "FB",
        content: "x",
        reason: "",
        status: "rejected",
        checker: null,
        decidedBy: "Alex",
        decidedAt: NOW,
        decisionNote: "prea lung",
        createdAt: NOW,
      },
      {
        id: "a3",
        agentId: "maria-1",
        threadId: "t1",
        cardId: null,
        action: "send",
        target: "x",
        content: "x",
        reason: "",
        status: "approved",
        checker: null,
        decidedBy: "Alex",
        decidedAt: "2026-10-01T10:00:00.000Z",
        decisionNote: "",
        createdAt: NOW,
      },
    ];
    const ratings: StaffRating[] = [
      {
        id: "g1",
        agentId: "maria-1",
        threadId: null,
        by: "Ion",
        thumbs: "up",
        score: 5,
        comment: "",
        at: NOW,
      },
      {
        id: "g2",
        agentId: "maria-1",
        threadId: null,
        by: "Ion",
        thumbs: "down",
        score: 2,
        comment: "",
        at: NOW,
      },
    ];
    const evaluation = evaluateMonth({
      month: "2026-11",
      agents: [agent({ minutesPerTask: 45 })],
      runs: [
        run(),
        run({ id: "r2", tokens: 60_000, durationMs: 4 * 60_000 }),
        run({ id: "r3", status: "failed", tokens: 10_000, durationMs: null }),
        run({ id: "r4", startedAt: "2026-10-30T10:00:00.000Z" }),
      ],
      approvals,
      ratings,
      settings: { pricePerMillionTokens: 3, currency: "EUR" },
    });
    expect(evaluation.rows[0]).toMatchObject({
      tasksDone: 2,
      tasksFailed: 1,
      tokens: 110_000,
      cost: 0.33,
      minutesWorked: 10,
      minutesSaved: 80,
      approvals: 2,
      approved: 1,
      rejected: 1,
      approvalRate: 0.5,
      thumbsUp: 1,
      thumbsDown: 1,
      averageScore: 3.5,
    });
    expect(evaluation.totals).toEqual({
      tasksDone: 2,
      tokens: 110_000,
      cost: 0.33,
      minutesSaved: 80,
    });
    const noPrice = evaluateMonth({
      month: "2026-11",
      agents: [agent()],
      runs: [run()],
      approvals: [],
      ratings: [],
      settings: { pricePerMillionTokens: null, currency: "EUR" },
    });
    expect(noPrice.rows[0]!.cost).toBeNull();
    expect(noPrice.rows[0]!.approvalRate).toBeNull();
  });

  it("estimates from history, else from the role", () => {
    const settings = { pricePerMillionTokens: null, currency: "EUR" };
    const fromHistory = estimateTask({
      agent: agent(),
      runs: [
        run(),
        run({ id: "r2", durationMs: 10 * 60_000, tokens: 80_000 }),
        run({ id: "r3", durationMs: 8 * 60_000, tokens: 50_000 }),
      ],
      settings,
    });
    expect(fromHistory).toMatchObject({
      basis: "history",
      samples: 3,
      minutes: 8,
      tokens: 50_000,
      humanMinutes: 45,
    });
    expect(estimateTask({ agent: agent(), runs: [], settings }).basis).toBe("template");
  });

  it("writes the weekly report", () => {
    const text = weeklyReportText({
      agent: agent(),
      weekStartMs: Date.parse("2026-11-02T00:00:00.000Z"),
      runs: [run()],
      approvals: [],
      ratings: [],
      locale: "ro",
    });
    expect(text).toMatch(/Sarcini terminate: 1 din 1/);
  });
});

describe("checker", () => {
  const brand = {
    tone: "calm",
    bannedWords: ["ieftin"],
    prices: [{ item: "Ciorbă de burtă", price: 32 }],
  };
  const base = {
    action: "publish" as const,
    target: "Facebook",
    brand,
    memoryPrices: [],
    locale: "ro" as const,
  };

  it("flags wrong prices, leftovers, discounts, personal data and brand words", () => {
    const findings = runCheckerRules({
      ...base,
      content:
        "Reducere de vineri! Ciorbă de burtă doar 29 lei, cel mai ieftin din oraș. Sună la 0722 123 456. [link meniu] CNP 1960101223344",
    });
    const rules = findings.map((finding) => finding.rule);
    expect(rules).toEqual(
      expect.arrayContaining([
        "price",
        "placeholder",
        "anpc-discount",
        "gdpr-contact",
        "brand-word",
      ]),
    );
    expect(findings.find((finding) => finding.rule === "price")!.message).toMatch(/32/);
  });

  it("passes clean content and catches cedillas", () => {
    expect(
      runCheckerRules({
        ...base,
        content: "Ciorbă de burtă, 32 lei, ca la mama acasă. Vă așteptăm!",
      }),
    ).toEqual([]);
    expect(
      runCheckerRules({ ...base, content: "Vă aşteptăm la masă" }).map((finding) => finding.rule),
    ).toEqual(["cedilla"]);
  });

  it("asks for unsubscribe on newsletters and checks payments", () => {
    const send = runCheckerRules({
      ...base,
      action: "send",
      target: "newsletter abonați",
      content: "Noutățile lunii noiembrie.",
    });
    expect(send.map((finding) => finding.rule)).toContain("gdpr-unsubscribe");
    expect(
      runCheckerRules({
        ...base,
        action: "pay",
        target: "Furnizor SRL",
        content: "Plată factura 12",
      }).map((finding) => finding.rule),
    ).toContain("payment");
  });

  it("reads memory price lines and merges the AI pass", () => {
    expect(
      extractPriceLines("- Pizza Margherita: 32 lei\n| Tiramisu | 18 RON |\nalt text"),
    ).toEqual([
      { item: "Pizza Margherita", price: 32 },
      { item: "Tiramisu", price: 18 },
    ]);
    const rules = runCheckerRules({ ...base, content: "Ciorbă de burtă 29 lei" });
    const ai = parseAiFindings(
      'Sure: [{"rule":"price-wrong","severity":"high","message":"Prețul diferă","excerpt":"29 lei"},{"rule":"tone","severity":"low","message":"Ton sec","excerpt":"Ciorbă"}]',
    );
    expect(ai).toHaveLength(2);
    const merged = mergeCheckerResult(rules, ai, NOW);
    expect(merged.status).toBe("issues");
    expect(merged.findings.map((finding) => finding.rule)).toEqual(["price", "tone"]);
    expect(merged.aiChecked).toBe(true);
    expect(parseAiFindings("no json")).toEqual([]);
    expect(mergeCheckerResult([], null, NOW)).toMatchObject({ status: "ok", aiChecked: false });
  });
});

describe("model answers", () => {
  it("parses an HR draft and falls back to the catalog", () => {
    const draft = parseHrDraft(
      '{"name":"Ana","role":"Recepție","instructions":"Răspunzi la rezervări.","workflows":["customer-reply","nope"],"connectors":["gmail"],"objectives":["30 min"],"duties":[{"title":"Lista","prompt":"Fă lista","weekday":1,"time":"09:30"}],"minutesPerTask":12}',
      { workflows: ["customer-reply"], connectors: ["gmail"] },
    );
    expect(draft).toMatchObject({
      name: "Ana",
      workflows: ["customer-reply"],
      connectors: ["gmail"],
      minutesPerTask: 12,
    });
    expect(parseHrDraft("nope", { workflows: [], connectors: [] })).toBeNull();
    const fallback = fallbackHrDraft(
      [{ id: "work", answer: "Verifică facturile de la furnizori" }],
      "ro",
    );
    expect(fallback.templateId).toBe("junior-accountant");
    expect(fallback.instructions).toMatch(/Din interviu/);
  });

  it("parses personas", () => {
    expect(
      parsePersonas(
        '[{"name":"Familia cu copii","summary":"Vin duminica","cares":["porții mari"],"objections":["preț"]}]',
        "p",
      ),
    ).toEqual([
      {
        id: "p-1",
        name: "Familia cu copii",
        summary: "Vin duminica",
        cares: ["porții mari"],
        objections: ["preț"],
      },
    ]);
  });
});

// The engine with fakes: hiring, a task with an approval, the decision reaching the agent.

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

function makeEngine(overrides: Partial<StaffDeps> = {}) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-staff-"));
  temps.push(root);
  const stateDir = NodePath.join(root, "state");
  NodeFS.mkdirSync(NodePath.join(stateDir, "zen"), { recursive: true });
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
  const launches: Array<{
    threadId: string;
    modelSelection: { instanceId: string };
    text: string;
    projectId: string;
  }> = [];
  const sent: Array<{ threadId: string; text: string }> = [];
  const duties: string[] = [];
  const deps: StaffDeps = {
    stateDir,
    zenHome: root,
    now: () => new Date(NOW),
    threads: async (ids) =>
      (ids ?? launches.map((launch) => launch.threadId)).map((id) => ({
        id,
        projectId: "p1",
        title: "Chat",
        active: true,
        createdAtMs: Date.parse(NOW),
        modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
        runtimeMode: "auto-accept-edits",
      })),
    usage: async () => ({
      status: "completed",
      durationMs: 120_000,
      tokens: 30_000,
      firstUserText: null,
      minutesSpan: 2,
    }),
    launch: async (input) => {
      launches.push(input);
    },
    send: async (input) => {
      sent.push(input);
    },
    generate: async () => "[]",
    providerAvailable: async (id) => id === "claude-company",
    upsertDuty: async (input) => {
      duties.push(input.title);
      return `task-${duties.length}`;
    },
    deleteDuty: async () => undefined,
    workflows: () => [],
    ...overrides,
  };
  return { engine: new StaffEngine(deps), launches, sent, duties, root, stateDir };
}

const defaults = {
  modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  runtimeMode: "auto-accept-edits",
  projectId: "p1",
};

describe("engine", () => {
  it("refuses a company agent until the company account and runner exist, then hires", async () => {
    const { engine, root, duties } = makeEngine();
    const hire = () =>
      engine.call("agent.hire", {
        companyId: "acme",
        templateId: "social-media-manager",
        kind: "company",
        locale: "en",
        defaults,
      });
    await expect(hire()).rejects.toMatchObject({ reason: "needs-company-account" });
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
    await expect(hire()).rejects.toMatchObject({ reason: "needs-runner" });
    NodeFS.mkdirSync(NodePath.join(root, "toolchains"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "toolchains", "state.json"),
      JSON.stringify({ settings: { companyRunner: true } }),
    );
    const hired = (await hire()) as StaffAgent;
    expect(hired).toMatchObject({
      kind: "company",
      templateId: "social-media-manager",
      managerId: null,
    });
    expect(hired.duties[0]!.scheduledTaskId).toBe("task-1");
    expect(duties).toEqual(["Maria: Plan this week's posts"]);
    const personal = (await engine.call("agent.hire", {
      companyId: "acme",
      templateId: "admin-assistant",
      kind: "personal",
      locale: "ro",
      defaults,
    })) as StaffAgent;
    expect(personal.kind).toBe("personal");
    const file = NodePath.join(root, "state", "zen", "staff", "acme.json");
    expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("runs a task, holds the outbound action for approval and tells the agent the decision", async () => {
    const { engine, launches, sent, root } = makeEngine({
      generate: async () =>
        '[{"rule":"tone","severity":"low","message":"Ton prea sec","excerpt":"Vineri"}]',
    });
    NodeFS.mkdirSync(NodePath.join(root, "toolchains"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "toolchains", "state.json"),
      JSON.stringify({ settings: { companyRunner: true } }),
    );
    await engine.call("overview", { companyId: "acme", locale: "ro" });
    await engine.call("settings.save", {
      companyId: "acme",
      settings: {
        companyAccount: {
          kind: "api-key",
          providerInstanceId: "claude-company",
          model: "claude-haiku-5-5",
          label: "Acme API",
        },
        brand: { tone: "", bannedWords: [], prices: [{ item: "Ciorbă", price: 32 }] },
      },
    });
    const ana = (await engine.call("agent.hire", {
      companyId: "acme",
      templateId: "horeca-reservations",
      kind: "company",
      managerId: "owner",
      locale: "ro",
      defaults,
    })) as StaffAgent;
    const started = (await engine.call("task.start", {
      companyId: "acme",
      agentId: ana.id,
      text: "Postează meniul de vineri",
      locale: "ro",
      defaults,
    })) as { threadId: string };
    expect(launches[0]!.modelSelection.instanceId).toBe("claude-company");
    expect(parseAgentMarker(launches[0]!.text)).toEqual({ agentId: ana.id, companyId: "acme" });
    expect(engine.isAgentThread(started.threadId)).toBe(true);
    expect(engine.gate(started.threadId, "mcp__meta__publish_post").behavior).toBe("deny");
    expect(engine.gate("someone-else", "mcp__meta__publish_post").behavior).toBe("pass");

    const tools = engine.toolsFor(started.threadId)!;
    const answer = await tools.call("staff_request_approval", {
      action: "publish",
      target: "Facebook",
      content: "Vineri: Ciorbă 29 lei",
    });
    expect(answer).toMatch(/Approval requested/);
    let overview = (await engine.call("overview", { companyId: "acme", locale: "ro" })) as {
      approvals: StaffApproval[];
      agents: Array<{ id: string; status: string }>;
    };
    const pending = overview.approvals[0]!;
    expect(pending.status).toBe("pending");
    expect(pending.checker!.findings.map((finding) => finding.rule)).toEqual(["price", "tone"]);
    expect(overview.agents.find((item) => item.id === ana.id)!.status).toBe("waiting-approval");

    await expect(
      engine.call("approval.decide", {
        companyId: "acme",
        approvalId: pending.id,
        decision: "reject",
        locale: "ro",
      }),
    ).rejects.toBeInstanceOf(StaffError);
    await engine.call("approval.decide", {
      companyId: "acme",
      approvalId: pending.id,
      decision: "reject",
      note: "Prețul e 32 lei",
      locale: "ro",
    });
    expect(sent[0]!.text).toMatch(/a respins/);
    expect(engine.gate(started.threadId, "mcp__meta__publish_post").behavior).toBe("deny");

    await tools.call("staff_request_approval", {
      action: "publish",
      target: "Facebook",
      content: "Vineri: Ciorbă 32 lei",
    });
    overview = (await engine.call("overview", {
      companyId: "acme",
      locale: "ro",
    })) as typeof overview;
    const second = overview.approvals.find((item) => item.status === "pending")!;
    expect(second.checker!.findings.some((finding) => finding.rule === "price")).toBe(false);
    await engine.call("approval.decide", {
      companyId: "acme",
      approvalId: second.id,
      decision: "approve",
      locale: "ro",
    });
    expect(sent[1]!.text).toMatch(/a aprobat/);
    expect(engine.gate(started.threadId, "mcp__meta__publish_post").behavior).toBe("allow");
    expect(engine.gate(started.threadId, "mcp__meta__publish_post").behavior).toBe("deny");

    await tools.call("staff_record_result", {
      summary: "Postat",
      explain_to_boss: ["a", "b", "c"],
      sources: ["memorie"],
      files_read: ["meniu.md"],
    });
    await engine.onRunUpdated(started.threadId, true);
    const evaluation = (await engine.call("evaluation", { companyId: "acme" })) as {
      rows: Array<{
        agentId: string;
        tasksDone: number;
        rejected: number;
        approved: number;
        tokens: number;
      }>;
    };
    expect(evaluation.rows.find((row) => row.agentId === ana.id)).toMatchObject({
      tasksDone: 1,
      approved: 1,
      rejected: 1,
      tokens: 30_000,
    });
    const stored = JSON.parse(
      NodeFS.readFileSync(NodePath.join(root, "state", "zen", "staff", "acme.json"), "utf8"),
    ) as { runs: StaffTaskRun[]; corrections: unknown[] };
    expect(stored.runs[0]!.trail).toMatchObject({ summary: "Postat", filesRead: ["meniu.md"] });
    expect(stored.corrections).toHaveLength(1);
  });

  it("hands @mentions in a company chat to the agent", async () => {
    const { engine, launches } = makeEngine();
    await engine.call("overview", { companyId: "acme", locale: "ro" });
    const radu = (await engine.call("agent.hire", {
      companyId: "acme",
      templateId: "customer-support-reviews",
      kind: "personal",
      locale: "ro",
      defaults,
    })) as StaffAgent;
    await engine.onUserMessage({
      id: "m1",
      threadId: "chat-1",
      text: `@${radu.name} răspunde la recenzia de azi`,
      scheduledTaskId: null,
      createdBy: "user",
    });
    expect(launches).toHaveLength(1);
    expect(launches[0]!.modelSelection.instanceId).toBe("claudeAgent");
    const overview = (await engine.call("overview", { companyId: "acme", locale: "ro" })) as {
      cards: Array<{ origin: string; assignee: { id: string } }>;
    };
    expect(overview.cards[0]).toMatchObject({ origin: "mention", assignee: { id: radu.id } });
    await engine.onUserMessage({
      id: "m1",
      threadId: "chat-1",
      text: `@${radu.name} din nou`,
      scheduledTaskId: null,
      createdBy: "user",
    });
    expect(launches).toHaveLength(1);
  });

  it("keeps discovery opt-in", async () => {
    const { engine } = makeEngine();
    await expect(engine.call("discovery.run", { companyId: "acme" })).rejects.toMatchObject({
      reason: "forbidden",
    });
    await engine.call("settings.save", { companyId: "acme", settings: { discoveryOptIn: true } });
    expect(await engine.call("discovery.run", { companyId: "acme" })).toMatchObject({
      suggestions: [],
    });
  });

  it("keeps the admin's block on personal AI accounts", async () => {
    const { engine } = makeEngine();
    const saved = (await engine.call("settings.save", {
      companyId: "acme",
      settings: { blockPersonalAccounts: true },
    })) as { blockPersonalAccounts?: boolean };
    expect(saved.blockPersonalAccounts).toBe(true);
    // Saving another field keeps it; only a boolean changes it.
    const later = (await engine.call("settings.save", {
      companyId: "acme",
      settings: { discoveryOptIn: true, blockPersonalAccounts: "yes" },
    })) as { blockPersonalAccounts?: boolean };
    expect(later.blockPersonalAccounts).toBe(true);
    expect(DEFAULT_SETTINGS.blockPersonalAccounts).toBeUndefined();
  });

  it("uses default settings for a new company", () => {
    expect(DEFAULT_SETTINGS.discoveryOptIn).toBe(false);
  });
});
