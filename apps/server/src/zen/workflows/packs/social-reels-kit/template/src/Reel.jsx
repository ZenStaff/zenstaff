// One reel: scenes cut on the beat with real transitions, kinetic headlines, depth (picture,
// type, texture), and the end card with a pressed call-to-action button. Every visual decision
// comes from the plan (look, brand colors, texts, media) through the shared premium kit.
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import {
  AiVoicePill,
  BrandField,
  EASE,
  EndCard,
  Grain,
  Icon,
  Kinetic,
  LOOKS,
  Label,
  LightLeak,
  Line,
  Media,
  PhotoCard,
  SPRING,
  Scrim,
  Track,
  Vignette,
  alpha,
  ensureFonts,
  palette as makePalette,
  progress,
  safeZone,
  shade,
  springAt,
  tint,
} from "../../kit/motion/index.js";
import { photoTops, reelLabelBox } from "./layout.js";
import { listItemDelay, offerBadgeDelay, reelTimeline } from "./schema.js";

ensureFonts();

function useLayout() {
  const { width, height } = useVideoConfig();
  const safe = safeZone(width, height);
  const inner = width - safe.left - safe.right;
  return { safe, inner, width, height, tall: safe.kind === "vertical", u: safe.unit };
}

/** Text block anchored low in the safe zone (where thumbs and eyes go on a phone). */
function Stack({ children, justify = "flex-end", align = "flex-start", gap = 26 }) {
  const { safe } = useLayout();
  return (
    <AbsoluteFill
      style={{
        padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify,
        alignItems: align,
        gap,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

const justifyFor = (scene, fallback = "flex-end") =>
  scene.place === "top"
    ? "flex-start"
    : scene.place === "center"
      ? "center"
      : scene.place === "bottom"
        ? "flex-end"
        : fallback;
const scrimFor = (scene) =>
  scene.place === "top" ? "top" : scene.place === "center" ? "full" : "bottom";

const moveFor = (scene, index) =>
  scene.move && scene.move !== "auto"
    ? scene.move
    : index === 0
      ? "punch"
      : index % 2
        ? "push"
        : "pull";

function Body({ text, look, color, size, delay, width }) {
  if (!text) return null;
  return (
    <Line delay={delay} style={{ ...LOOKS[look].body, fontSize: size, color, maxWidth: width }}>
      {text}
    </Line>
  );
}

function HookScene({ scene, P, look, length }) {
  const { inner, tall, u } = useLayout();
  const hasMedia = Boolean(scene.media);
  const ink = hasMedia ? P.paper : P.onPrimary;
  return (
    <AbsoluteFill>
      {hasMedia ? (
        <Media
          file={scene.media}
          focusX={scene.focusX}
          focusY={scene.focusY}
          start={scene.start}
          move={moveFor(scene, 0)}
          length={length}
        />
      ) : (
        <BrandField
          color={P.primary}
          accent={P.accent}
          word={scene.title?.split(" ")[0]}
          look={look}
        />
      )}
      {hasMedia ? <Scrim where={scrimFor(scene)} strength={0.92} color={P.primaryDeep} /> : null}
      <Stack justify={hasMedia ? justifyFor(scene) : "center"} gap={30 * u}>
        <Label
          text={scene.kicker}
          look={look}
          color={P.accent}
          delay={1}
          size={(tall ? 42 : 34) * u}
        />
        <Kinetic
          text={scene.title}
          look={look}
          color={ink}
          accentColor={P.accent}
          onAccent={P.onAccent}
          accent={scene.accent}
          box={{
            base: (look === "bold" ? 280 : 220) * (tall ? 1 : 0.75) * u,
            width: inner,
            height: (tall ? 640 : 440) * u,
          }}
          delay={0}
          step={2}
        />
        <Body
          text={scene.text}
          look={look}
          color={alpha(ink, 0.92)}
          size={(tall ? 50 : 40) * u}
          delay={14}
          width={inner}
        />
      </Stack>
      <LightLeak from={0} to={20} color={tint(P.accent, 0.25)} peak={0.42} />
    </AbsoluteFill>
  );
}

function PhotoScene({ scene, P, look, length, index }) {
  const { inner, tall, u, width, height } = useLayout();
  const frame = useCurrentFrame();
  // Bold and playful stay full-bleed; warm and elegant alternate with a framed, editorial layout.
  const framed = (look === "warm" || look === "elegant") && index % 2 === 0 && scene.media;
  if (framed) {
    const enter = progress(frame, 0, 18, EASE.out);
    return (
      <AbsoluteFill>
        <BrandField color={P.primary} accent={P.accent} look={look} />
        <div
          style={{ position: "absolute", left: width * 0.09, top: photoTops(width, height).framed }}
        >
          <PhotoCard
            file={scene.media}
            focusX={scene.focusX}
            focusY={scene.focusY}
            start={scene.start}
            width={width * 0.82}
            height={height * (tall ? 0.42 : 0.44)}
            tilt={look === "elegant" ? 0 : -2}
            enter={enter}
            length={length}
            radius={look === "elegant" ? 4 : 30}
          />
        </div>
        <Stack gap={22 * u}>
          <Label
            text={scene.kicker}
            look={look}
            color={P.accent}
            delay={3}
            size={(tall ? 38 : 30) * u}
          />
          <Kinetic
            text={scene.title}
            look={look}
            color={P.onPrimary}
            accentColor={P.accent}
            onAccent={P.onAccent}
            accent={scene.accent}
            box={{ base: (tall ? 150 : 110) * u, width: inner, height: 300 * u }}
            delay={3}
          />
          <Body
            text={scene.text}
            look={look}
            color={alpha(P.onPrimary, 0.88)}
            size={(tall ? 46 : 36) * u}
            delay={12}
            width={inner}
          />
        </Stack>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <Media
        file={scene.media}
        focusX={scene.focusX}
        focusY={scene.focusY}
        start={scene.start}
        move={moveFor(scene, index)}
        length={length}
      />
      <Scrim where={scrimFor(scene)} strength={0.9} color={P.primaryDeep} />
      <Stack justify={justifyFor(scene)} gap={24 * u}>
        <Label
          text={scene.kicker}
          look={look}
          color={P.accent}
          delay={2}
          size={(tall ? 40 : 32) * u}
        />
        <Kinetic
          text={scene.title}
          look={look}
          color={P.paper}
          accentColor={P.accent}
          onAccent={P.onAccent}
          accent={scene.accent}
          box={{
            base: (look === "bold" ? 190 : 160) * (tall ? 1 : 0.75) * u,
            width: inner,
            height: 420 * u,
          }}
          delay={2}
        />
        <Body
          text={scene.text}
          look={look}
          color={alpha(P.paper, 0.92)}
          size={(tall ? 48 : 38) * u}
          delay={12}
          width={inner}
        />
      </Stack>
    </AbsoluteFill>
  );
}

function ListItems({ items, P, look, beatFrames, ink, width }) {
  const { tall, u } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = LOOKS[look];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: (tall ? 24 : 16) * u, width }}>
      {items.map((item) => {
        const i = items.indexOf(item);
        const at = listItemDelay(i, beatFrames);
        const s = springAt(frame, fps, at, SPRING.snappy);
        const check = progress(frame, at + 3, at + 12, EASE.out);
        return (
          <div
            key={item}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 30 * u,
              padding: `${28 * u}px ${34 * u}px`,
              borderRadius: 24 * u,
              background: alpha(P.paper, 0.1),
              border: `${2 * u}px solid ${alpha(P.paper, 0.16)}`,
              transform: `translateX(${(1 - s) * -140}px)`,
              opacity: Math.min(1, s * 1.6),
            }}
          >
            <div
              style={{
                flex: "none",
                width: 80 * u,
                height: 80 * u,
                borderRadius: 80 * u,
                background: P.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `scale(${0.4 + 0.6 * check})`,
              }}
            >
              <Icon name="check" size={46 * u} color={P.onAccent} stroke={3} />
            </div>
            <div
              style={{
                ...L.body,
                fontWeight: 700,
                fontSize: (tall ? 64 : 48) * u,
                lineHeight: 1.1,
                color: ink,
              }}
            >
              {item}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListScene({ scene, P, look, length, beatFrames }) {
  const { inner, tall, u, height, safe } = useLayout();
  const items = scene.items ?? [];
  if (scene.media) {
    // Split: the picture fills the top, the list sits on the brand color below. No dead space.
    const photoH = height * (tall ? 0.44 : 0.4);
    return (
      <AbsoluteFill style={{ backgroundColor: P.primary }}>
        <BrandField color={P.primary} accent={P.accent} look={look} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: photoH,
            overflow: "hidden",
          }}
        >
          <Media
            file={scene.media}
            focusX={scene.focusX}
            focusY={scene.focusY}
            start={scene.start}
            move="push"
            length={length}
          />
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, ${alpha(P.primary, 0)} 55%, ${alpha(P.primary, 1)} 100%)`,
            }}
          />
        </div>
        <AbsoluteFill
          style={{
            padding: `${photoH - 150 * u}px ${safe.right}px ${safe.bottom - 40 * u}px ${safe.left}px`,
            display: "flex",
            flexDirection: "column",
            gap: 34 * u,
          }}
        >
          <Label
            text={scene.kicker}
            look={look}
            color={P.accent}
            delay={1}
            size={(tall ? 40 : 32) * u}
          />
          <Kinetic
            text={scene.title}
            look={look}
            color={P.onPrimary}
            accentColor={P.accent}
            onAccent={P.onAccent}
            accent={scene.accent ?? -1}
            box={{
              base: (look === "bold" ? 190 : 150) * (tall ? 1 : 0.75) * u,
              width: inner,
              height: 260 * u,
            }}
            delay={1}
          />
          <ListItems
            items={items}
            P={P}
            look={look}
            beatFrames={beatFrames}
            ink={P.onPrimary}
            width={inner}
          />
          <Body
            text={scene.text}
            look={look}
            color={alpha(P.onPrimary, 0.85)}
            size={(tall ? 42 : 32) * u}
            delay={listItemDelay(items.length, beatFrames)}
            width={inner}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <BrandField color={P.primary} accent={P.accent} look={look} />
      <Stack justify="center" gap={48 * u}>
        <Label
          text={scene.kicker}
          look={look}
          color={P.accent}
          delay={1}
          size={(tall ? 40 : 32) * u}
        />
        <Kinetic
          text={scene.title}
          look={look}
          color={P.onPrimary}
          accentColor={P.accent}
          onAccent={P.onAccent}
          accent={scene.accent ?? -1}
          box={{
            base: (look === "bold" ? 220 : 170) * (tall ? 1 : 0.75) * u,
            width: inner,
            height: 420 * u,
          }}
          delay={1}
        />
        <ListItems
          items={items}
          P={P}
          look={look}
          beatFrames={beatFrames}
          ink={P.onPrimary}
          width={inner}
        />
        <Body
          text={scene.text}
          look={look}
          color={alpha(P.onPrimary, 0.85)}
          size={(tall ? 42 : 32) * u}
          delay={listItemDelay(items.length, beatFrames)}
          width={inner}
        />
      </Stack>
    </AbsoluteFill>
  );
}

function OfferScene({ scene, P, look, length, beatFrames }) {
  const { inner, tall, u, width, height } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = LOOKS[look];
  const enter = progress(frame, 0, 18, EASE.out);
  const badgeAt = offerBadgeDelay(beatFrames);
  const stamp = springAt(frame, fps, badgeAt, SPRING.heavy);
  return (
    <AbsoluteFill>
      <BrandField color={P.primary} accent={P.accent} look={look} />
      {scene.media ? (
        <div
          style={{ position: "absolute", left: width * 0.1, top: photoTops(width, height).offer }}
        >
          <PhotoCard
            file={scene.media}
            focusX={scene.focusX}
            focusY={scene.focusY}
            start={scene.start}
            width={width * 0.8}
            height={height * (tall ? 0.33 : 0.3)}
            tilt={look === "elegant" ? 0 : 2.5}
            enter={enter}
            length={length}
            radius={look === "elegant" ? 4 : 28}
          />
        </div>
      ) : null}
      <Stack gap={18 * u}>
        <Label
          text={scene.kicker ?? scene.note}
          look={look}
          color={P.accent}
          delay={2}
          size={(tall ? 40 : 32) * u}
        />
        <Kinetic
          text={scene.title}
          look={look}
          color={P.onPrimary}
          accentColor={P.accent}
          onAccent={P.onAccent}
          accent={scene.accent ?? -1}
          box={{
            base: (look === "bold" ? 150 : 120) * (tall ? 1 : 0.75) * u,
            width: inner,
            height: 240 * u,
          }}
          delay={2}
        />
        {scene.badge ? (
          <div
            style={{
              ...L.numbers,
              fontSize: (tall ? 300 : 210) * u,
              lineHeight: 0.9,
              color: P.accent,
              textShadow: `0 ${10 * u}px 40px ${alpha(shade(P.primary, 0.6), 0.6)}`,
              whiteSpace: "nowrap",
              transform: `scale(${0.5 + 0.5 * stamp}) rotate(${(1 - stamp) * -8}deg)`,
              transformOrigin: "left center",
              opacity: Math.min(1, stamp * 2),
            }}
          >
            {scene.badge}
          </div>
        ) : null}
        <Body
          text={scene.text}
          look={look}
          color={alpha(P.onPrimary, 0.9)}
          size={(tall ? 42 : 34) * u}
          delay={badgeAt + 8}
          width={inner}
        />
        {scene.note && scene.kicker ? (
          <Line
            delay={badgeAt + 12}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14 * u,
              ...L.body,
              fontWeight: 700,
              fontSize: (tall ? 36 : 30) * u,
              color: P.accent,
            }}
          >
            <Icon name="clock" size={36 * u} color={P.accent} />
            {scene.note}
          </Line>
        ) : null}
      </Stack>
    </AbsoluteFill>
  );
}

function QuoteScene({ scene, P, look }) {
  const { inner, tall, u } = useLayout();
  const quoteLook = look === "bold" || look === "playful" ? "warm" : look;
  return (
    <AbsoluteFill>
      <BrandField color={P.primary} accent={P.accent} look={look} />
      <Stack justify="center" gap={34 * u}>
        <Line delay={0} dy={10}>
          <Icon name="quote" size={120 * u} color={P.accent} stroke={1.6} />
        </Line>
        <Kinetic
          text={scene.text}
          look={quoteLook}
          color={P.onPrimary}
          accentColor={P.accent}
          onAccent={P.onAccent}
          accent={-1}
          preset="lift"
          step={2}
          box={{ base: (tall ? 92 : 74) * u, width: inner, height: 640 * u }}
          delay={4}
          shadow={false}
        />
        {scene.author ? (
          <Line
            delay={20}
            style={{ ...LOOKS[look].label, fontSize: (tall ? 32 : 26) * u, color: P.accent }}
          >
            {scene.author}
          </Line>
        ) : null}
      </Stack>
    </AbsoluteFill>
  );
}

function StatementScene({ scene, P, look }) {
  const { inner, tall, u } = useLayout();
  return (
    <AbsoluteFill>
      <BrandField
        color={P.primary}
        accent={P.accent}
        word={scene.title?.split(" ").at(-1)}
        look={look}
      />
      <Stack justify="center" gap={30 * u}>
        <Label
          text={scene.kicker}
          look={look}
          color={P.accent}
          delay={1}
          size={(tall ? 42 : 34) * u}
        />
        <Kinetic
          text={scene.title}
          look={look}
          color={P.onPrimary}
          accentColor={P.accent}
          onAccent={P.onAccent}
          accent={scene.accent}
          box={{
            base: (look === "bold" ? 260 : 210) * (tall ? 1 : 0.75) * u,
            width: inner,
            height: 700 * u,
          }}
          delay={1}
        />
        <Body
          text={scene.text}
          look={look}
          color={alpha(P.onPrimary, 0.9)}
          size={(tall ? 44 : 36) * u}
          delay={16}
          width={inner}
        />
      </Stack>
    </AbsoluteFill>
  );
}

const SCENES = {
  hook: HookScene,
  photo: PhotoScene,
  list: ListScene,
  offer: OfferScene,
  quote: QuoteScene,
  statement: StatementScene,
};

export function Reel(props) {
  const { brand, scenes, end, style: look, audio, music, mix, draft } = props;
  const { width, height } = useVideoConfig();
  const timeline = reelTimeline(props);
  const P = makePalette({
    primary: brand.primary,
    accent: brand.accent,
    dark: brand.dark,
    light: brand.light,
  });
  const track = scenes.map((scene, index) => {
    const Scene = SCENES[scene.type] ?? PhotoScene;
    return {
      frames: timeline.frames[index],
      transition: timeline.transitions[index],
      render: ({ length }) => (
        <Scene
          scene={scene}
          P={P}
          look={look}
          length={length}
          index={index}
          beatFrames={timeline.beatFrames}
        />
      ),
    };
  });
  track.push({
    frames: timeline.endFrames,
    transition: timeline.endTransition,
    render: () => (
      <EndCard
        brand={brand}
        palette={P}
        cta={end.title}
        lines={end.lines}
        look={look}
        pressAt={timeline.pressAt}
      />
    ),
  });
  return (
    <AbsoluteFill style={{ backgroundColor: P.primaryDeep }}>
      <Track scenes={track} accent={P.accent} leak={tint(P.accent, 0.4)} />
      <Vignette strength={0.3} />
      {draft ? null : <Grain opacity={0.055} />}
      {/* The AI-voice label, for the whole reel, clear of every text zone (layout.js). */}
      <AiVoicePill
        text={props.aiVoiceLabel}
        palette={P}
        box={props.aiVoiceLabel ? reelLabelBox(width, height, props.aiVoiceLabel) : undefined}
      />
      {mix ? (
        // Voice-over and music in one track, the music ducked under the voice (render.mjs).
        <Audio src={staticFile(mix)} />
      ) : (
        <>
          {audio ? <Audio src={staticFile(audio)} /> : null}
          {music ? <Audio src={staticFile(music)} volume={0.85} /> : null}
        </>
      )}
    </AbsoluteFill>
  );
}
