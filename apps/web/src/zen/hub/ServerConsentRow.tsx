// Zen Staff: on the company server, what it uses for colleagues (review 0.2.3, P0-6). A server made
// before the confirmation existed shows a warning with "Confirmă" (colleagues' work waits until
// then); a confirmed one shows the account and how many connections are shared, with "Schimbă".
import { AlertTriangleIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useZenText } from "../i18n/zenI18n";
import { serverSetupText } from "./serverSetup.i18n";
import type { RecordedServerConsent } from "./serverSetup.logic";

export function ServerConsentRow(props: {
  readonly consent: RecordedServerConsent | null;
  readonly loaded: boolean;
  readonly onConfirm: () => void;
}) {
  const t = useZenText(serverSetupText);
  if (!props.loaded) return null;
  if (props.consent === null) {
    return (
      <div
        className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm"
        data-testid="server-consent-pending"
      >
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t.pendingTitle}</p>
          <p className="text-muted-foreground text-xs">{t.pendingHint}</p>
        </div>
        <Button size="sm" onClick={props.onConfirm}>
          {t.pendingAction}
        </Button>
      </div>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm"
      data-testid="server-consent-recorded"
    >
      <ShieldCheckIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        {t.recorded(props.consent.account.label, props.consent.shared.length)}
      </span>
      <Button size="xs" variant="ghost" onClick={props.onConfirm}>
        {t.change}
      </Button>
    </div>
  );
}
