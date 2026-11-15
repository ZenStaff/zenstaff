// Reads CSV/XLSX and writes XLSX, with no dependencies; one identical copy per workflow (packs3.test.ts).
//   node tables.mjs read <file> [--sheet name] [--max rows] | csv <file.xlsx> | xlsx <spec.json> <out.xlsx>
// Spec: { sheets: [{ name, title?, subtitle?, columns: [{ header, type?, width? }], rows }] }; types text,
// wrap, money, int, qty, percent, date; cell { v, f, t, s } with s = header|check|bad|good|total.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";
import * as NodeURL from "node:url";

const XML_BAD = /[^\u0009\u000A\u000D -퟿-�]/gu;
export const xmlEscape = (value) =>
  String(value)
    .replace(XML_BAD, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const xmlUnescape = (value) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");

/** Column letters for a 0-based index: 0 -> A, 26 -> AA. */
export function columnName(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** 0-based column index for letters: A -> 0. */
export function columnIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const EPOCH = Date.UTC(1899, 11, 30);
/** YYYY-MM-DD -> Excel serial day number. */
export function isoToSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000);
}
/** Excel serial day number -> YYYY-MM-DD. */
export function serialToIso(serial) {
  const date = new Date(EPOCH + Math.round(Number(serial)) * 86400000);
  return date.toISOString().slice(0, 10);
}

const MONTHS = {
  ian: 1,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mai: 5,
  may: 5,
  iun: 6,
  jun: 6,
  iul: 7,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  noi: 11,
  nov: 11,
  dec: 12,
};
/**
 * A date as written on Romanian and international documents -> YYYY-MM-DD, or null.
 * Day first unless the year comes first: 07.11.2026, 7/11/26, 2026-11-07, 7 nov. 2026, 45968 (Excel).
 */
export function parseDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value > 20000 && value < 80000 ? serialToIso(value) : null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(text);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{2,4})/.exec(text);
  if (m) return valid(year(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})\s*[-. ]?\s*([a-zăâî]{3,})\.?\s*[-. ]?\s*(\d{2,4})/.exec(text);
  if (m) {
    const month = MONTHS[m[2].slice(0, 4)] ?? MONTHS[m[2].slice(0, 3)];
    if (month) return valid(year(+m[3]), month, +m[1]);
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) return parseDate(Number(text));
  return null;
  function year(y) {
    return y < 100 ? 2000 + y : y;
  }
  function valid(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCDate() !== d) return null;
    return date.toISOString().slice(0, 10);
  }
}

/**
 * A number as written in Romanian or English documents -> number, or null.
 * "1.234,56", "1,234.56", "-45,00 lei", "(12.50)", "12%" (-> 12). `decimal` forces "," or ".".
 */
