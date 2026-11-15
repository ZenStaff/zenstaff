// Zen Staff chat integrations (web): the page talks to its own server (one RPC, `zen.chat.call`).
// Tokens go to the server once and are never read back.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_CHAT_WS_METHODS, type ZenChatOp } from "@t3tools/contracts/zenChat";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";

const zenChatCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-chat:call",
  tag: ZEN_CHAT_WS_METHODS.call,
});

const chatQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-chat:query",
  tag: ZEN_CHAT_WS_METHODS.call,
  staleTimeMs: 2_000,
  idleTtlMs: 60_000,
  refreshIntervalMs: 5_000,
});

/** Reads that do not change while the page is open (manifests). */
const chatStaticQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-chat:static-query",
  tag: ZEN_CHAT_WS_METHODS.call,
  staleTimeMs: 60_000,
  idleTtlMs: 120_000,
});

export type ChatCall = <T = unknown>(op: ZenChatOp, input?: Record<string, unknown>) => Promise<T>;

export function chatErrorMessage(error: unknown, fallback = "Try again."): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

/** `call(op, input)` against this window's primary server; rejects with the server's message. */
export function useChatCall(): {
  readonly environmentId: EnvironmentId | null;
  readonly call: ChatCall;
} {
  const environmentId = usePrimaryEnvironmentId();
  const run = useAtomCommand(zenChatCall, { reportFailure: false });
  const call = useStableCallback(
    async (op: ZenChatOp, input: Record<string, unknown> = {}): Promise<unknown> => {
      if (environmentId === null) throw new Error("No machine is connected.");
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as ChatCall;
  return { environmentId, call };
}

/** A read (status, audit list) as an atom, refreshed every few seconds while the page is open. */
export function useChatQuery<T>(
  environmentId: EnvironmentId,
  op: ZenChatOp,
  input: Record<string, unknown> = {},
  options: { readonly live?: boolean } = {},
): { readonly data: T | null; readonly error: string | null; readonly refresh: () => void } {
  const registry = useContext(RegistryContext);
  const family = options.live === false ? chatStaticQuery : chatQuery;
  const atom = family({ environmentId, input: { op, input } });
  const result = useAtomValue(atom);
  const data = AsyncResult.getOrElse(result, () => null) as T | null;
  const error =
    result._tag === "Failure"
      ? chatErrorMessage(Cause.squash(result.cause), "Chat integrations are not available.")
      : null;
  const refresh = useStableCallback(() => registry.refresh(atom));
  return { data, error, refresh };
}
