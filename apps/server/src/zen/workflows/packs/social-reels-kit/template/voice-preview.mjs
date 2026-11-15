// Zen Staff video packs: how a voice-over is labelled. The local Piper voice is a PREVIEW, only to
// check timing and wording; the final voice is the person's own professional voice service
// (ElevenLabs through their own account). Shared by the voice packs (each keeps an identical copy,
// checked by a test) so the file names, the report and the reply always say which voice was used.

/** Added to the name of every file made with the local preview voice. */
export const PREVIEW_VOICE_SUFFIX = "-preview-voice";

/** voice-over.mp4 -> voice-over-preview-voice.mp4 (only once). */
export function previewFileName(path) {
  if (path.includes(PREVIEW_VOICE_SUFFIX)) return path;
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash
    ? `${path.slice(0, dot)}${PREVIEW_VOICE_SUFFIX}${path.slice(dot)}`
    : `${path}${PREVIEW_VOICE_SUFFIX}`;
}

const TEXT = {
  ro: {
    preview:
      "Vocea din acest video este o PREVIZUALIZARE LOCALĂ (Piper, gratuită, doar orientativă): e bună ca să verifici textul și ritmul, nu pentru varianta finală și niciodată pentru reclame.",
    redo: "Refă cu voce profesională: conectează-ți contul ElevenLabs (scrie în chat „conectează-mi ElevenLabs” sau Setări > Conexiuni; cheia rămâne în contul tău, Zen nu o păstrează), apoi scrie „Refă cu voce profesională” și refac video-ul cu același text.",
    pro: "Voce: voce profesională ElevenLabs, din contul tău.",
    none: "Fără voce: doar subtitrare.",
    aiLabel: "Voce generată cu AI",
    fellBack:
      "Ai ales vocea profesională, dar ElevenLabs nu e conectat pe acest calculator, așa că am folosit previzualizarea locală.",
  },
  en: {
    preview:
      "The voice in this video is a LOCAL PREVIEW (Piper, free, for checking only): good for checking the words and the timing, not for the final version and never for ads.",
    redo: 'Redo with a professional voice: connect your ElevenLabs account (type "connect ElevenLabs" in the chat, or Settings > Connections; the key stays in your account, Zen does not keep it), then type "Redo with a professional voice" and I make the video again with the same script.',
    pro: "Voice: professional ElevenLabs voice, from your own account.",
    none: "No voice: captions only.",
    aiLabel: "AI-generated voice",
    fellBack:
      "You chose the professional voice, but ElevenLabs is not connected on this computer, so the local preview voice was used.",
  },
};

const pick = (language) => TEXT[language === "ro" ? "ro" : "en"];

/** The label shown on screen whenever a voice is generated (EU AI Act). */
export function aiVoiceLabel(language) {
  return pick(language).aiLabel;
}

/**
 * The voice to use: "elevenlabs" when chosen and connected, the local "preview" when chosen or as
 * the fallback, or "none". `fellBack` is true when the professional voice was asked for but is
 * not connected.
 */
export function resolveVoice(requested, env) {
  if (requested === "none") return { voice: "none", fellBack: false };
  if (requested === "elevenlabs") {
    return env.ELEVENLABS_API_KEY
      ? { voice: "elevenlabs", fellBack: false }
      : { voice: "preview", fellBack: true };
  }
  return { voice: "preview", fellBack: false };
}

/** The lines the report and the agent's reply carry about the voice that was used. */
export function voiceReportLines(voice, language, fellBack = false) {
  const text = pick(language);
  if (voice === "none") return [text.none];
  if (voice === "elevenlabs") return [text.pro, `${text.aiLabel}.`];
  return [...(fellBack ? [text.fellBack] : []), text.preview, text.redo];
}
