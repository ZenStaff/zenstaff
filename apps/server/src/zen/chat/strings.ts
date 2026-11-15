// Zen Staff chat integrations: what the bot itself says in chat, in English and Romanian (the
// connection's language setting). Agents answer in the language they are written to.
export type ChatLanguage = "en" | "ro";

const en = {
  working: "_Working on it..._",
  unknownPerson:
    "I don't know who you are in the company yet. Ask an admin to link your account in Zen Staff > Chat integrations.",
  guest: "Guests can read but not give tasks to the company's AI staff.",
  personalUnavailable:
    "This personal assistant is unavailable: it only runs on its owner's own computer, which is offline right now.",
  personalNotOwner: "A personal assistant only works for its owner, in a direct message.",
  noAgent: "No AI staff member is assigned to this channel yet. Ask an admin to bind one.",
  needsRunner:
    "Company AI staff only run on the company's always-on server, and this bot is not connected there.",
  rateLimited: "Too many messages at once. Wait a minute and try again.",
  help: "Mention me with a task, or use `/zen <task>`. `/zen status` shows what I'm working on here.",
  status: (agent: string, running: number, approvals: number) =>
    `**${agent}** answers here. Working on ${running} conversation(s); ${approvals} approval(s) waiting.`,
  statusNone: "No AI staff member is assigned to this channel.",
  approvalTitle: (agent: string) => `**${agent}** wants to do something that needs your approval`,
  approvalAsked: (who: string, where: string) => `Asked by ${who} in ${where}.`,
  approvalOnlyManager: (manager: string) =>
    `Only ${manager} can approve it, in Zen Staff (To approve).`,
  approveInApp: "You have something to approve in Zen Staff: open To approve in the app.",
  approvalWaiting: (manager: string) => `Waiting for approval from ${manager}.`,
  approve: "Approve",
  decline: "Decline",
  approved: (who: string) => `Approved by ${who}.`,
  declined: (who: string) => `Declined by ${who}.`,
  approvalGone: "This request is no longer waiting for an answer.",
  notAllowedToApprove: (manager: string) => `Only ${manager} can answer this request.`,
  fileTooLarge: (name: string, limitMb: number) =>
    `${name} was not read: files over ${limitMb} MB are skipped.`,
  fileFailed: (name: string) => `${name} could not be downloaded.`,
  runFailed: "Something went wrong while working on this. Try again, or ask in Zen Staff.",
  reportHeader: (name: string) => `**${name}**`,
  stopped: "Stopped.",
};

type Strings = typeof en;

const ro: Strings = {
  working: "_Lucrez la asta..._",
  unknownPerson:
    "Încă nu știu cine ești în companie. Cere unui administrator să-ți lege contul în Zen Staff > Integrări chat.",
  guest: "Invitații pot citi, dar nu pot da sarcini angajaților AI ai companiei.",
  personalUnavailable:
    "Acest asistent personal nu este disponibil: rulează doar pe calculatorul proprietarului, care acum e offline.",
  personalNotOwner: "Un asistent personal lucrează doar pentru proprietarul lui, în mesaj direct.",
  noAgent: "Niciun angajat AI nu e alocat acestui canal. Cere unui administrator să aloce unul.",
  needsRunner:
    "Angajații AI ai companiei rulează doar pe serverul permanent al companiei, iar acest bot nu e conectat acolo.",
  rateLimited: "Prea multe mesaje deodată. Așteaptă un minut și încearcă din nou.",
  help: "Menționează-mă cu o sarcină sau folosește `/zen <sarcină>`. `/zen status` arată la ce lucrez aici.",
  status: (agent: string, running: number, approvals: number) =>
    `**${agent}** răspunde aici. Lucrez la ${running} conversații; ${approvals} aprobări în așteptare.`,
  statusNone: "Niciun angajat AI nu e alocat acestui canal.",
  approvalTitle: (agent: string) =>
    `**${agent}** vrea să facă ceva care are nevoie de aprobarea ta`,
  approvalAsked: (who: string, where: string) => `Cerut de ${who} în ${where}.`,
  approvalOnlyManager: (manager: string) =>
    `Doar ${manager} poate aproba, în Zen Staff („De aprobat”).`,
  approveInApp: "Ai ceva de aprobat în Zen Staff: deschide „De aprobat” în aplicație.",
  approvalWaiting: (manager: string) => `Aștept aprobarea de la ${manager}.`,
  approve: "Aprob",
  decline: "Refuz",
  approved: (who: string) => `Aprobat de ${who}.`,
  declined: (who: string) => `Refuzat de ${who}.`,
  approvalGone: "Această cerere nu mai așteaptă răspuns.",
  notAllowedToApprove: (manager: string) => `Doar ${manager} poate răspunde la această cerere.`,
  fileTooLarge: (name: string, limitMb: number) =>
    `${name} nu a fost citit: fișierele de peste ${limitMb} MB sunt sărite.`,
  fileFailed: (name: string) => `${name} nu a putut fi descărcat.`,
  runFailed: "Ceva n-a mers cât am lucrat la asta. Încearcă din nou sau întreabă în Zen Staff.",
  reportHeader: (name: string) => `**${name}**`,
  stopped: "Oprit.",
};

export function chatStrings(language: string | undefined): Strings {
  return language === "ro" ? ro : en;
}
