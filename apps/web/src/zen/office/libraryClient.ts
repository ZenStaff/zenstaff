// Zen Staff community library: the web side of `zen.office.library {op, input}` (communityLibrary.ts).
import {
  createEnvironmentRpcCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_OFFICE_WS_METHODS, type ZenLibraryCallInput } from "@t3tools/contracts/zenOffice";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useAtomCommand } from "../../state/use-atom-command";

const libraryCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-library:call",
  tag: ZEN_OFFICE_WS_METHODS.library,
});

export type LibraryCall = <T = unknown>(
  environmentId: EnvironmentId,
  op: ZenLibraryCallInput["op"],
  input: Record<string, unknown>,
) => Promise<T>;

/** `call(environmentId, op, input)`; rejects with the server's message. */
export function useLibraryCall(): LibraryCall {
  const run = useAtomCommand(libraryCommand, { reportFailure: false });
  return useStableCallback(
    async (
      environmentId: EnvironmentId,
      op: ZenLibraryCallInput["op"],
      input: Record<string, unknown>,
    ): Promise<unknown> => {
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as LibraryCall;
}
