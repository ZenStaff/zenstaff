// @effect-diagnostics nodeBuiltinImport:off - zlib, crypto and Buffer for pack archives.
// Zen Staff: the remote marketplace registry, client side. URL rules, the download with limits,
// the sha256 check, safe archive reading (tar.gz and zip) and merging remote entries with the
// bundled ones. Pure or promise-based so tests cover them without the service. See ZEN.md,
// "Office edition".
import type { ZenRegistryDownload, ZenRegistryEntry } from "@t3tools/contracts/zenOffice";
import * as NodeCrypto from "node:crypto";
import * as NodeZlib from "node:zlib";
import * as Yauzl from "yauzl";

export const REMOTE_REGISTRY_LIMITS = {
  /** The registry index. */
  indexBytes: 2 * 1024 * 1024,
  indexTimeoutMs: 10_000,
  /** A pack archive as downloaded. */
  archiveBytes: 20 * 1024 * 1024,
  archiveTimeoutMs: 60_000,
  /** A pack once extracted. */
  extractedBytes: 50 * 1024 * 1024,
  files: 500,
} as const;

export type Outcome<A> = { readonly ok: A } | { readonly error: string };

/** An http(s) URL with no credentials, trimmed; empty means "no URL". */
export function normalizeRegistryUrl(input: string | null): Outcome<string | null> {
  const trimmed = input?.trim() ?? "";
  if (trimmed.length === 0) return { ok: null };
  if (trimmed.length > 2048) return { error: "The registry address is too long." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "The registry address is not a valid web address." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "The registry address must start with http:// or https://." };
  }
  if (url.username || url.password) {
    return { error: "Leave the user name and password out of the registry address." };
  }
  return { ok: url.toString() };
}

/** A pack's download URL, resolved against the registry URL; only http(s). */
export function resolveDownloadUrl(registryUrl: string, url: string): Outcome<string> {
  let resolved: URL;
  try {
    resolved = new URL(url, registryUrl);
  } catch {
    return { error: "The pack's download address is not valid." };
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return { error: "The pack's download address must use http or https." };
  }
  return { ok: resolved.toString() };
}

/**
 * The registry index's detached Ed25519 signature (`<index>.sig`, base64) against the public key
 * (SPKI DER, base64). Anything missing, malformed or not matching is false: the index is ignored.
 */
export function verifyRegistrySignature(
  index: Uint8Array,
  signature: string | null,
  publicKeyBase64: string,
): boolean {
  if (signature === null || signature.trim() === "") return false;
  try {
    const key = NodeCrypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const sig = Buffer.from(signature.trim(), "base64");
    if (sig.length !== 64) return false;
    return NodeCrypto.verify(null, index, key, sig);
  } catch {
    return false;
  }
}

/** Plain semver order ("1.2.10" > "1.2.9"); non-numeric parts compare as text. */
export function compareRegistryVersions(left: string, right: string): number {
  const parts = (value: string) => value.trim().replace(/^v/, "").split(/[.+-]/);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? "0";
    const y = b[index] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    const order = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return 0;
}

export function sha256Hex(bytes: Uint8Array): string {
  return NodeCrypto.createHash("sha256").update(bytes).digest("hex");
}

/** True when `bytes` hash to `expected` (64 hex characters, any case). */
export function verifySha256(bytes: Uint8Array, expected: string): boolean {
  const want = expected.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return false;
  return NodeCrypto.timingSafeEqual(Buffer.from(sha256Hex(bytes), "hex"), Buffer.from(want, "hex"));
}

