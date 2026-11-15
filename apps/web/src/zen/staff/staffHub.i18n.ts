// Zen Staff hub v6: strings for AI staff that belongs to the company (kept on the hub, run by the
// company runner, copied to every colleague's app).
import { defineZenMessages } from "../i18n/zenI18n";

export const staffHubText = defineZenMessages({
  en: {
    publish: "Publish to the company",
    publishConfirm: (name: string) =>
      `Publish ${name} to the company? Everyone in the company sees ${name} and can give tasks. ${name} then works on the company server with the company's AI account, and the duties run there, even when this computer is off.`,
    published: (name: string) => `${name} now belongs to the company.`,
    badge: (version: number) => `Company · v${version}`,
    badgeHelp:
      "Kept on the hub for the whole company. Works on the company server; this copy follows the hub.",
    onRunner: "Runs on this computer (the company server).",
    copy: "Copy that follows the hub. Tasks go to the company server.",
    readOnly: "Only owners, admins and this employee's manager can change the profile.",
    deleteAdminOnly: "Only owners and admins can remove a company AI employee.",
    noTaskPermission:
      "Your role does not allow giving tasks to the company's AI staff (AI staff: create). Ask an owner or admin.",
    sentToRunner: (name: string) =>
      `The task went to the company server. ${name} starts it there; you will see the progress in the org chart.`,
    savedBy: (name: string, when: string) => `Last saved by ${name}, ${when}`,
    syncedAt: (when: string) => `Synced with the company ${when}.`,
    neverSynced: "Not synced with the company yet. It happens about once a minute.",
    refused: (count: number) =>
      count === 1
        ? "One change from the hub was not applied on this computer:"
        : `${count} changes from the hub were not applied on this computer:`,
    managerHint: "Pick a colleague from the company as manager. They can change this profile.",
    reasons: {
      "older than the version this machine has":
        "The hub offered an older version than the one here.",
      "the statement does not match the record":
        "The change on the hub does not match its signature.",
      "changed by someone who is not an owner, an admin or the agent's manager":
        "Changed by someone who may not change this employee.",
      "the signing device is gone": "The computer that signed the change was signed out.",
      "the signing device's key changed":
        "The keys of the computer that signed the change are different.",
      "the signing device is waiting for approval on this machine":
        "The computer that made the change waits for approval here (Team > Account).",
      "the signature is not valid": "The signature of the change is not valid.",
      "it was not sealed to this machine (saved before it became the company runner)":
        "It was saved before this computer became the company server. Save it again from any computer.",
      "the profile could not be opened on this machine":
        "The profile could not be opened on this computer.",
    } as Record<string, string>,
  },
  ro: {
    publish: "Publică pentru firmă",
    publishConfirm: (name: string) =>
      `Publici pe ${name} pentru firmă? Toți colegii îl văd și îi pot da sarcini. ${name} lucrează apoi pe serverul firmei, cu contul AI al firmei, iar sarcinile recurente rulează acolo, chiar dacă acest calculator e închis.`,
    published: (name: string) => `${name} e acum angajatul firmei.`,
    badge: (version: number) => `Al firmei · v${version}`,
    badgeHelp:
      "Păstrat în hub pentru toată firma. Lucrează pe serverul firmei; copia de aici urmează hub-ul.",
    onRunner: "Lucrează pe acest calculator (serverul firmei).",
    copy: "Copie care urmează hub-ul. Sarcinile pleacă la serverul firmei.",
    readOnly:
      "Doar proprietarii, administratorii și managerul acestui angajat îi pot schimba fișa.",
    deleteAdminOnly: "Doar proprietarii și administratorii pot concedia un angajat AI al firmei.",
    noTaskPermission:
      "Rolul tău nu permite sarcini pentru angajații AI ai firmei (Angajați AI: creează). Cere-i unui proprietar sau administrator.",
    sentToRunner: (name: string) =>
      `Sarcina a plecat la serverul firmei. ${name} o începe acolo; vezi cum merge în organigramă.`,
    savedBy: (name: string, when: string) => `Salvat ultima dată de ${name}, ${when}`,
    syncedAt: (when: string) => `Sincronizat cu firma la ${when}.`,
    neverSynced: "Încă nu s-a sincronizat cu firma. Se întâmplă cam o dată pe minut.",
    refused: (count: number) =>
      count === 1
        ? "O modificare din hub nu a fost aplicată pe acest calculator:"
        : `${count} modificări din hub nu au fost aplicate pe acest calculator:`,
    managerHint: "Alege ca manager un coleg din firmă. El poate schimba această fișă.",
    reasons: {
      "older than the version this machine has":
        "Hub-ul a oferit o versiune mai veche decât cea de aici.",
      "the statement does not match the record":
        "Modificarea din hub nu se potrivește cu semnătura ei.",
      "changed by someone who is not an owner, an admin or the agent's manager":
        "A fost schimbată de cineva care nu are voie să schimbe acest angajat.",
      "the signing device is gone": "Calculatorul care a semnat modificarea a fost deconectat.",
      "the signing device's key changed":
        "Cheile calculatorului care a semnat modificarea sunt altele.",
      "the signing device is waiting for approval on this machine":
        "Calculatorul care a făcut modificarea așteaptă aprobare aici (Echipă > Cont).",
      "the signature is not valid": "Semnătura modificării nu e validă.",
      "it was not sealed to this machine (saved before it became the company runner)":
        "A fost salvată înainte ca acest calculator să devină serverul firmei. Salvează fișa din nou, de pe orice calculator.",
      "the profile could not be opened on this machine":
        "Fișa nu a putut fi deschisă pe acest calculator.",
    } as Record<string, string>,
  },
});
