// Zen Staff: the draft screen's heading in Office ("What should we work on?" instead of
// upstream's "What should we build in X?"). Hooked into DraftHeroProjectHeading.tsx.
import type { ReactNode } from "react";

import { useZenText } from "../i18n/zenI18n";
import { officeText } from "./office.i18n";

export function ZenOfficeDraftHero(props: { readonly children: ReactNode }) {
  const t = useZenText(officeText);
  return (
    <div className="w-full">
      <h1 className="flex w-full flex-col items-center justify-center gap-2 text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        <span className="max-w-full">{t.draftQuestion}</span>
        <span className="flex min-w-0 max-w-full items-baseline justify-center gap-1.5 text-base text-muted-foreground tracking-normal">
          <span>{t.draftQuestionIn}</span>
          <span className="min-w-0 text-foreground">{props.children}</span>
        </span>
      </h1>
    </div>
  );
}
