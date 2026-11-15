// Zen Staff: the toolchain and access strings (Preparing step, badges, marketplace, Settings).
import type { ZenAccessLock, ZenToolchainStatus } from "@t3tools/contracts/zenToolchains";

import { defineZenMessages } from "../i18n/zenI18n";

type ToolchainsMessages = {
  readonly status: Record<ZenToolchainStatus, string>;
  readonly checkingTitle: string;
  readonly checkingBody: (name: string) => string;
  readonly oneMoment: string;
  readonly errorTitle: string;
  readonly updatingTitle: string;
  readonly preparingTitle: string;
  readonly notCompatibleTitle: string;
  readonly slowTitle: string;
  readonly setupTitle: string;
  readonly lockedTitle: string;
  readonly willSetUp: string;
  readonly safetyUpdate: string;
  readonly untested: string;
  readonly totals: (download: string, time: string, disk: string) => string;
  readonly expect: (estimate: string) => string;
  readonly licenseNotes: string;
  readonly readLicense: string;
  readonly otherFree: string;
  readonly safetyServer: (tools: string, server: string) => string;
  readonly otherWays: string;
  readonly askAdminConnector: string;
  readonly useThis: string;
  readonly usingLighter: string;
  readonly backToFull: string;
  readonly details: string;
  readonly setupSuffix: string;
  readonly cancelSetup: string;
  readonly close: string;
  readonly cancel: string;
  readonly runOn: (server: string) => string;
  readonly install: string;
  readonly tryAgain: string;
  readonly continueHere: string;
  readonly step: Record<
    "waiting" | "downloading" | "installing" | "verifying" | "done" | "failed" | "cancelled",
    string
  >;
  readonly of: (done: string, total: string) => string;
  readonly progress: string;
  readonly why: string;
  readonly lock: Record<ZenAccessLock["code"], string>;
  readonly serverOffer: string;
  readonly needs: string;
  readonly oneTimeSetup: (download: string) => string;
  readonly tier: { readonly standard: string; readonly enterprise: string; readonly beta: string };
  readonly enterpriseHint: string;
  readonly showBeta: string;
  readonly approveTitle: string;
  readonly approveBody: (name: string) => string;
  readonly approveCheck: string;
  readonly approveButton: string;
  readonly secretsNeeded: string;
  readonly readOnly: string;
  readonly canChange: string;
  readonly requirements: string;
  readonly systemTool: (name: string, version: string) => string;
  readonly systemNote: string;
  readonly useZenVersion: string;
  readonly continue: string;
};

