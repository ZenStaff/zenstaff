// Real photo mockups: a design warped onto a licensed Pexels photo of a real object and blended
// with its light (multiply on paper, ink on fabric or dark surfaces, glow on screens), the recipe
// of our reference brand books (the fictional Ceaunul Fermecat and Luna Piccola). Photos are downloaded at run time and checked by
// sha256 (the corners were measured on exactly those files); they are never shipped in a pack.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const CATALOG = JSON.parse(
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "mockups.json"), "utf8"),
);

export function cacheDir() {
  const dir =
    process.env.ZEN_MOCKUP_CACHE ||
    NodePath.join(NodeOS.homedir(), ".cache", "zen-staff", "mockups");
  NodeFS.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The mockups that take a design of `kind` (poster, card, logo, story, menu, banner, sign...). */
export const mockupsFor = (kind) =>
  CATALOG.mockups.filter((m) => m.layers.some((l) => l.slot === kind));

/** Downloads (once) and checks a mockup photo; returns its local path, or null when unavailable. */
export async function mockupPhoto(entry) {
  const file = NodePath.join(cacheDir(), `${entry.id}-${entry.photo.sha256.slice(0, 12)}.jpg`);
  if (NodeFS.existsSync(file)) return file;
  try {
    const response = await fetch(entry.photo.url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    // A different file than the one the corners were measured on would put the design off the
    // surface: refuse it rather than deliver a crooked mockup.
    if (hash !== entry.photo.sha256) return null;
    NodeFS.writeFileSync(file, bytes);
    return file;
  } catch {
    return null;
  }
}

/** Homography that maps the unit square to the quad (TL, TR, BR, BL), as a CSS matrix3d. */
export function quadMatrix(w, h, quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  // Square -> quad (Heckbert).
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a13 = 0;
  let a23 = 0;
  if (dx3 !== 0 || dy3 !== 0) {
    const den = dx1 * dy2 - dx2 * dy1;
    a13 = (dx3 * dy2 - dx2 * dy3) / den;
    a23 = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a11 = x1 - x0 + a13 * x1;
  const a21 = x3 - x0 + a23 * x3;
  const a31 = x0;
  const a12 = y1 - y0 + a13 * y1;
  const a22 = y3 - y0 + a23 * y3;
  const a32 = y0;
  // Pre-scale the element (w x h px) to the unit square.
  const m = [
    a11 / w,
    a12 / w,
    0,
    a13 / w,
    a21 / h,
    a22 / h,
    0,
    a23 / h,
    0,
    0,
    1,
    0,
    a31,
    a32,
    0,
    1,
  ];
  return `matrix3d(${m.map((v) => +v.toFixed(10)).join(",")})`;
}

/** A sub-rectangle of a quad (u0, v0, u1, v1 in 0..1), optionally fitted to a design ratio. */
export function subQuad(quad, sub, ratio) {
  const bil = (u, v) => {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
    const tx = x0 + (x1 - x0) * u;
    const ty = y0 + (y1 - y0) * u;
    const bx = x3 + (x2 - x3) * u;
    const by = y3 + (y2 - y3) * u;
    return [tx + (bx - tx) * v, ty + (by - ty) * v];
  };
  let [u0, v0, u1, v1] = sub ?? [0, 0, 1, 1];
  if (ratio) {
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const qw = (len(quad[0], quad[1]) + len(quad[3], quad[2])) / 2;
    const qh = (len(quad[0], quad[3]) + len(quad[1], quad[2])) / 2;
    const bw = (u1 - u0) * qw;
    const bh = (v1 - v0) * qh;
    if (bw / bh > ratio) {
      const d = (bw - bh * ratio) / qw / 2;
      u0 += d;
      u1 -= d;
    } else {
      const d = (bh - bw / ratio) / qh / 2;
      v0 += d;
      v1 -= d;
    }
  }
  return [bil(u0, v0), bil(u1, v0), bil(u1, v1), bil(u0, v1)];
}

const dataUrl = (file) => {
  const ext = NodePath.extname(file).slice(1).toLowerCase();
  const type = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
  return `data:${type};base64,${NodeFS.readFileSync(file).toString("base64")}`;
};

/**
 * Composes one mockup. `page` is a Playwright page (any size), `designs` maps each slot of the
 * mockup to a PNG of the design (at production proportions), `out` is the JPEG to write,
 * `maxSide` the output size. Returns { out, credit } or null when the photo is unavailable.
 */
export async function composeMockup(page, { id, designs, out, maxSide = 2000 }) {
  const entry = CATALOG.mockups.find((m) => m.id === id);
  if (!entry) throw new Error(`Unknown mockup ${id}`);
  const photo = await mockupPhoto(entry);
  if (!photo) return null;
  const scale = Math.min(1, maxSide / Math.max(entry.photo.width, entry.photo.height));
  const W = Math.round(entry.photo.width * scale);
  const H = Math.round(entry.photo.height * scale);
  const layers = [];
  for (const layer of entry.layers) {
    const file = designs[layer.slot];
    if (!file) continue;
    layers.push({
      ...layer,
      src: dataUrl(file),
      quad: layer.quad.map(([x, y]) => [x * scale, y * scale]),
      mask: (layer.mask ?? []).map((poly) => poly.map(([x, y]) => [x * scale, y * scale])),
    });
  }
  if (!layers.length) return null;
  await page.setViewportSize({ width: W, height: H });
  const result = await page.evaluate(
    async ({ photoSrc, W, H, layers, scale }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const canvas = (w, h) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c;
      };
      const base = canvas(W, H);
      const bctx = base.getContext("2d", { willReadFrequently: true });
      bctx.drawImage(await load(photoSrc), 0, 0, W, H);
      const photo = bctx.getImageData(0, 0, W, H);
      const P = photo.data;
      for (const layer of layers) {
        const img = await load(layer.src);
        // Warp with CSS 3D (exact perspective), rasterise through an SVG foreignObject-free path:
        // draw the image into a DOM element, then read it back with a second canvas per strip.
        const holder = document.createElement("div");
        holder.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;pointer-events:none;`;
        document.body.appendChild(holder);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        // fit: keep the design's proportions, centered on the surface (never stretched, never cut)
        const ratio = layer.fit ? w / h : null;
        const quad = window.__zenSubQuad(layer.quad, layer.sub, ratio);
        const el = document.createElement("img");
        el.src = img.src;
        el.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;transform:${window.__zenQuadMatrix(w, h, quad)};${layer.blur ? `filter:blur(${layer.blur * scale * 2}px);` : ""}`;
        holder.appendChild(el);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const warped = await window.__zenSnapshot(holder, W, H);
        holder.remove();
        const D = warped.data;
        // Masks: polygons of the photo in front of the surface (a strap, a hand).
        let maskData = null;
        if (layer.mask && layer.mask.length) {
          const m = canvas(W, H);
          const mctx = m.getContext("2d");
          mctx.fillStyle = "#fff";
          mctx.fillRect(0, 0, W, H);
          mctx.fillStyle = "#000";
          for (const poly of layer.mask) {
            mctx.beginPath();
            poly.forEach(([x, y], i) => (i ? mctx.lineTo(x, y) : mctx.moveTo(x, y)));
            mctx.closePath();
            mctx.fill();
          }
          maskData = mctx.getImageData(0, 0, W, H).data;
        }
        const mode = layer.mode ?? "multiply";
        const opacity = layer.opacity ?? 1;
        const lum = (i) => (P[i] * 0.299 + P[i + 1] * 0.587 + P[i + 2] * 0.114) / 255;
        let ref = layer.ref;
        if (mode !== "multiply" && !ref) {
          const values = [];
          for (let i = 0; i < D.length; i += 16) if (D[i + 3] > 128) values.push(lum(i));
          values.sort((a, b) => a - b);
          ref = values.length ? values[Math.floor(values.length * 0.8)] : 0.8;
        }
        const shadeAmount = layer.shade ?? (mode === "ink" ? 1 : 0.25);
        const texture = layer.texture ?? 0;
        let mean = 0;
        if (texture) {
          let n = 0;
          for (let i = 0; i < P.length; i += 64) {
            mean += lum(i);
            n++;
          }
          mean /= n;
        }
        for (let i = 0; i < D.length; i += 4) {
          let a = (D[i + 3] / 255) * opacity;
          if (a <= 0) continue;
          if (maskData) a *= maskData[i] / 255;
          for (let c = 0; c < 3; c++) {
            const p = P[i + c] / 255;
            const d = D[i + c] / 255;
            let o;
            if (mode === "multiply") o = p * (1 - a + a * d);
            else {
              let sh = Math.min(1.25, Math.max(0, lum(i) / Math.max(ref, 0.001)));
              sh = 1 + (sh - 1) * shadeAmount;
              let ink = Math.min(1, Math.max(0, d * sh));
              if (texture) ink = Math.min(1, Math.max(0, ink + (lum(i) - mean) * texture));
              o = p * (1 - a) + ink * a;
            }
            P[i + c] = Math.round(o * 255);
          }
        }
      }
      bctx.putImageData(photo, 0, 0);
      return base.toDataURL("image/jpeg", 0.9);
    },
    { photoSrc: dataUrl(photo), W, H, layers, scale },
  );
  NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
  NodeFS.writeFileSync(out, Buffer.from(result.split(",")[1], "base64"));
  return {
    out,
    credit: `Photo: Pexels ${entry.photo.pexels}${entry.photo.author ? ` (${entry.photo.author})` : ""}, Pexels License`,
  };
}

/**
 * Installs the helpers composeMockup needs in a page: the homography, the sub-quad and a
 * snapshot of a DOM element into ImageData (via Playwright's screenshot, exposed as a binding).
 */
export async function prepareMockupPage(page) {
  await page.exposeBinding("__zenShot", async ({ page: p }, W, H) => {
    const png = await p.screenshot({
      clip: { x: 0, y: 0, width: W, height: H },
      omitBackground: true,
      type: "png",
    });
    return `data:image/png;base64,${png.toString("base64")}`;
  });
  await page.addScriptTag({
    content: `window.__zenQuadMatrix = ${quadMatrix.toString()};
window.__zenSubQuad = ${subQuad.toString()};
window.__zenSnapshot = async (holder, W, H) => {
  const hidden = [...document.body.children].filter((c) => c !== holder && c.style.visibility !== "hidden");
  hidden.forEach((c) => (c.style.visibility = "hidden"));
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  const src = await window.__zenShot(W, H);
  hidden.forEach((c) => (c.style.visibility = ""));
  const img = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, W, H);
};`,
  });
}
