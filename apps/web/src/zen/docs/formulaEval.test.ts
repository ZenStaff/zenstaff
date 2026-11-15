import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";

import { cellColors, formatCellDisplay } from "./cellFormat";
import { recalculateSheets } from "./formulaEval";
import { historyApply, startHistory, type GridCell, type GridSheet } from "./gridModel";
import { readXlsx, saveXlsx } from "./xlsx";
import { buildWorkbook } from "./xlsxFixture";

const value = (display: string): GridCell => ({ display, formula: null });
const formula = (text: string, cached: string): GridCell => ({ display: cached, formula: text });

/** The food-cost sheet from the review: F5 price, G5 VAT, H5 net = IF(F5>0,F5/(1+G5),0). */
const foodCost: GridSheet = {
  name: "Fise",
  rows: [
    [value("Produs"), value("Pret"), value("TVA"), value("Net"), value("Total")],
    [
      value("Ciorba"),
      value("24"),
      value("0.11"),
      formula("IF(B2>0,B2/(1+C2),0)", "21.6216216216216"),
      formula("SUM(D2:D3)", "39.6"),
    ],
    [value("Placinta"), value("20"), value("0.11"), formula("ROUND(B3/(1+C3),2)", "18.02")],
  ],
};

const displayAt = (sheets: ReadonlyArray<GridSheet>, row: number, col: number) =>
  sheets[0]!.rows[row]![col]!.display;

describe("formula recalculation", () => {
  it("updates dependent formulas after an edit, through chains", () => {
    const history = historyApply(startHistory([foodCost]), {
      type: "set",
      sheet: "Fise",
      row: 1,
      col: 1,
      text: "25",
    });
    expect(displayAt(history.sheets, 1, 3)).toBe("22.5225225225225");
    expect(history.sheets[0]!.rows[1]![3]!.computed).toBe(true);
    // E2 = D2 + D3 follows D2.
    expect(Number(displayAt(history.sheets, 1, 4))).toBeCloseTo(22.5225 + 18.02, 3);
    // Untouched results keep their cached text and are not marked.
    expect(history.sheets[0]!.rows[2]![3]).toEqual(foodCost.rows[2]![3]);
  });

  it("works out a typed formula and common functions", () => {
    const sheet: GridSheet = {
      name: "S",
      rows: [
        [value("1"), value("2"), value("3"), value("x")],
        [
          formula("AVERAGE(A1:C1)", ""),
          formula('COUNTIF(A1:D1,">1")', ""),
          formula('A1&"-"&D1', ""),
        ],
        [
          formula('IFERROR(1/0,"n/a")', ""),
          formula("1/0", ""),
          formula("SUMPRODUCT(A1:C1,A1:C1)", ""),
        ],
        [
          formula("MAX(A1:C1)-MIN(A1:C1)", ""),
          formula("AND(A1>0,B1>1)", ""),
          formula("0.1+0.2", ""),
        ],
        [formula("ROUNDUP(2.341,1)", ""), formula("25%*B1", ""), formula("2^3", "")],
      ],
    };
    const [out] = recalculateSheets([sheet]);
    const shown = out!.rows.map((row) => row.map((cell) => cell?.display));
    expect(shown[1]).toEqual(["2", "2", "1-x"]);
    expect(shown[2]).toEqual(["n/a", "#DIV/0!", "14"]);
    expect(shown[3]).toEqual(["2", "TRUE", "0.3"]);
    expect(shown[4]).toEqual(["2.4", "0.5", "8"]);
  });

  it("leaves cells it cannot work out (unknown functions, names, cycles, other sheets) alone", () => {
    const sheet: GridSheet = {
      name: "S",
      rows: [
        [
          formula("OFFSET(B1,1,1)", "7"),
          formula("Rate*2", "4"),
          formula("C1+1", "9"),
          formula("A1+1", "8"),
          formula("Other!A1", "5"),
        ],
      ],
    };
    const [out] = recalculateSheets([sheet]);
    expect(out!.rows[0]!.map((cell) => cell?.display)).toEqual(["7", "4", "9", "8", "5"]);
    expect(out!.rows[0]!.some((cell) => cell?.computed)).toBe(false);
  });

  it("looks values up and rounds to a step, as food-cost sheets do", () => {
    const sheet: GridSheet = {
      name: "S",
      rows: [
        [value("Orez"), value("6.2")],
        [value("Ceapă"), value("3.1")],
        [
          formula('INDEX(B1:B2,MATCH("Ceapă",A1:A2,0))', ""),
          formula('VLOOKUP("Orez",A1:B2,2,FALSE)', ""),
          formula("CEILING(B1*3.3,0.5)", ""),
          formula('MATCH("x",A1:A2,0)', ""),
        ],
      ],
    };
    const [out] = recalculateSheets([sheet]);
    expect(out!.rows[2]!.map((cell) => cell?.display)).toEqual(["3.1", "6.2", "20.5", "#N/A"]);
  });

  it("uses the cached result of a formula it cannot work out when others depend on it", () => {
    const sheet: GridSheet = {
      name: "S",
      rows: [[value("2"), formula("OFFSET(A1,0,0)*10", "20"), formula("B1+A1", "0")]],
    };
    const [out] = recalculateSheets([sheet]);
    expect(out!.rows[0]![1]!.display).toBe("20");
    expect(out!.rows[0]![2]).toMatchObject({ display: "22", computed: true });
  });

  it("follows references to another sheet, quoted names included", () => {
    const other: GridSheet = { name: "Rezumat lunar", rows: [[value("10")]] };
    const sheet: GridSheet = { name: "S", rows: [[formula("'Rezumat lunar'!A1*3", "0")]] };
    expect(recalculateSheets([sheet, other])[0]!.rows[0]![0]!.display).toBe("30");
  });

  it("keeps the cell's look when its value is edited", () => {
    const styled: GridSheet = {
      name: "S",
      rows: [
        [
          {
            display: "0.11",
            formula: null,
            format: { numFmt: "0%", bold: true, italic: false, color: null, fill: "#fde68a" },
          },
        ],
      ],
    };
    const history = historyApply(startHistory([styled]), {
      type: "set",
      sheet: "S",
      row: 0,
      col: 0,
      text: "0.19",
    });
    expect(history.sheets[0]!.rows[0]![0]!.format?.numFmt).toBe("0%");
    expect(history.sheets[0]!.rows[0]![0]!.format?.fill).toBe("#fde68a");
  });
});

