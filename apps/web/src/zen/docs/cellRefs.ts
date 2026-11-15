// Zen Staff document editing: A1 references in spreadsheet formulas and ranges. Used to shift
// references when rows or columns are inserted or removed, and to turn a shared formula into the
// formula of each cell it covers. String literals are left alone; function names (LOG10(...))
// and defined names are not references.

const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;

export function columnName(index: number): string {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function columnIndex(name: string): number {
  let value = 0;
  for (const char of name.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

export interface CellAddress {
  readonly row: number;
  readonly col: number;
}

export function parseAddress(ref: string): CellAddress | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref);
  if (match === null) return null;
  const col = columnIndex(match[1]!);
  const row = Number(match[2]) - 1;
  return col < MAX_COLS && row >= 0 && row < MAX_ROWS ? { row, col } : null;
}

export const addressName = (address: CellAddress) => `${columnName(address.col)}${address.row + 1}`;

/** A row or column change on one sheet. */
export interface Shift {
  readonly axis: "row" | "col";
  /** First row/column (0-based) that moves or is removed. */
  readonly at: number;
  /** Positive = inserted before `at`, negative = removed starting at `at`. */
  readonly delta: number;
}

/** Where index `index` goes; null when it was removed. */
export function shiftIndex(index: number, shift: Shift): number | null {
  if (index < shift.at) return index;
  if (shift.delta >= 0) return index + shift.delta;
  const removedEnd = shift.at - shift.delta; // exclusive
  if (index < removedEnd) return null;
  return index + shift.delta;
}

/** A range [start, end] (inclusive) after a shift; removed parts shrink it, null if all gone. */
function shiftSpan(start: number, end: number, shift: Shift): [number, number] | null {
  if (shift.delta >= 0) {
    return [shiftIndex(start, shift)!, end >= shift.at ? end + shift.delta : end];
  }
  const removedEnd = shift.at - shift.delta - 1; // inclusive
  if (start >= shift.at && end <= removedEnd) return null;
  const newStart = start < shift.at ? start : start <= removedEnd ? shift.at : start + shift.delta;
  const newEnd = end < shift.at ? end : end <= removedEnd ? shift.at - 1 : end + shift.delta;
  return newEnd < newStart ? null : [newStart, newEnd];
}

// Sheet prefix ('My sheet'! or Sheet1!), then a cell, column range or row range.
const REFERENCE =
  /((?:'(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!)?(\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d{1,7}:\$?\d{1,7})/g;

function sheetOfPrefix(prefix: string | undefined): string | null {
  if (prefix === undefined) return null;
  const name = prefix.slice(0, -1);
  return name.startsWith("'") ? name.slice(1, -1).replaceAll("''", "'") : name;
}

interface RefPart {
  readonly colAbs: boolean;
  readonly col: number | null;
  readonly rowAbs: boolean;
  readonly row: number | null;
}

function parsePart(text: string): RefPart | null {
  const match = /^(\$?)([A-Za-z]{1,3})?(\$?)(\d{1,7})?$/.exec(text);
  if (match === null || (match[2] === undefined && match[4] === undefined)) return null;
  return {
    colAbs: match[2] !== undefined && match[1] === "$",
    col: match[2] === undefined ? null : columnIndex(match[2]),
    rowAbs:
      match[4] !== undefined && (match[2] === undefined ? match[1] === "$" : match[3] === "$"),
    row: match[4] === undefined ? null : Number(match[4]) - 1,
  };
}

function printPart(part: RefPart): string {
  const col = part.col === null ? "" : `${part.colAbs ? "$" : ""}${columnName(part.col)}`;
  const row = part.row === null ? "" : `${part.rowAbs ? "$" : ""}${part.row + 1}`;
  return col + row;
}

/**
 * Rewrites the references of a formula. `onRef` gets each reference's sheet (null = unqualified)
 * and parts, and returns new parts, or null for #REF!.
 */
function mapReferences(
  formula: string,
  onRef: (sheet: string | null, parts: ReadonlyArray<RefPart>) => ReadonlyArray<RefPart> | null,
): string {
  let out = "";
  let index = 0;
  while (index < formula.length) {
    const quote = formula.indexOf('"', index);
    const end = quote === -1 ? formula.length : quote;
    out += mapSegment(formula.slice(index, end), onRef);
    if (quote === -1) break;
    // Copy the string literal ("" is an escaped quote inside it).
    let close = quote + 1;
    while (close < formula.length) {
      if (formula[close] === '"') {
        if (formula[close + 1] === '"') close += 2;
        else break;
      } else close += 1;
    }
    out += formula.slice(quote, close + 1);
    index = close + 1;
  }
  return out;
}

function mapSegment(
  segment: string,
  onRef: (sheet: string | null, parts: ReadonlyArray<RefPart>) => ReadonlyArray<RefPart> | null,
): string {
  return segment.replace(
    REFERENCE,
    (match, prefix: string | undefined, ref: string, offset: number) => {
      const before = offset > 0 ? segment[offset - 1]! : "";
      const after = segment[offset + match.length] ?? "";
      // Part of a longer name (LOG10, Tax2024, _xlfn.), a function call, or a [structured] ref.
      if (/[\w.$À-￿\]]/.test(before) || /[\w(![À-￿]/.test(after)) return match;
      const parts = ref.split(":").map(parsePart);
      if (parts.some((part) => part === null)) return match;
      const valid = (parts as Array<RefPart>).every(
        (part) =>
          (part.col === null || part.col < MAX_COLS) && (part.row === null || part.row < MAX_ROWS),
      );
      if (!valid) return match;
      const next = onRef(sheetOfPrefix(prefix), parts as Array<RefPart>);
      if (next === null) return `${prefix ?? ""}#REF!`;
      return `${prefix ?? ""}${next.map(printPart).join(":")}`;
    },
  );
}

/** The formula as it reads `dr` rows and `dc` columns away (relative parts move). */
export function translateFormula(formula: string, dr: number, dc: number): string {
  return mapReferences(formula, (_sheet, parts) => {
    const moved = parts.map((part) => ({
      ...part,
      row: part.row === null || part.rowAbs ? part.row : part.row + dr,
      col: part.col === null || part.colAbs ? part.col : part.col + dc,
    }));
    return moved.some(
      (part) => (part.row !== null && part.row < 0) || (part.col !== null && part.col < 0),
    )
      ? null
      : moved;
  });
}

function shiftParts(parts: ReadonlyArray<RefPart>, shift: Shift): ReadonlyArray<RefPart> | null {
  const key = shift.axis === "row" ? "row" : "col";
  if (parts.length === 1) {
    const value = parts[0]![key];
    if (value === null) return parts;
    const moved = shiftIndex(value, shift);
    return moved === null ? null : [{ ...parts[0]!, [key]: moved }];
  }
  const [first, second] = parts as [RefPart, RefPart];
  if (first[key] === null || second[key] === null) return parts;
  const span = shiftSpan(
    Math.min(first[key]!, second[key]!),
    Math.max(first[key]!, second[key]!),
    shift,
  );
  if (span === null) return null;
  return [
    { ...first, [key]: span[0] },
    { ...second, [key]: span[1] },
  ];
}

/**
 * A formula after rows/columns of `changedSheet` moved. `formulaSheet` is the sheet the formula
 * lives on (its unqualified references point there).
 */
export function shiftFormula(
  formula: string,
  formulaSheet: string,
  changedSheet: string,
  shift: Shift,
): string {
  return mapReferences(formula, (sheet, parts) =>
    (sheet ?? formulaSheet).toLowerCase() === changedSheet.toLowerCase()
      ? shiftParts(parts, shift)
      : parts,
  );
}

/** A space-separated list of ranges (sqref, mergeCell ref) after a shift; empty = all removed. */
export function shiftRangeList(list: string, shift: Shift): string {
  return list
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((range) => {
      const parts = range.split(":").map(parsePart);
      if (parts.some((part) => part === null)) return [range];
      const moved = shiftParts(parts as Array<RefPart>, shift);
      return moved === null ? [] : [moved.map(printPart).join(":")];
    })
    .join(" ");
}
