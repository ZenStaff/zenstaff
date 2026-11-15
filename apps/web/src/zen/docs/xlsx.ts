// Zen Staff document editing: XLSX read and surgical save with JSZip (already shipped). Only the
// parts an edit touches are rewritten; styles, charts, pivots and every other part stay byte for
// byte. Formulas stay formulas; edited workbooks recalculate on open (`fullCalcOnLoad`).
import JSZip from "jszip";

import {
  addressName,
  parseAddress,
  shiftFormula,
  shiftIndex,
  shiftRangeList,
  translateFormula,
  type Shift,
} from "./cellRefs";
import type { GridCellFormat, GridOp, GridSheet } from "./gridModel";

export interface XlsxCell {
  /** What the grid shows: the cached value, a date for date-formatted numbers. */
  readonly display: string;
  /** Formula without the leading "=". */
  readonly formula: string | null;
  readonly computed?: boolean;
  readonly format?: GridCellFormat;
}

export interface XlsxSheet {
  readonly name: string;
  readonly path: string;
  /** rows[r][c]; missing cells are null. */
  readonly rows: Array<Array<XlsxCell | null>>;
}

export interface XlsxWorkbook {
  readonly sheets: ReadonlyArray<XlsxSheet>;
}

const decoder = new TextDecoder();

// ─── XML helpers ────────────────────────────────────────────────────────────

export function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, name: string) => {
    const lower = name.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return match;
  });
}

export function escapeXml(text: string): string {
  return (
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Control characters other than tab/newline are not allowed in XML 1.0.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return match === null ? null : unescapeXml(match[1]!);
}

function setAttr(attrs: string, name: string, value: string | null): string {
  const pattern = new RegExp(`\\s${name}="[^"]*"`);
  if (value === null) return attrs.replace(pattern, "");
  const next = ` ${name}="${escapeXml(value)}"`;
  return pattern.test(attrs) ? attrs.replace(pattern, next) : `${attrs}${next}`;
}

/** Element prefix used by the file (`x:` in some generators, none in Excel's). */
function prefixOf(xml: string, local: string): string {
  return new RegExp(`<(\\w+:)?${local}[\\s>/]`).exec(xml)?.[1] ?? "";
}

function texts(xml: string): string {
  let text = "";
  for (const match of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) {
    text += unescapeXml(match[1]!);
  }
  return text;
}

// ─── Parts ──────────────────────────────────────────────────────────────────

interface SheetRef {
  readonly name: string;
  readonly path: string;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: Array<string> = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return out.join("/");
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file === null ? null : decoder.decode(await file.async("uint8array"));
}

async function sheetRefs(zip: JSZip): Promise<ReadonlyArray<SheetRef>> {
  const workbook = (await readText(zip, "xl/workbook.xml")) ?? "";
  const rels = (await readText(zip, "xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const id = attr(match[1]!, "Id");
    const target = attr(match[1]!, "Target");
    if (id !== null && target !== null) targets.set(id, resolveTarget(target));
  }
  const refs: Array<SheetRef> = [];
  for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const name = attr(match[1]!, "name");
    const id = attr(match[1]!, "r:id") ?? /\s\w+:id="([^"]*)"/.exec(match[1]!)?.[1] ?? null;
    const path = id === null ? undefined : targets.get(id);
    if (name !== null && path !== undefined && zip.file(path) !== null) refs.push({ name, path });
  }
  return refs;
}

async function sharedStrings(zip: JSZip): Promise<ReadonlyArray<string>> {
  const xml = await readText(zip, "xl/sharedStrings.xml");
  if (xml === null) return [];
  return [...xml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    // Phonetic runs (rPh) are reading aids, not text.
    texts(match[1]!.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "")),
  );
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Style indexes (cellXfs) whose number format is a date or time. */
async function dateStyles(zip: JSZip): Promise<ReadonlySet<number>> {
  const xml = await readText(zip, "xl/styles.xml");
  if (xml === null) return new Set();
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(match[1]!, "numFmtId"));
    const code = attr(match[1]!, "formatCode") ?? "";
    custom.set(id, code);
  }
  const isDate = (id: number) => {
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    if (code === undefined) return false;
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return /[dmyhs]/i.test(bare) && !/^[#0.,%E+-]*$/i.test(bare);
  };
  const cellXfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(xml)?.[1] ?? "";
  const result = new Set<number>();
  [...cellXfs.matchAll(/<(?:\w+:)?xf\b([^>]*)\/?>/g)].forEach((match, index) => {
    if (isDate(Number(attr(match[1]!, "numFmtId") ?? "0"))) result.add(index);
  });
  return result;
}

