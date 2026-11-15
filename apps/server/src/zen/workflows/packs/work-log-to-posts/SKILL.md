# From work log to posts

## 1. Collect the evidence (`posts/activity-<YYYY-MM-DD>.md`)

- Pasted notes: take them as given.
- Files and folders: read the ones changed in the period (`find <folder> -type f -newermt <start date>`, skipping `node_modules`, `.git`, build output, images). Notes, changelogs, reports, finished documents count most.
- A git project: `git log --since=<start> --no-merges --date=short --format="%h|%ad|%s"` on the main branch = shipped; commits only on other branches = still in progress. Skip routine commits (typo, lint, bump, merge, wip).
- Write each item as: date, what happened, status (**done** or **in progress**), source (file or commit). Nothing goes in without a source.

## 2. Decide what is worth a post

A story is worth a post when at least one is true: something people can now see or use (a launch, a new service, a new place, a finished project); a practical lesson others can apply; a real, checkable number or result; something the person explicitly noted as worth sharing. Ten small fixes are not a story. At most 3 drafts; fewer is fine.

- **Done vs in progress:** only "done" items may be written as done ("we launched"). In-progress work is "we are working on".
- **Only what the sources say.** No invented numbers, quotes, clients or outcomes. A post that needs a missing number goes without it.
- **Privacy and safety:** respect the boundaries given; no personal data of customers or staff; no security details (vulnerabilities, passwords, incidents not yet fixed); no confidential client figures.

## 3. Write the drafts (`posts/drafts/<YYYY-MM-DD>-<channel>-<short-slug>.md`)

Each file:

```
---
channel: linkedin | facebook
status: draft
period: <start> to <end>
sources:
  - "<source for each claim: file, commit or note>"
---

<the post, exactly as it would be published>
```

- **LinkedIn:** 120 to 250 words. The first sentence carries a fact or a number, not a rhetorical question. Short paragraphs. First person ("we built", "I learned"). At most 3 hashtags, at the end. A link only when the sources have a public page for it.
- **Facebook:** 60 to 150 words, warmer and more personal, local when it fits. One link at most.
- When both channels are chosen, write the same story differently for each, not a copy.
- **Voice:** direct and concrete, the way the person talks; match the past posts when given. No buzzwords ("excited to announce", "game-changer", "thrilled", "leverage", "journey"), no emoji strings, no engagement bait ("Agree?"), no fake humility.

## 4. Check before saving

Every claim traces to a source line; nothing in progress reads as done; the boundaries hold; word counts fit.
