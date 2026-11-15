// Zen Staff: relative times ("5m ago") in the app's language.
import { relativeTimeElapsedMs, formatRelativeTimeLabel } from "../../timestampFormat";
import type { ZenLocale } from "./zenI18n";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** "5m ago" in English (the upstream label), "acum 5 minute" in Romanian. */
export function formatZenRelativeTime(locale: ZenLocale, isoDate: string): string {
  if (locale === "en") return formatRelativeTimeLabel(isoDate);
  const elapsed = relativeTimeElapsedMs(isoDate);
  if (elapsed === null) return "";
  if (elapsed < MINUTE_MS) return "chiar acum";
  const format = new Intl.RelativeTimeFormat("ro-RO", { numeric: "auto" });
  if (elapsed < HOUR_MS) return format.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return format.format(-Math.floor(elapsed / HOUR_MS), "hour");
  return format.format(-Math.floor(elapsed / DAY_MS), "day");
}
