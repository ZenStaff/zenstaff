// Fixtures follow the public descriptions of each export format; the data in them is invented.
import { describe, expect, it } from "vite-plus/test";

import {
  detectExport,
  htmlToText,
  isoTime,
  parseChatGptConversations,
  parseClaudeConversations,
  parseClaudeExport,
  parseGeminiActivity,
  pickExportEntry,
  pickMemoriesEntry,
  pickProjectEntries,
  projectNameMatches,
  toImportedConversation,
} from "./exportParsers";
import chatgptFixture from "./fixtures/chatgpt-conversations.json?raw";
import claudeFixture from "./fixtures/claude-conversations.json?raw";
import geminiHtmlFixture from "./fixtures/gemini-MyActivity.html?raw";
import geminiJsonFixture from "./fixtures/gemini-MyActivity.json?raw";

const FIXTURES: Record<string, string> = {
  "chatgpt-conversations.json": chatgptFixture,
  "claude-conversations.json": claudeFixture,
  "gemini-MyActivity.html": geminiHtmlFixture,
  "gemini-MyActivity.json": geminiJsonFixture,
};
const fixture = (name: string) => FIXTURES[name]!;

describe("ChatGPT conversations.json", () => {
  const conversations = parseChatGptConversations(
    JSON.parse(fixture("chatgpt-conversations.json")),
  );

  it("follows the visible branch, keeps tool calls and skips hidden and reasoning nodes", () => {
    expect(conversations).toHaveLength(2);
    const [plan] = conversations;
    expect(plan).toMatchObject({
      externalId: "6f1c0000-0000-4000-8000-000000000001",
      title: "Plan de marketing pentru brutărie",
      model: "gpt-4o",
      createdAt: "2024-03-01T10:00:00.120Z",
    });
    expect(plan!.messages.map((message) => [message.role, message.toolName ?? null])).toEqual([
      ["user", null],
      ["tool", "python"],
      ["tool", "python"],
      ["assistant", null],
      ["user", null],
    ]);
    expect(plan!.messages.map((message) => message.text).join("|")).not.toContain("respinsă");
    expect(plan!.messages.at(-1)?.text).toBe("[image]\nCe zici de afișul ăsta?");
  });

  it("reads old exports without current_node from the newest leaf", () => {
    expect(conversations[1]).toMatchObject({ externalId: "legacy-0002" });
    expect(conversations[1]!.messages.map((message) => message.text)).toEqual([
      "Translate 'good morning' to Romanian",
      "Bună dimineața",
    ]);
  });

  it("accepts the {conversations: [...]} wrapper and ignores anything else", () => {
    expect(parseChatGptConversations({ conversations: [] })).toEqual([]);
    expect(parseChatGptConversations("nope")).toEqual([]);
    expect(
      parseChatGptConversations([{ mapping: { a: { message: null, parent: "a" } } }]),
    ).toHaveLength(1);
  });
});

describe("Claude.ai conversations.json", () => {
  const conversations = parseClaudeConversations(JSON.parse(fixture("claude-conversations.json")));

  it("reads content blocks: text, artifacts as tool rows, attachments by name, no thinking", () => {
    const [offer] = conversations;
    expect(offer!.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "assistant",
    ]);
    expect(offer!.messages[0]!.text).toContain("[attachment: meniu-demo.pdf]");
    expect(offer!.messages[2]).toMatchObject({ toolName: "artifacts" });
    expect(offer!.messages[2]!.text).toContain("Ofertă catering");
    expect(offer!.messages.map((message) => message.text).join("|")).not.toContain(
      "private reasoning",
    );
  });

  it("reads the older text-only shape and titles an unnamed chat from its first prompt", () => {
    expect(conversations[1]).toMatchObject({ title: "What is a CUI in Romania?" });
    expect(conversations[1]!.messages).toHaveLength(2);
    expect(conversations[2]!.messages).toEqual([]);
  });
});

