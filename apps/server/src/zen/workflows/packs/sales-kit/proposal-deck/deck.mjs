// Builds a 16:9 offer deck from deck.json (layouts in SKILL.md): PDF, one PNG per slide, contact
// sheet, speaker notes, and the same deck as an editable PowerPoint file (pptx.mjs).
//   node deck.mjs --deck deck/deck.json --out deck
// Text that does not fit is shrunk a little; if it still does not fit, ERROR lines name the slide.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { writePptx } from "./pptx.mjs";
import { contrast, deckTheme, HEX, labels, LAYOUTS, pad2 } from "./theme.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const deckPath = option("deck");
const out = NodePath.resolve(option("out", "deck"));
if (!deckPath) fail("Use --deck <deck.json> --out <folder>.");
const modules = process.env.ZEN_PLAYWRIGHT_MODULES;
const chrome = process.env.ZEN_CHROME;
const fontsDir = process.env.ZEN_FONTS_DIR;
if (!modules || !chrome)
  fail(
    "The browser tools are not prepared (ZEN_PLAYWRIGHT_MODULES / ZEN_CHROME). Start the task from Zen Staff.",
  );
if (!fontsDir) fail("The fonts are not prepared (ZEN_FONTS_DIR). Start the task from Zen Staff.");

let deck;
try {
  deck = JSON.parse(NodeFS.readFileSync(deckPath, "utf8"));
} catch (error) {
  fail(`deck.json could not be read: ${error.message}`);
}
const base = NodePath.dirname(NodePath.resolve(deckPath));
const problems = [];
const lang = deck.language === "en" ? "en" : "ro";
const brand = deck.brand ?? {};
const theme = deckTheme(deck);
const { colors } = theme;
for (const [k, v] of Object.entries(colors))
  if (!HEX.test(v)) problems.push(`brand.colors.${k} must look like #1A2B3C.`);
if (!deck.title) problems.push('"title" is required.');
if (!Array.isArray(deck.slides) || deck.slides.length < 3 || deck.slides.length > 16)
  problems.push('"slides" needs 3 to 16 slides.');
const fileData = (file, what) => {
  if (!file) return null;
  const abs = NodePath.resolve(base, file);
  if (!NodeFS.existsSync(abs)) {
    problems.push(`${what}: ${file} does not exist (paths are relative to deck.json).`);
    return null;
  }
  const ext = NodePath.extname(abs).toLowerCase().slice(1);
  const mime = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    svg: "image/svg+xml",
  }[ext];
  if (!mime) {
    problems.push(`${what}: use PNG, JPG, WEBP or SVG.`);
    return null;
  }
  return `data:${mime};base64,${NodeFS.readFileSync(abs).toString("base64")}`;
};
const logo = fileData(brand.logo, "brand.logo");
const logoOnDark = fileData(brand.logoOnDark, "brand.logoOnDark");
const clientLogo = fileData(deck.client?.logo, "client.logo");
(deck.slides ?? []).forEach((s, i) => {
  if (!LAYOUTS.includes(s.layout))
    problems.push(`slides[${i}].layout must be one of ${LAYOUTS.join(", ")}.`);
  const need = {
    points: ["points", 2, 4],
    numbers: ["stats", 2, 4],
    timeline: ["steps", 3, 6],
    pricing: ["options", 1, 3],
    next: ["steps", 1, 5],
  }[s.layout];
  if (need) {
    const list = s[need[0]];
    if (!Array.isArray(list) || list.length < need[1] || list.length > need[2])
      problems.push(
        `slides[${i}] (${s.layout}) needs "${need[0]}" with ${need[1]} to ${need[2]} items.`,
      );
  }
  if (
    s.layout === "table" &&
    (!Array.isArray(s.columns) ||
      !Array.isArray(s.rows) ||
      s.rows.length > 8 ||
      s.columns.length > 5)
  )
    problems.push(`slides[${i}] (table) needs "columns" (up to 5) and "rows" (up to 8).`);
  if (s.layout === "quote" && !s.quote) problems.push(`slides[${i}] (quote) needs "quote".`);
  if (s.chart !== undefined) {
    const bars = s.chart?.bars;
    if (
      s.layout !== "numbers" ||
      !Array.isArray(bars) ||
      bars.length < 2 ||
      bars.length > 8 ||
      !bars.every(
        (b) =>
          b && b.label !== undefined && Number.isFinite(Number(b.value)) && Number(b.value) >= 0,
      )
    )
      problems.push(
        `slides[${i}].chart goes on a numbers slide and needs "bars": 2 to 8 items { "label", "value" } with numbers of 0 or more.`,
      );
  }
  if (s.image) s._image = fileData(s.image, `slides[${i}].image`);
});
if (problems.length) fail(problems.join("\nERROR: "));

