// Zen Staff: strings of the Terminal sessions page and its entry points.
import { countLabel, defineZenMessages } from "../i18n/zenI18n";

export const cliSessionsText = defineZenMessages({
  en: {
    // Entry points.
    navLabel: "Terminal sessions",
    paletteTitle: "Open terminal sessions",
    // Page.
    title: "Terminal sessions",
    breadcrumb: "Terminal sessions breadcrumb",
    refresh: "Refresh terminal sessions",
    intro:
      "Claude Code and Codex sessions started in a terminal on your machines. Import one as a thread with its whole history (tool steps included); continuing it resumes the same session, so the agent keeps its context. Or copy the command to continue it in a terminal.",
    searchLabel: "Search terminal sessions",
    searchPlaceholder: "Search titles and conversations",
    sourceLabel: "Session source",
    originTerminal: "Terminal",
    originApp: "Zen",
    originOther: "SDK / IDE",
    allClients: "All clients",
    alreadyInThreads: "Already in threads",
    noMachineTitle: "No machine connected",
    noMachineDescription: "Connect an environment to see its terminal sessions.",
    machineFallback: "Machine",
    loadFailed: "Could not load sessions from this machine.",
    sessionsOn: (machine: string) => `Sessions on ${machine}`,
    shownOf: (shown: number, total: number) => `${shown} of ${total}`,
    matchesNoun: (count: number): string => (count === 1 ? "match" : "matches"),
    sessionsNoun: (count: number): string => (count === 1 ? "session" : "sessions"),
    noMatch: "No session matches this search.",
    noSessions: "No terminal sessions on this machine.",
    unknownFolder: "Unknown folder",
    messageCount: (count: number) => countLabel("en", count, { one: "message", other: "messages" }),
    resumeFailed: "Could not import the session",
    commandCopied: "Resume command copied",
    commandClipboardName: "resume command",
    copyCommand: "Copy resume command",
    openThread: "Open thread",
    resuming: "Importing…",
    resume: "Import",
    selectSession: (title: string) => `Select ${title}`,
    selectAllShown: "Select all shown",
    clearSelection: "Clear selection",
    importSelected: (count: number) =>
      `Import ${countLabel("en", count, { one: "session", other: "sessions" })}`,
    bulkHint: "New colleague? Select all and import your terminal history in one go.",
    bulkProgress: (done: number, total: number) => `Importing ${done} of ${total}…`,
    bulkDone: (imported: number, failed: number) =>
      failed > 0
        ? `Imported ${imported}; ${failed} could not be imported.`
        : `Imported ${imported}.`,
    importedItems: (count: number) =>
      `Imported with ${countLabel("en", count, { one: "entry", other: "entries" })} of history.`,
  },
  ro: {
    navLabel: "Sesiuni din terminal",
    paletteTitle: "Deschide sesiunile din terminal",
    title: "Sesiuni din terminal",
    breadcrumb: "Navigare sesiuni din terminal",
    refresh: "Reîncarcă sesiunile din terminal",
    intro:
      "Sesiunile Claude Code și Codex pornite într-un terminal pe calculatoarele tale. Importă una ca o conversație, cu tot istoricul (inclusiv pașii făcuți cu unelte); continuarea reia aceeași sesiune, deci agentul își păstrează contextul. Sau copiază comanda ca s-o continui în terminal.",
    searchLabel: "Caută în sesiunile din terminal",
    searchPlaceholder: "Caută în titluri și conversații",
    sourceLabel: "De unde vine sesiunea",
    originTerminal: "Terminal",
    originApp: "Zen",
    originOther: "SDK / IDE",
    allClients: "Toate aplicațiile",
    alreadyInThreads: "Deja în conversații",
    noMachineTitle: "Niciun calculator conectat",
    noMachineDescription: "Conectează un calculator ca să-i vezi sesiunile din terminal.",
    machineFallback: "Calculator",
    loadFailed: "Nu am putut încărca sesiunile de pe acest calculator.",
    sessionsOn: (machine: string) => `Sesiuni pe ${machine}`,
    shownOf: (shown: number, total: number) => `${shown} din ${total}`,
    matchesNoun: (count: number) => (count === 1 ? "rezultat" : withDe(count, "rezultate")),
    sessionsNoun: (count: number) => (count === 1 ? "sesiune" : withDe(count, "sesiuni")),
    noMatch: "Nicio sesiune nu se potrivește cu căutarea.",
    noSessions: "Nicio sesiune din terminal pe acest calculator.",
    unknownFolder: "Folder necunoscut",
    messageCount: (count: number) => countLabel("ro", count, { one: "mesaj", other: "mesaje" }),
    resumeFailed: "Nu am putut importa sesiunea",
    commandCopied: "Comanda de continuare a fost copiată",
    commandClipboardName: "comanda de continuare",
    copyCommand: "Copiază comanda de continuare",
    openThread: "Deschide conversația",
    resuming: "Se importă…",
    resume: "Importă",
    selectSession: (title: string) => `Selectează ${title}`,
    selectAllShown: "Selectează tot ce se vede",
    clearSelection: "Golește selecția",
    importSelected: (count: number) =>
      `Importă ${count === 1 ? "o sesiune" : countLabel("ro", count, { one: "sesiune", other: "sesiuni" })}`,
    bulkHint: "Coleg nou? Selectează tot și importă-ți istoricul din terminal dintr-o dată.",
    bulkProgress: (done: number, total: number) => `Se importă ${done} din ${total}…`,
    bulkDone: (imported: number, failed: number) =>
      failed > 0
        ? `Am importat ${imported}; ${failed} nu s-au putut importa.`
        : `Am importat ${imported}.`,
    importedItems: (count: number) =>
      `Importată cu ${countLabel("ro", count, { one: "pas", other: "pași" })} din istoric.`,
  },
});

/** The noun after a number that is printed separately ("20 de sesiuni"). */
function withDe(count: number, noun: string): string {
  const rest = count % 100;
  return count !== 0 && (rest === 0 || rest >= 20) ? `de ${noun}` : noun;
}

/** Palette search terms in both languages, so either finds the page. */
export const CLI_SESSIONS_SEARCH_TERMS = [
  "terminal",
  "sessions",
  "claude",
  "codex",
  "resume",
  "import",
  "cli",
  "history",
  "uuid",
  "sesiuni",
  "sesiune",
  "continuă",
  "continua",
  "importă",
  "importa",
  "istoric",
  "conversații",
  "conversatii",
];