describe("Gemini (Google Takeout My Activity)", () => {
  it("groups prompts close in time into conversations and strips 'Prompted'", () => {
    const conversations = parseGeminiActivity(JSON.parse(fixture("gemini-MyActivity.json")));
    expect(conversations.map((conversation) => conversation.messages.length)).toEqual([4, 2]);
    expect(conversations[0]).toMatchObject({
      externalId: "gemini:2024-05-10T09:00:00.000Z",
      title: "Ce postez mâine pe Facebook pentru cafenea?",
    });
    expect(conversations[0]!.messages[1]!.text).toBe(
      "Trei idei:\n\n- Cafeaua zilei\n- Echipa\nSpor & succes!",
    );
  });

  it("reads the HTML variant", () => {
    const conversations = parseGeminiActivity(fixture("gemini-MyActivity.html"));
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.messages.map((message) => message.text)).toEqual([
      "Cum calculez TVA la 19%?",
      "Înmulțești prețul fără TVA cu 0,19.",
      "Și la 9%?",
      "Cu 0,09.",
    ]);
    expect(conversations[0]!.createdAt).toBe("2024-05-10T09:00:00.000Z");
  });
});

describe("detection", () => {
  it("tells the formats apart by shape and finds the file inside an export zip", () => {
    expect(detectExport("conversations.json", fixture("chatgpt-conversations.json"))?.source).toBe(
      "chatgpt",
    );
    expect(detectExport("conversations.json", fixture("claude-conversations.json"))?.source).toBe(
      "claude",
    );
    expect(detectExport("MyActivity.json", fixture("gemini-MyActivity.json"))?.source).toBe(
      "gemini",
    );
    expect(detectExport("MyActivity.html", fixture("gemini-MyActivity.html"))?.source).toBe(
      "gemini",
    );
    expect(detectExport("x.json", "{not json")).toBeNull();
    expect(detectExport("x.json", "[1,2]")).toBeNull();
    expect(
      pickExportEntry([
        "__MACOSX/conversations.json",
        "chat.html",
        "user.json",
        "conversations.json",
      ]),
    ).toBe("conversations.json");
    expect(pickExportEntry(["Takeout/My Activity/Gemini Apps/MyActivity.html"])).toBe(
      "Takeout/My Activity/Gemini Apps/MyActivity.html",
    );
    expect(pickExportEntry(["Takeout/Drive/a.json"])).toBeNull();
  });

  it("normalizes times and HTML", () => {
    expect(isoTime(1709287200)).toBe("2024-03-01T10:00:00.000Z");
    expect(isoTime(1709287200000)).toBe("2024-03-01T10:00:00.000Z");
    expect(isoTime("garbage")).toBeNull();
    expect(htmlToText("<p>a&nbsp;b</p><script>x</script><p>&#x219;&#537;</p>")).toBe("a b\nșș");
  });
});

// ─── Organization: projects, memory, starred (shapes from the export descriptions) ───

const claudeChat = (uuid: string, name: string, extra: Record<string, unknown> = {}) => ({
  uuid,
  name,
  summary: "",
  created_at: "2025-01-10T09:00:00Z",
  updated_at: "2025-01-10T09:05:00Z",
  chat_messages: [
    { sender: "human", text: `Despre ${name}`, created_at: "2025-01-10T09:00:00Z" },
    { sender: "assistant", text: "Sigur.", created_at: "2025-01-10T09:01:00Z" },
  ],
  ...extra,
});

const claudeProjects = [
  {
    uuid: "proj-oferte",
    name: "Oferte Brutăria",
    description: "Ofertele pentru clienți B2B",
    prompt_template: "Scrie oferte scurte, în română.",
    is_private: true,
    created_at: "2024-12-01T10:00:00Z",
    updated_at: "2025-01-01T10:00:00Z",
    docs: [
      { filename: "preturi.md", content: "pâine 5 lei", created_at: "2024-12-01T10:00:00Z" },
      { filename: "", content: "" },
      { filename: "gol.txt", content: "" },
    ],
  },
  {
    uuid: "proj-site",
    title: "Site restaurant",
    description: "",
    prompt_template: "",
    docs: [],
  },
  {
    uuid: "proj-marketing",
    name: "Marketing restaurant",
    prompt_template: "Ton cald.",
    docs: [{ filename: "brand.md", content: "x".repeat(2_100_000) }],
  },
];

