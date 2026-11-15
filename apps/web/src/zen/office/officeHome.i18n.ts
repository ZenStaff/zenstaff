// Zen Staff Birou (Office home) redesign strings: greeting, the ask box, "Continuă", the folder
// line and the workflow gallery. See zen/i18n/zenI18n.ts.
import { defineZenMessages } from "../i18n/zenI18n";
import type { ContinueState, DayPart } from "./officeHome.logic";

const en = {
  greeting: {
    morning: "Good morning",
    day: "Good afternoon",
    evening: "Good evening",
  } satisfies Record<DayPart, string>,
  /** The second line of the title; the pen stroke goes under the second part. */
  whatToday: ["What shall we do", "today"] as readonly [string, string],
  greetingSub: "Write what you need in your own words, or pick a ready task below.",
  askPlaceholder: "What do you need? For example: write a client offer for a 40-person lunch",
  askLabel: "Ask your AI staff",
  askSend: "Start",
  askStarting: "Starting",
  askHint: "Enter starts the chat, Shift+Enter adds a line.",
  askNoFolder: "Add a folder in the sidebar first: the chat saves its work there.",
  workingIn: "Working in",
  change: "change",
  chooseFolderTitle: "Where should the work be saved?",
  noFolder: "no folder yet",
  continueTitle: "Continue",
  continueEmpty: "Nothing open. What you start here shows up in this row.",
  continueState: {
    "needs-you": "Waiting for you",
    working: "Working",
    recent: "Open",
  } satisfies Record<ContinueState, string>,
  seeAllThreads: "All chats are in the sidebar",
  tasksTitle: "Ready tasks",
  tasksSub: "Each one asks you a few things in the chat, then gets to work.",
  allCategories: "All",
  searchTasks: "Search tasks",
  searchPlaceholder: "Search",
  companyTask: "Company",
  yourTask: "Yours",
  customized: "Customized",
  draftWaiting: "Draft to review",
  more: "More",
  library: "All tasks",
  newTask: "Create a task",
};

type OfficeHomeMessages = typeof en;

const ro: OfficeHomeMessages = {
  greeting: {
    morning: "Bună dimineața",
    day: "Bună ziua",
    evening: "Bună seara",
  },
  whatToday: ["Ce facem", "azi"],
  greetingSub: "Scrie ce ai nevoie, cu cuvintele tale, sau alege mai jos o sarcină gata pregătită.",
  askPlaceholder: "Ce ai nevoie? De exemplu: scrie o ofertă pentru un prânz de 40 de persoane",
  askLabel: "Cere ceva colegilor AI",
  askSend: "Pornește",
  askStarting: "Pornesc",
  askHint: "Enter pornește discuția, Shift+Enter adaugă un rând.",
  askNoFolder: "Adaugă întâi un dosar din bara din stânga: discuția își salvează acolo munca.",
  workingIn: "Lucrezi în",
  change: "schimbă",
  chooseFolderTitle: "Unde se salvează munca?",
  noFolder: "încă niciun dosar",
  continueTitle: "Continuă",
  continueEmpty: "Nimic deschis. Ce pornești de aici apare în rândul acesta.",
  continueState: {
    "needs-you": "Te așteaptă",
    working: "Lucrează",
    recent: "Deschisă",
  },
  seeAllThreads: "Toate discuțiile sunt în bara din stânga",
  tasksTitle: "Sarcini gata pregătite",
  tasksSub: "Fiecare te întreabă câteva lucruri în chat, apoi se apucă de treabă.",
  allCategories: "Toate",
  searchTasks: "Caută sarcini",
  searchPlaceholder: "Caută",
  companyTask: "A firmei",
  yourTask: "A ta",
  customized: "Personalizată",
  draftWaiting: "Ciornă de verificat",
  more: "Mai mult",
  library: "Toate sarcinile",
  newTask: "Creează o sarcină",
};

export const officeHomeText = defineZenMessages<OfficeHomeMessages>({ en, ro });
