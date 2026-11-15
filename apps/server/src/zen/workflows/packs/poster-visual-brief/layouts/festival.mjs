// The "festival" layout: a landscape photo with the festival name set huge in the sky and slipped
// BEHIND the hills (the sky is found in the photo and the foreground is laid back over the
// letters), an optional sun in the strong color behind the name, then the line-up in tiers
// (headliners largest), the dates, the place and the tickets. The photo is placed so its horizon
// sits at the same height on every format; on the wide event cover the line-up gets its own panel.
import { alpha, mix } from "../kit/common/color.js";
import { css } from "../kit/common/type.js";
import { esc, grainUrl, sheetShape } from "./shared.mjs";

export function festivalHtml(ctx, { W, H, bleed = 0, safe, story = false }) {
  const { spec, L, photo } = ctx;
  const ink = spec.brand.primary ?? "#0F3D2E";
  const loud = spec.brand.accent ?? "#FF4F87";
  const paper = spec.brand.paper ?? "#F6EEDF";
  const titleColor = spec.titleColor ?? ink;
  const { shape, u } = sheetShape(W, H);
  const pad = bleed + safe;
  const top = pad + (story ? H * 0.1 : 0);
  const bottom = pad + (story ? H * 0.13 : 0);
  const wide = shape === "wide";
  // Where the horizon should land, as a share of the picture's height.
  const horizonAt =
    spec.horizon?.[shape] ?? (wide ? 0.6 : shape === "square" ? 0.47 : story ? 0.42 : 0.4);
  const picW = wide ? W * 0.6 : W;
  const tiers = (spec.lineup ?? []).map((t) => (Array.isArray(t) ? t : [t]));
  const sep = `<i class="sep">/</i>`;
  const lineup = tiers
    .map(
      (names, i) =>
        `<div class="tier t${i}">${names.map((n) => `<span class="n">${esc(n)}</span>`).join(` ${sep} `)}</div>`,
    )
    .join("");
  const tickets = (spec.tickets ?? [])
    .map(
      (t) =>
        `<div class="tk"><span class="tl">${esc(t.label)}</span><span class="tp">${esc(t.price)}</span></div>`,
    )
    .join("");
  const place = (spec.details ?? [])
    .map((d) => `<div class="pl">${esc(d.text ?? d)}</div>`)
    .join("");
  const words = String(spec.headline ?? "");
  const info = `
    <div class="info">
      <div class="dates">${esc(spec.dates ?? "")}</div>
      <div class="where">${place}</div>
      ${tickets ? `<div class="tickets">${tickets}</div>` : ""}
    </div>
    <div class="foot"><span>${esc(spec.cta ?? "")}</span><span class="url">${esc(spec.url ?? "")}</span></div>`;
  const topBar = `
    <div class="bar">
      <span>${esc(spec.edition ?? "")}</span>
      <span class="mid">${esc(spec.kicker ?? "")}</span>
      <span>${esc(spec.datesShort ?? "")}</span>
    </div>`;
  const k = wide ? 1 : shape === "square" ? 0.86 : story ? 0.94 : 1;
  const label = css(L.label);
  const display = css(L.display);
  const photoLayer = (cls) =>
    `<div class="${cls}" style="background-image:url('${photo.url}')"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${ctx.fontsCss()}
@page { size: ${W}px ${H}px; margin: 0 }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${ink}; -webkit-print-color-adjust: exact; print-color-adjust: exact }
* { box-sizing: border-box }
.sheet { --u: ${(u * k).toFixed(3)}px; position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${ink}; color: ${paper} }
.pic { position: absolute; left: 0; top: 0; width: ${picW}px; height: ${H}px; overflow: hidden }
.photo, .fore { position: absolute; inset: 0; background-repeat: no-repeat; background-size: cover; filter: saturate(1.08) contrast(1.04) }
.fore { -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-size: cover; mask-size: cover }
.sun { position: absolute; border-radius: 50%; background: ${loud}; display: ${spec.sun === false ? "none" : "block"} }
.title { position: absolute; left: 0; width: ${picW}px; text-align: center; ${display}; color: ${titleColor}; line-height: 1; white-space: nowrap; margin: 0 }
.shade { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(180deg, ${alpha(ink, 0)} 0%, ${alpha(ink, 0.6)} 22%, ${alpha(ink, 0.9)} 42%, ${ink} 70%) }
.grain { position: absolute; inset: 0; background-image: ${grainUrl(11)}; background-size: calc(32 * var(--u)); mix-blend-mode: overlay; opacity: 0.55; pointer-events: none }
.frame { position: absolute; left: ${pad}px; right: ${pad}px; top: ${top}px; bottom: ${bottom}px; display: flex; flex-direction: column }
.bar { display: flex; justify-content: space-between; align-items: center; ${label}; font-size: calc(1.8 * var(--u)); color: ${ink}; padding-bottom: calc(1.2 * var(--u)); border-bottom: calc(0.25 * var(--u)) solid ${ink} }
.bar .mid { text-align: center }
.low { margin-top: auto; display: flex; flex-direction: column }
.tier { ${display}; text-align: center; line-height: 1.02; text-wrap: balance }
.tier .n { white-space: nowrap }
.tier .sep { font-style: normal; color: ${loud}; padding: 0 0.12em }
.t0 { font-size: calc(9 * var(--u)); color: ${paper} }
.t1 { font-size: calc(5 * var(--u)); color: ${paper}; margin-top: calc(1.4 * var(--u)) }
.t2 { ${css(L.body)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; font-size: calc(2.3 * var(--u)); color: ${mix(paper, ink, 0.12)}; margin-top: calc(1.6 * var(--u)); line-height: 1.45 }
.t3 { ${css(L.body)}; font-weight: 600; font-size: calc(2 * var(--u)); color: ${mix(paper, ink, 0.3)}; margin-top: calc(0.8 * var(--u)) }
.info { display: grid; grid-template-columns: auto 1fr auto; gap: calc(3 * var(--u)); align-items: end; margin-top: calc(3 * var(--u)); padding-top: calc(2.2 * var(--u)); border-top: calc(0.25 * var(--u)) solid ${alpha(paper, 0.6)} }
.dates { ${display}; font-size: calc(8.4 * var(--u)); line-height: 0.86; color: ${loud}; white-space: nowrap }
.where { ${css(L.body)}; font-weight: 700; font-size: calc(2.1 * var(--u)); line-height: 1.25 }
.tickets { display: flex; flex-direction: column; gap: calc(0.5 * var(--u)) }
.tk { display: flex; justify-content: space-between; gap: calc(2.4 * var(--u)); align-items: baseline; ${css(L.body)}; font-size: calc(2 * var(--u)) }
.tl { font-weight: 600; color: ${mix(paper, ink, 0.2)} }
.tp { ${display}; font-size: calc(3.4 * var(--u)); color: ${paper} }
.foot { display: flex; justify-content: space-between; margin-top: calc(2 * var(--u)); ${label}; font-size: calc(1.6 * var(--u)); color: ${mix(paper, ink, 0.2)} }
.foot .url { color: ${paper} }
${
  wide
    ? `.panel { position: absolute; left: ${picW}px; top: 0; bottom: 0; right: 0; background: ${ink}; }
.frame { left: ${picW + 5 * u}px; top: ${pad + bleed}px }
.frame .bar { display: none }
.low { margin-top: 0; height: 100%; justify-content: center }
.tier { text-align: left }
.t0 { font-size: calc(7.4 * var(--u)) }
.t1 { font-size: calc(4.2 * var(--u)) }
.info { grid-template-columns: auto 1fr; }
.info .tickets { grid-column: 1 / -1; flex-direction: row; gap: calc(3 * var(--u)) }
.wbar { position: absolute; left: ${pad}px; top: ${pad}px; width: ${picW - pad * 2}px; display: flex; justify-content: space-between; ${label}; font-size: calc(1.8 * var(--u)); color: ${ink}; padding-bottom: calc(1.2 * var(--u)); border-bottom: calc(0.25 * var(--u)) solid ${ink} }`
    : ""
}
${shape === "square" ? `.info { grid-template-columns: auto 1fr; } .info .tickets { display: none } .t2 { font-size: calc(2.1 * var(--u)) }` : ""}
</style></head><body><div class="sheet">
  <div class="pic">
    ${photoLayer("photo")}
    <div class="sun"></div>
    <h1 class="title">${esc(words)}</h1>
    ${photoLayer("fore")}
    ${wide ? "" : '<div class="shade"></div>'}
  </div>
  ${wide ? `<div class="panel"></div><div class="wbar"><span>${esc(spec.edition ?? "")}</span><span>${esc(spec.kicker ?? "")}</span></div>` : ""}
  <div class="grain"></div>
  <div class="frame">${wide ? "" : topBar}<div class="low">${lineup}${info}</div></div>
</div>
<script>
(async () => {
  await document.fonts.ready;
  const W = ${W}, H = ${H}, picW = ${picW};
  const img = new Image();
  // A data URL: a file:// image would taint the canvas and its pixels could not be read.
  img.src = ${JSON.stringify(photo.dataUrl ?? photo.url)};
  await img.decode();
  const iw = img.naturalWidth, ih = img.naturalHeight;
  // 1. The sky: grow a region from the top edge through pixels that change smoothly.
  const cw = Math.min(iw, 1600), ch = Math.round((ih * cw) / iw);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.filter = "blur(1.2px)";
  g.drawImage(img, 0, 0, cw, ch);
  const d = g.getImageData(0, 0, cw, ch).data;
  const tol = ${Number(spec.depth?.tolerance ?? 7)};
  // Per column, walk down from the top while the color changes smoothly (step <= tol) and stays
  // close to the sky just above (a running average, so a slow fade into the hills stops too).
  const at = (x, y) => (y * cw + x) * 4;
  const raw = new Float32Array(cw);
  for (let x = 0; x < cw; x++) {
    let ref = [d[at(x, 0)], d[at(x, 0) + 1], d[at(x, 0) + 2]];
    let y = 1;
    for (; y < ch; y++) {
      const i = at(x, y), j = at(x, y - 1);
      const step = Math.max(Math.abs(d[i] - d[j]), Math.abs(d[i + 1] - d[j + 1]), Math.abs(d[i + 2] - d[j + 2]));
      const far = Math.max(Math.abs(d[i] - ref[0]), Math.abs(d[i + 1] - ref[1]), Math.abs(d[i + 2] - ref[2]));
      if (step > tol || far > tol * 3.2) break;
      ref = ref.map((v, k) => v * 0.8 + d[i + k] * 0.2);
    }
    raw[x] = y;
  }
  // Smooth the ridge (median of 9 columns) so single noisy columns do not spike.
  const ridgePx = new Float32Array(cw);
  for (let x = 0; x < cw; x++) {
    const win = [];
    for (let k = -2; k <= 2; k++) win.push(raw[Math.min(cw - 1, Math.max(0, x + k))]);
    win.sort((p, q) => p - q);
    ridgePx[x] = win[2];
  }
  const sky = new Uint8Array(cw * ch);
  for (let x = 0; x < cw; x++) for (let y = 0; y < ridgePx[x]; y++) sky[y * cw + x] = 1;
  const ridge = new Float32Array(cw);
  for (let x = 0; x < cw; x++) ridge[x] = ridgePx[x] / ch;
  const sorted = [...ridge].sort((a, b) => a - b);
  const horizon = sorted[Math.floor(cw * 0.5)];
  // 2. Place the photo: cover the picture area, horizon at the chosen height.
  const scale = Math.max(picW / iw, H / ih);
  const dw = iw * scale, dh = ih * scale;
  let oy = H * ${horizonAt} - horizon * dh;
  oy = Math.min(0, Math.max(H - dh, oy));
  const ox = (picW - dw) * ${(spec.focusX ?? 50) / 100};
  for (const el of document.querySelectorAll(".photo, .fore")) {
    el.style.backgroundSize = dw + "px " + dh + "px";
    el.style.backgroundPosition = ox + "px " + oy + "px";
  }
  // 3. The foreground mask (everything that is not sky), feathered a little.
  const m = document.createElement("canvas");
  m.width = cw; m.height = ch;
  const mg = m.getContext("2d");
  const md = mg.createImageData(cw, ch);
  for (let i = 0; i < cw * ch; i++) { md.data[i * 4 + 3] = sky[i] ? 0 : 255; }
  mg.putImageData(md, 0, 0);
  const f = document.createElement("canvas");
  f.width = cw; f.height = ch;
  const fg = f.getContext("2d");
  fg.filter = "blur(0.6px)";
  fg.drawImage(m, 0, 0);
  const fore = document.querySelector(".fore");
  const maskUrl = "url(" + f.toDataURL("image/png") + ")";
  fore.style.webkitMaskImage = maskUrl; fore.style.maskImage = maskUrl;
  fore.style.webkitMaskSize = dw + "px " + dh + "px"; fore.style.maskSize = dw + "px " + dh + "px";
  fore.style.webkitMaskPosition = ox + "px " + oy + "px"; fore.style.maskPosition = ox + "px " + oy + "px";
  // 4. The title: as wide as the picture allows, its foot sunk into the hills by "overlap".
  const t = document.querySelector(".title");
  const margin = ${wide ? 0.06 : 0.035} * picW;
  let size = 100;
  t.style.fontSize = size + "px";
  t.style.width = "max-content";
  size = size * (picW - margin * 2) / t.getBoundingClientRect().width;
  t.style.fontSize = size + "px";
  t.style.width = picW + "px";
  const probe = document.createElement("canvas").getContext("2d");
  const cs = getComputedStyle(t);
  probe.font = cs.fontStyle + " " + cs.fontWeight + " " + size + "px " + cs.fontFamily;
  const mt = probe.measureText(t.textContent.toUpperCase());
  const asc = mt.actualBoundingBoxAscent, desc = Math.max(0, mt.actualBoundingBoxDescent);
  // Ridge under the title, in sheet px (median over the title's width).
  const cols = [];
  for (let x = margin; x < picW - margin; x += 4) {
    const px = Math.min(cw - 1, Math.max(0, Math.round(((x - ox) / dw) * cw)));
    cols.push(oy + ridge[px] * dh);
  }
  cols.sort((a, b) => a - b);
  const ridgeY = cols[Math.floor(cols.length * ${spec.depth?.ridge ?? 0.5})];
  const overlap = ${Number(spec.depth?.overlap ?? 0.2)};
  const capBottom = ridgeY + overlap * asc;
  // The line box: baseline sits at top + (lineHeight - (ascent+descent of the font))/2 + font ascent.
  const lineH = t.getBoundingClientRect().height;
  const span = document.createElement("span"); span.style.display = "inline-block"; span.style.height = "0"; span.style.verticalAlign = "baseline";
  t.appendChild(span);
  const baselineInBox = span.getBoundingClientRect().top - t.getBoundingClientRect().top;
  span.remove();
  t.style.top = (capBottom - baselineInBox) + "px";
  const sun = document.querySelector(".sun");
  const sr = ${Number(spec.sunSize ?? 0.21)} * picW;
  sun.style.width = sun.style.height = 2 * sr + "px";
  sun.style.left = (picW * ${Number(spec.sunX ?? 0.66)} - sr) + "px";
  sun.style.top = (ridgeY - sr * ${Number(spec.sunRise ?? 1.25)}) + "px";
  const shade = document.querySelector(".shade");
  // The shade starts just above the line-up, so the lit landscape between stays bright.
  const lowTop = () => document.querySelector(".low").getBoundingClientRect().top;
  const placeShade = () => { if (shade) shade.style.top = Math.max(ridgeY + (H - ridgeY) * 0.2, lowTop() - H * 0.16) + "px"; };
  // 5. Line-up: the headliners as large as the width allows.
  const low = document.querySelector(".low");
  // Headliners and the second tier on one line each when they fit at 55% of their size or more.
  for (const tier of document.querySelectorAll(".tier.t0, .tier.t1")) {
    let s = parseFloat(getComputedStyle(tier).fontSize);
    const start = s;
    const max = tier.clientWidth;
    tier.style.whiteSpace = "nowrap";
    while (tier.scrollWidth > max + 1 && s > start * 0.55) { s *= 0.97; tier.style.fontSize = s + "px"; }
    if (tier.scrollWidth > max + 1) tier.style.whiteSpace = "";
    const names = [...tier.querySelectorAll(".n")];
    for (let i = 0; i < 60 && names.some((n) => n.getBoundingClientRect().width > max); i++) { s *= 0.95; tier.style.fontSize = s + "px"; }
  }
  // Keep the line-up below the title: shrink the lower block until it clears the ridge.
  const limit = ${wide ? 0 : "ridgeY + (H - ridgeY) * 0.16"};
  for (let i = 0; i < 40 && low.getBoundingClientRect().top < limit; i++) {
    for (const el of low.querySelectorAll(".tier, .dates, .where, .tk, .tp")) el.style.fontSize = parseFloat(getComputedStyle(el).fontSize) * 0.96 + "px";
  }
  placeShade();
  // A separator never ends or starts a line.
  for (const sep of document.querySelectorAll(".tier .sep")) {
    const prev = sep.previousElementSibling, next = sep.nextElementSibling;
    if (prev && next && Math.abs(prev.getBoundingClientRect().top - next.getBoundingClientRect().top) > 4) sep.style.visibility = "hidden";
  }
  document.body.dataset.fitted = "1";
})();
</script></body></html>`;
}
