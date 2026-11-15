// Builds the finished poster set from poster/poster.json: the print poster (PDF with 3 mm bleed,
// a proof with crop marks, a 300 dpi PNG), the social versions (post, story, square, event
// cover), real photo mockups of the poster in place, the brief with print specifications, and an
// overview sheet to review. Usage: node build.mjs --spec poster/poster.json --out poster [--check]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { alpha, contrast, palette as makePalette, shade, tint } from "./kit/common/color.js";
import { contactIcon, iconSvg } from "./kit/common/icons.js";
import { LOOKS, css } from "./kit/common/type.js";
import { festivalHtml } from "./layouts/festival.mjs";
import { roundelHtml } from "./layouts/roundel.mjs";
import { imageSize } from "./layouts/shared.mjs";
import { composeMockup, prepareMockupPage } from "./kit/print/mockup.mjs";
import {
  BLEED_MM,
  SAFE_MM,
  SIZES,
  SOCIAL,
  fontsCss,
  loadPlaywright,
  mmToPx,
  printPdfs,
  printPng,
  printSpec,
} from "./kit/print/print.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const specPath = opt("spec");
if (!specPath) fail("Use --spec <poster.json> --out <folder> [--check].");
const out = NodePath.resolve(opt("out", NodePath.dirname(specPath)));
let spec;
try {
  spec = JSON.parse(NodeFS.readFileSync(specPath, "utf8"));
} catch (error) {
  fail(`poster.json could not be read: ${error.message}`);
}
const base = NodePath.dirname(NodePath.resolve(specPath));
const resolve = (file) => (file ? NodePath.resolve(base, file) : null);

const problems = [];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const LOOK_NAMES = ["modern", "warm", "bold", "elegant", "playful", "editorial"];
if (!SIZES[spec.size ?? "A3"])
  problems.push(`"size" must be one of ${Object.keys(SIZES).join(", ")}.`);
if (spec.look && !LOOK_NAMES.includes(spec.look))
  problems.push(`"look" must be one of ${LOOK_NAMES.join(", ")}.`);
if (!spec.brand?.name) problems.push('"brand.name" is required.');
for (const key of ["primary", "accent"])
  if (spec.brand?.[key] && !COLOR.test(spec.brand[key]))
    problems.push(`brand.${key} must look like #1A2B3C.`);
const LAYOUTS = ["auto", "photo-hero", "type-led", "roundel", "festival"];
if (spec.layout && !LAYOUTS.includes(spec.layout))
  problems.push(`"layout" must be one of ${LAYOUTS.join(", ")}.`);
const words = String(spec.headline ?? "")
  .split(/\s+/)
  .filter(Boolean);
if (spec.layout === "festival") {
  if (words.length < 1 || words.length > 3)
    problems.push('"headline" is the festival name on a festival poster: 1-3 words.');
  if (!spec.photo)
    problems.push('A festival poster needs a "photo" (a landscape with sky works best).');
  const lineup = spec.lineup ?? [];
  if (!lineup.length || lineup.length > 4)
    problems.push('"lineup" takes 1-4 tiers, each a list of names (headliners first).');
  if (lineup.flat().length > 30) problems.push('"lineup": at most 30 names; add "+ more" instead.');
  if ((spec.tickets ?? []).length > 3) problems.push('"tickets" takes at most 3 prices.');
} else if (spec.layout === "roundel") {
  if (words.length < 1 || words.length > 5)
    problems.push('"headline" on a roundel poster: 1-5 short words, set on one line.');
  if (!spec.photo)
    problems.push('A roundel poster needs a "photo" with a round subject seen from above.');
  const c = spec.roundel;
  if (!c || ![c.x, c.y, c.r].every((v) => typeof v === "number"))
    problems.push(
      '"roundel" needs { "x", "y", "r" }: the circle of the dish in the photo, in % of the photo width (x, r) and height (y).',
    );
  if ((spec.facts ?? []).length > 3) problems.push('"facts" takes at most 3 columns.');
  for (const f of spec.facts ?? [])
    if (String(f.value ?? "").length > 14)
      problems.push(
        `Fact "${f.value}" is over 14 characters; it is set large. Move the rest to "note".`,
      );
  if ((spec.items ?? []).join(" / ").length > 70)
    problems.push('"items" (set on the ring) must stay under 70 characters in total.');
} else if (words.length < 2 || words.length > 9)
  problems.push(
    `"headline" needs 2-9 words (it has ${words.length}); a poster is read in 3 seconds.`,
  );
