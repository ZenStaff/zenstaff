// Zen Staff document editing: DOCX paragraph text. Only `word/document.xml` and only changed
// paragraphs are rewritten; an edited paragraph keeps its style and first run's formatting.
// Paragraphs with pictures, fields, links, tracked changes, equations, controls or text boxes
// are read-only here.
import JSZip from "jszip";

import { escapeXml, unescapeXml } from "./xlsx";

export interface DocxParagraph {
  readonly index: number;
  readonly text: string;
  /** Paragraph style id (Heading1, Title, ListParagraph...). */
  readonly style: string | null;
  readonly inTable: boolean;
  /** Ends a section (page setup); it can be edited but not removed. */
  readonly sectionBreak: boolean;
  /** Why it cannot be edited here, or null. */
  readonly locked:
    | "picture"
    | "field"
    | "link"
    | "tracked"
    | "equation"
    | "control"
    | "nested"
    | null;
}

export interface DocxDocument {
  readonly paragraphs: ReadonlyArray<DocxParagraph>;
}

export type DocxOp =
  | { readonly type: "set"; readonly index: number; readonly text: string }
  | { readonly type: "insertAfter"; readonly index: number; readonly text: string }
  | { readonly type: "delete"; readonly index: number };

interface ParagraphSpan {
  readonly start: number;
  readonly end: number;
  readonly inTable: boolean;
}

/** Outermost `<w:p>` elements with their positions (a text box nests paragraphs inside one). */
function paragraphSpans(xml: string): ReadonlyArray<ParagraphSpan> {
  const spans: Array<ParagraphSpan> = [];
  const tag = /<(\/?)w:(p|tc)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let tableDepth = 0;
  let start = -1;
  let startInTable = false;
  for (const match of xml.matchAll(tag)) {
    const closing = match[1] === "/";
    const selfClosing = match[3] === "/";
    if (match[2] === "tc") {
      if (selfClosing) continue;
      tableDepth += closing ? -1 : 1;
      continue;
    }
    if (selfClosing) {
      if (depth === 0)
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          inTable: tableDepth > 0,
        });
      continue;
    }
    if (!closing) {
      if (depth === 0) {
        start = match.index;
        startInTable = tableDepth > 0;
      }
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: match.index + match[0].length, inTable: startInTable });
        start = -1;
      }
    }
  }
  return spans;
}

const LOCKS: ReadonlyArray<[RegExp, NonNullable<DocxParagraph["locked"]>]> = [
  [/<w:(drawing|pict|object)\b|<v:/, "picture"],
  [/<w:(fldChar|fldSimple|instrText)\b/, "field"],
  [/<w:hyperlink\b/, "link"],
  [/<w:(ins|del|moveFrom|moveTo)\b/, "tracked"],
  [/<m:oMath/, "equation"],
  [/<w:(sdt|footnoteReference|endnoteReference|commentReference)\b/, "control"],
];

function paragraphText(xml: string): string {
  let text = "";
  for (const match of xml.matchAll(/<w:(t|tab|br|cr)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:t>)/g)) {
    if (match[1] === "t") text += unescapeXml(match[2] ?? "");
    else if (match[1] === "tab") text += "\t";
    else text += "\n";
  }
  return text;
}

function describe(xml: string, index: number, inTable: boolean): DocxParagraph {
  const inner = xml.replace(/^<w:p\b[^>]*>/, "");
  const nested = /<w:p\b/.test(inner);
  const locked = nested ? "nested" : (LOCKS.find(([pattern]) => pattern.test(xml))?.[1] ?? null);
  const style = /<w:pStyle\s+w:val="([^"]*)"/.exec(xml)?.[1] ?? null;
  return {
    index,
    text: paragraphText(xml),
    style,
    inTable,
    sectionBreak: /<w:sectPr\b/.test(xml),
    locked,
  };
}

async function documentXml(zip: JSZip): Promise<string> {
  const file = zip.file("word/document.xml");
  if (file === null) throw new Error("This is not a Word document (word/document.xml is missing).");
  return file.async("string");
}

export async function readDocx(bytes: Uint8Array): Promise<DocxDocument> {
  const xml = await documentXml(await JSZip.loadAsync(bytes));
  return {
    paragraphs: paragraphSpans(xml).map((span, index) =>
      describe(xml.slice(span.start, span.end), index, span.inTable),
    ),
  };
}

function runsFor(text: string, runProperties: string): string {
  const pieces = text.split("\n").map((line) =>
    line
      .split("\t")
      .map((part) => (part === "" ? "" : `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`))
      .join("<w:tab/>"),
  );
  return `<w:r>${runProperties}${pieces.join("<w:br/>")}</w:r>`;
}

