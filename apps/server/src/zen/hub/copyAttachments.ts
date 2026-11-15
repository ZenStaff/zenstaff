// @effect-diagnostics nodeBuiltinImport:off -- Plain file reads and writes at the hub's promise boundary.
// Zen Staff hub: attachment bytes for "Continue on my side" and hand-overs. The owner's runner reads
// one attachment of the shared thread (within the copy limit); the viewer's server stores it for
// the new thread exactly the way upstream stores uploads (an id with the thread's segment, the
// file under the attachments directory), so the copied thread shows and sends it like any other.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  type ChatAttachment,
  ChatAttachmentId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import type { ZenHubExportAttachment } from "@t3tools/contracts/zenHub";

import {
  attachmentFileExtension,
  createAttachmentId,
  resolveAttachmentPath,
} from "../../attachmentStore.ts";
import { COPY_FILE_MAX_BYTES } from "./threadCopy.ts";

/** What `thread.attachment` answers (sealed to the asking device). */
export interface CopiedAttachmentBytes {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** base64 */
  readonly data: string;
}

/** Runner side: the bytes of one attachment of the shared thread, or why not. */
export function readAttachmentForCopy(
  attachmentsDir: string,
  attachment: ChatAttachment,
):
  | { readonly ok: true; readonly value: CopiedAttachmentBytes }
  | { readonly ok: false; readonly status: number; readonly reason: string } {
  const path = resolveAttachmentPath({ attachmentsDir, attachment });
  if (path === null) return { ok: false, status: 404, reason: "This file cannot be copied." };
  let bytes: Buffer;
  try {
    const size = NodeFS.statSync(path).size;
    if (size > COPY_FILE_MAX_BYTES) {
      return { ok: false, status: 413, reason: "This file is over the copy limit." };
    }
    bytes = NodeFS.readFileSync(path);
  } catch {
    return { ok: false, status: 404, reason: "This file is no longer on the owner's machine." };
  }
  return {
    ok: true,
    value: {
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: bytes.length,
      data: bytes.toString("base64"),
    },
  };
}

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;

/**
 * Viewer side: stores copied bytes as an attachment of the new thread. Images become image
 * attachments (shown inline and sent to the agent as images), everything else (audio, video,
 * documents) a file attachment, as upstream does for uploads. Null when the bytes do not match
 * what the export announced.
 */
export function storeCopiedAttachment(input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly source: ZenHubExportAttachment;
  readonly bytes: Uint8Array;
}): ChatAttachment | null {
  const { source, bytes } = input;
  if (bytes.byteLength === 0 || bytes.byteLength !== source.sizeBytes) return null;
  if (bytes.byteLength > COPY_FILE_MAX_BYTES) return null;
  const name = (source.name.trim() || "file").slice(0, 255);
  const mimeType = MIME_TYPE.test(source.mimeType) ? source.mimeType : "application/octet-stream";
  const image =
    mimeType.toLowerCase().startsWith("image/") &&
    bytes.byteLength <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;
  const id = createAttachmentId(input.threadId, image ? undefined : attachmentFileExtension(name));
  if (id === null) return null;
  const attachment: ChatAttachment = image
    ? { type: "image", id: ChatAttachmentId.make(id), name, mimeType, sizeBytes: bytes.byteLength }
    : { type: "file", id: ChatAttachmentId.make(id), name, mimeType, sizeBytes: bytes.byteLength };
  const path = resolveAttachmentPath({ attachmentsDir: input.attachmentsDir, attachment });
  if (path === null) return null;
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, bytes);
  return attachment;
}

/** Removes attachments stored for a copy that did not finish. */
export function removeCopiedAttachments(
  attachmentsDir: string,
  attachments: Iterable<ChatAttachment>,
): void {
  for (const attachment of attachments) {
    const path = resolveAttachmentPath({ attachmentsDir, attachment });
    if (path !== null) NodeFS.rmSync(path, { force: true });
  }
}
