import { Composition } from "remotion";
import { Tutorial, tutorialFrames } from "./Tutorial.jsx";

const SIZES = { landscape: [1920, 1080], vertical: [1080, 1920] };
const DEFAULT_PROPS = {
  format: "landscape",
  title: "Tutorial",
  kicker: "Tutorial",
  brand: { primary: "#0F4C5C", accent: "#F2C14E" },
  outro: { title: "Gata", lines: [] },
  introSeconds: 3,
  bodySeconds: 4,
  outroSeconds: 3.5,
  events: [],
  steps: [],
  cues: [],
  body: "body.mp4",
  narration: "narration.wav",
  domain: "example.com",
};

export const Root = () => (
  <Composition
    id="Tutorial"
    component={Tutorial}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={tutorialFrames(DEFAULT_PROPS)}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={({ props }) => {
      const [width, height] = SIZES[props.format] ?? SIZES.landscape;
      return { width, height, durationInFrames: tutorialFrames(props) };
    }}
  />
);
