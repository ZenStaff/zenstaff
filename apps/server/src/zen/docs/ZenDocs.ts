// @effect-diagnostics nodeBuiltinImport:off -- path joins for the versions folder.
// Zen Staff inline document editing: RPC service. The web reads and writes whole files here, on
// the environment that owns them (remote environments answer the same RPCs over their own
// connection). Only folders the server knows as workspaces are served. See ZEN.md, "Documents".
import {
  ZEN_DOCS_WS_METHODS,
  ZenDocsError,
  type ZenDocContents,
  type ZenDocNotesInput,
  type ZenDocNotesResult,
  type ZenDocReadVersionInput,
  type ZenDocTarget,
  type ZenDocVersionsResult,
  type ZenDocWriteInput,
  type ZenDocWriteResult,
} from "@t3tools/contracts/zenDocs";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as NodePath from "node:path";

import * as ServerConfig from "../../config.ts";
import * as KnownWorkspaces from "../../workspace/KnownWorkspaces.ts";
import {
  DocFailure,
  listVersions,
  readDocBytes,
  readNotes,
  readVersion,
  resolveDocPath,
  writeDoc,
  writeNotes,
} from "./docStore.ts";

export class ZenDocs extends Context.Service<
  ZenDocs,
  {
    readonly read: (input: ZenDocTarget) => Effect.Effect<ZenDocContents, ZenDocsError>;
    readonly write: (input: ZenDocWriteInput) => Effect.Effect<ZenDocWriteResult, ZenDocsError>;
    readonly versions: (input: ZenDocTarget) => Effect.Effect<ZenDocVersionsResult, ZenDocsError>;
    readonly readVersion: (
      input: ZenDocReadVersionInput,
    ) => Effect.Effect<ZenDocContents, ZenDocsError>;
    readonly notes: (input: ZenDocNotesInput) => Effect.Effect<ZenDocNotesResult, ZenDocsError>;
  }
>()("t3/zen/docs/ZenDocs") {}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new DocFailure("invalid-input", "The file contents are not valid base64.");
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

const isZenDocsError = Schema.is(ZenDocsError);

const asDocsError = (cause: unknown): ZenDocsError =>
  cause instanceof DocFailure
    ? new ZenDocsError({ reason: cause.reason, detail: cause.message })
    : isZenDocsError(cause)
      ? cause
      : new ZenDocsError({
          reason: "io",
          detail: `The file could not be read or saved: ${cause instanceof Error ? cause.message : String(cause)}`,
        });

const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const versionsRoot = NodePath.join(serverConfig.stateDir, "zen", "doc-versions");

  const known = (cwd: string) =>
    knownWorkspaces.assertContains(cwd).pipe(
      Effect.mapError(
        () =>
          new ZenDocsError({
            reason: "outside-workspace",
            detail: "This folder is not one of the projects on this machine.",
          }),
      ),
    );

  const run = <A>(cwd: string, task: () => Promise<A>) =>
    known(cwd).pipe(Effect.flatMap(() => Effect.tryPromise({ try: task, catch: asDocsError })));

  const read = Effect.fn("ZenDocs.read")(function* (input: ZenDocTarget) {
    return yield* run(input.cwd, async () => {
      const target = await resolveDocPath(input.cwd, input.relativePath, { write: false });
      if (!target.exists) throw new DocFailure("not-found", "The file is no longer there.");
      const { bytes, stamp } = await readDocBytes(target.realPath);
      return { ...stamp, relativePath: target.relativePath, base64: toBase64(bytes) };
    });
  });

  const write = Effect.fn("ZenDocs.write")(function* (input: ZenDocWriteInput) {
    return yield* run(input.cwd, async (): Promise<ZenDocWriteResult> => {
      const target = await resolveDocPath(input.cwd, input.relativePath, { write: true });
      const outcome = await writeDoc({
        realPath: target.realPath,
        bytes: fromBase64(input.base64),
        expectedSha256: input.expectedSha256,
        force: input.force === true,
        versionsRoot,
      });
      if (outcome._tag === "saved") return outcome;
      return {
        _tag: "conflict",
        current:
          outcome.current === null
            ? null
            : {
                ...outcome.current.stamp,
                relativePath: target.relativePath,
                base64: toBase64(outcome.current.bytes),
              },
      };
    });
  });

  const versions = Effect.fn("ZenDocs.versions")(function* (input: ZenDocTarget) {
    return yield* run(input.cwd, async () => {
      const target = await resolveDocPath(input.cwd, input.relativePath, { write: false });
      return { versions: await listVersions(versionsRoot, target.realPath) };
    });
  });

  const readVersionOf = Effect.fn("ZenDocs.readVersion")(function* (input: ZenDocReadVersionInput) {
    return yield* run(input.cwd, async () => {
      const target = await resolveDocPath(input.cwd, input.relativePath, { write: false });
      const { bytes, version } = await readVersion(versionsRoot, target.realPath, input.versionId);
      return {
        sha256: version.sha256,
        size: version.size,
        mtimeMs: Date.parse(version.savedAt),
        relativePath: target.relativePath,
        base64: toBase64(bytes),
      };
    });
  });

  const notes = Effect.fn("ZenDocs.notes")(function* (input: ZenDocNotesInput) {
    return yield* run(input.cwd, async () => {
      const target = await resolveDocPath(input.cwd, input.relativePath, { write: false });
      if (input.notes !== undefined) await writeNotes(versionsRoot, target.realPath, input.notes);
      return { notes: await readNotes(versionsRoot, target.realPath) };
    });
  });

  return ZenDocs.of({ read, write, versions, readVersion: readVersionOf, notes });
});

export const layer = Layer.effect(ZenDocs, make);

/** RPC handlers for ws.ts; the service is optional so upstream's ws tests need no Zen mock. */
export const wsHandlers = (service: Option.Option<ZenDocs["Service"]>) => {
  const unavailable = Effect.fail(
    new ZenDocsError({
      reason: "unavailable",
      detail: "Document editing is not available on this server.",
    }),
  );
  const call = <A>(task: (docs: ZenDocs["Service"]) => Effect.Effect<A, ZenDocsError>) =>
    Option.isSome(service) ? task(service.value) : unavailable;
  return {
    [ZEN_DOCS_WS_METHODS.read]: (input: ZenDocTarget) => call((docs) => docs.read(input)),
    [ZEN_DOCS_WS_METHODS.write]: (input: ZenDocWriteInput) => call((docs) => docs.write(input)),
    [ZEN_DOCS_WS_METHODS.versions]: (input: ZenDocTarget) => call((docs) => docs.versions(input)),
    [ZEN_DOCS_WS_METHODS.readVersion]: (input: ZenDocReadVersionInput) =>
      call((docs) => docs.readVersion(input)),
    [ZEN_DOCS_WS_METHODS.notes]: (input: ZenDocNotesInput) => call((docs) => docs.notes(input)),
  };
};
