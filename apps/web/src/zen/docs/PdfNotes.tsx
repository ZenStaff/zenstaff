// Zen Staff document editing: PDFs are read-only; next to the app's PDF.js viewer the person keeps
// notes (per page, optionally quoting selected text) and can hand a note or a selection to the
// chat. Notes are stored on the machine that has the file (zen.docs.notes), not in the PDF.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenDocNote, ZenDocTarget } from "@t3tools/contracts/zenDocs";
import { MessageSquarePlusIcon, Trash2Icon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { FileSurfaceLoading } from "../../components/files/fileSurfaceChrome";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { toastManager } from "../../components/ui/toast";
import { useZenText } from "../i18n/zenI18n";
import { docsText } from "./docs.i18n";
import { loadNotes, saveNotes } from "./docsState";
import type { DocSelection } from "./formatEditor";

const PdfViewer = lazy(() => import("../../components/files/PdfViewer"));

function noteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function PdfNotes(props: {
  readonly environmentId: EnvironmentId;
  readonly target: ZenDocTarget;
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly onSelection: (selection: DocSelection | null) => void;
  readonly onAsk: (selection: DocSelection) => void;
}) {
  const t = useZenText(docsText);
  const [notes, setNotes] = useState<ReadonlyArray<ZenDocNote>>([]);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const [quote, setQuote] = useState<string | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const { onSelection, environmentId, target } = props;
  // One URL per mount (the shell remounts this view for new bytes). It is not revoked in an
  // effect cleanup: development's double effect run would revoke it before PDF.js reads it.
  const [url] = useState(() =>
    URL.createObjectURL(new Blob([props.bytes as BlobPart], { type: "application/pdf" })),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- notes live on the file's machine and load once per file.
  useEffect(() => {
    let cancelled = false;
    void loadNotes(environmentId, target).then(
      (loaded) => !cancelled && setNotes(loaded),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, target]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the document selection inside the PDF text layer.
  useEffect(() => {
    const onChange = () => {
      const selection = document.getSelection();
      if (selection === null || viewer.current === null) return;
      const anchor = selection.anchorNode;
      if (anchor === null || !viewer.current.contains(anchor)) return;
      const text = selection.toString().trim();
      setQuote(text === "" ? null : text.slice(0, 4000));
      // The page the selection sits on, from PDF.js's page containers.
      const pageElement = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest(
        "[data-page-number]",
      );
      const pageNumber = Number(pageElement?.getAttribute("data-page-number"));
      if (Number.isFinite(pageNumber) && pageNumber > 0) setPage(pageNumber);
      onSelection(
        text === "" ? null : { label: t.selectionLabel(text.slice(0, 40)), text, language: "text" },
      );
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [onSelection, t]);

  const persist = async (next: ReadonlyArray<ZenDocNote>) => {
    setNotes(next);
    try {
      setNotes(await saveNotes(environmentId, target, next));
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: t.saveFailed,
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const add = () => {
    if (draft.trim() === "" && quote === null) return;
    void persist([
      ...notes,
      {
        id: noteId(),
        page,
        text: draft.trim(),
        ...(quote === null ? {} : { quote }),
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft("");
    setQuote(null);
  };

  return (
    <div className="@container flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @2xl:flex-row">
        <div ref={viewer} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Suspense fallback={<FileSurfaceLoading />}>
            <PdfViewer src={url} title={props.fileName} />
          </Suspense>
        </div>
        <aside
          className="flex max-h-[45%] w-full shrink-0 flex-col gap-2 overflow-y-auto border-t p-3 @2xl:max-h-none @2xl:w-72 @2xl:border-t-0 @2xl:border-l"
          aria-label={t.notes}
        >
          <h3 className="font-medium text-sm">{t.notes}</h3>
          <p className="text-muted-foreground text-xs">{t.pdfNote}</p>
          {quote !== null ? (
            <blockquote className="line-clamp-4 border-l-2 pl-2 text-muted-foreground text-xs">
              {quote}
            </blockquote>
          ) : null}
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground text-xs" htmlFor="zen-pdf-note-page">
              {t.page(page)}
            </label>
            <Input
              id="zen-pdf-note-page"
              type="number"
              min={0}
              size="sm"
              value={page}
              onChange={(event) => setPage(Math.max(0, Number(event.currentTarget.value) || 0))}
            />
          </div>
          <Textarea
            aria-label={quote !== null ? t.noteFromSelection : t.notePlaceholder}
            placeholder={t.notePlaceholder}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={add}
            disabled={draft.trim() === "" && quote === null}
          >
            <MessageSquarePlusIcon />
            {t.addNote}
          </Button>
          {notes.length === 0 ? <p className="text-muted-foreground text-xs">{t.noNotes}</p> : null}
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id} className="flex flex-col gap-1 rounded-md border p-2 text-xs">
                <span className="text-muted-foreground">
                  {note.page === 0 ? t.wholeDocument : t.page(note.page)}
                </span>
                {note.quote ? (
                  <blockquote className="line-clamp-3 border-l-2 pl-2 text-muted-foreground">
                    {note.quote}
                  </blockquote>
                ) : null}
                {note.text ? <p className="whitespace-pre-wrap">{note.text}</p> : null}
                <div className="flex justify-end gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      props.onAsk({
                        label: note.page === 0 ? t.wholeDocument : t.page(note.page),
                        text: [note.quote, note.text].filter(Boolean).join("\n\n"),
                        language: "text",
                      })
                    }
                  >
                    {t.askAboutNote}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t.deleteNote}
                    onClick={() =>
                      void persist(notes.filter((candidate) => candidate.id !== note.id))
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
