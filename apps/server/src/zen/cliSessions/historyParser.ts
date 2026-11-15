// Zen Staff Terminal sessions: a Claude Code or Codex transcript's whole conversation, tool calls
// included, read once more when a session is imported (the index keeps only text for search).
// Unknown entries are skipped, never fatal.
import type { ZenCliSessionProvider } from "@t3tools/contracts/zenCliSessions";

import { CODEX_PREAMBLE, isPromptText } from "./transcriptParser.ts";

/** Long tool inputs and outputs are cut: the timeline shows them folded, the agent keeps all. */
export const TOOL_TEXT_LIMIT = 8_000;
const MESSAGE_TEXT_LIMIT = 200_000;
/** Beyond this many entries the oldest are left out (with a notice in the thread). */
export const HISTORY_ENTRY_LIMIT = 20_000;

export type HistoryEntry =
  | {
      readonly kind: "message";
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly timestamp: string | null;
      readonly model: string | null;
    }
  | {
      readonly kind: "tool";
      readonly callId: string | null;
      readonly name: string;
      readonly input: unknown;
      output: string | null;
      isError: boolean;
      readonly timestamp: string | null;
    };

type ToolEntry = Extract<HistoryEntry, { kind: "tool" }>;

function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function parse(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Tool results are a string or a list of blocks (text, images). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    const single = record(content);
    if (single !== null && typeof single.text === "string") return single.text;
    return content === undefined || content === null ? "" : JSON.stringify(content);
  }
  return content
    .map((block) => {
      const entry = record(block);
      if (entry === null) return "";
      if (typeof entry.text === "string") return entry.text;
      if (entry.type === "image") return "[image]";
      return "";
    })
    .filter((part) => part.length > 0)
    .join("\n");
}

function cutInput(input: unknown): unknown {
  if (typeof input === "string") return cut(input, TOOL_TEXT_LIMIT);
  const serialized = JSON.stringify(input ?? null);
  if (serialized.length <= TOOL_TEXT_LIMIT) return input ?? null;
  const fields = record(input);
  if (fields === null) return cut(serialized, TOOL_TEXT_LIMIT);
  // Keep the shape (file_path, command...) and cut only the long string fields.
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === "string" ? cut(value, TOOL_TEXT_LIMIT / 2) : value,
    ]),
  );
}

export class FullHistory {
  readonly entries: Array<HistoryEntry> = [];
  /** Lines too big to decode (usually a huge tool result); counted for the notice. */
  skippedLines = 0;
  private readonly pending = new Map<string, ToolEntry>();

  private readonly provider: ZenCliSessionProvider;
  constructor(provider: ZenCliSessionProvider) {
    this.provider = provider;
  }

  consume(line: string, oversized: boolean): void {
    if (line.length === 0) return;
    if (oversized) {
      this.skippedLines += 1;
      return;
    }
    if (this.provider === "claudeAgent") this.consumeClaude(line);
    else this.consumeCodex(line);
  }

  /** Entries in order; with more than `limit`, the newest `limit` and how many were left out. */
  result(limit = HISTORY_ENTRY_LIMIT): {
    readonly entries: ReadonlyArray<HistoryEntry>;
    readonly omitted: number;
  } {
    const omitted = Math.max(0, this.entries.length - limit);
    return { entries: omitted > 0 ? this.entries.slice(omitted) : this.entries, omitted };
  }

  private pushMessage(
    role: "user" | "assistant",
    text: string,
    timestamp: string | null,
    model: string | null,
  ): void {
    if (text.trim().length === 0) return;
    const last = this.entries.at(-1);
    // Claude Code writes one line per content block; consecutive text of one answer is one message.
    if (last?.kind === "message" && last.role === role && role === "assistant") {
      this.entries[this.entries.length - 1] = {
        ...last,
        text: cut(`${last.text}\n\n${text}`, MESSAGE_TEXT_LIMIT),
      };
      return;
    }
    this.entries.push({
      kind: "message",
      role,
      text: cut(text, MESSAGE_TEXT_LIMIT),
      timestamp,
      model,
    });
  }

