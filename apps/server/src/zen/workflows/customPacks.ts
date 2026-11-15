// Zen Staff: customized packs, the pure parts (markers, guarded keys, diff, 3-way merge, the
// thread message). A copy keeps the workflow id so it replaces the original; its original is the
// merge base for Keep mine / Take new / Merge. Effects: customPackStore.ts. ZEN.md, "Customized
// packs".
import {
  ZenWorkflowCustomization,
  type ZenCustomDraftFile,
  type ZenCustomScope,
} from "@t3tools/contracts/zenOffice";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** In a customized workflow folder: who owns it and what it came from. */
export const CUSTOM_MARKER_FILE = ".zen-custom.json";
/** In a customized workflow folder: `base/` (the original), `checks.json`, `merge-report.json`. */
export const CUSTOM_META_DIR = ".zen-custom";
/** Under a workflows folder: one draft per workflow id, never loaded as a workflow. */
export const CUSTOM_DRAFTS_DIR = ".zen-custom-drafts";
/** Under a workflows folder: copies kept before a save, a revert or "Take new" replaced them. */
export const CUSTOM_BACKUPS_DIR = ".zen-custom-backups";
/** How many backups of one workflow are kept. */
export const CUSTOM_BACKUPS_KEPT = 3;
/** Files that are bookkeeping, not part of the pack (never diffed, merged or copied as content). */
const BOOKKEEPING = new Set([CUSTOM_MARKER_FILE, ".zen-pack.json"]);
const SKIPPED_DIRS = new Set([CUSTOM_META_DIR, "node_modules", ".git", "out", "renders"]);

/**
 * The workflow.json blocks a customization may not change: they decide what a scheduled run may
 * do without asking (`unattended`), who may run it (`access`) and which tools are installed for it
 * (`requires`), and the toolchain manager reads them from the original. A new version may change
 * them; a merge takes theirs.
 */
const GUARDED_MANIFEST_KEYS = ["id", "access", "unattended", "requires"] as const;

const decodeCustomization = Schema.decodeUnknownOption(
  Schema.fromJsonString(ZenWorkflowCustomization),
);

export function parseCustomMarker(text: string | null): ZenWorkflowCustomization | null {
  if (text === null) return null;
  return Option.getOrNull(decodeCustomization(text));
}

export function customIdFor(workflowId: string, scope: ZenCustomScope): string {
  return `${workflowId}@${scope === "company" ? "firma" : "personal"}`;
}

/** Whether a path inside a workflow folder is pack content (diffed, merged, copied). */
export function isPackContent(relativePath: string): boolean {
  const parts = relativePath.split("/");
  if (parts.length === 1 && BOOKKEEPING.has(parts[0]!)) return false;
  return !parts.some((part) => SKIPPED_DIRS.has(part));
}

/** Compares dotted versions numerically ("2.10.0" > "2.9.1"); -1, 0 or 1. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** The newer original to offer, or null (not newer, or the person chose to keep theirs). */
export function updateOffered(
  customization: Pick<ZenWorkflowCustomization, "origin" | "declinedVersion">,
  latestVersion: string | null,
): string | null {
  if (latestVersion === null) return null;
  if (compareVersions(latestVersion, customization.origin.version) <= 0) return null;
  if (
    customization.declinedVersion !== null &&
    compareVersions(latestVersion, customization.declinedVersion) <= 0
  ) {
    return null;
  }
  return latestVersion;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** The guarded workflow.json keys whose value differs between the base and the draft. */
export function guardedChanges(baseJson: string, draftJson: string): ReadonlyArray<string> {
  let base: Record<string, unknown>;
  let draft: Record<string, unknown>;
  try {
    base = JSON.parse(baseJson) as Record<string, unknown>;
    draft = JSON.parse(draftJson) as Record<string, unknown>;
  } catch {
    return ["workflow.json"];
  }
  return GUARDED_MANIFEST_KEYS.filter((key) => stableJson(base[key]) !== stableJson(draft[key]));
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The file as text, or null when it is binary (a NUL byte or not UTF-8). */
export function asText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const splitLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split("\n");
  // A final newline is not an extra empty line.
  if (lines.at(-1) === "") lines.pop();
  return lines;
};
const joinLines = (lines: ReadonlyArray<string>, finalNewline: boolean) =>
  lines.length === 0 ? "" : lines.join("\n") + (finalNewline ? "\n" : "");

/** Above this many cells the diff gives up on alignment and treats the file as replaced. */
const MAX_LCS_CELLS = 16_000_000;

/**
 * Pairs of equal lines (index in `a`, index in `b`) of a longest common subsequence, in order.
 * Common prefix and suffix are matched first, so typical edits stay cheap.
 */
function matchLines(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): ReadonlyArray<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    pairs.push([start, start]);
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  const tail: Array<readonly [number, number]> = [];
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    tail.unshift([endA, endB]);
  }
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_LCS_CELLS) {
    // lengths[i][j] = LCS of a[start+i..endA) and b[start+j..endB), row-major.
    const width = m + 1;
    const lengths = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * width + j] =
          a[start + i] === b[start + j]
            ? lengths[(i + 1) * width + j + 1]! + 1
            : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i++;
      else j++;
    }
  }
  return [...pairs, ...tail];
}

