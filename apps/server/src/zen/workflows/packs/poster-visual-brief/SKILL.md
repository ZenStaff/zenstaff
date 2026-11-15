# The poster builder

`$ZEN_WORKFLOW_DIR/build.mjs` (read only) turns `poster/poster.json` into the finished set, with
the shared premium kit (`$ZEN_WORKFLOW_DIR/kit`: type, color, real photo mockups, print export):

- `<name>-<size>-print.pdf`: the print file, trim size plus 3 mm bleed on every side, text and logo
  kept 12 mm inside the trim. This is what the printer gets.
- `<name>-<size>-proof.pdf`: the same with crop marks, for checking and for printers that want marks.
- `<name>-<size>-300dpi.png`: the trimmed poster at 300 dpi.
- `social/`: Instagram/Facebook post 1080x1350, story 1080x1920 (words kept out of the story
  buttons), square 1080x1080, Facebook event cover 1920x1005, each laid out for its shape.
- `mockups/`: the poster framed on a wall, on a slatted wood wall, on a street A-board, and the story
  on a phone in a hand: real Pexels photos (downloaded once, licensed for commercial use), the design
  warped onto the real surface and blended with its light. Never shown as anything but a preview.
- `visual-brief.md`: goal, final copy, hierarchy, colors with contrast ratios and approximate CMYK,
  type, image direction, print specifications, approval checklist and credits.
- `overview.jpg`: everything on one sheet, for your review.

The bar is a poster an agency would print: one clear message readable in three seconds from two
metres, a real photo, a strict grid, the brand colors, nothing crowded and no empty corners.

## poster.json

```json
{
  "size": "A3",
  "look": "warm",
  "layout": "auto",
  "brand": { "name": "Casa Verde", "primary": "#1F4D3A", "accent": "#F2B544", "logo": "logo.png" },
  "photo": "paine.jpg",
  "focusY": 40,
  "kicker": "Târgul de Crăciun · Stand 14",
  "headline": "Pâine caldă pentru serile reci",
  "accent": 4,
  "sub": "Cozonac, pâine cu maia și ciocolată caldă, direct din cuptorul nostru.",
  "details": [
    { "icon": "calendar", "text": "12-24 decembrie" },
    { "icon": "clock", "text": "10:00-22:00" },
    { "icon": "map-pin", "text": "Piața Sfatului, Brașov" }
  ],
  "cta": "Te așteptăm la stand",
  "url": "casaverde.ro",
  "brief": {
    "goal": "One sentence: what the poster must make people do.",
    "remember": "The one thing a passer-by must remember.",
    "imageIdeas": ["Three concrete photo ideas for the next shoot"],
    "avoid": ["what not to show"]
  }
}
```

- `size`: "A3 poster" -> `A3`, "A4 poster or flyer" -> `A4`, "A5 flyer" -> `A5`, "A2 poster" ->
  `A2`, "50x70 cm poster" -> `50x70`.
- `look`: "Clean and minimal" -> `modern` (Bricolage Grotesque), "Warm and friendly" -> `warm`
  (Fraunces, italic accent word), "Premium" -> `elegant` (Instrument Serif), "Bold and loud" ->
  `bold` (Anton, all caps), "Playful" -> `playful`. `editorial` (Fraunces) suits culture and events.
- `layout`: `auto` (a photo on top when there is one, otherwise type on the brand color), or
  `photo-hero`, `type-led` (big type, the photo as a tilted print inset), or the two editorial
  layouts below, `roundel` (a dish seen from above, on paper) and `festival` (the name in the sky,
  behind the hills). Pick them whenever the photo allows: they are the agency-level ones.
- `brand`: colors as `#RRGGBB` (from the form, the brand guide or the logo; never pure black, never
  black with orange). Text contrast is checked and kept above 4.5:1 automatically.
- `photo`, `brand.logo`: paths relative to poster.json. `focusX`/`focusY` (0-100) keep the subject
  in the frame. Use a photo of at least 2000 px on the long side for A3 (it prints at 150+ dpi).
- `kicker`: the small line above the headline (event, place, "Nou"), under 40 characters.
- `headline`: 2-9 words. `accent`: index of the word in the accent color (default the last word;
  -1 none). The builder fits the size to the grid; every word stays whole.
- `sub`: one sentence, under 140 characters. `details`: up to 4 lines under 40 characters each,
  with an icon: `calendar`, `clock`, `map-pin`, `phone`, `globe`, `at-sign`, `instagram`, `mail`.
- `cta` and `url`: the band at the foot of the poster. `legal`: optional small print for the brief.
- `mockups` (optional): which mockups to make; default the four above. Others in the kit:
  `menu-clipboard` (an A4 sheet on a clipboard, good for flyers).

## The `roundel` layout (restaurants, cafés, bakeries: one dish seen from above)

The poster is set on paper like a magazine page: a masthead (the brand, `masthead`, `kicker`), the
headline on one line, the dish cut as a perfect circle out of the photo, a row of three `facts` and
a footer (`cta`, `url`). With `clock`, the dish becomes a clock face: the serving hours are drawn
as an arc in the strong color and `items` (what is served) run around the ring. Colors: `brand.paper`
(light, calm), `brand.primary` (ink, calm), `brand.accent` (the strong one: the arc and the first
fact only).

