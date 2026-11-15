import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProjectId,
  ProviderThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";

import { buildImportEvents, importedThreadId } from "./CliSessionImport.ts";
import { FullHistory, HISTORY_ENTRY_LIMIT, TOOL_TEXT_LIMIT } from "./historyParser.ts";

const meta = { sessionId: "s1", cwd: "/work/horeca", entrypoint: "cli", isSidechain: false };
const line = (value: unknown) => JSON.stringify(value);

// Shapes as Claude Code writes them: one line per content block, tool results on user entries.
const claudeLines = [
  line({
    type: "user",
    message: { role: "user", content: "Actualizează prețurile în meniu.csv" },
    timestamp: "2026-11-01T09:00:00.000Z",
    ...meta,
  }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "thinking", thinking: "plan" }],
    },
    ...meta,
  }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text: "Mă uit întâi în fișier." }],
    },
    ...meta,
  }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "head meniu.csv" } }],
    },
    ...meta,
  }),
  line({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: [{ type: "text", text: "produs,pret\nciorbă,18" }],
        },
      ],
    },
    ...meta,
  }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t2",
          name: "Edit",
          input: { file_path: "/work/horeca/meniu.csv", old_string: "18", new_string: "19" },
        },
      ],
    },
    ...meta,
  }),
  line({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }] },
    ...meta,
  }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t3", name: "Grep", input: { pattern: "pret" } }],
    },
    ...meta,
  }),
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t4",
          name: "mcp__zen-memory__memory_search",
          input: { query: "furnizor" },
        },
      ],
    },
    ...meta,
  }),
  line({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t4", content: "nimic", is_error: true }],
    },
    ...meta,
  }),
  // Not conversation: slash command echo, meta entry, a subagent's line, a summary record.
  line({
    type: "user",
    message: { role: "user", content: "<command-name>/clear</command-name>" },
    ...meta,
  }),
  line({ type: "user", isMeta: true, message: { role: "user", content: "Caveat" }, ...meta }),
  line({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "subagent" }] },
    ...meta,
    isSidechain: true,
  }),
  line({ type: "summary", summary: "Prețuri" }),
  line({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Gata, ciorba costă 19 lei." }] },
    ...meta,
  }),
  '{"type":"user","message":{"role":"user","content":"jumătate de li',
];

const codexLines = [
  line({
    timestamp: "2026-11-01T09:00:00.000Z",
    type: "session_meta",
    payload: { id: "c1", cwd: "/work", originator: "codex_cli_rs" },
  }),
  line({
    timestamp: "2026-11-01T09:00:01.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "<environment_context>x</environment_context>\nRulează testele",
    },
  }),
  line({
    timestamp: "2026-11-01T09:00:02.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "shell",
      arguments: JSON.stringify({ command: ["bash", "-lc", "npm test"] }),
      call_id: "call_1",
    },
  }),
  line({
    timestamp: "2026-11-01T09:00:03.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call_1",
      output: JSON.stringify({ output: "1 failed", metadata: { exit_code: 1 } }),
    },
  }),
  line({
    timestamp: "2026-11-01T09:00:04.000Z",
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "apply_patch",
      input: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** End Patch",
      call_id: "call_2",
    },
  }),
  line({
    timestamp: "2026-11-01T09:00:05.000Z",
    type: "response_item",
    payload: { type: "web_search_call", action: { type: "search", query: "vitest flaky" } },
  }),
  line({
    timestamp: "2026-11-01T09:00:06.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "Am reparat testul." },
  }),
  // Response items that duplicate the event messages are not counted twice.
  line({
    timestamp: "2026-11-01T09:00:06.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Am reparat testul." }],
    },
  }),
];

