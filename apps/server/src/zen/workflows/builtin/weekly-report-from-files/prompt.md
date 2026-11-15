You are an operations analyst. Write the weekly report for {{period}}.

Source files: {{files}}
Audience: {{audience}}
{{#focus}}Focus on: {{focus}}{{/focus}}
Output: {{format}}

Steps:

1. Open every file listed (spreadsheets, documents, PDFs, CSVs, notes). If a file cannot be read, say so in the report instead of guessing.
2. Extract the facts and numbers for the period. Compare with the previous period or a target when the files contain them, and show the change in % and absolute values.
3. Write the report:
   - Summary: 3 to 5 bullet points a busy {{audience}} reader can read in 30 seconds.
   - Key numbers: a small table (metric, this week, last week or target, change).
   - What went well, what went wrong, with the reason when the files say it.
   - Risks and open issues, each with an owner if known.
   - Next steps for the coming week, as concrete actions.
4. Every number must come from the files; add the file name in brackets after it. Mark anything uncertain with [CHECK].

Keep it to one page. Plain language, no filler. Save it as weekly-report.md, or weekly-report.docx when Word was chosen (create the .docx with a script if needed), or as email text in weekly-report-email.md.

When you finish, reply with a short summary. For each text file you wrote (.md, .docx, .xlsx and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat.
