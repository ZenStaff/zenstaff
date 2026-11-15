# Client radar

A short list of real businesses that could buy what the person sells, each with the evidence
behind it. Quality over quantity: 40 well-sourced leads beat 400 guesses. The scripts do the
fetching, the matching and the files; you choose the sources, read the dossiers, judge the need
and write.

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

## Files (all in the run folder)

| File                    | What it is                                                       |
| ----------------------- | ---------------------------------------------------------------- |
| `leads.json`            | the working list; every field `{ v, src, at }`                   |
| `dossiers/<id>.json`    | what the business's own site showed, page by page, with signals  |
| `lists/<site>/`         | saved pages of public lists you walked (`pages.json` + HTML)     |
| `crawl-log.jsonl`       | every request and every skip, with the time                      |
| `leaduri.xlsx` / `.csv` | the deliverable (Leaduri, Surse, Sărite sheets)                  |
| `radar.html`            | the dashboard: filters, A/B/C, detail with sources, map, skipped |

Run every command as `node "$ZEN_WORKFLOW_DIR/radar.mjs" <command> --leads <run folder>/leads.json ...`
and always pass `--contact "<the person's business e-mail or site>"` to commands that read websites.

## Method

1. **Start the file.** `add --from` a JSON list (can be `[]`) with
   `--meta '{"niche":"…","region":"…","offer":"…","lang":"ro"}'`.
2. **Find candidates, official sources first.**
   - Companies with a known CUI: put them in with `cui` and run `anaf` (one request a second,
     up to 100 CUIs each; the company's registered name, address, status, CAEN and phone).
   - OpenStreetMap: `overpass --area "<city or county as named in OSM>" --tag <key=value>`.
     Pick tags for the niche (sports clubs: `leisure=sports_centre`, `club=sport`, `sport=soccer`;
     restaurants: `amenity=restaurant`; dentists: `amenity=dentist`; hotels: `tourism=hotel`;
     shops: `shop=<kind>`; offices: `office=<kind>`). Every lead's source is its OSM page.
   - Google Places only when `GOOGLE_PLACES_API_KEY` is set (the person's own key; the costs are
     on their Google account): `places --query "<niche> in <place>"`. Keep place IDs; Google's
     terms do not allow keeping their other content for more than 30 days, so say the list
     should be refreshed rather than archived.
   - Public lists the person gave or you found with web search (a federation's member list, a
     chamber's directory, a city hall's listing): `crawl --start <url> [--follow "<regex for its
     next pages>"] --max 30`. It saves the pages under `lists/`; read them and write the
     businesses into a candidates file, each field with the list page as `src`, then `add`.
     With the Crawlee tool prepared it walks long lists for you; the rules are the same.
   - Web search is fine to discover lists and sites; a search result is not a source for a
     field. Read the page itself (through `crawl --max 1` or `site`) before using what it says.
   - Apify (optional, only when the person connected their own Apify account in their AI
     assistant; the costs are on their Apify account, never ours): use only actors that read
     public business listings, never ones that log in, bypass blocks or collect people's
     profiles; their results go through `add` with the listing URL as `src`, then `check`.
3. **Stop at the asked number** plus about 20% (some will drop out at the dedupe and the check).
4. **Read each lead's own site:** `site` (all leads not read yet) or `site --id <id>`. Add
   `--render` when a site is empty without JavaScript. It reads the home page and up to 3
   contact/about pages, fills the business e-mail, phone and social pages it publishes, and
   lists signals (no HTTPS, not built for phones, old copyright year, no description for Google,
   no social links, no contact on the site, social page instead of a site). Sites that robots.txt
   or their terms close are skipped and listed with the reason.
5. **Judge the opportunity against the offer.** For each lead, write 1-3 `opportunities`:
   `{ "text": "site din 2018, nu merge pe telefon", "strength": "clear" | "probable", "src": <the
   page that shows it> }`. Only what the evidence shows and only what the person's offer can fix;
   a signal unrelated to the offer is not an opportunity. Mark obviously large players
   `"large": true`. Short `notes` are fine (season not confirmed, municipal club, etc.).
6. **Dedupe:** `dedupe --existing <the person's list>` (by CUI, site, e-mail, phone, name + city;
   duplicates inside the new list are merged).
7. **Check:** `check`. It drops what is not business data (personal-looking e-mails, contacts not
   published by the business, personal profiles, unknown fields) and lists every field without a
   source. Fix or empty those fields and run it again until it passes.
8. **Score:** `score`. A = clear need + business e-mail; B = probable need, or clear need with
   only a phone; C = no visible need, inactive at ANAF, or a large company. The reasons are
   written next to each score; do not override a score without writing why in `notes`.
9. **Export:** `export --out <run folder> --lang <the person's language>`.

## Self-review before replying

- Open `leads.json`: every non-empty field has `src` and `at`; no e-mail looks like a person's
  name; no field holds a private person's data.
- Every A has a clear opportunity tied to the offer and a business e-mail.
- The skipped list explains each skip (robots.txt, terms, refused, CAPTCHA) and you did not try
  to read those sites another way.
- The counts in your reply match the export's output (leads, A/B/C, with e-mail, skipped).

## Reply

Counts (leads, A/B/C, with e-mail, skipped and why in one line), the 3-5 best A leads with
their opportunity in one line each, what could not be confirmed, and the files. Suggest the
next step: the "Outreach cu aprobare" workflow can write the first messages from this list, and
nothing is sent without their approval.
