// Zen Staff: strings for customized packs ("Personalizează", review, updates). ZEN.md,
// "Customized packs".
import { defineZenMessages } from "../i18n/zenI18n";

const en = {
  customize: "Customize",
  customizeNamed: (name: string) => `Customize ${name}`,
  customizeTitle: (name: string) => `Customize "${name}"`,
  customizeIntro:
    "Packs are templates: make them yours. A copy is changed by the assistant from what you write, checked, and shown to you before anyone uses it. The original stays, so you can go back any time.",
  whatToChange: "What should change?",
  whatToChangePlaceholder:
    "For example: in the reels I want a voice-over and the music quieter. Or: put our logo and colors in the offer.",
  forWhom: "Who uses the changed version",
  forMe: "Only me",
  forCompany: (company: string) => `Everyone in ${company}`,
  startCustomizing: "Start customizing",
  starting: "Starting...",
  cancel: "Cancel",
  noFolder: "Add a folder in the sidebar first: the assistant needs one to start the chat.",
  badgeCustomized: "Customized",
  badgeCompanyCopy: "Company version",
  badgeDraft: "Being changed",
  sectionTitle: "Your customized packs",
  sectionIntro:
    "Copies of packs changed for you or your company. They are used instead of the originals.",
  scopeMine: "Only for you",
  scopeCompany: "For the whole company",
  basedOn: (version: string) => `based on version ${version}`,
  revision: (count: number) => (count === 1 ? "1 saved change" : `${count} saved changes`),
  review: "Review and save",
  continueChat: "Change more",
  backToOriginal: "Back to the original",
  backToOriginalConfirm: (name: string) =>
    `Go back to the original "${name}"? Your customized copy is kept aside as a backup.`,
  shareWithCompany: (company: string) => `Use it for all of ${company}`,
  shared: (company: string) => `Everyone in ${company} now uses this version.`,
  reverted: (name: string) => `"${name}" is back to the original.`,
  reviewTitle: (name: string) => `Review the changes to "${name}"`,
  reviewIntro:
    "This is what changed compared with the version in use. Nothing is used until you save it.",
  filesChanged: (count: number) => (count === 1 ? "1 file changed" : `${count} files changed`),
  changeAdded: "added",
  changeRemoved: "removed",
  changeChanged: "changed",
  changeConflict: "to resolve",
  checksPassed: "Checks passed",
  checksFailed: "Checks failed",
  checksMissing: "The checks have not run yet. Ask the assistant to check the pack.",
  blockedBecause: "Not ready to save yet:",
  diffTruncated: "The list of changes is long; only the start is shown.",
  showDiff: "Show the exact changes",
  saveMine: "Save my version",
  discardDraft: "Discard the draft",
  discarded: "The draft was discarded.",
  saved: (name: string) => `Your version of "${name}" is now in use.`,
  loadingReview: "Loading the changes...",
  updateAvailable: (version: string) => `Version ${version} is available`,
  updateTitle: (name: string, version: string) => `New version ${version} of "${name}"`,
  updateIntro:
    "We improved the original this copy was made from. Choose what happens to your version.",
  keepMine: "Keep mine",
  keepMineHelp: "Stay on your version; this update is not offered again.",
  takeNew: "Take the new one",
  takeNewHelp: "Use the new original; your changes are kept aside as a backup.",
  merge: "Combine both",
  mergeHelp:
    "The assistant puts your changes on top of the new version, checks it and shows you the difference before you save.",
  keptMine: "You keep your version.",
  tookNew: (name: string) => `"${name}" now uses the new version.`,
  updatePack: (version: string) => `Update to ${version}`,
  chatCardTitle: (name: string) => `Keep this change in "${name}"?`,
  chatCardBody:
    "I can make a copy of the pack with this change, check it, and show it to you before it is used every time.",
  chatCardAction: "Customize the pack",
  notNow: "Not now",
  failed: "That did not work.",
};

