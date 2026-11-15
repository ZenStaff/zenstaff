# The promo video template

`$ZEN_WORKFLOW_DIR/template` is a Remotion project built on the shared premium kit
(`$ZEN_WORKFLOW_DIR/kit`, read only). You only write `props.json`; `render.mjs` checks it, makes
the score (music cut to the beat, whooshes on the transitions, a click on the button), renders
the video, masters the sound (-14 LUFS, -16 with a voice-over), and writes a cover image and the
review sheets in `check/` (a frame every 0.5 s with its time, and the safe zones). Never edit the
template or the kit.

The bar is a promo an agency would deliver: it lands on the first beat, every scene shows a real
picture in a considered layout, the words are few and big, and it ends on a clear action.

## 1. Art direction (before writing props.json)

Write 4-6 lines of notes: the story in 4-5 beats (a hook that names the benefit, two or three
proofs with real pictures, the offer), the strongest picture for the opening (movement beats a
still), where the words sit on each picture, and the look. Never open on a logo or a slogan alone.

## 2. props.json

```json
{
  "format": "landscape",
  "seconds": 30,
  "style": "warm",
  "brand": { "name": "Casa Verde", "primary": "#1F4D3A", "accent": "#F2B544", "logo": "logo.png" },
  "scenes": [
    {
      "kicker": "Bistro de familie în Brașov",
      "title": "Gătit în casă, din zori",
      "image": "cafea.mp4",
      "focusX": 35
    },
    {
      "kicker": "În fiecare dimineață",
      "title": "Pâine din cuptorul nostru",
      "text": "Coaptă la 6, pe masa ta la prânz",
      "image": "paine.jpg"
    },
    {
      "kicker": "Meniul zilei",
      "title": "Trei feluri la 39 de lei",
      "text": "Luni-vineri, 12-16",
      "image": "paste.jpg",
      "image2": "supa.jpg"
    },
    { "title": "Masa ta te așteaptă", "text": "Str. Lungă 12, Brașov", "image": "sala.jpg" }
  ],
  "cta": {
    "title": "Rezervă o masă pentru weekend",
    "button": "Rezervă acum",
    "subtitle": "casaverde.ro"
  },
  "music": "generated:warm"
}
```

- `format`: "Landscape 16:9" -> `landscape` (1920x1080), "Vertical 9:16" -> `vertical`
  (1080x1920, words kept out of the Reels/TikTok buttons), "Square 1:1" -> `square`.
- `seconds`: 30 unless told otherwise (10-60). Scene lengths are set for you and land on the beat.
- `style` (the look): "Modern and clean" -> `modern` (Bricolage Grotesque), "Warm and friendly"
  -> `warm` (Fraunces, italic accent word), "Bold and punchy" -> `bold` (Anton, word slams),
  "Elegant and calm" -> `elegant` (Instrument Serif).
- `brand`: colors as `#RRGGBB`. Without brand colors, take a deep color and a bright one from the
  logo or the photos; never pure black, never black with orange. Text contrast is kept
  automatically. `logo` shows as a small mark in the corner and on the end card.
- `scenes`: 3-5. The first is the opening (2-7 words). `kicker` is the small line above a title,
  `text` one short line under it. `image` is a photo or a short clip in the public folder;
  `image2` a second photo for the `cards` layout. `focusX`/`focusY` (0-100) keep the subject in
  frame. `accent`: index of the title word to highlight (default the last; -1 none).
- `layout`: leave `auto` (opening full picture, then split screen, floating cards, full picture),
  or set `full`, `split`, `cards` or `statement` (words only, on the brand color). A scene without
  a picture becomes a statement.
- `cta`: `title` is the offer or the invitation (big, on the end card), `button` the action on the
  button (2-3 words), `subtitle` the website or phone.
- `music`: `generated:upbeat`, `generated:warm`, `generated:calm` or `generated:bright` (made on
  this computer, free to use), a music file in the public folder, or `none`.
- Every file you name must be in `promo-video/public`; use each picture once.

## 3. Review checklist (draft, then final)

Open `check/<name>-contact.jpg` and `check/<name>-safe.jpg` after the draft and answer each with
yes before the final render:

- The first frame already shows a strong picture and the opening title is readable by 1 s.
- No title sits over a face or the product; nothing important in the red zones (vertical).
- Every picture is sharp and well cropped; no stretch where nothing new happens for 3 s.
- The highlighted word is the one that matters; no typo; Romanian has ș and ț with a comma.
- The end card says one clear action and the website or phone is right.

## Voice-over (optional)

Add `--voiceover-text "<one or two sentences>"` and `--voice-language ro|en` to the render command,
with `--voice` from the form: "Professional voice-over" -> `--voice elevenlabs` (the person's own
ElevenLabs account; without the connection the script makes a preview and says so), "Local preview"
-> `--voice preview` (Piper, free, only to check: the video name ends in `-preview-voice`), "No
voice-over" -> leave out `--voiceover-text`. Any generated voice puts an "AI-generated voice" label
on the video (ads must carry it).

The music ducks by itself: while the voice speaks it sits about 12 dB under it, in the pauses it
comes back up (short ramps, no pumping between close sentences), and the whole mix is mastered to
-16 LUFS with the true peak under -1 dBTP. The result line `ducking` gives the two music levels.
Nothing to set; just leave real pauses in the script where the music should breathe.

## The voice that was used (always say it)

The last lines the script prints (`voiceNotice`) say which voice was used. Repeat them in your reply,
in the person's language, word for word in meaning:

- Professional voice (ElevenLabs, their own account): say so, and that the video carries the
  "AI-generated voice" label.
- Local preview (Piper): say plainly that this is a PREVIEW voice, only to check the words and the
  timing, not for the final version and never for ads; the file name ends in `-preview-voice`.
  Then offer the way to a professional voice: connect their own ElevenLabs account (type
  "connect ElevenLabs" / "conectează-mi ElevenLabs" in the chat, or Settings > Connections; Zen keeps
  no key), then they write "Refă cu voce profesională" / "Redo with a professional voice".
- When they write "Refă cu voce profesională" / "Redo with a professional voice": run the same
  command again with the professional voice and the same texts (nothing else changes). If
  ElevenLabs is still not connected, do not make another preview: tell them how to connect it.
  Never call a preview voice final, and never suggest it for an ad.

## When it fails

`render.mjs` prints one line starting with `ERROR:` and a plain reason. Fix props.json and run it
again; do not install anything and do not try other tools.

## License notes (tell the person in one line at the end)

Remotion is free for individuals and companies with up to 3 people; larger companies need a
Remotion company license (remotion.pro). The fonts are open (SIL OFL); the made-for-you music and
sound effects are generated on this computer and free to post. Photos, clips, logo and an own
music file must be the person's own or licensed.
