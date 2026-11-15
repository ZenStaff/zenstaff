// Zen Staff chat-first task start: "Folosește" in the Magazin hands a workflow to the Office home,
// which opens its chat in the folder chosen there (sessionStorage, read once). The sidebar's "My
// workflows" and the command palette hand over the same way; listeners let an Office home that is
// already open pick it up.
import { useSyncExternalStore } from "react";

const KEY = "zen:office:intake";
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribeOfficeIntake(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setOfficeIntake(workflowId: string): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, workflowId);
  } catch {
    // Without storage the Office home simply opens.
  }
  notify();
}

function peekOfficeIntake(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function clearOfficeIntake(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
  notify();
}

/** The workflow waiting to open on the Office home, re-read when one is handed over. */
export function useOfficeIntake(): string | null {
  return useSyncExternalStore(subscribeOfficeIntake, peekOfficeIntake, () => null);
}
