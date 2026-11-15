// The deck as an editable PowerPoint file (text boxes, shapes, native tables/charts, notes).
// slideShapes() is pure: HTML geometry 1920x1080 px, 144 px = 1 in (13.333 x 7.5 in), 1 px = 0.5 pt.
// Sizes the browser shrank arrive in `fit` (else estimated here); every box shrinks on overflow.
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { fontFace, labels, pad2 } from "./theme.mjs";

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const PX_PER_IN = 144;
const PAD = { x: 128, y: 104, w: 1664, h: 826 };
const BODY = 30;

const inch = (px) => Math.round((px / PX_PER_IN) * 10000) / 10000;
const pt = (px) => Math.round(px * 5) / 10;
const hex = (c) => String(c).replace("#", "").toUpperCase();

// Average advance of a lowercase letter, in em, per font face (measured on Romanian text).
const ADVANCE = {
  Barlow: 0.528,
  "Barlow SemiBold": 0.536,
  "Barlow ExtraBold": 0.546,
  "Barlow Condensed": 0.424,
  "Barlow Condensed ExtraBold": 0.46,
  "Source Sans 3": 0.512,
  "Playfair Display": 0.556,
};
const charEm = (ch) => {
  if (ch === " ") return 0.26;
  if (/[iljtfrI.,;:'!|ț]/.test(ch)) return 0.6;
  if (/[mwMW]/.test(ch)) return 1.6;
  if (/[A-ZĂÂÎȘȚ]/.test(ch)) return 1.12;
  if (/[0-9]/.test(ch)) return 1.08;
  return 1;
};
/** Width of a line of text in px, estimated from the font's average advance. */
export function textWidth(text, style) {
  const base = ADVANCE[style.face] ?? 0.5;
  const bold = style.bold ? 1.06 : 1;
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * base * bold * style.size + [...text].length * (style.spacing ?? 0);
}
/** Lines the text wraps to in a box `width` px wide (greedy, word by word, explicit \n kept). */
export function wrapLines(text, style, width) {
  let lines = 0;
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    let count = 1;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, style) > width) {
        count += 1;
        line = word;
      } else line = next;
    }
    lines += count;
  }
  return lines;
}

