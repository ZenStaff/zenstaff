// Picture layers: media with camera motion, film grain, vignette, light leaks, legibility scrims
// and textured brand backgrounds. These give a frame depth (foreground type, mid-ground picture,
// texture on top) instead of flat text on a flat color.
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { alpha, mix, shade, tint } from "../common/color.js";
import { EASE, clamp, hash01 } from "./core.js";

const IS_VIDEO = /\.(mp4|mov|m4v|webm)$/i;
export const isVideo = (file) => IS_VIDEO.test(file ?? "");

/**
 * A photo or muted clip, cover-cropped around the focus point, with a camera move:
 * `punch` lands from a fast push (the hook), `push` slowly moves in, `pull` slowly out,
 * `pan` drifts sideways, `still` holds. Video clips move less than photos.
 */
export function Media({
  file,
  focusX = 50,
  focusY = 50,
  start = 0,
  move = "push",
  length = 90,
  blur = 0,
  dim = 0,
  parallax = 0,
  rate = 1,
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const video = isVideo(file);
  const amount = video ? 0.5 : 1;
  const t = Math.min(1, frame / Math.max(1, length));
  let scale = 1;
  let x = 0;
  let y = 0;
  if (move === "punch") {
    const land = interpolate(frame, [0, 14], [1.32, 1.08], { ...clamp, easing: EASE.out });
    scale = land + t * 0.06 * amount;
  } else if (move === "push") {
    scale = 1.05 + EASE.drift(t) * 0.1 * amount;
  } else if (move === "pull") {
    scale = 1.16 - EASE.drift(t) * 0.1 * amount;
  } else if (move === "pan") {
    scale = 1.14;
    x = interpolate(EASE.drift(t), [0, 1], [-3, 3]) * amount;
  }
  y += parallax * t;
  const style = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${focusX}% ${focusY}%`,
    transform: `translate(${x}%, ${y}px) scale(${scale + blur / 300})`,
    transformOrigin: `${focusX}% ${focusY}%`,
    filter: blur ? `blur(${blur}px) saturate(1.05)` : "saturate(1.06) contrast(1.03)",
  };
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#101010" }}>
      {video ? (
        <OffthreadVideo
          src={staticFile(file)}
          muted
          playbackRate={rate}
          trimBefore={Math.round(start * fps)}
          style={style}
        />
      ) : (
        <Img src={staticFile(file)} style={style} />
      )}
      {dim ? <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dim})` }} /> : null}
    </AbsoluteFill>
  );
}

/**
 * Darkens (or tints) where text sits, using the brand's deep color instead of flat black so the
 * picture keeps its warmth. `where`: bottom, top, full, left.
 */
export function Scrim({ where = "bottom", strength = 0.8, color = "#000000" }) {
  const c = (a) => alpha(color, a);
  const s = strength;
  const gradients = {
    bottom: `linear-gradient(180deg, ${c(0)} 22%, ${c(s * 0.5)} 46%, ${c(s * 0.88)} 70%, ${c(s)} 100%)`,
    top: `linear-gradient(0deg, ${c(0)} 45%, ${c(s * 0.55)} 75%, ${c(s)} 100%)`,
    full: `linear-gradient(180deg, ${c(s * 0.5)} 0%, ${c(s * 0.25)} 40%, ${c(s * 0.7)} 75%, ${c(s)} 100%)`,
    left: `linear-gradient(90deg, ${c(s)} 0%, ${c(s * 0.75)} 38%, ${c(0)} 72%)`,
  };
  return <AbsoluteFill style={{ background: gradients[where] ?? gradients.bottom }} />;
}

