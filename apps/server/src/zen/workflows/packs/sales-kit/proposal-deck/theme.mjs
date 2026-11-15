// The deck's colors and type, shared by deck.mjs (HTML, PDF, PNG) and pptx.mjs (PowerPoint),
// so both outputs use the same palette with the same contrast fixes. No dependencies.

export const LAYOUTS = [
  "cover",
  "statement",
  "points",
  "split",
  "numbers",
  "timeline",
  "pricing",
  "table",
  "quote",
  "next",
];
export const HEX = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_COLORS = {
  primary: "#1F3A4D",
  accent: "#C8843A",
  light: "#F6F3EE",
  dark: "#1C1F22",
};

const MODERN = {
  head: "Barlow",
  headWeight: 600,
  strong: 800,
  body: "Source Sans 3",
  label: "Barlow",
  numbers: "Barlow Condensed",
  headCase: "none",
  tracking: "-0.015em",
};
export const LOOKS = {
  modern: MODERN,
  elegant: {
    head: "Playfair Display",
    headWeight: 500,
    strong: 700,
    body: "Source Sans 3",
    label: "Source Sans 3",
    numbers: "Playfair Display",
    headCase: "none",
    tracking: "-0.01em",
  },
  strong: {
    head: "Barlow Condensed",
    headWeight: 700,
    strong: 800,
    body: "Barlow",
    label: "Barlow",
    numbers: "Barlow Condensed",
    headCase: "uppercase",
    tracking: "0.005em",
  },
};

export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
export const mix = (a, b, t) =>
  `#${rgb(a)
    .map((v, i) =>
      Math.round(v + (rgb(b)[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();

/** Every color the layouts use, from deck.brand.colors (or the calm default palette). */
export function deckTheme(deck) {
  const brand = deck.brand ?? {};
  const colors = { ...DEFAULT_COLORS, ...brand.colors };
  const valid = Object.values(colors).every((v) => HEX.test(v));
  const onColor = (bg) => (contrast(bg, "#FFFFFF") >= 4.5 ? "#FFFFFF" : colors.dark);
  const theme = { colors, valid, onColor };
  if (!valid) return theme;
  // The accent as text must read on the light background; otherwise it is darkened.
  let accentText = colors.accent;
  for (let t = 0.15; contrast(accentText, colors.light) < 3 && t <= 0.9; t += 0.15)
    accentText = mix(colors.accent, colors.dark, t);
  const paper = colors.light;
  const onPrimary = onColor(colors.primary);
  const accentOnPrimary = contrast(colors.accent, colors.primary) >= 3 ? colors.accent : onPrimary;
  return {
    ...theme,
    accentText,
    paper,
    muted: mix(colors.dark, paper, 0.38),
    rule: mix(colors.dark, paper, 0.84),
    onPrimary,
    onPrimaryMuted: mix(onPrimary, colors.primary, 0.3),
    accentOnPrimary,
    onAccent: onColor(colors.accent),
    card: mix(paper, "#FFFFFF", 0.55),
    statValue:
      colors.primary === paper
        ? colors.dark
        : contrast(colors.primary, paper) >= 3
          ? colors.primary
          : colors.dark,
    look: LOOKS[brand.fonts] ?? MODERN,
  };
}

/** The form "Look" names the deck's fonts; a family plus weight becomes a font name PowerPoint knows. */
export function fontFace(family, weight) {
  if (family === "Barlow")
    return weight >= 800
      ? { face: "Barlow ExtraBold", bold: false }
      : weight >= 600
        ? { face: "Barlow SemiBold", bold: false }
        : { face: "Barlow", bold: false };
  if (family === "Barlow Condensed")
    return weight >= 800
      ? { face: "Barlow Condensed ExtraBold", bold: false }
      : { face: "Barlow Condensed", bold: true };
  if (family === "Source Sans 3") return { face: "Source Sans 3", bold: weight >= 600 };
  return { face: family, bold: weight >= 700 };
}

export const pad2 = (n) => String(n).padStart(2, "0");
export const labels = (lang) =>
  lang === "en"
    ? { for: "for", recommended: "Recommended" }
    : { for: "pentru", recommended: "Recomandat" };
