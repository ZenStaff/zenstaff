// Zen Staff: strings of Settings > General > Tools (ToolsSettingsSection.tsx).
import { countLabel, defineZenMessages } from "../i18n/zenI18n";

export const toolsSettingsText = defineZenMessages({
  en: {
    section: "Tools",
    rowTitle: "Tools for workflows",
    loading: "Loading...",
    summary: (root: string, count: number, size: string) =>
      `Programs some workflows need (video, speech, documents), installed only for Zen Staff in ${root}. ${count} installed, ${size} in total.`,
    cleanUp: (unused: number) => (unused > 0 ? `Clean up unused (${unused})` : "Clean up unused"),
    nothingTitle: "Nothing installed yet",
    nothingDescription: "Tools are set up the first time a workflow needs them.",
    somethingWrong: "Something went wrong.",
    keepTitle: "Remove tools not used for",
    keepDescription:
      "Unused tools are removed automatically; they are set up again when a workflow needs them.",
    days: (count: number) => `${count} days`,
    forever: "Forever",
    runnerTitle: "This computer is the company's always-on server",
    runnerDescription: "Other computers connected to it can offer to run heavy workflows here.",
    safety: "Safety",
    sandbox: {
      bwrap: "Tools run in a sandbox (bubblewrap): only the task folder is writable.",
      "sandbox-exec": "Tools run in a macOS sandbox: only the task folder is writable.",
      none: "No sandbox is available on this computer; tools run with your permissions.",
    } as Record<string, string>,
    advisories: (source: string, date: string | null, blocked: number) =>
      `Security advisories: ${source}${date ? `, ${date}` : ""}; ${countLabel("en", blocked, { one: "blocked version", other: "blocked versions" })}.`,
    never: "never",
    notUsed: "Not used by any workflow",
    usedBy: (names: string, more: number) =>
      `Used by ${names}${more > 0 ? ` and ${more} more` : ""}`,
    lastUsed: (date: string) => `last used ${date}`,
    blocked: "Blocked",
    license: "License",
    works: "Works",
    broken: "Broken",
    verify: "Verify",
    remove: "Remove",
    systemTitle: "Use tools already installed",
    systemDescription:
      "When a program this computer already has fits (version, security advisories, needed features), Zen uses it instead of downloading its own copy. Those programs are not checksum-pinned by Zen.",
    systemFound: "Found on this computer",
    systemNone: "Nothing usable found on this computer.",
    systemUsable: "usable",
    systemNotUsed: (reason: string) => `not used: ${reason}`,
    systemPinned: "Zen version chosen",
    systemUnpin: "Use the installed one",
    companyPinnedTitle: "Company: Zen versions only",
    companyPinnedDescription:
      "Company workflows and the company server always use Zen's pinned, checksum-checked tools. Only company owners and admins can change this. Enterprise workflows always do.",
    mirrorTitle: "Download tools from",
    mirrorDescription:
      "Zen's mirror is tried first, then the official site. The files are checked the same way wherever they come from.",
    mirrorDefault: "Zen mirror (tools.zed-zen.com)",
    mirrorOff: "Official sites only",
    mirrorCustom: "Own mirror",
    mirrorPlaceholder: "https://mirror.example.com",
    save: "Save",
  },
  ro: {
    section: "Unelte",
    rowTitle: "Unelte pentru fluxuri de lucru",
    loading: "Se încarcă...",
    summary: (root, count, size) =>
      `Programe de care au nevoie unele fluxuri (video, voce, documente), instalate doar pentru Zen Staff în ${root}. ${countLabel("ro", count, { one: "unealtă instalată", other: "unelte instalate" })}, ${size} în total.`,
    cleanUp: (unused) =>
      unused > 0 ? `Curăță ce nu se folosește (${unused})` : "Curăță ce nu se folosește",
    nothingTitle: "Nimic instalat încă",
    nothingDescription: "Uneltele se instalează prima dată când un flux are nevoie de ele.",
    somethingWrong: "Ceva n-a mers.",
    keepTitle: "Șterge uneltele nefolosite de",
    keepDescription:
      "Uneltele nefolosite se șterg singure; se instalează din nou când un flux are nevoie de ele.",
    days: (count) => countLabel("ro", count, { one: "zi", other: "zile" }),
    forever: "Niciodată",
    runnerTitle: "Acest calculator e serverul firmei, pornit mereu",
    runnerDescription: "Celelalte calculatoare conectate la el pot trimite aici fluxurile grele.",
    safety: "Siguranță",
    sandbox: {
      bwrap: "Uneltele rulează izolat (bubblewrap): pot scrie doar în dosarul sarcinii.",
      "sandbox-exec": "Uneltele rulează izolat în macOS: pot scrie doar în dosarul sarcinii.",
      none: "Acest calculator nu poate izola uneltele; ele rulează cu drepturile tale.",
    },
    advisories: (source, date, blocked) =>
      `Avertismente de securitate: ${source}${date ? `, ${date}` : ""}; ${countLabel("ro", blocked, { one: "versiune blocată", other: "versiuni blocate" })}.`,
    never: "niciodată",
    notUsed: "Nu o folosește niciun flux",
    usedBy: (names, more) => `Folosită de ${names}${more > 0 ? ` și încă ${more}` : ""}`,
    lastUsed: (date) => `folosită ultima dată ${date}`,
    blocked: "Blocată",
    license: "Licență",
    works: "Merge",
    broken: "Nu merge",
    verify: "Verifică",
    remove: "Șterge",
    systemTitle: "Folosește uneltele deja instalate",
    systemDescription:
      "Când un program pe care calculatorul îl are deja se potrivește (versiune, avertismente de securitate, funcții necesare), Zen îl folosește în loc să descarce propria copie. Aceste programe nu sunt verificate de Zen prin sumă de control.",
    systemFound: "Găsite pe acest calculator",
    systemNone: "Nu am găsit nimic potrivit pe acest calculator.",
    systemUsable: "se poate folosi",
    systemNotUsed: (reason) => `nu se folosește: ${reason}`,
    systemPinned: "ai ales versiunea Zen",
    systemUnpin: "Folosește-l pe cel instalat",
    companyPinnedTitle: "Firma: doar versiunile Zen",
    companyPinnedDescription:
      "Fluxurile firmei și serverul firmei folosesc mereu uneltele Zen, fixate și verificate. Doar proprietarii și administratorii firmei pot schimba asta. Fluxurile Enterprise le folosesc oricum.",
    mirrorTitle: "De unde se descarcă uneltele",
    mirrorDescription:
      "Întâi de pe serverul Zen, apoi de pe site-ul oficial. Fișierele se verifică la fel, oriunde ar fi descărcate.",
    mirrorDefault: "Serverul Zen (tools.zed-zen.com)",
    mirrorOff: "Doar site-urile oficiale",
    mirrorCustom: "Server propriu",
    mirrorPlaceholder: "https://oglinda.firma.ro",
    save: "Salvează",
  },
});
