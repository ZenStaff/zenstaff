// Zen Staff onboarding interview: the structured flow, the company profile and the suggestions
// (staff, connectors, first workflow) as pure functions shared by web and server. Its RPC
// `zen.onboarding.call` rides on ZEN_COMPANIES_RPCS. See ZEN.md ("Onboarding interview").
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { AuthOrchestrationOperateScope, EnvironmentAuthorizationError } from "./auth.ts";

export const ZEN_ONBOARDING_WS_METHODS = {
  call: "zen.onboarding.call",
} as const;

const ZEN_ONBOARDING_OPS = [
  "status",
  "get",
  "save",
  "dismissFirstRun",
  "prefill.website",
  "prefill.document",
  "profile.save",
  // Brand profile: the company's logo, saved in `<zen home>/companies/<id>/brand/`.
  "brand.setLogo",
] as const;
export type ZenOnboardingOp = (typeof ZEN_ONBOARDING_OPS)[number];

export const ZenOnboardingCallInput = Schema.Struct({
  op: Schema.Literals(ZEN_ONBOARDING_OPS),
  input: Schema.Unknown,
});
export type ZenOnboardingCallInput = typeof ZenOnboardingCallInput.Type;

export class ZenOnboardingError extends Schema.TaggedError<ZenOnboardingError>()(
  "ZenOnboardingError",
  {
    reason: Schema.Literals(["invalid-input", "not-found", "unreachable", "unavailable"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const ZenOnboardingCallRpc = Rpc.make(ZEN_ONBOARDING_WS_METHODS.call, {
  payload: ZenOnboardingCallInput,
  success: Schema.Unknown,
  error: Schema.Union([ZenOnboardingError, EnvironmentAuthorizationError]),
});

/** Spread into ZEN_COMPANIES_RPCS (so rpc.ts needs no new line). */
export const ZEN_ONBOARDING_RPCS = [ZenOnboardingCallRpc] as const;
export const ZEN_ONBOARDING_RPC_SCOPES = {
  [ZEN_ONBOARDING_WS_METHODS.call]: AuthOrchestrationOperateScope,
} as const;
export const ZEN_ONBOARDING_RPC_AGGREGATES = {
  [ZEN_ONBOARDING_WS_METHODS.call]: "zen",
} as const;

// The flow

export const ONBOARDING_STEPS = [
  "language",
  "who",
  "company",
  "offer",
  "voice",
  "tools",
  "timeSinks",
  "review",
  "staff",
  "connect",
  "edition",
  "workflow",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const ONBOARDING_WHO = ["freelancer", "small-team", "company"] as const;
export type OnboardingWho = (typeof ONBOARDING_WHO)[number];

export const ONBOARDING_TONES = [
  "warm",
  "friendly",
  "professional",
  "formal",
  "playful",
  "premium",
  "direct",
] as const;
export type OnboardingTone = (typeof ONBOARDING_TONES)[number];

/** Tools people pick as chips; most map to a connector in the catalog (`connectorId`). */
export const ONBOARDING_TOOLS: ReadonlyArray<{
  readonly id: string;
  readonly connectorId: string | null;
}> = [
  { id: "gmail", connectorId: "gmail" },
  { id: "outlook", connectorId: "outlook" },
  { id: "google-drive", connectorId: "google-drive" },
  { id: "onedrive", connectorId: "onedrive-sharepoint" },
  { id: "google-calendar", connectorId: "google-calendar" },
  { id: "facebook", connectorId: "meta-pages" },
  { id: "instagram", connectorId: "meta-pages" },
  { id: "google-business", connectorId: "google-business-profile" },
  { id: "smartbill", connectorId: "smartbill" },
  { id: "oblio", connectorId: "oblio" },
  { id: "saga", connectorId: "saga" },
  { id: "efactura", connectorId: "efactura-anaf" },
  { id: "shopify", connectorId: "shopify" },
  { id: "woocommerce", connectorId: "woocommerce" },
  { id: "whatsapp", connectorId: null },
  { id: "excel", connectorId: null },
  { id: "slack", connectorId: "slack" },
  { id: "teams", connectorId: "microsoft-teams" },
  { id: "trello", connectorId: "trello" },
  { id: "notion", connectorId: "notion" },
  { id: "hubspot", connectorId: "hubspot" },
  { id: "pipedrive", connectorId: "pipedrive" },
  { id: "horecaos", connectorId: "horecaos" },
  { id: "stripe", connectorId: "stripe" },
];

export const ONBOARDING_TIME_SINKS = [
  "social",
  "offers",
  "emails",
  "invoices",
  "reports",
  "reviews",
  "reservations",
  "video",
  "seo",
  "admin",
  "press",
] as const;
export type OnboardingTimeSink = (typeof ONBOARDING_TIME_SINKS)[number];

export interface OnboardingAnswers {
  readonly language?: "en" | "ro";
  readonly who?: OnboardingWho;
  readonly companyName?: string;
  readonly website?: string;
  readonly sells?: string;
  readonly customers?: string;
  readonly prices?: string;
  readonly tones?: ReadonlyArray<OnboardingTone>;
  readonly toneNotes?: string;
  readonly competitors?: string;
  readonly tools?: ReadonlyArray<string>;
  readonly toolsOther?: string;
  readonly timeSinks?: ReadonlyArray<OnboardingTimeSink>;
  readonly timeSinksOther?: string;
  readonly edition?: "office" | "code";
  /** Brand profile (the "Adaugă primul client" form): colors as #RRGGBB, up to 5. */
  readonly brandColors?: ReadonlyArray<string>;
  /** Free-text rules for everything written or designed for this company. */
  readonly rules?: string;
  /** File name of the logo in the company's brand folder (`brand/logo.png`). */
  readonly logo?: string;
}

/** Where a prefilled answer came from (shown next to it until the person edits it). */
export interface OnboardingPrefill {
  readonly source: "website" | "document";
  readonly label: string;
  readonly fields: Partial<
    Pick<
      OnboardingAnswers,
      "companyName" | "sells" | "customers" | "prices" | "competitors" | "toneNotes"
    >
  > & { readonly tones?: ReadonlyArray<OnboardingTone> };
  readonly at: string;
}

export interface OnboardingState {
  readonly companyId: string;
  readonly status: "not-started" | "in-progress" | "skipped" | "done";
  readonly step: OnboardingStep;
  readonly answers: OnboardingAnswers;
  readonly skippedSteps: ReadonlyArray<OnboardingStep>;
  readonly prefills: ReadonlyArray<OnboardingPrefill>;
  /** Documents the person gave (names; files are kept in the company folder). */
  readonly documents: ReadonlyArray<string>;
  readonly profileSavedAt: string | null;
  readonly memory: "hosted" | "local" | "file-only" | null;
  readonly hired: ReadonlyArray<string>;
  readonly connectorsOpened: ReadonlyArray<string>;
  readonly updatedAt: string;
}

export function initialOnboarding(companyId: string, now: string): OnboardingState {
  return {
    companyId,
    status: "not-started",
    // Language and edition are chosen on the first run (and in Settings): never asked again.
    step: "who",
    answers: {},
    skippedSteps: [],
    prefills: [],
    documents: [],
    profileSavedAt: null,
    memory: null,
    hired: [],
    connectorsOpened: [],
    updatedAt: now,
  };
}

/**
 * Steps that make sense with the answers so far (connect needs a tool that has a connector).
 * Language and edition are never asked: the first run and Settings already chose them.
 */
export function stepAvailable(step: OnboardingStep, answers: OnboardingAnswers): boolean {
  if (step === "language" || step === "edition") return false;
  if (step === "connect") return suggestConnectors(answers).length > 0;
  return true;
}

export function nextStep(step: OnboardingStep, answers: OnboardingAnswers): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  for (const candidate of ONBOARDING_STEPS.slice(index + 1)) {
    if (stepAvailable(candidate, answers)) return candidate;
  }
  return "done";
}

function previousStep(step: OnboardingStep, answers: OnboardingAnswers): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  for (const candidate of ONBOARDING_STEPS.slice(0, Math.max(0, index)).reverse()) {
    if (stepAvailable(candidate, answers)) return candidate;
  }
  return "who";
}

const clean = (value: string | undefined, max: number) =>
  value === undefined ? undefined : value.replace(/\s+$/g, "").slice(0, max);

/** Keeps known fields only, trimmed to sane lengths (the server stores what this returns). */
export function sanitizeAnswers(raw: unknown): OnboardingAnswers {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const str = (key: string, max: number) =>
    typeof input[key] === "string" ? clean(input[key] as string, max) : undefined;
  const pick = <T extends string>(key: string, allowed: ReadonlyArray<T>): T | undefined =>
    typeof input[key] === "string" &&
    (allowed as ReadonlyArray<string>).includes(input[key] as string)
      ? (input[key] as T)
      : undefined;
  const many = <T extends string>(key: string, allowed: ReadonlyArray<T> | null, max: number) =>
    Array.isArray(input[key])
      ? ([
          ...new Set(
            (input[key] as unknown[]).filter(
              (item): item is T =>
                typeof item === "string" &&
                item.length <= 60 &&
                (allowed === null || (allowed as ReadonlyArray<string>).includes(item)),
            ),
          ),
        ].slice(0, max) as T[])
      : undefined;
  const answers: Record<string, unknown> = {
    language: pick("language", ["en", "ro"] as const),
    who: pick("who", ONBOARDING_WHO),
    companyName: str("companyName", 80),
    website: str("website", 300),
    sells: str("sells", 2000),
    customers: str("customers", 2000),
    prices: str("prices", 6000),
    tones: many("tones", ONBOARDING_TONES, 4),
    toneNotes: str("toneNotes", 1000),
    competitors: str("competitors", 1000),
    tools: many(
      "tools",
      ONBOARDING_TOOLS.map((tool) => tool.id),
      30,
    ),
    toolsOther: str("toolsOther", 500),
    timeSinks: many("timeSinks", ONBOARDING_TIME_SINKS, 11),
    timeSinksOther: str("timeSinksOther", 500),
    edition: pick("edition", ["office", "code"] as const),
    brandColors: Array.isArray(input.brandColors)
      ? [
          ...new Set(
            (input.brandColors as unknown[])
              .filter(
                (item): item is string =>
                  typeof item === "string" && /^#[0-9a-fA-F]{6}$/.test(item),
              )
              .map((item) => item.toUpperCase()),
          ),
        ].slice(0, 5)
      : undefined,
    rules: str("rules", 3000),
    logo: (() => {
      const value = str("logo", 40);
      return value !== undefined && /^logo\.(png|jpe?g|webp|gif)$/.test(value) ? value : undefined;
    })(),
  };
  return Object.fromEntries(
    Object.entries(answers).filter(([, value]) => value !== undefined),
  ) as OnboardingAnswers;
}

/** Answers a step and moves on. Resumable: the state is saved after every step. */
export function answerStep(
  state: OnboardingState,
  step: OnboardingStep,
  patch: OnboardingAnswers,
  now: string,
): OnboardingState {
  const answers = sanitizeAnswers({ ...state.answers, ...patch });
  const next = nextStep(step, answers);
  return {
    ...state,
    status: next === "done" ? "done" : "in-progress",
    step: next,
    answers,
    skippedSteps: state.skippedSteps.filter((item) => item !== step),
    updatedAt: now,
  };
}

/** Skips one question (it stays empty and can be answered later in company settings). */
export function skipStep(
  state: OnboardingState,
  step: OnboardingStep,
  now: string,
): OnboardingState {
  const next = nextStep(step, state.answers);
  return {
    ...state,
    status: next === "done" ? "done" : "in-progress",
    step: next,
    skippedSteps: state.skippedSteps.includes(step)
      ? state.skippedSteps
      : [...state.skippedSteps, step],
    updatedAt: now,
  };
}

export function goBack(state: OnboardingState, now: string): OnboardingState {
  return { ...state, step: previousStep(state.step, state.answers), updatedAt: now };
}

/** "Later": the whole interview is put aside; it can be resumed from company settings. */
export function skipInterview(state: OnboardingState, now: string): OnboardingState {
  return { ...state, status: state.status === "done" ? "done" : "skipped", updatedAt: now };
}

/** Opens a finished or skipped interview again (company settings > Company profile). */
export function reopenInterview(
  state: OnboardingState,
  step: OnboardingStep,
  now: string,
): OnboardingState {
  return { ...state, status: "in-progress", step, updatedAt: now };
}

/** Applies prefill fields to the answers the person has not given yet. */
export function applyPrefill(state: OnboardingState, prefill: OnboardingPrefill): OnboardingState {
  const answers: Record<string, unknown> = { ...state.answers };
  for (const [key, value] of Object.entries(prefill.fields)) {
    const current = answers[key];
    const empty =
      current === undefined ||
      (typeof current === "string" && current.trim() === "") ||
      (Array.isArray(current) && current.length === 0);
    if (empty && value !== undefined) answers[key] = value;
  }
  return {
    ...state,
    answers: sanitizeAnswers(answers),
    prefills: [...state.prefills.filter((item) => item.label !== prefill.label), prefill].slice(
      -10,
    ),
    updatedAt: prefill.at,
  };
}

export function onboardingProgress(state: OnboardingState): number {
  if (state.status === "done") return 1;
  const visible = ONBOARDING_STEPS.filter((step) => stepAvailable(step, state.answers));
  const index = Math.max(0, visible.indexOf(state.step));
  return index / Math.max(1, visible.length - 1);
}

export function sanitizeState(raw: unknown, companyId: string, now: string): OnboardingState {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const base = initialOnboarding(companyId, now);
  const step =
    typeof input.step === "string" &&
    (ONBOARDING_STEPS as ReadonlyArray<string>).includes(input.step)
      ? (input.step as OnboardingStep)
      : base.step;
  // A saved interview that stopped on a question no longer asked resumes at the next one.
  const resumeStep =
    stepAvailable(step, sanitizeAnswers(input.answers)) || step === "done"
      ? step
      : nextStep(step, sanitizeAnswers(input.answers));
  const status =
    input.status === "in-progress" || input.status === "skipped" || input.status === "done"
      ? input.status
      : base.status;
  const strings = (value: unknown, max: number) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string" && item.length <= 120)
          .slice(0, max)
      : [];
  const prefills = Array.isArray(input.prefills)
    ? input.prefills
        .filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
        )
        .slice(-10)
        .map((item) => {
          const fields = sanitizeAnswers(item.fields);
          return {
            source: item.source === "document" ? ("document" as const) : ("website" as const),
            label: typeof item.label === "string" ? item.label.slice(0, 200) : "",
            fields: {
              ...(fields.companyName ? { companyName: fields.companyName } : {}),
              ...(fields.sells ? { sells: fields.sells } : {}),
              ...(fields.customers ? { customers: fields.customers } : {}),
              ...(fields.prices ? { prices: fields.prices } : {}),
              ...(fields.competitors ? { competitors: fields.competitors } : {}),
              ...(fields.toneNotes ? { toneNotes: fields.toneNotes } : {}),
              ...(fields.tones ? { tones: fields.tones } : {}),
            },
            at: typeof item.at === "string" ? item.at : now,
          };
        })
    : [];
  const memory =
    input.memory === "hosted" || input.memory === "local" || input.memory === "file-only"
      ? input.memory
      : null;
  return {
    companyId,
    status,
    step: resumeStep,
    answers: sanitizeAnswers(input.answers),
    skippedSteps: strings(input.skippedSteps, 20).filter((item): item is OnboardingStep =>
      (ONBOARDING_STEPS as ReadonlyArray<string>).includes(item),
    ),
    prefills,
    documents: strings(input.documents, 20),
    profileSavedAt: typeof input.profileSavedAt === "string" ? input.profileSavedAt : null,
    memory,
    hired: strings(input.hired, 10),
    connectorsOpened: strings(input.connectorsOpened, 30),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now,
  };
}

// The profile

const TONE_WORDS: Readonly<Record<OnboardingTone, { en: string; ro: string }>> = {
  warm: { en: "warm", ro: "cald" },
  friendly: { en: "friendly", ro: "prietenos" },
  professional: { en: "professional", ro: "profesionist" },
  formal: { en: "formal", ro: "formal" },
  playful: { en: "playful", ro: "jucăuș" },
  premium: { en: "premium", ro: "premium" },
  direct: { en: "direct", ro: "direct" },
};

const TONE_RULES: Readonly<Record<OnboardingTone, { en: string; ro: string }>> = {
  warm: {
    en: "Write like a person who knows the customer: kind, close, never pushy.",
    ro: "Scrie ca un om care își cunoaște clientul: cald, apropiat, niciodată insistent.",
  },
  friendly: {
    en: "Short sentences, simple words, a friendly greeting.",
    ro: "Fraze scurte, cuvinte simple, un salut prietenos.",
  },
  professional: {
    en: "Clear and precise; facts, prices and dates first.",
    ro: "Clar și precis; întâi faptele, prețurile și datele.",
  },
  formal: {
    en: "Formal address, no slang, no emoji.",
    ro: "Adresare cu „dumneavoastră”, fără argou, fără emoji.",
  },
  playful: {
    en: "Light and playful, a little humour, still respectful.",
    ro: "Lejer și jucăuș, puțin umor, dar respectuos.",
  },
  premium: {
    en: "Calm and confident; quality and care over discounts.",
    ro: "Calm și sigur; calitatea și grija înaintea reducerilor.",
  },
  direct: {
    en: "Get to the point; one idea per sentence; clear next step.",
    ro: "Direct la subiect; o idee pe frază; pasul următor clar.",
  },
};

const SINK_LABEL: Readonly<Record<OnboardingTimeSink, { en: string; ro: string }>> = {
  social: { en: "social media posts", ro: "postări pe rețelele sociale" },
  offers: { en: "offers and quotes", ro: "oferte și cotații" },
  emails: { en: "answering e-mails", ro: "răspunsuri la e-mailuri" },
  invoices: { en: "invoices and payments", ro: "facturi și încasări" },
  reports: { en: "reports", ro: "rapoarte" },
  reviews: { en: "reviews and customer messages", ro: "recenzii și mesaje de la clienți" },
  reservations: { en: "reservations and orders", ro: "rezervări și comenzi" },
  video: { en: "video and reels", ro: "video și reels" },
  seo: { en: "website content and SEO", ro: "conținut pentru site și SEO" },
  admin: { en: "admin and paperwork", ro: "administrativ și hârtii" },
  press: { en: "press and PR", ro: "presă și PR" },
};

const WHO_LABEL: Readonly<Record<OnboardingWho, { en: string; ro: string }>> = {
  freelancer: { en: "a freelancer", ro: "freelancer" },
  "small-team": { en: "a small team", ro: "o echipă mică" },
  company: { en: "a company", ro: "o companie" },
};

export function toolLabel(id: string): string {
  const names: Record<string, string> = {
    gmail: "Gmail",
    outlook: "Outlook / Microsoft 365",
    "google-drive": "Google Drive",
    onedrive: "OneDrive / SharePoint",
    "google-calendar": "Google Calendar",
    facebook: "Facebook",
    instagram: "Instagram",
    "google-business": "Google Business Profile",
    smartbill: "SmartBill",
    oblio: "Oblio",
    saga: "Saga",
    efactura: "e-Factura (SPV)",
    shopify: "Shopify",
    woocommerce: "WooCommerce",
    whatsapp: "WhatsApp",
    excel: "Excel",
    slack: "Slack",
    teams: "Microsoft Teams",
    trello: "Trello",
    notion: "Notion",
    hubspot: "HubSpot",
    pipedrive: "Pipedrive",
    horecaos: "HoReCaOS",
    stripe: "Stripe",
  };
  return names[id] ?? id;
}

export interface CompanyProfile {
  /** The whole `company-profile.md`. */
  readonly markdown: string;
  /** The brand voice section on its own (for agents' instructions). */
  readonly brandVoice: string;
  /** What goes to company memory: a dense summary, no headings. */
  readonly memoryText: string;
}

/** The company profile and brand voice, in the person's language. Empty answers are left out. */
export function buildCompanyProfile(
  answers: OnboardingAnswers,
  locale: "en" | "ro",
  date: string,
): CompanyProfile {
  const ro = locale === "ro";
  const name = answers.companyName?.trim() || (ro ? "Compania" : "The company");
  const tones = answers.tones ?? [];
  const toneWords = tones.map((tone) => TONE_WORDS[tone][locale]);
  const rules = tones.map((tone) => `- ${TONE_RULES[tone][locale]}`);
  const tools = [
    ...(answers.tools ?? []).map(toolLabel),
    ...(answers.toolsOther?.trim() ? [answers.toolsOther.trim()] : []),
  ];
  const sinks = [
    ...(answers.timeSinks ?? []).map((sink) => SINK_LABEL[sink][locale]),
    ...(answers.timeSinksOther?.trim() ? [answers.timeSinksOther.trim()] : []),
  ];
  const section = (title: string, body: string | undefined | null) =>
    body && body.trim() !== "" ? [`## ${title}`, "", body.trim(), ""] : [];
  const brandVoiceLines = [
    ...(toneWords.length > 0
      ? [ro ? `Tonul: ${toneWords.join(", ")}.` : `Tone: ${toneWords.join(", ")}.`]
      : []),
    ...rules,
    ...(answers.toneNotes?.trim() ? [answers.toneNotes.trim()] : []),
    ro
      ? "- Folosește diacriticele corecte (ș, ț cu virgulă). Nu inventa prețuri sau promisiuni: ia-le din lista de prețuri de mai jos."
      : "- Never invent prices or promises: take them from the price list below.",
  ];
  const brandVoice = brandVoiceLines.join("\n");
  const markdown = [
    `# ${name}`,
    "",
    ro
      ? `Profilul companiei, din interviul de început (${date}). Agenții îl citesc înainte de orice text pentru clienți.`
      : `Company profile from the onboarding interview (${date}). Agents read it before writing anything for customers.`,
    "",
    ...section(
      ro ? "Cine suntem" : "Who we are",
      answers.who
        ? ro
          ? `Suntem ${WHO_LABEL[answers.who].ro}.`
          : `We are ${WHO_LABEL[answers.who].en}.`
        : null,
    ),
    ...section(ro ? "Ce vindem" : "What we sell", answers.sells),
    ...section(ro ? "Clienții noștri" : "Our customers", answers.customers),
    ...section(ro ? "Prețuri" : "Prices", answers.prices),
    ...section(ro ? "Vocea brandului" : "Brand voice", brandVoice),
    ...section(ro ? "Reguli" : "Rules", answers.rules),
    ...section(
      ro ? "Identitate vizuală" : "Visual identity",
      [
        ...(answers.brandColors !== undefined && answers.brandColors.length > 0
          ? [
              ro
                ? `- Culorile brandului: ${answers.brandColors.join(", ")} (prima e culoarea principală).`
                : `- Brand colors: ${answers.brandColors.join(", ")} (the first is the main one).`,
            ]
          : []),
        ...(answers.logo
          ? [
              ro
                ? `- Logo: \`brand/${answers.logo}\` în dosarul companiei.`
                : `- Logo: \`brand/${answers.logo}\` in the company folder.`,
            ]
          : []),
      ].join("\n") || null,
    ),
    ...section(ro ? "Concurenți" : "Competitors", answers.competitors),
    ...section(ro ? "Site" : "Website", answers.website),
    ...section(
      ro ? "Unelte folosite" : "Tools we use",
      tools.length > 0 ? tools.map((tool) => `- ${tool}`).join("\n") : null,
    ),
    ...section(
      ro ? "Ce ne ia cel mai mult timp" : "What takes the most time",
      sinks.length > 0 ? sinks.map((sink) => `- ${sink}`).join("\n") : null,
    ),
  ]
    .join("\n")
    .trim()
    .concat("\n");
  const memoryParts = [
    ro ? `Profilul companiei ${name}` : `Company profile of ${name}`,
    answers.who
      ? ro
        ? `tip: ${WHO_LABEL[answers.who].ro}`
        : `kind: ${WHO_LABEL[answers.who].en}`
      : null,
    answers.sells ? `${ro ? "vinde" : "sells"}: ${answers.sells.trim()}` : null,
    answers.customers ? `${ro ? "clienți" : "customers"}: ${answers.customers.trim()}` : null,
    answers.prices ? `${ro ? "prețuri" : "prices"}: ${answers.prices.trim()}` : null,
    toneWords.length > 0 || answers.toneNotes
      ? `${ro ? "vocea brandului" : "brand voice"}: ${[toneWords.join(", "), answers.toneNotes?.trim()].filter(Boolean).join("; ")}`
      : null,
    answers.competitors
      ? `${ro ? "concurenți" : "competitors"}: ${answers.competitors.trim()}`
      : null,
    answers.website ? `${ro ? "site" : "website"}: ${answers.website.trim()}` : null,
    answers.rules ? `${ro ? "reguli" : "rules"}: ${answers.rules.trim()}` : null,
    answers.brandColors !== undefined && answers.brandColors.length > 0
      ? `${ro ? "culori de brand" : "brand colors"}: ${answers.brandColors.join(", ")}`
      : null,
    tools.length > 0 ? `${ro ? "unelte" : "tools"}: ${tools.join(", ")}` : null,
    sinks.length > 0
      ? `${ro ? "consumă cel mai mult timp" : "most time goes to"}: ${sinks.join(", ")}`
      : null,
  ].filter((part): part is string => part !== null);
  return { markdown, brandVoice, memoryText: `${memoryParts.join(". ")}.`.slice(0, 6000) };
}

// Suggestions

/** Connector ids to offer (from the tools picked), catalog order, no duplicates. */
export function suggestConnectors(answers: OnboardingAnswers): string[] {
  const picked = new Set(answers.tools ?? []);
  return [
    ...new Set(
      ONBOARDING_TOOLS.filter((tool) => picked.has(tool.id) && tool.connectorId !== null).map(
        (tool) => tool.connectorId!,
      ),
    ),
  ].slice(0, 6);
}

const ROLE_BY_SINK: Readonly<Record<OnboardingTimeSink, ReadonlyArray<string>>> = {
  social: ["social-media-manager"],
  offers: ["sales-assistant"],
  emails: ["customer-support-reviews", "admin-assistant"],
  invoices: ["junior-accountant"],
  reports: ["report-analyst"],
  reviews: ["customer-support-reviews"],
  reservations: ["horeca-reservations"],
  video: ["video-reels"],
  seo: ["seo-content"],
  admin: ["admin-assistant"],
  press: ["pr-communication"],
};

const HORECA =
  /\b(restaurant|bistro|cafenea|cafe|caf[eé]|brut[aă]ri|patiser|cofet[aă]ri|bakery|pizz|hotel|pensiune|catering|horeca|bar\b|meniu|men[uú]|bucat[aă]ri)/i;

/** 3 to 5 AI staff roles (catalog ids) for what takes the most time, with a sensible fill. */
export function suggestStaffRoles(answers: OnboardingAnswers): string[] {
  const roles: string[] = [];
  const add = (role: string) => {
    if (!roles.includes(role)) roles.push(role);
  };
  for (const sink of answers.timeSinks ?? []) for (const role of ROLE_BY_SINK[sink]) add(role);
  const about = `${answers.sells ?? ""} ${answers.customers ?? ""} ${answers.companyName ?? ""}`;
  const tools = new Set(answers.tools ?? []);
  if (HORECA.test(about) || tools.has("horecaos")) add("horeca-reservations");
  if (tools.has("smartbill") || tools.has("oblio") || tools.has("saga") || tools.has("efactura"))
    add("junior-accountant");
  if (tools.has("facebook") || tools.has("instagram")) add("social-media-manager");
  if (tools.has("google-business")) add("customer-support-reviews");
  for (const fallback of [
    "social-media-manager",
    "customer-support-reviews",
    "sales-assistant",
    "admin-assistant",
  ])
    if (roles.length < 3) add(fallback);
  return roles.slice(0, 5);
}

export interface FirstWorkflowSuggestion {
  readonly workflowId: string;
  /** Sample answers for the workflow's form, from the profile. */
  readonly values: Readonly<Record<string, string>>;
}

const firstLine = (value: string | undefined, max = 200) =>
  (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "")
    ?.slice(0, max) ?? "";

/** The first workflow to try, with its form prefilled from the interview. */
export function suggestFirstWorkflow(
  answers: OnboardingAnswers,
  locale: "en" | "ro",
): FirstWorkflowSuggestion {
  const ro = locale === "ro";
  const name = answers.companyName?.trim() || (ro ? "compania noastră" : "our company");
  const sells = firstLine(answers.sells, 300) || (ro ? "produsele noastre" : "our products");
  const customers = firstLine(answers.customers, 200) || (ro ? "clienții noștri" : "our customers");
  const tones = answers.tones ?? [];
  const sinks = answers.timeSinks ?? [];
  const formal = tones.includes("formal") || tones.includes("professional");
  // Select answers are the workflow's own option values (shown translated in the form).
  const socialTone = formal ? "Professional" : tones.includes("playful") ? "Playful" : "Friendly";
  if (sinks[0] === "offers" || (sinks.includes("offers") && !sinks.includes("social"))) {
    return {
      workflowId: "client-offer-email",
      values: {
        client: ro ? "Un client nou (exemplu)" : "A new customer (example)",
        need: ro ? `Vrea o ofertă pentru ${sells}.` : `Wants an offer for ${sells}.`,
        offer: firstLine(answers.prices, 400) || sells,
        tone: tones.includes("formal")
          ? "Formal"
          : tones.includes("direct")
            ? "Short and direct"
            : "Friendly professional",
      },
    };
  }
  if (sinks[0] === "press") {
    return {
      workflowId: "press-release",
      values: {
        news: ro
          ? `${name} lansează o noutate: ${sells}.`
          : `${name} launches something new: ${sells}.`,
        organization: name,
        versions: ro ? "Only Romanian" : "Only English",
      },
    };
  }
  if (sinks[0] === "video") {
    return {
      workflowId: "video-script-shot-list",
      values: {
        subject: ro
          ? `Un clip despre ${sells} pentru ${customers}.`
          : `A clip about ${sells} for ${customers}.`,
        goal: ro ? "Mai mulți clienți noi" : "More new customers",
        platform: "Instagram Reels / TikTok (vertical)",
        length: "30 seconds",
        resources: "Phone only",
      },
    };
  }
  return {
    workflowId: "social-media-post-set",
    values: {
      topic: ro ? `${name}: ${sells}` : `${name}: ${sells}`,
      audience: customers,
      networks: "Instagram + Facebook",
      tone: socialTone,
      posts: "3",
      language: ro ? "română" : "English",
    },
  };
}
