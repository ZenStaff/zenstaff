// Zen Staff chat-first task start ("intake", ZEN.md): a card opens a chat whose agent gets the
// workflow's questions as a checklist plus what the app knows, asks only for what is missing and
// calls `intake_ready` to run the workflow; the same chat sets up a hired AI employee. Pure parts.
import {
  buildWorkflowMessage,
  type ZenWorkflow,
  type ZenWorkflowInput,
  type ZenWorkflowManifest,
} from "./zenOffice.ts";

export type IntakeLocale = "en" | "ro";

/** Marks an intake thread's first message (the workflow it prepares). */
function intakeMarker(workflowId: string): string {
  return `[zen-intake: ${workflowId}]`;
}
const INTAKE_MARKER = /\[zen-intake:[ \t]*([a-z0-9][a-z0-9-]{1,63})[ \t]*\]/;
const HIRE_MARKER = /\[zen-hire-setup:[ \t]*([A-Za-z0-9_-]{1,80})[ \t]*\]/;

export function parseIntakeMarker(text: string): string | null {
  return INTAKE_MARKER.exec(text)?.[1] ?? null;
}
function hireSetupMarker(agentId: string): string {
  return `[zen-hire-setup: ${agentId}]`;
}
export function parseHireSetupMarker(text: string): string | null {
  return HIRE_MARKER.exec(text)?.[1] ?? null;
}

// What the app already knows.

/** Facts read from the company profile (onboarding interview), memory and settings. */
export interface IntakeFacts {
  readonly companyName?: string | null;
  /** Tone words from the profile ("friendly", "warm"...), first = main. */
  readonly tones?: ReadonlyArray<string>;
  readonly toneNotes?: string | null;
  readonly website?: string | null;
  readonly customers?: string | null;
  readonly sells?: string | null;
  readonly prices?: string | null;
  /** Other links found in the profile or memory (booking page, menu...). */
  readonly links?: ReadonlyArray<string>;
  readonly address?: string | null;
}

export type IntakeSource = "profile" | "memory" | "previous" | "app";

export interface IntakeSuggestion {
  readonly value: string;
  readonly source: IntakeSource;
  /** Plain words for the agent: "brand tone in the company profile". */
  readonly why: string;
}

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Words for a tone in both languages, so a profile tone finds the option whatever its language. */
const TONE_SYNONYMS: ReadonlyArray<ReadonlyArray<string>> = [
  ["friendly", "prietenos", "warm", "cald", "apropiat"],
  ["professional", "profesionist", "serios", "serious", "formal", "direct"],
  ["playful", "jucaus", "amuzant", "funny", "fun", "haios"],
  ["bold", "indraznet", "premium", "curajos"],
];

/** The option of a tone select that matches a tone word, or null. */
export function matchToneOption(tone: string, options: ReadonlyArray<string>): string | null {
  const word = fold(tone);
  const direct = options.find((option) => fold(option) === word);
  if (direct) return direct;
  const group = TONE_SYNONYMS.find((words) => words.includes(word));
  if (!group) return null;
  return options.find((option) => group.includes(fold(option))) ?? null;
}

/** The option matching a free answer ("instagram si facebook" -> "Instagram + Facebook"), or null. */
export function matchOption(answer: string, options: ReadonlyArray<string>): string | null {
  const wanted = fold(answer);
  if (wanted === "") return null;
  const exact = options.find((option) => fold(option) === wanted);
  if (exact) return exact;
  const words = (text: string) =>
    fold(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0 && !["si", "and", "doar", "only", "plus"].includes(word));
  const asked = new Set(words(answer));
  if (asked.size === 0) return null;
  // Same set of words, in any order: "facebook si instagram" is "Instagram + Facebook".
  const same = options.find((option) => {
    const have = words(option);
    return have.length === asked.size && have.every((word) => asked.has(word));
  });
  return same ?? null;
}

const has = (text: string | null | undefined): text is string =>
  typeof text === "string" && text.trim().length > 0;

const LANGUAGE_WORDS: Readonly<Record<IntakeLocale, string>> = { en: "English", ro: "română" };

type FieldKind = "tone" | "audience" | "language" | "link" | "company" | "other";

/** What a workflow question asks for, from its id and label (in any language). */
function intakeFieldKind(input: Pick<ZenWorkflowInput, "id" | "label" | "type">): FieldKind {
  const key = fold(`${input.id} ${input.label}`);
  if (/\b(tone|ton|tonul|voice|vocea)\b/.test(key)) return "tone";
  if (/(audience|public|customers|clienti|target|cui te adresezi|who should)/.test(key)) {
    return "audience";
  }
  if (/\b(language|limba)\b/.test(key)) return "language";
  if (input.type === "url" || /(call_to_action|website|site|link|url|ce vrei sa faca)/.test(key)) {
    return "link";
  }
  if (/(company|firma|brand_name|business)/.test(key)) return "company";
  return "other";
}

