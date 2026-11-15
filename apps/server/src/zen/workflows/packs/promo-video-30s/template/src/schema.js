// props.json schema (zod) and the promo's timeline, shared by the Remotion bundle and render.mjs.
// Older props files (format, seconds, brand, scenes{title,text,image}, cta, music, voiceover) stay
// valid: everything new has a default.
import { MOODS } from "../../kit/audio/sound.mjs";
import { snapToBeats } from "../../kit/motion/beats.js";

export const FPS = 30;
export const SIZES = {
  landscape: [1920, 1080],
  vertical: [1080, 1920],
  square: [1080, 1080],
};
export const LOOKS_FOR_PROMO = ["bold", "elegant", "warm", "modern"];
export const LAYOUTS = ["auto", "full", "split", "cards", "statement"];

export function makeSchemas(z) {
  const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #1A2B3C.");
  const file = z
    .string()
    .min(1)
    .refine(
      (value) => !value.includes("..") && !value.startsWith("/") && !/^[a-zA-Z]:/.test(value),
      {
        message: "Use a plain file name inside the public folder.",
      },
    );
  const short = (max) => z.string().max(max, `Keep it under ${max} characters.`);
  const scene = z.object({
    title: short(52),
    text: short(120).optional(),
    kicker: short(30).optional(),
    image: file.optional(),
    /** A second picture for the "cards" layout. */
    image2: file.optional(),
    focusX: z.number().min(0).max(100).default(50),
    focusY: z.number().min(0).max(100).default(50),
    layout: z.enum(LAYOUTS).default("auto"),
    /** Index of the title word to highlight; -1 for none. */
    accent: z.number().int().min(-1).max(12).optional(),
  });
  const props = z.object({
    format: z.enum(Object.keys(SIZES)).default("landscape"),
    seconds: z.number().min(10).max(60).default(30),
    style: z.enum(LOOKS_FOR_PROMO).default("modern"),
    brand: z.object({
      name: short(40).default("Your brand"),
      primary: color.default("#0F4C5C"),
      accent: color.default("#F2C14E"),
      background: color.optional(),
      text: color.optional(),
      logo: file.optional(),
    }),
    scenes: z.array(scene).min(2).max(5),
    cta: z.object({
      title: short(48),
      subtitle: short(48).optional(),
      button: short(28).optional(),
    }),
    /** A music file in the public folder, "generated:<mood>" or "none". */
    music: z.string().default("generated:upbeat"),
    voiceover: file.optional(),
    aiVoiceLabel: z.string().max(80).optional(),
    /** Filled by render.mjs. */
    score: z.string().optional(),
    /** Filled by render.mjs with a voice-over: voice + ducked music in one track. */
    mix: z.string().optional(),
    draft: z.boolean().default(false),
  });
  return { props, scene };
}

export const promoBpm = (music) => {
  const mood = String(music ?? "").startsWith("generated:") ? music.slice(10) : null;
  return mood && MOODS[mood] ? MOODS[mood].bpm : 110;
};

/**
 * Scene lengths (on the beat) for a total length: the opening is short and punchy, the middle
 * scenes share the rest, the call to action gets about a sixth (at least 4.5 s).
 */
export function promoTimeline(props) {
  const bpm = promoBpm(props.music);
  const total = Math.round((props.seconds ?? 30) * FPS);
  const beat = 60 / bpm;
  const ctaSeconds = Math.max(4.5, (props.seconds ?? 30) / 6);
  const ctaFrames = Math.round(Math.round(ctaSeconds / beat) * beat * FPS);
  const n = props.scenes.length;
  const opening = Math.min(3.6, (props.seconds ?? 30) * 0.13);
  const rest = (total - ctaFrames) / FPS - opening;
  const wished = [opening, ...Array.from({ length: n - 1 }, () => rest / (n - 1))];
  const frames = snapToBeats(wished, { bpm, fps: FPS, minBeats: 4, barBeats: 1 });
  const used = frames.reduce((a, b) => a + b, 0);
  const endFrames = Math.max(Math.round(4 * beat * FPS), total - used);
  const transitions = props.scenes.map((_, i) =>
    i === 0 ? "cut" : ["push", "whip", "wipe", "zoom"][(i - 1) % 4],
  );
  const cues = [];
  let t = 0;
  frames.forEach((f, i) => {
    if (i > 0)
      cues.push({ t: Math.max(0, t / FPS - 0.16), kind: "whoosh", pan: i % 2 ? 0.25 : -0.25 });
    t += f;
  });
  cues.push({ t: Math.max(0, t / FPS - 0.16), kind: "whoosh" });
  const pressAt = Math.round(6 * beat * FPS);
  cues.push({ t: (t + pressAt) / FPS, kind: "click" });
  return { bpm, frames, transitions, endStart: t, endFrames, pressAt, total: t + endFrames, cues };
}

/** The layout each scene gets when the props say "auto": varied, and always with a picture when there is one. */
export function layoutFor(scene, index) {
  if (scene.layout && scene.layout !== "auto")
    return scene.image || scene.layout === "statement" ? scene.layout : "statement";
  if (!scene.image) return index === 0 ? "full" : "statement";
  if (index === 0) return "full";
  return ["split", "cards", "full", "split"][(index - 1) % 4];
}
