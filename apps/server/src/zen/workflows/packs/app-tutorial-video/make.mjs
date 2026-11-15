// Records a narrated tutorial from tutorial.json (voice, real browser, QA), then edits it with
// compose.mjs (window on the brand background, auto-zoom, eased cursor, step titles, captions).
// Usage: node make.mjs --storyboard tutorial/tutorial.json --out tutorial [--rehearse]
//   [--login <file>] [--force] [--quality draft|final]
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { handleCookies, pageProblems, resolveTarget } from "./browser.mjs";
import { FORMATS, fail, loadPlaywright, options, run, tool } from "./common.mjs";
import { composeTutorial } from "./compose.mjs";
import { previewFileName, resolveVoice, voiceReportLines } from "./voice-preview.mjs";

const opt = options(process.argv);
const storyboardPath = opt.get("storyboard");
if (!storyboardPath) fail("Use --storyboard <tutorial.json> --out <folder> [--rehearse].");
const out = NodePath.resolve(opt.get("out", NodePath.dirname(storyboardPath)));
const rehearse = opt.has("rehearse");
const force = opt.has("force");
const qualityName = opt.get("quality", "final");
if (!["draft", "final"].includes(qualityName)) fail('--quality must be "draft" or "final".');
const ffmpeg = tool("ffmpeg");
const ffprobe = tool("ffprobe");
let sb;
try {
  sb = JSON.parse(NodeFS.readFileSync(storyboardPath, "utf8"));
} catch (error) {
  fail(`The storyboard could not be read: ${error.message}`);
}
const problems = [];
const COLOR = /^#[0-9a-fA-F]{6}$/;
if (!/^https?:\/\//.test(sb.url ?? ""))
  problems.push('"url" must be the full web address where the tutorial starts.');
if (!["ro", "en"].includes(sb.language)) problems.push('"language" must be "ro" or "en".');
if (!["local", "preview", "none", "elevenlabs"].includes(sb.voice ?? "preview"))
  problems.push('"voice" must be "elevenlabs", "preview" or "none".');
if (!FORMATS[sb.format ?? "landscape"])
  problems.push('"format" must be "landscape" or "vertical".');
if (!sb.title || sb.title.length > 70) problems.push('"title" is required (under 70 characters).');
sb.brand = { primary: "#0F4C5C", accent: "#F2C14E", ...sb.brand };
for (const key of ["primary", "accent"])
  if (!COLOR.test(sb.brand[key])) problems.push(`brand.${key} must look like #1A2B3C.`);
if (!Array.isArray(sb.steps) || sb.steps.length < 2 || sb.steps.length > 30)
  problems.push('"steps" needs 2 to 30 steps.');
const ACTIONS = [
  "goto",
  "click",
  "fill",
  "select",
  "check",
  "press",
  "scroll",
  "hover",
  "highlight",
  "wait",
];
(sb.steps ?? []).forEach((step, i) => {
  const where = `step ${i + 1}`;
  if (!step.say || typeof step.say !== "string")
    problems.push(`${where}: "say" (the narration) is required.`);
  else if (step.say.length > 260)
    problems.push(
      `${where}: "say" is too long (keep each step under 260 characters, about 15 seconds).`,
    );
  for (const action of step.do ?? []) {
    const kind = Object.keys(action).find((key) => ACTIONS.includes(key));
    if (!kind)
      problems.push(
        `${where}: unknown action ${JSON.stringify(action)}; use one of ${ACTIONS.join(", ")}.`,
      );
  }
});
for (const [i, step] of (sb.steps ?? []).entries())
  if (step.title !== undefined && (typeof step.title !== "string" || step.title.length > 40))
    problems.push(
      `Step ${i + 1}: "title" (the step's on-screen title) must be under 40 characters.`,
    );
if (problems.length) fail(`The storyboard has problems:\n  ${problems.join("\n  ")}`);
const format = FORMATS[sb.format ?? "landscape"];
const [W, H] = format.size;
// The professional voice is the person's own ElevenLabs; without it the local Piper voice makes a
// preview, and every file, report line and reply says so.
const voiceChoice = resolveVoice(
  sb.voice === "local" ? "preview" : (sb.voice ?? "preview"),
  process.env,
);
const voiceMode = voiceChoice.voice === "preview" ? "local" : voiceChoice.voice;
const voiceLines = voiceReportLines(voiceChoice.voice, sb.language, voiceChoice.fellBack);
NodeFS.mkdirSync(out, { recursive: true });

// Demo-account values come from a local file the agent never reads (KEY=value lines).
const secrets = {};
const loginFile = opt.get("login");
if (loginFile) {
  if (!NodeFS.existsSync(loginFile)) fail(`The login file ${loginFile} does not exist.`);
  for (const line of NodeFS.readFileSync(loginFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match) secrets[match[1]] = match[2];
  }
}
const fillValue = (value) =>
  String(value ?? "").replace(/\$([A-Z_]+)/g, (all, name) =>
    name in secrets ? secrets[name] : all,
  );
const wavSeconds = (file) => {
  const buffer = NodeFS.readFileSync(file);
  const byteRate = buffer.readUInt32LE(28);
  let offset = 12;
  while (offset < buffer.length - 8) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") return Math.min(size, buffer.length - offset - 8) / byteRate;
    offset += 8 + size;
  }
  return 0;
};
const voiceDir = NodePath.join(out, "voice");
NodeFS.mkdirSync(voiceDir, { recursive: true });
async function voiceFor(text, index) {
  const hash = NodeCrypto.createHash("sha1")
    .update(`${voiceMode}|${sb.language}|${text}`)
    .digest("hex")
    .slice(0, 10);
  const wav = NodePath.join(voiceDir, `step-${String(index + 1).padStart(2, "0")}-${hash}.wav`);
  if (voiceMode === "none") return { file: null, seconds: Math.max(2.2, text.length / 15) };
  if (!NodeFS.existsSync(wav)) {
    if (voiceMode === "local") {
      const model =
        sb.language === "ro" ? process.env.ZEN_PIPER_VOICE_RO : process.env.ZEN_PIPER_VOICE_EN;
      if (!model || !NodeFS.existsSync(model))
        fail(
          `The ${sb.language === "ro" ? "Romanian" : "English"} voice is not installed. Choose "No voice" or start the task from Zen Staff again.`,
        );
      run(
        tool("piper-python"),
        [
          "-m",
          "piper",
          "-m",
          model,
          "-f",
          wav,
          "--length-scale",
          sb.language === "ro" ? "1.05" : "1.0",
          "--sentence-silence",
          "0.25",
        ],
        { input: Buffer.from(text, "utf8") },
      );
    } else {
      const key = process.env.ELEVENLABS_API_KEY;
      if (!key)
        fail('ElevenLabs is not connected on this computer. Use "voice": "local" or "none".');
      const voice = sb.elevenlabsVoice || process.env.ZEN_ELEVENLABS_VOICE_ID;
      if (!voice)
        fail(
          'Set "elevenlabsVoice" in the storyboard to the voice id from your ElevenLabs account.',
        );
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      }).catch((error) => fail(`ElevenLabs could not be reached: ${error.message}`));
      if (!response.ok) fail(`ElevenLabs refused the voice (${response.status}).`);
      const mp3 = wav.replace(/\.wav$/, ".mp3");
      NodeFS.writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
      run(ffmpeg, ["-y", "-v", "error", "-i", mp3, "-ar", "44100", "-ac", "1", wav]);
    }
  }
  return { file: wav, seconds: wavSeconds(wav) };
}
const voices = [];
if (!rehearse) {
  console.log(voiceMode === "none" ? "No voice: timing the captions..." : "Recording the voice...");
  for (const [index, step] of sb.steps.entries()) voices.push(await voiceFor(step.say, index));
}
const RISKY =
  /^(trimite|send|submit|pl[aă]te[sș]te|pay|buy|cump[aă]r[aă]|comand[aă]|place order|delete|[sș]terge|abonea?z[aă]-?m?[aă]?|subscribe|cere oferta|cere ofert[aă]|confirm[aă]?|register|[iî]nregistreaz[aă]|sign up|creeaz[aă] cont)/i;
