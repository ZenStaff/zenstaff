Make a short promo video for {{product}}.

What the video should say:
{{message}}

Call to action: {{call_to_action}}
{{#website}}Website or contact: {{website}}
{{/website}}{{#brand_colors}}Brand colors: {{brand_colors}}
{{/brand_colors}}{{#images}}Photos or logo to use: {{images}}
{{/images}}{{#music}}Music: {{music}}
{{/music}}Voice-over: {{voice}}
Look: {{look}}
Format: {{format}}
Language of the texts: {{language}}

How to do it (follow the guidance below exactly; the template and the tools are already installed):

1. Create the folder `promo-video` in the current folder, and `promo-video/public` inside it. Copy the photos, clips, logo and music the person gave into `promo-video/public` (keep the file names simple: lowercase, no spaces). Then look at them: `node "$ZEN_WORKFLOW_DIR/kit/check/inspect.mjs" --media promo-video/public --out promo-video/check` writes `promo-video/check/media-sheet.jpg`; open it and note what each picture shows, how sharp it is and where the subject sits.
2. Art direction, then `promo-video/props.json`, as the guidance describes: the story in 4-5 beats (hook, two or three proofs, the offer), the strongest picture for the opening, a layout per scene, one look. Facts only from the text above. Short, punchy texts in the requested language: 2-7 words per title, at most 14 per line of text. For a voice-over, write the script first as one or two sentences that follow the scenes.
3. Render a draft: `node "$ZEN_WORKFLOW_DIR/template/render.mjs" --props promo-video/props.json --public promo-video/public --out promo-video/<short-name>.mp4 --quality draft`
   Render the draft without the voice-over; the voice is added once, in the final render.
   If the command `node` is not found, use the absolute path of `node` listed at the end of this message.
4. Review like a creative director: open `promo-video/check/<short-name>-contact.jpg` (a frame every 0.5 s) and `-safe.jpg`, and go through the checklist in the guidance. Fix props.json and render the draft again until you would show it to a paying client. Then render the final: the same command with `--quality final`, and for a voice-over add `--voiceover-text "<one or two sentences>" --voice-language <ro|en> --voice <elevenlabs|preview>` as the guidance says. The script prints the final file name (a preview voice adds `-preview-voice`); use that name below. Look at the final contact sheet once more.
5. Say which voice was used, exactly as the guidance ("The voice that was used") says: a local preview is never presented as final or as ready for an ad. Then answer with one short sentence and the video embedded as a Markdown image with its absolute path, for example `![Promo for Acme](/absolute/path/promo-video/acme-promo.mp4)`, so it plays in the chat. Do not paste the props file.
