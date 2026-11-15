// Zen Staff chat imports: readers for the ChatGPT, Claude.ai and Gemini (Google Takeout) exports,
// run in the browser so the export never travels whole to the server. Every field is optional and
// unknown shapes are skipped. ChatGPT / Claude.ai projects, memory and stars: see "Projects".
import {
  ZEN_IMPORT_LIMITS,
  type ZenImportSource,
  type ZenImportedConversation,
  type ZenImportedMessage,
} from "@t3tools/contracts/zenImports";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Seconds (ChatGPT), milliseconds or ISO strings, as ISO; anything else is null. */
export function isoTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

const cut = (text: string) =>
  text.length > ZEN_IMPORT_LIMITS.charsPerMessage
    ? `${text.slice(0, ZEN_IMPORT_LIMITS.charsPerMessage)}…`
    : text;

function finish(conversation: {
  externalId: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  messages: Array<ZenImportedMessage>;
}): ZenImportedConversation {
  const messages = conversation.messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => ({ ...message, text: cut(message.text) }))
    .slice(-ZEN_IMPORT_LIMITS.messagesPerConversation);
  const firstUser = messages.find((message) => message.role === "user")?.text ?? "";
  const title =
    conversation.title.trim() !== ""
      ? conversation.title.trim()
      : firstUser.replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    externalId: conversation.externalId.slice(0, 300),
    title: title.slice(0, 500),
    createdAt: conversation.createdAt ?? messages[0]?.createdAt ?? null,
    updatedAt: conversation.updatedAt ?? messages.at(-1)?.createdAt ?? null,
    model: conversation.model?.slice(0, 200) ?? null,
    messages,
  };
}

/** A conversation plus how it was organized in the source app (web side only). */
export interface ParsedConversation extends ZenImportedConversation {
  /** The source project it belongs to, or the one suggested for it (`projectSuggested`). */
  readonly projectExternalId: string | null;
  /** True when `projectExternalId` is a guess from the title (Claude.ai), not from the export. */
  readonly projectSuggested: boolean;
  readonly starred: boolean;
  readonly archived: boolean;
  /** A custom GPT the chat was held with (ChatGPT `g-...` ids that are not projects). */
  readonly gptId: string | null;
}

export interface ParsedProjectFile {
  readonly name: string;
  readonly content: string;
}

export interface ParsedProject {
  readonly externalId: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly files: ReadonlyArray<ParsedProjectFile>;
  readonly memory: string | null;
}

export interface SkippedProjectFile {
  readonly project: string;
  readonly name: string;
  readonly reason: "too-large" | "total-too-large" | "too-many";
}

const plain = (
  conversation: ZenImportedConversation,
  meta: {
    readonly projectExternalId?: string | null;
    readonly projectSuggested?: boolean;
    readonly starred?: boolean;
    readonly archived?: boolean;
    readonly gptId?: string | null;
  } = {},
): ParsedConversation => ({
  ...conversation,
  projectExternalId: meta.projectExternalId ?? null,
  projectSuggested: meta.projectSuggested ?? false,
  starred: meta.starred ?? false,
  archived: meta.archived ?? false,
  gptId: meta.gptId ?? null,
});

/** What the server receives: the conversation without the web-only organization fields. */
export function toImportedConversation(conversation: ParsedConversation): ZenImportedConversation {
  return {
    externalId: conversation.externalId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    model: conversation.model,
    messages: conversation.messages,
    ...(conversation.starred ? { starred: true } : {}),
  };
}

// ─── ChatGPT ────────────────────────────────────────────────────────────────

