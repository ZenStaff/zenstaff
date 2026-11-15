// Zen Staff Academy: watches for moments a lesson helps (a paste or a message in the composer, a
// page opened) and shows the first matching tip from tipRules.ts as a toast. Listens on the
// document, so the upstream composer needs no change. Also counts topic labels of sent messages
// for the local learning signals (only when the person opted in; signals.ts).
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { GraduationCapIcon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";

import { toastManager } from "../../components/ui/toast";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useQuietThreadShells } from "../../state/entities";
import { getZenEdition } from "../office/officeState";
import { academyLessons, lessonsInput } from "./academyState";
import { recordAskedTopics, recordThreadOutcomes, useAcademySignals } from "./signals";
import { academyStrings } from "./academy.i18n";
import {
  ACADEMY_TIP_RULES,
  EMPTY_TIP_HISTORY,
  matchTip,
  recordTipDismissed,
  recordTipShown,
  type TipEvent,
  type TipHistory,
} from "./tipRules";

const HISTORY_KEY = "zen:academy:tips";
const COMPOSER_EDITOR = '[data-testid="composer-editor"]';
const COMPOSER_FORM = '[data-chat-composer-form="true"]';

function readHistory(): TipHistory {
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_KEY);
    if (!raw) return EMPTY_TIP_HISTORY;
    const value = JSON.parse(raw) as Partial<TipHistory>;
    return {
      shownAt: typeof value.shownAt === "object" && value.shownAt !== null ? value.shownAt : {},
      dismissed: Array.isArray(value.dismissed) ? value.dismissed : [],
    };
  } catch {
    return EMPTY_TIP_HISTORY;
  }
}

function writeHistory(history: TipHistory) {
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Tips may repeat in a private window; harmless.
  }
}

function composerEditorOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const editor = target.closest<HTMLElement>(COMPOSER_EDITOR);
  if (editor) return editor;
  return target.closest(COMPOSER_FORM)?.querySelector<HTMLElement>(COMPOSER_EDITOR) ?? null;
}

export function AcademyTipsHost() {
  const environmentId = usePrimaryEnvironmentId();
  const { optedIn } = useAcademySignals();
  return environmentId === null ? null : (
    <>
      <TipsWatcher environmentId={environmentId} />
      {optedIn ? <TaskOutcomeWatcher /> : null}
    </>
  );
}

/** Counts failed / heavily corrected tasks (labels only) while "Help improve" is on. */
function TaskOutcomeWatcher() {
  const threads = useQuietThreadShells();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds the opt-in signal store (localStorage) from the live thread list
  useEffect(() => {
    recordThreadOutcomes(
      threads.map((thread) => ({
        id: `${thread.environmentId}:${thread.id}`,
        title: thread.title,
        latestRun: thread.latestRun,
      })),
    );
  }, [threads]);
  return null;
}

function TipsWatcher(props: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const lessonsResult = useAtomValue(
    academyLessons({ environmentId: props.environmentId, input: lessonsInput(null) }),
  );
  const lessonIds = AsyncResult.isSuccess(lessonsResult)
    ? new Set(lessonsResult.value.lessons.map((lesson) => lesson.manifest.id))
    : null;
  const consider = useStableCallback((event: TipEvent) => {
    // Before the lesson list loads, text tips still show (they link by id); route tips wait below.
    const history = readHistory();
    const now = Date.now();
    const rule = matchTip(ACADEMY_TIP_RULES, event, history, now, lessonIds);
    if (!rule) return;
    writeHistory(recordTipShown(history, rule.id, now));
    const strings = academyStrings();
    const copy = rule.copy(strings);
    const toastId = toastManager.add({
      type: "info",
      title: copy.title,
      description: (
        <span className="block pt-0.5 leading-relaxed text-pretty">{copy.description}</span>
      ),
      timeout: 15_000,
      data: {
        hideCopyButton: true,
        // Buttons under the text, right-aligned: side by side they squeezed the text into a
        // narrow column (two buttons in a 360 px toast).
        actionLayout: "stacked-end",
        secondaryActionVariant: "ghost",
        leadingIcon: <GraduationCapIcon aria-hidden className="size-4 text-info-foreground" />,
        secondaryActionProps: {
          children: strings.tipDismiss,
          className: "whitespace-nowrap",
          onClick: () => {
            writeHistory(recordTipDismissed(readHistory(), rule.id));
            toastManager.close(toastId);
          },
        },
      },
      actionProps: {
        children: strings.tipOpenLesson,
        onClick: () => {
          toastManager.close(toastId);
          void navigate({ to: "/academy", search: { lesson: rule.lessonId } });
        },
      },
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document paste/keydown/submit listeners held while mounted
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!composerEditorOf(event.target)) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text) consider({ trigger: "paste", text, edition: getZenEdition() });
    };
    const onSend = (editor: HTMLElement | null) => {
      const text = editor?.innerText ?? "";
      if (!text.trim()) return;
      recordAskedTopics(text);
      consider({ trigger: "send", text, edition: getZenEdition() });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      const editor = composerEditorOf(event.target);
      if (editor) onSend(editor);
    };
    const onSubmit = (event: SubmitEvent) => {
      if (event.target instanceof Element && event.target.matches(COMPOSER_FORM)) {
        onSend(event.target.querySelector<HTMLElement>(COMPOSER_EDITOR));
      }
    };
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [consider]);

  const hasLessons = lessonIds !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a short timer per route change that may show an imperative toast
  useEffect(() => {
    // Route tips need the lesson list, so a "first time" tip is not spent before it can link.
    if (!hasLessons) return;
    const timer = setTimeout(
      () => consider({ trigger: "route", path: pathname, edition: getZenEdition() }),
      800,
    );
    return () => clearTimeout(timer);
  }, [pathname, hasLessons, consider]);

  return null;
}
