# Brand fix

`$ZEN_WORKFLOW_DIR/brandfix.mjs` (read only) has three commands: `scan`, `outro` (a preview of the
generated outro: `--logo <png> --size 1080x1920 --title ... --lines "a|b"`) and `apply`. You only
write `brand-fix/plan.json`.

## plan.json

```json
{
  "title": "Casa Verde: videos brought on brand",
  "brand": { "name": "Casa Verde", "primary": "#1F4D3A", "accent": "#F2B544" },
  "look": "modern",
  "outro": {
    "logo": "brand/logo.png",
    "title": "Book a table",
    "lines": ["casaverde.ro", "@casaverde"],
    "seconds": 3
  },
  "intro": { "video": "brand/intro.mp4" },
  "videos": [
    {
      "file": "2025/autumn-menu.mp4",
      "cutAt": 17.0,
      "remove": [[22.5, 26.0]],
      "patches": [
        {
          "from": 3.0,
          "to": 7.0,
          "x": 28,
          "y": 76,
          "w": 44,
          "h": 7,
          "fill": "#C0392B",
          "text": "Only 39 lei",
          "color": "#FFFFFF"
        }
      ],
      "status": "ready",
      "note": ""
    },
    {
      "file": "old-ad.mp4",
      "action": "skip",
      "status": "redo",
      "note": "The voice says the old price 29 lei; record a new voice-over."
    }
  ]
}
```

- `outro`: either `{ "video": "path/outro.mp4" }` (the person's own outro, scaled to every size)
  or `{ "logo": "path/logo.png", "title": ..., "lines": [...] }`: the premium end card made for each
  video size (3.5 s): the logo lands on the brand color, `title` becomes a call-to-action button
  that is pressed on the beat (2-4 words: "Rezervă o masă"), and up to 3 `lines` (handle, website,
  phone, address) appear with line icons; a sound accent and a click are generated. The `title`
  and `lines` come from the person's outro text; if none was given, use only the logo. Paths are
  relative to the current folder.
- `brand`: `primary` (the deep brand color: the outro background), `accent` (the button and
  icons), `name` (shown when there is no logo). Colors as `#RRGGBB`, from the form or the logo.
  Older plans with `background`/`text` still work (the darker one becomes the background).
- `look`: the type of the corrected text and the outro: `modern` (default), `warm`, `bold` or
  `elegant`; match the videos' own feel.
- `intro`: optional; `"intro": false` on a video skips it there. `"outro": false` likewise.
- Per video (`file` is the path inside the videos folder, as listed by `scan`):
  - `cutAt`: seconds where the old ending starts (everything after is dropped). Pick the time of
    the first frame of the old end card, usually one of `cutsNearEnd`. Leave it out when the video
    has no old ending.
  - `remove`: ranges `[from, to]` (seconds) to drop from the middle, e.g. a scene about an old offer.
  - `patches`: cover outdated text. `x`, `y`, `w`, `h` are in % of the frame (0-100, top-left
    origin), estimated from the sheet; make the box a little larger than the text. With `text`
    (the corrected wording, short, from "What is true now") the old words are covered by a rounded
    label in the brand type that fades in and out with the scene (make the box cover the whole old
    line, including any subtitle it overlaps, and end it with the shot the old words belong to): `fill` is its color (the brand
    accent, or the color of the old label so it blends in), `color` the text color (optional;
    contrast is kept automatically). Without `text`, the area is blurred: never leave an empty
    solid box. `from`/`to` must cover every frame where the old
    text is visible, including its animation in and out (check the frames around it).
  - `status`: `ready` when nothing outdated is left, `to confirm` when a person should look once
    (a wording choice, a blurry frame), `redo` when covering cannot fix it. Use `"action": "skip"`
    for videos that need a redo (they are listed in the report, not rendered) and for videos that
    are already fine (status `ready`, note "already on brand"; or include them without changes to
    give them the new outro).
  - `note`: one plain sentence for the report, in the person's language (Romanian with ă, â, î,
    ș, ț; never without diacritics).
  - The old outro of a clip may come right after the clip's own end card: when the clip already
    ends on a card with the current brand, cut before that card too, so the video does not end on
    two cards.

## What cannot be fixed by covering

Spoken claims (the voice says the old price), text that moves across the whole frame, an old logo
woven into the footage, or a scene whose whole point is an outdated offer: cut the scene with
`remove` if the video still makes sense without it, otherwise mark the video `redo` and say what
to remake. Never put a price, number or promise on screen that is not in "What is true now".

## Output

`apply` writes the fixed videos to the output folder with the same subfolders, H.264 (CRF 19) +
AAC 192 kbit/s, -14 LUFS (two-pass loudness), fast start, original size, 30 fps; old endings are
replaced by the new outro with a 0.3 s crossfade.

Before you report, open `check/<n>-after-ending.jpg` and a frame inside every patch
(`ffmpeg -ss <second> -i <video> -frames:v 1 brand-fix/check/patch-<n>.jpg`) and check like an
editor: the old words are fully hidden for the whole time they were on screen (also while they
animate in and out), the label reads in one line and sits where the old one was, the outro shows
the right button and contact lines, and no video ends on two end cards. `REPORT.md` lists every video, the changes, the
ready-to-post list and what to confirm or redo; `check/<n>-after-ending.jpg` shows each new ending.

## License notes (tell the person in one line at the end)

Only the person's own videos, logo and outro are used; the outro's sound accents are generated on
this computer and the fonts are open (SIL OFL). The outro is rendered with Remotion: free for
individuals and companies with up to 3 people; larger companies need a Remotion company license. If the old videos use licensed music, its license still applies.
