// Zen Staff: which AI accounts this device confirmed (localStorage), so a CLI login found on the
// computer is never used silently. Moves to the hub account with the other per-person choices.
import { useSyncExternalStore } from "react";

const KEY = "zen:ai-account:confirmed";
const listeners = new Set<() => void>();

function read(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

let current = read();

function write(next: ReadonlySet<string>) {
  current = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...next]));
  } catch {}
  for (const listener of listeners) listener();
}

export function confirmAiAccount(signature: string): void {
  write(new Set([...current, signature]));
}

export function forgetAiAccount(signature: string): void {
  write(new Set([...current].filter((value) => value !== signature)));
}

export function useConfirmedAiAccounts(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}

const BANNER_KEY = "zen:ai-account:banner-dismissed";
const bannerListeners = new Set<() => void>();
let bannerDismissed = (() => {
  try {
    return globalThis.localStorage?.getItem(BANNER_KEY) === "1";
  } catch {
    return false;
  }
})();

/** The Birou question was answered ("Alt cont" or hidden): it does not come back on every visit. */
export function dismissAiAccountBanner(): void {
  bannerDismissed = true;
  try {
    globalThis.localStorage?.setItem(BANNER_KEY, "1");
  } catch {}
  for (const listener of bannerListeners) listener();
}

export function useAiAccountBannerDismissed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      bannerListeners.add(listener);
      return () => bannerListeners.delete(listener);
    },
    () => bannerDismissed,
    () => bannerDismissed,
  );
}
