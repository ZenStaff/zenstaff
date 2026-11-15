# The reels template

`$ZEN_WORKFLOW_DIR/template` is a Remotion project built on the shared premium kit
(`$ZEN_WORKFLOW_DIR/kit`, read only). You only write `reels.json`; `render.mjs` validates it,
prepares the media, writes the score (music cut to the beat plus whooshes, ticks, a pop and a
button click), renders every reel (H.264, 30 fps), masters the sound to -14 LUFS (-16 with a
voice-over, the music ducked under the voice), and writes a
cover per reel (`<id>.jpg`), `captions.md`, `overview.jpg` and the review sheets in `check/`:
`<id>-contact.jpg` (a frame every 0.5 s with its time) and `<id>-safe.jpg` (the zones the
Instagram/TikTok buttons cover, shaded red).

The bar is agency work a paying client would post today: a hook that stops the thumb in the first
second, words that move with the music, real pictures, brand colors everywhere, a clean end card.

## 1. Art direction first (write it down before the plan)

Look at `check/media-sheet.jpg` and decide, in 4-6 lines of notes:

- **The one idea of each reel** and its hook (a promise, a question or the news, 2-7 words).
- **The picture for each hook**: the strongest, sharpest, most appetising image or clip (movement
  beats a still for the hook). Never start on a logo, a menu or an empty room.
- **Where the words sit** on each picture: over calm areas (table, wall, sky), never over a face or
  the product. Use `place` to move them (`top`, `center`, `bottom`).
- **One look for the set** (the same headline face on every reel, so they read as one brand on
  the grid) and one music mood. Keep the brand colors exactly as given.

## 2. reels.json

```json
{
  "brand": { "name": "Casa Verde", "primary": "#1F4D3A", "accent": "#F2B544", "logo": "logo.png" },
  "format": "vertical",
  "style": "warm",
  "music": "generated:upbeat",
  "end": {
    "title": "Rezervă o masă",
    "lines": ["@casaverde.bistro", "casaverde.ro", "Str. Lungă 12, Brașov"]
  },
  "reels": [
    {
      "id": "meniul-zilei",
      "style": "bold",
      "caption": "Meniul zilei: 39 de lei, luni-vineri 12-16. ...\n\n#brasov #pranz",
      "scenes": [
        {
          "type": "hook",
          "media": "supa.mp4",
          "kicker": "Luni-vineri, 12-16",
          "title": "Prânzul e gata la 12",
          "seconds": 2.6
        },
        {
          "type": "photo",
          "media": "masa.mp4",
          "title": "Supă caldă în fiecare zi",
          "text": "Gătită dimineața, la noi",
          "place": "top",
          "seconds": 3
        },
        {
          "type": "list",
          "media": "bucatarie.mp4",
          "kicker": "Meniul zilei",
          "title": "Trei feluri",
          "items": ["Supă sau ciorbă", "Fel principal", "Desert"],
          "seconds": 3.6
        },
        {
          "type": "offer",
          "media": "paste.jpg",
          "kicker": "Meniul zilei",
          "title": "Totul la",
          "badge": "39 lei",
          "note": "Luni-vineri, 12-16",
          "seconds": 3.4
        }
      ]
    }
  ]
}
```

- `brand.primary`: the deep brand color (backgrounds, scrims), `accent`: the highlight (one word
  of each headline, the price, the button). `dark`/`light` are optional text colors; the kit keeps
  every text above WCAG contrast automatically. Without brand colors, take a deep color and a
  bright one from the logo or the photos; never pure black, never black with orange.
- `format`: `vertical` (1080x1920, Reels/TikTok/Stories, default), `portrait` (1080x1350) or `square`.
- `style` (the look): "Bold and punchy" -> `bold` (Anton, word slams, a color block on the key
  word), "Elegant and calm" -> `elegant` (Instrument Serif, lines revealed from a mask),
  "Warm and friendly" -> `warm` (Fraunces, soft rise, italic accent word, framed photos),
  "Playful" -> `playful` (Bricolage Grotesque, pops). A reel may override it.
