// Zen Staff: in Office, a provider that is not ready reads as one calm grey line in Romanian
// ("ChatGPT nu e instalat pe acest calculator · Instalează") instead of upstream's red English
// banner with CLI paths (review 0.2.3, P1-7). Code keeps the upstream banner.
import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { InfoIcon, XIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useZenText } from "../i18n/zenI18n";
import { officeProviderText } from "./officeProvider.i18n";

/** "ChatGPT" for Codex, "Claude" for Claude, else the provider's own name. */
function officeProviderName(status: ServerProvider): string {
  const driver = String(status.driver);
  if (driver === "codex") return "ChatGPT";
  if (driver === "claudeAgent") return "Claude";
  return status.displayName?.trim() || driver;
}

function officeProviderProblem(
  status: ServerProvider,
): "not-installed" | "signed-out" | "unavailable" {
  if (!status.installed || /could not start|not found|enoent/i.test(status.message ?? "")) {
    return "not-installed";
  }
  if (status.auth.status === "unauthenticated") return "signed-out";
  return "unavailable";
}

export function OfficeProviderNotice(props: {
  readonly status: ServerProvider;
  readonly onDismiss: () => void;
  readonly onOpenProviderSetup?: ((instanceId: ProviderInstanceId) => void) | undefined;
}) {
  const t = useZenText(officeProviderText);
  const name = officeProviderName(props.status);
  const problem = officeProviderProblem(props.status);
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[calc(100%-2rem)] pt-3">
      <div
        role="status"
        data-testid="office-provider-notice"
        className="flex items-center gap-2 rounded-lg border bg-muted/60 px-3 py-1.5 text-muted-foreground text-sm"
      >
        <InfoIcon className="size-4 shrink-0" />
        <span>{t.problem[problem](name)}</span>
        {props.onOpenProviderSetup ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => props.onOpenProviderSetup?.(props.status.instanceId)}
          >
            {t.action[problem]}
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={t.dismiss}
          onClick={props.onDismiss}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
