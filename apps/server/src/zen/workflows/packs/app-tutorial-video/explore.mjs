// Opens a page and lists what a tutorial can click: links, buttons and form fields with the exact
// names to use in the storyboard, plus a screenshot. Usage:
//   node explore.mjs --url https://example.com --out tutorial/explore [--format landscape|vertical] [--cookies accept|reject|leave]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { CURSOR_SCRIPT, handleCookies, pageProblems } from "./browser.mjs";
import { FORMATS, fail, loadPlaywright, options } from "./common.mjs";

const opt = options(process.argv);
const url = opt.get("url");
const out = NodePath.resolve(opt.get("out", "tutorial/explore"));
const format = FORMATS[opt.get("format", "landscape")] ?? FORMATS.landscape;
if (!url || !/^https?:\/\//.test(url)) fail("Use --url https://... (a full web address).");
NodeFS.mkdirSync(out, { recursive: true });

const { chromium, chrome } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chrome });
const context = await browser.newContext({
  viewport: format.viewport,
  deviceScaleFactor: 1,
  isMobile: format.mobile,
  hasTouch: format.mobile,
  locale: opt.get("locale", "ro-RO"),
});
await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
let status;
try {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  status = response?.status();
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
} catch (error) {
  await browser.close();
  fail(`${url} could not be opened: ${error.message.split("\n")[0]}`);
}
const cookie = await handleCookies(page, opt.get("cookies", "accept"));
const problems = await pageProblems(page, { status, allowLogin: true });
const slug =
  new URL(page.url()).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
const shot = NodePath.join(out, `${slug}.png`);
await page.screenshot({ path: shot });
const full = NodePath.join(out, `${slug}-full.jpg`);
await page
  .screenshot({ path: full, fullPage: true, type: "jpeg", quality: 70 })
  .catch(() => undefined);

const elements = await page.evaluate(() => {
  const seen = new Set();
  const items = [];
  const nameOf = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.innerText ||
      el.value ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || (tag === "input" && ["submit", "button"].includes(el.type)))
      return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input")
      return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "textbox";
    return tag;
  };
  const labelOf = (el) => {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.innerText.replace(/\s+/g, " ").trim();
    }
    const parent = el.closest("label");
    return parent ? parent.innerText.replace(/\s+/g, " ").trim() : "";
  };
  for (const el of document.querySelectorAll(
    "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem]",
  )) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (
      rect.width < 4 ||
      rect.height < 4 ||
      style.visibility === "hidden" ||
      style.display === "none"
    )
      continue;
    const role = roleOf(el);
    const name = nameOf(el);
    const label = ["textbox", "combobox", "checkbox", "radio"].includes(role) ? labelOf(el) : "";
    const key = `${role}|${name}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      role,
      name,
      label: label || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      href: el.getAttribute("href") || undefined,
      inView: rect.top >= 0 && rect.bottom <= innerHeight,
      y: Math.round(rect.top + scrollY),
    });
  }
  return items.slice(0, 160);
});
const overlays = await page.evaluate(() =>
  [...document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open]")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 200 &&
        r.height > 120 &&
        getComputedStyle(el).visibility !== "hidden" &&
        getComputedStyle(el).display !== "none"
      );
    })
    .map((el) => ({
      label: el.getAttribute("aria-label") || "",
      text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 200),
      choices: [...el.querySelectorAll("a, button")]
        .map((b) => (b.getAttribute("aria-label") || b.innerText).replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 8),
    })),
);
const headings = await page.evaluate(() =>
  [...document.querySelectorAll("h1, h2, h3")]
    .map((h) => h.innerText.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30),
);
const summary = {
  url: page.url(),
  title: await page.title(),
  status,
  cookieBanner: cookie ?? "none clicked",
  problems,
  overlays,
  screenshot: shot,
  fullPage: full,
  pageHeight: await page.evaluate(() => document.documentElement.scrollHeight),
  headings,
  elements,
};
NodeFS.writeFileSync(NodePath.join(out, `${slug}.json`), JSON.stringify(summary, null, 1));
await browser.close();
if (overlays.length)
  summary.advice =
    "A dialog covers the page when it opens: the storyboard must answer or close it first (a click on one of its choices).";
console.log(
  JSON.stringify(
    {
      ...summary,
      elements: `${elements.length} elements, see ${NodePath.join(out, `${slug}.json`)}`,
    },
    null,
    1,
  ),
);