export function parseNumber(value, decimal) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value).trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text
    .replace(/−/g, "-")
    .replace(/[^\d.,'\- ]/g, "")
    .replace(/['\s]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (!/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let sep = decimal;
  if (!sep) {
    if (lastComma >= 0 && lastDot >= 0) sep = lastComma > lastDot ? "," : ".";
    else if (lastComma >= 0 || lastDot >= 0) {
      const mark = lastComma >= 0 ? "," : ".";
      const parts = text.split(mark);
      const after = parts.at(-1).length;
      // "1.234" or "12,345,678": thousands; "0,500" and "12,5": decimal.
      sep =
        parts.length > 2 || (after === 3 && parts[0] !== "0") ? (mark === "," ? "." : ",") : mark;
    } else sep = ".";
  }
  const other = sep === "," ? "." : ",";
  const normal = text.split(other).join("").replace(sep, ".");
  const number = Number(normal);
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function decodeText(buffer) {
  let text = new TextDecoder("utf-8").decode(buffer);
  let encoding = "utf-8";
  if (text.includes("�")) {
    text = new TextDecoder("windows-1250").decode(buffer);
    encoding = "windows-1250";
  }
  return { text: text.replace(/^﻿/, ""), encoding };
}

/** CSV text -> rows (arrays of strings), with the delimiter detected from the first lines. */
export function parseCsv(text, delimiter) {
  const sample = text.split(/\r?\n/).slice(0, 20);
  const sep =
    delimiter ??
    [",", ";", "\t", "|"]
      .map((candidate) => ({
        candidate,
        score: sample.reduce((n, line) => n + countOutsideQuotes(line, candidate), 0),
        steady: new Set(sample.filter(Boolean).map((line) => countOutsideQuotes(line, candidate)))
          .size,
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => a.steady - b.steady || b.score - a.score)[0]?.candidate ??
    ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((cell) => cell.trim() !== "")), delimiter: sep };
}

function countOutsideQuotes(line, ch) {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

export function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = cell === null || cell === undefined ? "" : String(cell);
          return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
}

export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const deflated = NodeZlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = NodeZlib.crc32(raw) >>> 0;
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip file (is it really .xlsx?)");
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const size = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLength);
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const body = buffer.subarray(start, start + size);
    files.set(name, method === 8 ? NodeZlib.inflateRawSync(body) : Buffer.from(body));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** Reads every sheet of an .xlsx into rows of plain values (strings, numbers, booleans). */
export function readXlsx(buffer) {
  const files = unzip(buffer);
  const text = (name) => files.get(name)?.toString("utf8") ?? "";
  const strings = [];
  for (const si of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    strings.push(
      xmlUnescape([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
    );
  }
  const rels = new Map(
    [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])?.[1],
      /Target="([^"]+)"/.exec(m[0])?.[1],
    ]),
  );
  const sheets = [];
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlUnescape(/name="([^"]*)"/.exec(m[0])?.[1] ?? "Sheet");
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    let target = rels.get(rid) ?? "";
    target = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = text(target);
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const rowNumber = Number(/r="(\d+)"/.exec(r[0])?.[1] ?? rows.length + 1);
      const row = [];
      for (const c of (r[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const inner = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = null;
        if (type === "s") value = strings[Number(v)] ?? "";
        else if (type === "inlineStr")
          value = xmlUnescape(
            [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""),
          );
        else if (type === "str" || type === "e") value = v === undefined ? null : xmlUnescape(v);
        else if (type === "b") value = v === "1";
        else if (v !== undefined) value = Number(v);
        const col = ref ? columnIndex(ref) : row.length;
        row[col] = value;
      }
      while (rows.length < rowNumber - 1) rows.push([]);
      rows[rowNumber - 1] = Array.from(row, (cell) => (cell === undefined ? null : cell));
    }
    sheets.push({ name, rows: rows.filter((row) => row.some((c) => c !== null && c !== "")) });
  }
  return sheets;
}

/** CSV or XLSX file -> { sheets: [{ name, rows }], delimiter?, encoding? }. */
export function readTable(file) {
  const buffer = NodeFS.readFileSync(file);
  if (buffer.subarray(0, 2).toString() === "PK") return { sheets: readXlsx(buffer) };
  const { text, encoding } = decodeText(buffer);
  const { rows, delimiter } = parseCsv(text);
  return { sheets: [{ name: NodePath.basename(file), rows }], delimiter, encoding };
}

const FORMATS = ["text", "money", "int", "percent", "date", "wrap", "qty"];
const VARIANTS = ["plain", "header", "check", "bad", "good", "total"];
const NUMFMT = { text: 0, money: 4, int: 3, percent: 164, date: 165, wrap: 0, qty: 166 };
const FILLS = { plain: 0, header: 2, check: 3, bad: 4, good: 5, total: 6 };
const TITLE_STYLE = FORMATS.length * VARIANTS.length;
const NOTE_STYLE = TITLE_STYLE + 1;
const styleIndex = (format, variant) =>
  Math.max(0, FORMATS.indexOf(format)) * VARIANTS.length + Math.max(0, VARIANTS.indexOf(variant));

