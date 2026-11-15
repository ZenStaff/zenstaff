import type { SVGProps } from "react";
import {
  ZEN_BRAND_COLORS,
  ZEN_LOCKUP_SMALL,
  ZEN_MARK_16_PATH,
  ZEN_MARK_32_PATH,
  ZEN_MARK_PATH,
} from "@t3tools/contracts/zen";

// Zen Staff: the "Semnătura" Z mark (assets/zen/zen-mark.svg) in place of upstream's T3 wordmark.
// UI sizes are 10-16 px, so it draws the 16 px hinted mark (assets/zen/zen-mark-16px.svg), cropped
// to the stroke so it fills its box. `currentColor`: muted where upstream shows a muted icon.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="2 2 12 12" xmlns="http://www.w3.org/2000/svg">
      <path
        d={ZEN_MARK_16_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The app icon in the UI, 24-47 px: vermilion on the navy tile (assets/zen/zen-app-icon-32px.svg). */
export function ZenMarkTile(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="7" fill={ZEN_BRAND_COLORS.navy} />
      <path
        d={ZEN_MARK_32_PATH}
        fill="none"
        stroke={ZEN_BRAND_COLORS.vermilion}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The lockup "[Z]en Staff" (variant C): the vermilion mark is the Z of "Zen", followed by "en Staff"
 * in Young Serif (outlines, `currentColor`). Sidebar, standalone pages and the Code wizard header;
 * all are under 28 px tall, so it is the small-size drawing (assets/zen/zen-lockup-small.svg).
 * Size it by height (`h-5 w-auto`); the width follows the viewBox.
 */
export function ZenLockup(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox={`0 0 ${ZEN_LOCKUP_SMALL.width} ${ZEN_LOCKUP_SMALL.height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        transform={ZEN_LOCKUP_SMALL.markTransform}
        d={ZEN_MARK_PATH}
        fill="none"
        stroke={ZEN_BRAND_COLORS.vermilion}
        strokeWidth={ZEN_LOCKUP_SMALL.markStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={ZEN_LOCKUP_SMALL.textPath} fill="currentColor" />
    </svg>
  );
}
