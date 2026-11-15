import { Composition } from "remotion";
import { DEFAULT_PROPS, Promo } from "./Promo.jsx";
import { FPS, SIZES, promoTimeline } from "./schema.js";

export const Root = () => (
  <Composition
    id="Promo"
    component={Promo}
    fps={FPS}
    width={1920}
    height={1080}
    durationInFrames={30 * FPS}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={({ props }) => {
      const [width, height] = SIZES[props.format] ?? SIZES.landscape;
      return {
        width,
        height,
        durationInFrames: promoTimeline({ ...DEFAULT_PROPS, ...props }).total,
      };
    }}
  />
);
