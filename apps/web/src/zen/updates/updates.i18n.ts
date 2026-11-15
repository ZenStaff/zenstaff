// Zen Staff: strings of our own app updates (Settings > Updates, the restart prompt, the sidebar
// update button's idle tooltip). ZEN.md, "Updates and telemetry".
import { defineZenMessages } from "../i18n/zenI18n";

export const updatesText = defineZenMessages({
  en: {
    section: "Updates",
    channelTitle: "Update channel",
    channelDescription: "Stable gets tested releases. Beta gets new versions first.",
    channelPinned: "Your administrator keeps this computer on Stable.",
    stable: "Stable",
    beta: "Beta",
    versionTitle: "Current version",
    lastCheck: (when: string) => `Last check: ${when}.`,
    neverChecked: "Not checked yet.",
    checkNow: "Check now",
    checking: "Checking...",
    upToDate: "Zen Staff is up to date.",
    available: (version: string) => `Version ${version} is available.`,
    downloading: (version: string, percent: number | null) =>
      `Downloading version ${version}${percent === null ? "" : ` (${Math.floor(percent)}%)`}...`,
    downloaded: (version: string) =>
      `Version ${version} is downloaded and installs when you close Zen Staff.`,
    failed: "The last update check failed. Try again later.",
    manual: (version: string) =>
      `Version ${version} is available. This package (.deb/.rpm) cannot update itself.`,
    downloadNew: "Download the new version",
    off: "Automatic updates are not available for this install.",
    promptTitle: (version: string) => `New version ${version} available`,
    promptBody: "Restart to install it",
    restartNow: "Restart now",
    installOnClose: "Install on close",
    idleTitle: "Updates",
    idleDetail: (version: string, channel: string, when: string | null) =>
      `${version}, ${channel} channel${when ? `, checked ${when}` : ""}.`,
    couldNotSwitch: "Could not switch the update channel.",
    couldNotCheck: "Could not check for updates.",
  },
  ro: {
    section: "Actualizări",
    channelTitle: "Canal de actualizări",
    channelDescription: "Stabil primește versiunile testate. Beta primește versiunile noi primul.",
    channelPinned: "Administratorul ține acest calculator pe Stabil.",
    stable: "Stabil",
    beta: "Beta",
    versionTitle: "Versiunea curentă",
    lastCheck: (when: string) => `Ultima verificare: ${when}.`,
    neverChecked: "Nu s-a verificat încă.",
    checkNow: "Caută acum",
    checking: "Caut...",
    upToDate: "Zen Staff e la zi.",
    available: (version: string) => `Versiunea ${version} e disponibilă.`,
    downloading: (version: string, percent: number | null) =>
      `Se descarcă versiunea ${version}${percent === null ? "" : ` (${Math.floor(percent)}%)`}...`,
    downloaded: (version: string) =>
      `Versiunea ${version} e descărcată și se instalează când închizi Zen Staff.`,
    failed: "Ultima căutare de actualizări a eșuat. Încearcă mai târziu.",
    manual: (version: string) =>
      `Versiunea ${version} e disponibilă. Pachetul acesta (.deb/.rpm) nu se poate actualiza singur.`,
    downloadNew: "Descarcă versiunea nouă",
    off: "Actualizările automate nu sunt disponibile pentru această instalare.",
    promptTitle: (version: string) => `Versiune nouă ${version} disponibilă`,
    promptBody: "Repornește ca s-o instalezi",
    restartNow: "Repornește acum",
    installOnClose: "Instalează la închidere",
    idleTitle: "Actualizări",
    idleDetail: (version: string, channel: string, when: string | null) =>
      `${version}, canal ${channel}${when ? `, verificat ${when}` : ""}.`,
    couldNotSwitch: "Nu am putut schimba canalul de actualizări.",
    couldNotCheck: "Nu am putut căuta actualizări.",
  },
});
