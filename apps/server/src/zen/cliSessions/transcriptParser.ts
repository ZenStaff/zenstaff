import type { ZenCliSessionOrigin, ZenCliSessionProvider } from "@t3tools/contracts/zenCliSessions";

/** Lines past this size are never decoded whole: only their edges are kept for metadata. */
export const MAX_LINE_BYTES = 512 * 1024;
const EDGE_BYTES = 2048;
const MAX_TITLE_FIELD_LINE = 64 * 1024;
const TITLE_LENGTH = 90;
const PROMPT_PREVIEW_LENGTH = 400;

/** Search text kept per session, split between the start and the latest part of a conversation. */
const USER_TEXT_BUDGET = { head: 24 * 1024, tail: 24 * 1024, perMessage: 4 * 1024 };
const ASSISTANT_TEXT_BUDGET = { head: 8 * 1024, tail: 16 * 1024, perMessage: 1024 };

export interface TextBudget {
  head: string;
  tail: string;
}

export interface SessionDigest {
  provider: ZenCliSessionProvider;
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  client: string | null;
  customTitle: string | null;
  aiTitle: string | null;
  summary: string | null;
  firstPrompt: string | null;
  model: string | null;
  startedAt: string | null;
  userMessages: number;
  assistantMessages: number;
  /** Diacritic-folded text the user typed. */
  userText: TextBudget;
  /** Diacritic-folded text the agent answered (no tool traffic, no thinking). */
  assistantText: TextBudget;
  /** Codex subagent rollouts are not conversations a user can resume. */
  excluded: boolean;
}

export function emptyDigest(provider: ZenCliSessionProvider): SessionDigest {
  return {
    provider,
    sessionId: null,
    cwd: null,
    gitBranch: null,
    client: null,
    customTitle: null,
    aiTitle: null,
    summary: null,
    firstPrompt: null,
    model: null,
    startedAt: null,
    userMessages: 0,
    assistantMessages: 0,
    userText: { head: "", tail: "" },
    assistantText: { head: "", tail: "" },
    excluded: false,
  };
}

export function cloneDigest(digest: SessionDigest): SessionDigest {
  return {
    ...digest,
    userText: { ...digest.userText },
    assistantText: { ...digest.assistantText },
  };
}

// ─── Line splitting ─────────────────────────────────────────────────────────

/**
 * Splits byte chunks into lines without ever holding an oversized line: past MAX_LINE_BYTES only
 * the first and last EDGE_BYTES survive. `completedBytes` counts bytes up to the last newline, so
 * a re-read of an append-only transcript resumes at a line boundary.
 */
export class LineSplitter {
  private readonly decoder = new TextDecoder();
  private parts: Array<Uint8Array> = [];
  private partBytes = 0;
  private oversizedHead: Uint8Array | null = null;
  private oversizedTail: Uint8Array = new Uint8Array(0);
  private oversizedSkipped = 0;
  private readonly onLine: (line: string, oversized: boolean) => void;
  completedBytes = 0;

  constructor(onLine: (line: string, oversized: boolean) => void) {
    this.onLine = onLine;
  }

