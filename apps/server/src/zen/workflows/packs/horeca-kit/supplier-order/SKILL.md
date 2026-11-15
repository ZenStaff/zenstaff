# Supplier order from stock

Order enough to reach the next delivery plus a small safety stock, rounded to the supplier's
packs, and nothing more: overstock is money on a shelf and waste in the bin.

## order-input.json

```json
{
  "cover_days": 3,
  "delivery_date": "2026-11-10",
  "items": [
    {
      "name": "Cartofi",
      "unit": "kg",
      "stock": 12,
      "daily_use": 9,
      "min": 10,
      "supplier": "Fresh Legume Ardeal",
      "pack": 10,
      "lead_days": 1,
      "price": 2.8
    },
    {
      "name": "Detergent vase",
      "unit": "buc",
      "stock": 1,
      "par": 4,
      "supplier": "Distribuție Horeca Plus",
      "pack": 1,
      "price": 42
    }
  ],
  "suppliers": [
    {
      "name": "Fresh Legume Ardeal",
      "contact": "comenzi@... / 07...",
      "min_order": 150,
      "delivery_days": "L, Mi, V"
    }
  ]
}
```

- `stock`: what is on hand now, in the purchase unit. A negative stock in the file means the
  inventory is wrong: keep the number (the script flags it).
- `daily_use`: from the usage given (or sales × the recipe quantity when the person gave both);
  for weekends or events in the notes, use the higher figure and say so. No usage and no `par`
  for an item: leave both out; the script flags it and you ask.
- `par`: a fixed level to fill up to (cleaning products, packaging, drinks), when the person
  works that way.
- `min`: safety stock (one day of use is a good default for fresh produce if nothing is given).
- `cover_days` from the form ("until the next delivery plus one day" = days between deliveries
  - 1). `lead_days`: days from ordering to delivery (1 when unknown).
- `pack`, `price`, `supplier`: from the supplier files or notes; unknown pack = 1.

## messages.md

Per supplier: subject "Comandă <restaurant> pentru <zi, dată>", a short polite email (greeting,
the list as a table: product, quantity with unit and packs, any note), delivery date and time
window, who receives it, a request to confirm, signature with the restaurant's name; then a
WhatsApp version of 5-10 lines. Under it, for the person only: the order value, items flagged,
and below-minimum orders with the suggestion from the sheet. Product names as the supplier
writes them when the supplier list has them.

## Self-review (do it, then fix what fails)

1. Quantities in the messages are exactly the "De comandat" column, with units and packs.
2. Every flagged item is in the questions; nothing was ordered on a guessed usage.
3. Each supplier's message has only that supplier's items.
4. Below-minimum orders are pointed out with what to add or when to join them.
5. Romanian text uses ș and ț (comma below); no emoji.
