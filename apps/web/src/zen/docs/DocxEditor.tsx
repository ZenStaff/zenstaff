// Zen Staff document editing: Word documents. "View" uses the app's own DOCX renderer on the
// bytes being edited; "Edit text" lists the paragraphs (docx.ts says what is read-only and why).
import { LockIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { lazy, Suspense, useEffect, useImperativeHandle, useState } from "react";

import { FileSurfaceLoading } from "../../components/files/fileSurfaceChrome";
import { Button } from "../../components/ui/button";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { cn } from "../../lib/utils";
import { useZenText } from "../i18n/zenI18n";
import { docsText } from "./docs.i18n";
import {
  applyDocxOp,
  canDelete,
  readDocx,
  saveDocx,
  type DocxOp,
  type DocxParagraph,
} from "./docx";
import type { FormatEditorProps } from "./formatEditor";

const OfficeViewer = lazy(() => import("../../components/files/OfficeViewer"));

const LOCK_TEXT = {
  picture: "lockedPicture",
  field: "lockedField",
  link: "lockedLink",
  tracked: "lockedTracked",
  equation: "lockedEquation",
  control: "lockedControl",
  nested: "lockedNested",
} as const satisfies Record<NonNullable<DocxParagraph["locked"]>, keyof typeof docsText.en>;

interface Snapshot {
  readonly paragraphs: ReadonlyArray<DocxParagraph>;
  readonly ops: ReadonlyArray<DocxOp>;
}

interface Model extends Snapshot {
  /** The bytes the op log starts from (the opened or last saved file). */
  readonly original: Uint8Array;
  readonly past: ReadonlyArray<Snapshot>;
  readonly future: ReadonlyArray<Snapshot>;
}

/**
 * My paragraph edits on their version. Only text edits merge automatically, and only when both
 * versions have the same paragraphs; a paragraph both sides changed keeps mine (counted).
 */
async function mergeDocx(base: Uint8Array, theirs: Uint8Array, ops: ReadonlyArray<DocxOp>) {
  if (ops.some((op) => op.type !== "set")) return null;
  const [mine, other] = await Promise.all([readDocx(base), readDocx(theirs)]);
  if (mine.paragraphs.length !== other.paragraphs.length) return null;
  const edited = new Set(ops.map((op) => op.index));
  let conflicts = 0;
  for (const index of edited) {
    if (mine.paragraphs[index]?.text !== other.paragraphs[index]?.text) conflicts += 1;
  }
  return { bytes: await saveDocx(theirs, ops), conflicts };
}

export default function DocxEditor(props: FormatEditorProps) {
  const t = useZenText(docsText);
  const [mode, setMode] = useState<"view" | "edit">("edit");
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<Model | null>(null);
  const [previewUrl, setPreviewUrl] = useState<{ url: string; size: number } | null>(null);
  const { onDirty, onSelection, bytes } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reading the document is async work started by the bytes the shell hands in.
  useEffect(() => {
    let cancelled = false;
    void readDocx(bytes).then(
      (document) => {
        if (!cancelled)
          setDoc({
            original: bytes,
            paragraphs: document.paragraphs,
            ops: [],
            past: [],
            future: [],
          });
      },
      (cause: unknown) =>
        !cancelled && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  const apply = (op: DocxOp) => {
    if (doc === null) return;
    // Typing coalesces: consecutive edits of one paragraph are one undo step.
    const last = doc.ops.at(-1);
    const coalesce = op.type === "set" && last?.type === "set" && last.index === op.index;
    setDoc({
      ...doc,
      paragraphs: applyDocxOp(doc.paragraphs, op),
      ops: [...doc.ops, op],
      past: coalesce ? doc.past : [...doc.past, { paragraphs: doc.paragraphs, ops: doc.ops }],
      future: coalesce ? doc.future : [],
    });
    onDirty();
  };

  const showPreview = async () => {
    if (doc === null) return;
    const current = await saveDocx(doc.original, doc.ops);
    const url = URL.createObjectURL(
      new Blob([current as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    if (previewUrl !== null) URL.revokeObjectURL(previewUrl.url);
    setPreviewUrl({ url, size: current.length });
  };

  useImperativeHandle(props.controller, () => ({
    serialize: () => (doc === null ? Promise.resolve(bytes) : saveDocx(doc.original, doc.ops)),
    markSaved: (saved) => {
      if (doc !== null) setDoc({ ...doc, original: saved, ops: [], past: [], future: [] });
    },
    undo: () => {
      const previous = doc?.past.at(-1);
      if (doc === null || previous === undefined) return;
      setDoc({
        ...doc,
        ...previous,
        past: doc.past.slice(0, -1),
        future: [...doc.future, { paragraphs: doc.paragraphs, ops: doc.ops }],
      });
      onDirty();
    },
    redo: () => {
      const next = doc?.future.at(-1);
      if (doc === null || next === undefined) return;
      setDoc({
        ...doc,
        ...next,
        past: [...doc.past, { paragraphs: doc.paragraphs, ops: doc.ops }],
        future: doc.future.slice(0, -1),
      });
      onDirty();
    },
    merge: async (base, theirs) => {
      const merged = await mergeDocx(base, theirs, doc?.ops ?? []);
      if (merged === null) return null;
      return {
        bytes: merged.bytes,
        notice: merged.conflicts === 0 ? t.mergedClean : t.mergedParagraphs(merged.conflicts),
      };
    },
  }));

  if (error !== null) return <p className="p-4 text-destructive text-sm">{error}</p>;
  const paragraphs = doc?.paragraphs ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col items-start gap-1 border-b px-2 py-1">
        <ToggleGroup
          aria-label={t.editText}
          variant="segmented"
          value={[mode]}
          onValueChange={(next) => {
            const value = next[0];
            if (value !== "view" && value !== "edit") return;
            if (value === "view") void showPreview();
            setMode(value);
          }}
        >
          <Toggle value="view">{t.view}</Toggle>
          <Toggle value="edit">{t.editText}</Toggle>
        </ToggleGroup>
        <span className="text-muted-foreground text-xs">{t.docxNote}</span>
      </div>
      {mode === "view" ? (
        previewUrl === null ? (
          <FileSurfaceLoading />
        ) : (
          <Suspense fallback={<FileSurfaceLoading />}>
            <OfficeViewer
              key={previewUrl.url}
              src={previewUrl.url}
              name={props.fileName}
              kind="docx"
              sizeBytes={previewUrl.size}
            />
          </Suspense>
        )
      ) : (
        <div
          className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto bg-muted/30 py-4"
          data-zen-no-translate
        >
          <div className="mx-2 flex max-w-3xl flex-col gap-1 rounded-lg border bg-background px-5 py-6 shadow-xs sm:mx-auto sm:px-8">
            {paragraphs.map((paragraph) => {
              const heading = /^(Heading|Titlu)(\d)$/i.exec(paragraph.style ?? "")?.[2];
              const isTitle = /^(Title|Titlu)$/i.test(paragraph.style ?? "");
              const textClass = cn(
                // min-w-0 + flex-1: with field-sizing a textarea in a flex row otherwise shrinks to its text.
                "w-full min-w-0 flex-1 resize-none bg-transparent leading-relaxed outline-none [field-sizing:content]",
                isTitle
                  ? "font-semibold text-2xl"
                  : heading === "1"
                    ? "font-semibold text-xl"
                    : heading !== undefined
                      ? "font-semibold text-lg"
                      : "text-sm",
                paragraph.inTable && "rounded border-l-2 border-info/40 pl-2",
              );
              return (
                <div key={paragraph.index} className="group relative flex items-start gap-1">
                  {paragraph.locked !== null ? (
                    <div
                      className={cn(textClass, "min-h-6 whitespace-pre-wrap text-muted-foreground")}
                    >
                      <LockIcon className="mr-1 inline size-3" aria-hidden />
                      {paragraph.text}
                      <span className="ml-2 text-2xs">({t[LOCK_TEXT[paragraph.locked]]})</span>
                    </div>
                  ) : (
                    <textarea
                      aria-label={paragraph.inTable ? t.tableCell : t.editText}
                      rows={1}
                      className={textClass}
                      value={paragraph.text}
                      onChange={(event) =>
                        apply({
                          type: "set",
                          index: paragraph.index,
                          text: event.currentTarget.value,
                        })
                      }
                      onSelect={(event) => {
                        const element = event.currentTarget;
                        const text =
                          element.value.slice(element.selectionStart, element.selectionEnd) ||
                          element.value;
                        onSelection(
                          text.trim() === ""
                            ? null
                            : {
                                label: t.selectionLabel(text.slice(0, 40)),
                                text,
                                language: "text",
                              },
                        );
                      }}
                    />
                  )}
                  {paragraph.locked === null ? (
                    <div className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      {!paragraph.inTable ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t.addParagraph}
                          onClick={() =>
                            apply({ type: "insertAfter", index: paragraph.index, text: "" })
                          }
                        >
                          <PlusIcon />
                        </Button>
                      ) : null}
                      {canDelete(paragraph) ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t.deleteParagraph}
                          onClick={() => apply({ type: "delete", index: paragraph.index })}
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
