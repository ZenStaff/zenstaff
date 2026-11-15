// Zen Staff: the words of the "app did not start" screen (lib/bootError.ts), in Romanian or
// English. That screen draws itself before the app's i18n loads, so this table is plain data and
// the language comes from bootLocale(). Covered by errors.test.ts.

const en = {
  title: "Zen Staff did not start",
  offline: "This browser appears to be offline. Check the internet connection, then reload.",
  unknown: "We do not know why yet. Reload first; your files and chats are safe.",
  reload: "Reload",
  downloadUpdate: "Download the update",
  downloading: (percent: number) => `Downloading the update (${percent}%)`,
  restartToUpdate: "Restart to update",
  updateDownloadFailed: "The update could not be downloaded. Try again.",
  updateInstallFailed: "The update could not be installed. Try again.",
  copyBlocked: "Copying was blocked. The text is selected, so you can copy it yourself.",
  pressToCopy: (mac: boolean): string => (mac ? "Press ⌘C to copy" : "Press Ctrl+C to copy"),
  copied: "Copied",
  copiedAnnounce: "Copied to the clipboard.",
  details: "Technical details",
  reinstall: "Download and reinstall Zen Staff",
  reinstallNightly: "Download and reinstall the latest test build",
  triage: "For support: run this on the computer that runs Zen Staff, it checks the logs.",
  copyCommand: "Copy the command",
  privacy: "The details may include file and folder names. Check them before sending.",
  copyDetails: "Copy the details",
  report: "Send the report by e-mail",
  mailSubject: "Zen Staff did not start",
  mailIntro: "What I was doing when it happened:",
};

const ro: { readonly [K in keyof typeof en]: (typeof en)[K] } = {
  title: "Zen Staff nu a pornit",
  offline: "Browserul pare să nu aibă internet. Verifică conexiunea, apoi reîncarcă.",
  unknown: "Încă nu știm de ce. Reîncarcă întâi; fișierele și discuțiile tale sunt în siguranță.",
  reload: "Reîncarcă",
  downloadUpdate: "Descarcă actualizarea",
  downloading: (percent) => `Se descarcă actualizarea (${percent}%)`,
  restartToUpdate: "Repornește ca să actualizezi",
  updateDownloadFailed: "Actualizarea nu s-a putut descărca. Încearcă din nou.",
  updateInstallFailed: "Actualizarea nu s-a putut instala. Încearcă din nou.",
  copyBlocked: "Copierea a fost blocată. Textul e selectat, îl poți copia tu.",
  pressToCopy: (mac) => (mac ? "Apasă ⌘C ca să copiezi" : "Apasă Ctrl+C ca să copiezi"),
  copied: "Copiat",
  copiedAnnounce: "Copiat în clipboard.",
  details: "Detalii tehnice",
  reinstall: "Descarcă și reinstalează Zen Staff",
  reinstallNightly: "Descarcă și reinstalează ultima versiune de test",
  triage:
    "Pentru suport: rulează asta pe calculatorul pe care merge Zen Staff, verifică jurnalele.",
  copyCommand: "Copiază comanda",
  privacy: "Detaliile pot conține nume de fișiere și dosare. Verifică-le înainte să le trimiți.",
  copyDetails: "Copiază detaliile",
  report: "Trimite raportul pe e-mail",
  mailSubject: "Zen Staff nu a pornit",
  mailIntro: "Ce făceam când s-a întâmplat:",
};

export const BOOT_ERROR_TEXT = { en, ro } as const;
export type BootErrorText = typeof en;
