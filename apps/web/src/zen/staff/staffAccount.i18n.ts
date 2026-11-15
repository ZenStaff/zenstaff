// Zen Staff AI staff > Settings: the company's AI account, in Office wording (no "runner", no
// "seat"). Kept apart from staff.i18n.ts.
import { defineZenMessages } from "../i18n/zenI18n";

export const staffAccountText = defineZenMessages({
  en: {
    title: "The company's AI account",
    intro:
      "Company agents work only with the company's AI account, never with someone's personal subscription. Zen Staff keeps no password or key: pick the assistant on this computer that is signed in to the company's account.",
    personalCompany:
      "Personal has no company account. Company agents belong to a company: choose or create one at the top of the sidebar.",
    kindLabel: "Type of account",
    kindNone: "Not set yet",
    kind: {
      "team-seat": "Team subscription",
      "enterprise-seat": "Enterprise subscription",
      "api-key": "The company's API key",
    },
    assistant: "Assistant on this computer",
    noAssistant: "No assistant on this computer",
    model: "Model",
    label: "Name shown to the team",
    labelPlaceholder: "For example: Claude Team ZED-ZEN",
    signedInAs: (account: string) => `Signed in: ${account}`,
    notSignedIn: "This assistant is not signed in.",
    blockPersonal: "Block personal accounts for company agents",
    blockPersonalHelp:
      "When on, a company agent cannot run on a personal subscription (Free, Pro, Max, Plus), only on Team, Enterprise or an API key.",
    save: "Save",
    saved: "Saved",
    runnerTitle: "The company's computer",
    runnerYes: (source: string) => `This computer runs the company's agents (${source}).`,
    runnerNo:
      "Company agents run on the company's computer, not on this one. Open Team to see which one it is.",
  },
  ro: {
    title: "Contul de AI al firmei",
    intro:
      "Agenții firmei lucrează doar cu contul de AI al firmei, niciodată cu abonamentul personal al cuiva. Zen Staff nu păstrează parole sau chei: alege asistentul de pe acest calculator conectat la contul firmei.",
    personalCompany:
      "Personal nu are cont de firmă. Agenții de firmă aparțin unei firme: alege sau creează una sus, în bara laterală.",
    kindLabel: "Tipul contului",
    kindNone: "Încă nesetat",
    kind: {
      "team-seat": "Abonament Team",
      "enterprise-seat": "Abonament Enterprise",
      "api-key": "Cheia API a firmei",
    },
    assistant: "Asistentul de pe acest calculator",
    noAssistant: "Niciun asistent pe acest calculator",
    model: "Model",
    label: "Numele văzut de echipă",
    labelPlaceholder: "De exemplu: Claude Team ZED-ZEN",
    signedInAs: (account: string) => `Conectat: ${account}`,
    notSignedIn: "Asistentul acesta nu e conectat la niciun cont.",
    blockPersonal: "Blochează conturile personale pentru agenții firmei",
    blockPersonalHelp:
      "Când e pornit, un agent al firmei nu poate lucra pe un abonament personal (Free, Pro, Max, Plus), doar pe Team, Enterprise sau o cheie API.",
    save: "Salvează",
    saved: "Salvat",
    runnerTitle: "Calculatorul firmei",
    runnerYes: (source: string) => `Acest calculator rulează agenții firmei (${source}).`,
    runnerNo:
      "Agenții firmei lucrează pe calculatorul firmei, nu pe acesta. Deschide Echipa ca să vezi care e.",
  },
});
