// @effect-diagnostics nodeBuiltinImport:off -- Plain unit test that loads the proposal deck's scripts from disk.
// The proposal deck's PowerPoint copy (sales-kit/proposal-deck/pptx.mjs): every layout maps to
// shapes inside the 13.333 x 7.5 in slide, no text box is empty, every slide has notes, and every
// color comes from the deck's theme (theme.mjs, shared with the HTML/PDF).
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

const folder = NodePath.join(import.meta.dirname, "packs", "sales-kit", "proposal-deck");

interface Run {
  readonly text: string;
  readonly color?: string;
}
interface Cell {
  readonly text: string;
  readonly color: string;
  readonly face: string;
  readonly size: number;
  readonly bottom: { readonly color: string; readonly width: number };
}
interface Shape {
  readonly kind: "text" | "rect" | "ellipse" | "icon" | "image" | "table" | "chart";
  readonly role: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly runs?: ReadonlyArray<Run>;
  readonly color?: string;
  readonly fill?: string;
  readonly line?: string;
  readonly face?: string;
  readonly size?: number;
  readonly rows?: ReadonlyArray<ReadonlyArray<Cell>>;
  readonly colW?: ReadonlyArray<number>;
  readonly labels?: ReadonlyArray<string>;
  readonly values?: ReadonlyArray<number>;
  readonly ink?: string;
  readonly valueInk?: string;
}
interface SlideSpec {
  readonly background: string;
  readonly notes: string;
  readonly shapes: ReadonlyArray<Shape>;
}
interface Theme {
  readonly valid: boolean;
  readonly colors: Record<string, string>;
  readonly look: { readonly head: string };
  readonly [key: string]: unknown;
}
type DeckShapes = (deck: unknown, theme: Theme, options?: unknown) => ReadonlyArray<SlideSpec>;

const load = async () => {
  const pptx = (await import(NodePath.join(folder, "pptx.mjs"))) as {
    deckShapes: DeckShapes;
    wrapLines: (text: string, style: unknown, width: number) => number;
    runs: (text: string, accent: string) => ReadonlyArray<Run>;
    SLIDE_W: number;
    SLIDE_H: number;
    PX_PER_IN: number;
  };
  const theme = (await import(NodePath.join(folder, "theme.mjs"))) as {
    deckTheme: (deck: unknown) => Theme;
    LAYOUTS: ReadonlyArray<string>;
  };
  return { ...pptx, ...theme };
};

const image = { data: "data:image/png;base64,iVBORw0KGgo=", width: 400, height: 100 };
const photo = { data: "data:image/jpeg;base64,/9j/4AAQ", width: 1600, height: 1000 };

const deckWith = (fonts: string, extra: Record<string, unknown> = {}) => ({
  language: "ro",
  title: "Catering pentru conferința anuală",
  subtitle: "Pauze de cafea, prânzuri și cina de gală pentru 180 de invitați",
  date: "8 noiembrie 2026",
  author: "Ana Pop, Casa Verde",
  brand: {
    name: "Casa Verde",
    colors: { primary: "#1F4D3A", accent: "#F2B544", light: "#FBF5E8", dark: "#1E1E1C" },
    fonts,
  },
  client: { name: "Hotel Carpați" },
  slides: [
    { layout: "cover", notes: "Deschidere." },
    {
      layout: "statement",
      kicker: "Ce am înțeles",
      title: "Două zile în care **mâncarea nu are voie să întârzie** programul.",
      text: "180 de invitați, 4 pauze de cafea, 2 prânzuri și o cină de gală.",
      notes: "Cuvintele lor.",
    },
    {
      layout: "points",
      kicker: "Propunerea",
      title: "Trei momente, fiecare gândit pentru ritmul conferinței",
      points: [
        {
          title: "Pauze în 20 de minute",
          text: "Patru stații de cafea și gustări gata porționate.",
        },
        { title: "Prânz cald", text: "Bufet cu două linii." },
        { title: "Cina de gală", text: "Meniu servit în patru feluri." },
      ],
      notes: "Trei părți.",
    },
    {
      layout: "split",
      kicker: "De ce noi",
      title: "Gătim în bucătăria noastră și aducem totul cald",
      text: "Lucrăm cu echipa noastră.",
      bullets: ["Catering din 2016", "Bucătărie la 12 km"],
      figure: "400",
      caption: "porții gătite zilnic",
      notes: "Bucătăria e aproape.",
    },
    {
      layout: "numbers",
      title: "Evenimente mari, livrate la timp",
      stats: [
        { value: "10", label: "ani de catering" },
        { value: "400", label: "porții pe zi" },
      ],
      chart: {
        title: "Porții servite",
        unit: "pe an",
        bars: [
          { label: "2025", value: 34100 },
          { label: "2026", value: 38600 },
        ],
      },
      notes: "Din registre.",
    },
    {
      layout: "timeline",
      title: "De la degustare la cina de gală",
      steps: [
        { when: "Martie", title: "Degustare", text: "Gustați meniurile." },
        { when: "Aprilie", title: "Meniul final", text: "Confirmăm invitații." },
        { when: "Mai", title: "Conferința", text: "Suntem în sală." },
      ],
      notes: "Calendar.",
    },
    {
      layout: "pricing",
      title: "Trei variante",
      options: [
        { name: "Esențial", price: "245 lei", unit: "de persoană", features: ["4 pauze"] },
        {
          name: "Gală",
          price: "325 lei",
          unit: "de persoană",
          recommended: true,
          features: ["Cină servită", "Vinuri incluse"],
        },
        { name: "Premium", price: "410 lei", features: ["Bar deschis"] },
      ],
      note: "Prețuri fără TVA, valabile 30 de zile.",
      notes: "Recomandăm Gală.",
    },
    {
      layout: "table",
      title: "Ce include fiecare variantă",
      columns: ["", "Esențial", "Gală"],
      rows: [
        ["Cina", "bufet", "**servită**"],
        ["Preț", "245 lei", "325 lei"],
      ],
      align: ["left", "right", "right"],
      notes: "Diferențele.",
    },
    {
      layout: "quote",
      dark: true,
      quote: "Pauzele s-au terminat la minut.",
      author: "Maria Ionescu, Hotel Aro",
    },
    {
      layout: "next",
      title: "Pașii următori",
      steps: ["Alegeți varianta", "Semnăm contractul"],
      cta: "Rezervăm data până pe **30 noiembrie**",
      contact: "Ana Pop · 0700 000 011\nevenimente@casaverde.example",
      action: "Răspundeți la acest e-mail",
      notes: "Data limită.",
    },
  ],
  ...extra,
});

