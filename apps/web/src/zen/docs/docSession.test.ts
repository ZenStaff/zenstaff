// The editor's save path against fake environments: one local, one remote, each owning its own
// files, with an "agent" changing a file between open and save.
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

import type {
  ZenDocContents,
  ZenDocTarget,
  ZenDocVersion,
  ZenDocWriteInput,
  ZenDocWriteResult,
} from "@t3tools/contracts/zenDocs";
import { describe, expect, it } from "vite-plus/test";

import { parseCsv, serializeCsv } from "./csv";
import { DocSession, decodeBase64, encodeBase64, type DocBackend } from "./docSession";
import { mergeText } from "./textMerge";

const sha = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** An environment's file store, answering like the zen.docs RPCs. */
class FakeEnvironment implements DocBackend {
  readonly files = new Map<string, Uint8Array>();
  readonly history = new Map<string, Array<Uint8Array>>();
  writes = 0;
  constructor(readonly name: string) {}
  private key(target: ZenDocTarget) {
    return `${target.cwd}/${target.relativePath}`;
  }
  private contents(target: ZenDocTarget, bytes: Uint8Array): ZenDocContents {
    return {
      relativePath: target.relativePath,
      base64: encodeBase64(bytes),
      sha256: sha(bytes),
      size: bytes.length,
      mtimeMs: 1,
    };
  }
  async read(target: ZenDocTarget): Promise<ZenDocContents> {
    const bytes = this.files.get(this.key(target));
    if (bytes === undefined) throw new Error(`${this.name}: not found`);
    return this.contents(target, bytes);
  }
  async write(input: ZenDocWriteInput): Promise<ZenDocWriteResult> {
    const key = this.key(input);
    const current = this.files.get(key);
    const matches =
      input.expectedSha256 === null
        ? current === undefined
        : current !== undefined && sha(current) === input.expectedSha256;
    if (!matches && input.force !== true) {
      return {
        _tag: "conflict",
        current: current === undefined ? null : this.contents(input, current),
      };
    }
    if (current !== undefined) this.history.set(key, [...(this.history.get(key) ?? []), current]);
    const bytes = decodeBase64(input.base64);
    this.files.set(key, bytes);
    this.writes += 1;
    return {
      _tag: "saved",
      stamp: { sha256: sha(bytes), size: bytes.length, mtimeMs: 2 },
      versionId: current === undefined ? null : `v${this.history.get(key)!.length}`,
    };
  }
  async versions(target: ZenDocTarget): Promise<ReadonlyArray<ZenDocVersion>> {
    return (this.history.get(this.key(target)) ?? []).map((bytes, index) => ({
      id: `v${index + 1}`,
      savedAt: "",
      size: bytes.length,
      sha256: sha(bytes),
    }));
  }
  async readVersion(target: ZenDocTarget, versionId: string): Promise<ZenDocContents> {
    const bytes = this.history.get(this.key(target))?.[Number(versionId.slice(1)) - 1];
    if (bytes === undefined) throw new Error("no version");
    return this.contents(target, bytes);
  }
}

const target = { cwd: "/srv/acme", relativePath: "rapoarte/vanzari.csv" };

describe("DocSession", () => {
  it("saves to the environment that owns the file, not the local one", async () => {
    const local = new FakeEnvironment("local");
    const remote = new FakeEnvironment("vps");
    remote.files.set("/srv/acme/rapoarte/vanzari.csv", bytesOf("produs,pret\nciorba,18\n"));
    const session = new DocSession(remote, target);
    const opened = await session.open();
    const grid = parseCsv(textOf(opened.bytes));
    grid.rows[1]![1] = "19";
    const saved = await session.save(bytesOf(serializeCsv(grid)));
    expect(saved.status).toBe("saved");
    expect(textOf(remote.files.get("/srv/acme/rapoarte/vanzari.csv")!)).toBe(
      "produs,pret\nciorba,19\n",
    );
    expect(local.files.size).toBe(0);
    expect(local.writes).toBe(0);
    // A second save continues from the saved hash, without a false conflict.
    expect((await session.save(bytesOf("produs,pret\nciorba,20\n"))).status).toBe("saved");
    expect((await session.versions()).map((version) => version.id)).toEqual(["v1", "v2"]);
    expect(textOf(await session.version("v1"))).toBe("produs,pret\nciorba,18\n");
  });

  it("detects a change by the agent, merges onto it, and catches a third change too", async () => {
    const remote = new FakeEnvironment("vps");
    remote.files.set(
      "/srv/acme/rapoarte/vanzari.csv",
      bytesOf("produs,pret\nciorba,18\nmici,5\nsarmale,32\n"),
    );
    const session = new DocSession(remote, target);
    const opened = await session.open();
    const mine = "produs,pret\nciorba,19\nmici,5\nsarmale,32\n";
    // The agent edits another line while the person is editing.
    remote.files.set(
      "/srv/acme/rapoarte/vanzari.csv",
      bytesOf("produs,pret\nciorba,18\nmici,5\nsarmale,35\n"),
    );
    expect(await session.changedOnDisk()).not.toBeNull();

    const first = await session.save(bytesOf(mine));
    expect(first.status).toBe("conflict");
    expect(textOf(remote.files.get("/srv/acme/rapoarte/vanzari.csv")!)).toBe(
      "produs,pret\nciorba,18\nmici,5\nsarmale,35\n",
    );
    if (first.status !== "conflict" || first.theirs === null)
      throw new Error("expected their version");

    const merged = mergeText(textOf(opened.bytes), mine, textOf(first.theirs.bytes));
    expect(merged).toEqual({ text: "produs,pret\nciorba,19\nmici,5\nsarmale,35\n", conflicts: 0 });
    session.rebase(first.theirs);
    remote.files.set(
      "/srv/acme/rapoarte/vanzari.csv",
      bytesOf("produs,pret\nciorba,1\nsarmale,35\n"),
    );
    expect((await session.save(bytesOf(merged.text))).status).toBe("conflict");

    // "Keep mine" is an explicit overwrite; the replaced bytes stay as a version.
    expect((await session.save(bytesOf(merged.text), { force: true })).status).toBe("saved");
    expect(textOf(remote.files.get("/srv/acme/rapoarte/vanzari.csv")!)).toBe(merged.text);
    expect(textOf(await session.version("v1"))).toBe("produs,pret\nciorba,1\nsarmale,35\n");
  });

  it("reload adopts their version as the new base", async () => {
    const remote = new FakeEnvironment("vps");
    remote.files.set("/srv/acme/rapoarte/vanzari.csv", bytesOf("a\n"));
    const session = new DocSession(remote, target);
    await session.open();
    remote.files.set("/srv/acme/rapoarte/vanzari.csv", bytesOf("b\n"));
    const theirs = await session.changedOnDisk();
    session.adopt(theirs!);
    expect(await session.changedOnDisk()).toBeNull();
    expect((await session.save(bytesOf("c\n"))).status).toBe("saved");
  });

  it("base64 survives every byte value", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });
});