type DiffOp = { readonly kind: " " | "-" | "+"; readonly line: string };

function diffOps(a: ReadonlyArray<string>, b: ReadonlyArray<string>): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  for (const [x, y] of [...matchLines(a, b), [a.length, b.length] as const]) {
    while (i < x) ops.push({ kind: "-", line: a[i++]! });
    while (j < y) ops.push({ kind: "+", line: b[j++]! });
    if (x < a.length && y < b.length) {
      ops.push({ kind: " ", line: a[x]! });
      i = x + 1;
      j = y + 1;
    }
  }
  return ops;
}

/** A unified diff of one file (git style, 3 lines of context); "" when nothing changed. */
export function unifiedDiff(
  path: string,
  before: string | null,
  after: string | null,
  context = 3,
): string {
  if (before === after) return "";
  const a = splitLines(before ?? "");
  const b = splitLines(after ?? "");
  const ops = diffOps(a, b);
  const header = [
    `--- ${before === null ? "/dev/null" : `a/${path}`}`,
    `+++ ${after === null ? "/dev/null" : `b/${path}`}`,
  ];
  // Changed ops closer than 2x context apart share a hunk.
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  const groups: Array<[number, number]> = [];
  for (const index of changed) {
    const last = groups.at(-1);
    if (last && index - last[1] <= context * 2 + 1) last[1] = index;
    else groups.push([index, index]);
  }
  const hunks: string[] = [];
  for (const [first, lastChange] of groups) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length, lastChange + context + 1);
    let oldLine = 1;
    let newLine = 1;
    for (let k = 0; k < from; k++) {
      if (ops[k]!.kind !== "+") oldLine++;
      if (ops[k]!.kind !== "-") newLine++;
    }
    const body = ops.slice(from, to);
    const oldCount = body.filter((op) => op.kind !== "+").length;
    const newCount = body.filter((op) => op.kind !== "-").length;
    hunks.push(
      `@@ -${oldCount === 0 ? oldLine - 1 : oldLine},${oldCount} +${newCount === 0 ? newLine - 1 : newLine},${newCount} @@`,
      ...body.map((op) => `${op.kind}${op.line}`),
    );
  }
  return [...header, ...hunks].join("\n") + "\n";
}

export const CONFLICT_OURS = "<<<<<<< ours (your customized copy)";
const CONFLICT_BASE = "||||||| base (the original you customized)";
const CONFLICT_SPLIT = "=======";
export const CONFLICT_THEIRS = ">>>>>>> theirs (the new version)";

/** Whether a text still has conflict markers left by `mergeText`. */
export function hasConflictMarkers(text: string): boolean {
  return text.split("\n").some((line) => line === CONFLICT_OURS || line === CONFLICT_THEIRS);
}

const sameLines = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((line, index) => line === right[index]);

