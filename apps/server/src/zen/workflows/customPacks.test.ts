import { describe, expect, it } from "@effect/vitest";

import {
  CONFLICT_OURS,
  CONFLICT_THEIRS,
  compareVersions,
  conflictFilesOf,
  customIdFor,
  customThreadMessage,
  draftChanges,
  folderDiff,
  guardedChanges,
  hasConflictMarkers,
  isPackContent,
  jsonStringField,
  mergeFolders,
  mergeManifest,
  mergeText,
  parseChecks,
  parseCustomMarker,
  unifiedDiff,
  updateOffered,
} from "./customPacks.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const files = (record: Record<string, string | Uint8Array>) =>
  new Map(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? enc.encode(value) : value,
    ]),
  );
const lines = (...items: string[]) => `${items.join("\n")}\n`;

describe("customized packs: ids, versions, markers", () => {
  it("names the company and personal copies", () => {
    expect(customIdFor("social-reels-kit", "company")).toBe("social-reels-kit@firma");
    expect(customIdFor("social-reels-kit", "user")).toBe("social-reels-kit@personal");
  });

  it("compares versions numerically and offers only newer, not declined ones", () => {
    expect(compareVersions("2.10.0", "2.9.1")).toBe(1);
    expect(compareVersions("2.0.0", "2.0")).toBe(0);
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
    const marker = { origin: { version: "2.0.0" }, declinedVersion: null } as never;
    expect(updateOffered(marker, "2.1.0")).toBe("2.1.0");
    expect(updateOffered(marker, "2.0.0")).toBeNull();
    expect(updateOffered(marker, null)).toBeNull();
    const declined = { origin: { version: "2.0.0" }, declinedVersion: "2.1.0" } as never;
    expect(updateOffered(declined, "2.1.0")).toBeNull();
    expect(updateOffered(declined, "2.2.0")).toBe("2.2.0");
  });

  it("parses the marker and rejects a broken one", () => {
    const marker = {
      customId: "x@firma",
      scope: "company",
      companyId: "acme",
      origin: { packId: "x", workflowId: "x", version: "1.0.0", kind: "pack" },
      revision: 1,
      request: "mai încet",
      declinedVersion: null,
      updatedAt: "2026-11-08T10:00:00.000Z",
    };
    expect(parseCustomMarker(JSON.stringify(marker))?.customId).toBe("x@firma");
    expect(parseCustomMarker("{nope")).toBeNull();
    expect(parseCustomMarker(JSON.stringify({ ...marker, scope: "everyone" }))).toBeNull();
    expect(parseCustomMarker(null)).toBeNull();
  });

  it("keeps bookkeeping, meta and renders out of the pack content", () => {
    expect(isPackContent("prompt.md")).toBe(true);
    expect(isPackContent("template/src/Reel.jsx")).toBe(true);
    expect(isPackContent(".zen-custom.json")).toBe(false);
    expect(isPackContent(".zen-pack.json")).toBe(false);
    expect(isPackContent(".zen-custom/base/prompt.md")).toBe(false);
    expect(isPackContent("template/node_modules/x/index.js")).toBe(false);
    expect(isPackContent("kit/.zen-pack.json")).toBe(true);
  });

  it("reads small JSON fields and merge reports without throwing", () => {
    expect(jsonStringField('{"name":"Reels"}', "name")).toBe("Reels");
    expect(jsonStringField('{"name":3}', "name")).toBeNull();
    expect(jsonStringField("{", "name")).toBeNull();
    expect(conflictFilesOf('[{"path":"a","conflicts":2},{"path":"b","conflicts":0}]')).toEqual([
      "a",
    ]);
    expect(conflictFilesOf("nope")).toEqual([]);
    expect(parseChecks('{"passed":true,"summary":"ok"}')).toEqual({
      passed: true,
      summary: "ok",
      commands: [],
    });
    expect(parseChecks('{"passed":"yes"}')).toBeNull();
  });
});