if ((spec.kicker ?? "").length > 40) problems.push('"kicker" must be under 40 characters.');
if ((spec.sub ?? "").length > 140) problems.push('"sub" must be under 140 characters.');
if ((spec.details ?? []).length > 4)
  problems.push('"details" takes at most 4 lines (date, time, place, price).');
for (const d of spec.details ?? [])
  if (String(d.text ?? d).length > 40)
    problems.push(`Detail "${d.text ?? d}" is over 40 characters; shorten it.`);
if ((spec.cta ?? "").length > 40) problems.push('"cta" must be under 40 characters.');
for (const [key, file] of [
  ["photo", spec.photo],
  ["brand.logo", spec.brand?.logo],
])
  if (file && !NodeFS.existsSync(resolve(file)))
    problems.push(`${key}: ${file} does not exist (paths are relative to poster.json).`);
if (problems.length) fail(`poster.json has problems:\n  ${problems.join("\n  ")}`);

const size = SIZES[spec.size ?? "A3"];
const look = spec.look ?? "modern";
const L = LOOKS[look];
const P = makePalette({
  primary: spec.brand.primary ?? "#0F4C5C",
  accent: spec.brand.accent ?? "#F2C14E",
});
const photoUrl = spec.photo ? NodeURL.pathToFileURL(resolve(spec.photo)).href : null;
const logoUrl = spec.brand.logo ? NodeURL.pathToFileURL(resolve(spec.brand.logo)).href : null;
const details = (spec.details ?? [])
  .map((d) => (typeof d === "string" ? { text: d } : d))
  .map((d) => ({ ...d, icon: d.icon ?? contactIcon(d.text) }));
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const photoSize = spec.photo ? imageSize(resolve(spec.photo)) : null;
const layoutCtx = {
  spec,
  L,
  P,
  photo: photoUrl
    ? {
        url: photoUrl,
        ...(photoSize ?? { width: 1, height: 1 }),
        // The festival layout reads the photo's pixels (to find the sky) from a data URL.
        get dataUrl() {
          const type = /\.png$/i.test(spec.photo) ? "image/png" : "image/jpeg";
          return `data:${type};base64,${NodeFS.readFileSync(resolve(spec.photo)).toString("base64")}`;
        },
      }
    : null,
  fontsCss,
  headlineHtml: () => headlineHtml(),
};
const preview = args.includes("--preview");

if (args.includes("--check")) {
  console.log(
    JSON.stringify({
      ok: true,
      size: spec.size ?? "A3",
      look,
      layout: spec.layout ?? "auto",
      contrast: Number(contrast(P.onPrimary, P.primary).toFixed(1)),
    }),
  );
  process.exit(0);
}

/** The headline with the accent word, one span per word (no word ever breaks). */
function headlineHtml() {
  const accent =
    spec.accent ?? (look === "elegant" || look === "editorial" ? -1 : words.length - 1);
  return words
    .map((w, i) => (i === accent ? `<span class="accent">${esc(w)}</span>` : esc(w)))
    .join(" ");
}

/**
 * One poster page. `W`, `H` in CSS px of the full sheet; `bleed` and `safe` in px. Everything else
 * is in cqw/cqh of the sheet so one design scales from A5 to A2 and to the social sizes.
 */
function posterHtml(opts) {
  if (spec.layout === "roundel") return roundelHtml(layoutCtx, opts);
  if (spec.layout === "festival") return festivalHtml(layoutCtx, opts);
  return classicHtml(opts);
}