/**
 * diff3 on lines. Regions changed on one side only take that side; the same change on both
 * sides is taken once; different changes to the same region become a conflict block with the
 * three versions (ours, base, theirs) for the agent to resolve.
 */
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): { readonly text: string; readonly conflicts: number } {
  if (ours === theirs) return { text: ours, conflicts: 0 };
  if (ours === base) return { text: theirs, conflicts: 0 };
  if (theirs === base) return { text: ours, conflicts: 0 };
  const b = splitLines(base);
  const o = splitLines(ours);
  const t = splitLines(theirs);
  const toOurs = new Map(matchLines(b, o));
  const toTheirs = new Map(matchLines(b, t));
  const out: string[] = [];
  let conflicts = 0;
  let i = 0;
  let x = 0;
  let y = 0;
  const resolve = (endBase: number, endOurs: number, endTheirs: number) => {
    const chunkBase = b.slice(i, endBase);
    const chunkOurs = o.slice(x, endOurs);
    const chunkTheirs = t.slice(y, endTheirs);
    if (sameLines(chunkOurs, chunkBase)) out.push(...chunkTheirs);
    else if (sameLines(chunkTheirs, chunkBase) || sameLines(chunkOurs, chunkTheirs)) {
      out.push(...chunkOurs);
    } else if (
      chunkBase.length > 0 &&
      chunkOurs.length === chunkBase.length &&
      chunkTheirs.length === chunkBase.length &&
      chunkBase.every(
        (line, index) =>
          chunkOurs[index] === line ||
          chunkTheirs[index] === line ||
          chunkOurs[index] === chunkTheirs[index],
      )
    ) {
      // Same number of lines on every side and each line changed on one side at most (edits
      // next to each other, e.g. the music level on one line, the voice on the next).
      chunkBase.forEach((line, index) =>
        out.push(chunkOurs[index] === line ? chunkTheirs[index]! : chunkOurs[index]!),
      );
    } else {
      conflicts++;
      out.push(
        CONFLICT_OURS,
        ...chunkOurs,
        CONFLICT_BASE,
        ...chunkBase,
        CONFLICT_SPLIT,
        ...chunkTheirs,
        CONFLICT_THEIRS,
      );
    }
  };
  while (i < b.length) {
    const inOurs = toOurs.get(i);
    const inTheirs = toTheirs.get(i);
    if (inOurs === x && inTheirs === y) {
      out.push(b[i]!);
      i++;
      x++;
      y++;
      continue;
    }
    // The next base line both sides kept, at or after their current positions.
    let next = i;
    while (next < b.length) {
      const nextOurs = toOurs.get(next);
      const nextTheirs = toTheirs.get(next);
      if (nextOurs !== undefined && nextTheirs !== undefined && nextOurs >= x && nextTheirs >= y) {
        break;
      }
      next++;
    }
    if (next >= b.length) break;
    resolve(next, toOurs.get(next)!, toTheirs.get(next)!);
    i = next;
    x = toOurs.get(next)!;
    y = toTheirs.get(next)!;
  }
  resolve(b.length, o.length, t.length);
  const finalNewline =
    (ours.endsWith("\n") || ours === "") && (theirs.endsWith("\n") || theirs === "");
  return { text: joinLines(out, finalNewline), conflicts };
}

export type FolderFiles = ReadonlyMap<string, Uint8Array>;

export interface MergedFile {
  readonly path: string;
  /** null = the file is gone in the result. */
  readonly bytes: Uint8Array | null;
  readonly outcome:
    | "unchanged"
    | "ours"
    | "theirs"
    | "merged"
    | "conflict"
    | "binary-conflict"
    | "removed";
  readonly conflicts: number;
}

const encoder = new TextEncoder();

/**
 * Merges three versions of a pack folder (relative path -> bytes). Text files go through
 * `mergeText`; a binary changed on both sides keeps ours (reported as a conflict, the new one is
 * left next to it as `<name>.new<ext>`). workflow.json's guarded keys always take theirs.
 */
