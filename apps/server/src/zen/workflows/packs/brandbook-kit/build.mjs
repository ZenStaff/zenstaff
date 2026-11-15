// Builds the brandbook (A4 landscape PDF, our reference standard: photo section openers, full
// pages, the identity applied on real photo mockups) and the social media kit from brand.json,
// with the prepared browser and the shared premium kit.
// Usage: node build.mjs --brand brandbook/brand.json --out brandbook
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import {
  cmyk,
  contrast,
  hexToRgb,
  mix,
  palette as makePalette,
  readable,
  shade,
  tint,
} from "./kit/common/color.js";
import { contactIcon, ICONS, iconSvg } from "./kit/common/icons.js";
import { CATALOG, composeMockup, prepareMockupPage } from "./kit/print/mockup.mjs";
import { fontsCss, loadHtml, loadPlaywright, pixelPng } from "./kit/print/print.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const brandPath = option("brand");
const out = NodePath.resolve(option("out", "brandbook"));
if (!brandPath) fail("Use --brand <brand.json> --out <folder>.");
const fontsDir = process.env.ZEN_FONTS_DIR;
if (!fontsDir) fail("The fonts are not prepared (ZEN_FONTS_DIR). Start the task from Zen Staff.");
let b;
try {
  b = JSON.parse(NodeFS.readFileSync(brandPath, "utf8"));
} catch (error) {
  fail(`brand.json could not be read: ${error.message}`);
}
const base = NodePath.dirname(NodePath.resolve(brandPath));
const problems = [];
const HEX = /^#[0-9a-fA-F]{6}$/;
if (!b.name) problems.push('"name" is required.');
if (!["ro", "en"].includes(b.language ?? "ro")) problems.push('"language" must be "ro" or "en".');
if (!Array.isArray(b.colors) || b.colors.length < 2 || b.colors.length > 8)
  problems.push('"colors" needs 2 to 8 colors.');
for (const [i, c] of (b.colors ?? []).entries()) {
  if (!HEX.test(c.hex ?? "")) problems.push(`colors[${i}].hex must look like #1A2B3C.`);
  if (!c.name) problems.push(`colors[${i}].name is required.`);
}
const roles = Object.fromEntries(
  (b.colors ?? []).filter((c) => c.role).map((c) => [c.role, c.hex]),
);
if (!roles.primary) problems.push('One color needs "role": "primary".');
const posts = b.social?.posts ?? [];
if (posts.length < 1 || posts.length > 4) problems.push('"social.posts" needs 1 to 4 posts.');
const resolve = (file, what) => {
  if (!file) return null;
  const abs = NodePath.resolve(base, file);
  if (!NodeFS.existsSync(abs)) {
    problems.push(`${what} ${file} does not exist (paths are relative to brand.json).`);
    return null;
  }
  return abs;
};
const logoFile = resolve(b.logo, "The logo");
const logoLightFile = resolve(b.logoOnDark, "The logo for dark backgrounds");
const photos = (b.photos ?? []).map((p, i) => resolve(p, `photos[${i}]`)).filter(Boolean);
// Fonts: the open fonts of the toolchain (kit families) or the company's own files.
const FAMILIES = {
  Fraunces: "ZenFraunces",
  "Instrument Serif": "ZenInstrument",
  "Playfair Display": "ZenPlayfair",
  "Bricolage Grotesque": "ZenBricolage",
  Anton: "ZenAnton",
  Barlow: "ZenBarlow",
  "Barlow Condensed": "ZenBarlowCondensed",
  "Source Sans 3": "ZenSourceSans",
  Caveat: "ZenCaveat",
};
const fontSpec = (spec, what) => {
  if (typeof spec === "string") {
    if (!FAMILIES[spec])
      problems.push(
        `${what} must be one of ${Object.keys(FAMILIES).join(", ")}, or {"name": ..., "file": "font.ttf"}.`,
      );
    return { name: spec, family: FAMILIES[spec] ?? "ZenSourceSans" };
  }
  const file = resolve(spec?.file, `${what} file`);
  return { name: spec?.name ?? "Custom", family: `Own${what.replace(/\W/g, "")}`, file };
};
const heading = fontSpec(b.fonts?.heading ?? "Fraunces", "fonts.heading");
const body = fontSpec(b.fonts?.body ?? "Source Sans 3", "fonts.body");
// Optional third font for labels, captions and page numbers (often a mono).
const label = b.fonts?.label ? fontSpec(b.fonts.label, "fonts.label") : null;
const files = (list, what) =>
  (Array.isArray(list) ? list : []).map((item, i) => ({
    ...item,
    abs: item?.file ? resolve(item.file, `${what}[${i}].file`) : null,
  }));
const logoVariants = files(b.logoVariants, "logoVariants");
const logoRules = b.logoRules ?? null;
const clearFile = logoRules?.clearSpace?.file
  ? resolve(logoRules.clearSpace.file, "logoRules.clearSpace.file")
  : null;
const minimums = files(logoRules?.minimum, "logoRules.minimum");
const dontList = files(logoRules?.donts, "logoRules.donts");
const motifs = files(b.motifs, "motifs");
const appGroups = (Array.isArray(b.applications) ? b.applications : []).map((g, gi) => ({
  ...g,
  items: files(g.items, `applications[${gi}].items`),
}));
for (const nm of [...(b.icons?.names ?? []), ...(b.icons?.dont?.names ?? [])])
  if (!ICONS[nm])
    problems.push(`icons: "${nm}" is not in the icon set (${Object.keys(ICONS).join(", ")}).`);
if (b.mockups !== undefined && b.mockups !== false && !Array.isArray(b.mockups))
  problems.push('"mockups" is a list of mockup ids, or false for none.');
if (problems.length) fail(`brand.json has problems:\n  ${problems.join("\n  ")}`);

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const url = (file) => NodeURL.pathToFileURL(file).href;
const ownFonts = [heading, body, label]
  .filter((f) => f?.file)
  .map((f) => `@font-face{font-family:"${f.family}";src:url("${url(f.file)}");font-weight:100 900}`)
  .join("\n");
// Single quotes: these also go into style="..." attributes.
const HEAD = `'${heading.family}', Georgia, serif`;
const BODY = `'${body.family}', 'DejaVu Sans', sans-serif`;
const LABEL = label ? `'${label.family}', 'DejaVu Sans Mono', monospace` : BODY;
const HEADING_STYLE = {
  ZenAnton: "text-transform:uppercase;letter-spacing:0.01em;font-weight:400",
  ZenBarlowCondensed: "text-transform:uppercase;letter-spacing:0.01em;font-weight:800",
  ZenFraunces:
    "font-weight:560;font-variation-settings:'SOFT' 50,'opsz' 144;letter-spacing:-0.02em",
  ZenBricolage: "font-weight:700;letter-spacing:-0.03em",
  ZenInstrument: "font-weight:400;letter-spacing:-0.01em",
};
const headingStyle = HEADING_STYLE[heading.family] ?? "font-weight:700;letter-spacing:-0.015em";