const plain = (s) => String(s ?? "").replace(/\*\*([^*]+)\*\*/g, "$1");
/** `**words**` become accent runs; everything else keeps the box color. */
export function runs(text, accent) {
  const out = [];
  const source = String(text ?? "");
  let last = 0;
  for (const m of source.matchAll(/\*\*([^*]+)\*\*/g)) {
    if (m.index > last) out.push({ text: source.slice(last, m.index) });
    out.push({ text: m[1], color: accent });
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push({ text: source.slice(last) });
  return out.filter((r) => r.text.length > 0);
}

/** Pure: one slide of deck.json as positioned shapes (inches, points, hex colors). */
export function slideShapes(deck, theme, index, options = {}) {
  const s = deck.slides[index];
  const total = deck.slides.length;
  const lang = deck.language === "en" ? "en" : "ro";
  const T = labels(lang);
  const look = theme.look;
  const c = theme.colors;
  const fit = options.fit ?? {};
  const images = options.images ?? {};
  const inner = fit.inner ?? 1;
  const dark = s.dark === true || (s.dark !== false && s.layout === "cover");
  const ink = dark ? theme.onPrimary : c.dark;
  const soft = dark ? theme.onPrimaryMuted : theme.muted;
  const accentInk = dark ? theme.accentOnPrimary : theme.accentText;
  const upper = (t) => (look.headCase === "uppercase" ? String(t).toUpperCase() : t);
  const shapes = [];

  const type = (family, weight, size, extra = {}) => ({
    ...fontFace(family, weight),
    size,
    ...extra,
  });
  const headType = (size) =>
    type(look.head, look.headWeight, size, { spacing: size * parseFloat(look.tracking) });
  // Kickers and card names are heavy; footer, meta and author lines are regular, as in the CSS.
  const labelType = (size, tracking, weight = look.label === "Source Sans 3" ? 700 : 800) =>
    type(look.label, weight, size, {
      spacing: size * tracking,
      upper: true,
    });
  const bodyType = (size, weight = 400) => type(look.body, weight, size);
  const numType = (size) =>
    type(look.numbers, look.numbers === "Playfair Display" ? 500 : 700, size);

  const height = (text, style, width, lh) =>
    wrapLines(style.upper ? String(text).toUpperCase() : text, style, width) * style.size * lh;

  // A text box: `text` may hold **accent** marks; the box is as tall as the estimated lines.
  const text = (value, style, box, more = {}) => {
    const source = style.upper ? String(value).toUpperCase() : String(value);
    if (!plain(source).trim()) return 0;
    const lh = more.lh ?? 1.42;
    const h = more.h ?? height(plain(source), style, box.w, lh);
    shapes.push({
      kind: "text",
      role: more.role ?? "text",
      x: box.x,
      y: box.y,
      w: box.w,
      h,
      runs: runs(source, more.accent ?? accentInk),
      face: style.face,
      bold: style.bold,
      size: style.size,
      color: more.color ?? ink,
      align: more.align ?? "left",
      valign: more.valign ?? "top",
      lineHeight: lh,
      spacing: style.spacing ?? 0,
    });
    return h;
  };
  const rect = (box, fill, more = {}) => shapes.push({ kind: "rect", ...box, fill, ...more });

  // Kicker line + title, as in head(): returns the height used.
  const head = (x, y, w, titleSize, titleMax, maxLines = 2) => {
    let used = 0;
    if (s.kicker) {
      rect({ x, y: y + 13.5, w: 56, h: 3 }, c.accent, { role: "kicker-rule" });
      text(
        s.kicker,
        labelType(21, 0.2),
        { x: x + 76, y, w: w - 76 },
        {
          color: dark ? theme.onPrimary : theme.accentText,
          role: "kicker",
        },
      );
      used += 21 * 1.42 + 34;
    }
    if (s.title) {
      const size =
        fit.title ??
        fitSize(upper(plain(s.title)), headType(titleSize), Math.min(w, titleMax), maxLines);
      used += text(
        upper(s.title),
        headType(size),
        { x, y: y + used, w: Math.min(w, titleMax) },
        {
          lh: titleSize >= 100 ? 1.0 : titleSize >= 84 ? 1.08 : 1.06,
          role: "title",
        },
      );
    }
    return used;
  };
  // The HTML's own rule: shrink the title 2 px at a time to 72 % until it fits its lines.
  function fitSize(value, style, width, maxLines) {
    let size = style.size;
    while (
      size > style.size * 0.72 &&
      wrapLines(value, { ...style, size, spacing: (style.spacing / style.size) * size }, width) >
        maxLines
    )
      size -= 2;
    return size;
  }

  const foot = (right = PAD.x) => {
    const y = SLIDE_H - 56 - 30;
    const footStyle = labelType(18, 0.14, 400);
    let x = PAD.x;
    const logo = dark ? images.logoOnDark : images.logo;
    if (logo) {
      const w = (34 * logo.width) / logo.height;
      shapes.push({ kind: "image", role: "logo", x, y: y - 2, w, h: 34, image: logo });
      x += w + 18;
    }
    // Brand name and "for <client>" share one box, so neither wraps on its own.
    const parts = [
      logo ? "" : (deck.brand?.name ?? ""),
      deck.client?.name ? `${T.for} ${deck.client.name}` : "",
    ]
      .filter(Boolean)
      .map((part) => part.toUpperCase());
    if (parts.length)
      text(
        parts.join("   "),
        footStyle,
        { x, y, w: Math.max(200, SLIDE_W - right - 220 - x) },
        {
          color: soft,
          role: "footer",
          h: 30,
        },
      );
    text(
      `${pad2(index + 1)} / ${pad2(total)}`,
      { ...numType(18), spacing: 18 * 0.14 },
      {
        x: SLIDE_W - right - 200,
        y,
        w: 200,
      },
      { color: soft, align: "right", role: "page", h: 30 },
    );
  };
  const check = (x, y, size, color) =>
    shapes.push({ kind: "icon", icon: "check", role: "icon", x, y, w: size, h: size, color });

  // Content that the HTML centres in the space under the title (margin: auto 0).
  const centred = (top, contentH, bottom = PAD.y + PAD.h) =>
    top + Math.max(0, (bottom - top - contentH) / 2);

  const background = dark ? c.primary : theme.paper;
  switch (s.layout) {
    case "cover": {
      const photo = images[`slide${index}`];
      const photoW = photo ? SLIDE_W * 0.42 : 0;
      if (photo)
        shapes.push({
          kind: "image",
          role: "photo",
          x: SLIDE_W - photoW,
          y: 0,
          w: photoW,
          h: SLIDE_H,
          image: photo,
          cover: true,
        });
      const right = photo ? photoW + 64 : PAD.x;
      const top = 96;
      if (images.logoOnDark) {
        const lg = images.logoOnDark;
        let h = Math.min(92, lg.height);
        let w = (h * lg.width) / lg.height;
        if (w > 420) {
          w = 420;
          h = (w * lg.height) / lg.width;
        }
        shapes.push({
          kind: "image",
          role: "logo",
          x: PAD.x,
          y: top + (92 - h) / 2,
          w,
          h,
          image: lg,
        });
      } else if (deck.brand?.name) {
        text(
          deck.brand.name,
          type(look.head, look.strong, 40, { spacing: 0.8 }),
          { x: PAD.x, y: top + 18, w: 900 },
          {
            color: theme.onPrimary,
            role: "wordmark",
          },
        );
      }
      if (deck.client?.name && !photo) {
        const forStyle = labelType(21, 0.2, 400);
        const forLabel = T.for.toUpperCase();
        const forW = textWidth(forLabel, forStyle) + 8;
        const edge = SLIDE_W - right;
        if (images.clientLogo) {
          const cl = images.clientLogo;
          let h = 64;
          let w = (h * cl.width) / cl.height;
          if (w > 260) {
            w = 260;
            h = (w * cl.height) / cl.width;
          }
          const boxX = edge - w - 28;
          rect({ x: boxX, y: top + 46 - (h + 20) / 2, w: w + 28, h: h + 20 }, "#FFFFFF", {
            radius: 6,
            role: "client-logo-box",
          });
          shapes.push({
            kind: "image",
            role: "client-logo",
            x: boxX + 14,
            y: top + 46 - h / 2,
            w,
            h,
            image: cl,
          });
          text(
            forLabel,
            forStyle,
            { x: boxX - 22 - forW, y: top + 31, w: forW },
            { color: theme.onPrimaryMuted, align: "right", role: "for" },
          );
        } else {
          const name = deck.client.name.toUpperCase();
          const nameW = Math.min(700, textWidth(name, forStyle) + 8);
          text(
            `${forLabel}  ${name}`,
            forStyle,
            { x: edge - nameW - forW - 22, y: top + 31, w: nameW + forW + 22 },
            {
              color: theme.onPrimaryMuted,
              align: "right",
              role: "for",
            },
          );
        }
      }
      const bodyW = photo ? 980 : 1340;
      const title = s.title ?? deck.title;
      const subtitle = s.subtitle ?? deck.subtitle;
      const titleSize = fit.title ?? fitSize(upper(plain(title)), headType(112), bodyW, 3);
      const titleH = height(upper(plain(title)), headType(titleSize), bodyW, 1.0);
      const subStyle = bodyType(38 * inner);
      const subH = subtitle
        ? 34 + height(plain(subtitle), subStyle, Math.min(bodyW, 1100), 1.42)
        : 0;
      let y = SLIDE_H - 190 - (8 + 46 + titleH + subH);
      rect({ x: PAD.x, y, w: 120, h: 8 }, c.accent, { role: "bar" });
      y += 54;
      text(
        upper(title),
        headType(titleSize),
        { x: PAD.x, y, w: bodyW },
        { lh: 1.0, role: "title", h: titleH },
      );
      y += titleH + 34;
      if (subtitle)
        text(
          subtitle,
          subStyle,
          { x: PAD.x, y, w: Math.min(bodyW, 1100) },
          { color: theme.onPrimaryMuted, role: "subtitle" },
        );
      const meta = [
        deck.client?.name && photo ? `${T.for} ${deck.client.name}` : "",
        deck.date,
        deck.author,
      ]
        .filter(Boolean)
        .join("  ·  ");
      if (meta)
        text(
          meta,
          labelType(21, 0.18, 400),
          { x: PAD.x, y: SLIDE_H - 96 - 30, w: SLIDE_W - 2 * PAD.x },
          {
            color: theme.onPrimaryMuted,
            role: "meta",
            h: 30,
          },
        );
      break;
    }
    case "statement": {
      const kickerH = s.kicker ? 21 * 1.42 + 34 : 0;
      const size = fit.title ?? fitSize(upper(plain(s.title)), headType(84), 1450, 4);
      const titleH = height(upper(plain(s.title)), headType(size), 1450, 1.08);
      const leadStyle = bodyType(34 * inner);
      const leadH = s.text ? 44 + height(plain(s.text), leadStyle, 1150, 1.42) : 0;
      const y = centred(PAD.y, kickerH + titleH + leadH);
      head(PAD.x, y, 1450, 84, 1450, 4);
      if (s.text)
        text(
          s.text,
          leadStyle,
          { x: PAD.x, y: y + kickerH + titleH + 44, w: 1150 },
          { color: soft, role: "lead" },
        );
      foot();
      break;
    }
    case "points": {
      const used = head(PAD.x, PAD.y, PAD.w, 76, 1500);
      const n = s.points.length;
      const colW = (PAD.w - 72 * (n - 1)) / n;
      const h3 = headType(46 * inner);
      const p = bodyType(BODY * inner);
      const heights = s.points.map(
        (pt_) =>
          32 +
          76 +
          26 +
          height(upper(plain(pt_.title)), h3, colW, 1.14) +
          (pt_.text ? 16 + height(plain(pt_.text), p, colW, 1.45) : 0),
      );
      const y = centred(PAD.y + used, Math.max(...heights));
      s.points.forEach((point, k) => {
        const x = PAD.x + k * (colW + 72);
        rect({ x, y, w: colW, h: 2 }, dark ? theme.onPrimary : c.dark, { role: "col-rule" });
        text(
          pad2(k + 1),
          numType(76),
          { x, y: y + 32, w: colW },
          { lh: 1, color: accentInk, role: "number" },
        );
        const th = text(
          upper(point.title),
          h3,
          { x, y: y + 32 + 76 + 26, w: colW },
          { lh: 1.14, role: "point-title" },
        );
        if (point.text)
          text(
            point.text,
            p,
            { x, y: y + 32 + 76 + 26 + th + 16, w: colW },
            { lh: 1.45, color: soft, role: "point-text" },
          );
      });
      foot();
      break;
    }
    case "split": {
      const mediaW = SLIDE_W * 0.44;
      const mediaX = SLIDE_W - mediaW;
      const photo = images[`slide${index}`];
      if (photo)
        shapes.push({
          kind: "image",
          role: "photo",
          x: mediaX,
          y: 0,
          w: mediaW,
          h: SLIDE_H,
          image: photo,
          cover: true,
        });
      else {
        rect({ x: mediaX, y: 0, w: mediaW, h: SLIDE_H }, c.primary, { role: "media" });
        const capStyle = bodyType(28);
        const capH = s.caption ? 18 + height(s.caption, capStyle, mediaW - 192, 1.42) : 0;
        const bottom = SLIDE_H - 150;
        if (s.figure)
          text(
            String(s.figure),
            numType(150),
            { x: mediaX + 96, y: bottom - capH - 150, w: mediaW - 192 },
            {
              lh: 1,
              color: theme.onPrimary,
              role: "figure",
              h: 150,
            },
          );
        if (s.caption)
          text(
            s.caption,
            capStyle,
            { x: mediaX + 96, y: bottom - capH + 18, w: mediaW - 192 },
            { color: theme.onPrimaryMuted, role: "caption" },
          );
      }
      const w = mediaX - 96 - PAD.x;
      // The split text always sits on the light side.
      const lightInk = c.dark;
      let y = PAD.y;
      if (s.kicker) {
        rect({ x: PAD.x, y: y + 13.5, w: 56, h: 3 }, c.accent, { role: "kicker-rule" });
        text(
          s.kicker,
          labelType(21, 0.2),
          { x: PAD.x + 76, y, w: w - 76 },
          { color: theme.accentText, role: "kicker" },
        );
        y += 21 * 1.42 + 34;
      }
      if (s.title) {
        const size = fit.title ?? fitSize(upper(plain(s.title)), headType(66), w, 2);
        y += text(
          upper(s.title),
          headType(size),
          { x: PAD.x, y, w },
          { lh: 1.06, color: lightInk, accent: theme.accentText, role: "title" },
        );
      }
      if (s.text)
        y +=
          30 +
          text(
            s.text,
            bodyType(33 * inner),
            { x: PAD.x, y: y + 30, w },
            { color: theme.muted, accent: theme.accentText, role: "lead" },
          );
      if (Array.isArray(s.bullets) && s.bullets.length) {
        y += 40;
        const li = bodyType(32 * inner);
        for (const b of s.bullets) {
          check(PAD.x, y + 5, 34, theme.accentText);
          y +=
            22 +
            text(
              b,
              li,
              { x: PAD.x + 56, y, w: w - 56 },
              { lh: 1.4, color: lightInk, accent: theme.accentText, role: "bullet" },
            );
        }
      }
      foot(mediaW + 96);
      break;
    }
    case "numbers": {
      let used = head(PAD.x, PAD.y, PAD.w, 76, 1500);
      const leadStyle = bodyType(33 * inner);
      if (s.text)
        used +=
          30 +
          text(
            s.text,
            leadStyle,
            { x: PAD.x, y: PAD.y + used + 30, w: 1180 },
            { color: soft, role: "lead" },
          );
      const n = s.stats.length;
      const colW = (PAD.w - 64 * (n - 1)) / n;
      const chart = s.chart && Array.isArray(s.chart.bars) ? s.chart : null;
      const vSize = chart ? 120 : 176;
      const label = bodyType(31 * inner);
      const statH = Math.max(
        ...s.stats.map(
          (st) =>
            vSize * 0.95 + 22 + height(plain(st.label), label, Math.min(470, colW - 37), 1.42),
        ),
      );
      const chartH = chart ? 330 : 0;
      const y = chart ? PAD.y + used + 48 : centred(PAD.y + used, statH);
      s.stats.forEach((st, k) => {
        const x = PAD.x + k * (colW + 64);
        rect({ x, y, w: 3, h: statH }, c.accent, { role: "stat-rule" });
        text(
          String(st.value),
          numType(vSize),
          { x: x + 37, y, w: colW - 37 },
          {
            lh: 0.95,
            color: dark ? theme.onPrimary : theme.statValue,
            role: "stat-value",
            h: vSize * 0.95,
          },
        );
        text(
          st.label,
          label,
          { x: x + 37, y: y + vSize * 0.95 + 22, w: Math.min(470, colW - 37) },
          { color: soft, role: "stat-label" },
        );
      });
      if (chart) {
        const top = PAD.y + PAD.h - chartH;
        const caption = [chart.title, chart.unit].filter(Boolean).join(" · ");
        if (caption)
          text(
            caption,
            labelType(19, 0.16),
            { x: PAD.x, y: top, w: PAD.w },
            { color: dark ? theme.onPrimary : theme.accentText, role: "chart-title", h: 28 },
          );
        shapes.push({
          kind: "chart",
          role: "chart",
          x: PAD.x,
          y: top + 40,
          w: PAD.w,
          h: chartH - 40,
          labels: chart.bars.map((b) => String(b.label)),
          values: chart.bars.map((b) => Number(b.value)),
          name: chart.title ?? chart.unit ?? "",
          color: dark ? theme.onPrimary : c.primary,
          ink: soft,
          valueInk: ink,
          face: fontFace(look.body, 400).face,
          numberFace: fontFace(look.numbers, 700).face,
        });
      }
      foot();
      break;
    }
    case "timeline": {
      const used = head(PAD.x, PAD.y, PAD.w, 76, 1500);
      const n = s.steps.length;
      const colW = (PAD.w - 48 * (n - 1)) / n;
      const h3 = headType(40 * inner);
      const p = bodyType(28 * inner);
      const w = labelType(22, 0.18);
      const heights = s.steps.map(
        (st) =>
          72 +
          (st.when ? 22 * 1.42 + 14 : 22 * 1.42 + 14) +
          height(upper(plain(st.title)), h3, colW, 1.15) +
          (st.text ? 12 + height(plain(st.text), p, colW, 1.42) : 0),
      );
      const y = centred(PAD.y + used, Math.max(...heights));
      rect({ x: PAD.x, y: y + 13, w: PAD.w, h: 2 }, theme.rule, { role: "timeline-rule" });
      s.steps.forEach((st, k) => {
        const x = PAD.x + k * (colW + 48);
        // The CSS dot is 28 px outside with a 6 px ring; a PowerPoint outline is centred on the edge.
        shapes.push({
          kind: "ellipse",
          role: "dot",
          x: x + 3,
          y: y + 8 + 3,
          w: 22,
          h: 22,
          fill: theme.paper,
          line: c.accent,
          lineWidth: 6,
        });
        let yy = y + 72;
        if (st.when)
          text(st.when, w, { x, y: yy, w: colW }, { color: theme.accentText, role: "when" });
        yy += 22 * 1.42 + 14;
        const th = text(
          upper(st.title),
          h3,
          { x, y: yy, w: colW },
          { lh: 1.15, role: "step-title" },
        );
        if (st.text)
          text(st.text, p, { x, y: yy + th + 12, w: colW }, { color: soft, role: "step-text" });
      });
      foot();
      break;
    }
    case "pricing": {
      const used = head(PAD.x, PAD.y, PAD.w, 76, 1500);
      const noteStyle = bodyType(25 * inner);
      const noteH = s.note ? height(plain(s.note), noteStyle, PAD.w, 1.42) - 8 : 0;
      const n = s.options.length;
      const colW = (PAD.w - 44 * (n - 1)) / n;
      const li = bodyType(29 * inner);
      const innerW = colW - 92;
      const cardH = Math.max(
        ...s.options.map(
          (o) =>
            48 * 2 +
            34 +
            34 +
            108 +
            (o.unit ? 10 + 27 * 1.42 : 0) +
            36 +
            30 +
            (o.features ?? []).reduce(
              (sum, f) => sum + height(plain(f), li, innerW - 44, 1.35) + 16,
              -16,
            ),
        ),
      );
      const y = centred(PAD.y + used, cardH, PAD.y + PAD.h - noteH);
      s.options.forEach((o, k) => {
        const x = PAD.x + k * (colW + 44);
        const rec = o.recommended === true;
        const fg = rec ? theme.onPrimary : c.dark;
        const fgSoft = rec ? theme.onPrimaryMuted : theme.muted;
        const tick = rec ? theme.accentOnPrimary : theme.accentText;
        rect({ x, y, w: colW, h: cardH }, rec ? c.primary : theme.card, {
          line: rec ? c.primary : theme.rule,
          lineWidth: 2,
          radius: 14,
          role: rec ? "card-recommended" : "card",
        });
        const cx = x + 46;
        let yy = y + 48;
        const nameStyle = type(look.label, 800, 22, { spacing: 22 * 0.18, upper: true });
        if (rec) {
          const tagStyle = type(look.label, 800, 17, { spacing: 17 * 0.14, upper: true });
          const tag = T.recommended.toUpperCase();
          const tagW = textWidth(tag, tagStyle) + 28 + 6;
          rect({ x: cx + innerW - tagW, y: yy - 3, w: tagW, h: 17 * 1.42 + 16 }, c.accent, {
            radius: 20,
            role: "tag",
          });
          text(
            tag,
            tagStyle,
            { x: cx + innerW - tagW, y: yy - 3, w: tagW },
            {
              color: theme.onAccent,
              align: "center",
              valign: "middle",
              role: "tag-text",
              h: 17 * 1.42 + 16,
            },
          );
          text(
            o.name,
            nameStyle,
            { x: cx, y: yy, w: innerW - tagW - 12 },
            { color: fg, role: "option-name" },
          );
        } else
          text(o.name, nameStyle, { x: cx, y: yy, w: innerW }, { color: fg, role: "option-name" });
        yy += 34 + 34;
        text(
          String(o.price),
          numType(108),
          { x: cx, y: yy, w: innerW },
          { lh: 1, color: fg, role: "price", h: 108 },
        );
        yy += 108;
        if (o.unit) {
          text(
            o.unit,
            bodyType(27),
            { x: cx, y: yy + 10, w: innerW },
            { color: fgSoft, role: "unit" },
          );
          yy += 10 + 27 * 1.42;
        }
        yy += 36;
        rect({ x: cx, y: yy, w: innerW, h: 1 }, rec ? theme.onPrimaryMuted : theme.rule, {
          role: "card-rule",
        });
        yy += 30;
        for (const f of o.features ?? []) {
          check(cx, yy + 3, 28, tick);
          yy +=
            16 +
            text(
              f,
              li,
              { x: cx + 44, y: yy, w: innerW - 44 },
              { lh: 1.35, color: fg, accent: tick, role: "feature" },
            );
        }
      });
      if (s.note)
        text(
          s.note,
          noteStyle,
          { x: PAD.x, y: PAD.y + PAD.h - noteH - 8, w: PAD.w },
          { color: soft, role: "note" },
        );
      foot();
      break;
    }
    case "table": {
      const used = head(PAD.x, PAD.y, PAD.w, 76, 1500);
      const noteStyle = bodyType(25 * inner);
      const noteH = s.note ? height(plain(s.note), noteStyle, PAD.w, 1.42) - 8 : 0;
      const right = (s.align ?? []).map((a) => a === "right");
      const cell = bodyType(BODY * inner);
      const n = s.columns.length;
      // Columns as wide as their longest text, like the browser's automatic table layout.
      const want = s.columns.map(
        (col, k) =>
          Math.max(
            textWidth(String(col).toUpperCase(), labelType(19, 0.16)),
            ...s.rows.map((r) =>
              textWidth(plain(r[k] ?? ""), bodyType(BODY * inner, k === 0 ? 600 : 400)),
            ),
          ) + 22,
      );
      const sum = want.reduce((a, b) => a + b, 0);
      const colW = want.map((w) =>
        sum > PAD.w ? Math.max(140, (w / sum) * PAD.w) : (w / sum) * PAD.w,
      );
      const fix = PAD.w / colW.reduce((a, b) => a + b, 0);
      for (let k = 0; k < n; k++) colW[k] *= fix;
      const headH = 19 * 1.42 + 22;
      const rowHs = s.rows.map(
        (r) => 44 + Math.max(...r.map((v, k) => height(plain(v ?? ""), cell, colW[k] - 22, 1.42))),
      );
      const tableH = headH + rowHs.reduce((a, b) => a + b, 0);
      const y = centred(PAD.y + used, tableH, PAD.y + PAD.h - noteH);
      const border = (color, w) => ({ color, width: w });
      shapes.push({
        kind: "table",
        role: "table",
        x: PAD.x,
        y,
        w: PAD.w,
        colW,
        rowH: [headH, ...rowHs],
        rows: [
          s.columns.map((col, k) => ({
            text: String(col).toUpperCase(),
            face: fontFace(look.label, 800).face,
            bold: fontFace(look.label, 800).bold,
            size: 19,
            spacing: 19 * 0.16,
            color: dark ? theme.onPrimary : theme.accentText,
            align: right[k] ? "right" : "left",
            pad: [0, 22, 22, 0],
            bottom: border(dark ? theme.onPrimary : c.dark, 2),
          })),
          ...s.rows.map((r) =>
            r.map((v, k) => {
              const face = right[k]
                ? fontFace(look.numbers, 700)
                : fontFace(look.body, k === 0 ? 600 : 400);
              return {
                text: String(v ?? ""),
                runs: runs(String(v ?? ""), accentInk),
                face: face.face,
                bold: face.bold,
                size: BODY * inner,
                spacing: 0,
                color: ink,
                align: right[k] ? "right" : "left",
                pad: [22, 22, 22, 0],
                bottom: border(theme.rule, 1),
              };
            }),
          ),
        ],
      });
      if (s.note)
        text(
          s.note,
          noteStyle,
          { x: PAD.x, y: PAD.y + PAD.h - noteH - 8, w: PAD.w },
          { color: soft, role: "note" },
        );
      foot();
      break;
    }
    case "quote": {
      const size = fit.title ?? fitSize(plain(s.quote), type("Playfair Display", 500, 64), 1500, 4);
      const qStyle = type("Playfair Display", 500, size);
      const qH = height(plain(s.quote), qStyle, 1500, 1.18);
      const whoH = s.author ? 44 + 22 * 1.42 : 0;
      const y = centred(PAD.y, 120 + qH + whoH);
      text(
        "“",
        type("Playfair Display", 500, 260),
        { x: PAD.x - 6, y: y - 34, w: 200 },
        {
          lh: 1,
          color: c.accent,
          role: "quote-mark",
          h: 200,
        },
      );
      text(s.quote, qStyle, { x: PAD.x, y: y + 120, w: 1500 }, { lh: 1.18, role: "quote", h: qH });
      if (s.author)
        text(
          s.author,
          labelType(22, 0.18, 400),
          { x: PAD.x, y: y + 120 + qH + 44, w: 1500 },
          { color: soft, role: "author" },
        );
      foot();
      break;
    }
    case "next": {
      const used = head(PAD.x, PAD.y, PAD.w, 76, 1500);
      const leftW = ((PAD.w - 96) * 1.2) / 2.2;
      const rightW = PAD.w - 96 - leftW;
      const li = bodyType(36 * inner);
      const stepsH = s.steps.reduce(
        (sum, st) => sum + height(plain(st), li, leftW - 86, 1.35) + 26,
        -26,
      );
      const c1 = headType(50);
      const c2 = bodyType(30);
      const ctaInner = rightW - 104;
      const ctaH =
        52 +
        48 +
        (s.cta ? height(upper(plain(s.cta)), c1, ctaInner, 1.12) : 0) +
        (s.contact ? 22 + height(s.contact, c2, ctaInner, 1.42) : 0) +
        (s.action ? 30 + 20 * 1.42 : 0);
      const y = centred(PAD.y + used, Math.max(stepsH, ctaH));
      let yy = y + (Math.max(stepsH, ctaH) - stepsH) / 2;
      s.steps.forEach((st, k) => {
        text(
          pad2(k + 1),
          type(look.numbers, 700, 34),
          { x: PAD.x, y: yy + 2, w: 58 },
          { lh: 1.35, color: c.accent, role: "step-number" },
        );
        yy +=
          26 +
          text(st, li, { x: PAD.x + 86, y: yy, w: leftW - 86 }, { lh: 1.35, role: "next-step" });
      });
      const bx = PAD.x + leftW + 96;
      const by = y + (Math.max(stepsH, ctaH) - ctaH) / 2;
      const ctaFg = dark ? c.dark : theme.onPrimary;
      rect({ x: bx, y: by, w: rightW, h: ctaH }, dark ? theme.paper : c.primary, {
        radius: 16,
        role: "cta-box",
      });
      let cy = by + 52;
      if (s.cta)
        cy += text(
          upper(s.cta),
          c1,
          { x: bx + 52, y: cy, w: ctaInner },
          {
            lh: 1.12,
            color: ctaFg,
            accent: dark ? theme.accentText : theme.accentOnPrimary,
            role: "cta",
          },
        );
      if (s.contact)
        cy +=
          22 +
          text(
            s.contact,
            c2,
            { x: bx + 52, y: cy + 22, w: ctaInner },
            { color: ctaFg, role: "contact" },
          );
      if (s.action) {
        const goColor = dark ? theme.accentText : theme.accentOnPrimary;
        const goStyle = type(look.label, 800, 20, { spacing: 20 * 0.16, upper: true });
        const goW = Math.min(ctaInner - 40, textWidth(s.action.toUpperCase(), goStyle) + 8);
        text(
          s.action,
          goStyle,
          { x: bx + 52, y: cy + 30, w: goW },
          { color: goColor, role: "action" },
        );
        shapes.push({
          kind: "icon",
          icon: "arrow",
          role: "icon",
          x: bx + 52 + goW + 6,
          y: cy + 30 + 2,
          w: 26,
          h: 26,
          color: goColor,
        });
      }
      foot();
      break;
    }
    default:
      break;
  }

  const notes =
    String(s.notes ?? "").trim() ||
    [plain(s.title ?? s.quote ?? deck.title), plain(s.text ?? s.subtitle ?? "")]
      .filter(Boolean)
      .join("\n");
  return {
    background,
    notes,
    shapes: shapes.map((shape) => toInches(shape)),
  };
}

const toInches = (shape) => {
  const out = {
    ...shape,
    x: inch(shape.x),
    y: inch(shape.y),
    w: inch(shape.w),
    h: inch(shape.h ?? 0),
  };
  if (shape.size) out.size = pt(shape.size);
  if (shape.spacing) out.spacing = pt(shape.spacing);
  if (shape.lineWidth) out.lineWidth = pt(shape.lineWidth);
  if (shape.radius) out.radius = inch(shape.radius);
  if (shape.kind === "table") {
    out.colW = shape.colW.map(inch);
    out.rowH = shape.rowH.map(inch);
    out.h = inch(shape.rowH.reduce((a, b) => a + b, 0));
    out.rows = shape.rows.map((row) =>
      row.map((cell) => ({
        ...cell,
        size: pt(cell.size),
        spacing: pt(cell.spacing),
        pad: cell.pad.map(inch),
        bottom: { ...cell.bottom, width: pt(cell.bottom.width) },
      })),
    );
  }
  return out;
};

/** Pure: every slide of the deck. */
export function deckShapes(deck, theme, options = {}) {
  return deck.slides.map((_, i) =>
    slideShapes(deck, theme, i, { images: options.images, fit: options.fits?.[i] }),
  );
}

// Lucide's check and arrow-right, as freeform shapes (points in the icon's 24x24 box).
const ICON_PATHS = {
  check: [
    [
      [20, 6],
      [9, 17],
      [4, 12],
    ],
  ],
  arrow: [
    [
      [5, 12],
      [19, 12],
    ],
    [
      [12, 5],
      [19, 12],
      [12, 19],
    ],
  ],
};

/** Writes deck.pptx with pptxgenjs from ZEN_PPTXGENJS_MODULES. Returns the file path. */
export async function writePptx(deck, theme, { modules, file, images, fits }) {
  const require = NodeModule.createRequire(NodePath.join(modules, "noop.js"));
  const PptxGenJS = require("pptxgenjs");
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "ZEN_16x9", width: SLIDE_W / PX_PER_IN, height: SLIDE_H / PX_PER_IN });
  pres.layout = "ZEN_16x9";
  pres.title = deck.title ?? "";
  pres.author = deck.author ?? deck.brand?.name ?? "";
  pres.company = deck.brand?.name ?? "";
  pres.lang = deck.language === "en" ? "en-GB" : "ro-RO";
  const theme_ = theme.look;
  pres.theme = {
    headFontFace: fontFace(theme_.head, theme_.headWeight).face,
    bodyFontFace: fontFace(theme_.body, 400).face,
  };

  for (const spec of deckShapes(deck, theme, { images, fits })) {
    const slide = pres.addSlide();
    slide.background = { color: hex(spec.background) };
    for (const sh of spec.shapes) addShape(pres, slide, sh);
    slide.addNotes(spec.notes);
  }
  await pres.writeFile({ fileName: file, compression: true });
  return file;
}

