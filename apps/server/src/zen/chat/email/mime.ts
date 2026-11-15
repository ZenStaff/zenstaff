// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Pure parsing and building of RFC 5322 / MIME messages, outside the Effect runtime.
// Zen Staff e-mail channel: reading and writing mail without a library. Parses headers (folded,
// RFC 2047 encoded words), multipart bodies (any depth), base64 / quoted-printable, charsets
// (TextDecoder: utf-8, iso-8859-x, windows-125x), RFC 2231 file names, and picks the text
// (text/plain, else the HTML turned into text). Builds replies with In-Reply-To / References,
// a quoted original and attachments.
import * as NodeCrypto from "node:crypto";

import { htmlToText } from "./html.ts";

export interface MailAddress {
  readonly name: string;
  readonly address: string;
}

export interface MailAttachment {
  readonly index: number;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly inline: boolean;
  readonly contentId: string | null;
  readonly content: Uint8Array;
}

export interface ParsedMail {
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: ReadonlyArray<string>;
  readonly subject: string;
  readonly from: MailAddress | null;
  readonly replyTo: ReadonlyArray<MailAddress>;
  readonly to: ReadonlyArray<MailAddress>;
  readonly cc: ReadonlyArray<MailAddress>;
  readonly deliveredTo: ReadonlyArray<string>;
  readonly date: string | null;
  /** The readable text: text/plain, else the HTML turned into text. */
  readonly text: string;
  readonly html: string | null;
  /** Text a reader would not see in the HTML (removed; flagged by the caller). */
  readonly hiddenText: ReadonlyArray<string>;
  readonly linkMismatches: ReadonlyArray<{ readonly text: string; readonly href: string }>;
  readonly attachments: ReadonlyArray<MailAttachment>;
}

// Headers