export function archiveFormat(download: ZenRegistryDownload): "tar.gz" | "zip" {
  if (download.format) return download.format;
  return /\.zip(?:$|[?#])/i.test(download.url) ? "zip" : "tar.gz";
}

/**
 * A member path made relative and normalized, or null when it is unsafe: absolute, a drive
 * letter, backslashes, NUL, or a `..` segment.
 */
export function safeArchivePath(name: string): string | null {
  if (name.length === 0 || name.length > 1024) return null;
  if (name.includes("\0") || name.includes("\\")) return null;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null;
  const segments: string[] = [];
  for (const segment of name.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
}

export interface ArchiveFile {
  readonly path: string;
  readonly data: Uint8Array;
}

/** Junk some archivers add (macOS resource forks); skipped, never written. */
const isJunk = (path: string) =>
  path.startsWith("__MACOSX/") || path.split("/").some((segment) => segment.startsWith("._"));

class ArchiveCollector {
  readonly files: ArchiveFile[] = [];
  private total = 0;
  private readonly seen = new Set<string>();
  add(rawName: string, data: Uint8Array): string | null {
    const path = safeArchivePath(rawName);
    if (path === null) return `The pack contains an unsafe path: "${rawName.slice(0, 200)}".`;
    if (isJunk(path)) return null;
    if (this.seen.has(path)) return `The pack lists "${path}" twice.`;
    this.seen.add(path);
    this.total += data.byteLength;
    if (this.files.length >= REMOTE_REGISTRY_LIMITS.files) return "The pack has too many files.";
    if (this.total > REMOTE_REGISTRY_LIMITS.extractedBytes) return "The pack is too large.";
    this.files.push({ path, data });
    return null;
  }
  checkDirectory(rawName: string): string | null {
    return safeArchivePath(rawName) === null
      ? `The pack contains an unsafe path: "${rawName.slice(0, 200)}".`
      : null;
  }
}

const ascii = (bytes: Uint8Array, start: number, length: number) => {
  const slice = bytes.subarray(start, start + length);
  const end = slice.indexOf(0);
  return Buffer.from(end === -1 ? slice : slice.subarray(0, end)).toString("utf8");
};

const octal = (bytes: Uint8Array, start: number, length: number): number | null => {
  if ((bytes[start]! & 0x80) !== 0) return null; // base-256: far beyond our limits anyway
  const text = ascii(bytes, start, length).trim();
  if (text.length === 0) return 0;
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : null;
};

/** PAX extended header records ("<len> key=value\n"); only `path` matters here. */
const paxPath = (data: Uint8Array): string | null => {
  const text = Buffer.from(data).toString("utf8");
  let found: string | null = null;
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(" ", offset);
    if (space === -1) break;
    const length = Number.parseInt(text.slice(offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, offset + length - 1);
    const equals = record.indexOf("=");
    if (equals !== -1 && record.slice(0, equals) === "path") found = record.slice(equals + 1);
    offset += length;
  }
  return found;
};

/**
 * The regular files of a .tar.gz, with paths checked. Directories are fine; symlinks, hard
 * links, devices and anything else are refused.
 */
export function readTarGz(bytes: Uint8Array): Outcome<ReadonlyArray<ArchiveFile>> {
  let tar: Uint8Array;
  try {
    tar = NodeZlib.gunzipSync(bytes, {
      maxOutputLength: REMOTE_REGISTRY_LIMITS.extractedBytes + 1024 * 1024,
    });
  } catch {
    return { error: "The pack is not a valid .tar.gz archive (or it is too large)." };
  }
  const collector = new ArchiveCollector();
  let offset = 0;
  let longName: string | null = null;
  let paxName: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    if (size === null) return { error: "The pack's archive is damaged." };
    const type = String.fromCharCode(header[156]!);
    const magic = ascii(header, 257, 6);
    const prefix = magic.startsWith("ustar") ? ascii(header, 345, 155) : "";
    const headerName = prefix ? `${prefix}/${ascii(header, 0, 100)}` : ascii(header, 0, 100);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) return { error: "The pack's archive is cut short." };
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = ascii(data, 0, data.length);
      continue;
    }
    if (type === "x") {
      paxName = paxPath(data);
      continue;
    }
    if (type === "g") continue;
    const name = paxName ?? longName ?? headerName;
    paxName = null;
    longName = null;
    if (type === "5") {
      const problem = collector.checkDirectory(name);
      if (problem) return { error: problem };
      continue;
    }
    if (type !== "0" && type !== "\0" && type !== "7") {
      return {
        error: `The pack contains "${name.slice(0, 200)}", which is not a plain file (links are not allowed).`,
      };
    }
    const problem = collector.add(name, data);
    if (problem) return { error: problem };
  }
  return { ok: collector.files };
}

