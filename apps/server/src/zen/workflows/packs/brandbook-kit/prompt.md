Make a brandbook and a social media kit for {{name}}.

What they do and for whom:
{{about}}

{{#website}}Existing website: {{website}}
{{/website}}{{#logo}}Logo: {{logo}}
{{/logo}}{{#colors}}Brand colors: {{colors}}
{{/colors}}Fonts: {{fonts}}
{{#tone}}Tone of voice: {{tone}}
{{/tone}}{{#photos}}Photos: {{photos}}
{{/photos}}{{#contact}}Contact for the business card: {{contact}}
{{/contact}}Language of the brandbook: {{language}}

How to do it (the tools are already installed; follow the guidance below exactly):

1. {{#website}}Read the website: `node "$ZEN_WORKFLOW_DIR/extract.mjs" --url "{{website}}" --out brandbook/extract`. Look at `brandbook/extract/site.png` and the logo candidates it saved; use its colors, fonts and texts only where the form gave nothing.{{/website}}{{^website}}There is no website: work from the form only.{{/website}} Open the logo{{#photos}} and the photos{{/photos}} to see them.
2. Write `brandbook/brand.json` as described in the guidance (use 5-9 of the person's photos; they open the sections and fill the pages): colors with roles and usage, fonts, a short brand story, values, tone of voice with real examples, three social posts and the business-card contact. Every fact comes from the form or the website; never invent awards, numbers, prices or promises. When the person gives more (logo versions, a seal, own fonts, graphic motifs, screens or templates), fill the optional sections from the guidance (`logoVariants`, `logoRules`, `typography.scale`, `motifs`, `icons`, `tone.pairs`, `applications`); for a software or service brand, choose fitting `mockups` and set `imagery` instead of the food photography texts.
3. Build: `node "$ZEN_WORKFLOW_DIR/build.mjs" --brand brandbook/brand.json --out brandbook`
   If the command `node` is not found, use the absolute path of `node` listed at the end of this message.
4. Review like an art director: open `brandbook/overview.jpg`, then every page in `brandbook/check/` at full size, the mockups in `brandbook/mockups/` and the images in `brandbook/social/`, and go through the review list in the guidance (no empty areas, nothing cut off, the logo centered and undistorted on every mockup, correct diacritics, no invented facts). Fix brand.json and build again until it is a manual a designer would hand over.
5. Do not install anything and do not try other tools.

When you finish, reply with a short summary. For each text file you wrote (.md, .docx, .xlsx, .pdf and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat.
