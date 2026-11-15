# Brandbook builder

`$ZEN_WORKFLOW_DIR` holds `extract.mjs` (reads a website) and `build.mjs` (makes the PDF and the
social pack); both are read only. You only write `brandbook/brand.json`.

## brand.json

```json
{
  "name": "Casa Verde",
  "language": "ro",
  "tagline": "Bistro de familie în Brașov",
  "description": "Two or three sentences: what they do, how, for whom.",
  "audience": "One sentence about who they serve.",
  "values": ["Ingrediente locale", "Gătit în casă", "Ospitalitate caldă"],
  "website": "casaverde.ro",
  "logo": "../logo.png",
  "logoOnDark": "../logo-white.png",
  "photos": ["../photos/bread.jpg"],
  "colors": [
    {
      "name": "Verde pădure",
      "hex": "#1F4D3A",
      "role": "primary",
      "usage": "Fundaluri, logo, titluri"
    },
    { "name": "Galben miere", "hex": "#F2B544", "role": "accent", "usage": "Butoane și accente" },
    { "name": "Crem", "hex": "#FBF5E8", "role": "light", "usage": "Fundal deschis" },
    { "name": "Cărbune", "hex": "#1E1E1C", "role": "dark", "usage": "Text" }
  ],
  "fonts": { "heading": "Playfair Display", "body": "Source Sans 3" },
  "tone": {
    "summary": "One sentence.",
    "weAre": ["calzi", "simpli", "concreți"],
    "weAreNot": ["pretențioși", "reci", "vagi"],
    "wordsWeUse": ["făcut în casă", "de sezon"],
    "wordsWeAvoid": ["experiență unică", "cel mai bun din oraș"],
    "examples": [
      {
        "instead": "Oferim o experiență culinară unică.",
        "say": "Gătim în fiecare zi, din ce e proaspăt."
      }
    ]
  },
  "social": {
    "handle": "@casaverde.bistro",
    "posts": [
      {
        "headline": "Meniul de toamnă a sosit",
        "text": "Supă de dovleac și pâine caldă.",
        "cta": "Rezervă o masă"
      }
    ],
    "story": { "headline": "...", "text": "...", "cta": "..." }
  },
  "contact": {
    "person": "Andrei Pop",
    "role": "Bucătar",
    "phone": "0700 000 000",
    "email": "salut@casaverde.test"
  }
}
```

- Paths (`logo`, `logoOnDark`, `photos`, own font files) are relative to `brand.json`. Without a
  logo, the name is set as a wordmark in the heading font. If a logo is light (white) and there is
  no dark version, give it as `logoOnDark` and leave `logo` empty only if no dark version exists.
- `language`: `ro` or `en`. Write every text in that language; Romanian with ș and ț (comma below).
- `colors`: 2-8, each with `name`, `hex`, `usage`; exactly one `primary`, ideally one `accent`,
  `light` and `dark`. From the form first, then the logo, then the website (the extract lists the
  colors by how much of the page they cover; ignore plain white, black and greys unless they are
  the text and background colors). Contrast ratios are computed for you.
- `fonts`: `heading` and `body`, each one of `Fraunces`, `Instrument Serif`, `Playfair Display`,
  `Bricolage Grotesque`, `Anton` (headings only, all caps), `Barlow`, `Barlow Condensed`,
  `Source Sans 3`, `Caveat` (accents only), or `{"name": "Their Font", "file": "fonts/Their.ttf"}`
  for the company's own files. Map the form: "Modern sans" -> Bricolage Grotesque + Source Sans 3,
  "Elegant serif" -> Instrument Serif + Source Sans 3 (or Fraunces + Source Sans 3 for a warmer
  serif), "Strong condensed" -> Anton + Barlow; "Pick for me": Fraunces + Source Sans 3 for food,
  hospitality and crafts, Instrument Serif + Source Sans 3 for fashion, beauty, law, Bricolage
  Grotesque + Source Sans 3 for tech, services and shops, Anton + Barlow for sport and events.
  Never Inter or Archivo. If the website uses a font that is not in the list, name it in the
  summary and pick the closest open one.
- `tone`: 3 "we are" and 3 "we are not", 3-6 words to use and to avoid, 1-3 before/after examples
  in their own domain.
- `social.posts`: 3 posts (headline up to 6 words, one short line of text, a call to action of 2-4
  words). They become `post-1..3.png`; the second uses a photo when photos are given. `story`
  defaults to the first post.

## Optional sections (for a full agency manual)

All optional; leave a key out and the page keeps its standard form. Paths are relative to
brand.json; every listed file must exist.

- `fonts.label`: a third font for labels, captions and page numbers (often a mono), same form as
  `heading`/`body`.
- `colors[].share`: percent of a typical layout (for example 60 / 32 / 8). It sets the
  proportions bar and the column widths. `colorRule`: one sentence on how the colors work together.
- `positioning`: `{ "title", "lead", "quote", "against": [...], "for": [...] }`, a page after the
  story: what the brand stands against (struck through) and for.
