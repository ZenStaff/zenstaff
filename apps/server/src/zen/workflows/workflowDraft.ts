// Zen Staff: "Save this as a workflow". A finished thread becomes a draft for the workflow
// editor: the model (Haiku) generalizes the conversation into questions and an English prompt
// template; when that fails, a basic draft is built from the first message. Pure, so tests cover
// it without a model. ZEN.md, "Office edition".
import {
  ZEN_WORKFLOW_CATEGORIES,
  ZEN_WORKFLOW_INPUT_TYPES,
  templatePlaceholders,
  validateWorkflow,
  workflowIdFromName,
  type ZenWorkflowCategory,
  type ZenWorkflowDraft,
  type ZenWorkflowInput,
  type ZenWorkflowInputType,
  type ZenWorkflowManifest,
} from "@t3tools/contracts/zenOffice";
import { redactSensitive } from "@t3tools/contracts/zenSecrets";

/** The model that writes drafts: short, cheap, good at structure. */
export const ZEN_WORKFLOW_DRAFT_MODEL = "claude-haiku-5-5";

/** Icons the web app can draw (zen/office/workflowIcons.tsx); anything else falls back. */
const DRAFT_ICONS = [
  "sparkles",
  "megaphone",
  "newspaper",
  "palette",
  "image",
  "video",
  "mic",
  "send",
  "mail",
  "message-square-reply",
  "handshake",
  "shopping-cart",
  "target",
  "trending-up",
  "file-chart-column",
  "file-text",
  "presentation",
  "receipt",
  "calculator",
  "list-checks",
  "clipboard-list",
  "calendar",
  "languages",
  "globe",
  "briefcase",
  "users",
  "pen-line",
  "lightbulb",
  "search",
  "gauge",
  "shield-check",
] as const;