describe("number formats in the grid", () => {
  const format = (numFmt: string) => ({
    numFmt,
    bold: false,
    italic: false,
    color: null,
    fill: null,
  });
  it("shows percent, decimals, thousands and currency text", () => {
    expect(formatCellDisplay("0.11", format("0%"), "en-US")).toBe("11%");
    expect(formatCellDisplay("0.1234", format("0.00%"), "en-US")).toBe("12.34%");
    expect(formatCellDisplay("1234.5", format("#,##0.00"), "en-US")).toBe("1,234.50");
    expect(formatCellDisplay("1234.5", format('#,##0.00 "lei"'), "en-US")).toBe("1,234.50 lei");
    expect(formatCellDisplay("12", format("[$RON-418] #,##0"), "en-US")).toBe("RON 12");
    expect(formatCellDisplay("-5", format("#,##0;(#,##0)"), "en-US")).toBe("(5)");
    expect(formatCellDisplay("21.6216", format("0.00"), "en-US")).toBe("21.62");
  });

  it("keeps fills and real colors, drops black or gray text without a fill", () => {
    const look = (color: string | null, fill: string | null) => ({
      numFmt: null,
      bold: false,
      italic: false,
      color,
      fill,
    });
    expect(cellColors(look("#ffffff", "#1f4d3a"))).toEqual({
      backgroundColor: "#1f4d3a",
      color: "#ffffff",
    });
    expect(cellColors(look(null, "#fde68a"))).toEqual({
      backgroundColor: "#fde68a",
      color: "#111827",
    });
    expect(cellColors(look("#1e1e1c", null))).toBeUndefined();
    expect(cellColors(look("#c0392b", null))).toEqual({ color: "#c0392b" });
  });

  it("leaves text, General and dates as they are", () => {
    expect(formatCellDisplay("abc", format("0%"))).toBe("abc");
    expect(formatCellDisplay("0.11", undefined)).toBe("0.11");
    expect(formatCellDisplay("45000", format("dd.mm.yyyy"))).toBe("45000");
  });
});

describe("saving recalculated results", () => {
  it("writes the new cached value of dependent formulas, keeping the formula", async () => {
    const original = await buildWorkbook();
    const workbook = await readXlsx(original);
    // Vanzari: B2..B4 values, B5 = SUM(B2:B4), D5 = B5*2.
    const history = historyApply(startHistory(workbook.sheets), {
      type: "set",
      sheet: "Vanzari",
      row: 1,
      col: 1,
      text: "20",
    });
    const sales = history.sheets[0]!;
    expect(sales.rows[4]![1]!.display).toBe("64");
    expect(sales.rows[4]![3]!.display).toBe("128");
    const saved = await saveXlsx(original, history.ops, history.sheets);
    const xml = (await (
      await JSZip.loadAsync(saved)
    )
      .file("xl/worksheets/sheet1.xml")
      ?.async("string"))!;
    expect(xml).toMatch(/<c r="B5"[^>]*><f>SUM\(B2:B4\)<\/f><v>64<\/v><\/c>/);
    expect(xml).toMatch(/<c r="D5"[^>]*><f>B5\*2<\/f><v>128<\/v><\/c>/);
    const reread = await readXlsx(saved);
    expect(reread.sheets[0]!.rows[4]![1]).toMatchObject({ display: "64", formula: "SUM(B2:B4)" });
  });
});
