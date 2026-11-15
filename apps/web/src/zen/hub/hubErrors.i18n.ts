// Zen Staff: the sentences hubErrors.ts adds around the hub's refusals.
import { defineZenMessages } from "../i18n/zenI18n";

export const hubErrorText = defineZenMessages({
  en: {
    noPermission: (what: string) => `Your role does not allow this (${what}).`,
    askOwner: "Ask an owner or an admin of the company.",
    tryAgain: "Try again.",
    noMachine: "No computer is connected.",
    hubDown: "Your Zen Staff account is not answering right now. Try again in a minute.",
  },
  ro: {
    noPermission: (what: string) => `Rolul tău nu permite asta (${what}).`,
    askOwner: "Cere-i unui proprietar sau administrator al firmei.",
    tryAgain: "Încearcă din nou.",
    noMachine: "Niciun calculator conectat.",
    hubDown: "Contul tău Zen Staff nu răspunde acum. Încearcă din nou într-un minut.",
  },
});
