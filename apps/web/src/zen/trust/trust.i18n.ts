// Zen Staff: the one trust model Office shows everywhere. The agent works alone inside the folder;
// anything that leaves the company waits for "Aprobă" in "De aprobat". No "sandbox" or "full
// access" words in Office. ZEN.md, "Trust model".
import { defineZenMessages } from "../i18n/zenI18n";

const en = {
  pickerTitle: "How the assistant works",
  autoLabel: "Automatic",
  autoHelp: "Works on its own in the folder, asks you about anything that leaves the company",
  askLabel: "Ask me at every step",
  askHelp: "Waits for your Approve before every change",
  advanced: "Advanced",
  editsLabel: "Edit files alone, ask about the rest",
  editsHelp: "Changes files in the folder on its own; commands wait for you",
  fullLabel: "Full access, no questions",
  fullHelp: "May send, delete or pay without you. Only if you know why you need it.",
  rule: "Sending e-mails or messages, publishing, paying, deleting or sharing outside the company always waits for Approve in To approve.",
  approvalRule:
    "This leaves the folder, so it waits for your Approve. Everything that waits is also in To approve.",
  approvalStepRule: "You asked to be asked at every step, so this waits for your Approve.",
  migratedTitle: "The assistant now works in Automatic mode",
  migratedBody:
    "It works on its own in the folder and asks you about anything that leaves the company. You can change it from the composer.",
};

const ro: { readonly [K in keyof typeof en]: (typeof en)[K] } = {
  pickerTitle: "Cum lucrează asistentul",
  autoLabel: "Automat",
  autoHelp: "Lucrează singur în dosar, te întreabă la ce iese din firmă",
  askLabel: "Întreabă-mă la fiecare pas",
  askHelp: "Așteaptă „Aprobă” de la tine înainte de orice schimbare",
  advanced: "Avansat",
  editsLabel: "Editează singur fișierele, întreabă de rest",
  editsHelp: "Schimbă singur fișierele din dosar; comenzile te așteaptă",
  fullLabel: "Acces complet, fără întrebări",
  fullHelp: "Poate trimite, șterge sau plăti fără tine. Doar dacă știi de ce îți trebuie.",
  rule: "Trimiterea de e-mailuri sau mesaje, publicarea, plata, ștergerea sau partajarea în afara firmei așteaptă mereu „Aprobă” în „De aprobat”.",
  approvalRule:
    "Asta iese din dosar, așa că așteaptă „Aprobă” de la tine. Tot ce așteaptă apare și în „De aprobat”.",
  approvalStepRule: "Ai cerut să fii întrebat la fiecare pas, așa că asta așteaptă „Aprobă”.",
  migratedTitle: "Asistentul lucrează acum în modul Automat",
  migratedBody:
    "Lucrează singur în dosar și te întreabă la ce iese din firmă. Îl poți schimba din caseta de scris.",
};

export const trustText = defineZenMessages({ en, ro });
