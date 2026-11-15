// Zen Staff document editing: Markdown <-> the rich editor's document (Tiptap JSON), via remark.
// What the rich editor has no node for (tables, HTML, math, footnotes, images, front matter) is
// kept as raw source pieces. Untouched blocks are written back exactly as they were in the file.
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface PmMark {
  readonly type: "bold" | "italic" | "strike" | "code" | "link";
  readonly attrs?: { readonly href: string; readonly title?: string | null };
}

export interface PmNode {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: ReadonlyArray<PmNode>;
  readonly text?: string;
  readonly marks?: ReadonlyArray<PmMark>;
}

export const RAW_BLOCK = "zenRawBlock";
export const RAW_INLINE = "zenRawInline";

interface MdNode {
  readonly type: string;
  readonly children?: ReadonlyArray<MdNode>;
  readonly value?: string;
  readonly depth?: number;
  readonly ordered?: boolean | null;
  readonly start?: number | null;
  readonly checked?: boolean | null;
  readonly lang?: string | null;
  readonly url?: string;
  readonly title?: string | null;
  readonly position?: {
    readonly start: { readonly offset?: number };
    readonly end: { readonly offset?: number };
  };
}

export interface ParsedMarkdown {
  readonly doc: PmNode;
  /** Source of each top-level block, keyed by its JSON, for blocks left untouched. */
  readonly originals: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly trailingNewline: boolean;
}

const KEPT_ATTRS: Record<string, ReadonlyArray<string>> = {
  heading: ["level"],
  orderedList: ["start"],
  taskItem: ["checked"],
  codeBlock: ["language"],
  [RAW_BLOCK]: ["source"],
  [RAW_INLINE]: ["source"],
};

/**
 * The editor adds default attributes (alignment, link target...) and orders marks its own way;
 * this keeps only what Markdown can express, so an untouched block compares equal.
 */
export function normalizeNode(node: PmNode): PmNode {
  const kept = KEPT_ATTRS[node.type] ?? [];
  const attrs = Object.fromEntries(
    kept.flatMap((key) => {
      const value = node.attrs?.[key];
      return value === undefined || value === null ? [] : [[key, value]];
    }),
  );
  const marks = (node.marks ?? [])
    .map((mark): PmMark =>
      mark.type === "link"
        ? {
            type: "link",
            attrs: {
              href: String(mark.attrs?.href ?? ""),
              ...(mark.attrs?.title ? { title: mark.attrs.title } : {}),
            },
          }
        : { type: mark.type },
    )
    .sort((left, right) => left.type.localeCompare(right.type));
  return {
    type: node.type,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(marks.length > 0 ? { marks } : {}),
    ...(node.content !== undefined && node.content.length > 0
      ? { content: node.content.map(normalizeNode) }
      : {}),
  };
}

const keyOf = (node: PmNode) => JSON.stringify(normalizeNode(node));

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n/;

function sourceOf(node: MdNode, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? "" : source.slice(start, end);
}

const sameMarks = (left: ReadonlyArray<PmMark>, right: ReadonlyArray<PmMark>) =>
  JSON.stringify(left) === JSON.stringify(right);

function inline(
  nodes: ReadonlyArray<MdNode>,
  source: string,
  marks: ReadonlyArray<PmMark> = [],
): Array<PmNode> {
  const out: Array<PmNode> = [];
  const pushText = (text: string, withMarks: ReadonlyArray<PmMark>) => {
    if (text === "") return;
    const last = out.at(-1);
    if (last?.type === "text" && sameMarks(last.marks ?? [], withMarks)) {
      out[out.length - 1] = { ...last, text: `${last.text}${text}` };
      return;
    }
    out.push(
      withMarks.length === 0 ? { type: "text", text } : { type: "text", text, marks: withMarks },
    );
  };
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        pushText(node.value ?? "", marks);
        break;
      case "emphasis":
        out.push(...inline(node.children ?? [], source, [...marks, { type: "italic" }]));
        break;
      case "strong":
        out.push(...inline(node.children ?? [], source, [...marks, { type: "bold" }]));
        break;
      case "delete":
        out.push(...inline(node.children ?? [], source, [...marks, { type: "strike" }]));
        break;
      case "inlineCode":
        pushText(node.value ?? "", [...marks, { type: "code" }]);
        break;
      case "link":
        out.push(
          ...inline(node.children ?? [], source, [
            { type: "link", attrs: { href: node.url ?? "", title: node.title ?? null } },
            ...marks,
          ]),
        );
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      default:
        out.push({ type: RAW_INLINE, attrs: { source: sourceOf(node, source) } });
    }
  }
  // Adjacent text with the same marks after nesting is one node.
  return out.reduce<Array<PmNode>>((merged, node) => {
    const last = merged.at(-1);
    if (
      node.type === "text" &&
      last?.type === "text" &&
      sameMarks(last.marks ?? [], node.marks ?? [])
    ) {
      merged[merged.length - 1] = { ...last, text: `${last.text}${node.text}` };
    } else merged.push(node);
    return merged;
  }, []);
}