/** Excel's built-in number formats the grid can show (ids 1-11, 37-40, 48). */
const BUILTIN_NUMBER_FORMATS: Readonly<Record<number, string>> = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  48: "##0.0E+0",
};

/** An ARGB color from styles.xml ("FF1F2937") as CSS, or null (theme and indexed colors). */
function cssColor(attrs: string | undefined): string | null {
  if (attrs === undefined) return null;
  const rgb = attr(attrs, "rgb");
  if (rgb === null || !/^[0-9a-f]{6,8}$/i.test(rgb)) return null;
  return `#${rgb.slice(-6).toLowerCase()}`;
}

/** The look of every style index (cellXfs): number format, bold/italic, font color, solid fill. */
async function cellFormats(zip: JSZip): Promise<ReadonlyArray<GridCellFormat | undefined>> {
  const xml = await readText(zip, "xl/styles.xml");
  if (xml === null) return [];
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) {
    custom.set(
      Number(attr(match[1]!, "numFmtId")),
      unescapeXml(attr(match[1]!, "formatCode") ?? ""),
    );
  }
  const section = (name: string) =>
    new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`).exec(xml)?.[1] ??
    "";
  const fonts = [
    ...section("fonts").matchAll(/<(?:\w+:)?font\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?font>)/g),
  ].map((match) => {
    const inner = match[1] ?? "";
    return {
      bold: /<(?:\w+:)?b(?:\s+val="(?:1|true)")?\s*\/>/.test(inner),
      italic: /<(?:\w+:)?i(?:\s+val="(?:1|true)")?\s*\/>/.test(inner),
      color: cssColor(/<(?:\w+:)?color\b([^>]*)\/?>/.exec(inner)?.[1]),
    };
  });
  const fills = [
    ...section("fills").matchAll(/<(?:\w+:)?fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?fill>)/g),
  ].map((match) => {
    const inner = match[1] ?? "";
    if (!/patternType="solid"/.test(inner)) return null;
    return cssColor(/<(?:\w+:)?fgColor\b([^>]*)\/?>/.exec(inner)?.[1]);
  });
  return [...section("cellXfs").matchAll(/<(?:\w+:)?xf\b([^>]*)\/?>/g)].map((match) => {
    const attrs = match[1]!;
    const numFmtId = Number(attr(attrs, "numFmtId") ?? "0");
    const numFmt = custom.get(numFmtId) ?? BUILTIN_NUMBER_FORMATS[numFmtId] ?? null;
    const font = fonts[Number(attr(attrs, "fontId") ?? "0")];
    const fill = fills[Number(attr(attrs, "fillId") ?? "0")] ?? null;
    const format: GridCellFormat = {
      numFmt: numFmt === "General" ? null : numFmt,
      bold: font?.bold ?? false,
      italic: font?.italic ?? false,
      // Black text is the default; keep it themed so dark mode stays readable.
      color: font?.color === "#000000" ? null : (font?.color ?? null),
      fill,
    };
    return format.numFmt === null &&
      !format.bold &&
      !format.italic &&
      format.color === null &&
      format.fill === null
      ? undefined
      : format;
  });
}

async function uses1904(zip: JSZip): Promise<boolean> {
  const workbook = (await readText(zip, "xl/workbook.xml")) ?? "";
  return /<(?:\w+:)?workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);
}

/** Excel serial date to ISO (date, or date and time). */
export function serialToIso(serial: number, date1904 = false): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86_400_000);
  const iso = new Date(epoch + ms).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
}

export function isoToSerial(text: string, date1904 = false): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (match === null) return null;
  const [, y, m, d, hh = "0", mm = "0", ss = "0"] = match;
  const time = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  if (Number.isNaN(time)) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return (time - epoch) / 86_400_000;
}

// ─── Cells ──────────────────────────────────────────────────────────────────

interface RawCell {
  /** The whole `<c>` element. */
  readonly xml: string;
  readonly attrs: string;
  readonly inner: string;
  readonly ref: string;
}

const CELL = /<((?:\w+:)?)c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1c>)/g;
const ROW = /<((?:\w+:)?)row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1row>)/g;

function cellsOf(rowInner: string): Array<RawCell> {
  const cells: Array<RawCell> = [];
  for (const match of rowInner.matchAll(CELL)) {
    const ref = attr(match[2]!, "r");
    if (ref === null) continue;
    cells.push({ xml: match[0], attrs: match[2]!, inner: match[3] ?? "", ref });
  }
  return cells;
}

function formulaOf(inner: string): { readonly text: string | null; readonly attrs: string } | null {
  const match = /<(?:\w+:)?f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f>)/.exec(inner);
  return match === null
    ? null
    : { attrs: match[1]!, text: match[2] === undefined ? null : unescapeXml(match[2]) };
}

function valueOf(inner: string): string | null {
  const match = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
  return match === null ? null : unescapeXml(match[1]!);
}

function displayOf(
  cell: RawCell,
  strings: ReadonlyArray<string>,
  dates: ReadonlySet<number>,
  date1904: boolean,
): string {
  const type = attr(cell.attrs, "t") ?? "n";
  if (type === "inlineStr") return texts(cell.inner);
  const value = valueOf(cell.inner);
  if (value === null || value === "") {
    // A formula saved without a result (written by a library, never opened in Excel).
    const formula = formulaOf(cell.inner);
    return formula?.text ? `=${formula.text}` : "";
  }
  if (type === "s") return strings[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  if (type === "n") {
    const number = Number(value);
    const style = Number(attr(cell.attrs, "s") ?? "0");
    if (Number.isFinite(number) && dates.has(style)) return serialToIso(number, date1904);
    return Number.isFinite(number) ? String(number) : value;
  }
  return value;
}

/** Shared formulas: the master's text and anchor per group index. */
function sharedMasters(
  sheetXml: string,
): Map<string, { readonly text: string; readonly ref: string }> {
  const masters = new Map<string, { text: string; ref: string }>();
  for (const cell of cellsOf(sheetXml)) {
    const formula = formulaOf(cell.inner);
    if (formula === null || formula.text === null) continue;
    if (attr(formula.attrs, "t") !== "shared") continue;
    const si = attr(formula.attrs, "si");
    if (si !== null && !masters.has(si)) masters.set(si, { text: formula.text, ref: cell.ref });
  }
  return masters;
}

function cellFormula(
  cell: RawCell,
  masters: ReadonlyMap<string, { readonly text: string; readonly ref: string }>,
): string | null {
  const formula = formulaOf(cell.inner);
  if (formula === null) return null;
  if (formula.text !== null && formula.text !== "") return formula.text;
  if (attr(formula.attrs, "t") !== "shared") return null;
  const master = masters.get(attr(formula.attrs, "si") ?? "");
  const from = master === undefined ? null : parseAddress(master.ref);
  const to = parseAddress(cell.ref);
  if (master === undefined || from === null || to === null) return null;
  return translateFormula(master.text, to.row - from.row, to.col - from.col);
}

export async function readXlsx(bytes: Uint8Array): Promise<XlsxWorkbook> {
  const zip = await JSZip.loadAsync(bytes);
  const [refs, strings, dates, date1904, formats] = await Promise.all([
    sheetRefs(zip),
    sharedStrings(zip),
    dateStyles(zip),
    uses1904(zip),
    cellFormats(zip),
  ]);
  if (refs.length === 0) throw new Error("This file has no worksheets that can be edited.");
  const sheets: Array<XlsxSheet> = [];
  for (const ref of refs) {
    const xml = (await readText(zip, ref.path)) ?? "";
    const masters = sharedMasters(xml);
    const rows: Array<Array<XlsxCell | null>> = [];
    for (const cell of cellsOf(xml)) {
      const address = parseAddress(cell.ref);
      if (address === null) continue;
      const row = (rows[address.row] ??= []);
      const style = Number(attr(cell.attrs, "s") ?? "0");
      // Dates already show as dates; their format code is not applied again.
      const format = dates.has(style) ? undefined : formats[style];
      row[address.col] = {
        display: displayOf(cell, strings, dates, date1904),
        formula: cellFormula(cell, masters),
        ...(format === undefined ? {} : { format }),
      };
    }
    for (let index = 0; index < rows.length; index += 1) rows[index] ??= [];
    sheets.push({ name: ref.name, path: ref.path, rows });
  }
  return { sheets };
}

// ─── Saving ─────────────────────────────────────────────────────────────────

/** What a typed value becomes in the file. */
function cellXml(input: {
  readonly prefix: string;
  readonly ref: string;
  readonly style: string | null;
  readonly text: string;
  readonly dateStyled: boolean;
  readonly date1904: boolean;
}): string | null {
  const { prefix, ref } = input;
  const styleAttr = input.style === null ? "" : ` s="${escapeXml(input.style)}"`;
  const text = input.text;
  if (text === "") return input.style === null ? null : `<${prefix}c r="${ref}"${styleAttr}/>`;
  if (text.startsWith("=") && text.length > 1) {
    return `<${prefix}c r="${ref}"${styleAttr}><${prefix}f>${escapeXml(text.slice(1))}</${prefix}f></${prefix}c>`;
  }
  if (input.dateStyled) {
    const serial = isoToSerial(text, input.date1904);
    if (serial !== null)
      return `<${prefix}c r="${ref}"${styleAttr}><${prefix}v>${serial}</${prefix}v></${prefix}c>`;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text.trim()) && Number.isFinite(Number(text))) {
    return `<${prefix}c r="${ref}"${styleAttr}><${prefix}v>${Number(text)}</${prefix}v></${prefix}c>`;
  }
  if (text === "TRUE" || text === "FALSE") {
    return `<${prefix}c r="${ref}"${styleAttr} t="b"><${prefix}v>${text === "TRUE" ? 1 : 0}</${prefix}v></${prefix}c>`;
  }
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
  return `<${prefix}c r="${ref}"${styleAttr} t="inlineStr"><${prefix}is><${prefix}t${space}>${escapeXml(text)}</${prefix}t></${prefix}is></${prefix}c>`;
}

interface SheetRow {
  attrs: string;
  cells: Map<number, string>;
}

/** sheetData as rows of cell XML by column, so edits can address cells directly. */
class SheetData {
  readonly rows = new Map<number, SheetRow>();
  constructor(
    readonly prefix: string,
    sheetDataInner: string,
  ) {
    for (const match of sheetDataInner.matchAll(ROW)) {
      const rowNumber = Number(attr(match[2]!, "r"));
      const cells = new Map<number, string>();
      for (const cell of cellsOf(match[3] ?? "")) {
        const address = parseAddress(cell.ref);
        if (address !== null) cells.set(address.col, cell.xml);
      }
      const index = Number.isFinite(rowNumber) && rowNumber > 0 ? rowNumber - 1 : this.rows.size;
      this.rows.set(index, { attrs: match[2]!, cells });
    }
  }

  get(row: number, col: number): string | null {
    return this.rows.get(row)?.cells.get(col) ?? null;
  }

  set(row: number, col: number, xml: string | null): void {
    let entry = this.rows.get(row);
    if (entry === undefined) {
      if (xml === null) return;
      entry = { attrs: ` r="${row + 1}"`, cells: new Map() };
      this.rows.set(row, entry);
    }
    if (xml === null) entry.cells.delete(col);
    else entry.cells.set(col, xml);
  }

  /** Moves rows or columns; cells in a removed band are dropped. */
  shift(shift: Shift): void {
    const rows = [...this.rows.entries()];
    this.rows.clear();
    for (const [rowIndex, row] of rows) {
      const nextRow = shift.axis === "row" ? shiftIndex(rowIndex, shift) : rowIndex;
      if (nextRow === null) continue;
      const cells = new Map<number, string>();
      for (const [colIndex, xml] of row.cells) {
        const nextCol = shift.axis === "col" ? shiftIndex(colIndex, shift) : colIndex;
        if (nextCol === null) continue;
        const ref = addressName({ row: nextRow, col: nextCol });
        cells.set(nextCol, xml.replace(/(<(?:\w+:)?c\b[^>]*?\sr=")[^"]*"/, `$1${ref}"`));
      }
      // Column spans are a hint; drop them rather than keep a wrong one.
      const attrs = setAttr(setAttr(row.attrs, "r", String(nextRow + 1)), "spans", null);
      this.rows.set(nextRow, { attrs, cells });
    }
  }

  /** Every formula in the sheet, rewritten. */
  mapFormulas(map: (formula: string) => string): void {
    for (const row of this.rows.values()) {
      for (const [col, xml] of row.cells) {
        const next = xml.replace(
          /(<(?:\w+:)?f\b[^>]*>)([\s\S]*?)(<\/(?:\w+:)?f>)/,
          (_match, open: string, text: string, close: string) =>
            `${open}${escapeXml(map(unescapeXml(text)))}${close}`,
        );
        row.cells.set(col, next);
      }
    }
  }

  bounds(): string | null {
    let maxRow = -1;
    let maxCol = -1;
    for (const [rowIndex, row] of this.rows) {
      for (const col of row.cells.keys()) {
        maxRow = Math.max(maxRow, rowIndex);
        maxCol = Math.max(maxCol, col);
      }
    }
    return maxRow < 0 ? null : `A1:${addressName({ row: maxRow, col: maxCol })}`;
  }

  toXml(): string {
    const p = this.prefix;
    return [...this.rows.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, row]) => {
        const cells = [...row.cells.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(([, xml]) => xml);
        return cells.length === 0 && !/\s(ht|customHeight|hidden|s)="/.test(row.attrs)
          ? ""
          : `<${p}row${row.attrs}>${cells.join("")}</${p}row>`;
      })
      .join("");
  }
}

