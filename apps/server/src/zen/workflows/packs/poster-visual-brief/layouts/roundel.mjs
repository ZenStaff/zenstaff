// The "roundel" layout: an editorial poster on paper built around one round subject cut from the
// photo (a bowl, a plate, a pizza, a cup seen from above). Optional clock ring: the serving
// hours drawn as an arc around the dish ("from 12 to 15"), the list of what is served set on the
// ring. A masthead on top, the headline, the dish, a row of three facts (price, hours, address)
// and a footer. Two calm colors (paper and ink) and the brand's strong color only on the arc and
// the price.
import { alpha, mix } from "../kit/common/color.js";
import { css } from "../kit/common/type.js";
import { esc, sheetShape } from "./shared.mjs";

const hourAngle = (h) => ((h % 12) / 12) * 360 - 90;
const parseHour = (v) => {
  const m = String(v ?? "").match(/(\d{1,2})(?::(\d{2}))?/);
  return m ? Number(m[1]) + Number(m[2] ?? 0) / 60 : null;
};
// SVG style attributes are double-quoted: the font stacks must use single quotes inside them.
const svgCss = (style) => css(style).replace(/"/g, "'");
const polar = (r, deg) => [
  500 + r * Math.cos((deg * Math.PI) / 180),
  500 + r * Math.sin((deg * Math.PI) / 180),
];

/** The ring around the dish as SVG (viewBox 1000): minute ticks, hour marks, the serving arc. */
function ringSvg({ spec, ink, loud, paper, L }) {
  const parts = [];
  const tickOuter = 492;
  for (let i = 0; i < 60; i++) {
    const hour = i % 5 === 0;
    const deg = i * 6 - 90;
    const [x1, y1] = polar(tickOuter - (hour ? 30 : 14), deg);
    const [x2, y2] = polar(tickOuter, deg);
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${ink}" stroke-width="${hour ? 4.2 : 2}" stroke-linecap="butt"/>`,
    );
  }
  const from = parseHour(spec.clock?.from);
  const to = parseHour(spec.clock?.to);
  if (from !== null && to !== null) {
    const a0 = hourAngle(from);
    let a1 = hourAngle(to);
    if (a1 <= a0) a1 += 360;
    const r = 438;
    const [x0, y0] = polar(r, a0);
    const [x1, y1] = polar(r, a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    parts.push(
      `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${loud}" stroke-width="30" stroke-linecap="butt"/>`,
    );
    // The two times at the ends of the arc, outside the ring.
    const label = (h, text, anchorDeg) => {
      const [lx, ly] = polar(tickOuter + 16, anchorDeg);
      const side = Math.cos((anchorDeg * Math.PI) / 180);
      const anchor = Math.abs(side) < 0.3 ? "middle" : side > 0 ? "start" : "end";
      const dy = Math.sin((anchorDeg * Math.PI) / 180) < -0.7 ? -14 : 12;
      return `<text x="${lx.toFixed(1)}" y="${(ly + dy).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="${dy < 0 ? "auto" : "middle"}" fill="${ink}" style="${svgCss(L.label)};font-size:34px;letter-spacing:0.06em">${esc(text)}</text>`;
    };
    parts.push(label(from, spec.clock.from, a0), label(to, spec.clock.to, a1));
  }
  // What is served, set along the lower half of the ring.
  const items = (spec.items ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (items.length) {
    const r = 536;
    const [sx, sy] = polar(r, 168);
    const [ex, ey] = polar(r, 12);
    parts.push(
      `<path id="lower" d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${r} ${r} 0 0 0 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none"/>`,
      `<text fill="${ink}" style="${svgCss(L.label)};font-size:31px;letter-spacing:0.2em"><textPath href="#lower" startOffset="50%" text-anchor="middle">${items.map(esc).join(`  <tspan fill="${loud}">/</tspan>  `)}</textPath></text>`,
    );
  }
  return `<svg class="ring" viewBox="-60 -60 1120 1120" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

/**
 * One sheet. `ctx`: spec, L (look), photo { url, width, height }, fontsCss(), headlineHtml().
 * W, H in CSS px; bleed and safe in px.
 */
export function roundelHtml(ctx, { W, H, bleed = 0, safe, story = false }) {
  const { spec, L, photo } = ctx;
  const ink = spec.brand.primary ?? "#1B2233";
  const loud = spec.brand.accent ?? "#D9381E";
  const paper = spec.brand.paper ?? "#F2EDE3";
  const soft = mix(ink, paper, 0.42);
  const { shape, u } = sheetShape(W, H);
  const pad = bleed + safe;
  const top = pad + (story ? H * 0.11 : 0);
  const bottom = pad + (story ? H * 0.12 : 0);
  // The round subject: a circle in photo pixels (or % of the photo width/height).
  const c = spec.roundel ?? {};
  const pw = photo?.width ?? 1;
  const ph = photo?.height ?? 1;
  const cx = c.x <= 100 && c.unit !== "px" ? (c.x / 100) * pw : c.x;
  const cy = c.y <= 100 && c.unit !== "px" ? (c.y / 100) * ph : c.y;
  const cr = c.r <= 100 && c.unit !== "px" ? (c.r / 100) * pw : c.r;
  const bgSize = (pw / (2 * cr)) * 100;
  const posX = pw - 2 * cr === 0 ? 50 : ((cx - cr) / (pw - 2 * cr)) * 100;
  const posY = ph - 2 * cr === 0 ? 50 : ((cy - cr) / (ph - 2 * cr)) * 100;
  const facts = (spec.facts ?? []).slice(0, 3);
  const mast = `
    <header class="mast">
      <div class="brand">${esc(spec.brand.name)}</div>
      ${spec.masthead ? `<div class="mt">${esc(spec.masthead)}</div>` : ""}
      ${spec.kicker ? `<div class="mt right">${esc(spec.kicker)}</div>` : ""}
    </header>`;
  const head = `<h1 class="h">${ctx.headlineHtml()}</h1>${spec.sub ? `<p class="sub">${esc(spec.sub)}</p>` : ""}`;
  const dish = `
    <div class="stage"><div class="dish">
      <div class="plate"></div>
      <div class="bowl" style="background-image:url('${photo?.url ?? ""}');background-size:${bgSize.toFixed(3)}% auto;background-position:${posX.toFixed(3)}% ${posY.toFixed(3)}%"></div>
      ${ringSvg({ spec, ink, loud, paper, L })}
    </div></div>`;
  const factsHtml = facts.length
    ? `<div class="facts">${facts
        .map(
          (f, i) =>
            `<div class="f${i === 0 ? " first" : ""}"><div class="fl">${esc(f.label)}</div><div class="fv${f.loud || i === 0 ? " loud" : ""}">${esc(f.value)}</div>${f.note ? `<div class="fn">${esc(f.note)}</div>` : ""}</div>`,
        )
        .join("")}</div>`
    : "";
  const foot = `
    <footer class="foot">
      <div class="cta">${esc(spec.cta ?? "")}</div>
      <div class="url">${esc(spec.url ?? "")}</div>
    </footer>`;
  const display = css(L.display);
  const accentCss = css(L.accent);
  // tall: one column; wide and square: the dish on the left, the words on the right.
  const twoCol = shape !== "tall";
  const body =
    shape === "square"
      ? `<div class="frame sq">${mast}${head}<div class="cols"><div class="left">${dish}</div><div class="right">${factsHtml}${foot}</div></div></div>`
      : twoCol
        ? `<div class="frame two">${mast}<div class="cols"><div class="left">${dish}</div><div class="right">${head}${factsHtml}${foot}</div></div></div>`
        : `<div class="frame">${mast}${head}${dish}${factsHtml}${foot}</div>`;
  const k = shape === "wide" ? 0.95 : shape === "square" ? 0.84 : 1;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${ctx.fontsCss()}
@page { size: ${W}px ${H}px; margin: 0 }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${paper}; -webkit-print-color-adjust: exact; print-color-adjust: exact }
* { box-sizing: border-box }
.sheet { --u: ${(u * k).toFixed(3)}px; position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${paper}; color: ${ink} }
.frame { position: absolute; left: ${pad}px; right: ${pad}px; top: ${top}px; bottom: ${bottom}px; display: flex; flex-direction: column }
.mast { display: flex; align-items: baseline; gap: calc(3 * var(--u)); padding-bottom: calc(1.6 * var(--u)); border-bottom: calc(0.28 * var(--u)) solid ${ink} }
.brand { ${display}; font-size: calc(5.2 * var(--u)); letter-spacing: -0.03em; line-height: 1 }
.mt { ${css(L.label)}; font-size: calc(1.7 * var(--u)); color: ${soft} }
.mt.right { margin-left: auto }
.h { ${display}; margin: calc(3.2 * var(--u)) 0 0; font-size: calc(15 * var(--u)); line-height: 0.9; letter-spacing: -0.035em; white-space: nowrap }
.h .accent { ${accentCss} }
.sub { ${css(L.body)}; margin: calc(1.6 * var(--u)) 0 0; font-size: calc(2.6 * var(--u)); max-width: 40em; color: ${soft} }
.stage { flex: 1; position: relative; min-height: 0; margin: calc(2.5 * var(--u)) 0 }
.dish { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) }
.dish .ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible }
.dish .bowl { position: absolute; left: 50%; top: 50%; width: 72.5%; height: 72.5%; transform: translate(-50%, -50%); border-radius: 50%; background-repeat: no-repeat; box-shadow: 0 calc(1.2 * var(--u)) calc(3.2 * var(--u)) ${alpha(ink, 0.22)}, inset 0 0 calc(1.4 * var(--u)) ${alpha("#000000", 0.25)} }
.dish .plate { position: absolute; left: 50%; top: 50%; width: 78.5%; height: 78.5%; transform: translate(-50%, -50%); border-radius: 50%; border: calc(0.22 * var(--u)) solid ${alpha(ink, 0.55)} }
.facts { display: grid; grid-template-columns: repeat(${Math.max(1, facts.length)}, 1fr); border-top: calc(0.28 * var(--u)) solid ${ink}; border-bottom: calc(0.14 * var(--u)) solid ${ink} }
.f { padding: calc(1.8 * var(--u)) calc(2 * var(--u)) calc(2 * var(--u)); border-left: calc(0.14 * var(--u)) solid ${ink}; min-width: 0 }
.f.first { border-left: 0; padding-left: 0 }
.fl { ${css(L.label)}; font-size: calc(1.55 * var(--u)); color: ${soft} }
.fv { ${css(L.numbers ?? L.display)}; font-size: calc(6.4 * var(--u)); line-height: 1; margin-top: calc(1 * var(--u)); letter-spacing: -0.03em; white-space: nowrap }
.fv.loud { color: ${loud} }
.fn { ${css(L.body)}; font-size: calc(1.85 * var(--u)); line-height: 1.25; margin-top: calc(0.8 * var(--u)); color: ${soft} }
.foot { display: flex; justify-content: space-between; align-items: baseline; padding-top: calc(1.6 * var(--u)) }
.cta { ${css(L.body)}; font-weight: 700; font-size: calc(2.2 * var(--u)) }
.url { ${css(L.label)}; font-size: calc(1.7 * var(--u)) }
.frame.two .cols { flex: 1; display: grid; grid-template-columns: ${shape === "wide" ? "0.9fr 1.1fr" : "1fr 1fr"}; gap: calc(4 * var(--u)); min-height: 0 }
.frame.two .left { position: relative; display: flex; flex-direction: column }
.frame.two .left .stage { margin: calc(3 * var(--u)) 0 calc(1 * var(--u)) }
.frame.two .right { display: flex; flex-direction: column; justify-content: flex-end; min-width: 0 }
.frame.two .right { justify-content: center }
.frame.two .h { font-size: calc(${shape === "wide" ? 12 : 9} * var(--u)); white-space: normal; margin: 0 0 calc(5 * var(--u)) }
.frame.two .sub { margin: calc(-3 * var(--u)) 0 calc(4 * var(--u)) }
.frame.two .fv { font-size: calc(${shape === "wide" ? 5.4 : 4.6} * var(--u)) }
.frame.two .fn { font-size: calc(1.6 * var(--u)) }
.frame.sq .cols { flex: 1; display: grid; grid-template-columns: 1.25fr 1fr; gap: calc(3.5 * var(--u)); min-height: 0; margin-top: calc(1 * var(--u)) }
.frame.sq .left { position: relative; display: flex; flex-direction: column }
.frame.sq .left .stage { margin: calc(2.5 * var(--u)) 0 0 }
.frame.sq .right { display: flex; flex-direction: column; justify-content: flex-end; min-width: 0 }
.frame.sq .facts { grid-template-columns: 1fr; border-bottom: 0 }
.frame.sq .f { border-left: 0; padding-left: 0; border-bottom: calc(0.14 * var(--u)) solid ${ink}; padding-top: calc(1.6 * var(--u)) }
.frame.sq .fv { font-size: calc(7 * var(--u)) }
.frame.sq .foot { flex-direction: column; gap: calc(0.6 * var(--u)) }
</style></head><body><div class="sheet">${body}</div>
<script>
// Fit: the headline as large as the column allows (one line on tall sheets), the dish fills
// what is left, each fact value fits its column.
(async () => {
  await document.fonts.ready;
  const h = document.querySelector(".h");
  const box = h.parentElement.getBoundingClientRect().width;
  let size = parseFloat(getComputedStyle(h).fontSize) * 1.6;
  for (let i = 0; i < 120; i++) {
    h.style.fontSize = size + "px";
    if (h.scrollWidth <= box + 1 && h.getBoundingClientRect().width <= box + 1) break;
    size *= 0.97;
  }
  for (const v of document.querySelectorAll(".fv")) {
    let s = parseFloat(getComputedStyle(v).fontSize);
    const w = v.parentElement.clientWidth - parseFloat(getComputedStyle(v.parentElement).paddingLeft) - parseFloat(getComputedStyle(v.parentElement).paddingRight);
    for (let i = 0; i < 60 && v.scrollWidth > w + 1; i++) { s *= 0.95; v.style.fontSize = s + "px"; }
  }
  // The dish: a true circle, as large as its stage allows.
  for (const st of document.querySelectorAll(".stage")) {
    const dish = st.querySelector(".dish");
    const D = Math.min(st.clientWidth, st.clientHeight);
    dish.style.width = dish.style.height = D + "px";
  }
  // Fact values: one size for the row, the largest that fits every column.
  const vs = [...document.querySelectorAll(".fv")];
  const min = Math.min(...vs.map((v) => parseFloat(v.style.fontSize || getComputedStyle(v).fontSize)));
  for (const v of vs) v.style.fontSize = min + "px";
  document.body.dataset.fitted = "1";
})();
</script></body></html>`;
}
