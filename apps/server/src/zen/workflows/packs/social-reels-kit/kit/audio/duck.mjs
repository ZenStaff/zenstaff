// Music ducking under a voice-over: the voice levelled to -16 LUFS, the music set by a gain
// envelope built from the speech segments (known timings or silencedetect), about 12 dB under the
// voice while it speaks and back up between lines. master.mjs then makes the final linear
// -16 LUFS pass (true peak under -1 dBTP).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { measureLoudness } from "./master.mjs";

/** Defaults: voice 12 dB over the music while speaking, music 6 dB up between lines. */
export const DUCK = {
  gapDb: 12,
  liftDb: 6,
  /** Seconds: the music starts down this long before a line, takes `attack` to get there. */
  lead: 0.1,
  attack: 0.18,
  /** Seconds the music stays down after a line, then the time it takes to come back up. */
  hold: 0.2,
  release: 0.6,
  /** Pauses shorter than this stay ducked (no pumping between close sentences). */
  minGap: 0.9,
  voiceLufs: -16,
  voiceTruePeak: -2,
  /** Never push the music up more than this, nor down more than `maxCutDb`. */
  maxBoostDb: 10,
  maxCutDb: -40,
};

const round = (value, digits = 3) => Number(value.toFixed(digits));

/** Silence intervals from FFmpeg silencedetect output, [{ start, end }] in seconds. */
export function parseSilences(stderr) {
  const out = [];
  let open = null;
  for (const line of String(stderr ?? "").split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) open = Math.max(0, Number(start[1]));
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end) {
      out.push({ start: open ?? 0, end: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: Infinity });
  return out;
}

/** Merges segments that overlap or sit closer than `gap` seconds; sorts them. */
export function mergeSegments(segments, gap = 0) {
  const sorted = segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start - last.end < gap) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** An FFmpeg aselect expression for the segments (undefined when they are too short to measure). */
export function speechSelect(segments) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  if (total < 0.5) return undefined;
  return segments.map((s) => `between(t,${round(s.start)},${round(s.end)})`).join("+");
}

/** Speech segments of a track of `duration` seconds: everything that is not silence. */
export function speechFromSilences(silences, duration, { minSpeech = 0.12 } = {}) {
  const quiet = mergeSegments(
    silences.map((s) => ({ start: s.start, end: Math.min(duration, s.end) })),
  );
  const out = [];
  let at = 0;
  for (const s of quiet) {
    if (s.start - at >= minSpeech) out.push({ start: round(at), end: round(s.start) });
    at = Math.max(at, s.end);
  }
  if (duration - at >= minSpeech) out.push({ start: round(at), end: round(duration) });
  return out;
}

/**
 * Music gains in dB: `downDb` while the voice speaks (music `gapDb` under the voice) and `upDb`
 * between lines (`liftDb` higher). Without music (null or silent) both are 0.
 */
export function duckLevels({
  voiceLufs,
  musicLufs,
  gapDb = DUCK.gapDb,
  liftDb = DUCK.liftDb,
  maxBoostDb = DUCK.maxBoostDb,
  maxCutDb = DUCK.maxCutDb,
}) {
  if (!Number.isFinite(voiceLufs) || !Number.isFinite(musicLufs) || musicLufs < -60)
    return { downDb: 0, upDb: 0 };
  const limit = (db) => Math.max(maxCutDb, Math.min(maxBoostDb, db));
  const downDb = limit(voiceLufs - gapDb - musicLufs);
  return { downDb: round(downDb, 2), upDb: round(limit(downDb + liftDb), 2) };
}

/**
 * The gain envelope for the music: [{ t, db }] breakpoints, linear in dB between them, from 0 to
 * `duration`. Lines closer than `minGap` share one dip, so the music only comes back up in real
 * pauses.
 */
export function duckEnvelope(
  segments,
  {
    duration,
    downDb,
    upDb,
    lead = DUCK.lead,
    attack = DUCK.attack,
    hold = DUCK.hold,
    release = DUCK.release,
    minGap = DUCK.minGap,
  },
) {
  const dips = mergeSegments(
    segments.map((s) => ({ start: Math.max(0, s.start), end: Math.min(duration, s.end) })),
    Math.max(minGap, lead + attack + hold + release),
  );
  const points = [{ t: 0, db: upDb }];
  const push = (t, db) => {
    const last = points.at(-1);
    const time = round(Math.min(duration, Math.max(last.t, t)));
    if (time === last.t) last.db = db;
    else points.push({ t: time, db });
  };
  for (const dip of dips) {
    const down = dip.start - lead;
    push(down - attack, upDb);
    if (down - attack <= 0) points[0].db = downDb;
    push(down, downDb);
    push(dip.end + hold, downDb);
    push(dip.end + hold + release, upDb);
  }
  push(duration, points.at(-1).db);
  return points;
}

