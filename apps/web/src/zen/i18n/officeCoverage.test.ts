// @effect-diagnostics nodeBuiltinImport:off - reads the Zen source files on disk.
// Fails when a Zen string an Office person can see has no Romanian: every catalog's Romanian side
// is complete and translated, no cedilla letters (ş ţ) anywhere, upstream and server tables are
// filled, and Zen .tsx files show no literal English in JSX text or user-facing attributes.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { zenServerText } from "./serverText";
import { UPSTREAM_CODE_RO } from "./upstreamCodeText";
import { UPSTREAM_OFFICE_RO, UPSTREAM_SCREENS_RO } from "./upstreamScreensText";
import { UPSTREAM_SETTINGS_RO } from "./upstreamSettingsText";
import { translateUpstreamText } from "./upstreamText";
import { UPSTREAM_TOAST_RO } from "./upstreamToastText";

const ZEN_DIR = NodePath.join(import.meta.dirname, "..");

function filesUnder(dir: string, test: (name: string) => boolean): string[] {
  return NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full, test);
    return test(entry.name) ? [full] : [];
  });
}

const catalogModules = import.meta.glob<Record<string, unknown>>("../**/*.i18n.ts", {
  eager: true,
});

function isCatalog(
  value: unknown,
): value is { en: Record<string, unknown>; ro: Record<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { en?: unknown }).en === "object" &&
    typeof (value as { ro?: unknown }).ro === "object"
  );
}

/** Romanian that may equal the English: names, units, codes, words both languages share. */
const SAME_IN_BOTH = new Set([
  // Same word in Romanian, product names, and the exact field names of the Microsoft/Meta portals.
  "Zen Staff",
  // The company AI providers (Cont AI).
  "Anthropic (Claude)",
  "OpenAI (Codex)",
  "Personal",
  "Test",
  // The Stop button and the manager of an AI employee are the same words in Romanian.
  "Stop",
  "Manager",
  "Manifest",
  "Claude Code",
  "Directory (tenant) ID",
  "Application ID",
  "Phone number ID",
  "English",
  "Română",
  "Office",
  "Code",
  "General",
  "Model",
  "Standard",
  "Enterprise",
  "Server",
  "Beta",
  "Hub",
  "Email",
  "E-mail",
  "e-mail",
  "Google",
  "Microsoft",
  "Cost",
  "Video",
  "Admin",
  "Administrator",
  "Design",
  "PR",
  "Browser",
  "Android",
  "OK",
  "API",
  "Terminal",
  "Webhook",
  "webhook",
  "manual",
  "personal",
  // Brand names and words spelled the same in Romanian.
  "Google",
  "Microsoft",
  "e-mail",
  "Cost",
  // Chat imports and document editing: product names and words Romanian uses as is.
  "Folder",
  "ChatGPT",
  "Claude.ai",
  "Gemini",
  "Markdown",
  "Link",
  // "Connect your AI" cards.
  "Claude",
  "Google (Gemini)",
]);

function walk(en: unknown, ro: unknown, path: string, problems: string[]): void {
  if (typeof en === "string") {
    if (typeof ro !== "string" || ro.trim() === "") problems.push(`${path}: missing Romanian`);
    else if (
      ro === en &&
      en.trim().length > 3 &&
      !SAME_IN_BOTH.has(en.trim()) &&
      /[a-z]{3}/.test(en)
    )
      problems.push(`${path}: Romanian is the English text "${en}"`);
    return;
  }
  if (typeof en === "function") {
    if (typeof ro !== "function") problems.push(`${path}: Romanian is not a function`);
    return;
  }
  if (typeof en === "object" && en !== null) {
    if (typeof ro !== "object" || ro === null) {
      problems.push(`${path}: missing Romanian object`);
      return;
    }
    for (const key of Object.keys(en)) {
      walk(
        (en as Record<string, unknown>)[key],
        (ro as Record<string, unknown>)[key],
        `${path}.${key}`,
        problems,
      );
    }
  }
}

