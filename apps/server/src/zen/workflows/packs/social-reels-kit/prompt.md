Make {{count}} short vertical reels for {{business}} ({{business_type}}), ready to post on Instagram, Facebook and TikTok.

What the reels should say:
{{offer}}

Photos and clips: {{media}}
{{#contact}}Where people find them: {{contact}}
{{/contact}}{{#logo}}Logo: {{logo}}
{{/logo}}{{#brand_colors}}Brand colors: {{brand_colors}}
{{/brand_colors}}Look: {{style}}
Music: {{music}}{{#music_file}} ({{music_file}}){{/music_file}}
Voice-over: {{voice}}
Language of the texts: {{language}}

How to do it (the template and the tools are already installed; follow the guidance below exactly):

1. Look at the material first:
   `node "$ZEN_WORKFLOW_DIR/kit/check/inspect.mjs" --media "{{media}}" --out reels-kit/check`
   It prints every file with its size and orientation and writes `reels-kit/check/media-sheet.jpg`. Open that image and look at it: note what each numbered picture shows, how sharp it is and where the subject sits. Do not use blurry, dark or off-topic pictures. If the logo is given, look at it too.
2. Art direction, then the plan, as the guidance describes: the one idea and the hook of each reel, the strongest picture for each hook, where the words sit on each picture, one look and one music mood. Facts only from the text above: never invent prices, dates, dishes, products, reviews or claims. For a voice-over, write each speaking reel's `voiceover` (1-3 short sentences that follow its scenes). Write `reels-kit/reels.json`. Copy the logo and the music file (if any) into the media folder first if they are elsewhere, and refer to every file by its name inside the media folder.
3. Check the plan: `node "$ZEN_WORKFLOW_DIR/template/render.mjs" --plan reels-kit/reels.json --media "{{media}}" --out reels-kit --check`. Fix whatever it reports.
4. Draft: the same command with `--quality draft --voice none` instead of `--check` (the voice is made once, in the final render). If the command `node` is not found, use the absolute path of `node` listed at the end of this message.
5. Review like a creative director: open every `reels-kit/check/<id>-contact.jpg` and `reels-kit/check/<id>-safe.jpg` and go through the checklist in the guidance (hook readable at 1 s, words never over a face or the product or in the red zones, pictures sharp and well cropped, the right word highlighted, no typo, no scene without something new, a clear end card). Fix the plan and render that reel's draft again with `--only <id>`. Repeat until you would show it to a paying client.
6. Final: `node "$ZEN_WORKFLOW_DIR/template/render.mjs" --plan reels-kit/reels.json --media "{{media}}" --out reels-kit --quality final`, and for a voice-over add `--voice <elevenlabs|preview> --voice-language <ro|en>` as the guidance says (a preview voice adds `-preview-voice` to the file names; use the names the script prints). Open the final contact sheets once more; fix and render again anything that is not right.
7. Say which voice was used, exactly as the guidance ("The voice that was used") says: a local preview is never presented as final or as ready for an ad.
8. Do not install anything and do not try other tools; if a command fails, read its `ERROR:` line, fix the plan and run it again.

When you finish, reply with a short summary. For each text file you wrote (.md, .docx, .xlsx and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat.
