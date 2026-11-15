// @effect-diagnostics nodeBuiltinImport:off globalDate:off - temp folders and fixed dates for the engine's file state.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { parseIntakeMarker, type IntakeThreadView } from "@t3tools/contracts/zenIntake";
import type { ZenWorkflow } from "@t3tools/contracts/zenOffice";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { parseWorkflowFolder } from "../workflows/workflowStore.ts";
import { codexMcpServers, IntakeEngine, recentFiles } from "./intakeEngine.ts";
import { zenThreadFolderWords } from "./threadFolderName.ts";

const workflow: ZenWorkflow = {
  manifest: {
    id: "social-media-post-set",
    name: "Social media post set",
    description: "A week of posts.",
    category: "social",
    icon: "megaphone",
    inputs: [
      { id: "topic", label: "What is it about?", type: "longtext", required: true },
      {
        id: "networks",
        label: "Networks",
        type: "select",
        required: true,
        options: ["Instagram + Facebook", "LinkedIn"],
      },
      { id: "tone", label: "Tone", type: "select", required: true, options: ["Friendly", "Bold"] },
      { id: "call_to_action", label: "What should people do?", type: "text", required: false },
    ],
    output: "social-posts.md",
    version: "1.0.0",
    author: "Zen Staff",
    i18n: {
      ro: {
        name: "Postări pentru rețelele sociale",
        inputs: {
          topic: { label: "Despre ce e vorba?" },
          networks: { label: "Rețelele" },
          tone: { label: "Tonul", options: ["Prietenos", "Îndrăzneț"] },
        },
      },
    },
  },
  prompt:
    "Write posts about {{topic}} for {{networks}} in a {{tone}} tone.{{#call_to_action}} CTA: {{call_to_action}}{{/call_to_action}}",
  skill: "Check prices.",
  source: "builtin",
  packId: null,
  editable: false,
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

function setup(workflows: ReadonlyArray<ZenWorkflow> = [workflow]) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-intake-"));
  dirs.push(root);
  const stateDir = NodePath.join(root, "state");
  const zenHome = NodePath.join(root, "home");
  const cwd = NodePath.join(root, "work");
  NodeFS.mkdirSync(NodePath.join(stateDir, "zen", "onboarding"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(zenHome, "companies", "cafea", "memory"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(cwd, "brand"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(stateDir, "zen", "onboarding", "cafea.json"),
    JSON.stringify({
      answers: {
        companyName: "Cafea Bună",
        tones: ["friendly"],
        website: "https://cafeabuna.ro",
        customers: "Tineri din Cluj",
      },
    }),
  );
  NodeFS.writeFileSync(
    NodePath.join(zenHome, "companies", "cafea", "company-profile.md"),
    "# Cafea Bună\n\nAdresa: Str. Memorandumului 10, Cluj\n",
  );
  NodeFS.writeFileSync(
    NodePath.join(zenHome, "companies", "cafea", "memory", "MEMORY.md"),
    "- Rezervări: https://cafeabuna.ro/rezervari\n",
  );
  NodeFS.writeFileSync(NodePath.join(cwd, "brand", "ghid-brand.pdf"), "x");
  NodeFS.writeFileSync(NodePath.join(cwd, ".hidden"), "x");
  const codexConfigPath = NodePath.join(root, "codex.toml");
  NodeFS.writeFileSync(codexConfigPath, '[mcp_servers.zernio]\ncommand = "x"\n');
  const engine = new IntakeEngine({
    stateDir,
    zenHome,
    now: () => new Date("2026-11-08T09:00:00.000Z"),
    listWorkflows: async () => workflows,
    staffRoot: NodePath.join(root, "Zen Staff"),
    connections: async () => [
      { name: "claude.ai Meta", app: "Meta", origin: "account", health: "connected" },
      { name: "broken", app: null, origin: "local", health: "failed" },
    ],
    codexConfigPath,
  });
  const tool = (name: string) => engine.tools().find((item) => item.name === name)!;
  return { engine, tool, cwd, stateDir, root };
}

describe("intake engine: workflows", () => {
  it("starts with a first message built from the profile, memory and folder", async () => {
    const { engine, cwd } = setup();
    const started = await engine.call("workflow.start", {
      threadId: "t1",
      workflowId: "social-media-post-set",
      companyId: "cafea",
      projectId: "p1",
      cwd,
      folderName: "Marketing",
      locale: "ro",
      appendix: "Tools: node",
    });
    const { message, title, suggestions } = started as {
      message: string;
      title: string;
      suggestions: Record<string, { value: string }>;
    };
    expect(title).toBe("Postări pentru rețelele sociale");
    expect(parseIntakeMarker(message)).toBe("social-media-post-set");
    expect(message).toContain("Company: Cafea Bună");
    expect(message).toContain("Address: Str. Memorandumului 10, Cluj");
    expect(message).toContain("brand/ghid-brand.pdf");
    expect(message).not.toContain(".hidden");
    expect(message).toContain("Meta (AI account connector)");
    expect(message).toContain("zernio (Codex)");
    expect(suggestions.tone?.value).toBe("Prietenos");
    expect(suggestions.call_to_action?.value).toBe("https://cafeabuna.ro/rezervari");
    const view = (await engine.call("state", { threadId: "t1" })) as IntakeThreadView;
    expect(view).toMatchObject({
      kind: "workflow",
      workflowId: "social-media-post-set",
      launched: null,
    });
    expect(await engine.call("state", { threadId: "other" })).toBeNull();
  });

  it("shows quick replies, then intake_ready returns the workflow run and remembers the answers", async () => {
    const { engine, tool, cwd } = setup();
    const start = {
      threadId: "t1",
      workflowId: "social-media-post-set",
      companyId: "cafea",
      projectId: "p1",
      cwd,
      locale: "ro",
      appendix: "Tools: node",
    };
    await engine.call("workflow.start", start);
    await tool("intake_ask").run("t1", {
      field: "networks",
      question: "Pe ce rețele?",
      options: ["Instagram + Facebook", "LinkedIn", "LinkedIn"],
    });
    const asked = engine.view("t1")!;
    expect(asked.chips).toMatchObject({
      field: "networks",
      options: ["Instagram + Facebook", "LinkedIn"],
    });
    await expect(tool("intake_ask").run("t1", { options: ["one"] })).rejects.toThrow(/2 to 6/);

    await expect(
      tool("intake_ready").run("t1", { values: { topic: "Meniul de toamnă" } }),
    ).rejects.toThrow(/Still missing: Rețelele \(networks\), Tonul \(tone\)/);
    const result = await tool("intake_ready").run("t1", {
      values: { topic: "Meniul de toamnă", networks: "instagram si facebook", tone: "prietenos" },
    });
    expect(result).toContain(
      `Run folder: ${NodePath.join(cwd, "2026-11-08-postari-meniul-toamna")}`,
    );
    expect(result).toContain(
      "Write posts about Meniul de toamnă for Instagram + Facebook in a Prietenos tone.",
    );
    expect(result).toContain("Guidance for this task:\n\nCheck prices.");
    expect(result).toContain("Tools: node");
    const launched = engine.view("t1")!;
    expect(launched.chips).toBeNull();
    expect(launched.launched).toMatchObject({
      folder: "2026-11-08-postari-meniul-toamna",
      values: { networks: "Instagram + Facebook", tone: "Prietenos" },
    });

    // Repeat it: the web saves the scheduled task and reports back.
    await tool("intake_schedule").run("t1", {
      frequency: "weekly",
      weekday: "monday",
      time: "9:00",
    });
    expect(engine.view("t1")!.schedule).toMatchObject({
      kind: "weekly",
      weekday: 1,
      time: "09:00",
      state: "pending",
    });
    await engine.call("schedule.result", { threadId: "t1", ok: true });
    expect(engine.view("t1")!.schedule?.state).toBe("saved");

    // The next time, the choices of this run are proposed (never the topic).
    const again = (await engine.call("workflow.start", { ...start, threadId: "t2" })) as {
      suggestions: Record<string, { value: string; source: string }>;
      message: string;
    };
    expect(again.suggestions.networks).toMatchObject({
      value: "Instagram + Facebook",
      source: "previous",
    });
    expect(again.suggestions.topic).toBeUndefined();
    expect(again.message).toContain("This task last ran on 2026-11-08");
  });

  it("refuses intake tools in a chat that is not a task being prepared", async () => {
    const { tool } = setup();
    await expect(tool("intake_ready").run("plain", { values: {} })).rejects.toThrow(
      /not a task being prepared/,
    );
  });

  it("keeps its state across a restart of the server", async () => {
    const { engine, cwd, stateDir } = setup();
    await engine.call("workflow.start", {
      threadId: "t1",
      workflowId: "social-media-post-set",
      cwd,
      locale: "en",
    });
    const fresh = new IntakeEngine({
      stateDir,
      zenHome: "/nowhere",
      listWorkflows: async () => [workflow],
      connections: async () => [],
    });
    expect(fresh.view("t1")?.locale).toBe("en");
  });
});

describe("intake engine: hiring", () => {
  it("writes the setup chat with the connections found and stores the proposal for approval", async () => {
    const { engine, tool, cwd } = setup();
    const started = (await engine.call("hire.start", {
      threadId: "h1",
      companyId: "cafea",
      projectId: "p1",
      cwd,
      locale: "ro",
      agent: {
        id: "maria-1a2b",
        name: "Maria",
        role: "Social Media Manager",
        templateId: "social-media-manager",
        kind: "company",
      },
      managerName: "Alex",
      approvalsRequired: true,
      companyAccount: "Claude Team",
    })) as { message: string; title: string };
    expect(started.title).toBe("Angajare: Maria");
    expect(started.message).toContain("Văd că ai conectat Meta și zernio în Claude");
    expect(started.message).toContain("Ești social media managerul companiei");
    expect(started.message).toContain("Your manager: Alex.");
    await expect(tool("intake_ready").run("h1", { values: {} })).rejects.toThrow(/hire_propose/);
    await tool("hire_propose").run("h1", {
      instructions: "Planifici 4 postări pe săptămână pentru Instagram și Facebook.",
      workflows: ["social-media-post-set", "nope"],
      connectors: ["Meta"],
      duties: [
        { title: "Postările săptămânii", prompt: "Propune 4 postări", weekday: 1, time: "09:00" },
      ],
      approvals: "Alex aprobă",
      never: ["Nu inventa prețuri"],
    });
    const view = engine.view("h1")!;
    expect(view).toMatchObject({ kind: "hire", agentId: "maria-1a2b", proposalState: "pending" });
    expect(view.proposal?.workflows).toEqual(["social-media-post-set"]);
    await engine.call("hire.approved", { threadId: "h1" });
    expect(engine.view("h1")!.proposalState).toBe("approved");
  });
});

describe("helpers", () => {
  it("lists the newest files without hidden ones", () => {
    const { cwd } = setup();
    expect(recentFiles(cwd).map((file) => file.name)).toEqual(["brand/ghid-brand.pdf"]);
  });

  it("reads Codex's MCP servers", () => {
    expect(
      codexMcpServers('[mcp_servers.meta]\nx=1\n[mcp_servers."my server"]\n[other]\n'),
    ).toEqual(["meta", "my server"]);
  });

  it("names Scratch thread folders in plain words", () => {
    expect(zenThreadFolderWords("https://www.reddit.com/r/cafe/comments/1 ce zic oamenii")).toBe(
      "reddit-ce-zic-oamenii",
    );
    expect(zenThreadFolderWords("Postări pentru meniul de toamnă")).toBe(
      "postari-pentru-meniul-de-toamna",
    );
    expect(zenThreadFolderWords("Convert these PNGs to WebP, please!")).toBe(
      "convert-these-pngs-to-webp",
    );
    const workflowMessage =
      "Postări pentru rețelele sociale\n\nDespre ce e vorba? Meniul de toamnă\n\n---\n\nWrite posts.\n\nLanguage: the person using this works in Romanian. Always answer.";
    expect(zenThreadFolderWords(workflowMessage)).toBe("postari-pentru-retelele-sociale-meniul");
  });
});

/** A real pack from apps/server/src/zen/workflows/packs, parsed like the Office loads it. */
function realPack(relative: string): ZenWorkflow {
  const dir = NodePath.join(import.meta.dirname, "..", "workflows", "packs", relative);
  const read = (name: string) => {
    const file = NodePath.join(dir, name);
    return NodeFS.existsSync(file) ? NodeFS.readFileSync(file, "utf8") : null;
  };
  const parsed = parseWorkflowFolder(
    {
      folderName: NodePath.basename(dir),
      workflowJson: read("workflow.json"),
      prompt: read("prompt.md"),
      skill: read("SKILL.md"),
      packMarker: null,
    },
    "builtin",
  );
  if (parsed._tag !== "ok") throw new Error(parsed.problem.message);
  return parsed.workflow;
}

describe("intake engine: packs with files start in the chat, never in a form", () => {
  const packs = [
    { path: "social-reels-kit", id: "social-reels-kit" },
    { path: "poster-visual-brief", id: "poster-visual-brief" },
    { path: "promo-video-30s", id: "promo-video-30s" },
    { path: "finance-paperwork/invoices-to-spreadsheet", id: "invoices-to-spreadsheet" },
  ];
  it.each(packs)(
    "$id: asks for every input in the chat, files dropped there, brand defaults",
    async (pack) => {
      const real = realPack(pack.path);
      const { engine, tool, cwd } = setup([real]);
      const started = (await engine.call("workflow.start", {
        threadId: pack.id,
        workflowId: pack.id,
        companyId: "cafea",
        projectId: "p1",
        cwd,
        folderName: "Marketing",
        locale: "ro",
        appendix: "",
      })) as { message: string; suggestions: Record<string, { value: string }> };
      // Every input is on the agent's internal checklist, none is shown as a form.
      for (const input of real.manifest.inputs) {
        expect(started.message).toContain(`- ${input.id} (`);
      }
      expect(started.message).toContain("never show it as a list or a form");
      // Files: dropped into the chat, copied into "materiale", never typed as a path.
      expect(started.message).toContain("drop the files right here in the chat");
      expect(started.message).toContain('copy them into the folder "materiale"');
      expect(started.message).toContain("trage-le direct aici, în chat");
      // Company brand defaults are offered, not asked again.
      expect(started.message).toContain("Company: Cafea Bună");
      expect(started.message).toContain("Brand tone: friendly");
      // Agents without the intake tools (Codex) still get the task itself, no form needed.
      expect(started.message).toContain("Only if the intake_ready tool is not available");

      const values: Record<string, string> = {};
      for (const input of real.manifest.inputs) {
        if (!input.required) continue;
        values[input.id] =
          input.type === "file"
            ? NodePath.join(cwd, "materiale")
            : input.type === "select"
              ? (input.options?.[0] ?? "x")
              : `Răspuns ${input.id}`;
      }
      const result = await tool("intake_ready").run(pack.id, { values });
      expect(result).toContain("Run folder: ");
      expect(result).toContain("do the task now");
      const firstText = real.manifest.inputs.find(
        (input) => input.required && (input.type === "text" || input.type === "longtext"),
      );
      if (firstText) expect(result).toContain(`Răspuns ${firstText.id}`);
    },
  );

  it("takes answers the app already has (the onboarding hand-over) as known, never a file", async () => {
    const real = realPack("social-reels-kit");
    const { engine, cwd } = setup([real]);
    const started = (await engine.call("workflow.start", {
      threadId: "known",
      workflowId: "social-reels-kit",
      companyId: "cafea",
      cwd,
      locale: "ro",
      known: { business: "Cafea Bună, cafenea în Cluj", media: "/tmp/x", nope: "y" },
    })) as { message: string; suggestions: Record<string, { value: string }> };
    expect(started.suggestions.business?.value).toBe("Cafea Bună, cafenea în Cluj");
    expect(started.suggestions.media).toBeUndefined();
    expect(started.message).toContain('already known: "Cafea Bună, cafenea în Cluj"');
  });
});

describe("intake engine: hiring folders and company choice", () => {
  it("gives a hire its own folder under Zen Staff/<Company>/<Role>, never a chat folder", async () => {
    const { engine, root } = setup();
    const company = (await engine.call("hire.folder", {
      companyName: "Cafea Bună",
      role: "Social Media Manager",
    })) as { path: string };
    expect(company.path).toBe(
      NodePath.join(root, "Zen Staff", "Cafea Bună", "Social Media Manager"),
    );
    expect(NodeFS.statSync(company.path).isDirectory()).toBe(true);
    const personal = (await engine.call("hire.folder", {
      companyName: null,
      role: 'Contabil: "facturi"/lună',
    })) as { path: string };
    expect(personal.path).toBe(
      NodePath.join(root, "Zen Staff", "Personal", "Contabil facturi lună"),
    );
  });

  it("offers the companies in the chat when a company role is hired in Personal", async () => {
    const { engine, cwd } = setup();
    const start = (threadId: string, companyId: string, kind: string) =>
      engine.call("hire.start", {
        threadId,
        companyId,
        cwd,
        locale: "ro",
        agent: {
          id: `a-${threadId}`,
          name: "Maria",
          role: "Social Media Manager",
          templateId: "social-media-manager",
          kind,
        },
      }) as Promise<{ message: string }>;
    const personal = await start("p", "personal", "personal");
    expect(personal.message).toContain("This role usually works for a company");
    expect(personal.message).toContain("your name: you are called Maria");
    expect(personal.message).toContain("your limits");
    const view = (await engine.call("state", { threadId: "p" })) as IntakeThreadView;
    expect(view).toMatchObject({ companyChoice: true, templateId: "social-media-manager" });
    const inCompany = await start("c", "cafea", "company");
    expect(inCompany.message).not.toContain("This role usually works for a company");
    expect(
      ((await engine.call("state", { threadId: "c" })) as IntakeThreadView).companyChoice,
    ).toBe(false);
  });
});
