import { describe, expect, it } from "vite-plus/test";

import {
  LineSplitter,
  MAX_LINE_BYTES,
  RecentMessages,
  cloneDigest,
  compileQuery,
  consumeLine,
  emptyDigest,
  matchSession,
  resolveOrigin,
  resolveTitle,
  type SessionDigest,
} from "./transcriptParser.ts";

const encoder = new TextEncoder();
const CWD = "/home/alex/proiecte/horeca";
const SESSION = "0b6f5f3c-8a1e-4c55-9c7e-2f1b8f3f9a10";

const meta = (timestamp: string) => ({
  userType: "external",
  entrypoint: "cli",
  cwd: CWD,
  sessionId: SESSION,
  version: "2.1.3",
  gitBranch: "feat/facturi",
  timestamp,
});

// Field order follows real Claude Code transcripts: prefixed records start with `type`,
// conversation records carry their session fields after `message`.
const claudeTranscript = (toolOutput: string) =>
  [
    {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-11-01T09:00:00.000Z",
      sessionId: SESSION,
    },
    {
      parentUuid: null,
      isSidechain: false,
      promptId: "p1",
      type: "user",
      message: { role: "user", content: "Cum generez ședința de inventar pentru depozit?" },
      uuid: "u1",
      ...meta("2026-11-01T09:00:01.000Z"),
    },
    {
      parentUuid: "u1",
      isSidechain: false,
      message: {
        model: "claude-opus-4-1",
        id: "m1",
        type: "message",
        role: "assistant",
        content: [{ type: "thinking", thinking: "secret chain of thought about ledgers" }],
      },
      type: "assistant",
      uuid: "a1",
      ...meta("2026-11-01T09:00:02.000Z"),
    },
    {
      parentUuid: "a1",
      isSidechain: false,
      message: {
        model: "claude-opus-4-1",
        id: "m1",
        type: "message",
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
      },
      type: "assistant",
      uuid: "a2",
      ...meta("2026-11-01T09:00:03.000Z"),
    },
    {
      parentUuid: "a2",
      isSidechain: false,
      promptId: "p1",
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: toolOutput }] },
        ],
      },
      uuid: "u2",
      ...meta("2026-11-01T09:00:04.000Z"),
    },
    {
      parentUuid: "u2",
      isSidechain: false,
      message: {
        model: "claude-opus-4-1",
        id: "m2",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Folosește modulul de inventar și exportă PDF-ul." }],
      },
      type: "assistant",
      uuid: "a3",
      ...meta("2026-11-01T09:00:05.000Z"),
    },
    { type: "ai-title", aiTitle: "Inventar depozit", sessionId: SESSION },
    {
      parentUuid: "a3",
      isSidechain: true,
      promptId: "p2",
      type: "user",
      message: { role: "user", content: "subagent prompt that is not the conversation" },
      uuid: "s1",
      ...meta("2026-11-01T09:00:06.000Z"),
    },
    {
      parentUuid: "a3",
      isSidechain: false,
      type: "system",
      subtype: "compact_boundary",
      uuid: "c0",
      ...meta("2026-11-01T09:10:00.000Z"),
    },
    {
      parentUuid: "c0",
      isSidechain: false,
      promptId: "p3",
      type: "user",
      isCompactSummary: true,
      message: {
        role: "user",
        content: "This session is being continued from a previous conversation.",
      },
      uuid: "c1",
      ...meta("2026-11-01T09:10:01.000Z"),
    },
    {
      parentUuid: "c1",
      isSidechain: false,
      promptId: "p4",
      type: "user",
      isMeta: true,
      message: { role: "user", content: "<command-name>/model</command-name>" },
      uuid: "c2",
      ...meta("2026-11-01T09:10:02.000Z"),
    },
    {
      parentUuid: "c2",
      isSidechain: false,
      promptId: "p5",
      type: "user",
      message: {
        role: "user",
        content: "<local-command-stdout>Set model to opus</local-command-stdout>",
      },
      uuid: "c3",
      ...meta("2026-11-01T09:10:03.000Z"),
    },
    {
      parentUuid: "c3",
      isSidechain: false,
      promptId: "p6",
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Acum adaugă și facturile restante" }],
      },
      uuid: "u3",
      ...meta("2026-11-01T09:11:00.000Z"),
    },
    { type: "ai-title", aiTitle: "Inventar și facturi restante", sessionId: SESSION },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n") + "\n";

function digestOf(
  contents: string,
  chunkSize = 64 * 1024,
  provider: SessionDigest["provider"] = "claudeAgent",
) {
  const digest = emptyDigest(provider);
  const splitter = new LineSplitter((line, oversized) => consumeLine(digest, line, oversized));
  const bytes = encoder.encode(contents);
  for (let start = 0; start < bytes.byteLength; start += chunkSize) {
    splitter.push(bytes.subarray(start, start + chunkSize));
  }
  return { digest, completedBytes: splitter.completedBytes };
}

