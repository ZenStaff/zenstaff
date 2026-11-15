Make a finished {{format}} for {{purpose}}, plus the same design for social media, photo mockups of it in place and the brief behind it.

Main message: {{headline}}
{{#details}}Details that must appear: {{details}}
{{/details}}{{#call_to_action}}Call to action and address: {{call_to_action}}
{{/call_to_action}}Look and feel: {{mood}}
{{#photos}}Photos: {{photos}}
{{/photos}}{{#logo}}Logo: {{logo}}
{{/logo}}{{#brand_colors}}Brand colors: {{brand_colors}}
{{/brand_colors}}Brand: {{#brand_guide}}read {{brand_guide}} first and follow its colors, logo rules and tone exactly.{{/brand_guide}}{{^brand_guide}}look in this folder for a brand guide, logo files or past designs and follow them; if there are none, take the colors from the logo or the photos.{{/brand_guide}}

How to do it (the tools are already installed; follow the guidance below exactly):

1. Create the folder `poster` and copy the logo and the photos into it (simple file names). If there are several photos, look at them (`node "$ZEN_WORKFLOW_DIR/kit/check/inspect.mjs" --media poster --out poster/check` writes `poster/check/media-sheet.jpg`) and pick the strongest one for the poster: sharp, well lit, the subject clear, room for the words.
2. Art direction, then `poster/poster.json` as the guidance describes. First find the idea: one thought the picture and the headline make together (a bowl that is also a clock, a name that sets behind the hills), not the offer repeated in big letters. Use the `roundel` layout for a dish photographed from above and the `festival` layout for an event with a landscape photo; the others when neither fits. Then: the one thing a passer-by must remember, the headline (2-9 words, the most important word highlighted), the details as short lines with the right icon, the call to action, the look, and the brief notes. Facts only from the text above: never invent dates, prices, addresses or claims.
3. Check: `node "$ZEN_WORKFLOW_DIR/build.mjs" --spec poster/poster.json --out poster --check`, fix what it reports, then do quick rounds with `--preview` (poster and social versions in seconds) until the art direction is right, then build: the same command without `--check` or `--preview`. If the command `node` is not found, use the absolute path of `node` listed at the end of this message.
4. Review like an art director: open `poster/overview.jpg` and the 300 dpi PNG, and go through the checklist in the guidance. Fix poster.json and build again until you would hand it to a paying client.

Answer the person in their language and write the documents in it too, unless the answers above ask for another language.

When you finish, reply with a short summary. For each text file you wrote (.md, .pdf and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat: at least the poster PNG, one social version and two mockups.
