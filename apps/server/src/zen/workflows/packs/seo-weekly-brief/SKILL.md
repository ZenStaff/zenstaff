# The weekly search brief

Read `{{workflow_folder}}/references/method.md` and follow its steps in order. The essentials:

- **Compare with last week.** Look in `seo-weekly/` for the newest earlier `snapshot-*.json`, `ai-answers-*.json` and `brief-*.md`. No earlier files means this is the first week: say "first week, this is the baseline" and do not invent trends.
- **Facts only.** Every number comes from the data you collected or the export. Separate correlation from cause; say "possibly" when unsure. Under 50 impressions a week is noise: do not draw conclusions from it.
- **Polite fetching.** At most about 40 requests to the website and 10 to each competitor, one at a time, with `-A "Mozilla/5.0 (compatible; owner-seo-brief)"`; respect robots.txt for competitors.
- **AI answers are an approximation.** You answer the questions as a neutral assistant with web search; this stands in for ChatGPT, Perplexity or Gemini, and the brief says so. Never favour the business in your answer.
- **3 actions, not 30.** Each action: the page, exactly what to change, why (with the evidence), effort (minutes or hours), who does it, and the number to check next week.

Files to write (dates as YYYY-MM-DD):

- `seo-weekly/snapshot-<date>.json`: the site and competitor data (format in the method file).
- `seo-weekly/ai-answers-<date>.json`: one object per question.
- `seo-weekly/brief-<date>.md`: the brief for the owner.
- `seo-weekly/actions.md`: running checklist; append this week's 3 actions as `- [ ] action | number to check | check on <date>` and tick `[x]` earlier ones the data now confirms, with the result.
