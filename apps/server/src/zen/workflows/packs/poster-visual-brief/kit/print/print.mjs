// Print production for the design packs (Chrome through Playwright): trim sizes in mm, 3 mm bleed,
// a print PDF and a proof with crop marks, a 300 dpi PNG, social sizes, the kit fonts. Chrome
// writes sRGB PDFs: the spec sheet gives approximate CMYK and asks the printer to convert.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { fontFaceCss } from "../common/type.js";
import { cmyk } from "../common/color.js";

export const SIZES = {
  A2: { w: 420, h: 594, label: "A2 poster" },
  A3: { w: 297, h: 420, label: "A3 poster" },
  A4: { w: 210, h: 297, label: "A4 poster or flyer" },
  A5: { w: 148, h: 210, label: "A5 flyer" },
  DL: { w: 99, h: 210, label: "DL flyer" },
  "50x70": { w: 500, h: 700, label: "50x70 cm poster" },
};
export const SOCIAL = {
  "instagram-post": { w: 1080, h: 1350, label: "Instagram / Facebook post (4:5)" },
  "instagram-story": { w: 1080, h: 1920, label: "Story / Reels cover (9:16)" },
  "square-post": { w: 1080, h: 1080, label: "Square post (1:1)" },
  "facebook-event": { w: 1920, h: 1005, label: "Facebook event cover" },
};
export const BLEED_MM = 3;
export const SAFE_MM = 6;
const MM = 96 / 25.4; // CSS px per mm

export const mmToPx = (mm) => mm * MM;

export function loadPlaywright() {
  const modules = process.env.ZEN_PLAYWRIGHT_MODULES;
  const chrome = process.env.ZEN_CHROME;
  if (!modules || !NodeFS.existsSync(modules) || !chrome || !NodeFS.existsSync(chrome)) {
    console.error(
      "ERROR: The browser tools are not prepared (ZEN_PLAYWRIGHT_MODULES / ZEN_CHROME are not set). Start the task from Zen Staff.",
    );
    process.exit(1);
  }
  const require = NodeModule.createRequire(NodePath.join(modules, "zen.cjs"));
  return { chromium: require("playwright-core").chromium, chrome };
}

/** @font-face rules pointing at the open-fonts toolchain (file URLs, no network). */
export function fontsCss() {
  const dir = process.env.ZEN_FONTS_DIR;
  if (!dir || !NodeFS.existsSync(dir)) {
    console.error(
      "ERROR: The fonts are not prepared (ZEN_FONTS_DIR is not set). Start the task from Zen Staff.",
    );
    process.exit(1);
  }
  return fontFaceCss((file) => NodeURL.pathToFileURL(NodePath.join(dir, file)).href);
}

const pagesDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-print-"));
let pageCount = 0;
process.on("exit", () => NodeFS.rmSync(pagesDir, { recursive: true, force: true }));

/**
 * Opens HTML from a file (file:// pages may load the local fonts and photos; about:blank may not).
 * Returns the file URL.
 */
export async function loadHtml(page, html) {
  const file = NodePath.join(pagesDir, `page-${++pageCount}.html`);
  NodeFS.writeFileSync(file, html);
  const url = NodeURL.pathToFileURL(file).href;
  await page.goto(url, { waitUntil: "load" });
  await settle(page);
  return url;
}

/** Waits until every font and image of the page is ready. */
export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)),
      ),
    );
  });
}

/**
 * Print PDF of an HTML page laid out at trim + bleed (the page's CSS must use the full sheet,
 * backgrounds running into the bleed). Also writes the proof with crop marks next to it.
 */
export async function printPdfs(browser, { html, size, out, proof }) {
  const W = size.w + BLEED_MM * 2;
  const H = size.h + BLEED_MM * 2;
  const page = await browser.newPage({
    viewport: { width: Math.round(mmToPx(W)), height: Math.round(mmToPx(H)) },
  });
  const sheetUrl = await loadHtml(page, html);
  await page.pdf({
    path: out,
    width: `${W}mm`,
    height: `${H}mm`,
    printBackground: true,
    pageRanges: "1",
  });
  if (proof) {
    // The same sheet on a larger page with crop marks at the trim, 8 mm slug around the bleed.
    const slug = 8;
    const PW = W + slug * 2;
    const PH = H + slug * 2;
    const marks = cropMarks(size, slug);
    const wrap = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${PW}mm;height:${PH}mm;background:#fff}</style></head><body><iframe src="${sheetUrl}" style="position:absolute;left:${slug}mm;top:${slug}mm;border:0;width:${W}mm;height:${H}mm"></iframe>${marks}</body></html>`;
    await page.setViewportSize({ width: Math.round(mmToPx(PW)), height: Math.round(mmToPx(PH)) });
    await loadHtml(page, wrap);
    await page.waitForTimeout(500);
    await page.pdf({
      path: proof,
      width: `${PW}mm`,
      height: `${PH}mm`,
      printBackground: true,
      pageRanges: "1",
    });
  }
  await page.close();
}