const raw = (node: MdNode, source: string): PmNode => ({
  type: RAW_BLOCK,
  attrs: { source: sourceOf(node, source) },
});

function listItem(node: MdNode, source: string, task: boolean): PmNode | null {
  const children = node.children ?? [];
  if (children.length > 0 && children[0]!.type !== "paragraph") return null;
  const content =
    children.length === 0
      ? [{ type: "paragraph" }]
      : children.flatMap((child) => block(child, source));
  return task
    ? { type: "taskItem", attrs: { checked: node.checked === true }, content }
    : { type: "listItem", content };
}

function block(node: MdNode, source: string): Array<PmNode> {
  switch (node.type) {
    case "paragraph": {
      const content = inline(node.children ?? [], source);
      return [content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content }];
    }
    case "heading": {
      const content = inline(node.children ?? [], source);
      return [
        {
          type: "heading",
          attrs: { level: node.depth ?? 1 },
          ...(content.length > 0 ? { content } : {}),
        },
      ];
    }
    case "blockquote":
      return [
        {
          type: "blockquote",
          content: (node.children ?? []).flatMap((child) => block(child, source)),
        },
      ];
    case "code":
      return [
        {
          type: "codeBlock",
          attrs: { language: node.lang ?? null },
          ...(node.value ? { content: [{ type: "text", text: node.value }] } : {}),
        },
      ];
    case "thematicBreak":
      return [{ type: "horizontalRule" }];
    case "list": {
      const items = node.children ?? [];
      const task = items.some((item) => item.checked !== null && item.checked !== undefined);
      if (task && node.ordered === true) return [raw(node, source)];
      const content = items.map((item) => listItem(item, source, task));
      if (content.some((item) => item === null)) return [raw(node, source)];
      if (task) return [{ type: "taskList", content: content as Array<PmNode> }];
      return node.ordered === true
        ? [
            {
              type: "orderedList",
              attrs: { start: node.start ?? 1 },
              content: content as Array<PmNode>,
            },
          ]
        : [{ type: "bulletList", content: content as Array<PmNode> }];
    }
    default:
      return [raw(node, source)];
  }
}

export function parseMarkdown(text: string): ParsedMarkdown {
  const frontMatter = FRONT_MATTER.exec(text)?.[0] ?? null;
  const body = frontMatter === null ? text : text.slice(frontMatter.length);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as unknown as MdNode;
  const blocks: Array<PmNode> = [];
  const originals = new Map<string, Array<string>>();
  const remember = (node: PmNode, sourceText: string) => {
    const key = keyOf(node);
    originals.set(key, [...(originals.get(key) ?? []), sourceText]);
  };
  if (frontMatter !== null) {
    const node: PmNode = { type: RAW_BLOCK, attrs: { source: frontMatter.replace(/\r?\n$/, "") } };
    blocks.push(node);
    remember(node, frontMatter.replace(/\r?\n$/, ""));
  }
  for (const child of tree.children ?? []) {
    for (const node of block(child, body)) {
      blocks.push(node);
      remember(node, sourceOf(child, body));
    }
  }
  return {
    doc: { type: "doc", content: blocks.length > 0 ? blocks : [{ type: "paragraph" }] },
    originals,
    trailingNewline: text.endsWith("\n"),
  };
}

// ─── Serializing ────────────────────────────────────────────────────────────