/** The envelope's gain in dB at `t` seconds. */
export function gainAt(points, t) {
  if (!points.length) return 0;
  if (t <= points[0].t) return points[0].db;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) return b.t === a.t ? b.db : a.db + ((b.db - a.db) * (t - a.t)) / (b.t - a.t);
  }
  return points.at(-1).db;
}

/**
 * An FFmpeg `volume` expression (linear gain from t) for the envelope: a flat sum of one term
 * per piece, so long voice-overs do not nest deeply. Use with eval=frame.
 */
export function volumeExpression(points) {
  const n = (v) => String(round(v, 4));
  const terms = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.t <= a.t) continue;
    const range = `between(t,${n(a.t)},${n(b.t)})*lt(t,${n(b.t)})`;
    const value =
      a.db === b.db ? n(a.db) : `(${n(a.db)}+${n(b.db - a.db)}*(t-${n(a.t)})/${n(b.t - a.t)})`;
    terms.push(`${range}*${value}`);
  }
  const last = points.at(-1) ?? { t: 0, db: 0 };
  terms.push(`gte(t,${n(last.t)})*${n(last.db)}`);
  return `pow(10,(${terms.join("+")})/20)`;
}

/** Filter graph for the voice stem: inputs placed at their start times, levelled, cut to length. */
export function voiceGraph(
  voices,
  duration,
  { lufs = DUCK.voiceLufs, truePeak = DUCK.voiceTruePeak } = {},
) {
  const parts = voices.map(
    (v, i) =>
      `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(Math.max(0, v.at) * 1000)}:all=1[v${i}]`,
  );
  const sum =
    voices.length > 1
      ? `${voices.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voices.length}:normalize=0:duration=longest[vs]`
      : `[v0]anull[vs]`;
  const level = lufs === null ? "anull" : `loudnorm=I=${lufs}:TP=${truePeak}:LRA=7,aresample=48000`;
  return `${parts.join(";")};${sum};[vs]apad,atrim=0:${round(duration)},${level}[out]`;
}

/** Filter graph for the music stem: each source at its gain, faded, summed, cut to length. */
export function musicGraph(music, duration) {
  const d = round(duration);
  const parts = music.map((m, i) => {
    const fades = [
      m.fadeIn ? `afade=t=in:d=${m.fadeIn}` : null,
      m.fadeOut
        ? `afade=t=out:st=${round(Math.max(0, duration - m.fadeOut))}:d=${m.fadeOut}`
        : null,
    ].filter(Boolean);
    return `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${m.gainDb ?? 0}dB,apad,atrim=0:${d}${fades.length ? `,${fades.join(",")}` : ""}[m${i}]`;
  });
  const sum =
    music.length > 1
      ? `${music.map((_, i) => `[m${i}]`).join("")}amix=inputs=${music.length}:normalize=0:duration=longest`
      : `[m0]anull`;
  return `${parts.join(";")};${sum},atrim=0:${d}[out]`;
}

/**
 * Mix graph: input 0 is the music stem, input 1 the voice stem. The music follows the envelope
 * (small frames so the ramps are smooth) and the two are summed.
 */
export function duckMixGraph(points) {
  return `${duckGraph(points, "duck")};[duck][1:a]amix=inputs=2:normalize=0:duration=first[out]`;
}

/**
 * Level graph for the mix: the gain that brings it to the target loudness, then a limiter that
 * keeps sample peaks at -2.5 dBFS, so the video's -16 LUFS master stays linear (true peak under
 * -1 dBTP after the AAC encode).
 */
export function levelGraph(gainDb) {
  return `[0:a]volume=${round(gainDb, 2)}dB,alimiter=limit=0.75:attack=5:release=60:level=disabled[out]`;
}

/** The music stem (input 0) following the envelope, labelled `label`. */
export function duckGraph(points, label = "out") {
  return `[0:a]asetnsamples=n=256:p=0,volume='${volumeExpression(points)}':eval=frame[${label}]`;
}

