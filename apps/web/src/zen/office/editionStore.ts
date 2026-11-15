// Zen Staff: the edition store, free of runtime imports so upstream guards can read it.
// Order: hub account (when registered) > this device's choice > server default > Code.
// Server and device values are cached in localStorage for the first paint. ZEN.md.
import { ZEN_DEFAULT_EDITION, type ZenEdition } from "@t3tools/contracts/zenOffice";

import {
  getZenAccountPreferences,
  subscribeZenAccountPreferences,
  writeZenAccountPreferences,
} from "../account/accountPreferences";

/** The server's default, cached so a reload paints the right edition before the RPC answers. */
const SERVER_EDITION_KEY = "zen:edition";
/** This device's own choice; absent means "use the server's default". */
const DEVICE_EDITION_KEY = "zen:edition:device";

function isEdition(value: unknown): value is ZenEdition {
  return value === "office" || value === "code";
}

function read(key: string): ZenEdition | null {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return isEdition(value) ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, value: ZenEdition | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the value still applies until reload.
  }
}

/** The account's choice first (when signed in to the hub), then the device's, then the server's default, then Code. */
export function effectiveEdition(
  device: ZenEdition | null,
  server: ZenEdition | null,
  account: ZenEdition | null = null,
): ZenEdition {
  return account ?? device ?? server ?? ZEN_DEFAULT_EDITION;
}

function accountEdition(): ZenEdition | null {
  const value = getZenAccountPreferences().edition;
  return isEdition(value) ? value : null;
}

let serverEdition: ZenEdition | null = read(SERVER_EDITION_KEY);
let deviceEdition: ZenEdition | null = read(DEVICE_EDITION_KEY);
let currentEdition: ZenEdition = effectiveEdition(deviceEdition, serverEdition, accountEdition());
const listeners = new Set<() => void>();

function recompute() {
  // Listeners also run when only the device or server value moved (the settings row shows both).
  currentEdition = effectiveEdition(deviceEdition, serverEdition, accountEdition());
  for (const listener of listeners) listener();
}

subscribeZenAccountPreferences(recompute);

export function getZenEdition(): ZenEdition {
  return currentEdition;
}

/** True in the Office edition. The one check every guard goes through. */
export function isZenOffice(): boolean {
  return currentEdition === "office";
}

export function getDeviceEdition(): ZenEdition | null {
  return deviceEdition;
}

export function getServerEdition(): ZenEdition | null {
  return serverEdition;
}

export function subscribeZenEdition(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The server's default edition arrived (or changed). */
export function applyServerEdition(edition: ZenEdition): void {
  serverEdition = edition;
  write(SERVER_EDITION_KEY, edition);
  recompute();
}

/** This device's choice; null goes back to the server's default. */
export function applyDeviceEdition(edition: ZenEdition | null): void {
  deviceEdition = edition;
  write(DEVICE_EDITION_KEY, edition);
  // Signed in to the hub: the choice follows the person to their other devices.
  writeZenAccountPreferences({ edition });
  recompute();
}
