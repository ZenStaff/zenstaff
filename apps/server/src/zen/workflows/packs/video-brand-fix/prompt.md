Bring the videos in {{videos}} in line with the current brand.

New outro or logo: {{outro}}
{{#outro_text}}Outro text: {{outro_text}}
{{/outro_text}}{{#intro}}New intro: {{intro}}
{{/intro}}{{#brand_colors}}Brand colors: {{brand_colors}}
{{/brand_colors}}
What is outdated (must not appear any more):
{{old_claims}}

What is true now:
{{correct_claims}}

How to do it (the tools are already installed; follow the guidance below exactly):

1. Scan: `node "$ZEN_WORKFLOW_DIR/brandfix.mjs" scan --videos "{{videos}}" --out brand-fix/work`. It lists every video and writes two sheets per video in `brand-fix/work/sheets/` (the whole video and its last 6 seconds, each frame stamped with its time).
2. Look at every sheet. For each video, note: where an old ending starts (use the time stamps and the `cutsNearEnd` in `brand-fix/work/inventory.json`), and every frame where something from the outdated list is visible, with its time range and position.
3. Write `brand-fix/plan.json` as described in the guidance: cut old endings, cover outdated text with the corrected wording only from "What is true now", mark what cannot be fixed by covering (a voice saying an old price, a whole scene built on an old offer) as "redo" with a clear note. Never invent a new price, claim or name.
4. Apply: `node "$ZEN_WORKFLOW_DIR/brandfix.mjs" apply --plan brand-fix/plan.json --videos "{{videos}}" --out brand-fix/output`
   If the command `node` is not found, use the absolute path of `node` listed at the end of this message.
5. Check the result: open the sheets in `brand-fix/output/check/` (the new endings) and, for every covered text, one frame from the middle of its time range (`ffmpeg -ss <second> -i <video> -frames:v 1 brand-fix/work/check-<n>.jpg`). Fix the plan and apply again until each fixed video looks finished and nothing outdated is left.
6. Do not install anything and do not try other tools; the originals in {{videos}} must stay untouched.

When you finish, reply with a short summary (how many are ready, how many to confirm or redo, and why). For each text file you wrote (.md, .docx, .xlsx and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat.
