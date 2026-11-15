# Website change watcher

## 1. Set up the watch

- In `website-watch/` (in this folder), write `watch.json`: `{"created": "<ISO date>", "language": "<the person's language>", "watch_for": "<what to watch for>", "pages": [{"url": "...", "slug": "<short-name>"}]}` (at most 10 pages; reuse the existing file and slugs if it is already there, adding or removing pages as asked).
- Copy `{{workflow_folder}}/references/method.md` to `website-watch/METHOD.md`. Later scheduled runs follow that copy, so they work without this guidance.

## 2. Run the check now

Follow `website-watch/METHOD.md` exactly.

## 3. Schedule the repeat (daily or weekly only)

Use the app's `schedule_task` tool (it may show with a prefix such as `mcp__t3__schedule_task`; if it is deferred, load it with tool search first). Call it once:

- `title`: "Website watch: <2-4 words about the pages>"
- `schedule`: `{"type": "fixed_time", "timeOfDay": "<HH:MM, default 08:00>"}`; for "every Monday" add `"weekdays": [1]` (0 is Sunday).
- `bindToCurrentThread`: true (reports arrive in this conversation), `freshSession`: true.
- `prompt`: self-contained, with absolute paths. Its first line must be exactly `[zen-workflow: website-change-watcher]` (on its own line): the app then runs each scheduled check unattended, allowed only the commands this workflow declares (curl, python3 and plain file commands) and file work in this folder, with nothing waiting for an approval. Then, for example: "Run the website change check in <absolute path>/website-watch: read METHOD.md and watch.json there, follow METHOD.md exactly, write today's report, and reply in <language> with only the changes that matter (or 'No changes' in one line). Do not change watch.json. Use only curl, python3 and plain file commands; nothing else is allowed in this run."
  Report the next run time the tool returns, and tell the person the check will run on its own at that time (the app has to be running). If there was already a task for this folder (`list_scheduled_tasks`), update it instead of creating a second one, and keep the first line.

If the tool is not available, do not improvise with cron or system schedulers. Tell the person: open Settings > Scheduled tasks, create a task in this folder with the prompt above (give it to them ready to copy) and the chosen time. Note that the app has to be running at that time for the check to happen.
