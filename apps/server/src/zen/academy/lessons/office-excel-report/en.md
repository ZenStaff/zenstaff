---
learn:
  - Put the spreadsheet where the agent can see it and name the exact file
  - Ask for a report for a specific period and reader
  - Make the agent compute the numbers instead of guessing, and check the totals
---

## Put the file where the agent can see it

The agent can only work with files that are in the thread's folder or in an app your company has connected.

Copy the spreadsheet into the folder first. Then name it exactly in your request: "use vanzari-octombrie.csv".

:::picture folder
The spreadsheet has to be in the folder the agent works in.
:::

:::tip
Several versions of the same spreadsheet? Delete or move the old ones. Otherwise the agent may pick the wrong one.
:::

## CSV or XLSX?

- **CSV** is a plain table: rows and columns, nothing else. The agent reads it reliably. If you can, save your sheet as CSV (in Excel: File, Save As, CSV UTF-8).
- **XLSX** is a full Excel file with several sheets, formulas, merged cells and colours. The agent can usually read it, but merged headers, hidden sheets and totals typed in the middle of the data confuse it.

:::example If you send an XLSX
"Sheet Octombrie, data from row 3, ignore the total row at the bottom."
:::

## Say the period and the reader

The same numbers make a different report for different people:

- **Management** wants three or four numbers, the trend and what to decide.
- **The team** wants detail: which product, which day, what to change.
- **A client** wants only what concerns them.

Write both explicitly: "period: 1-31 October 2026; reader: the owner, who has two minutes".

:::dont
"Make a report from the sales file."
:::

:::do
"Use vanzari-octombrie.csv. Write a one-page report for the owner about October 2026: total sales, sales per store, top 3 products, weakest store and a possible reason based only on the data. Compute everything from the file and show the method. Save as raport-octombrie.md."
:::

## Compute, don't guess

An agent can "read" a table at a glance and write a total that looks right but is not. Ask for computed numbers.

:::example Lines to put in your request
"Compute every number from the file. Do not estimate or round before the final step. Under each table, show how you computed it (which column, which rows, sum or average)."
:::

The agent then actually runs the calculation over the file instead of eyeballing it. And when it shows the method, you can check it.

## Check the totals yourself

Before the report goes anywhere:

1. Open the CSV in Excel and sum the total column. It must match the report's grand total exactly.
2. Pick one store or product and filter it. Compare.
3. Look for numbers the file cannot contain.

:::picture check
The total in the report has to match the file.
:::

:::warn
Percentages "versus last year" when you only gave one month, or "growth" with nothing to compare against, are invented. Remove them or give the agent the missing data.
:::

## Try it now

:::try
The button starts the "Weekly report from files" workflow in a practice folder with fake October sales from a bakery with three shops. The fields are already filled in. When the report is ready, open the CSV and check that the grand total matches.
:::

:::quiz
The report says sales grew 12% versus last year, but you only gave it the October 2026 file. What do you do?

- [ ] Keep it, it sounds believable.
- [ ] Round it to 10% to be safe.
- [x] Remove the number, or give the agent last year's data too.

> The file has nothing to compare against, so the percentage is invented.
:::

:::quiz
What do you add to your request so you can check the totals?

- [x] Compute every number from the file and show how it was computed.
- [ ] Write in a more professional tone.
- [ ] Make the report longer.

> When it shows the column, the rows and the operation, you can redo the calculation in Excel.
:::

:::quiz
You send an XLSX with several sheets and a total row at the bottom. What do you tell the agent?

- [ ] Nothing, it will figure it out.
- [ ] Read all the sheets and add everything up.
- [x] Which sheet, which row the data starts on, and to ignore the total row.

> Hidden sheets, merged headers and totals inside the table confuse the agent.
:::