```json
{
  "layout": "roundel",
  "look": "warm",
  "photo": "ciorba.jpg",
  "brand": { "name": "Polonic", "primary": "#1B2233", "accent": "#D63A1F", "paper": "#F2EDE3" },
  "roundel": { "x": 42, "y": 51.9, "r": 40 },
  "clock": { "from": "12:00", "to": "15:00" },
  "items": ["Ciorbă", "Fel principal", "Desert", "Pâine de casă"],
  "masthead": "Bistro de prânz · Cluj-Napoca",
  "kicker": "Din 1 decembrie",
  "headline": "Ora supei.",
  "accent": 1,
  "facts": [
    { "label": "Prânzul zilei", "value": "39 lei", "note": "Trei feluri și pâine de casă" },
    { "label": "Se servește", "value": "12–15", "note": "De luni până vineri" },
    { "label": "Ne găsești", "value": "Horea 9", "note": "Cluj-Napoca, lângă gară" }
  ],
  "cta": "Masa e pusă la 12 fix.",
  "url": "polonic.ro"
}
```

- `roundel`: the circle of the dish in the photo: centre `x` and radius `r` in % of the photo
  width, centre `y` in % of its height. Measure it on the photo (look at it); keep the circle
  inside the food so no table shows at the edge. The photo needs the dish at 1500 px or more.
- `headline`: 1-5 words, one line. The idea goes here, not the offer ("Ora supei.", not
  "Prânzul zilei la 39 lei"). `facts`: up to 3, `value` under 14 characters (set large), the rest
  in `note`. `items`: under 70 characters together.

## The `festival` layout (festivals, concerts, open-air events: a landscape with sky)

The festival name is set as wide as the poster, in the sky, and slips behind the landscape: the
builder finds the sky in the photo and lays the hills, trees or rooftops back over the letters. A
sun in the strong color sets behind the name (`"sun": false` to leave it out). Below: the line-up
in tiers, then the dates (large, strong color), the place, the tickets and the address. The
photo is moved so its horizon sits at the same height on every format; the event cover gets a
line-up panel on the right.

```json
{
  "layout": "festival",
  "look": "bold",
  "photo": "dealuri.jpg",
  "brand": { "name": "Dealuri", "primary": "#0F3B2E", "accent": "#FF4F87", "paper": "#F6EEDF" },
  "headline": "Dealuri",
  "edition": "Ediția a 3-a",
  "kicker": "Festival de muzică și arte",
  "datesShort": "23–26 iulie 2027",
  "dates": "23–26.07",
  "lineup": [
    ["Headliner A", "Headliner B"],
    ["Three", "Second", "Tier"],
    ["Six or so smaller names"],
    ["și încă 24 de concerte"]
  ],
  "details": [{ "text": "Poiana cu Nuci" }, { "text": "lângă Sighișoara, jud. Mureș" }],
  "tickets": [
    { "label": "Abonament 4 zile", "price": "289 lei" },
    { "label": "Bilet de o zi", "price": "99 lei" }
  ],
  "cta": "Bilete pe dealuri.ro",
  "url": "dealuri.ro",
  "depth": { "tolerance": 7, "overlap": 0.14 }
}
```

- The photo: a clear sky over a defined skyline (hills, a ridge of trees, roofs), sky in the top
  third. Mist or a sky that melts into the land does not cut well; then set `"depth": { "tolerance": 4 }`
  or pick another photo.
- `depth.overlap`: how much of the letters' height sinks behind the land (0.1-0.25; above that the
  name stops reading from two metres). `depth.tolerance`: raise it (8-10) if the cut follows clouds
  instead of the land, lower it if the hills are missed. `sunSize`, `sunX`, `sunRise` move the sun.
- `headline`: the festival name, 1-3 words. `lineup`: 1-4 tiers, headliners first, at most 30
  names; the first two tiers are kept on one line each. `titleColor` overrides the name's color.

## Quick rounds

`--preview` writes only the poster (at 110 dpi) and the social versions in a few seconds: use it for
the art-direction rounds, then build once without it for the print files and the mockups.

## Review checklist (open overview.jpg and the PNG)

- From two metres (the overview at small size): is the headline the first thing you read, and does
  it say the one thing to remember?
- Does the photo sit well (subject not cut, no busy area under the words)? If not, change
  `focusX`/`focusY` or the photo, or use `type-led`.
- Are the details right, short and on one line each? Any typo, any missing ș/ț?
- Does every social version read on a phone? Nothing important hidden in the story's top or bottom.
- Do the mockups look like real photos of a printed poster (straight, not cut off)?

Fix poster.json and build again until every answer is yes.

## When it fails

Every error starts with `ERROR:` and says what to fix. A mockup whose photo cannot be downloaded
is skipped and listed in the brief's credits. Do not edit the builder or the kit, do not install
anything and do not try other tools.

## License notes (tell the person in one line at the end)

The fonts are open (SIL OFL). Mockup photos are from Pexels (free commercial use, no attribution
needed; they are previews of the design, not stock to resell). The poster's own photos and logo
must be the person's own or licensed.
