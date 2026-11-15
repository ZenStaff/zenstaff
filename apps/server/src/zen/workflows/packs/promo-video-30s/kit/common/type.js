// The type system. Fonts come from the open-fonts toolchain (SIL OFL 1.1, every file has full
// Romanian letters: ă â î ș ț). Each "look" is a tested pairing: a display face for headlines, a
// text face, a label style (small caps line) and an accent face for one word or a kicker.
// No Inter, no Archivo, no system defaults.

export const FONT_FILES = [
  ["ZenAnton", "Anton-Regular.ttf", "400", "normal"],
  ["ZenBarlow", "Barlow-Regular.ttf", "400", "normal"],
  ["ZenBarlow", "Barlow-SemiBold.ttf", "600", "normal"],
  ["ZenBarlow", "Barlow-ExtraBold.ttf", "800", "normal"],
  ["ZenBarlowCondensed", "BarlowCondensed-Bold.ttf", "700", "normal"],
  ["ZenBarlowCondensed", "BarlowCondensed-ExtraBold.ttf", "800", "normal"],
  ["ZenSourceSans", "SourceSans3.ttf", "200 900", "normal"],
  ["ZenPlayfair", "PlayfairDisplay.ttf", "400 900", "normal"],
  ["ZenCaveat", "Caveat.ttf", "400 700", "normal"],
  ["ZenFraunces", "Fraunces.ttf", "100 900", "normal"],
  ["ZenFraunces", "Fraunces-Italic.ttf", "100 900", "italic"],
  ["ZenInstrument", "InstrumentSerif-Regular.ttf", "400", "normal"],
  ["ZenInstrument", "InstrumentSerif-Italic.ttf", "400", "italic"],
  ["ZenBricolage", "BricolageGrotesque.ttf", "200 800", "normal"],
];

const SANS = '"DejaVu Sans", Arial, sans-serif';
const SERIF = "Georgia, serif";

/**
 * `charWidth` is the average glyph width in em of the display face (used to fit headlines),
 * `case` the headline case. `numbers` is the face for prices and big figures.
 */
export const LOOKS = {
  bold: {
    display: {
      fontFamily: `ZenAnton, ${SANS}`,
      fontWeight: 400,
      textTransform: "uppercase",
      lineHeight: 0.92,
      letterSpacing: "0.005em",
    },
    body: { fontFamily: `ZenBarlow, ${SANS}`, fontWeight: 600, lineHeight: 1.22 },
    label: {
      fontFamily: `ZenBarlow, ${SANS}`,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.16em",
    },
    accent: { fontFamily: `ZenAnton, ${SANS}`, fontWeight: 400, textTransform: "uppercase" },
    numbers: { fontFamily: `ZenAnton, ${SANS}`, fontWeight: 400 },
    charWidth: 0.47,
  },
  elegant: {
    display: {
      fontFamily: `ZenInstrument, ${SERIF}`,
      fontWeight: 400,
      lineHeight: 0.98,
      letterSpacing: "-0.015em",
    },
    body: { fontFamily: `ZenSourceSans, ${SANS}`, fontWeight: 400, lineHeight: 1.38 },
    label: {
      fontFamily: `ZenSourceSans, ${SANS}`,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.3em",
    },
    accent: { fontFamily: `ZenInstrument, ${SERIF}`, fontWeight: 400, fontStyle: "italic" },
    numbers: { fontFamily: `ZenInstrument, ${SERIF}`, fontWeight: 400 },
    charWidth: 0.43,
  },
  warm: {
    display: {
      fontFamily: `ZenFraunces, ${SERIF}`,
      fontWeight: 650,
      lineHeight: 0.98,
      letterSpacing: "-0.02em",
      fontVariationSettings: '"SOFT" 100, "WONK" 0, "opsz" 144',
    },
    body: { fontFamily: `ZenSourceSans, ${SANS}`, fontWeight: 500, lineHeight: 1.32 },
    label: {
      fontFamily: `ZenSourceSans, ${SANS}`,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.2em",
    },
    accent: {
      fontFamily: `ZenFraunces, ${SERIF}`,
      fontWeight: 500,
      fontStyle: "italic",
      fontVariationSettings: '"SOFT" 100, "WONK" 1, "opsz" 144',
    },
    numbers: {
      fontFamily: `ZenFraunces, ${SERIF}`,
      fontWeight: 700,
      fontVariationSettings: '"SOFT" 100, "opsz" 144',
    },
    charWidth: 0.53,
  },
  playful: {
    display: {
      fontFamily: `ZenBricolage, ${SANS}`,
      fontWeight: 800,
      lineHeight: 0.95,
      letterSpacing: "-0.035em",
      fontVariationSettings: '"wdth" 80, "opsz" 96',
    },
    body: { fontFamily: `ZenBricolage, ${SANS}`, fontWeight: 500, lineHeight: 1.25 },
    label: { fontFamily: `ZenCaveat, cursive`, fontWeight: 700, letterSpacing: "0.01em" },
    accent: { fontFamily: `ZenCaveat, cursive`, fontWeight: 700 },
    numbers: {
      fontFamily: `ZenBricolage, ${SANS}`,
      fontWeight: 800,
      fontVariationSettings: '"wdth" 75',
    },
    charWidth: 0.5,
  },
  /** Print and documents: editorial serif headlines with a clean humanist text face. */
  editorial: {
    display: {
      fontFamily: `ZenFraunces, ${SERIF}`,
      fontWeight: 560,
      lineHeight: 1.0,
      letterSpacing: "-0.02em",
      fontVariationSettings: '"SOFT" 50, "WONK" 0, "opsz" 144',
    },
    body: { fontFamily: `ZenSourceSans, ${SANS}`, fontWeight: 400, lineHeight: 1.45 },
    label: {
      fontFamily: `ZenSourceSans, ${SANS}`,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.18em",
    },
    accent: {
      fontFamily: `ZenFraunces, ${SERIF}`,
      fontWeight: 400,
      fontStyle: "italic",
      fontVariationSettings: '"SOFT" 100, "opsz" 144',
    },
    numbers: { fontFamily: `ZenFraunces, ${SERIF}`, fontWeight: 600 },
    charWidth: 0.5,
  },
  /** Product, tech and services: a confident grotesque. */
  modern: {
    display: {
      fontFamily: `ZenBricolage, ${SANS}`,
      fontWeight: 700,
      lineHeight: 0.98,
      letterSpacing: "-0.03em",
      fontVariationSettings: '"wdth" 90, "opsz" 96',
    },
    body: { fontFamily: `ZenSourceSans, ${SANS}`, fontWeight: 400, lineHeight: 1.42 },
    label: {
      fontFamily: `ZenBarlow, ${SANS}`,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.16em",
    },
    accent: { fontFamily: `ZenInstrument, ${SERIF}`, fontWeight: 400, fontStyle: "italic" },
    numbers: { fontFamily: `ZenBricolage, ${SANS}`, fontWeight: 700 },
    charWidth: 0.5,
  },
};

