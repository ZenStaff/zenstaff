import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId, ProviderThreadId } from "@t3tools/contracts";

import {
  buildImportEvents,
  importedThreadId,
  type CliSessionImportInput,
} from "./CliSessionImport.ts";

const session = (omitted: number): CliSessionImportInput => ({
  provider: "claudeAgent",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  sessionId: "0b6f5f3c-8a1e-4c55-9c7e-2f1b8f3f9a10",
  ownerThreadId: null,
  cwd: "/work/horeca",
  title: "Inventar lunar",
  model: null,
  startedAt: "not a date",
  lastActivityMs: Date.UTC(2026, 10, 1),
  entries: [
    {
      kind: "message",
      role: "user",
      text: "Generează inventarul",
      timestamp: "2026-11-01T09:00:00.000Z",
      model: null,
    },
    {
      kind: "message",
      role: "assistant",
      text: "Gata.",
      timestamp: null,
      model: "claude-opus-4-1",
    },
  ],
  omittedMessageCount: omitted,
  transcript: {
    filePath: "/x.jsonl",
    size: 10,
    mtimeMs: 1,
    inode: null,
    device: 1,
    birthtimeMs: null,
  },
});

describe("buildImportEvents", () => {
  it("creates a thread whose provider thread resumes the session id", () => {
    const threadId = importedThreadId("claudeAgent", session(0).sessionId);
    expect(threadId).toBe("import:claudeAgent:0b6f5f3c-8a1e-4c55-9c7e-2f1b8f3f9a10");
    const { events, providerThread } = buildImportEvents({
      threadId,
      projectId: ProjectId.make("project-1"),
      runtimeMode: "full-access",
      providerThreadId: ProviderThreadId.make("pt-1"),
      session: session(0),
    });
    expect(providerThread.nativeThreadRef).toEqual({
      driver: "claudeAgent",
      nativeId: "0b6f5f3c-8a1e-4c55-9c7e-2f1b8f3f9a10",
      strength: "strong",
    });
    expect(events.map((event) => event.type)).toEqual([
      "thread.created",
      "message.updated",
      "turn-item.updated",
      "message.updated",
      "turn-item.updated",
      "provider-thread.updated",
    ]);
    const created = events[0];
    expect(created?.type === "thread.created" ? created.payload : null).toMatchObject({
      projectId: "project-1",
      title: "Inventar lunar",
      historyOrigin: "v1_import",
      activeProviderThreadId: "pt-1",
    });
  });

  it("adds a notice when earlier messages were left out", () => {
    const { events } = buildImportEvents({
      threadId: importedThreadId("claudeAgent", "s"),
      projectId: ProjectId.make("project-1"),
      runtimeMode: "full-access",
      providerThreadId: ProviderThreadId.make("pt-1"),
      session: session(12),
    });
    const notice = events[1];
    expect(notice?.type === "turn-item.updated" ? notice.payload : null).toMatchObject({
      type: "system_notice",
      ordinal: 0,
    });
  });
});
