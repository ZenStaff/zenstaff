// Zen Staff AI staff: prompts for the short Haiku calls (HR interview draft, instruction updates,
// customer personas) and the parsers that read their JSON answers back. When the model is not
// available, `fallbackHrDraft` builds a draft from the catalog so hiring still works.
import type { StaffLocale, StaffPersona, StaffRoleTemplate } from "@t3tools/contracts/zenStaff";

import { suggestTemplate, discoveryTokens } from "./analytics.ts";
import { ROLE_CATALOG } from "./roleCatalog.ts";

export const STAFF_MODEL = "claude-haiku-5-5";

/** The questions the HR flow asks (the web shows them one by one). */
export const HR_QUESTIONS: Readonly<
  Record<StaffLocale, ReadonlyArray<{ id: string; question: string }>>
> = {
  en: [
    {
      id: "work",
      question: "What should this person do for you? Describe the work in a few sentences.",
    },
    { id: "weekly", question: "Which tasks come back every week, and on which day?" },
    {
      id: "apps",
      question: "Which apps or accounts does the work touch (e-mail, Facebook, invoicing...)?",
    },
    { id: "approver", question: "Who checks the work before it goes out?" },
    { id: "never", question: "What must it never do? And what tone should it use?" },
  ],
  ro: [
    {
      id: "work",
      question: "Ce ar trebui să facă pentru tine? Descrie munca în câteva propoziții.",
    },
    { id: "weekly", question: "Ce sarcini revin în fiecare săptămână și în ce zi?" },
    {
      id: "apps",
      question: "Ce aplicații sau conturi atinge munca (e-mail, Facebook, facturare...)?",
    },
    { id: "approver", question: "Cine verifică munca înainte să plece în afară?" },
    { id: "never", question: "Ce nu are voie să facă niciodată? Și pe ce ton să scrie?" },
  ],
};

export interface HrDraft {
  readonly name: string;
  readonly role: string;
  readonly instructions: string;
  readonly workflows: ReadonlyArray<string>;
  readonly connectors: ReadonlyArray<string>;
  readonly objectives: ReadonlyArray<string>;
  readonly duties: ReadonlyArray<{
    readonly title: string;
    readonly prompt: string;
    readonly weekday: number;
    readonly time: string;
  }>;
  readonly templateId: string | null;
  readonly minutesPerTask: number;
}

export function hrDraftPrompt(input: {
  readonly answers: ReadonlyArray<{ readonly question: string; readonly answer: string }>;
  readonly locale: StaffLocale;
  readonly workflows: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly connectors: ReadonlyArray<string>;
}): string {
  const lang = input.locale === "ro" ? "Romanian (with ș and ț)" : "English";
  return [
    "You are the HR assistant of a small company that hires AI employees (agents). From the interview below, draft the agent's profile.",
    `Write every text field in ${lang}. Answer ONLY with one JSON object:`,
    '{"name": a first name, "role": job title, "instructions": the job description in second person, 80-180 words, concrete, including what it must never do, "workflows": ids from the list, "connectors": ids from the list, "objectives": 1-3 measurable goals, "duties": [{"title", "prompt", "weekday": 1-7 (1 = Monday), "time": "HH:MM"}] for the weekly recurring tasks, "minutesPerTask": minutes a person needs for one such task}',
    "Never include passwords or keys. Outbound actions (send, publish, pay, delete) always need the manager's approval; say so in the instructions.",
    "",
    `Workflows: ${input.workflows.map((workflow) => `${workflow.id} (${workflow.name})`).join("; ")}`,
    `Connectors: ${input.connectors.join(", ")}`,
    "",
    "Interview:",
    ...input.answers.map((item) => `Q: ${item.question}\nA: ${item.answer.slice(0, 2_000)}`),
  ].join("\n");
}

function jsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const list = (value: unknown, max: number) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

export function parseHrDraft(
  raw: string,
  known: { readonly workflows: ReadonlyArray<string>; readonly connectors: ReadonlyArray<string> },
): HrDraft | null {
  const object = jsonObject(raw);
  if (object === null) return null;
  const name = text(object.name, 60);
  const instructions = text(object.instructions, 6_000);
  if (name === "" || instructions === "") return null;
  const duties = (Array.isArray(object.duties) ? object.duties : []).slice(0, 5).flatMap((duty) => {
    if (typeof duty !== "object" || duty === null) return [];
    const record = duty as Record<string, unknown>;
    const weekday = Number(record.weekday);
    const time =
      typeof record.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(record.time)
        ? record.time
        : "09:00";
    const title = text(record.title, 120);
    const prompt = text(record.prompt, 2_000);
    if (title === "" || prompt === "" || !(weekday >= 1 && weekday <= 7)) return [];
    return [{ title, prompt, weekday: Math.round(weekday), time }];
  });
  const tokens = discoveryTokens(`${text(object.role, 120)} ${instructions}`);
  const minutes = Number(object.minutesPerTask);
  return {
    name,
    role: text(object.role, 120),
    instructions,
    workflows: list(object.workflows, 20).filter((id) => known.workflows.includes(id)),
    connectors: list(object.connectors, 20).filter((id) => known.connectors.includes(id)),
    objectives: list(object.objectives, 3),
    duties,
    templateId: suggestTemplate(tokens),
    minutesPerTask:
      Number.isFinite(minutes) && minutes > 0 ? Math.min(600, Math.round(minutes)) : 30,
  };
}

