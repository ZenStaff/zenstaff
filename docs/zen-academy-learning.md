# Zen Academy: learning from what people ask

Status: design. Only the local part (on the device) is built in v1; the hub part comes with
`zen/hub` (accounts, relay, sharing).

## Goal

The Academy should get better from real use. If many people in many companies ask the agent how to
build an Excel report, or search the Academy for "facturi" and find nothing, we want to know. We
then write a lesson or a workflow for it. Nothing is published automatically.

We do this without reading anyone's chats. The design rule: **only topic labels and counts ever
leave a device, and only when the company has opted in.**

## Signals

| Signal                                       | What is counted                                                                              | Where it comes from                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Topics people ask about                      | Labels from a fixed list (`spreadsheets`, `press-release`, `database-rls`, ...) with a count | Messages sent from the composer, reduced to labels on the device                       |
| Tasks that failed or needed many corrections | Workflow id or topic label, plus a count of failed runs and of follow-up corrections         | Thread outcomes (run failed, interrupted, or more than N user corrections before done) |
| Academy searches with no result              | The search, stripped to at most 5 plain words, with a count                                  | The Academy search box                                                                 |

What is never collected: message text, file names or contents, project or company names, people's
names, emails, phone numbers, IDs, links, numbers, anything that looks like a password or key, model
output, and which person did what.

## Privacy rules

1. **Opt-in per company.** A company admin turns it on for the company. It is off by default, and
   always off by default on a self-hosted hub. A person can still turn it off for their own device
   ("Help improve the Academy" in Settings > General); the device setting wins.
2. **Personal data and content are stripped on the device.** A message is reduced to labels from a
   fixed list before anything is stored; the text itself is never stored. A no-result search is
   folded to lowercase ASCII words, and emails, links, digits and secret-looking text are dropped. A
   search that contains a CNP, a card number or a key is dropped entirely (`signals.ts`,
   `secretDetection.ts`).
3. **Only topic labels and counts leave.** The payload is `{ since, topics: {label: count},
   noResultSearches: {words: count}, failedTasks: {label: count} }` per device and period. The hub
   adds the counts per company and then across companies.
4. **Thresholds before anything is visible.** A label or search is only shown to reviewers when it
   was seen in at least 3 companies and 10 devices in the period (k-anonymity). Rare searches never
   leave the aggregation step.
5. **Nothing is used without human review.** The hub proposes; people at ZED-ZEN decide.

## Flow

```
device                          company hub                   ZED-ZEN review
------                          -----------                   --------------
message -> topic labels  ─┐
academy search (no hit) ──┼─> local counters ── opt-in? ──> per-company totals ──> cross-company totals
failed / corrected task ──┘   (localStorage)    (company)    (no device ids kept)    (k >= 3 companies)
                                                                                      |
                                                                    proposals: "write a lesson on X",
                                                                    "add a workflow for Y", "improve Z"
                                                                                      |
                                                                    reviewer accepts / edits / rejects
                                                                                      |
                                                                    lesson or workflow is written and
                                                                    shipped in a normal release (or the
                                                                    marketplace), never auto-published
```

1. **On the device.** Counters live in `localStorage` (`zen:academy:signals`). They only count while
   "Help improve the Academy" is on. Settings shows exactly what would be shared, and Clear empties
   it. Turning the switch off clears it.
2. **Collection.** The hub client calls `collectAcademySignals()` (returns `null` when not opted in)
   once a day, sends the counts with the company id and resets the period. Device ids are not stored
   on the hub; the company total is what is kept.
3. **Aggregation.** The ZED-ZEN hub receives company totals only from companies that opted in,
   applies the thresholds, and builds a ranked list: top topics with no matching lesson, top
   no-result searches, workflows with the highest failure or correction rate.
4. **Proposals.** For each item the hub drafts a proposal: the topic, the counts and trend, the
   closest existing lessons and workflows, and a suggested outline. A model may draft the outline
   from the label only; it never sees user content because none exists on the hub.
5. **Review.** A person reviews each proposal: accept (then a lesson or workflow is written and
   checked like any other content), merge into an existing lesson, or reject. Rejected labels can be
   muted.
6. **Company lessons.** A company admin sees the same view for their own company (their own totals,
   no thresholds across companies) and can write "how we do X here" lessons in
   `<zen home>/companies/<id>/academy/`.

## What v1 builds (local only)

- Academy search records no-result searches locally (`recordNoResultSearch`, debounced 1.5 s).
- A local topic counter: messages sent from the composer are reduced to labels from the fixed list
  in `signals.ts` (`ACADEMY_TOPICS`) and counted; no text is kept.
- Settings > General > Academy > "Help improve the Academy", default off, with a preview of the
  exact payload and a Clear button.
- `collectAcademySignals()`: the seam the hub will call.

Not built yet: failed/corrected task counts (needs the thread outcome events on the server), the
hub transport, company opt-in, aggregation, thresholds and the review screen.

## Open questions

- Should the topic list be versioned and updated from the hub? (Probably yes: a new label should not
  need an app release.)
- Should company admins see their own company's no-result searches before the threshold? They
  already own that data, so likely yes, still without device or person ids.
- Retention on the hub: keep monthly totals for 12 months, delete raw daily uploads after aggregation.
