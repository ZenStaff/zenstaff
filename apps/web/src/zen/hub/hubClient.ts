// Zen Staff hub: the web side talks to its own server (one RPC, `zen.hub.call`), which talks to the
// hub. The browser never holds the hub session or the runner credential.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_HUB_WS_METHODS, type ZenHubOp } from "@t3tools/contracts/zenHub";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { hubPermissionMessage } from "./hubErrors";

const zenHubCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-hub:call",
  tag: ZEN_HUB_WS_METHODS.call,
});

const hubQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-hub:query",
  tag: ZEN_HUB_WS_METHODS.call,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

/** Lists that change while you look at them (shares, comments): asked again every few seconds. */
const hubLiveQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-hub:live-query",
  tag: ZEN_HUB_WS_METHODS.call,
  staleTimeMs: 2_000,
  idleTtlMs: 30_000,
  refreshIntervalMs: 4_000,
});

export type HubCall = <T = unknown>(op: ZenHubOp, input?: Record<string, unknown>) => Promise<T>;

/** The error's message in the app's language (review P1-18: the hub's refusals are English). */
export function hubErrorMessage(error: unknown, fallback = "Try again."): string {
  return hubPermissionMessage(error, fallback);
}

/** `call(op, input)` against this window's primary server; rejects with the hub's message. */
export function useHubCall(): {
  readonly environmentId: EnvironmentId | null;
  readonly call: HubCall;
} {
  const environmentId = usePrimaryEnvironmentId();
  const run = useAtomCommand(zenHubCall, { reportFailure: false });
  const call = useStableCallback(
    async (op: ZenHubOp, input: Record<string, unknown> = {}): Promise<unknown> => {
      if (environmentId === null) throw new Error("No machine is connected.");
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as HubCall;
  return { environmentId, call };
}

/**
 * `call(op, input)` against one connected machine's server (e.g. the company server srv-birou seen
 * from a laptop): the op runs there, with that machine's own hub sign-in.
 */
export function useHubCallOn(environmentId: EnvironmentId): HubCall {
  const run = useAtomCommand(zenHubCall, { reportFailure: false });
  return useStableCallback(
    async (op: ZenHubOp, input: Record<string, unknown> = {}): Promise<unknown> => {
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as HubCall;
}

/** A hub read as an atom: cached, shared between components, refreshed with `refresh()`. */
export function useHubQuery<T>(
  environmentId: EnvironmentId,
  op: ZenHubOp,
  input: Record<string, unknown> = {},
  options: { readonly live?: boolean } = {},
): { readonly data: T | null; readonly error: string | null; readonly refresh: () => void } {
  const registry = useContext(RegistryContext);
  const family = options.live === true ? hubLiveQuery : hubQuery;
  const atom = family({ environmentId, input: { op, input } });
  const result = useAtomValue(atom);
  const data = AsyncResult.getOrElse(result, () => null) as T | null;
  const error =
    result._tag === "Failure"
      ? hubErrorMessage(Cause.squash(result.cause), "The hub is not available.")
      : null;
  const refresh = useStableCallback(() => registry.refresh(atom));
  return { data, error, refresh };
}