- `music`: "Made for you: upbeat/warm/calm" -> `generated:upbeat` / `generated:warm` /
  `generated:calm` (`generated:bright` is a faster upbeat); own file -> its file name; "No music"
  -> `none` (the sound accents stay). Cuts snap to the beat of the made-for-you music.
- `end`: the end card (logo or name, `title` = the call to action on a button; a reel cannot be
  tapped, so say where to act: "Rezervă: link în bio", "Sună la 0700 000 000"; up to 3 `lines`:
  handle, website, address or hours, each shown with a line icon). A reel may override it.

### Scenes (2 to 7 per reel; 12-25 seconds with the end card)

| type        | use it for                                 | fields                                                                        |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| `hook`      | the first scene, always: stop the scroll   | `title` (2-7 words), `kicker`, `text`, `media` (a clip is best)               |
| `photo`     | a product, dish, room, team, detail        | `media`, `title`, `text`, `kicker`                                            |
| `list`      | 2-4 short points (menu, services, reasons) | `title`, `items` (each under 36 characters), `media` (shown on top)           |
| `offer`     | a price, discount or deal                  | `badge` ("39 lei", "-20%"; numbers roll up), `title`, `text`, `note`, `media` |
| `quote`     | a real customer review the person gave you | `text` (the quote), `author`                                                  |
| `statement` | one strong line on the brand color         | `title`, `kicker`, `text`                                                     |

- `seconds`: 1.8-2.6 for most scenes, a hook 2-2.6, a list 3-4.5 (Reels move fast). The
  renderer snaps them to the beat, so cuts land on the music.
- `transition` into a scene: leave `auto` (each look has its rhythm: whips and zooms for bold,
  dissolves and pushes for elegant, pushes and a brand wipe for warm). Set one only for a reason:
  `whip`, `zoom`, `push`, `wipe` (brand panel, best before an offer), `fade`, `flash` (at most
  once per reel), `cut`.
- `media`: a file name in the media folder. For clips, `start` is the second to start from (pick
  the moment with movement). `focusX` / `focusY` (0-100) keep the subject in frame when a
  landscape picture is cut to vertical. `move`: `auto` (the hook lands with a punch-in, then
  push/pull alternate), `push`, `pull`, `pan`, `still`.
- `place`: where the words sit (`auto` = bottom). `accent`: the index of the headline word to
  highlight (0 = first; default the last word; -1 = none). Highlight the word that carries the
  meaning (the price, the day, the dish), not a filler word.
- Text limits (the check enforces them): title 48 characters, text 110, kicker 28, badge 14,
  note 60. A title of 2-6 words reads best; one line of text at most.
- Use each picture once per reel and vary pictures across reels. A `photo` scene needs media.

## 3. Words

- Only facts from the person's text and from what the photos show. Never invent prices, dates,
  discounts, products, awards, numbers or reviews. `quote` only with a real review given to you.
- The requested language; Romanian with ș and ț (comma below), never ş/ţ. Short, concrete, warm;
  no clichés ("the best in town", "unique experience"), no emoji anywhere in the video, no hype
  translated from English.
- Captions (`caption`): 2-4 short lines that say what the reel says plus one clear call to action,
  a blank line, 3-6 hashtags (place + category + business). At most one emoji, or none.

## Voice-over (optional, per reel)

The form's "Voice-over" choice: "Professional voice-over" -> `--voice elevenlabs` (the person's own
ElevenLabs account through their connector; without the connection the script makes a preview and
says so), "Local preview voice" -> `--voice preview` (Piper, free, only to check the words and the
timing: the files end in `-preview-voice`), "No voice-over" -> `--voice none` and no `voiceover`
texts. Add `--voice-language ro|en`. Render the drafts without a voice (`--voice none`); the voice
is made once, for the final render.