function addShape(pres, slide, sh) {
  const box = { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
  switch (sh.kind) {
    case "rect":
      slide.addShape(sh.radius ? pres.ShapeType.roundRect : pres.ShapeType.rect, {
        ...box,
        fill: { color: hex(sh.fill) },
        line: sh.line ? { color: hex(sh.line), width: sh.lineWidth ?? 1 } : { type: "none" },
        ...(sh.radius ? { rectRadius: sh.radius } : {}),
        objectName: sh.role,
      });
      return;
    case "ellipse":
      slide.addShape(pres.ShapeType.ellipse, {
        ...box,
        fill: { color: hex(sh.fill) },
        line: { color: hex(sh.line), width: sh.lineWidth },
        objectName: sh.role,
      });
      return;
    case "icon": {
      const scale = sh.w / 24;
      for (const path of ICON_PATHS[sh.icon]) {
        const xs = path.map((p) => p[0]);
        const ys = path.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const w = Math.max(0.01, (Math.max(...xs) - minX) * scale);
        const h = Math.max(0.01, (Math.max(...ys) - minY) * scale);
        slide.addShape(pres.ShapeType.custGeom, {
          x: sh.x + minX * scale,
          y: sh.y + minY * scale,
          w,
          h,
          points: path.map(([px, py], i) => ({
            x: (px - minX) * scale,
            y: (py - minY) * scale,
            ...(i === 0 ? { moveTo: true } : {}),
          })),
          fill: { type: "none" },
          line: { color: hex(sh.color), width: Math.max(1.5, sh.w * 72 * 0.1), cap: "round" },
          objectName: sh.role,
        });
      }
      return;
    }
    case "image": {
      const img = sh.image;
      const options = { ...box, data: img.data, altText: sh.role, objectName: sh.role };
      if (sh.cover) {
        const ratio = img.width / img.height;
        options.w = sh.w;
        options.h = sh.w / ratio;
        if (options.h < sh.h) {
          options.h = sh.h;
          options.w = sh.h * ratio;
        }
        options.sizing = { type: "cover", w: sh.w, h: sh.h };
      }
      slide.addImage(options);
      return;
    }
    case "text":
      slide.addText(
        sh.runs.map((r) => ({ text: r.text, options: r.color ? { color: hex(r.color) } : {} })),
        {
          ...box,
          fontFace: sh.face,
          bold: sh.bold,
          fontSize: sh.size,
          color: hex(sh.color),
          align: sh.align,
          valign: sh.valign,
          margin: 0,
          lineSpacing: Math.round(sh.size * sh.lineHeight * 10) / 10,
          charSpacing: sh.spacing || undefined,
          fit: "shrink",
          wrap: true,
          objectName: sh.role,
        },
      );
      return;
    case "table":
      slide.addTable(
        sh.rows.map((row) =>
          row.map((cell) => ({
            text: cell.runs
              ? cell.runs.map((r) => ({
                  text: r.text,
                  options: r.color ? { color: hex(r.color) } : {},
                }))
              : cell.text,
            options: {
              fontFace: cell.face,
              bold: cell.bold,
              fontSize: cell.size,
              charSpacing: cell.spacing || undefined,
              color: hex(cell.color),
              align: cell.align,
              valign: "top",
              margin: cell.pad,
              border: [
                { type: "none" },
                { type: "none" },
                { type: "solid", color: hex(cell.bottom.color), pt: cell.bottom.width },
                { type: "none" },
              ],
            },
          })),
        ),
        {
          x: sh.x,
          y: sh.y,
          w: sh.w,
          colW: sh.colW,
          rowH: sh.rowH,
          autoPage: false,
          objectName: sh.role,
        },
      );
      return;
    case "chart":
      slide.addChart(
        pres.ChartType.bar,
        [{ name: sh.name || "Serie", labels: sh.labels, values: sh.values }],
        {
          ...box,
          barDir: "col",
          chartColors: [hex(sh.color)],
          barGapWidthPct: 60,
          showValue: true,
          dataLabelPosition: "outEnd",
          dataLabelColor: hex(sh.valueInk),
          dataLabelFontFace: sh.numberFace,
          dataLabelFontSize: 20,
          dataLabelFormatCode: "#,##0",
          catAxisLabelColor: hex(sh.ink),
          catAxisLabelFontFace: sh.face,
          catAxisLabelFontSize: 15,
          catAxisLineShow: true,
          catAxisLineColor: hex(sh.ink),
          valAxisHidden: true,
          valGridLine: { style: "none" },
          showLegend: false,
          showTitle: false,
          objectName: sh.role,
        },
      );
      return;
    default:
      return;
  }
}
