// Zen Staff client approval links: the chat's links with their hub status, asked again every 10 s
// while the chat is open (the client may answer any time).
import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_HUB_WS_METHODS } from "@t3tools/contracts/zenHub";
import { AsyncResult } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import type { ApprovalItem } from "./approvalsModel";

const approvalsQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-hub:approvals",
  tag: ZEN_HUB_WS_METHODS.call,
  staleTimeMs: 3_000,
  idleTtlMs: 60_000,
  refreshIntervalMs: 10_000,
});

const atomFor = (environmentId: EnvironmentId, threadId: string) =>
  approvalsQuery({ environmentId, input: { op: "approval.list", input: { threadId } } });

export interface ThreadApprovals {
  readonly items: ReadonlyArray<ApprovalItem>;
  readonly offline: boolean;
}

export function useThreadApprovals(
  environmentId: EnvironmentId,
  threadId: string,
): ThreadApprovals | null {
  const result = useAtomValue(atomFor(environmentId, threadId));
  return AsyncResult.getOrElse(result, () => null) as ThreadApprovals | null;
}

export function refreshThreadApprovals(environmentId: EnvironmentId, threadId: string): void {
  appAtomRegistry.refresh(atomFor(environmentId, threadId));
}