const searchable = (digest: SessionDigest) =>
  [
    digest.userText.head,
    digest.userText.tail,
    digest.assistantText.head,
    digest.assistantText.tail,
  ].join("\n");

describe("Claude transcripts", () => {
  it("reads metadata, prompts and answers but no tool traffic, thinking, sidechains or meta entries", () => {
    const { digest } = digestOf(claudeTranscript("tool output with a SECRET_TOKEN=abc"));
    expect(digest).toMatchObject({
      sessionId: SESSION,
      cwd: CWD,
      gitBranch: "feat/facturi",
      client: "cli",
      aiTitle: "Inventar și facturi restante",
      model: "claude-opus-4-1",
      startedAt: "2026-11-01T09:00:01.000Z",
      userMessages: 2,
      assistantMessages: 1,
    });
    expect(digest.firstPrompt).toBe("Cum generez ședința de inventar pentru depozit?");
    const text = searchable(digest);
    expect(text).toContain("Cum generez sedinta de inventar");
    expect(text).toContain("Foloseste modulul de inventar");
    expect(text).toContain("facturile restante");
    expect(text).not.toContain("SECRET_TOKEN");
    expect(text).not.toContain("chain of thought");
    expect(text).not.toContain("subagent prompt");
    expect(text).not.toContain("being continued");
    expect(text).not.toContain("Set model");
    expect(resolveTitle(digest)).toBe("Inventar și facturi restante");
  });

  it("prefers a rename, then the AI title, then the first prompt", () => {
    const base = claudeTranscript("ok");
    const renamed = `${base}${JSON.stringify({ type: "custom-title", customTitle: "Inventar Q4", sessionId: SESSION })}\n`;
    expect(resolveTitle(digestOf(renamed).digest)).toBe("Inventar Q4");
    const cleared = `${renamed}${JSON.stringify({ type: "custom-title", customTitle: "", sessionId: SESSION })}\n`;
    expect(resolveTitle(digestOf(cleared).digest)).toBe("Inventar și facturi restante");
    const untitled = base
      .split("\n")
      .filter((line) => !line.includes('"ai-title"'))
      .join("\n");
    expect(resolveTitle(digestOf(untitled).digest)).toBe(
      "Cum generez ședința de inventar pentru depozit?",
    );
  });

  it("skips huge lines without decoding them and still reads the fields at their end", () => {
    const huge = "x".repeat(MAX_LINE_BYTES * 3);
    const { digest } = digestOf(claudeTranscript(huge), 100_000);
    expect(digest.userMessages).toBe(2);
    expect(digest.assistantMessages).toBe(1);
    expect(searchable(digest)).not.toContain("xxxx");

    const onlyHuge = emptyDigest("claudeAgent");
    const lines: Array<{ line: string; oversized: boolean }> = [];
    const splitter = new LineSplitter((line, oversized) => {
      lines.push({ line: line.slice(0, 20), oversized });
      consumeLine(onlyHuge, line, oversized);
    });
    const hugeLine = JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: huge },
      ...meta("2026-11-02T10:00:00.000Z"),
    });
    splitter.push(encoder.encode(`${hugeLine}\n`));
    expect(lines).toEqual([{ line: hugeLine.slice(0, 20), oversized: true }]);
    expect(onlyHuge.cwd).toBe(CWD);
    expect(onlyHuge.gitBranch).toBe("feat/facturi");
  });

  it("splits lines across chunk boundaries and leaves a half-written last line for later", () => {
    const contents = claudeTranscript("ok");
    const whole = digestOf(contents).digest;
    const byteByByte = digestOf(contents, 7).digest;
    expect(byteByByte).toEqual(whole);

    const partial = `${contents}{"parentUuid":"x","isSidechain":false,"type":"user","message":{"role":"user","content":"half`;
    const { digest, completedBytes } = digestOf(partial, 1000);
    expect(completedBytes).toBe(encoder.encode(contents).byteLength);
    expect(digest.userMessages).toBe(2);
  });

  it("continues an appended transcript from the last line boundary", () => {
    const contents = claudeTranscript("ok");
    const lines = contents.split("\n");
    const firstHalf = `${lines.slice(0, 6).join("\n")}\n`;
    const { digest: start, completedBytes } = digestOf(firstHalf);
    const resumed = cloneDigest(start);
    const splitter = new LineSplitter((line, oversized) => consumeLine(resumed, line, oversized));
    splitter.push(encoder.encode(contents).subarray(completedBytes));
    expect(resumed).toEqual(digestOf(contents).digest);
    expect(start.userMessages).toBe(1);
  });

  it("keeps the start and the latest part of a long conversation searchable", () => {
    const prompts = Array.from({ length: 400 }, (_, index) =>
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: {
          role: "user",
          content: `pas ${index} ${index === 0 ? "inceputul" : ""} ${index === 399 ? "sfarsitul" : ""} ${"lorem ipsum ".repeat(40)}`,
        },
        ...meta("2026-11-01T09:00:00.000Z"),
      }),
    );
    const { digest } = digestOf(`${prompts.join("\n")}\n`);
    expect(digest.userMessages).toBe(400);
    expect(digest.userText.head).toContain("inceputul");
    expect(digest.userText.tail).toContain("sfarsitul");
    expect(digest.userText.head.length + digest.userText.tail.length).toBeLessThanOrEqual(
      48 * 1024,
    );
  });
});