describe("customized packs: guarded workflow.json keys", () => {
  const base = JSON.stringify({
    id: "reels",
    name: "Reels",
    requires: { tools: [{ id: "ffmpeg" }] },
    unattended: { commands: ["node render.mjs"] },
  });
  it("allows name, prompt-level and input changes", () => {
    const changed = JSON.stringify({ ...JSON.parse(base), name: "Reels firma", inputs: [] });
    expect(guardedChanges(base, changed)).toEqual([]);
  });
  it("flags tools, access, scheduled-run rules and the id", () => {
    const more = JSON.parse(base);
    more.requires.tools.push({ id: "curl" });
    more.unattended.commands.push("rm -rf /");
    more.access = { tier: "enterprise" };
    more.id = "other";
    expect(guardedChanges(base, JSON.stringify(more))).toEqual([
      "id",
      "access",
      "unattended",
      "requires",
    ]);
  });
  it("ignores key order", () => {
    const reordered =
      '{"unattended":{"commands":["node render.mjs"]},"requires":{"tools":[{"id":"ffmpeg"}]},"name":"Reels","id":"reels"}';
    expect(guardedChanges(base, reordered)).toEqual([]);
  });
});

describe("customized packs: diff", () => {
  it("writes a git-style unified diff with context", () => {
    const before = lines("a", "b", "c", "d", "e", "f", "g", "h", "i", "j");
    const after = lines("a", "b", "c", "d", "E", "f", "g", "h", "i", "j", "k");
    const diff = unifiedDiff("prompt.md", before, after);
    expect(diff).toContain("--- a/prompt.md\n+++ b/prompt.md\n");
    expect(diff).toContain("@@ -2,9 +2,10 @@");
    expect(diff).toContain("-e\n+E\n");
    expect(diff).toContain("+k\n");
    expect(unifiedDiff("x", before, before)).toBe("");
    expect(unifiedDiff("new.md", null, "hi\n")).toContain(
      "--- /dev/null\n+++ b/new.md\n@@ -0,0 +1,1 @@\n+hi",
    );
  });

  it("lists added, removed, changed and conflicted files and diffs the folder", () => {
    const before = files({ "a.md": "one\n", "b.md": "two\n", "img.png": new Uint8Array([0, 1]) });
    const after = files({
      "a.md": "one\nmore\n",
      "c.md": `${CONFLICT_OURS}\nx\n=======\ny\n${CONFLICT_THEIRS}\n`,
      "img.png": new Uint8Array([0, 2]),
    });
    expect(draftChanges(before, after)).toEqual([
      { path: "a.md", change: "changed" },
      { path: "b.md", change: "removed" },
      { path: "c.md", change: "conflict" },
      { path: "img.png", change: "changed" },
    ]);
    const { diff, truncated } = folderDiff(before, after);
    expect(truncated).toBe(false);
    expect(diff).toContain("+more");
    expect(diff).toContain("+++ /dev/null");
    expect(diff).toContain("Binary file img.png changed");
    expect(folderDiff(before, after, 10).truncated).toBe(true);
  });
});

