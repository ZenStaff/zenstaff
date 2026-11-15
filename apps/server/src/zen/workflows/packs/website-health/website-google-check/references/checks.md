# Search visibility checks ("Why can't Google find us?")

Set `UA="Mozilla/5.0 (compatible; owner-website-check)"`, `SITE` = the address given, `HOST` = its host. Everything here is public: no Search Console login, no paid tools, no API keys. If the person has a Search Console export in the folder, use it as extra evidence.

## 1. Can Google reach the pages at all? (the blockers)

- Home page: `curl -sIL -A "$UA" "$SITE"`: final status 200, at most 2 redirects, ends on https. 4xx/5xx or a redirect loop is critical.
- Same site, one address: `http://`, `https://`, with and without `www.` should all end on the same address (otherwise Google sees duplicates, medium).
- `robots.txt` (`curl -s -A "$UA" "https://$HOST/robots.txt"`): `Disallow: /` under `User-agent: *` or `Googlebot` is critical. Blocking CSS/JS folders is medium. Note the `Sitemap:` line.
- Noindex: `<meta name="robots" content="...noindex...">` in the HTML or an `X-Robots-Tag: noindex` header on the home page or key pages is critical (a common leftover from the site's construction phase; WordPress "Discourage search engines" does this).
- Canonical: `<link rel="canonical">` pointing to another domain, to the staging site, or every page pointing to the home page: high.
- Login walls or "coming soon" pages on the main pages: critical.

## 2. Is it in Google's index?

- Web search `site:$HOST`, then the exact home page title in quotes. Many search tools ignore `site:`, so an empty `site:` result alone proves nothing: call the site "not indexed" (high) only when the quoted title and the business name also find none of its pages; otherwise say indexing looks fine or cannot be confirmed without Search Console.
- Web search the business name (and city for a local business). Is the site in the first results? Who is above it (directories, marketplaces, old addresses)?
- Web search 2 to 4 of the phrases the customer gave (or that a customer would type, such as "dentist Cluj"), and note which sites appear in the top results and where this site appears, if at all.

## 3. Sitemap

- From robots.txt or `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`. Missing is medium (high for sites over 50 pages).
- Valid XML, real page addresses on the same host, no `noindex` or redirected pages listed. Check the status of up to 10 listed addresses with `curl -sI`.

## 4. The pages themselves

Take the home page plus up to 7 important pages (from the menu or the sitemap: services, products, contact, about). For each, from the raw HTML (`curl -s -A "$UA"`):

- `<title>`: present, unique, 30 to 60 characters, says what and where ("Dentist in Cluj-Napoca | Clinic name"). Same title on many pages is high.
- Meta description: present, unique, 70 to 160 characters (missing is low; it is the text under the link).
- One `<h1>` that says what the page is about.
- Real text in the HTML: if the raw HTML has almost no visible words (an empty shell filled by JavaScript), Google may index little (high). Very thin pages (under ~150 words) on key services: medium.
- `<html lang="...">` set; `<meta name="viewport">` present (mobile-friendly basics).
- Images: share without `alt` text (low to medium).
- Structured data: `application/ld+json` with `Organization` or `LocalBusiness` (name, address, phone, opening hours) for local businesses: missing is medium for a local business.
- Open Graph (`og:title`, `og:image`) for nice link previews: low.
- Internal links: important pages reachable from the menu or footer.

## 5. Local presence (for businesses with a physical location)

- Web search "<business name> <city>": does a Google Business Profile (map listing) appear? Missing, or with a different phone or address than the site, is high for a local business: most local customers come through the map.
- Name, address and phone written the same way on the site, the profile and the main directories.

## 6. Speed and mobile (short)

- Run the PageSpeed check (keyless public service; may refuse when busy): `curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<SITE>&strategy=mobile&category=performance&category=seo"`. Report the SEO and performance scores and any failed SEO audits. A performance score under 50 on mobile is medium for search; for details point to the "Why is the website slow?" check.

## 7. AI answers (ChatGPT, Gemini, AI Overviews)

- Google needs nothing special for AI Overviews: an indexed page that can show a snippet. `llms.txt` is not used by Google Search; do not recommend it as a fix.
- Ask yourself 2 of the customer's questions with web search, as a neutral assistant, and note whether the site is mentioned. This is an approximation of what ChatGPT or Perplexity would say; say so.

## Code folder (only when given)

Look for the framework's SEO settings: a global `noindex`, a robots or sitemap generator, page titles set per page, client-side-only rendering.

## Search Console export (only when given)

If a file from Search Console (Performance export: Queries, Pages) is in the folder, use it: total clicks and impressions, top queries, queries on positions 5 to 20 with many impressions (the easiest wins), pages with many impressions and a low click rate (title or description to improve). Ignore anything under 50 impressions.

## Who fixes what

Robots, noindex, canonical, sitemap, titles in templates: the web developer (or the person with admin access to WordPress or the site builder, often a single setting). Texts, titles and descriptions per page: the owner or whoever writes the content. Google Business Profile: the owner, at business.google.com.

## Severity guide

Critical: blocked by robots.txt, noindex on main pages, site down or redirect loop. High: not in the index, duplicate titles, empty JavaScript shell, wrong canonicals, no map listing for a local business. Medium: no sitemap, missing structured data, thin pages, slow mobile. Low: descriptions, alt texts, previews.