function escapeText(text: string, atLineStart: boolean): string {
  let escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/([`*[\]])/g, "\\$1")
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (match) => match.replace("_", "\\_"))
    .replace(/<(?=[A-Za-z/!?])/g, "\\<");
  if (atLineStart) {
    escaped = escaped
      .replace(/^(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/, "\\$1")
      .replace(/^(\s*)(=+|-+)\s*$/, "$1\\$2");
  }
  return escaped;
}

const MARK_ORDER: ReadonlyArray<PmMark["type"]> = ["link", "bold", "italic", "strike", "code"];

function openMark(mark: PmMark): string {
  switch (mark.type) {
    case "bold":
      return "**";
    case "italic":
      return "_";
    case "strike":
      return "~~";
    case "link":
      return "[";
    case "code":
      return "";
  }
}

function closeMark(mark: PmMark): string {
  switch (mark.type) {
    case "bold":
      return "**";
    case "italic":
      return "_";
    case "strike":
      return "~~";
    case "link": {
      const href = (mark.attrs?.href ?? "").replace(/[()\s]/g, (char) => encodeURIComponent(char));
      const title = mark.attrs?.title ? ` "${mark.attrs.title.replaceAll('"', '\\"')}"` : "";
      return `](${href}${title})`;
    }
    case "code":
      return "";
  }
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function inlineMarkdown(nodes: ReadonlyArray<PmNode>): string {
  let out = "";
  let open: Array<PmMark> = [];
  let pendingSpace = "";
  const sorted = (marks: ReadonlyArray<PmMark>) =>
    [...marks]
      .filter((mark) => mark.type !== "code")
      .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
  const closeTo = (keep: number) => {
    while (open.length > keep) out += closeMark(open.pop()!);
  };
  for (const node of nodes) {
    const marks = node.type === "text" ? sorted(node.marks ?? []) : [];
    let common = 0;
    while (
      common < open.length &&
      common < marks.length &&
      JSON.stringify(open[common]) === JSON.stringify(marks[common])
    ) {
      common += 1;
    }
    closeTo(common);
    out += pendingSpace;
    pendingSpace = "";
    if (node.type === "hardBreak") {
      closeTo(0);
      out += "\\\n";
      continue;
    }
    if (node.type === RAW_INLINE) {
      out += String(node.attrs?.source ?? "");
      continue;
    }
    const text = node.text ?? "";
    const isCode = (node.marks ?? []).some((mark) => mark.type === "code");
    const lead = /^\s*/.exec(text)![0];
    const trail = text.length > lead.length ? /\s*$/.exec(text)![0] : "";
    const core = text.slice(lead.length, text.length - trail.length);
    out += lead;
    for (const mark of marks.slice(common)) {
      out += openMark(mark);
      open.push(mark);
    }
    const atLineStart = out === "" || out.endsWith("\n");
    out += isCode ? codeSpan(core) : escapeText(core, atLineStart);
    pendingSpace = trail;
  }
  closeTo(0);
  return out + pendingSpace;
}

function indent(text: string, prefix: string, first: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? first + line : line === "" ? "" : prefix + line))
    .join("\n");
}

function blockMarkdown(node: PmNode): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return inlineMarkdown(children);
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${inlineMarkdown(children)}`.trimEnd();
    case "blockquote":
      return children
        .map(blockMarkdown)
        .join("\n\n")
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    case "codeBlock": {
      const code = children.map((child) => child.text ?? "").join("");
      const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
      const fence = "`".repeat(longest + 1);
      return `${fence}${String(node.attrs?.language ?? "")}\n${code}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const start = Number(node.attrs?.start ?? 1);
      return children
        .map((item, index) => {
          const marker =
            node.type === "orderedList"
              ? `${start + index}. `
              : node.type === "taskList"
                ? `- [${item.attrs?.checked === true ? "x" : " "}] `
                : "- ";
          const body = (item.content ?? []).map(blockMarkdown).join("\n\n");
          return indent(body, " ".repeat(node.type === "taskList" ? 2 : marker.length), marker);
        })
        .join("\n");
    }
    case RAW_BLOCK:
      return String(node.attrs?.source ?? "");
    default:
      return inlineMarkdown(children);
  }
}

export function serializeMarkdown(
  doc: PmNode,
  originals: ReadonlyMap<string, ReadonlyArray<string>> = new Map(),
  trailingNewline = true,
): string {
  const used = new Map<string, number>();
  const blocks = (doc.content ?? []).map((node) => {
    const key = keyOf(node);
    const sources = originals.get(key);
    const count = used.get(key) ?? 0;
    if (sources !== undefined && count < sources.length) {
      used.set(key, count + 1);
      return sources[count]!;
    }
    return blockMarkdown(node);
  });
  const text = blocks.join("\n\n").replace(/\n+$/, "");
  return trailingNewline && text !== "" ? `${text}\n` : text;
}
