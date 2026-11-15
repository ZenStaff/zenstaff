// Zen Staff: strings of the company server confirmation (review 0.2.3, P0-6) and of the one trust
// model every Office screen uses: the agent works on its own inside the company's folder
// ("Automat"); whatever leaves the company waits for "Aprobă" in "De aprobat".
import { defineZenMessages } from "../i18n/zenI18n";

export const serverSetupText = defineZenMessages({
  en: {
    title: (company: string) => `Make this computer the server of ${company}`,
    confirmTitle: (company: string) => `What the server of ${company} uses`,
    intro:
      "Colleagues' chats and tasks for the AI staff will run on this computer. Choose what they may use.",
    accountTitle: "Company AI account",
    accountHint: "Every task colleagues give runs on this account and counts against its limits.",
    seat: (account: string) => `The account this computer is signed in to: ${account}`,
    noSeat: "No AI account is signed in on this computer.",
    personalWarning:
      "This is a personal subscription. Using it for a whole team can break the provider's terms, and colleagues would work on your own account. Better: a Team account of the company or a company API key.",
    apiKey: "A company API key",
    apiKeyHint: "The key stays encrypted on this computer; colleagues only see its name.",
    apiKeyName: "Name colleagues see",
    apiKeyDefaultName: "Company API key",
    apiKeyPlaceholder: "Paste the key",
    apiKeyStored: "Saved on this computer (leave empty to keep it)",
    chooseAccount: "Choose the company AI account first: until then the AI staff do not start.",
    connectorsTitle: "Connections colleagues may use",
    connectorsHint:
      "None by default. Your personal connections (for example payroll or your own Facebook) stay yours unless you tick them.",
    connectorsNone: "No connection on this computer.",
    connectorsLoading: "Looking for connections...",
    personalConnection: "your account",
    localConnection: "this computer",
    trustTitle: "How the AI staff work",
    trustAuto:
      'They work on their own inside the company\'s folder: they read, write and create files (mode "Automat").',
    trustApprove:
      'Anything that leaves the company (sending e-mails or messages, publishing, paying, deleting, sharing outside) waits for "Aprobă" in "De aprobat".',
    acknowledge: "I understand: colleagues' tasks run on this computer, with the account above.",
    cancel: "Cancel",
    confirm: "Make it the company server",
    save: "Save",
    saving: "Saving...",
    couldNotSave: "Could not make this computer the company server",
    done: "This computer is the company server",
    pendingTitle: "Confirm what the company server uses",
    pendingHint:
      "Until you confirm, colleagues' chats and tasks do not run here and none of your connections is shared.",
    pendingAction: "Confirm",
    recorded: (account: string, count: number) =>
      count === 0
        ? `Uses ${account}; no connection shared.`
        : `Uses ${account}; ${count} connection${count === 1 ? "" : "s"} shared.`,
    change: "Change",
    stop: "Stop the server on this computer",
  },
  ro: {
    title: (company: string) => `Fă din acest calculator serverul firmei ${company}`,
    confirmTitle: (company: string) => `Ce folosește serverul firmei ${company}`,
    intro:
      "Chaturile colegilor și sarcinile pentru angajații AI vor rula pe acest calculator. Alege ce pot folosi.",
    accountTitle: "Contul AI al firmei",
    accountHint:
      "Fiecare sarcină dată de colegi rulează pe acest cont și se scade din limitele lui.",
    seat: (account: string) => `Contul cu care e conectat acest calculator: ${account}`,
    noSeat: "Pe acest calculator nu e conectat niciun cont AI.",
    personalWarning:
      "E un abonament personal. Folosit pentru toată echipa poate încălca termenii furnizorului, iar colegii ar lucra pe contul tău. Mai bine: un cont Team al firmei sau o cheie API a firmei.",
    apiKey: "O cheie API a firmei",
    apiKeyHint: "Cheia rămâne criptată pe acest calculator; colegii văd doar numele ei.",
    apiKeyName: "Numele pe care îl văd colegii",
    apiKeyDefaultName: "Cheia API a firmei",
    apiKeyPlaceholder: "Lipește cheia",
    apiKeyStored: "Salvată pe acest calculator (lasă gol ca s-o păstrezi)",
    chooseAccount: "Alege întâi contul AI al firmei: până atunci angajații AI nu pornesc.",
    connectorsTitle: "Conexiuni pe care le pot folosi colegii",
    connectorsHint:
      "Niciuna implicit. Conexiunile tale personale (de exemplu salarizarea sau Facebookul tău) rămân ale tale dacă nu le bifezi.",
    connectorsNone: "Nicio conexiune pe acest calculator.",
    connectorsLoading: "Caut conexiunile...",
    personalConnection: "contul tău",
    localConnection: "acest calculator",
    trustTitle: "Cum lucrează angajații AI",
    trustAuto:
      "Lucrează singuri în dosarul firmei: citesc, scriu și creează fișiere (modul „Automat”).",
    trustApprove:
      "Tot ce iese din firmă (trimite e-mailuri sau mesaje, publică, plătește, șterge, partajează în afară) așteaptă „Aprobă” în „De aprobat”.",
    acknowledge:
      "Am înțeles: sarcinile colegilor rulează pe acest calculator, cu contul de mai sus.",
    cancel: "Anulează",
    confirm: "Fă-l serverul firmei",
    save: "Salvează",
    saving: "Salvez...",
    couldNotSave: "Nu am putut face din acest calculator serverul firmei",
    done: "Acest calculator e serverul firmei",
    pendingTitle: "Confirmă ce folosește serverul firmei",
    pendingHint:
      "Până confirmi, chaturile și sarcinile colegilor nu rulează aici și nicio conexiune de-a ta nu e partajată.",
    pendingAction: "Confirmă",
    recorded: (account: string, count: number) =>
      count === 0
        ? `Folosește ${account}; nicio conexiune partajată.`
        : count === 1
          ? `Folosește ${account}; o conexiune partajată.`
          : `Folosește ${account}; ${count} conexiuni partajate.`,
    change: "Schimbă",
    stop: "Oprește serverul pe acest calculator",
  },
});
