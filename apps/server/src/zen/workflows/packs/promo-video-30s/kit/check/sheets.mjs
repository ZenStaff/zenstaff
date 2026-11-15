// Review sheets for the self-check loop (FFmpeg only): contactSheet (a frame every 0.5 s with its
// timecode), safeSheet (frames with the Reels/TikTok hidden zones shaded) and pageSheet (images
// side by side). `font` is a TTF from the open-fonts toolchain for the timecodes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const run = (bin, args) =>
  NodeChildProcess.spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function probeVideo(ffprobe, file) {
  const result = run(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height,r_frame_rate:format=duration,size",
    "-of",
    "json",
    file,
  ]);
  const info = JSON.parse(result.stdout || "{}");
  const v = (info.streams ?? []).find((s) => s.codec_type === "video") ?? {};
  return {
    seconds: Number(info.format?.duration ?? 0),
    width: v.width,
    height: v.height,
    audio: (info.streams ?? []).some((s) => s.codec_type === "audio"),
    sizeMB: Number(info.format?.size ?? 0) / 1048576,
  };
}

const escapeFont = (font) => font.replace(/\\/g, "/").replace(/:/g, "\\:");

/** A grid of frames every `every` seconds with timecodes. Returns the sheet path. */
export function contactSheet(
  ffmpeg,
  ffprobe,
  video,
  out,
  { every = 0.5, columns, thumb = 240, font } = {},
) {
  const info = probeVideo(ffprobe, video);
  const count = Math.max(1, Math.floor(info.seconds / every));
  const cols = columns ?? (info.height > info.width ? 10 : 6);
  const rows = Math.ceil(count / cols);
  const label =
    font && NodeFS.existsSync(font)
      ? `,drawtext=fontfile='${escapeFont(font)}':text='%{eif\\:t\\:d}.%{eif\\:mod(t*10\\,10)\\:d}s':x=8:y=h-th-8:fontsize=${Math.round(thumb / 9)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=4`
      : "";
  const filter = `fps=1/${every},scale=${thumb}:-2${label},tile=${cols}x${rows}:padding=6:margin=6:color=0x1b1b1b`;
  NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
  const result = run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    video,
    "-vf",
    filter,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
  if (result.status !== 0)
    throw new Error(`contact sheet: ${(result.stderr ?? "").trim().split("\n").pop()}`);
  return out;
}

/**
 * Frames at `times` with the zones the Reels/TikTok interface covers shaded red: if text or a
 * face sits in red, it will be hidden on the phone.
 */
export function safeSheet(ffmpeg, video, out, { times, width, height, thumb = 360 }) {
  const vertical = height / width > 1.6;
  const u = width / 1080;
  const boxes = vertical
    ? [
        [0, 0, width, Math.round(250 * u)],
        [0, height - Math.round(430 * u), width, Math.round(430 * u)],
        [
          width - Math.round(160 * u),
          Math.round(250 * u),
          Math.round(160 * u),
          height - Math.round(680 * u),
        ],
      ]
    : [];
  const shade = boxes
    .map(([x, y, w, h]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=red@0.28:t=fill`)
    .join(",");
  const parts = [];
  times.forEach((t, i) =>
    parts.push(
      `[0:v]trim=start=${t.toFixed(2)},setpts=PTS-STARTPTS,select='eq(n\\,0)'${shade ? `,${shade}` : ""},scale=${thumb}:-2[f${i}]`,
    ),
  );
  const filter = `${parts.join(";")};${times.map((_, i) => `[f${i}]`).join("")}hstack=inputs=${times.length}`;
  const args = [
    "-y",
    "-v",
    "error",
    "-i",
    video,
    "-filter_complex",
    times.length > 1 ? filter : parts[0].replace(/\[f0\]$/, ""),
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ];
  const result = run(ffmpeg, args);
  if (result.status !== 0)
    throw new Error(`safe sheet: ${(result.stderr ?? "").trim().split("\n").pop()}`);
  return out;
}

/** Images (page renders, social sizes) side by side in rows, scaled to `thumb` px high. */
export function pageSheet(ffmpeg, images, out, { thumb = 360, columns = 6 } = {}) {
  const rows = [];
  for (let i = 0; i < images.length; i += columns) rows.push(images.slice(i, i + columns));
  const inputs = images.flatMap((file) => ["-i", file]);
  const parts = images.map(
    (_, i) => `[${i}:v]scale=-2:${thumb},pad=iw+12:ih+12:6:6:color=0x1b1b1b[p${i}]`,
  );
  let k = 0;
  const rowLabels = rows.map((row, r) => {
    const labels = row.map(() => `[p${k++}]`).join("");
    parts.push(
      row.length > 1 ? `${labels}hstack=inputs=${row.length}[r${r}]` : `${labels}null[r${r}]`,
    );
    return `[r${r}]`;
  });
  if (rows.length > 1)
    parts.push(
      `${rowLabels.join("")}xstack=inputs=${rows.length}:layout=${rows.map((_, i) => (i === 0 ? "0_0" : `0_${Array.from({ length: i }, (_, j) => `h${j}`).join("+")}`)).join("|")}:fill=0x1b1b1b[out]`,
    );
  const map = rows.length > 1 ? "[out]" : "[r0]";
  const result = run(ffmpeg, [
    "-y",
    "-v",
    "error",
    ...inputs,
    "-filter_complex",
    parts.join(";"),
    "-map",
    map,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
  if (result.status !== 0)
    throw new Error(`page sheet: ${(result.stderr ?? "").trim().split("\n").pop()}`);
  return out;
}
