// Zen Staff: Team > Account, "Ce vede patronul despre tine" (review 0.2.3, P1-20): what owners
// and admins see about you and what they do not, in plain sentences.
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { useZenText } from "../i18n/zenI18n";
import { whatOwnersSeeText } from "./whatOwnersSee.i18n";

export function WhatOwnersSee() {
  const t = useZenText(whatOwnersSeeText);
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm"
      data-testid="what-owners-see"
    >
      <h2 className="font-medium">{t.title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
            <EyeIcon className="size-3.5" />
            {t.canTitle}
          </h3>
          <ul className="flex list-disc flex-col gap-1 ps-4">
            {t.can.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
            <EyeOffIcon className="size-3.5" />
            {t.cannotTitle}
          </h3>
          <ul className="flex list-disc flex-col gap-1 ps-4">
            {t.cannot.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
