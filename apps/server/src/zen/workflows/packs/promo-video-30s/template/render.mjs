// Renders props.json (-14 LUFS; a voice-over ducks the music, -16 LUFS), a cover and the sheets.
// Usage: node render.mjs --props props.json --public <folder> --out <file.mp4>
//   [--quality draft|final] [--voiceover-text "..."] [--voice elevenlabs|preview|none]
//   [--voice-language ro|en] [--stems <folder>] (stems: voice.wav, music-ducked.wav)
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { makeScore } from "../kit/audio/sound.mjs";
import { mixVoiceOver } from "../kit/audio/duck.mjs";
import { normalizeLoudness } from "../kit/audio/master.mjs";
import { contactSheet, probeVideo, safeSheet } from "../kit/check/sheets.mjs";
import {
  blackStretches,
  bundleTemplate,
  makePublic,
  prepareMedia,
  quality,
  renderPoster,
  renderVideo,
  tools,
} from "../kit/motion/node.mjs";
import { FPS, layoutFor, makeSchemas, promoTimeline } from "./src/schema.js";
import { aiVoiceLabel, previewFileName, resolveVoice, voiceReportLines } from "./voice-preview.mjs";

const here = import.meta.dirname;
/** The voice-over starts this many seconds in (after the opening hit). */
const VOICE_START = 0.4;
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const propsPath = option("props");
const publicDir = NodePath.resolve(option("public") ?? NodePath.dirname(propsPath ?? "."));
let out = option("out");
const q = quality(option("quality") ?? "final");
const voiceoverText = option("voiceover-text");
const voiceLanguage = option("voice-language") === "en" ? "en" : "ro";
const requestedVoice = option("voice") ?? "elevenlabs";
if (!["elevenlabs", "preview", "none"].includes(requestedVoice))
  fail('--voice must be "elevenlabs", "preview" or "none".');
if (!propsPath || !out)
  fail("Use --props <props.json> --out <video.mp4> [--public <folder>] [--quality draft|final].");

const T = tools();
const { z } = T.require("zod");
const schemas = makeSchemas(z);
const explain = (error) =>
  error.issues.map((issue) => `${issue.path.join(".") || "props"}: ${issue.message}`).join("\n  ");
let props;
try {
  props = JSON.parse(NodeFS.readFileSync(propsPath, "utf8"));
} catch (error) {
  fail(`props.json could not be read: ${error.message}`);
}
const checked = schemas.props.safeParse(props);
if (!checked.success) fail(`props.json has problems:\n  ${explain(checked.error)}`);
props = checked.data;
const words = props.scenes[0].title.split(/\s+/).filter(Boolean).length;
if (words > 7)
  fail(`The opening title has ${words} words; keep it to 2-7 so it reads in the first second.`);
const files = [
  props.brand?.logo,
  props.music && !props.music.startsWith("generated:") && props.music !== "none"
    ? props.music
    : null,
  props.voiceover,
  ...props.scenes.flatMap((scene) => [scene.image, scene.image2]),
].filter(Boolean);
for (const file of files) {
  if (!NodeFS.existsSync(NodePath.join(publicDir, file))) fail(`${file} is not in ${publicDir}.`);
}
const pictures = props.scenes.flatMap((scene) => [scene.image, scene.image2]).filter(Boolean);
if (new Set(pictures).size !== pictures.length)
  fail("A picture is used twice; use each picture once.");

// The professional voice is the person's own ElevenLabs; without it the local Piper voice makes a
// PREVIEW: the file name says so, and the result lines tell the person it is not for ads.
const voiceChoice = voiceoverText
  ? resolveVoice(requestedVoice, process.env)
  : { voice: "none", fellBack: false };
if (voiceChoice.voice === "elevenlabs") {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ZEN_ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: voiceoverText, model_id: "eleven_multilingual_v2" }),
  }).catch((error) => fail(`ElevenLabs could not be reached: ${error.message}`));
  if (!response.ok) fail(`ElevenLabs refused the voice-over (${response.status}).`);
  NodeFS.writeFileSync(
    NodePath.join(publicDir, "voiceover.mp3"),
    Buffer.from(await response.arrayBuffer()),
  );
  props.voiceover = "voiceover.mp3";
} else if (voiceChoice.voice === "preview") {
  const model =
    voiceLanguage === "ro" ? process.env.ZEN_PIPER_VOICE_RO : process.env.ZEN_PIPER_VOICE_EN;
  const python = process.env.ZEN_TOOL_PIPER_PYTHON;
  if (!model || !NodeFS.existsSync(model) || !python) {
    fail(
      "The local preview voice is not installed. Start the task from Zen Staff again, or choose the professional voice or no voice-over.",
    );
  }
  const wav = previewFileName("voiceover.wav");
  const spoken = NodeChildProcess.spawnSync(
    python,
    ["-m", "piper", "-m", model, "-f", NodePath.join(publicDir, wav), "--sentence-silence", "0.25"],
    { input: Buffer.from(voiceoverText, "utf8") },
  );
  if (spoken.status !== 0) fail("The local preview voice could not read the text.");
  props.voiceover = wav;
  out = previewFileName(out);
}
if (voiceChoice.voice !== "none") props.aiVoiceLabel = aiVoiceLabel(voiceLanguage);
const voiceLines = voiceReportLines(voiceChoice.voice, voiceLanguage, voiceChoice.fellBack);

