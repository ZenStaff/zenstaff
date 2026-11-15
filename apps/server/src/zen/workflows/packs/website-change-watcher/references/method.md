# How to check the watched pages

Work in the `website-watch` folder that holds this file. Read `watch.json` for the pages, what to watch for and the language of the report.

## Commands

Scheduled runs happen with nobody there to approve anything: only curl, python3 and plain file commands (ls, cat, mkdir, cp, mv, rm, touch, date, sha256sum, head, tail, grep, sed, wc, diff, sort, find, echo) are allowed, and anything else is refused. Write each command plainly, joined with `&&` or `|` if needed: no shell variables (`UA=...`), no `$(...)` or backticks. Type values (the user agent, the saved validators, file names) straight into the command. For Python, write the script to a file in this folder (for example `extract.py`) and run `python3 extract.py`, not `python3 -c`.

## Fetch each page politely

- Identify yourself with the user agent `Mozilla/5.0 (compatible; website-change-watcher; personal monitoring)`.
- robots.txt: fetch `https://<host>/robots.txt` once per host per run; if it disallows the page's path for `*`, skip the page and say so in the report.
- One request per page per run, one page at a time. Send the saved validators to avoid downloading unchanged pages: `curl -s -L -A "Mozilla/5.0 (compatible; website-change-watcher; personal monitoring)" -H "If-None-Match: <etag>" -H "If-Modified-Since: <last-modified>" -D headers.txt -o page.html -w "%{http_code}" "<url>"`. A 304 means unchanged.
- No logins, no cookies from a browser, no getting around paywalls, captchas or "access denied" pages: record the status and move on. A 403, 429 or captcha twice in a row: suggest removing the page from the watch.
- If the HTML has almost no text (a page built by JavaScript), try the web fetch tool once; if that also fails, say the page cannot be watched this way.

## Keep only what matters

- Turn the HTML into readable text (python3 or your own reading of the HTML: drop scripts, styles, menus, footers, cookie banners, dates like "updated 5 minutes ago", counters, ads).
- From that text keep the parts that match what to watch for (for prices: item names with their prices; for job posts: titles, place, date; for terms: the full text of the terms section). Normalise spacing.
- Save it as `snapshots/<slug>/<YYYY-MM-DD-HHMM>.md`, with the URL and fetch time at the top.
- Save the validators and a hash of the kept text in `state.json`: `{"<slug>": {"etag": "...", "last_modified": "...", "hash": "...", "last_snapshot": "<file>", "last_checked": "<ISO>"}}`.

## Compare

For each page, compare the new kept text with the previous snapshot (by `last_snapshot`) and nothing else: if a value went back to what an older snapshot had, that is still a change to report. Never fetch a page a second time in the same run to double-check. Ignore changes in whitespace, order of identical items and anything unrelated to what is watched.

- No previous snapshot: "Starting point saved", with a 2-3 line summary of what is there now (for example "12 dishes, prices from 25 to 48 lei").
- Unchanged (304 or same hash): "No change".
- Changed: list each change plainly: "Daily soup: 18 lei → 21 lei", "New job post: Cook, Brașov, posted 3 November", "Terms, section 5 (returns): the return period went from 30 to 14 days". Quote the old and new wording for terms.

## The report (`report-<YYYY-MM-DD-HHMM>.md`, a new file each run)

In the language from `watch.json`:

1. **In short:** how many pages changed, and the one change that matters most.
2. **Changes:** per changed page: the page (name and link), what changed, and why it might matter for the business in one line (for example "the competitor's lunch is now 3 lei cheaper than ours").
3. **No change:** the list of pages, one line.
4. **Could not check:** pages blocked, failed or skipped, with the reason.
   Keep at most the last 30 snapshots per page; delete older ones.
