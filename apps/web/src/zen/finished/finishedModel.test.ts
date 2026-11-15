import { describe, expect, it } from "vite-plus/test";

import { filterFinished, groupFinishedByDay } from "./finishedModel";

const at = (key: string, title: string, finishedAt: string) => ({ key, title, finishedAt });
const labels = { today: "Azi", yesterday: "Ieri" };

describe("finished tasks", () => {
  const now = new Date(2026, 10, 8, 15, 0);
  const threads = [
    at("a", "Ofertă Hotel Carpați", new Date(2026, 10, 8, 9, 0).toISOString()),
    at("b", "Raport vânzări", new Date(2026, 10, 7, 18, 0).toISOString()),
    at("c", "Ședință săptămânală", new Date(2026, 10, 8, 14, 0).toISOString()),
    at("d", "Facturi octombrie", new Date(2026, 10, 3, 10, 0).toISOString()),
    at("e", "Bilanț 2025", new Date(2025, 11, 30, 10, 0).toISOString()),
  ];

  it("groups by day, newest first, with Today and Yesterday", () => {
    const days = groupFinishedByDay(threads, now, "ro", labels);
    expect(days.map((day) => day.label)).toEqual([
      "Azi",
      "Ieri",
      "Marți, 3 noiembrie",
      "30 decembrie 2025",
    ]);
    expect(days[0]!.threads.map((thread) => thread.key)).toEqual(["c", "a"]);
  });

  it("uses English dates in English", () => {
    const days = groupFinishedByDay(threads, now, "en", { today: "Today", yesterday: "Yesterday" });
    expect(days[2]!.label).toBe("Tuesday, November 3");
  });

  it("searches titles without caring about case or diacritics", () => {
    expect(filterFinished(threads, "sedinta").map((thread) => thread.key)).toEqual(["c"]);
    expect(filterFinished(threads, "RAPORT vanzari").map((thread) => thread.key)).toEqual(["b"]);
    expect(filterFinished(threads, "  ")).toHaveLength(5);
    expect(filterFinished(threads, "nimic")).toEqual([]);
  });
});