- Give each reel that should speak a `voiceover`: 1-3 short sentences that say what the screen
  says (sound-off viewers still get the message from the on-screen words), about 2 words a second,
  ending before the end card (the voice starts at 0.5 s; `--check` warns when a text is too long,
  the render fails with the exact seconds). Numbers as words ("treizeci și nouă de lei"), Romanian
  with ș and ț. No voice-over on a reel = that reel stays music only.
- Any generated voice puts the "Voce generată cu AI" / "AI-generated voice" label on the reel for
  its whole length. It is placed by the template above the safe zone, clear of every text zone of
  every scene and of the end card; never move or cover it, and never remove it from an ad.
- The music ducks by itself: while the voice speaks it sits about 12 dB under it, in the pauses it
  comes back up (short ramps, no pumping between close sentences), and the whole mix is mastered to
  -16 LUFS with the true peak under -1 dBTP. The result line `ducking` gives the two music levels.
  Nothing to set; just leave real pauses in the script where the music should breathe.

## The voice that was used (always say it)

The last lines the script prints (`voiceNotice`) say which voice was used. Repeat them in your
reply, in the person's language, word for word in meaning:

- Professional voice (ElevenLabs, their own account): say so, and that the reels carry the
  "AI-generated voice" label.
- Local preview (Piper): say plainly that this is a PREVIEW voice, only to check the words and the
  timing, not for the final version and never for ads; the file names end in `-preview-voice`.
  Then offer the way to a professional voice: connect their own ElevenLabs account (type
  "connect ElevenLabs" / "conectează-mi ElevenLabs" in the chat, or Settings > Connections; Zen keeps
  no key), then they write "Refă cu voce profesională" / "Redo with a professional voice".
- When they write "Refă cu voce profesională" / "Redo with a professional voice": run the same final
  command again with `--voice elevenlabs` and the same texts (nothing else changes). If ElevenLabs is
  still not connected, do not make another preview: tell them how to connect it. Never call a
  preview voice final, and never suggest it for an ad.

## 4. Render: draft, review, final

1. `node "$ZEN_WORKFLOW_DIR/template/render.mjs" --plan reels-kit/reels.json --media <media> --out reels-kit --check`
2. Draft (half size, fast): add `--quality draft`.
3. **Review every reel like a demanding creative director.** Open `check/<id>-contact.jpg` and
   `check/<id>-safe.jpg` and go through this list; fix the plan and render the draft again
   (`--only <id>`) until every answer is yes:
   - Is the hook headline readable at 1.0 s and does the first frame already show something
     strong (no empty or dark opening)?
   - Does every headline sit on a calm part of the picture, never over a face or the product?
     Nothing important in the red zones of the safe sheet?
   - Is each picture sharp and well cropped (subject in frame, no awkward cut through a head or
     a plate)? If not, change `focusX`/`focusY`, `start` or the picture.
   - Is the highlighted word the one that matters? Any typo, any word that could be shorter?
   - Does every scene earn its time (no scene where nothing new happens for 2 s)?
   - Is the end card's button text a clear action and are the contact lines correct?
4. Final: the same command with `--quality final` (default), plus `--voice <elevenlabs|preview>
   --voice-language <ro|en>` when the reels have a voice-over. Look at the final contact sheets once
   more before you deliver (the AI-voice label sits at the top, clear of the words).

## When it fails

Every error starts with `ERROR:` and says what to fix in the plan (a missing file, a text that is
too long, a wrong color, a hook with too many words). Fix `reels.json` and run the same command
again. Do not edit the template or the kit, do not install anything and do not try other tools.

## License notes (tell the person in one line at the end)

- Remotion is free for individuals and companies with up to 3 people; larger companies need a
  Remotion company license (remotion.pro).
- The fonts are open (SIL OFL), and the music and sound effects are generated on this computer, so
  all are free to post. Photos, clips, logo and an own music file must be the person's own or
  licensed.