function chatgptText(content: Json): string {
  const type = str(content.content_type);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const fromParts = parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      const partType = str(part.content_type) ?? "";
      if (partType.includes("image")) return "[image]";
      if (partType.includes("audio")) return "[audio]";
      return "";
    })
    .filter((part) => part.length > 0)
    .join("\n");
  switch (type) {
    case "text":
    case "multimodal_text":
      return fromParts;
    case "code":
      return str(content.text) ?? fromParts;
    case "execution_output":
      return str(content.text) ?? fromParts;
    case "tether_browsing_display":
      return [str(content.summary), str(content.result)].filter(Boolean).join("\n");
    case "tether_quote":
      return [str(content.title), str(content.url), str(content.text)].filter(Boolean).join("\n");
    case "system_error":
      return [str(content.name), str(content.text)].filter(Boolean).join(": ");
    case "thoughts":
    case "reasoning_recap":
    case "user_editable_context":
    case "model_editable_context":
      // Hidden reasoning and custom-instruction blocks are not part of the conversation.
      return "";
    default:
      return fromParts || (str(content.text) ?? "");
  }
}

/** The visible branch: from `current_node` up through `parent`, oldest first. */
function chatgptBranch(mapping: Json, currentNode: string | null): Array<Json> {
  let leaf = currentNode !== null && isRecord(mapping[currentNode]) ? currentNode : null;
  if (leaf === null) {
    // Older exports lack current_node: take the newest message that has no children.
    let newest = -Infinity;
    for (const [id, node] of Object.entries(mapping)) {
      if (!isRecord(node)) continue;
      const children = Array.isArray(node.children) ? node.children : [];
      const time = isRecord(node.message) ? Number(node.message.create_time ?? 0) : 0;
      if (children.length === 0 && time >= newest) {
        newest = time;
        leaf = id;
      }
    }
  }
  const branch: Array<Json> = [];
  const seen = new Set<string>();
  for (let id = leaf; id !== null && !seen.has(id);) {
    seen.add(id);
    const node = mapping[id];
    if (!isRecord(node)) break;
    branch.push(node);
    id = str(node.parent);
  }
  return branch.reverse();
}

/** ChatGPT projects are gizmos whose id starts with `g-p-`; other `g-` ids are custom GPTs. */
const CHATGPT_PROJECT_PREFIX = "g-p-";

function chatgptGizmo(entry: Json): { project: string | null; gpt: string | null } {
  const ids = [str(entry.gizmo_id), str(entry.conversation_template_id)].filter(
    (id): id is string => id !== null && id.startsWith("g-"),
  );
  const project = ids.find((id) => id.startsWith(CHATGPT_PROJECT_PREFIX)) ?? null;
  const gpt = project === null ? (ids[0] ?? null) : null;
  return { project, gpt };
}

export function parseChatGptConversations(raw: unknown): Array<ParsedConversation> {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.conversations)
      ? raw.conversations
      : [];
  const result: Array<ParsedConversation> = [];
  list.forEach((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.mapping)) return;
    const messages: Array<ZenImportedMessage> = [];
    let model = str(entry.default_model_slug);
    for (const node of chatgptBranch(entry.mapping, str(entry.current_node))) {
      const message = node.message;
      if (!isRecord(message) || !isRecord(message.content)) continue;
      const metadata = isRecord(message.metadata) ? message.metadata : {};
      if (metadata.is_visually_hidden_from_conversation === true) continue;
      const author = isRecord(message.author) ? message.author : {};
      const role = str(author.role);
      const text = chatgptText(message.content);
      if (text.trim() === "") continue;
      const createdAt = isoTime(message.create_time);
      const recipient = str(message.recipient) ?? "all";
      if (role === "user") {
        messages.push({ role: "user", text, createdAt });
      } else if (role === "assistant") {
        model = str(metadata.model_slug) ?? model;
        // An assistant message addressed to a tool (python, browser, dalle...) is a tool call.
        if (recipient !== "all")
          messages.push({ role: "tool", text, createdAt, toolName: recipient });
        else messages.push({ role: "assistant", text, createdAt });
      } else if (role === "tool") {
        messages.push({ role: "tool", text, createdAt, toolName: str(author.name) ?? "tool" });
      }
    }
    const id =
      str(entry.conversation_id) ??
      str(entry.id) ??
      `chatgpt-${index}-${String(entry.create_time ?? "")}`;
    const gizmo = chatgptGizmo(entry);
    result.push(
      plain(
        finish({
          externalId: id,
          title: str(entry.title) ?? "",
          createdAt: isoTime(entry.create_time),
          updatedAt: isoTime(entry.update_time),
          model,
          messages,
        }),
        {
          projectExternalId: gizmo.project,
          gptId: gizmo.gpt,
          starred: entry.is_starred === true,
          archived: entry.is_archived === true,
        },
      ),
    );
  });
  return result;
}

