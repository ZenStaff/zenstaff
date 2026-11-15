// Where a reel puts words and pictures, as pure functions (no Remotion imports), so the
// "Voce generată cu AI" label can be placed clear of them and a test can check every layout.
import { aiLabelBox, box, safeZone } from "../../kit/motion/placement.js";

const layoutUnits = (width, height) => {
  const safe = safeZone(width, height);
  return { safe, u: safe.unit, tall: safe.kind === "vertical" };
};

/**
 * Every box where a reel can show text, for any scene type, any `place` and the end card: the
 * text stack and the end card fill the safe zone; a list over a picture starts under the picture
 * and reaches 40 units below the safe zone's bottom edge.
 */
export function textZones(width, height) {
  const { safe, u, tall } = layoutUnits(width, height);
  const inner = width - safe.left - safe.right;
  const stack = box(safe.left, safe.top, inner, height - safe.top - safe.bottom);
  const listTop = height * (tall ? 0.44 : 0.4) - 150 * u;
  const list = box(safe.left, listTop, inner, height - (safe.bottom - 40 * u) - listTop);
  return [stack, list];
}

/**
 * Where the photo cards start: the offer card and the framed photo. On 9:16 they rise a little
 * above the safe zone (the label sits higher still); on feed formats they start under the top
 * margin, where the label goes.
 */
export function photoTops(width, height) {
  const { safe, u, tall } = layoutUnits(width, height);
  if (tall) return { offer: safe.top - 20 * u, framed: height * 0.12 };
  return { offer: safe.top + 24 * u, framed: Math.max(height * 0.07, safe.top + 24 * u) };
}

/** The photo cards (offer and framed photo scenes), with room for their tilt (up to 2.5 deg). */
export function pictureZones(width, height) {
  const { tall } = layoutUnits(width, height);
  const tops = photoTops(width, height);
  const tilt = 0.02 * width;
  return [
    box(
      width * 0.1 - tilt,
      tops.offer - tilt,
      width * 0.8 + 2 * tilt,
      height * (tall ? 0.33 : 0.3) + 2 * tilt,
    ),
    box(
      width * 0.09 - tilt,
      tops.framed - tilt,
      width * 0.82 + 2 * tilt,
      height * (tall ? 0.42 : 0.44) + 2 * tilt,
    ),
  ];
}

/** The AI-voice label's box for a reel: never over text, off the pictures when there is room. */
export function reelLabelBox(width, height, text) {
  return aiLabelBox({
    width,
    height,
    text,
    avoid: textZones(width, height),
    soft: pictureZones(width, height),
  });
}
