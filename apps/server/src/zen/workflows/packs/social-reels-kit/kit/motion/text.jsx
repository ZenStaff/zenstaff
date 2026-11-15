// Kinetic typography, one component with four presets matching the looks: slam (bold: words punch
// in with motion blur, the key word on a color block), rise (elegant: lines revealed from a mask),
// lift (warm: soft spring, italic accent word), pop (playful: one small bounce).
import { useEffect, useState } from "react";
import {
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { LOOKS, balanceLines, fitSize } from "../common/type.js";
import { fitHeadline } from "./measure.js";
import { EASE, SPRING, clamp, progress, springAt } from "./core.js";

const PRESET_FOR_LOOK = {
  bold: "slam",
  elegant: "rise",
  warm: "lift",
  playful: "pop",
  modern: "lift",
  editorial: "rise",
};

/** True once every font face is loaded; holds the frame until the headline is laid out again. */
function useFontsReady() {
  const initial = typeof document !== "undefined" && document.fonts?.status === "loaded";
  const [ready, setReady] = useState(initial);
  useEffect(() => {
    if (ready || typeof document === "undefined") return undefined;
    const handle = delayRender("Measuring the headline");
    let live = true;
    document.fonts.ready.then(() => {
      if (live) setReady(true);
      continueRender(handle);
    });
    return () => {
      live = false;
      continueRender(handle);
    };
  }, [ready]);
  return ready;
}

/**
 * A headline that animates in. `accent` is the index of the word to highlight (default: the last
 * word for bold/warm/playful, none for elegant). Sizes itself to `box` {width, height, base}.
 */
export function Kinetic({
  text,
  look = "bold",
  color = "#FFFFFF",
  accentColor = "#F2C14E",
  onAccent = "#111111",
  box,
  delay = 0,
  step,
  align = "left",
  accent,
  preset,
  shadow = true,
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ready = useFontsReady();
  if (!text) return null;
  const L = LOOKS[look] ?? LOOKS.bold;
  const kind = preset ?? PRESET_FOR_LOOK[look] ?? "lift";
  // Real glyph widths once the fonts are in; the character estimate before that.
  const measured = ready ? fitHeadline(text, L.display, box) : null;
  const size =
    measured?.size ??
    fitSize(text, {
      base: box.base,
      maxWidth: box.width,
      maxHeight: box.height,
      charWidth: L.charWidth,
      lineHeight: L.display.lineHeight,
    });
  const lines =
    measured?.lines ??
    balanceLines(text, Math.max(6, Math.floor(box.width / (size * L.charWidth))));
  // Every word with its position in the whole headline (for the stagger and the accent).
  const rows = [];
  let count = 0;
  for (const [li, line] of lines.entries()) {
    const row = line.split(" ").map((w) => ({ w, i: count++, id: `${li}:${count}:${w}` }));
    rows.push({ line, li, row });
  }
  const words = rows.flatMap((r) => r.row);
  const accentIndex =
    accent === null
      ? -1
      : (accent ?? (look === "elegant" || look === "editorial" ? -1 : words.length - 1));
  const gap = step ?? (kind === "rise" ? 5 : kind === "slam" ? 3 : 4);
  const textShadow = shadow ? "0 2px 24px rgba(0,0,0,0.28)" : undefined;
  return (
    <div
      style={{
        ...L.display,
        fontSize: size,
        color,
        textAlign: align,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        textShadow,
      }}
    >
      {rows.map(({ line, li, row }) => {
        const lineDelay = delay + li * gap * 2;
        const lineP = progress(frame, lineDelay, lineDelay + 20, EASE.out);
        return (
          <div
            key={`${li}:${line}`}
            style={{
              overflow: kind === "rise" ? "hidden" : "visible",
              paddingBottom: kind === "rise" ? "0.06em" : 0,
              display: "flex",
              flexWrap: "nowrap",
              columnGap: "0.24em",
              letterSpacing:
                kind === "rise"
                  ? `${interpolate(lineP, [0, 1], [0.06, -0.015])}em`
                  : L.display.letterSpacing,
            }}
          >
            {row.map(({ w: word, i, id }) => {
              const at = kind === "rise" ? lineDelay : delay + i * gap;
              const isAccent = i === accentIndex;
              let transform = "none";
              let opacity = 1;
              let filter;
              if (kind === "slam") {
                const p = progress(frame, at, at + 7, EASE.out);
                transform = `scale(${interpolate(p, [0, 1], [1.7, 1])}) translateY(${(1 - p) * -0.08}em)`;
                opacity = interpolate(frame - at, [0, 2], [0, 1], clamp);
                const b = (1 - p) * 14;
                filter = b > 0.3 ? `blur(${b}px)` : undefined;
              } else if (kind === "rise") {
                transform = `translateY(${(1 - lineP) * 105}%)`;
              } else if (kind === "lift") {
                const s = springAt(frame, fps, at, SPRING.soft);
                // A short rise that stays inside its own line (never crosses the text below).
                transform = `translateY(${(1 - s) * 0.22}em)`;
                opacity = interpolate(s, [0, 0.35], [0, 1], clamp);
              } else {
                const s = springAt(frame, fps, at, SPRING.bouncy);
                transform = `translateY(${(1 - s) * 0.4}em) scale(${0.6 + 0.4 * s}) rotate(${(1 - s) * (i % 2 ? 6 : -6)}deg)`;
                opacity = interpolate(s, [0, 0.25], [0, 1], clamp);
              }
              const block = isAccent && (kind === "slam" || kind === "pop");
              const blockP = progress(frame, at + 4, at + 12, EASE.out);
              return (
                <span
                  key={id}
                  style={{
                    position: "relative",
                    display: "inline-block",
                    transform,
                    opacity,
                    filter,
                    transformOrigin: "50% 60%",
                    color: isAccent ? (block ? onAccent : accentColor) : undefined,
                    ...(isAccent && !block ? LOOKS[look].accent : null),
                    ...(isAccent && !block ? { textTransform: L.display.textTransform } : null),
                    padding: block ? "0 0.12em" : undefined,
                    margin: block ? "0 -0.12em" : undefined,
                    textShadow: block ? "none" : undefined,
                    zIndex: 1,
                  }}
                >
                  {block ? (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: "0.04em",
                        bottom: "0.02em",
                        background: accentColor,
                        transform: `scaleX(${blockP})`,
                        transformOrigin: "left center",
                        zIndex: -1,
                        borderRadius: look === "playful" ? "0.12em" : 0,
                      }}
                    />
                  ) : null}
                  {word}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** A short line that fades and rises in (body text, notes). */
export function Line({ children, delay = 0, style, dy = 26 }) {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, delay + 16, EASE.out);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * dy}px)`, ...style }}>
      {children}
    </div>
  );
}

/** The small caps label above a headline, with a rule that draws in. */
export function Label({ text, look = "bold", color, rule = true, delay = 0, size = 34 }) {
  const frame = useCurrentFrame();
  if (!text) return null;
  const L = LOOKS[look] ?? LOOKS.bold;
  const p = progress(frame, delay, delay + 14, EASE.out);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.6,
        opacity: Math.min(1, p * 1.6),
      }}
    >
      {rule ? (
        <div
          style={{
            width: size * 1.6 * p,
            height: Math.max(3, size * 0.1),
            background: color,
            borderRadius: 4,
          }}
        />
      ) : null}
      <div
        style={{ ...L.label, fontSize: size, color, transform: `translateX(${(1 - p) * -20}px)` }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * A number that rolls up to its value (a price, a percentage). Non-numeric text is shown as is.
 * Keeps the text around the number ("39 lei", "-20%").
 */
export function RollingNumber({ text, delay = 0, frames = 18, style }) {
  const frame = useCurrentFrame();
  const match = String(text ?? "").match(/^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/);
  if (!match) return <span style={style}>{text}</span>;
  const [, before, digits, after] = match;
  const value = Number(digits.replace(",", "."));
  const decimals = (digits.split(/[.,]/)[1] ?? "").length;
  const p = progress(frame, delay, delay + frames, EASE.out);
  const shown = (value * p).toFixed(decimals).replace(".", digits.includes(",") ? "," : ".");
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {before}
      {shown}
      {after}
    </span>
  );
}
