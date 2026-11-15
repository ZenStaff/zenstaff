import { describe, expect, it } from "vite-plus/test";

import { matchLines, mergeText } from "./textMerge";

describe("mergeText", () => {
  const base = ["# Meniu", "", "Ciorbă 18", "Sarmale 32", "Plăcintă 12", ""].join("\n");

  it("takes changes from both sides when they touch different lines", () => {
    const mine = base.replace("Ciorbă 18", "Ciorbă 19");
    const theirs = base.replace("Plăcintă 12", "Plăcintă 13");
    expect(mergeText(base, mine, theirs)).toEqual({
      text: base.replace("Ciorbă 18", "Ciorbă 19").replace("Plăcintă 12", "Plăcintă 13"),
      conflicts: 0,
    });
  });

  it("marks lines both sides changed differently", () => {
    const merged = mergeText(
      base,
      base.replace("Sarmale 32", "Sarmale 30"),
      base.replace("Sarmale 32", "Sarmale 35"),
    );
    expect(merged.conflicts).toBe(1);
    expect(merged.text).toContain("<<<<<<< mine\nSarmale 30\n=======\nSarmale 35\n>>>>>>> theirs");
  });

  it("handles one side unchanged, the same edit on both sides, and inserted lines", () => {
    expect(mergeText(base, base, "x").text).toBe("x");
    expect(mergeText(base, "same", "same").text).toBe("same");
    const mine = base.replace("Sarmale 32", "Sarmale 32\nMici 5");
    const theirs = `Antet\n${base}`;
    expect(mergeText(base, mine, theirs)).toEqual({ text: `Antet\n${mine}`, conflicts: 0 });
  });

  it("matches lines like an LCS", () => {
    expect(matchLines(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"])).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
  });
});
