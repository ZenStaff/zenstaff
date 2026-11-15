// Spoken-word captions: short phrases (max two lines), the word being said highlighted, inside
// the safe zone, on a soft box so they read over any picture. Timings come from the voice
// (word start/end in seconds); without them, a phrase is spread evenly over its time.
import { useCurrentFrame, useVideoConfig } from "remotion";
import { alpha } from "../common/color.js";
import { LOOKS } from "../common/type.js";
import { EASE, progress, safeZone } from "./core.js";
import { AI_LABEL, CAPTION_FONT, aiLabelSize, captionLayout } from "./placement.js";

/** Groups words into caption phrases of at most `maxChars` per line and `lines` lines. */
export function phrases(words, { maxChars = 28, lines = 2 } = {}) {
  const out = [];
  let current = [];
  let lineLength = 0;
  let lineCount = 1;
  const flush = () => {
    if (current.length) out.push(current);
    current = [];
    lineLength = 0;
    lineCount = 1;
  };
  for (const word of words) {
    const len = word.w.length + (lineLength ? 1 : 0);
    if (lineLength + len > maxChars) {
      if (lineCount >= lines) flush();
      else {
        lineCount += 1;
        lineLength = 0;
      }
    }
    current.push(word);
    lineLength += word.w.length + (lineLength ? 1 : 0);
    // A sentence end closes the phrase.
    if (/[.!?]$/.test(word.w)) flush();
  }
  flush();
  return out;
}

/** Even word timings for a sentence said between `start` and `end` seconds. */
export function evenWords(text, start, end) {
  const list = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const weight = list.map((w) => w.length + 2);
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let t = start;
  return list.map((w, i) => {
    const d = ((end - start) * weight[i]) / total;
    const word = { w, s: t, e: t + d };
    t += d;
    return word;
  });
}

/** Splits a phrase into lines of at most `maxChars` characters (whole words). */
export function captionLines(words, maxChars) {
  const lines = [];
  let line = [];
  let length = 0;
  for (const word of words) {
    const add = word.w.length + (line.length ? 1 : 0);
    if (line.length && length + add > maxChars) {
      lines.push(line);
      line = [];
      length = 0;
    }
    line.push(word);
    length += word.w.length + (line.length > 1 ? 1 : 0);
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * words: [{w, s, e}] in seconds from the start of the composition. band: optional {top, bottom}
 * in px, the free strip to centre the captions in. Size and line length come from
 * captionLayout() (placement.js), so two lines always fit; the face is Barlow SemiBold, whose
 * ș ț Ș Ț have a real comma below.
 */
export function Captions({ words, palette, offset = 0, band }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = captionLayout(width, height, { band });
  const t = frame / fps + offset;
  const groups = phrases(words, { maxChars: layout.maxChars, lines: layout.lines });
  const group = groups.find((g) => t >= g[0].s - 0.05 && t <= g.at(-1).e + 0.25);
  if (!group) return null;
  const size = layout.size;
  const enter = progress(
    frame,
    Math.round((group[0].s - offset) * fps) - 2,
    Math.round((group[0].s - offset) * fps) + 5,
    EASE.out,
  );
  return (
    <div
      style={{
        position: "absolute",
        left: layout.left,
        right: layout.right,
        bottom: layout.bottom,
        display: "flex",
        justifyContent: "center",
        transform: `translateY(${(1 - enter) * 16}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          padding: `${layout.padY}px ${layout.padX}px`,
          borderRadius: size * 0.36,
          background: alpha(palette.ink, 0.74),
          backdropFilter: "blur(6px)",
          textAlign: "center",
          fontFamily: `${CAPTION_FONT.family}, "DejaVu Sans", Arial, sans-serif`,
          fontWeight: CAPTION_FONT.weight,
          fontSize: size,
          lineHeight: layout.lineHeight,
          color: palette.paper,
        }}
      >
        {captionLines(group, layout.maxChars).map((line) => (
          <div key={`${line[0].s}:${line[0].w}`} style={{ whiteSpace: "nowrap" }}>
            {line.map((word) => {
              const active = t >= word.s && t < word.e + 0.08;
              const said = t >= word.e;
              return (
                <span
                  key={`${word.s}:${word.w}`}
                  style={{
                    display: "inline-block",
                    margin: "0 0.06em",
                    padding: "0 0.08em",
                    borderRadius: "0.14em",
                    background: active ? palette.accent : "transparent",
                    color: active
                      ? palette.onAccent
                      : said
                        ? palette.paper
                        : alpha(palette.paper, 0.8),
                  }}
                >
                  {word.w}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The AI-voice notice ("Voce generată cu AI" / "AI-generated voice"), visible for the whole video
 * inside the safe zone, as the EU AI Act (art. 50) asks for synthetic voices.
 */
export function AiVoicePill({ text, palette, corner = "top-left", box }) {
  const { width, height } = useVideoConfig();
  if (!text) return null;
  const safe = safeZone(width, height);
  const u = safe.unit;
  const top = corner.startsWith("top");
  const left = corner.endsWith("left");
  // With `box` (from aiLabelBox in placement.js) the pill sits exactly there, at a fixed height.
  const position = box
    ? { left: box.x, top: box.y, height: aiLabelSize(text, u).h, boxSizing: "border-box" }
    : {
        [top ? "top" : "bottom"]: top
          ? safe.kind === "vertical"
            ? safe.top - 64 * u
            : 28 * u
          : safe.kind === "vertical"
            ? safe.bottom + 16 * u
            : 28 * u,
        [left ? "left" : "right"]: left ? safe.left : safe.right,
      };
  return (
    <div
      style={{
        position: "absolute",
        ...position,
        padding: `${AI_LABEL.padY * u}px ${AI_LABEL.padX * u}px`,
        borderRadius: 999,
        background: alpha(palette.ink, 0.62),
        border: `${AI_LABEL.border}px solid ${alpha(palette.paper, 0.22)}`,
        ...LOOKS.modern.body,
        fontWeight: 600,
        fontSize: AI_LABEL.fontSize * u,
        lineHeight: AI_LABEL.lineHeight,
        whiteSpace: "nowrap",
        color: palette.paper,
        zIndex: 60,
      }}
    >
      {text}
    </div>
  );
}