  push(chunk: Uint8Array): void {
    let start = 0;
    while (start < chunk.byteLength) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.byteLength : newline;
      this.append(chunk.subarray(start, end));
      if (newline === -1) return;
      this.completedBytes += this.partBytes + this.oversizedSkipped + 1;
      this.flushLine();
      start = newline + 1;
    }
  }

  private append(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    if (this.oversizedHead !== null) {
      this.oversizedSkipped += bytes.byteLength;
      this.keepTail(bytes);
      return;
    }
    // Chunks are reused by the reader, so keep copies.
    this.parts.push(bytes.slice());
    this.partBytes += bytes.byteLength;
    if (this.partBytes > MAX_LINE_BYTES) {
      const whole = concat(this.parts, this.partBytes);
      this.oversizedHead = whole.slice(0, EDGE_BYTES);
      this.oversizedTail = whole.slice(whole.byteLength - EDGE_BYTES);
      this.oversizedSkipped = whole.byteLength;
      this.parts = [];
      this.partBytes = 0;
    }
  }

  private keepTail(bytes: Uint8Array): void {
    if (bytes.byteLength >= EDGE_BYTES) {
      this.oversizedTail = bytes.slice(bytes.byteLength - EDGE_BYTES);
      return;
    }
    const merged = new Uint8Array(
      Math.min(EDGE_BYTES, this.oversizedTail.byteLength + bytes.byteLength),
    );
    const keepOld = merged.byteLength - bytes.byteLength;
    merged.set(this.oversizedTail.subarray(this.oversizedTail.byteLength - keepOld), 0);
    merged.set(bytes, keepOld);
    this.oversizedTail = merged;
  }

  private flushLine(): void {
    if (this.oversizedHead !== null) {
      const line = `${this.decoder.decode(this.oversizedHead)}…${this.decoder.decode(this.oversizedTail)}`;
      this.oversizedHead = null;
      this.oversizedTail = new Uint8Array(0);
      this.oversizedSkipped = 0;
      this.onLine(line, true);
      return;
    }
    if (this.partBytes === 0) {
      this.parts = [];
      return;
    }
    const bytes = this.parts.length === 1 ? this.parts[0]! : concat(this.parts, this.partBytes);
    this.parts = [];
    this.partBytes = 0;
    this.onLine(this.decoder.decode(bytes), false);
  }
}

function concat(parts: ReadonlyArray<Uint8Array>, total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// ─── Text helpers ───────────────────────────────────────────────────────────

const COMBINING_MARKS = /\p{M}+/gu;

/** Strips diacritics (ș → s, ă → a) so Romanian text matches queries typed without them. */
function foldText(text: string): string {
  return /^[\x00-\x7f]*$/.test(text) ? text : text.normalize("NFD").replace(COMBINING_MARKS, "");
}

function appendBudgeted(
  target: TextBudget,
  text: string,
  budget: { readonly head: number; readonly tail: number; readonly perMessage: number },
): void {
  const piece = foldText(text.length > budget.perMessage ? text.slice(0, budget.perMessage) : text)
    .replace(/\s+/g, " ")
    .trim();
  if (piece.length === 0) return;
  if (target.head.length < budget.head) {
    target.head = target.head.length === 0 ? piece : `${target.head}\n${piece}`;
    if (target.head.length <= budget.head) return;
    const overflow = target.head.slice(budget.head);
    target.head = target.head.slice(0, budget.head);
    target.tail = overflow;
    return;
  }
  const next = target.tail.length === 0 ? piece : `${target.tail}\n${piece}`;
  target.tail = next.length > budget.tail ? next.slice(next.length - budget.tail) : next;
}

const NON_PROMPT_PREFIX =
  /^<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|bash-input|bash-stdout|bash-stderr|user-memory-input|task-notification)>/;

/** Claude Code writes slash commands and their output as user entries; they are not prompts. */
export function isPromptText(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("[Request interrupted")) return false;
  if (trimmed.startsWith("Caveat: The messages below were generated")) return false;
  return !NON_PROMPT_PREFIX.test(trimmed);
}

