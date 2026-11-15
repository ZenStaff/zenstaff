// @effect-diagnostics nodeBuiltinImport:off -- the tests write real folders in a temp dir.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { ZenImportedProject } from "@t3tools/contracts/zenImports";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  KNOWLEDGE_DIR,
  MEMORY_FILE,
  agentsMarkdown,
  chooseProjectFolder,
  ensureBaseFolder,
  isInside,
  sanitizeSegment,
  uniqueName,
  writeGlobalMemory,
  writeImportedProject,
} from "./importProjects.ts";

let root: string;

beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-import-projects-"));
});
afterEach(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

const project = (overrides: Partial<ZenImportedProject> = {}): ZenImportedProject => ({
  externalId: "p-1",
  name: "Brutăria / Ofertă 2025",
  description: "Oferte pentru clienți B2B.",
  instructions: "Răspunde mereu în română, pe scurt.",
  memory: "Clientul principal e Hotel Central.",
  files: [
    { name: "lista-preturi.md", content: "# Prețuri\npâine 5 lei" },
    { name: "contract.txt", content: "Contract cadru" },
  ],
  ...overrides,
});

/** Every file under `dir`, relative, `/`-separated. */
function tree(dir: string): Array<string> {
  return (NodeFS.readdirSync(dir, { recursive: true }) as Array<string>)
    .filter((entry) => NodeFS.statSync(NodePath.join(dir, entry)).isFile())
    .map((entry) => entry.split(NodePath.sep).join("/"))
    .toSorted();
}

describe("sanitizeSegment", () => {
  it("keeps one plain segment and refuses traversal, absolute paths and reserved names", () => {
    expect(sanitizeSegment("../../etc/passwd", "x")).toBe("passwd");
    expect(sanitizeSegment("/etc/shadow", "x")).toBe("shadow");
    expect(sanitizeSegment("C:\\Windows\\system.ini", "x")).toBe("system.ini");
    expect(sanitizeSegment("..", "fallback")).toBe("fallback");
    expect(sanitizeSegment("../", "fallback")).toBe("fallback");
    expect(sanitizeSegment(".env", "x")).toBe("env");
    expect(sanitizeSegment("a\u0000b<c>:d?.md", "x")).toBe("a b c d .md");
    expect(sanitizeSegment("CON", "x")).toBe("_CON");
    expect(sanitizeSegment("   ", "fallback")).toBe("fallback");
    const long = sanitizeSegment(`${"a".repeat(300)}.md`, "x", 120);
    expect(long).toHaveLength(120);
    expect(long.endsWith(".md")).toBe(true);
  });

  it("dedupes names case-insensitively", () => {
    const taken = new Set(["note.md", "note (2).md"]);
    expect(uniqueName("Note.md", taken)).toBe("Note (3).md");
    expect(uniqueName("altul.md", taken)).toBe("altul.md");
  });

  it("tells inside from outside", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a/b/../c")).toBe(false);
  });
});

