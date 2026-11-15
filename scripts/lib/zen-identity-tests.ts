// @effect-diagnostics nodeBuiltinImport:off - Codemod helper.
// Zen Staff: upstream tests that assert T3 Code's identity (`~/.t3`, `t3code://`,
// `com.t3tools.*`, "T3 Code" names, v1 profile import, ...) are edited to assert Zen's instead.
// The edits are recorded as before/after hunks against the `upstream` branch in
// zen-identity-tests.json, so a sync can take upstream's version of such a test and re-apply them:
//
//   node scripts/zen-rebrand.ts --files <test>        re-apply the recorded hunks to one test
//   node scripts/zen-rebrand.ts --record-identity     re-record after editing a test by hand
//
// A hunk whose "before" text is gone (upstream changed those lines) is reported, never guessed:
// edit the test by hand to assert the Zen value, then record again. See ZEN.md "Identity tests".
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Hand-maintained: every upstream test file that asserts Zen identity instead of T3's. */
export const ZEN_IDENTITY_TEST_FILES: ReadonlyArray<string> = [
  "apps/desktop/src/app/DesktopAppIdentity.test.ts",
  "apps/desktop/src/app/DesktopClerk.test.ts",
  "apps/desktop/src/app/DesktopEnvironment.test.ts",
  "apps/desktop/src/app/DesktopLifecycle.test.ts",
  "apps/desktop/src/app/DesktopLinuxUrlHandler.test.ts",
  "apps/desktop/src/app/DesktopPreReadyPlatform.test.ts",
  "apps/desktop/src/app/DesktopUserData.test.ts",
  "apps/desktop/src/window/DesktopWindow.test.ts",
  "apps/desktop/src/app/DesktopCliCommand.test.ts",
  "packages/shared/src/promptLinks.test.ts",
  "scripts/install.test.ts",
  "apps/server/src/cli/app.test.ts",
  "apps/server/src/cli/config.test.ts",
  "apps/server/src/cli/pair.test.ts",
  "apps/server/src/cli/invocation.test.ts",
  "apps/server/src/cliCompileCache.test.ts",
  "apps/server/src/preview/PreviewBrowser.test.ts",
  "apps/server/src/cloud/servicePreflight.test.ts",
  "apps/server/src/cli/install.test.ts",
  "apps/server/src/provider/agentContextBudget.json",
  "scripts/build-desktop-artifact.test.ts",
  "apps/mobile/app.config.test.ts",
  "apps/mobile/src/features/settings/environmentUpdateCheck.test.ts",
  "apps/server/src/cli/update.test.ts",
  "packages/ssh/src/tunnel.test.ts",
  "apps/mobile/src/features/settings/environment-maintenance.test.ts",
];

const DATA_FILE = NodePath.join(import.meta.dirname, "zen-identity-tests.json");

interface Hunk {
  readonly before: string;
  readonly after: string;
}
type Recorded = Record<string, ReadonlyArray<Hunk>>;

const readRecorded = (): Recorded => {
  try {
    return JSON.parse(NodeFS.readFileSync(DATA_FILE, "utf8")) as Recorded;
  } catch {
    return {};
  }
};

/** Parses `git diff -U1` output of one file into before/after blocks (context lines in both). */
export function parseHunks(diff: string): Array<Hunk> {
  const hunks: Array<Hunk> = [];
  let before: Array<string> | null = null;
  let after: Array<string> = [];
  const flush = () => {
    if (before) hunks.push({ before: before.join("\n"), after: after.join("\n") });
    before = null;
    after = [];
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      flush();
      before = [];
      continue;
    }
    if (!before) continue;
    if (line.startsWith("\\")) continue;
    const body = line.slice(1);
    if (line.startsWith(" ")) {
      before.push(body);
      after.push(body);
    } else if (line.startsWith("-")) before.push(body);
    else if (line.startsWith("+")) after.push(body);
  }
  flush();
  return hunks;
}

export function recordZenIdentityTestEdits(repoRoot: string): Recorded {
  const recorded: Record<string, Array<Hunk>> = {};
  for (const file of ZEN_IDENTITY_TEST_FILES) {
    const diff = NodeChildProcess.execFileSync(
      "git",
      ["diff", "--no-color", "-U1", "upstream", "--", file],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const hunks = parseHunks(diff);
    if (hunks.length > 0) recorded[file] = hunks;
  }
  NodeFS.writeFileSync(DATA_FILE, `${JSON.stringify(recorded, null, 2)}\n`);
  return recorded;
}

/** Applies each hunk once, in order; already-applied hunks are skipped. */
export function applyHunks(
  source: string,
  hunks: ReadonlyArray<Hunk>,
): { readonly text: string; readonly missing: Array<string> } {
  let text = source;
  let cursor = 0;
  const missing: Array<string> = [];
  for (const hunk of hunks) {
    const at = text.indexOf(hunk.before, cursor);
    const done = text.indexOf(hunk.after, cursor);
    if (hunk.before !== hunk.after && done !== -1 && (at === -1 || done <= at)) {
      cursor = done + hunk.after.length;
      continue;
    }
    if (at === -1) {
      missing.push(hunk.before.split("\n").find((line) => line.trim().length > 0) ?? "");
      continue;
    }
    text = text.slice(0, at) + hunk.after + text.slice(at + hunk.before.length);
    cursor = at + hunk.after.length;
  }
  return { text, missing };
}

export function applyZenIdentityTestEdits(
  repoRoot: string,
  input: { readonly check: boolean; readonly only: ReadonlyArray<string> | null },
): { readonly changed: Array<string>; readonly problems: Array<string> } {
  const recorded = readRecorded();
  const changed: Array<string> = [];
  const problems: Array<string> = [];
  for (const file of ZEN_IDENTITY_TEST_FILES) {
    if (input.only && !input.only.includes(file)) continue;
    const hunks = recorded[file];
    if (!hunks) continue;
    const absolute = NodePath.join(repoRoot, file);
    if (!NodeFS.existsSync(absolute)) {
      problems.push(
        `${file}: identity test is gone upstream; drop it from ZEN_IDENTITY_TEST_FILES`,
      );
      continue;
    }
    const source = NodeFS.readFileSync(absolute, "utf8");
    const { text, missing } = applyHunks(source, hunks);
    for (const line of missing) {
      problems.push(`${file}: upstream changed the lines near "${line.trim()}"; re-apply by hand`);
    }
    if (text !== source) {
      changed.push(file);
      if (!input.check) NodeFS.writeFileSync(absolute, text);
    }
  }
  return { changed, problems };
}