const en: ToolchainsMessages = {
  status: {
    ready: "Ready",
    slow: "Slow here",
    "needs-install": "Setup needed",
    updating: "Setup needed",
    "not-compatible": "Not supported here",
  },
  checkingTitle: "Checking this computer",
  checkingBody: (name) => `Making sure ${name} has what it needs.`,
  oneMoment: "One moment...",
  errorTitle: "Setup could not start",
  updatingTitle: "Updating for safety",
  preparingTitle: "Preparing",
  notCompatibleTitle: "This computer cannot run this task",
  slowTitle: "This will be slow on this computer",
  setupTitle: "Preparing: one-time setup",
  lockedTitle: "This workflow is locked",
  willSetUp: "Zen Staff will set up, once, for this and other tasks:",
  safetyUpdate: " (safety update)",
  untested: "Not yet tested on this kind of computer.",
  totals: (download, time, disk) =>
    `${download} to download, ${time}, ${disk} on disk. Nothing else on this computer changes.`,
  expect: (estimate) => `Expect ${estimate}. You can keep working meanwhile.`,
  licenseNotes: "License notes",
  readLicense: "Read the license",
  otherFree: "The other tools are free for business use.",
  safetyServer: (tools, server) =>
    `${tools} open files from outside (videos, web pages, documents). For safety, running on ${server} is recommended.`,
  otherWays: "Other ways to do it",
  askAdminConnector: " Ask your administrator to connect it first.",
  useThis: "Use this",
  usingLighter: "Using the lighter version.",
  backToFull: "Back to the full version",
  details: "Details",
  setupSuffix: "setup",
  cancelSetup: "Cancel setup",
  close: "Close",
  cancel: "Cancel",
  runOn: (server) => `Run on ${server}`,
  install: "Install",
  tryAgain: "Try again",
  continueHere: "Continue here",
  step: {
    waiting: "Waiting",
    downloading: "Downloading",
    installing: "Installing",
    verifying: "Checking that it works",
    done: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  of: (done, total) => `${done} of ${total}`,
  progress: "Setup progress",
  why: "Why",
  lock: {
    "needs-grant": "Ask an admin to unlock this workflow for you.",
    "needs-runner": "Your company needs a server for Enterprise workflows.",
    "needs-secret": "A company key for this workflow is missing on the server. Ask an admin.",
    invalid: "This workflow is not valid and cannot run.",
  },
  serverOffer: "About the always-on company server",
  needs: "Needs:",
  oneTimeSetup: (download) => `One-time setup on this computer: ${download} download.`,
  tier: { standard: "Standard", enterprise: "Enterprise", beta: "Beta" },
  enterpriseHint: "Needs admin approval and stronger security",
  showBeta: "Show beta",
  approveTitle: "Admin approval",
  approveBody: (name) =>
    `"${name}" is an Enterprise workflow: it uses company accounts or keys. A company admin must approve it before it is installed.`,
  approveCheck: "I am a company admin and I approve this workflow for our company.",
  approveButton: "Approve and install",
  secretsNeeded: "Company keys it uses:",
  readOnly: "read only",
  canChange: "can change data",
  requirements: "Requirements",
  systemTool: (name, version) => `Using ${name} ${version} already installed on this computer.`,
  systemNote:
    "Programs already on the computer are not checksum-checked by Zen. Choose the Zen version if you want the pinned one.",
  useZenVersion: "Use the Zen version",
  continue: "Continue",
};

const ro: ToolchainsMessages = {
  status: {
    ready: "Gata",
    slow: "Lent aici",
    "needs-install": "Necesită pregătire",
    updating: "Necesită pregătire",
    "not-compatible": "Nu merge aici",
  },
  checkingTitle: "Verificăm acest calculator",
  checkingBody: (name) => `Ne asigurăm că ${name} are tot ce îi trebuie.`,
  oneMoment: "O clipă...",
  errorTitle: "Pregătirea nu a putut porni",
  updatingTitle: "Actualizare de siguranță",
  preparingTitle: "Pregătire",
  notCompatibleTitle: "Acest calculator nu poate face această sarcină",
  slowTitle: "Pe acest calculator va merge încet",
  setupTitle: "Pregătire: o singură dată",
  lockedTitle: "Acest flux de lucru este blocat",
  willSetUp: "Zen Staff instalează, o singură dată, pentru aceasta și alte sarcini:",
  safetyUpdate: " (actualizare de siguranță)",
  untested: "Încă netestat pe acest tip de calculator.",
  totals: (download, time, disk) =>
    `${download} de descărcat, ${time}, ${disk} pe disc. Altceva nu se schimbă pe acest calculator.`,
  expect: (estimate) => `Durează ${estimate}. Poți lucra în continuare între timp.`,
  licenseNotes: "Despre licențe",
  readLicense: "Citește licența",
  otherFree: "Celelalte unelte sunt gratuite și pentru firme.",
  safetyServer: (tools, server) =>
    `${tools} deschid fișiere din afară (video, pagini web, documente). Pentru siguranță, recomandăm rularea pe ${server}.`,
  otherWays: "Alte variante",
  askAdminConnector: " Cere administratorului să îl conecteze întâi.",
  useThis: "Folosește",
  usingLighter: "Folosești varianta mai ușoară.",
  backToFull: "Înapoi la varianta completă",
  details: "Detalii",
  setupSuffix: "instalare",
  cancelSetup: "Oprește pregătirea",
  close: "Închide",
  cancel: "Renunță",
  runOn: (server) => `Rulează pe ${server}`,
  install: "Instalează",
  tryAgain: "Încearcă din nou",
  continueHere: "Continuă aici",
  step: {
    waiting: "În așteptare",
    downloading: "Se descarcă",
    installing: "Se instalează",
    verifying: "Verificăm că merge",
    done: "Gata",
    failed: "Nu a reușit",
    cancelled: "Oprit",
  },
  of: (done, total) => `${done} din ${total}`,
  progress: "Progresul pregătirii",
  why: "De ce",
  lock: {
    "needs-grant": "Cere unui administrator să deblocheze acest flux de lucru pentru tine.",
    "needs-runner": "Firma ta are nevoie de un server pentru fluxurile Enterprise.",
    "needs-secret":
      "Lipsește o cheie a firmei pe server pentru acest flux. Cere unui administrator.",
    invalid: "Acest flux de lucru nu este valid și nu poate rula.",
  },
  serverOffer: "Despre serverul firmei, pornit mereu",
  needs: "Necesită:",
  oneTimeSetup: (download) =>
    `Pregătire o singură dată pe acest calculator: ${download} de descărcat.`,
  tier: { standard: "Standard", enterprise: "Enterprise", beta: "Beta" },
  enterpriseHint: "necesită aprobare admin și securitate sporită",
  showBeta: "Arată beta",
  approveTitle: "Aprobare administrator",
  approveBody: (name) =>
    `„${name}” este un flux Enterprise: folosește conturi sau chei ale firmei. Un administrator al firmei trebuie să îl aprobe înainte de instalare.`,
  approveCheck: "Sunt administrator al firmei și aprob acest flux de lucru pentru firma noastră.",
  approveButton: "Aprobă și instalează",
  secretsNeeded: "Chei ale firmei folosite:",
  readOnly: "doar citire",
  canChange: "poate modifica date",
  requirements: "Ce îi trebuie",
  systemTool: (name, version) => `Folosesc ${name} ${version} deja instalat pe calculator.`,
  systemNote:
    "Programele de pe calculator nu sunt verificate de Zen prin sumă de control. Alege versiunea Zen dacă vrei varianta fixată.",
  useZenVersion: "Folosește versiunea Zen",
  continue: "Continuă",
};

export const toolchainsText = defineZenMessages<ToolchainsMessages>({ en, ro });
