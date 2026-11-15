// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- tests the plain Node store on a temp folder.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  DocFailure,
  listVersions,
  readNotes,
  readVersion,
  resolveDocPath,
  sha256Hex,
  writeDoc,
  writeNotes,
} from "./docStore.ts";

const encode = (text: string) => new TextEncoder().encode(text);

async function sandbox() {
  const base = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "zen-docs-"));
  const root = NodePath.join(base, "work");
  const versions = NodePath.join(base, "state", "doc-versions");
  await NodeFSP.mkdir(NodePath.join(root, "rapoarte"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(root, "rapoarte", "vanzari.csv"),
    "produs,pret\nciorba,18\n",
  );
  return {
    base,
    root,
    versions,
    [Symbol.asyncDispose]: () => NodeFSP.rm(base, { recursive: true, force: true }),
  };
}

const reasonOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof DocFailure ? error.reason : String(error)),
  );

describe("resolveDocPath", () => {
  it("resolves files in the folder and refuses escapes, .git, links out and other formats", async () => {
    await using box = await sandbox();
    const ok = await resolveDocPath(box.root, "rapoarte/vanzari.csv", { write: true });
    expect(ok).toMatchObject({ relativePath: "rapoarte/vanzari.csv", exists: true });
    await NodeFSP.writeFile(NodePath.join(box.base, "secret.csv"), "x");
    await NodeFSP.symlink(
      NodePath.join(box.base, "secret.csv"),
      NodePath.join(box.root, "link.csv"),
    );
    await NodeFSP.symlink(box.base, NodePath.join(box.root, "out"));
    expect(
      await Promise.all([
        reasonOf(resolveDocPath(box.root, "../secret.csv", { write: false })),
        reasonOf(resolveDocPath(box.root, "/etc/passwd.csv", { write: false })),
        reasonOf(resolveDocPath(box.root, ".git/config.md", { write: true })),
        reasonOf(resolveDocPath(box.root, "link.csv", { write: true })),
        reasonOf(resolveDocPath(box.root, "out/new.csv", { write: true })),
        reasonOf(resolveDocPath(box.root, "script.sh", { write: true })),
        reasonOf(resolveDocPath(box.root, "scan.pdf", { write: true })),
        reasonOf(resolveDocPath(box.root, "rapoarte", { write: false })),
      ]),
    ).toEqual([
      "outside-workspace",
      "outside-workspace",
      "outside-workspace",
      "outside-workspace",
      "outside-workspace",
      "invalid-input",
      "invalid-input",
      "invalid-input",
    ]);
    expect(await resolveDocPath(box.root, "nou/lista.md", { write: true })).toMatchObject({
      exists: false,
    });
  });
});

