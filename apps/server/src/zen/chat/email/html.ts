// Zen Staff e-mail channel (also used by the onboarding website reader): HTML to plain text,
// without a DOM. Scripts, styles and comments are dropped; so is text a reader would not see
// (display:none, visibility:hidden, font-size:0, zero-size or white-on-white), which is a common
// way to hide instructions for an AI in a mail. What was hidden is reported, never kept.

export interface HtmlText {
  readonly text: string;
  /** Text a person would not see (it was removed); the caller flags it. */
  readonly hidden: ReadonlyArray<string>;
  /** Links whose visible text names another domain than the one they open. */
  readonly linkMismatches: ReadonlyArray<{ readonly text: string; readonly href: string }>;
  readonly title: string | null;
}

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: String.fromCharCode(0x2014),
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  times: "×",
  shy: "",
  zwnj: "",
  zwj: "",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const value = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : match;
    }
    if (code.startsWith("#")) {
      const value = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : match;
    }
    return NAMED[code.toLowerCase()] ?? match;
  });
}

const HIDDEN_STYLE =
  /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?\s*(?:;|$|!)|max-height\s*:\s*0(?:px)?\s*(?:;|$|!)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)|(?:^|;)\s*color\s*:\s*(?:#fff(?:fff)?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255)|(?:^|;)\s*(?:width|height)\s*:\s*0(?:px)?\s*(?:;|$))/i;

const VOID = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
]);
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "table",
  "tr",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "form",
  "figure",
  "figcaption",
  "dl",
  "dt",
  "dd",
  "address",
]);
const SKIP = new Set([
  "script",
  "style",
  "head",
  "noscript",
  "template",
  "svg",
  "iframe",
  "object",
]);

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (match === null) return null;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
}

function isHiddenTag(tag: string): boolean {
  if (/\shidden(\s|=|>|\/)/i.test(tag)) return true;
  if (/aria-hidden\s*=\s*["']?true/i.test(tag)) return true;
  const style = attr(tag, "style");
  return style !== null && HIDDEN_STYLE.test(style);
}

function domainOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Visible text that itself looks like a web address or domain (for link mismatch checks). */
function domainInText(text: string): string | null {
  const match = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?/i.exec(text.trim());
  if (match === null) return null;
  return domainOf(match[1]!.startsWith("http") ? match[1]! : `https://${match[1]}`);
}

/** Plain text of an HTML document or fragment. */
export function htmlToText(html: string): HtmlText {
  const out: string[] = [];
  const hidden: string[] = [];
  const mismatches: { text: string; href: string }[] = [];
  let title: string | null = null;
  // Stack of open elements: name, hidden, skip.
  const stack: { name: string; hidden: boolean; skip: boolean }[] = [];
  let hiddenBuffer = "";
  let link: { href: string; text: string } | null = null;
  let listDepth = 0;
  let inPre = 0;
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const tokens = source.split(/(<[^>]*>)/);
  const hiddenNow = () => stack.some((item) => item.hidden);
  const skipNow = () => stack.some((item) => item.skip);
  for (const token of tokens) {
    if (token === "") continue;
    if (token.startsWith("<") && token.endsWith(">")) {
      const closing = /^<\s*\//.test(token);
      const nameMatch = /^<\s*\/?\s*([a-z0-9:-]+)/i.exec(token);
      if (nameMatch === null) continue;
      const name = nameMatch[1]!.toLowerCase();
      if (closing) {
        const index = stack.findLastIndex((item) => item.name === name);
        if (index !== -1) {
          const wasHidden = stack[index]!.hidden && !stack.slice(0, index).some((i) => i.hidden);
          stack.splice(index);
          if (wasHidden && hiddenBuffer.trim() !== "") {
            hidden.push(hiddenBuffer.replace(/\s+/g, " ").trim().slice(0, 300));
            hiddenBuffer = "";
          }
        }
        if (name === "a" && link !== null) {
          const shown = domainInText(link.text);
          const target = domainOf(link.href);
          if (
            shown !== null &&
            target !== null &&
            shown !== target &&
            !target.endsWith(`.${shown}`)
          )
            mismatches.push({
              text: link.text.trim().slice(0, 120),
              href: link.href.slice(0, 300),
            });
          if (
            link.href.startsWith("http") &&
            link.text.trim() !== "" &&
            !link.text.includes(link.href) &&
            !hiddenNow() &&
            !skipNow()
          ) {
            out.push(` (${link.href})`);
          }
          link = null;
        }
        if (name === "ul" || name === "ol") listDepth = Math.max(0, listDepth - 1);
        if (name === "pre") inPre = Math.max(0, inPre - 1);
        if (BLOCK.has(name)) out.push("\n");
        if (name === "td" || name === "th") out.push("\t");
        continue;
      }
      const selfClosing = /\/\s*>$/.test(token) || VOID.has(name);
      if (name === "br") {
        if (!hiddenNow() && !skipNow()) out.push("\n");
        continue;
      }
      if (name === "hr") {
        out.push("\n---\n");
        continue;
      }
      if (name === "img") {
        const alt = attr(token, "alt");
        if (alt && !hiddenNow() && !skipNow()) out.push(`[${alt}]`);
        continue;
      }
      if (selfClosing) continue;
      const entry = { name, hidden: isHiddenTag(token), skip: SKIP.has(name) };
      stack.push(entry);
      if (name === "a") {
        const href = attr(token, "href");
        link = href ? { href, text: "" } : null;
      }
      if (name === "ul" || name === "ol") listDepth += 1;
      if (name === "pre") inPre += 1;
      if (name === "li") out.push(`\n${"  ".repeat(Math.max(0, listDepth - 1))}- `);
      else if (BLOCK.has(name)) out.push("\n");
      continue;
    }
    if (stack.some((item) => item.name === "title") && title === null) {
      title = decodeEntities(token).replace(/\s+/g, " ").trim() || null;
      continue;
    }
    if (skipNow()) continue;
    const decoded = decodeEntities(token);
    if (hiddenNow()) {
      hiddenBuffer += ` ${decoded}`;
      continue;
    }
    if (link !== null) link.text += decoded;
    out.push(inPre > 0 ? decoded : decoded.replace(/[ \t\r\n\f]+/g, " "));
  }
  if (hiddenBuffer.trim() !== "")
    hidden.push(hiddenBuffer.replace(/\s+/g, " ").trim().slice(0, 300));
  const text = out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+(?!- )/g, "\n")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    text,
    hidden: hidden.filter((item) => item !== ""),
    linkMismatches: mismatches,
    title,
  };
}
