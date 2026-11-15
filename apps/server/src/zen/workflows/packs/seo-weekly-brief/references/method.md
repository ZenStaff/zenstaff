# Weekly search brief: method

## Step 1. Last week

List `seo-weekly/`. Read the newest earlier snapshot, AI answers, brief and `actions.md`. Note which actions were due for checking this week.

## Step 2. The website (public)

Set `UA="Mozilla/5.0 (compatible; owner-seo-brief)"`.

- Home page: `curl -sIL -A "$UA" "$SITE"` (final status, redirects) and the HTML: title, meta description, H1, canonical, robots meta, `lang`, JSON-LD types.
- `robots.txt` and the sitemap (from robots.txt, `/sitemap.xml`, `/sitemap_index.xml` or `/wp-sitemap.xml`): number of URLs, and the newest `lastmod` values. New URLs since last week's snapshot = pages published.
- Up to 15 key pages (menu plus sitemap, newest first): status, title, description, H1, canonical, noindex, word count of the visible text (rough).
- Problems to flag: noindex or robots blocks on pages that should rank, missing or duplicate titles, pages returning errors, canonicals to other pages, pages removed since last week.
- Index estimate: web search `site:<host>` and note the rough count (an estimate; trend only).

## Step 3. Search Console export (only when given)

The export folder has CSV files such as `Queries.csv`, `Pages.csv`, `Countries.csv`, `Devices.csv`, `Dates.csv` (names may be translated: Interogări, Pagini, Țări, Dispozitive, Date). Columns: query or page, Clicks, Impressions, CTR, Position (also translated: Clicuri, Afișări, CTR, Poziție).

- Totals: clicks and impressions for the period; compare with last week's snapshot when it has export totals, else with the first and second halves of `Dates.csv`.
- Opportunities: queries on positions 5 to 20 with the most impressions (page two or bottom of page one: the easiest wins).
- Weak snippets: pages with many impressions and a click rate under 2% (the title and description to rewrite).
- Winners and losers: the queries and pages with the largest change in clicks, when both weeks are known.
- Ignore rows with under 50 impressions.

## Step 4. Search positions you can see publicly

Pick 5 searches: the main service + city, the business name, and 3 from the export's top queries or from the customer questions. Run each with web search. Record, for each, the top 5 domains and the position of the website (or "not in the results we saw"). Results vary by person and place, and your web search tool is not Google itself: call them "search results", not "Google results", treat them as indicative and compare week to week only. If the business name search does not find the website at all, say the search tool may be missing it and that Search Console confirms indexing.

## Step 5. Competitors

For each competitor (at most 4): home page title and description, sitemap URL count and new URLs since last week (what they published), and their positions in the step 4 searches. Fetch politely and respect their robots.txt; if blocked, use web search results only.

## Step 6. AI answers

For each question (at most 8):

1. Answer it as a neutral assistant who does not know the business: use web search exactly as you would for any user, and do not search the business's name unless the question contains it.
2. Record your honest answer: the recommended businesses in order.
3. Record: is the business mentioned (yes/no), at what position, which competitors are mentioned, and which websites you used as sources.
   JSON object per question: `{"q": "...", "mentioned": true, "position": 2, "recommended": ["..."], "competitors": ["..."], "sources": ["domain.ro", "..."], "summary": "2-3 lines"}`.
   Sources that come up for many questions and do not mention the business are the best places to get listed or mentioned (a directory, a review site, a local news article, a comparison page).

## Step 7. The snapshot file

`seo-weekly/snapshot-<date>.json`: `{"date", "site": {"home": {...}, "sitemap_urls": n, "sitemap_newest": [...], "pages": [{"url","status","title","description","h1","noindex","words"}], "site_search_estimate": n}, "export": {"period", "clicks", "impressions", "top_queries": [...]} or null, "searches": [{"q","top5","position"}], "competitors": [{"name","url","sitemap_urls","new_urls","positions"}]}`.

## Step 8. The brief (`seo-weekly/brief-<date>.md`)

Written for the owner: short sentences, no jargon.

1. **This week in 4 lines**: the big numbers and the one thing that matters most.
2. **What changed since last week**: pages published or removed (yours and competitors'), position moves, export numbers, AI mentions. First week: "baseline" and what will be compared next time.
3. **The 3 actions for this week**: page, exact change, why (evidence), effort, who does it (owner / whoever writes the texts / web developer), number to check next week.
4. **How AI assistants answer your customers**: a table (question, mentioned?, position, who is recommended instead) and the 2 sources worth getting into. State that this approximates ChatGPT, Perplexity and Gemini with one assistant's web search.
5. **Competitors**: what each did this week, in one line each.
6. **Problems found on the site**: only real ones, with the page.
7. **Last week's actions**: done or not, and the result where the data shows it.
8. **Data and limits**: what was measured, what was not (for example "no Search Console export this week").