describe("writeImportedProject", () => {
  it("creates the project folder with AGENTS.md, CLAUDE.md, memory and knowledge files", () => {
    const base = ensureBaseFolder(root, "Importuri Claude");
    expect(base).toBe(NodePath.join(root, "Importuri Claude"));
    const { folder, reused } = chooseProjectFolder({
      base,
      name: project().name,
      previousFolder: null,
    });
    expect(reused).toBe(false);
    expect(NodePath.basename(folder)).toBe("Ofertă 2025");
    const outcome = writeImportedProject({
      base,
      folder,
      source: "claude",
      language: "ro",
      project: project(),
      date: "2026-11-09",
    });
    expect(tree(folder)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      MEMORY_FILE,
      `${KNOWLEDGE_DIR}/contract.txt`,
      `${KNOWLEDGE_DIR}/lista-preturi.md`,
    ]);
    expect(outcome.written).toHaveLength(5);
    const agents = NodeFS.readFileSync(NodePath.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("Răspunde mereu în română");
    expect(agents).toContain("Oferte pentru clienți B2B.");
    expect(agents).toContain("Importat din Claude.ai la 2026-11-09");
    expect(agents).toContain(`\`${KNOWLEDGE_DIR}/lista-preturi.md\``);
    expect(agents).toContain(MEMORY_FILE);
    expect(NodeFS.readFileSync(NodePath.join(folder, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(NodeFS.readFileSync(NodePath.join(folder, MEMORY_FILE), "utf8")).toContain(
      "Hotel Central",
    );
  });

  it("never writes outside the project folder, whatever the file names say", () => {
    const base = ensureBaseFolder(root, "Importuri");
    const { folder } = chooseProjectFolder({ base, name: "P", previousFolder: null });
    const outcome = writeImportedProject({
      base,
      folder,
      source: "claude",
      language: "en",
      project: project({
        memory: null,
        files: [
          { name: "../../../escape.txt", content: "a" },
          { name: "/etc/passwd", content: "b" },
          { name: "..\\..\\win.txt", content: "c" },
          { name: "..", content: "d" },
          { name: "escape.txt", content: "e" },
          { name: "empty.md", content: "   " },
        ],
      }),
      date: "2026-11-09",
    });
    expect(tree(root)).toEqual(
      [
        "AGENTS.md",
        "CLAUDE.md",
        `${KNOWLEDGE_DIR}/escape.txt`,
        `${KNOWLEDGE_DIR}/escape (2).txt`,
        `${KNOWLEDGE_DIR}/fisier-4.txt`,
        `${KNOWLEDGE_DIR}/passwd`,
        `${KNOWLEDGE_DIR}/win.txt`,
      ]
        .map((entry) => `Importuri/P/${entry}`)
        .toSorted(),
    );
    expect(outcome.skipped).toEqual([{ name: "empty.md", reason: "empty" }]);
  });

  it("refuses a base folder name that tries to leave the chosen folder", () => {
    expect(NodePath.dirname(ensureBaseFolder(root, "../../tmp"))).toBe(root);
    expect(() => ensureBaseFolder(root, "..")).not.toThrow();
    expect(NodePath.dirname(ensureBaseFolder(root, ".."))).toBe(root);
  });

  it("does not follow a symlink planted inside the base folder", () => {
    const outside = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-import-outside-"));
    try {
      const base = ensureBaseFolder(root, "Importuri");
      NodeFS.symlinkSync(outside, NodePath.join(base, "Link"));
      expect(() =>
        writeImportedProject({
          base,
          folder: NodePath.join(base, "Link"),
          source: "claude",
          language: "en",
          project: project(),
          date: "2026-11-09",
        }),
      ).toThrow(/outside/);
      expect(NodeFS.readdirSync(outside)).toEqual([]);
      // A new folder is picked next to it instead of reusing the link.
      const chosen = chooseProjectFolder({ base, name: "Link", previousFolder: null });
      expect(NodePath.basename(chosen.folder)).toBe("Link (2)");
    } finally {
      NodeFS.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reuses the folder on re-import and keeps the files the person edited", () => {
    const base = ensureBaseFolder(root, "Importuri");
    const first = chooseProjectFolder({ base, name: "Oferte", previousFolder: null });
    writeImportedProject({
      base,
      folder: first.folder,
      source: "claude",
      language: "en",
      project: project({ name: "Oferte" }),
      date: "2026-11-09",
    });
    NodeFS.writeFileSync(NodePath.join(first.folder, "AGENTS.md"), "edited by me\n");
    const second = chooseProjectFolder({ base, name: "Oferte", previousFolder: first.folder });
    expect(second).toEqual({ folder: first.folder, reused: true });
    const outcome = writeImportedProject({
      base,
      folder: second.folder,
      source: "claude",
      language: "en",
      project: project({
        name: "Oferte",
        files: [...project().files, { name: "nou.md", content: "nou" }],
      }),
      date: "2026-11-10",
    });
    expect(outcome.written).toEqual([NodePath.join(KNOWLEDGE_DIR, "nou.md")]);
    expect(outcome.kept).toContain("AGENTS.md");
    expect(NodeFS.readFileSync(NodePath.join(first.folder, "AGENTS.md"), "utf8")).toBe(
      "edited by me\n",
    );
    // A same-named project from another import gets its own folder.
    expect(
      NodePath.basename(chooseProjectFolder({ base, name: "oferte", previousFolder: null }).folder),
    ).toBe("oferte (2)");
    // A recorded folder outside the base is never reused.
    expect(chooseProjectFolder({ base, name: "X", previousFolder: root }).reused).toBe(false);
  });

  it("caps the size of the knowledge files", () => {
    const base = ensureBaseFolder(root, "Importuri");
    const big = "x".repeat(1_900_000);
    const outcome = writeImportedProject({
      base,
      folder: NodePath.join(base, "Mare"),
      source: "claude",
      language: "en",
      project: project({
        memory: null,
        files: [
          { name: "a.txt", content: big },
          { name: "b.txt", content: big },
          { name: "c.txt", content: "mic" },
        ],
      }),
      date: "2026-11-09",
    });
    expect(outcome.skipped).toEqual([{ name: "b.txt", reason: "total-too-large" }]);
    expect(tree(NodePath.join(base, "Mare"))).toContain(`${KNOWLEDGE_DIR}/c.txt`);
  });
});

describe("ChatGPT projects and global memory", () => {
  it("says what the ChatGPT export leaves out", () => {
    const text = agentsMarkdown({
      source: "chatgpt",
      language: "en",
      project: project({ name: "ChatGPT project 1", instructions: "", memory: null, files: [] }),
      files: [],
      date: "2026-11-09",
    });
    expect(text).toContain("Imported from ChatGPT on 2026-11-09");
    expect(text).toContain("does not include project instructions");
    expect(text).toContain("does not include project files");
  });

  it("writes MEMORIE-<source>.md in the base folder once", () => {
    const base = ensureBaseFolder(root, "Importuri Claude");
    const first = writeGlobalMemory({
      base,
      source: "claude",
      language: "ro",
      memory: "Alex lucrează la Zen Staff.",
      date: "2026-11-09",
    });
    expect(first).toEqual({ path: NodePath.join(base, "MEMORIE-Claude.md"), written: true });
    expect(NodeFS.readFileSync(first.path, "utf8")).toContain("Alex lucrează la Zen Staff.");
    expect(
      writeGlobalMemory({ base, source: "claude", language: "ro", memory: "alt", date: "x" })
        .written,
    ).toBe(false);
  });
});
