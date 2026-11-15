// The tutorial edited like a Screen Studio recording: the recording in a rounded window on the
// brand background, a camera that zooms to the action, an eased cursor with click ripples, a
// lower third per step, captions under the window, branded intro and outro.
import {
  AbsoluteFill,
  Audio,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  AiVoicePill,
  BrandField,
  Captions,
  EASE,
  EndCard,
  Grain,
  Kinetic,
  LOOKS,
  Label,
  Line,
  SPRING,
  Track,
  alpha,
  clamp,
  ensureFonts,
  evenWords,
  palette as makePalette,
  progress,
  safeZone,
  springAt,
} from "../../kit/motion/index.js";
import { cameraAt, cameraKeys, cursorAt } from "./camera.js";
import { tutorialOverlay, windowBox } from "./layout.js";

export { windowBox };

ensureFonts();
const FPS = 30;

function Cursor({ x, y, size, pressed }) {
  return (
    <svg
      width={size}
      height={size * 1.3}
      viewBox="0 0 28 36"
      style={{
        position: "absolute",
        left: x - size * 0.08,
        top: y - size * 0.06,
        transform: `scale(${pressed})`,
        transformOrigin: "10% 6%",
        filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.35))",
        zIndex: 30,
      }}
    >
      <path
        d="M2 2 L2 28 L9 21 L14 33 L19 31 L14 19 L24 19 Z"
        fill="#111"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The recording with camera, cursor, clicks and highlights, inside the window. */
function Screen({ body, events, keys, w, h, accent, seconds }) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cam = cameraAt(keys, t);
  const pos = cursorAt(events, t);
  const tx = (0.5 - cam.x) * w * cam.scale;
  const ty = (0.5 - cam.y) * h * cam.scale;
  let pressed = 1;
  const ripples = [];
  const highlights = [];
  for (const e of events) {
    if (e.kind === "click") {
      const d = t - e.t;
      if (d > -0.12 && d < 0.2)
        pressed = Math.min(pressed, interpolate(d, [-0.12, 0, 0.2], [1, 0.82, 1], clamp));
      if (d >= 0 && d < 0.6) ripples.push({ x: e.x, y: e.y, p: d / 0.6 });
    }
    if (e.kind === "highlight" && e.box && t >= e.t && t < (e.until ?? e.t + 2.5))
      highlights.push({ box: e.box, p: Math.min(1, (t - e.t) / 0.35) });
  }
  const cursorSize = 30 * (w / 1536);
  const visible = t < seconds;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#fff" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${tx}px, ${ty}px) scale(${cam.scale})`,
          transformOrigin: "50% 50%",
        }}
      >
        <OffthreadVideo
          src={staticFile(body)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {highlights.map((hl) => (
          <div
            key={`h${hl.box.x}:${hl.box.y}`}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            <div
              style={{
                position: "absolute",
                left: hl.box.x * w - 8,
                top: hl.box.y * h - 8,
                width: hl.box.width * w + 16,
                height: hl.box.height * h + 16,
                borderRadius: 12,
                border: `${3}px solid ${accent}`,
                boxShadow: `0 0 0 9999px rgba(10,12,16,${0.32 * hl.p}), 0 0 24px ${alpha(accent, 0.6)}`,
                opacity: hl.p,
              }}
            />
          </div>
        ))}
        {ripples.map((r) => {
          const s = 26 + r.p * 46;
          return (
            <div
              key={`r${r.x}:${r.y}`}
              style={{
                position: "absolute",
                left: r.x * w - s / 2,
                top: r.y * h - s / 2,
                width: s,
                height: s,
                borderRadius: "50%",
                border: `4px solid ${accent}`,
                background: alpha(accent, 0.18 * (1 - r.p)),
                opacity: 1 - r.p,
              }}
            />
          );
        })}
        {visible ? (
          <Cursor
            x={pos.x * w}
            y={pos.y * h}
            size={(cursorSize / cam.scale) * Math.min(cam.scale, 1.3)}
            pressed={pressed}
          />
        ) : null}
      </div>
    </div>
  );
}