function classicHtml({ W, H, bleed = 0, safe, story = false }) {
  const ratio = H / W;
  const tall = ratio >= 1.2;
  const landscape = ratio < 0.9;
  const layout =
    spec.layout && spec.layout !== "auto" ? spec.layout : photoUrl ? "photo-hero" : "type-led";
  const pad = bleed + safe;
  const storyTop = story ? H * 0.12 : 0;
  const storyBottom = story ? H * 0.14 : 0;
  const photoH = tall ? (story ? 0.48 : 0.52) : landscape ? 1 : 0.5;
  const focus = `${spec.focusX ?? 50}% ${spec.focusY ?? 50}%`;
  const detailHtml = details
    .map(
      (d) =>
        `<div class="d"><span class="i">${iconSvg(d.icon, { size: 100, color: P.accent, stroke: 2.2 })}</span><span>${esc(d.text)}</span></div>`,
    )
    .join("");
  const logo = logoUrl
    ? `<img class="logo" src="${logoUrl}">`
    : `<div class="name">${esc(spec.brand.name)}</div>`;
  const ctaBand =
    spec.cta || spec.url
      ? `<div class="cta"><div class="ctat">${esc(spec.cta ?? "")}</div>${spec.url ? `<div class="url">${esc(spec.url)} ${iconSvg("arrow-right", { size: 100, color: P.onAccent, stroke: 2.4 })}</div>` : ""}</div>`
      : "";
  const textBlock = `
    ${spec.kicker ? `<div class="kicker"><span class="rule"></span>${esc(spec.kicker)}</div>` : ""}
    <h1 class="h">${headlineHtml()}</h1>
    ${spec.sub ? `<p class="sub">${esc(spec.sub)}</p>` : ""}
    ${details.length ? `<div class="details">${detailHtml}</div>` : ""}`;
  let body;
  if (layout === "photo-hero" && photoUrl && !landscape) {
    body = `
      <div class="photo" style="height:${photoH * 100}%"><img src="${photoUrl}" style="object-position:${focus}"><div class="fade"></div></div>
      <div class="top">${logo}</div>
      <div class="text" style="top:${(photoH - (tall ? 0.07 : 0.05)) * 100}%">${textBlock}</div>
      ${ctaBand}`;
  } else if (landscape && photoUrl) {
    body = `
      <div class="photo side"><img src="${photoUrl}" style="object-position:${focus}"><div class="fadeside"></div></div>
      <div class="top">${logo}</div>
      <div class="text land">${textBlock}</div>
      ${ctaBand}`;
  } else {
    body = `
      <div class="field"></div>
      <div class="top">${logo}</div>
      ${photoUrl ? `<div class="inset"><img src="${photoUrl}" style="object-position:${focus}"></div>` : ""}
      <div class="text typeled ${photoUrl ? "withinset" : ""}">${textBlock}</div>
      ${ctaBand}`;
  }
  // Every size is N x --k cqw: landscape sheets are wide, so their type scales from the height.
  const u = "cqw";
  const k = landscape ? 0.56 : 1;
  const display = css(L.display);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontsCss()}
