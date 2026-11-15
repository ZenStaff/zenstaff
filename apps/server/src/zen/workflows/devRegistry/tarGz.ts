// @effect-diagnostics nodeBuiltinImport:off - Test and dev helper for pack archives.
// Zen Staff: writes a small ustar .tar.gz (regular files only) for the dev registry server and the
// remote registry tests. The server only reads archives (remoteRegistry.ts). See ZEN.md.
import * as NodeZlib from "node:zlib";

export interface TarEntry {
  readonly path: string;
  readonly data: Uint8Array | string;
  /** "0" file (default), "2" symlink, "5" directory; tests use the others to check refusals. */
  readonly type?: "0" | "2" | "5";
  readonly linkTarget?: string;
}

const field = (header: Buffer, offset: number, length: number, value: string) => {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
};
const octal = (value: number, length: number) => `${value.toString(8).padStart(length - 1, "0")}\0`;

export function writeTarGz(entries: ReadonlyArray<TarEntry>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data;
    const type = entry.type ?? "0";
    const size = type === "0" ? data.byteLength : 0;
    const header = Buffer.alloc(512);
    field(header, 0, 100, entry.path);
    field(header, 100, 8, octal(type === "5" ? 0o755 : 0o644, 8));
    field(header, 108, 8, octal(0, 8));
    field(header, 116, 8, octal(0, 8));
    field(header, 124, 12, octal(size, 12));
    field(header, 136, 12, octal(0, 12));
    header.fill(" ", 148, 156);
    field(header, 156, 1, type);
    if (entry.linkTarget) field(header, 157, 100, entry.linkTarget);
    field(header, 257, 6, "ustar\0");
    field(header, 263, 2, "00");
    let sum = 0;
    for (const byte of header) sum += byte;
    field(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header);
    if (size > 0) {
      blocks.push(Buffer.from(data));
      const pad = (512 - (size % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return NodeZlib.gzipSync(Buffer.concat(blocks));
}