  private pushTool(entry: Omit<ToolEntry, "output" | "isError">): void {
    const tool: ToolEntry = {
      ...entry,
      input: cutInput(entry.input),
      output: null,
      isError: false,
    };
    this.entries.push(tool);
    if (tool.callId !== null) this.pending.set(tool.callId, tool);
  }

  private settleTool(callId: string | null, output: string, isError: boolean): void {
    if (callId === null) return;
    const tool = this.pending.get(callId);
    if (tool === undefined) return;
    tool.output = cut(output, TOOL_TEXT_LIMIT);
    tool.isError = isError;
    this.pending.delete(callId);
  }

  // ─── Claude Code ──────────────────────────────────────────────────────────

  private consumeClaude(line: string): void {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return;
    const entry = parse(line);
    if (entry === null || entry.isSidechain === true) return;
    if (entry.type !== "user" && entry.type !== "assistant") return;
    const message = record(entry.message);
    if (message === null) return;
    const timestamp = str(entry.timestamp);
    const content = message.content;
    if (entry.type === "user") {
      if (entry.isMeta === true || entry.isCompactSummary === true) return;
      if (typeof content === "string") {
        if (isPromptText(content)) this.pushMessage("user", content, timestamp, null);
        return;
      }
      if (!Array.isArray(content)) return;
      const texts: Array<string> = [];
      for (const block of content) {
        const part = record(block);
        if (part === null) continue;
        if (part.type === "tool_result") {
          this.settleTool(str(part.tool_use_id), resultText(part.content), part.is_error === true);
        } else if (part.type === "text" && typeof part.text === "string") {
          texts.push(part.text);
        } else if (part.type === "image") {
          texts.push("[image]");
        }
      }
      const text = texts.join("\n");
      if (texts.length > 0 && isPromptText(text)) this.pushMessage("user", text, timestamp, null);
      return;
    }
    const rawModel = str(message.model);
    const model = rawModel === null || rawModel === "<synthetic>" ? null : rawModel;
    if (typeof content === "string") {
      this.pushMessage("assistant", content, timestamp, model);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      const part = record(block);
      if (part === null) continue;
      if (part.type === "text" && typeof part.text === "string") {
        this.pushMessage("assistant", part.text, timestamp, model);
      } else if (part.type === "tool_use" && typeof part.name === "string") {
        this.pushTool({
          kind: "tool",
          callId: str(part.id),
          name: part.name,
          input: part.input,
          timestamp,
        });
      }
    }
  }

  // ─── Codex ────────────────────────────────────────────────────────────────

  private consumeCodex(line: string): void {
    const entry = parse(line);
    if (entry === null) return;
    const timestamp = str(entry.timestamp);
    const payload = record(entry.payload);
    if (payload === null) return;
    if (entry.type === "event_msg") {
      const text = str(payload.message);
      if (text === null) return;
      if (payload.type === "user_message") {
        const prompt = text.replace(CODEX_PREAMBLE, "").trim();
        if (isPromptText(prompt)) this.pushMessage("user", prompt, timestamp, null);
      } else if (payload.type === "agent_message") {
        this.pushMessage("assistant", text, timestamp, null);
      }
      return;
    }
    if (entry.type !== "response_item") return;
    const callId = str(payload.call_id) ?? str(payload.id);
    switch (payload.type) {
      case "function_call": {
        const raw = str(payload.arguments);
        let input: unknown = raw;
        if (raw !== null) {
          try {
            input = JSON.parse(raw);
          } catch {
            input = raw;
          }
        }
        this.pushTool({
          kind: "tool",
          callId,
          name: str(payload.name) ?? "tool",
          input,
          timestamp,
        });
        return;
      }
      case "custom_tool_call":
        this.pushTool({
          kind: "tool",
          callId,
          name: str(payload.name) ?? "tool",
          input: payload.input,
          timestamp,
        });
        return;
      case "local_shell_call": {
        const action = record(payload.action);
        this.pushTool({
          kind: "tool",
          callId,
          name: "shell",
          input: { command: action?.command ?? null },
          timestamp,
        });
        return;
      }
      case "web_search_call": {
        const action = record(payload.action);
        this.pushTool({
          kind: "tool",
          callId: null,
          name: "web_search",
          input: { query: str(action?.query) ?? "" },
          timestamp,
        });
        return;
      }
      case "function_call_output":
      case "custom_tool_call_output":
      case "local_shell_call_output": {
        const output = payload.output;
        const fields = record(output);
        const text = typeof output === "string" ? output : resultText(fields?.content ?? output);
        // Codex wraps shell results as JSON {output, metadata: {exit_code}}.
        let shown = text;
        let failed = fields?.success === false;
        try {
          const wrapped = record(JSON.parse(text));
          if (wrapped !== null && typeof wrapped.output === "string") {
            shown = wrapped.output;
            const exit = record(wrapped.metadata)?.exit_code;
            failed = typeof exit === "number" && exit !== 0;
          }
        } catch {
          // Plain text output.
        }
        this.settleTool(callId, shown, failed);
        return;
      }
      default:
        return;
    }
  }
}