const { chromium, chrome } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chrome });
const context = await browser.newContext({
  viewport: format.viewport,
  deviceScaleFactor: format.scale,
  isMobile: format.mobile,
  hasTouch: format.mobile,
  locale: sb.language === "ro" ? "ro-RO" : "en-US",
});
// The cursor, ripples and highlights are drawn by the editor from the event log, eased and sharp
// at any zoom; the page only gets a silent stand-in so the recorder can call it.
await context.addInitScript(
  "window.__zenCursor = { moveTo() {}, ripple() {}, highlight() {}, clear() {} };" +
    "document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[target]'); if (a) a.removeAttribute('target'); }, true);",
);
const page = await context.newPage();
let lastStatus;
page.on("response", (response) => {
  if (response.request().isNavigationRequest() && response.frame() === page.mainFrame())
    lastStatus = response.status();
});
const sameUrl = (a, b) =>
  a.replace(/\/+$/, "").replace(/#.*$/, "") === b.replace(/\/+$/, "").replace(/#.*$/, "");
async function settle() {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
}
// What happened where and when, for the editor (seconds, viewport fractions).
const events = [];
const vw = format.viewport.width;
const vh = format.viewport.height;
const norm = (box) =>
  box && { x: box.x / vw, y: box.y / vh, width: box.width / vw, height: box.height / vh };
const log = (kind, extra = {}) => events.push({ t: Date.now() / 1000, kind, ...extra });
async function moveCursorTo(locator) {
  // A scroll moves the page under a zoomed camera: tell the editor, so it pulls out first.
  const before = await page.evaluate(() => scrollY).catch(() => 0);
  const scrollAt = Date.now() / 1000;
  await locator
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }))
    .catch(() => undefined);
  const after = await page.evaluate(() => scrollY).catch(() => 0);
  if (Math.abs(after - before) > 24) events.push({ t: scrollAt, kind: "scroll" });
  await page.waitForTimeout(rehearse ? 50 : 700);
  // Styled checkboxes hide the real input: point at its label instead.
  const box = await locator.evaluate((el) => {
    let target = el;
    const r = el.getBoundingClientRect();
    if (
      (el.type === "checkbox" || el.type === "radio") &&
      (r.width < 6 || r.height < 6 || getComputedStyle(el).opacity === "0")
    ) {
      target =
        el.closest("label") ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.parentElement;
    }
    const b = target.getBoundingClientRect();
    return b.width && b.height ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
  });
  if (!box) throw new Error("the element has no position on screen");
  const x = box.x + Math.min(box.width / 2, 60);
  const y = box.y + box.height / 2;
  await page.evaluate(([px, py]) => window.__zenCursor?.moveTo(px, py), [x, y]);
  log("move", { x: x / vw, y: y / vh, box: norm(box) });
  await page.waitForTimeout(rehearse ? 50 : 750);
  return { box, x, y };
}

