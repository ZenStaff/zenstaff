// Zen Staff: "Cum lucrează agenții tăi", the trust model in three lines and a small picture: the
// agent works alone in the company folder; whatever leaves the company stops at "De aprobat".
// Shown once on the first run (ZenWelcome) before any agent starts. ZEN.md, "First run".
import { ArrowRightIcon, FolderIcon, SendIcon, StampIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useZenText } from "../i18n/zenI18n";
import { trustText } from "./trust.i18n";

export function ZenTrustModel() {
  const t = useZenText(trustText);
  return (
    <div className="flex flex-col gap-5" data-zen-trust-model>
      <TrustPicture />
      <ol className="flex flex-col gap-3">
        <TrustLine index={1} title={t.alone} body={t.aloneBody} />
        <TrustLine index={2} title={t.ask} body={t.askBody} />
        <TrustLine index={3} title={t.one} body={t.oneBody} />
      </ol>
    </div>
  );
}

function TrustLine(props: {
  readonly index: number;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground font-medium text-background text-xs">
        {props.index}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-sm">{props.title}</span>
        <span className="text-muted-foreground text-sm">{props.body}</span>
      </span>
    </li>
  );
}

/** Folder (the agent works here) -> "De aprobat" (the one stop) -> outside the company. */
function TrustPicture() {
  const t = useZenText(trustText);
  return (
    <div
      className="flex items-stretch justify-between gap-2 rounded-xl border bg-muted/40 p-3"
      aria-hidden
    >
      <PictureBox icon={<FolderIcon className="size-5" />} label={t.folder} />
      <ArrowRightIcon className="size-4 shrink-0 self-center text-muted-foreground" />
      <PictureBox
        icon={<StampIcon className="size-5" />}
        label={t.approve}
        className="border-primary/50 text-primary"
      />
      <ArrowRightIcon className="size-4 shrink-0 self-center text-muted-foreground" />
      <PictureBox icon={<SendIcon className="size-5" />} label={t.outside} />
    </div>
  );
}

function PictureBox(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span
      className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg border bg-background px-2 py-2.5 text-center text-xs ${props.className ?? ""}`}
    >
      {props.icon}
      <span className="font-medium leading-tight">{props.label}</span>
    </span>
  );
}