/** The shell command of a Bash / shell / exec_command call, if the tool is one. */
export function commandOf(name: string, input: unknown): string | null {
  const fields = record(input);
  const lowered = name.toLowerCase();
  if (
    lowered === "bash" ||
    lowered === "shell" ||
    lowered === "exec_command" ||
    lowered === "local_shell"
  ) {
    const command = fields?.command ?? fields?.cmd ?? input;
    if (typeof command === "string") return command;
    if (Array.isArray(command)) {
      const parts = command.filter((part): part is string => typeof part === "string");
      // ["bash", "-lc", "<script>"] reads better as the script.
      if (parts.length === 3 && /^(ba|z)?sh$/.test(parts[0]!) && parts[1] === "-lc")
        return parts[2]!;
      return parts.join(" ");
    }
  }
  return null;
}

export interface FileEdit {
  readonly fileName: string;
  readonly oldStr?: string;
  readonly newStr?: string;
  readonly diffStr?: string;
}

/** Claude's Edit/MultiEdit/Write/NotebookEdit and Codex's apply_patch, as file changes. */
export function fileEditOf(name: string, input: unknown): FileEdit | null {
  const fields = record(input);
  if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") {
    const fileName = str(fields?.file_path) ?? str(fields?.notebook_path);
    if (fileName === null || fileName.trim() === "") return null;
    if (name === "Write") return { fileName, newStr: str(fields?.content) ?? "" };
    if (name === "MultiEdit" && Array.isArray(fields?.edits)) {
      const edits = fields.edits.map(record).filter((edit) => edit !== null);
      return {
        fileName,
        oldStr: edits.map((edit) => str(edit.old_string) ?? "").join("\n"),
        newStr: edits.map((edit) => str(edit.new_string) ?? "").join("\n"),
      };
    }
    return {
      fileName,
      oldStr: str(fields?.old_string) ?? "",
      newStr: str(fields?.new_string) ?? str(fields?.new_source) ?? "",
    };
  }
  if (name === "apply_patch") {
    const patch = typeof input === "string" ? input : (str(fields?.input) ?? str(fields?.patch));
    if (patch === null) return null;
    const file = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(patch)?.[1]?.trim();
    return file === undefined || file === "" ? null : { fileName: file, diffStr: patch };
  }
  return null;
}

/** Search tools (Grep, Glob) and web searches, with what was searched for. */
export function searchOf(
  name: string,
  input: unknown,
): { readonly kind: "file" | "web"; readonly pattern: string } | null {
  const fields = record(input);
  if (name === "Grep" || name === "Glob") {
    return { kind: "file", pattern: str(fields?.pattern) ?? "" };
  }
  if (name === "WebSearch" || name === "web_search") {
    return { kind: "web", pattern: str(fields?.query) ?? "" };
  }
  return null;
}