describe("Codex rollouts", () => {
  const rollout = (source?: unknown) =>
    [
      {
        timestamp: "2026-11-03T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "019a1b2c-3d4e-7f00-8000-000000000001",
          timestamp: "2026-11-03T08:00:00.000Z",
          cwd: "/srv/app",
          originator: "codex_cli_rs",
          cli_version: "0.50.0",
          instructions: "long instructions",
          ...(source === undefined ? {} : { source }),
          git: { branch: "main", commit_hash: "abc" },
        },
      },
      {
        timestamp: "2026-11-03T08:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }],
        },
      },
      {
        timestamp: "2026-11-03T08:00:02.000Z",
        type: "turn_context",
        payload: { cwd: "/srv/app", model: "gpt-5-codex" },
      },
      {
        timestamp: "2026-11-03T08:00:03.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Repară migrarea Supabase", kind: "plain" },
      },
      {
        timestamp: "2026-11-03T08:00:04.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "c", output: "private output" },
      },
      {
        timestamp: "2026-11-03T08:00:05.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "Am reparat migrarea." },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n";

  it("reads the session meta and the conversation events only", () => {
    const { digest } = digestOf(rollout(), 64 * 1024, "codex");
    expect(digest).toMatchObject({
      sessionId: "019a1b2c-3d4e-7f00-8000-000000000001",
      cwd: "/srv/app",
      gitBranch: "main",
      client: "codex_cli_rs",
      model: "gpt-5-codex",
      userMessages: 1,
      assistantMessages: 1,
      excluded: false,
    });
    expect(resolveTitle(digest)).toBe("Repară migrarea Supabase");
    expect(searchable(digest)).not.toContain("private output");
    expect(resolveOrigin("codex", digest.client)).toBe("terminal");
  });

  it("marks subagent rollouts", () => {
    expect(digestOf(rollout({ subagent: { parent: "x" } }), 1024, "codex").digest.excluded).toBe(
      true,
    );
  });
});

describe("origin", () => {
  it("maps transcript client names", () => {
    expect(resolveOrigin("claudeAgent", "cli")).toBe("terminal");
    expect(resolveOrigin("claudeAgent", "t3-code")).toBe("app");
    expect(resolveOrigin("claudeAgent", "sdk-cli")).toBe("other");
    expect(resolveOrigin("codex", "Zen Staff")).toBe("app");
  });
});

describe("search", () => {
  const { digest } = digestOf(claudeTranscript("ok"));
  const fields = { title: resolveTitle(digest), cwd: CWD, sessionId: SESSION };

  it("matches titles first, ignoring case and diacritics", () => {
    expect(matchSession(compileQuery("FACTURI")!, fields, digest)).toEqual({ kind: "title" });
    expect(matchSession(compileQuery("horeca inventar")!, fields, digest)).toEqual({
      kind: "title",
    });
    expect(matchSession(compileQuery("0b6f5f3c")!, fields, digest)).toEqual({ kind: "title" });
  });

  it("finds content with a snippet and requires every word", () => {
    const match = matchSession(compileQuery("sedinta depozit")!, fields, digest);
    expect(match?.kind).toBe("content");
    expect(match?.kind === "content" ? match.snippet : "").toContain("sedinta de inventar");
    expect(matchSession(compileQuery("sedinta bucatarie")!, fields, digest)).toBeNull();
    expect(matchSession(compileQuery("SECRET")!, fields, digest)).toBeNull();
  });

  it("treats query text literally", () => {
    expect(matchSession(compileQuery("pdf-ul.")!, fields, digest)?.kind).toBe("content");
    expect(matchSession(compileQuery("(.*)")!, fields, digest)).toBeNull();
    expect(compileQuery("   ")).toBeNull();
  });
});

describe("RecentMessages", () => {
  it("keeps the first prompt and the newest messages within the limit", () => {
    const recent = new RecentMessages("claudeAgent", { limit: 2, maxChars: 10_000 });
    for (const line of claudeTranscript("ok").split("\n")) recent.consume(line, false);
    const { messages, omitted } = recent.messages();
    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "Cum generez ședința de inventar pentru depozit?"],
      ["assistant", "Folosește modulul de inventar și exportă PDF-ul."],
      ["user", "Acum adaugă și facturile restante"],
    ]);
    expect(omitted).toBe(0);
    expect(messages[0]?.timestamp).toBe("2026-11-01T09:00:01.000Z");

    const tight = new RecentMessages("claudeAgent", { limit: 1, maxChars: 10_000 });
    for (const line of claudeTranscript("ok").split("\n")) tight.consume(line, false);
    expect(tight.messages()).toMatchObject({ omitted: 1 });
  });
});
