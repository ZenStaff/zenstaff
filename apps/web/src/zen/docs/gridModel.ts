// Zen Staff document editing: the grid the CSV and XLSX editors share. Every edit is an
// operation; the grid applies it for display and keeps it in a log, which is what an XLSX save
// replays onto the original file and what a merge replays onto someone else's newer version.

import { recalculateSheets } from "./formulaEval";

/** How an XLSX cell looks in the file: number format, font and fill (only what the grid shows). */
export interface GridCellFormat {
  /** Excel number format code ("0.00%", "#,##0.00 \"lei\""), null for General. */
  readonly numFmt: string | null;
  readonly bold: boolean;
  readonly italic: boolean;
  /** CSS colors ("#1f2937"), null when the file leaves them to the theme. */
  readonly color: string | null;
  readonly fill: string | null;
}

export interface GridCell {
  /** Shown value (an XLSX formula cell shows its last calculated result). */
  readonly display: string;
  /** Formula without "=" for XLSX formula cells. */
  readonly formula: string | null;
  /** The result was recalculated here (formulaEval.ts), so a save writes it as the cached value. */
  readonly computed?: boolean;
  readonly format?: GridCellFormat;
}

export interface GridSheet {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<GridCell | null>>;
}

export type GridOp =
  | {
      readonly type: "set";
      readonly sheet: string;
      readonly row: number;
      readonly col: number;
      /** As typed: "=SUM(A1:A3)" for a formula. */
      readonly text: string;
    }
  | {
      readonly type: "insertRows" | "deleteRows" | "insertCols" | "deleteCols";
      readonly sheet: string;
      readonly at: number;
      readonly count: number;
    };

/** What the cell editor starts with: the formula for formula cells, else the value. */
export function editText(cell: GridCell | null | undefined): string {
  if (cell === null || cell === undefined) return "";
  return cell.formula !== null ? `=${cell.formula}` : cell.display;
}

function typedCell(text: string, format: GridCellFormat | undefined): GridCell | null {
  if (text === "") return null;
  const keep = format === undefined ? {} : { format };
  // A new formula shows its text until the recalculation works it out.
  return text.startsWith("=") && text.length > 1
    ? { display: text, formula: text.slice(1), ...keep }
    : { display: text, formula: null, ...keep };
}

function withRows(
  rows: ReadonlyArray<ReadonlyArray<GridCell | null>>,
  change: (rows: Array<Array<GridCell | null>>) => void,
): ReadonlyArray<ReadonlyArray<GridCell | null>> {
  const copy = rows.map((row) => [...row]);
  change(copy);
  return copy;
}

export function applyOp(sheets: ReadonlyArray<GridSheet>, op: GridOp): ReadonlyArray<GridSheet> {
  return sheets.map((sheet) => {
    if (sheet.name !== op.sheet) return sheet;
    const rows = withRows(sheet.rows, (copy) => {
      switch (op.type) {
        case "set": {
          while (copy.length <= op.row) copy.push([]);
          const row = copy[op.row]!;
          while (row.length < op.col) row.push(null);
          // The cell keeps its look (number format, bold, colors), as in Excel.
          row[op.col] = typedCell(op.text, row[op.col]?.format);
          return;
        }
        case "insertRows":
          copy.splice(
            Math.min(op.at, copy.length),
            0,
            ...Array.from({ length: op.count }, () => []),
          );
          return;
        case "deleteRows":
          copy.splice(op.at, op.count);
          return;
        case "insertCols":
          for (const row of copy) {
            if (row.length > op.at)
              row.splice(op.at, 0, ...Array.from({ length: op.count }, () => null));
          }
          return;
        case "deleteCols":
          for (const row of copy) row.splice(op.at, op.count);
          return;
      }
    });
    return { ...sheet, rows };
  });
}

export const cellAt = (sheet: GridSheet | undefined, row: number, col: number): GridCell | null =>
  sheet?.rows[row]?.[col] ?? null;

export function columnCount(sheet: GridSheet): number {
  return sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
}

interface GridSnapshot {
  readonly sheets: ReadonlyArray<GridSheet>;
  readonly ops: ReadonlyArray<GridOp>;
}

/** Undo/redo over whole states with the op log kept in step (the log is what gets saved). */
export interface GridHistory extends GridSnapshot {
  readonly past: ReadonlyArray<GridSnapshot>;
  readonly future: ReadonlyArray<GridSnapshot>;
}

const HISTORY_LIMIT = 200;

export const startHistory = (sheets: ReadonlyArray<GridSheet>): GridHistory => ({
  sheets,
  ops: [],
  past: [],
  future: [],
});

export function historyApply(history: GridHistory, op: GridOp): GridHistory {
  // Typing the value a cell already has is not an edit.
  if (op.type === "set") {
    const sheet = history.sheets.find((candidate) => candidate.name === op.sheet);
    if (editText(cellAt(sheet, op.row, op.col)) === op.text) return history;
  }
  return {
    // Formulas that depend on the edit show their new results right away.
    sheets: recalculateSheets(applyOp(history.sheets, op)),
    ops: [...history.ops, op],
    past: [...history.past, { sheets: history.sheets, ops: history.ops }].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export function historyUndo(history: GridHistory): GridHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    ...previous,
    past: history.past.slice(0, -1),
    future: [...history.future, { sheets: history.sheets, ops: history.ops }],
  };
}

export function historyRedo(history: GridHistory): GridHistory {
  const next = history.future.at(-1);
  if (next === undefined) return history;
  return {
    ...next,
    past: [...history.past, { sheets: history.sheets, ops: history.ops }],
    future: history.future.slice(0, -1),
  };
}

export interface GridMerge {
  readonly sheets: ReadonlyArray<GridSheet>;
  readonly ops: ReadonlyArray<GridOp>;
  /** Cells both sides changed; mine was kept. "Sheet1!B2". */
  readonly conflicts: ReadonlyArray<string>;
}

/**
 * My edits replayed onto their newer version. A cell I set that they also changed (compared
 * with what I opened) is a conflict; my value wins and the cell is listed.
 */
export function mergeGrid(
  base: ReadonlyArray<GridSheet>,
  theirs: ReadonlyArray<GridSheet>,
  ops: ReadonlyArray<GridOp>,
  name: (sheet: string, row: number, col: number) => string,
): GridMerge {
  let mine = base;
  let merged = theirs;
  const conflicts: Array<string> = [];
  for (const op of ops) {
    if (op.type === "set") {
      const before = editText(
        cellAt(
          mine.find((sheet) => sheet.name === op.sheet),
          op.row,
          op.col,
        ),
      );
      const theirsNow = editText(
        cellAt(
          merged.find((sheet) => sheet.name === op.sheet),
          op.row,
          op.col,
        ),
      );
      if (before !== theirsNow && theirsNow !== op.text)
        conflicts.push(name(op.sheet, op.row, op.col));
    }
    mine = applyOp(mine, op);
    merged = applyOp(merged, op);
  }
  return { sheets: recalculateSheets(merged), ops, conflicts: [...new Set(conflicts)] };
}