/** The regular files of a .zip, with paths checked; symlinks are refused. */
export function readZip(bytes: Uint8Array): Promise<Outcome<ReadonlyArray<ArchiveFile>>> {
  return new Promise((resolve) => {
    Yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (openError, zip) => {
        if (openError || !zip) {
          resolve({ error: "The pack is not a valid .zip archive." });
          return;
        }
        const collector = new ArchiveCollector();
        let settled = false;
        const finish = (outcome: Outcome<ReadonlyArray<ArchiveFile>>) => {
          if (settled) return;
          settled = true;
          zip.close();
          resolve(outcome);
        };
        if (zip.entryCount > REMOTE_REGISTRY_LIMITS.files * 2) {
          finish({ error: "The pack has too many files." });
          return;
        }
        zip.on("error", () => finish({ error: "The pack's .zip archive could not be read." }));
        zip.on("end", () => finish({ ok: collector.files }));
        zip.on("entry", (entry: Yauzl.Entry) => {
          const name = entry.fileName;
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (mode === 0o120000) {
            finish({ error: `The pack contains a link ("${name.slice(0, 200)}"), not allowed.` });
            return;
          }
          if (name.endsWith("/")) {
            const problem = collector.checkDirectory(name);
            if (problem) finish({ error: problem });
            else zip.readEntry();
            return;
          }
          if (entry.uncompressedSize > REMOTE_REGISTRY_LIMITS.extractedBytes) {
            finish({ error: "The pack is too large." });
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              finish({ error: "The pack's .zip archive could not be read." });
              return;
            }
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("error", () => finish({ error: "The pack's .zip archive is damaged." }));
            stream.on("end", () => {
              const problem = collector.add(name, Buffer.concat(chunks));
              if (problem) finish({ error: problem });
              else zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}

/**
 * The pack's files relative to its workflow folder: either `workflow.json` sits at the archive
 * root, or every file is inside one top-level folder that has it.
 */
export function packFilesAtRoot(
  files: ReadonlyArray<ArchiveFile>,
  /** For a pack of several workflows: each must be a folder with a workflow.json at the root. */
  workflowIds?: ReadonlyArray<string>,
): Outcome<ReadonlyArray<ArchiveFile>> {
  if (files.length === 0) return { error: "The pack's archive is empty." };
  const marker = (id: string) => (workflowIds ? `${id}/workflow.json` : "workflow.json");
  const complete = (list: ReadonlyArray<ArchiveFile>) =>
    (workflowIds ?? [""]).every((id) => list.some((file) => file.path === marker(id)));
  if (complete(files)) return { ok: files };
  const tops = new Set(files.map((file) => file.path.split("/")[0]!));
  if (tops.size === 1 && files.every((file) => file.path.includes("/"))) {
    const [top] = tops;
    const stripped = files.map((file) => ({ ...file, path: file.path.slice(top!.length + 1) }));
    if (complete(stripped)) return { ok: stripped };
  }
  return workflowIds
    ? { error: "The pack's archive is missing one of its workflows." }
    : { error: "The pack's archive has no workflow.json at its root or in one folder." };
}

export type RegistryOrigin = "local" | "remote" | "community";
export interface MergedRegistryEntry {
  readonly entry: ZenRegistryEntry;
  readonly origin: RegistryOrigin;
}

/**
 * The bundled entries with the remote ones: bundled built-ins always stay (they ship with the
 * app); for anything else a remote entry replaces the bundled one with the same id only when its
 * version is newer. Remote "builtin" entries the app does not ship are dropped. Bundled order
 * first, then new remote ones.
 */
export function mergeRegistryEntries(
  local: ReadonlyArray<ZenRegistryEntry>,
  remote: ReadonlyArray<ZenRegistryEntry>,
): ReadonlyArray<MergedRegistryEntry> {
  const localBuiltins = new Set(
    local.filter((entry) => entry.kind === "builtin").map((entry) => entry.id),
  );
  const remoteById = new Map<string, ZenRegistryEntry>();
  for (const entry of remote) {
    if (entry.kind === "builtin" || localBuiltins.has(entry.id)) continue;
    if (!remoteById.has(entry.id)) remoteById.set(entry.id, entry);
  }
  const merged: MergedRegistryEntry[] = [];
  const used = new Set<string>();
  for (const entry of local) {
    if (used.has(entry.id)) continue;
    used.add(entry.id);
    const remoteEntry = remoteById.get(entry.id);
    const replacement =
      remoteEntry !== undefined && compareRegistryVersions(remoteEntry.version, entry.version) > 0
        ? remoteEntry
        : undefined;
    merged.push(
      replacement ? { entry: replacement, origin: "remote" } : { entry, origin: "local" },
    );
  }
  for (const entry of remoteById.values()) {
    if (used.has(entry.id)) continue;
    used.add(entry.id);
    merged.push({ entry, origin: "remote" });
  }
  return merged;
}

/** GET with a timeout and a byte cap; http(s) only. Rejects with a plain-language Error. */
export async function fetchLimited(
  url: string,
  limits: { readonly timeoutMs: number; readonly maxBytes: number },
): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https addresses can be used.");
  }
  const signal = AbortSignal.timeout(limits.timeoutMs);
  let response: Response;
  try {
    // @effect-diagnostics-next-line globalFetch:off -- promise helper with a byte cap; ZenOffice wraps it, and its layer needs no HttpClient.
    response = await fetch(parsed, { signal, redirect: "follow" });
  } catch (cause) {
    throw new Error(
      signal.aborted
        ? `${parsed.host} did not answer in time.`
        : `${parsed.host} could not be reached.`,
      { cause },
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${parsed.host} answered with HTTP ${response.status}.`);
  }
  const declared = Number(response.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > limits.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The download is larger than allowed.");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limits.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The download is larger than allowed.");
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message === "The download is larger than allowed.") {
      throw cause;
    }
    throw new Error(
      signal.aborted ? `${parsed.host} did not answer in time.` : "The download was interrupted.",
      { cause },
    );
  }
  return Buffer.concat(chunks);
}