async function perform(action, step) {
  const kind = Object.keys(action).find((key) => ACTIONS.includes(key));
  const value = action[kind];
  if (kind === "goto") {
    const url = new URL(value, page.url() === "about:blank" ? sb.url : page.url()).toString();
    if (!sameUrl(page.url(), url)) {
      log("nav");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await settle();
    }
    return;
  }
  if (kind === "wait") return page.waitForTimeout(rehearse ? 50 : Number(value) * 1000);
  if (kind === "press") return page.keyboard.press(value);
  if (kind === "scroll") {
    log("scroll");
    if (typeof value === "number")
      await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), value);
    else {
      const target = await resolveTarget(page, value.to ?? value);
      if (target.error) throw new Error(target.error);
      await target.locator.evaluate((el) =>
        el.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
    }
    return page.waitForTimeout(rehearse ? 100 : 1000);
  }
  const target = await resolveTarget(page, value);
  if (target.error) throw new Error(target.error);
  if (target.note) step.notes.push(target.note);
  const { locator } = target;
  const { box, x, y } = await moveCursorTo(locator);
  if (kind === "highlight") {
    log("highlight", { x: x / vw, y: y / vh, box: norm(box) });
    await page.evaluate(
      ([b, color]) => window.__zenCursor?.highlight(b, color),
      [box, sb.brand.accent],
    );
    return page.waitForTimeout(rehearse ? 50 : 400);
  }
  if (kind === "hover") return locator.hover();
  await page.evaluate(
    ([px, py, color]) => window.__zenCursor?.ripple(px, py, color),
    [x, y, sb.brand.accent],
  );
  if (kind === "click") {
    const info = await locator.evaluate((el) => ({
      submit:
        el.tagName === "BUTTON" ||
        (el.tagName === "INPUT" && ["submit", "button"].includes(el.type)) ||
        el.getAttribute("role") === "button" ||
        el.type === "submit",
      name: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim(),
    }));
    if (info.submit && RISKY.test(info.name) && step.allowSubmit !== true) {
      throw new Error(
        `"${info.name}" would send or change real data. A tutorial stops before it: point at it with "highlight" and say what happens when the person presses it.`,
      );
    }
    log("click", { x: x / vw, y: y / vh, box: norm(box) });
    await locator.click({ timeout: 8000 });
    await page.waitForTimeout(rehearse ? 150 : 500);
    await settle();
    return;
  }
  if (kind === "fill") {
    log("click", { x: x / vw, y: y / vh, box: norm(box) });
    log("type", { x: x / vw, y: y / vh, box: norm(box) });
    await locator.click({ timeout: 8000 });
    await locator.fill("");
    await locator.pressSequentially(fillValue(action.value), { delay: rehearse ? 0 : 55 });
    return;
  }
  if (kind === "select") return locator.selectOption({ label: action.option ?? action.value });
  if (kind === "check") {
    log("click", { x: x / vw, y: y / vh, box: norm(box) });
    // Styled checkboxes hide the real input; Playwright's own check() then retries and scrolls
    // the page back and forth (visible jitter in the video). Click where the viewer sees the box.
    if (!(await locator.isChecked().catch(() => false))) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(150);
    }
    if (!(await locator.isChecked().catch(() => false)))
      await locator.check({ force: true, timeout: 3000 }).catch(() => undefined);
    if (!(await locator.isChecked())) throw new Error("the box could not be ticked");
    return page.waitForTimeout(rehearse ? 50 : 300);
  }
}

