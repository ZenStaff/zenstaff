// @effect-diagnostics nodeBuiltinImport:off - reads the pack files the test checks.
// The premium kit shared by the video and design packs, and the prop schemas of their templates.
// The kit and templates are plain JS run by agents, so they are loaded with dynamic imports.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { z } from "zod";

import { expectedKitCopies } from "../../../../../scripts/lib/zen-premium-kit.ts";

const here = import.meta.dirname;
type Any = any;
const load = (relative: string): Promise<Any> => import(NodePath.join(here, relative));

describe("premium kit copies", () => {
  it("every consuming pack carries an up-to-date copy of its kit parts", () => {
    for (const [pack, files] of Object.entries(expectedKitCopies(here))) {
      const dir = NodePath.join(here, "packs", pack, "kit");
      for (const [relative, text] of Object.entries(files)) {
        const file = NodePath.join(dir, relative);
        expect(
          NodeFS.existsSync(file),
          `${pack}/kit/${relative} is missing: run zen:workflows`,
        ).toBe(true);
        expect(
          NodeFS.readFileSync(file, "utf8"),
          `${pack}/kit/${relative} is stale: run zen:workflows`,
        ).toBe(text);
      }
    }
  });
});

describe("reels template", () => {
  const plan = {
    brand: { name: "Casa Verde", primary: "#1F4D3A", accent: "#F2B544", logo: "logo.png" },
    style: "warm",
    music: "generated:upbeat",
    end: { title: "Rezervă o masă", lines: ["@casaverde", "casaverde.ro"] },
    reels: [
      {
        id: "meniul-zilei",
        scenes: [
          { type: "hook", media: "supa.mp4", title: "Prânzul e gata la 12", seconds: 2.6 },
          {
            type: "list",
            title: "Trei feluri",
            items: ["Supă", "Fel principal", "Desert"],
            seconds: 3.6,
          },
          { type: "offer", badge: "39 lei", title: "Totul la", seconds: 3.4, place: "top" },
        ],
      },
    ],
  };

  it("accepts a valid plan and fills the defaults", async () => {
    const { makeSchemas } = await load("packs/social-reels-kit/template/src/schema.js");
    const parsed = makeSchemas(z).plan.parse(plan);
    expect(parsed.reels[0].scenes[0].transition).toBe("auto");
    expect(parsed.reels[0].scenes[0].focusX).toBe(50);
    expect(parsed.reels[0].scenes[2].place).toBe("top");
  });

  it("refuses wrong colors, long titles, unknown transitions and file paths outside the media folder", async () => {
    const { makeSchemas } = await load("packs/social-reels-kit/template/src/schema.js");
    const { plan: schema } = makeSchemas(z);
    const bad = (patch: Any) => schema.safeParse({ ...plan, ...patch }).success;
    expect(bad({ brand: { ...plan.brand, primary: "green" } })).toBe(false);
    const first: Any = plan.reels[0];
    const scene = (extra: Any) => ({
      reels: [{ ...first, scenes: [{ ...first.scenes[0], ...extra }, first.scenes[1]] }],
    });
    expect(bad(scene({ title: "x".repeat(49) }))).toBe(false);
    expect(bad(scene({ transition: "spin" }))).toBe(false);
    expect(bad(scene({ media: "../secret.jpg" }))).toBe(false);
    expect(bad(scene({ media: "/etc/passwd" }))).toBe(false);
  });

  it("cuts on the beat, starts the end card on a bar and keeps every sound accent inside the reel", async () => {
    const { FPS, makeSchemas, moodBpm, reelTimeline } = await load(
      "packs/social-reels-kit/template/src/schema.js",
    );
    const parsed = makeSchemas(z).plan.parse(plan);
    const bpm = moodBpm(parsed.music);
    const reel = makeSchemas(z).reel.parse({
      ...parsed.reels[0],
      brand: parsed.brand,
      style: "bold",
      bpm,
    });
    const t = reelTimeline(reel);
    const beat = (60 / bpm) * FPS;
    let at = 0;
    for (const frames of t.frames) {
      at += frames;
      expect(Math.abs(at / beat - Math.round(at / beat))).toBeLessThan(0.06);
    }
    expect(Math.round(t.endStart / beat) % 4).toBe(0);
    expect(t.transitions[0]).toBe("cut");
    expect(t.transitions[2]).toBe("wipe");
    for (const cue of t.cues) expect(cue.t).toBeLessThan(t.total / FPS);
    expect(t.cues.filter((c: Any) => c.kind === "tick")).toHaveLength(3);
  });
});

