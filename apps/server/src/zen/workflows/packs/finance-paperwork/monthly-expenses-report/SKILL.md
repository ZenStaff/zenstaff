# Monthly expenses from the bank statement

The owner wants three answers: where the money went, what changed, and what needs a look.
`expenses.mjs` does the arithmetic and the flags; you choose the categories, explain, and ask.

## Input files

- **CSV or Excel export** (best): the script finds the header row and the date, description,
  amount or debit/credit columns of most banks (BT, BCR, ING, BRD, Raiffeisen, Revolut, CEC).
  If it says the columns were not recognised, write `expenses/map.json` with the exact header
  names (`{"date": "...", "description": "...", "debit": "...", "credit": "..."}` or
  `"amount"`) and add `--map expenses/map.json`.
- **PDF statement**: if it has text, read it page by page and write `expenses/extras.csv` with
  the header `date,description,amount` (date YYYY-MM-DD, amount negative for payments and
  positive for money in, dot as decimal mark), one row per transaction, nothing skipped; then
  run the script on that CSV. Check that the number of rows and the total of payments match the
  statement's own totals when it prints them. A scanned PDF (only images, no text): ask for
  the CSV or Excel export from internet banking instead (every Romanian bank has one).

## rules.json

```json
[
  { "match": "transfer intre conturi proprii", "ignore": true },
  { "match": "fresh legume", "category": "Marfă și consumabile" },
  { "match": "salariu", "category": "Salarii și colaboratori" }
]
```

`match` is a piece of the bank description (no diacritics needed); the first rule that matches
wins, before the built-in ones. Use the person's own category names when they gave them, and
keep 8-14 categories. Transfers between the company's own accounts, loans moved between
accounts and card top-ups are `ignore`: they are not expenses.

## The report (`raport-<YYYY-MM>.md`)

1. **In one paragraph**: total spent, total received, the difference, and the one thing that
   matters most this month.
2. **Where the money went**: the categories table (amount, share, transactions) as in the
   workbook, biggest first, with one line of comment on the top 3.
3. **What changed**: against the previous month (when the files have it) or the budget given;
   only real differences, with the amounts.
4. **Check these**: every flag from the "De verificat" sheet in plain words (possible double
   charge, unusually large payment, new merchant, price change, foreign currency) and what to do.
5. **Questions for you**: the payments that stayed unclear, with date, amount and description,
   so the person can answer in one go; their answers become rules next month.
6. **Ideas**: at most 3 concrete savings that follow from the numbers (a subscription to cancel,
   a supplier to renegotiate, card fees), never generic advice.

Amounts as in the bank (lei, two decimals, Romanian format 1.234,56 lei in Romanian text).

## Self-review (do it, then fix what fails)

1. The script ran without ERROR on all statement files; the month is right.
2. Totals in the report are copied from the script's summary, not recomputed by hand.
3. Own-account transfers are ignored, not counted as expenses.
4. Every flagged transaction appears in "Check these"; nothing flagged is called fraud: you
   say what was noticed and how to check.
5. Uncategorised merchants are either categorised by a rule or listed as questions.
6. No invented reasons for a payment; Romanian text uses ș and ț (comma below).
