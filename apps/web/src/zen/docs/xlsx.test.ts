import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";

import { shiftFormula, shiftRangeList, translateFormula } from "./cellRefs";
import {
  applyOp,
  historyApply,
  historyRedo,
  historyUndo,
  mergeGrid,
  startHistory,
  type GridOp,
  type GridSheet,
} from "./gridModel";
import { isoToSerial, readXlsx, saveXlsx, serialToIso } from "./xlsx";
import { CHART_XML, buildWorkbook } from "./xlsxFixture";

const text = async (bytes: Uint8Array, path: string) =>
  (await (await JSZip.loadAsync(bytes)).file(path)?.async("string")) ?? null;

describe("cell references", () => {
  it("translates relative parts of a shared formula and leaves strings and names alone", () => {
    expect(translateFormula("B4*2+$C$1+LOG10(A1)", 1, 0)).toBe("B5*2+$C$1+LOG10(A2)");
    expect(translateFormula('"A1"&A1', 0, 1)).toBe('"A1"&B1');
    expect(translateFormula("A1", -1, 0)).toBe("#REF!");
  });

  it("shifts references into the changed sheet only, shrinking or breaking removed ranges", () => {
    const insert = { axis: "row", at: 2, delta: 1 } as const;
    expect(shiftFormula("SUM(B2:B4)", "Vanzari", "Vanzari", insert)).toBe("SUM(B2:B5)");
    expect(shiftFormula("Vanzari!B5+'Rezumat lunar'!B5", "Rezumat lunar", "Vanzari", insert)).toBe(
      "Vanzari!B6+'Rezumat lunar'!B5",
    );
    const remove = { axis: "row", at: 1, delta: -2 } as const;
    expect(shiftFormula("SUM(B2:B4)+B2+$B$5", "S", "S", remove)).toBe("SUM(B2:B2)+#REF!+$B$3");
    expect(shiftFormula("SUM(A:A)+SUM(2:3)", "S", "S", remove)).toBe("SUM(A:A)+SUM(#REF!)");
    expect(shiftRangeList("A1:B2 D4", { axis: "col", at: 0, delta: -1 })).toBe("A1:A2 C4");
  });
});

