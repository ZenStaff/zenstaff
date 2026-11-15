// Zen Staff document editing: Markdown with a rich view (Tiptap, already the composer's editor)
// and a Source view. Parts the rich view has no node for stay as raw source pieces.
import { Node } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  StrikethroughIcon,
} from "lucide-react";
import { useImperativeHandle, useRef, useState } from "react";

import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { useZenText, zenText } from "../i18n/zenI18n";
import { docsText } from "./docs.i18n";
import { EditorToolButton } from "./EditorToolButton";
import { decodeText, encodeText, type FormatEditorProps } from "./formatEditor";
import {
  parseMarkdown,
  RAW_BLOCK,
  RAW_INLINE,
  serializeMarkdown,
  type PmNode,
} from "./markdownDoc";
import { mergeText } from "./textMerge";

const RawBlock = Node.create({
  name: RAW_BLOCK,
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "pre[data-zen-raw-block]" }],
  renderHTML: ({ node }) => [
    "pre",
    {
      "data-zen-raw-block": "",
      title: zenText(docsText).rawBlockHint,
      class:
        "my-2 whitespace-pre-wrap rounded border border-dashed bg-muted/40 p-2 font-mono text-muted-foreground text-xs",
    },
    String(node.attrs.source ?? ""),
  ],
});

const RawInline = Node.create({
  name: RAW_INLINE,
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "code[data-zen-raw-inline]" }],
  renderHTML: ({ node }) => [
    "code",
    {
      "data-zen-raw-inline": "",
      title: zenText(docsText).rawBlockHint,
      class: "rounded border border-dashed px-1 font-mono text-muted-foreground text-xs",
    },
    String(node.attrs.source ?? ""),
  ],
});

/** Document look for the rich view (the app has no typography plugin). */
const RICH_TEXT_CSS = `
.zen-doc-rich h1 { font-size: 1.6em; font-weight: 650; margin: 0.8em 0 0.4em; }
.zen-doc-rich h2 { font-size: 1.3em; font-weight: 650; margin: 0.8em 0 0.4em; }
.zen-doc-rich h3, .zen-doc-rich h4 { font-size: 1.1em; font-weight: 600; margin: 0.7em 0 0.3em; }
.zen-doc-rich p { margin: 0.5em 0; }
.zen-doc-rich ul { list-style: disc; padding-left: 1.5em; }
.zen-doc-rich ol { list-style: decimal; padding-left: 1.5em; }
.zen-doc-rich ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
.zen-doc-rich ul[data-type="taskList"] li { display: flex; gap: 0.5em; }
.zen-doc-rich blockquote { border-left: 3px solid var(--border); padding-left: 0.8em; color: var(--muted-foreground); }
.zen-doc-rich pre:not([data-zen-raw-block]) { background: var(--muted); padding: 0.6em; border-radius: 6px; font-size: 0.85em; }
.zen-doc-rich code:not([data-zen-raw-inline]) { background: var(--muted); padding: 0 0.25em; border-radius: 4px; font-size: 0.9em; }
.zen-doc-rich a { color: var(--primary); text-decoration: underline; }
.zen-doc-rich hr { margin: 1em 0; border-color: var(--border); }
`;

const extensions = [
  StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  RawBlock,
  RawInline,
];

export default function MarkdownEditor(props: FormatEditorProps) {
  const t = useZenText(docsText);
  const [initial] = useState(() => {
    const text = decodeText(props.bytes);
    return { text, parsed: parseMarkdown(text) };
  });
  const [parsed, setParsed] = useState(initial.parsed);
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [source, setSource] = useState(initial.text);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { onDirty, onSelection } = props;

  const editor = useEditor({
    extensions,
    content: initial.parsed.doc as never,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "zen-doc-rich min-h-full px-6 py-4 text-sm leading-relaxed outline-none",
      },
    },
    onUpdate: () => onDirty(),
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      const text = current.state.doc.textBetween(from, to, "\n");
      onSelection(
        text.trim() === ""
          ? null
          : { label: t.selectionLabel(text.slice(0, 40)), text, language: "markdown" },
      );
    },
  });

  const currentText = () =>
    mode === "source" || editor === null
      ? source
      : serializeMarkdown(editor.getJSON() as PmNode, parsed.originals, parsed.trailingNewline);

  const switchMode = (next: "rich" | "source") => {
    if (next === mode) return;
    if (next === "source") {
      setSource(currentText());
    } else if (editor !== null) {
      const next = parseMarkdown(source);
      setParsed(next);
      editor.commands.setContent(next.doc as never, { emitUpdate: false });
    }
    setMode(next);
  };

  useImperativeHandle(props.controller, () => ({
    serialize: async () => encodeText(currentText()),
    markSaved: (bytes) => {
      // Untouched blocks are compared against what was saved last.
      setParsed(parseMarkdown(decodeText(bytes)));
    },
    undo: () => {
      if (mode === "rich") editor?.commands.undo();
      else {
        textarea.current?.focus();
        document.execCommand("undo");
      }
    },
    redo: () => {
      if (mode === "rich") editor?.commands.redo();
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

  const chain = () => editor!.chain().focus();

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
        {mode === "rich" && editor !== null ? (
          <div className="flex flex-wrap items-center">
            <EditorToolButton
              label={t.bold}
              active={editor.isActive("bold")}
              onPress={() => chain().toggleBold().run()}
            >
              <BoldIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.italic}
              active={editor.isActive("italic")}
              onPress={() => chain().toggleItalic().run()}
            >
              <ItalicIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.strike}
              active={editor.isActive("strike")}
              onPress={() => chain().toggleStrike().run()}
            >
              <StrikethroughIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.heading}
              active={editor.isActive("heading")}
              onPress={() => chain().toggleHeading({ level: 2 }).run()}
            >
              <Heading2Icon />
            </EditorToolButton>
            <EditorToolButton
              label={t.bulletList}
              active={editor.isActive("bulletList")}
              onPress={() => chain().toggleBulletList().run()}
            >
              <ListIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.orderedList}
              active={editor.isActive("orderedList")}
              onPress={() => chain().toggleOrderedList().run()}
            >
              <ListOrderedIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.taskList}
              active={editor.isActive("taskList")}
              onPress={() => chain().toggleTaskList().run()}
            >
              <ListChecksIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.quote}
              active={editor.isActive("blockquote")}
              onPress={() => chain().toggleBlockquote().run()}
            >
              <QuoteIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.code}
              active={editor.isActive("codeBlock")}
              onPress={() => chain().toggleCodeBlock().run()}
            >
              <CodeIcon />
            </EditorToolButton>
            <EditorToolButton
              label={t.link}
              active={editor.isActive("link")}
              onPress={() => {
                const previous = String(editor.getAttributes("link").href ?? "");
                const href = window.prompt(t.linkPrompt, previous);
                if (href === null) return;
                if (href.trim() === "") chain().unsetLink().run();
                else chain().extendMarkRange("link").setLink({ href: href.trim() }).run();
              }}
            >
              <LinkIcon />
            </EditorToolButton>
          </div>
        ) : null}
      </div>
      {mode === "rich" ? (
        <div className="min-h-0 flex-1 overflow-auto" data-zen-no-translate>
          <style>{RICH_TEXT_CSS}</style>
          <EditorContent editor={editor} className="min-h-full" />
        </div>
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
                : { label: t.selectionLabel(text.slice(0, 40)), text, language: "markdown" },
            );
          }}
        />
      )}
    </div>
  );
}
