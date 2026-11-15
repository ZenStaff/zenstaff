// Zen Staff: the plain sentences the compatibility check returns, in English and Romanian (the
// languages of the web layer, zen/i18n). Technical details stay in English.
export type ZenToolchainLocale = "en" | "ro";

const OS = {
  en: { linux: "Linux", windows: "Windows", macos: "macOS", other: "this system" },
  ro: { linux: "Linux", windows: "Windows", macos: "macOS", other: "acest sistem" },
} as const;
const ARCH = {
  en: { x64: "Intel/AMD (x64)", arm64: "ARM", other: "this" },
  ro: { x64: "Intel/AMD (x64)", arm64: "ARM", other: "acest tip de" },
} as const;

const gbText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} GB`;

/** A catalog tool's name in the person's language. */
export function toolName(
  entry: { readonly name: string; readonly nameRo?: string | undefined },
  locale: ZenToolchainLocale | undefined,
): string {
  return locale === "ro" && entry.nameRo ? entry.nameRo : entry.name;
}

/** "1.2 GB" -> "1,2 GB" in Romanian. */
const localBytes = (locale: ZenToolchainLocale, text: string) =>
  locale === "ro" ? text.replace(/(\d)\.(\d)/g, "$1,$2") : text;

type Purpose = "video" | "audio" | "documents" | "web" | "other";

/** What the tools are for, from the tools being set up (for the headline). */
export function setupPurpose(toolIds: ReadonlyArray<string>): Purpose {
  const has = (...ids: string[]) => ids.some((id) => toolIds.includes(id));
  if (has("ffmpeg", "remotion", "open-fonts")) return "video";
  if (has("faster-whisper", "piper-tts", "piper-voice-ro", "piper-voice-en")) return "audio";
  if (toolIds.some((id) => id.startsWith("whisper-model"))) return "audio";
  if (has("pandoc", "tesseract")) return "documents";
  if (has("playwright", "yt-dlp")) return "web";
  return "other";
}

const PURPOSE = {
  en: {
    video: "the video tools",
    audio: "the voice tools",
    documents: "the document tools",
    web: "the web tools",
    other: "the tools",
  },
  ro: {
    video: "uneltele pentru video",
    audio: "uneltele pentru voce",
    documents: "uneltele pentru documente",
    web: "uneltele pentru pagini web",
    other: "uneltele",
  },
} as const;

/** Progress and job sentences (install jobs, installer steps). */
export function jobText(locale: ZenToolchainLocale | undefined) {
  const ro = locale === "ro";
  return {
    waiting: ro ? "Așteaptă să înceapă" : "Waiting to start",
    nothing: ro ? "Nu e nimic de instalat." : "Nothing to install.",
    settingUp: (name: string) => (ro ? `Pregătesc ${name}` : `Setting up ${name}`),
    already: ro ? "Era deja instalat." : "Already installed.",
    installed: ro ? "Instalat și verificat." : "Installed and checked.",
    failed: (name: string, message: string) =>
      ro ? `${name} nu a putut fi pregătit. ${message}` : `${name} could not be set up. ${message}`,
    cancelled: ro
      ? "Pregătirea a fost oprită. Nu a rămas nimic instalat pe jumătate."
      : "Setup cancelled. Nothing half-installed was kept.",
    ready: ro ? "Gata." : "Ready.",
    readyOptional: ro
      ? "Gata. Unele extra opționale nu s-au putut pregăti; sarcina merge și fără ele."
      : "Ready. Some optional extras could not be set up; the task runs without them.",
    savedDownload: ro ? "Folosesc fișierul descărcat deja." : "Using the saved download.",
    downloadingFrom: (host: string, mirror: boolean) =>
      ro
        ? `Descarc de pe ${mirror ? `serverul Zen (${host})` : host}`
        : `Downloading from ${mirror ? `the Zen mirror (${host})` : host}`,
    retryFrom: (failed: string, next: string) =>
      ro ? `${failed} nu a mers, încerc ${next}.` : `${failed} did not work, trying ${next}.`,
    theMirror: ro ? "Serverul Zen" : "The mirror",
    unpacking: ro ? "Despachetez" : "Unpacking",
    npm: ro ? "Instalez pachetele (fără scripturi)" : "Installing packages (scripts off)",
    pythonRuntime: ro ? "Pregătesc Python" : "Setting up Python",
    pythonEnv: ro ? "Pregătesc mediul Python" : "Setting up the Python environment",
    pip: ro ? "Instalez pachetele Python verificate" : "Installing checked Python packages",
    browser: ro ? "Pregătesc browserul pentru video" : "Setting up the video browser",
    checking: ro ? "Verific că merge" : "Checking that it works",
  };
}

function durationText(locale: ZenToolchainLocale, seconds: number): string {
  if (seconds < 60) return locale === "ro" ? "sub un minut" : "less than a minute";
  const minutes = Math.round(seconds / 60);
  const about = locale === "ro" ? "aproximativ" : "about";
  if (minutes < 60) return `${about} ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${about} ${hours} h` : `${about} ${hours} h ${rest} min`;
}

export function evalText(locale: ZenToolchainLocale) {
  const ro = locale === "ro";
  const os = OS[locale];
  const arch = ARCH[locale];
  return {
    os: (value: keyof typeof os) => os[value],
    gb: gbText,
    duration: (seconds: number) => durationText(locale, seconds),
    unknownTool: (id: string) =>
      ro
        ? `Această sarcină are nevoie de o unealtă (${id}) pe care această versiune de Zen Staff nu o cunoaște încă. Actualizează Zen Staff.`
        : `This task needs a tool (${id}) this version of Zen Staff does not know yet. Update Zen Staff.`,
    brokenList: ro ? "Lista de unelte este greșită." : "The tool list is broken.",
    safetyUpdate: (name: string, from: string, to: string) =>
      ro
        ? `${name} ${from} are o problemă de securitate cunoscută, așa că se actualizează întâi la ${to}.`
        : `${name} ${from} has a known security problem, so it will be updated to ${to} first.`,
    blocked: (name: string) =>
      ro
        ? `${name} are o problemă de securitate cunoscută și încă nu există o versiune sigură pentru acest calculator. Sarcina e blocată până apare o actualizare.`
        : `${name} has a known security problem and no safe version is available for this computer yet. The task is blocked until an update ships.`,
    noRecipe: (name: string, o: keyof typeof os, a: keyof typeof arch) =>
      ro
        ? `${name} nu este disponibil pentru ${os[o]} pe calculatoare ${arch[a]}.`
        : `${name} is not available for ${os[o]} on ${arch[a]} computers.`,
    noVersion: (name: string) =>
      ro
        ? `Această sarcină cere o versiune de ${name} pe care Zen Staff nu o poate instala.`
        : `This task needs a version of ${name} that Zen Staff cannot install.`,
    platform: ro
      ? "Zen Staff nu poate instala unelte pe acest tip de calculator."
      : "Zen Staff cannot install tools on this kind of computer.",
    onlyOs: (wanted: ReadonlyArray<keyof typeof os>, have: keyof typeof os) =>
      ro
        ? `Această sarcină merge doar pe ${wanted.map((o) => os[o]).join(" sau ")}; acest calculator are ${os[have]}.`
        : `This task works only on ${wanted.map((o) => os[o]).join(" or ")}; this computer runs ${os[have]}.`,
    arch: (have: keyof typeof arch) =>
      ro
        ? `Această sarcină nu merge pe calculatoare ${arch[have]}.`
        : `This task does not run on ${arch[have]} computers.`,
    ram: (need: number, have: number) =>
      ro
        ? `Această sarcină are nevoie de ${gbText(need)} de memorie (RAM); acest calculator are ${gbText(have)}.`
        : `This task needs ${gbText(need)} of memory (RAM); this computer has ${gbText(have)}.`,
    cpu: (need: number, have: number) =>
      ro
        ? `Această sarcină are nevoie de un procesor cu ${need} nuclee; acest calculator are ${have}.`
        : `This task needs a processor with ${need} cores; this computer has ${have}.`,
    gpuNeed: (vendor: string, vram: number | undefined) =>
      ro
        ? `o placă video${vendor ? ` ${vendor}` : ""}${vram ? ` cu ${gbText(vram)}` : ""}`
        : `a ${vendor ? `${vendor} ` : ""}graphics card${vram ? ` with ${gbText(vram)}` : ""}`,
    gpu: (need: string, have: string | null) =>
      ro
        ? `Această sarcină are nevoie de ${need}; acest calculator ${have === null ? "nu are niciuna" : `are doar ${have}`}.`
        : `This task needs ${need}; this computer has ${have === null ? "none" : `only ${have}`}.`,
    disk: (need: number, have: number) =>
      ro
        ? `Această sarcină are nevoie de ${gbText(need)} liberi pe disc; acest calculator are ${gbText(have)} liberi.`
        : `This task needs ${gbText(need)} of free disk space; this computer has ${gbText(have)} free.`,
    installDir: ro
      ? "Zen Staff nu poate salva unelte pe acest calculator (dosarul de unelte nu poate fi scris). Cere ajutorul administratorului."
      : "Zen Staff cannot save tools on this computer (its tools folder is read-only). Ask your administrator.",
    network: ro
      ? "Zen Staff nu poate ajunge acum la serverele de descărcare. Verifică internetul."
      : "Zen Staff cannot reach the download servers right now. Check the internet connection.",
    connector: (name: string) =>
      ro
        ? `Această sarcină are nevoie de ${name}. Cere administratorului să îl conecteze.`
        : `This task needs ${name}. Ask your administrator to connect it.`,
    optionalConnector: (name: string, purpose: string | undefined) =>
      ro
        ? `${name} nu este conectat, așa că sarcina merge fără${purpose ? ` (${purpose})` : ""}.`
        : `${name} is not connected, so the task runs without it${purpose ? ` (${purpose})` : ""}.`,
    runEstimate: (duration: string, unit: string) =>
      ro
        ? `${duration} pentru ${unit} pe acest calculator`
        : `${duration} for ${unit} on this computer`,
    slow: (estimate: string) =>
      ro ? `Merge aici, dar încet: ${estimate}.` : `This works here, but slowly: ${estimate}.`,
    connectorAlternative: (name: string) =>
      ro
        ? `Folosește ${name} în cloud în loc de acest calculator.`
        : `Uses ${name} in the cloud instead of this computer.`,
    lighterAlternative: ro
      ? "O variantă mai ușoară, potrivită pentru acest calculator."
      : "A lighter version that fits this computer.",
    ready: ro ? "Gata." : "Ready.",
    readySlow: (estimate: string | null) =>
      ro
        ? `Gata, dar lent pe acest calculator: ${estimate ?? "durează"}.`
        : `Ready, but slow on this computer: ${estimate ?? "it takes a while"}.`,
    needsInstall: (names: string, download: string, duration: string, purpose: Purpose) =>
      ro
        ? `Pregătesc ${PURPOSE.ro[purpose]} (~${localBytes("ro", download)}, o singură dată, ${duration}): ${names}.`
        : `Getting ${PURPOSE.en[purpose]} ready (~${download}, one time, ${duration}): ${names}.`,
    systemTool: (name: string, version: string) =>
      ro
        ? `Folosesc ${name} ${version} deja instalat pe calculator.`
        : `Using ${name} ${version} already installed on this computer.`,
    updating: ro
      ? "Se actualizează o unealtă pentru siguranță, înainte de prima rulare."
      : "Updating a tool for safety before the first run.",
    cannotRun: ro
      ? "Această sarcină nu poate rula pe acest calculator."
      : "This task cannot run on this computer.",
  };
}

export type EvalText = ReturnType<typeof evalText>;