/**
 * Values the agent proposes instead of asking: the last run of the same workflow first (choices
 * such as networks or how many, never the topic or a file), then the company profile and memory.
 * The agent confirms them in one sentence before using them.
 */
export function prefillIntake(input: {
  readonly inputs: ReadonlyArray<ZenWorkflowInput>;
  readonly facts: IntakeFacts;
  readonly previous: Readonly<Record<string, string>> | null;
  readonly locale: IntakeLocale;
}): Readonly<Record<string, IntakeSuggestion>> {
  const ro = input.locale === "ro";
  const out: Record<string, IntakeSuggestion> = {};
  for (const field of input.inputs) {
    const last = input.previous?.[field.id];
    if (has(last) && field.type !== "longtext" && field.type !== "file") {
      out[field.id] = {
        value: last.trim(),
        source: "previous",
        why: ro ? "ultima dată când ai făcut asta" : "the last time you ran this",
      };
      continue;
    }
    const facts = input.facts;
    switch (intakeFieldKind(field)) {
      case "tone": {
        const tones = facts.tones ?? [];
        const value =
          field.type === "select"
            ? (tones.map((tone) => matchToneOption(tone, field.options ?? [])).find(Boolean) ??
              null)
            : (tones[0] ?? null);
        if (value) {
          out[field.id] = {
            value,
            source: "profile",
            why: ro ? "tonul din profilul firmei" : "the brand tone in the company profile",
          };
        }
        break;
      }
      case "audience":
        if (has(facts.customers)) {
          out[field.id] = {
            value: facts.customers.trim().split("\n")[0]!.slice(0, 200),
            source: "profile",
            why: ro ? "clienții din profilul firmei" : "the customers in the company profile",
          };
        }
        break;
      case "language":
        out[field.id] = {
          value: LANGUAGE_WORDS[input.locale],
          source: "app",
          why: ro ? "limba aplicației" : "the app's language",
        };
        break;
      case "link": {
        const link = facts.links?.find(has) ?? (has(facts.website) ? facts.website : null);
        if (link) {
          out[field.id] = {
            value: link.trim(),
            source: facts.links?.includes(link) ? "memory" : "profile",
            why: ro ? "linkul firmei" : "the company's link",
          };
        }
        break;
      }
      case "company":
        if (has(facts.companyName)) {
          out[field.id] = {
            value: facts.companyName.trim(),
            source: "profile",
            why: ro ? "numele din profilul firmei" : "the name in the company profile",
          };
        }
        break;
      case "other":
        break;
    }
  }
  return out;
}

/** Links (https://...) in a text, without trailing punctuation, at most `limit`. */
export function extractLinks(text: string, limit = 5): ReadonlyArray<string> {
  const found: string[] = [];
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>()"'\]]+/g)) {
    const link = match[0].replace(/[.,;:!?]+$/, "");
    if (!found.includes(link)) found.push(link);
    if (found.length >= limit) break;
  }
  return found;
}

// The checklist and the first message.

/** One line per question, for the agent's internal checklist. */
export function intakeChecklist(
  inputs: ReadonlyArray<ZenWorkflowInput>,
  suggestions: Readonly<Record<string, IntakeSuggestion>>,
): string {
  return inputs
    .map((field) => {
      const parts = [
        `- ${field.id} (${field.required ? "required" : "optional"}, ${field.type}): "${field.label}"`,
      ];
      if (field.options?.length)
        parts.push(`  choices: ${field.options.map((o) => `"${o}"`).join(", ")}`);
      if (field.placeholder) parts.push(`  example: ${field.placeholder}`);
      if (field.help) parts.push(`  note: ${field.help}`);
      const suggestion = suggestions[field.id];
      if (suggestion) parts.push(`  already known: "${suggestion.value}" (from ${suggestion.why})`);
      return parts.join("\n");
    })
    .join("\n");
}

export interface IntakeRecentFile {
  readonly name: string;
  /** ISO date of the last change. */
  readonly modifiedAt: string;
}

