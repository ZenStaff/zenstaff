// Zen Staff Academy: local learning signals (docs/zen-academy-learning.md). Opt-in, off by default.
// Only topic labels from a fixed list and sanitized no-result searches are counted, on this device;
// nothing is sent in this version. `collectAcademySignals()` is the seam the hub will call.
import { useSyncExternalStore } from "react";

import { detectPersonalData, looksLikeSecret } from "./secretDetection";
import {
  EMPTY_OUTCOME_TRACKER,
  observeOutcomes,
  parseOutcomeTracker,
  type OutcomeEvent,
  type OutcomeThread,
} from "./taskOutcomes";

/** Fixed topic labels with the words (English and Romanian, accents folded) that point to them. */
const ACADEMY_TOPICS: ReadonlyArray<{
  readonly label: string;
  readonly words: ReadonlyArray<string>;
}> = [
  {
    label: "spreadsheets",
    words: ["excel", "xlsx", "csv", "spreadsheet", "tabel", "foaie de calcul", "pivot"],
  },
  { label: "reports", words: ["report", "raport", "dashboard", "kpi", "summary of", "sinteza"] },
  { label: "press-release", words: ["press release", "comunicat", "press kit"] },
  {
    label: "social-media",
    words: ["instagram", "facebook", "linkedin", "tiktok", "social media", "postare", "post set"],
  },
  { label: "email", words: ["email", "e-mail", "newsletter", "mail catre", "reply to"] },
  { label: "translation", words: ["translate", "traduce", "traducere", "localize"] },
  { label: "presentations", words: ["presentation", "prezentare", "slides", "pptx", "deck"] },
  { label: "meetings", words: ["meeting", "sedinta", "minuta", "agenda", "action items"] },
  {
    label: "contracts-legal",
    words: ["contract", "clauza", "terms and conditions", "nda", "legal"],
  },
  {
    label: "invoices-finance",
    words: ["invoice", "factura", "budget", "buget", "cash flow", "accounting", "contabil"],
  },
  {
    label: "personal-data",
    words: ["gdpr", "personal data", "date personale", "cnp", "anonymiz", "privacy"],
  },
  {
    label: "passwords-secrets",
    words: ["password", "parola", "api key", "secret", "token", "credential"],
  },
  { label: "workflows", words: ["workflow", "template", "sablon", "automat", "automation"] },
  {
    label: "connect-app",
    words: ["conecteaza", "connect", "google drive", "gmail", "slack", "notion", "mcp"],
  },
  {
    label: "design-images",
    words: ["poster", "banner", "logo", "image", "imagine", "design", "afis"],
  },
  { label: "video", words: ["video", "youtube", "reel", "script video", "subtitle"] },
  {
    label: "security-audit",
    words: ["security audit", "audit de securitate", "vulnerab", "owasp", "pentest"],
  },
  { label: "database-rls", words: ["rls", "row level security", "supabase", "postgres", "policy"] },
  { label: "auth-sessions", words: ["auth", "login", "jwt", "session", "cookie", "oauth"] },
  {
    label: "dependencies",
    words: ["dependency", "dependencies", "npm audit", "cve", "package.json", "supply chain"],
  },
  { label: "prompt-injection", words: ["prompt injection", "jailbreak", "injectie"] },
  { label: "code-review", words: ["code review", "review the diff", "pull request", "diff"] },
  { label: "testing", words: ["unit test", "tests", "teste", "vitest", "jest", "playwright"] },
  { label: "deploy", words: ["deploy", "production", "productie", "docker", "ci/cd"] },
];

function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** The topic labels a message is about (each at most once). No content is kept. */
export function topicLabelsFor(text: string): ReadonlyArray<string> {
  const folded = ` ${foldText(text).replace(/\s+/g, " ")} `;
  return ACADEMY_TOPICS.filter((topic) =>
    topic.words.some((word) =>
      word.length <= 4
        ? new RegExp(`[^a-z0-9]${word}[^a-z0-9]`).test(folded)
        : folded.includes(word),
    ),
  ).map((topic) => topic.label);
}

/**
 * A no-result search reduced to plain words: no numbers, emails, links or secret-looking text,
 * at most 5 words and 40 characters. Null when nothing safe is left.
 */
export function sanitizeSearchQuery(query: string): string | null {
  if (looksLikeSecret(query) || detectPersonalData(query).length > 0) return null;
  const words = foldText(query)
    .replace(/\S+@\S+/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && word.length <= 20)
    .slice(0, 5);
  const text = words.join(" ").slice(0, 40).trim();
  return text.length >= 3 ? text : null;
}

export interface AcademySignals {
  /** ISO time counting started (or was last cleared). */
  readonly since: string;
  readonly topics: Readonly<Record<string, number>>;
  readonly noResultSearches: Readonly<Record<string, number>>;
  /** Tasks with a failed run, by topic label of the task title. */
  readonly failedTasks: Readonly<Record<string, number>>;
  /** Tasks with more than 3 follow-up corrections, by topic label. */
  readonly correctedTasks: Readonly<Record<string, number>>;
}

