// Zen Staff: the Office edition's strings (Office home, workflow form, editor, library,
// edition and language switch, chat summary rows). See zen/i18n/zenI18n.ts.
import type { ZenWorkflowCategory, ZenWorkflowInputType } from "@t3tools/contracts/zenOffice";

import { countLabel, defineZenMessages, type ZenLocale } from "../i18n/zenI18n";

const en = {
  officeTitle: "Office",
  homeQuestion: "What do you want to do today?",
  marketplace: "Library",
  createWorkflow: "Create workflow",
  editWorkflow: "Edit workflow",
  searchTasksPlaceholder: "Search tasks, such as press release or report",
  searchTasks: "Search tasks",
  notConnected: "Not connected",
  waitingToConnect: "Waiting for this computer to connect.",
  addFolderToStart: "Your first task makes the company folder on its own.",
  workIn: "Work in",
  folder: "Folder",
  chooseFolder: "Choose a folder",
  tasksLoadFailed: "Could not load the tasks.",
  noTaskMatches: (query: string) => `No task matches "${query}".`,
  workflowsNotLoaded: (count: number) =>
    count === 1 ? "1 workflow could not load" : `${count} workflows could not load`,
  badgeCompany: "Company",
  badgeInstalled: "Installed",
  badgeYours: "Yours",
  editNamed: (name: string) => `Edit ${name}`,
  addFolderFirst: "Add a folder first",
  addFolderFirstBody:
    "Tasks save their results in a folder, and the company folder could not be made here. Choose a folder and try again.",
  ok: "OK",
  optional: "(optional)",
  choose: "Choose",
  fileHelp: (folder: string | undefined) =>
    folder ? `A file or folder inside ${folder}.` : "A file or folder inside the chosen folder.",
  pleaseFillIn: (labels: string) => `Please fill in: ${labels}.`,
  checkLinkIn: (labels: string) => `Check the link in: ${labels}.`,
  youGet: (output: string, folder: string) => `You get: ${output} Saved in ${folder}.`,
  cancel: "Cancel",
  start: "Start",
  starting: "Starting...",
  noAssistant:
    "No AI assistant is ready on this computer. Ask your administrator to sign in to one in Settings.",
  taskDidNotStart: "The task did not start.",

  marketplaceIntro:
    "Ready-made workflows for your team, all free: Zen Staff's own and the community's, each checked by us before it appears here. Install one and it shows on your Office home.",
  marketplaceLoadFailed: "Could not load the library.",
  searchWorkflows: "Search workflows",
  filter: "Filter",
  filterAll: "All",
  filterInstalled: "Installed",
  nothingMatches: "Nothing matches.",
  comingSoon: "Coming soon",
  included: "Included",
  includedInPlan: "Free",
  installed: "Installed",
  install: "Install",
  installing: "Installing...",
  uninstall: "Uninstall",
  installWorkflow: "Install workflow",
  uninstallWorkflow: "Uninstall workflow",
  readyOnHome: (name: string) => `"${name}" is ready on your Office home`,
  removedNamed: (name: string) => `Removed "${name}"`,
  versionLine: (author: string, version: string, category: string) =>
    `${author} · v${version} · ${category}`,
  registrySource: "Where workflows come from",
  registrySourceLocal: "Built-in list on this computer",
  registrySourceRemote: (url: string) => `Online list: ${url}`,
  registrySourceCache: (url: string) => `Saved copy of ${url}`,
  registryUrlLabel: "Online list address",
  registryUrlPlaceholder: "https://example.com/registry.json",
  registryUrlHelp:
    "Leave empty to use only the workflows that come with the app. Packs are checked before they are installed.",
  registryUrlSave: "Use this list",
  registryUrlClear: "Use built-in list",
  registryUrlInvalid: "Enter a web address that starts with https:// or http://.",
  registryUrlSaved: "Library list updated",
  registryCacheNotice: "The online list could not be reached. Showing the copy saved earlier.",
  registryLocalNotice:
    "The online list could not be reached. Showing only the workflows that come with the app.",

  saveWorkflow: "Save workflow",
  saving: "Saving...",
  delete: "Delete",
  workflowLoadFailed: "Could not load the workflow.",
  onlyOwnEditable:
    "Only your own workflows can be edited. Built-in and installed ones can be copied: create a new workflow and paste the parts you want.",
  savedNamed: (name: string) => `Saved "${name}"`,
  confirmDelete: (name: string) => `Delete "${name}"? This cannot be undone.`,
  about: "About",
  name: "Name",
  namePlaceholder: "Product description",
  whatItDoes: "What it does",
  whatItDoesPlaceholder: "Writes a product description for the online shop.",
  category: "Category",
  whatYouGet: "What you get",
  whatYouGetPlaceholder: "A description in product.md",
  icon: "Icon",
  questions: "Questions",
  questionsHelp: "What the person fills in before starting.",
  addQuestion: "Add question",
  noQuestions: "No questions yet.",
  questionN: (n: number) => `Question ${n}`,
  questionPlaceholder: "Question, such as Product name",
  answerTypeN: (n: number) => `Answer type ${n}`,
  required: "Required",
  requiredN: (n: number) => `Required ${n}`,
  moveUp: "Move up",
  moveDown: "Move down",
  removeQuestionN: (n: number) => `Remove question ${n}`,
  choicesN: (n: number) => `Choices ${n}`,
  choicesPlaceholder: "One choice per line\nFriendly\nFormal",
  exampleAnswerN: (n: number) => `Example answer ${n}`,
  exampleAnswerPlaceholder: "Example answer (shown greyed out)",
  inTheInstructions: "In the instructions:",
  instructionsTitle: "Instructions for the assistant",
  instructionsHelpBefore:
    "Write what the assistant should do. Click a question to insert its answer. Text between",
  instructionsHelpAnd: "and",
  instructionsHelpAfter: "is used only when that answer is filled in.",
  instructions: "Instructions",
  instructionsPlaceholder:
    "You are a copywriter. Write a product description for {{product_name}}...",
  preview: "Preview",
  untitledWorkflow: "Untitled workflow",
  messagePreview: "Message the assistant receives",
  writeInstructionsToPreview: "Write the instructions to see the message.",

  officeHome: "Office home",
  openOfficeHome: "Open Office home",
  openMarketplace: "Open the library",
  switchToCode: "Switch to Code",
  switchToOffice: "Switch to Office",
  edition: "Edition",
  editionDescription:
    "Office shows ready-made tasks and hides developer tools such as git, terminals and code changes. Code shows everything. This choice is saved on this device only.",
  editionDefault: (edition: string) =>
    `You chose this on this device only; the computer starts in ${edition} by default.`,
  editionFollowsDefault: "This device follows the computer's default.",
  editionUseDefault: "Use the default",
  editionMakeDefault: "Make this the default",
  editionOffice: "Office",
  editionCode: "Code",
  language: "Language",
  languageDescription: "The language of the app. Automatic follows your computer or browser.",
  languageAuto: (name: string) => `Automatic (${name})`,

  working: "Working…",
  workedOnFiles: (files: string) => `Worked on ${files}`,
  workingOnFiles: (files: string) => `Working on ${files}…`,
  lookedFiles: (files: string) => `Looked at ${files}`,
  searchedWeb: "Searched the web",
  stepsDone: (steps: string) => `Worked through ${steps}`,
  showDetails: "Show what was done",
  hideDetails: "Hide details",
  changedFile: (name: string) => `Changed ${name}`,
  readFile: (name: string) => `Read ${name}`,
  webSearches: (count: string) => `Searched the web (${count})`,
  otherSteps: (count: string) => `Other steps (${count})`,
  someStepsFailed: (count: number) =>
    count === 1
      ? "1 step did not work and was tried another way"
      : `${count} steps did not work and were tried another way`,
  fileForms: { one: "file", other: "files" },
  stepForms: { one: "step", other: "steps" },
  searchForms: { one: "search", other: "searches" },

  draftQuestion: "What should we work on?",
  draftQuestionIn: "What should we work on in",
};