function stylesXml(accent) {
  const header = (accent ?? "1F4D3A").replace("#", "").toUpperCase();
  const xfs = [];
  for (const format of FORMATS) {
    for (const variant of VARIANTS) {
      const font = variant === "header" ? 1 : variant === "total" ? 2 : 0;
      const border = variant === "total" ? 1 : variant === "header" ? 2 : 0;
      const wrap = format === "wrap" || variant === "header";
      const align = wrap
        ? `<alignment wrapText="1" vertical="top"/>`
        : `<alignment vertical="top"/>`;
      xfs.push(
        `<xf numFmtId="${NUMFMT[format]}" fontId="${font}" fillId="${FILLS[variant]}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`,
      );
    }
  }
  xfs.push(`<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>`);
  xfs.push(
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="0"/></xf>`,
  );
  const fill = (rgb) =>
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="#,##0.###"/></numFmts>
<fonts count="5">
<font><sz val="11"/><color rgb="FF1E1E1C"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1E1E1C"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF${header}"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5F6368"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill(header)}${fill("FFF1C2")}${fill("FBD9D6")}${fill("DDF0DF")}${fill("EEF1EE")}</fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF5F6368"/></top><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF${header}"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

const SHEET_NAME_BAD = /[[\]:*?/\\]/g;

/** Problems in a spec, in plain words; empty means it can be written. */
export function specProblems(spec) {
  const problems = [];
  if (!spec || !Array.isArray(spec.sheets) || spec.sheets.length === 0)
    return ['The spec needs "sheets": [ { "name", "columns", "rows" } ].'];
  const names = new Set();
  spec.sheets.forEach((sheet, i) => {
    const where = `sheets[${i}]`;
    const name = String(sheet.name ?? "")
      .replace(SHEET_NAME_BAD, " ")
      .trim()
      .slice(0, 31);
    if (!name) problems.push(`${where}: a name is required.`);
    if (names.has(name.toLowerCase())) problems.push(`${where}: two sheets are called "${name}".`);
    names.add(name.toLowerCase());
    if (!Array.isArray(sheet.columns) || sheet.columns.length === 0)
      problems.push(`${where}: "columns" needs at least one column.`);
    for (const [j, col] of (sheet.columns ?? []).entries()) {
      if (col.type && !FORMATS.includes(col.type))
        problems.push(`${where}.columns[${j}]: type must be one of ${FORMATS.join(", ")}.`);
    }
    if (!Array.isArray(sheet.rows)) problems.push(`${where}: "rows" must be a list of rows.`);
    for (const [r, entry] of (sheet.rows ?? []).entries()) {
      const row = Array.isArray(entry) ? entry : entry?.cells;
      if (!Array.isArray(row))
        problems.push(
          `${where}.rows[${r}] must be a list of cells or { "cells": [...], "style": "total" }.`,
        );
      if (entry && !Array.isArray(entry) && entry.style && !VARIANTS.includes(entry.style))
        problems.push(`${where}.rows[${r}]: row style "${entry.style}" is unknown.`);
      for (const cell of Array.isArray(row) ? row : []) {
        if (cell && typeof cell === "object") {
          if (cell.t && !FORMATS.includes(cell.t))
            problems.push(`${where}.rows[${r}]: cell type "${cell.t}" is unknown.`);
          if (cell.s && !VARIANTS.includes(cell.s))
            problems.push(`${where}.rows[${r}]: cell style "${cell.s}" is unknown.`);
          if (cell.f !== undefined && typeof cell.f !== "string")
            problems.push(`${where}.rows[${r}]: "f" must be a formula string.`);
        }
      }
    }
  });
  return problems;
}

function cellXml(ref, cell, column, rowVariant) {
  const raw = cell && typeof cell === "object" && !Array.isArray(cell) ? cell : { v: cell };
  const format = raw.t ?? column?.type ?? "text";
  const variant = raw.s ?? rowVariant ?? "plain";
  const s = styleIndex(format, variant);
  if (typeof raw.f === "string" && raw.f.trim()) {
    const formula = xmlEscape(raw.f.replace(/^=/, ""));
    const cached =
      typeof raw.v === "number" && Number.isFinite(raw.v)
        ? `<v>${raw.v}</v>`
        : typeof raw.v === "string"
          ? `<v>${xmlEscape(raw.v)}</v>`
          : "";
    const type = typeof raw.v === "string" ? ` t="str"` : "";
    return `<c r="${ref}" s="${s}"${type}><f>${formula}</f>${cached}</c>`;
  }
  let value = raw.v;
  if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${s}"/>`;
  if (format === "date" && typeof value === "string") {
    const serial = isoToSerial(parseDate(value) ?? "");
    if (serial !== null) value = serial;
  }
  if (typeof value === "boolean") return `<c r="${ref}" s="${s}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === "number" && Number.isFinite(value))
    return `<c r="${ref}" s="${s}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function sheetXml(sheet) {
  const columns = sheet.columns ?? [];
  const rows = [];
  let r = 0;
  const width = Math.max(columns.length, 1);
  if (sheet.title) {
    r++;
    rows.push(
      `<row r="${r}" ht="24" customHeight="1"><c r="A${r}" s="${TITLE_STYLE}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(sheet.title)}</t></is></c></row>`,
    );
  }
  if (sheet.subtitle) {
    r++;
    rows.push(
      `<row r="${r}"><c r="A${r}" s="${NOTE_STYLE}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(sheet.subtitle)}</t></is></c></row>`,
    );
  }
  if (sheet.title || sheet.subtitle) r++;
  r++;
  const headerRow = r;
  rows.push(
    `<row r="${r}" ht="30" customHeight="1">${columns
      .map((col, i) =>
        cellXml(`${columnName(i)}${r}`, col.header ?? "", { type: "text" }, "header"),
      )
      .join("")}</row>`,
  );
  for (const row of sheet.rows ?? []) {
    r++;
    const variant = Array.isArray(row) ? undefined : row.style;
    const cells = (Array.isArray(row) ? row : (row.cells ?? [])).map((cell, i) =>
      cellXml(`${columnName(i)}${r}`, cell, columns[i], variant),
    );
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
  }
  const lastRow = Math.max(r, headerRow);
  const cols = columns
    .map((col, i) => {
      const fallback =
        { money: 14, int: 10, qty: 11, percent: 10, date: 12, wrap: 40 }[col.type] ?? 18;
      const w = Math.min(80, Math.max(6, Number(col.width) || fallback));
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    })
    .join("");
  const freeze =
    sheet.freeze === false
      ? ""
      : `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/></sheetView></sheetViews>`;
  const filter =
    sheet.filter === false || (sheet.rows ?? []).length === 0
      ? ""
      : `<autoFilter ref="A${headerRow}:${columnName(width - 1)}${lastRow - (sheet.filterExcludesLast ?? 0)}"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${freeze}<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows.join("")}</sheetData>${filter}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

/** The row number (1-based) of the first data row of a sheet in this spec. */
export function firstDataRow(sheet) {
  return (
    (sheet.title || sheet.subtitle ? 1 + (sheet.title ? 1 : 0) + (sheet.subtitle ? 1 : 0) : 0) + 2
  );
}

/** spec -> .xlsx bytes. */
export function writeXlsx(spec) {
  const problems = specProblems(spec);
  if (problems.length) throw new Error(problems.join(" "));
  const sheets = spec.sheets.map((sheet, i) => ({
    ...sheet,
    name: String(sheet.name).replace(SHEET_NAME_BAD, " ").trim().slice(0, 31),
    file: `sheet${i + 1}.xml`,
  }));
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map(
          (s) =>
            `<Override PartName="/xl/worksheets/${s.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join(
          "",
        )}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(spec.title ?? sheets[0].name)}</dc:title><dc:creator>Zen Staff</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets
        .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (s, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${s.file}"/>`,
        )
        .join(
          "",
        )}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: stylesXml(spec.accent) },
    ...sheets.map((s) => ({ name: `xl/worksheets/${s.file}`, data: sheetXml(s) })),
  ];
  return zip(files);
}

