// @effect-diagnostics nodeBuiltinImport:off globalDate:off extendsNativeError:off -- plain Node file I/O, wrapped by ZenDocs.ts.
// Zen Staff inline document editing, file side (plain Node, tested on a temp folder): paths stay
// inside the workspace (symlinks resolved, no .git, editable formats only); writes are
// compare-and-swap on the SHA-256 the editor opened, via temp file + rename; the replaced bytes
// are kept as versions under `<state dir>/zen/doc-versions/`.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  ZEN_DOCS_MAX_BYTES,
  ZEN_DOCS_MAX_VERSIONS,
  type ZenDocNote,
  type ZenDocStamp,
  type ZenDocVersion,
  type ZenDocsError,
} from "@t3tools/contracts/zenDocs";

const EDITABLE_EXTENSIONS = new Set([
  ".csv",
  ".tsv",
  ".xlsx",
  ".md",
  ".markdown",
  ".mdx",
  ".html",
  ".htm",
  ".docx",
  ".pdf",
]);
/** PDFs are viewed and annotated (notes), never rewritten. */
const WRITABLE_EXTENSIONS = new Set([...EDITABLE_EXTENSIONS].filter((ext) => ext !== ".pdf"));

export class DocFailure extends Error {
  readonly reason: ZenDocsError["reason"];
  constructor(reason: ZenDocsError["reason"], detail: string) {
    super(detail);
    this.reason = reason;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return NodeCrypto.createHash("sha256").update(bytes).digest("hex");
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`) &&
      !NodePath.isAbsolute(relative))
  );
}

export interface ResolvedDoc {
  readonly root: string;
  readonly realPath: string;
  readonly relativePath: string;
  readonly exists: boolean;
}

/**
 * Resolves `relativePath` under `cwd`. The deepest existing ancestor is resolved through
 * symlinks, so a link that points outside the workspace is refused like `../`.
 */
export async function resolveDocPath(
  cwd: string,
  relativePath: string,
  options: { readonly write: boolean },
): Promise<ResolvedDoc> {
  if (NodePath.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw new DocFailure("outside-workspace", "Only files inside the folder can be edited.");
  }
  const extension = NodePath.extname(relativePath).toLowerCase();
  const allowed = options.write ? WRITABLE_EXTENSIONS : EDITABLE_EXTENSIONS;
  if (!allowed.has(extension)) {
    throw new DocFailure(
      "invalid-input",
      `This kind of file (${extension || "no extension"}) is not edited here.`,
    );
  }
  const root = await NodeFSP.realpath(NodePath.resolve(cwd)).catch(() => {
    throw new DocFailure("not-found", "The folder could not be opened.");
  });
  const lexical = NodePath.resolve(root, relativePath);
  if (!insideRoot(root, lexical)) {
    throw new DocFailure("outside-workspace", "The file is outside the folder.");
  }
  const segments = NodePath.relative(root, lexical).split(NodePath.sep);
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    throw new DocFailure("outside-workspace", "Files inside .git are not edited.");
  }
  let realPath = lexical;
  let exists = false;
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const candidate = NodePath.join(root, ...segments.slice(0, depth));
    try {
      const resolved = await NodeFSP.realpath(candidate);
      realPath = NodePath.join(resolved, ...segments.slice(depth));
      exists = depth === segments.length;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new DocFailure("io", "The file could not be resolved.");
      }
      const dangling = await NodeFSP.lstat(candidate).then(
        () => true,
        () => false,
      );
      if (dangling) throw new DocFailure("outside-workspace", "The file is a broken link.");
    }
  }
  if (!insideRoot(root, realPath)) {
    throw new DocFailure("outside-workspace", "The file links outside the folder.");
  }
  if (exists) {
    const stat = await NodeFSP.stat(realPath);
    if (!stat.isFile()) throw new DocFailure("not-a-file", "This is not a regular file.");
  }
  return { root, realPath, relativePath: segments.join("/"), exists };
}

export async function readDocBytes(
  realPath: string,
): Promise<{ readonly bytes: Uint8Array; readonly stamp: ZenDocStamp }> {
  const stat = await NodeFSP.stat(realPath).catch(() => {
    throw new DocFailure("not-found", "The file is no longer there.");
  });
  if (!stat.isFile()) throw new DocFailure("not-a-file", "This is not a regular file.");
  if (stat.size > ZEN_DOCS_MAX_BYTES) {
    throw new DocFailure("too-large", "Files over 25 MB are not edited here.");
  }
  const bytes = new Uint8Array(await NodeFSP.readFile(realPath));
  return { bytes, stamp: { sha256: sha256Hex(bytes), size: bytes.length, mtimeMs: stat.mtimeMs } };
}

// ─── Versions ───────────────────────────────────────────────────────────────

interface VersionIndex {
  readonly path: string;
  readonly versions: ReadonlyArray<ZenDocVersion>;
}

function versionsDirFor(versionsRoot: string, realPath: string): string {
  return NodePath.join(versionsRoot, sha256Hex(new TextEncoder().encode(realPath)).slice(0, 32));
}

async function readIndex(dir: string, realPath: string): Promise<VersionIndex> {
  try {
    const raw = JSON.parse(await NodeFSP.readFile(NodePath.join(dir, "index.json"), "utf8")) as {
      path?: unknown;
      versions?: unknown;
    };
    const versions = Array.isArray(raw.versions)
      ? raw.versions.filter(
          (entry): entry is ZenDocVersion =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as ZenDocVersion).id === "string" &&
            /^[0-9a-z-]{1,80}$/.test((entry as ZenDocVersion).id),
        )
      : [];
    return { path: realPath, versions };
  } catch {
    return { path: realPath, versions: [] };
  }
}

async function writePrivate(file: string, contents: string | Uint8Array): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  await NodeFSP.writeFile(file, contents, { mode: 0o600 });
}

export async function listVersions(
  versionsRoot: string,
  realPath: string,
): Promise<ReadonlyArray<ZenDocVersion>> {
  const index = await readIndex(versionsDirFor(versionsRoot, realPath), realPath);
  return index.versions.toReversed();
}

export async function readVersion(
  versionsRoot: string,
  realPath: string,
  versionId: string,
): Promise<{ readonly bytes: Uint8Array; readonly version: ZenDocVersion }> {
  const dir = versionsDirFor(versionsRoot, realPath);
  const version = (await readIndex(dir, realPath)).versions.find((entry) => entry.id === versionId);
  if (version === undefined) throw new DocFailure("not-found", "That version is no longer kept.");
  const bytes = new Uint8Array(await NodeFSP.readFile(NodePath.join(dir, `${version.id}.bin`)));
  return { bytes, version };
}

async function keepVersion(
  versionsRoot: string,
  realPath: string,
  bytes: Uint8Array,
  now: Date,
  maxVersions: number,
): Promise<string> {
  const dir = versionsDirFor(versionsRoot, realPath);
  const index = await readIndex(dir, realPath);
  const sha256 = sha256Hex(bytes);
  // Saving twice without a change on disk in between keeps one copy.
  const latest = index.versions.at(-1);
  if (latest !== undefined && latest.sha256 === sha256) return latest.id;
  const id = `${now.getTime().toString(36)}-${NodeCrypto.randomBytes(3).toString("hex")}`;
  await writePrivate(NodePath.join(dir, `${id}.bin`), bytes);
  const versions = [
    ...index.versions,
    { id, savedAt: now.toISOString(), size: bytes.length, sha256 },
  ];
  const dropped = versions.slice(0, Math.max(0, versions.length - maxVersions));
  const kept = versions.slice(dropped.length);
  await writePrivate(
    NodePath.join(dir, "index.json"),
    JSON.stringify({ path: realPath, versions: kept }),
  );
  await Promise.all(
    dropped.map((entry) => NodeFSP.rm(NodePath.join(dir, `${entry.id}.bin`), { force: true })),
  );
  return id;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export type WriteOutcome =
  | { readonly _tag: "saved"; readonly stamp: ZenDocStamp; readonly versionId: string | null }
  | {
      readonly _tag: "conflict";
      readonly current: { readonly bytes: Uint8Array; readonly stamp: ZenDocStamp } | null;
    };

const locks = new Map<string, Promise<unknown>>();

/** One write at a time per file in this process, so check-then-rename is not raced by us. */
async function withLock<A>(key: string, run: () => Promise<A>): Promise<A> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, settled);
  try {
    return await next;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
}

export async function writeDoc(input: {
  readonly realPath: string;
  readonly bytes: Uint8Array;
  readonly expectedSha256: string | null;
  readonly force: boolean;
  readonly versionsRoot: string;
  readonly now?: Date;
  readonly maxVersions?: number;
}): Promise<WriteOutcome> {
  if (input.bytes.length > ZEN_DOCS_MAX_BYTES) {
    throw new DocFailure("too-large", "Files over 25 MB are not saved here.");
  }
  return withLock(input.realPath, async () => {
    const current = await readDocBytes(input.realPath).catch((error: unknown) => {
      if (error instanceof DocFailure && error.reason === "not-found") return null;
      throw error;
    });
    const matches =
      input.expectedSha256 === null
        ? current === null
        : current?.stamp.sha256 === input.expectedSha256;
    if (!matches && !input.force) return { _tag: "conflict", current };
    const versionId =
      current === null
        ? null
        : await keepVersion(
            input.versionsRoot,
            input.realPath,
            current.bytes,
            input.now ?? new Date(),
            input.maxVersions ?? ZEN_DOCS_MAX_VERSIONS,
          );
    const dir = NodePath.dirname(input.realPath);
    await NodeFSP.mkdir(dir, { recursive: true });
    const temp = NodePath.join(
      dir,
      `.${NodePath.basename(input.realPath)}.zen-${NodeCrypto.randomBytes(4).toString("hex")}.tmp`,
    );
    const mode = current === null ? 0o644 : (await NodeFSP.stat(input.realPath)).mode & 0o777;
    try {
      await NodeFSP.writeFile(temp, input.bytes, {
        flag: NodeFS.constants.O_WRONLY | NodeFS.constants.O_CREAT | NodeFS.constants.O_EXCL,
        mode,
      });
      await NodeFSP.rename(temp, input.realPath);
    } catch (error) {
      await NodeFSP.rm(temp, { force: true });
      throw new DocFailure("io", `The file could not be saved: ${(error as Error).message}`);
    }
    const stat = await NodeFSP.stat(input.realPath);
    return {
      _tag: "saved",
      stamp: { sha256: sha256Hex(input.bytes), size: input.bytes.length, mtimeMs: stat.mtimeMs },
      versionId,
    };
  });
}

// ─── Notes (PDF comments) ───────────────────────────────────────────────────

export async function readNotes(
  versionsRoot: string,
  realPath: string,
): Promise<ReadonlyArray<ZenDocNote>> {
  try {
    const raw = JSON.parse(
      await NodeFSP.readFile(
        NodePath.join(versionsDirFor(versionsRoot, realPath), "notes.json"),
        "utf8",
      ),
    ) as { notes?: unknown };
    return Array.isArray(raw.notes) ? (raw.notes as ReadonlyArray<ZenDocNote>) : [];
  } catch {
    return [];
  }
}

export async function writeNotes(
  versionsRoot: string,
  realPath: string,
  notes: ReadonlyArray<ZenDocNote>,
): Promise<void> {
  await writePrivate(
    NodePath.join(versionsDirFor(versionsRoot, realPath), "notes.json"),
    JSON.stringify({ path: realPath, notes }),
  );
}
