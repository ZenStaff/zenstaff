// Zen Staff document editing: CSV / TSV per RFC 4180, kept byte-faithful on a round trip.
// The file's delimiter, line ending, BOM and final newline are remembered, and a cell is quoted
// again only when it needs it or was quoted when read, so saving an unchanged grid writes the
// same bytes back.

export interface CsvDocument {
  readonly rows: Array<Array<string>>;
  /** Cells that were quoted in the file, by "row:col", re-quoted on save. */
  readonly quoted: Set<string>;
  readonly delimiter: "," | ";" | "\t";
  readonly lineEnding: "\n" | "\r\n";
  readonly bom: boolean;
  readonly trailingNewline: boolean;
}

/** `;` is common in Romanian Excel exports (the comma is the decimal separator). */
function guessDelimiter(text: string, fileName: string): "," | ";" | "\t" {
  if (/\.tsv$/i.test(fileName)) return "\t";
  const sample = text.slice(0, 4096).split(/\r?\n/).slice(0, 5).join("\n");
  const count = (char: string) => sample.split(char).length - 1;
  const commas = count(",");
  const semicolons = count(";");
  const tabs = count("\t");
  if (tabs > commas && tabs > semicolons) return "\t";
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(input: string, fileName = "file.csv"): CsvDocument {
  const bom = input.startsWith("﻿");
  const text = bom ? input.slice(1) : input;
  const delimiter = guessDelimiter(text, fileName);
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const rows: Array<Array<string>> = [];
  const quoted = new Set<string>();
  let row: Array<string> = [];
  let cell = "";
  let inQuotes = false;
  let wasQuoted = false;
  const endCell = () => {
    if (wasQuoted) quoted.add(`${rows.length}:${row.length}`);
    row.push(cell);
    cell = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      inQuotes = true;
      wasQuoted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\r" && text[index + 1] === "\n") {
      endRow();
      index += 1;
    } else if (char === "\n") {
      endRow();
    } else {
      cell += char;
    }
  }
  const trailingNewline = text.endsWith("\n");
  if (!trailingNewline || cell !== "" || row.length > 0) endRow();
  if (text === "") rows.length = 0;
  return { rows, quoted, delimiter, lineEnding, bom, trailingNewline };
}

function needsQuotes(value: string, delimiter: string): boolean {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    /^\s|\s$/.test(value)
  );
}

export function serializeCsv(
  document: Omit<CsvDocument, "rows"> & { readonly rows: ReadonlyArray<ReadonlyArray<string>> },
): string {
  const lines = document.rows.map((row, rowIndex) =>
    row
      .map((value, colIndex) =>
        document.quoted.has(`${rowIndex}:${colIndex}`) || needsQuotes(value, document.delimiter)
          ? `"${value.replaceAll('"', '""')}"`
          : value,
      )
      .join(document.delimiter),
  );
  const body = lines.join(document.lineEnding);
  return `${document.bom ? "﻿" : ""}${body}${document.trailingNewline && lines.length > 0 ? document.lineEnding : ""}`;
}

/** After rows/columns are inserted or removed, the remembered quotes move with their cells. */
export function shiftQuoted(
  quoted: ReadonlySet<string>,
  axis: "row" | "col",
  at: number,
  delta: number,
): Set<string> {
  const next = new Set<string>();
  for (const key of quoted) {
    const [row, col] = key.split(":").map(Number) as [number, number];
    const index = axis === "row" ? row : col;
    if (delta < 0 && index >= at && index < at - delta) continue;
    const moved = index >= at ? index + delta : index;
    next.add(axis === "row" ? `${moved}:${col}` : `${row}:${moved}`);
  }
  return next;
}