const P = makePalette({
  primary: roles.primary,
  accent: roles.accent ?? roles.secondary ?? b.colors.find((c) => c.hex !== roles.primary)?.hex,
  dark: roles.dark,
  light: roles.light,
});
const primary = P.primary;
const accent = P.accent;
const paper = roles.light ?? P.paper;
const ink = roles.dark ?? P.ink;
const on = (bg) => readable(bg, [paper, ink, "#FFFFFF", "#111111"], 4.5);
const ro = (b.language ?? "ro") === "ro";
const T = ro
  ? {
      guide: "Manual de identitate",
      contents: "Cuprins",
      story: "Povestea brandului",
      audience: "Pentru cine",
      logo: "Logo",
      logoOnLight: "Pe fundal deschis",
      logoOnDark: "Pe fundal închis",
      logoOnColor: "Pe culoarea principală",
      logoOnPhoto: "Pe fotografie",
      logoLead:
        "Logoul e semnătura noastră. Îl folosim mereu întreg, cu aer în jur, în culorile de mai jos.",
      rules: "Spațiu, mărime, greșeli",
      clear:
        "Spațiul liber din jurul logoului este cel puțin un sfert din înălțimea lui. Nimic nu intră în această zonă: text, margini de pagină, alte logouri.",
      min: "Mărime minimă",
      minPrint: "pe hârtie",
      minScreen: "pe ecran",
      donts: "Așa nu",
      dont: [
        "nu-l deforma",
        "nu-i schimba culorile",
        "nu-l roti",
        "nu-l pune pe contrast slab",
        "nu-i adăuga umbre sau efecte",
        "nu-l pune pe fundal aglomerat",
      ],
      colorType: "Culoare și literă",
      colorLead:
        "Culorile și literele ne fac recognoscibili de departe. Le folosim la fel peste tot.",
      proportion: "Proporții recomandate",
      pairs: "Perechi de culori și contrast (WCAG)",
      ok: "bun pentru text",
      large: "doar titluri mari",
      no: "nu pentru text",
      type: "Tipografie",
      headingFont: "Titluri",
      bodyFont: "Text",
      scale: "Ierarhie",
      voiceImages: "Voce și imagine",
      tone: "Tonul vocii",
      weAre: "Suntem",
      weAreNot: "Nu suntem",
      wordsUse: "Cuvinte pe care le folosim",
      wordsAvoid: "Cuvinte pe care le evităm",
      examples: "Exemple",
      instead: "În loc de",
      say: "spunem",
      photo: "Fotografie",
      photoDo: [
        "Lumină naturală, caldă",
        "Produsul real, aproape, fără decor fals",
        "Oamenii noștri, la lucru",
        "Culori adevărate, fără filtre puternice",
      ],
      photoDont: [
        "Fotografii de stoc cu zâmbete regizate",
        "Text peste fețe sau peste produs",
        "Imagini strâmbe sau neclare",
      ],
      do: "Așa da",
      apps: "Aplicații",
      appsLead:
        "Identitatea aplicată pe obiecte reale: tipărituri, ambalaje, locație, afișe și online.",
      appsPrint: "Tipărituri și ambalaje",
      appsPlace: "În locație și pe stradă",
      appsDigital: "Afișe, uniforme și online",
      appsDigitalNoWear: "Afișe și online",
      social: "Kit pentru social media",
      file: "Fișier",
      size: "Mărime",
      use: "Unde",
      mockNote:
        "Machete pe fotografii reale (Pexels): previzualizări ale identității, nu fotografii ale locației.",
      thanks: "Mulțumim",
      alphabet: "AaĂăÂâBbCcDdEeFfGgHhIiÎîJjKkLlMmNnOoPpQqRrSsȘșTtȚțUuVvWwXxYyZz 0123456789",
      versions: "Versiuni",
      positioning: "Poziționare",
      against: "Împotriva",
      stand: "Pentru",
      clearTitle: "Spațiu liber",
      minTitle: "Mărime minimă",
      labelFont: "Etichete",
      scaleTitle: "Ierarhie și diacritice",
      diacritics: "Diacritice",
      diacriticsNote:
        "Ș și ț se scriu cu virgulă dedesubt (U+0218-021B), nu cu sedilă (ş ţ). Verifică fiecare font înainte de tipar.",
      wrong: "greșit",
      motifs: "Motive grafice",
      icons: "Iconițe",
      banned: "Cuvinte interzise",
      pairsTitle: "Nu așa. Nici așa. Așa da.",
      no1: "Nu așa",
      no2: "Nici așa",
      yes: "Așa da",
      L: {
        cards: "Cărți de vizită",
        cup: "Pahar de cafea",
        bag: "Pungă kraft",
        mug: "Cană",
        tee: "Tricou",
        apron: "Șorț",
        window: "Vitrină și firmă",
        sign: "Panou pe fațadă",
        wall: "Perete în local",
        badge: "Ecuson",
        banner: "Banner",
        frame: "Afiș înrămat",
        board: "Panou pe stradă",
        phone: "Story pe telefon",
      },
    }
  : {
      guide: "Brand guidelines",
      contents: "Contents",
      story: "Brand story",
      audience: "Who it is for",
      logo: "Logo",
      logoOnLight: "On light backgrounds",
      logoOnDark: "On dark backgrounds",
      logoOnColor: "On the primary color",
      logoOnPhoto: "On a photograph",
      logoLead:
        "The logo is our signature. Always whole, with space around it, in the colors below.",
      rules: "Space, size, mistakes",
      clear:
        "The clear space around the logo is at least a quarter of its height. Nothing enters it: text, page edges, other logos.",
      min: "Minimum size",
      minPrint: "in print",
      minScreen: "on screen",
      donts: "Don't",
      dont: [
        "don't stretch it",
        "don't recolor it",
        "don't rotate it",
        "don't use low contrast",
        "don't add shadows or effects",
        "don't place it on busy images",
      ],
      colorType: "Color and type",
      colorLead:
        "Colors and letters make us recognisable from afar. We use them the same way everywhere.",
      proportion: "Recommended proportions",
      pairs: "Color pairs and contrast (WCAG)",
      ok: "good for text",
      large: "large titles only",
      no: "not for text",
      type: "Typography",
      headingFont: "Headings",
      bodyFont: "Body text",
      scale: "Hierarchy",
      voiceImages: "Voice and imagery",
      tone: "Tone of voice",
      weAre: "We are",
      weAreNot: "We are not",
      wordsUse: "Words we use",
      wordsAvoid: "Words we avoid",
      examples: "Examples",
      instead: "Instead of",
      say: "we say",
      photo: "Photography",
      photoDo: [
        "Natural, warm light",
        "The real product, close, no fake props",
        "Our people at work",
        "True colors, no heavy filters",
      ],
      photoDont: [
        "Stock photos with staged smiles",
        "Text over faces or the product",
        "Crooked or blurry pictures",
      ],
      do: "Do",
      apps: "Applications",
      appsLead: "The identity on real objects: print, packaging, the venue, posters and online.",
      appsPrint: "Print and packaging",
      appsPlace: "On site and on the street",
      appsDigital: "Posters, uniforms and online",
      appsDigitalNoWear: "Posters and online",
      social: "Social media kit",
      file: "File",
      size: "Size",
      use: "Where",
      mockNote:
        "Mockups on real photographs (Pexels): previews of the identity, not photos of the venue.",
      thanks: "Thank you",
      alphabet: "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789",
      versions: "Versions",
      positioning: "Positioning",
      against: "Against",
      stand: "For",
      clearTitle: "Clear space",
      minTitle: "Minimum size",
      labelFont: "Labels",
      scaleTitle: "Hierarchy",
      diacritics: "Special characters",
      diacriticsNote: "Check every font for the characters of each language before print.",
      wrong: "wrong",
      motifs: "Graphic motifs",
      icons: "Icons",
      banned: "Banned words",
      pairsTitle: "Not this. Not this either. This.",
      no1: "Not this",
      no2: "Not this either",
      yes: "This",
      L: {
        cards: "Business cards",
        cup: "Coffee cup",
        bag: "Kraft bag",
        mug: "Mug",
        tee: "T-shirt",
        apron: "Apron",
        window: "Shop window and fascia",
        sign: "Facade sign",
        wall: "Wall inside",
        badge: "Staff badge",
        banner: "Banner",
        frame: "Framed poster",
        board: "Street board",
        phone: "Story on a phone",
      },
    };
const year = new Date().getFullYear();
const photoAt = (i) => (photos.length ? photos[i % photos.length] : null);
const logoFor = (bg) => (contrast(bg, "#000000") < 7 && logoLightFile ? logoLightFile : logoFile);
const logoImg = (bg, style = "") => {
  const file = logoFor(bg);
  return file
    ? `<img src="${url(file)}" style="object-fit:contain;${style}">`
    : `<span class="wordmark" style="color:${on(bg)};${style}">${esc(b.name)}</span>`;
};
const soft = (a) => {
  const [r, g, bl] = hexToRgb(accent);
  return `rgba(${r},${g},${bl},${a})`;
};
const line = mix(paper, ink, 0.14);
/** A ground named in brand.json: light, dark/primary, accent, ink or a #hex. */
const ground = (g) =>
  g === "dark" || g === "primary"
    ? primary
    : g === "accent"
      ? accent
      : g === "ink"
        ? ink
        : typeof g === "string" && HEX.test(g)
          ? g
          : paper;
