// Zen Staff: the one line above the limits on Office's Usage page (review 0.2.3, P1-12): what the
// bar and its vertical mark mean, and that a subscription costs the same however much it is used.
import { InfoIcon } from "lucide-react";

import { useZenText } from "../i18n/zenI18n";
import { officeUsageText } from "./officeUsage.i18n";

export function ZenOfficeUsageNote() {
  const t = useZenText(officeUsageText);
  return (
    <p
      className="mb-4 flex items-start gap-2 text-muted-foreground text-sm"
      data-testid="office-usage-note"
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0" />
      <span>{t.note}</span>
    </p>
  );
}
