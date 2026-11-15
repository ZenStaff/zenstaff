# Rough cut

`$ZEN_WORKFLOW_DIR/roughcut.py` (read only) runs with the prepared `whisper-python`. Commands:
`inventory`, `transcribe`, `selects`, `export`. Everything stays on this computer. You only write
`rough-cut/edit.json`.

## edit.json

```json
{
  "name": "BISTRO_OPENING",
  "fps": 25,
  "items": [
    { "select": "S001", "note": "Chef introduces himself" },
    { "clip": "C001", "in": 6.5, "out": 10.0, "note": "We open today" },
    { "select": "S009", "note": "B-roll: pizza" },
    { "select": "S003" }
  ]
}
```

- `name`: letters, digits and underscores (the sequence name in the editor).
- `fps`: the timeline frame rate. "Same as the footage" -> the most common `fps` in the inventory,
  rounded to 24, 25, 30, 50 or 60 (23.976, 29.97 and 59.94 are allowed too).
- `items`, in timeline order: either a select id from `selects.csv` (`{"select": "S004"}`, you may
  override `in`/`out` next to it), or a piece of any clip (`{"clip": "C003", "in": 12.5, "out": 18.0}`,
  seconds in the clip). `note` becomes a marker in the editor and a line in the cut list; write
  it in the person's language (Romanian with ă, â, î, ș, ț).
  `"audio": false` keeps only the picture (b-roll over silence; b-roll selects are picture-only).

## Building the story

- Read `transcript.md` end to end first. Pick soundbites that carry the story; prefer complete
  sentences, clear sound and the speaker's best take (when a sentence is repeated, the last take is
  usually the good one). Drop false starts ("let me start again", "ok, that's enough"), small talk
  and anything off-topic. Never cut a speaker in a way that changes what they meant.
- Shape: a hook or introduction (5-10 % of the length), the middle in the order of the story, an
  ending with a conclusion or an invitation.
- B-roll: put 3-5 s of b-roll between soundbites from different moments, or where a soundbite
  mentions something that can be shown (the bread, the dish, the place). Use each b-roll piece once.
- Length: add up `out - in`; land within about 15 % of the target. For a short target, use fewer,
  stronger soundbites rather than trimming each one.
- In and out points: soundbites from `selects` already have breathing room (0.3 s before, 0.4 s
  after). When you cut inside a segment, use the times from `transcripts/<clip>.json` (word
  timings) and leave 0.2-0.3 s around the words.

## Output and how to open it

- `rough-cut/<name>.xml`: Premiere Pro (File > Import) and DaVinci Resolve (File > Import >
  Timeline). `rough-cut/<name>.fcpxml`: Final Cut Pro (File > Import > XML). `rough-cut/<name>.edl`:
  any editor that reads CMX3600 EDL (relink the clips by name). The media stays where it is: keep
  the footage folder in place, or relink if it moves.
- `rough-cut/<name>-preview.mp4`: a small preview of the cut to watch first.
- `rough-cut/<name>-cutlist.md`, `rough-cut/transcript.md`, `rough-cut/transcripts/*.srt`
  (subtitles per clip), `rough-cut/selects.csv` (can be edited in Excel), `rough-cut/inventory.md`.
- Source timecode is counted from the start of each file (0); clips with embedded camera timecode
  line up by content, not by that timecode.

## When it fails

Errors start with `ERROR:` and say what to fix. Do not install anything and do not try other
tools.

## License notes (tell the person in one line at the end)

Everything runs locally with free tools (FFmpeg, faster-whisper and the Whisper model, MIT); the
footage never leaves this computer.