type Messages = {
  readonly [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : string;
};

const ro: Messages = {
  customize: "Personalizează",
  customizeNamed: (name) => `Personalizează ${name}`,
  customizeTitle: (name) => `Personalizează „${name}”`,
  customizeIntro:
    "Pachetele sunt șabloane: fă-le ale voastre. Asistentul schimbă o copie după ce îi scrii, o verifică și ți-o arată înainte să o folosească cineva. Originalul rămâne, poți reveni oricând.",
  whatToChange: "Ce vrei să schimbi?",
  whatToChangePlaceholder:
    "De exemplu: la reels vreau voce și muzica mai încet. Sau: pune logo-ul și culorile noastre în ofertă.",
  forWhom: "Cine folosește varianta schimbată",
  forMe: "Doar eu",
  forCompany: (company) => `Toată echipa ${company}`,
  startCustomizing: "Începe personalizarea",
  starting: "Pornesc...",
  cancel: "Renunță",
  noFolder:
    "Adaugă mai întâi un dosar din bara laterală: asistentul are nevoie de unul ca să pornească discuția.",
  badgeCustomized: "Personalizat",
  badgeCompanyCopy: "Varianta firmei",
  badgeDraft: "În lucru",
  sectionTitle: "Pachetele voastre personalizate",
  sectionIntro:
    "Copii ale pachetelor schimbate pentru tine sau pentru firmă. Se folosesc în locul originalelor.",
  scopeMine: "Doar pentru tine",
  scopeCompany: "Pentru toată firma",
  basedOn: (version) => `pornită de la versiunea ${version}`,
  revision: (count) => (count === 1 ? "o schimbare salvată" : `${count} schimbări salvate`),
  review: "Verifică și salvează",
  continueChat: "Mai schimbă",
  backToOriginal: "Înapoi la original",
  backToOriginalConfirm: (name) =>
    `Revii la originalul „${name}”? Copia personalizată rămâne păstrată deoparte.`,
  shareWithCompany: (company) => `Folosește-o pentru toată echipa ${company}`,
  shared: (company) => `Toată echipa ${company} folosește acum această variantă.`,
  reverted: (name) => `„${name}” a revenit la original.`,
  reviewTitle: (name) => `Verifică schimbările din „${name}”`,
  reviewIntro:
    "Asta s-a schimbat față de varianta folosită acum. Nu se folosește nimic până nu salvezi.",
  filesChanged: (count) => (count === 1 ? "un fișier schimbat" : `${count} fișiere schimbate`),
  changeAdded: "adăugat",
  changeRemoved: "scos",
  changeChanged: "schimbat",
  changeConflict: "de rezolvat",
  checksPassed: "Verificările au trecut",
  checksFailed: "Verificările nu au trecut",
  checksMissing: "Verificările nu au rulat încă. Cere-i asistentului să verifice pachetul.",
  blockedBecause: "Încă nu se poate salva:",
  diffTruncated: "Lista schimbărilor e lungă; se vede doar începutul.",
  showDiff: "Arată schimbările exacte",
  saveMine: "Salvează versiunea mea",
  discardDraft: "Renunță la ciornă",
  discarded: "Ciorna a fost ștearsă.",
  saved: (name) => `Varianta ta de „${name}” e acum cea folosită.`,
  loadingReview: "Încarc schimbările...",
  updateAvailable: (version) => `E disponibilă versiunea ${version}`,
  updateTitle: (name, version) => `Versiune nouă ${version} pentru „${name}”`,
  updateIntro:
    "Am îmbunătățit originalul de la care ai pornit. Alege ce se întâmplă cu varianta ta.",
  keepMine: "Păstrează-o pe a mea",
  keepMineHelp: "Rămâi la varianta ta; această versiune nu mai e propusă.",
  takeNew: "Ia versiunea nouă",
  takeNewHelp: "Folosești noul original; schimbările tale rămân păstrate deoparte.",
  merge: "Combină-le",
  mergeHelp:
    "Asistentul pune schimbările tale peste versiunea nouă, o verifică și îți arată diferența înainte să salvezi.",
  keptMine: "Rămâi la varianta ta.",
  tookNew: (name) => `„${name}” folosește acum versiunea nouă.`,
  updatePack: (version) => `Actualizează la ${version}`,
  chatCardTitle: (name) => `Păstrez schimbarea în „${name}”?`,
  chatCardBody:
    "Pot face o copie a pachetului cu schimbarea asta, o verific și ți-o arăt înainte să se folosească de fiecare dată.",
  chatCardAction: "Personalizează pachetul",
  notNow: "Nu acum",
  failed: "Nu a mers.",
};

export const customPacksText = defineZenMessages({ en, ro });