async function expectProblems(step) {
  const found = [];
  const expect = step.expect ?? {};
  if (expect.url && !page.url().includes(expect.url))
    found.push(`Expected the address to contain "${expect.url}", but it is ${page.url()}.`);
  if (expect.text) {
    const visible = await page
      .getByText(expect.text, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) found.push(`Expected to see "${expect.text}" on screen, but it is not visible.`);
  }
  return found;
}
const framesDir = NodePath.join(out, ".frames");
const stepsDir = NodePath.join(out, "steps");
NodeFS.rmSync(framesDir, { recursive: true, force: true });
NodeFS.mkdirSync(stepsDir, { recursive: true });
const frames = [];
let cdp;
try {
  await page.goto(sb.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await settle();
} catch (error) {
  await browser.close();
  fail(`${sb.url} could not be opened: ${error.message.split("\n")[0]}`);
}
await handleCookies(page, sb.cookies ?? "accept");
if (!rehearse) {
  NodeFS.mkdirSync(framesDir, { recursive: true });
  cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = NodePath.join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
    NodeFS.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: W,
    maxHeight: H,
    everyNthFrame: 1,
  });
  await page.evaluate(() => window.__zenCursor?.moveTo(innerWidth * 0.5, innerHeight * 0.62));
  await page.waitForTimeout(800);
}
const results = [];
for (const [index, step] of sb.steps.entries()) {
  const result = {
    step: index + 1,
    say: step.say,
    notes: [],
    problems: [],
    start: Date.now() / 1000,
  };
  step.notes = result.notes;
  await page.evaluate(() => window.__zenCursor?.clear()).catch(() => undefined);
  try {
    for (const action of step.do ?? []) await perform(action, step);
  } catch (error) {
    const message = String(error.message);
    const cover = message.match(
      /from (<[^>]*>) subtree intercepts pointer events|(<[^>]*>) intercepts pointer events/,
    );
    if (cover) {
      const tag = cover[1] ?? cover[2];
      const label = tag.match(/aria-label="([^"]*)"/)?.[1];
      result.problems.push(
        `Something covers the element (${label ? `the dialog "${label}"` : `the layer ${tag.slice(0, 80)}`}); add an action before it that answers or closes it.`,
      );
    } else result.problems.push(`An action failed: ${message.split("\n")[0]}`);
  }
  result.problems.push(
    ...(await pageProblems(page, {
      status: lastStatus,
      allowLogin: step.login === true || sb.login === true,
    })),
  );
  result.problems.push(...(await expectProblems(step)));
  result.url = page.url();
  result.screenshot = NodePath.join(stepsDir, `step-${String(index + 1).padStart(2, "0")}.jpg`);
  await page
    .screenshot({ path: result.screenshot, type: "jpeg", quality: 80 })
    .catch(() => undefined);
  if (!rehearse) {
    const holdUntil = result.start + voices[index].seconds + 0.6;
    const wait = Math.max(0.8, holdUntil - Date.now() / 1000);
    await page.waitForTimeout(wait * 1000);
  }
  result.end = Date.now() / 1000;
  result.status = result.problems.length ? "FAIL" : "PASS";
  results.push(result);
  console.log(
    `step ${index + 1}: ${result.status}${result.problems.length ? ` - ${result.problems.join(" ")}` : ""}`,
  );
  if (result.problems.length && !force && !rehearse) break;
}
if (cdp) await cdp.send("Page.stopScreencast").catch(() => undefined);
await page.waitForTimeout(200);
const failed = results.filter((result) => result.status === "FAIL");
const font = NodePath.join(process.env.ZEN_FONTS_DIR ?? "", "Barlow-SemiBold.ttf");
const sheet = NodePath.join(out, "qa-steps.jpg");
{
  const tmp = NodeFS.mkdtempSync(NodePath.join(out, ".qa-"));
  results.forEach((result, i) => {
    if (!NodeFS.existsSync(result.screenshot)) return;
    const label = `drawbox=x=0:y=0:w=iw:h=64:color=${result.status === "PASS" ? "0x1B7F3B" : "0xB3261E"}@0.9:t=fill,drawtext=fontfile='${font}':text='${result.step} ${result.status}':x=16:y=14:fontsize=38:fontcolor=white`;
    run(
      ffmpeg,
      [
        "-y",
        "-v",
        "error",
        "-i",
        result.screenshot,
        "-vf",
        `scale=640:-2,format=rgb24,${label}`,
        NodePath.join(tmp, `${String(i).padStart(3, "0")}.png`),
      ],
      { allowFail: true },
    );
  });
  const columns = Math.min(4, results.length);
  run(
    ffmpeg,
    [
      "-y",
      "-v",
      "error",
      "-framerate",
      "1",
      "-i",
      NodePath.join(tmp, "%03d.png"),
      "-vf",
      `tile=${columns}x${Math.ceil(results.length / columns)}:padding=8:color=white`,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      sheet,
    ],
    { allowFail: true },
  );
  NodeFS.rmSync(tmp, { recursive: true, force: true });
}
const qaLines = [
  `# Tutorial QA: ${sb.title}`,
  "",
  `${results.length - failed.length} of ${sb.steps.length} steps PASS${rehearse ? " (rehearsal, no video)" : ""}.`,
  "",
  "| Step | Result | Narration | Address | Problems |",
  "| ---- | ------ | --------- | ------- | -------- |",
  ...results.map(
    (r) =>
      `| ${r.step} | ${r.status} | ${r.say.replace(/\|/g, "/")} | ${r.url} | ${[...r.problems, ...r.notes].join(" ").replace(/\|/g, "/") || "-"} |`,
  ),
  "",
  `Step screenshots: ${stepsDir} (sheet: ${sheet})`,
];
NodeFS.writeFileSync(NodePath.join(out, "qa.md"), qaLines.join("\n"));
if (rehearse || (failed.length && !force) || results.length < sb.steps.length) {
  await browser.close();
  console.log(
    JSON.stringify(
      {
        rehearsal: rehearse,
        pass: results.length - failed.length,
        steps: sb.steps.length,
        report: NodePath.join(out, "qa.md"),
        sheet,
      },
      null,
      1,
    ),
  );
  if (failed.length || results.length < sb.steps.length)
    fail(
      `${failed.length || sb.steps.length - results.length} step(s) did not pass; read ${NodePath.join(out, "qa.md")}, fix the storyboard and run again.`,
    );
  process.exit(0);
}
const work = NodePath.join(out, ".build");
NodeFS.rmSync(work, { recursive: true, force: true });
NodeFS.mkdirSync(work, { recursive: true });
const aiNote =
  voiceMode === "none" ? null : sb.language === "ro" ? "Voce generată cu AI" : "AI-generated voice";
