// Zen Staff: in Office, "Adaugă un dosar" (the sidebar's +, the empty sidebar, Ctrl+K) opens
// Zen's simple folder dialog instead of upstream's developer palette (Git, GitHub, Azure...).
// commandPaletteBus.ts asks `zenOpensAddFolder()` first (one line). Code keeps the palette.
import { create } from "zustand";

import { isZenOffice } from "./editionStore";

export const useZenAddFolder = create<{
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/** Office: opens the Zen folder dialog and returns true; Code: false (the palette opens). */
export function zenOpensAddFolder(): boolean {
  if (!isZenOffice()) return false;
  useZenAddFolder.getState().show();
  return true;
}