export function mergeFolders(
  base: FolderFiles,
  ours: FolderFiles,
  theirs: FolderFiles,
): ReadonlyArray<MergedFile> {
  const paths = [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])].toSorted();
  const result: MergedFile[] = [];
  for (const path of paths) {
    const b = base.get(path);
    const o = ours.get(path);
    const t = theirs.get(path);
    if (sameBytes(o, t)) {
      result.push({
        path,
        bytes: o ?? null,
        outcome: o === undefined ? "removed" : sameBytes(o, b) ? "unchanged" : "ours",
        conflicts: 0,
      });
      continue;
    }
    if (sameBytes(o, b)) {
      result.push({
        path,
        bytes: t ?? null,
        outcome: t === undefined ? "removed" : "theirs",
        conflicts: 0,
      });
      continue;
    }
    if (sameBytes(t, b)) {
      result.push({
        path,
        bytes: o ?? null,
        outcome: o === undefined ? "removed" : "ours",
        conflicts: 0,
      });
      continue;
    }
    // Changed on both sides (or added on both with different content, or edited vs removed).
    const textBase = b === undefined ? "" : asText(b);
    const textOurs = o === undefined ? null : asText(o);
    const textTheirs = t === undefined ? null : asText(t);
    if (o === undefined || t === undefined) {
      // One side removed a file the other changed: keep the changed one and flag it.
      const kept = (o ?? t)!;
      const text = asText(kept);
      result.push({
        path,
        bytes: kept,
        outcome: text === null ? "binary-conflict" : "conflict",
        conflicts: 1,
      });
      continue;
    }
    if (textBase === null || textOurs === null || textTheirs === null) {
      result.push({ path, bytes: o, outcome: "binary-conflict", conflicts: 1 });
      const dot = path.lastIndexOf(".");
      const slash = path.lastIndexOf("/");
      const sibling =
        dot > slash + 1 ? `${path.slice(0, dot)}.new${path.slice(dot)}` : `${path}.new`;
      result.push({ path: sibling, bytes: t, outcome: "theirs", conflicts: 0 });
      continue;
    }
    if (path === "workflow.json") {
      const merged = mergeManifest(textBase, textOurs, textTheirs);
      result.push({
        path,
        bytes: encoder.encode(merged.text),
        outcome: merged.conflicts > 0 ? "conflict" : "merged",
        conflicts: merged.conflicts,
      });
      continue;
    }
    const merged = mergeText(textBase, textOurs, textTheirs);
    result.push({
      path,
      bytes: encoder.encode(merged.text),
      outcome: merged.conflicts > 0 ? "conflict" : "merged",
      conflicts: merged.conflicts,
    });
  }
  return result;
}

/**
 * workflow.json: the guarded keys and the version come from theirs (the new original decides
 * tools, access and scheduled-run rules); everything else merges key by key, a key changed
 * differently on both sides keeps ours and counts as a conflict only when it cannot be decided.
 */
export function mergeManifest(
  base: string,
  ours: string,
  theirs: string,
): { readonly text: string; readonly conflicts: number } {
  let b: Record<string, unknown>;
  let o: Record<string, unknown>;
  let t: Record<string, unknown>;
  try {
    b = JSON.parse(base) as Record<string, unknown>;
    o = JSON.parse(ours) as Record<string, unknown>;
    t = JSON.parse(theirs) as Record<string, unknown>;
  } catch {
    return mergeText(base, ours, theirs);
  }
  const keys = [...new Set([...Object.keys(t), ...Object.keys(o)])];
  const out: Record<string, unknown> = {};
  let conflicts = 0;
  for (const key of keys) {
    const guarded =
      (GUARDED_MANIFEST_KEYS as ReadonlyArray<string>).includes(key) || key === "version";
    const [vb, vo, vt] = [b[key], o[key], t[key]].map((value) => stableJson(value));
    let value: unknown;
    if (guarded || vo === vb) value = t[key];
    else if (vt === vb || vo === vt) value = o[key];
    else {
      // Both changed the same key: a text merge of its JSON keeps both sides when it can.
      const merged = mergeText(
        `${JSON.stringify(b[key] ?? null, null, 2)}\n`,
        `${JSON.stringify(o[key] ?? null, null, 2)}\n`,
        `${JSON.stringify(t[key] ?? null, null, 2)}\n`,
      );
      try {
        if (merged.conflicts > 0) throw new Error("conflict");
        value = JSON.parse(merged.text);
      } catch {
        value = o[key];
        conflicts++;
      }
    }
    if (value !== undefined) out[key] = value;
  }
  // Key order: theirs first (the shipped layout), then keys only ours has.
  return { text: `${JSON.stringify(out, null, 2)}\n`, conflicts };
}

