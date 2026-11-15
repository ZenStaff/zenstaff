// Zen Staff document editing: what every format editor offers the editor shell.
import type { RefObject } from "react";

export type DocKind = "csv" | "xlsx" | "markdown" | "html" | "docx" | "pdf";

export function docKindOf(path: string): DocKind | null {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  switch (extension) {
    case "csv":
    case "tsv":
      return "csv";
    case "xlsx":
      return "xlsx";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "html":
    case "htm":
      return "html";
    case "docx":
      return "docx";
    case "pdf":
      return "pdf";
    default:
      return null;
  }
}

/** A selection handed to the chat as context. */
export interface DocSelection {
  /** "Sheet1!B2:C4", "paragraph 3", "selected text". */
  readonly label: string;
  readonly text: string;
  /** Code fence language for the context block. */
  readonly language: string;
}

export interface MergeResult {
  readonly bytes: Uint8Array;
  /** Shown to the person after the merge. */
  readonly notice: string;
}

export interface FormatController {
  /** The file as it would be saved now. */
  serialize(): Promise<Uint8Array>;
  /** After a save: these bytes are the new starting point (op logs restart from them). */
  markSaved(bytes: Uint8Array): void;
  undo(): void;
  redo(): void;
  /** My edits on top of their newer version; null when it cannot be merged automatically. */
  merge(base: Uint8Array, theirs: Uint8Array): Promise<MergeResult | null>;
}

export interface FormatEditorProps {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly controller: RefObject<FormatController | null>;
  /** Something changed since the last save. */
  readonly onDirty: () => void;
  readonly onSelection: (selection: DocSelection | null) => void;
}

// The BOM is kept: CSV files remember it.
export const decodeText = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
export const encodeText = (text: string) => new TextEncoder().encode(text);