export const LOOK_NAMES = Object.keys(LOOKS);

/** CSS declarations from a style object (for the HTML print builders). */
export function css(style) {
  return Object.entries(style)
    .filter(([key]) => key !== "charWidth")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(";");
}

/** @font-face rules for HTML pages; `urlFor(file)` gives each font's URL. */
export function fontFaceCss(urlFor) {
  return FONT_FILES.map(
    ([family, file, weight, style]) =>
      `@font-face{font-family:${family};src:url("${urlFor(file)}");font-weight:${weight};font-style:${style};font-display:block}`,
  ).join("\n");
}

/**
 * A font size that fits `text` in a box: limited by the longest word (no word ever breaks) and by
 * the area the whole text needs at that size.
 */
export function fitSize(
  text,
  { base, maxWidth, maxHeight, charWidth = 0.5, lineHeight = 1.0, min = 24 },
) {
  const value = String(text ?? "");
  if (!value) return base;
  const longest = Math.max(...value.split(/\s+/).map((word) => word.length), 1);
  const byWord = maxWidth / (longest * charWidth * 1.04);
  const byArea = Math.sqrt((maxWidth * maxHeight) / (value.length * charWidth * lineHeight * 1.3));
  return Math.max(min, Math.floor(Math.min(base, byWord, byArea)));
}

/**
 * Splits a headline into lines of whole words: the fewest lines that fit `maxChars`, then the most
 * even split (no one-word last line when it can be avoided).
 */
export function balanceLines(text, maxChars) {
  const words = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 1) return [words.join(" ")];
  let best = null;
  const total = words.length;
  const search = (start, lines) => {
    if (lines.length > 5) return;
    if (start === total) {
      const lengths = lines.map((line) => line.length);
      const longest = Math.max(...lengths);
      const shortest = Math.min(...lengths);
      const tiny = lines.filter((l) => !l.includes(" ") && l.length <= 3).length;
      const orphan =
        (lines.length > 1 && lines.at(-1).split(" ").length === 1 && total > 3 ? 4 : 0) +
        (total > 2 ? tiny * 40 : 0);
      const over = Math.max(0, longest - maxChars) * 50;
      const score = lines.length * 100 + over + (longest - shortest) + orphan;
      if (!best || score < best.score) best = { score, lines: [...lines] };
      return;
    }
    let line = "";
    for (let end = start; end < total; end++) {
      line = line ? `${line} ${words[end]}` : words[end];
      if (line.length > maxChars && end > start) break;
      search(end + 1, [...lines, line]);
    }
  };
  search(0, []);
  return best ? best.lines : [words.join(" ")];
}
