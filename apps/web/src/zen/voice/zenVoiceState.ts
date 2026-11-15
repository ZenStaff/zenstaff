// Zen voice state on this device: the preferred engine (environment model or the browser's
// Web Speech) and which composer asked for the simple setup dialog.
import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import type { ZenVoiceEngine } from "./zenVoiceModel";

const ENGINE_KEY = "zen:voice:engine";

function readEngine(): ZenVoiceEngine {
  try {
    return globalThis.localStorage?.getItem(ENGINE_KEY) === "browser" ? "browser" : "local";
  } catch {
    return "local";
  }
}

type SetupRequest = {
  /** New for every opening, so the dialog starts from the current settings each time. */
  readonly id: number;
  /** The draft's environment: the one offered for local transcription. */
  readonly environmentId: EnvironmentId;
  /** Called after setup so the recording starts without a second click. */
  readonly start: () => void;
};

export const useZenVoiceStore = create<{
  readonly engine: ZenVoiceEngine;
  readonly setEngine: (engine: ZenVoiceEngine) => void;
  readonly setup: SetupRequest | null;
  readonly openSetup: (request: Omit<SetupRequest, "id">) => void;
  readonly closeSetup: () => void;
}>((set) => ({
  engine: readEngine(),
  setEngine: (engine) => {
    try {
      globalThis.localStorage?.setItem(ENGINE_KEY, engine);
    } catch {
      // Storage can be refused; the choice still holds for this session.
    }
    set({ engine });
  },
  setup: null,
  openSetup: (setup) => set((state) => ({ setup: { ...setup, id: (state.setup?.id ?? 0) + 1 } })),
  closeSetup: () => set({ setup: null }),
}));
