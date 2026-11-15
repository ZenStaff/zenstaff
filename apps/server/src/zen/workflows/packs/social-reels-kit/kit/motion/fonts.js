// Loads the kit's fonts in the Remotion page. The render scripts copy them from the open-fonts
// toolchain into the public folder under _zen/fonts; nothing is fetched from the internet.
import { continueRender, delayRender, staticFile } from "remotion";
import { FONT_FILES } from "../common/type.js";

let started = false;
export function ensureFonts() {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("Loading fonts");
  Promise.all(
    FONT_FILES.map(([family, file, weight, style]) => {
      const face = new FontFace(family, `url("${staticFile(`_zen/fonts/${file}`)}")`, {
        weight,
        style,
      });
      document.fonts.add(face);
      return face.load().catch((error) => console.error(`Font ${file}: ${error.message}`));
    }),
  ).finally(() => continueRender(handle));
}

/** The font files a render needs in its public folder. */
export const FONT_FILE_NAMES = [...new Set(FONT_FILES.map(([, file]) => file))];