/** A formula cell's XML with `display` as its cached result (number, boolean, error or text). */
function withCachedValue(xml: string, display: string, prefix: string): string {
  const open = /^<(?:\w+:)?c\b([^>]*?)(\/?)>/.exec(xml);
  if (open === null) return xml;
  const formula = /<(?:\w+:)?f\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?f>)/.exec(xml)?.[0];
  if (formula === undefined) return xml;
  const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(display);
  const type = numeric
    ? null
    : display === "TRUE" || display === "FALSE"
      ? "b"
      : /^#(?:DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!)$/.test(display)
        ? "e"
        : "str";
  const value = type === "b" ? (display === "TRUE" ? "1" : "0") : display;
  const attrs = setAttr(open[1]!, "t", type);
  return `<${prefix}c${attrs}>${formula}<${prefix}v>${escapeXml(value)}</${prefix}v></${prefix}c>`;
}

/** Shared formulas become one formula per cell, so cells can be edited and moved one by one. */
function unshareFormulas(data: SheetData): void {
  const masters = new Map<string, { text: string; row: number; col: number }>();
  for (const [rowIndex, row] of data.rows) {
    for (const [col, xml] of row.cells) {
      const formula = formulaOf(xml);
      if (formula?.text && attr(formula.attrs, "t") === "shared") {
        const si = attr(formula.attrs, "si");
        if (si !== null && !masters.has(si))
          masters.set(si, { text: formula.text, row: rowIndex, col });
      }
    }
  }
  if (masters.size === 0) return;
  for (const [rowIndex, row] of data.rows) {
    for (const [col, xml] of row.cells) {
      const formula = formulaOf(xml);
      if (formula === null || attr(formula.attrs, "t") !== "shared") continue;
      const master = masters.get(attr(formula.attrs, "si") ?? "");
      if (master === undefined) continue;
      const text =
        formula.text && formula.text !== ""
          ? formula.text
          : translateFormula(master.text, rowIndex - master.row, col - master.col);
      row.cells.set(
        col,
        xml.replace(
          /<((?:\w+:)?)f\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?f>)/,
          (_match, p: string) => `<${p}f>${escapeXml(text)}</${p}f>`,
        ),
      );
    }
  }
}

