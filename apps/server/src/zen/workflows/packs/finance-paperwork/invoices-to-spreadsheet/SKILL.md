# Invoices and receipts to a spreadsheet

The accountant gets one clean workbook; the person sees at a glance which cells to check on
paper. OCR is never trusted blindly: every value you write is looked up again in the words
Tesseract read, with their confidence, by `invoices.mjs`.

## invoices.json (you write it)

```json
{
  "title": "Facturi furnizori, octombrie 2026",
  "invoices": [
    {
      "file": "inputs/facturi/IMG_1412.jpg",
      "type": "invoice",
      "supplier": "Fresh Legume Ardeal SRL",
      "supplier_cui": "RO44712353",
      "buyer_cui": "RO38554417",
      "number": "FLA 2026-0412",
      "date": "2026-10-03",
      "due_date": "2026-10-17",
      "currency": "RON",
      "vat": [{ "rate": 11, "base": 344.5, "vat": 37.9 }],
      "net": 344.5,
      "vat_total": 37.9,
      "total": 382.4,
      "payment": "transfer",
      "uncertain": ["number"]
    }
  ]
}
```

- One entry per document (a PDF with two invoices = two entries with the same `file`).
- `type`: `invoice`, `receipt` (bon fiscal) or `other` (proforma, aviz, chitanță: say which
  in `notes`; a proforma is not an invoice for the accountant).
- Write values **exactly as printed** on the document: supplier name as written, the series
  and number together, dates as YYYY-MM-DD, amounts as numbers with a dot (1234.5).
- `vat`: one line per VAT rate as printed (base and VAT of that rate). On a receipt the base
  is usually not printed: base = total of that rate − its VAT.
- `net`, `vat_total`, `total`: as printed; when a total is not printed, the sum of the lines.
- `uncertain`: the fields you could not read clearly, even after looking at the preview.
  Never guess a digit: a field you cannot read stays `null` and goes in `uncertain`.
- `payment`: only when the document says it (card, cash, transfer, OP); otherwise leave it out.
- Foreign currency: keep the currency and the amounts as printed; the sheet says the
  accountant converts them at the BNR rate of the date.

## How to read well

- Read the `.txt` first, then **open the preview image** and compare: OCR mixes 0/O, 1/l, 5/S,
  8/B, comma and dot. Words in `[?word]` were read with low confidence: check them on the image.
- The supplier (furnizor/vânzător) and the buyer (cumpărător/client) both have a CIF: do not
  swap them. The buyer should be the person's company when its tax ID was given; if not, say
  so in the README.
- A Romanian CUI/CIF has 2-10 digits (RO in front only for VAT payers). The script checks
  its control digit; a failure means a misread digit.
- Romanian VAT rates: 21% and 11% from 1 August 2025 (5% and 9% / 19% before). A receipt
  shows letters per rate (A, B, ...) with the rate next to it.
- Look for: "Total de plată", "Total", "TOTAL LEI", "Bază", "TVA", "Valoare TVA", "Total fără TVA".
- A photo that reads very badly (confidence under 60, or totals not readable on the image
  either): keep the entry with what you can read, mark the rest uncertain and tell the person
  to retake the photo flat, in good light, the whole page in the frame.

## What the script marks

- Every field it cannot find again in the OCR words, or finds with confidence under 80, goes
  yellow and into the "De verificat" sheet (one line per field: document, field, value read,
  confidence, why, what to do).
- The amounts per VAT rate are added up and compared with the printed totals: base + VAT of all
  rates against "Total de plată", the VAT of all rates against the total VAT. A difference over
  5 bani marks the total red: one of the digits is misread.
- On the "Documente" sheet each document row has its lowest confidence and a "De verificat"
  column with DA for every row that has something marked. `rowsToCheck` in the summary is how
  many rows that is; the person only checks those rows.

## README.md

How many documents, the totals (net, VAT per rate, total) from the script's summary, the list
"Please check" (every line of the "De verificat" sheet in plain words: which document, which
field, what to look at), the documents that could not be read, and the duplicates. Two lines
for the accountant: the column meanings and that the original files are in the folder.

## Self-review (do it, then fix what fails)

1. `invoices.mjs` ran without ERROR and the workbook has every document.
2. For every document you compared the numbers with the preview image, not only the text.
3. No value was guessed: unreadable fields are null and in `uncertain`.
4. Supplier and buyer are not swapped; the buyer matches the company's tax ID when given.
5. For each document net + VAT = total, or the sheet flags it and the README explains it.
6. Every flagged cell is in the README's "Please check" list in plain words, and the reply says
   "verifici doar cele N rânduri marcate" with N = `rowsToCheck`.
7. Romanian text uses ș and ț (comma below); amounts are not rounded differently from the
   documents.