export interface IntakeContext {
  readonly suggestions: Readonly<Record<string, IntakeSuggestion>>;
  readonly facts: IntakeFacts;
  /** company-profile.md, shortened. */
  readonly profileExcerpt: string | null;
  /** The company memory index (MEMORY.md), shortened. */
  readonly memoryExcerpt: string | null;
  readonly recentFiles: ReadonlyArray<IntakeRecentFile>;
  /** When the same workflow last ran, ISO, or null. */
  readonly previousAt: string | null;
  /** Connected apps, "Gmail (Claude Code)". */
  readonly connections: ReadonlyArray<string>;
  readonly folderName: string;
}

const INTAKE_SUMMARY: Readonly<Record<IntakeLocale, string>> = {
  ro: "Hai să stabilim împreună ce îți trebuie.",
  en: "Let's work out together what you need.",
};

/** Shown in the bubble when the task needs files: they go into the chat, not into a form. */
const INTAKE_FILES_HINT: Readonly<Record<IntakeLocale, string>> = {
  ro: "Când îți cer poze, clipuri sau documente, trage-le direct aici, în chat.",
  en: "When I ask for photos, clips or documents, drop them right here in the chat.",
};

/** The folder inside the work folder where files dropped into the chat are copied. */
const INTAKE_MATERIALS_FOLDER = "materiale";

/**
 * The first message of an intake thread. The bubble shows the workflow name and one friendly
 * line; the English instructions (checklist, what is known, rules) sit under Details, like a
 * workflow's (`splitWorkflowMessage` recognises it through the language line).
 */
