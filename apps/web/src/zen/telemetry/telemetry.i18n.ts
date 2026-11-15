// Zen Staff: anonymous usage statistics (consent on the first-run screen, the one-time question
// after an update, Settings > Privacy). ZEN.md, "Updates and telemetry".
import { defineZenMessages } from "../i18n/zenI18n";

export const telemetryText = defineZenMessages({
  en: {
    title: "Anonymous statistics",
    question: "Help us improve Zen Staff?",
    explain:
      "We count, once a day, how many chats, workflows and approvals you used, plus the app version, system, edition and language. Never what you write, file names, e-mails, company names or your IP address.",
    send: "Send anonymous statistics",
    dontSend: "Don't send",
    chosenOn: "You send anonymous statistics. Thank you.",
    chosenOff: "Nothing is sent.",
    changeLater: "You can change this anytime in Settings > Privacy.",
    blocked: "Your organization turned usage statistics off on this computer.",
    saveFailed: "Could not save your choice.",
    privacy: "Privacy",
    privacyDescription: "What Zen Staff sends about how you use it.",
    statusTitle: "Usage statistics",
    notChosen: "You have not chosen yet; nothing is sent.",
    updatesTitle: "Update checks",
    updatesBody:
      "Checking for updates tells our update server the app version, system and edition (Office or Code). No install id.",
  },
  ro: {
    title: "Statistici anonime",
    question: "Ne ajuți să îmbunătățim Zen Staff?",
    explain:
      "Numărăm o dată pe zi câte conversații, fluxuri și aprobări ai folosit, plus versiunea aplicației, sistemul, ediția și limba. Niciodată ce scrii, nume de fișiere, e-mailuri, nume de firme sau adresa IP.",
    send: "Trimite statistici anonime",
    dontSend: "Nu trimite",
    chosenOn: "Trimiți statistici anonime. Mulțumim.",
    chosenOff: "Nu se trimite nimic.",
    changeLater: "Poți schimba oricând în Setări > Confidențialitate.",
    blocked: "Organizația ta a oprit statisticile de utilizare pe acest calculator.",
    saveFailed: "Alegerea nu a putut fi salvată.",
    privacy: "Confidențialitate",
    privacyDescription: "Ce trimite Zen Staff despre felul în care îl folosești.",
    statusTitle: "Statistici de utilizare",
    notChosen: "Nu ai ales încă; nu se trimite nimic.",
    updatesTitle: "Verificarea actualizărilor",
    updatesBody:
      "Când caută actualizări, aplicația spune serverului nostru de actualizări versiunea, sistemul și ediția (Office sau Code). Fără niciun identificator al instalării.",
  },
});
