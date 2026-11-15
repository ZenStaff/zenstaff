// Node side of the motion kit: everything a pack's render script needs around Remotion, so the
// packs share one way to prepare media, bundle, render, master the sound and make review sheets.
// Tools come only from the ZEN_* variables Zen Staff sets for the task.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { FONT_FILES } from "../common/type.js";

export function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

export function options(argv = process.argv.slice(2)) {
  return {
    get: (name, fallback) => {
      const index = argv.indexOf(`--${name}`);
      return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
    },
    has: (name) => argv.includes(`--${name}`),
  };
}

/**
 * Draft: half resolution, faster encode, no grain, for checking the cut and the words.
 * Final: full resolution, high quality, mastered sound. Render a draft first, review its contact
 * sheet, then render the final.
 */
export const QUALITY = {
  draft: { scale: 0.5, crf: 26, jpegQuality: 70, draft: true, x264Preset: "veryfast" },
  final: { scale: 1, crf: 17, jpegQuality: 92, draft: false, x264Preset: "medium" },
};

export function quality(name = "final") {
  const q = QUALITY[name];
  if (!q) fail('--quality must be "draft" or "final".');
  return { name, ...q };
}

export function run(command, args, extra = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...extra,
  });
  if (result.error) fail(`${NodePath.basename(command)} could not start: ${result.error.message}`);
  return result;
}

export function tools() {
  const modules = process.env.ZEN_REMOTION_MODULES;
  if (!modules || !NodeFS.existsSync(modules))
    fail(
      "The Remotion tools are not prepared (ZEN_REMOTION_MODULES is not set). Start the task from Zen Staff.",
    );
  const fontsDir = process.env.ZEN_FONTS_DIR;
  if (!fontsDir || !NodeFS.existsSync(fontsDir))
    fail("The fonts are not prepared (ZEN_FONTS_DIR is not set). Start the task from Zen Staff.");
  return {
    modules,
    fontsDir,
    ffmpeg: process.env.ZEN_TOOL_FFMPEG || "ffmpeg",
    ffprobe: process.env.ZEN_TOOL_FFPROBE || "ffprobe",
    browser: process.env.ZEN_REMOTION_BROWSER || null,
    require: NodeModule.createRequire(NodePath.join(modules, "zen-render.cjs")),
  };
}

/** A temporary public folder with the kit's fonts in _zen/fonts. Remove it with cleanup(). */
export function makePublic(fontsDir) {
  const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-render-"));
  const publicDir = NodePath.join(work, "public");
  NodeFS.mkdirSync(NodePath.join(publicDir, "_zen", "fonts"), { recursive: true });
  for (const name of new Set(FONT_FILES.map(([, file]) => file))) {
    const from = NodePath.join(fontsDir, name);
    if (!NodeFS.existsSync(from))
      fail(
        `Font ${name} is missing from ${fontsDir}. Update the fonts in Settings > General > Tools.`,
      );
    NodeFS.copyFileSync(from, NodePath.join(publicDir, "_zen", "fonts", name));
  }
  return { work, publicDir, cleanup: () => NodeFS.rmSync(work, { recursive: true, force: true }) };
}

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg)$/i;

/**
 * Copies the media a plan uses into the public folder, ready for fast rendering: clips become
 * constant 30 fps H.264 (phone HEVC, variable frame rate and rotation would slow or break the
 * render), photos are limited to `maxSide` px (a 6000 px photo costs seconds per frame).
 */
export function prepareMedia({ ffmpeg, files, from, publicDir, maxSide = 2160, clipSeconds = 60 }) {
  for (const file of files) {
    const source = NodePath.join(from, file);
    const target = NodePath.join(publicDir, file);
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    if (VIDEO.test(file)) {
      const result = run(ffmpeg, [
        "-y",
        "-v",
        "error",
        "-i",
        source,
        "-t",
        String(clipSeconds),
        "-an",
        "-vf",
        `scale='min(${maxSide},iw)':-2,fps=30,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        target,
      ]);
      if (result.status !== 0)
        fail(
          `The clip ${file} could not be read: ${(result.stderr ?? "").trim().split("\n").pop()}`,
        );
    } else if (IMAGE.test(file)) {
      const png = /\.png$/i.test(file);
      const result = run(ffmpeg, [
        "-y",
        "-v",
        "error",
        "-i",
        source,
        "-vf",
        `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`,
        ...(png ? [] : ["-q:v", "2"]),
        target,
      ]);
      if (result.status !== 0) NodeFS.copyFileSync(source, target);
    } else if (AUDIO.test(file)) {
      NodeFS.copyFileSync(source, target);
    } else {
      fail(`${file}: use JPG, PNG or WebP photos, MP4/MOV clips and MP3/WAV/M4A music.`);
    }
  }
}

/** Bundles a template whose imports reach the kit next to it; Remotion comes from the toolchain. */
export async function bundleTemplate({ require, modules, entryPoint, rootDir, publicDir, work }) {
  const { bundle } = require("@remotion/bundler");
  const withModules = (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      modules: [modules, ...(config.resolve?.modules ?? ["node_modules"])],
    },
    resolveLoader: {
      ...config.resolveLoader,
      modules: [modules, ...(config.resolveLoader?.modules ?? ["node_modules"])],
    },
  });
  return bundle({
    entryPoint,
    rootDir,
    publicDir,
    outDir: NodePath.join(work, "bundle"),
    enableCaching: false,
    webpackOverride: withModules,
  });
}

/** Renders one composition to MP4 and returns the time it took in seconds. */
export async function renderVideo({
  require,
  serveUrl,
  id,
  inputProps,
  output,
  q,
  browser,
  label = id,
}) {
  const { renderMedia, selectComposition } = require("@remotion/renderer");
  const started = Date.now();
  const composition = await selectComposition({
    serveUrl,
    id,
    inputProps,
    browserExecutable: browser,
  });
  const concurrency = Math.max(1, Math.min(8, Math.floor(NodeOS.availableParallelism() / 2)));
  let shown = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: q.crf,
    x264Preset: q.x264Preset,
    audioBitrate: "192k",
    outputLocation: output,
    inputProps,
    scale: q.scale,
    concurrency,
    browserExecutable: browser,
    onProgress: ({ progress }) => {
      const step = Math.floor(progress * 4);
      if (step > shown) {
        shown = step;
        console.log(`${label}: ${step * 25}%`);
      }
    },
  });
  return { composition, seconds: Math.round((Date.now() - started) / 1000) };
}

export async function renderPoster({
  require,
  serveUrl,
  composition,
  inputProps,
  output,
  frame,
  q,
  browser,
}) {
  const { renderStill } = require("@remotion/renderer");
  await renderStill({
    composition,
    serveUrl,
    output,
    inputProps,
    frame,
    imageFormat: "jpeg",
    jpegQuality: q.jpegQuality,
    scale: q.scale,
    browserExecutable: browser,
  });
}

/** Seconds of near-black frames (a broken clip or a missing photo shows up as black). */
export function blackStretches(ffmpeg, video) {
  const result = run(ffmpeg, [
    "-v",
    "info",
    "-i",
    video,
    "-vf",
    "blackdetect=d=0.4:pix_th=0.06",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  return (result.stderr.match(/black_start/g) ?? []).length;
}
