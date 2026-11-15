// Zen Staff: strings of Team > company > Server and Cont AI (the company server and the company
// AI account). Plain office words: "serverul firmei", never "runner" or "seat".
import { defineZenMessages } from "../i18n/zenI18n";

export const companyServerText = defineZenMessages({
  en: {
    serverTitle: "Company server",
    serverExplain:
      "The company server is the computer the company's AI staff work on. It must stay on.",
    aiTitle: "Company AI account",
    aiExplain:
      "The company AI account is chosen on the company server: the AI staff work there, with that account.",
    noServer: "The company has no server yet.",
    noServerMember: "The company has no server yet. An owner or an admin chooses it.",
    readOnly: "Only owners and admins change the server and the AI account.",
    running: "on",
    stopped: "off",
    thisComputer: "this computer",
    ownedBy: (name: string) => `belongs to ${name}`,
    chooseTitle: "Choose the company server",
    chooseHint:
      "Your computers connected to Zen Staff. Pick one that stays on all the time, such as a server.",
    makeServer: "Make it the company server",
    stopServer: "Stop being the company server",
    isServer: "Company server",
    personalWarning:
      "It will work for the whole team, so it must stay on and connected. On a personal laptop or PC, the AI staff stop when you close it. Better: a computer or a server that runs non-stop.",
    serverWarning: "It must stay on and connected all the time.",
    notSignedIn: "Not signed in to the team with your account. Open Team on it and sign in.",
    otherAccount: "Signed in to the team with another account.",
    noAccess: "You are not an owner or an admin of this company on that computer.",
    checking: "Checking...",
    noMachines: "No computer is connected.",
    addServerHint:
      "A separate server (for example srv-birou) appears here after you add it in Settings > Computers.",
    moreAbout: "More about the company server",
    couldNotChange: "Could not change the company server",
    onServer: (name: string) => `On ${name}`,
    accountNotChosen: "Not chosen yet: the AI staff use the account the server is signed in with.",
    accountIs: (label: string) => `Account: ${label}`,
    provider: "Provider",
    howPaid: "How it is paid",
    modeServer: "My subscription (just me)",
    modeKey: "Company API key",
    modeServerHint:
      "The server uses the Claude or ChatGPT subscription it is signed in with, for you alone.",
    modeKeyHint: "The key stays encrypted on the server; colleagues only see the name.",
    modeSoloWarning:
      "Just for you. Colleagues work with their own AI account; for the server to work for them too, add a company API key.",
    keyOnlyForTeam:
      "With colleagues, the company server works only on a company API key: personal Claude or ChatGPT subscriptions are for one person and cannot serve a team.",
    providerName: { claude: "Anthropic (Claude)", codex: "OpenAI (Codex)" },
    consoleLink: "Create a key in the provider's console",
    capNote: "Tip: set a monthly spending limit there.",
    needsKey:
      "Colleagues cannot use it yet: add the company API key (Company AI account) to turn it on for them.",
    notForColleagues: "Not for colleagues: no company API key",
    inviteNoKey:
      "Colleagues work on their own computer, with their own AI account. For shared AI staff on the company server, add a company API key.",
    addCompanyKey: "Add the company API key",
    accountName: "Name colleagues see (no keys)",
    defaultName: { seat: "My subscription", "api-key": "Company API key" },
    apiKey: "API key",
    apiKeyStored: "Saved on the server (leave empty to keep it)",
    save: "Save",
    saved: "Saved",
    couldNotSave: "Could not save the AI account",
    manageOnServer: (name: string) =>
      `Changed from ${name}. Connect that computer to Zen Staff (Settings > Computers) to change it from here.`,
  },
  ro: {
    serverTitle: "Serverul firmei",
    serverExplain:
      "Serverul firmei e calculatorul pe care lucrează angajații AI ai firmei. Trebuie să stea pornit.",
    aiTitle: "Contul AI al firmei",
    aiExplain:
      "Contul AI al firmei se alege pe serverul firmei: acolo lucrează angajații AI, cu acest cont.",
    noServer: "Firma nu are încă un server.",
    noServerMember: "Firma nu are încă un server. Îl alege un proprietar sau un administrator.",
    readOnly: "Doar proprietarii și administratorii schimbă serverul și contul AI.",
    running: "pornit",
    stopped: "oprit",
    thisComputer: "acest calculator",
    ownedBy: (name: string) => `al lui ${name}`,
    chooseTitle: "Alege serverul firmei",
    chooseHint:
      "Calculatoarele tale conectate la Zen Staff. Alege unul care stă pornit tot timpul, de exemplu un server.",
    makeServer: "Fă-l serverul firmei",
    stopServer: "Nu mai e serverul firmei",
    isServer: "Serverul firmei",
    personalWarning:
      "Va lucra pentru toată echipa, deci trebuie să stea pornit și conectat. Pe un laptop sau PC personal, angajații AI se opresc când îl închizi. Mai bine: un calculator sau un server care merge non-stop.",
    serverWarning: "Trebuie să stea pornit și conectat tot timpul.",
    notSignedIn: "Nu e conectat la echipă cu contul tău. Deschide Echipă pe el și conectează-te.",
    otherAccount: "E conectat la echipă cu alt cont.",
    noAccess: "Pe acel calculator nu ești proprietar sau administrator al firmei.",
    checking: "Verific...",
    noMachines: "Niciun calculator conectat.",
    addServerHint:
      "Un server separat (de exemplu srv-birou) apare aici după ce îl adaugi în Setări > Calculatoare.",
    moreAbout: "Mai multe despre serverul firmei",
    couldNotChange: "Nu am putut schimba serverul firmei",
    onServer: (name: string) => `Pe ${name}`,
    accountNotChosen: "Încă nu e ales: angajații AI folosesc contul cu care e conectat serverul.",
    accountIs: (label: string) => `Cont: ${label}`,
    provider: "Furnizor",
    howPaid: "Cum se plătește",
    modeServer: "Abonamentul meu (doar pentru mine)",
    modeKey: "Cheie API a firmei",
    modeServerHint:
      "Serverul folosește abonamentul Claude sau ChatGPT cu care e conectat, doar pentru tine.",
    modeKeyHint: "Cheia rămâne criptată pe server; colegii văd doar numele.",
    modeSoloWarning:
      "Doar pentru tine. Colegii lucrează cu contul lor de AI; ca serverul să lucreze și pentru ei, adaugă o cheie API a firmei.",
    keyOnlyForTeam:
      "Cu colegi, serverul firmei lucrează doar cu o cheie API a firmei: abonamentele personale Claude sau ChatGPT sunt pentru o singură persoană și nu pot servi o echipă.",
    providerName: { claude: "Anthropic (Claude)", codex: "OpenAI (Codex)" },
    consoleLink: "Creează o cheie în consola furnizorului",
    capNote: "Sfat: pune acolo o limită lunară de cheltuieli.",
    needsKey:
      "Colegii nu-l pot folosi încă: adaugă cheia API a firmei (Contul AI al firmei) ca să pornească și pentru ei.",
    notForColleagues: "Nu și pentru colegi: lipsește cheia API a firmei",
    inviteNoKey:
      "Colegii lucrează pe calculatorul lor, cu contul lor de AI. Pentru angajați AI comuni, pe serverul firmei, adaugă o cheie API a firmei.",
    addCompanyKey: "Adaugă cheia API a firmei",
    accountName: "Numele pe care îl văd colegii (fără chei)",
    defaultName: { seat: "Abonamentul meu", "api-key": "Cheie API a firmei" },
    apiKey: "Cheie API",
    apiKeyStored: "Salvată pe server (lasă gol ca s-o păstrezi)",
    save: "Salvează",
    saved: "Salvat",
    couldNotSave: "Nu am putut salva contul AI",
    manageOnServer: (name: string) =>
      `Se schimbă de pe ${name}. Conectează acel calculator la Zen Staff (Setări > Calculatoare) ca să-l schimbi de aici.`,
  },
});
