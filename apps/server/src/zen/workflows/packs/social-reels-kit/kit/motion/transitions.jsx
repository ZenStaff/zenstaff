// Scene track with real transitions (whip, zoom, push, wipe, fade, flash, cut). Around each cut
// both scenes are on screen for a few frames and the transition moves them; the cut itself sits
// exactly on the boundary, which the templates snap to a music beat.
import {
  AbsoluteFill,
  Freeze,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { alpha } from "../common/color.js";
import { EASE, clamp } from "./core.js";

export const TRANSITIONS = ["whip", "zoom", "push", "wipe", "fade", "flash", "cut"];
/** Frames each scene keeps rendering past its cut. */
const HALF = { whip: 6, zoom: 7, push: 8, wipe: 9, fade: 6, flash: 4, cut: 0 };

/** Direction-aware motion blur through an SVG filter (CSS blur is round, a whip is not). */
function MotionBlurDefs({ id, amount, vertical }) {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation={vertical ? `0 ${amount}` : `${amount} 0`} />
      </filter>
    </svg>
  );
}

/** Transform for a scene given how far it is into its entrance (enter 0..1) or exit (exit 0..1). */
function look(kind, enter, exit, size, id) {
  const { width, height } = size;
  let transform = "";
  let opacity = 1;
  let filter;
  let blurDefs = null;
  if (kind === "whip") {
    const pin = 1 - EASE.out(enter);
    const pout = EASE.in(exit);
    const x = pin * width * 0.55 - pout * width * 0.55;
    const amount = Math.max(pin, pout) * 46;
    transform = `translateX(${x}px)`;
    if (amount > 0.5) {
      blurDefs = <MotionBlurDefs id={id} amount={amount} />;
      filter = `url(#${id})`;
    }
  } else if (kind === "zoom") {
    const pin = 1 - EASE.out(enter);
    const pout = EASE.in(exit);
    const scale = 1 + pin * 0.45 + pout * 0.6;
    const amount = (pin + pout) * 16;
    transform = `scale(${scale})`;
    filter = amount > 0.4 ? `blur(${amount}px)` : undefined;
    opacity = 1 - pout * 0.4;
  } else if (kind === "push") {
    const pin = 1 - EASE.inOut(enter);
    const pout = EASE.inOut(exit);
    const y = pin * height - pout * height * 0.35;
    transform = `translateY(${y}px)`;
    const amount = Math.max(pin, pout) * 24;
    if (amount > 0.5) {
      blurDefs = <MotionBlurDefs id={id} amount={amount} vertical />;
      filter = `url(#${id})`;
    }
    opacity = 1 - pout * 0.6;
  } else if (kind === "fade") {
    opacity = Math.min(EASE.out(enter), 1 - exit);
    transform = `scale(${1 + (1 - enter) * 0.04})`;
  } else if (kind === "flash") {
    opacity = Math.min(1, 0.2 + enter * 0.8) * (1 - exit * 0.5);
  }
  return { transform, opacity, filter, blurDefs };
}

/** The panel that sweeps across for "wipe", drawn above both scenes around the cut. */
function Wipe({ at, color, half }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const p = interpolate(frame, [at - half, at + half], [0, 1], { ...clamp, easing: EASE.inOut });
  if (p <= 0 || p >= 1) return null;
  const x = interpolate(p, [0, 1], [-1.3, 1.3]) * width;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: "-10%",
          bottom: "-10%",
          left: x,
          width: width * 1.05,
          background: color,
          transform: "skewX(-12deg)",
          boxShadow: `0 0 80px ${alpha(color, 0.6)}`,
        }}
      />
    </AbsoluteFill>
  );
}

