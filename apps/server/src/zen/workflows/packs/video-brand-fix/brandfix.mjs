// Brings a folder of videos on brand: cuts old endings, covers outdated text, adds the new intro and
// outro, evens out loudness and writes a report. Commands: scan --videos --out; outro --logo --size
// --title --lines; apply --plan --videos --out (see SKILL.md).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const tool = (name) => process.env[`ZEN_TOOL_${name.toUpperCase()}`] || name;
const ffmpeg = tool("ffmpeg");
const ffprobe = tool("ffprobe");
const fontsDir = process.env.ZEN_FONTS_DIR;
if (!fontsDir || !NodeFS.existsSync(fontsDir))
  fail("The fonts are not prepared (ZEN_FONTS_DIR is not set). Start the task from Zen Staff.");
const FONT = NodePath.join(fontsDir, "Barlow-SemiBold.ttf");
const run = (cmdArgs, { allowFail = false, cwd } = {}) => {
  const result = NodeChildProcess.spawnSync(ffmpeg, ["-y", "-v", "error", ...cmdArgs], {
    encoding: "utf8",
    cwd,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) fail(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0 && !allowFail)
    fail(`ffmpeg failed: ${result.stderr.trim().split("\n").slice(-2).join(" | ")}`);
  return result;
};
const probe = (file) => {
  const result = NodeChildProcess.spawnSync(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,avg_frame_rate:stream_side_data=rotation:format=duration",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  const info = JSON.parse(result.stdout || "{}");
  const v = (info.streams ?? []).find((s) => s.codec_type === "video");
  if (!v) return null;
  const rotation = Math.abs(Number(v.side_data_list?.[0]?.rotation ?? 0));
  const [num, den] = String(v.avg_frame_rate ?? "30/1")
    .split("/")
    .map(Number);
  return {
    width: rotation === 90 || rotation === 270 ? v.height : v.width,
    height: rotation === 90 || rotation === 270 ? v.width : v.height,
    fps: den ? Number((num / den).toFixed(2)) : 30,
    seconds: Number(Number(info.format?.duration ?? 0).toFixed(2)),
    audio: (info.streams ?? []).some((s) => s.codec_type === "audio"),
  };
};
// drawtext: escape for the filter graph, text passed through a file to avoid quoting trouble.
const esc = (value) => String(value).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
const listVideos = (dir) => {
  const found = [];
  const walk = (relative) => {
    for (const name of NodeFS.readdirSync(NodePath.join(dir, relative)).toSorted()) {
      if (name.startsWith(".")) continue;
      const rel = relative ? `${relative}/${name}` : name;
      const stat = NodeFS.statSync(NodePath.join(dir, rel));
      if (stat.isDirectory()) walk(rel);
      else if (VIDEO.test(name)) found.push(rel);
    }
  };
  walk("");
  return found;
};
const COLOR = /^#[0-9a-fA-F]{6}$/;
function scan() {
  const videosDir = NodePath.resolve(option("videos", "."));
  const out = NodePath.resolve(option("out", "brand-fix/work"));
  if (!NodeFS.existsSync(videosDir)) fail(`${videosDir} does not exist.`);
  const files = listVideos(videosDir);
  if (files.length === 0) fail(`No videos (MP4, MOV, M4V, WebM, MKV) in ${videosDir}.`);
  if (files.length > 300) fail(`${files.length} videos: run it on folders of up to 300.`);
  const sheets = NodePath.join(out, "sheets");
  NodeFS.mkdirSync(sheets, { recursive: true });
  const inventory = [];
  for (const [index, file] of files.entries()) {
    const abs = NodePath.join(videosDir, file);
    const info = probe(abs);
    if (!info) {
      inventory.push({ file, error: "not a readable video" });
      continue;
    }
    const id = String(index + 1).padStart(3, "0");
    const label = (expr) =>
      `drawtext=fontfile='${esc(FONT)}':text='${expr}':x=8:y=h-th-8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`;
    // Whole video: 12 evenly spaced frames, each stamped with its time.
    const step = Math.max(0.5, info.seconds / 12);
    const whole = NodePath.join(sheets, `${id}-whole.jpg`);
    run(
      [
        "-i",
        abs,
        "-vf",
        `fps=1/${step.toFixed(3)},scale=320:-2,${label("%{pts\\:hms}")},tile=6x2:padding=4:color=white`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        whole,
      ],
      { allowFail: true },
    );
    // The ending: last 6 seconds every 0.5 s, where old outros and prices usually sit.
    const start = Math.max(0, info.seconds - 6);
    const ending = NodePath.join(sheets, `${id}-ending.jpg`);
    run(
      [
        "-ss",
        start.toFixed(2),
        "-i",
        abs,
        "-vf",
        `fps=2,scale=320:-2,${label(`%{eif\\:t+${start.toFixed(2)}\\:d\\:1}.%{eif\\:mod((t+${start.toFixed(2)})*10\\,10)\\:d} s`)},tile=6x2:padding=4:color=white`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        ending,
      ],
      { allowFail: true },
    );
    // Hard cuts in the last 8 seconds: candidates for where an old outro begins.
    const cutsFrom = Math.max(0, info.seconds - 8);
    const cutScan = NodeChildProcess.spawnSync(
      ffmpeg,
      [
        "-v",
        "info",
        "-ss",
        cutsFrom.toFixed(2),
        "-i",
        abs,
        "-vf",
        "select='gt(scene,0.32)',showinfo",
        "-an",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8" },
    );
    const cuts = [...(cutScan.stderr ?? "").matchAll(/pts_time:([\d.]+)/g)].map((m) =>
      Number((Number(m[1]) + cutsFrom).toFixed(2)),
    );
    inventory.push({
      id,
      file,
      ...info,
      sheetWhole: whole,
      sheetEnding: ending,
      cutsNearEnd: cuts,
    });
    console.log(
      `${id} ${file}: ${info.width}x${info.height}, ${info.seconds}s${cuts.length ? `, cuts near the end at ${cuts.join(", ")} s` : ""}`,
    );
  }
  const target = NodePath.join(out, "inventory.json");
  NodeFS.writeFileSync(target, JSON.stringify({ videosDir, videos: inventory }, null, 1));
  console.log(JSON.stringify({ inventory: target, videos: inventory.length, sheets }, null, 1));
}
/** The deep brand color for the outro background: an explicit primary, else the darkest given. */
function outroPrimary(brand) {
  const lum = (h) => {
    const n = Number.parseInt(String(h).slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  };
  const candidates = [brand.primary, brand.text, brand.background].filter((c) =>
    COLOR.test(c ?? ""),
  );
  if (brand.primary && COLOR.test(brand.primary)) return brand.primary;
  return candidates.sort((x, y) => lum(x) - lum(y))[0] ?? "#1F4D3A";
}
/** Renders a kit job (outro video or text patch) in a child process; see outro.mjs. */
function renderKit(job) {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(import.meta.dirname, "outro.mjs"), JSON.stringify(job)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0)
    fail(
      `The ${job.kind} could not be made: ${(result.stderr || result.stdout || "").trim().split("\n").pop()}`,
    );
  return job.out;
}
function makeOutro({ logo, out, width, height, title, lines, brand, name, look, seconds = 3.5 }) {
  const file = NodePath.join(out, `outro-${width}x${height}.mp4`);
  if (NodeFS.existsSync(file)) return file;
  return renderKit({
    kind: "outro",
    out: file,
    width,
    height,
    seconds,
    brand: {
      name: name ?? "",
      primary: outroPrimary(brand),
      accent: COLOR.test(brand.accent ?? "") ? brand.accent : "#F2C14E",
      logo: logo ?? undefined,
    },
    title: title ?? "",
    lines: (lines ?? []).slice(0, 3),
    look: look ?? "modern",
  });
}
function apply() {
  const planPath = option("plan");
  const videosDir = NodePath.resolve(option("videos", "."));
  const out = NodePath.resolve(option("out", "brand-fix/output"));
  if (!planPath) fail("Use --plan <plan.json> --videos <folder> --out <folder>.");
  let plan;
  try {
    plan = JSON.parse(NodeFS.readFileSync(planPath, "utf8"));
  } catch (error) {
    fail(`The plan could not be read: ${error.message}`);
  }
  const brand = plan.brand ?? {};
  for (const key of ["background", "accent", "text", "primary"])
    if (brand[key] && !COLOR.test(brand[key])) fail(`brand.${key} must look like #1A2B3C.`);
  const resolveFile = (value, what) => {
    if (!value) return null;
    const abs = NodePath.resolve(value);
    if (!NodeFS.existsSync(abs)) fail(`${what} ${value} does not exist.`);
    return abs;
  };
  const outroVideo = resolveFile(plan.outro?.video, "The outro video");
  const outroLogo = resolveFile(plan.outro?.logo, "The logo");
  const introVideo = resolveFile(plan.intro?.video, "The intro video");
  if (!Array.isArray(plan.videos) || plan.videos.length === 0)
    fail('"videos" must list the videos to fix.');
  const work = NodePath.join(out, ".work");
  NodeFS.mkdirSync(work, { recursive: true });
  const report = [];
  const started = Date.now();
  for (const [index, entry] of plan.videos.entries()) {
    const where = `videos[${index}] (${entry.file})`;
    const source = NodePath.join(videosDir, entry.file ?? "");
    if (!entry.file || !NodeFS.existsSync(source))
      fail(`${where}: the file is not in ${videosDir}.`);
    const info = probe(source);
    if (!info) fail(`${where}: not a readable video.`);
    if (entry.action === "skip") {
      report.push({ file: entry.file, status: entry.status ?? "skipped", note: entry.note ?? "" });
      continue;
    }
    const W = info.width - (info.width % 2);
    const H = info.height - (info.height % 2);
    const end = entry.cutAt ? Math.min(Number(entry.cutAt), info.seconds) : info.seconds;
    if (!(end > 0.5)) fail(`${where}: cutAt leaves nothing.`);
    // Kept parts of the source timeline (removing "remove" ranges and everything after cutAt).
    let keep = [[0, end]];
    for (const [a, b] of entry.remove ?? []) {
      if (!(b > a)) fail(`${where}: each "remove" range is [from, to] in seconds.`);
      keep = keep.flatMap(([s, e]) =>
        b <= s || a >= e
          ? [[s, e]]
          : [a > s ? [s, a] : null, b < e ? [b, e] : null].filter(Boolean),
      );
    }
    keep = keep.filter(([s, e]) => e - s > 0.2);
    // Patches cover outdated text: a filled box (or a blur) with the corrected text on top.
    const vf = [];
    const patchInputs = [];
    for (const [p, patch] of (entry.patches ?? []).entries()) {
      const [x, y, w, h] = ["x", "y", "w", "h"].map((k) => Number(patch[k]));
      if ([x, y, w, h].some((n) => !(n >= 0 && n <= 100)) || !(patch.to > patch.from))
        fail(`${where}: patch ${p + 1} needs from/to in seconds and x, y, w, h in % of the frame.`);
      const px = Math.round((x / 100) * W);
      const py = Math.round((y / 100) * H);
      const pw = Math.round((w / 100) * W);
      const ph = Math.round((h / 100) * H);
      const enable = `enable='between(t,${patch.from},${patch.to})'`;
      // A box with no text on top reads as a black bar: without text, always blur.
      if (patch.fill === "blur" || !patch.text)
        vf.push(
          `[CUR]split[m${p}][c${p}];[c${p}]crop=${pw}:${ph}:${px}:${py},boxblur=20:2[b${p}];[m${p}][b${p}]overlay=${px}:${py}:${enable}[NEXT]`,
        );
      if (patch.text) {
        // The corrected words as a rounded label in the brand type, faded in and out.
        const png = renderKit({
          kind: "patch",
          out: NodePath.join(work, `patch-${index}-${p}.png`),
          width: pw,
          height: ph,
          text: patch.text,
          fill: patch.fill && COLOR.test(patch.fill) ? patch.fill : "#FFFFFF",
          color: patch.color && COLOR.test(patch.color) ? patch.color : undefined,
          bold: patch.bold,
          align: patch.align,
          look: plan.look ?? "modern",
        });
        patchInputs.push("-loop", "1", "-t", String(info.seconds), "-i", png);
        const n = patchInputs.filter((x) => x === "-i").length;
        const fadeOut = Math.max(patch.from, patch.to - 0.15);
        vf.push(
          `[${n}:v]format=rgba,fade=t=in:st=${patch.from}:d=0.15:alpha=1,fade=t=out:st=${fadeOut}:d=0.15:alpha=1[t${p}];[CUR][t${p}]overlay=${px}:${py}:${enable}:shortest=1[NEXT]`,
        );
      }
    }
    // Chain the patch filters on the source, then cut and normalize.
    let graph = "";
    let current = "0:v";
    vf.forEach((f, i) => {
      const next = `p${i}`;
      graph += `${f.replaceAll("[CUR]", `[${current}]`).replaceAll("[NEXT]", `[${next}]`)};`;
      current = next;
    });
    const norm = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
    const audioIn = info.audio ? "0:a" : "silence";
    if (!info.audio) graph += `anullsrc=r=48000:cl=stereo,atrim=0:${info.seconds}[silence];`;
    graph += `[${current}]split=${keep.length}${keep.map((_, i) => `[vs${i}]`).join("")};`;
    graph += `[${audioIn}]aresample=48000,aformat=channel_layouts=stereo,asplit=${keep.length}${keep.map((_, i) => `[as${i}]`).join("")};`;
    keep.forEach(([s, e], i) => {
      graph += `[vs${i}]trim=${s}:${e},setpts=PTS-STARTPTS,${norm}[vk${i}];[as${i}]atrim=${s}:${e},asetpts=PTS-STARTPTS[ak${i}];`;
    });
    graph += `${keep.map((_, i) => `[vk${i}][ak${i}]`).join("")}concat=n=${keep.length}:v=1:a=1[body_v][body_a]`;
    let bodySeconds = keep.reduce((sum, [s, e]) => sum + (e - s), 0);
    const inputs = ["-i", source, ...patchInputs];
    let videoLabel = "body_v";
    let audioLabel = "body_a";
    const XF = 0.3;
    const clipIn = (file, name) => {
      inputs.push("-i", file);
      const n = inputs.filter((x) => x === "-i").length - 1;
      const has = probe(file)?.audio;
      graph += `;[${n}:v]${norm},settb=AVTB[${name}_v]`;
      graph += has
        ? `;[${n}:a]aresample=48000,aformat=channel_layouts=stereo[${name}_a]`
        : `;anullsrc=r=48000:cl=stereo,atrim=0:${probe(file).seconds}[${name}_a]`;
      return probe(file).seconds;
    };
    graph += `;[body_v]settb=AVTB[body_vt]`;
    videoLabel = "body_vt";
    if (introVideo && entry.intro !== false) {
      const introSeconds = clipIn(introVideo, "intro");
      graph += `;[intro_v][${videoLabel}]xfade=transition=fade:duration=${XF}:offset=${(introSeconds - XF).toFixed(3)}[iv];[intro_a][${audioLabel}]acrossfade=d=${XF}[ia]`;
      videoLabel = "iv";
      audioLabel = "ia";
      bodySeconds += introSeconds - XF;
    }
    if (entry.outro !== false && (outroVideo || outroLogo || plan.outro?.title)) {
      const file =
        outroVideo ??
        makeOutro({
          logo: outroLogo,
          out: work,
          width: W,
          height: H,
          title: plan.outro?.title,
          lines: plan.outro?.lines,
          brand,
          name: plan.outro?.name ?? brand.name,
          look: plan.look,
          seconds: plan.outro?.seconds ?? 3.5,
        });
      clipIn(file, "outro");
      graph += `;[${videoLabel}][outro_v]xfade=transition=fade:duration=${XF}:offset=${(bodySeconds - XF).toFixed(3)}[ov];[${audioLabel}][outro_a]acrossfade=d=${XF}[oa]`;
      videoLabel = "ov";
      audioLabel = "oa";
    }
    const target = NodePath.join(out, entry.output ?? entry.file);
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    const temp = NodePath.join(work, `assembled-${index}.mkv`);
    run([
      ...inputs,
      "-filter_complex",
      graph,
      "-map",
      `[${videoLabel}]`,
      "-map",
      `[${audioLabel}]`,
      "-c:v",
      "libx264",
      "-crf",
      "19",
      "-preset",
      "medium",
      "-c:a",
      "pcm_s16le",
      temp,
    ]);
    // Loudness to -14 LUFS in two passes (measure, then apply), video copied as is.
    const measure = NodeChildProcess.spawnSync(
      ffmpeg,
      [
        "-v",
        "info",
        "-i",
        temp,
        "-af",
        "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8" },
    );
    const m = JSON.parse((measure.stderr.match(/\{[\s\S]*?\}/g) ?? ["{}"]).at(-1));
    const silent = !m.input_i || m.input_i === "-inf" || Number(m.input_i) < -60;
    const af = silent
      ? "anull"
      : `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    run([
      "-i",
      temp,
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-c:v",
      "copy",
      "-af",
      `${af},aresample=48000`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      target,
    ]);
    NodeFS.rmSync(temp, { force: true });
    const result = probe(target);
    // After-sheet: the last 5 seconds, to confirm the new ending.
    const after = NodePath.join(
      out,
      "check",
      `${String(index + 1).padStart(3, "0")}-after-ending.jpg`,
    );
    NodeFS.mkdirSync(NodePath.dirname(after), { recursive: true });
    run(
      [
        "-ss",
        Math.max(0, result.seconds - 5).toFixed(2),
        "-i",
        target,
        "-vf",
        "fps=2,scale=240:-2,tile=5x2:padding=4:color=white",
        "-frames:v",
        "1",
        "-q:v",
        "4",
        after,
      ],
      { allowFail: true },
    );
    report.push({
      file: entry.file,
      output: target,
      status: entry.status ?? "ready",
      before: `${info.seconds}s`,
      after: `${result.seconds}s`,
      size: `${result.width}x${result.height}`,
      changes: [
        entry.cutAt ? `old ending cut at ${entry.cutAt}s` : null,
        ...(entry.remove ?? []).map(([a, b]) => `removed ${a}-${b}s`),
        ...(entry.patches ?? []).map(
          (p) => `${p.text ? `"${p.text}"` : "covered"} at ${p.from}-${p.to}s`,
        ),
        introVideo && entry.intro !== false ? "intro" : null,
        entry.outro !== false ? "new outro" : null,
      ]
        .filter(Boolean)
        .join("; "),
      note: entry.note ?? "",
      check: after,
    });
    console.log(`${entry.file}: ${result.seconds}s, ${entry.status ?? "ready"}`);
  }
  NodeFS.rmSync(work, { recursive: true, force: true });
  const ready = report.filter((r) => r.status === "ready");
  const confirm = report.filter((r) => r.status !== "ready");
  const lines = [
    `# ${plan.title ?? "Brand update report"}`,
    "",
    `${report.length} videos checked: ${ready.length} ready to post, ${confirm.length} to confirm or redo.`,
    "",
    "Encoding: H.264 (CRF 19) + AAC 192 kbit/s, loudness -14 LUFS (two passes), fast start, original size, 30 fps.",
    "",
    "| Video | Result | Length before > after | Changes | Note |",
    "| ----- | ------ | --------------------- | ------- | ---- |",
    ...report.map(
      (r) =>
        `| ${r.file} | ${r.status} | ${r.before ?? "-"} > ${r.after ?? "-"} | ${(r.changes ?? "").replace(/\|/g, "/") || "-"} | ${(r.note ?? "").replace(/\|/g, "/") || "-"} |`,
    ),
    "",
    "## Ready to post",
    "",
    ...(ready.length ? ready.map((r) => `- ${r.output}`) : ["- none"]),
    "",
    "## To confirm or redo",
    "",
    ...(confirm.length ? confirm.map((r) => `- ${r.file}: ${r.note || r.status}`) : ["- none"]),
    "",
  ];
  const reportFile = NodePath.join(out, "REPORT.md");
  NodeFS.writeFileSync(reportFile, lines.join("\n"));
  console.log(
    JSON.stringify(
      {
        report: reportFile,
        ready: ready.length,
        toConfirm: confirm.length,
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      1,
    ),
  );
}

if (command === "scan") scan();
else if (command === "apply") apply();
else if (command === "outro") {
  const out = NodePath.resolve(option("out", "brand-fix/work"));
  NodeFS.mkdirSync(out, { recursive: true });
  const [width, height] = String(option("size", "1080x1920")).split("x").map(Number);
  const file = makeOutro({
    logo: option("logo") ? NodePath.resolve(option("logo")) : null,
    out,
    width,
    height,
    title: option("title"),
    lines: option("lines") ? option("lines").split("|") : [],
    brand: {
      primary: option("primary") ?? option("text"),
      background: option("bg"),
      accent: option("accent"),
    },
    name: option("name"),
    look: option("look"),
  });
  console.log(file);
} else fail("Use scan, outro or apply (see the guidance).");
