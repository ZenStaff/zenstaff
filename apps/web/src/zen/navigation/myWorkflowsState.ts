// Zen Staff sidebar "My workflows": pins, the run log and the collapsed header, per browser in
// localStorage (the same pattern as the pinned projects strip). The sidebar also keeps the last
// loaded workflow list here so the command palette can list workflows without its own query.
import { create } from "zustand";

import {
  type MyWorkflowRuns,
  type MyWorkflowSource,
  parsePins,
  parseRuns,
  recordRun,
  setPins,
  togglePin,
} from "./myWorkflowsModel";

const PINS_KEY = "zen:my-workflows:pins";
const RUNS_KEY = "zen:my-workflows:runs";
const COLLAPSED_KEY = "zen:my-workflows:collapsed";

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the change still holds for this session.
  }
}

interface MyWorkflowsState {
  readonly pins: ReadonlyArray<string>;
  readonly runs: MyWorkflowRuns;
  readonly collapsed: boolean;
  /** The workflows the sidebar last loaded (localized), for the command palette. */
  readonly catalog: ReadonlyArray<MyWorkflowSource>;
  readonly togglePin: (id: string) => void;
  readonly setPinned: (ids: ReadonlyArray<string>, pinned: boolean) => void;
  readonly recordRun: (id: string) => void;
  readonly setCollapsed: (collapsed: boolean) => void;
  readonly setCatalog: (catalog: ReadonlyArray<MyWorkflowSource>) => void;
}

export const useMyWorkflowsStore = create<MyWorkflowsState>((set, get) => ({
  pins: parsePins(read(PINS_KEY)),
  runs: parseRuns(read(RUNS_KEY)),
  collapsed: read(COLLAPSED_KEY) === "1",
  catalog: [],
  togglePin: (id) => {
    const pins = togglePin(get().pins, id);
    write(PINS_KEY, JSON.stringify(pins));
    set({ pins });
  },
  setPinned: (ids, pinned) => {
    const pins = setPins(get().pins, ids, pinned);
    write(PINS_KEY, JSON.stringify(pins));
    set({ pins });
  },
  recordRun: (id) => {
    const runs = recordRun(get().runs, id, new Date().toISOString());
    write(RUNS_KEY, JSON.stringify(runs));
    set({ runs });
  },
  setCollapsed: (collapsed) => {
    write(COLLAPSED_KEY, collapsed ? "1" : "0");
    set({ collapsed });
  },
  setCatalog: (catalog) => set({ catalog }),
}));

/** Counts a workflow start (Office home, sidebar, palette, Magazin) for "most used". */
export function recordWorkflowRun(id: string): void {
  useMyWorkflowsStore.getState().recordRun(id);
}
