// @effect-diagnostics nodeBuiltinImport:off -- small synchronous file writes under one folder.
// Zen Staff chat imports: a ChatGPT / Claude.ai project becomes a folder the agents read.
// `<chosen folder>/<base folder>/<project>/` gets AGENTS.md (instructions, description, where
// it came from), CLAUDE.md (`@AGENTS.md`), `cunostinte/` (knowledge files) and MEMORIE.md.
// Everything in an export is untrusted: names are reduced to one plain path segment, every
// target is checked to resolve inside the base folder (symlinks included), files are created
// exclusively and never overwritten, so a re-import keeps what the person edited.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ZEN_IMPORT_LIMITS,
  type ZenImportProjectSource,
  type ZenImportedProject,
} from "@t3tools/contracts/zenImports";

export const KNOWLEDGE_DIR = "cunostinte";
export const MEMORY_FILE = "MEMORIE.md";

const SOURCE_NAMES: Record<ZenImportProjectSource, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude.ai",
};

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * One safe path segment from an untrusted name: no separators, no `..`, no control or
 * reserved characters, no leading dots, at most `max` characters (extension kept).
 */
export function sanitizeSegment(name: string, fallback: string, max = 80): string {
  const lastPart = name.split(/[/\\]/).findLast((part) => part.trim() !== "") ?? "";
  let clean = lastPart
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (clean.length > max) {
    const dot = clean.lastIndexOf(".");
    const extension = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : "";
    clean = `${clean.slice(0, max - extension.length).trimEnd()}${extension}`;
  }
  if (clean === "" || clean === "." || clean === "..") return fallback;
  if (WINDOWS_RESERVED.test(clean)) return `_${clean}`;
  return clean;
}

/** `name.md`, `name (2).md`, ... unique case-insensitively among `taken`. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 2; ; index++) {
    const candidate = `${stem} (${index})${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** True when `target` is `root` or inside it, after resolving both. */
