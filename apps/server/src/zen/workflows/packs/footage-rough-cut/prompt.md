Make a rough cut from the raw footage in {{footage}}.

The story:
{{story}}

Target length: {{length}}
Spoken language: {{language}}
Finishing in: {{editor}}
Timeline frame rate: {{fps}}

How to do it (the tools are already installed; follow the guidance below exactly):

1. Inventory: `whisper-python "$ZEN_WORKFLOW_DIR/roughcut.py" inventory --footage "{{footage}}" --out rough-cut`. Read `rough-cut/inventory.md` and look at the contact sheets in `rough-cut/sheets/` (8 frames per clip, stamped with clip id and time).
2. Transcribe: `whisper-python "$ZEN_WORKFLOW_DIR/roughcut.py" transcribe --out rough-cut --language "{{language}}" --model "$ZEN_WHISPER_MODEL_SMALL"`. This takes a while for long footage; it writes `rough-cut/transcript.md` and an .srt per clip.
3. Selects: `whisper-python "$ZEN_WORKFLOW_DIR/roughcut.py" selects --out rough-cut --keywords "<8-15 words from the story>"`. Read `rough-cut/selects.csv`: soundbites (speech) and b-roll windows with steady motion.
4. Build the edit as described in the guidance: tell the story with the best soundbites in a sensible order, cover cuts and jumps with b-roll, drop false starts, retakes and off-topic talk, and stay close to the target length. Write `rough-cut/edit.json`.
5. Export: `whisper-python "$ZEN_WORKFLOW_DIR/roughcut.py" export --out rough-cut --edit rough-cut/edit.json`. Watch the logic once more by reading `rough-cut/<name>-cutlist.md`; if a piece starts or ends mid-word, adjust its in/out by a few tenths of a second and export again.
   If `whisper-python` is not found, use its absolute path from the list at the end of this message.
6. Do not install anything, do not try other tools and never change the original clips.

When you finish, reply with a short summary: the length of the cut, how it is built (beginning, middle, end) and how to open it in {{editor}}. For each text file you wrote (.md, .docx, .xlsx and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat.