export interface DraftMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: "English", ro: "Romanian" };
const MAX_TRANSCRIPT_CHARS = 14_000;
const MAX_MESSAGE_CHARS = 3_000;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 3)}...`;

/** The conversation as plain lines, secrets redacted, the start and the end kept when long. */
export function draftTranscript(messages: ReadonlyArray<DraftMessage>): string {
  const lines = messages
    .filter((message) => message.text.trim().length > 0)
    .map(
      (message) =>
        `${message.role === "user" ? "Person" : "Assistant"}: ${clip(
          redactSensitive(message.text.trim()).text,
          MAX_MESSAGE_CHARS,
        )}`,
    );
  let text = lines.join("\n\n");
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  // The first request says what the task is; the last messages say how it ended.
  const head = lines.slice(0, 2).join("\n\n");
  const tail: string[] = [];
  let size = head.length;
  for (let index = lines.length - 1; index >= 2; index--) {
    const line = lines[index]!;
    if (size + line.length > MAX_TRANSCRIPT_CHARS) break;
    tail.unshift(line);
    size += line.length;
  }
  text = [head, "(...)", ...tail].join("\n\n");
  return clip(text, MAX_TRANSCRIPT_CHARS);
}

/** The request to the model. The reply must be one JSON object (parsed by `parseDraftReply`). */
export function buildDraftPrompt(messages: ReadonlyArray<DraftMessage>, locale: string): string {
  const language = LANGUAGE_NAMES[locale] ?? "English";
  return [
    "You turn a finished chat between a person and an AI assistant into a reusable workflow: a form with a few questions, and an instruction template the assistant follows next time.",
    "",
    "Rules:",
    "- Generalize. Specific details the person gave this time (names, dates, links, products, amounts, tone) become questions, so the next run can use other answers.",
    "- 1 to 6 questions (the form marks optional ones itself; do not write (optional) in a label). Each has: id (lowercase letters, digits, underscores, starts with a letter), label (a short question), type (one of: " +
      ZEN_WORKFLOW_INPUT_TYPES.join(", ") +
      "; use url for web addresses, file for a file in the work folder, longtext for notes, select only with 2+ options), required (true/false), placeholder (an example answer), and options (only for select).",
    "- prompt: the instructions in English, written to the assistant, using {{id}} for each answer, and {{#id}}...{{/id}} around text that only applies when an optional answer is given. Include what to produce and where to save it, learned from how the chat ended. Do not mention this chat.",
    `- name (max 60 characters), description (one sentence), output (what the person gets back) and every label and placeholder are in ${language}.`,
    "- category: one of " + ZEN_WORKFLOW_CATEGORIES.join(", ") + ".",
    "- icon: one of " + DRAFT_ICONS.join(", ") + ".",
    "- Never copy passwords, keys or personal identification numbers into the workflow.",
    "",
    'Reply with only one JSON object: {"name": "...", "description": "...", "category": "...", "icon": "...", "output": "...", "inputs": [...], "prompt": "..."}',
    "",
    "The chat:",
    "",
    draftTranscript(messages),
  ].join("\n");
}

const asString = (value: unknown, max: number): string =>
  typeof value === "string" ? clip(value.trim(), max) : "";

function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanInputId(value: unknown, taken: Set<string>): string {
  const base =
    (typeof value === "string" ? value : "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^[^a-z]+/, "")
      .replace(/_+$/, "")
      .slice(0, 32) || "detail";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

function cleanInputs(raw: unknown): ZenWorkflowInput[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<string>();
  const inputs: ZenWorkflowInput[] = [];
  for (const item of raw.slice(0, 8)) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    // The form marks optional questions itself.
    const label = asString(record.label, 120)
      .replace(/\s*\((?:optional|opțional|opţional)\)\s*$/i, "")
      .trim();
    if (!label) continue;
    const id = cleanInputId(record.id ?? label, taken);
    const declared = record.type;
    let type: ZenWorkflowInputType = (ZEN_WORKFLOW_INPUT_TYPES as ReadonlyArray<unknown>).includes(
      declared,
    )
      ? (declared as ZenWorkflowInputType)
      : "text";
    const options = Array.isArray(record.options)
      ? record.options.map((option) => asString(option, 80)).filter(Boolean)
      : [];
    if (type === "select" && options.length < 2) type = "text";
    const placeholder = asString(record.placeholder, 200);
    inputs.push({
      id,
      label,
      type,
      required: record.required !== false,
      ...(type === "select" ? { options } : {}),
      ...(placeholder ? { placeholder } : {}),
    });
  }
  return inputs;
}

/** Placeholders the template uses without a matching input are turned into plain text. */
function dropUnknownPlaceholders(prompt: string, ids: ReadonlySet<string>): string {
  return prompt
    .replace(
      /\{\{\s*[#^]\s*([a-z][a-z0-9_]*)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\1\s*\}\}/g,
      (whole, id) => (ids.has(id) ? whole : ""),
    )
    .replace(/\{\{\s*\/?\s*([a-z][a-z0-9_]*)\s*\}\}/g, (whole, id) =>
      ids.has(id) ? whole : `the ${String(id).replaceAll("_", " ")}`,
    );
}

function manifestOf(fields: {
  readonly name: string;
  readonly description: string;
  readonly category: ZenWorkflowCategory;
  readonly icon: string;
  readonly output: string;
  readonly inputs: ReadonlyArray<ZenWorkflowInput>;
}): ZenWorkflowManifest {
  return {
    id: workflowIdFromName(fields.name),
    name: fields.name,
    description: fields.description,
    category: fields.category,
    icon: fields.icon,
    inputs: fields.inputs,
    output: fields.output,
    version: "1.0.0",
    author: "Me",
  };
}

/** The model's reply as a valid draft, or null when it cannot be used. */
export function parseDraftReply(reply: string): Omit<ZenWorkflowDraft, "method"> | null {
  const parsed = firstJsonObject(reply);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const name = asString(record.name, 60);
  const rawPrompt = asString(record.prompt, 20_000);
  if (!name || !rawPrompt) return null;
  const inputs = cleanInputs(record.inputs);
  const ids = new Set(inputs.map((input) => input.id));
  const prompt = dropUnknownPlaceholders(rawPrompt, ids);
  const category = (ZEN_WORKFLOW_CATEGORIES as ReadonlyArray<unknown>).includes(record.category)
    ? (record.category as ZenWorkflowCategory)
    : "admin";
  const icon = (DRAFT_ICONS as ReadonlyArray<unknown>).includes(record.icon)
    ? (record.icon as string)
    : "sparkles";
  const manifest = manifestOf({
    name,
    description: asString(record.description, 300),
    category,
    icon,
    output: asString(record.output, 200),
    inputs,
  });
  if (validateWorkflow(manifest, prompt).length > 0) return null;
  // An input the template never uses would be asked for nothing.
  const used = new Set(templatePlaceholders(prompt));
  return {
    manifest: { ...manifest, inputs: inputs.filter((input) => used.has(input.id)) },
    prompt,
  };
}

const BASIC_TEXT: Readonly<
  Record<string, { readonly label: string; readonly placeholder: string; readonly output: string }>
> = {
  en: {
    label: "Anything different this time?",
    placeholder: "Other names, dates or details for this run",
    output: "The same kind of result as last time",
  },
  ro: {
    label: "Ce e diferit de data asta?",
    placeholder: "Alte nume, date sau detalii pentru această rulare",
    output: "Același fel de rezultat ca data trecută",
  },
};

/** Without the model: the first request becomes the template, with one optional question. */
export function basicDraft(
  messages: ReadonlyArray<DraftMessage>,
  title: string,
  locale: string,
): Omit<ZenWorkflowDraft, "method"> {
  const text = BASIC_TEXT[locale] ?? BASIC_TEXT.en!;
  const first = messages.find((message) => message.role === "user")?.text.trim() ?? "";
  const request = clip(redactSensitive(first).text, 6_000).replace(/\{\{/g, "{ {");
  const name = clip(title.trim() || "My workflow", 60);
  const prompt = [
    request || "Do the task described below.",
    "",
    "{{#changes}}For this run, take into account: {{changes}}{{/changes}}",
  ].join("\n");
  return {
    manifest: manifestOf({
      name,
      description: clip(request.split("\n")[0] ?? "", 200),
      category: "admin",
      icon: "sparkles",
      output: text.output,
      inputs: [
        {
          id: "changes",
          label: text.label,
          type: "longtext",
          required: false,
          placeholder: text.placeholder,
        },
      ],
    }),
    prompt,
  };
}

/**
 * The text a workflow's first message shows the person, without the instructions; ordinary
 * messages are kept. Used so a draft is built from what was asked, not from the old template.
 */
export function draftMessageText(text: string): string {
  const separator = text.indexOf("\n\n---\n\n");
  if (separator > 0 && text.includes("\nLanguage: the person using this works in ")) {
    return text.slice(separator + 7).split("\n\nLanguage: the person using this works in ")[0]!;
  }
  return text;
}
