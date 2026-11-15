// Where things sit in the tutorial frame, as pure functions (no Remotion imports) so the tests
// can check them: the recording's window, the captions under it and the AI-voice label.
import { aiLabelBox, box as rect, captionBox, captionLayout } from "../../kit/motion/placement.js";

/** Window geometry for a format: where the recording sits and how big it is. */
export function windowBox(width, height) {
  if (width > height) {
    const w = Math.round(width * 0.76);
    const h = Math.round((w * 9) / 16);
    const bar = Math.round(38 * (width / 1920));
    return {
      x: Math.round((width - w) / 2),
      y: Math.round(height * 0.04),
      w,
      h,
      bar,
      radius: 18 * (width / 1920),
    };
  }
  const w = Math.round(width * 0.74);
  const h = Math.round((w * 16) / 9);
  const bar = Math.round(18 * (width / 1080));
  return {
    x: Math.round((width - w) / 2),
    y: Math.round(height * 0.05),
    w,
    h,
    bar,
    radius: 54 * (width / 1080),
  };
}

/**
 * Captions and the AI-voice label for a frame size. Landscape: the captions are centred in the
 * strip under the window and the label sits beside them, clear of both. Vertical: the captions
 * keep their place above the platform's bottom bar (over the lower part of the window) and the
 * label stays in its top-left corner (`label` is null: use the corner).
 */
export function tutorialOverlay(width, height, labelText) {
  const win = windowBox(width, height);
  const landscape = width > height;
  const windowRect = rect(win.x, win.y, win.w, win.bar + win.h);
  const band = landscape ? { top: win.y + win.bar + win.h, bottom: height } : undefined;
  const captions = captionLayout(width, height, { band });
  const captionRect = captionBox(captions, width, height);
  const placed = labelText
    ? aiLabelBox({ width, height, text: labelText, avoid: [captionRect, windowRect] })
    : null;
  return {
    window: windowRect,
    band,
    captions,
    captionRect,
    label: placed?.ok && landscape ? placed : null,
  };
}
