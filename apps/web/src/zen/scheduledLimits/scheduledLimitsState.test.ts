import { describe, expect, it } from "vite-plus/test";

import {
  describeLimits,
  draftFromLimits,
  eventLabel,
  eventTone,
  formatDuration,
  formatTokens,
  limitsFromDraft,
  parseLimit,
} from "./scheduledLimitsState";

const empty = { maxRunsPerDay: "", maxDurationMinutes: "", quietStart: "", quietEnd: "" };

describe("parseLimit", () => {
  it("reads empty as no limit and whole numbers in range", () => {
    expect(parseLimit("  ", 10)).toEqual({ value: null });
    expect(parseLimit(" 7 ", 10)).toEqual({ value: 7 });
    expect(parseLimit("0", 10)).toEqual({ error: "Use 1 to 10, or leave empty." });
    expect(parseLimit("11", 10)).toEqual({ error: "Use 1 to 10, or leave empty." });
    expect(parseLimit("2.5", 10)).toEqual({ error: "Use a whole number, or leave empty." });
  });
});

describe("limitsFromDraft", () => {
  it("round-trips through the draft", () => {
    const limits = {
      maxRunsPerDay: 5,
      maxDurationMinutes: 30,
      quietHours: { start: "22:00", end: "07:00" },
    };
    expect(limitsFromDraft(draftFromLimits(limits))).toEqual({ limits });
  });

  it("clears every limit from an empty draft", () => {
    expect(limitsFromDraft(empty)).toEqual({
      limits: { maxRunsPerDay: null, maxDurationMinutes: null, quietHours: null },
    });
  });

  it("names the field that is wrong", () => {
    expect(limitsFromDraft({ ...empty, maxRunsPerDay: "x" })).toEqual({
      error: "Runs per day: Use a whole number, or leave empty.",
    });
    expect(limitsFromDraft({ ...empty, quietStart: "22:00" })).toEqual({
      error: "Quiet hours need both a start and an end.",
    });
    expect(limitsFromDraft({ ...empty, quietStart: "9pm", quietEnd: "07:00" })).toEqual({
      error: "Quiet hours use HH:MM, such as 22:00.",
    });
    expect(limitsFromDraft({ ...empty, quietStart: "07:00", quietEnd: "07:00" })).toEqual({
      error: "Quiet hours need a start and an end that differ.",
    });
  });
});

describe("labels", () => {
  it("describes limits in one line", () => {
    expect(
      describeLimits({ maxRunsPerDay: null, maxDurationMinutes: null, quietHours: null }),
    ).toBe("No limits");
    expect(
      describeLimits({
        maxRunsPerDay: 4,
        maxDurationMinutes: 20,
        quietHours: { start: "22:00", end: "07:00" },
      }),
    ).toBe("4/day · 20 min max · quiet 22:00-07:00");
  });

  it("formats tokens and durations compactly", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(25_000)).toBe("25k");
    expect(formatTokens(2_300_000)).toBe("2.3M");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(5 * 60_000 + 3_000)).toBe("5m 3s");
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });

  it("labels and colors events", () => {
    expect(eventLabel({ kind: "skipped", state: null })).toBe("Skipped");
    expect(eventTone({ kind: "skipped", state: null })).toBe("warning");
    expect(eventLabel({ kind: "queued", state: null })).toBe("Queued");
    expect(eventLabel({ kind: "run", state: "stopped" })).toBe("Stopped (max duration)");
    expect(eventTone({ kind: "run", state: "completed" })).toBe("success");
    expect(eventTone({ kind: "run", state: "dispatch_failed" })).toBe("error");
  });
});
