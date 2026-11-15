// Zen Staff: strings of company memory (Memorie tab, connection settings, the chat toggle).
import { defineZenMessages } from "../i18n/zenI18n";

export const memoryText = defineZenMessages({
  en: {
    // Connection (company Settings tab).
    connectionTitle: "Company memory",
    connectionIntro:
      "Finished conversations in this company's projects are summarized and saved to the company memory, so everyone's agents can answer what was decided, promised or priced. Personal projects keep their local memory.",
    personalNote:
      "Personal projects keep Claude Code's local memory. Company memory is set per company.",
    hostedActive: "Hosted memory: on",
    hostedKeyReady: "This computer has its own key from the hub.",
    hostedKeyPending: (error: string | null) =>
      error === null
        ? "Getting this computer's key from the hub..."
        : `This computer has no key yet: ${error}`,
    serverUrl: "Memory server address",
    serverUrlPlaceholder: "Not set: your memory server's address",
    apiKey: "API key",
    apiKeyPlaceholderSet: "Saved on this machine (leave empty to keep it)",
    apiKeyPlaceholder: "zm_...",
    apiKeyHint: (store: string | null): string =>
      store === "keychain"
        ? "Kept encrypted on this machine, with the key in the system keychain. It is never shown again or sent to the chat."
        : "Kept encrypted on this machine (owner-only files). It is never shown again or sent to the chat.",
    removeKey: "Remove key",
    saveConversations: "Save conversations to company memory",
    saveConversationsHint:
      'One short summary per finished conversation (secrets and personal ID numbers removed first). Chats marked "Don\'t save this chat" are skipped.',
    saveConnection: "Save",
    testConnection: "Test connection",
    testing: "Testing...",
    connectionSaved: "Company memory saved",
    connectionSaveFailed: "Could not save company memory",
    testOk: (name: string | null): string => (name ? `Connected to ${name}` : "Connected"),
    testFailed: "Connection failed",
    graphCounts: (entities: number, facts: number, episodes: number) =>
      `${entities} entities, ${facts} facts, ${episodes} conversations`,
    quotaNames: {
      episodes_per_day: "Conversations today",
      ingest_tokens_per_month: "Tokens this month",
      searches_per_minute: "Searches this minute",
    } as Record<string, string>,
    quotaUnlimited: "unlimited",
    quotaResets: (when: string) => `resets ${when}`,
    pending: (count: number): string =>
      count === 1 ? "1 summary waiting to be sent" : `${count} summaries waiting to be sent`,
    nextRetry: (when: string) => `next try ${when}`,
    lastSave: (status: string, when: string) => `Last save: ${status}, ${when}`,
    saveStatus: {
      accepted: "saved",
      skipped: "nothing new (server)",
      duplicate: "already saved",
      queued: "waiting to be sent",
      failed: "failed",
      nothing: "nothing to save",
    } as Record<string, string>,
    // Memorie tab.
    notConnectedTitle: "Company memory is not connected",
    notConnectedBody:
      "Add the memory server address and the company's API key in Settings to see decisions and promises here.",
    openSettings: "Open Settings",
    searchLabel: "Search company memory",
    searchPlaceholder: "What did we promise Hotel Arcadia?",
    search: "Search",
    searching: "Searching...",
    noResults: "Nothing found.",
    results: "Results",
    entities: "People and organizations",
    decisions: "Decisions",
    promises: "Promises",
    typeDecision: "Decision",
    typePromise: "Promise",
    typeFact: "Fact",
    showReplaced: "Show replaced",
    loadMore: "Load more",
    loadFailed: "Could not load company memory.",
    noDecisions: "No decisions yet.",
    groupOpen: "Open",
    groupOverdue: "Overdue",
    groupDone: "Done",
    noPromisesIn: "None.",
    owner: "Owner",
    to: "To",
    due: "Due",
    decided: "Decided",
    validFrom: "From",
    replaced: "Replaced",
    source: "Source",
    openThread: "Open chat",
    notOnThisMachine: "not on this machine",
    status: {
      open: "open",
      overdue: "overdue",
      done: "done",
      cancelled: "cancelled",
      superseded: "replaced",
      active: "active",
      reversed: "reversed",
    } as Record<string, string>,
    // Forget (GDPR).
    forget: "Forget this",
    forgetTitle: "Forget for good?",
    forgetBody: (name: string) =>
      `This erases ${name} and every fact about them from the company memory, and removes the name from other facts and saved conversation summaries. It cannot be undone. Only a company admin should do this (for example, for a GDPR erasure request).`,
    forgetWhich: "What to erase",
    forgetConfirm: "Yes, forget it",
    forgetCancel: "Cancel",
    forgotten: (name: string) => `${name} was erased from company memory`,
    forgottenDetail: (deleted: number, rewritten: number) =>
      `${deleted} facts deleted, ${rewritten} facts rewritten.`,
    forgetFailed: "Could not erase it",
    adminOnly: "Admin only",
    // Chat toggle.
    threadSaving: "Saved to company memory",
    threadSavingHint:
      "When this chat goes quiet, a short summary (without secrets) is saved to the company memory. Click to stop saving this chat.",
    threadNotSaving: "Not saved to company memory",
    threadNotSavingHint: "This chat is not saved to the company memory. Click to save it again.",
    dontSave: "Don't save this chat",
    saveAgain: "Save this chat",
    toggleFailed: "Could not change this chat's memory setting",
  },
  ro: {
    connectionTitle: "Memoria companiei",
    connectionIntro:
      "Conversațiile încheiate din proiectele acestei companii sunt rezumate și salvate în memoria companiei, ca agenții tuturor să știe ce s-a hotărât, ce s-a promis și la ce preț. Proiectele personale își păstrează memoria locală.",
    personalNote:
      "Proiectele personale folosesc memoria locală din Claude Code. Memoria companiei se setează pe fiecare companie.",
    hostedActive: "Memoria găzduită: activă",
    hostedKeyReady: "Calculatorul acesta are cheia lui de la hub.",
    hostedKeyPending: (error) =>
      error === null
        ? "Se cere cheia acestui calculator de la hub..."
        : `Calculatorul acesta nu are încă o cheie: ${error}`,
    serverUrl: "Adresa serverului de memorie",
    serverUrlPlaceholder: "Nesetată: adresa serverului tău de memorie",
    apiKey: "Cheie API",
    apiKeyPlaceholderSet: "Salvată pe acest calculator (lasă gol ca s-o păstrezi)",
    apiKeyPlaceholder: "zm_...",
    apiKeyHint: (store: string | null): string =>
      store === "keychain"
        ? "Păstrată criptat pe acest calculator, cu cheia în portofelul de parole al sistemului. Nu mai e afișată și nu ajunge în chat."
        : "Păstrată criptat pe acest calculator (fișiere accesibile doar proprietarului). Nu mai e afișată și nu ajunge în chat.",
    removeKey: "Șterge cheia",
    saveConversations: "Salvează conversațiile în memoria companiei",
    saveConversationsHint:
      "Un rezumat scurt pentru fiecare conversație încheiată (fără parole, chei sau CNP-uri). Conversațiile marcate „Nu salva această conversație” sunt sărite.",
    saveConnection: "Salvează",
    testConnection: "Testează conexiunea",
    testing: "Se testează...",
    connectionSaved: "Memoria companiei a fost salvată",
    connectionSaveFailed: "Nu am putut salva memoria companiei",
    testOk: (name: string | null): string => (name ? `Conectat la ${name}` : "Conectat"),
    testFailed: "Conexiunea nu a mers",
    graphCounts: (entities: number, facts: number, episodes: number) =>
      `${entities} entități, ${facts} fapte, ${episodes} conversații`,
    quotaNames: {
      episodes_per_day: "Conversații azi",
      ingest_tokens_per_month: "Tokeni luna aceasta",
      searches_per_minute: "Căutări în ultimul minut",
    } as Record<string, string>,
    quotaUnlimited: "nelimitat",
    quotaResets: (when: string) => `se resetează ${when}`,
    pending: (count: number): string =>
      count === 1
        ? "1 rezumat așteaptă să fie trimis"
        : `${count} rezumate așteaptă să fie trimise`,
    nextRetry: (when: string) => `următoarea încercare ${when}`,
    lastSave: (status: string, when: string) => `Ultima salvare: ${status}, ${when}`,
    saveStatus: {
      accepted: "salvată",
      skipped: "nimic nou (server)",
      duplicate: "deja salvată",
      queued: "așteaptă trimiterea",
      failed: "eșuată",
      nothing: "nimic de salvat",
    } as Record<string, string>,
    notConnectedTitle: "Memoria companiei nu e conectată",
    notConnectedBody:
      "Adaugă adresa serverului de memorie și cheia API a companiei în Setări ca să vezi aici hotărârile și promisiunile.",
    openSettings: "Deschide Setările",
    searchLabel: "Caută în memoria companiei",
    searchPlaceholder: "Ce am promis Hotelului Arcadia?",
    search: "Caută",
    searching: "Se caută...",
    noResults: "Nu am găsit nimic.",
    results: "Rezultate",
    entities: "Persoane și organizații",
    decisions: "Hotărâri",
    promises: "Promisiuni",
    typeDecision: "Hotărâre",
    typePromise: "Promisiune",
    typeFact: "Fapt",
    showReplaced: "Arată și pe cele înlocuite",
    loadMore: "Mai multe",
    loadFailed: "Nu am putut încărca memoria companiei.",
    noDecisions: "Nicio hotărâre încă.",
    groupOpen: "Deschise",
    groupOverdue: "Întârziate",
    groupDone: "Încheiate",
    noPromisesIn: "Niciuna.",
    owner: "Responsabil",
    to: "Către",
    due: "Termen",
    decided: "Hotărât",
    validFrom: "De la",
    replaced: "Înlocuit",
    source: "Sursa",
    openThread: "Deschide conversația",
    notOnThisMachine: "nu e pe acest calculator",
    status: {
      open: "deschisă",
      overdue: "întârziată",
      done: "îndeplinită",
      cancelled: "anulată",
      superseded: "înlocuită",
      active: "în vigoare",
      reversed: "anulată",
    } as Record<string, string>,
    forget: "Uită asta",
    forgetTitle: "Ștergi definitiv?",
    forgetBody: (name: string) =>
      `Se șterg ${name} și toate faptele despre el/ea din memoria companiei, iar numele dispare din celelalte fapte și din rezumatele salvate. Nu se poate anula. Doar un administrator al companiei ar trebui să facă asta (de exemplu, la o cerere de ștergere GDPR).`,
    forgetWhich: "Ce se șterge",
    forgetConfirm: "Da, șterge",
    forgetCancel: "Anulează",
    forgotten: (name: string) => `${name} a fost șters din memoria companiei`,
    forgottenDetail: (deleted: number, rewritten: number) =>
      `${deleted} fapte șterse, ${rewritten} fapte rescrise.`,
    forgetFailed: "Nu am putut șterge",
    adminOnly: "Doar administratorul",
    threadSaving: "Se salvează în memoria companiei",
    threadSavingHint:
      "Când conversația se liniștește, un rezumat scurt (fără parole sau chei) se salvează în memoria companiei. Apasă ca să nu se mai salveze.",
    threadNotSaving: "Nu se salvează în memoria companiei",
    threadNotSavingHint:
      "Conversația aceasta nu se salvează în memoria companiei. Apasă ca s-o salvezi din nou.",
    dontSave: "Nu salva această conversație",
    saveAgain: "Salvează această conversație",
    toggleFailed: "Nu am putut schimba setarea de memorie a conversației",
  },
});