// Codex sends setup context as user text ahead of the real request.
export const CODEX_PREAMBLE =
  /^(?:\s*(?:<(environment_context|user_instructions|INSTRUCTIONS|recommended_plugins)(?:\s[^>]*)?>[\s\S]*?<\/\1>|# AGENTS\.md instructions\b[^\n]*))+/;

function titleFromPrompt(text: string): string {
  const clean = text
    .replace(CODEX_PREAMBLE, "")
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/<[^>\n]{1,80}>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= TITLE_LENGTH) return clean;
  const cut = clean.slice(0, TITLE_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${space > TITLE_LENGTH / 2 ? cut.slice(0, space) : cut}…`;
}

export function resolveTitle(digest: SessionDigest): string {
  return (
    digest.customTitle ??
    digest.aiTitle ??
    digest.summary ??
    (digest.firstPrompt === null ? null : titleFromPrompt(digest.firstPrompt)) ??
    "Untitled session"
  );
}

/** Rough map from the transcript's client name to who started the session. */
export function resolveOrigin(
  provider: ZenCliSessionProvider,
  client: string | null,
): ZenCliSessionOrigin {
  if (client === null) return "terminal";
  if (provider === "claudeAgent") {
    if (client === "cli") return "terminal";
    if (client === "t3-code") return "app";
    return "other";
  }
  if (client === "Zen Staff") return "app";
  if (client.startsWith("codex_cli") || client === "codex-tui" || client === "codex_exec")
    return "terminal";
  return "other";
}

// ─── Field extraction without a full parse ──────────────────────────────────

const STRING_FIELD_CACHE = new Map<string, RegExp>();

function stringField(source: string, key: string): string | null {
  let pattern = STRING_FIELD_CACHE.get(key);
  if (pattern === undefined) {
    pattern = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`);
    STRING_FIELD_CACHE.set(key, pattern);
  }
  const match = pattern.exec(source);
  if (match === null) return null;
  const raw = match[1]!;
  if (!raw.includes("\\")) return raw;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}

/** Claude puts session fields after `message`, so they sit at the end of even a huge line. */
function edges(line: string): string {
  return line.length <= 2 * EDGE_BYTES
    ? line
    : `${line.slice(0, EDGE_BYTES)}\n${line.slice(-EDGE_BYTES)}`;
}

function parseObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    // A transcript still being written can end mid-line.
    return null;
  }
}

function textOf(content: unknown, blockType: string): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let text: string | null = null;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const entry = block as Record<string, unknown>;
    if (entry.type !== blockType || typeof entry.text !== "string") continue;
    text = text === null ? entry.text : `${text}\n${entry.text}`;
  }
  return text;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function notePrompt(digest: SessionDigest, text: string): void {
  digest.userMessages += 1;
  if (digest.firstPrompt === null) {
    const preview = text.replace(CODEX_PREAMBLE, "").trim();
    if (preview.length > 0) digest.firstPrompt = preview.slice(0, PROMPT_PREVIEW_LENGTH);
  }
  appendBudgeted(digest.userText, text, USER_TEXT_BUDGET);
}

function noteAnswer(digest: SessionDigest, text: string): void {
  digest.assistantMessages += 1;
  appendBudgeted(digest.assistantText, text, ASSISTANT_TEXT_BUDGET);
}

// ─── Claude Code ────────────────────────────────────────────────────────────

const PREFIX_TYPE = /^\{"type":"([a-z-]+)"/;

function consumeClaudeLine(digest: SessionDigest, line: string, oversized: boolean): void {
  const prefixed = PREFIX_TYPE.exec(line);
  if (prefixed !== null) {
    const type = prefixed[1]!;
    if (
      type !== "ai-title" &&
      type !== "custom-title" &&
      type !== "agent-name" &&
      type !== "summary"
    )
      return;
    if (oversized || line.length > MAX_TITLE_FIELD_LINE) return;
    const entry = parseObject(line);
    if (entry === null) return;
    if (type === "ai-title") digest.aiTitle = nonEmpty(entry.aiTitle) ?? digest.aiTitle;
    // An empty rename clears the custom title.
    else if (type === "custom-title")
      digest.customTitle =
        typeof entry.customTitle === "string" ? nonEmpty(entry.customTitle) : digest.customTitle;
    else if (type === "agent-name")
      digest.customTitle = nonEmpty(entry.agentName) ?? digest.customTitle;
    else digest.summary = nonEmpty(entry.summary) ?? digest.summary;
    return;
  }

  const outer = edges(line);
  if (digest.cwd === null) digest.cwd = stringField(outer, "cwd");
  if (digest.sessionId === null) digest.sessionId = stringField(outer, "sessionId");
  if (digest.client === null) digest.client = stringField(outer, "entrypoint");
  const branch = stringField(outer, "gitBranch");
  if (branch !== null && branch.length > 0 && branch !== "HEAD") digest.gitBranch = branch;
  if (digest.startedAt === null) digest.startedAt = stringField(outer, "timestamp");

  const message = claudeLineMessage(line, oversized);
  if (message === null) return;
  if (message.role === "user") notePrompt(digest, message.text);
  else {
    if (message.model !== null) digest.model = message.model;
    noteAnswer(digest, message.text);
  }
}

export interface LineMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly timestamp: string | null;
  readonly model: string | null;
}