describe("writeDoc", () => {
  it("saves when the hash matches, keeps the old bytes as a version, refuses a stale hash", async () => {
    await using box = await sandbox();
    const file = NodePath.join(box.root, "rapoarte", "vanzari.csv");
    const opened = sha256Hex(new Uint8Array(await NodeFSP.readFile(file)));
    NodeFS.chmodSync(file, 0o640);

    const saved = await writeDoc({
      realPath: file,
      bytes: encode("produs,pret\nciorba,19\n"),
      expectedSha256: opened,
      force: false,
      versionsRoot: box.versions,
    });
    expect(saved._tag).toBe("saved");
    expect(await NodeFSP.readFile(file, "utf8")).toBe("produs,pret\nciorba,19\n");
    expect(NodeFS.statSync(file).mode & 0o777).toBe(0o640);
    // No temp file is left next to it.
    expect(await NodeFSP.readdir(NodePath.dirname(file))).toEqual(["vanzari.csv"]);

    // The agent changes the file; the editor still holds the first hash.
    await NodeFSP.writeFile(file, "produs,pret\nciorba,21\n");
    const conflict = await writeDoc({
      realPath: file,
      bytes: encode("produs,pret\nciorba,20\n"),
      expectedSha256: opened,
      force: false,
      versionsRoot: box.versions,
    });
    expect(conflict._tag).toBe("conflict");
    expect(
      conflict._tag === "conflict" ? new TextDecoder().decode(conflict.current!.bytes) : null,
    ).toBe("produs,pret\nciorba,21\n");
    expect(await NodeFSP.readFile(file, "utf8")).toBe("produs,pret\nciorba,21\n");

    // "Keep mine" after the warning.
    const forced = await writeDoc({
      realPath: file,
      bytes: encode("produs,pret\nciorba,20\n"),
      expectedSha256: opened,
      force: true,
      versionsRoot: box.versions,
    });
    expect(forced._tag).toBe("saved");

    const versions = await listVersions(box.versions, file);
    expect(versions.map((version) => version.size)).toEqual([22, 22]);
    const oldest = await readVersion(box.versions, file, versions.at(-1)!.id);
    expect(new TextDecoder().decode(oldest.bytes)).toBe("produs,pret\nciorba,18\n");
    expect(await reasonOf(readVersion(box.versions, file, "nope"))).toBe("not-found");
  });

  it("creates a new file only when none exists and keeps at most N versions", async () => {
    await using box = await sandbox();
    const file = NodePath.join(box.root, "nou", "lista.md");
    const created = await writeDoc({
      realPath: file,
      bytes: encode("# 1"),
      expectedSha256: null,
      force: false,
      versionsRoot: box.versions,
    });
    expect(created).toMatchObject({ _tag: "saved", versionId: null });
    const again = await writeDoc({
      realPath: file,
      bytes: encode("# 2"),
      expectedSha256: null,
      force: false,
      versionsRoot: box.versions,
    });
    expect(again._tag).toBe("conflict");
    let hash = sha256Hex(encode("# 1"));
    for (let index = 2; index <= 6; index += 1) {
      const result = await writeDoc({
        realPath: file,
        bytes: encode(`# ${index}`),
        expectedSha256: hash,
        force: false,
        versionsRoot: box.versions,
        maxVersions: 3,
        now: new Date(Date.UTC(2026, 10, index)),
      });
      expect(result._tag).toBe("saved");
      hash = sha256Hex(encode(`# ${index}`));
    }
    const versions = await listVersions(box.versions, file);
    expect(versions).toHaveLength(3);
    const newest = await readVersion(box.versions, file, versions[0]!.id);
    expect(new TextDecoder().decode(newest.bytes)).toBe("# 5");
    const dir = NodePath.dirname(NodePath.join(box.versions, "x"));
    const stored = (await NodeFSP.readdir(dir, { recursive: true })).filter((name) =>
      String(name).endsWith(".bin"),
    );
    expect(stored).toHaveLength(3);
  });

  it("serializes concurrent saves of one file: only the first with the old hash wins", async () => {
    await using box = await sandbox();
    const file = NodePath.join(box.root, "rapoarte", "vanzari.csv");
    const opened = sha256Hex(new Uint8Array(await NodeFSP.readFile(file)));
    const results = await Promise.all(
      ["a", "b", "c"].map((value) =>
        writeDoc({
          realPath: file,
          bytes: encode(value),
          expectedSha256: opened,
          force: false,
          versionsRoot: box.versions,
        }),
      ),
    );
    expect(results.map((result) => result._tag)).toEqual(["saved", "conflict", "conflict"]);
  });
});

describe("notes", () => {
  it("keeps PDF notes per file on this machine", async () => {
    await using box = await sandbox();
    const file = NodePath.join(box.root, "contract.pdf");
    expect(await readNotes(box.versions, file)).toEqual([]);
    const note = {
      id: "n1",
      page: 2,
      text: "Verifică termenul",
      createdAt: "2026-11-08T10:00:00.000Z",
    };
    await writeNotes(box.versions, file, [note]);
    expect(await readNotes(box.versions, file)).toEqual([note]);
  });
});