function replaceSheetData(xml: string, data: SheetData): string {
  const p = data.prefix;
  const pattern = new RegExp(`<${p}sheetData\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${p}sheetData>)`);
  return xml.replace(pattern, `<${p}sheetData>${data.toXml()}</${p}sheetData>`);
}

function sheetDataInner(xml: string, prefix: string): string {
  return (
    new RegExp(`<${prefix}sheetData\\b[^>]*?>([\\s\\S]*?)<\\/${prefix}sheetData>`).exec(xml)?.[1] ??
    ""
  );
}

/** ref/sqref attributes outside sheetData (merges, validations, formats, filters, links). */
function shiftSheetRanges(xml: string, shift: Shift): string {
  let next = xml.replace(
    /<((?:\w+:)?)mergeCell\b([^>]*?)\/>/g,
    (match, p: string, attrs: string) => {
      const ref = attr(attrs, "ref");
      if (ref === null) return match;
      const moved = shiftRangeList(ref, shift);
      return moved === "" ? "" : `<${p}mergeCell${setAttr(attrs, "ref", moved)}/>`;
    },
  );
  next = next.replace(
    /(<(?:\w+:)?(?:conditionalFormatting|dataValidation|selection|protectedRange)\b[^>]*?\ssqref=")([^"]*)"/g,
    (_match, head: string, list: string) => {
      const moved = shiftRangeList(list, shift);
      return `${head}${moved === "" ? "A1" : moved}"`;
    },
  );
  next = next.replace(
    /(<(?:\w+:)?(?:hyperlink|autoFilter)\b[^>]*?\sref=")([^"]*)"/g,
    (_match, head: string, list: string) => {
      const moved = shiftRangeList(list, shift);
      return `${head}${moved === "" ? "A1" : moved}"`;
    },
  );
  next = next.replace(
    /<((?:\w+:)?)mergeCells\b([^>]*?)>([\s\S]*?)<\/\1mergeCells>/,
    (_match, p: string, attrs: string, inner: string) => {
      const count = (inner.match(/<(?:\w+:)?mergeCell\b/g) ?? []).length;
      return count === 0
        ? ""
        : `<${p}mergeCells${setAttr(attrs, "count", String(count))}>${inner}</${p}mergeCells>`;
    },
  );
  return next;
}

