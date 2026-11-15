// Zen Staff hub: the parts of a shared chat beyond text. Tool work folded the Office way ("Worked
// on 2 files", expandable to the steps), and attachments: images, audio and video play inline when
// the owner's machine sent them; other files show their name and size.
import type { ZenHubAttachment, ZenHubWorkDigest, ZenHubWorkStep } from "@t3tools/contracts/zenHub";
import { ChevronRightIcon, PaperclipIcon } from "lucide-react";
import { useState } from "react";

import { countLabel, useZenLocale, useZenText } from "../i18n/zenI18n";
import { officeText } from "../office/office.i18n";
import { hubText } from "./hub.i18n";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SharedWorkRow(props: {
  readonly digest: ZenHubWorkDigest;
  readonly steps: ReadonlyArray<ZenHubWorkStep>;
}) {
  const t = useZenText(officeText);
  const h = useZenText(hubText);
  const locale = useZenLocale();
  const [open, setOpen] = useState(false);
  const { digest } = props;
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
            : t.stepsDone(steps(Math.max(1, digest.otherSteps + digest.webSearches)));
  const lines = [
    ...digest.changedFiles.map((name) => t.changedFile(name)),
    ...digest.readFiles.map((name) => t.readFile(name)),
    ...(digest.webSearches > 0
      ? [t.webSearches(countLabel(locale, digest.webSearches, t.searchForms))]
      : []),
    ...(digest.failed > 0 ? [t.someStepsFailed(digest.failed)] : []),
  ];
  return (
    <li className="px-1 text-muted-foreground text-sm" data-testid="shared-work-row">
      <button
        type="button"
        className="flex items-center gap-1 rounded-sm text-left hover:text-foreground"
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
      {open ? (
        <ul className="mt-1 flex flex-col gap-0.5 pl-6 text-xs">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li className="mt-1 font-medium">{h.workSteps}</li>
          {props.steps.map((step) => (
            <li key={`${step.type}:${step.title}:${step.status}`}>
              {step.title}
              {step.status === "failed"
                ? ` (${h.failedStep})`
                : step.status === "running"
                  ? ` (${h.runningStep})`
                  : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function SharedAttachments(props: {
  readonly attachments: ReadonlyArray<ZenHubAttachment>;
}) {
  const h = useZenText(hubText);
  if (props.attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="shared-attachments">
      {props.attachments.map((attachment) =>
        attachment.dataUrl !== null && attachment.kind === "image" ? (
          <img
            key={attachment.id}
            src={attachment.dataUrl}
            alt={attachment.name}
            className="max-h-64 max-w-full rounded-md border"
          />
        ) : attachment.dataUrl !== null && attachment.kind === "audio" ? (
          <audio
            key={attachment.id}
            controls
            src={attachment.dataUrl}
            aria-label={attachment.name}
          />
        ) : attachment.dataUrl !== null && attachment.kind === "video" ? (
          <video
            key={attachment.id}
            controls
            src={attachment.dataUrl}
            aria-label={attachment.name}
            className="max-h-64 max-w-full rounded-md"
          />
        ) : (
          <span
            key={attachment.id}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          >
            <PaperclipIcon className="size-3" aria-label={h.attachment} />
            {attachment.name} · {sizeLabel(attachment.sizeBytes)}
            {attachment.kind !== "file" ? ` · ${h.tooLargeToPreview}` : ""}
          </span>
        ),
      )}
    </div>
  );
}
