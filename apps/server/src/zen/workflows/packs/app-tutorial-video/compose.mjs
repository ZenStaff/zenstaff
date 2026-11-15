// Edits the recorded tutorial with the Remotion compositor in compose/ (window on the brand
// background, auto-zoom, eased cursor, click ripples, lower thirds, captions, intro and outro),
// then masters the sound to -16 LUFS with the music ducked about 12 dB under the voice while it
// speaks and back up between steps. Called by make.mjs after the recording.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { makeScore } from "./kit/audio/sound.mjs";
import { mixVoiceOver } from "./kit/audio/duck.mjs";
import { normalizeLoudness } from "./kit/audio/master.mjs";
import { contactSheet } from "./kit/check/sheets.mjs";
import { bundleTemplate, makePublic, quality, renderVideo, tools } from "./kit/motion/node.mjs";

const here = import.meta.dirname;

/**
 * body: the 30 fps recording; narration: the whole voice track; steps and events in seconds of
 * the body; cues [{ text, s, e }] and voiceSegments [{ start, end }] (where the music ducks) in
 * seconds of the whole video; stems: a folder for voice.wav and music-ducked.wav.
 */
export async function composeTutorial({
  body,
  narration,
  output,
  format,
  sb,
  steps,
  events,
  cues,
  introSeconds,
  bodySeconds,
  outroSeconds,
  aiNote,
  qualityName = "final",
  music = true,
  voiceSegments = null,
  stems,
}) {
  const T = tools();
  const q = quality(qualityName);
  const { work, publicDir, cleanup } = makePublic(T.fontsDir);
  NodeFS.copyFileSync(body, NodePath.join(publicDir, "body.mp4"));
  NodeFS.copyFileSync(narration, NodePath.join(publicDir, "narration.wav"));
  let logo;
  if (sb.brand.logo && NodeFS.existsSync(sb.brand.logo)) {
    logo = `logo${NodePath.extname(sb.brand.logo).toLowerCase()}`;
    NodeFS.copyFileSync(sb.brand.logo, NodePath.join(publicDir, logo));
  }
  const total = introSeconds + bodySeconds + outroSeconds;
  // A quiet bed under the voice, a click on every click, a whoosh into the screen and the outro.
  const sfx = [
    { t: Math.max(0, introSeconds - 0.18), kind: "whoosh", gain: 0.6 },
    ...events
      .filter((e) => e.kind === "click")
      .map((e) => ({ t: introSeconds + e.t, kind: "click", gain: 0.7 })),
    { t: Math.max(0, introSeconds + bodySeconds - 0.18), kind: "whoosh", gain: 0.6 },
  ];
  const { wav } = makeScore({
    mood: music ? "calm" : "none",
    seconds: total,
    endAt: introSeconds + bodySeconds,
    cues: sfx,
    seed: 5,
    musicGain: 0.22,
  });
  NodeFS.writeFileSync(NodePath.join(publicDir, "_zen", "score.wav"), wav);
  let mix;
  let ducking = null;
  if (voiceSegments?.length) {
    const mixed = mixVoiceOver({
      ffmpeg: T.ffmpeg,
      music: [{ file: NodePath.join(publicDir, "_zen", "score.wav") }],
      voices: [{ file: narration, at: 0 }],
      segments: voiceSegments,
      duration: total,
      out: NodePath.join(publicDir, "_zen", "mix.wav"),
      stems,
    });
    mix = "_zen/mix.wav";
    ducking = { musicUnderVoiceDb: mixed.levels.downDb, musicBetweenLinesDb: mixed.levels.upDb };
  }
  let domain = sb.url;
  try {
    domain = new URL(sb.url).host.replace(/^www\./, "");
  } catch {}
  const outro = sb.outro ?? {};
  const inputProps = {
    format,
    title: sb.title,
    kicker: sb.kicker ?? (sb.language === "ro" ? "Tutorial pas cu pas" : "Step-by-step tutorial"),
    subtitle: sb.subtitle,
    brand: {
      name: sb.brand.name ?? domain,
      primary: sb.brand.primary,
      accent: sb.brand.accent,
      logo,
    },
    outro: {
      title: outro.title ?? (sb.language === "ro" ? "Gata!" : "That's it!"),
      button: outro.button,
      lines: outro.lines ?? [],
    },
    introSeconds,
    bodySeconds,
    outroSeconds,
    events,
    steps,
    cues,
    body: "body.mp4",
    narration: "narration.wav",
    score: "_zen/score.wav",
    mix,
    domain,
    aiNote,
    captions: sb.captions !== false,
    draft: q.draft,
  };
  console.log("Editing the video (zoom, cursor, titles, captions)...");
  const serveUrl = await bundleTemplate({
    require: T.require,
    modules: T.modules,
    entryPoint: NodePath.join(here, "compose", "src", "index.jsx"),
    rootDir: here,
    publicDir,
    work,
  });
  const { seconds } = await renderVideo({
    require: T.require,
    serveUrl,
    id: "Tutorial",
    inputProps,
    output,
    q,
    browser: T.browser,
    label: "tutorial",
  });
  const loud = normalizeLoudness(T.ffmpeg, output, { target: -16 });
  const sheet = contactSheet(
    T.ffmpeg,
    T.ffprobe,
    output,
    output.replace(/\.mp4$/i, "-contact.jpg"),
    { every: 1, thumb: 320, columns: 6, font: NodePath.join(T.fontsDir, "Barlow-SemiBold.ttf") },
  );
  cleanup();
  return { renderSeconds: seconds, loudness: loud, contactSheet: sheet, ducking };
}
