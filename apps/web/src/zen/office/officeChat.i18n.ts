// Zen Staff: strings for the Office additions in the chat and the workflow tools: plain-language
// approvals, the workflow message's hidden instructions, "Save this as a workflow", file inputs,
// company workflows, the per-workflow model and packs of several workflows.
import { countLabel, defineZenMessages } from "../i18n/zenI18n";
import type { OfficeApprovalAction } from "./officeApprovals";

type Subject = string | null;

const en = {
  approval: {
    download: (s: Subject) =>
      s ? `Get information from ${s}` : "Get information from the internet",
    downloadVideo: (s: Subject) => (s ? `Download a video from ${s}` : "Download a video"),
    checkSite: (s: Subject) => (s ? `Check the website ${s}` : "Check a website"),
    openWeb: (s: Subject) => (s ? `Open the web page on ${s}` : "Open a web page"),
    searchWeb: (s: Subject) => (s ? `Search the web for "${s}"` : "Search the web"),
    editMedia: (s: Subject) =>
      s ? `Work on the media file ${s}` : "Work on a video, sound or image",
    inspectMedia: (s: Subject) =>
      s ? `Look inside the media file ${s}` : "Look inside a media file",
    runScript: (s: Subject) => (s ? `Run the helper program ${s}` : "Run a helper program"),
    installSoftware: (s: Subject) => (s ? `Install software: ${s}` : "Install software"),
    deleteFiles: (s: Subject) => (s ? `Delete ${s}` : "Delete files"),
    createFolder: (s: Subject) => (s ? `Create the folder ${s}` : "Create a folder"),
    copyFiles: (s: Subject) => (s ? `Copy files to ${s}` : "Copy files"),
    moveFiles: (s: Subject) => (s ? `Move or rename files to ${s}` : "Move or rename files"),
    listFiles: (s: Subject) => (s ? `See what is in ${s}` : "See which files are in the folder"),
    readFile: (s: Subject) => (s ? `Read the file ${s}` : "Read a file"),
    searchFiles: (s: Subject) => (s ? `Search the files for ${s}` : "Search the files"),
    writeFile: (s: Subject) => (s ? `Create or replace the file ${s}` : "Create or replace a file"),
    editFile: (s: Subject) => (s ? `Change the file ${s}` : "Change a file"),
    convertDocument: (s: Subject) => (s ? `Convert the document ${s}` : "Convert a document"),
    archive: (s: Subject) => (s ? `Pack or unpack ${s}` : "Pack or unpack an archive"),
    versionControl: (_: Subject) => "Save or change the folder's version history",
    changePermissions: (s: Subject) => (s ? `Change who may open ${s}` : "Change file permissions"),
    stopProgram: (_: Subject) => "Stop a running program",
    scheduleTask: (_: Subject) => "Set up a task that repeats on a schedule",
    useApp: (s: Subject) => (s ? `Use the connected app ${s}` : "Use a connected app"),
    delegate: (_: Subject) => "Hand part of the work to a helper assistant",
    plan: (_: Subject) => "Update its to-do list",
    runCommand: (s: Subject) => (s ? `Run the program ${s}` : "Run a program on this computer"),
    other: (s: Subject) => (s ? `Use the tool ${s}` : "Do a step that needs your OK"),
  } satisfies Record<OfficeApprovalAction, (subject: Subject) => string>,
  approvalAsks: "The assistant wants to:",
  approvalMoreSteps: (count: number) =>
    count === 2 ? "and 1 more step" : `and ${count - 1} more steps`,
  approvalRisky: "This changes or removes things. Approve only if you expected it.",
  details: "Details",
  hideDetails: "Hide details",
  // Workflow first message.
  instructionsShown: "Instructions sent to the assistant",

  saveAsWorkflow: "Save this as a workflow",
  saveAsWorkflowHint: "Turn this task into a form you can fill in and run again.",
  draftingWorkflow: "Drafting the workflow from this chat…",
  draftFailed: "The workflow could not be drafted.",
  draftBasic:
    "The draft was built from your first message. Check the questions and the instructions before saving.",
  draftReady: "Draft ready. Check it and save.",
  draftFromTask: "Drafted from a chat. Check the questions and the instructions, then save.",
  // File inputs.
  chooseFile: "Choose a file",
  uploadingFile: "Copying the file…",
  fileCopied: (path: string) => `Copied into the folder as ${path}.`,
  fileTooLarge: "The file is larger than 25 MB.",
  fileUploadFailed: "The file could not be copied.",
  orTypePath: "Or type the path of a file already in the folder",
  chooseFolderFirst: "Choose a folder first.",
  // Company workflows.
  saveFor: "Save for",
  saveForMe: "Only me",
  saveForCompany: (company: string) => `Everyone in ${company}`,
  companyWorkflowNote: (company: string) => `This workflow belongs to ${company}.`,
  // Per-workflow model.
  model: "Model",
  modelHelp: "Which AI model runs this workflow.",
  modelDefault: "The folder's default",
  modelHaiku: "Haiku (fast, for simple tasks)",
  modelSonnet: "Sonnet (balanced)",
  modelOpus: "Opus (most capable, slower)",
  modelCustom: (model: string) => `Other: ${model}`,
  // Packs of several workflows.
  sampleLabel: "Example made with a professional ElevenLabs voice",
  repeatIt: "Repeat it automatically",
  repeatHelp: "It also runs now. Later runs start on their own at that time, in the same folder.",
  repeatHow: "How often",
  repeatDaily: "Every day",
  repeatWeekly: "Every week",
  repeatAt: "At",
  repeatOn: "On",
  weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  repeatBadTime: "Write the time as HH:MM, such as 09:30.",
  repeatFailed: "The task started, but the repeat could not be saved.",
  repeatSaved: (when: string) =>
    `It will repeat ${when}. You find it in Settings > Scheduled tasks.`,
  repeatEveryDayAt: (time: string) => `every day at ${time}`,
  repeatEveryWeekAt: (day: string, time: string) => `every ${day} at ${time}`,
  packWorkflows: (count: number) =>
    `${countLabel("en", count, { one: "workflow", other: "workflows" })} in this pack`,
};