const { work, publicDir: renderPublic, cleanup } = makePublic(T.fontsDir);
prepareMedia({
  ffmpeg: T.ffmpeg,
  files: new Set([...files, props.voiceover].filter(Boolean)),
  from: publicDir,
  publicDir: renderPublic,
});
const timeline = promoTimeline(props);
const mood = props.music.startsWith("generated:") ? props.music.slice("generated:".length) : "none";
const { wav } = makeScore({
  mood,
  seconds: timeline.total / FPS,
  endAt: timeline.endStart / FPS,
  cues: timeline.cues,
  seed: 11,
});
NodeFS.writeFileSync(NodePath.join(renderPublic, "_zen", "score.wav"), wav);
const inputProps = { ...props, score: "_zen/score.wav", draft: q.draft };
// With a voice-over, one mix: the voice levelled, the music (the score and the person's own
// track) ducked about 12 dB under it while it speaks and back up in the pauses.
let ducking = null;
if (props.voiceover) {
  const userMusic =
    props.music && !props.music.startsWith("generated:") && props.music !== "none"
      ? props.music
      : null;
  const mixed = mixVoiceOver({
    ffmpeg: T.ffmpeg,
    music: [
      { file: NodePath.join(renderPublic, "_zen", "score.wav") },
      ...(userMusic
        ? [{ file: NodePath.join(publicDir, userMusic), gainDb: -1.5, fadeIn: 0.35, fadeOut: 1 }]
        : []),
    ],
    voices: [{ file: NodePath.join(publicDir, props.voiceover), at: VOICE_START }],
    duration: timeline.total / FPS,
    out: NodePath.join(renderPublic, "_zen", "mix.wav"),
    stems: option("stems"),
  });
  inputProps.mix = "_zen/mix.wav";
  ducking = {
    musicUnderVoiceDb: mixed.levels.downDb,
    musicBetweenLinesDb: mixed.levels.upDb,
    voiceSegments: mixed.segments,
  };
}

console.log("Preparing the video template...");
const started = Date.now();
const serveUrl = await bundleTemplate({
  require: T.require,
  modules: T.modules,
  entryPoint: NodePath.join(here, "src", "index.jsx"),
  rootDir: NodePath.dirname(here),
  publicDir: renderPublic,
  work,
});
const video = NodePath.resolve(out);
NodeFS.mkdirSync(NodePath.dirname(video), { recursive: true });
const { composition, seconds: renderSeconds } = await renderVideo({
  require: T.require,
  serveUrl,
  id: "Promo",
  inputProps,
  output: video,
  q,
  browser: T.browser,
  label: "promo",
});
const loud = normalizeLoudness(T.ffmpeg, video, { target: props.voiceover ? -16 : -14 });
if (loud && loud.truePeak > -1)
  console.log(`Warning: true peak ${loud.truePeak.toFixed(1)} dBTP is above -1 dBTP.`);
const base = video.replace(/\.mp4$/i, "");
const poster = `${base}.jpg`;
await renderPoster({
  require: T.require,
  serveUrl,
  composition,
  inputProps,
  output: poster,
  frame: Math.min(timeline.frames[0] - 4, 45),
  q,
  browser: T.browser,
});
const checkDir = NodePath.join(NodePath.dirname(video), "check");
const name = NodePath.basename(base);
const font = NodePath.join(T.fontsDir, "Barlow-SemiBold.ttf");
const sheet = contactSheet(
  T.ffmpeg,
  T.ffprobe,
  video,
  NodePath.join(checkDir, `${name}-contact.jpg`),
  { every: 0.5, font, thumb: q.draft ? 160 : 220 },
);
const info = probeVideo(T.ffprobe, video);
const times = [];
let at = 0;
for (const f of timeline.frames) {
  times.push((at + f * 0.65) / FPS);
  at += f;
}
times.push((at + timeline.endFrames * 0.7) / FPS);
const safe = safeSheet(T.ffmpeg, video, NodePath.join(checkDir, `${name}-safe.jpg`), {
  times,
  width: info.width,
  height: info.height,
  thumb: info.width > info.height ? 420 : 280,
});
cleanup();
console.log(
  JSON.stringify({
    video,
    poster,
    contactSheet: sheet,
    safeSheet: safe,
    quality: q.name,
    seconds: Number(info.seconds.toFixed(2)),
    width: info.width,
    height: info.height,
    layouts: props.scenes.map((scene, index) => layoutFor(scene, index)),
    loudnessLufs: loud ? Number(loud.lufs.toFixed(1)) : null,
    truePeak: loud ? Number(loud.truePeak.toFixed(1)) : null,
    blackStretches: blackStretches(T.ffmpeg, video),
    sizeMB: Number(info.sizeMB.toFixed(1)),
    voice: voiceChoice.voice,
    voiceNotice: voiceLines,
    ducking,
    renderSeconds,
    totalSeconds: Math.round((Date.now() - started) / 1000),
  }),
);
