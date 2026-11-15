// Zen Staff: who the person works for, chosen on first run ("Lucrez pentru mine / firma mea" or
// "Lucrez pentru clienți"). In "clients" mode the company switcher says Clienți and offers
// "Adaugă un client". Per device, like the edition (moves to the hub account later).
import { create } from "zustand";

export type ZenWorkMode = "self" | "clients";

const KEY = "zen:work-mode";

function read(): ZenWorkMode | null {
  try {
    const value = globalThis.localStorage?.getItem(KEY);
    return value === "self" || value === "clients" ? value : null;
  } catch {
    return null;
  }
}

export const useZenWorkMode = create<{
  readonly mode: ZenWorkMode | null;
  readonly setMode: (mode: ZenWorkMode) => void;
}>((set) => ({
  mode: read(),
  setMode: (mode) => {
    try {
      globalThis.localStorage?.setItem(KEY, mode);
    } catch {
      // private mode: the choice lasts for this session
    }
    set({ mode });
  },
}));

/** Whether the switcher speaks of clients: only when the person chose it (existing installs keep "companies"). */
export function speaksOfClients(mode: ZenWorkMode | null): boolean {
  return mode === "clients";
}