export function buildIntakeMessage(input: {
  /** With `prompt` (and `skill`), agents without the intake tools (Codex) still get the task. */
  readonly workflow: Pick<ZenWorkflow, "manifest"> & Partial<Pick<ZenWorkflow, "prompt" | "skill">>;
  /** The manifest in the app's language (labels and options the person sees). */
  readonly localized: ZenWorkflowManifest;
  readonly locale: IntakeLocale;
  readonly context: IntakeContext;
}): string {
  const { localized, context, locale } = input;
  const ro = locale === "ro";
  const known: string[] = [];
  const facts = context.facts;
  if (has(facts.companyName)) known.push(`Company: ${facts.companyName.trim()}`);
  if (facts.tones?.length) known.push(`Brand tone: ${facts.tones.join(", ")}`);
  if (has(facts.toneNotes)) known.push(`Tone notes: ${facts.toneNotes.trim().slice(0, 300)}`);
  if (has(facts.sells)) known.push(`What they sell: ${facts.sells.trim().slice(0, 300)}`);
  if (has(facts.customers)) known.push(`Customers: ${facts.customers.trim().slice(0, 300)}`);
  if (has(facts.prices)) known.push(`Prices: ${facts.prices.trim().slice(0, 300)}`);
  if (has(facts.website)) known.push(`Website: ${facts.website.trim()}`);
  if (facts.links?.length) known.push(`Links: ${facts.links.join(", ")}`);
  if (has(facts.address)) known.push(`Address: ${facts.address.trim()}`);
  const example = ro
    ? "„Folosesc tonul prietenos din profilul firmei și linkul cafeabuna.ro/rezervari, bine?”"
    : '"I\'ll use the friendly tone from your company profile and the link cafeabuna.ro/rezervari, OK?"';
  const instructions = [
    intakeMarker(input.workflow.manifest.id),
    "",
    `The person picked the task "${localized.name}" (${localized.description}). Output: ${localized.output}`,
    `Work folder: ${context.folderName}. Do NOT start the task yet: first have a short conversation to gather what it needs.`,
    "",
    "Checklist (internal, never show it as a list or a form; required items must be answered before the task runs):",
    intakeChecklist(localized.inputs, context.suggestions),
    "",
    "What the app already knows:",
    ...(known.length > 0 ? known.map((line) => `- ${line}`) : ["- (no company profile yet)"]),
    ...(context.profileExcerpt ? ["", "Company profile (excerpt):", context.profileExcerpt] : []),
    ...(context.memoryExcerpt
      ? ["", "Company memory index (excerpt):", context.memoryExcerpt]
      : []),
    ...(context.recentFiles.length > 0
      ? [
          "",
          "Recent files in the work folder (newest first):",
          ...context.recentFiles.map((file) => `- ${file.name} (${file.modifiedAt.slice(0, 10)})`),
        ]
      : []),
    ...(context.previousAt
      ? [
          "",
          `This task last ran on ${context.previousAt.slice(0, 10)}; reused choices are marked "the last time you ran this".`,
        ]
      : []),
    ...(context.connections.length > 0
      ? ["", `Connected apps: ${context.connections.join(", ")}.`]
      : []),
    "",
    "How to run this conversation:",
    "1. Your first message: greet in one short sentence, then confirm in ONE sentence what you will reuse from what the app knows, naming the source, for example " +
      `${example} Then ask for the first missing required item.`,
    "2. Ask at most two questions per message, in plain, natural words (not the checklist labels verbatim). Never ask for something already known; just confirm it.",
    "3. For a question with choices, FIRST call the intake_ask tool (zen-connect MCP server) with the item id, your question and up to 4 short choices (the checklist choices, or sensible ones for numbers), THEN write the question itself as the last text of your message and end your turn (text written before a tool call is folded away in the app). The app shows the choices as buttons; the person may also type or speak a different answer, which is fine.",
    "4. If a recent file looks like useful material (a brand guide, past posts, a menu), say so and offer to use it.",
    ...(localized.inputs.some((field) => field.type === "file")
      ? [
          `4b. For a file item, ask the person to drop the files right here in the chat (drag them onto the message box or use the paperclip), or to name files or a folder already in the work folder. Files dropped in the chat reach you as attachment paths: copy them into the folder "${INTAKE_MATERIALS_FOLDER}" inside the work folder (create it; keep the original names) and give that path as the item's value (the folder itself for an item that takes several files). Never ask the person to type a path.`,
        ]
      : []),
    "5. When every required item has an answer and the person agreed with the reused ones, call intake_ready with all the values (item id -> answer; for choices use the choice text). It returns the full task instructions: follow them right away in this same turn.",
    "6. When the task is done, ask once whether to repeat it automatically (for example every week). If they say yes, call intake_schedule with the frequency, the weekday and the time they want.",
    "Never fill in facts the person did not give or the app does not know: ask instead.",
    ...(input.workflow.prompt
      ? [
          "",
          "Only if the intake_ready tool is not available to you: once the person has answered and agreed, do the task yourself following these instructions, with their answers in place of the {{item}} placeholders (sections between {{#item}} and {{/item}} only when that item has an answer):",
          "",
          input.workflow.prompt.trim(),
          ...(input.workflow.skill ? ["", "Guide:", input.workflow.skill.trim()] : []),
        ]
      : []),
  ].join("\n");
  return buildWorkflowMessage(
    { prompt: instructions.replace(/\{\{/g, "{ {"), skill: null },
    {},
    {
      locale,
      summary: {
        title: [
          localized.name,
          "",
          localized.inputs.some((field) => field.type === "file")
            ? `${INTAKE_SUMMARY[locale]} ${INTAKE_FILES_HINT[locale]}`
            : INTAKE_SUMMARY[locale],
        ].join("\n"),
        answers: [],
      },
    },
  );
}

// Gathered values.

export interface IntakeValuesCheck {
  readonly values: Readonly<Record<string, string>>;
  /** Labels of required items still missing. */
  readonly missing: ReadonlyArray<string>;
  /** Ids the workflow does not have (ignored). */
  readonly unknown: ReadonlyArray<string>;
}

/**
 * The agent's `intake_ready` values against the workflow: ids kept, strings trimmed, choices
 * matched to the option text in either language (a free answer stays as written), required
 * items reported when empty.
 */
export function checkIntakeValues(input: {
  readonly manifest: ZenWorkflowManifest;
  readonly localized: ZenWorkflowManifest;
  readonly raw: unknown;
}): IntakeValuesCheck {
  const raw =
    typeof input.raw === "object" && input.raw !== null && !Array.isArray(input.raw)
      ? (input.raw as Record<string, unknown>)
      : {};
  const values: Record<string, string> = {};
  const known = new Set(input.manifest.inputs.map((field) => field.id));
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  for (const field of input.localized.inputs) {
    const value = raw[field.id];
    const text =
      typeof value === "string"
        ? value.trim()
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : Array.isArray(value)
            ? value.filter((item) => typeof item === "string").join(" + ")
            : "";
    if (text === "") continue;
    if (field.type === "select") {
      const source = input.manifest.inputs.find((item) => item.id === field.id);
      const options = field.options ?? [];
      const localizedMatch = matchOption(text, options);
      const viaSource = source?.options ? matchOption(text, source.options) : null;
      const index = viaSource && source?.options ? source.options.indexOf(viaSource) : -1;
      values[field.id] = localizedMatch ?? (index >= 0 ? (options[index] ?? viaSource!) : text);
    } else {
      values[field.id] = text.slice(0, 4_000);
    }
  }
  const missing = input.localized.inputs
    .filter((field) => field.required && !has(values[field.id]))
    .map((field) => `${field.label} (${field.id})`);
  return { values, missing, unknown };
}

/** Quick-reply choices from the agent: 1-6 short, distinct, non-empty strings. */
export function normalizeChips(raw: unknown): ReadonlyArray<string> {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim().replace(/\s+/g, " ").slice(0, 60);
    if (text === "" || out.some((existing) => fold(existing) === fold(text))) continue;
    out.push(text);
    if (out.length >= 6) break;
  }
  return out;
}

// The run's folder.

/**
 * A human folder name for a run: date, then the workflow and the topic in plain words, such as
 * `2026-11-08-postari-meniu-toamna`. Links become their site name, filler words are dropped.
 */
function humanFolderName(input: {
  readonly date: string;
  readonly parts: ReadonlyArray<string | null | undefined>;
  readonly maxWords?: number;
}): string {
  const words = humanFolderWords(input.parts.filter(has).join(" "), input.maxWords ?? 5);
  return [input.date.slice(0, 10), words].filter(Boolean).join("-");
}

const FILLER = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "and",
  "or",
  "to",
  "in",
  "on",
  "with",
  "about",
  "my",
  "our",
  "de",
  "la",
  "si",
  "sau",
  "pe",
  "cu",
  "din",
  "in",
  "un",
  "o",
  "al",
  "ale",
  "despre",
  "pentru",
  "noi",
  "nou",
  "noua",
  "meu",
  "mea",
  "nostru",
  "noastra",
  "lansam",
  "vineri",
  "luni",
  "marti",
  "miercuri",
  "joi",
  "sambata",
  "duminica",
  "www",
  "com",
  "ro",
  "eu",
  "net",
  "org",
  "http",
  "https",
]);

