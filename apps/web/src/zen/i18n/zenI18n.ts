// Zen Staff: a small i18n layer for Zen-owned UI. Upstream T3 Code has no i18n system, so Zen pages
// keep their strings in per-feature dictionaries (`defineZenMessages`) and read them through
// `useZenText`. The language follows the browser/OS, with an override in Settings > General.
// Upstream strings visible in Office go through `upstreamText.ts` instead. See ZEN.md, "Languages".
import { useSyncExternalStore } from "react";

import {
  getZenAccountPreferences,
  subscribeZenAccountPreferences,
  writeZenAccountPreferences,
} from "../account/accountPreferences";

export const ZEN_LOCALES = ["en", "ro"] as const;
export type ZenLocale = (typeof ZEN_LOCALES)[number];
export type ZenLocalePreference = "auto" | ZenLocale;
const ZEN_DEFAULT_LOCALE: ZenLocale = "en";

/** Native names, shown in the language picker. */
export const ZEN_LOCALE_NAMES: Record<ZenLocale, string> = { en: "English", ro: "Română" };

const PREFERENCE_KEY = "zen:locale";

function isZenLocale(value: unknown): value is ZenLocale {
  return typeof value === "string" && (ZEN_LOCALES as ReadonlyArray<string>).includes(value);
}

/** Time zones of Romania and Moldova: a strong hint when the OS language list is English only. */
const ROMANIAN_TIME_ZONES = new Set(["Europe/Bucharest", "Europe/Chisinau", "Europe/Tiraspol"]);

/**
 * Romanian when any listed language is Romanian (a Windows in English often lists "ro" second) or
 * the computer's time zone is Romania's; else the first supported language, else English.
 */
export function detectZenLocale(
  languages: ReadonlyArray<string | undefined>,
  timeZone?: string,
): ZenLocale {
  const bases = languages.map((language) => language?.trim().toLowerCase().split(/[-_]/)[0]);
  if (bases.includes("ro")) return "ro";
  if (timeZone !== undefined && ROMANIAN_TIME_ZONES.has(timeZone)) return "ro";
  for (const base of bases) {
    if (isZenLocale(base)) return base;
  }
  return ZEN_DEFAULT_LOCALE;
}

function systemTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** What "Automatic" means on this device (browser/OS languages and time zone). */
export function detectSystemZenLocale(): ZenLocale {
  return detectZenLocale(browserLanguages(), systemTimeZone());
}

/**
 * The account's language (hub, when signed in) wins; then this device's choice; "auto" follows
 * the browser/OS.
 */
export function resolveZenLocale(
  preference: ZenLocalePreference,
  languages: ReadonlyArray<string | undefined>,
  account: ZenLocale | null = null,
  timeZone?: string,
): ZenLocale {
  if (account) return account;
  return preference === "auto" ? detectZenLocale(languages, timeZone) : preference;
}

function accountLocale(): ZenLocale | null {
  const value = getZenAccountPreferences().locale;
  return isZenLocale(value) ? value : null;
}

function browserLanguages(): ReadonlyArray<string> {
  const nav = globalThis.navigator;
  if (!nav) return [];
  return nav.languages && nav.languages.length > 0 ? nav.languages : [nav.language];
}