const { accentText, paper, muted, rule, onPrimary, onPrimaryMuted, look, onColor } = theme;
const FONT_FILES = [
  ["Barlow", "Barlow-Regular.ttf", "400"],
  ["Barlow", "Barlow-SemiBold.ttf", "600"],
  ["Barlow", "Barlow-ExtraBold.ttf", "800"],
  ["Barlow Condensed", "BarlowCondensed-Bold.ttf", "700"],
  ["Barlow Condensed", "BarlowCondensed-ExtraBold.ttf", "800"],
  ["Source Sans 3", "SourceSans3.ttf", "200 900"],
  ["Playfair Display", "PlayfairDisplay.ttf", "400 900"],
];
const fontFaces = FONT_FILES.filter(([, file]) => NodeFS.existsSync(NodePath.join(fontsDir, file)))
  .map(
    ([family, file, weight]) =>
      `@font-face{font-family:"${family}";src:url("data:font/ttf;base64,${NodeFS.readFileSync(NodePath.join(fontsDir, file)).toString("base64")}") format("truetype");font-weight:${weight};font-style:normal;font-display:block}`,
  )
  .join("\n");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// **word** marks the one phrase to set in the accent colour.
const rich = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<em class="hl">$1</em>');
const ICON = {
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
};
const total = deck.slides.length;
const T = labels(lang);

