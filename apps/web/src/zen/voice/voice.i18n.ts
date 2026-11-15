// Zen Staff: strings of the simple voice setup dialog (ZEN.md, "Voice input").
import { defineZenMessages } from "../i18n/zenI18n";

export const voiceMessages = defineZenMessages({
  en: {
    title: "Voice dictation",
    description:
      "Speak instead of typing. Your words appear in the message box so you can check them before sending.",
    languageLabel: "Language",
    languageHeading: "Language you speak",
    languages: { auto: "Auto-detect", ro: "Română", en: "English" },
    qualityLabel: "Quality",
    sizes: {
      tiny: {
        label: "Fast",
        detail: "Whisper Tiny. Smallest download, good for English, weak for Romanian.",
      },
      base: {
        label: "Balanced",
        detail: "Whisper Base. Good for English, makes mistakes in Romanian.",
      },
      small: {
        label: "Accurate",
        detail: "Whisper Small. Better Romanian, slower on older computers.",
      },
      best: {
        label: "Best for Romanian",
        detail: "Parakeet v3. Most accurate for Romanian and English, larger download.",
      },
    },
    installed: "Installed",
    megabytes: (count: number) => `${count} MB`,
    recommended: "Recommended",
    unsupported: (reason: string) => `This computer cannot run a speech model: ${reason}`,
    unsupportedBrowserHint: " You can use the browser's speech recognition instead.",
    howToTalk: "How to talk",
    toggleTitle: "Click to start, click to stop",
    toggleDetail: (shortcut: string) =>
      `Press the microphone or ${shortcut} once to start and again to finish.`,
    holdTitle: "Hold to talk",
    holdDetail: (shortcut: string) =>
      `Hold ${shortcut} while you speak; release to finish. The microphone button still works with clicks.`,
    whereLocal: "Runs on this computer. Your voice never leaves it.",
    whereRemote: (label: string) => `Runs on ${label}. Your voice goes only to that computer.`,
    yourComputer: "your Zen computer",
    cloudOff: "Cloud transcription is off; you can turn it on under More options.",
    progressLabel: "Speech model download progress",
    verifying: "Checking the download…",
    startingDownload: (megabytes: number) => `Starting the ${megabytes} MB download…`,
    downloading: (label: string, percent: number) => `Downloading ${label} model: ${percent}%`,
    useBrowser: "Use the browser's speech recognition instead",
    useBrowserNote:
      ". No download, but Chrome and Edge send your voice to Google or Microsoft to recognize it.",
    moreOptions: "More options",
    cancelDownload: "Cancel download",
    notNow: "Not now",
    downloadingButton: "Downloading…",
    startDictating: "Start dictating",
    downloadAndStart: (megabytes: number) => `Download (${megabytes} MB) and start`,
    askAdmin: "Ask an admin to download",
    errorUnreachable: "Could not reach the computer that transcribes. Check the connection.",
    errorDownload: "The download did not finish. Check the internet connection and try again.",
    errorSwitch: "The model is ready, but it could not be switched on. Try again.",
  },
  ro: {
    title: "Dictare vocală",
    description:
      "Vorbește în loc să scrii. Cuvintele apar în caseta de mesaj, ca să le verifici înainte să trimiți.",
    languageLabel: "Limba",
    languageHeading: "Limba în care vorbești",
    languages: { auto: "Automat", ro: "Română", en: "English" },
    qualityLabel: "Calitate",
    sizes: {
      tiny: {
        label: "Rapid",
        detail: "Whisper Tiny. Cea mai mică descărcare, bun pentru engleză, slab pentru română.",
      },
      base: {
        label: "Echilibrat",
        detail: "Whisper Base. Bun pentru engleză, greșește în română.",
      },
      small: {
        label: "Precis",
        detail: "Whisper Small. Română mai bună, mai lent pe calculatoare mai vechi.",
      },
      best: {
        label: "Cel mai bun pentru română",
        detail: "Parakeet v3. Cel mai precis pentru română și engleză, descărcare mai mare.",
      },
    },
    installed: "Instalat",
    megabytes: (count: number) => `${count} MB`,
    recommended: "Recomandat",
    unsupported: (reason: string) =>
      `Acest calculator nu poate rula un model de vorbire: ${reason}`,
    unsupportedBrowserHint: " Poți folosi în schimb recunoașterea vocală a browserului.",
    howToTalk: "Cum vorbești",
    toggleTitle: "Apeși ca să începi, apeși ca să termini",
    toggleDetail: (shortcut: string) =>
      `Apasă microfonul sau ${shortcut} o dată ca să începi și încă o dată ca să termini.`,
    holdTitle: "Ții apăsat cât vorbești",
    holdDetail: (shortcut: string) =>
      `Ține apăsat ${shortcut} cât vorbești; dă drumul ca să termini. Butonul microfonului merge în continuare cu clic.`,
    whereLocal: "Rulează pe acest calculator. Vocea ta nu pleacă de pe el.",
    whereRemote: (label: string) => `Rulează pe ${label}. Vocea ta ajunge doar la acel calculator.`,
    yourComputer: "calculatorul tău Zen",
    cloudOff: "Transcrierea în cloud e oprită; o poți porni din Mai multe opțiuni.",
    progressLabel: "Progresul descărcării modelului de vorbire",
    verifying: "Verific descărcarea…",
    startingDownload: (megabytes: number) => `Încep descărcarea de ${megabytes} MB…`,
    downloading: (label: string, percent: number) => `Descarc modelul ${label}: ${percent}%`,
    useBrowser: "Folosește în schimb recunoașterea vocală a browserului",
    useBrowserNote:
      ". Nu descarci nimic, dar Chrome și Edge trimit vocea ta la Google sau Microsoft ca să o recunoască.",
    moreOptions: "Mai multe opțiuni",
    cancelDownload: "Oprește descărcarea",
    notNow: "Nu acum",
    downloadingButton: "Descarc…",
    startDictating: "Începe dictarea",
    downloadAndStart: (megabytes: number) => `Descarcă (${megabytes} MB) și începe`,
    askAdmin: "Roagă un administrator să descarce",
    errorUnreachable: "Nu am putut ajunge la calculatorul care transcrie. Verifică conexiunea.",
    errorDownload: "Descărcarea nu s-a terminat. Verifică internetul și încearcă din nou.",
    errorSwitch: "Modelul e gata, dar nu a putut fi pornit. Încearcă din nou.",
  },
});
