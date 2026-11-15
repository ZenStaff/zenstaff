// Zen Staff AI staff: the web side talks to its machine through one RPC, `zen.staff.call`.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_STAFF_WS_METHODS,
  type StaffOverview,
  type ZenStaffCallInput,
} from "@t3tools/contracts/zenStaff";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useAtomCommand } from "../../state/use-atom-command";
import { getZenLocale } from "../i18n/zenI18n";

const staffCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-staff:call",
  tag: ZEN_STAFF_WS_METHODS.call,
});

/** The overview changes while you look at it (agents start, approvals arrive). */
const staffLiveQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-staff:overview",
  tag: ZEN_STAFF_WS_METHODS.call,
  staleTimeMs: 2_000,
  idleTtlMs: 30_000,
  refreshIntervalMs: 4_000,
});

const staffQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-staff:query",
  tag: ZEN_STAFF_WS_METHODS.call,
  staleTimeMs: 60_000,
  idleTtlMs: 5 * 60_000,
});

export type StaffOp = ZenStaffCallInput["op"];
export type StaffCall = <T = unknown>(op: StaffOp, input?: Record<string, unknown>) => Promise<T>;

export function staffErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

/** `call(op, input)`; the company and the app's language are added to every call. */
export function useStaffCall(environmentId: EnvironmentId | null, companyId: string): StaffCall {
  const run = useAtomCommand(staffCall, { reportFailure: false });
  return useStableCallback(
    async (op: StaffOp, input: Record<string, unknown> = {}): Promise<unknown> => {
      if (environmentId === null) throw new Error("No machine is connected.");
      const result = await run({
        environmentId,
        input: { op, input: { companyId, locale: getZenLocale(), ...input } },
      });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as StaffCall;
}

export function useStaffOverview(
  environmentId: EnvironmentId,
  companyId: string,
  locale: string,
): {
  readonly data: StaffOverview | null;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const registry = useContext(RegistryContext);
  const atom = staffLiveQuery({
    environmentId,
    input: { op: "overview", input: { companyId, locale } },
  });
  const result = useAtomValue(atom);
  const data = AsyncResult.getOrElse(result, () => null) as StaffOverview | null;
  const error =
    result._tag === "Failure"
      ? staffErrorMessage(Cause.squash(result.cause), "AI staff is not available.")
      : null;
  const refresh = useStableCallback(() => registry.refresh(atom));
  return { data, error, refresh };
}

export function useStaffCatalog<T>(environmentId: EnvironmentId): T | null {
  const result = useAtomValue(staffQuery({ environmentId, input: { op: "catalog", input: {} } }));
  return AsyncResult.getOrElse(result, () => null) as T | null;
}

/**
 * Any other read as an atom (cached, shared): live ones are asked again every few seconds while
 * shown. Input gets the company and the language like `useStaffCall`.
 */
export function useStaffQuery<T>(
  environmentId: EnvironmentId,
  companyId: string,
  op: StaffOp,
  input: Record<string, unknown>,
  options: { readonly live?: boolean } = {},
): T | null {
  const family = options.live === true ? staffLiveQuery : staffQuery;
  const result = useAtomValue(
    family({
      environmentId,
      input: { op, input: { companyId, locale: getZenLocale(), ...input } },
    }),
  );
  return AsyncResult.getOrElse(result, () => null) as T | null;
}
