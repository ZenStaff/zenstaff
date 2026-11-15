// Brand color math shared by the video templates (browser) and the print builders (Node).
// Plain functions, no dependencies. Every text color the kit picks goes through `readable`, so a
// customer's palette can never produce unreadable text.

const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function hexToRgb(hex) {
  const value = String(hex ?? "").replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** WCAG relative luminance (0 black .. 1 white). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1 .. 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `a` toward `b` by `amount` (0 = a, 1 = b). */
export function mix(a, b, amount) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const t = clamp01(amount);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}

export const tint = (hex, amount) => mix(hex, "#FFFFFF", amount);
export const shade = (hex, amount) => mix(hex, "#000000", amount);

/** `rgba()` string for a hex color. */
export function alpha(hex, opacity) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp01(opacity)})`;
}

export function rgbToHsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s, l];
}

/**
 * The first candidate that reaches `min` contrast on `background`; if none does, the candidate
 * pushed toward black or white until it does. Large display text needs 3, body text 4.5.
 */
export function readable(background, candidates = ["#FFFFFF", "#111111"], min = 4.5) {
  for (const candidate of candidates) if (contrast(candidate, background) >= min) return candidate;
  // None is enough: push the closest candidate toward white or black, whichever gets there first
  // (or gets furthest, for a mid grey where neither quite reaches `min`).
  let best = null;
  for (const target of ["#FFFFFF", "#000000"]) {
    const start =
      [...candidates].sort((a, b) => contrast(b, target) - contrast(a, target))[0] ?? target;
    for (let step = 1; step <= 20; step++) {
      const pushed = mix(start, target, step / 20);
      const c = contrast(pushed, background);
      if (c >= min) return pushed;
      if (!best || c > best.c) best = { color: pushed, c };
    }
  }
  return best.color;
}

/**
 * A full working palette from the one to three colors a customer gives. `primary` is the deep
 * brand color (backgrounds), `accent` the highlight, `ink` and `paper` the text and page colors
 * (never pure black or white: a warm near-black and an off-white tinted with the primary).
 */
export function palette({ primary = "#0F4C5C", accent = "#F2C14E", dark, light } = {}) {
  const paper = light ?? mix("#FBF8F2", primary, 0.04);
  const ink = dark ?? mix("#17181A", primary, 0.12);
  // An accent too close to the primary gets no attention: push it lighter or darker.
  let hot = accent;
  if (contrast(hot, primary) < 2.2)
    hot = luminance(primary) < 0.3 ? tint(hot, 0.45) : shade(hot, 0.45);
  return {
    primary,
    accent: hot,
    ink,
    paper,
    primaryDeep: shade(primary, 0.35),
    primarySoft: tint(primary, 0.86),
    accentSoft: tint(hot, 0.75),
    onPrimary: readable(primary, [paper, ink], 4.5),
    onAccent: readable(hot, [ink, paper], 4.5),
    onPaper: readable(paper, [ink], 7),
    line: mix(paper, ink, 0.14),
    muted: mix(ink, paper, 0.42),
  };
}

/** Approximate CMYK (0-100) for a print spec table. Real separations come from the printer's ICC. */
export function cmyk(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);
  return [c, m, y, k].map((v) => Math.round(v * 100));
}
