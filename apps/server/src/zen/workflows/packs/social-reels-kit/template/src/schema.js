// The reel plan schema (zod) and the timeline every render shares. One function so the Remotion
// bundle and render.mjs use the same rules while each passes its own copy of zod (the template has
// no node_modules of its own).
import { MOODS } from "../../kit/audio/sound.mjs";
import { snapToBeats } from "../../kit/motion/beats.js";

export const FORMATS = {
  vertical: [1080, 1920],
  portrait: [1080, 1350],
  square: [1080, 1080],
};
export const STYLES = ["bold", "elegant", "warm", "playful"];
export const SCENE_TYPES = ["hook", "photo", "list", "offer", "quote", "statement"];
export const TRANSITION_NAMES = ["auto", "whip", "zoom", "push", "wipe", "fade", "flash", "cut"];
export const FPS = 30;
/** Tempo used to place cuts when the music is the person's own file or none. */
export const DEFAULT_BPM = 110;

/** The transition each look uses when the plan says "auto", in order (repeats). */
const AUTO = {
  bold: ["whip", "zoom", "whip", "push", "zoom"],
  elegant: ["fade", "push", "fade", "flash", "fade"],
  warm: ["push", "wipe", "fade", "push", "flash"],
  playful: ["zoom", "whip", "push", "zoom", "wipe"],
};

export function makeSchemas(z) {
  const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #1A2B3C.");
  const file = z
    .string()
    .min(1)
    .refine(
      (value) => !value.includes("..") && !value.startsWith("/") && !/^[a-zA-Z]:/.test(value),
      { message: "Use a plain file name from the media folder." },
    );
  const short = (max) => z.string().max(max, `Keep it under ${max} characters.`);

  const scene = z.object({
    type: z.enum(SCENE_TYPES),
    media: file.optional(),
    /** Where the interesting part of the photo is, in % (50/50 = center). */
    focusX: z.number().min(0).max(100).default(50),
    focusY: z.number().min(0).max(100).default(50),
    /** For video clips: the second to start from. */
    start: z.number().min(0).default(0),
    seconds: z.number().min(1.2).max(8).default(3),
    kicker: short(28).optional(),
    title: short(48).optional(),
    text: short(110).optional(),
    items: z.array(short(36)).max(4).optional(),
    badge: short(14).optional(),
    note: short(60).optional(),
    author: short(40).optional(),
    /** Index of the title word to highlight; -1 for none. Default: the last word. */
    accent: z.number().int().min(-1).max(12).optional(),
    /** Camera move on the photo: punch (fast land), push, pull, pan, still. */
    move: z.enum(["auto", "punch", "push", "pull", "pan", "still"]).default("auto"),
    transition: z.enum(TRANSITION_NAMES).default("auto"),
    /** Where the words sit: keep them off the face or the product. */
    place: z.enum(["auto", "bottom", "top", "center"]).default("auto"),
  });

  const brand = z.object({
    name: short(40),
    primary: color.default("#0F4C5C"),
    accent: color.default("#F2C14E"),
    dark: color.optional(),
    light: color.optional(),
    logo: file.optional(),
  });

  const end = z.object({
    title: short(32).optional(),
    lines: z.array(short(40)).max(3).default([]),
  });

  const reel = z.object({
    id: z.string().regex(/^[a-z0-9-]{2,40}$/, "Use lowercase letters, digits and dashes."),
    format: z.enum(Object.keys(FORMATS)).default("vertical"),
    style: z.enum(STYLES).default("bold"),
    brand,
    scenes: z.array(scene).min(2).max(7),
    end: end.default({ lines: [] }),
    /** Filled by render.mjs: the score (music + accents) and the person's own music file. */
    audio: z.string().optional(),
    music: file.optional(),
    /** Filled by render.mjs with a voice-over: the voice and the ducked music in one track. */
    mix: z.string().optional(),
    aiVoiceLabel: z.string().max(80).optional(),
    bpm: z.number().min(60).max(180).default(DEFAULT_BPM),
    poster: z.number().min(0).max(1).default(0.12),
    /** Draft renders skip grain and blur-heavy effects to go faster. */
    draft: z.boolean().default(false),
  });

  const plan = z.object({
    brand,
    format: z.enum(Object.keys(FORMATS)).default("vertical"),
    style: z.enum(STYLES).default("bold"),
    /** "generated:upbeat|warm|calm|bright" | a file name | "none" */
    music: z.string().default("generated:upbeat"),
    end: end.default({ lines: [] }),
    reels: z
      .array(
        z.object({
          id: reel.shape.id,
          caption: z.string().max(2200).optional(),
          /** What the voice says (optional): a few short sentences, about 2 words a second. */
          voiceover: z.string().max(600, "Keep the voice-over under 600 characters.").optional(),
          style: z.enum(STYLES).optional(),
          scenes: z.array(scene).min(2).max(7),
          end: end.optional(),
          poster: z.number().min(0).max(1).optional(),
        }),
      )
      .min(1)
      .max(6),
  });
  return { scene, brand, reel, plan };
}

