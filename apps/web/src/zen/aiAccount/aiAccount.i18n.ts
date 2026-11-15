// Zen Staff: the AI account confirmation (onboarding, Settings, Office home, AI staff).
import { defineZenMessages } from "../i18n/zenI18n";

export const aiAccountText = defineZenMessages({
  en: {
    title: "AI account",
    accountsTitle: "AI accounts",
    chooseTitle: "Choose the AI account your AI staff work with",
    intro:
      "Your AI staff work with your Claude or ChatGPT account. Zen Staff does not use an account it finds on this computer until you say so.",
    found: (account: string) => `I found the ${account} account on this computer. Shall I use it?`,
    use: "Use it",
    connectOther: "Connect another account",
    inUse: (account: string) => `In use: ${account}`,
    stopUsing: "Stop using",
    notSignedIn: (service: string) => `${service} is not connected on this computer.`,
    connect: (service: string) => `Connect ${service}`,
    notInstalled: (service: string) => `${service} is not installed on this computer.`,
    install: "Set it up",
    checking: "Looking for the AI accounts on this computer…",
    kind: { personal: "Personal", company: "Company", api: "API key", unknown: "Account" },
    personalWarning:
      "This is a personal subscription. Company agents should run on the company's account (Team, Enterprise or an API key).",
    blockedPersonal:
      "Personal accounts are blocked for company agents. Choose an assistant signed in to the company's account.",
    agentAccount: (account: string) => `Account: ${account}`,
    agentNoCompanyAccount: "No company account yet",
    agentUnconfirmed: "AI account not confirmed",
    bannerTitle: "Confirm the AI account",
    bannerAsk: (account: string) => `Shall we use the ${account} account on this computer?`,
    bannerYes: "Yes",
    bannerOther: "Another account",
    bannerDismiss: "Hide",
  },
  ro: {
    title: "Contul de AI",
    accountsTitle: "Conturi AI",
    chooseTitle: "Alege contul de AI cu care lucrează angajații tăi",
    intro:
      "Angajații tăi AI lucrează cu contul tău de Claude sau ChatGPT. Zen Staff nu folosește un cont găsit pe acest calculator până nu îi spui tu.",
    found: (account: string) => `Am găsit contul ${account} pe acest calculator. Îl folosesc?`,
    use: "Folosește-l",
    connectOther: "Conectează alt cont",
    inUse: (account: string) => `Folosit: ${account}`,
    stopUsing: "Nu-l mai folosi",
    notSignedIn: (service: string) => `${service} nu e conectat pe acest calculator.`,
    connect: (service: string) => `Conectează ${service}`,
    notInstalled: (service: string) => `${service} nu e instalat pe acest calculator.`,
    install: "Instalează",
    checking: "Caut conturile de AI de pe acest calculator…",
    kind: { personal: "Personal", company: "Firmă", api: "Cheie API", unknown: "Cont" },
    personalWarning:
      "Acesta e un abonament personal. Agenții firmei ar trebui să lucreze cu contul firmei (Team, Enterprise sau o cheie API).",
    blockedPersonal:
      "Conturile personale sunt blocate pentru agenții firmei. Alege un asistent conectat la contul firmei.",
    agentAccount: (account: string) => `Cont: ${account}`,
    agentNoCompanyAccount: "Firma nu are încă un cont de AI",
    agentUnconfirmed: "Contul de AI nu e confirmat",
    bannerTitle: "Confirmă contul de AI",
    bannerAsk: (account: string) => `Folosim contul ${account} de pe acest calculator?`,
    bannerYes: "Da",
    bannerOther: "Alt cont",
    bannerDismiss: "Ascunde",
  },
});
