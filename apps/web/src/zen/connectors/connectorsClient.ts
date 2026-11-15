// Zen Staff connectors: the web side calls its own server (one RPC, `zen.connectors.call`). Nothing
// here ever holds a third-party credential.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_CONNECTORS_WS_METHODS, type ZenConnectorsOp } from "@t3tools/contracts/zenConnectors";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";

const zenConnectorsCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-connectors:call",
  tag: ZEN_CONNECTORS_WS_METHODS.call,
});

const connectorsQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-connectors:query",
  tag: ZEN_CONNECTORS_WS_METHODS.call,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

/** Lists that change while you look at them (shares, comments): asked again every few seconds. */
const connectorsLiveQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-connectors:live-query",
  tag: ZEN_CONNECTORS_WS_METHODS.call,
  staleTimeMs: 2_000,
  idleTtlMs: 30_000,
  refreshIntervalMs: 4_000,
});

export type ConnectorsCall = <T = unknown>(
  op: ZenConnectorsOp,
  input?: Record<string, unknown>,
) => Promise<T>;

export function connectorsErrorMessage(error: unknown, fallback = "Try again."): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

/** `call(op, input)` against this window's primary server; rejects with the server's message. */
export function useConnectorsCall(): {
  readonly environmentId: EnvironmentId | null;
  readonly call: ConnectorsCall;
} {
  const environmentId = usePrimaryEnvironmentId();
  const run = useAtomCommand(zenConnectorsCall, { reportFailure: false });
  const call = useStableCallback(
    async (op: ZenConnectorsOp, input: Record<string, unknown> = {}): Promise<unknown> => {
      if (environmentId === null) throw new Error("No machine is connected.");
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as ConnectorsCall;
  return { environmentId, call };
}

/** A connectors read as an atom: cached, shared between components, refreshed with `refresh()`. */
export function useConnectorsQuery<T>(
  environmentId: EnvironmentId,
  op: ZenConnectorsOp,
  input: Record<string, unknown> = {},
  options: { readonly live?: boolean } = {},
): { readonly data: T | null; readonly error: string | null; readonly refresh: () => void } {
  const registry = useContext(RegistryContext);
  const family = options.live === true ? connectorsLiveQuery : connectorsQuery;
  const atom = family({ environmentId, input: { op, input } });
  const result = useAtomValue(atom);
  const data = AsyncResult.getOrElse(result, () => null) as T | null;
  const error =
    result._tag === "Failure"
      ? connectorsErrorMessage(Cause.squash(result.cause), "Connections are not available.")
      : null;
  const refresh = useStableCallback(() => registry.refresh(atom));
  return { data, error, refresh };
}

const connectorsCatalogQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-connectors:catalog",
  tag: ZEN_CONNECTORS_WS_METHODS.call,
  staleTimeMs: 10 * 60_000,
  idleTtlMs: 30 * 60_000,
});

/** The connector catalog (changes only with the app or the hub). */
export const connectorsCatalogAtom = (environmentId: EnvironmentId) =>
  connectorsCatalogQuery({ environmentId, input: { op: "catalog", input: {} } });

/** A thread's connect cards, asked again every few seconds (the agent may add one). */
export const connectorsCardsAtom = (environmentId: EnvironmentId, threadId: string) =>
  connectorsLiveQuery({ environmentId, input: { op: "requests.list", input: { threadId } } });
