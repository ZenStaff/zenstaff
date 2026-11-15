// @effect-diagnostics nodeBuiltinImport:off
// "Continue on my side" with attachments: the export shape, the copy limits, storing copied files
// the way upstream stores attachments, and the copied thread's events. Also old trust files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProjectId, ThreadId, type ChatAttachment } from "@t3tools/contracts";
import type { ZenHubExportAttachment, ZenHubThreadSnapshot } from "@t3tools/contracts/zenHub";
import { afterAll, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import {
  readAttachmentForCopy,
  removeCopiedAttachments,
  storeCopiedAttachment,
} from "./copyAttachments.ts";
import { authorizeRelayRequest, emptyHubState, normalizeHubState } from "./hubState.ts";
import {
  buildCopyEvents,
  COPY_FILE_MAX_BYTES,
  COPY_MAX_FILES,
  COPY_TOTAL_MAX_BYTES,
  formatSize,
  planCopyAttachments,
} from "./threadCopy.ts";

const MB = 1024 * 1024;
const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-hub-copy-"));
afterAll(() => NodeFS.rmSync(dir, { recursive: true, force: true }));

const file = (
  id: string,
  sizeBytes: number,
  mimeType = "application/pdf",
  name = `${id}.pdf`,
): ZenHubExportAttachment => ({
  id,
  name,
  mimeType,
  sizeBytes,
  kind: mimeType.startsWith("image/") ? "image" : "file",
});

const message = (
  id: string,
  attachments: ReadonlyArray<ZenHubExportAttachment>,
  text = `text ${id}`,
  createdAt = "2026-11-07T10:00:00.000Z",
) => ({
  id,
  role: "user" as const,
  text,
  createdAt,
  streaming: false,
  attachments,
});

describe("copy limits", () => {
  it("are 5 MB per file, 20 MB and 40 files per copy (the view inlines 3 MB / 8 MB)", () => {
    expect(COPY_FILE_MAX_BYTES).toBe(5 * MB);
    expect(COPY_TOTAL_MAX_BYTES).toBe(20 * MB);
    expect(COPY_MAX_FILES).toBe(40);
  });

  it("fetches files within the limits, newest first, and lists the rest", () => {
    const plan = planCopyAttachments([
      message("m1", [file("old", 4 * MB)]),
      message("m2", [file("huge", 6 * MB), file("a", 4 * MB)]),
      message("m3", [file("b", 4 * MB), file("c", 4 * MB), file("d", 4 * MB)]),
      message("m4", [file("e", 4 * MB)]),
    ]);
    // Newest first: e, b, c, d, a (20 MB); "old" no longer fits; "huge" is over 5 MB.
    expect(plan.fetch.map((entry) => entry.attachment.id).toSorted()).toEqual(
      ["a", "b", "c", "d", "e"].toSorted(),
    );
    expect(plan.listed.map((entry) => entry.attachment.id).toSorted()).toEqual(["huge", "old"]);
    expect(plan.fetch.reduce((total, entry) => total + entry.attachment.sizeBytes, 0)).toBe(
      20 * MB,
    );
  });

  it("caps the number of files and skips streaming messages", () => {
    const many = Array.from({ length: COPY_MAX_FILES + 5 }, (_, index) => file(`f${index}`, 10));
    const plan = planCopyAttachments([
      message("m1", many),
      { ...message("m2", [file("partial", 10)]), streaming: true },
    ]);
    expect(plan.fetch).toHaveLength(COPY_MAX_FILES);
    expect(plan.listed).toHaveLength(5);
    expect(plan.fetch.some((entry) => entry.attachment.id === "partial")).toBe(false);
  });

  it("formats sizes for the listed files", () => {
    expect(formatSize(12.4 * MB)).toBe("12.4 MB");
    expect(formatSize(830 * 1024)).toBe("830 KB");
    expect(formatSize(512)).toBe("512 B");
  });
});

describe("copied attachments on disk", () => {
  it("stores an image and a file the way upstream stores uploads", () => {
    const png = Buffer.from("89504e470d0a1a0a0000", "hex");
    const image = storeCopiedAttachment({
      attachmentsDir: dir,
      threadId: "copy-thread-1",
      source: file("img", png.length, "image/png", "chart.png"),
      bytes: png,
    })!;
    expect(image.type).toBe("image");
    expect(image.id).toMatch(/^copy-thread-1-[0-9a-f-]{36}$/);
    expect(image.name).toBe("chart.png");
    const imagePath = resolveAttachmentPath({ attachmentsDir: dir, attachment: image })!;
    expect(NodeFS.readFileSync(imagePath)).toEqual(png);

    const audio = Buffer.alloc(2048, 1);
    const voice = storeCopiedAttachment({
      attachmentsDir: dir,
      threadId: "copy-thread-1",
      source: file("aud", audio.length, "audio/mpeg", "note.mp3"),
      bytes: audio,
    })!;
    expect(voice.type).toBe("file");
    expect(voice.mimeType).toBe("audio/mpeg");
    expect(voice.id).toMatch(/-mp3$/);
    expect(
      NodeFS.existsSync(resolveAttachmentPath({ attachmentsDir: dir, attachment: voice })!),
    ).toBe(true);

    removeCopiedAttachments(dir, [image, voice]);
    expect(NodeFS.existsSync(imagePath)).toBe(false);
  });

  it("refuses bytes that do not match the export, are empty or over the limit", () => {
    const source = file("x", 10);
    expect(
      storeCopiedAttachment({ attachmentsDir: dir, threadId: "t", source, bytes: Buffer.alloc(9) }),
    ).toBeNull();
    expect(
      storeCopiedAttachment({
        attachmentsDir: dir,
        threadId: "t",
        source: file("empty", 0),
        bytes: Buffer.alloc(0),
      }),
    ).toBeNull();
    const big = COPY_FILE_MAX_BYTES + 1;
    expect(
      storeCopiedAttachment({
        attachmentsDir: dir,
        threadId: "t",
        source: file("big", big),
        bytes: Buffer.alloc(big),
      }),
    ).toBeNull();
  });

  it("the runner reads a shared attachment within the limit and refuses a bigger one", () => {
    const small: ChatAttachment = {
      type: "file",
      id: "source-thread-00000000-0000-4000-8000-000000000001-pdf" as ChatAttachment["id"],
      name: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
    };
    NodeFS.writeFileSync(resolveAttachmentPath({ attachmentsDir: dir, attachment: small })!, "abc");
    const read = readAttachmentForCopy(dir, small);
    expect(read).toEqual({
      ok: true,
      value: {
        id: small.id,
        name: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        data: Buffer.from("abc").toString("base64"),
      },
    });
    const large: ChatAttachment = {
      ...small,
      id: "source-thread-00000000-0000-4000-8000-000000000002-pdf" as ChatAttachment["id"],
    };
    NodeFS.writeFileSync(
      resolveAttachmentPath({ attachmentsDir: dir, attachment: large })!,
      Buffer.alloc(COPY_FILE_MAX_BYTES + 1),
    );
    expect(readAttachmentForCopy(dir, large)).toMatchObject({ ok: false, status: 413 });
    expect(
      readAttachmentForCopy(dir, {
        ...small,
        id: "source-thread-00000000-0000-4000-8000-000000000003-pdf" as ChatAttachment["id"],
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });
});

describe("copied thread with attachments", () => {
  const snapshot: ZenHubThreadSnapshot = {
    version: "v",
    title: "Brief",
    kind: "personal",
    running: false,
    omittedMessageCount: 0,
    messages: [
      message("m1", [
        file("img", 4, "image/png", "chart.png"),
        file("big", 12 * MB, "video/mp4", "demo.mp4"),
      ]),
      { ...message("m2", [], "Done", "2026-11-07T10:00:05.000Z"), role: "assistant" },
      message(
        "m3",
        [file("doc", 3, "application/pdf", "brief.pdf")],
        "",
        "2026-11-07T10:00:06.000Z",
      ),
    ],
  };
  const stored = (id: string, type: "image" | "file"): ChatAttachment =>
    type === "image"
      ? {
          type,
          id: `copy-1-${id}` as ChatAttachment["id"],
          name: `${id}.png`,
          mimeType: "image/png",
          sizeBytes: 4,
        }
      : {
          type,
          id: `copy-1-${id}` as ChatAttachment["id"],
          name: `${id}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 3,
        };
  const events = (language: "en" | "ro") =>
    buildCopyEvents({
      threadId: ThreadId.make("copy-1"),
      projectId: ProjectId.make("p1"),
      modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" } as never,
      runtimeMode: "approval-required" as never,
      snapshot,
      fromName: "Alex",
      how: "copy",
      now: DateTime.makeUnsafe(Date.parse("2026-11-07T11:00:00.000Z")),
      copied: new Map([
        ["img", stored("img", "image")],
        ["doc", stored("doc", "file")],
      ]),
      language,
    });

  it("writes real attachments on the copied messages and lists the ones over the limits", () => {
    const all = events("en");
    const messages = all.flatMap((event) =>
      event.type === "message.updated" ? [event.payload] : [],
    );
    expect(messages).toHaveLength(3);
    expect(messages[0]!.attachments.map((attachment) => attachment.id)).toEqual(["copy-1-img"]);
    expect(messages[0]!.text).toBe(
      "text m1\n\nNot copied (over the size limits): demo.mp4 (12.0 MB)",
    );
    // A message that was only an attachment is copied too.
    expect(messages[2]!.text).toBe("");
    expect(messages[2]!.attachments.map((attachment) => attachment.type)).toEqual(["file"]);
    const userItem = all.find(
      (event) => event.type === "turn-item.updated" && event.payload.type === "user_message",
    );
    expect(
      userItem?.type === "turn-item.updated" && userItem.payload.type === "user_message"
        ? userItem.payload.attachments.length
        : -1,
    ).toBe(1);
    const notice = all[1]!;
    expect(
      notice.type === "turn-item.updated" && notice.payload.type === "system_notice"
        ? notice.payload.message
        : "",
    ).toMatch(/listed by name and size/);
  });

  it("writes the notice and the list in Romanian when asked", () => {
    const all = events("ro");
    const first = all.find((event) => event.type === "message.updated");
    expect(first?.type === "message.updated" ? first.payload.text : "").toMatch(
      /Necopiate \(peste limitele de mărime\): demo\.mp4/,
    );
    const notice = all[1]!;
    expect(
      notice.type === "turn-item.updated" && notice.payload.type === "system_notice"
        ? notice.payload.message
        : "",
    ).toMatch(/^Copiat din chatul lui Alex/);
  });
});

describe("runner state across versions", () => {
  it("allows title/comments and attachment requests on shares this machine made", () => {
    const state = {
      ...emptyHubState(),
      shares: { sh_1: { threadId: "t1", kind: "personal" as const, companyId: "co" } },
    };
    for (const op of ["thread.meta", "thread.attachment"]) {
      expect(
        authorizeRelayRequest(
          state,
          { op, shareId: "sh_1", threadId: "t1", companyId: "co" },
          "personal",
        ),
      ).toBeNull();
      expect(
        authorizeRelayRequest(
          state,
          { op, shareId: "sh_x", threadId: "t1", companyId: "co" },
          "personal",
        ),
      ).not.toBeNull();
    }
  });

  it("keeps pins from older files (approved) and the rejected list", () => {
    const loaded = normalizeHubState({
      version: 1,
      trust: {
        devices: {
          usr_1: [{ keyId: "k", signPublicKey: "s", boxPublicKey: "b", via: "first-use", at: "x" }],
        },
        revoked: [],
        rejected: ["k2", 3],
        runners: {},
      },
    });
    expect(loaded.trust.devices.usr_1?.[0]?.state).toBeUndefined();
    expect(loaded.trust.rejected).toEqual(["k2"]);
  });
});