/** Width / height of an SVG (viewBox) or PNG/JPEG file, for drawings that must fit a box. */
const aspectOf = (abs) => {
  try {
    const buf = NodeFS.readFileSync(abs);
    if (/\.svg$/i.test(abs)) {
      const m = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(
        buf.toString("utf8"),
      );
      return m ? Number(m[1]) / Number(m[2]) : 1;
    }
    if (buf.readUInt32BE(0) === 0x89504e47) return buf.readUInt32BE(16) / buf.readUInt32BE(20);
    for (let i = 2; i < buf.length - 9;) {
      const marker = buf.readUInt16BE(i);
      if (marker >= 0xffc0 && marker <= 0xffc3)
        return buf.readUInt16BE(i + 7) / buf.readUInt16BE(i + 5);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } catch {}
  return 1;
};
const art = (abs, style = "") =>
  `<img src="${url(abs)}" style="display:block;object-fit:contain;max-width:100%;max-height:100%;${style}">`;
const xMark = `<svg style="position:absolute;right:3mm;top:3mm" width="7mm" height="7mm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#B3261E"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const css = `${fontsCss()}
${ownFonts}
@page { size: 297mm 210mm; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact }
body { font-family: ${BODY}; color: ${ink}; background: ${paper} }
.page { width: 297mm; height: 210mm; position: relative; overflow: hidden; page-break-after: always; background: ${paper} }
h1, h2, h3, .head { font-family: ${HEAD}; ${headingStyle}; margin: 0; line-height: 1.02 }
h2 { font-size: 30pt } h3 { font-size: 14pt; line-height: 1.15 }
p { margin: 0; font-size: 10.5pt; line-height: 1.5 }
.kicker { font-family: ${LABEL}; font-weight: ${label ? 500 : 700}; font-size: ${label ? 7.5 : 8}pt; letter-spacing: ${label ? "0.16em" : "0.22em"}; text-transform: uppercase }
.label { font-family: ${LABEL}; font-size: 7pt; letter-spacing: 0.06em }
.small { font-size: 8pt; line-height: 1.4; opacity: 0.8 }
.foot { position: absolute; left: 16mm; right: 16mm; bottom: 8mm; display: flex; justify-content: space-between; font-family: ${LABEL}; font-size: 7pt; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.6 }
.full { position: absolute; top: 0; height: 100%; object-fit: cover }
.grid { position: absolute; left: 16mm; right: 16mm; top: 16mm; bottom: 18mm; display: grid; gap: 5mm }
.tile { position: relative; border-radius: 2.5mm; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 0 }
.tile .cap { position: absolute; left: 4mm; bottom: 3.5mm; font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700 }
.mock { width: 100%; height: 100%; object-fit: cover; display: block }
.mockcap { position: absolute; left: 0; right: 0; bottom: 0; padding: 6mm 4mm 3mm; font-size: 7.5pt; color: #fff; background: linear-gradient(0deg, rgba(0,0,0,0.55), rgba(0,0,0,0)); letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700 }
.wordmark { font-family: ${HEAD}; ${headingStyle}; font-size: 28pt }
.chip { display: inline-flex; align-items: center; gap: 2mm; padding: 1.4mm 3.4mm; border-radius: 99px; font-size: 9pt; font-weight: 700 }
table { border-collapse: collapse; width: 100% } td, th { text-align: left; padding: 1.6mm 2mm; font-size: 8.5pt; border-bottom: 0.25mm solid ${line} } th { font-size: 7pt; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.7 }
`;
const pages = [];
const sections = [];
const foot = (bg, n) =>
  `<div class="foot" style="color:${on(bg)}"><span>${esc(b.name)} · ${T.guide} ${year}</span><span>${String(n).padStart(2, "0")}</span></div>`;
/** Adds a page; returns its index. `fill` lets a page be written later (contents, mockups). */
const page = (inner, bg = paper, withFoot = true) => {
  const n = pages.length + 1;
  pages.push(
    inner === null
      ? null
      : `<section class="page" style="background:${bg};color:${on(bg)}">${inner}${withFoot ? foot(bg, n) : ""}</section>`,
  );
  return pages.length - 1;
};
const fill = (index, inner, bg = paper) => {
  pages[index] =
    `<section class="page" style="background:${bg};color:${on(bg)}">${inner}${foot(bg, index + 1)}</section>`;
};
/** Section opener: a full-bleed photo with the number and title on a brand panel (reference standard). */
const opener = (num, title, lead, photoIndex) => {
  sections.push([num, title, pages.length + 1]);
  const img = photoAt(photoIndex);
  page(
    `${img ? `<img class="full" src="${url(img)}" style="left:42%;width:58%">` : `<div class="full" style="left:42%;width:58%;background:radial-gradient(ellipse at 30% 20%, ${tint(primary, 0.2)}, ${shade(primary, 0.3)})"></div>`}
    <div style="position:absolute;left:0;top:0;bottom:0;width:42%;background:${primary};padding:18mm 14mm;display:flex;flex-direction:column;justify-content:space-between">
      <div class="kicker" style="color:${accent}">${esc(b.name)} · ${T.guide}</div>
      <div><div class="head" style="font-size:76pt;color:${accent};line-height:0.9">${num}</div><h2 style="font-size:40pt;color:${on(primary)};margin-top:6mm">${esc(title)}</h2>
      <p style="color:${on(primary)};opacity:0.85;margin-top:6mm;max-width:95%">${esc(lead)}</p></div>
      <div style="height:1mm;width:24mm;background:${accent}"></div>
    </div>`,
    primary,
    false,
  );
};

// Cover
{
  const img = photoAt(0);
  page(
    `${img ? `<img class="full" src="${url(img)}" style="left:38%;width:62%">` : ""}
    <div style="position:absolute;left:0;top:0;bottom:0;width:38%;background:${primary};padding:20mm 16mm;display:flex;flex-direction:column;justify-content:space-between;color:${on(primary)}">
      <div style="height:34mm;display:flex;align-items:flex-start">${logoImg(primary, "max-height:34mm;max-width:60mm")}</div>
      <div><div class="kicker" style="color:${accent}">${T.guide} · ${year}</div>
      <h1 style="font-size:46pt;margin-top:5mm;color:${on(primary)}">${esc(b.name)}</h1>
      ${b.tagline ? `<p style="font-size:14pt;margin-top:4mm;opacity:0.9">${esc(b.tagline)}</p>` : ""}</div>
      <div class="small" style="opacity:0.7">${esc(b.website ?? "")}</div>
    </div>`,
    primary,
    false,
  );
}
const contentsIndex = page(null);
// Story
{
  const img = photoAt(1);
  const values = b.values ?? [];
  page(`<div style="position:absolute;left:16mm;top:18mm;width:${img ? 150 : 250}mm">
      <div class="kicker" style="color:${primary}">${T.story}</div>
      <h2 style="font-size:40pt;margin-top:5mm;color:${primary}">${esc(b.tagline ?? b.name)}</h2>
      <p style="font-size:13.5pt;line-height:1.55;margin-top:7mm;max-width:145mm">${esc(b.description ?? "")}</p>
      ${b.audience ? `<div style="margin-top:7mm;padding-top:5mm;border-top:0.3mm solid ${line}"><div class="kicker" style="color:${primary}">${T.audience}</div><p style="margin-top:2mm">${esc(b.audience)}</p></div>` : ""}
    </div>
    ${img ? `<img src="${url(img)}" style="position:absolute;right:0;top:0;width:115mm;height:126mm;object-fit:cover">` : ""}
    <div style="position:absolute;left:16mm;right:16mm;bottom:18mm;display:grid;grid-template-columns:repeat(${Math.max(1, values.length)},1fr);gap:5mm">
      ${values
        .map((v, i) => {
          const bg = i === 0 ? primary : i === 1 ? accent : mix(paper, primary, 0.08);
          return `<div style="background:${bg};color:${on(bg)};border-radius:2.5mm;padding:6mm;min-height:46mm;display:flex;flex-direction:column;justify-content:space-between"><div class="head" style="font-size:22pt">0${i + 1}</div><h3>${esc(v)}</h3></div>`;
        })
        .join("")}
    </div>`);
}
// Positioning: what the brand stands against and for (optional).
if (b.positioning) {
  const pos = b.positioning;
  page(`<div style="position:absolute;left:16mm;top:18mm;width:116mm;bottom:20mm;display:flex;flex-direction:column;justify-content:space-between">
      <div><div class="kicker" style="color:${accent}">${T.positioning}</div>
      <h2 style="font-size:46pt;margin-top:5mm;color:${primary}">${esc(pos.title ?? "")}</h2>
      ${pos.lead ? `<p style="font-size:12.5pt;line-height:1.55;margin-top:7mm;max-width:112mm">${esc(pos.lead)}</p>` : ""}</div>
      ${pos.quote ? `<div class="head" style="font-size:24pt;line-height:1.15;color:${ink};border-left:1.4mm solid ${accent};padding-left:6mm">${esc(pos.quote)}</div>` : ""}
    </div>
    <div style="position:absolute;left:142mm;right:16mm;top:18mm;bottom:20mm;display:grid;grid-template-columns:1fr 1fr;gap:5mm">
      <div style="background:${mix(paper, ink, 0.05)};border-radius:2.5mm;padding:7mm 6mm;display:flex;flex-direction:column;gap:6mm">
        <div class="kicker" style="color:#B3261E;margin-bottom:2mm">${T.against}</div>
        ${(pos.against ?? []).map((w) => `<div class="head" style="font-size:14pt;line-height:1.25;text-decoration:line-through;text-decoration-color:${accent};text-decoration-thickness:0.6mm;opacity:0.72">${esc(w)}</div>`).join("")}
      </div>
      <div style="background:${primary};color:${on(primary)};border-radius:2.5mm;padding:7mm 6mm;display:flex;flex-direction:column;gap:6mm">
        <div class="kicker" style="color:${accent};margin-bottom:2mm">${T.stand}</div>
        ${(pos.for ?? []).map((w) => `<div style="display:flex;gap:2.6mm;align-items:flex-start"><span style="margin-top:1.2mm">${iconSvg("check", { size: 15, color: accent, stroke: 3 })}</span><div class="head" style="font-size:14pt;line-height:1.25">${esc(w)}</div></div>`).join("")}
      </div>
    </div>`);
}
// 01 Logo
opener("01", T.logo, T.logoLead, 2);
if (logoVariants.length) {
  // The versions the company gave (symbol, lockups, one-color, seal), each on its own ground.
  const n = logoVariants.length;
  const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
  page(`<div style="position:absolute;left:16mm;right:16mm;top:9mm"><div class="kicker" style="color:${primary}">01 · ${T.versions}</div></div>
    <div class="grid" style="top:16mm;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${Math.ceil(n / cols)},1fr)">
    ${logoVariants
      .map((v) => {
        const bg = v.ground === "photo" ? ink : ground(v.ground);
        const photo = v.ground === "photo" ? photoAt(3) : null;
        return `<div class="tile" style="background:${bg};${bg === paper ? `border:0.3mm solid ${line}` : ""}">${photo ? `<img src="${url(photo)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : ""}
          <div style="position:relative;width:78%;height:${v.height ?? "44%"};display:flex;align-items:center;justify-content:center">${v.abs ? art(v.abs, "height:100%;width:100%") : logoImg(bg, "height:100%")}</div>
          <div class="cap label" style="color:${photo ? "#fff" : on(bg)};text-transform:none;letter-spacing:0.04em;font-weight:500">${esc(v.caption ?? "")}</div></div>`;
      })
      .join("")}</div>`);
} else {
  const img = photoAt(3);
  const tiles = [
    [paper, T.logoOnLight, null],
    [primary, T.logoOnColor, null],
    [ink, T.logoOnDark, null],
    [null, T.logoOnPhoto, img],
  ];
  page(`<div class="grid" style="grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr">
    ${tiles
      .map(([bg, cap, im]) => {
        const back = bg ?? ink;
        return `<div class="tile" style="background:${back};${bg === paper ? `border:0.3mm solid ${line}` : ""}">${im ? `<img src="${url(im)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(0.6)">` : ""}<div style="position:relative;height:52%;display:flex;align-items:center">${logoImg(back, "height:100%;max-width:60mm")}</div><div class="cap" style="color:${im ? "#fff" : on(back)}">${cap}</div></div>`;
      })
      .join("")}</div>`);
}
if (logoRules) {
  const cs = logoRules.clearSpace ?? {};
  const ratio = Number(cs.ratio ?? 0.25);
  // The logo height in the clear-space drawing: 30 mm, less for wide logos so the zone fits.
  const aspect = aspectOf(clearFile ?? logoFile ?? "");
  const h = Math.min(30, 100 / (aspect + 2 * ratio), 70 / (1 + 2 * ratio));
  const X = h * ratio;
  const square = (pos) =>
    `<div style="position:absolute;${pos};width:${X}mm;height:${X}mm;background:${soft(0.22)};display:flex;align-items:center;justify-content:center;font-family:${LABEL};font-size:7pt;color:${accent}">X</div>`;
  const nd = dontList.length;
  page(`<div style="position:absolute;left:16mm;top:16mm;width:128mm;bottom:18mm;display:flex;flex-direction:column;gap:4.5mm">
      <div class="kicker" style="color:${primary}">${T.clearTitle}</div>
      <div style="flex:1;border-radius:2.5mm;background:${mix(paper, primary, 0.05)};display:flex;align-items:center;justify-content:center">
        <div style="position:relative;padding:${X}mm;outline:0.35mm dashed ${accent}">
          <div style="height:${h}mm;display:flex;outline:0.25mm solid ${mix(paper, ink, 0.25)}">${clearFile ? art(clearFile, `height:${h}mm;max-width:none`) : logoImg(paper, `height:${h}mm`)}</div>
          ${square("left:0;top:0")}${square("right:0;bottom:0")}
        </div>
      </div>
      <p style="font-size:9.5pt">${esc(cs.text ?? T.clear)}</p>
      ${
        minimums.length
          ? `<div style="padding-top:4mm;border-top:0.3mm solid ${line}"><div class="kicker" style="color:${primary};margin-bottom:3mm">${T.minTitle}</div>
        <div style="display:flex;gap:9mm;align-items:flex-end">${minimums
          .map(
            (m) =>
              `<div><div style="height:${m.heightMm ?? 8}mm;display:flex;align-items:flex-end">${m.abs ? art(m.abs, `height:${m.heightMm ?? 8}mm;max-width:none`) : logoImg(paper, `height:${m.heightMm ?? 8}mm`)}</div><div class="label" style="margin-top:2mm;opacity:0.8">${esc(m.label ?? "")}</div></div>`,
          )
          .join("")}</div></div>`
          : ""
      }
    </div>
    <div style="position:absolute;left:154mm;right:16mm;top:16mm;bottom:18mm;display:flex;flex-direction:column;gap:4mm">
      <div class="kicker" style="color:#B3261E">${T.donts}</div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(${Math.max(1, Math.ceil(nd / 2))},1fr);gap:4mm">
      ${dontList
        .map((d) => {
          const bg = d.ground === "photo" ? ink : ground(d.ground ?? mix(paper, ink, 0.05));
          const photo = d.ground === "photo" ? photoAt(4) : null;
          return `<div class="tile" style="background:${bg}">${photo ? `<img src="${url(photo)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : ""}<div style="position:relative;width:76%;height:${d.height ?? "40%"};display:flex;align-items:center;justify-content:center">${d.abs ? art(d.abs, `height:100%;width:100%;${d.style ?? ""}`) : logoImg(bg, `height:100%;${d.style ?? ""}`)}</div>
          ${xMark}<div class="cap" style="color:${photo ? "#fff" : on(bg)};text-transform:none;letter-spacing:0;font-weight:600">${esc(d.caption ?? "")}</div></div>`;
        })
        .join("")}</div></div>`);
} else {
  const dontStyles = [
    "transform:scaleX(1.6)",
    "filter:hue-rotate(150deg) saturate(1.6)",
    "transform:rotate(-18deg)",
    "opacity:0.25",
    "filter:drop-shadow(2mm 2mm 1.5mm rgba(0,0,0,0.6)) blur(0.4px)",
    "",
  ];
  const busy = photoAt(4);
  page(`<div style="position:absolute;left:16mm;top:16mm;width:120mm;bottom:18mm;display:flex;flex-direction:column;gap:5mm">
      <div class="kicker" style="color:${primary}">${T.rules}</div>
      <div style="flex:1;border-radius:2.5mm;background:${mix(paper, primary, 0.06)};display:flex;align-items:center;justify-content:center;position:relative">
        <div style="position:relative;padding:10mm;border:0.35mm dashed ${accent}">
          <div style="height:44mm;display:flex">${logoImg(mix(paper, primary, 0.06), "height:44mm;max-width:80mm")}</div>
          <div style="position:absolute;left:0;top:0;width:10mm;height:10mm;background:${soft(0.28)}"></div>
          <div style="position:absolute;right:0;bottom:0;width:10mm;height:10mm;background:${soft(0.28)}"></div>
        </div>
      </div>
      <p>${T.clear}</p>
      <div style="display:flex;gap:12mm;align-items:flex-end">
        <div><div style="height:12mm;display:flex;align-items:flex-end">${logoImg(paper, "height:12mm")}</div><p class="small" style="margin-top:2mm">${T.min}: 25 mm ${T.minPrint}</p></div>
        <div><div style="height:8mm;display:flex;align-items:flex-end">${logoImg(paper, "height:8mm")}</div><p class="small" style="margin-top:2mm">120 px ${T.minScreen}</p></div>
      </div>
    </div>
    <div style="position:absolute;left:146mm;right:16mm;top:16mm;bottom:18mm;display:flex;flex-direction:column;gap:4mm">
      <div class="kicker" style="color:#B3261E">${T.donts}</div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,1fr);gap:4mm">
      ${dontStyles
        .map((style, i) => {
          const usePhoto = i === 5 && busy;
          const bg = i === 3 ? mix(primary, paper, 0.25) : mix(paper, ink, 0.05);
          return `<div class="tile" style="background:${bg}">${usePhoto ? `<img src="${url(busy)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : ""}<div style="position:relative;height:46%;display:flex;align-items:center">${logoImg(bg, `height:100%;max-width:40mm;${style}`)}</div>
          <svg style="position:absolute;right:3mm;top:3mm" width="7mm" height="7mm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#B3261E"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>
          <div class="cap" style="color:${usePhoto ? "#fff" : on(bg)};text-transform:none;letter-spacing:0;font-weight:600;${usePhoto ? "text-shadow:0 1px 3px rgba(0,0,0,0.6)" : ""}">${T.dont[i]}</div></div>`;
        })
        .join("")}</div></div>`);
}
// 02 Color and type
opener("02", T.colorType, T.colorLead, 5);
{
  const cols = b.colors;
  page(
    `<div style="position:absolute;inset:0;display:grid;grid-template-columns:${cols.map((c) => (c.share ? `${Math.max(0.7, Math.sqrt(c.share / 10)).toFixed(2)}fr` : c.role === "primary" ? "1.6fr" : c.role === "accent" ? "1.2fr" : "1fr")).join(" ")}">
    ${cols
      .map((c) => {
        const [r, g, bl] = hexToRgb(c.hex);
        const [C, M, Y, K] = cmyk(c.hex);
        const fg = on(c.hex);
        return `<div style="background:${c.hex};color:${fg};padding:16mm 8mm 20mm;display:flex;flex-direction:column;justify-content:space-between;${c.hex.toUpperCase() === paper.toUpperCase() ? `border-right:0.3mm solid ${line}` : ""}">
          <div class="kicker" style="color:${fg};opacity:0.75">${esc(c.role ?? "")}</div>
          <div><h3 style="font-size:18pt">${esc(c.name)}</h3>
          <table style="margin-top:4mm;color:${fg}">${[
            ["HEX", c.hex.toUpperCase()],
            ["RGB", `${r} ${g} ${bl}`],
            ["CMYK", `C${C} M${M} Y${Y} K${K}`],
          ]
            .map(
              ([k, v]) =>
                `<tr><td style="border-color:${fg}33;padding-left:0">${k}</td><td style="border-color:${fg}33">${v}</td></tr>`,
            )
            .join("")}</table>
          ${c.usage ? `<p class="small" style="margin-top:4mm;opacity:0.9">${esc(c.usage)}</p>` : ""}</div></div>`;
      })
      .join(
        "",
      )}</div><div class="foot" style="color:${on(cols.at(-1).hex)};left:auto"><span>${String(pages.length + 1).padStart(2, "0")}</span></div>`,
    paper,
    false,
  );
}
{
  const pairs = [];
  for (const bg of b.colors)
    for (const fg of b.colors)
      if (bg.hex !== fg.hex) pairs.push([bg, fg, contrast(bg.hex, fg.hex)]);
  pairs.sort((x, y) => y[2] - x[2]);
  const shown = pairs.slice(0, 8);
  // `share` (percent of a layout) wins over the defaults per role.
  const weights = b.colors.map((c) =>
    Number(c.share) > 0
      ? Number(c.share)
      : c.role === "primary"
        ? 55
        : c.role === "light"
          ? 25
          : c.role === "accent"
            ? 12
            : 8,
  );
  const sum = weights.reduce((a, c) => a + c, 0);
  page(`<div style="position:absolute;left:16mm;right:16mm;top:14mm"><div class="kicker" style="color:${primary}">${T.pairs}</div></div>
    <div class="grid" style="top:22mm;bottom:50mm;grid-template-columns:repeat(4,1fr);grid-template-rows:1fr 1fr">
    ${shown
      .map(
        ([bg, fg, r]) =>
          `<div class="tile" style="background:${bg.hex};color:${fg.hex};flex-direction:column;align-items:flex-start;justify-content:space-between;padding:5mm;${bg.hex.toUpperCase() === paper.toUpperCase() ? `border:0.3mm solid ${line}` : ""}"><div class="head" style="font-size:34pt">Aa</div><div style="font-size:8pt;font-weight:700">${esc(fg.name)} / ${esc(bg.name)}<br>${r.toFixed(1)}:1 · ${r >= 4.5 ? T.ok : r >= 3 ? T.large : T.no}</div></div>`,
      )
      .join("")}</div>
    <div style="position:absolute;left:16mm;right:16mm;bottom:18mm"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8mm;margin-bottom:3mm"><div class="kicker" style="color:${primary};white-space:nowrap">${T.proportion}</div>${b.colorRule ? `<p style="font-size:9.5pt;text-align:right"><b>${esc(b.colorRule)}</b></p>` : ""}</div>
      <div style="display:flex;height:18mm;border-radius:2mm;overflow:hidden;border:0.3mm solid ${line}">${b.colors.map((c, i) => `<div style="flex:${weights[i]};background:${c.hex};color:${on(c.hex)};display:flex;align-items:center;padding-left:3mm;font-size:8pt;font-weight:700">${Math.round((weights[i] / sum) * 100)}%</div>`).join("")}</div></div>`);
}
{
  const img = photoAt(6);
  page(`<div style="position:absolute;left:16mm;top:16mm;width:150mm;bottom:18mm;display:flex;flex-direction:column;justify-content:space-between">
      <div><div class="kicker" style="color:${primary}">${T.type} · ${T.headingFont}</div>
      <div style="display:flex;align-items:flex-end;gap:8mm"><div class="head" style="font-size:130pt;color:${primary};line-height:0.95;margin-top:2mm">Aa</div>
      <div class="head" style="font-size:26pt;color:${ink};padding-bottom:4mm;max-width:80mm">${esc(b.tagline ?? b.name)}</div></div>
      <h3 style="font-size:20pt;margin-top:2mm">${esc(heading.name)}</h3>
      <p style="font-family:${HEAD};font-size:13pt;margin-top:2mm;word-break:break-all;line-height:1.3">${T.alphabet}</p></div>
      <div style="padding-top:5mm;border-top:0.3mm solid ${line}"><div class="kicker" style="color:${primary}">${T.bodyFont}</div>
      <h3 style="font-family:${BODY};font-weight:600;font-size:16pt;margin-top:2mm;letter-spacing:0;text-transform:none">${esc(body.name)}</h3>
      <p style="margin-top:2mm;word-break:break-all">${T.alphabet}</p></div>
    </div>
    <div style="position:absolute;left:180mm;right:16mm;top:16mm;bottom:18mm;display:flex;flex-direction:column;gap:3.5mm;justify-content:space-between">
      <div class="kicker" style="color:${primary}">${T.scale}</div>
      ${[
        ["H1", 30, b.tagline ?? b.name],
        ["H2", 20, posts[0]?.headline ?? b.name],
        ["H3", 14, (b.values ?? [])[0] ?? b.name],
      ]
        .map(
          ([n, s, t]) =>
            `<div><span class="small">${n} · ${s} pt</span><div class="head" style="font-size:${s}pt;color:${n === "H1" ? primary : ink};margin-top:1mm">${esc(t)}</div></div>`,
        )
        .join("")}
      <div><span class="small">Text · 10.5 pt / 1.5</span><p style="margin-top:1mm">${esc((b.description ?? "").split(/(?<=[.!?])\s/)[0])}</p></div>
      ${img ? `<img src="${url(img)}" style="width:100%;height:34mm;object-fit:cover;border-radius:2mm">` : ""}
    </div>`);
}
if (b.typography?.scale?.length) {
  const fam = (f) => (f === "label" ? LABEL : f === "body" ? BODY : HEAD);
  const famName = (f) =>
    (f === "label" ? label?.name : f === "body" ? body.name : heading.name) ?? "";
  const rows = b.typography.scale.slice(0, 7);
  const chars = b.typography.diacritics ?? (ro ? "Ăă Ââ Îî Șș Țț" : "");
  page(`<div style="position:absolute;left:16mm;top:14mm;width:178mm;bottom:18mm;display:flex;flex-direction:column">
      <div class="kicker" style="color:${primary};margin-bottom:3mm">${T.scaleTitle}</div>
      ${rows
        .map(
          (r, i) =>
            `<div style="display:grid;grid-template-columns:40mm 1fr;gap:5mm;align-items:baseline;padding:${i === 0 ? 1 : rows.length <= 5 ? 6 : 3}mm 0 ${rows.length <= 5 ? 5 : 2.6}mm;border-bottom:0.25mm solid ${line}">
          <div class="label" style="opacity:0.75;line-height:1.5">${esc(r.name)}<br>${esc(famName(r.font))} · ${r.size} pt / ${r.leading ?? "1.2"}</div>
          <div style="font-family:${fam(r.font)};${r.font === "heading" || !r.font ? headingStyle : ""};font-size:${r.size}pt;line-height:${r.leading ?? 1.15};color:${r.color === "accent" ? accent : i === 0 ? primary : ink};${r.font === "label" ? "letter-spacing:0.12em;text-transform:uppercase" : ""}">${esc(r.sample)}</div></div>`,
        )
        .join("")}
    </div>
    ${
      chars
        ? `<div style="position:absolute;left:204mm;right:16mm;top:14mm;bottom:18mm;background:${primary};color:${on(primary)};border-radius:2.5mm;padding:7mm 6mm;display:flex;flex-direction:column;gap:3.5mm">
      <div class="kicker" style="color:${accent}">${T.diacritics}</div>
      <div class="head" style="font-size:30pt;line-height:1.1">${esc(chars)}</div>
      <div style="font-family:${BODY};font-size:15pt">${esc(chars)}</div>
      ${label ? `<div style="font-family:${LABEL};font-size:12pt">${esc(chars)}</div>` : ""}
      ${ro ? `<div style="display:flex;align-items:center;gap:3mm;margin-top:2mm;padding-top:3.5mm;border-top:0.3mm solid ${on(primary)}33"><span class="head" style="font-size:22pt;text-decoration:line-through;text-decoration-color:${accent};text-decoration-thickness:0.7mm">ş ţ</span><span class="label" style="color:${accent}">${T.wrong}</span></div>` : ""}
      <p style="font-size:8.5pt;line-height:1.45;opacity:0.85;margin-top:auto">${esc(b.typography.note ?? T.diacriticsNote)}</p></div>`
        : ""
    }`);
}
// 03 Voice and imagery
opener("03", T.voiceImages, b.tone?.summary ?? "", 7);
{
  const tone = b.tone ?? {};
  page(`<div style="position:absolute;left:16mm;top:14mm;right:16mm"><div class="kicker" style="color:${primary}">${T.tone}</div>
      <h2 style="font-size:22pt;margin-top:3mm;color:${primary};max-width:230mm">${esc(tone.summary ?? "")}</h2></div>
    <div class="grid" style="top:40mm;grid-template-columns:1fr 1fr 1.4fr">
      <div style="background:${primary};color:${on(primary)};border-radius:2.5mm;padding:6mm;display:flex;flex-direction:column;gap:3mm"><div class="kicker" style="color:${accent}">${T.weAre}</div>${(tone.weAre ?? []).map((w) => `<div class="head" style="font-size:22pt">${esc(w)}</div>`).join("")}
        <div class="kicker" style="color:${accent};margin-top:auto">${T.wordsUse}</div><div style="display:flex;flex-wrap:wrap;gap:2mm">${(tone.wordsWeUse ?? []).map((w) => `<span class="chip" style="background:${accent};color:${on(accent)}">${esc(w)}</span>`).join("")}</div></div>
      <div style="background:${mix(paper, ink, 0.06)};border-radius:2.5mm;padding:6mm;display:flex;flex-direction:column;gap:3mm"><div class="kicker" style="color:#B3261E">${T.weAreNot}</div>${(tone.weAreNot ?? []).map((w) => `<div class="head" style="font-size:22pt;text-decoration:line-through;text-decoration-thickness:0.5mm;opacity:0.75">${esc(w)}</div>`).join("")}
        <div class="kicker" style="color:#B3261E;margin-top:auto">${T.wordsAvoid}</div><div style="display:flex;flex-wrap:wrap;gap:2mm">${(tone.wordsWeAvoid ?? []).map((w) => `<span class="chip" style="border:0.3mm solid ${mix(paper, ink, 0.3)}">${esc(w)}</span>`).join("")}</div></div>
      <div style="display:flex;flex-direction:column;gap:4mm"><div class="kicker" style="color:${primary}">${T.examples}</div>
        ${(tone.examples ?? [])
          .slice(0, 3)
          .map(
            (e) =>
              `<div style="border-radius:2.5mm;overflow:hidden;border:0.3mm solid ${line};flex:1;display:flex;flex-direction:column"><div style="padding:4mm 5mm;background:${mix(paper, ink, 0.05)}"><span class="small">${T.instead}</span><p style="text-decoration:line-through;opacity:0.7">${esc(e.instead)}</p></div><div style="padding:4mm 5mm;flex:1;border-left:1.2mm solid ${accent}"><span class="small">${T.say}</span><p style="font-weight:700;font-size:12pt">${esc(e.say)}</p></div></div>`,
          )
          .join("")}
      </div></div>`);
}
// "Not this. Not this either. This." pairs and the banned words (optional).
if (b.tone?.pairs?.length || b.tone?.banned?.length) {
  const pairs = (b.tone.pairs ?? []).slice(0, 3);
  const banned = b.tone.banned ?? [];
  const cellNo = (label, text) =>
    `<div style="background:${mix(paper, ink, 0.05)};border-radius:2mm;padding:3.6mm 4mm;display:flex;flex-direction:column;gap:1.6mm"><div class="label" style="color:#B3261E;display:flex;gap:1.4mm;align-items:center;text-transform:uppercase;letter-spacing:0.12em">${iconSvg("x", { size: 10, color: "#B3261E", stroke: 3 })}${label}</div><p style="font-size:${pairs.length <= 3 ? 11 : 9}pt;line-height:1.4;opacity:0.8">${esc(text)}</p></div>`;
  page(`<div style="position:absolute;left:16mm;right:16mm;top:14mm;display:flex;justify-content:space-between;align-items:flex-end;gap:10mm">
      <div><div class="kicker" style="color:${primary}">${T.tone}</div><h2 style="font-size:26pt;margin-top:2.5mm;color:${primary}">${T.pairsTitle}</h2></div>
    </div>
    ${
      banned.length
        ? `<div style="position:absolute;left:16mm;right:16mm;top:40mm;display:flex;flex-wrap:wrap;gap:2mm 5mm;align-items:baseline;padding:3.4mm 0;border-top:0.3mm solid ${line};border-bottom:0.3mm solid ${line}"><span class="kicker" style="color:#B3261E;margin-right:2mm">${T.banned}</span>${banned.map((w) => `<span class="head" style="font-size:12.5pt;text-decoration:line-through;text-decoration-color:${accent};text-decoration-thickness:0.5mm;opacity:0.75">${esc(w)}</span>`).join("")}</div>`
        : ""
    }
    <div style="position:absolute;left:16mm;right:16mm;top:${banned.length ? 63 : 40}mm;bottom:18mm;display:grid;grid-template-rows:repeat(${Math.max(1, pairs.length)},1fr);gap:4mm">
      ${pairs
        .map(
          (pr) =>
            `<div style="display:grid;grid-template-columns:44mm 1fr 1fr 1.25fr;gap:3.5mm">
          <div style="padding-top:2mm"><div class="head" style="font-size:15pt;line-height:1.2;color:${primary}">${esc(pr.topic ?? "")}</div></div>
          ${cellNo(T.no1, pr.no ?? "")}${pr.also ? cellNo(T.no2, pr.also) : "<div></div>"}
          <div style="border-radius:2mm;padding:3.6mm 4mm;border:0.3mm solid ${line};border-left:1.2mm solid ${accent};background:#FFFFFF;display:flex;flex-direction:column;gap:1.6mm"><div class="label" style="color:${primary};display:flex;gap:1.4mm;align-items:center;text-transform:uppercase;letter-spacing:0.12em">${iconSvg("check", { size: 11, color: accent, stroke: 3 })}${T.yes}</div><p class="head" style="font-size:${pairs.length <= 3 ? 15 : 11}pt;line-height:1.25;color:${ink}">${esc(pr.yes ?? "")}</p></div>
        </div>`,
        )
        .join("")}
    </div>`);
}
// Graphic motifs (optional): the brand's recurring devices, each drawn and explained.
if (motifs.length) {
  const n = Math.min(4, motifs.length);
  const two = n === 4;
  page(`<div style="position:absolute;left:16mm;right:16mm;top:14mm"><div class="kicker" style="color:${primary}">${T.motifs}</div>
      ${b.motifsLead ? `<h2 style="font-size:22pt;margin-top:2.5mm;color:${primary};max-width:230mm">${esc(b.motifsLead)}</h2>` : ""}</div>
    <div class="grid" style="top:${b.motifsLead ? 40 : 24}mm;grid-template-columns:repeat(${two ? 2 : n},1fr);${two ? "grid-template-rows:1fr 1fr;row-gap:6mm" : ""}">
    ${motifs
      .slice(0, 4)
      .map((m) => {
        const bg = ground(m.ground);
        const pic = `<div class="tile" style="${two ? "width:64%;height:100%" : "flex:1"};background:${bg};${bg === paper ? `border:0.3mm solid ${line}` : ""}">${m.abs ? art(m.abs, "width:100%;height:100%") : ""}</div>`;
        const text = `<div style="${two ? "flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2.5mm;padding-bottom:1mm" : ""}"><h3 style="color:${primary}">${esc(m.title ?? "")}</h3><p style="font-size:9pt;line-height:1.45;margin-top:${two ? 0 : 2}mm">${esc(m.text ?? "")}</p></div>`;
        return `<div style="display:flex;flex-direction:${two ? "row" : "column"};gap:${two ? 5 : 3.5}mm;min-height:0">${pic}${text}</div>`;
      })
      .join("")}</div>`);
}
// Icons (optional): a Lucide-style set drawn with the brand stroke, plus the rules and don'ts.
if (b.icons?.names?.length) {
  const ic = b.icons;
  const stroke = Number(ic.stroke ?? 2);
  const names = ic.names.slice(0, 18);
  page(`<div style="position:absolute;left:16mm;top:14mm;width:168mm"><div class="kicker" style="color:${primary}">${T.icons}</div>
      ${ic.lead ? `<h2 style="font-size:15pt;line-height:1.2;margin-top:2.5mm;color:${primary}">${esc(ic.lead)}</h2>` : ""}</div>
    <div style="position:absolute;left:16mm;width:168mm;top:${ic.lead ? 42 : 24}mm;bottom:18mm;display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:1fr;gap:3mm">
      ${names
        .map(
          (nm) =>
            `<div style="border:0.3mm solid ${line};border-radius:2mm;background:#FFFFFF;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.4mm">${iconSvg(nm, { size: 34, color: nm === ic.accent ? accent : ink, stroke })}<span class="label" style="opacity:0.7">${esc(nm)}</span></div>`,
        )
        .join("")}
    </div>
    <div style="position:absolute;left:194mm;right:16mm;top:14mm;bottom:18mm;display:flex;flex-direction:column;gap:4mm">
      <div style="background:${primary};color:${on(primary)};border-radius:2.5mm;padding:6mm;display:flex;flex-direction:column;gap:2.6mm">
        <div class="kicker" style="color:${accent}">${T.do}</div>
        ${(ic.rules ?? []).map((t) => `<p style="font-size:9.5pt;display:flex;gap:2mm;align-items:flex-start"><span style="margin-top:0.6mm">${iconSvg("check", { size: 13, color: accent, stroke: 3 })}</span><span>${esc(t)}</span></p>`).join("")}
      </div>
      ${
        ic.dont?.names?.length
          ? `<div style="background:${mix(paper, ink, 0.05)};border-radius:2.5mm;padding:5mm 6mm;margin-top:auto"><div class="kicker" style="color:#B3261E">${T.donts}</div>
        <div style="display:flex;gap:4mm;margin-top:3mm">${ic.dont.names.map((nm) => `<div style="position:relative;width:15mm;height:15mm;display:flex;align-items:center;justify-content:center;opacity:0.75">${iconSvg(nm, { size: 30, color: ink, stroke })}<svg style="position:absolute;inset:0" viewBox="0 0 10 10"><path d="M1 9L9 1" stroke="#B3261E" stroke-width="0.6"/></svg></div>`).join("")}</div>
        <p class="small" style="margin-top:3mm">${esc(ic.dont.caption ?? "")}</p></div>`
          : ""
      }
    </div>`);
}
{
  const grid = [1, 2, 3].map((i) => photoAt(i)).filter(Boolean);
  page(`<div class="grid" style="grid-template-columns:1.3fr 1fr 1fr;grid-template-rows:1.2fr 1fr">
      ${grid.length ? `<div style="grid-row:span 2;border-radius:2.5mm;overflow:hidden"><img class="mock" src="${url(grid[0])}"></div>` : `<div style="grid-row:span 2;border-radius:2.5mm;background:${primary}"></div>`}
      ${[grid[1], grid[2]].map((g) => (g ? `<div style="border-radius:2.5mm;overflow:hidden"><img class="mock" src="${url(g)}"></div>` : `<div style="border-radius:2.5mm;background:${mix(paper, primary, 0.08)}"></div>`)).join("")}
      <div style="grid-column:span 2;display:grid;grid-template-columns:1fr 1fr;gap:5mm">
        <div style="background:${primary};color:${on(primary)};border-radius:2.5mm;padding:5mm 6mm"><div class="kicker" style="color:${accent}">${esc(b.imagery?.title ?? T.photo)} · ${T.do}</div>${(b.imagery?.do ?? T.photoDo).map((t) => `<p style="margin-top:2mm;display:flex;gap:2mm;align-items:center">${iconSvg("check", { size: 14, color: accent, stroke: 3 })}${esc(t)}</p>`).join("")}</div>
        <div style="background:${mix(paper, ink, 0.06)};border-radius:2.5mm;padding:5mm 6mm"><div class="kicker" style="color:#B3261E">${esc(b.imagery?.title ?? T.photo)} · ${T.donts}</div>${(b.imagery?.dont ?? T.photoDont).map((t) => `<p style="margin-top:2mm">${esc(t)}</p>`).join("")}</div>
      </div></div>`);
}
// 04 Applications
opener("04", T.apps, b.appsLead ?? T.appsLead, 8);
// The company's own applications (screens, templates, print files), one page per group.
for (const group of appGroups) {
  const items = group.items.filter((it) => it.abs).slice(0, 4);
  if (!items.length) continue;
  const n = items.length;
  const columns =
    group.columns ?? (n === 1 ? "1fr" : n === 2 ? "1.45fr 1fr" : n === 3 ? "1.5fr 1fr" : "1fr 1fr");
  const rows = group.rows ?? (n <= 2 ? "1fr" : "1fr 1fr");
  page(`<div style="position:absolute;left:16mm;right:16mm;top:9mm;display:flex;justify-content:space-between;align-items:baseline"><div class="kicker" style="color:${primary}">04 · ${esc(group.title ?? "")}</div>${group.note ? `<div class="small">${esc(group.note)}</div>` : ""}</div>
    <div class="grid" style="top:16mm;grid-template-columns:${columns};grid-template-rows:${rows}">
    ${items
      .map((it, i) => {
        const bg = ground(it.ground ?? mix(paper, ink, 0.05));
        const span = n === 3 && i === 0 && !group.rows ? "grid-row:span 2;" : "";
        const fit = it.fit === "cover";
        return `<div class="tile" style="${span}background:${bg};${it.style ?? ""}">${fit ? `<img class="mock" src="${url(it.abs)}" style="object-position:${it.position ?? "50% 50%"}">` : `<div style="position:absolute;inset:${it.inset ?? "6%"};display:flex;align-items:center;justify-content:center">${art(it.abs, "width:100%;height:100%")}</div>`}
          ${it.caption ? `<div class="mockcap" style="${fit ? "" : `background:none;color:${on(bg)};opacity:0.8`}">${esc(it.caption)}</div>` : ""}</div>`;
      })
      .join("")}</div>`);
}
// Photo mockups: all of them by default, a chosen list with "mockups": [...], none with false.
const wanted = b.mockups === false ? [] : Array.isArray(b.mockups) ? b.mockups : null;
const want = (id) => wanted === null || wanted.includes(id);
const GROUPS = {
  print: ["business-cards", "kraft-bag", "coffee-cup", "mug"],
  place: ["shop-window", "cafe-wall", "wall-sign"],
  digital: ["poster-frame", "poster-street-board", "phone-story", "apron", "tshirt"],
};
const appIndex = [
  GROUPS.print.some(want) ? page(null) : null,
  GROUPS.place.some(want) ? page(null) : null,
  GROUPS.digital.some(want) ? page(null) : null,
  page(null),
];
// Back cover
page(
  `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9mm">
  <div style="height:40mm;display:flex">${logoImg(primary, "height:40mm;max-width:90mm")}</div>
  <div class="head" style="font-size:24pt;color:${on(primary)}">${T.thanks}</div>
  <div style="display:flex;gap:8mm;font-size:10pt;color:${on(primary)}">${[
    b.website,
    b.social?.handle,
    b.contact?.email,
    b.contact?.phone,
  ]
    .filter(Boolean)
    .map(
      (l) =>
        `<span style="display:flex;gap:2mm;align-items:center">${iconSvg(contactIcon(l), { size: 14, color: accent })}${esc(l)}</span>`,
    )
    .join("")}</div>
</div>`,
  primary,
  false,
);

const SOCIAL = [
  ...posts.map((p, i) => ({
    id: `post-${i + 1}`,
    w: 1080,
    h: 1350,
    use: "Instagram / Facebook feed",
    kind: "post",
    p,
    variant: i % 3,
  })),
  {
    id: "story",
    w: 1080,
    h: 1920,
    use: "Instagram / Facebook Stories",
    kind: "story",
    p: b.social?.story ?? posts[0],
  },
  {
    id: "profile",
    w: 1080,
    h: 1080,
    use: ro ? "Poză de profil (toate rețelele)" : "Profile picture (all networks)",
    kind: "profile",
  },
  {
    id: "facebook-cover",
    w: 1640,
    h: 624,
    use: ro ? "Copertă Facebook" : "Facebook cover",
    kind: "cover",
  },
  {
    id: "linkedin-banner",
    w: 1584,
    h: 396,
    use: ro ? "Banner LinkedIn" : "LinkedIn banner",
    kind: "banner",
  },
];
const htmlPage = (w, h, inner, bg) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}html,body{width:${w}px;height:${h}px;overflow:hidden;background:${bg}}</style></head><body style="position:relative">${inner}</body></html>`;
const socialHtml = (s) => {
  const p = s.p ?? {};
  const W = s.w;
  const H = s.h;
  const photo =
    s.kind === "story"
      ? photoAt(0)
      : s.kind === "post" && s.variant !== 2
        ? photoAt(s.variant + 1)
        : s.kind === "cover" || s.kind === "banner"
          ? photoAt(2)
          : null;
  const bg = s.kind === "post" && s.variant === 2 ? accent : primary;
  const fg = on(bg);
  const pad = Math.round(W * 0.075);
  const button = bg === accent ? primary : accent;
  let inner;
  if (s.kind === "profile") {
    inner = `<div style="position:absolute;inset:0;background:${primary};display:flex;align-items:center;justify-content:center">${logoImg(primary, "width:64%;height:64%")}</div>`;
  } else if (s.kind === "cover" || s.kind === "banner") {
    inner = `${photo ? `<img src="${url(photo)}" style="position:absolute;right:0;top:0;width:55%;height:100%;object-fit:cover">` : ""}
      <div style="position:absolute;inset:0;background:linear-gradient(90deg, ${primary} 45%, ${primary}00 70%)"></div>
      <div style="position:absolute;left:${pad}px;top:0;bottom:0;display:flex;align-items:center;gap:${Math.round(H * 0.08)}px">
        <div style="height:${Math.round(H * 0.42)}px;display:flex">${logoImg(primary, "height:100%")}</div>
        <div><div class="head" style="font-size:${Math.round(H * (s.kind === "banner" ? 0.16 : 0.1))}px;color:${on(primary)};max-width:${Math.round(W * 0.4)}px">${esc(b.tagline ?? b.name)}</div>
        <div style="font-size:${Math.round(H * (s.kind === "banner" ? 0.08 : 0.05))}px;color:${accent};font-weight:700;margin-top:${Math.round(H * 0.03)}px">${esc(b.website ?? b.social?.handle ?? "")}</div></div></div>`;
  } else {
    const photoTop = photo ? (s.kind === "story" ? 0.5 : 0.52) : 0;
    const headSize = Math.round(
      W * (String(p.headline ?? "").length > 28 ? 0.085 : 0.1) * (photo ? 1 : 1.3),
    );
    inner = `${photo ? `<img src="${url(photo)}" style="position:absolute;left:0;top:0;width:100%;height:${photoTop * 100}%;object-fit:cover"><div style="position:absolute;left:0;right:0;top:${photoTop * 100 - 14}%;height:14%;background:linear-gradient(180deg, ${bg}00, ${bg})"></div>` : `<div style="position:absolute;inset:0;background:radial-gradient(ellipse 90% 60% at 20% 10%, ${tint(bg, 0.16)}, ${bg} 70%)"></div>`}
      <div style="position:absolute;left:${pad}px;top:${s.kind === "story" ? Math.round(H * 0.08) : pad}px;height:${Math.round(W * 0.11)}px;display:flex">${logoImg(photo ? paper : bg, "height:100%")}</div>
      <div style="position:absolute;left:${pad}px;right:${pad}px;${photo ? `top:${(photoTop - 0.02) * 100}%` : "top:50%;transform:translateY(-42%)"};display:flex;flex-direction:column;gap:${Math.round(W * 0.03)}px">
        <div style="width:${Math.round(W * 0.1)}px;height:${Math.round(W * 0.01)}px;background:${button};border-radius:99px"></div>
        <div class="head" style="font-size:${headSize}px;color:${fg};text-wrap:balance">${esc(p.headline ?? b.name)}</div>
        ${p.text ? `<div style="font-size:${Math.round(W * 0.036)}px;line-height:1.35;color:${fg};opacity:0.9">${esc(p.text)}</div>` : ""}
        ${p.cta ? `<div style="display:flex;gap:${Math.round(W * 0.03)}px;align-items:center;margin-top:${Math.round(W * 0.02)}px"><span style="background:${button};color:${on(button)};font-weight:800;font-size:${Math.round(W * 0.036)}px;padding:${Math.round(W * 0.02)}px ${Math.round(W * 0.042)}px;border-radius:999px;display:inline-flex;align-items:center;gap:${Math.round(W * 0.015)}px">${esc(p.cta)}${iconSvg("arrow-right", { size: Math.round(W * 0.04), color: on(button), stroke: 2.6 })}</span><span style="color:${fg};font-weight:600;font-size:${Math.round(W * 0.03)}px;opacity:0.85">${esc(b.social?.handle ?? "")}</span></div>` : ""}
      </div>`;
  }
  return htmlPage(W, H, inner, bg);
};

const contact = b.contact ?? {};
const DESIGNS = {
  "card-front": [
    1062,
    600,
    `<div style="position:absolute;inset:0;background:${primary};display:flex;align-items:center;justify-content:center"><div style="height:46%;display:flex">${logoImg(primary, "height:100%")}</div></div>`,
    primary,
  ],
  "card-back": [
    1062,
    600,
    `<div style="position:absolute;inset:0;background:${paper};padding:64px 70px;display:flex;flex-direction:column;justify-content:space-between;color:${ink}">
      <div><div class="head" style="font-size:54px;color:${primary}">${esc(contact.person ?? b.name)}</div><div style="font-size:26px;margin-top:8px;opacity:0.8">${esc(contact.role ?? b.tagline ?? "")}</div></div>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:24px">${[
        contact.phone,
        contact.email,
        b.website,
      ]
        .filter(Boolean)
        .map(
          (l) =>
            `<span style="display:flex;gap:14px;align-items:center">${iconSvg(contactIcon(l), { size: 26, color: primary })}${esc(l)}</span>`,
        )
        .join("")}</div>
      <div style="position:absolute;right:0;top:0;bottom:0;width:22px;background:${accent}"></div></div>`,
    paper,
  ],
  fascia: [
    2400,
    330,
    `<div style="position:absolute;inset:0;background:${primary};display:flex;align-items:center;justify-content:center;gap:50px"><div style="height:70%;display:flex">${logoImg(primary, "height:100%")}</div><div class="head" style="font-size:150px;color:${on(primary)}">${esc(b.name)}</div></div>`,
    primary,
  ],
  sign: [
    1500,
    620,
    `<div style="position:absolute;inset:0;background:${primary};display:flex;align-items:center;justify-content:center;gap:60px;border:22px solid ${accent}"><div style="height:62%;display:flex">${logoImg(primary, "height:100%")}</div><div><div class="head" style="font-size:118px;color:${on(primary)}">${esc(b.name)}</div><div style="font-size:40px;color:${accent};font-weight:700;margin-top:8px">${esc(b.tagline ?? "")}</div></div></div>`,
    primary,
  ],
  badge: [
    600,
    1000,
    `<div style="position:absolute;inset:0;background:${paper};display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:90px 50px 70px"><div style="height:240px;display:flex">${logoImg(paper, "height:100%")}</div><div style="text-align:center"><div class="head" style="font-size:64px;color:${primary}">${esc((contact.person ?? b.name).split(" ")[0])}</div><div style="font-size:30px;margin-top:10px;opacity:0.8">${esc(contact.role ?? "")}</div></div><div style="width:100%;height:36px;background:${accent};border-radius:6px"></div></div>`,
    paper,
  ],
  banner: [
    1400,
    600,
    `<div style="position:absolute;inset:0;background:${primary};display:flex;align-items:center;padding:0 90px;gap:70px"><div style="height:62%;display:flex">${logoImg(primary, "height:100%")}</div><div><div class="head" style="font-size:96px;color:${on(primary)};max-width:820px">${esc(b.tagline ?? b.name)}</div><div style="font-size:42px;color:${accent};font-weight:700;margin-top:18px">${esc(b.website ?? "")}</div></div></div>`,
    primary,
  ],
  poster: [
    1000,
    1414,
    `${photoAt(1) ? `<img src="${url(photoAt(1))}" style="position:absolute;left:0;top:0;width:100%;height:56%;object-fit:cover">` : ""}<div style="position:absolute;left:0;right:0;top:${photoAt(1) ? 44 : 0}%;height:12%;background:linear-gradient(180deg,${primary}00,${primary})"></div>
    <div style="position:absolute;left:70px;top:60px;height:130px;display:flex">${logoImg(primary, "height:100%")}</div>
    <div style="position:absolute;left:70px;right:70px;top:58%"><div class="head" style="font-size:92px;color:${on(primary)};text-wrap:balance">${esc(posts[0]?.headline ?? b.tagline ?? b.name)}</div><div style="font-size:34px;margin-top:24px;color:${on(primary)};opacity:0.9">${esc(posts[0]?.text ?? "")}</div></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:110px;background:${accent};display:flex;align-items:center;justify-content:space-between;padding:0 70px;font-size:38px;font-weight:800;color:${on(accent)}"><span>${esc(posts[0]?.cta ?? "")}</span><span style="font-weight:600">${esc(b.website ?? "")}</span></div>`,
    primary,
  ],
};

NodeFS.mkdirSync(out, { recursive: true });
const socialDir = NodePath.join(out, "social");
const workDir = NodePath.join(out, ".designs");
const checkDir = NodePath.join(out, "check");
const mockDir = NodePath.join(out, "mockups");
for (const dir of [socialDir, workDir, checkDir]) NodeFS.mkdirSync(dir, { recursive: true });
const { chromium, chrome } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chrome });
const started = Date.now();
const shots = {};
for (const s of SOCIAL) {
  const file = NodePath.join(socialDir, `${s.id}.png`);
  await pixelPng(browser, { html: socialHtml(s), width: s.w, height: s.h, out: file });
  shots[s.id] = file;
}
const designFiles = {};
for (const [slot, [w, h, inner, bg]] of Object.entries(DESIGNS)) {
  const file = NodePath.join(workDir, `${slot}.png`);
  await pixelPng(browser, { html: htmlPage(w, h, inner, bg), width: w, height: h, out: file });
  designFiles[slot] = file;
}
if (logoFile) designFiles.logo = logoFile;
if (logoLightFile) designFiles["logo-light"] = logoLightFile;
designFiles.story = shots.story;
const mockPage = await browser.newPage();
await mockPage.setContent("<html><body style='margin:0'></body></html>");
await prepareMockupPage(mockPage);
const credits = [];
const M = {};
for (const id of [
  "business-cards",
  "coffee-cup",
  "kraft-bag",
  "mug",
  "tshirt",
  "shop-window",
  "wall-sign",
  "cafe-wall",
  "badge",
  "poster-frame",
  "poster-street-board",
  "phone-story",
  "apron",
]) {
  if (!want(id)) continue;
  if (["coffee-cup", "kraft-bag", "mug", "tshirt", "cafe-wall"].includes(id) && !logoFile) continue;
  if (id === "apron" && !logoLightFile) continue;
  const result = await composeMockup(mockPage, {
    id,
    designs: designFiles,
    out: NodePath.join(mockDir, `${id}.jpg`),
    maxSide: 2200,
  });
  if (result) {
    credits.push(`${id}: ${result.credit}`);
    M[id] = result.out;
  }
}
await mockPage.close();
const L = T.L;
/** Crops a mockup around the printed surface, so a tile never cuts the design off. */
const focusOf = (id) => {
  const entry = CATALOG.mockups.find((m) => m.id === id);
  const pts = entry.layers.flatMap((l) => l.quad);
  const x = pts.reduce((a, q) => a + q[0], 0) / pts.length / entry.photo.width;
  const y = pts.reduce((a, q) => a + q[1], 0) / pts.length / entry.photo.height;
  return `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
};
const cell = (id, caption, extra = "") =>
  M[id]
    ? `<div class="tile" style="${extra}"><img class="mock" src="${url(M[id])}" style="object-position:${focusOf(id)}"><div class="mockcap">${esc(caption)}</div></div>`
    : "";
const appHead = (title, note) =>
  `<div style="position:absolute;left:16mm;right:16mm;top:9mm;display:flex;justify-content:space-between;align-items:baseline"><div class="kicker" style="color:${primary}">04 · ${esc(title)}</div><div class="small">${note ? T.mockNote : ""}</div></div>`;
// Each application page uses the mockups that came out; a page never shows an empty slot.
const layout = (cells, columns, rows) =>
  `<div class="grid" style="top:16mm;grid-template-columns:${columns};grid-template-rows:${rows}">${cells.join("")}</div>`;
const printCells = [
  cell("business-cards", L.cards, "grid-column:span 2"),
  cell("kraft-bag", L.bag, "grid-row:span 2"),
  cell("coffee-cup", L.cup),
  cell("mug", L.mug),
].filter(Boolean);
const placeCells = [
  cell("shop-window", L.window),
  cell("cafe-wall", L.wall, "grid-row:span 2"),
  cell("wall-sign", L.sign),
].filter(Boolean);
const digitalCells = [
  cell("poster-frame", L.frame, "grid-row:span 2"),
  cell("poster-street-board", L.board),
  cell("phone-story", L.phone, "grid-row:span 2"),
  cell(M.apron ? "apron" : "tshirt", M.apron ? L.apron : L.tee),
].filter(Boolean);
if (appIndex[0] !== null)
  fill(
    appIndex[0],
    `${appHead(T.appsPrint, true)}${layout(printCells, printCells.length >= 4 ? "1fr 1fr 0.8fr" : "1fr 1fr", "1.15fr 1fr")}`,
  );
if (appIndex[1] !== null)
  fill(
    appIndex[1],
    `${appHead(T.appsPlace, false)}${layout(placeCells, placeCells.length >= 3 ? "1.4fr 1fr" : "1fr", "1fr 1fr")}`,
  );
if (appIndex[2] !== null)
  fill(
    appIndex[2],
    `${appHead(M.apron || M.tshirt ? T.appsDigital : T.appsDigitalNoWear, false)}${layout(digitalCells, digitalCells.length >= 4 ? "1.15fr 1.4fr 1fr" : "1fr 1fr", "1fr 1fr")}`,
  );
fill(
  appIndex[3],
  `<div style="position:absolute;left:16mm;right:16mm;top:9mm"><div class="kicker" style="color:${primary}">04 · ${T.social}</div></div>
   <div style="position:absolute;left:16mm;right:16mm;top:16mm;height:82mm;display:flex;gap:4mm;align-items:stretch;justify-content:space-between">
     ${SOCIAL.filter((s) => s.kind === "post" || s.kind === "story")
       .map(
         (s) =>
           `<img src="${url(shots[s.id])}" style="height:100%;border-radius:2mm;box-shadow:0 2mm 5mm rgba(0,0,0,0.15)">`,
       )
       .join("")}
   </div>
   <div style="position:absolute;left:16mm;top:104mm;width:132mm;display:flex;flex-direction:column;gap:3mm">
     <img src="${url(shots["facebook-cover"])}" style="width:100%;border-radius:2mm"><img src="${url(shots["linkedin-banner"])}" style="width:100%;border-radius:2mm">
   </div>
   <div style="position:absolute;left:156mm;right:16mm;top:104mm;display:flex;gap:5mm;align-items:flex-start"><img src="${url(shots.profile)}" style="width:24mm;border-radius:50%"><table style="font-size:7.5pt"><tr><th>${T.file}</th><th>${T.size}</th><th>${T.use}</th></tr>${SOCIAL.map((s) => `<tr><td>${s.id}.png</td><td>${s.w} x ${s.h}</td><td>${esc(s.use)}</td></tr>`).join("")}</table></div></div>`,
);
// Contents (needs the section pages).
{
  const img = photoAt(9) ?? photoAt(0);
  fill(
    contentsIndex,
    `<div style="position:absolute;left:16mm;top:18mm;width:150mm"><div class="kicker" style="color:${primary}">${T.contents}</div>
    <div style="margin-top:10mm;display:flex;flex-direction:column">${[["", T.story, 3], ...sections].map(([num, title, at]) => `<div style="display:flex;align-items:baseline;gap:6mm;padding:4.6mm 0;border-bottom:0.3mm solid ${line}"><span class="head" style="font-size:24pt;color:${primary};width:16mm">${num}</span><span class="head" style="font-size:19pt;flex:1">${esc(title)}</span><span class="small">${String(at).padStart(2, "0")}</span></div>`).join("")}</div>
    <div style="margin-top:8mm;display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;height:32mm">${[
      3, 4, 5,
    ]
      .map((i) => photoAt(i))
      .filter(Boolean)
      .map(
        (f) =>
          `<img src="${url(f)}" style="width:100%;height:100%;object-fit:cover;border-radius:2mm">`,
      )
      .join("")}</div></div>
    ${img ? `<img src="${url(img)}" style="position:absolute;right:0;top:0;width:110mm;height:100%;object-fit:cover">` : `<div style="position:absolute;right:0;top:0;width:110mm;height:100%;background:${primary}"></div>`}`,
  );
}
const bookHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${pages.join("\n")}</body></html>`;
const bookPage = await browser.newPage({ viewport: { width: 1123, height: 794 } });
await loadHtml(bookPage, bookHtml);
const slug =
  String(b.name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "brand";
const pdf = NodePath.join(out, `${slug}-brandbook.pdf`);
await bookPage.pdf({
  path: pdf,
  width: "297mm",
  height: "210mm",
  printBackground: true,
  preferCSSPageSize: true,
});
// Web version: the same pages as one HTML file with its fonts and images next to it.
const webDir = NodePath.join(out, "web");
{
  NodeFS.rmSync(webDir, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.join(webDir, "assets"), { recursive: true });
  const copied = new Map();
  const local = (href) => {
    if (copied.has(href)) return copied.get(href);
    const file = NodeURL.fileURLToPath(href);
    const name = `${String(copied.size).padStart(3, "0")}-${NodePath.basename(file).replace(/[^\w.-]/g, "_")}`;
    NodeFS.copyFileSync(file, NodePath.join(webDir, "assets", name));
    copied.set(href, `assets/${name}`);
    return `assets/${name}`;
  };
  const webHtml = bookHtml
    .replace(/file:\/\/[^"')\s]+/g, (href) => local(href))
    .replace(
      "</style>",
      `@media screen { html { background: #2a2a2a } body { background: #2a2a2a; padding: 56px 0 24px } .page { margin: 0 auto 18px; box-shadow: 0 6px 24px rgba(0,0,0,0.35) } }
      .webbar { position: fixed; z-index: 9; left: 0; right: 0; top: 0; height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; background: #1d1d1d; color: #f2f2f2; font: 500 13px/1 ${BODY} }
      .webbar a { color: #f2f2f2 }
      @media print { .webbar { display: none } body { padding: 0 } }</style>`,
    )
    .replace(
      "<body>",
      `<body><div class="webbar"><span>${esc(b.name)} · ${T.guide} ${year}</span><a href="${NodePath.basename(pdf)}" download>PDF</a></div>`,
    )
    .replace(
      "</body>",
      `<script>function fit(){var z=Math.min(1,(window.innerWidth-24)/1123);document.querySelectorAll('.page').forEach(function(p){p.style.zoom=z})}fit();addEventListener('resize',fit)</script></body>`,
    )
    .replace(
      '<meta charset="utf-8">',
      `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.name)} · ${T.guide}</title>`,
    );
  NodeFS.writeFileSync(NodePath.join(webDir, "index.html"), webHtml);
  NodeFS.copyFileSync(pdf, NodePath.join(webDir, NodePath.basename(pdf)));
}
// Page previews for checking, and one overview sheet.
for (const old of NodeFS.readdirSync(checkDir))
  if (/^page-\d+\.png$/.test(old)) NodeFS.rmSync(NodePath.join(checkDir, old));
const previews = [];
const handles = await bookPage.$$(".page");
for (const [i, handle] of handles.entries()) {
  const file = NodePath.join(checkDir, `page-${String(i + 1).padStart(2, "0")}.png`);
  await handle.screenshot({ path: file });
  previews.push(file);
}
await bookPage.close();
const overview = NodePath.join(out, "overview.jpg");
{
  const page2 = await browser.newPage({ viewport: { width: 2400, height: 1200 } });
  await loadHtml(
    page2,
    `<!doctype html><html><body style="margin:0;background:#1b1b1b;padding:16px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px;width:2368px">${previews.map((f) => `<img src="${url(f)}" style="width:100%;display:block;box-shadow:0 4px 14px rgba(0,0,0,.5)">`).join("")}</body></html>`,
  );
  await page2.screenshot({ path: overview, fullPage: true, type: "jpeg", quality: 85 });
  await page2.close();
}
await browser.close();
NodeFS.rmSync(workDir, { recursive: true, force: true });
NodeFS.writeFileSync(
  NodePath.join(out, "CREDITS.md"),
  [
    "# Credits",
    "",
    "Fonts: SIL Open Font License.",
    "Mockup photos (Pexels License, free commercial use, no attribution required):",
    ...credits.map((c) => `- ${c}`),
    "",
  ].join("\n"),
);
console.log(
  JSON.stringify(
    {
      brandbook: pdf,
      web: NodePath.join(webDir, "index.html"),
      pages: previews.length,
      overview,
      previews: checkDir,
      social: Object.values(shots),
      mockups: Object.values(M),
      seconds: Math.round((Date.now() - started) / 1000),
    },
    null,
    1,
  ),
);