// ─── Claude.ai ──────────────────────────────────────────────────────────────

function claudeBlockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(claudeBlockText).filter(Boolean).join("\n");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (value.content !== undefined) return claudeBlockText(value.content);
  return "";
}

function claudeToolInput(input: unknown): string {
  if (!isRecord(input)) return typeof input === "string" ? input : "";
  // Artifacts carry their title and full content; other tools their query or code.
  const parts = [
    str(input.title),
    str(input.query),
    str(input.code),
    str(input.content),
    str(input.command),
  ];
  const text = parts
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join("\n");
  return text !== "" ? text : JSON.stringify(input);
}

export function parseClaudeConversations(raw: unknown): Array<ParsedConversation> {
  const list = Array.isArray(raw) ? raw : [];
  const result: Array<ParsedConversation> = [];
  list.forEach((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.chat_messages)) return;
    const messages: Array<ZenImportedMessage> = [];
    for (const chat of entry.chat_messages) {
      if (!isRecord(chat)) continue;
      const sender = str(chat.sender);
      const role = sender === "human" ? "user" : sender === "assistant" ? "assistant" : null;
      if (role === null) continue;
      const createdAt = isoTime(chat.created_at);
      const attachments = [
        ...(Array.isArray(chat.attachments) ? chat.attachments : []),
        ...(Array.isArray(chat.files) ? chat.files : []),
      ]
        .map((file) => (isRecord(file) ? str(file.file_name) : null))
        .filter((name): name is string => name !== null && name.trim() !== "")
        .map((name) => `[attachment: ${name}]`);
      if (Array.isArray(chat.content) && chat.content.length > 0) {
        const texts: Array<string> = [];
        const flush = () => {
          const text = [...texts].join("\n");
          texts.length = 0;
          if (text.trim() !== "") messages.push({ role, text, createdAt });
        };
        for (const block of chat.content) {
          if (!isRecord(block)) continue;
          if (block.type === "text") texts.push(str(block.text) ?? "");
          else if (block.type === "tool_use") {
            flush();
            messages.push({
              role: "tool",
              text: claudeToolInput(block.input),
              createdAt,
              toolName: str(block.name) ?? "tool",
            });
          } else if (block.type === "tool_result") {
            flush();
            messages.push({
              role: "tool",
              text: claudeBlockText(block.content),
              createdAt,
              toolName: str(block.name) ?? "tool result",
            });
          }
          // `thinking` blocks are the model's private reasoning: not imported.
        }
        texts.push(...attachments);
        flush();
      } else {
        const text = [str(chat.text) ?? "", ...attachments]
          .filter((part) => part !== "")
          .join("\n");
        if (text.trim() !== "") messages.push({ role, text, createdAt });
      }
    }
    result.push(
      plain(
        finish({
          externalId: str(entry.uuid) ?? `claude-${index}-${String(entry.created_at ?? "")}`,
          title: str(entry.name) ?? "",
          createdAt: isoTime(entry.created_at),
          updatedAt: isoTime(entry.updated_at),
          model: str(entry.model),
          messages,
        }),
        // The export does not link conversations to projects (see suggestClaudeProjects).
        { starred: entry.is_starred === true, archived: entry.is_archived === true },
      ),
    );
  });
  return result;
}

// ─── Gemini (Google Takeout, My Activity) ───────────────────────────────────

/** Records further apart than this start a new conversation (Takeout has no conversation ids). */
const GEMINI_GAP_MS = 30 * 60_000;