function claudeLineMessage(line: string, oversized: boolean): LineMessage | null {
  if (oversized || line.startsWith('{"type":"')) return null;
  if (line.slice(0, 400).includes('"isSidechain":true')) return null;
  const isUser = line.includes('"type":"user"');
  const isAssistant = !isUser && line.includes('"type":"assistant"');
  if (!isUser && !isAssistant) return null;
  // Tool results ride on user entries and answers to tool calls are not text: skip the parse.
  if (isUser && /[^\\]"type":"tool_result"/.test(line)) return null;
  if (isAssistant && !/[^\\]"type":"text"/.test(line)) return null;

  const entry = parseObject(line);
  if (entry === null || entry.isSidechain === true) return null;
  const message = entry.message;
  if (typeof message !== "object" || message === null) return null;
  const fields = message as Record<string, unknown>;
  const timestamp = nonEmpty(entry.timestamp);
  if (entry.type === "user") {
    if (entry.isMeta === true || entry.isCompactSummary === true) return null;
    const text = textOf(fields.content, "text");
    return text === null || !isPromptText(text)
      ? null
      : { role: "user", text, timestamp, model: null };
  }
  if (entry.type !== "assistant") return null;
  const text = textOf(fields.content, "text");
  if (text === null || text.trim().length === 0) return null;
  const model = nonEmpty(fields.model);
  return {
    role: "assistant",
    text,
    timestamp,
    model: model === null || model === "<synthetic>" ? null : model,
  };
}

// ─── Codex ──────────────────────────────────────────────────────────────────

const CODEX_PREFIX = /^\{"timestamp":"([^"]*)","type":"([a-z_]+)"/;

function consumeCodexLine(digest: SessionDigest, line: string, oversized: boolean): void {
  const prefixed = CODEX_PREFIX.exec(line);
  const type = prefixed?.[2] ?? null;
  if (prefixed !== null && digest.startedAt === null) digest.startedAt = prefixed[1]!;
  if (type === "session_meta") {
    const entry = oversized ? null : parseObject(line);
    const payload = entry?.payload;
    if (typeof payload === "object" && payload !== null) {
      const meta = payload as Record<string, unknown>;
      digest.sessionId ??= nonEmpty(meta.id);
      digest.cwd ??= nonEmpty(meta.cwd);
      digest.client ??= nonEmpty(meta.originator);
      const git = meta.git;
      if (typeof git === "object" && git !== null) {
        digest.gitBranch = nonEmpty((git as Record<string, unknown>).branch) ?? digest.gitBranch;
      }
      const source = meta.source;
      if (
        typeof source === "object" &&
        source !== null &&
        !Array.isArray(source) &&
        (Object.hasOwn(source, "subagent") || Object.hasOwn(source, "subAgent"))
      ) {
        digest.excluded = true;
      }
    } else {
      const outer = edges(line);
      digest.sessionId ??= stringField(outer, "id");
      digest.cwd ??= stringField(outer, "cwd");
      digest.client ??= stringField(outer, "originator");
    }
    return;
  }
  if (oversized) return;
  if (type === "turn_context") {
    const model = stringField(line.slice(0, 4096), "model");
    if (model !== null) digest.model = model;
    return;
  }
  const message = codexLineMessage(line, oversized);
  if (message === null) return;
  if (message.role === "user") notePrompt(digest, message.text);
  else noteAnswer(digest, message.text);
}

function codexLineMessage(line: string, oversized: boolean): LineMessage | null {
  if (oversized) return null;
  const prefixed = CODEX_PREFIX.exec(line);
  if (prefixed === null || prefixed[2] !== "event_msg") return null;
  const head = line.slice(0, 200);
  const isUser = head.includes('"type":"user_message"');
  if (!isUser && !head.includes('"type":"agent_message"')) return null;
  const payload = parseObject(line)?.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const text = (payload as Record<string, unknown>).message;
  if (typeof text !== "string" || text.trim().length === 0) return null;
  if (isUser && !isPromptText(text)) return null;
  return { role: isUser ? "user" : "assistant", text, timestamp: prefixed[1]!, model: null };
}

