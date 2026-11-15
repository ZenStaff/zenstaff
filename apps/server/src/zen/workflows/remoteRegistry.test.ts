// @effect-diagnostics nodeBuiltinImport:off - The test serves a registry over node:http and builds a zip.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ZenRegistryEntry } from "@t3tools/contracts/zenOffice";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeZlib from "node:zlib";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { writeTarGz } from "./devRegistry/tarGz.ts";
import {
  mergeRegistryEntries,
  normalizeRegistryUrl,
  packFilesAtRoot,
  readTarGz,
  readZip,
  resolveDownloadUrl,
  safeArchivePath,
  compareRegistryVersions,
  sha256Hex,
  verifyRegistrySignature,
  verifySha256,
} from "./remoteRegistry.ts";
import * as ZenOffice from "./ZenOffice.ts";

const entry = (overrides: Partial<ZenRegistryEntry>): ZenRegistryEntry => ({
  id: "x",
  name: "X",
  description: "X.",
  category: "admin",
  icon: "file-text",
  version: "1.0.0",
  author: "Test",
  kind: "pack",
  ...overrides,
});

/** A stored (uncompressed) zip; enough for yauzl. `mode` sets unix permissions, e.g. a symlink. */
function writeZip(files: ReadonlyArray<{ path: string; data: string; mode?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = Buffer.from(file.data, "utf8");
    const crc = NodeZlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const PACK_ID = "remote-thanks";
const packManifest = {
  id: PACK_ID,
  name: "Remote thank-you",
  description: "A thank-you note from the remote marketplace.",
  category: "admin",
  icon: "heart",
  inputs: [{ id: "person", label: "Who", type: "text", required: true }],
  output: "note.md",
  version: "2.0.0",
  author: "Hub",
};
const packArchive = writeTarGz([
  { path: `${PACK_ID}/`, data: "", type: "5" },
  { path: `${PACK_ID}/workflow.json`, data: JSON.stringify(packManifest) },
  { path: `${PACK_ID}/prompt.md`, data: "Thank {{person}}." },
  { path: `${PACK_ID}/SKILL.md`, data: "Be warm." },
]);

describe("remote registry helpers", () => {
  it("normalizes the registry URL", () => {
    expect(normalizeRegistryUrl(null)).toEqual({ ok: null });
    expect(normalizeRegistryUrl("  ")).toEqual({ ok: null });
    expect(normalizeRegistryUrl(" https://hub.example/registry.json ")).toEqual({
      ok: "https://hub.example/registry.json",
    });
    expect(normalizeRegistryUrl("ftp://hub.example/registry.json")).toHaveProperty("error");
    expect(normalizeRegistryUrl("file:///etc/passwd")).toHaveProperty("error");
    expect(normalizeRegistryUrl("https://me:secret@hub.example/r.json")).toHaveProperty("error");
    expect(normalizeRegistryUrl("not a url")).toHaveProperty("error");
  });

  it("resolves download URLs against the registry URL, http(s) only", () => {
    const base = "https://hub.example/market/registry.json";
    expect(resolveDownloadUrl(base, "packs/a.tar.gz")).toEqual({
      ok: "https://hub.example/market/packs/a.tar.gz",
    });
    expect(resolveDownloadUrl(base, "/files/a.zip")).toEqual({
      ok: "https://hub.example/files/a.zip",
    });
    expect(resolveDownloadUrl(base, "https://cdn.example/a.tar.gz")).toEqual({
      ok: "https://cdn.example/a.tar.gz",
    });
    expect(resolveDownloadUrl(base, "file:///etc/passwd")).toHaveProperty("error");
    expect(resolveDownloadUrl(base, "javascript:alert(1)")).toHaveProperty("error");
  });

  it("verifies sha256", () => {
    const bytes = Buffer.from("hello");
    const hex = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    expect(sha256Hex(bytes)).toBe(hex);
    expect(verifySha256(bytes, hex)).toBe(true);
    expect(verifySha256(bytes, hex.toUpperCase())).toBe(true);
    expect(verifySha256(bytes, "0".repeat(64))).toBe(false);
    expect(verifySha256(bytes, "abc")).toBe(false);
  });

  it("accepts only safe archive paths", () => {
    expect(safeArchivePath("./a//b.md")).toBe("a/b.md");
    expect(safeArchivePath("pack/workflow.json")).toBe("pack/workflow.json");
    for (const unsafe of ["../x", "a/../../b", "a/..", "/etc/passwd", "C:/x", "a\\b", "", "a\0b"]) {
      expect(safeArchivePath(unsafe), unsafe).toBeNull();
    }
  });

  it("reads tar.gz packs and refuses links, traversal and junk input", () => {
    const read = readTarGz(packArchive);
    if ("error" in read) throw new Error(read.error);
    expect(read.ok.map((file) => file.path)).toEqual([
      `${PACK_ID}/workflow.json`,
      `${PACK_ID}/prompt.md`,
      `${PACK_ID}/SKILL.md`,
    ]);
    const link = readTarGz(
      writeTarGz([{ path: "p/workflow.json", data: "", type: "2", linkTarget: "/etc/passwd" }]),
    );
    expect(link).toHaveProperty("error");
    expect(readTarGz(writeTarGz([{ path: "../evil.md", data: "x" }]))).toHaveProperty("error");
    expect(readTarGz(writeTarGz([{ path: "/abs.md", data: "x" }]))).toHaveProperty("error");
    expect(readTarGz(Buffer.from("not gzip"))).toHaveProperty("error");
  });

  it("reads zip packs and refuses links and traversal", async () => {
    const read = await readZip(
      writeZip([
        { path: "workflow.json", data: "{}" },
        { path: "prompt.md", data: "Hi" },
      ]),
    );
    if ("error" in read) throw new Error(read.error);
    expect(read.ok.map((file) => [file.path, Buffer.from(file.data).toString()])).toEqual([
      ["workflow.json", "{}"],
      ["prompt.md", "Hi"],
    ]);
    const link = await readZip(writeZip([{ path: "a", data: "/etc/passwd", mode: 0o120777 }]));
    expect(link).toHaveProperty("error");
    expect(await readZip(writeZip([{ path: "../evil.md", data: "x" }]))).toHaveProperty("error");
    expect(await readZip(Buffer.from("not a zip"))).toHaveProperty("error");
  });

  it("finds the workflow folder at the root or in one top folder", () => {
    const file = (path: string) => ({ path, data: new Uint8Array() });
    expect(packFilesAtRoot([file("workflow.json"), file("prompt.md")])).toEqual({
      ok: [file("workflow.json"), file("prompt.md")],
    });
    expect(packFilesAtRoot([file("p/workflow.json"), file("p/assets/a.png")])).toEqual({
      ok: [file("workflow.json"), file("assets/a.png")],
    });
    expect(packFilesAtRoot([file("a/workflow.json"), file("b/prompt.md")])).toHaveProperty("error");
    expect(packFilesAtRoot([])).toHaveProperty("error");
  });

  it("merges newer remote entries over bundled packs, keeping bundled built-ins", () => {
    const local = [
      entry({ id: "included", kind: "builtin" }),
      entry({ id: "shared-pack", version: "1.0.0", path: "packs/shared-pack" }),
      entry({ id: "soon", kind: "coming_soon" }),
    ];
    const remote = [
      entry({ id: "included", kind: "pack", version: "9.9.9" }),
      entry({ id: "shared-pack", version: "2.0.0" }),
      entry({ id: "unknown-builtin", kind: "builtin" }),
      entry({ id: "new-pack" }),
      // Same version as the bundled one: the bundled copy stays.
      entry({ id: "soon", kind: "pack", version: "1.0.0" }),
    ];
    const merged = mergeRegistryEntries(local, remote);
    expect(merged.map((item) => [item.entry.id, item.origin, item.entry.version])).toEqual([
      ["included", "local", "1.0.0"],
      ["shared-pack", "remote", "2.0.0"],
      ["soon", "local", "1.0.0"],
      ["new-pack", "remote", "1.0.0"],
    ]);
  });
});

/** The test's own registry signing key (the app embeds the real public key). */
const signingKeys = NodeCrypto.generateKeyPairSync("ed25519");
const TEST_PUBLIC_KEY = signingKeys.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");
const signIndex = (bytes: Uint8Array) =>
  NodeCrypto.sign(null, bytes, signingKeys.privateKey).toString("base64");

describe("registry signature", () => {
  const index = new TextEncoder().encode(JSON.stringify({ version: 1, entries: [] }));
  it("accepts the index signed with the embedded key", () => {
    expect(verifyRegistrySignature(index, signIndex(index), TEST_PUBLIC_KEY)).toBe(true);
  });
  it("refuses a missing, empty, malformed or foreign signature, and a changed index", () => {
    expect(verifyRegistrySignature(index, null, TEST_PUBLIC_KEY)).toBe(false);
    expect(verifyRegistrySignature(index, " ", TEST_PUBLIC_KEY)).toBe(false);
    expect(verifyRegistrySignature(index, "not base64!", TEST_PUBLIC_KEY)).toBe(false);
    const other = NodeCrypto.generateKeyPairSync("ed25519");
    const foreign = NodeCrypto.sign(null, index, other.privateKey).toString("base64");
    expect(verifyRegistrySignature(index, foreign, TEST_PUBLIC_KEY)).toBe(false);
    const changed = new TextEncoder().encode(JSON.stringify({ version: 1, entries: [1] }));
    expect(verifyRegistrySignature(changed, signIndex(index), TEST_PUBLIC_KEY)).toBe(false);
    expect(verifyRegistrySignature(index, signIndex(index), "bad key")).toBe(false);
  });
  it("orders versions numerically", () => {
    expect(compareRegistryVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareRegistryVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareRegistryVersions("1.0.0", "1.1")).toBe(-1);
  });
});

interface Hub {
  readonly url: string;
  /** Serves this sha256 for the pack (defaults to the right one). */
  checksum: string;
  /** The index signature it serves: valid (default), invalid (another key) or missing. */
  signature: "valid" | "invalid" | "missing";
  readonly close: Effect.Effect<void>;
}

/** A registry on 127.0.0.1 with one remote pack. */
const startHub = Effect.acquireRelease(
  Effect.callback<Hub>((resume) => {
    let checksum = sha256Hex(packArchive);
    let signature: Hub["signature"] = "valid";
    const indexBytes = () =>
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          entries: [
            entry({
              id: PACK_ID,
              name: packManifest.name,
              version: packManifest.version,
              download: { url: `packs/${PACK_ID}.tar.gz`, sha256: checksum },
            }),
          ],
        }),
      );
    const server = NodeHttp.createServer((request, response) => {
      if (request.url === "/market/registry.json.sig") {
        if (signature === "missing") {
          response.writeHead(404);
          response.end();
          return;
        }
        const bytes = indexBytes();
        const sig =
          signature === "valid"
            ? signIndex(bytes)
            : NodeCrypto.sign(
                null,
                bytes,
                NodeCrypto.generateKeyPairSync("ed25519").privateKey,
              ).toString("base64");
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(sig);
      } else if (request.url === "/market/registry.json") {
        response.writeHead(200, { "content-type": "application/json" });
        // The same bytes the signature covers.
        response.end(indexBytes());
      } else if (request.url === `/market/packs/${PACK_ID}.tar.gz`) {
        response.writeHead(200, { "content-type": "application/gzip" });
        response.end(packArchive);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    const close = Effect.callback<void>((done) => {
      if (!server.listening) return done(Effect.void);
      server.closeAllConnections();
      server.close(() => done(Effect.void));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as NodeNet.AddressInfo;
      const hub: Hub = {
        url: `http://127.0.0.1:${port}/market/registry.json`,
        get checksum() {
          return checksum;
        },
        set checksum(value: string) {
          checksum = value;
        },
        get signature() {
          return signature;
        },
        set signature(value: Hub["signature"]) {
          signature = value;
        },
        close,
      };
      resume(Effect.succeed(hub));
    });
  }),
  (hub) => hub.close,
);

const makeOffice = (baseDir: string, registryUrl: string | null) =>
  ZenOffice.make({
    defaultRegistryUrl: registryUrl,
    remoteRegistryTtlMs: 0,
    registryPublicKey: TEST_PUBLIC_KEY,
  }).pipe(Effect.provide(ServerConfig.ServerConfig.layerTest(baseDir, baseDir)));

it.layer(Layer.mergeAll(NodeServices.layer, SqlitePersistence.layerMemory))(
  "ZenOffice remote registry",
  (it) => {
    it.effect("lists, installs and verifies remote packs, then falls back to the cache", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const hub = yield* startHub;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-remote-" });
        const office = yield* makeOffice(baseDir, hub.url);
        const packDir = path.join(baseDir, "workflows", PACK_ID);

        const market = yield* office.registry;
        expect(market).toMatchObject({ source: hub.url, sourceKind: "remote", notice: null });
        const remote = market.entries.find((item) => item.entry.id === PACK_ID);
        expect(remote).toMatchObject({ installed: false });
        // The bundled built-ins and packs are still there.
        expect(market.entries.filter((item) => item.entry.kind === "builtin")).toHaveLength(7);
        expect(market.entries.some((item) => item.entry.id === "customer-reply")).toBe(true);

        hub.checksum = "f".repeat(64);
        const refused = yield* office.installPack({ id: PACK_ID }).pipe(Effect.flip);
        expect(refused.reason).toBe("invalid");
        expect(refused.detail).toContain("checksum");
        expect(yield* fs.exists(packDir)).toBe(false);
        const staging = path.join(baseDir, "caches", "zen-pack-staging");
        expect(yield* fs.readDirectory(staging).pipe(Effect.orElseSucceed(() => []))).toEqual([]);

        hub.checksum = sha256Hex(packArchive);
        const installed = yield* office.installPack({ id: PACK_ID });
        expect(installed.entries.find((item) => item.entry.id === PACK_ID)).toMatchObject({
          installed: true,
          installedVersion: "2.0.0",
        });
        const listed = yield* office.listWorkflows({});
        expect(listed.workflows.find((item) => item.manifest.id === PACK_ID)).toMatchObject({
          source: "user",
          packId: PACK_ID,
          editable: false,
          skill: "Be warm.",
        });

        yield* hub.close;
        const offline = yield* office.registry;
        expect(offline.sourceKind).toBe("cache");
        expect(offline.notice).toContain("could not be reached");
        expect(offline.entries.find((item) => item.entry.id === PACK_ID)?.installed).toBe(true);

        const removed = yield* office.uninstallPack({ id: PACK_ID });
        expect(removed.entries.find((item) => item.entry.id === PACK_ID)?.installed).toBe(false);
        expect(yield* fs.exists(packDir)).toBe(false);
      }),
    );

    it.effect("ignores an index whose signature is missing or not ours", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const hub = yield* startHub;
        for (const mode of ["missing", "invalid"] as const) {
          hub.signature = mode;
          const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: `zen-office-sig-${mode}-` });
          const office = yield* makeOffice(baseDir, hub.url);
          const market = yield* office.registry;
          expect(market.sourceKind).toBe("local");
          expect(market.notice).toContain("signature is missing or not valid");
          expect(market.entries.some((item) => item.entry.id === PACK_ID)).toBe(false);
          expect(market.entries.filter((item) => item.entry.kind === "builtin")).toHaveLength(7);
        }
        // Signed again: the remote pack is offered.
        hub.signature = "valid";
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-sig-ok-" });
        const office = yield* makeOffice(baseDir, hub.url);
        const market = yield* office.registry;
        expect(market.sourceKind).toBe("remote");
        expect(market.entries.some((item) => item.entry.id === PACK_ID)).toBe(true);
      }),
    );

    it.effect("without a cache an unreachable registry shows the bundled one with a notice", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const hub = yield* startHub;
        yield* hub.close;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-remote-down-" });
        const office = yield* makeOffice(baseDir, hub.url);
        const market = yield* office.registry;
        expect(market.sourceKind).toBe("local");
        expect(market.notice).toContain("could not be reached");
        expect(market.entries.some((item) => item.entry.id === PACK_ID)).toBe(false);
        expect(market.entries.filter((item) => item.entry.kind === "builtin")).toHaveLength(7);
      }),
    );

    it.effect("saves the registry URL; null means bundled only; bad URLs are refused", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "zen-office-remote-url-" });
        const office = yield* makeOffice(baseDir, "https://env.example/registry.json");
        expect((yield* office.settings).registryUrl).toBe("https://env.example/registry.json");
        const saved = yield* office.setRegistryUrl({ url: " https://hub.example/r.json " });
        expect(saved.registryUrl).toBe("https://hub.example/r.json");
        const cleared = yield* office.setRegistryUrl({ url: null });
        expect(cleared.registryUrl).toBeNull();
        const market = yield* office.registry;
        expect(market).toMatchObject({ sourceKind: "local", notice: null });
        const bad = yield* office.setRegistryUrl({ url: "file:///etc/passwd" }).pipe(Effect.flip);
        expect(bad.reason).toBe("invalid");
      }),
    );
  },
);
