// Zen Staff chat integrations: message text. Agents answer in Markdown; each platform has its own
// markup and length limit. Pure functions: formatting, long-answer chunking, inbound decoding and
// the files an answer points at.
import type { ZenChatPlatform } from "@t3tools/contracts/zenChat";

// Markdown -> platform markup

type Segment = {
  readonly kind: "text" | "code" | "fence";
  readonly body: string;
  readonly lang?: string;
};

/** Splits Markdown into prose, inline code and fenced blocks so markup is only rewritten in prose. */
function splitCode(markdown: string): ReadonlyArray<Segment> {
  const segments: Segment[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (const match of markdown.matchAll(fence)) {
    if (match.index > last) segments.push(...splitInline(markdown.slice(last, match.index)));
    segments.push({
      kind: "fence",
      body: (match[2] ?? "").replace(/\n$/, ""),
      lang: match[1] ?? "",
    });
    last = match.index + match[0].length;
  }
  if (last < markdown.length) segments.push(...splitInline(markdown.slice(last)));
  return segments;
}

function splitInline(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match.index > last) out.push({ kind: "text", body: text.slice(last, match.index) });
    out.push({ kind: "code", body: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", body: text.slice(last) });
  return out;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeSlack = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Images and file links to local paths are sent as files, so the text keeps only the title. */
const LOCAL_FILE_LINK = /!?\[([^\]]*)\]\((\/[^)\s]+|[A-Za-z]:\\[^)\s]+)\)/g;

/** Markdown emphasis in the `*bold* _italic_ ~strike~` family (Slack, Google Chat, WhatsApp). */
function starMarkup(text: string): string {
  const BOLD = "\u0001";
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, `${BOLD}$1${BOLD}`)
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}_$1_${BOLD}`)
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${BOLD}`)
    .replace(/__(.+?)__/g, `${BOLD}$1${BOLD}`)
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1_$2_")
    .replace(/~~(.+?)~~/g, "~$1~")
    .replace(/\u0001/g, "*");
}

function prose(platform: ZenChatPlatform, raw: string): string {
  let text = raw.replace(LOCAL_FILE_LINK, (_match, title: string) =>
    title.trim() === "" ? "" : `[${title.trim()}]`,
  );
  switch (platform) {
    case "slack":
    case "googlechat": {
      const links: string[] = [];
      text = text.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_m, label: string, url: string) => {
          links.push(`<${url}|${label.replace(/[|<>]/g, "")}>`);
          return `\u0000${links.length - 1}\u0000`;
        },
      );
      if (platform === "slack") text = escapeSlack(text);
      text = starMarkup(text);
      return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => links[Number(index)]!);
    }
    case "telegram": {
      const links: string[] = [];
      text = text.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_m, label: string, url: string) => {
          links.push(
            `<a href="${escapeHtml(url).replace(/"/g, "&quot;")}">${escapeHtml(label)}</a>`,
          );
          return `\u0000${links.length - 1}\u0000`;
        },
      );
      text = escapeHtml(text)
        .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/__(.+?)__/g, "<b>$1</b>")
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<i>$2</i>")
        .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1<i>$2</i>")
        .replace(/~~(.+?)~~/g, "<s>$1</s>")
        .replace(/^(\s*)[-*+]\s+/gm, "$1• ");
      return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => links[Number(index)]!);
    }
    case "whatsapp":
      return starMarkup(text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)"));
    case "teams":
      // Teams renders Markdown but not headings.
      return text.replace(/^#{1,6}\s+(.+)$/gm, "**$1**");
    default:
      return text;
  }
}

