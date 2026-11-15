// The end card every video in the packs closes on: the logo (or the name) lands, the call to
// action appears as a real button that gets "pressed" on a beat, and the contact lines follow with
// line icons. Built on the brand background with depth (BrandField), inside the safe zone.
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ICONS, contactIcon } from "../common/icons.js";
import { readable, tint } from "../common/color.js";
import { LOOKS, fitSize } from "../common/type.js";
import { EASE, SPRING, clamp, progress, safeZone, springAt } from "./core.js";
import { Kinetic } from "./text.jsx";
import { BrandField, Grain, LightLeak } from "./layers.jsx";

export function Icon({ name, size = 40, color = "currentColor", stroke = 2 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The icon bodies are static strings from common/icons.js (Lucide), never user input.
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS["arrow-right"] }}
    />
  );
}

/**
 * brand: { name, logo?, palette (from common/color palette()) }
 * cta: the button text ("Rezervă o masă"); headline: an optional line above it (an offer);
 * lines: up to 3 contact lines; label: a small note in the corner (the AI-voice notice).
 * pressAt: frame of the button press (on a beat); the template plays a click there.
 */
export function EndCard({
  brand,
  palette,
  cta,
  headline,
  lines = [],
  look = "bold",
  pressAt = 34,
  logoScale = 1,
  label,
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const safe = safeZone(width, height);
  const L = LOOKS[look] ?? LOOKS.bold;
  const unit = safe.unit;
  const vertical = safe.kind === "vertical" || safe.kind === "portrait";
  const bg = palette.primary;
  const ink = readable(bg, [palette.paper, palette.ink], 4.5);
  const logoIn = springAt(frame, fps, 0, SPRING.heavy);
  const logoOpacity = Math.min(1, 0.55 + logoIn);
  const reveal = progress(frame, 0, 10, EASE.out);
  const ctaIn = springAt(frame, fps, 5, SPRING.snappy);
  const pulse =
    frame > pressAt + 5 ? 1 + 0.018 * Math.sin(((frame - pressAt) / 30) * Math.PI * 2) : 1;
  const press = interpolate(frame - pressAt, [-2, 0, 5], [1, 0.93, 1], clamp) * pulse;
  const ripple = progress(frame, pressAt, pressAt + 16, EASE.out);
  const logoSize = (vertical ? 520 : 340) * unit * logoScale * (headline ? 0.75 : 1);
  const nameSize = fitSize(brand.name, {
    base: (vertical ? 150 : 120) * unit,
    maxWidth: width - safe.left - safe.right,
    maxHeight: 260 * unit,
    charWidth: L.charWidth,
    lineHeight: L.display.lineHeight,
  });
  const ctaSize = (vertical ? 70 : 52) * unit;
  return (
    <AbsoluteFill>
      <BrandField color={bg} accent={palette.accent} word={brand.name} look={look} />
      <AbsoluteFill
        style={{
          padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 64 * unit,
          clipPath: `circle(${40 + reveal * 110}% at 50% 45%)`,
        }}
      >
        {brand.logo ? (
          <div
            style={{
              width: logoSize,
              height: logoSize,
              transform: `scale(${0.82 + 0.18 * logoIn})`,
              opacity: logoOpacity,
              filter: "drop-shadow(0 24px 40px rgba(0,0,0,0.28))",
            }}
          >
            <Img
              src={staticFile(brand.logo)}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        ) : (
          <div
            style={{
              ...L.display,
              fontSize: nameSize,
              color: ink,
              textAlign: "center",
              transform: `translateY(${(1 - logoIn) * 60}px)`,
              opacity: logoIn,
            }}
          >
            {brand.name}
          </div>
        )}
        {headline ? (
          <Kinetic
            text={headline}
            look={look}
            color={ink}
            accentColor={palette.accent}
            onAccent={palette.onAccent}
            align="center"
            delay={3}
            box={{
              base: (vertical ? 150 : 120) * unit,
              width: width - safe.left - safe.right,
              height: (vertical ? 380 : 260) * unit,
            }}
          />
        ) : null}
        {cta ? (
          <div
            style={{
              position: "relative",
              transform: `translateY(${(1 - ctaIn) * 80}px) scale(${press})`,
              opacity: ctaIn,
            }}
          >
            {ripple > 0 && ripple < 1 ? (
              <div
                style={{
                  position: "absolute",
                  inset: -24 * ripple * unit,
                  borderRadius: 999,
                  border: `${4 * unit}px solid ${palette.accent}`,
                  opacity: 1 - ripple,
                }}
              />
            ) : null}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: ctaSize * 0.5,
                padding: `${ctaSize * 0.52}px ${ctaSize * 0.95}px`,
                borderRadius: 999,
                background: palette.accent,
                color: palette.onAccent,
                ...L.label,
                letterSpacing: "0.04em",
                textTransform: "none",
                fontFamily: L.body.fontFamily,
                fontWeight: 800,
                fontSize: ctaSize,
                boxShadow: `0 20px 50px rgba(0,0,0,0.3), inset 0 -4px 0 rgba(0,0,0,0.12)`,
                whiteSpace: "nowrap",
              }}
            >
              {cta}
              <Icon
                name="arrow-right"
                size={ctaSize * 1.05}
                color={palette.onAccent}
                stroke={2.6}
              />
            </div>
          </div>
        ) : null}
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 * unit }}
        >
          {lines.slice(0, 3).map((line) => {
            const i = lines.indexOf(line);
            const p = progress(frame, 12 + i * 3, 24 + i * 3, EASE.out);
            return (
              <div
                key={line}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16 * unit,
                  ...L.body,
                  fontWeight: 600,
                  fontSize: (vertical ? 50 : 38) * unit,
                  color: ink,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 24}px)`,
                }}
              >
                <Icon
                  name={contactIcon(line)}
                  size={(vertical ? 44 : 34) * unit}
                  color={tint(palette.accent, 0.1)}
                />
                {line}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {label ? (
        <div
          style={{
            position: "absolute",
            right: safe.right,
            bottom: safe.kind === "vertical" ? safe.bottom - 70 * unit : 36 * unit,
            ...L.label,
            fontFamily: L.body.fontFamily,
            letterSpacing: "0.06em",
            textTransform: "none",
            fontSize: 22 * unit,
            color: ink,
            opacity: 0.7,
          }}
        >
          {label}
        </div>
      ) : null}
      <LightLeak from={0} to={18} color={tint(palette.accent, 0.35)} peak={0.25} />
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
}
