// Zen Staff inline document editing: whole-file reads and compare-and-swap writes on the
// environment that owns the file (remote ones too), versions kept there, PDF notes. A changed
// hash on disk is a conflict, never a silent overwrite. See ZEN.md, "Documents".
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ZEN_DOCS_WS_METHODS = {
  read: "zen.docs.read",
  write: "zen.docs.write",
  versions: "zen.docs.versions",
  readVersion: "zen.docs.readVersion",
  notes: "zen.docs.notes",
} as const;

/** Files bigger than this are not opened for editing (base64 travels over the app connection). */
export const ZEN_DOCS_MAX_BYTES = 25 * 1024 * 1024;
/** Versions kept per file on the machine that owns it. */
export const ZEN_DOCS_MAX_VERSIONS = 20;

const RelativePath = TrimmedNonEmptyString.check(Schema.isMaxLength(4096));

export const ZenDocTarget = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: RelativePath,
});
export type ZenDocTarget = typeof ZenDocTarget.Type;

export const ZenDocStamp = Schema.Struct({
  sha256: Schema.String,
  size: NonNegativeInt,
  mtimeMs: Schema.Number,
});
export type ZenDocStamp = typeof ZenDocStamp.Type;

export const ZenDocContents = Schema.Struct({
  ...ZenDocStamp.fields,
  relativePath: RelativePath,
  base64: Schema.String,
});
export type ZenDocContents = typeof ZenDocContents.Type;

export const ZenDocWriteInput = Schema.Struct({
  ...ZenDocTarget.fields,
  base64: Schema.String,
  /** The hash the editor opened (or last saved). Null = the file must not exist yet. */
  expectedSha256: Schema.NullOr(Schema.String),
  /** Overwrite even if the file changed. Only sent after the person chose "Keep mine". */
  force: Schema.optional(Schema.Boolean),
});
export type ZenDocWriteInput = typeof ZenDocWriteInput.Type;

export const ZenDocWriteResult = Schema.Union([
  Schema.TaggedStruct("saved", {
    stamp: ZenDocStamp,
    /** The version that holds the contents before this save, if there were any. */
    versionId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("conflict", {
    /** What is on disk now; the editor offers merge, reload or keep mine. */
    current: Schema.NullOr(ZenDocContents),
  }),
]);
export type ZenDocWriteResult = typeof ZenDocWriteResult.Type;

export const ZenDocVersion = Schema.Struct({
  id: Schema.String,
  savedAt: Schema.String,
  size: NonNegativeInt,
  sha256: Schema.String,
});
export type ZenDocVersion = typeof ZenDocVersion.Type;

export const ZenDocVersionsResult = Schema.Struct({
  versions: Schema.Array(ZenDocVersion),
});
export type ZenDocVersionsResult = typeof ZenDocVersionsResult.Type;

export const ZenDocReadVersionInput = Schema.Struct({
  ...ZenDocTarget.fields,
  versionId: Schema.String.check(Schema.isPattern(/^[0-9a-z-]{1,80}$/)),
});
export type ZenDocReadVersionInput = typeof ZenDocReadVersionInput.Type;

export const ZenDocNote = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(80)),
  /** 1-based page for PDFs; 0 = the whole document. */
  page: NonNegativeInt,
  text: Schema.String.check(Schema.isMaxLength(4000)),
  /** The text the note is about, when it was made from a selection. */
  quote: Schema.optional(Schema.String.check(Schema.isMaxLength(4000))),
  createdAt: Schema.String,
});
export type ZenDocNote = typeof ZenDocNote.Type;

export const ZenDocNotesInput = Schema.Struct({
  ...ZenDocTarget.fields,
  /** When given, replaces the notes; otherwise they are only read. */
  notes: Schema.optional(Schema.Array(ZenDocNote).check(Schema.isMaxLength(500))),
});
export type ZenDocNotesInput = typeof ZenDocNotesInput.Type;

export const ZenDocNotesResult = Schema.Struct({ notes: Schema.Array(ZenDocNote) });
export type ZenDocNotesResult = typeof ZenDocNotesResult.Type;

export class ZenDocsError extends Schema.TaggedError<ZenDocsError>()("ZenDocsError", {
  reason: Schema.Literals([
    "not-found",
    "outside-workspace",
    "too-large",
    "not-a-file",
    "invalid-input",
    "io",
    "unavailable",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const errors = Schema.Union([ZenDocsError, EnvironmentAuthorizationError]);

const ZenDocsReadRpc = Rpc.make(ZEN_DOCS_WS_METHODS.read, {
  payload: ZenDocTarget,
  success: ZenDocContents,
  error: errors,
});
const ZenDocsWriteRpc = Rpc.make(ZEN_DOCS_WS_METHODS.write, {
  payload: ZenDocWriteInput,
  success: ZenDocWriteResult,
  error: errors,
});
const ZenDocsVersionsRpc = Rpc.make(ZEN_DOCS_WS_METHODS.versions, {
  payload: ZenDocTarget,
  success: ZenDocVersionsResult,
  error: errors,
});
const ZenDocsReadVersionRpc = Rpc.make(ZEN_DOCS_WS_METHODS.readVersion, {
  payload: ZenDocReadVersionInput,
  success: ZenDocContents,
  error: errors,
});
const ZenDocsNotesRpc = Rpc.make(ZEN_DOCS_WS_METHODS.notes, {
  payload: ZenDocNotesInput,
  success: ZenDocNotesResult,
  error: errors,
});

/** Spread into `WsRpcGroup` (rpc.ts). */
export const ZEN_DOCS_RPCS = [
  ZenDocsReadRpc,
  ZenDocsWriteRpc,
  ZenDocsVersionsRpc,
  ZenDocsReadVersionRpc,
  ZenDocsNotesRpc,
] as const;

export const ZEN_DOCS_RPC_SCOPES = {
  [ZEN_DOCS_WS_METHODS.read]: AuthFilesystemReadScope,
  [ZEN_DOCS_WS_METHODS.write]: AuthFilesystemWriteScope,
  [ZEN_DOCS_WS_METHODS.versions]: AuthFilesystemReadScope,
  [ZEN_DOCS_WS_METHODS.readVersion]: AuthFilesystemReadScope,
  // Notes are written next to the versions, on the machine that owns the file.
  [ZEN_DOCS_WS_METHODS.notes]: AuthFilesystemWriteScope,
} as const;

export const ZEN_DOCS_RPC_AGGREGATES = {
  [ZEN_DOCS_WS_METHODS.read]: "zen",
  [ZEN_DOCS_WS_METHODS.write]: "zen",
  [ZEN_DOCS_WS_METHODS.versions]: "zen",
  [ZEN_DOCS_WS_METHODS.readVersion]: "zen",
  [ZEN_DOCS_WS_METHODS.notes]: "zen",
} as const;
