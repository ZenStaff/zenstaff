// Frame geometry without Remotion imports, so Node scripts and unit tests share it with the
// templates: safe zones, where the "Voce generată cu AI" label goes so it never covers text, and
// how big spoken captions can be while two lines still fit.

/**
 * Where text and important pixels may sit. Reels/TikTok/Shorts cover the top (account, sound),
 * the bottom (caption, buttons) and a column on the right (like, comment, share); feed formats
 * and landscape video only need a title-safe margin.
 */
export function safeZone(width, height) {
  const ratio = height / width;
  if (ratio > 1.6) {
    const unit = width / 1080;
    return {
      kind: "vertical",
      top: Math.round(250 * unit),
      bottom: Math.round(430 * unit),
      left: Math.round(96 * unit),
      right: Math.round(176 * unit),
      width,
      height,
      unit,
    };
  }
  if (ratio > 1.1) {
    const unit = width / 1080;
    return {
      kind: "portrait",
      top: 96 * unit,
      bottom: 110 * unit,
      left: 80 * unit,
      right: 80 * unit,
      width,
      height,
      unit,
    };
  }
  if (ratio > 0.9) {
    const unit = width / 1080;
    return {
      kind: "square",
      top: 80 * unit,
      bottom: 90 * unit,
      left: 80 * unit,
      right: 80 * unit,
      width,
      height,
      unit,
    };
  }
  const unit = width / 1920;
  return {
    kind: "landscape",
    top: Math.round(96 * unit),
    bottom: Math.round(96 * unit),
    left: Math.round(130 * unit),
    right: Math.round(130 * unit),
    width,
    height,
    unit,
  };
}

/** A box in pixels. */
export const box = (x, y, w, h) => ({ x, y, w, h });

/** True when two boxes share any area (or come closer than `gap` px). */
export function overlaps(a, b, gap = 0) {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

/** True when `a` lies fully inside the frame. */
export const insideFrame = (a, width, height) =>
  a.x >= 0 && a.y >= 0 && a.x + a.w <= width && a.y + a.h <= height;

/**
 * The AI-voice pill, in kit units (1 unit = 1 px at 1080 wide, or at 1920 wide for landscape).
 * `charEm` is an upper bound of the average glyph width (Source Sans 3 SemiBold is about 0.5), so
 * the computed box is never smaller than the rendered pill.
 */
export const AI_LABEL = {
  fontSize: 22,
  padX: 16,
  padY: 8,
  lineHeight: 1.2,
  border: 1,
  charEm: 0.6,
};

/** Width and height in px of the pill for `text`. */
export function aiLabelSize(text, unit = 1) {
  const fs = AI_LABEL.fontSize * unit;
  return {
    w: Math.ceil(
      String(text ?? "").length * AI_LABEL.charEm * fs +
        2 * (AI_LABEL.padX * unit + AI_LABEL.border),
    ),
    h: Math.ceil(fs * AI_LABEL.lineHeight + 2 * (AI_LABEL.padY * unit + AI_LABEL.border)),
  };
}

/**
 * The AI-voice label's box: the first candidate corner inside the frame and clear of every `avoid`
 * box (text, captions), preferring one clear of `soft` boxes (pictures). 9:16: the band just above
 * the safe zone; other formats: the top or bottom margin. `ok` is false when nothing is clear.
 */
export function aiLabelBox({ width, height, text, avoid = [], soft = [], gap = 10 }) {
  const safe = safeZone(width, height);
  const u = safe.unit;
  const { w, h } = aiLabelSize(text, u);
  const air = gap * u;
  const left = safe.left;
  const right = width - safe.right - w;
  const candidates = [];
  if (safe.kind === "vertical") {
    // Just above the safe zone; pictures may rise 20 units into the margin, so stay above that.
    const y = Math.round(safe.top - 20 * u - air - h);
    candidates.push(["top-left", left, y], ["top-right", right, y]);
  } else {
    const top = Math.round(Math.max(4 * u, (safe.top - h) / 2));
    const bottom = Math.round(height - Math.max(4 * u, (safe.bottom - h) / 2) - h);
    if (safe.kind === "landscape")
      candidates.push(["bottom-left", left, bottom], ["bottom-right", right, bottom]);
    candidates.push(["top-left", left, top], ["top-right", right, top]);
    if (safe.kind !== "landscape")
      candidates.push(["bottom-left", left, bottom], ["bottom-right", right, bottom]);
  }
  const placed = candidates.map(([corner, x, y]) => ({ corner, ...box(Math.round(x), y, w, h) }));
  const clear = (b, list) => list.every((other) => !overlaps(b, other, air));
  const fits = placed.filter((b) => insideFrame(b, width, height) && clear(b, avoid));
  const best = fits.find((b) => clear(b, soft)) ?? fits[0];
  return best ? { ...best, ok: true } : { ...placed[0], ok: false };
}

/**
 * Spoken captions in Barlow SemiBold, whose ș ț Ș Ț carry a clear comma below (Source Sans 3
 * draws them like a cedilla). `charEm` is an upper bound of the average glyph width (Romanian
 * text in capitals is about 0.53), `wordEm` the extra width per word of the highlight pill.
 */
export const CAPTION_FONT = {
  family: "ZenBarlow",
  weight: 600,
  lineHeight: 1.16,
  charEm: 0.56,
  wordEm: 0.2,
  padYEm: 0.22,
  padXEm: 0.42,
};

/**
 * Size, line length and position of spoken captions (at most `lines` lines of `maxChars`).
 * `band` {top, bottom} in px, when given, is the free strip the captions are centred in (the
 * tutorial's strip under the window).
 */
export function captionLayout(width, height, { band, lines = 2 } = {}) {
  const safe = safeZone(width, height);
  const u = safe.unit;
  const vertical = safe.kind === "vertical";
  const size = Math.round((vertical ? 60 : safe.kind === "landscape" ? 48 : 52) * u);
  const maxChars = vertical ? 20 : safe.kind === "landscape" ? 34 : 26;
  const padY = Math.round(size * CAPTION_FONT.padYEm);
  const padX = Math.round(size * CAPTION_FONT.padXEm);
  const boxHeight = Math.ceil(lines * size * CAPTION_FONT.lineHeight + 2 * padY);
  const left = safe.left;
  const right = vertical ? safe.right : safe.left;
  let bottom = vertical ? safe.bottom + 40 * u : 36 * u;
  if (band) bottom = height - band.bottom + Math.max(0, (band.bottom - band.top - boxHeight) / 2);
  return {
    size,
    maxChars,
    lines,
    padX,
    padY,
    lineHeight: CAPTION_FONT.lineHeight,
    left,
    right,
    bottom: Math.round(bottom),
    boxHeight,
    maxWidth: width - left - right,
  };
}

/** Width in px of a caption line of `chars` characters and `words` words (upper bound). */
export const captionLineWidth = (chars, words, size) =>
  size * (chars * CAPTION_FONT.charEm + words * CAPTION_FONT.wordEm);

/** The caption box of a layout in its widest case (full lines), for overlap checks. */
export function captionBox(layout, width, height) {
  const words = Math.ceil(layout.maxChars / 4) + 1;
  const w = Math.ceil(captionLineWidth(layout.maxChars, words, layout.size) + 2 * layout.padX);
  return box(
    Math.round((width - w) / 2),
    height - layout.bottom - layout.boxHeight,
    w,
    layout.boxHeight,
  );
}
