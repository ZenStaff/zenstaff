// @effect-diagnostics nodeBuiltinImport:off - zlib and Buffer for pack archives.
// Zen Staff: a small ustar .tar.gz of regular files (fixed times and owners, so the same files give
// the same archive), what scripts/zen-publish-packs.ts uploads and remoteRegistry.ts reads.
import * as NodeZlib from "node:zlib";

export interface PackArchiveFile {
  /** Relative path, at most 100 bytes (no ustar prefix field). */
  readonly path: string;
  readonly data: Uint8Array;
}

const field = (header: Buffer, offset: number, length: number, value: string) => {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
};
const octal = (value: number, length: number) => `${value.toString(8).padStart(length - 1, "0")}\0`;

export function writePackArchive(files: ReadonlyArray<PackArchiveFile>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const size = file.data.byteLength;
    const header = Buffer.alloc(512);
    field(header, 0, 100, file.path);
    field(header, 100, 8, octal(0o644, 8));
    field(header, 108, 8, octal(0, 8));
    field(header, 116, 8, octal(0, 8));
    field(header, 124, 12, octal(size, 12));
    field(header, 136, 12, octal(0, 12));
    header.fill(" ", 148, 156);
    field(header, 156, 1, "0");
    field(header, 257, 6, "ustar\0");
    field(header, 263, 2, "00");
    let sum = 0;
    for (const byte of header) sum += byte;
    field(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header);
    if (size > 0) {
      blocks.push(Buffer.from(file.data));
      const pad = (512 - (size % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return NodeZlib.gzipSync(Buffer.concat(blocks));
}
