# Tutorial recorder

`$ZEN_WORKFLOW_DIR` holds `explore.mjs` (lists what can be clicked), `make.mjs` (rehearses,
records and builds) and their helpers (read only). You only write `tutorial/tutorial.json`.

## tutorial.json

```json
{
  "url": "https://example.com",
  "language": "ro",
  "voice": "local",
  "format": "landscape",
  "title": "Cum rezervi o masă online",
  "subtitle": "În patru pași, de pe telefon sau calculator",
  "brand": { "primary": "#0F4C5C", "accent": "#F2C14E", "logo": "tutorial/logo.png" },
  "outro": { "title": "Gata, masa e aproape rezervată", "lines": ["example.com/rezervari"] },
  "cookies": "accept",
  "steps": [
    {
      "title": "Deschide site-ul",
      "say": "Deschide site-ul example.com.",
      "do": [{ "goto": "https://example.com" }],
      "expect": { "text": "Bine ai venit" }
    },
    {
      "say": "Apasă pe Rezervă, sus în dreapta.",
      "do": [{ "click": { "role": "link", "name": "Rezervă" } }],
      "expect": { "url": "/rezervari" }
    },
    { "say": "Alege data și ora.", "do": [{ "select": { "label": "Ora" }, "option": "19:00" }] },
    { "say": "Scrie numele tău.", "do": [{ "fill": { "label": "Nume" }, "value": "Ana Pop" }] },
    {
      "say": "La final apeși pe Trimite. Noi ne oprim aici.",
      "do": [{ "highlight": { "role": "button", "name": "Trimite" } }]
    }
  ]
}
```

- `language`: `ro` or `en` (from the form). `voice`: "Professional voice" -> `elevenlabs` (the
  person's own ElevenLabs account; add `"elevenlabsVoice": "<voice id>"` when they gave one), "Local
  preview" -> `preview` (Piper, free, only to check), "No voice" -> `none`. When `elevenlabs` is
  chosen but not connected, the recorder makes a preview and says so.
- `format`: "Landscape" -> `landscape` (1920x1080), "Vertical" -> `vertical` (1080x1920, the phone
  layout of the site). Explore with the same format.
- `brand`: colors as `#RRGGBB` (from the form, else from the site's main color); `logo` is a file
  path, optional. `title` under 70 characters; `subtitle` and `outro` optional.
- `cookies`: `accept` (default), `reject` or `leave` for the cookie banner.

### Steps (2-30)

- `title`: the step's on-screen title (2-5 words, under 40 characters: "Alege data", "Trimite
  comanda"). It appears as a lower third with the step number while the step plays. Give every
  step one; it is what a viewer scanning the video reads.

- `say`: what the narrator says while the step happens: one or two short sentences (under 260
  characters), plain words, present tense, "you" form ("Apasă pe...", "Click..."). Say what is
  on the screen, using the same words as the buttons. In Romanian use ș and ț with a comma below.
- `do`: the actions, in order. Targets use the names from the exploration:
  - `{ "goto": "https://..." }` opens a page (skipped when already there).
  - `{ "click": <target> }`, `{ "hover": <target> }`, `{ "highlight": <target> }` (frames an element
    without clicking), `{ "check": <target> }` (tick a box).
  - `{ "fill": <target>, "value": "Ana Pop" }` types visibly. For the demo account use
    `"$LOGIN_EMAIL"` and `"$LOGIN_PASSWORD"` as values; the recorder fills them in.
  - `{ "select": <target>, "option": "19:00" }`, `{ "press": "Enter" }`, `{ "scroll": 600 }` or
    `{ "scroll": { "to": <target> } }`, `{ "wait": 1.5 }`.
  - A target is `{ "role": "link"|"button"|"textbox"|"checkbox"|..., "name": "..." }` (add
    `"exact": true` when a longer name also matches, `"nth": 1` for the second match),
    `{ "label": "Nume" }` for form fields, `{ "placeholder": "..." }`, `{ "text": "..." }`, or as a
    last resort `{ "selector": "css" }`.
- `expect`: `{ "url": "/part-of-the-address" }` and/or `{ "text": "words visible after the step" }`.
  Put one on every step that opens a page or changes what is shown: it is what catches a wrong page,
  a login wall or a blocked visit before recording.
- `login: true` on a step (or on the whole storyboard) when a login form is expected there;
  otherwise a visible password field fails the step.
- `allowSubmit: true` only when the person explicitly asked to show sending a form on a demo
  account. Without it, buttons like Send, Pay, Delete, Subscribe, Register are refused.

## What the checks catch (and how to fix them)

Each step is checked after its actions: bot-check and rate-limit pages, access denied, page not
found, an empty page, a login wall, an element that is missing, hidden or covered by a dialog, and
your `expect`. The rehearsal runs the same checks in seconds, without recording; rehearse until all
steps PASS, then record. Typical fixes:

- "Something covers the element (the dialog ...)": add a first click that answers or closes it
  (a cookie banner, a language or region chooser, a newsletter pop-up).
- "Nothing on the page matches": use the exact name from the exploration, or `exact`/`nth`.
- "exists but is hidden": open the menu first (a click on the menu button), or scroll to it.
- A step PASSES but its screenshot does not match the narration: change the narration or add a
  `scroll`/`wait`, never the other way around.

The recording waits on each step until its narration ends, so the picture and the voice stay in
sync. The final checks confirm the size, the length, the voice loudness (about -16 LUFS) and the
captions; `qa.md` lists everything.

## How the video is edited (automatic)

The recording is edited like a screen-recording studio: the browser sits in a rounded window with
a soft shadow on the brand background, the camera zooms in on the control being used and glides
between nearby ones, pulls out for page changes and scrolls, the cursor moves on an eased curve
and every click leaves a ripple, highlights dim the rest of the page, step titles slide in, the
narration is captioned under the window (large Barlow captions, at most two lines, with a real
comma under ș ț Ș Ț), a quiet music bed with a click on every click ducks about 12 dB under the
voice while it speaks and comes back up between steps, and branded intro and outro cards open and
close it. The whole mix is mastered to -16 LUFS, true peak under -1 dBTP; `qa.md` notes the music
levels (`musicDucking`). With a voice, the "Voce generată cu AI" label sits beside the captions,
never over them or the window. You control it through the storyboard: good `title`s, one action per step, and steps
that point at what the narration names.

## Draft, review, final

Record with `--quality draft` first (half size, faster), then open the contact sheet next to the
video (`<slug>-contact.jpg`, a frame every second) and check, like a demanding editor:

- The zoom lands on the thing the narration names in every step (if not, split the step or add a
  `highlight` on the right element first).
- No step shows a loading page, a cookie banner, a pop-up or an empty screen for more than a
  moment; no long wait where nothing moves (shorten `wait`, cut the step).
- Every step title is short and matches its narration; no typo in titles or captions.
- The intro title and the outro (`outro.title`, `outro.button`, `outro.lines`) are right.

Fix the storyboard and record again until it is something a paying client would publish, then
record the final with `--quality final` (the default).

## Output

`tutorial/<title-slug>.mp4` (H.264, captions burned in), `tutorial/<title-slug>.srt` (captions to
upload separately), `tutorial/qa.md` and `tutorial/qa-steps.jpg`.

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

## License notes (tell the person in one line at the end)

The local preview voices are free to use, but only as a preview; the intro card says the voice is
AI-generated, as the EU AI Act asks. Only record sites you own or
are allowed to show, and only demo accounts: never a real customer's data.