describe("customized packs: 3-way merge", () => {
  const base = lines("title", "music 0.3", "voice none", "font Inter", "end");

  it("takes changes made on one side only, from both sides", () => {
    const ours = lines("title", "music 0.15", "voice none", "font Inter", "end");
    const theirs = lines(
      "title",
      "music 0.3",
      "voice piper",
      "font Source Sans 3",
      "end",
      "duck 12",
    );
    const merged = mergeText(base, ours, theirs);
    expect(merged.conflicts).toBe(0);
    expect(merged.text).toBe(
      lines("title", "music 0.15", "voice piper", "font Source Sans 3", "end", "duck 12"),
    );
  });

  it("takes the same change once", () => {
    const both = lines("title", "music 0.2", "voice none", "font Inter", "end");
    expect(mergeText(base, both, both)).toEqual({ text: both, conflicts: 0 });
  });

  it("marks different changes to the same lines as a conflict with all three versions", () => {
    const ours = lines("title", "music 0.15", "voice none", "font Inter", "end");
    const theirs = lines("title", "music 0.25 ducked", "voice none", "font Inter", "end");
    const merged = mergeText(base, ours, theirs);
    expect(merged.conflicts).toBe(1);
    expect(hasConflictMarkers(merged.text)).toBe(true);
    expect(merged.text).toContain(`${CONFLICT_OURS}\nmusic 0.15\n`);
    expect(merged.text).toContain("music 0.3\n=======\nmusic 0.25 ducked\n");
    expect(merged.text.startsWith("title\n")).toBe(true);
    expect(merged.text.endsWith("voice none\nfont Inter\nend\n")).toBe(true);
  });

  it("keeps insertions from both sides at different places", () => {
    const ours = lines("logo ours", ...base.trim().split("\n"));
    const theirs = lines(...base.trim().split("\n"), "new section");
    const merged = mergeText(base, ours, theirs);
    expect(merged.conflicts).toBe(0);
    expect(merged.text).toBe(
      lines("logo ours", "title", "music 0.3", "voice none", "font Inter", "end", "new section"),
    );
  });

  it("merges folders: text, binaries, added and removed files", () => {
    const merged = mergeFolders(
      files({
        "prompt.md": base,
        "logo.png": new Uint8Array([0, 1]),
        "old.md": "x\n",
        "same.md": "s\n",
      }),
      files({
        "prompt.md": lines("title", "music 0.15", "voice none", "font Inter", "end"),
        "logo.png": new Uint8Array([0, 9]),
        "old.md": "x changed\n",
        "same.md": "s\n",
        "brand.md": "ours\n",
      }),
      files({
        "prompt.md": lines("title", "music 0.3", "voice piper", "font Inter", "end"),
        "logo.png": new Uint8Array([0, 7]),
        "same.md": "s\n",
        "voice.mjs": "export {}\n",
      }),
    );
    const byPath = Object.fromEntries(merged.map((file) => [file.path, file]));
    expect(byPath["prompt.md"]!.outcome).toBe("merged");
    expect(dec.decode(byPath["prompt.md"]!.bytes!)).toContain("music 0.15\nvoice piper");
    expect(byPath["logo.png"]!.outcome).toBe("binary-conflict");
    expect([...byPath["logo.png"]!.bytes!]).toEqual([0, 9]);
    expect([...byPath["logo.new.png"]!.bytes!]).toEqual([0, 7]);
    // Theirs removed a file ours changed: kept, flagged.
    expect(byPath["old.md"]!.outcome).toBe("conflict");
    expect(byPath["same.md"]!.outcome).toBe("unchanged");
    expect(byPath["brand.md"]!.outcome).toBe("ours");
    expect(byPath["voice.mjs"]!.outcome).toBe("theirs");
  });

  it("workflow.json: guarded keys and version from theirs, the person's labels kept", () => {
    const b = JSON.stringify({
      id: "r",
      name: "Reels",
      version: "2.0.0",
      requires: { tools: ["a"] },
      inputs: [{ id: "x", label: "X" }],
    });
    const o = JSON.stringify({
      id: "r",
      name: "Reels firma",
      version: "2.0.0",
      requires: { tools: ["a", "evil"] },
      inputs: [{ id: "x", label: "X" }],
    });
    const t = JSON.stringify({
      id: "r",
      name: "Reels",
      version: "2.1.0",
      requires: { tools: ["a", "piper"] },
      inputs: [
        { id: "x", label: "X" },
        { id: "voice", label: "Voice" },
      ],
    });
    const merged = mergeManifest(b, o, t);
    expect(merged.conflicts).toBe(0);
    const json = JSON.parse(merged.text);
    expect(json).toMatchObject({
      name: "Reels firma",
      version: "2.1.0",
      requires: { tools: ["a", "piper"] },
    });
    expect(json.inputs).toHaveLength(2);
  });
});

describe("customized packs: the thread message", () => {
  it("scopes the agent to the draft, forbids guarded keys and asks for checks and approval", () => {
    const message = customThreadMessage({
      workflowName: "Reels",
      workflowId: "social-reels-kit",
      customId: "social-reels-kit@firma",
      scope: "company",
      draftFolder: "/home/a/.zen/companies/acme/workflows/.zen-custom-drafts/social-reels-kit",
      request: "la reels vreau voce și muzica mai încet",
      locale: "ro",
    });
    expect(message).toContain("social-reels-kit@firma");
    expect(message).toContain("la reels vreau voce și muzica mai încet");
    expect(message).toContain(".zen-custom-drafts/social-reels-kit");
    expect(message).toContain("id, access, unattended, requires");
    expect(message).toContain(".zen-custom/checks.json");
    expect(message).toContain("Salvează versiunea mea");
    expect(message).toContain("answer the person in Romanian");
  });

  it("explains the merge and lists the conflicts", () => {
    const message = customThreadMessage({
      workflowName: "Reels",
      workflowId: "social-reels-kit",
      customId: "social-reels-kit@personal",
      scope: "user",
      draftFolder: "/d",
      request: null,
      locale: "en",
      merge: { from: "2.0.0", to: "2.1.0", conflictFiles: ["prompt.md"], reportFile: "/d/r.json" },
    });
    expect(message).toContain("version 2.1.0");
    expect(message).toContain("prompt.md");
    expect(message).toContain(CONFLICT_OURS);
    expect(message).toContain("answer the person in English");
  });
});
