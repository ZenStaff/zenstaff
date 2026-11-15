// Zen Staff: strings of the connect card and the Connections page.
import type { ZenConnectorPathKind, ZenMcpHealth } from "@t3tools/contracts/zenConnectors";

import { defineZenMessages } from "../i18n/zenI18n";

type ConnectorsMessages = {
  readonly cardTitle: (app: string) => string;
  readonly cardTitleKind: string;
  readonly whichOne: string;
  readonly customTitle: (url: string) => string;
  readonly customBody: string;
  readonly kind: Record<ZenConnectorPathKind, string>;
  readonly kindHint: Record<ZenConnectorPathKind, string>;
  readonly bestWay: string;
  readonly otherWays: string;
  readonly anotherWay: string;
  readonly unavailable: string;
  readonly access: string;
  readonly accessWrite: (text: string) => string;
  readonly noKeys: string;
  readonly scopeLabel: string;
  readonly scopePersonal: string;
  readonly scopeCompany: string;
  readonly already: (name: string) => string;
  readonly connected: (name: string) => string;
  readonly openSettings: (provider: string) => string;
  readonly otherAccounts: string;
  readonly check: string;
  readonly checking: string;
  readonly notVisibleYet: string;
  readonly connect: string;
  readonly connecting: string;
  readonly signInReady: string;
  readonly openSignIn: string;
  readonly scanPhone: string;
  readonly copyLink: string;
  readonly copied: string;
  readonly sendEmail: string;
  readonly emailPlaceholder: string;
  readonly send: string;
  readonly pasteBackLabel: string;
  readonly pasteBackHelp: string;
  readonly pasteBackButton: string;
  readonly waitingSignIn: string;
  readonly signInFailed: (message: string) => string;
  readonly manualTitle: string;
  readonly manualBody: string;
  readonly connectZapier: string;
  readonly openApp: (app: string) => string;
  readonly supervised: string;
  readonly askZedZen: string;
  readonly askTitle: (app: string) => string;
  readonly askNote: string;
  readonly askContact: string;
  readonly askSend: string;
  readonly askSent: string;
  readonly askNoSecrets: string;
  readonly notNow: string;
  readonly close: string;
  readonly verified: string;
  readonly unverified: string;
  readonly enterpriseBadge: string;
  readonly pageTitle: string;
  readonly pageIntro: string;
  readonly refresh: string;
  readonly empty: string;
  readonly noClaude: string;
  readonly colApp: string;
  readonly colWhere: string;
  readonly colStatus: string;
  readonly colAccess: string;
  readonly colUsedBy: string;
  readonly colChecked: string;
  readonly origin: Record<"account" | "plugin" | "local", string>;
  readonly health: Record<ZenMcpHealth, string>;
  readonly test: string;
  readonly testOk: string;
  readonly testFailed: (message: string) => string;
  readonly signIn: string;
  readonly disconnect: string;
  readonly disconnectAccount: string;
  readonly confirmDisconnect: (name: string) => string;
  readonly companyServer: string;
  readonly personalMachine: string;
  readonly catalogTitle: string;
  readonly catalogIntro: string;
  readonly addByAddress: string;
  readonly addressPlaceholder: string;
  readonly addAddress: string;
  readonly supportTitle: string;
  readonly supportLocal: string;
  readonly enterpriseTitle: string;
  readonly enterpriseIntro: string;
  readonly grantPlaceholder: string;
  readonly grant: string;
  readonly revoke: string;
  readonly adminConfirm: string;
  readonly sidebar: string;
  readonly palette: string;
  readonly usedByNone: string;
  readonly storedNothing: string;
};