/** Agent Markdown in the platform's own markup. */
export function formatFor(platform: ZenChatPlatform, markdown: string): string {
  return splitCode(markdown)
    .map((segment) => {
      if (segment.kind === "text") return prose(platform, segment.body);
      if (segment.kind === "code") {
        return platform === "telegram"
          ? `<code>${escapeHtml(segment.body)}</code>`
          : platform === "slack"
            ? `\`${escapeSlack(segment.body)}\``
            : `\`${segment.body}\``;
      }
      if (platform === "telegram") return `<pre>${escapeHtml(segment.body)}</pre>`;
      if (platform === "slack") return `\`\`\`\n${escapeSlack(segment.body)}\n\`\`\``;
      if (platform === "whatsapp" || platform === "googlechat") {
        return `\`\`\`\n${segment.body}\n\`\`\``;
      }
      return `\`\`\`${segment.lang ?? ""}\n${segment.body}\n\`\`\``;
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Long answers

const FENCE_OPEN: Partial<Record<ZenChatPlatform, [string, string]>> = {
  telegram: ["<pre>", "</pre>"],
};

/**
 * Splits text into pieces of at most `limit` characters: at a blank line, else a line break, else a
 * space. A piece that ends inside a code block closes it and the next piece reopens it, so every
 * piece renders on its own.
 */
export function chunkText(text: string, limit: number, platform?: ZenChatPlatform): string[] {
  const [open, close] = (platform && FENCE_OPEN[platform]) ?? ["```\n", "\n```"];
  const budget = Math.max(50, limit - open.length - close.length - 2);
  const chunks: string[] = [];
  let rest = text.trim();
  let carryFence = false;
  while (rest.length > 0) {
    let piece: string;
    if ((carryFence ? open.length : 0) + rest.length <= limit) {
      piece = rest;
      rest = "";
    } else {
      const window = rest.slice(0, budget);
      let cut = window.lastIndexOf("\n\n");
      if (cut < budget * 0.5) cut = window.lastIndexOf("\n");
      if (cut < budget * 0.5) cut = window.lastIndexOf(" ");
      if (cut < budget * 0.3) cut = budget;
      piece = rest.slice(0, cut);
      rest = rest.slice(cut).replace(/^\s+/, "");
    }
    const withCarry: string = carryFence ? `${open}${piece}` : piece;
    const insideFence: boolean = countFences(withCarry, platform) % 2 === 1;
    chunks.push(insideFence && rest.length > 0 ? `${withCarry}${close}` : withCarry);
    carryFence = insideFence && rest.length > 0;
  }
  return chunks.length === 0 ? [""] : chunks;
}

function countFences(text: string, platform?: ZenChatPlatform): number {
  if (platform === "telegram") {
    return (text.match(/<pre>/g)?.length ?? 0) + (text.match(/<\/pre>/g)?.length ?? 0);
  }
  return text.match(/```/g)?.length ?? 0;
}

// Inbound decoding

const decodeEntities = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** Slack mrkdwn as typed: user/channel mentions, links, entities. */
export function decodeSlackText(
  text: string,
  botUserId: string | null,
  names: Readonly<Record<string, string>> = {},
): string {
  return decodeEntities(
    text
      .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_m, id: string) =>
        id === botUserId ? "" : `@${names[id] ?? id}`,
      )
      .replace(/<#([CG][A-Z0-9]+)\|([^>]*)>/g, (_m, _id: string, name: string) => `#${name}`)
      .replace(/<!(here|channel|everyone)>/g, "@$1")
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)")
      .replace(/<(https?:\/\/[^>]+)>/g, "$1")
      .replace(/<mailto:([^|>]+)\|[^>]+>/g, "$1"),
  )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Teams: `<at>Bot</at>` mentions and the little HTML Teams sends. */
export function decodeTeamsText(text: string, botName: string | null): string {
  const withoutBot = text.replace(/<at>([^<]*)<\/at>/g, (_m, name: string) =>
    botName !== null && name.trim() === botName.trim() ? "" : `@${name}`,
  );
  return decodeEntities(
    withoutBot
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Removes a leading/trailing `@bot` mention (Telegram, Discord, typed). */
export function stripMention(text: string, mention: RegExp): string {
  return text
    .replace(mention, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** `/zen task`, `/zen@MyBot task`, `zen: task` are commands; returns the arguments. */
export function parseZenCommand(text: string): { args: string } | null {
  const match = /^\s*\/zen(?:@[\w_]+)?(?:\s+([\s\S]*))?$/i.exec(text);
  return match ? { args: (match[1] ?? "").trim() } : null;
}

// Files an answer points at

/** Absolute paths the answer embeds or links (`![x](/a/b.png)`, `[report](/a/r.pdf)`). */
export function referencedFiles(markdown: string): ReadonlyArray<{ path: string; title: string }> {
  const seen = new Set<string>();
  const files: { path: string; title: string }[] = [];
  for (const segment of splitCode(markdown)) {
    if (segment.kind !== "text") continue;
    for (const match of segment.body.matchAll(LOCAL_FILE_LINK)) {
      const path = match[2]!;
      if (seen.has(path)) continue;
      seen.add(path);
      files.push({ path, title: (match[1] ?? "").trim() });
    }
  }
  return files;
}

/** File names that are safe on every OS: no separators, no control characters, short. */
export function safeFileName(name: string, fallback = "file"): string {
  const base = name
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(-120);
  return base === "" ? fallback : base;
}

export function attachmentKind(mimeType: string): "image" | "audio" | "video" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  zip: "application/zip",
};

export function mimeFromName(name: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}