const CSS = `${fontFaces}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;background:#888}
.slide{width:1920px;height:1080px;position:relative;overflow:hidden;background:${paper};color:${colors.dark};font-family:"${look.body}",sans-serif;font-size:30px;line-height:1.42;page-break-after:always;break-after:page}
.slide.dark{background:${colors.primary};color:${onPrimary}}
.pad{position:absolute;inset:104px 128px 150px 128px;display:flex;flex-direction:column}
.kicker{font-family:"${look.label}",sans-serif;font-weight:${look.label === "Source Sans 3" ? 700 : 800};font-size:21px;letter-spacing:.2em;text-transform:uppercase;color:${accentText};display:flex;align-items:center;gap:20px;margin-bottom:34px}
.kicker:before{content:"";width:56px;height:3px;background:${colors.accent}}
.dark .kicker{color:${onPrimary}}
.h{text-wrap:balance;font-family:"${look.head}",serif;font-weight:${look.headWeight};letter-spacing:${look.tracking};text-transform:${look.headCase};line-height:1.06;font-size:76px;max-width:1500px}
.h .hl,.statement .hl{font-style:normal;color:${accentText}}
.dark .h .hl{color:${contrast(colors.accent, colors.primary) >= 3 ? colors.accent : onPrimary};}
.lead{font-size:33px;color:${muted};max-width:1180px;margin-top:30px}
.dark .lead{color:${onPrimaryMuted}}
.foot{position:absolute;left:128px;right:128px;bottom:56px;display:flex;justify-content:space-between;align-items:center;font-family:"${look.label}",sans-serif;font-size:18px;letter-spacing:.14em;text-transform:uppercase;color:${muted}}
.dark .foot{color:${onPrimaryMuted}}
.foot .brand{display:flex;align-items:center;gap:18px}.foot img{height:34px;width:auto}
.num{font-family:"${look.numbers}",sans-serif;font-weight:${look.numbers === "Playfair Display" ? 500 : 700};font-variant-numeric:lining-nums}
/* cover */
.cover .top{position:absolute;top:96px;left:128px;right:128px;display:flex;justify-content:space-between;align-items:center}
.cover .top img{max-height:92px;max-width:420px}
.cover .wordmark{font-family:"${look.head}",serif;font-weight:${look.strong};font-size:40px;letter-spacing:.02em}
.cover .for{font-family:"${look.label}",sans-serif;font-size:21px;letter-spacing:.2em;text-transform:uppercase;color:${onPrimaryMuted};display:flex;align-items:center;gap:22px}
.cover .for img{max-height:64px;max-width:260px;background:#fff;padding:10px 14px;border-radius:6px}
.cover .body{position:absolute;left:128px;bottom:190px;width:1340px}
.cover .bar{width:120px;height:8px;background:${colors.accent};margin-bottom:46px}
.cover .h{font-size:112px;line-height:1.0}
.cover .sub{font-size:38px;margin-top:34px;color:${onPrimaryMuted};max-width:1100px}
.cover .meta{position:absolute;left:128px;bottom:96px;font-family:"${look.label}",sans-serif;font-size:21px;letter-spacing:.18em;text-transform:uppercase;color:${onPrimaryMuted}}
.cover .photo{position:absolute;top:0;right:0;bottom:0;width:42%;background-size:cover;background-position:center}
.cover .photo:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,${colors.primary} 0%,${colors.primary}00 38%)}
.cover.withphoto .body{width:980px}.cover.withphoto .top{right:calc(42% + 64px)}
/* statement */
.statement .pad{justify-content:center}
.statement .h{font-size:84px;max-width:1450px;line-height:1.08}
.statement .lead{font-size:34px;max-width:1150px;margin-top:44px}
/* points */
.cols{display:grid;gap:72px;margin:auto 0}
.col{border-top:2px solid ${colors.dark};padding-top:30px;display:flex;flex-direction:column}
.dark .col{border-color:${onPrimary}}
.col .n{font-size:76px;line-height:1;color:${accentText};margin-bottom:26px}
.col h3{font-family:"${look.head}",serif;font-weight:${look.headWeight};font-size:46px;line-height:1.14;margin-bottom:16px;text-transform:${look.headCase}}
.col p{font-size:30px;line-height:1.45;color:${muted}}
h3,.c1{text-wrap:balance}p,li{text-wrap:pretty}
/* split */
.split .foot{right:calc(44% + 96px)}
.split .pad{right:calc(44% + 96px)}
.split .media{position:absolute;top:0;right:0;bottom:0;width:44%;background:${colors.primary} center/cover no-repeat;display:flex;align-items:flex-end;padding:96px 96px 150px;color:${onPrimary}}
.split .media .big{font-size:150px;line-height:1}.split .media .cap{font-size:28px;margin-top:18px;color:${onPrimaryMuted}}
.split .h{font-size:66px}
.list{list-style:none;margin-top:40px;display:flex;flex-direction:column;gap:22px}
.list li{display:flex;gap:22px;font-size:32px;line-height:1.4}
.list li i{flex:none;width:34px;height:34px;margin-top:5px;color:${accentText}}
.list li i svg{width:34px;height:34px}
/* numbers */
.stats{display:grid;gap:64px;margin:auto 0}
.stat{border-left:3px solid ${colors.accent};padding-left:34px}
.stat .v{font-size:176px;line-height:.95;color:${colors.primary === paper ? colors.dark : contrast(colors.primary, paper) >= 3 ? colors.primary : colors.dark}}
.dark .stat .v{color:${onPrimary}}
.stat .l{font-size:31px;margin-top:22px;color:${muted};max-width:470px}
.dark .stat .l{color:${onPrimaryMuted}}.dark .chart .ct{color:${onPrimary}}
.withchart .stats{margin:48px 0 0}.withchart .stat .v{font-size:120px}
.chart{margin-top:auto;height:330px;display:flex;flex-direction:column}
.chart .ct{font-family:"${look.label}",sans-serif;font-weight:800;font-size:19px;letter-spacing:.16em;text-transform:uppercase;color:${accentText};height:40px}
.chart .bars{flex:1;display:flex;align-items:flex-end;gap:3%;border-bottom:2px solid ${muted};padding:0 2%}
.chart .bc{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}
.chart .bv{font-size:24px;color:${colors.dark};margin-bottom:8px}
.chart .bb{width:100%;background:${colors.primary}}
.dark .chart .bb{background:${onPrimary}}.dark .chart .bv{color:${onPrimary}}.dark .chart .bars{border-color:${onPrimaryMuted}}
.chart .bl{display:flex;gap:3%;padding:10px 2% 0;font-size:20px;color:${muted}}.chart .bl span{flex:1;text-align:center}
.dark .chart .bl{color:${onPrimaryMuted}}
/* timeline */
.tl{position:relative;display:grid;gap:48px;margin:auto 0;padding-top:72px}
.tl:before{content:"";position:absolute;top:13px;left:0;right:0;height:2px;background:${rule}}
.step{position:relative}
.step:before{content:"";position:absolute;top:-64px;left:0;width:28px;height:28px;border-radius:50%;background:${paper};border:6px solid ${colors.accent}}
.step .w{font-family:"${look.label}",sans-serif;font-weight:800;font-size:22px;letter-spacing:.18em;text-transform:uppercase;color:${accentText};margin-bottom:14px}
.step h3{font-family:"${look.head}",serif;font-weight:${look.headWeight};font-size:40px;line-height:1.15;margin-bottom:12px;text-transform:${look.headCase}}
.step p{font-size:28px;color:${muted};line-height:1.42}
/* pricing */
.cards{display:grid;gap:44px;margin:auto 0;align-items:stretch}
.card{border:2px solid ${rule};border-radius:14px;padding:48px 46px;display:flex;flex-direction:column;background:${theme.card}}
.card.rec{background:${colors.primary};color:${onPrimary};border-color:${colors.primary}}
.card .name{font-family:"${look.label}",sans-serif;font-weight:800;font-size:22px;letter-spacing:.18em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center}
.card .tag{font-size:17px;letter-spacing:.14em;background:${colors.accent};color:${onColor(colors.accent)};padding:8px 14px;border-radius:999px}
.card .price{font-size:108px;line-height:1;margin-top:34px}
.card .unit{font-size:27px;color:${muted};margin-top:10px}.card.rec .unit{color:${onPrimaryMuted}}
.card ul{list-style:none;margin-top:36px;padding-top:30px;border-top:1px solid ${rule};display:flex;flex-direction:column;gap:16px}
.card.rec ul{border-color:${onPrimaryMuted}}
.card li{display:flex;gap:16px;font-size:29px;line-height:1.35}.card li i{flex:none;width:28px;height:28px;margin-top:3px;color:${accentText}}.card.rec li i{color:${contrast(colors.accent, colors.primary) >= 3 ? colors.accent : onPrimary}}
.note{font-size:25px;color:${muted};margin-top:-8px}
/* table */
table{width:100%;border-collapse:collapse;margin:auto 0;font-size:30px}
th{font-family:"${look.label}",sans-serif;font-weight:800;font-size:19px;letter-spacing:.16em;text-transform:uppercase;text-align:left;color:${accentText};padding:0 22px 22px 0;border-bottom:2px solid ${colors.dark}}
td{padding:22px 22px 22px 0;border-bottom:1px solid ${rule};vertical-align:top}
td.r,th.r{text-align:right}td:first-child{font-weight:600}
/* quote */
.quote .pad{justify-content:center}
.quote .mark{font-family:"Playfair Display",serif;font-size:260px;line-height:.6;color:${colors.accent};height:120px}
.quote blockquote{font-family:"Playfair Display",serif;font-style:normal;font-weight:500;font-size:64px;line-height:1.18;max-width:1500px}
.quote .who{margin-top:44px;font-family:"${look.label}",sans-serif;font-size:22px;letter-spacing:.18em;text-transform:uppercase;color:${muted}}
.dark.quote .who{color:${onPrimaryMuted}}
/* next */
.next .grid{display:grid;grid-template-columns:1.2fr 1fr;gap:96px;margin:auto 0;align-items:center}
.next ol{list-style:none;counter-reset:s;display:flex;flex-direction:column;gap:26px}
.next li{counter-increment:s;display:flex;gap:28px;font-size:36px;line-height:1.35;align-items:baseline}
.next li:before{content:counter(s,decimal-leading-zero);font-family:"${look.numbers}",sans-serif;font-weight:700;font-size:34px;color:${colors.accent};flex:none;width:58px}
.cta{background:${colors.primary};color:${onPrimary};border-radius:16px;padding:52px 52px 48px}
.dark .cta{background:${paper};color:${colors.dark}}
.cta .c1{font-family:"${look.head}",serif;font-weight:${look.headWeight};font-size:50px;line-height:1.12;text-transform:${look.headCase}}
.cta .hl{font-style:normal;color:${theme.accentOnPrimary}}.dark .cta .hl{color:${accentText}}
.cta .c2{font-size:30px;margin-top:22px;opacity:.86;white-space:pre-line}
.cta .go{display:inline-flex;align-items:center;gap:14px;margin-top:30px;font-family:"${look.label}",sans-serif;font-weight:800;font-size:20px;letter-spacing:.16em;text-transform:uppercase;color:${contrast(colors.accent, colors.primary) >= 3 ? colors.accent : onPrimary}}
.cta .go svg{width:26px;height:26px}
.dark .cta .go{color:${accentText}}
`;