/** Up to `max` plain ASCII words from a text, dash-joined; URLs count as their site name. */
export function humanFolderWords(text: string, max = 5): string {
  const withoutUrls = text.replace(/\bhttps?:\/\/([^\s/]+)[^\s]*/gi, (_, host: string) =>
    host
      .replace(/^www\./i, "")
      .split(".")
      .slice(0, -1)
      .join(" "),
  );
  const words = withoutUrls
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !FILLER.has(word) && !/^\d+$/.test(word));
  const unique = words.filter((word, index) => words.indexOf(word) === index);
  return unique.slice(0, max).join("-").slice(0, 48).replace(/-+$/, "");
}

/** The run folder for an intake: the workflow's short name + the first text answer. */
export function intakeRunFolder(input: {
  readonly date: string;
  readonly localized: ZenWorkflowManifest;
  readonly values: Readonly<Record<string, string>>;
}): string {
  const topic = input.localized.inputs
    .filter((field) => field.type === "longtext" || field.type === "text")
    .map((field) => input.values[field.id])
    .find(has);
  // "Postări pentru rețelele sociale" -> "postari"; the topic carries the rest.
  const nameWords = humanFolderWords(input.localized.name, topic ? 1 : 3);
  return humanFolderName({ date: input.date, parts: [nameWords, topic ?? null], maxWords: 4 });
}

// Hiring: the setup conversation of a new AI employee.

export interface HireConnection {
  readonly name: string;
  /** Where it is connected: "Claude Code", "AI account connector", "Codex", "Zen Staff". */
  readonly where: string;
}

export interface HireDutyProposal {
  readonly title: string;
  readonly prompt: string;
  /** 1 = Monday ... 7 = Sunday. */
  readonly weekday: number;
  readonly time: string;
}

export interface HireProposal {
  readonly instructions: string;
  readonly workflows: ReadonlyArray<string>;
  readonly connectors: ReadonlyArray<string>;
  readonly duties: ReadonlyArray<HireDutyProposal>;
  /** Where the employee publishes or sends ("Instagram @cafeabuna", "newsletter"). */
  readonly publishesTo: ReadonlyArray<string>;
  /** Who approves outbound work, in the person's words. */
  readonly approvals: string;
  /** What it must never do. */
  readonly never: ReadonlyArray<string>;
  /** The name the person chose in the chat, when it changes the default one. */
  readonly name?: string;
  /** Limits agreed in the chat (how much per day or week, what to ask first), in their words. */
  readonly limits?: string;
}

const strings = (raw: unknown, max: number, length = 200): string[] =>
  Array.isArray(raw)
    ? raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, length))
        .filter((item, index, all) => item !== "" && all.indexOf(item) === index)
        .slice(0, max)
    : [];

