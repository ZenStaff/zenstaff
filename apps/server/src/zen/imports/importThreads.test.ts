import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
import { zenImportSourceOfThread } from "@t3tools/contracts/zenImports";
import * as DateTime from "effect/DateTime";

import {
  CONTINUATION_TAIL,
  buildContinuationEvents,
  buildImportedThreadEvents,
  continuationTranscript,
  importThreadId,
} from "./importThreads.ts";

const now = DateTime.makeUnsafe(Date.UTC(2026, 10, 8, 12));
const modelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-haiku-5-5",
};
const items = (events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
  events.flatMap((event) => (event.type === "turn-item.updated" ? [event.payload] : []));

describe("importThreadId", () => {
  it("is stable per source and conversation, and names its source", () => {
    const id = importThreadId("chatgpt", "abc-123");
    expect(id).toBe(importThreadId("chatgpt", "abc-123"));
    expect(id).not.toBe(importThreadId("claude", "abc-123"));
    expect(zenImportSourceOfThread(id)).toBe("chatgpt");
    expect(zenImportSourceOfThread("import:claudeAgent:x")).toBeNull();
  });
});

describe("buildImportedThreadEvents", () => {
  it("writes a settled, run-less v1-import thread with a notice, messages and folded tool rows", () => {
    const events = buildImportedThreadEvents({
      threadId: importThreadId("chatgpt", "c1"),
      projectId: ProjectId.make("p1"),
      source: "chatgpt",
      modelSelection,
      runtimeMode: "auto-accept-edits",
      now,
      conversation: {
        externalId: "c1",
        title: "  Plan de marketing  ",
        createdAt: "2024-03-01T10:00:00.000Z",
        updatedAt: null,
        model: "gpt-4o",
        messages: [
          { role: "user", text: "Fă-mi un plan", createdAt: "2024-03-01T10:00:00.000Z" },
          { role: "tool", text: "print(1)\n1", createdAt: null, toolName: "python" },
          { role: "assistant", text: "", createdAt: null },
          { role: "assistant", text: "Iată planul.", createdAt: "not a date" },
        ],
      },
    });
    const created = events[0];
    expect(created?.type === "thread.created" ? created.payload : null).toMatchObject({
      title: "Plan de marketing",
      historyOrigin: "v1_import",
      activeProviderThreadId: null,
      archivedAt: null,
      settledOverride: "settled",
    });
    expect(items(events).map((item) => item.type)).toEqual([
      "system_notice",
      "user_message",
      "dynamic_tool",
      "assistant_message",
    ]);
    expect(items(events)[2]).toMatchObject({ toolName: "python", output: "print(1)\n1" });
  });
});

describe("buildContinuationEvents", () => {
  it("starts an open thread with the summary and the latest messages word for word", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `mesaj ${index}`,
      createdAt: null,
    }));
    const events = buildContinuationEvents({
      threadId: importThreadId("claude", "new"),
      projectId: ProjectId.make("p1"),
      source: "claude",
      title: "Oferta hotel",
      summary: "Clientul vrea 3 variante.",
      messages,
      modelSelection,
      runtimeMode: "auto-accept-edits",
      now,
    });
    const created = events[0];
    expect(created?.type === "thread.created" ? created.payload.archivedAt : "x").toBeNull();
    const rows = items(events);
    expect(rows.map((item) => item.type)).toEqual([
      "system_notice",
      "assistant_message",
      ...Array.from({ length: CONTINUATION_TAIL }, (_, index) =>
        index % 2 === 0 ? "user_message" : "assistant_message",
      ),
    ]);
    const summary = rows[1];
    expect(summary?.type === "assistant_message" ? summary.text : "").toContain(
      "(4 earlier messages summarized)",
    );
    expect(rows.at(-1)).toMatchObject({ text: "mesaj 9" });
  });

  it("keeps the start and the end of a long transcript", () => {
    const long = continuationTranscript(
      Array.from({ length: 200 }, (_, index) => ({
        role: "user" as const,
        text: `${index} ${"x".repeat(600)}`,
        createdAt: null,
      })),
    );
    expect(long).toContain("User: 0 ");
    expect(long).toContain("User: 199 ");
    expect(long).toContain("middle of the conversation left out");
    expect(long.length).toBeLessThan(62_000);
  });
});
