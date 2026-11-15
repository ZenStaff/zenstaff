// Zen Staff: the Office edition's work rows in the chat. One calm line per run of tool work
// ("Worked on 3 files"), expandable to a plain list; reasoning shows as a quiet "Working…".
// Hooked into MessagesTimeline.tsx (ZEN.md, "What Office hides").
import { ChevronRightIcon } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";

import {
  TimelineRowCtx,
  type TimelineRowSharedState,
} from "../../components/chat/timelineRowContext";
import { useRightPanelStore } from "../../rightPanelStore";
import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import { countLabel, useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeText } from "./office.i18n";
import {
  digestOfficeWork,
  officeTimelineEntries,
  officeWorkEntries,
  officeWorkspaceRelativePath,
} from "./officeTimeline.logic";
import { useZenOffice } from "./useZenEdition";

/** The timeline entries upstream turns into rows; folded in Office, untouched in Code. */
export function useZenOfficeTimelineEntries(
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyArray<TimelineEntry> {
  const office = useZenOffice();
  return office ? officeTimelineEntries(entries) : entries;
}

/** The folded work behind a "work" row, or null when the row is an ordinary upstream one. */
export function zenOfficeWorkOf(row: {
  readonly kind: string;
  readonly groupedEntries?: ReadonlyArray<WorkLogEntry>;
}): ReadonlyArray<WorkLogEntry> | null {
  if (row.kind !== "work" || row.groupedEntries?.length !== 1) return null;
  return officeWorkEntries(row.groupedEntries[0]!);
}

/** Upstream's "Thinking" row in Code; a quiet "Working…" in Office. */
export function ZenOfficeThinking(props: { readonly children: ReactNode }) {
  const office = useZenOffice();
  const t = useZenText(officeText);
  if (!office) return props.children;
  return (
    <div className="flex h-6 items-center px-1 text-muted-foreground/80 text-sm">{t.working}</div>
  );
}

export function ZenOfficeWorkRow(props: { readonly work: ReadonlyArray<WorkLogEntry> }) {
  const t = useZenText(officeText);
  const locale = useZenLocale();
  const [open, setOpen] = useState(false);
  // Null outside a chat timeline (tests, previews): file names then stay plain text.
  const timeline = useContext(TimelineRowCtx) as TimelineRowSharedState | null;
  const digest = digestOfficeWork(props.work);
  const files = (count: number) => countLabel(locale, count, t.fileForms);
  const steps = (count: number) => countLabel(locale, count, t.stepForms);

  const summary =
    digest.changedFiles.length > 0
      ? digest.active
        ? t.workingOnFiles(files(digest.changedFiles.length))
        : t.workedOnFiles(files(digest.changedFiles.length))
      : digest.active
        ? t.working
        : digest.readFiles.length > 0
          ? t.lookedFiles(files(digest.readFiles.length))
          : digest.webSearches > 0 && digest.otherSteps === 0
            ? t.searchedWeb
            : digest.otherSteps + digest.webSearches > 0
              ? t.stepsDone(steps(digest.otherSteps + digest.webSearches))
              : null;
  // Only reasoning, already finished: nothing worth a line.
  if (summary === null) return null;

  const threadRef = timeline?.threadRef ?? null;
  const openerFor = (name: string): (() => void) | null => {
    const reported = digest.filePaths[name];
    if (threadRef === null || reported === undefined) return null;
    const relative = officeWorkspaceRelativePath(reported, timeline?.workspaceRoot);
    if (relative === null) return null;
    return () => useRightPanelStore.getState().openFile(threadRef, relative);
  };
  const lines: ReadonlyArray<{ readonly text: string; readonly open: (() => void) | null }> = [
    ...digest.changedFiles.map((name) => ({ text: t.changedFile(name), open: openerFor(name) })),
    ...digest.readFiles.map((name) => ({ text: t.readFile(name), open: openerFor(name) })),
    ...(digest.webSearches > 0
      ? [{ text: t.webSearches(countLabel(locale, digest.webSearches, t.searchForms)), open: null }]
      : []),
    ...(digest.otherSteps > 0
      ? [{ text: t.otherSteps(steps(digest.otherSteps)), open: null }]
      : []),
    ...(digest.failed > 0 ? [{ text: t.someStepsFailed(digest.failed), open: null }] : []),
  ];
  const expandable = lines.length > 0 && !(lines.length === 1 && digest.otherSteps > 0);

  return (
    <div className="px-1 py-0.5 text-muted-foreground text-sm" data-zen-office-work="">
      {expandable ? (
        <button
          type="button"
          className="flex items-center gap-1 rounded-sm text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={open}
          aria-label={`${summary}. ${open ? t.hideDetails : t.showDetails}`}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRightIcon
            aria-hidden
            className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span>{summary}</span>
        </button>
      ) : (
        <span className="flex items-center gap-1 pl-4.5">{summary}</span>
      )}
      {open ? (
        <ul className="mt-1 flex flex-col gap-0.5 pl-6 text-xs">
          {lines.map((line) => (
            <li key={line.text}>
              {line.open ? (
                <button
                  type="button"
                  className="rounded-sm text-left underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={line.open}
                  data-zen-office-file-link=""
                >
                  {line.text}
                </button>
              ) : (
                line.text
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