// "Prompted" in the languages Takeout writes it in; anything else keeps the whole title.
const GEMINI_PROMPT_PREFIX =
  /^(?:Prompted|Asked|Ai întrebat|A întrebat|Ai solicitat|Prompt trimis:|Gefragt|Demandé|Preguntado|Chiesto)\s*:?\s+/i;

interface GeminiRecord {
  readonly time: string;
  readonly prompt: string;
  readonly answer: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** HTML to plain text with paragraphs and list items on their own lines (no DOM needed). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (match, name: string) => {
      if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      if (name.startsWith("#") && name !== "#39")
        return String.fromCodePoint(Number(name.slice(1)));
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function geminiRecordsFromJson(raw: unknown): Array<GeminiRecord> {
  const list = Array.isArray(raw) ? raw : [];
  const records: Array<GeminiRecord> = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const products = Array.isArray(entry.products) ? entry.products.map(String) : [];
    const header = str(entry.header) ?? "";
    if (!/gemini|bard/i.test([header, ...products].join(" "))) continue;
    const time = isoTime(entry.time);
    const title = str(entry.title) ?? "";
    if (time === null || title.trim() === "") continue;
    const answer = (Array.isArray(entry.safeHtmlItem) ? entry.safeHtmlItem : [])
      .map((item) => (isRecord(item) ? htmlToText(str(item.html) ?? "") : ""))
      .filter(Boolean)
      .join("\n\n");
    records.push({ time, prompt: title.replace(GEMINI_PROMPT_PREFIX, "").trim(), answer });
  }
  return records;
}

/** "May 10, 2024, 9:00:00 AM UTC"; an unknown zone name is read as UTC rather than dropped. */
function takeoutTime(line: string): string | null {
  if (!/\d{4}/.test(line) || !/\d{1,2}:\d{2}/.test(line)) return null;
  const direct = Date.parse(line);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  const withoutZone = Date.parse(`${line.replace(/\s[A-Z]{2,5}$/, "")} UTC`);
  return Number.isNaN(withoutZone) ? null : new Date(withoutZone).toISOString();
}

/** The HTML variant (Takeout's default): one `outer-cell` per record. */
function geminiRecordsFromHtml(html: string): Array<GeminiRecord> {
  const records: Array<GeminiRecord> = [];
  const cells = html.split(/<div[^>]*class="[^"]*outer-cell[^"]*"[^>]*>/i).slice(1);
  for (const cell of cells) {
    const content = /<div[^>]*class="[^"]*content-cell[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      cell,
    )?.[1];
    if (content === undefined) continue;
    const lines = htmlToText(content)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // Text cell: "Prompted <prompt>", then the date line, then the answer.
    const dateIndex = lines.findIndex((line, index) => index > 0 && takeoutTime(line) !== null);
    if (dateIndex < 1) continue;
    const time = takeoutTime(lines[dateIndex]!);
    if (time === null) continue;
    records.push({
      time,
      prompt: lines.slice(0, dateIndex).join("\n").replace(GEMINI_PROMPT_PREFIX, "").trim(),
      answer: lines.slice(dateIndex + 1).join("\n"),
    });
  }
  return records;
}

export function parseGeminiActivity(raw: unknown): Array<ParsedConversation> {
  const records = (
    typeof raw === "string" ? geminiRecordsFromHtml(raw) : geminiRecordsFromJson(raw)
  )
    .filter((record) => record.prompt !== "")
    .sort((left, right) => left.time.localeCompare(right.time));
  const groups: Array<Array<GeminiRecord>> = [];
  for (const record of records) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (
      group !== undefined &&
      last !== undefined &&
      Date.parse(record.time) - Date.parse(last.time) <= GEMINI_GAP_MS
    ) {
      group.push(record);
    } else {
      groups.push([record]);
    }
  }
  return groups.map((group) =>
    plain(
      finish({
        externalId: `gemini:${group[0]!.time}`,
        title: "",
        createdAt: group[0]!.time,
        updatedAt: group.at(-1)!.time,
        model: null,
        messages: group.flatMap((record) => [
          { role: "user" as const, text: record.prompt, createdAt: record.time },
          ...(record.answer === ""
            ? []
            : [{ role: "assistant" as const, text: record.answer, createdAt: record.time }]),
        ]),
      }),
    ),
  );
}

