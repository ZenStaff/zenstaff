// Lists the photos and clips in a folder (size, orientation, length) and makes one numbered
// contact sheet, so the agent can see every file before planning the reels.
// Usage: node kit/check/inspect.mjs --media <folder> --out <folder> (shared by the video packs)
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const mediaDir = NodePath.resolve(option("media") ?? ".");
const outDir = NodePath.resolve(option("out") ?? ".");
const ffmpeg = process.env.ZEN_TOOL_FFMPEG || "ffmpeg";
const ffprobe = process.env.ZEN_TOOL_FFPROBE || "ffprobe";
const font = process.env.ZEN_FONTS_DIR
  ? NodePath.join(process.env.ZEN_FONTS_DIR, "Barlow-SemiBold.ttf")
  : null;
if (!NodeFS.existsSync(mediaDir)) fail(`${mediaDir} does not exist.`);
NodeFS.mkdirSync(outDir, { recursive: true });

const files = NodeFS.readdirSync(mediaDir)
  .filter((name) => /\.(jpe?g|png|webp|mp4|mov|m4v|webm)$/i.test(name))
  .toSorted();
if (files.length === 0) fail(`No photos (JPG, PNG, WebP) or clips (MP4, MOV) in ${mediaDir}.`);
const list = [];
for (const name of files) {
  const probe = NodeChildProcess.spawnSync(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height,codec_type:stream_side_data=rotation:format=duration",
      "-of",
      "json",
      NodePath.join(mediaDir, name),
    ],
    { encoding: "utf8" },
  );
  const info = JSON.parse(probe.stdout || "{}");
  const video = (info.streams ?? []).find((stream) => stream.codec_type === "video") ?? {};
  const rotation = Math.abs(Number(video.side_data_list?.[0]?.rotation ?? 0));
  const [w, h] =
    rotation === 90 || rotation === 270 ? [video.height, video.width] : [video.width, video.height];
  const isClip = /\.(mp4|mov|m4v|webm)$/i.test(name);
  list.push({
    number: list.length + 1,
    file: name,
    kind: isClip ? "clip" : "photo",
    width: w,
    height: h,
    orientation:
      !w || !h ? "unknown" : h / w > 1.15 ? "vertical" : w / h > 1.15 ? "landscape" : "square",
    seconds: isClip ? Number(Number(info.format?.duration ?? 0).toFixed(1)) : undefined,
    usable: Boolean(w && h && Math.min(w, h) >= 600),
  });
}
// Numbered thumbnails, five per row.
const thumbs = [];
const tmp = NodeFS.mkdtempSync(NodePath.join(outDir, ".sheet-"));
for (const item of list) {
  const thumb = NodePath.join(tmp, `${String(item.number).padStart(3, "0")}.png`);
  const label = font
    ? `,drawbox=x=0:y=ih-56:w=iw:h=56:color=black@0.7:t=fill,drawtext=fontfile='${font}':text='${item.number}':x=14:y=h-46:fontsize=38:fontcolor=white`
    : "";
  NodeChildProcess.spawnSync(ffmpeg, [
    "-y",
    "-v",
    "error",
    ...(item.kind === "clip" ? ["-ss", String(Math.min(1, (item.seconds ?? 2) / 2))] : []),
    "-i",
    NodePath.join(mediaDir, item.file),
    "-frames:v",
    "1",
    "-vf",
    `scale=300:300:force_original_aspect_ratio=increase,crop=300:300,format=rgb24${label}`,
    thumb,
  ]);
  if (NodeFS.existsSync(thumb)) thumbs.push(thumb);
}
const columns = Math.min(5, thumbs.length);
const sheet = NodePath.join(outDir, "media-sheet.jpg");
NodeChildProcess.spawnSync(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-framerate",
  "1",
  "-i",
  NodePath.join(tmp, "%03d.png"),
  "-vf",
  `tile=${columns}x${Math.ceil(thumbs.length / columns)}:padding=6:color=white`,
  "-frames:v",
  "1",
  "-q:v",
  "3",
  sheet,
]);
NodeFS.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ sheet, media: list }, null, 1));
