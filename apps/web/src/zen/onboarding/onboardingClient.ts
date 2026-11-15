// Zen Staff onboarding: the web side calls its machine through one RPC, `zen.onboarding.call`,
// and opens the interview from anywhere (first run, a new company, company settings).
import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_ONBOARDING_WS_METHODS,
  type OnboardingState,
  type ZenOnboardingOp,
} from "@t3tools/contracts/zenCompanies";
import { AsyncResult } from "effect/reactivity";
import { create } from "zustand";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useAtomCommand } from "../../state/use-atom-command";

const onboardingCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-onboarding:call",
  tag: ZEN_ONBOARDING_WS_METHODS.call,
});

const onboardingStatusQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-onboarding:status",
  tag: ZEN_ONBOARDING_WS_METHODS.call,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
  refreshIntervalMs: 8_000,
});

export type OnboardingCall = <T = unknown>(
  op: ZenOnboardingOp,
  input?: Record<string, unknown>,
) => Promise<T>;

export interface OnboardingStatus {
  readonly firstRun: boolean;
  readonly newCompanies: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly states: Readonly<
    Record<string, { readonly status: OnboardingState["status"]; readonly step: string }>
  >;
}

export interface OnboardingGetResult {
  readonly state: OnboardingState;
  readonly memoryConnected: boolean;
  readonly localMemory: string | null;
  readonly profilePath: string;
  readonly workFolder: string;
}

export function onboardingErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

export function useOnboardingCall(environmentId: EnvironmentId | null): OnboardingCall {
  const run = useAtomCommand(onboardingCall, { reportFailure: false });
  return useStableCallback(
    async (op: ZenOnboardingOp, input: Record<string, unknown> = {}): Promise<unknown> => {
      if (environmentId === null) throw new Error("No machine is connected.");
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return result.value;
      throw squashAtomCommandFailure(result);
    },
  ) as OnboardingCall;
}

/** The interview status of every company (asked again every few seconds: new companies). */
export function useOnboardingStatus(environmentId: EnvironmentId): OnboardingStatus | null {
  const result = useAtomValue(
    onboardingStatusQuery({ environmentId, input: { op: "status", input: {} } }),
  );
  return AsyncResult.getOrElse(result, () => null) as OnboardingStatus | null;
}

/** Which company's interview is open (null = closed); any Zen page can open it. */
export const useOnboardingDialog = create<{
  readonly companyId: string | null;
  readonly reason: "first-run" | "new-company" | "settings" | null;
  readonly open: (companyId: string, reason: "first-run" | "new-company" | "settings") => void;
  readonly close: () => void;
}>((set) => ({
  companyId: null,
  reason: null,
  open: (companyId, reason) => set({ companyId, reason }),
  close: () => set({ companyId: null, reason: null }),
}));

/** Files as base64 for the RPC (documents up to 10 MB). */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