/** The draft's changes against the copy in use (or the original), per file. */
export function draftChanges(
  before: FolderFiles,
  draft: FolderFiles,
): ReadonlyArray<ZenCustomDraftFile> {
  const paths = [...new Set([...before.keys(), ...draft.keys()])].toSorted();
  const files: ZenCustomDraftFile[] = [];
  for (const path of paths) {
    const a = before.get(path);
    const b = draft.get(path);
    if (sameBytes(a, b)) continue;
    const text = b === undefined ? null : asText(b);
    files.push({
      path,
      change:
        text !== null && hasConflictMarkers(text)
          ? "conflict"
          : a === undefined
            ? "added"
            : b === undefined
              ? "removed"
              : "changed",
    });
  }
  return files;
}

/** The whole draft diff, capped so the review dialog stays readable. */
export function folderDiff(
  before: FolderFiles,
  draft: FolderFiles,
  maxChars = 200_000,
): { readonly diff: string; readonly truncated: boolean } {
  const parts: string[] = [];
  let size = 0;
  for (const file of draftChanges(before, draft)) {
    const a = before.get(file.path);
    const b = draft.get(file.path);
    const textA = a === undefined ? null : asText(a);
    const textB = b === undefined ? null : asText(b);
    const part =
      (a !== undefined && textA === null) || (b !== undefined && textB === null)
        ? `Binary file ${file.path} ${file.change}\n`
        : unifiedDiff(file.path, textA, textB);
    if (size + part.length > maxChars) return { diff: parts.join(""), truncated: true };
    parts.push(part);
    size += part.length;
  }
  return { diff: parts.join(""), truncated: false };
}

export const CHECKS_FILE = `${CUSTOM_META_DIR}/checks.json`;
const Checks = Schema.Struct({
  passed: Schema.Boolean,
  summary: Schema.optional(Schema.String),
  commands: Schema.optional(Schema.Array(Schema.String)),
});
const decodeChecks = Schema.decodeUnknownOption(Schema.fromJsonString(Checks));