/**
 * Applies the grid's edits to the original file and returns the new bytes. Parts no edit
 * touches are copied unchanged.
 */
export async function saveXlsx(
  original: Uint8Array,
  ops: ReadonlyArray<GridOp>,
  /** The grid after the edits; its recalculated formula results become the cached values. */
  computed?: ReadonlyArray<GridSheet>,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(original);
  const refs = await sheetRefs(zip);
  const [dates, date1904] = await Promise.all([dateStyles(zip), uses1904(zip)]);
  const xmlByPath = new Map<string, string>();
  const dataByPath = new Map<string, SheetData>();
  const loadSheet = async (path: string) => {
    let data = dataByPath.get(path);
    if (data !== undefined) return data;
    const xml = (await readText(zip, path)) ?? "";
    xmlByPath.set(path, xml);
    data = new SheetData(
      prefixOf(xml, "worksheet"),
      sheetDataInner(xml, prefixOf(xml, "worksheet")),
    );
    unshareFormulas(data);
    dataByPath.set(path, data);
    return data;
  };
  let workbookXml = (await readText(zip, "xl/workbook.xml")) ?? "";

  for (const op of ops) {
    const sheet = refs.find((ref) => ref.name === op.sheet);
    if (sheet === undefined) continue;
    const data = await loadSheet(sheet.path);
    if (op.type === "set") {
      const existing = data.get(op.row, op.col);
      const style =
        existing === null ? null : attr(/<(?:\w+:)?c\b([^>]*)/.exec(existing)?.[1] ?? "", "s");
      data.set(
        op.row,
        op.col,
        cellXml({
          prefix: data.prefix,
          ref: addressName({ row: op.row, col: op.col }),
          style,
          text: op.text,
          dateStyled: style !== null && dates.has(Number(style)),
          date1904,
        }),
      );
      continue;
    }
    const shift: Shift =
      op.type === "insertRows" || op.type === "deleteRows"
        ? { axis: "row", at: op.at, delta: op.type === "insertRows" ? op.count : -op.count }
        : { axis: "col", at: op.at, delta: op.type === "insertCols" ? op.count : -op.count };
    data.shift(shift);
    // References into the changed sheet move in every sheet, and in defined names.
    for (const ref of refs) {
      const other = await loadSheet(ref.path);
      other.mapFormulas((formula) => shiftFormula(formula, ref.name, sheet.name, shift));
    }
    xmlByPath.set(sheet.path, shiftSheetRanges(xmlByPath.get(sheet.path)!, shift));
    workbookXml = workbookXml.replace(
      /(<(?:\w+:)?definedName\b[^>]*>)([\s\S]*?)(<\/(?:\w+:)?definedName>)/g,
      (_match, open: string, text: string, close: string) =>
        `${open}${escapeXml(shiftFormula(unescapeXml(text), "\u0000", sheet.name, shift))}${close}`,
    );
  }

  for (const sheet of computed ?? []) {
    const ref = refs.find((candidate) => candidate.name === sheet.name);
    if (ref === undefined) continue;
    for (const [rowIndex, row] of sheet.rows.entries()) {
      for (const [colIndex, cell] of row.entries()) {
        if (cell?.computed !== true || cell.formula === null) continue;
        const data = await loadSheet(ref.path);
        const xml = data.get(rowIndex, colIndex);
        if (xml === null || formulaOf(xml) === null) continue;
        data.set(rowIndex, colIndex, withCachedValue(xml, cell.display, data.prefix));
      }
    }
  }

  if (dataByPath.size === 0) return original;
  for (const [path, data] of dataByPath) {
    let xml = replaceSheetData(xmlByPath.get(path)!, data);
    const bounds = data.bounds();
    xml = xml.replace(/(<(?:\w+:)?dimension\b[^>]*?\sref=")[^"]*"/, `$1${bounds ?? "A1"}"`);
    zip.file(path, xml);
  }
  // Cached results of edited formulas are stale: let the spreadsheet app recalculate them.
  workbookXml = /<(?:\w+:)?calcPr\b/.test(workbookXml)
    ? workbookXml.replace(
        /<((?:\w+:)?)calcPr\b([^>]*?)\/?>(?:<\/\1calcPr>)?/,
        (_match, p: string, attrs: string) =>
          `<${p}calcPr${setAttr(attrs, "fullCalcOnLoad", "1")}/>`,
      )
    : workbookXml.replace(
        /<\/((?:\w+:)?)workbook>/,
        (_match, p: string) => `<${p}calcPr fullCalcOnLoad="1"/></${p}workbook>`,
      );
  zip.file("xl/workbook.xml", workbookXml);
  if (zip.file("xl/calcChain.xml") !== null) {
    zip.remove("xl/calcChain.xml");
    const rels = await readText(zip, "xl/_rels/workbook.xml.rels");
    if (rels !== null) {
      zip.file(
        "xl/_rels/workbook.xml.rels",
        rels.replace(/<(?:\w+:)?Relationship\b[^>]*calcChain[^>]*\/>/g, ""),
      );
    }
    const types = await readText(zip, "[Content_Types].xml");
    if (types !== null) {
      zip.file("[Content_Types].xml", types.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ""));
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
