// Helpers shared by the poster layouts: HTML escaping, image sizes (PNG/JPEG headers, no
// dependencies) and the unit every layout scales from.
import * as NodeFS from "node:fs";

export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** Width and height of a PNG or JPEG file, or null when the header cannot be read. */
export function imageSize(file) {
  try {
    const b = NodeFS.readFileSync(file);
    if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG")
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The sheet's shape: `tall` (portrait posters, 4:5 and 9:16), `square`, or `wide` (event cover),
 * and the base unit `u` in px: one hundredth of the short side, so a design keeps its proportions
 * from A5 to the social sizes.
 */
export function sheetShape(W, H) {
  const ratio = H / W;
  const shape = ratio >= 1.2 ? "tall" : ratio < 0.9 ? "wide" : "square";
  const u = shape === "wide" ? H / 100 : W / 100;
  return { shape, u, ratio };
}

/** Film grain as an inline SVG data URL (feTurbulence), laid over photos so they print like ink. */
export const grainUrl = (seed = 7) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='${seed}' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.1 -0.2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`,
  )}")`;
