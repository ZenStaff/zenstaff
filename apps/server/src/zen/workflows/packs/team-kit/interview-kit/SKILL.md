# Interview kit: structured, fair, scored

Structured interviews (the same questions, scored against written anchors) predict job
performance far better than a free chat, and they are fairer. Everything here serves that.

## 1. Competencies

4-6 competencies from the must-haves (skills, behaviours, knowledge), each with a weight
(total 100) and a one-line definition in the business's words. Nice-to-haves never weigh more
than 15 in total. Example for a cook: Technical cooking 30, Hygiene and food safety 20, Speed
under pressure 20, Teamwork 15, Reliability 15.

## 2. interview-kit.md

1. **Structure** of each round with minutes (welcome and how the interview goes, questions,
   practical part, their questions, next steps and timeline).
2. **Questions**: for every competency 2-3 questions: behavioural ("Tell me about a time
   when...", followed by "What did you do? What happened?") and situational ("What would you
   do if..."), plus role-specific technical ones. Under each: **a strong answer** (what you
   want to hear, concrete), **a weak answer**, and 1-2 follow-up probes.
3. **Practical task** (when the format includes it, or for hands-on jobs): short, realistic,
   paid or under 1 hour, with what is evaluated. Never real unpaid work for the business.
4. **Scoring anchors** 1-4 per competency: 1 = no evidence, 2 = some, 3 = solid, 4 = strong,
   each described for this role.
5. **Do not ask** (Romania and the EU): age, marital status, children or plans for children,
   pregnancy, religion, ethnicity, nationality beyond the right to work, health beyond what the
   job strictly needs, political or union membership, sexual orientation. Discrimination is
   forbidden by the Labour Code (Codul muncii, art. 5) and OG 137/2000. Ask about availability
   ("Can you work the Saturday shifts?") instead of private life.
6. **After the interview**: each interviewer scores alone before talking; tie-break rules;
   what to tell candidates and when; keep notes and CVs only as long as needed (GDPR), delete
   the rest.

## 3. Scoring sheet (`scoring-sheet.json` -> `.xlsx`)

```json
{
  "title": "Interviu: Bucătar",
  "sheets": [
    {
      "name": "Punctaj",
      "title": "Fișă de punctaj: Bucătar",
      "subtitle": "Notează 1-4 după ancorele din kit. Totalul ponderat e calculat (maxim 4).",
      "columns": [
        { "header": "Competență", "width": 30 },
        { "header": "Pondere", "type": "percent" },
        { "header": "Candidat 1", "type": "int" },
        { "header": "Candidat 2", "type": "int" },
        { "header": "Candidat 3", "type": "int" },
        { "header": "Note", "type": "wrap" }
      ],
      "rows": [
        ["Tehnică culinară", 0.3, null, null, null, ""],
        {
          "style": "total",
          "cells": [
            "Total ponderat",
            { "f": "SUM(B5:B9)" },
            { "f": "SUMPRODUCT($B$5:$B$9,C5:C9)" },
            { "f": "SUMPRODUCT($B$5:$B$9,D5:D9)" },
            { "f": "SUMPRODUCT($B$5:$B$9,E5:E9)" },
            null
          ]
        }
      ]
    },
    {
      "name": "Ancore",
      "columns": [
        { "header": "Competență", "width": 26 },
        { "header": "1", "type": "wrap" },
        { "header": "2", "type": "wrap" },
        { "header": "3", "type": "wrap" },
        { "header": "4", "type": "wrap" }
      ],
      "rows": []
    }
  ]
}
```

With a title and a subtitle the header is on row 4 and the first data row is 5: count your
rows and write the formulas for them. Up to 5 candidate columns.

## 4. CV rubric (`cv-rubric.md`) and screening

Knock-out criteria (only true must-haves, e.g. a legal requirement), then points per
competency from what a CV can show, with examples of evidence. When screening: one row per
candidate (name as in the CV, evidence per criterion, points, "invite / maybe / no" and why).
Judge only job-related evidence; never infer age, family, origin or health; do not penalise
gaps without asking.

## Rules

- Questions in the language of the interview; Romanian with ș and ț (comma below).
- No trick questions, no brainteasers, no "What is your biggest weakness?".
- Nothing invented about the company: unknown facts (salary, schedule) become [CHECK].

## Self-review (do it, then fix what fails)

1. Weights add up to 100; each competency has 2-3 questions with strong/weak answers.
2. Every question is job-related; none is on the "do not ask" list.
3. The scoring sheet opens, its formulas point to the right rows, and totals are weighted.
4. Anchors 1-4 exist for every competency and are specific to this role.
5. CV screening (when done) cites evidence from each CV and uses only job criteria.
