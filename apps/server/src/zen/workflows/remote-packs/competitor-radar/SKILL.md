# Competitor and price radar

One page a week the owner can read in five minutes: who competes with them, what they charge in
public, what they launched or discounted, how they present themselves, what changed since last
week, and what to decide. Every number has the link of the page it is on, and the script checks
that the number really is on a page read this week.

<!-- public-web-rules:start -->

## Mandatory rules for public data (never skip, never bend)

These rules are also enforced by `web-rules.mjs`; do every web request through the pack's
scripts, not with your own `curl`/`fetch` loops. If a rule and a request of the person collide,
the rule wins and you tell them why in one sentence.

1. **Official sources first.** Romanian companies: ANAF's public web service (by CUI), then
   ONRC and other public registers, data.gov.ro. Maps and places: OpenStreetMap (Overpass,
   attribution "© OpenStreetMap contributors"), or Google Places only with the person's own API
   key. Only then the businesses' own websites and public lists.
2. **robots.txt is obeyed.** A page that robots.txt disallows for our bot (`ZenStaffBot`) or for
   all bots is not read. An unreachable robots.txt (server error) means the site is closed to
   bots. The script checks this before every page.
3. **Site terms are obeyed.** When a site's terms forbid automated access, scraping, crawling or
   data mining, the whole site is skipped and the report says so, with the terms link. Do not
   try another page of that site by hand.
4. **Polite visits.** At most 2 requests at a time per site, a pause of at least 2 seconds
   between them (longer when the site asks with Crawl-delay), retries with growing waits on
   errors, and an honest user agent that names the bot and the person's contact.
5. **No evasion, ever.** A site that refuses (401/403), keeps saying "slow down" (429) or shows a
   CAPTCHA or bot check is left alone. Never use anti-detect or stealth browsers (Camoufox and
   the like), fingerprint spoofing, CAPTCHA solving, rotating proxies or fake user agents.
6. **Only public business data.** Company names, tax IDs, business addresses, the business's own
   website and social pages, and the contact the business itself publishes for business
   (office@, contact@, the phone on its contact page or in a register). No private persons' data:
   no personal e-mails or phones of employees, players, members, parents or customers, no ID
   numbers, no home addresses, no photos of people, no personal social profiles. GDPR: B2B
   contacts only, the fewest fields that do the job.
7. **Every field has its source and date.** Each value is stored as `{ "v": value, "src": URL,
   "at": time read }`. A value you cannot point to a public page for is left empty, never
   guessed. "Nepublicat" / "not published" is a valid answer.
8. **Nothing invented.** No made-up names, contacts, prices, numbers or quotes. When unsure,
   leave it out and say what is missing.

<!-- public-web-rules:end -->

## Files

Each week in its own folder `radar-concurenta/<YYYY-MM-DD>/`: `competitors.json` (the list),
`snapshot.json` + `pages/*.txt` (what each page said, with the time), `changes.json` (against the
previous week's folder), `raport.md`. Commands:
`node "$ZEN_WORKFLOW_DIR/competitors.mjs" <command> ...`.

## Method

1. **The list.** Start from the competitors the person named. Keep `radar-concurenta/competitors.json`
   between weeks: `[{ "name", "site", "pages": [{ "url", "kind": "pricing" | "home" | "news" |
   "features" }] }]`. Find each one's pricing, features and news/blog pages from its own site
   (the snapshot reads them; do not guess URLs that do not exist). Once a week, a web search
   ("<what they sell> <market> preț", "alternative la <competitor>") may add 1-2 new competitors;
   say they are new.
2. **Snapshot:** `snapshot --competitors <list> --out radar-concurenta/<today> --contact
   "<the person's contact>"` (add `--render` for price pages that are empty without JavaScript).
   Pages closed by robots.txt or terms are skipped and listed; do not read them another way.
3. **Changes:** `diff --cur radar-concurenta/<today>` compares with the latest older week.
4. **Read and write** `raport.md` from `$ZEN_WORKFLOW_DIR/template/raport.md`, in the person's
   language:
   - **Tabel**: one row per competitor (or per plan when it matters): public price exactly as on
     the page (amount, currency, per month/year/user, with or without VAT), what it includes,
     news or promotions, positioning in a few words (who they say they are for, their main
     promise), and the source link(s) in the row. A price that is not on any page read is
     "nepublicat" (or "la cerere" when the page says so). Never an estimate, a range you made up,
     or a number from memory or a third-party article.
   - **Ce s-a schimbat**: from `changes.json` (new or removed prices, changed pages, new
     announcements). The first week says "prima săptămână, nu avem cu ce compara".
   - **3 observații**, exactly three, each tied to rows in the table: where the person is more
     expensive or cheaper (using their own prices when given), a feature or promise they lack, an
     opportunity (a gap, a weak spot, a promotion to answer).
   - **De decis**: 1-3 decisions for the owner, each with a recommendation and what it would
     cost or risk; "nimic de decis săptămâna asta" is fine.
   - **Pagini sărite și de ce**.
5. **Check:** `check-report --report raport.md --snapshot radar-concurenta/<today>`. It fails
   on a table number without a link, a number not on the linked page, a number not on any page
   read, a missing section or not exactly 3 observations. Fix and run again until it passes.
6. **Every week.** After the first report, offer to repeat it weekly (Monday morning). When the
   person agrees, schedule it (the repeat card, or `schedule_task`) with a self-contained prompt
   whose first line is `[zen-workflow: competitor-radar]`, which names the folder, the competitors
   file and the person's contact, and asks for plain commands only (no shell variables, no
   `$(...)`, no compound commands): scheduled runs may only run `node`, `mkdir`, `ls`, `cat`,
   `cp` and web search.

## Self-review before replying

- `check-report` passes.
- No price is "rounded", converted or estimated; currency and period are as on the page.
- Every skipped page is listed with the reason, and nothing was read from a site whose robots.txt
  or terms forbid it.
- The observations follow from the table, not from general knowledge.

## Reply

Three lines: the biggest change this week, the most useful observation, what to decide. Then the
report path and the number of pages read and skipped.