await browser.close();
const INTRO = 3;
const OUTRO = 3.5;
const t0 = results[0].start;
const tEnd = results.at(-1).end;
// Screencast frames can arrive out of order; resample by their capture time, not arrival.
const usable = frames.filter((frame) => frame.t <= tEnd).toSorted((a, b) => a.t - b.t);
if (usable.length < 2)
  fail(
    "The browser sent no video frames. Run again; if it repeats, the page may block automated browsers.",
  );
// Resample to a steady 30 fps: each output frame links the browser frame on screen at that time
// (the concat demuxer would round every short frame up to its own time base and drift).
const sequence = NodePath.join(work, "seq");
NodeFS.mkdirSync(sequence, { recursive: true });
const total30 = Math.max(1, Math.round((tEnd - t0) * 30));
let cursor = 0;
for (let k = 0; k < total30; k++) {
  const at = t0 + k / 30;
  while (cursor + 1 < usable.length && usable[cursor + 1].t <= at) cursor++;
  const target = NodePath.join(sequence, `${String(k).padStart(6, "0")}.jpg`);
  try {
    NodeFS.linkSync(usable[cursor].file, target);
  } catch {
    NodeFS.copyFileSync(usable[cursor].file, target);
  }
}
const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=30,format=yuv420p`;
console.log("Building the video...");
run(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-framerate",
  "30",
  "-i",
  NodePath.join(sequence, "%06d.jpg"),
  "-vf",
  fit,
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "16",
  NodePath.join(work, "body.mp4"),
]);
const bodySeconds = tEnd - t0;
const total = INTRO + bodySeconds + OUTRO;

// Narration placed where each step starts.
const offsets = results.map((result) => INTRO + (result.start - t0) + 0.15);
const narration = NodePath.join(work, "narration.wav");
if (voiceMode !== "none") {
  const inputs = [];
  const parts = [];
  results.forEach((result, i) => {
    inputs.push("-i", voices[i].file);
    parts.push(
      `[${i}:a]aresample=44100,aformat=channel_layouts=mono,adelay=${Math.round(offsets[i] * 1000)}:all=1[a${i}]`,
    );
  });
  const mix = `${parts.join(";")};${results.map((_, i) => `[a${i}]`).join("")}amix=inputs=${results.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(2)},atrim=0:${total.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  run(ffmpeg, [
    "-y",
    "-v",
    "error",
    ...inputs,
    "-filter_complex",
    mix,
    "-map",
    "[out]",
    "-ar",
    "44100",
    narration,
  ]);
} else {
  run(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=44100:cl=mono`,
    "-t",
    total.toFixed(2),
    narration,
  ]);
}

// Captions: up to two short lines per cue, timed across each step's narration.
const maxLine = W > H ? 46 : 26;
const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
function chunks(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxLine) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  const cues = [];
  for (let i = 0; i < lines.length; i += 2) cues.push(lines.slice(i, i + 2).join("\n"));
  return cues;
}
const srt = [];
const srtCues = [];
results.forEach((result, i) => {
  const cues = chunks(result.say);
  const span =
    voiceMode === "none" ? Math.max(2.2, result.end - result.start - 0.3) : voices[i].seconds;
  const totalChars = cues.reduce((sum, cue) => sum + cue.length, 0);
  let t = offsets[i];
  for (const cue of cues) {
    const d = (span * cue.length) / totalChars;
    srt.push(`${srt.length / 4 + 1}`, `${srtTime(t)} --> ${srtTime(t + d - 0.05)}`, cue, "");
    srtCues.push({ text: cue.replace(/\n/g, " "), s: t, e: t + d - 0.05 });
    t += d;
  }
});
const slug =
  (sb.slug || sb.title)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "tutorial";
const srtFile = NodePath.join(out, `${slug}.srt`);
NodeFS.writeFileSync(srtFile, srt.join("\n"));
NodeFS.copyFileSync(srtFile, NodePath.join(work, "captions.srt"));

const video = NodePath.join(
  out,
  voiceMode === "local" ? previewFileName(`${slug}.mp4`) : `${slug}.mp4`,
);
const composed = await composeTutorial({
  body: NodePath.join(work, "body.mp4"),
  narration,
  output: video,
  format: sb.format ?? "landscape",
  sb,
  steps: results.map((result, i) => ({
    title: sb.steps[i].title,
    start: Math.max(0, result.start - t0),
    end: Math.max(0, result.end - t0),
  })),
  events: events
    .filter((event) => event.t >= t0 && event.t <= tEnd)
    .map((event) => ({ ...event, t: event.t - t0 })),
  cues: srtCues,
  introSeconds: INTRO,
  bodySeconds,
  outroSeconds: OUTRO,
  aiNote,
  qualityName,
  // Where the voice speaks, so the music ducks under it and comes back up between steps.
  voiceSegments:
    voiceMode === "none"
      ? null
      : results.map((_, i) => ({ start: offsets[i], end: offsets[i] + voices[i].seconds })),
  stems: opt.get("stems"),
});
const probe = JSON.parse(
  run(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height:format=duration,size",
    "-of",
    "json",
    video,
  ]).stdout,
);
const v = probe.streams.find((stream) => stream.codec_type === "video");
const hasAudio = probe.streams.some((stream) => stream.codec_type === "audio");
const loud = run(
  ffmpeg,
  ["-v", "info", "-i", video, "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
  { allowFail: true },
).stderr.match(/I:\s+(-?[\d.]+) LUFS/);
const checks = {
  steps: `${results.length - failed.length}/${sb.steps.length} PASS`,
  size: `${v.width}x${v.height}`,
  seconds: Number(Number(probe.format.duration).toFixed(1)),
  expectedSeconds: Number(total.toFixed(1)),
  audio: hasAudio,
  loudnessLufs: loud ? Number(loud[1]) : null,
  captionCues: srt.length / 4,
  editSeconds: composed.renderSeconds,
  contactSheet: composed.contactSheet,
  musicDucking: composed.ducking
    ? `music ${composed.ducking.musicUnderVoiceDb} dB while the voice speaks, ${composed.ducking.musicBetweenLinesDb} dB between steps (voice about 12 dB above the music)`
    : "no voice",
};
const warnings = [];
if (v.width !== W || v.height !== H)
  warnings.push(`The video is ${v.width}x${v.height}, expected ${W}x${H}.`);
if (qualityName === "draft")
  warnings.splice(0, warnings.length, ...warnings.filter((w) => !w.startsWith("The video is")));
if (Math.abs(checks.seconds - checks.expectedSeconds) > 1.5)
  warnings.push("The video length does not match the steps.");
if (
  voiceMode !== "none" &&
  (checks.loudnessLufs === null || checks.loudnessLufs < -20 || checks.loudnessLufs > -12)
)
  warnings.push(`The voice loudness is ${checks.loudnessLufs} LUFS (expected about -16).`);
NodeFS.appendFileSync(
  NodePath.join(out, "qa.md"),
  `\n\n## Voice\n\n${voiceLines.map((line) => `- ${line}`).join("\n")}\n\n## Final video\n\n${Object.entries(
    checks,
  )
    .map(([k, value]) => `- ${k}: ${value}`)
    .join(
      "\n",
    )}\n${warnings.length ? `\nWarnings:\n${warnings.map((w) => `- ${w}`).join("\n")}\n` : "\nAll final checks passed.\n"}`,
);
NodeFS.rmSync(framesDir, { recursive: true, force: true });
NodeFS.rmSync(work, { recursive: true, force: true });
console.log(
  JSON.stringify(
    {
      video,
      captions: srtFile,
      report: NodePath.join(out, "qa.md"),
      sheet,
      voice: voiceChoice.voice,
      voiceNotice: voiceLines,
      ...checks,
      warnings,
    },
    null,
    1,
  ),
);