describe("promo template", () => {
  it("still accepts props written for the first version", async () => {
    const { makeSchemas } = await load("packs/promo-video-30s/template/src/schema.js");
    const parsed = makeSchemas(z).props.parse({
      format: "landscape",
      seconds: 30,
      brand: {
        name: "Acme",
        primary: "#0F4C5C",
        accent: "#F2C14E",
        background: "#0B1F2A",
        text: "#FFFFFF",
      },
      scenes: [
        { title: "Acme Coffee", text: "Specialty coffee", image: "shop.jpg" },
        { title: "Roasted weekly" },
      ],
      cta: { title: "20% off", subtitle: "acme.ro" },
      music: "music.mp3",
    });
    expect(parsed.style).toBe("modern");
    expect(parsed.scenes[0].layout).toBe("auto");
  });

  it("lays out varied scenes and lasts the asked length", async () => {
    const { FPS, layoutFor, makeSchemas, promoTimeline } = await load(
      "packs/promo-video-30s/template/src/schema.js",
    );
    const props = makeSchemas(z).props.parse({
      seconds: 30,
      brand: { name: "Acme" },
      scenes: [
        { title: "Open", image: "a.jpg" },
        { title: "Two", image: "b.jpg" },
        { title: "Three", image: "c.jpg" },
        { title: "Words only" },
      ],
      cta: { title: "Come in" },
    });
    expect(props.scenes.map((s: Any, i: number) => layoutFor(s, i))).toEqual([
      "full",
      "split",
      "cards",
      "statement",
    ]);
    const t = promoTimeline(props);
    expect(Math.abs(t.total / FPS - 30)).toBeLessThan(0.6);
    expect(t.endFrames / FPS).toBeGreaterThanOrEqual(1.9);
  });
});

describe("tutorial direction", () => {
  it("zooms closer on small controls than on wide areas and keeps the view inside the page", async () => {
    const { clampCenter, zoomFor } = await load("packs/app-tutorial-video/compose/src/camera.js");
    expect(zoomFor({ x: 0.4, y: 0.4, width: 0.08, height: 0.04 })).toBeGreaterThan(
      zoomFor({ x: 0, y: 0, width: 0.4, height: 0.3 }),
    );
    expect(zoomFor({ x: 0, y: 0, width: 0.9, height: 0.5 })).toBe(1);
    const c = clampCenter(0.98, 0.02, 2);
    expect(c).toEqual({ x: 0.75, y: 0.25 });
  });

  it("pulls out before a page change and never teleports the cursor", async () => {
    const { cameraAt, cameraKeys, cursorAt } = await load(
      "packs/app-tutorial-video/compose/src/camera.js",
    );
    const box = { x: 0.8, y: 0.05, width: 0.08, height: 0.05 };
    const events = [
      { t: 1, kind: "move", x: 0.84, y: 0.07, box },
      { t: 2, kind: "click", x: 0.84, y: 0.07, box },
      { t: 3, kind: "nav" },
    ];
    const keys = cameraKeys(events, { duration: 6 });
    expect(cameraAt(keys, 1.9).scale).toBeGreaterThan(1.2);
    expect(cameraAt(keys, 3.7).scale).toBeCloseTo(1, 2);
    const before = cursorAt(events, 0.99);
    const middle = cursorAt(events, 1.3);
    const after = cursorAt(events, 2);
    expect(middle.x).toBeGreaterThan(before.x);
    expect(middle.x).toBeLessThan(after.x);
    expect(after.x).toBeCloseTo(0.84, 6);
    expect(after.y).toBeCloseTo(0.07, 6);
  });
});