// ─── Projects ───────────────────────────────────────────────────────────────

/** Default name of the n-th ChatGPT project (the export has no project names). */
export type ChatGptProjectName = (index: number) => string;
const defaultChatGptProjectName: ChatGptProjectName = (index) => `ChatGPT project ${index}`;

/**
 * ChatGPT: conversations held in a project carry its `g-p-` gizmo id; names, instructions and
 * files are not in the export. Projects are numbered by their most recent conversation.
 */
function chatgptProjects(
  conversations: ReadonlyArray<ParsedConversation>,
  name: ChatGptProjectName = defaultChatGptProjectName,
): Array<ParsedProject> {
  const latest = new Map<string, string>();
  for (const conversation of conversations) {
    const id = conversation.projectExternalId;
    if (id === null) continue;
    const time = conversation.updatedAt ?? conversation.createdAt ?? "";
    if (!latest.has(id) || time > latest.get(id)!) latest.set(id, time);
  }
  return [...latest.entries()]
    .toSorted((left, right) => right[1].localeCompare(left[1]) || left[0].localeCompare(right[0]))
    .map(([externalId], index) => ({
      externalId,
      name: name(index + 1),
      description: "",
      instructions: "",
      files: [],
      memory: null,
    }));
}

const cutTo = (text: string, limit: number) => (text.length > limit ? text.slice(0, limit) : text);

/**
 * Claude.ai projects: `projects.json` (an array) or `projects/<uuid>.json` (one each), with
 * `uuid`, `name` (or `title`), `description`, `prompt_template` (the instructions) and `docs`
 * (`filename`, `content`). Knowledge files are capped per file and per project.
 */
function parseClaudeProjects(raws: ReadonlyArray<unknown>): {
  readonly projects: Array<ParsedProject>;
  readonly skipped: Array<SkippedProjectFile>;
} {
  const projects: Array<ParsedProject> = [];
  const skipped: Array<SkippedProjectFile> = [];
  const seen = new Set<string>();
  const entries = raws.flatMap((raw) =>
    Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.projects) ? raw.projects : [raw],
  );
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const externalId = (str(entry.uuid) ?? str(entry.id) ?? `claude-project-${index}`).slice(
      0,
      300,
    );
    if (seen.has(externalId)) return;
    const name = (str(entry.name) ?? str(entry.title) ?? "").replace(/\s+/g, " ").trim();
    const instructions = str(entry.prompt_template) ?? str(entry.instructions) ?? "";
    const docs = Array.isArray(entry.docs) ? entry.docs : [];
    if (name === "" && instructions.trim() === "" && docs.length === 0) return;
    seen.add(externalId);
    const projectName = cutTo(name === "" ? `Claude project ${projects.length + 1}` : name, 200);
    const files: Array<ParsedProjectFile> = [];
    let total = 0;
    for (const doc of docs) {
      if (!isRecord(doc)) continue;
      const fileName = (str(doc.filename) ?? str(doc.file_name) ?? "").trim();
      const content = str(doc.content) ?? "";
      if (fileName === "" && content.trim() === "") continue;
      const label = fileName === "" ? `document-${files.length + 1}.txt` : fileName;
      if (files.length >= ZEN_IMPORT_LIMITS.filesPerProject) {
        skipped.push({ project: projectName, name: label, reason: "too-many" });
      } else if (content.length > ZEN_IMPORT_LIMITS.charsPerProjectFile) {
        skipped.push({ project: projectName, name: label, reason: "too-large" });
      } else if (total + content.length > ZEN_IMPORT_LIMITS.charsPerProjectFiles) {
        skipped.push({ project: projectName, name: label, reason: "total-too-large" });
      } else if (content.trim() !== "") {
        total += content.length;
        files.push({ name: cutTo(label, 500), content });
      }
    }
    projects.push({
      externalId,
      name: projectName,
      description: cutTo(str(entry.description) ?? "", 20_000),
      instructions: cutTo(instructions, ZEN_IMPORT_LIMITS.charsPerInstructions),
      files,
      memory: null,
    });
  });
  return { projects, skipped };
}

