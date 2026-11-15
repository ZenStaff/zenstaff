import { describe, expect, it } from "vite-plus/test";

import {
  normalizeNode,
  parseMarkdown,
  RAW_BLOCK,
  serializeMarkdown,
  type PmNode,
} from "./markdownDoc";

const SAMPLE = `---
title: Meniu
---

# Meniul *zilei*

Preț **18 lei**, vezi [site](https://example.ro "Site").
Rând nou după\\
o pauză și \`cod\`.

* listă cu steluță
* al doilea

1. unu
2. doi

- [x] gata
- [ ] de făcut

> citat

\`\`\`js
const a = 1;
\`\`\`

| Produs | Preț |
| --- | --- |
| Ciorbă | 18 |

![poză](poza.png) cu <span>html</span>

---
`;

const replaceBlock = (doc: PmNode, index: number, node: PmNode): PmNode => ({
  ...doc,
  content: doc.content!.map((child, at) => (at === index ? node : child)),
});

describe("Markdown for the rich editor", () => {
  it("writes an untouched document back exactly", () => {
    const parsed = parseMarkdown(SAMPLE);
    expect(serializeMarkdown(parsed.doc, parsed.originals, parsed.trailingNewline)).toBe(SAMPLE);
  });

  it("keeps tables, front matter and inline HTML as raw source", () => {
    const { doc } = parseMarkdown(SAMPLE);
    const types = doc.content!.map((node) => node.type);
    expect(types[0]).toBe(RAW_BLOCK);
    expect(types).toContain("taskList");
    expect(types).toContain("orderedList");
    const table = doc.content!.find(
      (node) => node.type === RAW_BLOCK && String(node.attrs?.source).startsWith("| Produs"),
    );
    expect(table).toBeDefined();
  });

  it("serializes edited blocks and leaves the rest as they were", () => {
    const parsed = parseMarkdown(SAMPLE);
    const index = parsed.doc.content!.findIndex((node) => node.type === "paragraph");
    const edited = replaceBlock(parsed.doc, index, {
      type: "paragraph",
      content: [
        { type: "text", text: "Preț " },
        { type: "text", text: "19 lei ", marks: [{ type: "bold" }] },
        { type: "text", text: "acum", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "text", text: " * 2 [nota]" },
      ],
    });
    const out = serializeMarkdown(edited, parsed.originals, true);
    expect(out).toContain("Preț **19 lei _acum_** \\* 2 \\[nota\\]");
    // Untouched blocks keep their original spelling (`*` bullets).
    expect(out).toContain("* listă cu steluță\n* al doilea");
    expect(out).toContain("| Ciorbă | 18 |");
  });

  it("ignores attributes the editor adds when it decides what was touched", () => {
    const parsed = parseMarkdown("Text cu [link](https://a.ro).\n");
    const fromEditor: PmNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: null },
          content: [
            { type: "text", text: "Text cu " },
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://a.ro", title: null } }],
            },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    expect(normalizeNode(fromEditor)).toEqual(normalizeNode(parsed.doc));
    expect(serializeMarkdown(fromEditor, parsed.originals, true)).toBe(
      "Text cu [link](https://a.ro).\n",
    );
  });

  it("writes new lists, headings, quotes and code fences", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "# Titlu" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "unu" }] }],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "trei" }] }],
            },
          ],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "citat" }] }],
        },
        {
          type: "codeBlock",
          attrs: { language: "md" },
          content: [{ type: "text", text: "```x```" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "a`b", marks: [{ type: "code" }] }] },
      ],
    };
    expect(serializeMarkdown(doc)).toBe(
      "## \\# Titlu\n\n- unu\n\n3. trei\n\n> citat\n\n````md\n```x```\n````\n\n``a`b``\n",
    );
  });
});