/** Film grain: animated noise at low opacity, changing 12 times a second like real film. */
export function Grain({ opacity = 0.07, fpsStep = 2.5 }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const seed = Math.floor(frame / fpsStep);
  const dx = Math.round(hash01(seed) * 200);
  const dy = Math.round(hash01(seed + 9) * 200);
  const w = Math.ceil(width / 2) + 200;
  const h = Math.ceil(height / 2) + 200;
  return (
    <AbsoluteFill
      style={{ pointerEvents: "none", opacity, mixBlendMode: "overlay", overflow: "hidden" }}
    >
      <svg
        width={w}
        height={h}
        style={{
          position: "absolute",
          left: -dx,
          top: -dy,
          transform: "scale(2)",
          transformOrigin: "0 0",
        }}
      >
        <filter id={`zen-grain-${seed % 7}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed % 97} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#zen-grain-${seed % 7})`} />
      </svg>
    </AbsoluteFill>
  );
}

export function Vignette({ strength = 0.38 }) {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: `radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,${strength}) 100%)`,
      }}
    />
  );
}

/**
 * A warm light leak that sweeps across once between `from` and `to` (frames). Used sparingly: the
 * hook and the end card, never on every cut.
 */
export function LightLeak({ from = 0, to = 24, color = "#FFB36B", peak = 0.55 }) {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  const p = (frame - from) / Math.max(1, to - from);
  const intensity = Math.sin(p * Math.PI) * peak;
  const x = interpolate(p, [0, 1], [-20, 120]);
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        mixBlendMode: "screen",
        opacity: intensity,
        background: `radial-gradient(ellipse 45% 60% at ${x}% 8%, ${alpha(color, 0.95)} 0%, ${alpha(color, 0.35)} 40%, rgba(0,0,0,0) 70%), radial-gradient(ellipse 40% 50% at ${x - 30}% 85%, ${alpha(tint(color, 0.3), 0.6)} 0%, rgba(0,0,0,0) 65%)`,
      }}
    />
  );
}

/**
 * A brand background with depth: a soft diagonal light across the primary color, a large
 * tone-on-tone word (or shape) drifting slowly behind, and grain on top. Never a flat fill and
 * never a generic rainbow gradient: only the brand's own color, lighter and darker.
 */
export function BrandField({ color, accent, word, look = "bold", drift = 1 }) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const light = tint(color, 0.14);
  const deep = shade(color, 0.32);
  const t = frame / Math.max(1, durationInFrames);
  return (
    <AbsoluteFill style={{ backgroundColor: color, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 90% 60% at ${30 + t * 20 * drift}% 18%, ${alpha(light, 0.9)} 0%, ${alpha(color, 0)} 70%), linear-gradient(160deg, ${alpha(color, 0)} 40%, ${alpha(deep, 0.85)} 100%)`,
        }}
      />
      {word ? (
        <div
          style={{
            position: "absolute",
            left: -width * 0.08 - t * width * 0.12 * drift,
            top: height * 0.5,
            transform: "translateY(-50%) rotate(-90deg)",
            transformOrigin: "50% 50%",
            whiteSpace: "nowrap",
            fontFamily: look === "elegant" ? "ZenInstrument, serif" : "ZenAnton, sans-serif",
            fontSize: width * 0.62,
            lineHeight: 0.8,
            color: mix(color, accent ?? light, 0.12),
            opacity: 0.5,
            textTransform: look === "elegant" ? "none" : "uppercase",
          }}
        >
          {word}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

/** A photo placed as a card with a real shadow and a slight tilt, floating over a background. */
export function PhotoCard({
  file,
  focusX = 50,
  focusY = 50,
  width,
  height,
  tilt = -2.5,
  radius = 28,
  enter = 1,
  start = 0,
  length = 90,
}) {
  const lift = (1 - enter) * 160;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        transform: `translateY(${lift}px) rotate(${tilt * enter}deg) scale(${0.92 + 0.08 * enter})`,
        opacity: Math.min(1, enter * 2),
        boxShadow: "0 50px 90px rgba(0,0,0,0.38), 0 14px 30px rgba(0,0,0,0.22)",
        position: "relative",
      }}
    >
      <Media
        file={file}
        focusX={focusX}
        focusY={focusY}
        start={start}
        move="push"
        length={length}
      />
    </div>
  );
}