function WindowFrame({ children, box, url, P, vertical }) {
  const { w, h, bar, radius } = box;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: w,
        height: h + bar,
        borderRadius: radius,
        overflow: "hidden",
        boxShadow: "0 40px 90px rgba(0,0,0,0.35), 0 10px 26px rgba(0,0,0,0.2)",
        background: "#F3F2EF",
        border: `1px solid ${alpha("#000000", 0.08)}`,
      }}
    >
      {vertical ? (
        <div style={{ height: bar, background: "#F3F2EF" }} />
      ) : (
        <div
          style={{
            height: bar,
            display: "flex",
            alignItems: "center",
            gap: bar * 0.22,
            padding: `0 ${bar * 0.45}px`,
            background: "#F3F2EF",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          {["close", "minimise", "zoom"].map((name) => (
            <div
              key={name}
              style={{
                width: bar * 0.3,
                height: bar * 0.3,
                borderRadius: "50%",
                background: "#E4E2DC",
                border: "1px solid rgba(0,0,0,0.08)",
              }}
            />
          ))}
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div
              style={{
                minWidth: w * 0.3,
                padding: `${bar * 0.12}px ${bar * 0.5}px`,
                borderRadius: 999,
                background: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.07)",
                textAlign: "center",
                fontFamily: LOOKS.modern.body.fontFamily,
                fontSize: bar * 0.38,
                color: P.muted,
              }}
            >
              {url}
            </div>
          </div>
          <div style={{ width: bar * 1.5 }} />
        </div>
      )}
      <div style={{ position: "relative", width: w, height: h }}>{children}</div>
    </div>
  );
}

/** "2 · Alege zona": the step's lower third, sliding in at the step start. */
function LowerThird({ steps, P, box, look }) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const index = steps.findIndex((s) => t >= s.start && t < s.end);
  if (index < 0) return null;
  const step = steps[index];
  if (!step.title) return null;
  const local = Math.round((t - step.start) * FPS);
  const left = Math.round((step.end - t) * FPS);
  const p = Math.min(progress(local, 0, 12, EASE.out), progress(left, 0, 8, EASE.out));
  const u = box.w / 1536;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x + 24 * u,
        top: box.y + box.bar + box.h - 104 * u,
        display: "flex",
        alignItems: "center",
        gap: 14 * u,
        padding: `${12 * u}px ${22 * u}px ${12 * u}px ${12 * u}px`,
        borderRadius: 999,
        background: alpha(P.ink, 0.86),
        boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
        transform: `translateX(${(1 - p) * -40}px)`,
        opacity: p,
        zIndex: 40,
      }}
    >
      <div
        style={{
          width: 56 * u,
          height: 56 * u,
          borderRadius: "50%",
          background: P.accent,
          color: P.onAccent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: LOOKS[look].numbers.fontFamily,
          fontWeight: 700,
          fontSize: 30 * u,
        }}
      >
        {index + 1}
      </div>
      <div
        style={{
          ...LOOKS[look].body,
          fontWeight: 700,
          fontSize: 34 * u,
          color: P.paper,
          whiteSpace: "nowrap",
        }}
      >
        {step.title}
      </div>
    </div>
  );
}