- `logoVariants`: up to 8 `{ "file", "ground", "caption", "height" }` tiles (symbol, horizontal
  and stacked lockups, one-color, app icon, seal). `ground` is `light`, `dark`, `accent`,
  `photo` or a `#hex`; `height` is the logo height in the tile (`"24%"` for wide lockups).
- `logoRules`: `{ "clearSpace": { "file", "ratio", "text" }, "minimum": [{ "file", "heightMm",
  "label" }], "donts": [{ "caption", "file", "style", "ground", "height" }] }`. `ratio` is X
  (the clear space) as a share of the logo height; the drawing is fitted to the box. A don't
  can be a CSS `style` on the logo (`transform:scaleX(1.5)`, `filter:hue-rotate(160deg)`) or a
  `file` with the wrong artwork.
- `typography.scale`: up to 7 `{ "name", "font": "heading"|"body"|"label", "size" (pt),
  "leading", "sample" }` rows, shown with a diacritics check (`typography.diacritics` overrides
  the Romanian set).
- `tone.banned` (words never used, struck through) and `tone.pairs`: up to 3 `{ "topic", "no",
  "also", "yes" }` rows, the "Not this. Not this either. This." page.
- `motifs` (up to 4 `{ "title", "text", "file", "ground" }`) and `motifsLead`: the recurring
  graphic devices, each drawn on its own image.
- `icons`: `{ "lead", "stroke", "accent", "names": [...], "rules": [...], "dont": { "names",
  "caption" } }` with Lucide names from the kit (`kit/common/icons.js`); an unknown name stops the
  build and lists the ones available.
- `imagery`: `{ "title", "do": [...], "dont": [...] }` replaces the photography page texts
  (restaurant defaults) for brands whose images are not food and people.
- `applications`: pages of the company's own application artwork, before the photo mockups:
  `[{ "title", "note", "columns", "rows", "items": [{ "file", "caption", "fit": "cover",
  "ground", "inset" }] }]`, up to 4 items a page. Use one item a page for wide screens, `fit:
  "cover"` for images that should fill the tile, and a `ground` equal to the image background
  for flat artwork. Keep the files under about 2400 px so the PDF stays light.
- `mockups`: the photo mockups to use, by id (`business-cards`, `coffee-cup`, `kraft-bag`, `mug`,
  `tshirt`, `apron`, `shop-window`, `wall-sign`, `cafe-wall`, `badge`, `poster-frame`,
  `poster-street-board`, `phone-story`), or `false` for none. Software and service brands should
  not get cups and kraft bags.
- `appsLead`: the lead of the applications opener.

## Output

`brandbook/<name>-brandbook.pdf`: an A4 landscape manual of about 19 full pages in the standard of
our own brand books: cover on a photo, contents, brand story with values, four section openers
(full-bleed photo with the number and title on the brand color), logo versions on light, color,
dark and photo, clear space, minimum size and six don'ts, colors (HEX, RGB, CMYK, usage) with
proportions and a WCAG contrast table, typography specimens and hierarchy, tone of voice with
before/after examples, photography do/don't, and the identity applied on real photo mockups:
business cards, cup, kraft bag, mug, shop window, facade sign, cafe wall, framed poster, street
board, T-shirt, a story on a phone, plus the social kit and the back cover.
`brandbook/web/index.html`: the same manual as a web page, with its fonts and images in
`brandbook/web/assets/` and the PDF next to it (upload the folder as it is).
`brandbook/mockups/`: the mockups as JPEG (Pexels photos downloaded once; the design is warped
onto the real surface and blended with its light). `brandbook/social/`: post-1..3.png (1080x1350),
story.png (1080x1920), profile.png (1080x1080), facebook-cover.png (1640x624),
linkedin-banner.png (1584x396). `brandbook/check/page-NN.png` and `brandbook/overview.jpg`: the
pages for review. `brandbook/CREDITS.md`: the mockup photo credits.

Photos make or break a brand book: give 5-9 of the company's own (food, place, people, details);
they open the sections and fill the story, typography and photography pages. Without photos the
openers use the brand color.

## Review (before you deliver)

Open `brandbook/overview.jpg` and then each `check/page-NN.png` at full size, like an art director:

- No page has a large empty area or text running into the footer; nothing is cut off.
- The logo is crisp and never distorted on the logo pages and in every mockup; in each mockup it
  sits centered on the real printed surface at a believable size.
- Every text is in the requested language with correct diacritics; no invented facts.
- Colors are exactly the brand's; the contrast table shows which pairs are fit for text.
- The social images read on a phone.

Fix brand.json (shorter texts, other photos, another logo file) and build again until it is a
manual a designer would hand over.

## When it fails

Errors start with `ERROR:` and say what to fix in brand.json. Do not edit the scripts, do not
install anything and do not try other tools.

## License notes (tell the person in one line at the end)

The fonts are open (SIL OFL): free for print, web and video. Mockup photos are from Pexels (free
commercial use; previews, not stock to resell). Own font files and photos must be licensed for the
company. CMYK values are screen conversions: ask the printer for a proof.
