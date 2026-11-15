Write last week's Meta ads report for the ad account {{ad_account}}.{{#focus}} Focus on: {{focus}}{{/focus}}

1. Read the numbers with the prepared reader (it calls the Meta API through the company's credential proxy; you never see the key):
   `node "$ZEN_WORKFLOW_DIR/insights.mjs" {{ad_account}} > meta-ads-last-week.json`
   If it prints a line starting with `ERROR:`, stop and tell the person that reason in one sentence.
2. Write `meta-ads-report.md`: spend, results, cost per result and click-through rate per campaign, the best and worst ad, and three concrete changes for next week.
3. Answer with a five-line summary and the absolute path of the report. Do not install anything.