/** The agent's `hire_propose` arguments, cleaned: unknown workflows dropped, duties checked. */
export function normalizeHireProposal(
  raw: unknown,
  known: { readonly workflows: ReadonlyArray<string>; readonly connectors?: ReadonlyArray<string> },
): { readonly proposal: HireProposal } | { readonly error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "Send the proposal as an object." };
  const input = raw as Record<string, unknown>;
  const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
  if (instructions.length < 20) {
    return { error: "Write the job description (instructions), at least a few sentences." };
  }
  const duties: HireDutyProposal[] = [];
  for (const item of Array.isArray(input.duties) ? input.duties : []) {
    if (typeof item !== "object" || item === null) continue;
    const duty = item as Record<string, unknown>;
    const title = typeof duty.title === "string" ? duty.title.trim().slice(0, 120) : "";
    const prompt = typeof duty.prompt === "string" ? duty.prompt.trim().slice(0, 2_000) : "";
    const weekday = typeof duty.weekday === "number" ? Math.round(duty.weekday) : NaN;
    const time = typeof duty.time === "string" ? duty.time.trim() : "";
    if (title === "" || prompt === "" || !(weekday >= 1 && weekday <= 7)) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    duties.push({ title, prompt, weekday, time });
    if (duties.length >= 6) break;
  }
  return {
    proposal: {
      instructions: instructions.slice(0, 8_000),
      workflows: strings(input.workflows, 20, 64).filter((id) => known.workflows.includes(id)),
      connectors: strings(input.connectors, 20, 80),
      duties,
      publishesTo: strings(input.publishes_to ?? input.publishesTo, 10),
      approvals: typeof input.approvals === "string" ? input.approvals.trim().slice(0, 300) : "",
      never: strings(input.never, 10, 300),
      ...(typeof input.name === "string" && input.name.trim() !== ""
        ? { name: input.name.trim().replace(/\s+/g, " ").slice(0, 60) }
        : {}),
      ...(typeof input.limits === "string" && input.limits.trim() !== ""
        ? { limits: input.limits.trim().slice(0, 500) }
        : {}),
    },
  };
}

