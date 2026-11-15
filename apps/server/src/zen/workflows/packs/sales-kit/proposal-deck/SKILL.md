# Offer deck: premium, not "made by AI"

`$ZEN_WORKFLOW_DIR/deck.mjs` lays out the slides (open fonts, real grid, the brand's colors);
you write the story and the words in `deck/deck.json`. The scripts are read only.

One build gives: `deck/<file>.pdf`, `deck/<file>.pptx` (the same slides as an **editable**
PowerPoint file: real text boxes, shapes, native tables and charts, speaker notes in the notes
pane; it opens in PowerPoint, Keynote and Google Slides), `deck/slides/slide-NN.png`,
`deck/contact-sheet.png`, `deck/speaker-notes.md` and `deck/fonts/` (the deck's fonts with their
licenses, to install so PowerPoint shows the same type).

## The story (6-10 slides)

1. **cover**: the offer in the client's terms ("Catering pentru conferința anuală"), subtitle
   with the concrete scope.
2. **statement** "Ce am înțeles": their situation and goal in one strong sentence, details
   under it. This slide wins the meeting: use their words from the notes.
3. **points** "Propunerea pe scurt": 2-4 parts of the solution.
4. **split** or **numbers**: why us, with real proof only (years, volumes, clients who
   agreed). No proof given: use **split** with how we work instead.
5. **timeline**: how it goes, 3-6 steps with real dates or weeks.
6. **pricing**: 1-3 options (three when it makes sense: a smaller one, the recommended one, a
   bigger one), with what each includes; the note says VAT, validity, payment terms.
7. **table** (optional): what each option includes, side by side.
8. **quote** (optional, only a real quote the person gave, with the name they allowed).
9. **next**: 2-4 next steps, the call to action with a date, and the contact.

## deck.json

```json
{
  "language": "ro",
  "file": "oferta-catering-hotel-carpati",
  "title": "Catering pentru conferința anuală",
  "subtitle": "Prânz, pauze de cafea și cina de gală pentru 180 de invitați",
  "date": "8 noiembrie 2026",
  "author": "Ana Pop, evenimente Casa Verde",
  "brand": {
    "name": "Casa Verde",
    "logo": "../brand/logo.png",
    "logoOnDark": "../brand/logo-alb.png",
    "colors": { "primary": "#1F4D3A", "accent": "#F2B544", "light": "#FBF5E8", "dark": "#1E1E1C" },
    "fonts": "modern"
  },
  "client": { "name": "Hotel Carpați", "logo": null },
  "slides": [
    { "layout": "cover", "image": "../photos/sala.jpg" },
    {
      "layout": "statement",
      "kicker": "Ce am înțeles",
      "title": "Două zile în care **mâncarea nu are voie să întârzie** programul.",
      "text": "..."
    },
    {
      "layout": "points",
      "kicker": "Propunerea",
      "title": "...",
      "points": [{ "title": "...", "text": "..." }]
    },
    {
      "layout": "split",
      "kicker": "De ce noi",
      "title": "...",
      "text": "...",
      "bullets": ["..."],
      "image": "../photos/bucatarie.jpg"
    },
    {
      "layout": "numbers",
      "title": "...",
      "stats": [{ "value": "400", "label": "porții gătite zilnic" }],
      "chart": {
        "title": "Porții servite la evenimente",
        "unit": "pe an",
        "bars": [
          { "label": "2025", "value": 34100 },
          { "label": "2026", "value": 38600 }
        ]
      }
    },
    {
      "layout": "timeline",
      "title": "...",
      "steps": [{ "when": "Martie", "title": "Degustare", "text": "..." }]
    },
    {
      "layout": "pricing",
      "title": "...",
      "options": [
        {
          "name": "Gală",
          "price": "325 lei",
          "unit": "de persoană",
          "recommended": true,
          "features": ["..."]
        }
      ],
      "note": "Prețuri fără TVA, valabile 30 de zile."
    },
    {
      "layout": "table",
      "title": "...",
      "columns": ["", "Esențial", "Gală"],
      "rows": [["Cina", "bufet", "servită"]],
      "align": ["left", "right", "right"]
    },
    { "layout": "quote", "quote": "...", "author": "Nume, funcție, firmă" },
    {
      "layout": "next",
      "title": "Pașii următori",
      "steps": ["..."],
      "cta": "Rezervăm data până pe 30 noiembrie",
      "contact": "Ana Pop · 0700 000 011\nevenimente@casaverde.test",
      "action": "Răspundeți la acest e-mail"
    }
  ]
}
```

- Paths are relative to `deck.json`. `logoOnDark` is a white/light logo for the green cover;
  without it the cover sets the name in type (never a dark logo on a dark slide).
- `colors` from the brand kit or brandbook; without one, choose a restrained palette that fits
  the trade (a deep primary, one warm or bright accent, an off-white light, a near-black dark)
  and say so in the reply. `fonts`: `modern` (Barlow + Source Sans 3), `elegant` (Playfair
  Display + Source Sans 3), `strong` (Barlow Condensed + Barlow). The form's "Look" maps to it.
- `**words**` in a title or text sets those words in the accent color: once per slide at most,
  on the words that matter.
- `notes` on any slide: what to say (goes to `speaker-notes.md` and to the PowerPoint notes
  pane). Write notes for every slide; a slide without notes gets its own title there.
- `chart` (optional, **numbers** only): 2-8 bars with real numbers from the answers or files;
  drawn under the stats in the PDF and as a native, editable chart in the PowerPoint file.
  Only when the numbers compare like with like (years, months, sites); otherwise leave it out.
- Optional `"dark": true` on statement, quote or next makes that slide use the primary color
  (at most one or two in a deck, for rhythm).

## Writing for slides

- Titles: a statement with a verb, not a label ("Pregătit în bucătăria noastră, adus cald",
  not "Despre noi"). At most 2 lines (about 60 characters), the cover 3.
- Body: at most 30 words per text block, 4 bullets of at most 10 words, point texts at most
  22 words. Numbers written as numbers.
- Kickers: 1-3 words in capitals style, the section name.
- Never: emoji, exclamation marks, "soluții inovatoare", "partener de încredere", "experiență
  unică", stock phrases, fake logos, invented clients, invented numbers or testimonials.

## Visual self-review (look at the contact sheet and every slide; fix and rebuild)

1. No ERROR lines; nothing cut off, overlapping or squeezed; titles at most 2 lines.
2. One idea per slide; the reader gets the offer from the titles alone.
3. Price slide: every price from the answers, VAT stated, recommended option clear.
4. Colors: text readable everywhere; the accent used sparingly; the logo visible and not
   distorted (a light logo on dark slides only).
5. Photos (when given) are sharp, relevant and not stretched; no photo is better than a bad one.
6. Spelling: Romanian with ș and ț (comma below); names of the client and people right.
7. It looks like a studio deck: consistent margins, calm, nothing that says "template" or "AI".

## Delivering

Give the PDF (to send) and the PPTX (to edit) with their paths, and say in one line that the
PPTX is editable: every text, table, chart and the notes can be changed in PowerPoint, Keynote
or Google Slides. Fonts: install the files in `deck/fonts/` once so PowerPoint shows the same
type (without them it substitutes a similar font, and lines may wrap a little differently).

Tell the person in one line at the end: the fonts are open (SIL OFL), free for business use;
their own photos and logos must be theirs to use.
