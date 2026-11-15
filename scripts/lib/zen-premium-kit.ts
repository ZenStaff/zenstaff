// @effect-diagnostics nodeBuiltinImport:off - Build-time helper for scripts/zen-embed-workflows.ts and its test.
// Zen Staff: the premium kit (apps/server/src/zen/workflows/premium-kit) is one source shared by
// the video and design packs. Packs are installed by copying their own folder, so each consuming
// pack carries a generated copy in `<pack>/kit/` (only the parts it lists in consumers.json).
// Edit the kit, never the copies; `zen:workflows` refreshes them and a test fails when stale.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const KIT_DIR = "premium-kit";
export const KIT_COPY = "kit";
const NOTICE =
  "# Generated copy\n\nThis folder is a copy of `apps/server/src/zen/workflows/premium-kit` made by\n`vp run --filter @t3tools/scripts zen:workflows`. Edit the kit there, not here.\n";

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of NodeFS.readdirSync(dir).toSorted()) {
    if (name === ".DS_Store") continue;
    const absolute = NodePath.join(dir, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (NodeFS.statSync(absolute).isDirectory()) out.push(...listFiles(absolute, relative));
    else out.push(relative);
  }
  return out;
}

/** What every consuming pack's kit/ folder must contain: relative path -> text. */
export function expectedKitCopies(workflowsDir: string): Record<string, Record<string, string>> {
  const kit = NodePath.join(workflowsDir, KIT_DIR);
  const consumers = JSON.parse(
    NodeFS.readFileSync(NodePath.join(kit, "consumers.json"), "utf8"),
  ) as Record<string, string[]>;
  const result: Record<string, Record<string, string>> = {};
  for (const [pack, parts] of Object.entries(consumers)) {
    const files: Record<string, string> = { "README.md": NOTICE };
    for (const part of parts) {
      for (const file of listFiles(NodePath.join(kit, part))) {
        files[`${part}/${file}`] = NodeFS.readFileSync(NodePath.join(kit, part, file), "utf8");
      }
    }
    result[pack] = files;
  }
  return result;
}

/** Rewrites every `packs/<id>/kit/` folder from the kit. Returns the packs written. */
export function syncPremiumKit(workflowsDir: string): string[] {
  const written: string[] = [];
  for (const [pack, files] of Object.entries(expectedKitCopies(workflowsDir))) {
    const target = NodePath.join(workflowsDir, "packs", pack, KIT_COPY);
    NodeFS.rmSync(target, { recursive: true, force: true });
    for (const [relative, text] of Object.entries(files)) {
      const file = NodePath.join(target, relative);
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, text);
    }
    written.push(pack);
  }
  return written;
}