const MAX_SEARCH_KEYS = 200;

export function emptySignals(since: string): AcademySignals {
  return { since, topics: {}, noResultSearches: {}, failedTasks: {}, correctedTasks: {} };
}

/** Adds failed / heavily corrected task events (labels only). */
export function addOutcomes(
  signals: AcademySignals,
  events: ReadonlyArray<OutcomeEvent>,
): AcademySignals {
  if (events.length === 0) return signals;
  const failedTasks = { ...signals.failedTasks };
  const correctedTasks = { ...signals.correctedTasks };
  for (const event of events) {
    const target = event.kind === "failed" ? failedTasks : correctedTasks;
    for (const label of event.labels) target[label] = (target[label] ?? 0) + 1;
  }
  return { ...signals, failedTasks, correctedTasks };
}

export function addTopics(signals: AcademySignals, labels: ReadonlyArray<string>): AcademySignals {
  if (labels.length === 0) return signals;
  const topics = { ...signals.topics };
  for (const label of labels) topics[label] = (topics[label] ?? 0) + 1;
  return { ...signals, topics };
}

export function addNoResultSearch(signals: AcademySignals, query: string): AcademySignals {
  const clean = sanitizeSearchQuery(query);
  if (clean === null) return signals;
  const existing = signals.noResultSearches[clean];
  if (existing === undefined && Object.keys(signals.noResultSearches).length >= MAX_SEARCH_KEYS) {
    return signals;
  }
  return {
    ...signals,
    noResultSearches: { ...signals.noResultSearches, [clean]: (existing ?? 0) + 1 },
  };
}

function parseSignals(raw: string | null, now: string): AcademySignals {
  if (!raw) return emptySignals(now);
  try {
    const value = JSON.parse(raw) as Partial<AcademySignals>;
    const counts = (record: unknown) =>
      Object.fromEntries(
        Object.entries(typeof record === "object" && record !== null ? record : {}).filter(
          (entry): entry is [string, number] => typeof entry[1] === "number",
        ),
      );
    return {
      since: typeof value.since === "string" ? value.since : now,
      topics: counts(value.topics),
      noResultSearches: counts(value.noResultSearches),
      failedTasks: counts(value.failedTasks),
      correctedTasks: counts(value.correctedTasks),
    };
  } catch {
    return emptySignals(now);
  }
}

// Store (per device).

const OPT_IN_KEY = "zen:academy:help-improve";
const SIGNALS_KEY = "zen:academy:signals";
const OUTCOMES_KEY = "zen:academy:outcomes";
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Signals are best effort.
  }
}

let optedIn = read(OPT_IN_KEY) === "1";
let signals = parseSignals(read(SIGNALS_KEY), new Date().toISOString());
let snapshot = { optedIn, signals };
let outcomeTracker = parseOutcomeTracker(read(OUTCOMES_KEY));

function emit() {
  snapshot = { optedIn, signals };
  for (const listener of listeners) listener();
}

/** The Settings toggle. Turning it off also clears what was counted. */
export function setHelpImproveAcademy(on: boolean): void {
  optedIn = on;
  write(OPT_IN_KEY, on ? "1" : null);
  if (!on) clearAcademySignals();
  else emit();
}

export function clearAcademySignals(): void {
  signals = emptySignals(new Date().toISOString());
  outcomeTracker = EMPTY_OUTCOME_TRACKER;
  write(SIGNALS_KEY, null);
  write(OUTCOMES_KEY, null);
  emit();
}

function save(next: AcademySignals) {
  if (next === signals) return;
  signals = next;
  write(SIGNALS_KEY, JSON.stringify(signals));
  emit();
}

/** Counts the topic labels of a sent message. Does nothing unless the person opted in. */
export function recordAskedTopics(text: string): void {
  if (!optedIn) return;
  save(addTopics(signals, topicLabelsFor(text)));
}

/**
 * Counts tasks that failed or needed many corrections, from the thread list the app already has.
 * Does nothing unless the person opted in.
 */
export function recordThreadOutcomes(threads: ReadonlyArray<OutcomeThread>): void {
  if (!optedIn) return;
  const result = observeOutcomes(outcomeTracker, threads, topicLabelsFor, Date.now());
  if (result.tracker !== outcomeTracker) {
    outcomeTracker = result.tracker;
    write(OUTCOMES_KEY, JSON.stringify(outcomeTracker));
  }
  save(addOutcomes(signals, result.events));
}

/** Counts an Academy search with no result. Does nothing unless the person opted in. */
export function recordNoResultSearch(query: string): boolean {
  if (!optedIn) return false;
  save(addNoResultSearch(signals, query));
  return sanitizeSearchQuery(query) !== null;
}

/**
 * The hub seam: what this device would share, only labels and counts. Null when the person has
 * not opted in. The hub adds company opt-in, aggregation across devices and human review.
 */
export function collectAcademySignals(): AcademySignals | null {
  return optedIn ? signals : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAcademySignals(): {
  readonly optedIn: boolean;
  readonly signals: AcademySignals;
} {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
