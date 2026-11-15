#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Codemod script.
// Zen Staff: rewrites upstream's user-visible "T3 Code" / "T3 Connect" / `t3 <command>` text to
// the Zen names from packages/contracts/src/zen.ts. Only string literals, template text and JSX
// text are touched in TS/TSX (never comments or identifiers); Markdown is rewritten outside URLs.
// Idempotent and re-runnable, which is what keeps it mergeable: on a sync conflict in a
// rebranded line, take upstream's version and run this on the file again. See ZEN.md "Rebranding".
//
//   node scripts/zen-rebrand.ts                  rewrite every target file
//   node scripts/zen-rebrand.ts --check          list files that still need it (exit 1 if any)
//   node scripts/zen-rebrand.ts --files a.ts b.md   only these files
//   node scripts/zen-rebrand.ts --from "Old Name"   also replace a previous Zen product name
//   node scripts/zen-rebrand.ts --record-identity   record the identity-test edits (see lib)
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import ts from "typescript-legacy";

import {
  ZEN_APP_BASE_NAME,
  ZEN_CLI_INSTALL_PS1_TARGET,
  ZEN_CLI_INSTALL_SH_TARGET,
  ZEN_CLI_NAME,
  ZEN_HUB_NAME,
} from "@t3tools/contracts/zen";

import {
  applyZenIdentityTestEdits,
  recordZenIdentityTestEdits,
  ZEN_IDENTITY_TEST_FILES,
} from "./lib/zen-identity-tests.ts";

const repoRoot = NodePath.join(import.meta.dirname, "..");

const SOURCE_ROOTS = [
  "apps/web/src",
  "apps/desktop/src",
  "apps/server/src",
  "apps/mobile/src",
  "packages",
] as const;
const DOC_FILES = ["docs/README.md"] as const;
// Test helpers outside src whose text tests compare with rebranded literals.
const EXTRA_SOURCE_FILES = ["apps/server/scripts/acp-mock-agent.ts"] as const;
const DOC_ROOTS = ["docs/user"] as const;
const REPLAY_FIXTURE_ROOT = "apps/server/src/orchestration-v2/testkit/fixtures";

