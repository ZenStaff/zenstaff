// Zen Staff chat-first task start: the web side of `zen.office.intake {op, input}` (zenIntake.ts).
import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { IntakeThreadView } from "@t3tools/contracts/zenIntake";
import { ZEN_OFFICE_WS_METHODS, type ZenIntakeCallInput } from "@t3tools/contracts/zenOffice";
import { AsyncResult } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useAtomCommand } from "../../state/use-atom-command";

const intakeCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-intake:call",
  tag: ZEN_OFFICE_WS_METHODS.intake,
});

/** A thread's intake state: asked again every few seconds (the agent adds buttons and cards). */
const intakeLiveQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-intake:state",
  tag: ZEN_OFFICE_WS_METHODS.intake,
  staleTimeMs: 1_500,
  idleTtlMs: 30_000,
  refreshIntervalMs: 2_500,
});

export const intakeStateAtom = (environmentId: EnvironmentId, threadId: string) =>
  intakeLiveQuery({ environmentId, input: { op: "state", input: { threadId } } });

export type IntakeCall = <T = unknown>(
  environmentId: EnvironmentId,
  op: ZenIntakeCallInput["op"],
  input: Record<string, unknown>,
) => Promise<T>;

/** `call(environmentId, op, input)`; rejects with the server's message. */
export function useIntakeCall(): IntakeCall {
  const run = useAtomCommand(intakeCommand, { reportFailure: false });
  return useStableCallback(
    async (
      environmentId: EnvironmentId,
      op: ZenIntakeCallInput["op"],
      input: Record<string, unknown>,
    ): Promise<unknown> => {
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as IntakeCall;
}

export function useIntakeState(
  environmentId: EnvironmentId,
  threadId: string,
): IntakeThreadView | null {
  const result = useAtomValue(intakeStateAtom(environmentId, threadId));
  return (AsyncResult.getOrElse(result, () => null) as IntakeThreadView | null) ?? null;
}
