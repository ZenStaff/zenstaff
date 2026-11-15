// Headline fitting with real glyph widths (canvas measureText on the loaded fonts): the biggest
// size at which the words break into balanced lines inside the box. Character-count estimates
// leave condensed and serif faces far too small; this fills the space the layout gives.

let context = null;
const cache = new Map();

function ctx() {
  if (context) return context;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(8, 8)
      : document.createElement("canvas");
  context = canvas.getContext("2d");
  return context;
}

const firstFamily = (family) => String(family).split(",")[0].trim();

/** Width in px of `text` at 100 px in the given display style. */
function width100(text, style) {
  const upper = style.textTransform === "uppercase";
  const value = upper ? text.toLocaleUpperCase("ro-RO") : text;
  const key = `${style.fontFamily}|${style.fontWeight}|${style.fontStyle ?? ""}|${value}`;
  if (cache.has(key)) return cache.get(key);
  const c = ctx();
  c.font = `${style.fontStyle ?? "normal"} ${style.fontWeight ?? 400} 100px ${firstFamily(style.fontFamily)}`;
  let w = c.measureText(value).width;
  const spacing = Number.parseFloat(style.letterSpacing ?? "0");
  if (Number.isFinite(spacing)) w += spacing * 100 * value.length;
  cache.set(key, w);
  return w;
}

/** Best split of words into at most `maxLines` lines whose widths stay under `limit` (at 100 px). */
function split(words, widths, space, limit, maxLines) {
  const n = words.length;
  let best = null;
  const walk = (start, lines) => {
    if (lines.length > maxLines) return;
    if (start === n) {
      const ws = lines.map((l) => l.w);
      const longest = Math.max(...ws);
      const shortest = Math.min(...ws);
      const tiny = lines.filter((l) => l.words.length === 1 && l.words[0].length <= 3).length;
      const orphan =
        (lines.length > 1 && lines.at(-1).words.length === 1 && n > 3 ? 0.15 * limit : 0) +
        (n > 2 ? tiny * 0.4 * limit : 0);
      const score = lines.length * 10 * limit + (longest - shortest) + orphan;
      if (!best || score < best.score)
        best = { score, lines: lines.map((l) => l.words.join(" ")), longest };
      return;
    }
    let w = 0;
    for (let end = start; end < n; end++) {
      w += widths[end] + (end > start ? space : 0);
      if (w > limit && end > start) break;
      walk(end + 1, [...lines, { words: words.slice(start, end + 1), w }]);
    }
  };
  walk(0, []);
  return best;
}

/**
 * { size, lines } for a headline in `style` inside box {width, height, base}; null when the fonts
 * cannot be measured (the caller falls back to the estimate).
 */
export function fitHeadline(text, style, box, { maxLines = 4 } = {}) {
  try {
    const words = String(text ?? "")
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return null;
    const widths = words.map((w) => width100(w, style));
    const space = width100("a a", style) - width100("aa", style) || 26;
    const lineHeight = Number(style.lineHeight ?? 1);
    for (let size = Math.round(box.base); size >= 24; size = Math.floor(size * 0.96)) {
      const limit = (box.width / size) * 100 * 0.985;
      const result = split(words, widths, space, limit, maxLines);
      if (!result) continue;
      const height = result.lines.length * size * lineHeight * 1.04;
      if (height <= box.height && Math.max(...widths) <= limit)
        return { size, lines: result.lines };
    }
    return null;
  } catch {
    return null;
  }
}