const turnItems = (events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
  events.flatMap((event) => (event.type === "turn-item.updated" ? [event.payload] : []));

describe("FullHistory", () => {
  it("keeps Claude messages and tool calls in order with their results", () => {
    const history = new FullHistory("claudeAgent");
    for (const value of claudeLines) history.consume(value, false);
    history.consume("x".repeat(10), true);
    const { entries, omitted } = history.result();
    expect(omitted).toBe(0);
    expect(history.skippedLines).toBe(1);
    expect(
      entries.map((entry) => (entry.kind === "message" ? `${entry.role}` : entry.name)),
    ).toEqual([
      "user",
      "assistant",
      "Bash",
      "Edit",
      "Grep",
      "mcp__zen-memory__memory_search",
      "assistant",
    ]);
    expect(entries[2]).toMatchObject({ output: "produs,pret\nciorbă,18", isError: false });
    expect(entries[5]).toMatchObject({ output: "nimic", isError: true });
    expect(entries[1]).toMatchObject({
      text: "Mă uit întâi în fișier.",
      model: "claude-haiku-5-5",
    });
  });

  it("reads Codex rollouts: prompt without the preamble, shell and patch calls, searches", () => {
    const history = new FullHistory("codex");
    for (const value of codexLines) history.consume(value, false);
    const { entries } = history.result();
    expect(entries.map((entry) => (entry.kind === "message" ? entry.text : entry.name))).toEqual([
      "Rulează testele",
      "shell",
      "apply_patch",
      "web_search",
      "Am reparat testul.",
    ]);
    expect(entries[1]).toMatchObject({ output: "1 failed", isError: true });
  });

  it("cuts long tool output and keeps the newest entries past the limit", () => {
    const history = new FullHistory("claudeAgent");
    history.consume(claudeLines[3]!, false);
    history.consume(
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "y".repeat(TOOL_TEXT_LIMIT * 2) },
          ],
        },
        ...meta,
      }),
      false,
    );
    const tool = history.result().entries[0];
    expect(tool?.kind === "tool" ? tool.output?.length : 0).toBe(TOOL_TEXT_LIMIT + 1);
    for (let index = 0; index < 5; index += 1) history.consume(claudeLines[0]!, false);
    expect(history.result(3)).toMatchObject({ omitted: 3 });
    expect(HISTORY_ENTRY_LIMIT).toBeGreaterThan(1000);
  });
});

describe("buildImportEvents with tool calls", () => {
  it("writes tool calls as the turn items Office folds", () => {
    const claude = new FullHistory("claudeAgent");
    for (const value of claudeLines) claude.consume(value, false);
    const codex = new FullHistory("codex");
    for (const value of codexLines) codex.consume(value, false);
    const build = (provider: "claudeAgent" | "codex", history: FullHistory) =>
      buildImportEvents({
        threadId: importedThreadId(provider, "s1"),
        projectId: ProjectId.make("p1"),
        runtimeMode: "auto-accept-edits",
        providerThreadId: ProviderThreadId.make("pt"),
        session: {
          provider,
          providerInstanceId: ProviderInstanceId.make(provider),
          sessionId: "s1",
          ownerThreadId: null,
          cwd: "/work/horeca",
          title: "Prețuri",
          model: null,
          startedAt: null,
          lastActivityMs: Date.UTC(2026, 10, 1),
          entries: history.result().entries,
          omittedMessageCount: 0,
          transcript: {
            filePath: "/x",
            size: 1,
            mtimeMs: 1,
            inode: null,
            device: 1,
            birthtimeMs: null,
          },
        },
      }).events;
    const claudeItems = turnItems(build("claudeAgent", claude));
    expect(claudeItems.map((item) => item.type)).toEqual([
      "user_message",
      "assistant_message",
      "command_execution",
      "file_change",
      "file_search",
      "dynamic_tool",
      "assistant_message",
    ]);
    expect(claudeItems[2]).toMatchObject({
      input: "head meniu.csv",
      output: "produs,pret\nciorbă,18",
    });
    expect(claudeItems[3]).toMatchObject({
      fileName: "/work/horeca/meniu.csv",
      oldStr: "18",
      newStr: "19",
    });
    expect(claudeItems.every((item) => item.runId === null && item.status === "completed")).toBe(
      true,
    );
    expect(claudeItems.map((item) => item.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const codexItems = turnItems(build("codex", codex));
    expect(codexItems.map((item) => item.type)).toEqual([
      "user_message",
      "command_execution",
      "file_change",
      "web_search",
      "assistant_message",
    ]);
    expect(codexItems[1]).toMatchObject({ input: "npm test", outputIndicatesFailure: true });
    expect(codexItems[2]).toMatchObject({ fileName: "src/a.ts" });
  });
});
