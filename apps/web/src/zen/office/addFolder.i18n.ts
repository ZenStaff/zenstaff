// Zen Staff Office: "Adaugă un dosar" without the developer palette: a new folder for the current
// company, or a folder chosen from the computer; either one is attached to that company.
import { defineZenMessages } from "../i18n/zenI18n";

export const addFolderText = defineZenMessages({
  en: {
    title: (company: string) => `Add a folder to ${company}`,
    intro: "Your agents work and save their files in it.",
    personal: "your own work",
    newFolder: (company: string) => `New folder for ${company}`,
    newFolderBody: "Made in your Zen Staff folder, ready to use.",
    newFolderName: "Folder name",
    create: "Create the folder",
    pick: "Choose a folder from this computer",
    pickBody: "An existing folder, with your documents.",
    pickButton: "Choose…",
    pathLabel: "Folder path",
    pathPlaceholder: "e.g. /home/ana/Documents/Iris",
    add: "Add",
    working: "Adding the folder…",
    added: (folder: string, company: string) => `${folder} was added to ${company}.`,
    failed: "Could not add this folder. Check that it exists and try again.",
    close: "Close",
  },
  ro: {
    title: (company: string) => `Adaugă un dosar în ${company}`,
    intro: "Agenții tăi lucrează și își salvează fișierele în el.",
    personal: "munca ta",
    newFolder: (company: string) => `Dosar nou pentru ${company}`,
    newFolderBody: "Îl fac în dosarul tău Zen Staff, gata de folosit.",
    newFolderName: "Numele dosarului",
    create: "Fă dosarul",
    pick: "Alege un dosar de pe calculator",
    pickBody: "Un dosar care există deja, cu documentele tale.",
    pickButton: "Alege…",
    pathLabel: "Calea dosarului",
    pathPlaceholder: "ex. /home/ana/Documente/Iris",
    add: "Adaugă",
    working: "Adaug dosarul…",
    added: (folder: string, company: string) => `${folder} a fost adăugat în ${company}.`,
    failed: "Nu am putut adăuga dosarul. Verifică dacă există și încearcă din nou.",
    close: "Închide",
  },
});
