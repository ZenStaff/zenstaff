// Zen Staff document editing: the grid for CSV/TSV and XLSX. Only visible rows render; every
// change is an op (gridModel.ts) that undo, save and merge share.
import {
  ArrowDownToLineIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpToLineIcon,
  Columns3Icon,
  Rows3Icon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";

import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { useZenText } from "../i18n/zenI18n";
import { addressName, columnName } from "./cellRefs";
import { parseCsv, serializeCsv, shiftQuoted, type CsvDocument } from "./csv";
import { docsText } from "./docs.i18n";
import { EditorToolButton } from "./EditorToolButton";
import { decodeText, encodeText, type FormatEditorProps } from "./formatEditor";
import {
  cellAt,
  columnCount,
  editText,
  historyApply,
  historyRedo,
  historyUndo,
  mergeGrid,
  startHistory,
  type GridHistory,
  type GridOp,
  type GridSheet,
} from "./gridModel";
import { cellColors, formatCellDisplay } from "./cellFormat";
import { readXlsx, saveXlsx } from "./xlsx";

const ROW_HEIGHT = 28;
const OVERSCAN = 12;
const MAX_RENDERED_COLS = 200;

interface Loaded {
  readonly sheets: ReadonlyArray<GridSheet>;
  readonly csv: CsvDocument | null;
}

async function load(kind: "csv" | "xlsx", bytes: Uint8Array, fileName: string): Promise<Loaded> {
  if (kind === "xlsx") {
    const workbook = await readXlsx(bytes);
    return {
      sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows })),
      csv: null,
    };
  }
  const csv = parseCsv(decodeText(bytes), fileName);
  return {
    csv,
    sheets: [
      {
        name: "CSV",
        rows: csv.rows.map((row) =>
          row.map((value) => (value === "" ? null : { display: value, formula: null })),
        ),
      },
    ],
  };
}

function csvBytes(csv: CsvDocument, sheet: GridSheet, ops: ReadonlyArray<GridOp>): Uint8Array {
  let quoted: Set<string> = new Set(csv.quoted);
  for (const op of ops) {
    if (op.type === "set") continue;
    const axis = op.type.endsWith("Rows") ? "row" : "col";
    quoted = shiftQuoted(quoted, axis, op.at, op.type.startsWith("insert") ? op.count : -op.count);
  }
  // Rows keep their own length (a trailing empty value is a trailing delimiter in the file).
  const rows = sheet.rows.map((row) => Array.from(row, (cell) => editText(cell)));
  return encodeText(serializeCsv({ ...csv, rows, quoted }));
}

interface Selection {
  readonly row: number;
  readonly col: number;
  readonly toRow: number;
  readonly toCol: number;
}

const ORIGIN: Selection = { row: 0, col: 0, toRow: 0, toCol: 0 };

const box = (selection: Selection) => ({
  top: Math.min(selection.row, selection.toRow),
  bottom: Math.max(selection.row, selection.toRow),
  left: Math.min(selection.col, selection.toCol),
  right: Math.max(selection.col, selection.toCol),
});

function selectionText(sheet: GridSheet, selection: Selection): string {
  const range = box(selection);
  const lines: Array<string> = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const values: Array<string> = [];
    for (let col = range.left; col <= range.right; col += 1)
      values.push(cellAt(sheet, row, col)?.display ?? "");
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}

interface Model {
  readonly loaded: Loaded;
  readonly history: GridHistory;
  /** The bytes the op log starts from (the opened or last saved file). */
  readonly original: Uint8Array;
}