describe("Office-visible Zen strings have Romanian", () => {
  it("finds the catalogs", () => {
    const catalogs = Object.values(catalogModules).flatMap((module) =>
      Object.values(module).filter(isCatalog),
    );
    expect(catalogs.length).toBeGreaterThanOrEqual(10);
  });

  it("every catalog has a complete, translated Romanian side", () => {
    const problems: string[] = [];
    for (const [file, module] of Object.entries(catalogModules)) {
      for (const [name, value] of Object.entries(module)) {
        if (isCatalog(value)) walk(value.en, value.ro, `${file}:${name}`, problems);
      }
    }
    expect(problems).toEqual([]);
  });

  it("uses comma-below ș ț, never the cedilla letters", () => {
    // Tests may name the cedilla letters on purpose.
    const offenders = filesUnder(
      ZEN_DIR,
      (name) => /\.(ts|tsx)$/.test(name) && !name.includes(".test."),
    )
      .filter((file) => /[şţŞŢ]/.test(NodeFS.readFileSync(file, "utf8")))
      .map((file) => NodePath.relative(ZEN_DIR, file));
    expect(offenders).toEqual([]);
  });

  it("upstream Settings and toast tables are filled and reach the rewriter", () => {
    for (const table of [UPSTREAM_SETTINGS_RO, UPSTREAM_TOAST_RO]) {
      for (const [english, romanian] of Object.entries(table)) {
        expect(romanian.trim(), english).not.toBe("");
      }
    }
    expect(translateUpstreamText("Transcription language", "ro")).toBe("Limba transcrierii");
    expect(translateUpstreamText("Not connected: message not sent", "ro")).toBe(
      "Fără conexiune: mesajul nu s-a trimis",
    );
    expect(translateUpstreamText("Large paste attached as notes.txt", "ro")).toBe(
      "Textul lung a fost atașat ca notes.txt",
    );
    // Long descriptions (over 200 characters) are covered too.
    const long =
      "Names and terms transcription should spell your way, saved on this device. Add an alias when it keeps hearing a term wrong. The name of the project you dictate in is also sent as a hint.";
    expect(translateUpstreamText(long, "ro")).toMatch(/^Nume și termeni/);
    // The sidebar's empty state.
    expect(translateUpstreamText("No projects yet", "ro")).toBe("Încă nu ai dosare");
    expect(translateUpstreamText("No projects yet", "en")).toBe("No folders yet");
    expect(translateUpstreamText("No threads in Acme yet", "ro")).toBe(
      "Încă nu sunt sarcini în Acme",
    );
    // Notices written into imported chats.
    expect(
      translateUpstreamText(
        'Imported from ChatGPT (gpt-4o). This imported copy is read-only; use "Continue in a new chat" to keep working on it.',
        "ro",
      ),
    ).toMatch(/^Importat din ChatGPT \(gpt-4o\)\. /);
    expect(
      translateUpstreamText(
        'Continued from the imported Gemini chat "Plan de marketing". The assistant gets the summary and the latest messages below as context.',
        "ro",
      ),
    ).toMatch(/^Continuare a conversației „Plan de marketing” importate din Gemini\./);
    expect(
      translateUpstreamText(
        "Continued from a terminal session. 12 earlier entries are not shown here; the agent still has the full conversation.",
        "ro",
      ),
    ).toMatch(/12 intrări mai vechi/);
    // English Office wording is untouched for these Romanian-only tables.
    expect(translateUpstreamText("Transcription language", "en")).toBeNull();
  });

  it("Settings, Environments, About and the Usage window are Romanian in both editions", () => {
    // What Alex saw in English (0.2.1, Code edition in Romanian), screen by screen.
    const COVERAGE: Readonly<Record<string, ReadonlyArray<string>>> = {
      "settings sidebar": [
        "General",
        "Appearance",
        "Chat",
        "Diffs & pull requests",
        "Keybindings",
        "Voice",
        "SnapShots",
        "Agents",
        "Providers",
        "Threads",
        "Browser",
        "Devices",
        "Scheduled tasks",
        "Code",
        "Projects",
        "Source control",
        "Worktrees",
        "Connections",
        "Environments",
        "Sharing & access",
        "Maintenance",
        "Labs",
        "Privacy",
        "About",
        "Archive",
        "Search",
        "No settings found",
      ],
      environments: [
        "Local environment",
        "Environments",
        "Add environment",
        "Add Environment",
        "Linked environments",
        "Link",
        "Load balancing",
        "Automatically balance load",
        "Pull request sharing",
        "Read PRs",
        "Connected",
        "Routes",
        "Add route",
        "Permissions",
        "This machine",
        "Network access",
        "No saved remote environments",
        "Click “Add environment” to pair another environment.",
        "Pair another environment to this client.",
        "Enter a backend host and pairing code.",
        "Paste a full pairing URL here to fill both fields automatically.",
        "Remote link",
        "Host",
      ],
      about: [
        "Version",
        "Up to Date",
        "zs command",
        "Run Zen Staff's CLI as `zs` from any terminal.",
        "Mobile app",
        "Legal",
        "Privacy policy",
        "Open source licenses",
        "Copy version 0.2.1",
      ],
      devices: [
        "Use devices",
        "Agents can use devices",
        "Device sources",
        "Add source",
        "Local simulators",
      ],
      providers: [
        "Add provider",
        "Compact idle threads",
        "Binary path",
        "Launch arguments",
        "Authenticated · Claude Ultra Subscription",
      ],
      general: ["Notifications", "Sidebar", "Project grouping", "Updates", "Check for updates"],
      usage: [
        "Usage",
        "All environments",
        "All providers",
        "Cost (C)",
        "Tokens",
        "Limits",
        "Weekly",
        "Weekly · Fable",
        "left",
        "4d 21h",
        "↻ 4d 21h",
        "Past 24h",
        "791 sessions",
        "Oct 10 to Nov 8",
      ],
      "thread screen": [
        "Toggle Sidebar",
        "Command palette",
        "Open in editor",
        "Send a message to start the conversation.",
      ],
    };
    // Same word in Romanian.
    const SAME = new Set(["General", "Browser", "Cost (C)", "Link"]);
    const missing: string[] = [];
    for (const [screen, strings] of Object.entries(COVERAGE)) {
      for (const english of strings) {
        for (const edition of ["code", "office"] as const) {
          const romanian = translateUpstreamText(english, "ro", edition);
          if (romanian === null ? !SAME.has(english) : romanian === english) {
            missing.push(`${screen} (${edition}): ${english}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);

    // The words Alex asked for.
    expect(translateUpstreamText("Usage", "ro", "code")).toBe("Consum");
    expect(translateUpstreamText("All environments", "ro", "code")).toBe("Toate mediile");
    expect(translateUpstreamText("All providers", "ro", "code")).toBe("Toți furnizorii");
    expect(translateUpstreamText("Tokens", "ro", "code")).toBe("Tokeni");
    expect(translateUpstreamText("Limits", "ro", "code")).toBe("Limite");
    expect(translateUpstreamText("Weekly · Fable", "ro", "code")).toBe("Săptămânal · Fable");
    expect(translateUpstreamText("left", "ro", "code")).toBe("rămas");
    expect(translateUpstreamText("4d 21h", "ro", "code")).toBe("4z 21h");
    expect(translateUpstreamText("↻ 4d 21h", "ro", "code")).toBe("↻ 4z 21h");
    expect(
      translateUpstreamText(
        "Claude: 41% left, resets in 4d 21h, 70% of the window left",
        "ro",
        "code",
      ),
    ).toBe("Claude: 41% rămas, se resetează în 4z 21h, 70% din interval rămas");
    expect(translateUpstreamText("791 sessions", "ro", "code")).toBe("791 de sesiuni");
    expect(translateUpstreamText("9 sessions", "ro", "code")).toBe("9 sesiuni");
    // Office keeps its own wording; Code English stays upstream's.
    expect(translateUpstreamText("Environments", "ro", "office")).toBe("Calculatoare");
    expect(translateUpstreamText("Environments", "ro", "code")).toBe("Medii");
    expect(translateUpstreamText("Projects", "en", "office")).toBe("Folders");
    expect(translateUpstreamText("Projects", "en", "code")).toBeNull();
    expect(translateUpstreamText("Usage", "en", "code")).toBeNull();
  });

  it("Code wording never falls back to Office's dosar or calculator for projects and environments", () => {
    const keys = new Set([
      ...Object.keys(UPSTREAM_SETTINGS_RO),
      ...Object.keys(UPSTREAM_SCREENS_RO),
      ...Object.keys(UPSTREAM_OFFICE_RO),
      ...Object.keys(UPSTREAM_TOAST_RO),
      ...Object.keys(UPSTREAM_CODE_RO),
    ]);
    const offenders: string[] = [];
    for (const english of keys) {
      if (!/\b(project|environment|workspace)s?\b/i.test(english)) continue;
      if (/folder|director|computer|machine|host|desktop/i.test(english)) continue;
      const romanian = translateUpstreamText(english, "ro", "code") ?? "";
      if (/dosar|calculator/i.test(romanian)) offenders.push(`${english} -> ${romanian}`);
    }
    expect(offenders).toEqual([]);
    for (const [english, romanian] of Object.entries({
      ...UPSTREAM_CODE_RO,
      ...UPSTREAM_SCREENS_RO,
      ...UPSTREAM_OFFICE_RO,
    })) {
      expect(romanian.trim(), english).not.toBe("");
    }
  });

  it("server messages reach the person in Romanian", () => {
    expect(zenServerText("This pack is not installed.", "ro")).toBe(
      "Acest pachet nu este instalat.",
    );
    expect(
      zenServerText("Could not install the pack: This pack is not in the library.", "ro"),
    ).toBe("Nu am putut instala pachetul: Acest pachet nu este în bibliotecă.");
    expect(
      zenServerText(
        "The library at hub.example could not be reached (timeout). Showing the copy saved on 2026-11-01.",
        "ro",
      ),
    ).toBe(
      "Biblioteca de la hub.example nu a putut fi accesată (timeout). Arăt copia salvată pe 2026-11-01.",
    );
    expect(zenServerText("redacted before sending: API key", "ro")).toBe(
      "ascuns înainte de trimitere: API key",
    );
    expect(zenServerText("Something new from the server", "ro")).toBe(
      "Something new from the server",
    );
    expect(zenServerText("This pack is not installed.", "en")).toBe("This pack is not installed.");
  });

  it("Zen .tsx files show no literal English outside the i18n layer", () => {
    // CSS selectors that name upstream's own labels.
    const SKIPPED_FILES = new Set(["office/ZenEditionRoot.tsx"]);
    const SKIPPED_DIRS: string[] = [];
    // Language names in their own language, product names and example values that are the same in
    // every language.
    const ALLOWED = new Set([
      "RO",
      "EN",
      "Promise",
      "Effect.Effect",
      "English",
      "#general",
      "Claude",
      "Codex",
      "XXXX-XXXX",
    ]);
    const attribute =
      /\s(?:title|description|label|placeholder|aria-label|alt)=(?:"([^"]*[A-Za-z]{2}[^"]*)"|\{\s*"([^"]*[A-Za-z]{2}[^"]*)"\s*\})/g;
    const jsxText = />\s*([A-Z][^<>{}`=;]*?[A-Za-z.?!)])\s*</g;
    const found: string[] = [];
    for (const file of filesUnder(
      ZEN_DIR,
      (name) => name.endsWith(".tsx") && !name.includes(".test."),
    )) {
      const rel = NodePath.relative(ZEN_DIR, file).replaceAll("\\", "/");
      if (SKIPPED_FILES.has(rel) || SKIPPED_DIRS.some((dir) => rel.startsWith(dir))) continue;
      const source = NodeFS.readFileSync(file, "utf8")
        // Line comments only: "http://" inside a string is not a comment.
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of source.matchAll(attribute)) {
        const text = (match[1] ?? match[2] ?? "").trim();
        if (!ALLOWED.has(text) && !/^https?:\/\//.test(text)) found.push(`${rel}: ${text}`);
      }
      for (const match of source.matchAll(jsxText)) {
        const text = (match[1] ?? "").replace(/\s+/g, " ").trim();
        if (text.length > 1 && !ALLOWED.has(text)) found.push(`${rel}: ${text}`);
      }
    }
    expect(found).toEqual([]);
  });
});