export const moodBpm = (music) => {
  const mood = String(music ?? "").startsWith("generated:") ? music.slice(10) : null;
  return mood && MOODS[mood] ? MOODS[mood].bpm : DEFAULT_BPM;
};

/** List items appear one per beat, starting on the second beat. */
export const listItemDelay = (i, beatFrames) => Math.round(beatFrames * (1 + i));
/** The price badge lands one and a half beats into an offer scene. */
export const offerBadgeDelay = (beatFrames) => Math.round(beatFrames * 1.5);

/**
 * Frames per scene (cuts on beats, the end card on a bar), the end card length, the transitions
 * actually used, and the sound accents (seconds) that go with them.
 */
export function reelTimeline(reel) {
  const bpm = reel.bpm ?? DEFAULT_BPM;
  const beat = 60 / bpm;
  const beatFrames = beat * FPS;
  const frames = snapToBeats(
    reel.scenes.map((scene) => scene.seconds ?? 3),
    { bpm, fps: FPS, minBeats: 3 },
  );
  const endBeats = Math.max(4, Math.ceil(2.6 / beat / 2) * 2);
  const endFrames = Math.round(endBeats * beatFrames);
  const auto = AUTO[reel.style] ?? AUTO.bold;
  let autoIndex = 0;
  const transitions = reel.scenes.map((scene, index) => {
    if (index === 0) return "cut";
    if (scene.transition && scene.transition !== "auto") return scene.transition;
    // An offer gets the brand wipe; everything else follows the look's rhythm.
    if (scene.type === "offer") return "wipe";
    return auto[autoIndex++ % auto.length];
  });
  const endTransition = reel.style === "elegant" ? "fade" : "zoom";
  const cues = [];
  let t = 0;
  reel.scenes.forEach((scene, index) => {
    const start = t / FPS;
    const kind = transitions[index];
    if (index > 0 && kind !== "cut" && kind !== "fade")
      cues.push({ t: Math.max(0, start - 0.16), kind: "whoosh", pan: index % 2 ? 0.3 : -0.3 });
    if (index > 0 && kind === "fade")
      cues.push({ t: Math.max(0, start - 0.1), kind: "whoosh", gain: 0.45 });
    if (scene.type === "list")
      (scene.items ?? []).forEach((_, i) =>
        cues.push({ t: start + (listItemDelay(i, beatFrames) + 2) / FPS, kind: "tick" }),
      );
    if (scene.type === "offer" && scene.badge)
      cues.push({ t: start + (offerBadgeDelay(beatFrames) + 2) / FPS, kind: "pop" });
    t += frames[index];
  });
  const endStart = t;
  cues.push({ t: Math.max(0, endStart / FPS - 0.16), kind: "whoosh" });
  const pressAt = Math.round(2 * beatFrames);
  cues.push({ t: (endStart + pressAt) / FPS, kind: "click" });
  return {
    bpm,
    beatFrames,
    frames,
    transitions,
    endStart,
    endFrames,
    endTransition,
    pressAt,
    total: endStart + endFrames,
    cues,
  };
}

export const reelFrames = (reel) => reelTimeline(reel).total;