// On a dark slide only a logo made for dark backgrounds is used; otherwise the name is set in type.
const brandMark = (dark) => {
  const src = dark ? logoOnDark : logo;
  return src ? `<img src="${src}" alt="">` : `<span>${esc(brand.name ?? "")}</span>`;
};
const foot = (i, dark) =>
  `<div class="foot"><div class="brand">${brandMark(dark)}${deck.client?.name ? `<span>${T.for} ${esc(deck.client.name)}</span>` : ""}</div><div class="num">${pad2(i + 1)} / ${pad2(total)}</div></div>`;
const head = (s) =>
  `${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ""}${s.title ? `<h2 class="h" data-fit="title">${rich(s.title)}</h2>` : ""}`;
const cols = (n) => `grid-template-columns:repeat(${n},1fr)`;

function slideHtml(s, i) {
  const dark = s.dark === true || (s.dark !== false && ["cover"].includes(s.layout));
  const cls = `slide ${s.layout}${dark ? " dark" : ""}`;
  switch (s.layout) {
    case "cover": {
      const photo = s._image ?? null;
      const top = `<div class="top">${logoOnDark ? brandMark(true) : `<span class="wordmark">${esc(brand.name ?? "")}</span>`}${deck.client?.name && !photo ? `<div class="for">${T.for} ${clientLogo ? `<img src="${clientLogo}" alt="">` : `<span>${esc(deck.client.name)}</span>`}</div>` : ""}</div>`;
      return `<section class="${cls}${photo ? " withphoto" : ""}" data-slide="${i + 1}">${photo ? `<div class="photo" style="background-image:url('${photo}')"></div>` : ""}${top}<div class="body"><div class="bar"></div><h1 class="h" data-fit="title">${rich(s.title ?? deck.title)}</h1>${(s.subtitle ?? deck.subtitle) ? `<p class="sub" data-fit="sub">${rich(s.subtitle ?? deck.subtitle)}</p>` : ""}</div><div class="meta">${[deck.client?.name && photo ? `${T.for} ${deck.client.name}` : "", deck.date, deck.author].filter(Boolean).map(esc).join("&nbsp;&nbsp;·&nbsp;&nbsp;")}</div></section>`;
    }
    case "statement":
      return `<section class="${cls}" data-slide="${i + 1}"><div class="pad" data-fit="box">${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ""}<h2 class="h" data-fit="title">${rich(s.title)}</h2>${s.text ? `<p class="lead">${rich(s.text)}</p>` : ""}</div>${foot(i, dark)}</section>`;
    case "points":
      return `<section class="${cls}" data-slide="${i + 1}"><div class="pad" data-fit="box">${head(s)}<div class="cols" style="${cols(s.points.length)}">${s.points.map((p, k) => `<div class="col"><div class="n num">${pad2(k + 1)}</div><h3>${rich(p.title)}</h3>${p.text ? `<p>${rich(p.text)}</p>` : ""}</div>`).join("")}</div></div>${foot(i, dark)}</section>`;
    case "split": {
      const media = s._image
        ? `<div class="media" style="background-image:url('${s._image}')"></div>`
        : `<div class="media"><div><div class="big num">${esc(s.figure ?? "")}</div>${s.caption ? `<div class="cap">${esc(s.caption)}</div>` : ""}</div></div>`;
      return `<section class="${cls}" data-slide="${i + 1}">${media}<div class="pad" data-fit="box">${head(s)}${s.text ? `<p class="lead">${rich(s.text)}</p>` : ""}${Array.isArray(s.bullets) && s.bullets.length ? `<ul class="list">${s.bullets.map((b) => `<li><i>${ICON.check}</i><span>${rich(b)}</span></li>`).join("")}</ul>` : ""}</div>${foot(i, false)}</section>`;
    }
    case "numbers": {
      // Optional bar chart under the stats; the PowerPoint file gets the same data as a native chart.
      const bars = s.chart?.bars ?? [];
      const top = Math.max(...bars.map((b) => Number(b.value)), 0) || 1;
      const number = (v) => Number(v).toLocaleString(lang === "en" ? "en-GB" : "ro-RO");
      const chart = bars.length
        ? `<div class="chart"><div class="ct">${esc([s.chart.title, s.chart.unit].filter(Boolean).join(" · "))}</div><div class="bars">${bars.map((b) => `<div class="bc"><div class="bv num">${esc(number(b.value))}</div><div class="bb" style="height:${Math.max(1, (Number(b.value) / top) * 78)}%"></div></div>`).join("")}</div><div class="bl">${bars.map((b) => `<span>${esc(b.label)}</span>`).join("")}</div></div>`
        : "";
      return `<section class="${cls}${bars.length ? " withchart" : ""}" data-slide="${i + 1}"><div class="pad" data-fit="box">${head(s)}${s.text ? `<p class="lead">${rich(s.text)}</p>` : ""}<div class="stats" style="${cols(s.stats.length)}">${s.stats.map((st) => `<div class="stat"><div class="v num">${esc(st.value)}</div><div class="l">${rich(st.label)}</div></div>`).join("")}</div>${chart}</div>${foot(i, dark)}</section>`;
    }
    case "timeline":
      return `<section class="${cls}" data-slide="${i + 1}"><div class="pad" data-fit="box">${head(s)}<div class="tl" style="${cols(s.steps.length)}">${s.steps.map((st) => `<div class="step"><div class="w">${esc(st.when ?? "")}</div><h3>${rich(st.title)}</h3>${st.text ? `<p>${rich(st.text)}</p>` : ""}</div>`).join("")}</div></div>${foot(i, dark)}</section>`;
    case "pricing":
      return `<section class="${cls}" data-slide="${i + 1}"><div class="pad" data-fit="box">${head(s)}<div class="cards" style="${cols(s.options.length)}">${s.options.map((o) => `<div class="card${o.recommended ? " rec" : ""}"><div class="name"><span>${esc(o.name)}</span>${o.recommended ? `<span class="tag">${T.recommended}</span>` : ""}</div><div class="price num">${esc(o.price)}</div>${o.unit ? `<div class="unit">${esc(o.unit)}</div>` : ""}<ul>${(o.features ?? []).map((f) => `<li><i>${ICON.check}</i><span>${rich(f)}</span></li>`).join("")}</ul></div>`).join("")}</div>${s.note ? `<p class="note">${rich(s.note)}</p>` : ""}</div>${foot(i, dark)}</section>`;
    case "table": {
      const right = (s.align ?? []).map((a) => a === "right");
      return `<section class="${cls}" data-slide="${i + 1}"><div class="pad" data-fit="box">${head(s)}<table><thead><tr>${s.columns.map((c, k) => `<th class="${right[k] ? "r" : ""}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c, k) => `<td class="${right[k] ? "r num" : ""}">${rich(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>${s.note ? `<p class="note">${rich(s.note)}</p>` : ""}</div>${foot(i, dark)}</section>`;
    }
    case "quote":
      return `<section class="${cls}" data-slide="${i + 1}"><div class="pad" data-fit="box"><div class="mark">“</div><blockquote data-fit="title">${rich(s.quote)}</blockquote>${s.author ? `<div class="who">${esc(s.author)}</div>` : ""}</div>${foot(i, dark)}</section>`;
    case "next":
      return `<section class="${cls}" data-slide="${i + 1}"><div class="pad" data-fit="box">${head(s)}<div class="grid"><ol>${s.steps.map((st) => `<li><span>${rich(st)}</span></li>`).join("")}</ol><div class="cta"><div class="c1">${rich(s.cta ?? "")}</div>${s.contact ? `<div class="c2">${esc(s.contact)}</div>` : ""}${s.action ? `<div class="go">${esc(s.action)} ${ICON.arrow}</div>` : ""}</div></div></div>${foot(i, dark)}</section>`;
    default:
      return "";
  }
}

