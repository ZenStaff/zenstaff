# Writing an SOP from "how we do X"

A good procedure is the way the best person on the team does it, written so the newest person
can repeat it: one action per step, the checks that catch mistakes, and what to do when
something is off.

## Interview mode

Ask in rounds; at most 6 numbered questions per message; short and concrete; then stop.

- **Round 1, the frame**: What starts the process (a trigger, a time, a request)? What is the
  result when it is done well? Who does it, and who checks? What do you need before starting
  (tools, materials, accounts, documents)? How long does it take? How often?
- **Round 2, the steps**: "Walk me through it the last time you did it, step by step." Then
  for the unclear steps: what exactly do you look at, how much, which button, which form?
- **Round 3, the edges**: What goes wrong most often, and how do you notice? What do you do
  when X is missing or late? What must never happen (safety, money, customer, law)? Which
  record or proof stays after it is done?

Repeat back the steps as a numbered draft list in your third message when that helps the
person correct you. Never write the files before the person answered at least one round in
interview mode, unless they say "write it now".

## sop/<slug>.md

```
# <Process name>
Code: SOP-<AREA>-<NN> · Version 1.0 · <date> · Owner: <role> · Review: every 6 months

## Purpose            one or two sentences: why it exists, what it protects
## Scope              where it applies and where it does not
## Roles              who does, who checks, who decides when there is a problem
## When               trigger and frequency, time it takes
## You need           tools, materials, access, documents
## Steps              numbered; one action per step, starting with a verb;
                      quantities, times, temperatures, amounts written out;
                      "Check:" lines where a mistake is likely;
                      decisions as "If ..., then ...; otherwise ..."
## Quality checks     how to know it was done right (what you see, measure, record)
## Common mistakes    the ones from the interview, and how to avoid each
## Records            what is written down or kept, where, for how long
## Open questions     everything still unclear, as [CHECK: ...]
## Changes            table: version, date, what changed, who
```

Safety, hygiene and legal steps (food safety, money handling, personal data, working at
height, chemicals) are never shortened and are marked **Important**. Do not add a law or a
standard the person did not mention unless you are certain of it; otherwise write it as a
question.

## sop/<slug>-checklist.md

One page: the title, the steps as tick boxes (`- [ ]`), the 3 checks that matter most, and who
to call when something is wrong. Short enough to laminate.

## Rules

- The person's way of working, not a textbook version: keep their order, their names for
  things, their tools. Improve only wording; propose process changes separately under
  "Suggestions" at the end, clearly marked as suggestions.
- Romanian with ș and ț (comma below); "tu" form for instructions. No emoji.

## Self-review (do it, then fix what fails)

1. Every step is one action, starts with a verb, and has what someone new needs to do it.
2. Nothing in the steps was invented: unknowns are in "Open questions".
3. Each likely mistake has a "Check:" line or a quality check.
4. The checklist matches the steps (same order, nothing missing).
5. Safety, money and data steps are marked Important.