/** Without the model: the closest catalog role, with the person's own words added. */
export function fallbackHrDraft(
  answers: ReadonlyArray<{ readonly id: string; readonly answer: string }>,
  locale: StaffLocale,
): HrDraft {
  const all = answers.map((item) => item.answer).join(" ");
  const templateId = suggestTemplate(discoveryTokens(all)) ?? "admin-assistant";
  const template: StaffRoleTemplate =
    ROLE_CATALOG.find((item) => item.id === templateId) ?? ROLE_CATALOG[0]!;
  const answer = (id: string) => answers.find((item) => item.id === id)?.answer.trim() ?? "";
  const extra = [answer("work"), answer("never")].filter(Boolean).join("\n");
  return {
    name: template.name[locale],
    role: template.role[locale],
    instructions: extra
      ? `${template.instructions[locale]}\n\n${locale === "ro" ? "Din interviu" : "From the interview"}:\n${extra}`
      : template.instructions[locale],
    workflows: template.workflows,
    connectors: template.connectors,
    objectives: template.objectives.map((objective) => objective[locale]),
    duties: template.duties.map((duty) => ({
      title: duty.title[locale],
      prompt: duty.prompt[locale],
      weekday: duty.weekday,
      time: duty.time,
    })),
    templateId,
    minutesPerTask: template.minutesPerTask,
  };
}

export function improvePrompt(input: {
  readonly agentName: string;
  readonly role: string;
  readonly instructions: string;
  readonly corrections: ReadonlyArray<{ readonly kind: string; readonly text: string }>;
  readonly locale: StaffLocale;
}): string {
  const lang = input.locale === "ro" ? "Romanian (with ș and ț)" : "English";
  return [
    `An AI employee (${input.agentName}, ${input.role}) got corrections from its manager and colleagues. Update its job description so the same mistakes do not happen again.`,
    "Keep everything that still applies, add precise rules for each recurring problem, do not remove the approval rule.",
    `Answer ONLY with JSON: {"instructions": the full new job description in ${lang}, "changes": 1-5 short bullet sentences in ${lang} saying what changed and why}.`,
    "",
    "Current job description:",
    input.instructions,
    "",
    "Corrections (newest last):",
    ...input.corrections.slice(-30).map((item) => `- [${item.kind}] ${item.text.slice(0, 500)}`),
  ].join("\n");
}

export function parseImprove(
  raw: string,
): { readonly instructions: string; readonly changes: ReadonlyArray<string> } | null {
  const object = jsonObject(raw);
  if (object === null) return null;
  const instructions = text(object.instructions, 12_000);
  return instructions === "" ? null : { instructions, changes: list(object.changes, 5) };
}

export function personasPrompt(input: {
  readonly companyName: string;
  readonly sources: string;
  readonly memory: string;
  readonly count: number;
  readonly locale: StaffLocale;
}): string {
  const lang = input.locale === "ro" ? "Romanian (with ș and ț)" : "English";
  return [
    `Build ${input.count} distinct customer personas for ${input.companyName} from the material below (reviews, CRM exports, notes, company memory). Base every trait on the material; no stereotypes, no real names or personal data.`,
    `Answer ONLY with a JSON array of {"name": a short descriptive name, "summary": 1-2 sentences, "cares": 2-4 things they value, "objections": 2-3 typical objections} in ${lang}.`,
    "",
    "Material:",
    input.sources.slice(0, 20_000),
    "",
    "Company memory:",
    input.memory.slice(0, 8_000) || "(none)",
  ].join("\n");
}

export function parsePersonas(raw: string, idPrefix: string): StaffPersona[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 10).flatMap((item, index): StaffPersona[] => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const name = text(record.name, 80);
    if (name === "") return [];
    return [
      {
        id: `${idPrefix}-${index + 1}`,
        name,
        summary: text(record.summary, 400),
        cares: list(record.cares, 4),
        objections: list(record.objections, 3),
      },
    ];
  });
}

export function panelPrompt(input: {
  readonly personas: ReadonlyArray<StaffPersona>;
  readonly question: string;
  readonly locale: StaffLocale;
}): string {
  const lang = input.locale === "ro" ? "Romanian (with ș and ț)" : "English";
  return [
    "You simulate a panel of the company's customers. Each persona answers the question in its own voice, honestly (positive and negative), in 2-3 sentences, based only on its profile.",
    `Answer ONLY with a JSON array of {"persona": the persona name, "answer": text, "verdict": "positive"|"mixed"|"negative"} in ${lang}, then nothing else.`,
    "",
    "Personas:",
    ...input.personas.map(
      (persona) =>
        `- ${persona.name}: ${persona.summary} Values: ${persona.cares.join(", ")}. Objections: ${persona.objections.join(", ")}.`,
    ),
    "",
    `Question: ${input.question.slice(0, 4_000)}`,
  ].join("\n");
}

export function parsePanel(
  raw: string,
): Array<{ persona: string; answer: string; verdict: "positive" | "mixed" | "negative" }> {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10).flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const answer = text(record.answer, 1_000);
      if (answer === "") return [];
      const verdict =
        record.verdict === "positive" || record.verdict === "negative" ? record.verdict : "mixed";
      return [{ persona: text(record.persona, 80), answer, verdict }];
    });
  } catch {
    return [];
  }
}
