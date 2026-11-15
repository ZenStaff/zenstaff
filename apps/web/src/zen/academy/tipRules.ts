// Zen Staff Academy: contextual tips. A small rule list: when something happens (a paste into the
// composer, a message about to be sent, a page opened), the first matching rule suggests a lesson.
// To add a tip: add a rule here (and its title/description in academy.i18n.ts, en and ro).
import type { ZenEdition } from "@t3tools/contracts/zenOffice";

import type { AcademyStrings } from "./academy.i18n";
import { detectPersonalData, detectSecrets } from "./secretDetection";

export type TipTrigger = "paste" | "send" | "route";

export interface TipEvent {
  readonly trigger: TipTrigger;
  /** Pasted or typed text (paste, send). */
  readonly text?: string;
  /** Current path (route). */
  readonly path?: string;
  readonly edition: ZenEdition;
}

export interface TipRule {
  readonly id: string;
  /** The lesson the tip links to. */
  readonly lessonId: string;
  readonly triggers: ReadonlyArray<TipTrigger>;
  /** "once": never again after it was shown; otherwise at most once per `cooldownMs`. */
  readonly repeat: "once" | "cooldown";
  readonly cooldownMs?: number;
  readonly matches: (event: TipEvent) => boolean;
  readonly copy: (strings: AcademyStrings) => {
    readonly title: string;
    readonly description: string;
  };
}

export const ACADEMY_TIP_RULES: ReadonlyArray<TipRule> = [
  {
    id: "secret-pasted",
    lessonId: "office-data-safety",
    triggers: ["paste", "send"],
    repeat: "cooldown",
    cooldownMs: 60_000,
    matches: (event) => event.text !== undefined && detectSecrets(event.text).length > 0,
    copy: (strings) => strings.tips.secretPasted,
  },
  {
    id: "personal-data-pasted",
    lessonId: "office-data-safety",
    triggers: ["paste"],
    repeat: "cooldown",
    cooldownMs: 10 * 60_000,
    matches: (event) => event.text !== undefined && detectPersonalData(event.text).length > 0,
    copy: (strings) => strings.tips.personalData,
  },
  {
    id: "first-office",
    lessonId: "office-first-steps",
    triggers: ["route"],
    repeat: "once",
    matches: (event) => event.edition === "office" && event.path === "/office",
    copy: (strings) => strings.tips.firstOffice,
  },
];

/** When each tip was last shown, and the tips the person turned off. */
export interface TipHistory {
  readonly shownAt: Readonly<Record<string, number>>;
  readonly dismissed: ReadonlyArray<string>;
}

export const EMPTY_TIP_HISTORY: TipHistory = { shownAt: {}, dismissed: [] };

/** The first rule that matches and may show now, or null. */
export function matchTip(
  rules: ReadonlyArray<TipRule>,
  event: TipEvent,
  history: TipHistory,
  now: number,
  /** Lessons that exist; a tip for a missing lesson is skipped. Null = do not check. */
  lessonIds: ReadonlySet<string> | null = null,
): TipRule | null {
  for (const rule of rules) {
    if (!rule.triggers.includes(event.trigger)) continue;
    if (history.dismissed.includes(rule.id)) continue;
    if (lessonIds !== null && !lessonIds.has(rule.lessonId)) continue;
    const last = history.shownAt[rule.id];
    if (last !== undefined) {
      if (rule.repeat === "once") continue;
      if (now - last < (rule.cooldownMs ?? 60_000)) continue;
    }
    if (rule.matches(event)) return rule;
  }
  return null;
}

export function recordTipShown(history: TipHistory, ruleId: string, now: number): TipHistory {
  return { ...history, shownAt: { ...history.shownAt, [ruleId]: now } };
}

export function recordTipDismissed(history: TipHistory, ruleId: string): TipHistory {
  return history.dismissed.includes(ruleId)
    ? history
    : { ...history, dismissed: [...history.dismissed, ruleId] };
}
