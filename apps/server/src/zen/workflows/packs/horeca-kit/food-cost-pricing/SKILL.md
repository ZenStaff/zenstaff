# Food cost and menu prices

Food cost % = cost of the ingredients in one portion / menu price without VAT. The workbook
keeps the formulas live: the chef changes a price in "Ingrediente" and every dish updates.

## recipes.json

```json
{
  "target_food_cost": 30,
  "vat": 11,
  "ingredients": [
    {
      "name": "Carne tocată porc-vită",
      "unit": "kg",
      "price": 32.5,
      "price_includes_vat": false,
      "supplier": "..."
    },
    { "name": "Ceapă", "unit": "kg", "price": 3.1, "yield": 0.9 },
    { "name": "Ou", "unit": "buc", "price": 0.95 }
  ],
  "recipes": [
    {
      "name": "Ciorbă de perișoare",
      "category": "Supe",
      "portions": 12,
      "price": 24,
      "price_includes_vat": true,
      "lines": [{ "ingredient": "Carne tocată porc-vită", "qty": 800, "unit": "g" }]
    }
  ]
}
```

- Ingredient `unit` is the purchase unit of its price (kg, l, buc). Recipe lines may use g, kg,
  ml, l, buc: the script converts g/kg and ml/l; it cannot turn "1 bucată ceapă" into kg, so
  write such lines in the purchase unit (estimate 1 ceapă ≈ 0.15 kg only when the notes give
  weights, otherwise ask).
- `yield`: the usable share after cleaning or cooking loss (peeled onion 0.9, whole chicken
  for breast 0.4). Use the notes or the recipes; leave it out (1) when unknown and list it as a
  question: wrong yields are the main reason a food cost looks too good.
- Prices from invoices or price lists are usually without VAT: `price_includes_vat` false. A
  price from a supermarket receipt includes VAT: true, with `vat` of that product (11 for food,
  21 for most non-food). Use the most recent price for each ingredient and say which.
- Menu prices are with VAT (`price_includes_vat` true). VAT on food sold: 11% in Romania from
  August 2025 for restaurant food and non-alcoholic drinks (21% for alcohol); the form decides.
- `portions`: how many portions the recipe yields. Per-portion recipes have portions 1.
- `target_food_cost` per dish can be set on a recipe (drinks 20-25%, desserts 25-30%, mains
  28-35% are common ranges; use the form's target).

## raport.md

1. **In one paragraph**: average food cost (weighted by sales when given), how many dishes are
   above target and the biggest gap.
2. **The table**: dish, cost per portion, menu price, food cost %, margin per portion, price at
   target; above-target dishes first.
3. **What to do**, per dish above target, one concrete option each with the numbers: raise
   the price to X lei, reduce the costliest ingredient from 150 g to 120 g, swap an ingredient,
   change the side. The "price at target" column is a reference, not an instruction: a dish
   far below target does not need a lower price; say it is a good margin.
4. **Menu engineering** (only when sales were given): Stars (sell well, high margin), Plow
   horses (sell well, low margin: fix cost or price), Puzzles (high margin, sell little:
   promote, rename, move on the menu), Dogs (both low: replace). Popularity line at 70% of an
   even share, margin line at the average margin per portion.
5. **Questions and assumptions**: missing prices, yields guessed, units estimated.

## Self-review (do it, then fix what fails)

1. The script ran without missing prices or units, or every gap is in the questions.
2. Spot-check two dishes by hand (quantity × price per unit / portions) and they match.
3. VAT is handled once: menu prices with VAT, costs without.
4. No ingredient price was invented; each comes from the files or the notes.
5. Recommendations come with numbers and never suggest cutting a price below a good margin.
6. Romanian text uses ș and ț (comma below).
