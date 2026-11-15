# An SEO article that earns its place

One article that answers one real search better than what is ranking now, written only from
facts that can be checked, with the internal links and structured data a site needs. This is
the method of a blog pipeline that published about a hundred articles: choose from real
searches, brief first, strict facts, then checks.

## 1. Research (15 minutes of reading, not more)

- **The site**: what they sell, where, for whom, their tone, prices only if published. List
  the existing pages and posts (`sitemap.xml`, or the blog page). If a page already answers
  the search, do not write a second one: say so in the brief and write the article as an
  update of that page instead (same format), so the two do not compete.
- **The search**: use the web search tool on the topic and its variants. From the top
  results note the angle, the type of page that ranks (guide, list, comparison, local page,
  price page), what they all cover, what they miss, and the questions people ask. Do not
  copy sentences; never more than 8 words in a row from any page.
- **Sources**: facts outside the person's own come only from official or primary sources
  (laws on legislatie.just.ro, ANAF, ministries, standards, manufacturers' documentation,
  studies with a name and year). Write down each with its URL.

## 2. The brief (`brief.md`)

Main search phrase (the keyword) and 3-6 variants; search intent (learn / compare / buy /
find nearby); page type and length; the reader's situation in two sentences; the outline
(H2s phrased as questions people ask); 3-6 FAQ questions; 3 or more internal links (real URLs
of the site: the page that sells the thing, related posts, the contact page) and where each
goes; external sources; what makes this article better than the top results.

## 3. The article (`article.md`)

```markdown
---
title: "The H1: the search phrase near the start, a clear promise"
seo_title: "Title for Google, at most 60 characters"
slug: words-of-the-keyword-with-dashes
description: "Meta description, 120-160 characters, with the keyword and why to click."
keyword: the main search phrase
keywords: [variant 1, variant 2, variant 3]
published: YYYY-MM-DD
updated: YYYY-MM-DD
answer: "The direct answer in 40-60 words, the way it should appear in Google. No double quotes inside."
author: "Name from the form, or the business name"
publisher: "Business name"
language: ro
---

## Pe scurt

- 4 to 6 one-sentence facts.

## A question as people search it?

The first sentence answers. Then detail, steps, an example with real numbers when the facts
give them, a table when comparing.

(4 to 7 H2 sections in total)

## Întrebări frecvente

### Question?

Answer in 1-3 sentences.

The last line invites the next step with a link to the page that sells it or to contact.
```

- No `# H1` in the body (the title is the H1). The FAQ section is called exactly
  `## Întrebări frecvente` in Romanian or `## Frequently asked questions` in English, with
  `### ...?` questions: the build turns it into FAQPage data.
- Links are markdown links: internal ones as paths (`/meniu/`) or full URLs of the site;
  external ones only to the sources in the brief. At least 3 internal links, never the same
  URL twice.
- Length from the form: short guide 900-1200 words, full guide 1500-2200 words. Put
  `min_words: 1500` in the frontmatter for a full guide.
- Style: "tu"/"you", short sentences, concrete, examples from their trade. No "în era
  digitală", "în ziua de azi", "unic", "revoluționar", "cel mai bun". Romanian with ș and ț
  (comma below).

## Facts: what you may and may not write

You may write what the form says, what the site says, and what an official source says (with
the source linked). You may not invent prices, discounts, statistics, percentages, numbers of
customers, testimonials, awards, years of experience, certifications or fines. A fine or a
legal duty is written only with the act and article you read today. If a sentence needs a fact
you do not have, rewrite it without the fact or mark it [CHECK: what to confirm] and list it in
`publish.md`.

## 4. `publish.md`

The checks result (passed, words, internal links); every [CHECK] to answer; the SEO title,
description and slug to copy into the site's SEO fields (WordPress with Yoast or Rank Math,
Webflow, Shopify, Wix); how to paste `<slug>-body.html` (WordPress: a "Custom HTML" block or
the code editor; it carries its own FAQ and article data, so turn off a plugin's duplicate FAQ
schema); an image idea with alt text; after publishing: open the page, then ask Google to
index it in Search Console (URL inspection) and add it to a related older post as a link.
One line on transparency: the text was drafted with AI and must be read and approved by the
person who signs it.

## Self-review (do it, then fix what fails)

1. `article.mjs` passed (no ERROR lines); warnings are fixed or explained in `publish.md`.
2. The title, the `answer` and the first section answer the exact search.
3. Every number and claim is from the form, the site or a linked official source; nothing
   invented; open points marked [CHECK].
4. No sentence copied from a ranking page; the article adds something they miss.
5. Internal links point to pages that exist on the site (you saw them in the sitemap or
   on the site).
6. Headings are questions or clear statements, 4-7 H2s, FAQ 3-6 real questions.
7. Romanian diacritics are ș and ț everywhere; no emoji; no placeholders left except [CHECK].
