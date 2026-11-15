// Zen Staff: asks once, on installs that have not chosen yet (an update from before 0.2.4, or a
// first run that skipped the question), with a small card that blocks nothing. Also tells the
// machine the app opened (language and edition, for the day's counters) and tells the desktop
// the edition for its update feed's User-Agent. Mounted with the sidebar items.
import type { EnvironmentId } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { ChartColumnIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useZenText } from "../i18n/zenI18n";
import { useZenEdition } from "../office/useZenEdition";
import { telemetryText } from "./telemetry.i18n";
import { TelemetryChoice } from "./TelemetryChoice";
import { telemetryContext, useTelemetryCall, useTelemetryStatus } from "./telemetryClient";

// Once per environment and app session.
const greeted = new Set<string>();

function Gate({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(telemetryText);
  const status = useTelemetryStatus(environmentId);
  const call = useTelemetryCall(environmentId);
  const onWelcome = useLocation({ select: (location) => location.pathname === "/welcome" });
  const [answered, setAnswered] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the machine once per session that the app opened (language and edition only).
  useEffect(() => {
    if (status === null || status.choice !== "on" || greeted.has(environmentId)) return;
    greeted.add(environmentId);
    void call("hello", telemetryContext()).catch(() => undefined);
  }, [status, environmentId, call]);

  if (status === null || status.blockedByPolicy || status.choice !== null) return null;
  if (answered || onWelcome) return null;
  return (
    <div
      role="dialog"
      aria-label={t.title}
      className="fixed bottom-4 left-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
      data-zen-telemetry-gate
    >
      <ChartColumnIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="mb-2 font-medium text-sm">{t.question}</div>
        <TelemetryChoice environmentId={environmentId} onChosen={() => setAnswered(true)} />
        <p className="mt-2 text-muted-foreground text-xs">{t.changeLater}</p>
      </div>
    </div>
  );
}

/** The desktop puts the edition into its update checks' User-Agent (no install id). */
function DesktopEditionSync() {
  const edition = useZenEdition();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the edition to the desktop main process for the update feed's User-Agent.
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    void bridge?.setZenUpdateEdition?.(edition).catch(() => undefined);
  }, [edition]);
  return null;
}

export function ZenTelemetryGate() {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <>
      <DesktopEditionSync />
      {environmentId === null ? null : <Gate environmentId={environmentId} />}
    </>
  );
}