/**
 * Claude.ai `memories.json`: an array with one object holding `conversations_memory` (what
 * Claude remembers across chats) and `project_memories` (project uuid -> memory text).
 */
function parseClaudeMemories(raw: unknown): {
  readonly global: string | null;
  readonly projects: ReadonlyMap<string, string>;
} {
  const entries = Array.isArray(raw) ? raw : [raw];
  let global: string | null = null;
  const projects = new Map<string, string>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const memory = str(entry.conversations_memory);
    if (memory !== null && memory.trim() !== "") {
      global = cutTo(global === null ? memory : `${global}\n\n${memory}`, 200_000);
    }
    if (isRecord(entry.project_memories)) {
      for (const [id, value] of Object.entries(entry.project_memories)) {
        const text = typeof value === "string" ? value : isRecord(value) ? str(value.memory) : null;
        if (text !== null && text.trim() !== "")
          projects.set(id, cutTo(text, ZEN_IMPORT_LIMITS.charsPerMemory));
      }
    }
  }
  return { global, projects };
}

/** Words too common to tie a chat to a project by itself. */
const GENERIC_WORDS = new Set([
  "about",
  "altele",
  "ajutor",
  "chat",
  "chats",
  "chatgpt",
  "claude",
  "code",
  "despre",
  "diverse",
  "document",
  "documente",
  "documents",
  "demo",
  "example",
  "exemplu",
  "from",
  "general",
  "help",
  "idei",
  "ideas",
  "lucru",
  "misc",
  "nota",
  "note",
  "notes",
  "notite",
  "other",
  "pentru",
  "personal",
  "project",
  "projects",
  "proiect",
  "proiecte",
  "proiectul",
  "sample",
  "starter",
  "stuff",
  "test",
  "teste",
  "testing",
  "that",
  "this",
  "untitled",
  "with",
  "work",
  "writing",
  "your",
]);

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Does the project's name, or one of its significant words, appear in the chat's title? */
export function projectNameMatches(projectName: string, title: string): boolean {
  const nameWords = words(projectName);
  const titleWords = words(title);
  // The whole name, word for word (so "Ana" does not match "Banana").
  const name = nameWords.join(" ");
  if (name.length >= 3 && ` ${titleWords.join(" ")} `.includes(` ${name} `)) return true;
  const titleSet = new Set(titleWords);
  return nameWords.some(
    (word) => word.length >= 4 && !GENERIC_WORDS.has(word) && titleSet.has(word),
  );
}

/**
 * Claude.ai conversations carry no project link: suggest one only when exactly one project's
 * name matches the conversation's title. Ambiguous or no match: no suggestion.
 */
function suggestClaudeProjects(
  conversations: ReadonlyArray<ParsedConversation>,
  projects: ReadonlyArray<ParsedProject>,
): Array<ParsedConversation> {
  return conversations.map((conversation) => {
    if (conversation.projectExternalId !== null) return conversation;
    const matches = projects.filter((project) =>
      projectNameMatches(project.name, conversation.title),
    );
    return matches.length === 1
      ? { ...conversation, projectExternalId: matches[0]!.externalId, projectSuggested: true }
      : conversation;
  });
}

// ─── Detection ──────────────────────────────────────────────────────────────

export interface ParsedExport {
  readonly source: ZenImportSource;
  readonly conversations: ReadonlyArray<ParsedConversation>;
  /** Projects found in the export (ChatGPT: from the conversations; Claude.ai: projects files). */
  readonly projects: ReadonlyArray<ParsedProject>;
  /** What the app remembered across chats (Claude.ai `conversations_memory`). */
  readonly globalMemory: string | null;
  /** Knowledge files left out because of the size caps. */
  readonly skippedFiles: ReadonlyArray<SkippedProjectFile>;
}

