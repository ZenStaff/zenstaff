// The 30-second promo: an opening that lands on the first beat, three or four scenes in varied
// editorial layouts (full picture, split screen, floating cards, a statement), and the call to
// action as a pressed button. Landscape, vertical and square from the same props, through the
// shared premium kit (type, motion, transitions, sound).
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  AiVoicePill,
  BrandField,
  EASE,
  EndCard,
  Grain,
  Kinetic,
  LOOKS,
  Label,
  LightLeak,
  Line,
  Media,
  PhotoCard,
  Scrim,
  Track,
  Vignette,
  alpha,
  clamp,
  ensureFonts,
  palette as makePalette,
  progress,
  safeZone,
  tint,
} from "../../kit/motion/index.js";
import { layoutFor, promoTimeline } from "./schema.js";

ensureFonts();

export const DEFAULT_PROPS = {
  format: "landscape",
  seconds: 30,
  style: "modern",
  brand: { name: "Your brand", primary: "#0F4C5C", accent: "#F2C14E" },
  scenes: [
    { title: "Your brand", text: "A short line about what you do" },
    { title: "Why people love it", text: "One clear benefit in a few words" },
    { title: "Something new", text: "What is new this season" },
  ],
  cta: { title: "Visit us today", subtitle: "example.com" },
  music: "generated:upbeat",
  draft: false,
};

function useLayout() {
  const { width, height } = useVideoConfig();
  const safe = safeZone(width, height);
  const wide = width > height * 1.2;
  const inner = width - safe.left - safe.right;
  return { safe, wide, inner, width, height, u: safe.unit };
}

function TextBlock({ scene, P, look, ink, width, base, height, delay = 2, align = "left" }) {
  const { u, wide } = useLayout();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 26 * u,
        alignItems: align === "center" ? "center" : "flex-start",
        textAlign: align,
      }}
    >
      <Label
        text={scene.kicker}
        look={look}
        color={P.accent}
        delay={delay}
        size={(wide ? 35 : 44) * u}
      />
      <Kinetic
        text={scene.title}
        look={look}
        color={ink}
        accentColor={P.accent}
        onAccent={P.onAccent}
        accent={scene.accent}
        align={align}
        box={{ base, width, height }}
        delay={delay}
      />
      {scene.text ? (
        <Line
          delay={delay + 12}
          style={{
            ...LOOKS[look].body,
            fontSize: (wide ? 40 : 46) * u,
            color: alpha(ink, 0.9),
            maxWidth: width,
          }}
        >
          {scene.text}
        </Line>
      ) : null}
    </div>
  );
}

/** Full picture, words over a scrim on the calm side. */
function FullLayout({ scene, P, look, length, index }) {
  const { safe, wide, inner, u, width } = useLayout();
  const media = scene.image;
  return (
    <AbsoluteFill>
      {media ? (
        <Media
          file={media}
          focusX={scene.focusX}
          focusY={scene.focusY}
          move={index === 0 ? "punch" : "push"}
          length={length}
        />
      ) : (
        <BrandField
          color={P.primary}
          accent={P.accent}
          look={look}
          word={scene.title.split(" ")[0]}
        />
      )}
      {media ? (
        <Scrim where={wide ? "left" : "bottom"} strength={0.9} color={P.primaryDeep} />
      ) : null}
      <AbsoluteFill
        style={{
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: wide ? "center" : "flex-end",
        }}
      >
        <TextBlock
          scene={scene}
          P={P}
          look={look}
          ink={media ? P.paper : P.onPrimary}
          width={wide ? width * 0.5 : inner}
          base={(index === 0 ? 190 : 150) * u}
          height={(wide ? 520 : 640) * u}
          delay={index === 0 ? 2 : 3}
        />
      </AbsoluteFill>
      {index === 0 ? <LightLeak from={0} to={22} color={tint(P.accent, 0.3)} peak={0.4} /> : null}
    </AbsoluteFill>
  );
}