function readPreference(): ZenLocalePreference {
  try {
    const value = globalThis.localStorage?.getItem(PREFERENCE_KEY);
    return value === "auto" || isZenLocale(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

let preference: ZenLocalePreference = readPreference();
let currentLocale: ZenLocale = resolveZenLocale(
  preference,
  browserLanguages(),
  accountLocale(),
  systemTimeZone(),
);
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getZenLocale(): ZenLocale {
  return currentLocale;
}

function getZenLocalePreference(): ZenLocalePreference {
  return preference;
}

function subscribeZenLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Saves the language choice for this browser ("auto" follows the browser/OS). */
export function setZenLocalePreference(next: ZenLocalePreference): void {
  preference = next;
  try {
    if (next === "auto") globalThis.localStorage?.removeItem(PREFERENCE_KEY);
    else globalThis.localStorage?.setItem(PREFERENCE_KEY, next);
  } catch {
    // Storage may be blocked; the choice still applies until reload.
  }
  writeZenAccountPreferences({ locale: next === "auto" ? null : next });
  const resolved = resolveZenLocale(next, browserLanguages(), accountLocale(), systemTimeZone());
  if (resolved !== currentLocale) currentLocale = resolved;
  notify();
}

function refreshLocale() {
  const resolved = resolveZenLocale(
    preference,
    browserLanguages(),
    accountLocale(),
    systemTimeZone(),
  );
  if (resolved === currentLocale) return;
  currentLocale = resolved;
  notify();
}

subscribeZenAccountPreferences(refreshLocale);

if (typeof globalThis.addEventListener === "function") {
  // The OS/browser language changed while the app was open.
  globalThis.addEventListener("languagechange", refreshLocale);
}

export function useZenLocale(): ZenLocale {
  return useSyncExternalStore(subscribeZenLocale, getZenLocale, getZenLocale);
}

export function useZenLocalePreference(): ZenLocalePreference {
  return useSyncExternalStore(subscribeZenLocale, getZenLocalePreference, getZenLocalePreference);
}

// Dictionaries.

/**
 * A dictionary entry: a string, a function for text with values (counts, names), or a small
 * object of forms (such as `{ one, other }` for `countLabel`).
 */
export type ZenMessages = Readonly<Record<string, unknown>>;

/**
 * One feature's strings. English is the source; every other language must have every key, so a
 * missing translation is a type error. At runtime a missing key still falls back to English.
 */
export interface ZenMessageCatalog<T extends ZenMessages> {
  readonly en: T;
  readonly ro: { readonly [K in keyof T]: T[K] };
}

export function defineZenMessages<T extends ZenMessages>(
  catalog: ZenMessageCatalog<T>,
): ZenMessageCatalog<T> {
  return catalog;
}

const resolvedCache = new WeakMap<object, Partial<Record<ZenLocale, unknown>>>();

/** The catalog in one language, falling back to English key by key. */
export function zenMessagesFor<T extends ZenMessages>(
  catalog: ZenMessageCatalog<T>,
  locale: ZenLocale,
): T {
  if (locale === "en") return catalog.en;
  let byLocale = resolvedCache.get(catalog);
  if (!byLocale) {
    byLocale = {};
    resolvedCache.set(catalog, byLocale);
  }
  const cached = byLocale[locale] as T | undefined;
  if (cached) return cached;
  const translated = catalog[locale] as Partial<T> | undefined;
  const merged: Record<string, unknown> = { ...catalog.en };
  for (const key of Object.keys(catalog.en)) {
    const value = translated?.[key as keyof T];
    if (value !== undefined && value !== "") merged[key] = value;
  }
  byLocale[locale] = merged;
  return merged as T;
}

/** The catalog in the current language; re-renders when the language changes. */
export function useZenText<T extends ZenMessages>(catalog: ZenMessageCatalog<T>): T {
  return zenMessagesFor(catalog, useZenLocale());
}

/** The catalog in the current language, for code outside React (palette items, toasts). */
export function zenText<T extends ZenMessages>(catalog: ZenMessageCatalog<T>): T {
  return zenMessagesFor(catalog, getZenLocale());
}

/**
 * A count with its noun. Romanian puts "de" before the noun from 20 on ("20 de fișiere") and
 * after round hundreds; English only needs singular/plural.
 */
export function countLabel(
  locale: ZenLocale,
  count: number,
  forms: { readonly one: string; readonly other: string },
): string {
  if (count === 1) return `1 ${forms.one}`;
  if (locale === "ro") {
    const rest = count % 100;
    const needsDe = count !== 0 && (rest === 0 || rest >= 20);
    return needsDe ? `${count} de ${forms.other}` : `${count} ${forms.other}`;
  }
  return `${count} ${forms.other}`;
}
