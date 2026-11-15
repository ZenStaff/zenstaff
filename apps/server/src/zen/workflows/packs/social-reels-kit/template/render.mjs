// Renders every reel of reels.json (-14 LUFS; a `voiceover` ducks the music, -16 LUFS, AI label),
// a cover, captions.md and the review sheets.
// Usage: node render.mjs --plan reels.json --media <folder> --out <folder> [--quality draft|final]
//   [--only <id>] [--check] [--voice elevenlabs|preview|none] [--voice-language ro|en] [--stems <dir>]
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { makeScore } from "../kit/audio/sound.mjs";
import { mixVoiceOver } from "../kit/audio/duck.mjs";
import { normalizeLoudness } from "../kit/audio/master.mjs";
import { contactSheet, pageSheet, probeVideo, safeSheet } from "../kit/check/sheets.mjs";
import {
  blackStretches,
  bundleTemplate,
  fail,
  makePublic,
  options,
  prepareMedia,
  quality,
  renderPoster,
  renderVideo,
  tools,
} from "../kit/motion/node.mjs";
import { FORMATS, FPS, makeSchemas, moodBpm, reelTimeline } from "./src/schema.js";
import { aiVoiceLabel, previewFileName, resolveVoice, voiceReportLines } from "./voice-preview.mjs";

const here = import.meta.dirname;
const opt = options();
const planPath = opt.get("plan");
const mediaDir = NodePath.resolve(opt.get("media", "."));
const outDir = NodePath.resolve(opt.get("out", "reels"));
const only = opt.get("only");
const checkOnly = opt.has("check");
const q = quality(opt.get("quality", "final"));
const requestedVoice = opt.get("voice", "elevenlabs");
if (!["elevenlabs", "preview", "none"].includes(requestedVoice))
  fail('--voice must be "elevenlabs", "preview" or "none".');
const voiceLanguage = opt.get("voice-language", "ro") === "en" ? "en" : "ro";
const stemsDir = opt.get("stems");
/** The voice starts this many seconds in, after the hook has landed. */
const VOICE_START = 0.5;
/** About how many words a voice says per second (to warn before a voice is made). */
const WORDS_PER_SECOND = 2.4;
if (!planPath)
  fail("Use --plan <reels.json> --media <folder> --out <folder> [--quality draft|final].");