function Flash({ at, half, color }) {
  const frame = useCurrentFrame();
  const d = Math.abs(frame - at);
  if (d > half) return null;
  const o = interpolate(d, [0, half], [0.9, 0], { ...clamp, easing: EASE.out });
  // An exposure bloom over the whole frame, warm at the edge: hides the cut like a camera flare.
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        mixBlendMode: "screen",
        opacity: o,
        background: `radial-gradient(ellipse 120% 90% at 50% 45%, rgba(255,250,240,0.95) 0%, ${alpha(color, 0.85)} 60%, ${alpha(color, 0.6)} 100%)`,
      }}
    />
  );
}

/**
 * scenes: [{ frames, transition, render: (ctx) => JSX }] where ctx = { length, index }.
 * `transition` is how the scene enters. Returns the cut frames (scene starts) as data-cuts for QA.
 */
export function Track({ scenes, accent = "#F2C14E", leak = "#FFB36B" }) {
  const size = useVideoConfig();
  const placed = [];
  let start = 0;
  for (const [index, scene] of scenes.entries()) {
    placed.push({ ...scene, from: start, index });
    start += scene.frames;
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {placed.map((scene) => {
        const enterKind = scene.index === 0 ? "cut" : (scene.transition ?? "fade");
        const next = placed[scene.index + 1];
        const exitKind = next ? (next.transition ?? "fade") : "cut";
        const pre = HALF[enterKind] ?? 0;
        const post = HALF[exitKind] ?? 0;
        const from = Math.max(0, scene.from - pre);
        const duration = scene.frames + (scene.from - from) + post;
        return (
          <Sequence key={scene.index} from={from} durationInFrames={duration} layout="none">
            <SceneFrame
              scene={scene}
              lead={scene.from - from}
              pre={pre}
              post={post}
              enterKind={enterKind}
              exitKind={exitKind}
              size={size}
            />
          </Sequence>
        );
      })}
      {placed
        .slice(1)
        .map((scene) =>
          scene.transition === "wipe" ? (
            <Wipe key={`w${scene.index}`} at={scene.from} color={accent} half={HALF.wipe} />
          ) : scene.transition === "flash" ? (
            <Flash key={`f${scene.index}`} at={scene.from} half={HALF.flash} color={leak} />
          ) : null,
        )}
    </AbsoluteFill>
  );
}

function SceneFrame({ scene, lead, pre, post, enterKind, exitKind, size }) {
  const frame = useCurrentFrame();
  // Local time of the scene: 0 at its cut.
  const local = frame - lead;
  const enter = pre ? interpolate(local, [-pre, pre], [0, 1], clamp) : 1;
  const exit = post
    ? interpolate(local, [scene.frames - post, scene.frames + post], [0, 1], clamp)
    : 0;
  const id = `zen-mb-${scene.index}`;
  const a = look(enterKind, enter, 0, size, `${id}-in`);
  const b = look(exitKind, 1, exit, size, `${id}-out`);
  // Wipe hides the cut under the panel: the scene simply switches at the boundary.
  const hidden =
    (enterKind === "wipe" && local < 0) || (exitKind === "wipe" && local >= scene.frames);
  if (hidden) return null;
  return (
    <AbsoluteFill
      style={{ opacity: a.opacity * b.opacity, filter: a.filter, transform: a.transform }}
    >
      {a.blurDefs}
      {b.blurDefs}
      <AbsoluteFill style={{ filter: b.filter, transform: b.transform }}>
        {local < 0 ? (
          // Before its cut the incoming scene shows its first frame (it is moving in, blurred).
          <Freeze frame={lead}>
            <Sequence from={lead} layout="none">
              {scene.render({ length: scene.frames, index: scene.index })}
            </Sequence>
          </Freeze>
        ) : (
          <Sequence from={lead} layout="none">
            {scene.render({ length: scene.frames, index: scene.index })}
          </Sequence>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** The cut frames of a list of scene lengths (scene i starts at cuts[i]). */
export function cutFrames(frames) {
  const cuts = [];
  let t = 0;
  for (const f of frames) {
    cuts.push(t);
    t += f;
  }
  return cuts;
}
