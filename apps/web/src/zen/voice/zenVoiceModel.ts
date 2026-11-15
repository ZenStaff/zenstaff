// Pure rules for Zen's simple voice setup: model sizes, languages, where audio goes.
// No React and no browser globals, so `zenVoiceModel.test.ts` runs them directly.

/** Languages the simple setup offers. Upstream's Settings → Voice still lists every language. */
export type ZenVoiceLanguage = "auto" | "ro" | "en";
export const ZEN_VOICE_LANGUAGES: ReadonlyArray<{ id: ZenVoiceLanguage; label: string }> = [
  { id: "auto", label: "Auto-detect" },
  { id: "ro", label: "Română" },
  { id: "en", label: "English" },
];

/**
 * Upstream's `speechLanguage` client setting holds any language code. The simple setup shows
 * one of three choices; anything else (say "de", picked in Settings → Voice) reads as Auto
 * there and is only overwritten when the person picks a language in the dialog.
 */
export function zenVoiceLanguageFromSetting(speechLanguage: string): ZenVoiceLanguage {
  return speechLanguage === "ro" || speechLanguage === "en" ? speechLanguage : "auto";
}

export type ZenVoiceSize = "tiny" | "base" | "small" | "best";

export type ZenVoiceModelChoice = {
  readonly size: ZenVoiceSize;
  /** Upstream speech catalog id (apps/server/src/speech/catalog.json). */
  readonly modelId: string;
  readonly label: string;
  readonly detail: string;
  readonly megabytes: number;
};

/**
 * The sizes offered to Office users. tiny/base/small are Whisper (99 languages, auto-detect);
 * "best" is Parakeet TDT v3, which was far more accurate in Romanian at a speed close to Whisper
 * Base on the build server (see ZEN.md "Voice input", measured on a 10 s clip).
 */
export const ZEN_VOICE_MODEL_CHOICES: ReadonlyArray<ZenVoiceModelChoice> = [
  {
    size: "tiny",
    modelId: "handy-computer/whisper-tiny-gguf",
    label: "Fast",
    detail: "Whisper Tiny. Smallest download, good for English, weak for Romanian.",
    megabytes: 46,
  },
  {
    size: "base",
    modelId: "handy-computer/whisper-base-gguf",
    label: "Balanced",
    detail: "Whisper Base. Good for English, makes mistakes in Romanian.",
    megabytes: 85,
  },
  {
    size: "small",
    modelId: "handy-computer/whisper-small-gguf",
    label: "Accurate",
    detail: "Whisper Small. Better Romanian, slower on older computers.",
    megabytes: 270,
  },
  {
    size: "best",
    modelId: "handy-computer/parakeet-tdt-0.6b-v3-gguf",
    label: "Best for Romanian",
    detail: "Parakeet v3. Most accurate for Romanian and English, larger download.",
    megabytes: 740,
  },
];

export function zenVoiceModelChoice(size: ZenVoiceSize): ZenVoiceModelChoice {
  return ZEN_VOICE_MODEL_CHOICES.find((choice) => choice.size === size)!;
}

/** The size a model id belongs to, or null for a model picked elsewhere (Settings → Voice). */
export function zenVoiceSizeOfModel(modelId: string | null | undefined): ZenVoiceSize | null {
  return ZEN_VOICE_MODEL_CHOICES.find((choice) => choice.modelId === modelId)?.size ?? null;
}

/**
 * Preselected size: the model already installed on the environment when it is one of ours,
 * otherwise the most accurate one for Romanian or Auto, and Whisper Base for English only
 * (a ninth of the download, and English is where Whisper is strong).
 */
export function recommendZenVoiceSize(input: {
  readonly language: ZenVoiceLanguage;
  readonly installedModelIds?: ReadonlyArray<string>;
  readonly selectedModelId?: string | null;
}): ZenVoiceSize {
  const selected = zenVoiceSizeOfModel(input.selectedModelId);
  if (selected && input.installedModelIds?.includes(input.selectedModelId!)) return selected;
  if (input.language !== "en") return "best";
  const installed = ZEN_VOICE_MODEL_CHOICES.filter(({ modelId }) =>
    input.installedModelIds?.includes(modelId),
  );
  return installed.at(-1)?.size ?? "base";
}

/** Recording mode, stored in upstream's `voiceShortcutMode` setting. The mic button always toggles. */
export type ZenVoiceMode = "toggle" | "hold";
export function zenVoiceModeFromSetting(mode: string): ZenVoiceMode {
  return mode === "hold" ? "hold" : "toggle";
}

/**
 * Web Speech has no auto-detect: it needs one BCP 47 tag. Auto picks Romanian or English from
 * the browser's preferred languages, in their order, and falls back to English.
 */
export function webSpeechLocale(
  language: string,
  navigatorLanguages: ReadonlyArray<string>,
): string {
  const tag = (code: string) => (code === "ro" ? "ro-RO" : code === "en" ? "en-US" : code);
  if (language !== "auto") return tag(language);
  for (const preferred of navigatorLanguages) {
    const base = preferred.split(/[-_]/)[0]!.toLowerCase();
    if (base === "ro") return "ro-RO";
    if (base === "en") return preferred.includes("-") ? preferred : "en-US";
  }
  return "en-US";
}

/**
 * True when the transcription environment is this computer, so audio does not leave it.
 * The desktop app's own backend and `t3 serve` opened in a local browser both qualify.
 */
export function isLocalTranscriptionHost(httpBaseUrl: string | null | undefined): boolean {
  if (!httpBaseUrl) return false;
  let host: string;
  try {
    host = new URL(httpBaseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/** "local" transcribes with an environment's model (upstream); "browser" uses Web Speech. */
export type ZenVoiceEngine = "local" | "browser";

/**
 * Which engine a composer uses. A destination chosen in Settings → Voice (upstream's grant)
 * always wins, so the browser fallback never overrides an explicit local or cloud choice.
 */
export function resolveZenVoiceEngine(input: {
  readonly preferred: ZenVoiceEngine;
  readonly hasUpstreamGrant: boolean;
  readonly webSpeechAvailable: boolean;
}): ZenVoiceEngine {
  if (input.hasUpstreamGrant) return "local";
  return input.preferred === "browser" && input.webSpeechAvailable ? "browser" : "local";
}

/** Percent for a download progress bar, or null before the server reports bytes. */
export function downloadPercent(model: {
  readonly size: number;
  readonly downloaded?: number | undefined;
  readonly state?: string;
}): number | null {
  if (model.state === "installed") return 100;
  if (model.downloaded === undefined || model.size <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((model.downloaded / model.size) * 100)));
}

/**
 * Whether the mic shows while no destination is chosen. Upstream hides it in editors that would
 * lose their draft on the way to Settings → Voice; Zen's quick setup is a dialog, so the mic shows
 * wherever audio can be captured.
 */
export function zenSetupAvailable(upstreamAvailable: boolean, microphone: boolean): boolean {
  return upstreamAvailable || microphone;
}