/** The instructions saved in the profile: the job description plus the rules the chat agreed. */
export function hireInstructionsText(proposal: HireProposal, locale: IntakeLocale): string {
  const ro = locale === "ro";
  const sections = [proposal.instructions.trim()];
  if (proposal.publishesTo.length > 0) {
    sections.push(
      `${ro ? "Unde publici" : "Where you publish"}:\n${proposal.publishesTo.map((item) => `- ${item}`).join("\n")}`,
    );
  }
  if (proposal.approvals.trim()) {
    sections.push(`${ro ? "Aprobări" : "Approvals"}: ${proposal.approvals.trim()}`);
  }
  if (proposal.limits?.trim()) {
    sections.push(`${ro ? "Limite" : "Limits"}: ${proposal.limits.trim()}`);
  }
  if (proposal.never.length > 0) {
    sections.push(
      `${ro ? "Nu faci niciodată" : "Never"}:\n${proposal.never.map((item) => `- ${item}`).join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

/** A line diff (+ added, - removed, " " kept) for the approval summary. Small texts only. */
export function lineDiff(
  before: string,
  after: string,
): ReadonlyArray<{ readonly kind: "same" | "added" | "removed"; readonly text: string }> {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 250_000) {
    return [
      ...a.map((text) => ({ kind: "removed" as const, text })),
      ...b.map((text) => ({ kind: "added" as const, text })),
    ];
  }
  // Longest common subsequence table, then walk it.
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: { kind: "same" | "added" | "removed"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "removed", text: a[i++]! });
  while (j < m) out.push({ kind: "added", text: b[j++]! });
  return out;
}

export interface HireSetupContext {
  readonly agentName: string;
  readonly role: string;
  /** The role's template instructions (the starting job description). */
  readonly templateInstructions: string;
  readonly workflows: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Workflows the role starts with. */
  readonly roleWorkflows: ReadonlyArray<string>;
  readonly roleConnectors: ReadonlyArray<string>;
  readonly roleDuties: ReadonlyArray<HireDutyProposal>;
  readonly connections: ReadonlyArray<HireConnection>;
  readonly facts: IntakeFacts;
  readonly recentFiles: ReadonlyArray<IntakeRecentFile>;
  readonly kind: "personal" | "company";
  readonly managerName: string | null;
  /** The company's "Aprobări" switch: every outbound action waits for the manager. */
  readonly approvalsRequired: boolean;
  /** The company AI account the employee runs on, when it is a company employee. */
  readonly companyAccount: string | null;
  readonly folderName: string;
  /**
   * The role normally works for a company but the person is in Personal: the chat first offers to
   * keep it personal or move it to a company (the app shows the companies and "New company" as
   * buttons under the chat).
   */
  readonly companyChoice?: boolean;
}

const HIRE_SUMMARY: Readonly<Record<IntakeLocale, (name: string, role: string) => string>> = {
  ro: (name, role) => `Angajare: ${name}, ${role}`,
  en: (name, role) => `Hiring: ${name}, ${role}`,
};
const HIRE_LINE: Readonly<Record<IntakeLocale, string>> = {
  ro: "Discutăm ce va face și cu ce unelte.",
  en: "Let's agree on the job and the tools.",
};

/** The first message of a hiring setup chat. */
export function buildHireSetupMessage(input: {
  readonly agentId: string;
  readonly locale: IntakeLocale;
  readonly context: HireSetupContext;
}): string {
  const { context, locale } = input;
  const ro = locale === "ro";
  const weekday = (day: number) =>
    (ro
      ? ["", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică"]
      : ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])[day] ??
    "";
  const connections = context.connections.map((item) => `${item.name} (${item.where})`);
  const example = ro
    ? `„Văd că ai conectat ${
        context.connections
          .slice(0, 2)
          .map((item) => item.name)
          .join(" și ") || "Meta și Zernio"
      } în Claude. Le folosesc pentru postări?”`
    : `"I see you connected ${
        context.connections
          .slice(0, 2)
          .map((item) => item.name)
          .join(" and ") || "Meta and Zernio"
      } in Claude. Shall I use them for posts?"`;
  const facts = context.facts;
  const instructions = [
    hireSetupMarker(input.agentId),
    "",
    `You are ${context.agentName}, just hired as ${context.role}. This chat is your first day: learn the job from the person who hired you. Do NOT do real work yet.`,
    `Folder: ${context.folderName}. Kind: ${context.kind === "company" ? `company employee${context.companyAccount ? ` on the company AI account (${context.companyAccount})` : ""}` : "personal assistant of this person"}.`,
    context.managerName ? `Your manager: ${context.managerName}.` : "No manager is set yet.",
    context.approvalsRequired
      ? 'The company has "Aprobări" on: every outbound action (send, publish, pay, delete) waits for the manager\'s approval. This cannot be turned off here; say so when you talk about approvals.'
      : "Approvals are up to the person: ask who approves what before it goes out.",
    "",
    "Starting job description (from the role):",
    context.templateInstructions,
    "",
    `Workflows the role starts with: ${context.roleWorkflows.join(", ") || "(none)"}.`,
    `All workflows you may be given (id: name): ${context.workflows.map((item) => `${item.id}: ${item.name}`).join("; ") || "(none)"}.`,
    `Connectors the role usually needs: ${context.roleConnectors.join(", ") || "(none)"}.`,
    context.roleDuties.length > 0
      ? `Usual duties: ${context.roleDuties.map((duty) => `${duty.title} (${weekday(duty.weekday)} ${duty.time})`).join("; ")}.`
      : "No usual duties.",
    "",
    connections.length > 0
      ? `Connections this person already has: ${connections.join(", ")}.`
      : "No connections were found on this computer (Claude Code, AI account connectors, Codex, Zen Staff).",
    ...(has(facts.companyName) ? [`Company: ${facts.companyName.trim()}.`] : []),
    ...(facts.tones?.length
      ? [`Brand tone in the company profile: ${facts.tones.join(", ")}.`]
      : []),
    ...(has(facts.toneNotes) ? [`Tone notes: ${facts.toneNotes.trim().slice(0, 300)}`] : []),
    ...(has(facts.website) ? [`Website: ${facts.website.trim()}.`] : []),
    ...(context.recentFiles.length > 0
      ? [`Recent files in the folder: ${context.recentFiles.map((file) => file.name).join(", ")}.`]
      : []),
    "",
    ...(context.companyChoice
      ? [
          "",
          'This role usually works for a company, but the person hired you in Personal (no company). In your FIRST message, say so in one sentence and ask whether you stay their personal assistant or work for one of their companies; the app shows their companies and "Companie nouă" as buttons under the chat, so do not call intake_ask for this question. If they choose a company, the app moves you there and starts a new setup chat; if they keep you personal, go on below.',
        ]
      : []),
    "",
    "Learn, one or two questions per message, in natural words:",
    `- your name: you are called ${context.agentName} for now; ask if they want another name (keep it if they do not care);`,
    "- where you publish or send things (which accounts, pages, lists);",
    `- which tools and accounts you may use: start from the connections above and ask, for example ${example}`,
    "- the brand tone (confirm the profile's tone if there is one) and, if they have them, a few past posts or examples (a file in the folder or pasted text);",
    "- who approves your work before it goes out;",
    '- your schedule and duties, for example "în fiecare luni la 9 propui postările săptămânii?";',
    "- your limits: how much you may do or spend per day or week, and what you must ask about first;",
    "- what you must never do.",
    "For a question with clear choices, FIRST call intake_ask (zen-connect MCP server) with up to 4 short choices, THEN write the question as the last text of your message and end your turn (text before a tool call is folded away in the app).",
    "When you know enough, call hire_propose with: instructions (your full job description, in the person's language, second person: what you do, how, for whom), workflows (ids from the list above), connectors (names of the connections or apps you will use), duties (title, prompt, weekday 1=Monday..7=Sunday, time HH:MM), publishes_to, approvals, limits, never, and name if they chose another one. The app shows the person a summary of the changes to approve; tell them to check it. Do not claim you are active before they approve.",
  ].join("\n");
  const title = HIRE_SUMMARY[locale](context.agentName, context.role);
  return buildWorkflowMessage(
    { prompt: instructions.replace(/\{\{/g, "{ {"), skill: null },
    {},
    { locale, summary: { title: `${title}\n\n${HIRE_LINE[locale]}`, answers: [] } },
  );
}

// What the web reads about an intake thread.

export interface IntakeChipsView {
  readonly id: string;
  readonly field: string | null;
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  /** Epoch ms; the buttons hide once the person writes after this. */
  readonly askedAt: number;
}

export interface IntakeScheduleRequest {
  readonly kind: "daily" | "weekly";
  /** 0 = Sunday ... 6 = Saturday (the scheduled tasks' numbering). */
  readonly weekday: number;
  readonly time: string;
  readonly state: "pending" | "saved" | "failed";
  readonly detail: string | null;
}

export interface IntakeThreadView {
  readonly threadId: string;
  readonly kind: "workflow" | "hire";
  readonly workflowId: string | null;
  readonly companyId: string | null;
  readonly projectId: string | null;
  readonly locale: IntakeLocale;
  /** What the app proposed before asking (field id -> suggestion). */
  readonly suggestions: Readonly<Record<string, IntakeSuggestion>>;
  readonly chips: IntakeChipsView | null;
  /** Set once `intake_ready` ran: the answers and the run folder. */
  readonly launched: {
    readonly values: Readonly<Record<string, string>>;
    readonly folder: string;
    readonly at: string;
  } | null;
  readonly schedule: IntakeScheduleRequest | null;
  /** Hiring: the employee being set up and the proposal waiting for approval. */
  readonly agentId: string | null;
  readonly proposal: HireProposal | null;
  readonly proposalState: "none" | "pending" | "approved";
  /** Hiring: the role template (for moving the employee to a company). */
  readonly templateId?: string | null;
  /** Hiring in Personal a role that usually works for a company: offer the companies inline. */
  readonly companyChoice?: boolean;
}

/** Weekday names (both languages, any case) to the scheduled tasks' 0 = Sunday numbering. */
function parseWeekday(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    if (raw >= 0 && raw <= 6) return raw;
    if (raw === 7) return 0;
    return null;
  }
  if (typeof raw !== "string") return null;
  const word = fold(raw);
  const names: ReadonlyArray<ReadonlyArray<string>> = [
    ["sunday", "duminica", "sun", "dum"],
    ["monday", "luni", "mon", "lun"],
    ["tuesday", "marti", "tue", "mar"],
    ["wednesday", "miercuri", "wed", "mie"],
    ["thursday", "joi", "thu"],
    ["friday", "vineri", "fri", "vin"],
    ["saturday", "sambata", "sat", "sam"],
  ];
  const index = names.findIndex((group) => group.includes(word));
  return index >= 0 ? index : null;
}

/** The agent's `intake_schedule` arguments as a repeat, or a plain error. */
export function normalizeScheduleRequest(raw: unknown):
  | { readonly kind: "daily" | "weekly"; readonly weekday: number; readonly time: string }
  | {
      readonly error: string;
    } {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const frequency = fold(String(input.frequency ?? "weekly"));
  const kind = ["daily", "zilnic", "day", "every day"].includes(frequency) ? "daily" : "weekly";
  const timeRaw = typeof input.time === "string" ? input.time.trim() : "09:00";
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(timeRaw);
  if (!match || Number(match[1]) > 23 || Number(match[2] ?? 0) > 59) {
    return { error: "Give the time as HH:MM, for example 09:00." };
  }
  const time = `${match[1]!.padStart(2, "0")}:${match[2] ?? "00"}`;
  const weekday = kind === "daily" ? 1 : parseWeekday(input.weekday ?? "monday");
  if (weekday === null) return { error: "Give the weekday, for example monday." };
  return { kind, weekday, time };
}
