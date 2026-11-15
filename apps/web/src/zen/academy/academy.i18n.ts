// Zen Staff Academy: UI strings in English and Romanian, in the Zen i18n layer (ZEN.md, "Academy").
// The language is the app's (Settings > General > Language); the Academy page switch sets it.
import {
  countLabel,
  defineZenMessages,
  setZenLocalePreference,
  useZenText,
  zenText,
} from "../i18n/zenI18n";

const en = {
  pageTitle: "Academy",
  heading: "Learn to work with your AI staff",
  intro:
    "Short, practical lessons. Read one in a few minutes, then press Try it to practise on a real task.",
  tracks: {
    office: "Office",
    code: "Code",
  },
  trackDescriptions: {
    office: "How to get real work done with AI agents, safely.",
    code: "Security, vulnerabilities and working well with coding agents.",
  },
  levels: {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
  },
  minutes: (count: number) => `${count} min`,
  progress: (done: number, total: number) => `${done} of ${total} done`,
  searchPlaceholder: "Search lessons, such as passwords, Excel or RLS",
  searchLabel: "Search lessons",
  noResults: (query: string) => `No lesson matches "${query}".`,
  noResultsHint: "Try a shorter word. If you think a lesson is missing, tell your administrator.",
  noResultsRecorded: "We noted the topic (only the words, no names) to improve the Academy.",
  companyBadge: "Your company",
  doneBadge: "Done",
  loadFailed: "Could not load the lessons.",
  emptyTitle: "The lessons did not load",
  emptyBody:
    "This computer did not return any lesson. Try again; if the Academy stays empty, restart Zen Staff or reinstall it.",
  retry: "Try again",
  problemsSummary: (count: number) => `${count} lesson${count === 1 ? "" : "s"} could not load`,
  notConnected: "Waiting for this computer to connect.",
  back: "All lessons",
  markDone: "Mark as done",
  markNotDone: "Mark as not done",
  tryIt: "Try it",
  next: "Next lesson",
  language: "Language",
  tryItTitle: (lesson: string) => `Try it: ${lesson}`,
  tryItWorkflow: (name: string) =>
    `Starts the "${name}" task with example answers, so you can see the whole flow.`,
  tryItPrompt: "Sends this request to the agent in a new chat:",
  tryItAuditCommand: (command: string) =>
    `Runs the /${command} audit on the project you choose, in a new chat. It only reports; it does not change files.`,
  tryItAuditFallback: (command: string) =>
    `The /${command} command is not installed for this agent, so the chat gets a full audit request instead:`,
  tryItPracticeNote: "Runs in a practice folder with sample files, so nothing of yours is touched.",
  tryItPracticeFiles: "Practice files",
  runIn: "Run in",
  practiceFolder: "Practice folder (sample files)",
  practiceProject: "Practice project (sample code)",
  chooseFolder: "Choose a folder",
  noFolders: "Add a folder in the sidebar first, or use the practice folder.",
  start: "Start",
  starting: "Starting...",
  cancel: "Cancel",
  workflowMissing: (id: string) =>
    `The "${id}" task is not installed here. Open the Office home to see the tasks you have.`,
  noAgent:
    "No AI assistant is ready on this computer. Ask your administrator to sign in to one in Settings.",
  startFailed: "The task did not start.",
  openPage: (to: string) => `Opens ${to}.`,
  tipOpenLesson: "Open the lesson",
  tipDismiss: "Don't show again",
  tips: {
    secretPasted: {
      title: "That looks like a password or key",
      description:
        "Anything you send in chat is stored with the conversation. Remove it before you send, and change it if it was already shared.",
    },
    firstOffice: {
      title: "New here? Start with First steps",
      description: "A 3-minute lesson on how your AI staff works and how to give it a first task.",
    },
    personalData: {
      title: "Personal data in this message?",
      description:
        "Personal identification numbers, card numbers and similar data should be removed or replaced before you send them.",
    },
  },
  settingsTitle: "Academy",
  helpImproveTitle: "Help improve the Academy",
  helpImproveDescription:
    "Counts, on this device only, which topics you ask about, which Academy searches find nothing, and the topics of tasks that failed or needed more than 3 corrections. Only topic labels and counts are kept, never your messages. Off by default; nothing leaves this device in this version.",
  helpImproveCounted: (topics: number, searches: number) =>
    `Kept on this device: ${countLabel("en", topics, { one: "topic label", other: "topic labels" })}, ${countLabel("en", searches, { one: "search", other: "searches" })} with no result.`,
  helpImproveOutcomes: (failed: number, corrected: number) =>
    `Tasks that went badly: ${failed} failed, ${corrected} heavily corrected.`,
  clearSignals: "Clear",
  signalsPreview: "What this device would share (labels and counts only)",
  sidebarLabel: "Academy",
  paletteOpen: "Open Academy",
};