function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const fail = (message) => {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  };
  try {
    if (command === "read" || command === "csv") {
      const file = args.find((a) => !a.startsWith("--"));
      if (!file || !NodeFS.existsSync(file)) fail(`The file ${file ?? "(none)"} does not exist.`);
      const table = readTable(file);
      const wanted = option(args, "sheet");
      const sheets = wanted ? table.sheets.filter((s) => s.name === wanted) : table.sheets;
      if (sheets.length === 0)
        fail(`No sheet called "${wanted}". Sheets: ${table.sheets.map((s) => s.name).join(", ")}`);
      if (command === "csv") {
        process.stdout.write(toCsv(sheets[0].rows) + "\n");
        return;
      }
      const max = Number(option(args, "max") ?? 40);
      const out = {
        ...(table.delimiter ? { delimiter: table.delimiter, encoding: table.encoding } : {}),
        sheets: sheets.map((s) => ({
          name: s.name,
          rowCount: s.rows.length,
          rows: s.rows.slice(0, max),
        })),
      };
      process.stdout.write(JSON.stringify(out, null, 1) + "\n");
      return;
    }
    if (command === "xlsx") {
      const [specFile, outFile] = args;
      if (!specFile || !outFile) fail("Use: node tables.mjs xlsx <spec.json> <out.xlsx>");
      let spec;
      try {
        spec = JSON.parse(NodeFS.readFileSync(specFile, "utf8"));
      } catch (error) {
        fail(`${specFile} is not valid JSON: ${error.message}`);
      }
      const problems = specProblems(spec);
      if (problems.length) fail(problems.join("\n"));
      NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(outFile)), { recursive: true });
      NodeFS.writeFileSync(outFile, writeXlsx(spec));
      console.log(`Wrote ${NodePath.resolve(outFile)}`);
      return;
    }
    fail("Use: node tables.mjs read <file> | csv <file.xlsx> | xlsx <spec.json> <out.xlsx>");
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] && NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url))
  main();
