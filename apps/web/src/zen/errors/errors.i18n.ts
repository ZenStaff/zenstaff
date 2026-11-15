// Zen Staff: the app's error screens (a screen that crashed, the app that did not start). One
// human sentence, the technical details folded under "Detalii tehnice", a report by e-mail.
import { defineZenMessages } from "../i18n/zenI18n";

const en = {
  title: "Something went wrong on this screen",
  body: "Your files and chats are safe. Try again; if it keeps happening, send us the report.",
  tryAgain: "Try again",
  reload: "Restart the app",
  report: "Send the report",
  copy: "Copy the details",
  copied: "Copied",
  details: "Technical details",
  detailsNote: "The details may include file and folder names. Check them before sending.",
  mailSubject: "Zen Staff: an error on a screen",
  mailIntro: "What I was doing when it happened:",
};

const ro: { readonly [K in keyof typeof en]: (typeof en)[K] } = {
  title: "Ceva n-a mers pe ecranul ăsta",
  body: "Fișierele și discuțiile tale sunt în siguranță. Încearcă din nou; dacă se repetă, trimite-ne raportul.",
  tryAgain: "Încearcă din nou",
  reload: "Repornește aplicația",
  report: "Trimite raportul",
  copy: "Copiază detaliile",
  copied: "Copiat",
  details: "Detalii tehnice",
  detailsNote:
    "Detaliile pot conține nume de fișiere și dosare. Verifică-le înainte să le trimiți.",
  mailSubject: "Zen Staff: o eroare pe un ecran",
  mailIntro: "Ce făceam când s-a întâmplat:",
};

export const errorsText = defineZenMessages({ en, ro });