export const academyMessages = defineZenMessages({
  en,
  ro: {
    pageTitle: "Academie",
    heading: "Învață să lucrezi cu echipa ta AI",
    intro:
      "Lecții scurte și practice. Citești una în câteva minute, apoi apeși Încearcă și exersezi pe o sarcină reală.",
    tracks: {
      office: "Office",
      code: "Code",
    },
    trackDescriptions: {
      office: "Cum faci treabă reală cu agenții AI, fără riscuri.",
      code: "Securitate, vulnerabilități și lucrul bine cu agenții de cod.",
    },
    levels: {
      beginner: "Începător",
      intermediate: "Mediu",
      advanced: "Avansat",
    },
    minutes: (count: number) => `${count} min`,
    progress: (done: number, total: number) => `${done} din ${total} terminate`,
    searchPlaceholder: "Caută lecții, de exemplu parole, Excel sau RLS",
    searchLabel: "Caută lecții",
    noResults: (query: string) => `Nicio lecție nu se potrivește cu „${query}”.`,
    noResultsHint:
      "Încearcă un cuvânt mai scurt. Dacă simți că lipsește o lecție, spune-i administratorului.",
    noResultsRecorded:
      "Am notat subiectul (doar cuvintele, fără nume), ca să îmbunătățim Academia.",
    companyBadge: "Firma ta",
    doneBadge: "Terminată",
    loadFailed: "Nu am putut încărca lecțiile.",
    emptyTitle: "Lecțiile nu s-au încărcat",
    emptyBody:
      "Calculatorul nu a trimis nicio lecție. Încearcă din nou; dacă Academia rămâne goală, repornește Zen Staff sau reinstalează-l.",
    retry: "Încearcă din nou",
    problemsSummary: (count: number) =>
      count === 1 ? "O lecție nu s-a putut încărca" : `${count} lecții nu s-au putut încărca`,
    notConnected: "Așteptăm să se conecteze calculatorul.",
    back: "Toate lecțiile",
    markDone: "Marchează ca terminată",
    markNotDone: "Marchează ca neterminată",
    tryIt: "Încearcă",
    next: "Lecția următoare",
    language: "Limba",
    tryItTitle: (lesson: string) => `Încearcă: ${lesson}`,
    tryItWorkflow: (name: string) =>
      `Pornește sarcina „${name}” cu răspunsuri de exemplu, ca să vezi tot drumul.`,
    tryItPrompt: "Trimite agentului cererea asta, într-un chat nou:",
    tryItAuditCommand: (command: string) =>
      `Rulează auditul /${command} pe proiectul ales, într-un chat nou. Doar raportează, nu modifică fișiere.`,
    tryItAuditFallback: (command: string) =>
      `Comanda /${command} nu e instalată pentru acest agent, așa că în chat pleacă o cerere completă de audit:`,
    tryItPracticeNote:
      "Rulează într-un dosar de exercițiu cu fișiere de probă, deci nu se atinge nimic de-al tău.",
    tryItPracticeFiles: "Fișiere de exercițiu",
    runIn: "Rulează în",
    practiceFolder: "Dosar de exercițiu (fișiere de probă)",
    practiceProject: "Proiect de exercițiu (cod de probă)",
    chooseFolder: "Alege un dosar",
    noFolders: "Adaugă întâi un dosar din bara laterală sau folosește dosarul de exercițiu.",
    start: "Pornește",
    starting: "Pornește...",
    cancel: "Renunță",
    workflowMissing: (id: string) =>
      `Sarcina „${id}” nu e instalată aici. Deschide pagina Birou ca să vezi ce sarcini ai.`,
    noAgent:
      "Niciun asistent AI nu e pregătit pe acest calculator. Roagă-l pe administrator să conecteze unul din Setări.",
    startFailed: "Sarcina nu a pornit.",
    openPage: (to: string) => `Deschide ${to}.`,
    tipOpenLesson: "Deschide lecția",
    tipDismiss: "Nu mai arăta",
    tips: {
      secretPasted: {
        title: "Pare o parolă sau o cheie",
        description:
          "Tot ce trimiți în chat rămâne salvat în conversație. Scoate-o înainte să trimiți și schimb-o dacă ai trimis-o deja.",
      },
      firstOffice: {
        title: "Ești nou? Începe cu Primii pași",
        description:
          "O lecție de 3 minute despre cum lucrează echipa ta AI și cum îi dai prima sarcină.",
      },
      personalData: {
        title: "Ai date personale în mesaj?",
        description:
          "CNP-urile, numerele de card și alte date de felul ăsta se scot sau se înlocuiesc înainte să trimiți.",
      },
    },
    settingsTitle: "Academie",
    helpImproveTitle: "Ajută la îmbunătățirea Academiei",
    helpImproveDescription:
      "Numără, doar pe acest dispozitiv, despre ce subiecte întrebi, ce căutări din Academie nu găsesc nimic și subiectele sarcinilor care au eșuat sau au cerut mai mult de 3 corecturi. Se păstrează doar etichete de subiect și numere, niciodată mesajele tale. E oprit implicit; în această versiune nimic nu pleacă de pe dispozitiv.",
    helpImproveCounted: (topics: number, searches: number) =>
      `Păstrate pe acest dispozitiv: ${countLabel("ro", topics, { one: "subiect", other: "subiecte" })}, ${countLabel("ro", searches, { one: "căutare", other: "căutări" })} fără rezultat.`,
    helpImproveOutcomes: (failed: number, corrected: number) =>
      `Sarcini care n-au mers: ${failed} eșuate, ${corrected} corectate de multe ori.`,
    clearSignals: "Șterge",
    signalsPreview: "Ce ar trimite acest dispozitiv (doar etichete și numere)",
    sidebarLabel: "Academie",
    paletteOpen: "Deschide Academia",
  },
});

export type AcademyStrings = typeof en;

export function useAcademyStrings(): AcademyStrings {
  return useZenText(academyMessages);
}

/** Outside React (palette items). */
export function academyStrings(): AcademyStrings {
  return zenText(academyMessages);
}

/** The Academy shows lessons and its UI in the app language. */
export { useZenLocale as useAcademyLocale } from "../i18n/zenI18n";

/** The RO/EN switch on the Academy page changes the app language for this device. */
export function setAcademyLocale(locale: "en" | "ro"): void {
  setZenLocalePreference(locale);
}