export function parseChecks(
  text: string | null,
): { readonly passed: boolean; readonly summary: string; readonly commands: string[] } | null {
  if (text === null) return null;
  const decoded = Option.getOrNull(decodeChecks(text));
  return decoded
    ? {
        passed: decoded.passed,
        summary: decoded.summary ?? "",
        commands: [...(decoded.commands ?? [])],
      }
    : null;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { ro: "Romanian", en: "English" };

export interface CustomThreadInput {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly customId: string;
  readonly scope: ZenCustomScope;
  readonly draftFolder: string;
  readonly request: string | null;
  readonly locale: string | undefined;
  /** Set for a merge draft: the versions and the files left with conflict markers. */
  readonly merge?: {
    readonly from: string;
    readonly to: string;
    readonly conflictFiles: ReadonlyArray<string>;
    readonly reportFile: string;
  };
}

/**
 * The first message of the customization (or merge) thread. The agent works only in the draft
 * folder, keeps the pack runnable, runs its checks, writes `.zen-custom/checks.json`, shows the
 * diff and tells the person to approve it with "Save my version" (nothing is used before that).
 */
export function customThreadMessage(input: CustomThreadInput): string {
  const language = LANGUAGE_NAMES[input.locale?.slice(0, 2) ?? "en"] ?? "English";
  const owner =
    input.scope === "company"
      ? "the company's own copy (everyone in the company will use it once saved)"
      : "the person's own copy (only they use it once saved)";
  const request = input.request?.trim();
  const lines: string[] = [
    input.merge
      ? `Update a customized workflow pack: "${input.workflowName}" (${input.customId}).`
      : `Customize a workflow pack: "${input.workflowName}" (${input.customId}).`,
    "",
    `You are working in a DRAFT of ${owner}: ${input.draftFolder}`,
    "It is a complete copy of the pack (workflow.json, prompt.md, SKILL.md, templates, scripts, kit). The pack that is in use stays untouched until the person approves this draft.",
    "",
  ];
  if (input.merge) {
    lines.push(
      `We shipped version ${input.merge.to} of the original; the copy was made from ${input.merge.from}. The draft already holds an automatic 3-way merge (base = the original ${input.merge.from} in ${CUSTOM_META_DIR}/base/, ours = the customized copy, theirs = ${input.merge.to}). The per-file outcome is in ${input.merge.reportFile}.`,
      input.merge.conflictFiles.length > 0
        ? `Files with conflicts to resolve: ${input.merge.conflictFiles.join(", ")}. Each conflict block is "${CONFLICT_OURS}" (the customized lines), "${CONFLICT_BASE}" (the old original), "${CONFLICT_SPLIT}", then the new version's lines and "${CONFLICT_THEIRS}". Keep the person's customizations AND the new version's improvements; remove every marker line. A binary file changed on both sides kept ours, with the new one next to it as <name>.new.<ext>: decide which to keep and delete the other.`
        : "There were no conflicts. Still read the merged result where both sides changed the same file, and make sure the customizations survived.",
      "",
    );
  } else {
    lines.push(
      request
        ? `What the person wants changed, in their words: "${request}"`
        : "Ask the person what they want changed in this pack (one short question), then do it.",
      "",
    );
  }
  lines.push(
    "How to work:",
    "1. Read workflow.json, prompt.md and SKILL.md first, then only the files the change needs. Make the smallest change that does what was asked, in the pack's own style. Examples: a quieter music bed is the music gain in the template or the audio script; the company's logo and colors are the brand defaults in the template or SKILL.md; a different tone is prompt.md or SKILL.md.",
    `2. Edit files only inside ${input.draftFolder}. Do not touch ${CUSTOM_META_DIR}/base/ (the original, kept for updates and "back to the original"), ${CUSTOM_MARKER_FILE} or .zen-pack.json.`,
    `3. Do not change these workflow.json keys: ${GUARDED_MANIFEST_KEYS.join(", ")} (tools, access and scheduled-run rules come from the original; the copy is refused if they change). You may change the name, description, inputs, defaults, prompt, guidance, templates and scripts.`,
    "4. Keep Romanian text with comma-below letters (ș ț Ș Ț), never cedillas; no emoji.",
    "5. Check the draft before you finish: `node --check` every .js/.mjs file you changed; parse every JSON file you changed; if the pack has its own tests, a draft or preview mode (see SKILL.md, e.g. `--quality draft`) or sample inputs, run a short sample in a scratch folder outside the draft (never leave renders inside it) and look at the result (frames, loudness, pages) when the change is visible or audible. Fix what fails and check again.",
    `6. Write the outcome to ${input.draftFolder}/${CHECKS_FILE} as JSON: {"passed": true|false, "summary": "<one or two sentences: what was checked and the result>", "commands": ["<each command you ran>"]}. "passed" is true only when everything you ran succeeded. The app will not save the draft without it.`,
    "7. Finish with: a short list of what changed (file and one line each), the check result, and the diff of the main changes (`git diff --no-index` or `diff -ru` against the copy in use is fine, keep it short). Then tell the person to review and approve it with the button **Salvează versiunea mea / Save my version** (Marketplace > Customized packs, or the card on the Office home); nothing changes for anyone until they do. They can also discard the draft, or later go back to the original.",
    "",
    `Language: answer the person in ${language}, in plain words; explain what changed, not how the code works.`,
  );
  return lines.join("\n");
}

/** A string field of a JSON object text (workflow.json name/version, .zen-pack.json packId). */
export function jsonStringField(text: string | null, key: string): string | null {
  if (text === null) return null;
  try {
    const value = (JSON.parse(text) as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** The files a merge report lists with conflicts left. */
export function conflictFilesOf(report: string | null): ReadonlyArray<string> {
  if (report === null) return [];
  try {
    return (JSON.parse(report) as Array<{ path?: unknown; conflicts?: unknown }>)
      .filter((file) => typeof file.path === "string" && Number(file.conflicts) > 0)
      .map((file) => file.path as string);
  } catch {
    return [];
  }
}

export function customThreadTitle(
  workflowName: string,
  merge: boolean,
  locale: string | undefined,
) {
  const ro = locale?.startsWith("ro") ?? false;
  if (merge) return ro ? `Actualizare: ${workflowName}` : `Update: ${workflowName}`;
  return ro ? `Personalizare: ${workflowName}` : `Customize: ${workflowName}`;
}