describe("XLSX round trip", () => {
  it("reads values, shared and rich strings, dates and formulas of every sheet", async () => {
    const workbook = await readXlsx(await buildWorkbook());
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Vanzari", "Rezumat lunar"]);
    const [sales] = workbook.sheets;
    expect(sales!.rows[1]!.map((cell) => cell?.display)).toEqual(["Ciorbă", "18.5", "2024-11-01"]);
    expect(sales!.rows[2]![0]?.display).toBe("Sarmale & mămăligă");
    expect(sales!.rows[4]![1]).toMatchObject({ display: "62.5", formula: "SUM(B2:B4)" });
    // The shared formula's dependent cell gets its own translated formula.
    expect(sales!.rows[4]![3]).toEqual({ display: "125", formula: "B5*2" });
  });

  it("saving without edits gives back the same file", async () => {
    const original = await buildWorkbook();
    expect(await saveXlsx(original, [])).toBe(original);
  });

  it("edits cells and keeps styles, formulas, other parts; recalculation is requested", async () => {
    const original = await buildWorkbook();
    const ops: ReadonlyArray<GridOp> = [
      { type: "set", sheet: "Vanzari", row: 1, col: 1, text: "19" },
      { type: "set", sheet: "Vanzari", row: 2, col: 0, text: 'Sarmale <mari> & "bune"' },
      { type: "set", sheet: "Vanzari", row: 1, col: 2, text: "2026-11-08" },
      { type: "set", sheet: "Vanzari", row: 5, col: 2, text: "=B5/3" },
      { type: "set", sheet: "Vanzari", row: 3, col: 0, text: "" },
    ];
    const saved = await saveXlsx(original, ops);
    const reread = await readXlsx(saved);
    const sales = reread.sheets[0]!;
    expect(sales.rows[1]![1]?.display).toBe("19");
    expect(sales.rows[2]![0]?.display).toBe('Sarmale <mari> & "bune"');
    expect(sales.rows[1]![2]?.display).toBe("2026-11-08");
    expect(sales.rows[5]![2]?.formula).toBe("B5/3");
    expect(sales.rows[3]![0] ?? null).toBeNull();
    expect(sales.rows[4]![1]?.formula).toBe("SUM(B2:B4)");
    const sheetXml = (await text(saved, "xl/worksheets/sheet1.xml"))!;
    // The price keeps its number style, the date its date style.
    expect(sheetXml).toContain('<c r="B2" s="1"><v>19</v></c>');
    expect(sheetXml).toContain(`<c r="C2" s="2"><v>${isoToSerial("2026-11-08")}</v></c>`);
    expect(sheetXml).toContain('<mergeCell ref="A6:B6"/>');
    expect(await text(saved, "xl/charts/chart1.xml")).toBe(CHART_XML);
    expect(await text(saved, "xl/sharedStrings.xml")).toBe(
      await text(original, "xl/sharedStrings.xml"),
    );
    expect(await text(saved, "xl/worksheets/sheet2.xml")).toBe(
      await text(original, "xl/worksheets/sheet2.xml"),
    );
    expect(await text(saved, "xl/workbook.xml")).toContain('fullCalcOnLoad="1"');
    expect((await JSZip.loadAsync(saved)).file("xl/calcChain.xml")).toBeNull();
    expect(await text(saved, "[Content_Types].xml")).not.toContain("calcChain");
  });

  it("inserts and removes rows and columns, moving formulas, names, merges and ranges", async () => {
    const original = await buildWorkbook();
    const saved = await saveXlsx(original, [
      { type: "insertRows", sheet: "Vanzari", at: 1, count: 1 },
      { type: "set", sheet: "Vanzari", row: 1, col: 0, text: "Supă" },
      { type: "set", sheet: "Vanzari", row: 1, col: 1, text: "15" },
      { type: "deleteCols", sheet: "Vanzari", at: 2, count: 1 },
    ]);
    const reread = await readXlsx(saved);
    const sales = reread.sheets[0]!;
    expect(sales.rows[1]!.map((cell) => cell?.display ?? null)).toEqual(["Supă", "15"]);
    expect(sales.rows[5]![1]?.formula).toBe("SUM(B3:B5)");
    // Column D moved to C; the unshared formulas moved with their rows.
    expect(sales.rows[4]![2]?.formula).toBe("B5*2");
    expect(sales.rows[5]![2]?.formula).toBe("B6*2");
    expect(reread.sheets[1]!.rows[0]![0]?.formula).toBe("Vanzari!B6+'Rezumat lunar'!B1");
    // A reference inside a string literal is text, not a reference.
    expect(reread.sheets[1]!.rows[0]![2]?.formula).toBe('"Vanzari!B2"&"x"');
    const sheetXml = (await text(saved, "xl/worksheets/sheet1.xml"))!;
    expect(sheetXml).toContain('<mergeCell ref="A7:B7"/>');
    expect(sheetXml).toContain('sqref="B3:B5"');
    expect(sheetXml).toContain('<dimension ref="A1:C6"/>');
    expect(await text(saved, "xl/workbook.xml")).toContain(
      '<definedName name="Total">Vanzari!$B$6</definedName>',
    );
  });

  it("converts serial dates both ways", () => {
    expect(serialToIso(45597)).toBe("2024-11-01");
    expect(serialToIso(45597.5)).toBe("2024-11-01 12:00:00");
    expect(isoToSerial("2024-11-01")).toBe(45597);
    expect(isoToSerial("31.10.2024")).toBeNull();
  });
});

describe("grid edits", () => {
  const sheet: GridSheet = {
    name: "S",
    rows: [
      [
        { display: "a", formula: null },
        { display: "b", formula: null },
      ],
      [{ display: "c", formula: null }],
    ],
  };

  it("undoes and redoes, keeping the op log in step", () => {
    let history = startHistory([sheet]);
    history = historyApply(history, { type: "set", sheet: "S", row: 0, col: 0, text: "x" });
    history = historyApply(history, { type: "set", sheet: "S", row: 0, col: 0, text: "x" });
    history = historyApply(history, { type: "insertRows", sheet: "S", at: 0, count: 1 });
    expect(history.ops).toHaveLength(2);
    history = historyUndo(history);
    expect(history.ops).toHaveLength(1);
    expect(history.sheets[0]!.rows[0]![0]?.display).toBe("x");
    history = historyUndo(history);
    expect(history.sheets[0]!.rows[0]![0]?.display).toBe("a");
    history = historyRedo(history);
    expect(history.sheets[0]!.rows[0]![0]?.display).toBe("x");
    expect(history.future).toHaveLength(1);
  });

  it("merges my edits onto their version and lists cells both changed", () => {
    const theirs = applyOp(
      applyOp([sheet], { type: "set", sheet: "S", row: 1, col: 0, text: "theirs" }),
      {
        type: "set",
        sheet: "S",
        row: 0,
        col: 1,
        text: "B-theirs",
      },
    );
    const merged = mergeGrid(
      [sheet],
      theirs,
      [
        { type: "set", sheet: "S", row: 0, col: 0, text: "mine" },
        { type: "set", sheet: "S", row: 1, col: 0, text: "mine too" },
      ],
      (name, row, col) => `${name}!${row}:${col}`,
    );
    expect(merged.conflicts).toEqual(["S!1:0"]);
    expect(merged.sheets[0]!.rows.map((row) => row.map((cell) => cell?.display))).toEqual([
      ["mine", "B-theirs"],
      ["mine too"],
    ]);
  });
});