@page { size: ${W}px ${H}px; margin: 0 }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${P.primary}; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.sheet { --k: ${k}; position: relative; width: ${W}px; height: ${H}px; container-type: size; overflow: hidden; background: ${P.primary}; color: ${P.onPrimary} }
.photo { position: absolute; left: 0; top: 0; width: 100%; overflow: hidden }
.photo img, .inset img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(1.06) contrast(1.03) }
.photo .fade { position: absolute; left: 0; right: 0; bottom: 0; height: 42%; background: linear-gradient(180deg, ${alpha(P.primary, 0)} 0%, ${alpha(P.primary, 0.85)} 70%, ${P.primary} 100%) }
.photo.side { left: auto; right: 0; width: 52%; height: 100% }
.photo.side .fadeside { position: absolute; inset: 0; background: linear-gradient(90deg, ${P.primary} 0%, ${alpha(P.primary, 0)} 30%) }
.field { position: absolute; inset: 0; background: radial-gradient(ellipse 90% 60% at 25% 12%, ${alpha(tint(P.primary, 0.16), 0.95)} 0%, ${alpha(P.primary, 0)} 70%), linear-gradient(165deg, ${alpha(P.primary, 0)} 45%, ${alpha(shade(P.primary, 0.35), 0.9)} 100%) }
.top { position: absolute; left: ${pad}px; top: ${pad + storyTop}px; right: ${pad}px; display: flex; justify-content: space-between; align-items: flex-start }
.logo { height: calc(${tall ? 13 : landscape ? 13 : 10} * var(--k) * 1cqw); max-width: calc(30 * var(--k) * 1cqw); object-fit: contain; filter: drop-shadow(0 calc(0.4 * var(--k) * 1cqw) calc(1.2 * var(--k) * 1cqw) rgba(0,0,0,0.25)) }
.name { ${css(L.display)}; font-size: calc(4.6 * var(--k) * 1cqw); color: ${P.paper}; text-shadow: 0 calc(0.3 * var(--k) * 1cqw) calc(1.4 * var(--k) * 1cqw) rgba(0,0,0,0.3) }
.text { position: absolute; left: ${pad}px; right: ${pad}px; display: flex; flex-direction: column; gap: calc(${tall ? 2.2 : 1.8} * var(--k) * 1cqw) }
.text.land { left: ${pad}px; right: auto; width: ${W * 0.46 - pad}px; top: 33% }
.text.typeled { top: ${tall ? 22 : 18}%; }
.text.typeled.withinset { right: ${tall ? pad : W * 0.42}px }
.inset { position: absolute; ${tall ? `right: ${pad}px; top: ${H * 0.5}px; width: calc(46 * var(--k) * 1cqw); height: calc(34 * var(--k) * 1cqw);` : `right: ${pad}px; top: ${H * 0.2}px; width: calc(36 * var(--k) * 1cqw); height: calc(46 * var(--k) * 1cqw);`} border-radius: calc(1.4 * var(--k) * 1cqw); overflow: hidden; transform: rotate(3deg); box-shadow: 0 calc(3 * var(--k) * 1cqw) calc(6 * var(--k) * 1cqw) rgba(0,0,0,0.35) }
.kicker { ${css(L.label)}; font-size: calc(${tall ? 2.6 : 2.2} * var(--k) * 1cqw); color: ${P.accent}; display: flex; align-items: center; gap: calc(1.6 * var(--k) * 1cqw) }
.kicker .rule { display: inline-block; width: calc(6 * var(--k) * 1cqw); height: calc(0.5 * var(--k) * 1cqw); background: ${P.accent}; border-radius: calc(1 * var(--k) * 1cqw) }
.h { ${display}; margin: 0; font-size: calc(12 * var(--k) * 1cqw); color: ${P.onPrimary}; text-wrap: balance }
.h .accent { color: ${P.accent}; ${css(L.accent)} }
.sub { ${css(L.body)}; margin: 0; font-size: calc(${tall ? 3.4 : 2.8} * var(--k) * 1cqw); color: ${alpha(P.onPrimary, 0.88)}; max-width: 92% }
.details { display: grid; grid-template-columns: ${details.length > 2 && tall ? "1fr 1fr" : `repeat(${Math.max(1, details.length)}, auto)`}; gap: calc(1.6 * var(--k) * 1cqw) calc(4 * var(--k) * 1cqw); margin-top: calc(1 * var(--k) * 1cqw); padding-top: calc(2.4 * var(--k) * 1cqw); border-top: calc(0.25 * var(--k) * 1cqw) solid ${alpha(P.onPrimary, 0.22)}; justify-content: start }
.d { display: flex; align-items: center; gap: calc(1.6 * var(--k) * 1cqw); ${css(L.body)}; font-weight: 700; font-size: calc(${tall ? 3.2 : 2.6} * var(--k) * 1cqw); color: ${P.onPrimary}; white-space: nowrap }
.d .i svg { width: calc(${tall ? 4.2 : 3.4} * var(--k) * 1cqw); height: calc(${tall ? 4.2 : 3.4} * var(--k) * 1cqw); display: block }
.cta { position: absolute; left: 0; right: 0; bottom: 0; height: ${tall ? 9 : 11}${landscape ? "cqh" : u}; padding: 0 ${pad}px ${story ? storyBottom * 0.55 : bleed}px; background: ${P.accent}; color: ${P.onAccent}; display: flex; align-items: center; justify-content: space-between; gap: calc(3 * var(--k) * 1cqw); box-sizing: content-box }
.ctat { ${css(L.body)}; font-weight: 800; font-size: calc(${tall ? 4 : 3.2} * var(--k) * 1cqw); letter-spacing: -0.01em }
.url { display: flex; align-items: center; gap: calc(1.2 * var(--k) * 1cqw); ${css(L.body)}; font-weight: 700; font-size: calc(${tall ? 3.2 : 2.6} * var(--k) * 1cqw) }
.url svg { width: calc(3.2 * var(--k) * 1cqw); height: calc(3.2 * var(--k) * 1cqw) }
</style></head><body><div class="sheet">${body}</div>
<script>
// Fit the headline: the biggest size that keeps every word whole and the block inside its space.
(async () => {
  await document.fonts.ready;
  const h = document.querySelector(".h");
  const text = document.querySelector(".text");
  const sheet = document.querySelector(".sheet");
  const cta = document.querySelector(".cta");
  const limitBottom = (cta ? cta.getBoundingClientRect().top : sheet.clientHeight - ${pad}) - sheet.clientWidth * 0.035;
  const maxW = text.clientWidth;
  let size = parseFloat(getComputedStyle(h).fontSize) * ${tall ? 1.25 : 1.1};
  const fits = () => {
    const spans = [...h.querySelectorAll("span")];
    const widest = Math.max(h.scrollWidth, ...spans.map((s) => s.scrollWidth));
    return widest <= maxW + 1 && text.getBoundingClientRect().bottom <= limitBottom && h.getBoundingClientRect().height <= sheet.clientHeight * ${tall ? 0.3 : 0.42};
  };
  for (let i = 0; i < 80; i++) {
    h.style.fontSize = size + "px";
    if (fits()) break;
    size *= 0.96;
  }
  document.body.dataset.fitted = "1";
})();
</script></body></html>`;
}

async function fitted(page) {
  await page
    .waitForFunction(() => document.body.dataset.fitted === "1", null, { timeout: 15000 })
    .catch(() => undefined);
}

NodeFS.mkdirSync(out, { recursive: true });
const { chromium, chrome } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chrome });
const started = Date.now();
const sizeName = spec.size ?? "A3";
const sheetW = mmToPx(size.w + BLEED_MM * 2);
const sheetH = mmToPx(size.h + BLEED_MM * 2);
const printHtml = posterHtml({
  W: Math.round(sheetW),
  H: Math.round(sheetH),
  bleed: mmToPx(BLEED_MM),
  safe: mmToPx(SAFE_MM + 6),
});
// The headline is fitted by a script in the page: render once, keep the fitted HTML for every export.
const fitPage = await browser.newPage({
  viewport: { width: Math.round(sheetW), height: Math.round(sheetH) },
});
const { loadHtml } = await import("./kit/print/print.mjs");
await loadHtml(fitPage, printHtml);
await fitted(fitPage);
const fittedPrint = await fitPage.evaluate(() => {
  for (const s of document.querySelectorAll("script")) s.remove();
  document.body.dataset.fitted = "1";
  return `<!doctype html>${document.documentElement.outerHTML}`;
});
await fitPage.close();
const slug =
  String(spec.slug ?? spec.brand.name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "poster";
const files = [];
const pdf = NodePath.join(out, `${slug}-${sizeName}-print.pdf`);
const proof = NodePath.join(out, `${slug}-${sizeName}-proof.pdf`);
if (!preview) await printPdfs(browser, { html: fittedPrint, size, out: pdf, proof });
files.push(
  [`Print PDF, ${sizeName} with ${BLEED_MM} mm bleed (send this to the printer)`, pdf],
  ["Proof PDF with crop marks", proof],
);
const png = NodePath.join(out, `${slug}-${sizeName}-${preview ? "preview" : "300dpi"}.png`);
const pngSize = await printPng(browser, {
  html: fittedPrint,
  size,
  out: png,
  dpi: preview ? 110 : 300,
});
files.push([`PNG at 300 dpi (${pngSize.width} x ${pngSize.height} px)`, png]);
// Social versions.
const socialDir = NodePath.join(out, "social");
NodeFS.mkdirSync(socialDir, { recursive: true });
const social = {};
for (const [name, s] of Object.entries(SOCIAL)) {
  const html = posterHtml({
    W: s.w,
    H: s.h,
    bleed: 0,
    safe: Math.round(s.w * 0.06),
    story: name === "instagram-story",
  });
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await loadHtml(page, html);
  await fitted(page);
  const file = NodePath.join(socialDir, `${slug}-${name}.png`);
  await page.screenshot({ path: file });
  await page.close();
  social[name] = file;
  files.push([`${s.label}, ${s.w} x ${s.h}`, file]);
}
// --preview: the poster and the social versions only, for quick art-direction rounds.
if (preview) {
  await browser.close();
  console.log(
    JSON.stringify(
      { preview: png, social, seconds: Math.round((Date.now() - started) / 1000) },
      null,
      1,
    ),
  );
  process.exit(0);
}
// Mockups: the poster in place, the story on a phone.
const mockDir = NodePath.join(out, "mockups");
const mockPage = await browser.newPage();
await mockPage.setContent("<html><body style='margin:0'></body></html>");
await prepareMockupPage(mockPage);
const posterPng = NodePath.join(out, ".poster-preview.png");
await printPng(browser, { html: fittedPrint, size, out: posterPng, dpi: 150 });
const credits = [];
const mockups = [];
const wanted = spec.mockups ?? [
  "poster-frame",
  "poster-wood-wall",
  "poster-street-board",
  "phone-story",
];
for (const id of wanted) {
  const designs = { poster: posterPng, story: social["instagram-story"], a4: posterPng };
  const result = await composeMockup(mockPage, {
    id,
    designs,
    out: NodePath.join(mockDir, `${slug}-${id}.jpg`),
    maxSide: 2000,
  });
  if (result) {
    mockups.push(result.out);
    credits.push(`${NodePath.basename(result.out)}: ${result.credit}`);
    files.push([`Mockup: ${id}`, result.out]);
  } else
    credits.push(
      `${id}: not made (the photo could not be downloaded; check the internet connection)`,
    );
}
await mockPage.close();
NodeFS.rmSync(posterPng, { force: true });
// Overview sheet: the poster, the social versions and the mockups.
const overviewHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${fontsCss()}body{margin:0;background:#1b1b1b;color:#ddd;font-family:ZenSourceSans,sans-serif;padding:24px;width:2352px}h2{font-weight:600;font-size:22px;margin:18px 0 10px}.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}img{display:block;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.4)}</style></head><body>
<h2>${esc(sizeName)} poster (trim) and social versions</h2><div class="row"><img src="${NodeURL.pathToFileURL(png).href}" style="height:620px">${Object.values(
  social,
)
  .map((f) => `<img src="${NodeURL.pathToFileURL(f).href}" style="height:620px">`)
  .join("")}</div>
<h2>Mockups</h2><div class="row">${mockups.map((f) => `<img src="${NodeURL.pathToFileURL(f).href}" style="height:520px">`).join("")}</div></body></html>`;
const overview = NodePath.join(out, "overview.jpg");
{
  const page = await browser.newPage({ viewport: { width: 2400, height: 1400 } });
  await loadHtml(page, overviewHtml);
  await page.screenshot({ path: overview, fullPage: true, type: "jpeg", quality: 85 });
  await page.close();
}
await browser.close();

