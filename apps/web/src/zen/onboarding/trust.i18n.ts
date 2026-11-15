// Zen Staff: the one trust model every Office screen uses (ZEN.md, "First run"). The agent works on
// its own inside the company's folder (mode "Automat", the runtime's "auto"); anything that leaves
// the company waits for "Aprobă" in one place, "De aprobat". No other approval words in Office.
import { defineZenMessages } from "../i18n/zenI18n";

export const trustText = defineZenMessages({
  en: {
    title: "How your agents work",
    intro: "Before you start, three things:",
    alone: "It works on its own in the company folder",
    aloneBody:
      "It reads, writes and creates files without bothering you. This mode is called “Automatic”.",
    ask: "It asks before it sends, publishes, pays for or deletes anything",
    askBody: "Anything that leaves the company waits for your “Approve”.",
    one: "Everything lands in “To approve”",
    oneBody: "One place, in the sidebar. Approve or decline with one click.",
    folder: "Company folder",
    approve: "To approve",
    outside: "Outside the company",
    understood: "Got it, continue",
    preparing: "Preparing the company folder…",
    folderFailed: "Could not create the company folder. You can choose one later from the sidebar.",
  },
  ro: {
    title: "Cum lucrează agenții tăi",
    intro: "Înainte să începi, trei lucruri:",
    alone: "Lucrează singur în dosarul firmei",
    aloneBody:
      "Citește, scrie și creează fișiere fără să te deranjeze. Modul ăsta se numește „Automat”.",
    ask: "Te întreabă înainte să trimită, publice, plătească sau șteargă ceva",
    askBody: "Tot ce iese din firmă așteaptă „Aprobă” de la tine.",
    one: "Totul ajunge în „De aprobat”",
    oneBody: "Un singur loc, în bara laterală. Aprobi sau refuzi dintr-un clic.",
    folder: "Dosarul firmei",
    approve: "De aprobat",
    outside: "În afara firmei",
    understood: "Am înțeles, mai departe",
    preparing: "Pregătesc dosarul firmei…",
    folderFailed: "Nu am putut crea dosarul firmei. Poți alege unul mai târziu din bara laterală.",
  },
});