function Intro({ props, P }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const safe = safeZone(width, height);
  const u = safe.unit;
  const vertical = height > width;
  const box = windowBox(width, height);
  const enter = springAt(frame, fps, 6, SPRING.soft);
  const textWidth = vertical ? width - safe.left - safe.right : width * 0.46;
  const preview = vertical
    ? {
        left: width * 0.16,
        top: height * 0.5,
        w: width * 0.68,
        h: width * 0.68 * (box.h / box.w),
        rot: "rotateX(18deg) rotateZ(-4deg)",
      }
    : {
        left: width * 0.56,
        top: height * 0.2,
        w: width * 0.52,
        h: width * 0.52 * (box.h / box.w),
        rot: "rotateY(-24deg) rotateX(6deg)",
      };
  return (
    <AbsoluteFill>
      <BrandField color={P.primary} accent={P.accent} look="modern" />
      <div
        style={{
          position: "absolute",
          left: preview.left,
          top: preview.top,
          width: preview.w,
          height: preview.h + box.bar,
          borderRadius: box.radius,
          overflow: "hidden",
          background: "#F3F2EF",
          boxShadow: "0 50px 100px rgba(0,0,0,0.45)",
          transform: `perspective(2200px) ${preview.rot} translateX(${(1 - enter) * 260 * u}px)`,
          opacity: Math.min(1, enter * 1.4),
        }}
      >
        <div style={{ height: box.bar }} />
        <Freeze frame={0}>
          <OffthreadVideo
            src={staticFile(props.body)}
            muted
            style={{ width: "100%", height: preview.h, objectFit: "cover" }}
          />
        </Freeze>
      </div>
      <AbsoluteFill
        style={{
          padding: `${safe.top}px ${safe.right}px ${vertical ? height * 0.5 : safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 30 * u,
        }}
      >
        <Label
          text={props.kicker}
          look="modern"
          color={P.accent}
          delay={2}
          size={(vertical ? 38 : 30) * u}
        />
        <Kinetic
          text={props.title}
          look="modern"
          color={P.onPrimary}
          accentColor={P.accent}
          onAccent={P.onAccent}
          box={{
            base: (vertical ? 150 : 140) * u,
            width: textWidth,
            height: (vertical ? 480 : 440) * u,
          }}
          delay={3}
        />
        {props.subtitle ? (
          <Line
            delay={14}
            style={{
              ...LOOKS.modern.body,
              fontSize: (vertical ? 44 : 36) * u,
              color: alpha(P.onPrimary, 0.88),
              maxWidth: textWidth,
            }}
          >
            {props.subtitle}
          </Line>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Body({ props, P }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const box = windowBox(width, height);
  const vertical = height > width;
  const enter = springAt(frame, fps, 0, SPRING.soft);
  const keys = cameraKeys(props.events, { duration: props.bodySeconds });
  return (
    <AbsoluteFill>
      <BrandField color={P.primary} accent={P.accent} look="modern" drift={0.4} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `perspective(2400px) translateY(${(1 - enter) * 120}px) rotateX(${(1 - enter) * 10}deg) scale(${0.94 + 0.06 * enter})`,
          transformOrigin: "50% 80%",
        }}
      >
        <WindowFrame box={box} url={props.domain} P={P} vertical={vertical}>
          <Screen
            body={props.body}
            events={props.events}
            keys={keys}
            w={box.w}
            h={box.h}
            accent={P.accent}
            seconds={props.bodySeconds}
          />
        </WindowFrame>
        <LowerThird steps={props.steps} P={P} box={box} look="modern" />
      </div>
    </AbsoluteFill>
  );
}

export function Tutorial(props) {
  const P = makePalette({ primary: props.brand.primary, accent: props.brand.accent });
  const intro = Math.round(props.introSeconds * FPS);
  const body = Math.round(props.bodySeconds * FPS);
  const outro = Math.round(props.outroSeconds * FPS);
  const words = (props.cues ?? []).flatMap((cue) => evenWords(cue.text, cue.s, cue.e));
  const { width, height } = useVideoConfig();
  const overlay = tutorialOverlay(width, height, props.aiNote);
  const track = [
    { frames: intro, transition: "cut", render: () => <Intro props={props} P={P} /> },
    { frames: body, transition: "push", render: () => <Body props={props} P={P} /> },
    {
      frames: outro,
      transition: "zoom",
      render: () => (
        <EndCard
          brand={{ name: props.brand.name ?? props.title, logo: props.brand.logo }}
          palette={P}
          headline={props.outro.title}
          cta={props.outro.button}
          lines={props.outro.lines ?? []}
          look="modern"
          pressAt={30}
        />
      ),
    },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: P.primaryDeep }}>
      <Track scenes={track} accent={P.accent} />
      {props.captions === false ? null : (
        // Captions belong to the screen part: they end before the outro.
        <Sequence durationInFrames={intro + body - 6} layout="none">
          <Captions words={words} palette={P} band={overlay.band} />
        </Sequence>
      )}
      <AiVoicePill
        text={props.aiNote}
        palette={P}
        box={overlay.label ?? undefined}
        corner={props.format === "vertical" ? "top-left" : "bottom-right"}
      />
      {props.draft ? null : <Grain opacity={0.035} />}
      {props.mix ? (
        // Voice and music mixed and ducked by compose.mjs (kit/audio/duck.mjs).
        <Audio src={staticFile(props.mix)} />
      ) : (
        <>
          <Audio src={staticFile(props.narration)} />
          {props.score ? <Audio src={staticFile(props.score)} /> : null}
        </>
      )}
    </AbsoluteFill>
  );
}

export const tutorialFrames = (props) =>
  Math.round((props.introSeconds + props.bodySeconds + props.outroSeconds) * FPS);
export { Sequence };