type OfficeMessages = {
  readonly [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof en)[K] extends string
      ? string
      : (typeof en)[K];
};

const ro: OfficeMessages = {
  officeTitle: "Birou",
  homeQuestion: "Ce vrei să faci azi?",
  marketplace: "Bibliotecă",
  createWorkflow: "Creează o sarcină",
  editWorkflow: "Modifică sarcina",
  searchTasksPlaceholder: "Caută o sarcină, de exemplu comunicat sau raport",
  searchTasks: "Caută sarcini",
  notConnected: "Nu e conectat",
  waitingToConnect: "Așteptăm să se conecteze calculatorul.",
  addFolderToStart: "Prima sarcină îți face singură dosarul firmei.",
  workIn: "Lucrez în",
  folder: "Dosar",
  chooseFolder: "Alege un dosar",
  tasksLoadFailed: "Nu am putut încărca sarcinile.",
  noTaskMatches: (query) => `Nicio sarcină nu se potrivește cu „${query}”.`,
  workflowsNotLoaded: (count) =>
    count === 1
      ? "O sarcină nu s-a putut încărca"
      : `${countLabel("ro", count, { one: "sarcină", other: "sarcini" })} nu s-au putut încărca`,
  badgeCompany: "Companie",
  badgeInstalled: "Instalată",
  badgeYours: "A ta",
  editNamed: (name) => `Modifică ${name}`,
  addFolderFirst: "Adaugă întâi un dosar",
  addFolderFirstBody:
    "Sarcinile își salvează rezultatele într-un dosar, iar dosarul firmei nu a putut fi făcut aici. Alege un dosar și încearcă din nou.",
  ok: "Bine",
  optional: "(opțional)",
  choose: "Alege",
  fileHelp: (folder) =>
    folder ? `Un fișier sau un dosar din ${folder}.` : "Un fișier sau un dosar din dosarul ales.",
  pleaseFillIn: (labels) => `Completează: ${labels}.`,
  checkLinkIn: (labels) => `Verifică linkul de la: ${labels}.`,
  youGet: (output, folder) => `Primești: ${output} Se salvează în ${folder}.`,
  cancel: "Anulează",
  start: "Începe",
  starting: "Pornește...",
  noAssistant:
    "Pe acest calculator nu e pregătit niciun asistent AI. Roagă administratorul să conecteze unul din Setări.",
  taskDidNotStart: "Sarcina nu a pornit.",

  marketplaceIntro:
    "Sarcini gata făcute pentru echipa ta, toate gratuite: ale Zen Staff și ale comunității, fiecare verificată de noi înainte să apară aici. Instalează una și apare pe pagina ta de Birou.",
  marketplaceLoadFailed: "Nu am putut încărca biblioteca.",
  searchWorkflows: "Caută sarcini",
  filter: "Filtru",
  filterAll: "Toate",
  filterInstalled: "Instalate",
  nothingMatches: "Nu am găsit nimic.",
  comingSoon: "În curând",
  included: "Inclusă",
  includedInPlan: "Gratuită",
  installed: "Instalată",
  install: "Instalează",
  installing: "Se instalează...",
  uninstall: "Dezinstalează",
  installWorkflow: "Instalează sarcina",
  uninstallWorkflow: "Dezinstalează sarcina",
  readyOnHome: (name) => `„${name}” e gata pe pagina de Birou`,
  removedNamed: (name) => `Am scos „${name}”`,
  versionLine: (author, version, category) => `${author} · v${version} · ${category}`,
  registrySource: "De unde vin sarcinile",
  registrySourceLocal: "Lista inclusă în aplicație",
  registrySourceRemote: (url) => `Lista online: ${url}`,
  registrySourceCache: (url) => `Copia salvată a listei ${url}`,
  registryUrlLabel: "Adresa listei online",
  registryUrlPlaceholder: "https://exemplu.ro/registry.json",
  registryUrlHelp:
    "Lasă gol ca să folosești doar sarcinile care vin cu aplicația. Pachetele sunt verificate înainte să fie instalate.",
  registryUrlSave: "Folosește lista",
  registryUrlClear: "Folosește lista inclusă",
  registryUrlInvalid: "Scrie o adresă web care începe cu https:// sau http://.",
  registryUrlSaved: "Lista bibliotecii a fost schimbată",
  registryCacheNotice: "Nu am putut ajunge la lista online. Îți arăt copia salvată mai devreme.",
  registryLocalNotice:
    "Nu am putut ajunge la lista online. Îți arăt doar sarcinile care vin cu aplicația.",

  saveWorkflow: "Salvează sarcina",
  saving: "Se salvează...",
  delete: "Șterge",
  workflowLoadFailed: "Nu am putut încărca sarcina.",
  onlyOwnEditable:
    "Poți modifica doar sarcinile tale. Pe cele incluse sau instalate le poți copia: creează o sarcină nouă și lipește ce-ți trebuie.",
  savedNamed: (name) => `Am salvat „${name}”`,
  confirmDelete: (name) => `Ștergi „${name}”? Nu se mai poate recupera.`,
  about: "Despre",
  name: "Nume",
  namePlaceholder: "Descriere de produs",
  whatItDoes: "Ce face",
  whatItDoesPlaceholder: "Scrie descrierea unui produs pentru magazinul online.",
  category: "Categorie",
  whatYouGet: "Ce primești",
  whatYouGetPlaceholder: "O descriere în product.md",
  icon: "Pictogramă",
  questions: "Întrebări",
  questionsHelp: "Ce completează omul înainte să înceapă.",
  addQuestion: "Adaugă o întrebare",
  noQuestions: "Încă nu ai întrebări.",
  questionN: (n) => `Întrebarea ${n}`,
  questionPlaceholder: "Întrebarea, de exemplu Numele produsului",
  answerTypeN: (n) => `Tipul răspunsului ${n}`,
  required: "Obligatoriu",
  requiredN: (n) => `Obligatoriu ${n}`,
  moveUp: "Mută mai sus",
  moveDown: "Mută mai jos",
  removeQuestionN: (n) => `Scoate întrebarea ${n}`,
  choicesN: (n) => `Variante ${n}`,
  choicesPlaceholder: "O variantă pe rând\nPrietenos\nOficial",
  exampleAnswerN: (n) => `Exemplu de răspuns ${n}`,
  exampleAnswerPlaceholder: "Exemplu de răspuns (apare cu gri)",
  inTheInstructions: "În instrucțiuni:",
  instructionsTitle: "Instrucțiuni pentru asistent",
  instructionsHelpBefore:
    "Scrie ce trebuie să facă asistentul. Apasă pe o întrebare ca să pui răspunsul ei în text. Textul dintre",
  instructionsHelpAnd: "și",
  instructionsHelpAfter: "se folosește doar când răspunsul e completat.",
  instructions: "Instrucțiuni",
  instructionsPlaceholder: "Ești copywriter. Scrie descrierea produsului {{product_name}}...",
  preview: "Previzualizare",
  untitledWorkflow: "Sarcină fără nume",
  messagePreview: "Mesajul pe care îl primește asistentul",
  writeInstructionsToPreview: "Scrie instrucțiunile ca să vezi mesajul.",

  officeHome: "Birou",
  openOfficeHome: "Deschide pagina de Birou",
  openMarketplace: "Deschide biblioteca",
  switchToCode: "Treci la Code",
  switchToOffice: "Treci la Office",
  edition: "Ediție",
  editionDescription:
    "Office arată fluxuri gata făcute și ascunde uneltele pentru programatori, cum ar fi git, terminalul și modificările de cod. Code arată tot. Alegerea se salvează doar pe acest dispozitiv.",
  editionDefault: (edition) =>
    `Ai ales asta doar pe acest dispozitiv; calculatorul pornește implicit în ${edition}.`,
  editionFollowsDefault: "Acest dispozitiv folosește varianta implicită a calculatorului.",
  editionUseDefault: "Folosește varianta implicită",
  editionMakeDefault: "Fă-o implicită",
  editionOffice: "Office",
  editionCode: "Code",
  language: "Limbă",
  languageDescription:
    "Limba aplicației. Varianta automată urmează limba calculatorului sau a browserului.",
  languageAuto: (name) => `Automat (${name})`,

  working: "Lucrez…",
  workedOnFiles: (files) => `Am lucrat la ${files}`,
  workingOnFiles: (files) => `Lucrez la ${files}…`,
  lookedFiles: (files) => `M-am uitat prin ${files}`,
  searchedWeb: "Am căutat pe internet",
  stepsDone: (steps) => `Am parcurs ${steps}`,
  showDetails: "Arată ce am făcut",
  hideDetails: "Ascunde detaliile",
  changedFile: (name) => `Am modificat ${name}`,
  readFile: (name) => `Am citit ${name}`,
  webSearches: (count) => `Am căutat pe internet (${count})`,
  otherSteps: (count) => `Alți pași (${count})`,
  someStepsFailed: (count) =>
    count === 1
      ? "Un pas n-a mers și am încercat altfel"
      : `${countLabel("ro", count, { one: "pas", other: "pași" })} n-au mers și am încercat altfel`,
  fileForms: { one: "fișier", other: "fișiere" },
  stepForms: { one: "pas", other: "pași" },
  searchForms: { one: "căutare", other: "căutări" },

  draftQuestion: "La ce lucrăm?",
  draftQuestionIn: "La ce lucrăm în",
};

