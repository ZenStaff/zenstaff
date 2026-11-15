import { Composition } from "remotion";
import { z } from "zod";
import { FORMATS, FPS, makeSchemas, reelFrames } from "./schema.js";
import { Reel } from "./Reel.jsx";

const { reel } = makeSchemas(z);

const DEFAULT_PROPS = reel.parse({
  id: "preview",
  brand: { name: "Your business" },
  scenes: [
    { type: "hook", title: "Something new this week", seconds: 3 },
    { type: "statement", title: "Made fresh every day", text: "A short line about it", seconds: 3 },
  ],
  end: { title: "See you soon", lines: ["@yourbusiness"] },
});

export const Root = () => (
  <Composition
    id="Reel"
    component={Reel}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={reelFrames(DEFAULT_PROPS)}
    defaultProps={DEFAULT_PROPS}
    schema={reel}
    calculateMetadata={({ props }) => {
      const [width, height] = FORMATS[props.format] ?? FORMATS.vertical;
      return { width, height, durationInFrames: reelFrames(props) };
    }}
  />
);