const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${deck.slides.map(slideHtml).join("\n")}</body></html>`;

// Shrinks titles that run long, then lists every box that still overflows.
const FIT = () => {
  const report = [];
  const fits = [];
  for (const slide of document.querySelectorAll(".slide")) {
    const n = Number(slide.dataset.slide);
    const fit = {};
    fits.push(fit);
    for (const el of slide.querySelectorAll('[data-fit="title"]')) {
      let size = parseFloat(getComputedStyle(el).fontSize);
      const min = size * 0.72;
      const maxLines = el.closest(".cover") ? 3 : el.closest(".statement,.quote") ? 4 : 2;
      const lineHeight = () => parseFloat(getComputedStyle(el).lineHeight) || size * 1.1;
      while (el.scrollHeight > lineHeight() * maxLines + 4 && size > min) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
      if (el.scrollHeight > lineHeight() * maxLines + 4)
        report.push({ slide: n, what: "title", text: el.textContent.slice(0, 60) });
      fit.title = size;
    }
    const box = slide.querySelector('[data-fit="box"]');
    if (box) {
      let scale = 1;
      fit.inner = 1;
      while (box.scrollHeight > box.clientHeight + 2 && scale > 0.8) {
        scale -= 0.04;
        fit.inner *= 0.96;
        box.style.fontSize = `${30 * scale}px`;
        for (const t of box.querySelectorAll("p,li,h3,td,.l"))
          t.style.fontSize = `${parseFloat(getComputedStyle(t).fontSize) * 0.96}px`;
      }
      if (box.scrollHeight > box.clientHeight + 2)
        report.push({ slide: n, what: "content", overflowPx: box.scrollHeight - box.clientHeight });
    }
    for (const el of slide.querySelectorAll("h3,.l,.lead,.sub,td,li,.price")) {
      if (el.scrollWidth > el.clientWidth + 2)
        report.push({ slide: n, what: "a word is too wide", text: el.textContent.slice(0, 40) });
    }
  }
  return { report, fits };
};

const require = NodeModule.createRequire(NodePath.join(modules, "noop.js"));
const { chromium } = require("playwright-core");
NodeFS.mkdirSync(NodePath.join(out, "slides"), { recursive: true });
const browser = await chromium.launch({ executablePath: chrome });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const { report: overflow, fits } = await page.evaluate(FIT);
  // For checking the PowerPoint layout against the browser's (pptx previews in development).
  if (process.env.ZEN_DECK_FITS_FILE)
    NodeFS.writeFileSync(process.env.ZEN_DECK_FITS_FILE, JSON.stringify(fits));
  const slides = await page.$$(".slide");
  const pngs = [];
  for (const [i, el] of slides.entries()) {
    const file = NodePath.join(out, "slides", `slide-${pad2(i + 1)}.png`);
    await el.screenshot({ path: file });
    pngs.push(file);
  }
  const name =
    (deck.file ?? deck.title ?? "deck")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60) || "deck";
  const pdf = NodePath.join(out, `${name}.pdf`);
  await page.pdf({
    path: pdf,
    width: "1920px",
    height: "1080px",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  // Contact sheet: every slide small, to look at the whole deck at once.
  const sheet = NodePath.join(out, "contact-sheet.png");
  const thumbs = pngs
    .map((p) => `<img src="data:image/png;base64,${NodeFS.readFileSync(p).toString("base64")}">`)
    .join("");
  const perRow = 3;
  const rows = Math.ceil(pngs.length / perRow);
  const sheetPage = await browser.newPage({ viewport: { width: 1920, height: rows * 340 + 60 } });
  await sheetPage.setContent(
    `<body style="margin:0;background:#2b2b2b;padding:30px;display:grid;grid-template-columns:repeat(${perRow},1fr);gap:24px">${thumbs.replace(/<img /g, '<img style="width:100%;display:block" ')}</body>`,
  );
  await sheetPage.screenshot({ path: sheet, fullPage: true });
  const notes = deck.slides
    .map((s, i) => `## ${pad2(i + 1)}. ${s.title ?? s.quote ?? s.layout}\n\n${s.notes ?? ""}`)
    .join("\n\n");
  NodeFS.writeFileSync(NodePath.join(out, "speaker-notes.md"), `# ${deck.title}\n\n${notes}\n`);
  // The editable PowerPoint copy: same layout, colors and font names, notes in the notes pane.
  let pptx = null;
  const pptxModules = process.env.ZEN_PPTXGENJS_MODULES;
  if (pptxModules) {
    const images = {};
    const wanted = {
      logo,
      logoOnDark,
      clientLogo,
      ...Object.fromEntries(
        deck.slides.map((s, i) => [`slide${i}`, s._image]).filter(([, v]) => v),
      ),
    };
    for (const [key, url] of Object.entries(wanted)) {
      if (!url) continue;
      // PowerPoint gets PNG or JPEG: SVG and WEBP are drawn to a PNG in the browser first.
      images[key] = await page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const keep = /^data:image\/(png|jpeg);/.test(src);
        if (keep) return { data: src, width: img.naturalWidth, height: img.naturalHeight };
        const scale = Math.min(4, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((img.naturalWidth || 300) * scale));
        canvas.height = Math.max(1, Math.round((img.naturalHeight || 150) * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        return { data: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
      }, url);
    }
    pptx = await writePptx(deck, theme, {
      modules: pptxModules,
      file: NodePath.join(out, `${name}.pptx`),
      images,
      fits,
    });
    // The fonts travel with the file: PowerPoint shows the same look once they are installed.
    const fontsOut = NodePath.join(out, "fonts");
    NodeFS.mkdirSync(fontsOut, { recursive: true });
    for (const [family, file] of FONT_FILES) {
      if (![look.head, look.body, look.label, look.numbers, "Playfair Display"].includes(family))
        continue;
      const from = NodePath.join(fontsDir, file);
      if (NodeFS.existsSync(from)) NodeFS.copyFileSync(from, NodePath.join(fontsOut, file));
    }
    const licenses = NodePath.join(fontsDir, "licenses");
    if (NodeFS.existsSync(licenses))
      for (const file of NodeFS.readdirSync(licenses))
        NodeFS.copyFileSync(NodePath.join(licenses, file), NodePath.join(fontsOut, file));
  } else
    console.error(
      "WARNING: the PowerPoint tool is not prepared (ZEN_PPTXGENJS_MODULES), so no .pptx was made. Start the task from Zen Staff.",
    );
  const result = {
    pdf,
    pptx,
    slides: pngs,
    contactSheet: sheet,
    speakerNotes: NodePath.join(out, "speaker-notes.md"),
    colors: {
      textOnPrimary: onPrimary,
      accentAsText: accentText,
      accentContrastOnPaper: Math.round(contrast(colors.accent, paper) * 10) / 10,
    },
    overflow,
  };
  console.log(JSON.stringify(result, null, 1));
  if (overflow.length) {
    for (const o of overflow)
      console.error(
        `ERROR: slide ${o.slide}: ${o.what} does not fit${o.text ? ` ("${o.text}")` : ""}. Shorten the text in deck.json and build again.`,
      );
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