export default function GridEditor(props: FormatEditorProps & { readonly kind: "csv" | "xlsx" }) {
  const t = useZenText(docsText);
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(ORIGIN);
  const [editing, setEditing] = useState<{ row: number; col: number; text: string } | null>(null);
  const [barText, setBarText] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // Keys go to a hidden input: the app treats a focused input as typing, so its own shortcuts
  // (type anywhere to write in the chat) stay out of the grid.
  const sink = useRef<HTMLInputElement>(null);
  const { onDirty, onSelection, kind, fileName, bytes } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- parsing the file is async work started by the bytes the shell hands in.
  useEffect(() => {
    let cancelled = false;
    void load(kind, bytes, fileName).then(
      (loaded) => {
        if (cancelled) return;
        setModel({ loaded, history: startHistory(loaded.sheets), original: bytes });
        setSheetName(loaded.sheets[0]?.name ?? null);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bytes, fileName, kind]);

  // The grid's height decides how many rows render; it is measured while the grid is mounted.
  const attachScroller = (element: HTMLDivElement | null) => {
    scroller.current = element;
    if (element === null) return;
    const stop = observeResize(element, () => setViewport(element.clientHeight));
    return () => {
      stop();
      scroller.current = null;
    };
  };

  const sheets = model?.history.sheets ?? [];
  const sheet = sheets.find((candidate) => candidate.name === sheetName) ?? sheets[0];

  const apply = (op: GridOp) => {
    if (model === null) return;
    const history = historyApply(model.history, op);
    if (history === model.history) return;
    setModel({ ...model, history });
    onDirty();
  };

  useImperativeHandle(props.controller, () => ({
    serialize: async () => {
      if (model === null) return bytes;
      if (kind === "xlsx") return saveXlsx(model.original, model.history.ops, model.history.sheets);
      return csvBytes(model.loaded.csv!, model.history.sheets[0]!, model.history.ops);
    },
    markSaved: (saved) => {
      if (model === null) return;
      setModel({
        // The saved text is the new reference for quoting.
        loaded:
          kind === "csv"
            ? { ...model.loaded, csv: parseCsv(decodeText(saved), fileName) }
            : model.loaded,
        history: startHistory(model.history.sheets),
        original: saved,
      });
    },
    undo: () => {
      if (model === null) return;
      setModel({ ...model, history: historyUndo(model.history) });
      onDirty();
    },
    redo: () => {
      if (model === null) return;
      setModel({ ...model, history: historyRedo(model.history) });
      onDirty();
    },
    merge: async (base, theirs) => {
      if (model === null) return null;
      const ops = model.history.ops;
      const [mine, other] = await Promise.all([
        load(kind, base, fileName),
        load(kind, theirs, fileName),
      ]);
      const merged = mergeGrid(mine.sheets, other.sheets, ops, (name, row, col) =>
        kind === "xlsx" ? `${name}!${addressName({ row, col })}` : addressName({ row, col }),
      );
      const mergedBytes =
        kind === "xlsx"
          ? await saveXlsx(theirs, ops, merged.sheets)
          : csvBytes(other.csv!, merged.sheets[0]!, ops);
      const shown =
        merged.conflicts.slice(0, 8).join(", ") + (merged.conflicts.length > 8 ? "…" : "");
      return {
        bytes: mergedBytes,
        notice: merged.conflicts.length === 0 ? t.mergedClean : t.mergedCells(shown),
      };
    },
  }));

  if (error !== null) return <p className="p-4 text-destructive text-sm">{error}</p>;
  if (model === null || sheet === undefined) return null;

  const width = Math.min(MAX_RENDERED_COLS, Math.max(columnCount(sheet) + 1, 6));
  const height = Math.max(sheet.rows.length + 1, 20);
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(height, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const rows = Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index);
  const range = box(selection);
  const active = cellAt(sheet, selection.row, selection.col);

  const select = (next: Selection) => {
    setSelection(next);
    setBarText(null);
    const picked = box(next);
    const label =
      picked.top === picked.bottom && picked.left === picked.right
        ? addressName({ row: picked.top, col: picked.left })
        : `${addressName({ row: picked.top, col: picked.left })}:${addressName({ row: picked.bottom, col: picked.right })}`;
    onSelection({
      label: kind === "xlsx" ? `${sheet.name}!${label}` : label,
      text: selectionText(sheet, next),
      language: "tsv",
    });
  };

  const commit = (row: number, col: number, text: string) =>
    apply({ type: "set", sheet: sheet.name, row, col, text });

  const scrollTo = (row: number) => {
    const element = scroller.current;
    if (element === null) return;
    const top = (row + 1) * ROW_HEIGHT;
    if (top < element.scrollTop + ROW_HEIGHT) element.scrollTop = top - ROW_HEIGHT;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  };

  const move = (dRow: number, dCol: number, extend = false) => {
    const row = Math.max(0, (extend ? selection.toRow : selection.row) + dRow);
    const col = Math.max(0, (extend ? selection.toCol : selection.col) + dCol);
    select(
      extend ? { ...selection, toRow: row, toCol: col } : { row, col, toRow: row, toCol: col },
    );
    scrollTo(row);
  };

  const structural = (type: Exclude<GridOp["type"], "set">, at: number, count: number) =>
    apply({ type, sheet: sheet.name, at, count });

  const clearSelection = () => {
    let history = model.history;
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let col = range.left; col <= range.right; col += 1) {
        history = historyApply(history, { type: "set", sheet: sheet.name, row, col, text: "" });
      }
    }
    if (history === model.history) return;
    setModel({ ...model, history });
    onDirty();
  };

  const pasteAt = (text: string) => {
    let history = model.history;
    const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
    lines.forEach((line, dRow) =>
      line.split("\t").forEach((value, dCol) => {
        history = historyApply(history, {
          type: "set",
          sheet: sheet.name,
          row: selection.row + dRow,
          col: selection.col + dCol,
          text: value,
        });
      }),
    );
    if (history === model.history) return;
    setModel({ ...model, history });
    onDirty();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (editing !== null) return;
    const shift = event.shiftKey;
    switch (event.key) {
      case "ArrowUp":
        move(-1, 0, shift);
        break;
      case "ArrowDown":
        move(1, 0, shift);
        break;
      case "ArrowLeft":
        move(0, -1, shift);
        break;
      case "ArrowRight":
        move(0, 1, shift);
        break;
      case "Tab":
        move(0, shift ? -1 : 1);
        break;
      case "Enter":
      case "F2":
        setEditing({ row: selection.row, col: selection.col, text: editText(active) });
        break;
      case "Delete":
      case "Backspace":
        clearSelection();
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          setEditing({ row: selection.row, col: selection.col, text: event.key });
          event.preventDefault();
        }
        return;
    }
    event.preventDefault();
  };

  const finishEdit = (row: number, col: number, text: string, dRow: number, dCol: number) => {
    commit(row, col, text);
    setEditing(null);
    if (dRow !== 0 || dCol !== 0) {
      const nextRow = Math.max(0, row + dRow);
      const nextCol = Math.max(0, col + dCol);
      setSelection({ row: nextRow, col: nextCol, toRow: nextRow, toCol: nextCol });
      scrollTo(nextRow);
    }
    sink.current?.focus({ preventScroll: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-zen-no-translate>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <span className="w-20 shrink-0 font-mono text-muted-foreground text-xs">
          {addressName({ row: selection.row, col: selection.col })}
        </span>
        <input
          aria-label={t.cellContent}
          aria-description={t.formulaHint}
          placeholder={t.formulaHint}
          className="h-7 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-xs"
          value={barText ?? editText(active)}
          onChange={(event) => setBarText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              finishEdit(selection.row, selection.col, barText ?? editText(active), 1, 0);
              setBarText(null);
            } else if (event.key === "Escape") {
              setBarText(null);
              sink.current?.focus({ preventScroll: true });
            }
          }}
          onBlur={() => {
            if (barText !== null) commit(selection.row, selection.col, barText);
            setBarText(null);
          }}
        />
        <div className="flex items-center">
          <EditorToolButton
            label={t.insertRowAbove}
            onPress={() => structural("insertRows", range.top, 1)}
          >
            <ArrowUpToLineIcon />
          </EditorToolButton>
          <EditorToolButton
            label={t.insertRowBelow}
            onPress={() => structural("insertRows", range.bottom + 1, 1)}
          >
            <ArrowDownToLineIcon />
          </EditorToolButton>
          <EditorToolButton
            label={t.deleteRow}
            onPress={() => structural("deleteRows", range.top, range.bottom - range.top + 1)}
          >
            <Rows3Icon />
          </EditorToolButton>
          <EditorToolButton
            label={t.insertColLeft}
            onPress={() => structural("insertCols", range.left, 1)}
          >
            <ArrowLeftToLineIcon />
          </EditorToolButton>
          <EditorToolButton
            label={t.insertColRight}
            onPress={() => structural("insertCols", range.right + 1, 1)}
          >
            <ArrowRightToLineIcon />
          </EditorToolButton>
          <EditorToolButton
            label={t.deleteCol}
            onPress={() => structural("deleteCols", range.left, range.right - range.left + 1)}
          >
            <Columns3Icon />
          </EditorToolButton>
          <EditorToolButton label={t.clearCells} onPress={clearSelection}>
            <Trash2Icon />
          </EditorToolButton>
        </div>
      </div>
      <div
        ref={attachScroller}
        role="grid"
        aria-rowcount={height}
        aria-colcount={width}
        className="relative min-h-0 flex-1 overflow-auto outline-none"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        <input
          ref={sink}
          aria-label={t.cellContent}
          className="sr-only"
          value=""
          readOnly
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            if (editing !== null) return;
            const text = event.clipboardData.getData("text/plain");
            if (text === "") return;
            event.preventDefault();
            pasteAt(text);
          }}
          onCopy={(event) => {
            if (editing !== null) return;
            event.preventDefault();
            event.clipboardData.setData("text/plain", selectionText(sheet, selection));
          }}
        />
        <div
          style={{ height: (height + 1) * ROW_HEIGHT, width: 48 + width * 112 }}
          className="relative"
        >
          <div className="sticky top-0 z-20 flex bg-muted" style={{ height: ROW_HEIGHT }}>
            <div className="sticky left-0 z-30 w-12 shrink-0 border-r border-b bg-muted" />
            {Array.from({ length: width }, (_, col) => (
              <div
                key={col}
                className={cn(
                  "flex w-28 shrink-0 items-center justify-center border-r border-b text-muted-foreground text-xs",
                  col >= range.left && col <= range.right && "bg-accent text-foreground",
                )}
              >
                {columnName(col)}
              </div>
            ))}
          </div>
          {rows.map((row) => (
            <div
              key={row}
              role="row"
              className="absolute left-0 flex"
              style={{ top: (row + 1) * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <div
                className={cn(
                  "sticky left-0 z-10 flex w-12 shrink-0 items-center justify-end border-r border-b bg-muted pr-1.5 text-muted-foreground text-xs",
                  row >= range.top && row <= range.bottom && "bg-accent text-foreground",
                )}
              >
                {row + 1}
              </div>
              {Array.from({ length: width }, (_, col) => {
                const cell = cellAt(sheet, row, col);
                const selected =
                  row >= range.top &&
                  row <= range.bottom &&
                  col >= range.left &&
                  col <= range.right;
                const isActive = row === selection.row && col === selection.col;
                const isEditing = editing !== null && editing.row === row && editing.col === col;
                return (
                  <div
                    key={col}
                    role="gridcell"
                    aria-selected={selected}
                    data-cell={addressName({ row, col })}
                    className={cn(
                      "relative w-28 shrink-0 truncate border-r border-b px-1.5 text-xs leading-6.75",
                      selected && "bg-primary/8",
                      isActive && "outline-2 outline-primary -outline-offset-2",
                      cell?.formula != null &&
                        cellColors(cell.format) === undefined &&
                        "text-info-foreground",
                      cell !== null &&
                        /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(cell.display) &&
                        "text-right tabular-nums",
                      cell?.format?.bold && "font-semibold",
                      cell?.format?.italic && "italic",
                    )}
                    style={cellColors(cell?.format)}
                    onMouseDown={(event) => {
                      if (isEditing) return;
                      setDragging(true);
                      select(
                        event.shiftKey
                          ? { ...selection, toRow: row, toCol: col }
                          : { row, col, toRow: row, toCol: col },
                      );
                      sink.current?.focus({ preventScroll: true });
                      event.preventDefault();
                    }}
                    onMouseEnter={() => {
                      if (dragging) select({ ...selection, toRow: row, toCol: col });
                    }}
                    onDoubleClick={() => setEditing({ row, col, text: editText(cell) })}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        aria-label={t.cellContent}
                        className="absolute inset-0 z-10 h-full w-full bg-background px-1.5 font-mono text-xs outline-2 outline-primary"
                        value={editing.text}
                        onChange={(event) =>
                          setEditing({ row, col, text: event.currentTarget.value })
                        }
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            finishEdit(row, col, editing.text, event.shiftKey ? -1 : 1, 0);
                          } else if (event.key === "Tab") {
                            event.preventDefault();
                            finishEdit(row, col, editing.text, 0, event.shiftKey ? -1 : 1);
                          } else if (event.key === "Escape") {
                            setEditing(null);
                            sink.current?.focus({ preventScroll: true });
                          }
                        }}
                        onBlur={() => {
                          commit(row, col, editing.text);
                          setEditing(null);
                        }}
                      />
                    ) : (
                      formatCellDisplay(cell?.display ?? "", cell?.format)
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {sheets.length > 1 ? (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t px-2 py-1">
          <ToggleGroup
            aria-label={t.sheets}
            variant="segmented"
            value={[sheet.name]}
            onValueChange={(next) => {
              const value = next[0];
              if (typeof value === "string") {
                setSheetName(value);
                setSelection(ORIGIN);
              }
            }}
          >
            {sheets.map((candidate) => (
              <Toggle key={candidate.name} value={candidate.name}>
                {candidate.name}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
    </div>
  );
}