const claudeMemories = [
  {
    conversations_memory: "Alex conduce o brutărie în Reghin.",
    project_memories: { "proj-oferte": "Clientul principal e Hotel Central." },
    account_uuid: "acc-1",
  },
];

const claudeConversations = [
  claudeChat("c-1", "Ofertă pentru Hotel Central (brutăria)", { is_starred: true }),
  claudeChat("c-2", "Meniu nou pentru site"),
  // "restaurant" is in two project names: ambiguous, so no suggestion.
  claudeChat("c-3", "Idei restaurant"),
  claudeChat("c-4", "Rețetă de cozonac"),
];

describe("Claude.ai projects and memory", () => {
  const layouts: Array<[string, Array<string>]> = [
    ["a single projects.json", [JSON.stringify(claudeProjects)]],
    [
      "a projects/ folder with one file each",
      claudeProjects.map((project) => JSON.stringify(project)),
    ],
  ];

  it.each(layouts)(
    "reads %s: instructions, files, project memory and global memory",
    (_layout, projectTexts) => {
      const parsed = parseClaudeExport(claudeConversations, {
        projectTexts,
        memoriesText: JSON.stringify(claudeMemories),
      });
      expect(parsed.projects.map((project) => project.name)).toEqual([
        "Oferte Brutăria",
        "Site restaurant",
        "Marketing restaurant",
      ]);
      const [oferte, site, marketing] = parsed.projects;
      expect(oferte).toMatchObject({
        externalId: "proj-oferte",
        description: "Ofertele pentru clienți B2B",
        instructions: "Scrie oferte scurte, în română.",
        memory: "Clientul principal e Hotel Central.",
        files: [{ name: "preturi.md", content: "pâine 5 lei" }],
      });
      expect(site).toMatchObject({ externalId: "proj-site", files: [], memory: null });
      expect(marketing!.files).toEqual([]);
      expect(parsed.skippedFiles).toEqual([
        { project: "Marketing restaurant", name: "brand.md", reason: "too-large" },
      ]);
      expect(parsed.globalMemory).toBe("Alex conduce o brutărie în Reghin.");
    },
  );

  it("suggests a project only when exactly one project's name matches the title", () => {
    const parsed = parseClaudeExport(claudeConversations, {
      projectTexts: [JSON.stringify(claudeProjects)],
    });
    const byId = Object.fromEntries(
      parsed.conversations.map((conversation) => [conversation.externalId, conversation]),
    );
    expect(byId["c-1"]).toMatchObject({
      projectExternalId: "proj-oferte",
      projectSuggested: true,
      starred: true,
    });
    expect(byId["c-2"]).toMatchObject({ projectExternalId: "proj-site", projectSuggested: true });
    expect(byId["c-3"]).toMatchObject({ projectExternalId: null, projectSuggested: false });
    expect(byId["c-4"]).toMatchObject({ projectExternalId: null, starred: false });
    expect(parsed.globalMemory).toBeNull();
  });

  it("matches whole names and significant words, not generic ones", () => {
    expect(projectNameMatches("Oferte Brutăria", "oferte brutaria ianuarie")).toBe(true);
    expect(projectNameMatches("Oferte Brutăria", "Brutăria")).toBe(true);
    expect(projectNameMatches("Claude project", "Ce poate claude?")).toBe(false);
    expect(projectNameMatches("Ana", "Banana")).toBe(false);
    expect(projectNameMatches("Ana", "Ana are mere")).toBe(true);
  });

  it("works without projects or memories, and survives broken files", () => {
    const parsed = parseClaudeExport(claudeConversations, {
      projectTexts: ["{not json", JSON.stringify({ unrelated: true })],
      memoriesText: "[]",
    });
    expect(parsed.projects).toEqual([]);
    expect(
      parsed.conversations.every((conversation) => conversation.projectExternalId === null),
    ).toBe(true);
  });

  it("finds the project and memory files in the zip", () => {
    expect(
      pickProjectEntries([
        "conversations.json",
        "projects.json",
        "projects/abc.json",
        "__MACOSX/projects/._abc.json",
        "users.json",
      ]),
    ).toEqual(["projects.json", "projects/abc.json"]);
    expect(pickMemoriesEntry(["conversations.json", "export/memories.json"])).toBe(
      "export/memories.json",
    );
    expect(pickMemoriesEntry(["conversations.json"])).toBeNull();
  });
});