const ro: { readonly [K in keyof typeof en]: (typeof en)[K] } = {
  approval: {
    download: (s) => (s ? `Să ia informații de pe ${s}` : "Să ia informații de pe internet"),
    downloadVideo: (s) => (s ? `Să descarce un video de pe ${s}` : "Să descarce un video"),
    checkSite: (s) => (s ? `Să verifice site-ul ${s}` : "Să verifice un site"),
    openWeb: (s) => (s ? `Să deschidă pagina de pe ${s}` : "Să deschidă o pagină web"),
    searchWeb: (s) => (s ? `Să caute pe internet „${s}”` : "Să caute pe internet"),
    editMedia: (s) =>
      s ? `Să lucreze la fișierul ${s}` : "Să lucreze la un video, un sunet sau o imagine",
    inspectMedia: (s) =>
      s ? `Să se uite în fișierul ${s}` : "Să se uite într-un fișier video sau audio",
    runScript: (s) =>
      s ? `Să pornească programul ajutător ${s}` : "Să pornească un program ajutător",
    installSoftware: (s) => (s ? `Să instaleze programe: ${s}` : "Să instaleze programe"),
    deleteFiles: (s) => (s ? `Să șteargă ${s}` : "Să șteargă fișiere"),
    createFolder: (s) => (s ? `Să facă dosarul ${s}` : "Să facă un dosar"),
    copyFiles: (s) => (s ? `Să copieze fișiere în ${s}` : "Să copieze fișiere"),
    moveFiles: (s) =>
      s ? `Să mute sau să redenumească fișiere în ${s}` : "Să mute sau să redenumească fișiere",
    listFiles: (s) => (s ? `Să vadă ce e în ${s}` : "Să vadă ce fișiere sunt în dosar"),
    readFile: (s) => (s ? `Să citească fișierul ${s}` : "Să citească un fișier"),
    searchFiles: (s) => (s ? `Să caute în fișiere „${s}”` : "Să caute în fișiere"),
    writeFile: (s) =>
      s ? `Să facă sau să înlocuiască fișierul ${s}` : "Să facă sau să înlocuiască un fișier",
    editFile: (s) => (s ? `Să schimbe fișierul ${s}` : "Să schimbe un fișier"),
    convertDocument: (s) => (s ? `Să transforme documentul ${s}` : "Să transforme un document"),
    archive: (s) =>
      s ? `Să împacheteze sau să despacheteze ${s}` : "Să împacheteze sau să despacheteze o arhivă",
    versionControl: () => "Să salveze sau să schimbe istoricul versiunilor din dosar",
    changePermissions: (s) =>
      s ? `Să schimbe cine poate deschide ${s}` : "Să schimbe drepturile fișierelor",
    stopProgram: () => "Să oprească un program care rulează",
    scheduleTask: () => "Să programeze o sarcină care se repetă",
    useApp: (s) =>
      s ? `Să folosească aplicația conectată ${s}` : "Să folosească o aplicație conectată",
    delegate: () => "Să dea o parte din lucru unui asistent ajutător",
    plan: () => "Să-și actualizeze lista de pași",
    runCommand: (s) =>
      s ? `Să pornească programul ${s}` : "Să pornească un program pe calculator",
    other: (s) =>
      s ? `Să folosească unealta ${s}` : "Să facă un pas care are nevoie de acordul tău",
  },
  approvalAsks: "Asistentul vrea:",
  approvalMoreSteps: (count) => (count === 2 ? "și încă un pas" : `și încă ${count - 1} pași`),
  approvalRisky: "Asta schimbă sau șterge ceva. Aprobă doar dacă te așteptai.",
  details: "Detalii",
  hideDetails: "Ascunde detaliile",
  instructionsShown: "Instrucțiunile trimise asistentului",
  saveAsWorkflow: "Salvează ca sarcină gata făcută",
  saveAsWorkflowHint:
    "Fă din discuția asta un formular pe care îl completezi și îl pornești din nou.",
  draftingWorkflow: "Pregătesc sarcina din discuția asta…",
  draftFailed: "Nu am putut pregăti sarcina.",
  draftBasic:
    "Ciorna e făcută din primul tău mesaj. Verifică întrebările și instrucțiunile înainte să salvezi.",
  draftReady: "Ciorna e gata. Verific-o și salveaz-o.",
  draftFromTask:
    "Ciornă făcută dintr-o discuție. Verifică întrebările și instrucțiunile, apoi salvează.",
  chooseFile: "Alege un fișier",
  uploadingFile: "Copiez fișierul…",
  fileCopied: (path) => `L-am copiat în dosar ca ${path}.`,
  fileTooLarge: "Fișierul are mai mult de 25 MB.",
  fileUploadFailed: "Nu am putut copia fișierul.",
  orTypePath: "Sau scrie calea unui fișier care e deja în dosar",
  chooseFolderFirst: "Alege mai întâi un dosar.",
  saveFor: "Salvează pentru",
  saveForMe: "Doar pentru mine",
  saveForCompany: (company) => `Toată echipa ${company}`,
  companyWorkflowNote: (company) => `Sarcina asta e a echipei ${company}.`,
  model: "Model",
  modelHelp: "Ce model AI lucrează la sarcina asta.",
  modelDefault: "Modelul implicit al dosarului",
  modelHaiku: "Haiku (rapid, pentru sarcini simple)",
  modelSonnet: "Sonnet (echilibrat)",
  modelOpus: "Opus (cel mai capabil, mai lent)",
  modelCustom: (model) => `Altul: ${model}`,
  sampleLabel: "Exemplu realizat cu voce profesională ElevenLabs",
  repeatIt: "Repetă automat",
  repeatHelp: "Pornește și acum. Data viitoare pornește singură la ora aleasă, în același dosar.",
  repeatHow: "Cât de des",
  repeatDaily: "În fiecare zi",
  repeatWeekly: "În fiecare săptămână",
  repeatAt: "La ora",
  repeatOn: "În ziua",
  weekdays: ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"],
  repeatBadTime: "Scrie ora așa: HH:MM, de exemplu 09:30.",
  repeatFailed: "Sarcina a pornit, dar repetarea nu s-a putut salva.",
  repeatSaved: (when) => `Se va repeta ${when}. O găsești în Setări > Sarcini programate.`,
  repeatEveryDayAt: (time) => `în fiecare zi la ${time}`,
  repeatEveryWeekAt: (day, time) => `în fiecare ${day} la ${time}`,
  packWorkflows: (count) =>
    `${countLabel("ro", count, { one: "sarcină", other: "sarcini" })} în acest pachet`,
};

export const officeChatText = defineZenMessages({ en, ro });