const run = (bin, args) => {
  const result = NodeChildProcess.spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`ffmpeg: ${(result.stderr ?? "").trim().split("\n").slice(-2).join(" ")}`);
  return result;
};

/** Speech segments of an audio file (seconds), found with silencedetect. */
export function detectSpeech(ffmpeg, file, duration, { noiseDb = -42, minSilence = 0.3 } = {}) {
  const result = run(ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-af",
    `silencedetect=noise=${noiseDb}dB:d=${minSilence}`,
    "-f",
    "null",
    "-",
  ]);
  return speechFromSilences(parseSilences(result.stderr), duration);
}

/**
 * Mixes voices [{ file, at }] over music [{ file, gainDb?, fadeIn?, fadeOut? }] with ducking into
 * a 48 kHz WAV at `target` LUFS. `segments` (seconds) when known, else found in the voice stem;
 * `stems`: a folder to keep voice.wav and music-ducked.wav in for checks.
 */
export function mixVoiceOver({
  ffmpeg,
  music = [],
  voices,
  duration,
  out,
  segments,
  gapDb = DUCK.gapDb,
  liftDb = DUCK.liftDb,
  target = -16,
  stems,
}) {
  const work = NodeFS.mkdtempSync(NodePath.join(NodePath.dirname(out), ".zen-mix-"));
  try {
    const voiceStem = NodePath.join(work, "voice.wav");
    run(ffmpeg, [
      "-y",
      "-v",
      "error",
      ...voices.flatMap((v) => ["-i", v.file]),
      "-filter_complex",
      voiceGraph(voices, duration),
      "-map",
      "[out]",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      voiceStem,
    ]);
    const musicStem = NodePath.join(work, "music.wav");
    if (music.length) {
      run(ffmpeg, [
        "-y",
        "-v",
        "error",
        ...music.flatMap((m) => ["-i", m.file]),
        "-filter_complex",
        musicGraph(music, duration),
        "-map",
        "[out]",
        "-ar",
        "48000",
        "-c:a",
        "pcm_f32le",
        musicStem,
      ]);
    } else {
      run(ffmpeg, [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-t",
        String(round(duration)),
        "-c:a",
        "pcm_f32le",
        musicStem,
      ]);
    }
    const speech = segments ?? detectSpeech(ffmpeg, voiceStem, duration);
    // Both measured where the voice speaks: the gap is what the listener hears there (a bed
    // with loud hits elsewhere would otherwise end up too quiet under the voice).
    const select = speechSelect(speech);
    const voiceLufs = measureLoudness(ffmpeg, voiceStem, { select })?.lufs ?? null;
    const musicLufs = music.length
      ? (measureLoudness(ffmpeg, musicStem, { select })?.lufs ?? null)
      : null;
    const levels = duckLevels({ voiceLufs, musicLufs, gapDb, liftDb });
    const points = duckEnvelope(speech, { duration, ...levels });
    const raw = NodePath.join(work, "mix-raw.wav");
    run(ffmpeg, [
      "-y",
      "-v",
      "error",
      "-i",
      musicStem,
      "-i",
      voiceStem,
      "-filter_complex",
      duckMixGraph(points),
      "-map",
      "[out]",
      "-ar",
      "48000",
      "-c:a",
      "pcm_f32le",
      raw,
    ]);
    // Bring the mix to the target here (the pauses with music only pull the integrated loudness
    // down), so the master after the render is a small linear step.
    const mixLufs = measureLoudness(ffmpeg, raw)?.lufs;
    const gainDb = Number.isFinite(mixLufs) ? Math.max(-20, Math.min(12, target - mixLufs)) : 0;
    run(ffmpeg, [
      "-y",
      "-v",
      "error",
      "-i",
      raw,
      "-filter_complex",
      levelGraph(gainDb),
      "-map",
      "[out]",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      out,
    ]);
    if (stems) {
      NodeFS.mkdirSync(stems, { recursive: true });
      NodeFS.copyFileSync(voiceStem, NodePath.join(stems, "voice.wav"));
      run(ffmpeg, [
        "-y",
        "-v",
        "error",
        "-i",
        musicStem,
        "-filter_complex",
        duckGraph(points),
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        NodePath.join(stems, "music-ducked.wav"),
      ]);
    }
    return {
      out,
      segments: speech,
      points,
      levels,
      voiceLufs,
      musicLufs,
      gainDb: round(gainDb, 2),
    };
  } finally {
    NodeFS.rmSync(work, { recursive: true, force: true });
  }
}
