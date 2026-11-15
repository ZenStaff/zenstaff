import { describe, expect, it } from "vite-plus/test";

import {
  askTitle,
  continueItems,
  dayPart,
  firstName,
  type ContinueThread,
} from "./officeHome.logic";

const thread = (id: string, patch: Partial<ContinueThread> = {}): ContinueThread => ({
  id,
  environmentId: "env",
  projectId: "p1",
  title: id,
  updatedAt: "2026-11-08T10:00:00.000Z",
  archivedAt: null,
  settled: false,
  needsYou: false,
  working: false,
  ...patch,
});

describe("dayPart", () => {
  it("splits the day in three", () => {
    expect(dayPart(new Date(2026, 10, 8, 4, 59))).toBe("evening");
    expect(dayPart(new Date(2026, 10, 8, 5, 0))).toBe("morning");
    expect(dayPart(new Date(2026, 10, 8, 12, 0))).toBe("day");
    expect(dayPart(new Date(2026, 10, 8, 18, 0))).toBe("evening");
  });
});

describe("firstName", () => {
  it("takes the first word and refuses emails or empty names", () => {
    expect(firstName("Andrei Pop")).toBe("Andrei");
    expect(firstName("  Maria ")).toBe("Maria");
    expect(firstName("andrei@casaverde.example")).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});

describe("continueItems", () => {
  it("puts threads that wait for you first, then working ones, then the newest", () => {
    const items = continueItems(
      [
        thread("old", { updatedAt: "2026-11-01T10:00:00.000Z" }),
        thread("new", { updatedAt: "2026-11-08T12:00:00.000Z" }),
        thread("working", { working: true, updatedAt: "2026-11-02T10:00:00.000Z" }),
        thread("asks", { needsYou: true, updatedAt: "2026-10-01T10:00:00.000Z" }),
      ],
      () => true,
    );
    expect(items.map((item) => [item.thread.id, item.state])).toEqual([
      ["asks", "needs-you"],
      ["working", "working"],
      ["new", "recent"],
      ["old", "recent"],
    ]);
  });

  it("skips archived, settled and other folders' threads, and keeps the limit", () => {
    const items = continueItems(
      [
        thread("archived", { archivedAt: "2026-11-08T10:00:00.000Z" }),
        thread("settled", { settled: true }),
        thread("elsewhere", { projectId: "scratch" }),
        thread("a"),
        thread("b"),
      ],
      (_, projectId) => projectId === "p1",
      1,
    );
    expect(items.map((item) => item.thread.id)).toEqual(["a"]);
  });
});

describe("askTitle", () => {
  it("uses the first line and cuts long ones at a word", () => {
    expect(askTitle("\n  Scrie o ofertă \nmai multe")).toBe("Scrie o ofertă");
    const long =
      "Citește facturile din octombrie și fă-mi un tabel cu furnizorii, sumele și scadențele lor";
    const title = askTitle(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
  });
});