/** SVG crop marks for a trim size placed at (slug + bleed) on the proof sheet. */
export function cropMarks(size, slug = 8) {
  const W = size.w + BLEED_MM * 2 + slug * 2;
  const H = size.h + BLEED_MM * 2 + slug * 2;
  const x0 = slug + BLEED_MM;
  const y0 = slug + BLEED_MM;
  const x1 = x0 + size.w;
  const y1 = y0 + size.h;
  const len = 5;
  const gap = BLEED_MM + 1;
  const lines = [];
  for (const x of [x0, x1]) {
    lines.push([x, y0 - gap - len, x, y0 - gap], [x, y1 + gap, x, y1 + gap + len]);
  }
  for (const y of [y0, y1]) {
    lines.push([x0 - gap - len, y, x0 - gap, y], [x1 + gap, y, x1 + gap + len, y]);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:0;top:0" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${lines
    .map(
      ([a, b, c, d]) =>
        `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#000" stroke-width="0.25"/>`,
    )
    .join("")}</svg>`;
}

/** PNG of the trimmed page (bleed cut off) at `dpi`. */
export async function printPng(browser, { html, size, out, dpi = 300 }) {
  const W = size.w + BLEED_MM * 2;
  const H = size.h + BLEED_MM * 2;
  const scale = dpi / 96;
  const page = await browser.newPage({
    viewport: { width: Math.round(mmToPx(W)), height: Math.round(mmToPx(H)) },
    deviceScaleFactor: scale,
  });
  await loadHtml(page, html);
  await page.screenshot({
    path: out,
    clip: {
      x: mmToPx(BLEED_MM),
      y: mmToPx(BLEED_MM),
      width: mmToPx(size.w),
      height: mmToPx(size.h),
    },
  });
  await page.close();
  return { width: Math.round((size.w / 25.4) * dpi), height: Math.round((size.h / 25.4) * dpi) };
}

/** PNG of an HTML page at exact pixel size (social formats). */
export async function pixelPng(browser, { html, width, height, out, jpeg = false }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await loadHtml(page, html);
  await page.screenshot({ path: out, type: jpeg ? "jpeg" : "png", quality: jpeg ? 92 : undefined });
  await page.close();
}

/** The print spec as Markdown lines (sizes, bleed, safe zone, color note, files). */
export function printSpec({ size, sizeName, colors, files }) {
  const px = (mm) => Math.round((mm / 25.4) * 300);
  return [
    "## Print specifications",
    "",
    `- Format: ${sizeName} (${size.w} x ${size.h} mm trim), portrait.`,
    `- Bleed: ${BLEED_MM} mm on every side (the print PDF is ${size.w + BLEED_MM * 2} x ${size.h + BLEED_MM * 2} mm). Text and logos stay ${SAFE_MM} mm inside the trim.`,
    `- Resolution: the PNG is 300 dpi at trim size (${px(size.w)} x ${px(size.h)} px); photos in the layout were checked for at least 150 dpi at print size.`,
    "- Color: the files are sRGB. Ask the printer to convert to CMYK with their profile (for coated paper usually FOGRA39 / ISO Coated v2, uncoated FOGRA29) and to send a proof before the run. Approximate CMYK of the brand colors:",
    ...colors.map(
      ([name, hex]) =>
        `  - ${name} ${hex}: C${cmyk(hex)[0]} M${cmyk(hex)[1]} Y${cmyk(hex)[2]} K${cmyk(hex)[3]}`,
    ),
    "- Paper: 170-200 g/m² silk or matt for posters, 300-350 g/m² for flyers that should feel solid.",
    "",
    "### Files",
    "",
    ...files.map(([what, file]) => `- ${what}: ${file}`),
  ].join("\n");
}
