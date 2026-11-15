// Zen Staff document editing: HTML pages, edited in place (design mode) or as source. The page
// sits in a frame sandboxed without scripts, so nothing in it runs while it is edited; the
// app reads the edited markup back from that frame. Saving writes the browser's serialization
// of the page, with the original doctype.
import {
  BoldIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
} from "lucide-react";
import { useImperativeHandle, useRef, useState } from "react";

import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { useZenText } from "../i18n/zenI18n";
import { docsText } from "./docs.i18n";
import { EditorToolButton } from "./EditorToolButton";
import { decodeText, encodeText, type FormatEditorProps } from "./formatEditor";
import { mergeText } from "./textMerge";

const DOCTYPE = /^\s*<!doctype[^>]*>\s*/i;

/** The edited page as text: original doctype, then the document element. */
function serializeFrameDocument(doc: Document, original: string): string {
  const doctype = DOCTYPE.exec(original)?.[0].trim() ?? "";
  const html = doc.documentElement.outerHTML;
  return doctype === "" ? `${html}\n` : `${doctype}\n${html}\n`;
}

export default function HtmlEditor(props: FormatEditorProps) {
  const t = useZenText(docsText);
  const [initial] = useState(() => decodeText(props.bytes));
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [source, setSource] = useState(initial);
  // Bumped when Source hands new markup to the visual view.
  const [frameText, setFrameText] = useState(initial);
  const [frameKey, setFrameKey] = useState(0);
  const changedInFrame = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { onDirty, onSelection } = props;

  const frameDocument = () => frame.current?.contentDocument ?? null;

  const currentText = () => {
    if (mode === "source") return source;
    const doc = frameDocument();
    // An untouched page is saved exactly as it was read.
    return doc === null || !changedInFrame.current
      ? frameText
      : serializeFrameDocument(doc, frameText);
  };

  const switchMode = (next: "rich" | "source") => {
    if (next === mode) return;
    if (next === "source") setSource(currentText());
    else {
      setFrameText(source);
      changedInFrame.current = false;
      setFrameKey((value) => value + 1);
    }
    setMode(next);
  };

  const exec = (command: string, value?: string) => {
    const doc = frameDocument();
    if (doc === null) return;
    doc.execCommand(command, false, value);
    changedInFrame.current = true;
    onDirty();
  };

  useImperativeHandle(props.controller, () => ({
    serialize: async () => encodeText(currentText()),
    markSaved: () => undefined,
    undo: () => {
      if (mode === "rich") exec("undo");
      else {
        textarea.current?.focus();
        document.execCommand("undo");
      }
    },
    redo: () => {
      if (mode === "rich") exec("redo");
      else {
        textarea.current?.focus();
        document.execCommand("redo");
      }
    },
    merge: async (base, theirs) => {
      const merged = mergeText(decodeText(base), currentText(), decodeText(theirs));
      return {
        bytes: encodeText(merged.text),
        notice: merged.conflicts === 0 ? t.mergedClean : t.mergedConflicts(merged.conflicts),
      };
    },
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <ToggleGroup
          aria-label={t.source}
          variant="segmented"
          value={[mode]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "rich" || value === "source") switchMode(value);
          }}
        >
          <Toggle value="rich">{t.rich}</Toggle>
          <Toggle value="source">{t.source}</Toggle>
        </ToggleGroup>
        {mode === "rich" ? (
          <div className="flex items-center">
            <EditorToolButton label={t.bold} onPress={() => exec("bold")}>
              <BoldIcon />
            </EditorToolButton>
            <EditorToolButton label={t.italic} onPress={() => exec("italic")}>
              <ItalicIcon />
            </EditorToolButton>
            <EditorToolButton label={t.heading} onPress={() => exec("formatBlock", "h2")}>
              <Heading2Icon />
            </EditorToolButton>
            <EditorToolButton label={t.bulletList} onPress={() => exec("insertUnorderedList")}>
              <ListIcon />
            </EditorToolButton>
            <EditorToolButton label={t.orderedList} onPress={() => exec("insertOrderedList")}>
              <ListOrderedIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.link}
              onPress={() => {
                const href = window.prompt(t.linkPrompt, "https://");
                if (href !== null && href.trim() !== "") exec("createLink", href.trim());
              }}
            >
              <LinkIcon />
            </EditorToolButton>
          </div>
        ) : null}
        <span className="ml-auto text-muted-foreground text-xs">
          {mode === "rich" ? t.htmlNote : t.htmlSaveNote}
        </span>
      </div>
      {mode === "rich" ? (
        <iframe
          key={frameKey}
          ref={frame}
          title={props.fileName}
          // Same origin so the app can read the edited markup; no allow-scripts, so the page's
          // own scripts, handlers and forms never run.
          sandbox="allow-same-origin"
          srcDoc={frameText}
          className="min-h-0 w-full flex-1 border-0 bg-white"
          onLoad={() => {
            const doc = frameDocument();
            if (doc === null) return;
            doc.designMode = "on";
            doc.addEventListener("input", () => {
              changedInFrame.current = true;
              onDirty();
            });
            doc.addEventListener("selectionchange", () => {
              const text = doc.getSelection()?.toString() ?? "";
              onSelection(
                text.trim() === ""
                  ? null
                  : { label: t.selectionLabel(text.slice(0, 40)), text, language: "text" },
              );
            });
          }}
        />
      ) : (
        <textarea
          ref={textarea}
          aria-label={t.source}
          spellCheck={false}
          data-zen-no-translate
          className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-xs leading-relaxed outline-none"
          value={source}
          onChange={(event) => {
            setSource(event.currentTarget.value);
            onDirty();
          }}
          onSelect={(event) => {
            const element = event.currentTarget;
            const text = element.value.slice(element.selectionStart, element.selectionEnd);
            onSelection(
              text.trim() === ""
                ? null
                : { label: t.selectionLabel(text.slice(0, 40)), text, language: "html" },
            );
          }}
        />
      )}
    </div>
  );
}
