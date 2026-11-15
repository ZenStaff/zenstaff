// Final loudness: two-pass EBU R128 normalisation with FFmpeg's loudnorm, video stream copied.
// Reels/TikTok/YouTube play at about -14 LUFS; spoken tutorials sit at -16. True peak -1.5 dBTP.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const run = (bin, args) =>
  NodeChildProcess.spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * Integrated loudness (LUFS) and true peak of a file's audio, or null without audio. `select`:
 * an FFmpeg aselect expression to measure only those parts (for example the speech segments).
 */
export function measureLoudness(ffmpeg, file, { select } = {}) {
  const result = run(ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-af",
    `${select ? `aselect='${select}',asetpts=N/SR/TB,` : ""}loudnorm=print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  const json = (result.stderr ?? "").match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!json) return null;
  const data = JSON.parse(json[0]);
  return {
    lufs: Number(data.input_i),
    truePeak: Number(data.input_tp),
    lra: Number(data.input_lra),
    raw: data,
  };
}

/**
 * Rewrites `file` in place with its audio at `target` LUFS (two passes, linear when possible).
 * Returns the measured loudness after the change.
 */
export function normalizeLoudness(ffmpeg, file, { target = -14, truePeak = -1.5, lra = 11 } = {}) {
  const first = measureLoudness(ffmpeg, file);
  if (!first) return null;
  const m = first.raw;
  // loudnorm only scales linearly when the target range covers the source's: a ducked voice-over
  // (music up between lines) measures 12-14 LU, so the range follows the source (max 50).
  const range = Math.min(50, Math.max(lra, Math.ceil(Number(m.input_lra) || 0) + 1));
  const filter = `loudnorm=I=${target}:TP=${truePeak}:LRA=${range}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const temp = file.replace(/(\.\w+)$/, ".loud$1");
  const result = run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    file,
    "-c:v",
    "copy",
    "-af",
    filter,
    "-ar",
    "48000",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    temp,
  ]);
  if (result.status !== 0)
    throw new Error(`loudness: ${(result.stderr ?? "").trim().split("\n").pop()}`);
  NodeFS.renameSync(temp, file);
  return measureLoudness(ffmpeg, file);
}
