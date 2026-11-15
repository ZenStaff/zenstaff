// Zen Staff "Registru" building blocks for the redesigned pages (Birou, Angajați AI, Academie):
// serif page titles with an optional pen-stroked word, cards, quiet tags, the APROBAT stamp, empty
// states and skeleton bones. Styles in ./registru.css (scoped to .zen-registru). ZEN.md, "Registru
// in the app".
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/** The pen stroke under one word (the landing's motif). */
export function PenWord(props: { readonly children: ReactNode }) {
  return (
    <span className="zr-pen">
      {props.children}
      <svg viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden>
        <path pathLength={1} d="M4 15 C 38 8, 80 18, 118 11 S 178 7, 196 12" />
      </svg>
    </span>
  );
}

/** A page's heading: a serif title, one line under it, actions on the right. */
export function PageHeading(props: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-x-6 gap-y-4", props.className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="zr-title">{props.title}</h2>
        {props.subtitle ? <p className="zr-muted max-w-2xl text-base">{props.subtitle}</p> : null}
      </div>
      {props.actions ? (
        <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
      ) : null}
    </div>
  );
}

/** A section title inside a page, with an optional action on the right. */
export function SectionHeading(props: {
  readonly title: ReactNode;
  readonly icon?: LucideIcon;
  readonly detail?: ReactNode;
  readonly action?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {Icon ? <Icon className="zr-muted size-4.5" aria-hidden /> : null}
      <h3 className="zr-h2">{props.title}</h3>
      {props.detail ? <span className="zr-muted text-sm">{props.detail}</span> : null}
      <div className="flex-1" />
      {props.action}
    </div>
  );
}

export function Tag(props: {
  readonly children: ReactNode;
  readonly loud?: boolean;
  readonly className?: string;
}) {
  return (
    <span className={cn("zr-tag", props.loud && "zr-tag-loud", props.className)}>
      {props.children}
    </span>
  );
}

/** APROBAT / ÎN AȘTEPTARE / RESPINS, the double-ruled stamp. Loud only for the approved one. */
export function Stamp(props: {
  readonly children: ReactNode;
  readonly quiet?: boolean;
  readonly pop?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "zr-stamp",
        props.quiet && "zr-stamp-ink",
        props.pop && "zr-stamp-pop",
        props.className,
      )}
      aria-hidden
    >
      {props.children}
    </span>
  );
}

/** A friendly empty state: an icon in a soft tile, a title, one or two lines and an action. */
export function EmptyState(props: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly body?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  const Icon = props.icon;
  return (
    <div
      className={cn(
        "zr-sheet flex flex-col items-center gap-3 px-6 py-10 text-center",
        props.className,
      )}
      data-zen-empty
    >
      <span className="zr-tint flex size-12 items-center justify-center rounded-2xl">
        <Icon className="zr-soft size-5.5" aria-hidden />
      </span>
      <p className="zr-h3">{props.title}</p>
      {props.body ? (
        <p className="zr-muted max-w-md text-sm leading-relaxed">{props.body}</p>
      ) : null}
      {props.action ? (
        <div className="mt-1 flex flex-wrap justify-center gap-2">{props.action}</div>
      ) : null}
    </div>
  );
}

/** A skeleton bone in Registru colors. */
export function Bone(props: { readonly className?: string }) {
  return <div className={cn("zr-bone", props.className)} aria-hidden data-zen-skeleton />;
}
