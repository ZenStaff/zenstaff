// Zen Staff "Conectează-ți AI-ul": the web side of `zen.aiConnect.call` (start, status, code,
// cancel) and the dialog any page can open ("AI not connected" states in Birou and chat).
import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_AI_CONNECT_WS_METHODS,
  type AiConnectCliProvider,
  type AiConnectJob,
  type AiConnectMode,
} from "@t3tools/contracts/zenCompanies";
import { AsyncResult } from "effect/reactivity";
import { create } from "zustand";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useAtomCommand } from "../../state/use-atom-command";

const aiConnectCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:zen-ai-connect:call",
  tag: ZEN_AI_CONNECT_WS_METHODS.call,
});

// Asked every 1.5 s while a card is on screen: the job's steps and sign-in link.
const aiConnectStatusQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:zen-ai-connect:status",
  tag: ZEN_AI_CONNECT_WS_METHODS.call,
  staleTimeMs: 1_000,
  idleTtlMs: 5_000,
  refreshIntervalMs: 1_500,
});

export interface AiConnectActions {
  readonly start: (provider: AiConnectCliProvider, mode: AiConnectMode) => Promise<AiConnectJob>;
  readonly submitCode: (jobId: string, code: string) => Promise<AiConnectJob>;
  readonly cancel: (jobId: string) => Promise<AiConnectJob>;
}

export function useAiConnectActions(environmentId: EnvironmentId | null): AiConnectActions {
  const run = useAtomCommand(aiConnectCall, { reportFailure: false });
  const call = useStableCallback(
    async (op: "start" | "submitCode" | "cancel", input: Record<string, unknown>) => {
      if (environmentId === null) throw new Error("No machine is connected.");
      const result = await run({ environmentId, input: { op, input } });
      if (result._tag === "Success") return (result.value as { job: AiConnectJob }).job;
      throw squashAtomCommandFailure(result);
    },
  );
  return {
    start: (provider, mode) => call("start", { provider, mode }),
    submitCode: (jobId, code) => call("submitCode", { jobId, code }),
    cancel: (jobId) => call("cancel", { jobId }),
  };
}

const NO_JOBS: ReadonlyArray<AiConnectJob> = [];

/** The latest job per provider on this machine (polled while mounted). */
export function useAiConnectJobs(environmentId: EnvironmentId): ReadonlyArray<AiConnectJob> {
  const result = useAtomValue(
    aiConnectStatusQuery({ environmentId, input: { op: "status", input: {} } }),
  );
  const value = AsyncResult.getOrElse(result, () => null) as {
    readonly jobs?: ReadonlyArray<AiConnectJob>;
  } | null;
  return value?.jobs ?? NO_JOBS;
}

/** The "Connect your AI" dialog, opened from any "AI not connected" state. */
export const useAiConnectDialog = create<{
  readonly open: boolean;
  readonly show: () => void;
  readonly hide: () => void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** Error texts from a chat or provider that mean "this AI is not signed in or not installed". */
export function isAiNotConnectedError(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /not (authenticated|logged in|signed in)|unauthenticated|auth login|codex login|please (run )?\/?login|sign in (again|via the cli)|invalid api key/i.test(
      text,
    ) || /\b(claude|codex|gemini|antigravity)\b[^.\n]{0,40}\bnot installed\b/i.test(text)
  );
}
