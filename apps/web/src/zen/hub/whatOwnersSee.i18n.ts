// Zen Staff: "Ce vede patronul despre tine" in Team > Account (review 0.2.3, P1-20). Kept exact:
// every line matches what the hub and the company server actually show owners and admins.
import { defineZenMessages } from "../i18n/zenI18n";

export const whatOwnersSeeText = defineZenMessages({
  en: {
    title: "What the company's owners and admins see about you",
    canTitle: "They see",
    can: [
      "Your name, e-mail and role in the company.",
      "The Academy lessons you finished.",
      "The chats you share with the company, and what you write in the company's chats.",
      "The tasks you give the company's AI staff: they run on the company server, where owners and admins can follow them.",
      "A new computer of yours that asks to use the company server (they approve it).",
    ],
    cannotTitle: "They do not see",
    cannot: [
      "Your personal chats and the files on your computer, unless you share them.",
      "Your own AI account and how much you use it.",
      "Your passwords, two-factor codes and device keys.",
      "Your Academy searches by name: only team totals, and only if you turned on helping the Academy.",
    ],
  },
  ro: {
    title: "Ce văd proprietarii și administratorii firmei despre tine",
    canTitle: "Văd",
    can: [
      "Numele, e-mailul și rolul tău în firmă.",
      "Lecțiile din Academie pe care le-ai terminat.",
      "Chaturile pe care le partajezi cu firma și ce scrii în chaturile firmei.",
      "Sarcinile pe care le dai angajaților AI ai firmei: rulează pe serverul firmei, unde proprietarii și administratorii le pot urmări.",
      "Un calculator nou de-al tău care cere acces la serverul firmei (ei îl aprobă).",
    ],
    cannotTitle: "Nu văd",
    cannot: [
      "Chaturile tale personale și fișierele de pe calculatorul tău, dacă nu le partajezi.",
      "Contul tău de AI și cât îl folosești.",
      "Parolele, codurile de verificare în doi pași și cheile dispozitivelor tale.",
      "Căutările tale din Academie cu numele tău: doar totalurile echipei și doar dacă ai ales să ajuți Academia.",
    ],
  },
});