/** The other files of an export zip that hold its organization (texts, unparsed). */
export interface ExportExtras {
  readonly projectTexts?: ReadonlyArray<string>;
  readonly memoriesText?: string | null;
  readonly chatgptProjectName?: ChatGptProjectName;
}

const parseJson = (text: string | null | undefined): unknown => {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Claude.ai: conversations plus projects, project memories and the global memory. */
export function parseClaudeExport(
  rawConversations: unknown,
  extras: ExportExtras = {},
): ParsedExport {
  const { projects, skipped } = parseClaudeProjects(
    (extras.projectTexts ?? []).map(parseJson).filter((raw) => raw !== null),
  );
  const memories = parseClaudeMemories(parseJson(extras.memoriesText));
  const withMemory = projects.map((project) => ({
    ...project,
    memory: memories.projects.get(project.externalId) ?? null,
  }));
  return {
    source: "claude",
    conversations: suggestClaudeProjects(parseClaudeConversations(rawConversations), withMemory),
    projects: withMemory,
    globalMemory: memories.global,
    skippedFiles: skipped,
  };
}

function parseChatGptExport(raw: unknown, extras: ExportExtras = {}): ParsedExport {
  const conversations = parseChatGptConversations(raw);
  return {
    source: "chatgpt",
    conversations,
    projects: chatgptProjects(conversations, extras.chatgptProjectName),
    globalMemory: null,
    skippedFiles: [],
  };
}

const geminiExport = (conversations: Array<ParsedConversation>): ParsedExport => ({
  source: "gemini",
  conversations,
  projects: [],
  globalMemory: null,
  skippedFiles: [],
});

/** Tells the three formats apart by shape, so the person does not have to say which it is. */
export function detectExport(
  fileName: string,
  text: string,
  extras: ExportExtras = {},
): ParsedExport | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    const conversations = parseGeminiActivity(text);
    return conversations.length > 0 ? geminiExport(conversations) : null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.conversations)
      ? raw.conversations
      : [];
  const first = list.find(isRecord);
  if (first === undefined) return null;
  if (isRecord(first.mapping)) return parseChatGptExport(raw, extras);
  if (Array.isArray(first.chat_messages)) return parseClaudeExport(raw, extras);
  if ("safeHtmlItem" in first || "products" in first || /myactivity/i.test(fileName)) {
    return geminiExport(parseGeminiActivity(raw));
  }
  return null;
}

/** Inside an export zip, the file that holds the conversations. */
export function pickExportEntry(names: ReadonlyArray<string>): string | null {
  const candidates = names.filter((name) => !name.startsWith("__MACOSX/"));
  return (
    candidates.find((name) => /(^|\/)conversations\.json$/i.test(name)) ??
    candidates.find((name) => /gemini[^/]*\/MyActivity\.json$/i.test(name)) ??
    candidates.find((name) => /(gemini|bard)[^/]*\/MyActivity\.html$/i.test(name)) ??
    null
  );
}

/** Claude.ai project files next to conversations.json: `projects.json` or `projects/*.json`. */
export function pickProjectEntries(names: ReadonlyArray<string>): Array<string> {
  return names
    .filter((name) => !name.startsWith("__MACOSX/"))
    .filter(
      (name) => /(^|\/)projects\.json$/i.test(name) || /(^|\/)projects\/[^/]+\.json$/i.test(name),
    )
    .toSorted();
}

/** Claude.ai `memories.json`, if the export has one. */
export function pickMemoriesEntry(names: ReadonlyArray<string>): string | null {
  return (
    names
      .filter((name) => !name.startsWith("__MACOSX/"))
      .find((name) => /(^|\/)memories\.json$/i.test(name)) ?? null
  );
}
