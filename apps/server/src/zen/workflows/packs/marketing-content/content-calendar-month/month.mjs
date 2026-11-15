// The days of a month with their weekday, Romanian public holidays (Orthodox Easter and
// Pentecost computed) and the commercial / social dates brands usually post about.
//   node month.mjs 2026-12 [--lang ro|en] [--json]
// Use it for every date in the calendar: never work out weekdays from memory.
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const lang = args.includes("--lang") && args[args.indexOf("--lang") + 1] === "en" ? "en" : "ro";
const asJson = args.includes("--json");
const month = args.find((a) => /^\d{4}-\d{2}$/.test(a));

/** Orthodox Easter (Julian computus, shifted to the Gregorian calendar; valid 1900-2099). */
export function orthodoxEaster(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const monthJulian = Math.floor((d + e + 114) / 31);
  const dayJulian = ((d + e + 114) % 31) + 1;
  const date = new Date(Date.UTC(year, monthJulian - 1, dayJulian));
  date.setUTCDate(date.getUTCDate() + 13);
  return date.toISOString().slice(0, 10);
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The n-th given weekday (0 = Sunday) of a month; n = -1 for the last one. */
const nthWeekday = (year, month1, weekday, n) => {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return new Date(Date.UTC(year, month1 - 1, day)).toISOString().slice(0, 10);
  }
  const last = new Date(Date.UTC(year, month1, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - back);
  return last.toISOString().slice(0, 10);
};

export function datesOfYear(year) {
  const easter = orthodoxEaster(year);
  const legal = [
    [`${year}-01-01`, "Anul Nou", "New Year's Day"],
    [`${year}-01-02`, "A doua zi de Anul Nou", "Day after New Year's Day"],
    [`${year}-01-06`, "Boboteaza", "Epiphany (Orthodox)"],
    [`${year}-01-07`, "Sfântul Ioan Botezătorul", "Saint John the Baptist"],
    [`${year}-01-24`, "Ziua Unirii Principatelor Române", "Union Day"],
    [addDays(easter, -2), "Vinerea Mare", "Orthodox Good Friday"],
    [easter, "Paștele ortodox", "Orthodox Easter Sunday"],
    [addDays(easter, 1), "A doua zi de Paște", "Orthodox Easter Monday"],
    [`${year}-05-01`, "Ziua Muncii", "Labour Day"],
    [`${year}-06-01`, "Ziua Copilului", "Children's Day"],
    [addDays(easter, 49), "Rusaliile", "Orthodox Pentecost"],
    [addDays(easter, 50), "A doua zi de Rusalii", "Orthodox Pentecost Monday"],
    [`${year}-08-15`, "Adormirea Maicii Domnului (Sfânta Maria)", "Dormition of the Mother of God"],
    [`${year}-11-30`, "Sfântul Andrei", "Saint Andrew's Day"],
    [`${year}-12-01`, "Ziua Națională a României", "Romania's National Day"],
    [`${year}-12-25`, "Crăciunul", "Christmas Day"],
    [`${year}-12-26`, "A doua zi de Crăciun", "Second day of Christmas"],
  ].map(([date, ro, en]) => ({ date, name: lang === "ro" ? ro : en, kind: "legal" }));
  const social = [
    [`${year}-02-14`, "Valentine's Day", "Valentine's Day"],
    [`${year}-02-24`, "Dragobetele", "Dragobete (Romanian day of love)"],
    [`${year}-03-01`, "Mărțișorul", "Mărțișor (spring token day)"],
    [`${year}-03-08`, "Ziua Femeii", "International Women's Day"],
    [`${year}-04-01`, "1 Aprilie (ziua păcălelilor)", "April Fools' Day"],
    [
      nthWeekday(year, 5, 0, 1),
      "Ziua Mamei (prima duminică din mai)",
      "Mother's Day in Romania (first Sunday of May)",
    ],
    [`${year}-06-24`, "Ziua Iei (Sânziene)", "Romanian Blouse Day (Sânziene)"],
    [`${year}-10-31`, "Halloween", "Halloween"],
    [
      addDays(nthWeekday(year, 11, 4, 4), 1),
      "Black Friday (data din SUA; magazinele din România îl fac des mai devreme în noiembrie)",
      "Black Friday (US date; Romanian shops often run it earlier in November)",
    ],
    [`${year}-12-06`, "Moș Nicolae", "Saint Nicholas Day"],
    [`${year}-12-24`, "Ajunul Crăciunului", "Christmas Eve"],
    [`${year}-12-31`, "Revelionul", "New Year's Eve"],
  ].map(([date, ro, en]) => ({ date, name: lang === "ro" ? ro : en, kind: "social" }));
  return [...legal, ...social].sort((a, b) => a.date.localeCompare(b.date));
}

const DAYS = {
  ro: ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export function monthDays(ym) {
  const [y, m] = ym.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const special = datesOfYear(y);
  const days = [];
  for (let d = 1; d <= count; d++) {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    const iso = new Date(`${date}T00:00:00Z`);
    const thursday = new Date(iso);
    thursday.setUTCDate(iso.getUTCDate() + 3 - ((wd + 6) % 7));
    const week =
      1 +
      Math.round(
        ((thursday - new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))) / 86400000 -
          3 +
          ((new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4)).getUTCDay() + 6) % 7)) /
          7,
      );
    days.push({
      date,
      weekday: DAYS[lang][wd],
      weekend: wd === 0 || wd === 6,
      isoWeek: week,
      special: special
        .filter((s) => s.date === date)
        .map(
          (s) =>
            `${s.name}${s.kind === "legal" ? (lang === "ro" ? " (zi liberă legală)" : " (public holiday)") : ""}`,
        ),
    });
  }
  return days;
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("month.mjs")) {
  if (!month) {
    console.error("ERROR: Use node month.mjs YYYY-MM [--lang ro|en] [--json]");
    process.exit(1);
  }
  const days = monthDays(month);
  if (asJson) console.log(JSON.stringify(days, null, 1));
  else {
    for (const d of days)
      console.log(
        `${d.date}  ${d.weekday.padEnd(9)}  w${String(d.isoWeek).padStart(2, "0")}${d.special.length ? `  ${d.special.join("; ")}` : ""}`,
      );
    const [y, m] = month.split("-").map(Number);
    const next = datesOfYear(m === 12 ? y + 1 : y).filter(
      (s) =>
        s.date > `${month}-31` &&
        s.date <= `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, "0")}-15`,
    );
    if (next.length)
      console.log(
        `${lang === "ro" ? "La începutul lunii următoare" : "Early next month"}: ${next.map((s) => `${s.date} ${s.name}`).join("; ")}`,
      );
  }
}
