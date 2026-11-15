#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - One-off asset render script.
// Renders Zen Staff icons from assets/zen/*.svg (run: vp run --filter @t3tools/scripts zen:icons).
// Upstream's `icons:export` needs macOS Icon Composer and would overwrite these. See ZEN.md.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import sharp from "sharp";

import { ZEN_BRAND_COLORS, ZEN_MARK_PATH } from "@t3tools/contracts/zen";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const dir = NodePath.join(import.meta.dirname, "..", "assets", "zen");
const source = (name: string) => NodeFSP.readFile(NodePath.join(dir, name));
const rounded = await source("zen-app-icon.svg");
const fullBleed = await source("zen-app-icon-full-bleed.svg");
// Pixel-hinted drawings: below 24 px the 16 px one, 24-47 px the 32 px one, never the 1024 art.
const hinted16 = await source("zen-app-icon-16px.svg");
const hinted32 = await source("zen-app-icon-32px.svg");

const renderSvg = (svg: Buffer, size: number) =>
  sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();
// The rounded app icon at `size`, from the drawing made for that size.
const render = (size: number) =>
  renderSvg(size < 24 ? hinted16 : size < 48 ? hinted32 : rounded, size);
const write = (name: string, contents: Buffer) =>
  NodeFSP.writeFile(NodePath.join(dir, name), contents);
const ico = async (sizes: ReadonlyArray<number>) =>
  encodePngIco(
    await Promise.all(sizes.map(async (size) => ({ size, contents: await render(size) }))),
  );

await write("zen-universal-1024.png", await render(1024));
await write("zen-ios-1024.png", await renderSvg(fullBleed, 1024));
// macOS: an 824px body centered on a transparent 1024 canvas, per Apple's icon grid.
await write(
  "zen-macos-1024.png",
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: await render(824), left: 100, top: 100 }])
    .png()
    .toBuffer(),
);
await write("zen-web-favicon-16x16.png", await render(16));
await write("zen-web-favicon-32x32.png", await render(32));
await write("zen-web-apple-touch-180.png", await renderSvg(fullBleed, 180));
await write("zen-web-icon-192x192.png", await render(192));
await write("zen-web-icon-512x512.png", await render(512));
await write("zen-web-favicon.ico", await ico([16, 32, 48]));
await write("zen-windows.ico", await ico(WINDOWS_ICON_SIZES));

// Linux: build-desktop-artifact.ts stages these hinted sizes instead of shrinking the 1024 PNG.
await NodeFSP.mkdir(NodePath.join(dir, "linux", "icons"), { recursive: true });
for (const size of [16, 22, 24, 32]) {
  await write(NodePath.join("linux", "icons", `${size}x${size}.png`), await render(size));
}

// Android (apps/mobile): adaptive icon layers, monochrome mark, notification icon and the Android 12+
// splash. Written here, not over apps/mobile/assets/* (upstream art), and wired by app.config.ts.
// The mark as composed in zen-app-icon.svg (stroke 5.2, optically centered), scaled by `scale`
// relative to the app icon and centered on a `canvas` px square, optional background.
const markSvg = (canvas: number, scale: number, color: string, background?: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}">` +
      (background ? `<rect width="${canvas}" height="${canvas}" fill="${background}"/>` : "") +
      `<g transform="translate(${canvas / 2} ${canvas / 2}) scale(${(canvas / 1024) * scale}) translate(-512 -512)">` +
      `<g transform="translate(149.68 138.7) scale(15.6510)">` +
      `<path d="${ZEN_MARK_PATH}" fill="none" stroke="${color}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</g></g></svg>`,
  );
const { navy, vermilion } = ZEN_BRAND_COLORS;
// Adaptive icons: 108dp canvas, launchers show about the central 72dp; at 0.68 the mark fills the
// visible tile as it fills the app icon (navy background: androidAdaptiveBackgroundColor).
await write("zen-android-foreground-432.png", await renderSvg(markSvg(432, 0.68, vermilion), 432));
await write("zen-android-monochrome-432.png", await renderSvg(markSvg(432, 0.68, "#FFFFFF"), 432));
// Notification icon: 24dp with 2dp padding, white on transparent (Android tints it).
await write("zen-android-notification-96.png", await renderSvg(markSvg(96, 1.3, "#FFFFFF"), 96));
// Splash: Android 12+ masks the central two thirds of the 288dp canvas (1152px at 4x).
await write(
  "zen-android-splash-1152.png",
  await renderSvg(markSvg(1152, 0.64, vermilion, navy), 1152),
);
console.log(`Wrote Zen Staff icons to ${dir}`);
