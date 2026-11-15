// Zen Staff: the one hook upstream components ask before showing a developer surface.
import type { ZenEdition } from "@t3tools/contracts/zenOffice";
import { useSyncExternalStore } from "react";

import { getZenEdition, subscribeZenEdition } from "./editionStore";

export function useZenEdition(): ZenEdition {
  return useSyncExternalStore(subscribeZenEdition, getZenEdition, getZenEdition);
}

/** True in the Office edition: hide git, terminal, diffs, worktrees and pull requests. */
export function useZenOffice(): boolean {
  return useZenEdition() === "office";
}

/**
 * Thread details rows a person in the Office edition never sees. Everything else keeps the
 * user's own choice. Used by ThreadDetailsPanel.
 */
export function zenThreadDetailsVisibility<T extends Readonly<Record<string, boolean>>>(
  visible: T,
  office: boolean,
): T {
  if (!office) return visible;
  return {
    ...visible,
    environment: false,
    openIn: false,
    scripts: false,
    branch: false,
    gitActions: false,
    changes: false,
    servers: false,
    lineage: false,
  };
}

/** Right panel tabs an Office person cannot add: terminal, diff, pull requests, device. */
/** Office: the surface launcher lists only what it can open (Files, Browser, Side chat). */
export function zenOfficeSurfaceActions<A extends { readonly available: boolean }>(
  office: boolean,
  actions: ReadonlyArray<A>,
): ReadonlyArray<A> {
  return office ? actions.filter((action) => action.available) : actions;
}

export function zenRightPanelAvailability<
  T extends {
    readonly terminalAvailable: boolean;
    readonly diffAvailable: boolean;
    readonly pullRequestAvailable: boolean;
    readonly pullRequestsAvailable: boolean;
    readonly deviceAvailable: boolean;
  },
>(props: T, office: boolean): T {
  if (!office) return props;
  return {
    ...props,
    terminalAvailable: false,
    diffAvailable: false,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
    deviceAvailable: false,
  };
}