export function consumeLine(digest: SessionDigest, line: string, oversized: boolean): void {
  if (line.length === 0) return;
  if (digest.provider === "claudeAgent") consumeClaudeLine(digest, line, oversized);
  else consumeCodexLine(digest, line, oversized);
}

/** Keeps the first prompt and the latest messages of a transcript, within a byte budget. */
export class RecentMessages {
  private readonly provider: ZenCliSessionProvider;
  private readonly limit: number;
  private readonly maxChars: number;
  first: LineMessage | null = null;
  recent: Array<LineMessage> = [];
  total = 0;

  constructor(
    provider: ZenCliSessionProvider,
    options: { readonly limit: number; readonly maxChars: number },
  ) {
    this.provider = provider;
    this.limit = options.limit;
    this.maxChars = options.maxChars;
  }

  consume(line: string, oversized: boolean): void {
    const message =
      this.provider === "claudeAgent"
        ? claudeLineMessage(line, oversized)
        : codexLineMessage(line, oversized);
    if (message === null) return;
    this.total += 1;
    const trimmed =
      message.text.length > this.maxChars / 4
        ? { ...message, text: `${message.text.slice(0, this.maxChars / 4)}\u2026` }
        : message;
    if (this.first === null && message.role === "user") {
      this.first = trimmed;
      return;
    }
    this.recent.push(trimmed);
    if (this.recent.length > this.limit) this.recent.shift();
  }

  /** The first prompt, then the newest messages that fit; `omitted` counts what was left out. */
  messages(): { readonly messages: ReadonlyArray<LineMessage>; readonly omitted: number } {
    let budget = this.maxChars - (this.first?.text.length ?? 0);
    const kept: Array<LineMessage> = [];
    for (let index = this.recent.length - 1; index >= 0; index -= 1) {
      const message = this.recent[index]!;
      if (message.text.length > budget) break;
      budget -= message.text.length;
      kept.unshift(message);
    }
    const messages = this.first === null ? kept : [this.first, ...kept];
    return { messages, omitted: this.total - messages.length };
  }
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SearchQuery {
  readonly patterns: ReadonlyArray<RegExp>;
}

export function compileQuery(query: string): SearchQuery | null {
  const words = foldText(query)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;
  return {
    patterns: words.map((word) => new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")),
  };
}

export type SearchMatch =
  | { readonly kind: "title" }
  | { readonly kind: "content"; readonly snippet: string };

const SNIPPET_BEFORE = 50;
const SNIPPET_AFTER = 110;

/** Every word must appear somewhere; a session whose title and folder hold them all ranks first. */
export function matchSession(
  query: SearchQuery,
  fields: { readonly title: string; readonly cwd: string | null; readonly sessionId: string },
  digest: SessionDigest,
): SearchMatch | null {
  const label = foldText(`${fields.title}\n${fields.cwd ?? ""}\n${fields.sessionId}`);
  const bodies = [
    digest.userText.head,
    digest.userText.tail,
    digest.assistantText.head,
    digest.assistantText.tail,
  ];
  let titleOnly = true;
  for (const pattern of query.patterns) {
    if (pattern.test(label)) continue;
    titleOnly = false;
    if (!bodies.some((body) => pattern.test(body))) return null;
  }
  if (titleOnly) return { kind: "title" };
  for (const body of bodies) {
    for (const pattern of query.patterns) {
      const found = pattern.exec(body);
      if (found === null) continue;
      const from = Math.max(0, found.index - SNIPPET_BEFORE);
      const to = Math.min(body.length, found.index + found[0].length + SNIPPET_AFTER);
      return {
        kind: "content",
        snippet: `${from > 0 ? "…" : ""}${body.slice(from, to).trim()}${to < body.length ? "…" : ""}`,
      };
    }
  }
  return { kind: "content", snippet: "" };
}
