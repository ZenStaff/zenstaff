// Drag order of the sidebar "Pinned" strip. Pins themselves are upstream's project `pinnedAt`
// (project.meta.update `pinned`); only the order the user dragged chips into is Zen local state,
// per browser, keyed by sidebar project key.
import { create } from "zustand";

const ORDER_KEY = "zen:pinned-projects:order";

function readOrder(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(ORDER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export const usePinnedProjectOrderStore = create<{
  readonly order: ReadonlyArray<string>;
  readonly setOrder: (order: ReadonlyArray<string>) => void;
}>((set) => ({
  order: readOrder(),
  setOrder: (order) => {
    try {
      globalThis.localStorage?.setItem(ORDER_KEY, JSON.stringify(order));
    } catch {
      // Private windows can refuse storage; the order still holds for this session.
    }
    set({ order: [...order] });
  },
}));