const T = tools();
const { z } = T.require("zod");
const schemas = makeSchemas(z);
const explain = (error) =>
  error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`).join("\n  ");
let plan;
try {
  plan = schemas.plan.parse(JSON.parse(NodeFS.readFileSync(planPath, "utf8")));
} catch (error) {
  if (error.issues) fail(`The plan has problems:\n  ${explain(error)}`);
  fail(`The plan could not be read: ${error.message}`);
}
const ids = new Set();
for (const reel of plan.reels) {
  if (ids.has(reel.id)) fail(`Two reels are called ${reel.id}; give each its own id.`);
  ids.add(reel.id);
}

// Every file the plan names must be in the media folder.
const used = new Set();
if (plan.brand.logo) used.add(plan.brand.logo);
const musicFile = plan.music.startsWith("generated:") || plan.music === "none" ? null : plan.music;
if (musicFile) used.add(musicFile);
for (const reel of plan.reels)
  for (const scene of reel.scenes) if (scene.media) used.add(scene.media);
const missing = [...used].filter((file) => !NodeFS.existsSync(NodePath.join(mediaDir, file)));
if (missing.length) fail(`These files are not in ${mediaDir}: ${missing.join(", ")}`);
const mood = plan.music.startsWith("generated:") ? plan.music.slice("generated:".length) : null;
if (mood && !["upbeat", "calm", "warm", "bright"].includes(mood))
  fail(
    'music must be "generated:upbeat", "generated:warm", "generated:calm", "generated:bright", "none" or a file name.',
  );

// Craft checks that a schema cannot express.
const warnings = [];
for (const reel of plan.reels) {
  const first = reel.scenes[0];
  if (first.type !== "hook")
    fail(`Reel ${reel.id}: the first scene must be a "hook" (it stops the scroll).`);
  const words = String(first.title ?? "")
    .split(/\s+/)
    .filter(Boolean).length;
  if (words < 2 || words > 7)
    fail(`Reel ${reel.id}: the hook title needs 2-7 words (it has ${words}).`);
  const media = reel.scenes.map((scene) => scene.media).filter(Boolean);
  if (new Set(media).size !== media.length)
    fail(`Reel ${reel.id}: a photo or clip is used twice; use each once per reel.`);
  for (const [i, scene] of reel.scenes.entries()) {
    if ((scene.type === "photo" || scene.type === "hook") && !scene.media && scene.type === "photo")
      fail(`Reel ${reel.id}, scene ${i + 1}: a "photo" scene needs media.`);
    if (scene.type === "list" && (!scene.items || scene.items.length < 2))
      fail(`Reel ${reel.id}, scene ${i + 1}: a list needs 2-4 items.`);
    if (scene.type === "quote" && !scene.text)
      fail(`Reel ${reel.id}, scene ${i + 1}: a quote needs the text of a real review.`);
    if (scene.type === "offer" && !scene.badge)
      warnings.push(
        `Reel ${reel.id}, scene ${i + 1}: an offer without a badge (price or discount) is weak.`,
      );
  }
  const noMedia = reel.scenes.filter((scene) => !scene.media).length;
  if (noMedia > 2)
    warnings.push(
      `Reel ${reel.id}: ${noMedia} scenes have no photo; reels with real pictures perform better.`,
    );
}

const bpm = moodBpm(plan.music);
const reels = plan.reels
  .filter((reel) => !only || reel.id === only)
  .map((reel) => {
    const props = {
      id: reel.id,
      format: plan.format,
      style: reel.style ?? plan.style,
      brand: plan.brand,
      scenes: reel.scenes,
      end: reel.end ?? plan.end,
      poster: reel.poster ?? 0.12,
      bpm,
      draft: q.draft,
    };
    const parsed = schemas.reel.safeParse(props);
    if (!parsed.success) fail(`Reel ${reel.id}:\n  ${explain(parsed.error)}`);
    return { ...parsed.data, caption: reel.caption ?? "", voiceover: reel.voiceover?.trim() };
  });
if (reels.length === 0) fail(`No reel is called ${only}.`);
for (const reel of reels) {
  const seconds = reelTimeline(reel).total / FPS;
  if (seconds > 60)
    fail(`Reel ${reel.id} is ${seconds.toFixed(1)} s; keep reels under 60 s (aim for 12-25 s).`);
}
for (const reel of reels) {
  if (!reel.voiceover || requestedVoice === "none") continue;
  const room = reelTimeline(reel).total / FPS - VOICE_START - 0.6;
  const words = reel.voiceover.split(/\s+/).filter(Boolean).length;
  if (words / WORDS_PER_SECOND > room)
    warnings.push(
      `Reel ${reel.id}: the voice-over has ${words} words (about ${(words / WORDS_PER_SECOND).toFixed(1)} s) for ${room.toFixed(1)} s of reel; shorten it or give the scenes more seconds.`,
    );
}
if (checkOnly) {
  console.log(
    JSON.stringify({
      ok: true,
      bpm,
      warnings,
      reels: reels.map((reel) => {
        const t = reelTimeline(reel);
        return {
          id: reel.id,
          seconds: Number((t.total / FPS).toFixed(2)),
          scenes: reel.scenes.length,
          transitions: t.transitions,
        };
      }),
    }),
  );
  process.exit(0);
}

NodeFS.mkdirSync(outDir, { recursive: true });

// The voice: the professional one is the person's own ElevenLabs; without it the local Piper
// voice makes a PREVIEW (file names and the result lines say so).
const voiced = reels.filter((reel) => reel.voiceover);
const voiceChoice =
  voiced.length && requestedVoice !== "none"
    ? resolveVoice(requestedVoice, process.env)
    : { voice: "none", fellBack: false };
const voiceLines = voiced.length
  ? voiceReportLines(voiceChoice.voice, voiceLanguage, voiceChoice.fellBack)
  : [];
const voiceFiles = new Map();
async function speak(reel) {
  const dir = NodePath.join(outDir, "voice");
  NodeFS.mkdirSync(dir, { recursive: true });
  if (voiceChoice.voice === "elevenlabs") {
    const voice = process.env.ZEN_ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({ text: reel.voiceover, model_id: "eleven_multilingual_v2" }),
    }).catch((error) => fail(`ElevenLabs could not be reached: ${error.message}`));
    if (!response.ok) fail(`ElevenLabs refused the voice-over of ${reel.id} (${response.status}).`);
    const file = NodePath.join(dir, `${reel.id}.mp3`);
    NodeFS.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return file;
  }
  const model =
    voiceLanguage === "ro" ? process.env.ZEN_PIPER_VOICE_RO : process.env.ZEN_PIPER_VOICE_EN;
  const python = process.env.ZEN_TOOL_PIPER_PYTHON;
  if (!model || !NodeFS.existsSync(model) || !python)
    fail(
      "The local preview voice is not installed. Start the task from Zen Staff again, or use --voice elevenlabs or --voice none.",
    );
  const file = NodePath.join(dir, previewFileName(`${reel.id}.wav`));
  const spoken = NodeChildProcess.spawnSync(
    python,
    ["-m", "piper", "-m", model, "-f", file, "--sentence-silence", "0.3"],
    { input: Buffer.from(reel.voiceover, "utf8") },
  );
  if (spoken.status !== 0) fail(`The local preview voice could not read the text of ${reel.id}.`);
  return file;
}
const secondsOf = (file) =>
  Number(
    NodeChildProcess.spawnSync(
      T.ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    ).stdout,
  );
if (voiceChoice.voice !== "none") {
  console.log(
    voiceChoice.voice === "elevenlabs"
      ? "Recording the voice-overs..."
      : "Recording the preview voice-overs...",
  );
  for (const reel of voiced) {
    const file = await speak(reel);
    const room = reelTimeline(reel).total / FPS - VOICE_START - 0.3;
    const seconds = secondsOf(file);
    if (!(seconds > 0)) fail(`The voice-over of ${reel.id} came out empty.`);
    if (seconds > room)
      fail(
        `Reel ${reel.id}: the voice-over lasts ${seconds.toFixed(1)} s but the reel leaves ${room.toFixed(1)} s for it; shorten the voiceover text or give the scenes more seconds.`,
      );
    voiceFiles.set(reel.id, file);
  }
}

const { work, publicDir, cleanup } = makePublic(T.fontsDir);
console.log("Preparing photos and clips...");
prepareMedia({ ffmpeg: T.ffmpeg, files: used, from: mediaDir, publicDir });
for (const reel of reels) {
  const t = reelTimeline(reel);
  const name = `_zen/score-${reel.id}.wav`;
  const { wav } = makeScore({
    mood: mood ?? "none",
    seconds: t.total / FPS,
    endAt: t.endStart / FPS,
    cues: t.cues,
    seed: 7,
    musicGain: 1,
  });
  NodeFS.writeFileSync(NodePath.join(publicDir, name), wav);
  reel.audio = name;
  if (musicFile) reel.music = musicFile;
  const voice = voiceFiles.get(reel.id);
  if (voice) {
    // One track: the voice levelled, the score and the own music ducked under it.
    const mixName = `_zen/mix-${reel.id}.wav`;
    const mixed = mixVoiceOver({
      ffmpeg: T.ffmpeg,
      music: [
        { file: NodePath.join(publicDir, name) },
        ...(musicFile
          ? [{ file: NodePath.join(mediaDir, musicFile), gainDb: -1.5, fadeIn: 0.3, fadeOut: 1 }]
          : []),
      ],
      voices: [{ file: voice, at: VOICE_START }],
      duration: t.total / FPS,
      out: NodePath.join(publicDir, mixName),
      stems: stemsDir ? NodePath.join(stemsDir, reel.id) : undefined,
    });
    reel.mix = mixName;
    reel.aiVoiceLabel = aiVoiceLabel(voiceLanguage);
    reel.ducking = {
      musicUnderVoiceDb: mixed.levels.downDb,
      musicBetweenLinesDb: mixed.levels.upDb,
      voiceSegments: mixed.segments,
    };
  }
}

console.log("Preparing the video template...");
const started = Date.now();
const serveUrl = await bundleTemplate({
  require: T.require,
  modules: T.modules,
  entryPoint: NodePath.join(here, "src", "index.jsx"),
  rootDir: NodePath.dirname(here),
  publicDir,
  work,
});
const checkDir = NodePath.join(outDir, "check");
NodeFS.mkdirSync(checkDir, { recursive: true });
const font = NodePath.join(T.fontsDir, "Barlow-SemiBold.ttf");
const results = [];
for (const reel of reels) {
  const { caption: _caption, voiceover: _voiceover, ducking, ...props } = reel;
  const preview = Boolean(reel.mix) && voiceChoice.voice === "preview";
  const video = NodePath.join(
    outDir,
    preview ? previewFileName(`${reel.id}.mp4`) : `${reel.id}.mp4`,
  );
  const { composition, seconds: renderSeconds } = await renderVideo({
    require: T.require,
    serveUrl,
    id: "Reel",
    inputProps: props,
    output: video,
    q,
    browser: T.browser,
    label: reel.id,
  });
  const loud = normalizeLoudness(T.ffmpeg, video, { target: reel.mix ? -16 : -14 });
  const poster = video.replace(/\.mp4$/, ".jpg");
  const t = reelTimeline(reel);
  // The cover: the hook with its headline fully in.
  await renderPoster({
    require: T.require,
    serveUrl,
    composition,
    inputProps: props,
    output: poster,
    frame: Math.min(t.frames[0] - 4, Math.round(1.4 * FPS)),
    q,
    browser: T.browser,
  });
  const sheet = contactSheet(
    T.ffmpeg,
    T.ffprobe,
    video,
    NodePath.join(checkDir, `${reel.id}-contact.jpg`),
    { every: 0.5, font, thumb: q.draft ? 160 : 216 },
  );
  const info = probeVideo(T.ffprobe, video);
  const cuts = [];
  let at = 0;
  for (const f of t.frames) {
    cuts.push(at + f * 0.6);
    at += f;
  }
  cuts.push(at + t.endFrames * 0.7);
  const safe = safeSheet(T.ffmpeg, video, NodePath.join(checkDir, `${reel.id}-safe.jpg`), {
    times: cuts.map((frame) => frame / FPS),
    width: info.width,
    height: info.height,
    thumb: 300,
  });
  results.push({
    id: reel.id,
    video,
    poster,
    contactSheet: sheet,
    safeSheet: safe,
    seconds: Number(info.seconds.toFixed(2)),
    size: `${info.width}x${info.height}`,
    audio: info.audio,
    loudnessLufs: loud ? Number(loud.lufs.toFixed(1)) : null,
    truePeak: loud ? Number(loud.truePeak.toFixed(1)) : null,
    voice: reel.mix ? voiceChoice.voice : "none",
    ducking: ducking ?? null,
    blackStretches: blackStretches(T.ffmpeg, video),
    transitions: t.transitions,
    sizeMB: Number(info.sizeMB.toFixed(1)),
    renderSeconds,
  });
  console.log(`${reel.id}: done in ${renderSeconds} s`);
}

const captionLines = ["# Captions", ""];
for (const reel of reels)
  captionLines.push(`## ${reel.id}`, "", reel.caption || "(no caption written)", "");
if (!only) NodeFS.writeFileSync(NodePath.join(outDir, "captions.md"), captionLines.join("\n"));
const posters = results.map((result) => result.poster);
if (posters.length > 1)
  pageSheet(T.ffmpeg, posters, NodePath.join(outDir, "overview.jpg"), { thumb: 640, columns: 5 });
cleanup();
const [width, height] = FORMATS[plan.format];
console.log(
  JSON.stringify(
    {
      quality: q.name,
      format: `${width}x${height}`,
      bpm,
      renderSeconds: Math.round((Date.now() - started) / 1000),
      voice: voiceChoice.voice,
      voiceNotice: voiceLines,
      warnings,
      reels: results,
    },
    null,
    1,
  ),
);
