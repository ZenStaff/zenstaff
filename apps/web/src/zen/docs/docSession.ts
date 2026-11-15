// Zen Staff document editing: one open document's link to the file. Reads and writes go to the
// environment that owns the file (the local server or a remote one, over its own connection),
// always as compare-and-swap on the hash the editor last saw. A changed file is reported as a
// conflict with its new contents; it is never overwritten unless the person picks "Keep mine".
import type {
  ZenDocContents,
  ZenDocTarget,
  ZenDocVersion,
  ZenDocWriteInput,
  ZenDocWriteResult,
} from "@t3tools/contracts/zenDocs";

export interface DocBackend {
  readonly read: (target: ZenDocTarget) => Promise<ZenDocContents>;
  readonly write: (input: ZenDocWriteInput) => Promise<ZenDocWriteResult>;
  readonly versions: (target: ZenDocTarget) => Promise<ReadonlyArray<ZenDocVersion>>;
  readonly readVersion: (target: ZenDocTarget, versionId: string) => Promise<ZenDocContents>;
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export interface OpenedDoc {
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export type SaveOutcome =
  | { readonly status: "saved"; readonly sha256: string; readonly versionId: string | null }
  | { readonly status: "conflict"; readonly theirs: OpenedDoc | null };

export class DocSession {
  /** The file as the editor last knew it: what it opened, reloaded or saved. */
  private known: OpenedDoc | null = null;

  constructor(
    private readonly backend: DocBackend,
    readonly target: ZenDocTarget,
  ) {}

  get base(): OpenedDoc | null {
    return this.known;
  }

  async open(): Promise<OpenedDoc> {
    const contents = await this.backend.read(this.target);
    this.known = { bytes: decodeBase64(contents.base64), sha256: contents.sha256 };
    return this.known;
  }

  async save(bytes: Uint8Array, options: { readonly force?: boolean } = {}): Promise<SaveOutcome> {
    const result = await this.backend.write({
      ...this.target,
      base64: encodeBase64(bytes),
      expectedSha256: this.known?.sha256 ?? null,
      ...(options.force === true ? { force: true } : {}),
    });
    if (result._tag === "conflict") {
      return {
        status: "conflict",
        theirs:
          result.current === null
            ? null
            : { bytes: decodeBase64(result.current.base64), sha256: result.current.sha256 },
      };
    }
    this.known = { bytes, sha256: result.stamp.sha256 };
    return { status: "saved", sha256: result.stamp.sha256, versionId: result.versionId };
  }

  /** "Reload": their version becomes what the editor knows. */
  adopt(theirs: OpenedDoc): void {
    this.known = theirs;
  }

  /**
   * After a merge onto their version: the next save must match theirs, so a third change in
   * between is caught again.
   */
  rebase(theirs: OpenedDoc): void {
    this.known = theirs;
  }

  /** Whether the file changed on disk since the editor last saw it. */
  async changedOnDisk(): Promise<OpenedDoc | null> {
    const contents = await this.backend.read(this.target);
    if (contents.sha256 === this.known?.sha256) return null;
    return { bytes: decodeBase64(contents.base64), sha256: contents.sha256 };
  }

  versions(): Promise<ReadonlyArray<ZenDocVersion>> {
    return this.backend.versions(this.target);
  }

  async version(versionId: string): Promise<Uint8Array> {
    return decodeBase64((await this.backend.readVersion(this.target, versionId)).base64);
  }
}
