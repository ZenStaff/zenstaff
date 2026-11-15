Make a narrated tutorial video of {{url}}.

What the tutorial should show:
{{steps}}

Language: {{language}}
Voice: {{voice}}
Format: {{format}}
{{#login_file}}Demo account file: {{login_file}} (never open, read or print this file; pass it to the recorder with --login)
{{/login_file}}{{#brand_colors}}Brand colors: {{brand_colors}}
{{/brand_colors}}{{#logo}}Logo: {{logo}}
{{/logo}}
How to do it (the tools are already installed; follow the guidance below exactly):

1. Explore before writing anything: `node "$ZEN_WORKFLOW_DIR/explore.mjs" --url "{{url}}" --out tutorial/explore` (add `--format vertical` for the phone view). Open the screenshot it saves and read the JSON: the exact names of links, buttons and fields, and any dialog that covers the page. Explore every other page the steps reach (use the addresses from the links).
2. Write `tutorial/tutorial.json` as described in the guidance: one step per thing the viewer sees, each with a short on-screen `title`, the narration in the requested language, the exact element names from the exploration, and an `expect` on every step that changes the page.
3. Rehearse (fast, no video): `node "$ZEN_WORKFLOW_DIR/make.mjs" --storyboard tutorial/tutorial.json --out tutorial --rehearse{{#login_file}} --login "{{login_file}}"{{/login_file}}`. Open `tutorial/qa-steps.jpg` and check that every screenshot shows what its narration says. Fix the storyboard and rehearse again until every step is PASS and matches.
4. Record a draft: the same command without `--rehearse`, plus `--quality draft`. It records the voice, the browser session, the title cards and the captions, then checks the finished video.
   If the command `node` is not found, use the absolute path of `node` listed at the end of this message.
5. Read `tutorial/qa.md` and open the contact sheet next to the video (`tutorial/<slug>-contact.jpg`, a frame every second). Go through the review list in the guidance; if a step failed, a final check warns or anything looks unfinished, fix the storyboard and record the draft again. When it is right, record the final with `--quality final` and look at its contact sheet once more.
6. Never send, pay, delete, subscribe or create anything on the site: stop before such buttons and point at them with `highlight`. Do not install anything and do not try other tools.

When you finish, say which voice was used, exactly as the guidance ("The voice that was used") says: a local preview is never presented as final. Then reply with a short summary. For each text file you wrote (.md, .docx, .xlsx and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat.