/** Left as upstream wrote them, on purpose (see ZEN.md "Rebranding"). */
const EXCLUDED_FILES = new Set([
  // Headings are the anchors of upstream's T3 Connect troubleshooting links (environmentHttp.ts).
  "docs/user/t3-connect-troubleshooting.md",
  // Test data, not app text: search fixtures and provider-written tool labels ("T3 Code <tool>").
  "packages/shared/src/paletteSearch.test.ts",
  "packages/shared/src/t3McpToolPresentation.test.ts",
  // The upstream identity tests get Zen values from scripts/lib/zen-identity-tests.ts instead.
  ...ZEN_IDENTITY_TEST_FILES,
]);
const EXCLUDED_DIRS = new Set(["node_modules", "dist", "dist-electron", ".turbo", "zen-academy"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

// CLI subcommands of `t3` (apps/server/src/binCli.ts), so prose like "t3 code" is never matched.
const CLI_SUBCOMMANDS =
  "start|serve|app|pair|auth|environment|browser|project|thread|up|status|service|update|install|uninstall|theme|trace|doctor|policy|triage|connect|help|claude-history|acp-mcp-bridge|acp-mcp-call|--[a-z][\\w-]*";

export interface RebrandOptions {
  readonly appName: string;
  readonly hubName: string;
  readonly cliName: string;
  readonly previousNames?: ReadonlyArray<string>;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rewrites one piece of user-visible text (a string literal's content, JSX text, Markdown prose). */
export function rebrandText(text: string, options: RebrandOptions): string {
  if (!/T3|t3|\bT3\b/.test(text) && !options.previousNames?.some((name) => text.includes(name))) {
    return text;
  }
  let out = text;
  for (const previous of options.previousNames ?? []) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(previous)}\\b`, "g"), options.appName);
  }
  out = out
    .replace(/\bT3\s+Code\b/g, options.appName)
    // `?name=T3%20Code` in links that prefill another app's form.
    .replace(/\bT3%20Code\b/g, encodeURIComponent(options.appName))
    .replace(/\bT3\s+Connect\b/g, options.hubName)
    // "T3 server", "T3 home", "a T3 thread", "T3's": the product, not T3 Chat / T3 Tools.
    .replace(/\bT3(?='s\b| (?:[a-z]|MCP\b|Server\b|CLI\b))/g, options.appName)
    // `npx t3 pair`, `npx t3@1.2.3 pair` run upstream's npm package; ours is ZEN_CLI_NAME.
    .replace(/(?<![\w@/.-])npx t3(?:@\$\{[^}]*\}|@[\w.-]+)? (?=[a-z-])/g, `${options.cliName} `)
    .replace(new RegExp(`(?<=\`)t3(?=[ \`\\\\])`, "g"), options.cliName)
    // "the t3 command", "Another t3 at ...", "Could not install t3": the command itself.
    .replace(/\bt3(?= (?:command|launcher|CLI|at)\b)/g, options.cliName)
    .replace(
      /(?<=\b(?:install|remove|add|Added|Another|another|older|bundled|run) )t3\b(?![.\w-])/g,
      options.cliName,
    )
    // `which -a t3`, `~/.local/bin/t3 service install`: the command's file on PATH.
    .replace(/(?<=\bwhich -a |\/\.local\/bin\/)t3\b(?![.\w-])/g, options.cliName)
    // "Run t3 to get started", "t3 is uninstalled", "once t3 exits": the command in CLI output.
    .replace(
      /(?<=\b(?:Run|Remove|Installed|Stop|standalone|newer|downloaded|this) )t3\b(?![.\w/@-])/g,
      options.cliName,
    )
    .replace(/\bt3(?= (?:is|was|exits|and its)\b)/g, options.cliName)
    // "but t3@${version} requires": the release, not upstream's npm package (`t3@${channel}`).
    .replace(/(?<=\b(?:but|confirm|that|running) )t3@(?=\$\{)/g, `${options.appName} `)
    // Upstream's one-line installers (install.sh / install.ps1 on t3.codes): ours, once published.
    .replace(/https:\/\/t3\.codes\/install\.sh\b/g, ZEN_CLI_INSTALL_SH_TARGET)
    .replace(/https:\/\/t3\.codes\/install\.ps1\b/g, ZEN_CLI_INSTALL_PS1_TARGET)
    .replace(
      new RegExp(`(?<=^|[\\s"'(>])t3(?= (?:${CLI_SUBCOMMANDS})(?![\\w-]))`, "g"),
      options.cliName,
    );
  return out;
}

/** Rewrites the user-visible literals of a TS/TSX module; everything else is byte-for-byte kept. */
export function rebrandSource(fileName: string, source: string, options: RebrandOptions): string {
  if (!/T3|t3/.test(source) && !options.previousNames?.some((name) => source.includes(name))) {
    return source;
  }
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: ts.Node): void => {
    // Module specifiers are package names, never text.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isImportTypeNode(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const start = node.getStart(file);
      const end = node.getEnd();
      const raw = source.slice(start, end);
      // `\n\nT3 Code` in source: the escape's letter would hide the word boundary before "T3".
      const next = raw
        .split(/(\\[nrt])/)
        .map((part, index) => (index % 2 === 1 ? part : rebrandText(part, options)))
        .join("");
      if (next !== raw) edits.push({ start, end, text: next });
      return;
    }
    if (ts.isCallExpression(node) && isRequireOrDynamicImport(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (edits.length === 0) return source;
  let out = "";
  let cursor = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}

function isRequireOrDynamicImport(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(node.expression) && node.expression.text === "require";
}

const slug = (value: string) => value.toLowerCase().replace(/\s+/g, "-");

/** Markdown: prose and code are rewritten; URLs and link targets are kept except heading anchors. */
export function rebrandMarkdown(source: string, options: RebrandOptions): string {
  const urlOrTarget = /(\]\([^)\s]*\)|<https?:[^>]*>|https?:\/\/[^\s)>\]`"']+)/g;
  return (
    source
      // Upstream's one-line installers fetch T3 Code; ours point at ZEN_CLI_INSTALL_*_TARGET.
      .replace(/https:\/\/t3\.codes\/install\.sh\b/g, ZEN_CLI_INSTALL_SH_TARGET)
      .replace(/https:\/\/t3\.codes\/install\.ps1\b/g, ZEN_CLI_INSTALL_PS1_TARGET)
      .split(/(\r?\n)/)
      .map((line) =>
        line
          .split(urlOrTarget)
          .map((part, index) => {
            if (index % 2 === 0) return rebrandText(part, options);
            // In-page and cross-page anchors follow the renamed headings.
            return part.replace(/#([\w-]+)/g, (anchor) =>
              anchor
                .replace(/t3-code(?=-|$|\b)/g, slug(options.appName))
                .replace(/t3-connect(?=-|$|\b)/g, slug(options.hubName)),
            );
          })
          .join(""),
      )
      .join("")
  );
}

function* walk(dir: string): Generator<string> {
  let entries: Array<NodeFS.Dirent>;
  try {
    entries = NodeFS.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walk(NodePath.join(dir, entry.name));
    } else if (entry.isFile()) {
      yield NodePath.join(dir, entry.name);
    }
  }
}

export function defaultTargets(): Array<string> {
  const files: Array<string> = [];
  for (const root of SOURCE_ROOTS) {
    for (const absolute of walk(NodePath.join(repoRoot, root))) {
      const relative = NodePath.relative(repoRoot, absolute).split(NodePath.sep).join("/");
      if (root === "packages" && !relative.includes("/src/")) continue;
      if (!SOURCE_EXTENSIONS.has(NodePath.extname(relative))) continue;
      if (relative.endsWith(".gen.ts") || relative.endsWith(".d.ts")) continue;
      files.push(relative);
    }
  }
  for (const root of DOC_ROOTS) {
    for (const absolute of walk(NodePath.join(repoRoot, root))) {
      if (absolute.endsWith(".md")) files.push(NodePath.relative(repoRoot, absolute));
    }
  }
  files.push(...DOC_FILES, ...EXTRA_SOURCE_FILES);
  // Provider replay recordings hold the instructions the server sends, so they follow the text.
  for (const absolute of walk(NodePath.join(repoRoot, REPLAY_FIXTURE_ROOT))) {
    if (absolute.endsWith(".ndjson")) files.push(NodePath.relative(repoRoot, absolute));
  }
  return files.filter((file) => !EXCLUDED_FILES.has(file));
}

export function rebrandFile(relative: string, options: RebrandOptions): string | null {
  const absolute = NodePath.join(repoRoot, relative);
  const source = NodeFS.readFileSync(absolute, "utf8");
  const next = relative.endsWith(".md")
    ? rebrandMarkdown(source, options)
    : relative.endsWith(".ndjson")
      ? source
          .split("\n")
          .map((line) => rebrandText(line, options))
          .join("\n")
      : rebrandSource(relative, source, options);
  return next === source ? null : next;
}

const isMain = import.meta.filename === NodePath.resolve(process.argv[1] ?? "");
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--record-identity")) {
    const recorded = recordZenIdentityTestEdits(repoRoot);
    console.log(
      `zen-rebrand: recorded identity edits for ${Object.keys(recorded).length} test(s).`,
    );
    process.exit(0);
  }
  const check = args.includes("--check");
  const previousNames: Array<string> = [];
  const only: Array<string> = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--from") previousNames.push(args[(index += 1)] ?? "");
    else if (args[index] === "--files") {
      while (args[index + 1] && !args[index + 1]!.startsWith("--")) only.push(args[(index += 1)]!);
    }
  }
  const options: RebrandOptions = {
    appName: ZEN_APP_BASE_NAME,
    hubName: ZEN_HUB_NAME,
    cliName: ZEN_CLI_NAME,
    previousNames: previousNames.filter((name) => name.length > 0),
  };
  const targets =
    only.length > 0
      ? only.map((file) => NodePath.relative(repoRoot, NodePath.resolve(file)))
      : defaultTargets();
  const changed: Array<string> = [];
  for (const relative of targets) {
    if (EXCLUDED_FILES.has(relative)) continue;
    const next = rebrandFile(relative, options);
    if (next === null) continue;
    changed.push(relative);
    if (!check) NodeFS.writeFileSync(NodePath.join(repoRoot, relative), next);
  }
  // Identity tests: literal Zen values instead of T3's (scripts/lib/zen-identity-tests.ts).
  const identity = applyZenIdentityTestEdits(repoRoot, {
    check,
    only: only.length > 0 ? targets : null,
  });
  changed.push(...identity.changed);
  for (const problem of identity.problems) console.error(`zen-rebrand: ${problem}`);
  if (check) {
    for (const file of changed) console.log(file);
    if (changed.length > 0 || identity.problems.length > 0) {
      console.error(`zen-rebrand: ${changed.length} file(s) still show T3 names.`);
      process.exitCode = 1;
    }
  } else {
    console.log(`zen-rebrand: rewrote ${changed.length} file(s).`);
    if (identity.problems.length > 0) process.exitCode = 1;
  }
}
