// Zen Staff: seam for per-person preferences (edition, language). Nothing registers today, so
// both stay per device; the hub client registers a source later, whose values win, with the
// device copy as fallback. A source's write() must update read() optimistically. No runtime imports.

export interface ZenAccountPreferences {
  /** "office" | "code"; null or absent = the account has no choice yet. */
  readonly edition?: "office" | "code" | null;
  /** "en" | "ro"; null or absent = follow the device. */
  readonly locale?: "en" | "ro" | null;
}

export interface ZenAccountPreferencesSource {
  readonly id: string;
  /** The account's current values (synchronous: the hub client keeps them cached). */
  readonly read: () => ZenAccountPreferences;
  /** Called when the account's values change (another device saved a choice). */
  readonly subscribe: (listener: () => void) => () => void;
  /** Saves a choice made on this device to the account. */
  readonly write?: (change: ZenAccountPreferences) => void | Promise<void>;
}

const EMPTY: ZenAccountPreferences = {};
let source: ZenAccountPreferencesSource | null = null;
let unsubscribeSource: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The account's values, or `{}` when no account source is registered. */
export function getZenAccountPreferences(): ZenAccountPreferences {
  if (!source) return EMPTY;
  try {
    return source.read();
  } catch {
    return EMPTY;
  }
}

export function subscribeZenAccountPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registers the account source (one at a time). Returns a function that removes it. */
export function registerZenAccountPreferences(next: ZenAccountPreferencesSource): () => void {
  unsubscribeSource?.();
  source = next;
  unsubscribeSource = next.subscribe(notify);
  notify();
  return () => {
    if (source !== next) return;
    unsubscribeSource?.();
    unsubscribeSource = null;
    source = null;
    notify();
  };
}

/** Passes a choice made on this device to the account, when one is registered. */
export function writeZenAccountPreferences(change: ZenAccountPreferences): void {
  const write = source?.write;
  if (!write) return;
  try {
    // Synchronous call, so an optimistic read() applies before the stores recompute.
    void Promise.resolve(write(change)).catch(() => undefined);
  } catch {
    // The device value still applies; the account keeps its old value.
  }
}
