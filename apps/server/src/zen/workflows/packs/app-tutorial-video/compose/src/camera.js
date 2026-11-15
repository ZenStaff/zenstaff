// Screen Studio-style direction from the recorder's event log, as pure functions (no Remotion
// imports). Coordinates are 0..1 of the recorded viewport, times are seconds of the recording.
// cameraKeys zooms to the control in use and pulls out for page changes and scrolls; cursorAt
// moves the cursor on an eased arc, never a teleport.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** How far to zoom for a target box (normalised): small controls get closer, wide areas stay wide. */
export function zoomFor(box, { max = 1.5, min = 1 } = {}) {
  if (!box) return 1.45;
  const span = Math.max(box.width, box.height * 0.75);
  if (span > 0.55) return min;
  return clamp(0.56 / Math.max(span, 0.05), 1.2, max);
}

/** Keeps the zoomed view inside the recording (no empty margin at the edges). */
export function clampCenter(x, y, scale) {
  const half = 0.5 / scale;
  return { x: clamp(x, half, 1 - half), y: clamp(y, half, 1 - half) };
}

/**
 * Camera keyframes [{t, scale, x, y}] (x, y = the point at the center of the view). Each focus
 * event starts a 0.8 s move; navigation and scrolling pull out to the full page first.
 */
export function cameraKeys(events, { duration, max = 1.5, lead = 0.25 } = {}) {
  const keys = [{ t: 0, scale: 1, x: 0.5, y: 0.5 }];
  const push = (key) => {
    const last = keys.at(-1);
    if (key.t <= last.t + 0.05) {
      keys[keys.length - 1] = { ...key, t: Math.max(key.t, last.t) };
      return;
    }
    keys.push(key);
  };
  let current = keys[0];
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    if (event.kind === "nav" || event.kind === "scroll") {
      if (current.scale > 1) {
        push({ ...current, t: Math.max(0, event.t - 0.05) });
        current = { t: event.t + 0.6, scale: 1, x: 0.5, y: 0.5 };
        push(current);
      }
      continue;
    }
    if (!["move", "click", "type", "highlight"].includes(event.kind) || !event.box) continue;
    const scale =
      event.kind === "highlight"
        ? Math.min(zoomFor(event.box, { max }), 1.6)
        : zoomFor(event.box, { max });
    const cx = event.box.x + event.box.width / 2;
    const cy = event.box.y + event.box.height / 2;
    const center = clampCenter(cx, cy, scale);
    const near =
      Math.abs(center.x - current.x) < 0.08 &&
      Math.abs(center.y - current.y) < 0.08 &&
      Math.abs(scale - current.scale) < 0.15;
    if (near) continue;
    const start = Math.max(0, event.t - lead);
    push({ ...current, t: start });
    current = { t: start + 0.8, scale, ...center };
    push(current);
  }
  // Pull out to the whole page for the last second so the viewer sees where they ended up.
  if (current.scale > 1 && duration) {
    push({ ...current, t: Math.max(current.t, duration - 1.6) });
    push({ t: Math.max(current.t + 0.6, duration - 0.8), scale: 1, x: 0.5, y: 0.5 });
  }
  return keys;
}

/** The camera at time t, eased between keyframes. */
export function cameraAt(keys, t) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t < b.t) {
      const p = smooth((t - a.t) / Math.max(0.001, b.t - a.t));
      // Zoom in log space so in and out feel equally fast.
      const scale = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * p);
      return { scale, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
    }
  }
  return keys.at(-1);
}

/** Cursor position at time t: moves take `travel` seconds, eased, with a gentle arc. */
export function cursorAt(events, t, { travel = 0.65, start = { x: 0.5, y: 0.62 } } = {}) {
  let from = start;
  let pos = start;
  for (const event of events) {
    if (event.kind !== "move") continue;
    if (t < event.t) break;
    const p = smooth((t - event.t) / travel);
    const to = { x: event.x, y: event.y };
    const arc =
      Math.sin(Math.PI * p) * Math.min(0.04, Math.hypot(to.x - from.x, to.y - from.y) * 0.12);
    pos = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p - arc };
    if (p >= 1) from = to;
    else break;
  }
  return pos;
}