const themeColors = (theme: Theme) =>
  new Set(
    [
      ...Object.values(theme.colors),
      ...[
        "accentText",
        "paper",
        "muted",
        "rule",
        "onPrimary",
        "onPrimaryMuted",
        "accentOnPrimary",
        "onAccent",
        "card",
        "statValue",
      ].map((key) => theme[key] as string),
      "#FFFFFF",
    ].map((c) => c.toUpperCase()),
  );

const colorsOf = (shape: Shape): string[] => [
  ...[shape.color, shape.fill, shape.line, shape.ink, shape.valueInk].filter(
    (c): c is string => typeof c === "string",
  ),
  ...(shape.runs ?? []).flatMap((r) => (r.color ? [r.color] : [])),
  ...(shape.rows ?? []).flat().flatMap((cell) => [cell.color, cell.bottom.color]),
];

describe("proposal deck PowerPoint shapes", () => {
  it("maps every layout, in every look, to shapes inside the 13.333 x 7.5 in slide", async () => {
    const { deckShapes, deckTheme, LAYOUTS, SLIDE_W, SLIDE_H, PX_PER_IN } = await load();
    const slideW = SLIDE_W / PX_PER_IN;
    const slideH = SLIDE_H / PX_PER_IN;
    expect(slideW).toBeCloseTo(13.333, 3);
    expect(slideH).toBe(7.5);
    for (const look of ["modern", "elegant", "strong"]) {
      const deck = deckWith(look);
      expect(new Set(deck.slides.map((s) => s.layout))).toEqual(new Set(LAYOUTS));
      const theme = deckTheme(deck);
      const specs = deckShapes(deck, theme);
      expect(specs).toHaveLength(deck.slides.length);
      const allowed = themeColors(theme);
      for (const [i, spec] of specs.entries()) {
        const where = `${look} slide ${i + 1} (${deck.slides[i]!.layout})`;
        expect(spec.shapes.length, where).toBeGreaterThan(2);
        expect([theme.paper, theme.colors.primary], where).toContain(spec.background);
        expect(spec.notes.trim().length, `${where} notes`).toBeGreaterThan(0);
        for (const shape of spec.shapes) {
          const what = `${where} ${shape.role}`;
          for (const v of [shape.x, shape.y, shape.w, shape.h])
            expect(Number.isFinite(v), what).toBe(true);
          expect(shape.w, what).toBeGreaterThan(0);
          expect(shape.h, what).toBeGreaterThan(0);
          expect(shape.x, what).toBeGreaterThanOrEqual(0);
          expect(shape.y, what).toBeGreaterThanOrEqual(0);
          expect(shape.x + shape.w, what).toBeLessThanOrEqual(slideW + 0.001);
          expect(shape.y + shape.h, what).toBeLessThanOrEqual(slideH + 0.001);
          if (shape.kind === "text") {
            expect(
              (shape.runs ?? [])
                .map((r) => r.text)
                .join("")
                .trim(),
              what,
            ).not.toBe("");
            expect(shape.size, what).toBeGreaterThan(6);
          }
          for (const color of colorsOf(shape))
            expect(allowed.has(color.toUpperCase()), `${what} uses ${color}`).toBe(true);
        }
      }
    }
  });

  it("keeps text inside the slide's content area and out of the footer", async () => {
    const { deckShapes, deckTheme } = await load();
    const deck = deckWith("modern");
    const specs = deckShapes(deck, deckTheme(deck));
    for (const [i, spec] of specs.entries()) {
      if (deck.slides[i]!.layout === "cover") continue;
      for (const shape of spec.shapes) {
        if (["footer", "page", "logo", "media", "photo", "figure", "caption"].includes(shape.role))
          continue;
        // Content stays above the footer line (930 px = 6.46 in), as in the HTML.
        expect(shape.y + shape.h, `slide ${i + 1} ${shape.role}`).toBeLessThanOrEqual(6.47);
      }
    }
  });

  it("uses native tables and charts, accent runs, brand fonts and the browser's fitted sizes", async () => {
    const { deckShapes, deckTheme } = await load();
    const deck = deckWith("elegant");
    const theme = deckTheme(deck);
    const fits = deck.slides.map((_, i) => (i === 2 ? { title: 60, inner: 0.96 } : {}));
    const specs = deckShapes(deck, theme, { fits });
    const shapes = (i: number) => specs[i]!.shapes;

    const table = shapes(7).find((s) => s.kind === "table")!;
    expect(table.rows).toHaveLength(3);
    expect(table.rows![0]!.map((c) => c.text)).toEqual(["", "ESENȚIAL", "GALĂ"]);
    expect(table.colW!.reduce((a, b) => a + b, 0)).toBeCloseTo(table.w, 3);

    const chart = shapes(4).find((s) => s.kind === "chart")!;
    expect(chart.labels).toEqual(["2025", "2026"]);
    expect(chart.values).toEqual([34100, 38600]);

    // **words** become a run in the accent color (darkened to read on the light background).
    const statement = shapes(1).find((s) => s.role === "title")!;
    expect(statement.runs!.find((r) => r.text === "mâncarea nu are voie să întârzie")?.color).toBe(
      theme.accentText,
    );
    expect(statement.face).toBe("Playfair Display");

    // The title size and the shrink the browser applied (px) arrive in points (1 px = 0.5 pt).
    const points = shapes(2);
    expect(points.find((s) => s.role === "title")!.size).toBe(30);
    expect(points.find((s) => s.role === "point-text")!.size).toBeCloseTo(15 * 0.96, 1);

    // The recommended card is the primary color; the cover uses the type wordmark without a logo.
    expect(
      shapes(6).some((s) => s.role === "card-recommended" && s.fill === theme.colors.primary),
    ).toBe(true);
    expect(shapes(0).some((s) => s.role === "wordmark")).toBe(true);
    // A slide without notes gets its own text in the notes pane, not an empty pane.
    expect(specs[8]!.notes).toContain("Pauzele s-au terminat la minut.");
  });

  it("places logos and photos with their own proportions", async () => {
    const { deckShapes, deckTheme } = await load();
    const base = deckWith("strong");
    const deck = {
      ...base,
      slides: base.slides.map((s, i) => (i === 0 || i === 3 ? { ...s, image: "photo.jpg" } : s)),
    };
    const theme = deckTheme(deck);
    const specs = deckShapes(deck, theme, {
      images: { logo: image, logoOnDark: image, clientLogo: image, slide0: photo, slide3: photo },
    });
    const cover = specs[0]!.shapes;
    const coverPhoto = cover.find((s) => s.role === "photo")!;
    expect(coverPhoto.x + coverPhoto.w).toBeCloseTo(13.3333, 3);
    expect(coverPhoto.h).toBe(7.5);
    const logo = cover.find((s) => s.role === "logo")!;
    expect(logo.w / logo.h).toBeCloseTo(4, 2);
    // With a cover photo the client goes into the meta line, as in the HTML.
    expect(cover.some((s) => s.role === "client-logo")).toBe(false);
    expect(cover.find((s) => s.role === "meta")!.runs![0]!.text).toContain("PENTRU HOTEL CARPAȚI");
    expect(specs[3]!.shapes.some((s) => s.role === "photo")).toBe(true);
    expect(specs[3]!.shapes.some((s) => s.role === "figure")).toBe(false);
    // Strong look: uppercase headings in Barlow Condensed.
    const title = specs[2]!.shapes.find((s) => s.role === "title")!;
    expect(title.face).toBe("Barlow Condensed");
    expect(title.runs!.map((r) => r.text).join("")).toBe(
      title
        .runs!.map((r) => r.text)
        .join("")
        .toUpperCase(),
    );
  });

  it("wraps text and splits accent runs like the HTML", async () => {
    const { wrapLines, runs } = await load();
    const style = { face: "Source Sans 3", size: 30 };
    expect(wrapLines("Un rând scurt", style, 1600)).toBe(1);
    expect(wrapLines("Ana Pop\nevenimente@casaverde.example", style, 1600)).toBe(2);
    expect(wrapLines("cuvânt ".repeat(60), style, 600)).toBeGreaterThan(4);
    expect(runs("Rezervăm data până pe **30 noiembrie**", "#937132")).toEqual([
      { text: "Rezervăm data până pe " },
      { text: "30 noiembrie", color: "#937132" },
    ]);
  });
});
