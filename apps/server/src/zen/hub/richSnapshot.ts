// @effect-diagnostics globalDate:off -- Pure helpers over plain timestamps.
// Zen Staff hub: the rows of a shared chat view. Messages with their attachments (images, audio and
// video inline up to a size budget), and the agent's tool work between them folded into one row
// per stretch, with the same digest the Office timeline shows ("Worked on 2 files"). Pure: the
// caller reads attachment bytes.
import type {
  ZenHubAttachment,
  ZenHubThreadRow,
  ZenHubWorkDigest,
  ZenHubWorkStep,
} from "@t3tools/contracts/zenHub";

export interface SnapshotMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly streaming: boolean;
  readonly createdAt: number;
  readonly attachments: ReadonlyArray<{
    readonly type: string;
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }>;
}

export interface SnapshotItem {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly title: string | null;
  readonly at: number;
  readonly toolName?: string | null;
  readonly fileName?: string;
  readonly input?: unknown;
  readonly viewedImagePath?: string;
}

/** Items that are the conversation itself or bookkeeping, not tool work. */
const NOT_WORK = new Set([
  "user_message",
  "assistant_message",
  "notification",
  "checkpoint",
  "thread_created",
  "run_interrupt_request",
  "run_interrupt_result",
  "compaction",
  "handoff",
  "fork",
  "system_notice",
]);

const MEDIA_ITEM_MAX_BYTES = 3 * 1024 * 1024;
export const MEDIA_TOTAL_MAX_BYTES = 8 * 1024 * 1024;
const STEP_TITLE_MAX = 160;

export function attachmentKind(mimeType: string): ZenHubAttachment["kind"] {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "file";
}

function baseName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).at(-1) || trimmed;
}

function readPathOf(item: SnapshotItem): string | null {
  if (item.viewedImagePath) return item.viewedImagePath;
  if (item.type !== "dynamic_tool" || !/^read$/i.test(item.toolName ?? "")) return null;
  const input = item.input as { file_path?: unknown; path?: unknown } | null | undefined;
  const path =
    typeof input?.file_path === "string"
      ? input.file_path
      : typeof input?.path === "string"
        ? input.path
        : null;
  return path;
}

function stepStatus(status: string): ZenHubWorkStep["status"] {
  if (status === "failed" || status === "cancelled" || status === "interrupted") return "failed";
  if (status === "completed" || status === "idle") return "done";
  return "running";
}

function stepTitle(item: SnapshotItem): string {
  const raw =
    item.type === "file_change" && item.fileName
      ? `Edited ${baseName(item.fileName)}`
      : (item.title ?? item.toolName ?? item.type.replace(/_/g, " "));
  return raw.length > STEP_TITLE_MAX ? `${raw.slice(0, STEP_TITLE_MAX - 3)}...` : raw;
}

export function digestWork(items: ReadonlyArray<SnapshotItem>): ZenHubWorkDigest {
  const changed: string[] = [];
  const read: string[] = [];
  let webSearches = 0;
  let otherSteps = 0;
  let failed = 0;
  let active = false;
  for (const item of items) {
    const status = stepStatus(item.status);
    if (status === "running") active = true;
    if (item.type === "reasoning") continue;
    if (status === "failed") failed += 1;
    if (item.type === "file_change" && item.fileName) {
      const name = baseName(item.fileName);
      if (!changed.includes(name)) changed.push(name);
      continue;
    }
    if (item.type === "web_search") {
      webSearches += 1;
      continue;
    }
    const path = readPathOf(item);
    if (path !== null) {
      const name = baseName(path);
      if (!read.includes(name)) read.push(name);
      continue;
    }
    otherSteps += 1;
  }
  return {
    changedFiles: changed,
    readFiles: read.filter((name) => !changed.includes(name)),
    webSearches,
    otherSteps,
    active,
    failed,
  };
}

/**
 * Messages and work rows in time order. `media` returns a data URL for an image/audio/video
 * attachment that fits the budget it is given, or null (then the row shows name and size only).
 */
export function buildRows(input: {
  readonly messages: ReadonlyArray<SnapshotMessage>;
  readonly items: ReadonlyArray<SnapshotItem>;
  readonly media: (
    attachment: SnapshotMessage["attachments"][number],
    budget: number,
  ) => string | null;
}): Array<ZenHubThreadRow> {
  type Entry =
    | { readonly at: number; readonly order: number; readonly message: SnapshotMessage }
    | { readonly at: number; readonly order: number; readonly item: SnapshotItem };
  const entries: Array<Entry> = [
    ...input.messages
      .filter(
        (message) =>
          message.role !== "system" &&
          (message.text.trim() !== "" || message.attachments.length > 0),
      )
      .map((message, index) => ({ at: message.createdAt, order: index, message })),
    ...input.items
      .filter((item) => !NOT_WORK.has(item.type) && item.type !== "reasoning")
      .map((item, index) => ({ at: item.at, order: 100_000 + index, item })),
  ].toSorted((left, right) => left.at - right.at || left.order - right.order);

  // Media budget goes to the newest attachments first: those are what a viewer opens the chat for.
  const budgets = new Map<string, number>();
  let remaining = MEDIA_TOTAL_MAX_BYTES;
  for (const message of input.messages.toReversed()) {
    for (const attachment of message.attachments) {
      if (attachmentKind(attachment.mimeType) === "file") continue;
      if (attachment.sizeBytes > MEDIA_ITEM_MAX_BYTES || attachment.sizeBytes > remaining) continue;
      budgets.set(attachment.id, attachment.sizeBytes);
      remaining -= attachment.sizeBytes;
    }
  }

  const rows: Array<ZenHubThreadRow> = [];
  let work: Array<SnapshotItem> = [];
  const flush = () => {
    if (work.length === 0) return;
    rows.push({
      kind: "work",
      id: `work:${work[0]!.id}`,
      digest: digestWork(work),
      steps: work.map((item) => ({
        type: item.type,
        title: stepTitle(item),
        status: stepStatus(item.status),
      })),
    });
    work = [];
  };
  for (const entry of entries) {
    if ("item" in entry) {
      work.push(entry.item);
      continue;
    }
    flush();
    const message = entry.message;
    rows.push({
      kind: "message",
      id: message.id,
      role: message.role === "user" ? "user" : "assistant",
      text: message.text,
      createdAt: new Date(message.createdAt).toISOString(),
      streaming: message.streaming,
      attachments: message.attachments.map((attachment) => {
        const budget = budgets.get(attachment.id);
        return {
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          kind: attachmentKind(attachment.mimeType),
          dataUrl: budget === undefined ? null : input.media(attachment, budget),
        };
      }),
    });
  }
  flush();
  return rows;
}