/** Split screen: the picture slides in on one side behind a mask, the brand panel holds the words. */
function SplitLayout({ scene, P, look, length, index }) {
  const { safe, wide, u, width, height } = useLayout();
  const frame = useCurrentFrame();
  // Already mostly open when the scene arrives: a transition never shows the bare background.
  const open = 0.62 + 0.38 * progress(frame, 0, 10, EASE.out);
  const right = index % 2 === 1;
  if (!wide) {
    const photoH = height * 0.56;
    return (
      <AbsoluteFill>
        <BrandField color={P.primary} accent={P.accent} look={look} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: photoH,
            overflow: "hidden",
            clipPath: `inset(0 0 ${(1 - open) * 100}% 0)`,
          }}
        >
          <Media
            file={scene.image}
            focusX={scene.focusX}
            focusY={scene.focusY}
            move="pull"
            length={length}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: safe.left,
            right: safe.right,
            top: photoH + 40 * u,
            bottom: safe.bottom,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <TextBlock
            scene={scene}
            P={P}
            look={look}
            ink={P.onPrimary}
            width={width - safe.left - safe.right}
            base={180 * u}
            height={380 * u}
            delay={3}
          />
        </div>
      </AbsoluteFill>
    );
  }
  const photoW = width * 0.56;
  return (
    <AbsoluteFill>
      <BrandField color={P.primary} accent={P.accent} look={look} />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: photoW,
          [right ? "right" : "left"]: 0,
          overflow: "hidden",
          clipPath: right
            ? `inset(0 0 0 ${(1 - open) * 100}%)`
            : `inset(0 ${(1 - open) * 100}% 0 0)`,
        }}
      >
        <Media
          file={scene.image}
          focusX={scene.focusX}
          focusY={scene.focusY}
          move="pull"
          length={length}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          [right ? "left" : "right"]: 0,
          width: width - photoW,
          padding: `${safe.top}px ${70 * u}px ${safe.bottom}px ${right ? safe.left : 90 * u}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <TextBlock
          scene={scene}
          P={P}
          look={look}
          ink={P.onPrimary}
          width={width - photoW - 160 * u}
          base={140 * u}
          height={500 * u}
          delay={3}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 10 * u,
          left: right ? width - photoW - 5 * u : photoW - 5 * u,
          background: P.accent,
          transform: `scaleY(${open})`,
        }}
      />
    </AbsoluteFill>
  );
}

/** Floating photo cards over the brand color, with parallax: one or two pictures. */
function CardsLayout({ scene, P, look, length }) {
  const { safe, wide, u, width, height, inner } = useLayout();
  const frame = useCurrentFrame();
  const a = progress(frame, 0, 16, EASE.out);
  const b = progress(frame, 4, 20, EASE.out);
  const drift = interpolate(frame, [0, length], [0, -40 * u], clamp);
  if (!wide) {
    return (
      <AbsoluteFill>
        <BrandField color={P.primary} accent={P.accent} look={look} />
        <div
          style={{
            position: "absolute",
            left: width * 0.08,
            top: safe.top - 30 * u,
            transform: `translateY(${drift}px)`,
          }}
        >
          <PhotoCard
            file={scene.image}
            focusX={scene.focusX}
            focusY={scene.focusY}
            width={width * (scene.image2 ? 0.6 : 0.84)}
            height={height * 0.36}
            tilt={-3}
            enter={a}
            length={length}
          />
        </div>
        {scene.image2 ? (
          <div
            style={{
              position: "absolute",
              right: width * 0.07,
              top: safe.top + height * 0.16,
              transform: `translateY(${drift * 1.8}px)`,
            }}
          >
            <PhotoCard
              file={scene.image2}
              width={width * 0.46}
              height={height * 0.26}
              tilt={4}
              enter={b}
              length={length}
            />
          </div>
        ) : null}
        <div
          style={{ position: "absolute", left: safe.left, right: safe.right, bottom: safe.bottom }}
        >
          <TextBlock
            scene={scene}
            P={P}
            look={look}
            ink={P.onPrimary}
            width={inner}
            base={180 * u}
            height={420 * u}
            delay={3}
          />
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <BrandField color={P.primary} accent={P.accent} look={look} />
      <div
        style={{
          position: "absolute",
          left: safe.left,
          top: 0,
          bottom: 0,
          width: width * 0.42,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <TextBlock
          scene={scene}
          P={P}
          look={look}
          ink={P.onPrimary}
          width={width * 0.4}
          base={140 * u}
          height={540 * u}
          delay={3}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: width * 0.5,
          top: height * 0.14,
          transform: `translateY(${drift}px)`,
        }}
      >
        <PhotoCard
          file={scene.image}
          focusX={scene.focusX}
          focusY={scene.focusY}
          width={width * (scene.image2 ? 0.3 : 0.42)}
          height={height * (scene.image2 ? 0.62 : 0.72)}
          tilt={-3}
          enter={a}
          length={length}
        />
      </div>
      {scene.image2 ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.7,
            top: height * 0.3,
            transform: `translateY(${drift * 1.8}px)`,
          }}
        >
          <PhotoCard
            file={scene.image2}
            width={width * 0.24}
            height={height * 0.5}
            tilt={4}
            enter={b}
            length={length}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

function StatementLayout({ scene, P, look }) {
  const { safe, u, inner, wide } = useLayout();
  return (
    <AbsoluteFill>
      <BrandField
        color={P.primary}
        accent={P.accent}
        look={look}
        word={scene.title.split(" ").at(-1)}
      />
      <AbsoluteFill
        style={{
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <TextBlock
          scene={scene}
          P={P}
          look={look}
          ink={P.onPrimary}
          width={wide ? inner * 0.8 : inner}
          base={(wide ? 180 : 200) * u}
          height={(wide ? 560 : 760) * u}
          delay={2}
          align="center"
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

const LAYOUTS = {
  full: FullLayout,
  split: SplitLayout,
  cards: CardsLayout,
  statement: StatementLayout,
};

/** The logo as a small bug in the corner from the second scene on. */
function LogoBug({ logo, from }) {
  const frame = useCurrentFrame();
  const { safe, u } = useLayout();
  if (!logo || frame < from) return null;
  const p = progress(frame, from, from + 12, EASE.out);
  return (
    <div
      style={{
        position: "absolute",
        top: safe.kind === "vertical" ? safe.top - 40 * u : safe.top * 0.55,
        ...(safe.kind === "vertical" ? { left: safe.left } : { right: safe.right * 0.7 }),
        width: 140 * u,
        height: 140 * u,
        opacity: p * 0.95,
        transform: `scale(${0.8 + 0.2 * p})`,
        filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.3))",
      }}
    >
      <Img src={staticFile(logo)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>
  );
}

export function Promo(props) {
  const { durationInFrames, width, height } = useVideoConfig();
  const look = props.style ?? "modern";
  const brand = { ...DEFAULT_PROPS.brand, ...props.brand };
  const P = makePalette({ primary: brand.primary, accent: brand.accent });
  const t = promoTimeline({ ...DEFAULT_PROPS, ...props });
  const track = props.scenes.map((scene, index) => {
    const Layout = LAYOUTS[layoutFor(scene, index)];
    return {
      frames: t.frames[index],
      transition: t.transitions[index],
      render: ({ length }) => (
        <Layout scene={scene} P={P} look={look} length={length} index={index} />
      ),
    };
  });
  track.push({
    frames: t.endFrames,
    transition: "zoom",
    render: () => (
      <EndCard
        brand={brand}
        palette={P}
        headline={props.cta.title}
        cta={props.cta.button ?? props.cta.subtitle}
        lines={props.cta.button && props.cta.subtitle ? [props.cta.subtitle] : []}
        look={look}
        pressAt={t.pressAt}
      />
    ),
  });
  const voiced = Boolean(props.voiceover);
  return (
    <AbsoluteFill style={{ backgroundColor: P.primaryDeep }}>
      <Track scenes={track} accent={P.accent} leak={tint(P.accent, 0.4)} />
      <Sequence from={t.frames[0]} durationInFrames={t.endStart - t.frames[0]} layout="none">
        <LogoBug logo={brand.logo} from={0} />
      </Sequence>
      <Vignette strength={0.28} />
      <AiVoicePill
        text={props.aiVoiceLabel}
        palette={P}
        corner={height / width > 1.6 ? "top-right" : "bottom-left"}
      />
      {props.draft ? null : <Grain opacity={0.05} />}
      {props.mix ? (
        // Voice and music mixed by render.mjs, the music ducked under the voice (kit/audio/duck.mjs).
        <Audio src={staticFile(props.mix)} />
      ) : (
        <>
          {props.score ? <Audio src={staticFile(props.score)} volume={voiced ? 0.42 : 1} /> : null}
          {props.music && !props.music.startsWith("generated:") && props.music !== "none" ? (
            <Audio
              src={staticFile(props.music)}
              volume={(f) =>
                interpolate(
                  f,
                  [0, 10, durationInFrames - 30, durationInFrames],
                  [0, voiced ? 0.3 : 0.85, voiced ? 0.3 : 0.85, 0],
                  clamp,
                )
              }
            />
          ) : null}
          {voiced ? (
            <Sequence from={12}>
              <Audio src={staticFile(props.voiceover)} />
            </Sequence>
          ) : null}
        </>
      )}
    </AbsoluteFill>
  );
}
