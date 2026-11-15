// Zen Staff: the web side of anonymous statistics. One RPC, `zen.telemetry.call {op, input}`,
// answered by the machine's server (zen/telemetry/ZenTelemetry.ts), which counts and sends.
import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_TELEMETRY_WS_METHODS,
  type ZenTelemetryChoice,
  type ZenTelemetryErrorType,
  type ZenTelemetryStatus,
} from "@t3tools/contracts/zenTelemetry";
import { AsyncResult } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useAtomCommand } from "../../state/use-atom-command";
import { getZenLocale } from "../i18n/zenI18n";
import { getZenEdition } from "../office/editionStore";

const telemetryCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-telemetry:call",
  tag: ZEN_TELEMETRY_WS_METHODS.call,
});

const telemetryStatusQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-telemetry:status",
  tag: ZEN_TELEMETRY_WS_METHODS.call,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
  refreshIntervalMs: 30_000,
});

/** The machine's choice; null while loading or on a server without statistics (older). */
export function useTelemetryStatus(environmentId: EnvironmentId): ZenTelemetryStatus | null {
  const result = useAtomValue(
    telemetryStatusQuery({ environmentId, input: { op: "status", input: {} } }),
  );
  return AsyncResult.getOrElse(result, () => null) as ZenTelemetryStatus | null;
}

export type TelemetryCall = (
  op: "hello" | "setChoice" | "count",
  input: Record<string, unknown>,
) => Promise<ZenTelemetryStatus | null>;

export function useTelemetryCall(environmentId: EnvironmentId | null): TelemetryCall {
  const run = useAtomCommand(telemetryCall, { reportFailure: false });
  return useStableCallback(async (op, input) => {
    if (environmentId === null) return null;
    const result = await run({ environmentId, input: { op, input } });
    if (result._tag === "Success") return result.value as ZenTelemetryStatus | null;
    throw squashAtomCommandFailure(result);
  }) as TelemetryCall;
}

/** What the app says about itself: only closed lists (language ro/en, edition office/code). */
export function telemetryContext(): { readonly locale: string; readonly edition: string } {
  return { locale: getZenLocale(), edition: getZenEdition() };
}

export function choiceInput(choice: ZenTelemetryChoice): Record<string, unknown> {
  return { choice, ...telemetryContext() };
}

/** A workflow started (pack id only; the server reports ids that are not ours as "other"). */
export function workflowRunInput(workflow: {
  readonly packId: string | null;
  readonly manifest: { readonly id: string };
}): Record<string, unknown> {
  return { kind: "workflow", packId: workflow.packId ?? workflow.manifest.id };
}

export function errorInput(type: ZenTelemetryErrorType): Record<string, unknown> {
  return { kind: "error", type };
}
