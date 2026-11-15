// Zen Staff: the consent choice itself. Two equal buttons, one plain sentence on what is and is
// not sent; nothing is sent before a choice. Used on the first-run screen, the one-time card
// after an update and Settings > Privacy.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenTelemetryChoice as Choice } from "@t3tools/contracts/zenTelemetry";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { useZenText } from "../i18n/zenI18n";
import { telemetryText } from "./telemetry.i18n";
import { choiceInput, useTelemetryCall, useTelemetryStatus } from "./telemetryClient";

interface TelemetryChoiceProps {
  readonly environmentId: EnvironmentId;
  /** Shown as a question with a title (first run, the card); Settings has its own title. */
  readonly asQuestion?: boolean;
  readonly onChosen?: (choice: Choice) => void;
  readonly className?: string;
}

export function TelemetryChoice(
  props: Omit<TelemetryChoiceProps, "environmentId"> & {
    readonly environmentId: EnvironmentId | null;
  },
) {
  if (props.environmentId === null) return null;
  return <Choices {...props} environmentId={props.environmentId} />;
}

function Choices(props: TelemetryChoiceProps) {
  const t = useZenText(telemetryText);
  const status = useTelemetryStatus(props.environmentId);
  const call = useTelemetryCall(props.environmentId);
  const [local, setLocal] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (status === null) return null;
  if (status.blockedByPolicy) {
    return <p className="text-muted-foreground text-sm">{t.blocked}</p>;
  }
  const choice = local ?? status.choice;

  const choose = (next: Choice) => {
    setBusy(true);
    setFailed(false);
    // Promise chain instead of try/finally (React Compiler; reactCompilerCoverage.test.ts).
    void call("setChoice", choiceInput(next))
      .then(() => {
        setLocal(next);
        props.onChosen?.(next);
      })
      .catch(() => setFailed(true))
      .then(() => setBusy(false));
  };

  return (
    <div className={cn("flex flex-col gap-3", props.className)} data-zen-telemetry-choice>
      {props.asQuestion ? <span className="font-medium text-sm">{t.question}</span> : null}
      <p className="text-muted-foreground text-sm">{t.explain}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.title}>
        <Button
          variant={choice === "on" ? "default" : "outline"}
          role="radio"
          aria-checked={choice === "on"}
          disabled={busy}
          onClick={() => choose("on")}
          data-zen-telemetry="on"
        >
          {t.send}
        </Button>
        <Button
          variant={choice === "off" ? "default" : "outline"}
          role="radio"
          aria-checked={choice === "off"}
          disabled={busy}
          onClick={() => choose("off")}
          data-zen-telemetry="off"
        >
          {t.dontSend}
        </Button>
      </div>
      {failed ? <p className="text-destructive text-sm">{t.saveFailed}</p> : null}
      {choice !== null && props.asQuestion ? (
        <p className="text-muted-foreground text-xs">
          {choice === "on" ? t.chosenOn : t.chosenOff} {t.changeLater}
        </p>
      ) : null}
    </div>
  );
}
