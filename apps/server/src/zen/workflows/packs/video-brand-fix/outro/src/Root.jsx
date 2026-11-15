// The brand outro (the kit's end card: logo, call-to-action button, contact lines with icons) and
// the text patches that replace outdated words, both in the brand's type and colors.
import { AbsoluteFill, Audio, Composition, staticFile } from "remotion";
import {
  EndCard,
  LOOKS,
  ensureFonts,
  palette as makePalette,
  readable,
} from "../../kit/motion/index.js";

ensureFonts();

function Outro({ brand, title, lines, look, score }) {
  const P = makePalette({ primary: brand.primary, accent: brand.accent });
  return (
    <AbsoluteFill>
      <EndCard brand={brand} palette={P} cta={title} lines={lines} look={look} pressAt={36} />
      {score ? <Audio src={staticFile(score)} /> : null}
    </AbsoluteFill>
  );
}

function Patch({ text, fill, color, bold, align, look, width, height }) {
  const L = LOOKS[look] ?? LOOKS.modern;
  const ink = color ?? readable(fill, ["#14161A", "#FFFFFF"], 4.5);
  // One line, as large as the box allows (Source Sans averages about 0.5 em per character).
  const size = Math.max(
    10,
    Math.min(height * 0.5, (width - height * 0.6) / (String(text).length * 0.5)),
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: Math.min(height * 0.24, 28),
          background: fill,
          boxShadow: "0 4px 18px rgba(0,0,0,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: align === "left" ? "flex-start" : "center",
          padding: `0 ${height * 0.3}px`,
          ...L.body,
          fontWeight: bold === false ? 500 : 800,
          fontSize: size,
          lineHeight: 1.1,
          color: ink,
          whiteSpace: "nowrap",
          textAlign: align === "left" ? "left" : "center",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

const OUTRO_DEFAULT = {
  brand: { name: "Brand", primary: "#1F4D3A", accent: "#F2B544" },
  title: "",
  lines: [],
  look: "modern",
  width: 1080,
  height: 1920,
  seconds: 3.5,
};
const PATCH_DEFAULT = { text: "", fill: "#FFFFFF", look: "modern", width: 400, height: 80 };

export const Root = () => (
  <>
    <Composition
      id="Outro"
      component={Outro}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={105}
      defaultProps={OUTRO_DEFAULT}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        durationInFrames: Math.round(props.seconds * 30),
      })}
    />
    <Composition
      id="Patch"
      component={Patch}
      fps={30}
      width={400}
      height={80}
      durationInFrames={1}
      defaultProps={PATCH_DEFAULT}
      calculateMetadata={({ props }) => ({ width: props.width, height: props.height })}
    />
  </>
);