/** The paragraph with new text: its properties, bookmarks and first run's formatting stay. */
function rewriteParagraph(xml: string, text: string): string {
  const open = /^<w:p\b[^>]*?(\/?)>/.exec(xml);
  if (open === null) return xml;
  const openTag = open[1] === "/" ? open[0].replace(/\s*\/>$/, ">") : open[0];
  const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/.exec(xml)?.[0] ?? "";
  const rPr = /<w:r\b[^>]*>\s*(<w:rPr\b[\s\S]*?<\/w:rPr>)/.exec(xml)?.[1] ?? "";
  const bookmarks = [...xml.matchAll(/<w:bookmark(?:Start|End)\b[^>]*\/>/g)].map(
    (match) => match[0],
  );
  const starts = bookmarks.filter((mark) => mark.startsWith("<w:bookmarkStart"));
  const ends = bookmarks.filter((mark) => mark.startsWith("<w:bookmarkEnd"));
  return `${openTag}${pPr}${starts.join("")}${text === "" ? "" : runsFor(text, rPr)}${ends.join("")}</w:p>`;
}

/** A new paragraph like `reference`, without its section break or numbering restart id. */
function newParagraphLike(reference: string, text: string): string {
  const pPr = (/<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(reference)?.[0] ?? "")
    .replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, "")
    .replace(/<w:rPr\b[\s\S]*?<\/w:rPr>/, "");
  const rPr = /<w:r\b[^>]*>\s*(<w:rPr\b[\s\S]*?<\/w:rPr>)/.exec(reference)?.[1] ?? "";
  return `<w:p>${pPr}${text === "" ? "" : runsFor(text, rPr)}</w:p>`;
}

export function canDelete(paragraph: DocxParagraph): boolean {
  return paragraph.locked === null && !paragraph.inTable && !paragraph.sectionBreak;
}

export async function saveDocx(
  original: Uint8Array,
  ops: ReadonlyArray<DocxOp>,
): Promise<Uint8Array> {
  if (ops.length === 0) return original;
  const zip = await JSZip.loadAsync(original);
  const xml = await documentXml(zip);
  const spans = paragraphSpans(xml);
  // The paragraphs as a list of XML pieces (null = removed), plus what goes after each one.
  const pieces: Array<string | null> = spans.map((span) => xml.slice(span.start, span.end));
  const after: Array<Array<string>> = spans.map(() => []);
  // Ops address the editor's list, where inserted paragraphs have their own positions.
  type Slot = { readonly original: number; readonly inserted: number | null };
  let slots: Array<Slot> = spans.map((_, index) => ({ original: index, inserted: null }));
  for (const op of ops) {
    const slot = slots[op.index];
    if (slot === undefined) continue;
    const current =
      slot.inserted === null ? pieces[slot.original]! : after[slot.original]![slot.inserted]!;
    const info = describe(current, op.index, spans[slot.original]!.inTable);
    if (info.locked !== null) continue;
    if (op.type === "set") {
      const next = rewriteParagraph(current, op.text);
      if (slot.inserted === null) pieces[slot.original] = next;
      else after[slot.original]![slot.inserted] = next;
    } else if (op.type === "insertAfter") {
      const list = after[slot.original]!;
      const position = slot.inserted === null ? 0 : slot.inserted + 1;
      list.splice(position, 0, newParagraphLike(current, op.text));
      slots = slots.flatMap((candidate, index): Array<Slot> => {
        const shifted =
          candidate.original === slot.original &&
          candidate.inserted !== null &&
          candidate.inserted >= position
            ? { ...candidate, inserted: candidate.inserted + 1 }
            : candidate;
        return index === op.index
          ? [shifted, { original: slot.original, inserted: position }]
          : [shifted];
      });
    } else {
      if (!canDelete(info)) continue;
      if (slot.inserted === null) pieces[slot.original] = null;
      else {
        const position = slot.inserted;
        after[slot.original]!.splice(position, 1);
        slots = slots.map((candidate) =>
          candidate.original === slot.original &&
          candidate.inserted !== null &&
          candidate.inserted > position
            ? { ...candidate, inserted: candidate.inserted - 1 }
            : candidate,
        );
      }
      slots.splice(op.index, 1);
    }
  }
  let out = "";
  let cursor = 0;
  spans.forEach((span, index) => {
    out += xml.slice(cursor, span.start);
    out += (pieces[index] ?? "") + after[index]!.join("");
    cursor = span.end;
  });
  out += xml.slice(cursor);
  zip.file("word/document.xml", out);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** The editor's list after an op, so the screen follows what the save will do. */
export function applyDocxOp(
  paragraphs: ReadonlyArray<DocxParagraph>,
  op: DocxOp,
): ReadonlyArray<DocxParagraph> {
  const list = [...paragraphs];
  const target = list[op.index];
  if (target === undefined || target.locked !== null) return paragraphs;
  if (op.type === "set") list[op.index] = { ...target, text: op.text };
  else if (op.type === "insertAfter") {
    list.splice(op.index + 1, 0, { ...target, text: op.text, sectionBreak: false });
  } else if (canDelete(target)) list.splice(op.index, 1);
  return list.map((paragraph, index) => ({ ...paragraph, index }));
}
