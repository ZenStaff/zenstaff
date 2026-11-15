// @effect-diagnostics nodeBuiltinImport:off - a one-off generator run by hand.
// Zen Staff: writes skill.gen.ts from SKILL.md so packaged builds carry the "Conectare" skill (the
// zen-connect MCP server sends it as its instructions). Run after editing SKILL.md:
//   node apps/server/src/zen/connectors/skill/embed.ts
// skill.test (connectors.test.ts) fails when the generated file is stale.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

function skillModule(markdown: string): string {
  return `// Generated from SKILL.md by embed.ts. Do not edit.\nexport const CONECTARE_SKILL = ${JSON.stringify(markdown)};\n`;
}

if (import.meta.main) {
  const here = import.meta.dirname;
  const markdown = NodeFS.readFileSync(NodePath.join(here, "SKILL.md"), "utf8");
  NodeFS.writeFileSync(NodePath.join(here, "skill.gen.ts"), skillModule(markdown));
}