export function isInside(root: string, target: string): boolean {
  const relative = NodePath.relative(NodePath.resolve(root), NodePath.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
}

/** The real path of the deepest existing ancestor must stay inside the real root (symlinks). */
function assertRealInside(root: string, target: string): void {
  const realRoot = NodeFS.realpathSync(root);
  let existing = target;
  while (!NodeFS.existsSync(existing)) {
    const parent = NodePath.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = NodeFS.realpathSync(existing);
  if (!isInside(realRoot, real) || !isInside(root, target)) {
    throw new Error(`Refused to write outside the import folder: ${target}`);
  }
}

/** The base folder for imports inside the chosen folder, created when missing. */
export function ensureBaseFolder(anchorRoot: string, baseFolderName: string): string {
  const base = NodePath.join(anchorRoot, sanitizeSegment(baseFolderName, "Importuri"));
  if (!isInside(anchorRoot, base) || NodePath.resolve(base) === NodePath.resolve(anchorRoot)) {
    throw new Error("The import folder must be inside the chosen folder.");
  }
  assertRealInside(anchorRoot, base);
  NodeFS.mkdirSync(base, { recursive: true });
  assertRealInside(anchorRoot, base);
  return base;
}

type Language = "en" | "ro";

const TEXT = {
  en: {
    imported: (source: string, date: string, name: string) =>
      `Imported from ${source} on ${date} (project "${name}"). Zen Staff does not overwrite this file on a later import; edit it freely.`,
    instructions: "Instructions",
    noInstructionsChatgpt:
      "ChatGPT's data export does not include project instructions. Paste them here from the project's settings in ChatGPT.",
    noInstructions: "The project had no instructions.",
    knowledge: "Knowledge files",
    knowledgeBody: `The project's files are in \`${KNOWLEDGE_DIR}/\`. Read the ones that matter for the task:`,
    noFilesChatgpt:
      "ChatGPT's data export does not include project files. Add them to this folder if you need them.",
    memory: "Memory",
    memoryBody: (source: string) =>
      `What ${source} remembered about this project is in \`${MEMORY_FILE}\`. Read it before you start.`,
    memoryTitle: (source: string, name: string) => `${source} memory for "${name}"`,
    globalMemoryTitle: (source: string) => `${source} memory (all chats)`,
    memoryImported: (date: string) => `Imported on ${date}.`,
  },
  ro: {
    imported: (source: string, date: string, name: string) =>
      `Importat din ${source} la ${date} (proiectul „${name}”). Zen Staff nu suprascrie acest fișier la un import ulterior; îl poți modifica liber.`,
    instructions: "Instrucțiuni",
    noInstructionsChatgpt:
      "Exportul de date ChatGPT nu conține instrucțiunile proiectului. Copiază-le aici din setările proiectului din ChatGPT.",
    noInstructions: "Proiectul nu avea instrucțiuni.",
    knowledge: "Fișiere de cunoștințe",
    knowledgeBody: `Fișierele proiectului sunt în \`${KNOWLEDGE_DIR}/\`. Citește-le pe cele care contează pentru sarcină:`,
    noFilesChatgpt:
      "Exportul de date ChatGPT nu conține fișierele proiectului. Adaugă-le în acest folder dacă ai nevoie de ele.",
    memory: "Memorie",
    memoryBody: (source: string) =>
      `Ce ținea minte ${source} despre acest proiect e în \`${MEMORY_FILE}\`. Citește-l înainte să începi.`,
    memoryTitle: (source: string, name: string) => `Memoria ${source} pentru „${name}”`,
    globalMemoryTitle: (source: string) => `Memoria ${source} (toate conversațiile)`,
    memoryImported: (date: string) => `Importat la ${date}.`,
  },
} as const;

export function agentsMarkdown(input: {
  readonly source: ZenImportProjectSource;
  readonly language: Language;
  readonly project: ZenImportedProject;
  readonly files: ReadonlyArray<string>;
  readonly date: string;
}): string {
  const t = TEXT[input.language];
  const source = SOURCE_NAMES[input.source];
  const { project } = input;
  const lines = [`# ${project.name.replace(/\s+/g, " ").trim()}`, ""];
  if (project.description.trim() !== "") lines.push(project.description.trim(), "");
  lines.push(`_${t.imported(source, input.date, project.name.trim())}_`, "");
  lines.push(`## ${t.instructions}`, "");
  lines.push(
    project.instructions.trim() !== ""
      ? project.instructions.trim()
      : input.source === "chatgpt"
        ? t.noInstructionsChatgpt
        : t.noInstructions,
    "",
  );
  if (input.files.length > 0) {
    lines.push(`## ${t.knowledge}`, "", t.knowledgeBody, "");
    for (const file of input.files) lines.push(`- \`${KNOWLEDGE_DIR}/${file}\``);
    lines.push("");
  } else if (input.source === "chatgpt") {
    lines.push(`## ${t.knowledge}`, "", t.noFilesChatgpt, "");
  }
  if (project.memory !== null && project.memory.trim() !== "") {
    lines.push(`## ${t.memory}`, "", t.memoryBody(source), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function memoryMarkdown(input: {
  readonly title: string;
  readonly memory: string;
  readonly date: string;
  readonly language: Language;
}): string {
  return `# ${input.title}\n\n_${TEXT[input.language].memoryImported(input.date)}_\n\n${input.memory.trim()}\n`;
}

export interface WriteOutcome {
  readonly written: Array<string>;
  readonly kept: Array<string>;
  readonly skipped: Array<{ readonly name: string; readonly reason: string }>;
}

/** Creates `target` with `content` unless something is already there (file or link). */
function writeOnce(
  root: string,
  folder: string,
  relative: string,
  content: string,
  outcome: WriteOutcome,
) {
  const target = NodePath.join(folder, relative);
  assertRealInside(root, target);
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  assertRealInside(root, target);
  try {
    // `wx` fails on any existing entry, symlinks included, so nothing is followed or replaced.
    NodeFS.writeFileSync(target, content, { flag: "wx", mode: 0o644 });
    outcome.written.push(relative);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") outcome.kept.push(relative);
    else throw cause;
  }
}

/**
 * The project's folder: the one from an earlier import when it still exists inside the base,
 * otherwise a new one named after the project (unique among what is already there).
 */
export function chooseProjectFolder(input: {
  readonly base: string;
  readonly name: string;
  readonly previousFolder: string | null;
}): { readonly folder: string; readonly reused: boolean } {
  const { base, previousFolder } = input;
  if (
    previousFolder !== null &&
    isInside(base, previousFolder) &&
    NodePath.resolve(previousFolder) !== NodePath.resolve(base) &&
    NodeFS.existsSync(previousFolder) &&
    NodeFS.lstatSync(previousFolder).isDirectory()
  ) {
    return { folder: previousFolder, reused: true };
  }
  const taken = new Set(
    (NodeFS.existsSync(base) ? NodeFS.readdirSync(base) : []).map((entry) => entry.toLowerCase()),
  );
  const folder = NodePath.join(base, uniqueName(sanitizeSegment(input.name, "Proiect"), taken));
  return { folder, reused: false };
}

/** Writes an imported project into `folder` (inside `base`). Existing files are kept. */
export function writeImportedProject(input: {
  readonly base: string;
  readonly folder: string;
  readonly source: ZenImportProjectSource;
  readonly language: Language;
  readonly project: ZenImportedProject;
  readonly date: string;
}): WriteOutcome {
  const { base, folder, project } = input;
  if (!isInside(base, folder) || NodePath.resolve(base) === NodePath.resolve(folder)) {
    throw new Error("The project folder must be inside the import folder.");
  }
  assertRealInside(base, folder);
  NodeFS.mkdirSync(folder, { recursive: true });
  const outcome: WriteOutcome = { written: [], kept: [], skipped: [] };

  const taken = new Set<string>();
  const files: Array<{ readonly name: string; readonly content: string }> = [];
  let total = 0;
  project.files.slice(0, ZEN_IMPORT_LIMITS.filesPerProject).forEach((file, index) => {
    if (file.content.trim() === "") {
      outcome.skipped.push({ name: file.name, reason: "empty" });
      return;
    }
    if (file.content.length > ZEN_IMPORT_LIMITS.charsPerProjectFile) {
      outcome.skipped.push({ name: file.name, reason: "too-large" });
      return;
    }
    if (total + file.content.length > ZEN_IMPORT_LIMITS.charsPerProjectFiles) {
      outcome.skipped.push({ name: file.name, reason: "total-too-large" });
      return;
    }
    total += file.content.length;
    const name = uniqueName(sanitizeSegment(file.name, `fisier-${index + 1}.txt`, 120), taken);
    taken.add(name.toLowerCase());
    files.push({ name, content: file.content });
  });

  const hasMemory = project.memory !== null && project.memory.trim() !== "";
  writeOnce(
    base,
    folder,
    "AGENTS.md",
    agentsMarkdown({
      source: input.source,
      language: input.language,
      project,
      files: files.map((file) => file.name),
      date: input.date,
    }),
    outcome,
  );
  // Claude Code reads CLAUDE.md; the import keeps one set of instructions in AGENTS.md.
  writeOnce(base, folder, "CLAUDE.md", "@AGENTS.md\n", outcome);
  if (hasMemory) {
    writeOnce(
      base,
      folder,
      MEMORY_FILE,
      memoryMarkdown({
        title: TEXT[input.language].memoryTitle(SOURCE_NAMES[input.source], project.name.trim()),
        memory: project.memory!,
        date: input.date,
        language: input.language,
      }),
      outcome,
    );
  }
  for (const file of files) {
    writeOnce(base, folder, NodePath.join(KNOWLEDGE_DIR, file.name), file.content, outcome);
  }
  return outcome;
}

/** `MEMORIE-<source>.md` in the base folder (account-wide memory). Kept if already there. */
export function writeGlobalMemory(input: {
  readonly base: string;
  readonly source: ZenImportProjectSource;
  readonly language: Language;
  readonly memory: string;
  readonly date: string;
}): { readonly path: string; readonly written: boolean } {
  const outcome: WriteOutcome = { written: [], kept: [], skipped: [] };
  const relative = `MEMORIE-${input.source === "chatgpt" ? "ChatGPT" : "Claude"}.md`;
  writeOnce(
    input.base,
    input.base,
    relative,
    memoryMarkdown({
      title: TEXT[input.language].globalMemoryTitle(SOURCE_NAMES[input.source]),
      memory: input.memory,
      date: input.date,
      language: input.language,
    }),
    outcome,
  );
  return { path: NodePath.join(input.base, relative), written: outcome.written.length > 0 };
}
