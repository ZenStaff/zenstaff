// Zen Staff: strings of the chat import page, the imported-chat banner and their entry points.
import { countLabel, defineZenMessages } from "../i18n/zenI18n";

export const chatImportText = defineZenMessages({
  en: {
    navLabel: "Import chats",
    paletteTitle: "Import chats from ChatGPT, Claude or Gemini",
    title: "Import chats",
    intro:
      "Bring your earlier conversations here. Imported chats are kept read-only; continue any of them in a new chat, with its history summarized for the assistant.",
    terminalTitle: "From the terminal (Claude Code, Codex)",
    terminalBody:
      "Sessions started in a terminal on your machines are imported with their whole history, tool calls included, and continue as the same session.",
    openTerminalSessions: "Open terminal sessions",
    exportTitle: "From ChatGPT, Claude.ai or Gemini",
    howChatgpt:
      "ChatGPT: Settings > Data controls > Export data. Upload the .zip from the e-mail (or its conversations.json).",
    howClaude:
      "Claude.ai: Settings > Privacy > Export data. Upload the .zip (or its conversations.json).",
    howGemini:
      "Gemini: Google Takeout > My Activity > Gemini Apps. Upload the .zip or MyActivity.json / MyActivity.html.",
    privacyNote:
      "The file is read in this browser. Only the conversations you pick are sent, to the machine of the folder you choose.",
    chooseFile: "Choose export file",
    reading: "Reading the export…",
    notRecognized: "This file is not a ChatGPT, Claude.ai or Gemini export we can read.",
    readFailed: "Could not read the file.",
    foundIn: (count: number, source: string) =>
      `${countLabel("en", count, { one: "conversation", other: "conversations" })} found in the ${source} export.`,
    searchLabel: "Filter conversations",
    searchPlaceholder: "Filter by title or text",
    selectAll: "Select all shown",
    selectNone: "Clear selection",
    selectedCount: (count: number) => `${count} selected`,
    messages: (count: number) => countLabel("en", count, { one: "message", other: "messages" }),
    untitled: "Untitled chat",
    preview: "Preview",
    moreMessages: (count: number) =>
      `… and ${countLabel("en", count, { one: "more message", other: "more messages" })}`,
    folder: "Folder",
    chooseFolder: "Choose a folder",
    noFolders: "Add a folder first: imported chats are kept with a folder.",
    importSelected: (count: number) =>
      `Import ${countLabel("en", count, { one: "conversation", other: "conversations" })}`,
    importing: (done: number, total: number) => `Importing ${done} of ${total}…`,
    imported: (created: number, existing: number) =>
      existing > 0 ? `Imported ${created}; ${existing} were already here.` : `Imported ${created}.`,
    importFailed: "Could not import the conversations",
    importedTitle: "Imported chats",
    noImported: "No imported chats on this machine yet.",
    open: "Open",
    continueInNewChat: "Continue in a new chat",
    continuing: "Starting…",
    continueFailed: "Could not start the new chat",
    continuedExcerpt:
      "The summary model was not available, so the first request and the latest messages were carried over.",
    continuedCount: (count: number) =>
      countLabel("en", count, { one: "continuation", other: "continuations" }),
    sourceChatgpt: "ChatGPT",
    sourceClaude: "Claude.ai",
    sourceGemini: "Gemini",
    // Projects and organization (ChatGPT, Claude.ai).
    projectsTitle: "Projects",
    projectsBody: (base: string) =>
      `Each checked project becomes a folder in "${base}" with its instructions (AGENTS.md), knowledge files (cunostinte/) and memory (MEMORIE.md). Its chats are imported into it.`,
    chatgptProjectsGap:
      "ChatGPT's export has no project names, instructions or files. The projects are numbered by their latest chat: rename them here. Their chats are already grouped.",
    claudeSuggestGap:
      'Claude.ai\'s export does not say which chat belongs to which project. A chat whose title names exactly one project is suggested for it (marked "suggested"); check them and move the others.',
    chatgptProjectName: (index: number) => `ChatGPT project ${index}`,
    baseFolder: "Import folder",
    baseFolderHint: (folder: string) => `inside ${folder}`,
    defaultBaseFolder: (source: string) => `${source} imports`,
    includeProject: (name: string) => `Import project ${name}`,
    projectName: "Project name",
    projectChats: (count: number) => countLabel("en", count, { one: "chat", other: "chats" }),
    hasInstructions: "instructions",
    projectFiles: (count: number) => countLabel("en", count, { one: "file", other: "files" }),
    hasMemory: "memory",
    globalMemoryTitle: (source: string) => `What ${source} remembered about you`,
    globalMemoryKeep: (file: string) => `Save it as ${file} in the import folder`,
    globalMemoryNote: "It is not sent to company memory.",
    skippedFiles: (count: number, names: string) =>
      `${countLabel("en", count, { one: "file was", other: "files were" })} too large and left out: ${names}`,
    noProject: (folder: string) => `No project (${folder})`,
    chatProject: "Project for this chat",
    suggested: "suggested",
    starred: "Starred: pinned after import",
    archived: "archived",
    gptLabel: (id: string) => `GPT ${id}`,
    moveSelected: "Move selected to",
    move: "Move",
    importAll: (chats: number, projects: number) =>
      projects === 0
        ? `Import ${countLabel("en", chats, { one: "conversation", other: "conversations" })}`
        : `Import ${countLabel("en", chats, { one: "conversation", other: "conversations" })} and ${countLabel("en", projects, { one: "project", other: "projects" })}`,
    creatingProjects: (done: number, total: number) => `Creating projects: ${done} of ${total}…`,
    projectFailed: (name: string) => `Could not create the project "${name}"`,
    projectsCreated: (count: number) =>
      `${countLabel("en", count, { one: "project", other: "projects" })} ready.`,
    memorySaved: (path: string) => `Memory saved in ${path}`,
    memorySaveFailed: "Could not save the memory file",
    // Company memory.
    memoryTitle: "Send the useful parts to company memory",
    memoryBody:
      "Optional. One summary per chosen chat: secrets and personal data are removed first, small talk is skipped, and nothing is sent until you confirm. Only chats in a company folder whose memory saving is on can be sent.",
    memoryPreview: "Prepare summaries",
    memoryPreparing: "Summarizing…",
    memorySend: (count: number) =>
      `Send ${countLabel("en", count, { one: "summary", other: "summaries" })}`,
    memorySent: (count: number) =>
      `${countLabel("en", count, { one: "summary", other: "summaries" })} queued for company memory.`,
    memoryNone: "Choose imported chats above first.",
    memoryStatusReady: "Ready to send",
    memoryStatusNothing: "Nothing worth remembering",
    memoryStatusSkipped: "Skipped (too short or small talk)",
    memoryStatusOff: "Not sent: this folder's company has no memory, or saving is off",
    memoryStatusQueued: "Queued",
    memoryStatusFailed: "Could not summarize",
    memoryRedacted: (kinds: string) => `Removed before summarizing: ${kinds}`,
    memoryAlready: "Already sent",
    // Banner in an imported chat.
    bannerTitle: (source: string) => `Imported from ${source}`,
    bannerBody:
      "This copy is read-only. Continue it in a new chat; the assistant gets a summary of it.",
  },
  ro: {
    navLabel: "Importă conversații",
    paletteTitle: "Importă conversații din ChatGPT, Claude sau Gemini",
    title: "Importă conversații",
    intro:
      "Adu aici conversațiile tale de dinainte. Conversațiile importate rămân doar pentru citire; oricare poate fi continuată într-o conversație nouă, cu istoricul rezumat pentru asistent.",
    terminalTitle: "Din terminal (Claude Code, Codex)",
    terminalBody:
      "Sesiunile pornite într-un terminal pe calculatoarele tale se importă cu tot istoricul, inclusiv pașii făcuți cu unelte, și continuă ca aceeași sesiune.",
    openTerminalSessions: "Deschide sesiunile din terminal",
    exportTitle: "Din ChatGPT, Claude.ai sau Gemini",
    howChatgpt:
      "ChatGPT: Settings > Data controls > Export data. Încarcă fișierul .zip din e-mail (sau conversations.json din el).",
    howClaude:
      "Claude.ai: Settings > Privacy > Export data. Încarcă fișierul .zip (sau conversations.json din el).",
    howGemini:
      "Gemini: Google Takeout > My Activity > Gemini Apps. Încarcă fișierul .zip sau MyActivity.json / MyActivity.html.",
    privacyNote:
      "Fișierul e citit în acest browser. Se trimit doar conversațiile alese, pe calculatorul folderului ales.",
    chooseFile: "Alege fișierul exportat",
    reading: "Se citește exportul…",
    notRecognized: "Fișierul nu e un export ChatGPT, Claude.ai sau Gemini pe care îl putem citi.",
    readFailed: "Nu am putut citi fișierul.",
    foundIn: (count: number, source: string) =>
      `${countLabel("ro", count, { one: "conversație găsită", other: "conversații găsite" })} în exportul ${source}.`,
    searchLabel: "Filtrează conversațiile",
    searchPlaceholder: "Filtrează după titlu sau text",
    selectAll: "Selectează tot ce se vede",
    selectNone: "Golește selecția",
    selectedCount: (count: number) => (count === 1 ? "1 selectată" : `${count} selectate`),
    messages: (count: number) => countLabel("ro", count, { one: "mesaj", other: "mesaje" }),
    untitled: "Conversație fără titlu",
    preview: "Previzualizare",
    moreMessages: (count: number) =>
      count === 1
        ? "… și încă un mesaj"
        : `… și încă ${countLabel("ro", count, { one: "mesaj", other: "mesaje" })}`,
    folder: "Folder",
    chooseFolder: "Alege un folder",
    noFolders: "Adaugă întâi un folder: conversațiile importate se păstrează la un folder.",
    importSelected: (count: number) =>
      `Importă ${count === 1 ? "o conversație" : countLabel("ro", count, { one: "conversație", other: "conversații" })}`,
    importing: (done: number, total: number) => `Se importă ${done} din ${total}…`,
    imported: (created: number, existing: number) =>
      existing > 0
        ? `Am importat ${created}; ${existing} erau deja aici.`
        : `Am importat ${created}.`,
    importFailed: "Nu am putut importa conversațiile",
    importedTitle: "Conversații importate",
    noImported: "Încă nu există conversații importate pe acest calculator.",
    open: "Deschide",
    continueInNewChat: "Continuă într-o conversație nouă",
    continuing: "Se pornește…",
    continueFailed: "Nu am putut porni conversația nouă",
    continuedExcerpt:
      "Modelul de rezumat nu a fost disponibil, așa că am preluat prima cerere și ultimele mesaje.",
    continuedCount: (count: number) =>
      countLabel("ro", count, { one: "continuare", other: "continuări" }),
    sourceChatgpt: "ChatGPT",
    sourceClaude: "Claude.ai",
    sourceGemini: "Gemini",
    projectsTitle: "Proiecte",
    projectsBody: (base: string) =>
      `Fiecare proiect bifat devine un folder în „${base}”, cu instrucțiunile lui (AGENTS.md), fișierele de cunoștințe (cunostinte/) și memoria (MEMORIE.md). Conversațiile lui se importă acolo.`,
    chatgptProjectsGap:
      "Exportul ChatGPT nu conține numele, instrucțiunile sau fișierele proiectelor. Proiectele sunt numerotate după cea mai nouă conversație: redenumește-le aici. Conversațiile lor sunt deja grupate.",
    claudeSuggestGap:
      "Exportul Claude.ai nu spune ce conversație ține de ce proiect. O conversație al cărei titlu numește un singur proiect îi este propusă (scrie „sugestie”); verifică-le și mută-le pe celelalte.",
    chatgptProjectName: (index: number) => `Proiect ChatGPT ${index}`,
    baseFolder: "Folderul importului",
    baseFolderHint: (folder: string) => `în ${folder}`,
    defaultBaseFolder: (source: string) => `Importuri ${source}`,
    includeProject: (name: string) => `Importă proiectul ${name}`,
    projectName: "Numele proiectului",
    projectChats: (count: number) =>
      countLabel("ro", count, { one: "conversație", other: "conversații" }),
    hasInstructions: "instrucțiuni",
    projectFiles: (count: number) => countLabel("ro", count, { one: "fișier", other: "fișiere" }),
    hasMemory: "memorie",
    globalMemoryTitle: (source: string) => `Ce ținea minte ${source} despre tine`,
    globalMemoryKeep: (file: string) => `Salvează ca ${file} în folderul importului`,
    globalMemoryNote: "Nu se trimite în memoria companiei.",
    skippedFiles: (count: number, names: string) =>
      count === 1
        ? `Un fișier era prea mare și a rămas pe dinafară: ${names}`
        : `${countLabel("ro", count, { one: "fișier", other: "fișiere" })} erau prea mari și au rămas pe dinafară: ${names}`,
    noProject: (folder: string) => `Fără proiect (${folder})`,
    chatProject: "Proiectul conversației",
    suggested: "sugestie",
    starred: "Cu stea: va fi fixată după import",
    archived: "arhivată",
    gptLabel: (id: string) => `GPT ${id}`,
    moveSelected: "Mută selectatele în",
    move: "Mută",
    importAll: (chats: number, projects: number) => {
      const conversations =
        chats === 1
          ? "o conversație"
          : countLabel("ro", chats, { one: "conversație", other: "conversații" });
      if (projects === 0) return `Importă ${conversations}`;
      const folders =
        projects === 1
          ? "un proiect"
          : countLabel("ro", projects, { one: "proiect", other: "proiecte" });
      return `Importă ${conversations} și ${folders}`;
    },
    creatingProjects: (done: number, total: number) =>
      `Se creează proiectele: ${done} din ${total}…`,
    projectFailed: (name: string) => `Nu am putut crea proiectul „${name}”`,
    projectsCreated: (count: number) =>
      count === 1
        ? "Un proiect e gata."
        : `${countLabel("ro", count, { one: "proiect", other: "proiecte" })} sunt gata.`,
    memorySaved: (path: string) => `Memoria a fost salvată în ${path}`,
    memorySaveFailed: "Nu am putut salva fișierul cu memoria",
    memoryTitle: "Trimite părțile utile în memoria companiei",
    memoryBody:
      "Opțional. Câte un rezumat pentru fiecare conversație aleasă: secretele și datele personale se elimină întâi, discuțiile mărunte se sar și nu se trimite nimic până nu confirmi. Se pot trimite doar conversațiile dintr-un folder de companie cu salvarea în memorie pornită.",
    memoryPreview: "Pregătește rezumatele",
    memoryPreparing: "Se rezumă…",
    memorySend: (count: number) =>
      `Trimite ${count === 1 ? "rezumatul" : countLabel("ro", count, { one: "rezumat", other: "rezumate" })}`,
    memorySent: (count: number) =>
      count === 1
        ? "Un rezumat a fost pus la coadă pentru memoria companiei."
        : `${countLabel("ro", count, { one: "rezumat", other: "rezumate" })} au fost puse la coadă pentru memoria companiei.`,
    memoryNone: "Alege întâi conversații importate de mai sus.",
    memoryStatusReady: "Gata de trimis",
    memoryStatusNothing: "Nimic de ținut minte",
    memoryStatusSkipped: "Sărită (prea scurtă sau discuție măruntă)",
    memoryStatusOff: "Netrimisă: compania folderului nu are memorie sau salvarea e oprită",
    memoryStatusQueued: "Pusă la coadă",
    memoryStatusFailed: "Nu am putut face rezumatul",
    memoryRedacted: (kinds: string) => `Eliminat înainte de rezumat: ${kinds}`,
    memoryAlready: "Trimisă deja",
    bannerTitle: (source: string) => `Importată din ${source}`,
    bannerBody:
      "Copia aceasta e doar pentru citire. Continu-o într-o conversație nouă; asistentul primește un rezumat al ei.",
  },
});

export const CHAT_IMPORT_SEARCH_TERMS = [
  "import",
  "chatgpt",
  "claude",
  "gemini",
  "export",
  "takeout",
  "history",
  "importă",
  "importa",
  "conversații",
  "conversatii",
  "istoric",
  "proiecte",
  "projects",
];