// The brief: the art director's notes from poster.json plus everything measured here.
const b = spec.brief ?? {};
const ratio = (a, c) => contrast(a, c).toFixed(1);
const lines = [
  `# ${spec.brand.name}: ${spec.headline}`,
  "",
  "## Goal",
  "",
  b.goal ?? "(not given)",
  "",
  b.remember ? `What a passer-by must remember: ${b.remember}` : "",
  "",
  "## Final copy",
  "",
  spec.kicker ? `- Kicker: ${spec.kicker}` : null,
  `- Headline: ${spec.headline}`,
  spec.sub ? `- Subline: ${spec.sub}` : null,
  ...details.map((d) => `- Detail: ${d.text}`),
  spec.cta ? `- Call to action: ${spec.cta}` : null,
  spec.url ? `- Address: ${spec.url}` : null,
  spec.legal ? `- Legal: ${spec.legal}` : null,
  "",
  "## Layout and hierarchy",
  "",
  `1. ${photoUrl && (spec.layout ?? "auto") !== "type-led" ? "The photo (top 56% of the sheet, bleeding off three edges) sets the mood." : "The headline on the brand color carries the poster on its own."}`,
  "2. The headline, the largest element, fitted to the grid (every word whole, balanced lines).",
  spec.sub ? "3. The subline in the text face, one short sentence." : null,
  details.length
    ? `${spec.sub ? 4 : 3}. The details row with line icons, separated by a hairline.`
    : null,
  spec.cta || spec.url
    ? `${2 + (spec.sub ? 1 : 0) + (details.length ? 1 : 0) + 1}. The call-to-action band in the accent color at the foot of the sheet.`
    : null,
  "",
  `Grid: outer margin ${SAFE_MM + 6} mm inside the trim, one column of text on the full width, 8 px baseline rhythm at A3.`,
  "",
  "## Colors and type",
  "",
  `- Primary ${P.primary}, accent ${P.accent}, text on primary ${P.onPrimary} (contrast ${ratio(P.onPrimary, P.primary)}:1), text on accent ${P.onAccent} (${ratio(P.onAccent, P.accent)}:1). Body text needs at least 4.5:1; both pass.`,
  `- Type: ${L.display.fontFamily.split(",")[0].replace("Zen", "")} for the headline, ${L.body.fontFamily.split(",")[0].replace("Zen", "")} for text (open fonts, SIL OFL).`,
  `- Smallest text on the ${sizeName}: about ${Math.round(size.w * (2.6 / 100) * 2.83)} pt, readable from about 2 m.`,
  "",
  "## Image direction",
  "",
  ...(b.imageIdeas ?? []).map((idea, i) => `${i + 1}. ${idea}`),
  ...(b.avoid?.length ? ["", `Avoid: ${b.avoid.join("; ")}.`] : []),
  "",
  printSpec({
    size,
    sizeName,
    colors: [
      ["Primary", P.primary],
      ["Accent", P.accent],
    ],
    files,
  }),
  "",
  "## Approval checklist",
  "",
  "- [ ] Every date, time, price and address checked against the source.",
  "- [ ] Names and diacritics (ă â î ș ț) correct.",
  "- [ ] Logo is the current version, not stretched, with clear space around it.",
  "- [ ] The printer confirmed size, paper and the CMYK proof.",
  "- [ ] The social versions read on a phone at arm's length.",
  "",
  "## Credits",
  "",
  "Fonts: SIL Open Font License. Mockup photos (Pexels License, free commercial use):",
  ...credits.map((c) => `- ${c}`),
];
const brief = NodePath.join(out, "visual-brief.md");
NodeFS.writeFileSync(
  brief,
  lines
    .filter((l) => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n"),
);
console.log(
  JSON.stringify(
    {
      brief,
      overview,
      print: pdf,
      proof,
      png,
      social,
      mockups,
      seconds: Math.round((Date.now() - started) / 1000),
    },
    null,
    1,
  ),
);
