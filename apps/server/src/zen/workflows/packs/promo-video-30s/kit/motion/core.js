// Timing, curves and frame geometry for every Remotion template in the packs. One source of truth
// for "how things move": the curves are the ones motion designers reach for (expo-out entrances,
// quint in-out camera moves, a crisp spring for UI and a softer one for type), never linear.
import { Easing, interpolate, spring } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

export const EASE = {
  /** Entrances: fast start, long soft landing. */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Exits: slow start, fast leave. */
  in: Easing.bezier(0.7, 0, 0.84, 0),
  /** Camera moves and pushes. */
  inOut: Easing.bezier(0.83, 0, 0.17, 1),
  /** Gentle in-out for long drifts. */
  drift: Easing.bezier(0.45, 0, 0.55, 1),
  /** A small overshoot for stamps and badges. */
  back: Easing.bezier(0.34, 1.56, 0.64, 1),
};

export const SPRING = {
  /** UI and buttons: quick, no wobble. */
  snappy: { damping: 26, stiffness: 320, mass: 0.7 },
  /** Type: soft landing. */
  soft: { damping: 200, stiffness: 160, mass: 1 },
  /** Playful pop, one small bounce. */
  bouncy: { damping: 11, stiffness: 190, mass: 0.75 },
  /** Logo and stamps: settles with weight. */
  heavy: { damping: 16, stiffness: 120, mass: 1.2 },
};

/** 0..1 between two frames with a curve. */
export function progress(frame, from, to, easing = EASE.out) {
  return interpolate(frame, [from, to], [0, 1], { ...clamp, easing });
}

/** A spring that starts at `delay`. */
export function springAt(frame, fps, delay = 0, config = SPRING.soft) {
  return spring({ frame: frame - delay, fps, config });
}

export { safeZone } from "./placement.js";

export { beatSeconds, snapToBeats } from "./beats.js";

/** A deterministic pseudo-random number in 0..1 for a seed (grain, jitter). */
export function hash01(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
