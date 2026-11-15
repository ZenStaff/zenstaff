// Zen Staff: finished (settled) tasks grouped by day, with search. Pure; finishedModel.test.ts.
import type { ZenLocale } from "../i18n/zenI18n";

export interface FinishedThread {
  readonly key: string;
  readonly title: string;
  /** When it was finished (settledAt), else its last update. ISO. */
  readonly finishedAt: string;
}

export interface FinishedDay<T extends FinishedThread> {
  readonly key: string;
  readonly label: string;
  readonly threads: ReadonlyArray<T>;
}

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Lowercase without diacritics, so "facturi" finds "Facturi" and "sedinta" finds "ședință". */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function filterFinished<T extends FinishedThread>(
  threads: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return threads;
  return threads.filter((thread) => {
    const title = foldText(thread.title);
    return words.every((word) => title.includes(word));
  });
}

/** Newest day first; "Today", "Yesterday", then the weekday and date. */
export function groupFinishedByDay<T extends FinishedThread>(
  threads: ReadonlyArray<T>,
  now: Date,
  locale: ZenLocale,
  labels: { readonly today: string; readonly yesterday: string },
): ReadonlyArray<FinishedDay<T>> {
  const today = localDayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = localDayKey(yesterdayDate);
  const sameYear = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const otherYear = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const sorted = threads.toSorted((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
  const days: Array<{ key: string; label: string; threads: T[] }> = [];
  for (const thread of sorted) {
    const date = new Date(thread.finishedAt);
    const key = Number.isNaN(date.getTime()) ? "unknown" : localDayKey(date);
    let day = days.at(-1);
    if (day?.key !== key) {
      const label =
        key === today
          ? labels.today
          : key === yesterday
            ? labels.yesterday
            : key === "unknown"
              ? "-"
              : (date.getFullYear() === now.getFullYear() ? sameYear : otherYear).format(date);
      day = { key, label: label.charAt(0).toUpperCase() + label.slice(1), threads: [] };
      days.push(day);
    }
    day.threads.push(thread);
  }
  return days;
}
