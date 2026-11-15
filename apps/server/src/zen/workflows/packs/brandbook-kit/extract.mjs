// Reads an existing website for the brandbook: the colors it really uses (weighted by area),
// its fonts, logo candidates, title, description and a screenshot.
// Usage: node extract.mjs --url https://example.com --out brandbook/extract
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const url = option("url");
const out = NodePath.resolve(option("out", "brandbook/extract"));
if (!url || !/^https?:\/\//.test(url)) fail("Use --url https://... (a full web address).");
const modules = process.env.ZEN_PLAYWRIGHT_MODULES;
const chrome = process.env.ZEN_CHROME;
if (!modules || !chrome)
  fail(
    "The browser tools are not prepared (ZEN_PLAYWRIGHT_MODULES / ZEN_CHROME). Start the task from Zen Staff.",
  );
const { chromium } = NodeModule.createRequire(NodePath.join(modules, "zen.cjs"))("playwright-core");
NodeFS.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: chrome });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
} catch (error) {
  await browser.close();
  fail(`${url} could not be opened: ${error.message.split("\n")[0]}`);
}
await page.screenshot({ path: NodePath.join(out, "site.png") });
const data = await page.evaluate(() => {
  const toHex = (value) => {
    const m = value && value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    );
  };
  const backgrounds = {};
  const texts = {};
  const fonts = {};
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.top > 6000) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") continue;
    const bg = toHex(s.backgroundColor);
    if (bg) backgrounds[bg] = (backgrounds[bg] || 0) + r.width * r.height;
    const ownText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (ownText) {
      const c = toHex(s.color);
      const weight = (el.textContent || "").trim().length * parseFloat(s.fontSize);
      if (c) texts[c] = (texts[c] || 0) + weight;
      const family = s.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      const key = `${family}|${/^h[1-6]$/i.test(el.tagName) || parseFloat(s.fontSize) >= 28 ? "heading" : "body"}`;
      fonts[key] = (fonts[key] || 0) + weight;
    }
  }
  const top = (map, n) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => ({ value: k, weight: Math.round(v) }));
  const logos = [
    ...document.querySelectorAll(
      "header img, header svg, nav img, nav svg, a[href='/'] img, a[href='/'] svg, img[alt*='logo' i], img[src*='logo' i], [class*='logo' i] img, [class*='logo' i] svg",
    ),
  ]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 16 && r.height >= 16 && r.top < 400;
    })
    .slice(0, 4)
    .map((el, i) => {
      el.setAttribute("data-zen-logo", String(i));
      return {
        index: i,
        tag: el.tagName.toLowerCase(),
        alt: el.getAttribute("alt") || "",
        src: el.getAttribute("src") || "",
      };
    });
  const meta = (name) =>
    document
      .querySelector(`meta[name='${name}'], meta[property='${name}']`)
      ?.getAttribute("content") || "";
  return {
    title: document.title,
    description: meta("description") || meta("og:description"),
    siteName: meta("og:site_name"),
    themeColor: meta("theme-color"),
    headings: [...document.querySelectorAll("h1, h2")]
      .map((h) => h.innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 12),
    backgroundColors: top(backgrounds, 8),
    textColors: top(texts, 8),
    fonts: top(fonts, 8).map(({ value, weight }) => ({
      family: value.split("|")[0],
      use: value.split("|")[1],
      weight,
    })),
    logos,
  };
});
const logoFiles = [];
for (const logo of data.logos) {
  const file = NodePath.join(out, `logo-candidate-${logo.index + 1}.png`);
  const ok = await page
    .locator(`[data-zen-logo="${logo.index}"]`)
    .screenshot({ path: file, omitBackground: true })
    .then(() => true)
    .catch(() => false);
  if (ok) logoFiles.push(file);
}
await browser.close();
const result = { url, ...data, logoFiles, screenshot: NodePath.join(out, "site.png") };
NodeFS.writeFileSync(NodePath.join(out, "extract.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
