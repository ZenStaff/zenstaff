# Sales report per day and shift from a POS export

`sales.mjs` reads exports with one row per sold line (receipt, date, time, product, quantity,
value, category, payment, waiter, status) or one row per receipt, finds the columns by their
names, and does all sums and flags. You explain what the numbers mean for running the place.

## map.json (only when needed)

```json
{
  "datetime": "Data",
  "time": "Ora",
  "product": "Articol",
  "qty": "Cant",
  "value": "Valoare",
  "category": "Grupa",
  "payment": "Tip plata",
  "staff": "Ospatar",
  "receipt": "Nr bon",
  "discount": "Reducere",
  "status": "Stare"
}
```

Only the columns that exist; `datetime` and `value` are required. Use the value with VAT if the
export has both (that is what the till shows); say which one in the report. Rows with a
negative value or a status like storno/anulat are counted as voids, not sales.

## The report

1. **The period in numbers**: sales, receipts, average receipt, best and weakest day (with
   the weekday), share of the evening vs lunch shift.
2. **Per shift**: a short table per day and shift; what stands out (a shift that carries the
   week, a lunch that is weak on certain days).
3. **When people come**: the busiest hours, and what it means for staffing (for example "two
   people on the floor 12:00-14:00, one after 15:00 on weekdays").
4. **What sells**: top 10 products and categories by value; the slow ones (candidates to
   change, never "remove" on two weeks of data alone); the mix of payment methods.
5. **Team**: sales and average receipt per person, side by side with their shifts (a lunch
   waiter sells less per receipt than an evening one: say so instead of ranking unfairly).
   Discounts and voids per person.
6. **Check these**: every flag from the "De verificat" sheet in plain words, with the
   question to ask. A high number of voids is a question, not an accusation.
7. **Three actions for next week**, each tied to a number above.

Use the context from the form to explain a weak or strong day; never invent a reason (weather,
event) that was not given: write "cauza nu e cunoscută" and the question to ask.

## Self-review (do it, then fix what fails)

1. Every number in the report comes from the summary or the workbook.
2. The shifts match the form; late-night sales count for the right business day.
3. Voids and discounts are separate from sales and explained without blame.
4. Comparisons are fair (same weekday or same kind of day; lunch vs evening shifts).
5. The three actions are concrete and follow from the numbers.
6. Romanian text uses ș and ț (comma below).