describe("kit math", () => {
  it("keeps text readable on any brand color", async () => {
    const { contrast, palette } = await load("premium-kit/common/color.js");
    for (const primary of [
      "#1F4D3A",
      "#F2B544",
      "#FFFFFF",
      "#000000",
      "#E8611A",
      "#767676",
      "#0F4C5C",
    ]) {
      const p = palette({ primary, accent: "#F2C14E" });
      expect(contrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("breaks headlines into the fewest balanced lines without splitting words", async () => {
    const { balanceLines } = await load("premium-kit/common/type.js");
    expect(balanceLines("Totul la", 16)).toEqual(["Totul la"]);
    const lines = balanceLines("O seară fără grabă la Casa Verde", 14);
    expect(lines.join(" ")).toBe("O seară fără grabă la Casa Verde");
    expect(lines.length).toBe(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(14);
  });

  it("maps a design exactly onto the measured corners of a mockup", async () => {
    const { CATALOG, quadMatrix } = await load("premium-kit/print/mockup.mjs");
    const quad = [
      [100, 50],
      [400, 60],
      [380, 300],
      [90, 280],
    ];
    const m = quadMatrix(200, 100, quad).slice(9, -1).split(",").map(Number);
    const project = (x: number, y: number) => {
      const w = m[3]! * x + m[7]! * y + m[15]!;
      return [(m[0]! * x + m[4]! * y + m[12]!) / w, (m[1]! * x + m[5]! * y + m[13]!) / w];
    };
    const corners = [project(0, 0), project(200, 0), project(200, 100), project(0, 100)];
    corners.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(quad[i]![0]!, 3);
      expect(p[1]).toBeCloseTo(quad[i]![1]!, 3);
    });
    for (const mock of CATALOG.mockups) {
      expect(mock.photo.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(mock.photo.url).toMatch(/^https:\/\/images\.pexels\.com\/photos\//);
      for (const layer of mock.layers)
        for (const [x, y] of layer.quad) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(mock.photo.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(mock.photo.height);
        }
    }
  });

  it("makes a score of the right length with a valid WAV header", async () => {
    const { makeScore, SR } = await load("premium-kit/audio/sound.mjs");
    const { wav, bpm } = makeScore({
      mood: "warm",
      seconds: 4,
      endAt: 3,
      cues: [{ t: 1, kind: "whoosh" }],
    });
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(40)).toBe(4 * SR * 4);
    expect(bpm).toBe(98);
  });
});

describe("voice-over ducking", () => {
  /** Evaluates an FFmpeg volume expression of the kind volumeExpression() writes, at time t. */
  const evalExpression = (expression: string, t: number): number => {
    const js = expression
      .replace(/between\(t,([-\d.]+),([-\d.]+)\)/g, (_m, a, b) => `(t>=${a}&&t<=${b}?1:0)`)
      .replace(/lt\(t,([-\d.]+)\)/g, (_m, a) => `(t<${a}?1:0)`)
      .replace(/gte\(t,([-\d.]+)\)/g, (_m, a) => `(t>=${a}?1:0)`)
      .replace(/pow\(/g, "Math.pow(");
    return new Function("t", `return ${js};`)(t) as number;
  };

  it("reads speech segments from silencedetect output", async () => {
    const { parseSilences, speechFromSilences } = await load("premium-kit/audio/duck.mjs");
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 0",
      "[silencedetect @ 0x1] silence_end: 0.52 | silence_duration: 0.52",
      "[silencedetect @ 0x1] silence_start: 3.1",
      "[silencedetect @ 0x1] silence_end: 4.4 | silence_duration: 1.3",
      "[silencedetect @ 0x1] silence_start: 7.25",
    ].join("\n");
    const silences = parseSilences(stderr);
    expect(silences).toEqual([
      { start: 0, end: 0.52 },
      { start: 3.1, end: 4.4 },
      { start: 7.25, end: Infinity },
    ]);
    expect(speechFromSilences(silences, 10)).toEqual([
      { start: 0.52, end: 3.1 },
      { start: 4.4, end: 7.25 },
    ]);
  });

  it("puts the music 12 dB under the voice and 6 dB higher between lines", async () => {
    const { duckLevels } = await load("premium-kit/audio/duck.mjs");
    expect(duckLevels({ voiceLufs: -16, musicLufs: -18 })).toEqual({ downDb: -10, upDb: -4 });
    expect(duckLevels({ voiceLufs: -16, musicLufs: -30, gapDb: 12, liftDb: 6 })).toEqual({
      downDb: 2,
      upDb: 8,
    });
    // Never a huge boost of a very quiet bed, and nothing to do without music.
    expect(duckLevels({ voiceLufs: -16, musicLufs: -40 }).upDb).toBeLessThanOrEqual(10);
    expect(duckLevels({ voiceLufs: -16, musicLufs: null })).toEqual({ downDb: 0, upDb: 0 });
    expect(duckLevels({ voiceLufs: -16, musicLufs: -70 })).toEqual({ downDb: 0, upDb: 0 });
  });

  it("ducks while the voice speaks, comes back up in real pauses only, and the FFmpeg expression matches", async () => {
    const { duckEnvelope, gainAt, volumeExpression } = await load("premium-kit/audio/duck.mjs");
    const segments = [
      { start: 1, end: 3 },
      { start: 3.4, end: 5 }, // a short breath: stays down
      { start: 8, end: 10 },
    ];
    const points = duckEnvelope(segments, { duration: 12, downDb: -10, upDb: -4 });
    for (let i = 1; i < points.length; i++)
      expect(points[i].t).toBeGreaterThanOrEqual(points[i - 1].t);
    expect(points[0].t).toBe(0);
    expect(points.at(-1).t).toBe(12);
    expect(gainAt(points, 0.3)).toBe(-4);
    for (const t of [1, 2, 3.2, 4.9, 8.5, 9.9]) expect(gainAt(points, t), `t=${t}`).toBe(-10);
    expect(gainAt(points, 6.5)).toBe(-4);
    expect(gainAt(points, 11.5)).toBe(-4);
    // Ramps, not jumps: halfway into the attack the gain is between the two levels.
    const mid = gainAt(points, 1 - 0.1 - 0.09);
    expect(mid).toBeLessThan(-4);
    expect(mid).toBeGreaterThan(-10);
    const expression = volumeExpression(points);
    expect(expression.startsWith("pow(10,(")).toBe(true);
    expect(expression).not.toContain("if(");
    for (let t = 0; t < 12; t += 0.05)
      expect(evalExpression(expression, t), `t=${t.toFixed(2)}`).toBeCloseTo(
        10 ** (gainAt(points, t) / 20),
        3,
      );
  });

  it("measures voice and music only where the voice speaks", async () => {
    const { speechSelect } = await load("premium-kit/audio/duck.mjs");
    expect(
      speechSelect([
        { start: 0.5, end: 2 },
        { start: 3.25, end: 4.125 },
      ]),
    ).toBe("between(t,0.5,2)+between(t,3.25,4.125)");
    expect(speechSelect([{ start: 1, end: 1.2 }])).toBeUndefined();
  });

  it("a voice from the first frame starts ducked", async () => {
    const { duckEnvelope, gainAt } = await load("premium-kit/audio/duck.mjs");
    const points = duckEnvelope([{ start: 0, end: 2 }], { duration: 5, downDb: -9, upDb: -3 });
    expect(gainAt(points, 0)).toBe(-9);
    expect(gainAt(points, 4.5)).toBe(-3);
  });

  it("builds the voice, music, ducking and level graphs", async () => {
    const { voiceGraph, musicGraph, duckMixGraph, levelGraph, duckEnvelope } = await load(
      "premium-kit/audio/duck.mjs",
    );
    const voice = voiceGraph([{ file: "a.wav", at: 0.4 }], 20);
    expect(voice).toContain("adelay=400:all=1");
    expect(voice).toContain("loudnorm=I=-16:TP=-2");
    expect(voice).toContain("atrim=0:20");
    const music = musicGraph(
      [{ file: "score.wav" }, { file: "own.mp3", gainDb: -1.5, fadeIn: 0.35, fadeOut: 1 }],
      20,
    );
    expect(music).toContain("[1:a]");
    expect(music).toContain("volume=-1.5dB");
    expect(music).toContain("afade=t=out:st=19:d=1");
    expect(music).toContain("amix=inputs=2:normalize=0");
    const points = duckEnvelope([{ start: 1, end: 4 }], { duration: 20, downDb: -10, upDb: -4 });
    const mix = duckMixGraph(points);
    expect(mix).toContain("asetnsamples=n=256");
    expect(mix).toContain(":eval=frame");
    expect(mix).toContain("[duck][1:a]amix=inputs=2:normalize=0");
    expect(levelGraph(1.234)).toBe(
      "[0:a]volume=1.23dB,alimiter=limit=0.75:attack=5:release=60:level=disabled[out]",
    );
  });

  it("every video pack mixes its voice through the kit and masters to -16 LUFS with a voice", () => {
    const read = (relative: string) => NodeFS.readFileSync(NodePath.join(here, relative), "utf8");
    for (const file of [
      "packs/promo-video-30s/template/render.mjs",
      "packs/social-reels-kit/template/render.mjs",
      "packs/app-tutorial-video/compose.mjs",
    ]) {
      const text = read(file);
      expect(text, file).toContain('kit/audio/duck.mjs";');
      expect(text, file).toContain("mixVoiceOver(");
    }
    expect(read("packs/social-reels-kit/template/render.mjs")).toContain(
      "target: reel.mix ? -16 : -14",
    );
    expect(read("packs/promo-video-30s/template/render.mjs")).toContain(
      "target: props.voiceover ? -16 : -14",
    );
  });
});

describe("AI-voice label and captions placement", () => {
  const LABELS = ["Voce generată cu AI", "AI-generated voice"];

  it("never puts the label over text in any reel layout, on 9:16 above the safe zone", async () => {
    const { FORMATS } = await load("packs/social-reels-kit/template/src/schema.js");
    const { reelLabelBox, textZones, pictureZones } = await load(
      "packs/social-reels-kit/template/src/layout.js",
    );
    const { overlaps, insideFrame, safeZone } = await load("premium-kit/motion/placement.js");
    for (const [format, [W, H]] of Object.entries(FORMATS) as [string, [number, number]][]) {
      for (const scale of [1, 0.5]) {
        const width = W * scale;
        const height = H * scale;
        for (const text of LABELS) {
          const where = `${format} ${width}x${height} "${text}"`;
          const label = reelLabelBox(width, height, text);
          expect(label.ok, where).toBe(true);
          expect(insideFrame(label, width, height), where).toBe(true);
          for (const zone of textZones(width, height))
            expect(overlaps(label, zone), `${where} over text ${JSON.stringify(zone)}`).toBe(false);
          const safe = safeZone(width, height);
          if (safe.kind === "vertical") {
            expect(label.y + label.h, where).toBeLessThanOrEqual(safe.top - 20 * safe.unit);
            // Below the platform's top bar (about the top 150 px of 1920).
            expect(label.y, where).toBeGreaterThanOrEqual(150 * safe.unit);
          } else {
            for (const picture of pictureZones(width, height))
              expect(overlaps(label, picture), `${where} over a picture`).toBe(false);
          }
        }
      }
    }
  });

  it("keeps the tutorial's label clear of the captions and the window, and two caption lines fit", async () => {
    const { tutorialOverlay } = await load("packs/app-tutorial-video/compose/src/layout.js");
    const { overlaps, insideFrame, captionLineWidth } = await load(
      "premium-kit/motion/placement.js",
    );
    for (const [width, height] of [
      [1920, 1080],
      [960, 540],
      [1080, 1920],
      [540, 960],
    ] as const) {
      for (const text of LABELS) {
        const where = `${width}x${height} "${text}"`;
        const o = tutorialOverlay(width, height, text);
        const c = o.captions;
        // Two full lines of the longest allowed length fit the width and the frame.
        expect(o.captionRect.w, where).toBeLessThanOrEqual(c.maxWidth);
        expect(
          captionLineWidth(c.maxChars, Math.ceil(c.maxChars / 4) + 1, c.size) + 2 * c.padX,
          where,
        ).toBeLessThanOrEqual(c.maxWidth);
        expect(insideFrame(o.captionRect, width, height), where).toBe(true);
        if (width > height) {
          // Landscape: captions in the strip under the window, the label beside them.
          expect(o.captionRect.y, where).toBeGreaterThanOrEqual(o.band!.top);
          expect(overlaps(o.captionRect, o.window), where).toBe(false);
          expect(o.label, where).not.toBeNull();
          expect(insideFrame(o.label, width, height), where).toBe(true);
          expect(overlaps(o.label, o.captionRect), where).toBe(false);
          expect(overlaps(o.label, o.window), where).toBe(false);
          // Bigger than the 40 px of 2.0.
          expect(c.size, where).toBeGreaterThanOrEqual(48 * (width / 1920));
        } else {
          expect(c.size, where).toBeGreaterThanOrEqual(60 * (width / 1080));
        }
      }
    }
  });

  it("captions use a face with comma-below ș ț and stay at two lines", async () => {
    const { captionLayout, CAPTION_FONT } = await load("premium-kit/motion/placement.js");
    const { FONT_FILES } = await load("premium-kit/common/type.js");
    const source = NodeFS.readFileSync(
      NodePath.join(here, "premium-kit/motion/captions.jsx"),
      "utf8",
    );
    // Each phrase is drawn as explicit lines of whole words (no browser wrapping into a third line).
    expect(source).toContain("captionLines(group, layout.maxChars)");
    expect(source).toContain("CAPTION_FONT.family");
    expect(CAPTION_FONT.family).toBe("ZenBarlow");
    expect(
      FONT_FILES.some(
        ([family, file, weight]: string[]) =>
          family === "ZenBarlow" &&
          file === "Barlow-SemiBold.ttf" &&
          weight === String(CAPTION_FONT.weight),
      ),
    ).toBe(true);
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
    ] as const) {
      const layout = captionLayout(w, h);
      expect(layout.lines).toBe(2);
      expect(layout.maxChars).toBeGreaterThanOrEqual(w > h ? 30 : 18);
    }
  });
});