export const connectorsText = defineZenMessages<ConnectorsMessages>({
  en: {
    cardTitle: (app) => `Connect ${app}`,
    cardTitleKind: "Connect an app",
    whichOne: "Which one do you use?",
    customTitle: (url) => `Connect the MCP server ${url}`,
    customBody: "Claude Code adds it on this computer; if it needs a sign-in, a link appears here.",
    kind: {
      native: "Your AI account",
      "local-mcp": "Claude Code on this computer",
      automation: "Your Zapier / Make",
      csv: "Export a file",
      browser: "In your browser",
    },
    kindHint: {
      native: "Connected once in claude.ai; every assistant here sees it.",
      "local-mcp": "Claude Code adds it and keeps the sign-in.",
      automation: "Your own automation account reaches the app.",
      csv: "You export a file and give it to the assistant.",
      browser: "Slower; the assistant works while you watch.",
    },
    bestWay: "Best way here",
    otherWays: "Other ways",
    anotherWay: "Connect another way",
    unavailable: "not available here",
    access: "What it can see",
    accessWrite: (text) => `Only if you allow it later: ${text}`,
    noKeys:
      "Zen Staff never asks for or keeps passwords, keys or tokens. Sign-ins stay in your own accounts.",
    scopeLabel: "For",
    scopePersonal: "Only me",
    scopeCompany: "The company (company server)",
    already: (name) => `Already connected (${name}). The assistant can use it now.`,
    connected: (name) => `Connected (${name}). The assistant sees it from your next message.`,
    openSettings: (provider) => `Open ${provider} connectors`,
    otherAccounts: "Using ChatGPT or Gemini instead?",
    check: "Check",
    checking: "Checking…",
    notVisibleYet: "Not visible yet. Finish the steps, then check again (it can take a minute).",
    connect: "Connect",
    connecting: "Adding it to Claude Code…",
    signInReady: "Sign in to finish",
    openSignIn: "Open the sign-in page",
    scanPhone: "Or scan it with your phone",
    copyLink: "Copy link",
    copied: "Copied",
    sendEmail: "Send the link to my e-mail",
    emailPlaceholder: "you@company.example",
    send: "Send",
    pasteBackLabel: "Signed in on another device?",
    pasteBackHelp:
      "If the page after sign-in did not load, copy its address (it starts with http://localhost) and paste it here. It is used once and not kept.",
    pasteBackButton: "Finish",
    waitingSignIn: "Waiting for the sign-in…",
    signInFailed: (message) => `The sign-in did not finish: ${message}`,
    manualTitle: "This one needs your own key",
    manualBody:
      "Zen Staff does not take keys. Run this in a terminal on this computer with your key in place of the <...> part, or ask ZED-ZEN to do it with you.",
    connectZapier: "Connect Zapier first",
    openApp: (app) => `Open ${app}`,
    supervised: "Slower, and you stay in control: watch while it works.",
    askZedZen: "Ask ZED-ZEN to set this up for me",
    askTitle: (app) => `ZED-ZEN will help you connect ${app}`,
    askNote: "What do you want the assistant to do with it?",
    askContact: "Phone or e-mail (optional)",
    askSend: "Send request",
    askSent: "Request saved. ZED-ZEN will contact you.",
    askNoSecrets: "Do not write passwords or keys here.",
    notNow: "Not now",
    close: "Close",
    verified: "checked",
    unverified: "not checked yet",
    enterpriseBadge: "Enterprise",
    pageTitle: "Connections",
    pageIntro:
      "Apps your assistant can reach. They live in your own AI account or in Claude Code on this computer; Zen Staff only reads their state and keeps no keys.",
    refresh: "Refresh",
    empty: 'Nothing connected yet. Ask in chat: "connect my Gmail".',
    noClaude: "Claude Code was not found on this computer, so connections cannot be read here.",
    colApp: "App",
    colWhere: "Where",
    colStatus: "Status",
    colAccess: "Access",
    colUsedBy: "Used by",
    colChecked: "Checked",
    origin: { account: "AI account connector", plugin: "Claude Code plugin", local: "Claude Code" },
    health: {
      connected: "Connected",
      "needs-auth": "Needs sign-in",
      failed: "Not working",
      pending: "Waiting for approval",
      unknown: "Unknown",
    },
    test: "Test",
    testOk: "Works",
    testFailed: (message) => `Not working: ${message}`,
    signIn: "Sign in",
    disconnect: "Disconnect",
    disconnectAccount: "Manage in claude.ai",
    confirmDisconnect: (name) => `Remove ${name} from Claude Code on this computer?`,
    companyServer: "Company server",
    personalMachine: "This computer",
    catalogTitle: "Apps you can connect",
    catalogIntro: "Press an app to see the best way to connect it here.",
    addByAddress: "Connect by address (public MCP server)",
    addressPlaceholder: "https://mcp.example.com/mcp",
    addAddress: "Add",
    supportTitle: "Requests to ZED-ZEN",
    supportLocal: "saved on this computer (the hub will send them)",
    enterpriseTitle: "Enterprise connectors",
    enterpriseIntro: "Run only on the company's always-on server, for people an admin unlocked.",
    grantPlaceholder: "colleague@company.example",
    grant: "Unlock",
    revoke: "Lock",
    adminConfirm: "I am an admin of this company",
    sidebar: "Connections",
    palette: "Open connections (apps your assistant can use)",
    usedByNone: "none",
    storedNothing: "Zen Staff stores no keys or tokens for these connections.",
  },
  ro: {
    cardTitle: (app) => `Conectează ${app}`,
    cardTitleKind: "Conectează o aplicație",
    whichOne: "Pe care o folosiți?",
    customTitle: (url) => `Conectează serverul MCP ${url}`,
    customBody:
      "Claude Code îl adaugă pe acest calculator; dacă cere autentificare, apare aici un link.",
    kind: {
      native: "Contul tău AI",
      "local-mcp": "Claude Code pe acest calculator",
      automation: "Zapier / Make al tău",
      csv: "Export într-un fișier",
      browser: "În browserul tău",
    },
    kindHint: {
      native: "Conectat o dată în claude.ai; orice asistent de aici îl vede.",
      "local-mcp": "Claude Code îl adaugă și păstrează autentificarea.",
      automation: "Contul tău de automatizare ajunge la aplicație.",
      csv: "Exporți un fișier și i-l dai asistentului.",
      browser: "Mai lent; asistentul lucrează cât timp te uiți.",
    },
    bestWay: "Cea mai bună cale aici",
    otherWays: "Alte căi",
    anotherWay: "Conectează altfel",
    unavailable: "indisponibil aici",
    access: "Ce poate vedea",
    accessWrite: (text) => `Doar dacă permiți ulterior: ${text}`,
    noKeys:
      "Zen Staff nu cere și nu păstrează parole, chei sau tokenuri. Autentificările rămân în conturile tale.",
    scopeLabel: "Pentru",
    scopePersonal: "Doar eu",
    scopeCompany: "Firma (serverul firmei)",
    already: (name) => `Deja conectat (${name}). Asistentul îl poate folosi acum.`,
    connected: (name) => `Conectat (${name}). Asistentul îl vede de la următorul mesaj.`,
    openSettings: (provider) => `Deschide conectorii ${provider}`,
    otherAccounts: "Folosești ChatGPT sau Gemini?",
    check: "Verifică",
    checking: "Verific…",
    notVisibleYet: "Nu apare încă. Termină pașii, apoi verifică din nou (poate dura un minut).",
    connect: "Conectează",
    connecting: "Îl adaug în Claude Code…",
    signInReady: "Autentifică-te ca să termini",
    openSignIn: "Deschide pagina de autentificare",
    scanPhone: "Sau scanează cu telefonul",
    copyLink: "Copiază linkul",
    copied: "Copiat",
    sendEmail: "Trimite linkul pe e-mailul meu",
    emailPlaceholder: "tu@firma.example",
    send: "Trimite",
    pasteBackLabel: "Te-ai autentificat de pe alt dispozitiv?",
    pasteBackHelp:
      "Dacă pagina de după autentificare nu s-a încărcat, copiază adresa ei (începe cu http://localhost) și lipește-o aici. Se folosește o singură dată și nu se păstrează.",
    pasteBackButton: "Termină",
    waitingSignIn: "Aștept autentificarea…",
    signInFailed: (message) => `Autentificarea nu s-a terminat: ${message}`,
    manualTitle: "Aici e nevoie de cheia ta",
    manualBody:
      "Zen Staff nu primește chei. Rulează comanda într-un terminal pe acest calculator, cu cheia ta în locul părții <...>, sau cere ZED-ZEN să o facă împreună cu tine.",
    connectZapier: "Conectează întâi Zapier",
    openApp: (app) => `Deschide ${app}`,
    supervised: "Mai lent și rămâi tu la control: urmărește cât lucrează.",
    askZedZen: "Cere ZED-ZEN să configureze pentru mine",
    askTitle: (app) => `ZED-ZEN te ajută să conectezi ${app}`,
    askNote: "Ce vrei să facă asistentul cu ea?",
    askContact: "Telefon sau e-mail (opțional)",
    askSend: "Trimite cererea",
    askSent: "Cererea e salvată. ZED-ZEN te contactează.",
    askNoSecrets: "Nu scrie aici parole sau chei.",
    notNow: "Nu acum",
    close: "Închide",
    verified: "verificat",
    unverified: "neverificat încă",
    enterpriseBadge: "Enterprise",
    pageTitle: "Conexiuni",
    pageIntro:
      "Aplicațiile la care ajunge asistentul. Stau în contul tău AI sau în Claude Code pe acest calculator; Zen Staff doar le citește starea și nu păstrează chei.",
    refresh: "Reîmprospătează",
    empty: "Nimic conectat încă. Cere în chat: „conectează-mi Gmail”.",
    noClaude:
      "Claude Code nu a fost găsit pe acest calculator, deci conexiunile nu pot fi citite aici.",
    colApp: "Aplicație",
    colWhere: "Unde",
    colStatus: "Stare",
    colAccess: "Acces",
    colUsedBy: "Folosit de",
    colChecked: "Verificat",
    origin: {
      account: "Conector în contul AI",
      plugin: "Plugin Claude Code",
      local: "Claude Code",
    },
    health: {
      connected: "Conectat",
      "needs-auth": "Cere autentificare",
      failed: "Nu funcționează",
      pending: "Așteaptă aprobare",
      unknown: "Necunoscut",
    },
    test: "Testează",
    testOk: "Funcționează",
    testFailed: (message) => `Nu funcționează: ${message}`,
    signIn: "Autentificare",
    disconnect: "Deconectează",
    disconnectAccount: "Gestionează în claude.ai",
    confirmDisconnect: (name) => `Scoți ${name} din Claude Code pe acest calculator?`,
    companyServer: "Serverul firmei",
    personalMachine: "Acest calculator",
    catalogTitle: "Aplicații pe care le poți conecta",
    catalogIntro: "Apasă pe o aplicație ca să vezi cea mai bună cale de conectare aici.",
    addByAddress: "Conectează după adresă (server MCP public)",
    addressPlaceholder: "https://mcp.exemplu.example/mcp",
    addAddress: "Adaugă",
    supportTitle: "Cereri către ZED-ZEN",
    supportLocal: "salvate pe acest calculator (hub-ul le va trimite)",
    enterpriseTitle: "Conectori Enterprise",
    enterpriseIntro:
      "Rulează doar pe serverul firmei, pornit mereu, pentru persoanele deblocate de un admin.",
    grantPlaceholder: "coleg@firma.example",
    grant: "Deblochează",
    revoke: "Blochează",
    adminConfirm: "Sunt admin al acestei firme",
    sidebar: "Conexiuni",
    palette: "Deschide conexiunile (aplicațiile pe care le folosește asistentul)",
    usedByNone: "niciunul",
    storedNothing: "Zen Staff nu păstrează chei sau tokenuri pentru aceste conexiuni.",
  },
});
