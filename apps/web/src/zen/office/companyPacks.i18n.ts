// Zen Staff hub v6: strings for packs installed for the whole company (marketplace).
import { defineZenMessages } from "../i18n/zenI18n";

export const companyPacksText = defineZenMessages({
  en: {
    installForCompany: "Install for the company",
    enterprise: "Enterprise",
    installForCompanyConfirm: (name: string, company: string) =>
      `Install "${name}" for everyone in ${company}? Each colleague's app gets it automatically within a minute.`,
    installedForCompanyToast: (name: string) =>
      `"${name}" is installed for the company. Colleagues get it on their next sync.`,
    installedForCompany: "Installed for the company",
    managedNote:
      "An admin installed this for the whole company. You can hide it, but you cannot uninstall it.",
    enterpriseNote: "Enterprise pack: it runs only on the company server, and its keys stay there.",
    hide: "Hide for me",
    show: "Show again",
    hiddenToast: (name: string) => `"${name}" is hidden for you. It stays installed.`,
    shownToast: (name: string) => `"${name}" is shown again.`,
    panelTitle: "Company packs",
    panelIntro: "What you installed for all colleagues, and how far it got on each computer.",
    nothingYet:
      'No pack is installed for the company yet. Use "Install for the company" on a card.',
    nobodyYet: "No computer has reported yet. The apps check about once a minute.",
    checkNow: "Check now",
    remove: "Remove from the company",
    removeConfirm: (name: string) =>
      `Remove "${name}" from the company? Colleagues keep it installed, and may uninstall it themselves.`,
    removedToast: (name: string) => `"${name}" is no longer installed for the company.`,
    by: (name: string, when: string) => `Installed by ${name}, ${when}`,
    columns: {
      person: "Colleague",
      machine: "Computer",
      state: "Status",
      version: "Version",
      updated: "Updated",
    },
    states: {
      installing: "Installing",
      installed: "Installed",
      failed: "Not installed",
      "runner-only": "Only on the company server",
    },
    companyServer: "company server",
    hiddenByPerson: "hidden by this person",
    olderVersion: (version: string, wanted: string) => `has ${version} (company: ${wanted})`,
    refused: (count: number) =>
      count === 1
        ? "1 company pack was refused on this computer because its approval could not be checked."
        : `${count} company packs were refused on this computer because their approval could not be checked.`,
  },
  ro: {
    installForCompany: "Instalează pentru firmă",
    enterprise: "Enterprise",
    installForCompanyConfirm: (name: string, company: string) =>
      `Instalezi „${name}” pentru toată echipa ${company}? Aplicația fiecărui coleg îl primește singură, în cel mult un minut.`,
    installedForCompanyToast: (name: string) =>
      `„${name}” e instalat pentru firmă. Colegii îl primesc la următoarea sincronizare.`,
    installedForCompany: "Instalat pentru firmă",
    managedNote:
      "Un administrator l-a instalat pentru toată firma. Îl poți ascunde, dar nu îl poți dezinstala.",
    enterpriseNote:
      "Pachet Enterprise: rulează doar pe serverul firmei, iar cheile lui rămân acolo.",
    hide: "Ascunde la mine",
    show: "Arată din nou",
    hiddenToast: (name: string) => `„${name}” e ascuns la tine. Rămâne instalat.`,
    shownToast: (name: string) => `„${name}” se vede din nou.`,
    panelTitle: "Pachetele firmei",
    panelIntro: "Ce ai instalat pentru toți colegii și cât a ajuns pe fiecare calculator.",
    nothingYet:
      "Încă nu e niciun pachet instalat pentru firmă. Folosește „Instalează pentru firmă” pe un card.",
    nobodyYet: "Niciun calculator nu a raportat încă. Aplicațiile verifică cam o dată pe minut.",
    checkNow: "Verifică acum",
    remove: "Scoate de la firmă",
    removeConfirm: (name: string) =>
      `Scoți „${name}” de la firmă? Colegii îl păstrează instalat și îl pot dezinstala singuri.`,
    removedToast: (name: string) => `„${name}” nu mai e instalat pentru firmă.`,
    by: (name: string, when: string) => `Instalat de ${name}, ${when}`,
    columns: {
      person: "Coleg",
      machine: "Calculator",
      state: "Stare",
      version: "Versiune",
      updated: "Actualizat",
    },
    states: {
      installing: "Se instalează",
      installed: "Instalat",
      failed: "Nu s-a instalat",
      "runner-only": "Doar pe serverul firmei",
    },
    companyServer: "serverul firmei",
    hiddenByPerson: "ascuns de acest coleg",
    olderVersion: (version: string, wanted: string) => `are ${version} (firma: ${wanted})`,
    refused: (count: number) =>
      count === 1
        ? "Un pachet al firmei a fost refuzat pe acest calculator, pentru că aprobarea lui nu a putut fi verificată."
        : `${count} pachete ale firmei au fost refuzate pe acest calculator, pentru că aprobarea lor nu a putut fi verificată.`,
  },
});