const chatgptChat = (id: string, update: number, extra: Record<string, unknown> = {}) => ({
  id,
  conversation_id: id,
  title: `Chat ${id}`,
  create_time: update - 100,
  update_time: update,
  current_node: "n2",
  mapping: {
    n1: {
      id: "n1",
      parent: null,
      children: ["n2"],
      message: {
        author: { role: "user" },
        content: { content_type: "text", parts: ["Salut"] },
        create_time: update - 100,
      },
    },
    n2: {
      id: "n2",
      parent: "n1",
      children: [],
      message: {
        author: { role: "assistant" },
        content: { content_type: "text", parts: ["Bună"] },
        create_time: update - 50,
        recipient: "all",
      },
    },
  },
  ...extra,
});

describe("ChatGPT projects (gizmo ids)", () => {
  const raw = [
    chatgptChat("a", 1_700_000_000, { gizmo_id: "g-p-older", gizmo_type: "snorlax" }),
    chatgptChat("b", 1_700_500_000, { gizmo_id: "g-p-newer", is_starred: true }),
    chatgptChat("c", 1_700_100_000, { gizmo_id: "g-p-older", is_archived: true }),
    chatgptChat("d", 1_700_200_000, { gizmo_id: "g-abc123", gizmo_type: "gpt" }),
    chatgptChat("e", 1_700_300_000, { conversation_template_id: "g-p-newer" }),
    chatgptChat("f", 1_700_300_000),
  ];

  it("groups by g-p- ids, numbers projects by their latest chat, keeps custom GPT ids apart", () => {
    const parsed = detectExport("conversations.json", JSON.stringify(raw), {
      chatgptProjectName: (index) => `Proiect ChatGPT ${index}`,
    })!;
    expect(parsed.source).toBe("chatgpt");
    expect(
      parsed.projects.map((project) => [project.externalId, project.name, project.instructions]),
    ).toEqual([
      ["g-p-newer", "Proiect ChatGPT 1", ""],
      ["g-p-older", "Proiect ChatGPT 2", ""],
    ]);
    const byId = Object.fromEntries(
      parsed.conversations.map((conversation) => [conversation.externalId, conversation]),
    );
    expect(byId.a).toMatchObject({ projectExternalId: "g-p-older", starred: false });
    expect(byId.b).toMatchObject({ projectExternalId: "g-p-newer", starred: true });
    expect(byId.c).toMatchObject({ projectExternalId: "g-p-older", archived: true });
    expect(byId.d).toMatchObject({ projectExternalId: null, gptId: "g-abc123" });
    expect(byId.e).toMatchObject({ projectExternalId: "g-p-newer", projectSuggested: false });
    expect(byId.f).toMatchObject({ projectExternalId: null, gptId: null });
    expect(parsed.globalMemory).toBeNull();
  });

  it("sends only the conversation and its star to the server", () => {
    const [chat] = parseChatGptConversations([raw[1]]);
    const wire = toImportedConversation(chat!);
    expect(wire.starred).toBe(true);
    expect(Object.keys(wire).toSorted()).toEqual([
      "createdAt",
      "externalId",
      "messages",
      "model",
      "starred",
      "title",
      "updatedAt",
    ]);
    const [plain] = parseChatGptConversations([raw[5]]);
    expect("starred" in toImportedConversation(plain!)).toBe(false);
  });
});