function splitHeaderBody(raw: string): { header: string; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (match === null) return { header: raw, body: "" };
  return { header: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

function parseHeaders(header: string): Array<[string, string]> {
  const unfolded = header.replace(/\r?\n[ \t]+/g, " ");
  const out: Array<[string, string]> = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const value = line.slice(colon + 1).trim();
    // The source is the message's bytes as latin1; raw 8-bit header text is UTF-8 in practice.
    out.push([
      line.slice(0, colon).trim().toLowerCase(),
      /[\x80-\xff]/.test(value) ? Buffer.from(value, "latin1").toString("utf8") : value,
    ]);
  }
  return out;
}

const headerOf = (headers: ReadonlyArray<readonly [string, string]>, name: string) =>
  headers.find(([key]) => key === name)?.[1] ?? null;

function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  const aliases: Record<string, string> = {
    "us-ascii": "utf-8",
    ascii: "utf-8",
    latin1: "iso-8859-1",
    latin2: "iso-8859-2",
    utf8: "utf-8",
    cp1250: "windows-1250",
    cp1252: "windows-1252",
  };
  try {
    return new TextDecoder(aliases[label] ?? label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodeQuotedPrintable(text: string, headerMode = false): Uint8Array {
  const source = headerMode ? text.replace(/_/g, " ") : text.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "=" && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    const code = source.charCodeAt(index);
    if (code < 0x80) bytes.push(code);
    else for (const byte of Buffer.from(char, "utf8")) bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

/** RFC 2047 encoded words (=?charset?B|Q?...?=); adjacent words join without the space. */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?[^?]+\?[bq]\?[^?]*\?=)/gi, "$1")
    .replace(
      /=\?([^?*]+)(?:\*[^?]*)?\?([bq])\?([^?]*)\?=/gi,
      (_match, charset: string, encoding: string, data: string) => {
        const bytes =
          encoding.toLowerCase() === "b"
            ? Uint8Array.from(Buffer.from(data, "base64"))
            : decodeQuotedPrintable(data, true);
        return decodeBytes(bytes, charset);
      },
    );
}

/** Content-Type / Content-Disposition: value and parameters (RFC 2231 continuations too). */
function parseParams(value: string): { value: string; params: Record<string, string> } {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  const [first = "", ...rest] = parts;
  const params: Record<string, string> = {};
  const extended: Record<string, { charset: string | null; pieces: Map<number, string> }> = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let raw = part.slice(eq + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1).replace(/\\(.)/g, "$1");
    const ext = /^([^*]+)\*(?:(\d+)\*?)?$/.exec(key);
    if (ext !== null) {
      const name = ext[1]!;
      const order = ext[2] === undefined ? 0 : Number(ext[2]);
      const entry = (extended[name] ??= { charset: null, pieces: new Map() });
      let piece = raw;
      if (key.endsWith("*")) {
        const charsetMatch = /^([^']*)'[^']*'(.*)$/.exec(raw);
        if (charsetMatch !== null && order === 0) {
          entry.charset = charsetMatch[1] || "utf-8";
          piece = charsetMatch[2]!;
        }
        try {
          const bytes = Uint8Array.from(
            piece.replace(/%([0-9a-f]{2})/gi, (_m, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            ),
            (char) => char.charCodeAt(0),
          );
          piece = decodeBytes(bytes, entry.charset);
        } catch {
          // keep as is
        }
      }
      entry.pieces.set(order, piece);
      continue;
    }
    params[key] = decodeEncodedWords(raw);
  }
  for (const [name, entry] of Object.entries(extended)) {
    params[name] = [...entry.pieces.entries()]
      .toSorted(([left], [right]) => left - right)
      .map(([, piece]) => piece)
      .join("");
  }
  return { value: first.trim().toLowerCase(), params };
}

/** "Ana Pop" <ana@firma.example>, bob@x.example, =?utf-8?Q?...?= <c@y.example> */
export function parseAddressList(value: string | null): MailAddress[] {
  if (value === null || value.trim() === "") return [];
  const decoded = decodeEncodedWords(value);
  const items: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const char of decoded) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") angle += 1;
    if (!quoted && char === ">") angle = Math.max(0, angle - 1);
    if (char === "," && !quoted && angle === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.flatMap((item) => {
    const trimmed = item.trim();
    if (trimmed === "") return [];
    const angled = /^(.*)<([^<>]+)>\s*$/.exec(trimmed);
    const address = (angled ? angled[2]! : trimmed).trim().replace(/^mailto:/i, "");
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) return [];
    const name = angled ? angled[1]!.trim().replace(/^"|"$/g, "").trim() : "";
    return [{ name, address: address.toLowerCase() }];
  });
}

const messageIds = (value: string | null): string[] =>
  value === null ? [] : [...value.matchAll(/<([^<>\s]+)>/g)].map((match) => `<${match[1]}>`);

// Bodies

interface Part {
  readonly headers: Array<[string, string]>;
  readonly body: string;
}

function transferDecode(body: string, encoding: string | null): Uint8Array {
  const kind = (encoding ?? "7bit").trim().toLowerCase();
  if (kind === "base64")
    return Uint8Array.from(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64"));
  if (kind === "quoted-printable") return decodeQuotedPrintable(body);
  return Uint8Array.from(Buffer.from(body, "latin1"));
}

function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const lines = body.split(/\r?\n/);
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(marker)) {
      if (current !== null) parts.push(current.join("\r\n"));
      if (line.slice(marker.length).startsWith("--")) {
        current = null;
        break;
      }
      current = [];
      continue;
    }
    current?.push(line);
  }
  if (current !== null) parts.push(current.join("\r\n"));
  return parts;
}

interface Collected {
  plain: string[];
  html: string[];
  attachments: MailAttachment[];
}

function walk(part: Part, collected: Collected, depth: number) {
  if (depth > 12) return;
  const type = parseParams(headerOf(part.headers, "content-type") ?? "text/plain");
  const disposition = parseParams(headerOf(part.headers, "content-disposition") ?? "");
  const encoding = headerOf(part.headers, "content-transfer-encoding");
  if (type.value.startsWith("multipart/") && type.params.boundary) {
    for (const child of splitMultipart(part.body, type.params.boundary)) {
      const { header, body } = splitHeaderBody(child);
      walk({ headers: parseHeaders(header), body }, collected, depth + 1);
    }
    return;
  }
  const name = disposition.params.filename ?? type.params.name ?? null;
  const isAttachment =
    disposition.value === "attachment" ||
    (name !== null && !type.value.startsWith("text/")) ||
    type.value === "message/rfc822" ||
    (!type.value.startsWith("text/") && !type.value.startsWith("multipart/"));
  const bytes = transferDecode(part.body, encoding);
  if (!isAttachment && (type.value === "text/plain" || type.value === "text/html")) {
    const text = decodeBytes(bytes, type.params.charset ?? null);
    (type.value === "text/html" ? collected.html : collected.plain).push(text);
    return;
  }
  const contentId = headerOf(part.headers, "content-id");
  const fallback =
    type.value === "message/rfc822"
      ? "message.eml"
      : `attachment-${collected.attachments.length + 1}`;
  collected.attachments.push({
    index: collected.attachments.length,
    name: (name ?? fallback).replace(/[\\/]/g, "_").slice(0, 200),
    mimeType: type.value || "application/octet-stream",
    sizeBytes: bytes.byteLength,
    inline: disposition.value === "inline",
    contentId: contentId ? contentId.replace(/^<|>$/g, "") : null,
    content: bytes,
  });
}

export function parseMail(raw: string | Uint8Array): ParsedMail {
  // Work on the bytes as latin1 so every byte survives until its part's charset is known.
  const source = Buffer.from(typeof raw === "string" ? Buffer.from(raw, "utf8") : raw).toString(
    "latin1",
  );
  const { header, body } = splitHeaderBody(source);
  const headers = parseHeaders(header);
  const collected: Collected = { plain: [], html: [], attachments: [] };
  walk({ headers, body }, collected, 0);
  const html = collected.html.length > 0 ? collected.html.join("\n") : null;
  const converted = html === null ? null : htmlToText(html);
  const plain = collected.plain.join("\n\n").replace(/\r\n/g, "\n").trim();
  const subject = decodeEncodedWords(headerOf(headers, "subject") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const from = parseAddressList(headerOf(headers, "from"))[0] ?? null;
  const delivered = headers
    .filter(([key]) => key === "delivered-to" || key === "x-original-to" || key === "envelope-to")
    .flatMap(([, value]) => parseAddressList(value).map((item) => item.address));
  return {
    headers,
    messageId: messageIds(headerOf(headers, "message-id"))[0] ?? null,
    inReplyTo: messageIds(headerOf(headers, "in-reply-to"))[0] ?? null,
    references: messageIds(headerOf(headers, "references")),
    subject,
    from,
    replyTo: parseAddressList(headerOf(headers, "reply-to")),
    to: parseAddressList(headerOf(headers, "to")),
    cc: parseAddressList(headerOf(headers, "cc")),
    deliveredTo: delivered,
    date: (() => {
      const value = headerOf(headers, "date");
      const parsed = value === null ? Number.NaN : Date.parse(value);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    })(),
    text: plain !== "" ? plain : (converted?.text ?? ""),
    html,
    hiddenText: converted?.hidden ?? [],
    linkMismatches: converted?.linkMismatches ?? [],
    attachments: collected.attachments,
  };
}

/**
 * The new part of a reply: the text before the quoted history ("On ... wrote:", "În ... a
 * scris:", "-----Original Message-----", Outlook's "From: ... Sent:" block, or ">" lines).
 */
export function splitQuoted(text: string): { latest: string; quoted: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const markers = [
    /^\s*On .{3,200} wrote:\s*$/i,
    /^\s*(?:În|In|Pe) .{3,200} (?:a scris|scria|wrote)\s*:?\s*$/i,
    /^\s*-{2,}\s*(?:Original Message|Mesaj original|Forwarded message|Mesaj redirecționat)\s*-{2,}/i,
    /^\s*(?:From|De la|De):\s.+$/i,
    /^\s*>/,
  ];
  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;
    const isMarker = markers.some((pattern) => pattern.test(line));
    if (!isMarker) continue;
    // "From:" only counts with a "Sent:/Date:/Trimis:" line right after (Outlook header block).
    if (
      /^\s*(?:From|De la|De):/i.test(line) &&
      !/^\s*(?:Sent|Date|Trimis|Data):/i.test(lines[index + 1] ?? "")
    )
      continue;
    return {
      latest: lines.slice(0, index).join("\n").trim(),
      quoted: lines.slice(index).join("\n").trim(),
    };
  }
  return { latest: text.trim(), quoted: "" };
}

// Building

export interface OutgoingAttachment {
  readonly name: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export interface OutgoingMail {
  readonly from: MailAddress;
  readonly to: ReadonlyArray<MailAddress>;
  readonly cc?: ReadonlyArray<MailAddress>;
  readonly subject: string;
  readonly text: string;
  readonly inReplyTo?: string | null;
  readonly references?: ReadonlyArray<string>;
  readonly attachments?: ReadonlyArray<OutgoingAttachment>;
  readonly messageId?: string;
  readonly date?: Date;
  /** Extra headers (Auto-Submitted for reports, X-Zen-Staff marker). */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

function encodeWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatAddress(address: MailAddress): string {
  if (address.name.trim() === "") return address.address;
  const name = encodeWord(address.name.trim());
  return name.startsWith("=?")
    ? `${name} <${address.address}>`
    : `"${name.replace(/"/g, "'")}" <${address.address}>`;
}

const wrap76 = (base64: string) => base64.replace(/.{1,76}/g, (line) => `${line}\r\n`).trimEnd();

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^(re|răsp|rasp|aw|sv)\s*:/i.test(trimmed) ? trimmed : `Re: ${trimmed || "(no subject)"}`;
}

function newMessageId(domain: string): string {
  return `<zen-${NodeCrypto.randomBytes(12).toString("hex")}@${domain.replace(/[^a-z0-9.-]/gi, "") || "zen.local"}>`;
}

/** The quoted original under a reply, in the reply's language. */
export function quoteOriginal(
  original: { readonly from: string; readonly at: string | null; readonly text: string },
  locale: "en" | "ro",
): string {
  const when = original.at === null ? "" : new Date(original.at).toUTCString();
  const head =
    locale === "ro"
      ? `${when ? `Pe ${when}, ` : ""}${original.from} a scris:`
      : `On ${when || "an earlier date"}, ${original.from} wrote:`;
  const body = original.text
    .split(/\r?\n/)
    .slice(0, 400)
    .map((line) => `> ${line}`)
    .join("\n");
  return `${head}\n${body}`;
}

/** An RFC 5322 message (CRLF line ends): text/plain UTF-8, plus attachments as multipart/mixed. */
export function buildMail(mail: OutgoingMail): string {
  const domain = mail.from.address.split("@")[1] ?? "zen.local";
  const headers: string[] = [
    `From: ${formatAddress(mail.from)}`,
    `To: ${mail.to.map(formatAddress).join(", ")}`,
    ...(mail.cc && mail.cc.length > 0 ? [`Cc: ${mail.cc.map(formatAddress).join(", ")}`] : []),
    `Subject: ${encodeWord(mail.subject.replace(/[\r\n]+/g, " "))}`,
    `Date: ${(mail.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${mail.messageId ?? newMessageId(domain)}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`] : []),
    ...(mail.references && mail.references.length > 0
      ? [`References: ${mail.references.slice(-20).join(" ")}`]
      : []),
    ...Object.entries(mail.extraHeaders ?? {}).map(
      ([key, value]) => `${key.replace(/[^A-Za-z0-9-]/g, "")}: ${value.replace(/[\r\n]+/g, " ")}`,
    ),
    "MIME-Version: 1.0",
  ];
  const textPart = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(mail.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64")),
  ].join("\r\n");
  const attachments = mail.attachments ?? [];
  if (attachments.length === 0) return `${headers.join("\r\n")}\r\n${textPart}\r\n`;
  const boundary = `zen-${NodeCrypto.randomBytes(10).toString("hex")}`;
  const parts = [
    textPart,
    ...attachments.map((attachment) => {
      const safe = attachment.name.replace(/["\r\n\\]/g, "_");
      const encodedName = encodeWord(safe);
      return [
        `Content-Type: ${attachment.mimeType}; name="${encodedName}"`,
        `Content-Disposition: attachment; filename="${encodedName}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap76(Buffer.from(attachment.content).toString("base64")),
      ].join("\r\n");
    }),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.flatMap((part) => [`--${boundary}`, part]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