export const officeText = defineZenMessages<OfficeMessages>({ en, ro });

export const CATEGORY_TEXT = defineZenMessages<Record<ZenWorkflowCategory, string>>({
  en: {
    design: "Design",
    pr: "PR and communication",
    video: "Video",
    social: "Social media",
    sales: "Sales",
    reports: "Reports and documents",
    admin: "Admin",
  },
  ro: {
    design: "Design",
    pr: "PR și comunicare",
    video: "Video",
    social: "Rețele sociale",
    sales: "Vânzări",
    reports: "Rapoarte și documente",
    admin: "Administrativ",
  },
});

export const INPUT_TYPE_TEXT = defineZenMessages<Record<ZenWorkflowInputType, string>>({
  en: {
    text: "Short text",
    longtext: "Long text",
    select: "Choice list",
    file: "File in the folder",
    url: "Web link",
  },
  ro: {
    text: "Text scurt",
    longtext: "Text lung",
    select: "Listă de variante",
    file: "Fișier din dosar",
    url: "Link web",
  },
});

/**
 * Romanian for the plain-language problems `validateWorkflow` (contracts) returns, so the editor
 * speaks one language. Unknown messages stay as they are.
 */
const PROBLEM_RULES_RO: ReadonlyArray<readonly [RegExp, (...groups: string[]) => string]> = [
  [
    /^The id uses 2 to 64 lowercase letters, digits or dashes\.$/,
    () => "Codul are între 2 și 64 de litere mici, cifre sau liniuțe.",
  ],
  [/^Give the workflow a name\.$/, () => "Dă un nume sarcinii."],
  [/^Keep the name under 80 characters\.$/, () => "Numele trebuie să aibă sub 80 de caractere."],
  [
    /^Keep the description under 400 characters\.$/,
    () => "Descrierea trebuie să aibă sub 400 de caractere.",
  ],
  [/^The icon is a lucide icon name\.$/, () => "Alege o pictogramă din listă."],
  [/^Set a version, such as 1\.0\.0\.$/, () => "Pune o versiune, de exemplu 1.0.0."],
  [/^Use at most 20 inputs\.$/, () => "Folosește cel mult 20 de întrebări."],
  [
    /^Input "(.+)": the id starts with a letter and uses a-z, 0-9 or _\.$/,
    (name) => `Întrebarea „${name}”: codul începe cu o literă și folosește a-z, 0-9 sau _.`,
  ],
  [/^Two inputs use the id "(.+)"\.$/, (id) => `Două întrebări au același cod, „${id}”.`],
  [/^Input "(.+)" needs a label\.$/, (id) => `Întrebarea „${id}” nu are text.`],
  [
    /^Input "(.+)" is a choice list; give it at least two options\.$/,
    (name) => `Întrebarea „${name}” e o listă de variante; pune cel puțin două variante.`,
  ],
  [/^Write the prompt template\.$/, () => "Scrie instrucțiunile."],
  [
    /^Keep the prompt under 40,000 characters\.$/,
    () => "Instrucțiunile trebuie să aibă sub 40.000 de caractere.",
  ],
  [
    /^The prompt uses \{\{(.+)\}\}, but no input has that id\.$/,
    (id) => `Instrucțiunile folosesc {{${id}}}, dar nicio întrebare nu are acest cod.`,
  ],
];

export function localizeWorkflowProblem(problem: string, locale: ZenLocale): string {
  if (locale !== "ro") return problem;
  for (const [pattern, render] of PROBLEM_RULES_RO) {
    const match = pattern.exec(problem);
    if (match) return render(...match.slice(1));
  }
  return problem;
}
