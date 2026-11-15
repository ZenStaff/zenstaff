// Food cost and menu prices as a live workbook: change an ingredient price and every dish updates.
//   node foodcost.mjs --data recipes.json --out food-cost.xlsx [--lang en]   (recipes.json: see SKILL.md)
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { round2, writeXlsx } from "./tables.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const fold = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const UNITS = {
  kg: ["kg", 1000, "mass"],
  g: ["kg", 1, "mass"],
  gr: ["kg", 1, "mass"],
  mg: ["kg", 0.001, "mass"],
  l: ["l", 1000, "volume"],
  ml: ["l", 1, "volume"],
  cl: ["l", 10, "volume"],
  dl: ["l", 100, "volume"],
  buc: ["buc", 1, "count"],
  pcs: ["buc", 1, "count"],
  pc: ["buc", 1, "count"],
  bucata: ["buc", 1, "count"],
  ou: ["buc", 1, "count"],
};
/** Quantity in one unit -> quantity in another (kg/g, l/ml, buc); null when they do not convert. */
export function convert(qty, from, to) {
  const a = UNITS[fold(from)];
  const b = UNITS[fold(to)];
  if (!a || !b) return fold(from) === fold(to) ? qty : null;
  if (a[2] !== b[2]) return null;
  return (qty * a[1]) / b[1];
}

/** Rounds a menu price up to a whole leu, or to x.50 under 20 lei. */
export function menuPrice(value) {
  if (!(value > 0)) return null;
  return value < 20 ? Math.ceil(value * 2) / 2 : Math.ceil(value);
}

export function costRecipes(data) {
  const problems = [];
  const ingredients = new Map();
  for (const ing of data.ingredients ?? []) {
    if (!ing.name) continue;
    const vat = Number(ing.vat ?? data.ingredient_vat ?? 11);
    const price = Number(ing.price);
    const net = ing.price_includes_vat ? price / (1 + vat / 100) : price;
    const yieldShare =
      Number(ing.yield ?? 1) > 0 && Number(ing.yield ?? 1) <= 1 ? Number(ing.yield ?? 1) : 1;
    ingredients.set(fold(ing.name), {
      ...ing,
      net: Number.isFinite(net) ? net : null,
      yieldShare,
      unit: ing.unit ?? "kg",
    });
  }
  const dishes = [];
  for (const recipe of data.recipes ?? []) {
    const portions = Number(recipe.portions ?? 1) || 1;
    const vat = Number(recipe.vat ?? data.vat ?? 11);
    const lines = [];
    let complete = true;
    for (const line of recipe.lines ?? []) {
      const ing = ingredients.get(fold(line.ingredient));
      if (!ing || ing.net === null) {
        complete = false;
        problems.push({ dish: recipe.name, ingredient: line.ingredient, why: "missing-price" });
        lines.push({ ...line, qtyInUnit: null, cost: null, unit: line.unit });
        continue;
      }
      const qtyInUnit = convert(Number(line.qty), line.unit ?? ing.unit, ing.unit);
      if (qtyInUnit === null) {
        complete = false;
        problems.push({
          dish: recipe.name,
          ingredient: line.ingredient,
          why: "unit",
          detail: `${line.unit} -> ${ing.unit}`,
        });
        lines.push({ ...line, qtyInUnit: null, cost: null });
        continue;
      }
      lines.push({
        ...line,
        ingredientUnit: ing.unit,
        qtyInUnit,
        cost: (qtyInUnit / ing.yieldShare) * ing.net,
      });
    }
    const batch = lines.reduce((a, l) => a + (l.cost ?? 0), 0);
    const portionCost = batch / portions;
    const price = Number(recipe.price);
    const netPrice =
      Number.isFinite(price) && price > 0
        ? recipe.price_includes_vat === false
          ? price
          : price / (1 + vat / 100)
        : null;
    const target = Number(recipe.target_food_cost ?? data.target_food_cost ?? 30) / 100;
    const driver = [...lines].filter((l) => l.cost).sort((a, b) => b.cost - a.cost)[0];
    dishes.push({
      name: recipe.name,
      category: recipe.category ?? "",
      portions,
      vat,
      lines,
      complete,
      batchCost: batch,
      portionCost,
      priceWithVat:
        netPrice === null
          ? null
          : recipe.price_includes_vat === false
            ? netPrice * (1 + vat / 100)
            : price,
      netPrice,
      foodCost: netPrice ? portionCost / netPrice : null,
      margin: netPrice === null ? null : netPrice - portionCost,
      target,
      suggested: menuPrice((portionCost / target) * (1 + vat / 100)),
      driver: driver
        ? { ingredient: driver.ingredient, share: batch ? driver.cost / batch : 0 }
        : null,
    });
  }
  return { ingredients, dishes, problems };
}

function main() {
  const lang = opt("lang", "ro") === "en" ? "en" : "ro";
  const dataFile = opt("data");
  const out = opt("out");
  if (!dataFile || !out) fail("Use --data recipes.json --out food-cost.xlsx [--lang ro|en].");
  let data;
  try {
    data = JSON.parse(NodeFS.readFileSync(dataFile, "utf8"));
  } catch (error) {
    fail(`${dataFile} could not be read: ${error.message}`);
  }
  if (!Array.isArray(data.recipes) || data.recipes.length === 0)
    fail('recipes.json needs "recipes": [...]');
  if (!Array.isArray(data.ingredients) || data.ingredients.length === 0)
    fail('recipes.json needs "ingredients": [...]');
  const { ingredients, dishes, problems } = costRecipes(data);
  const L =
    lang === "ro"
      ? {
          sheets: ["Fișe de cost", "Rețete", "Ingrediente", "De verificat"],
          dishCols: [
            "Preparat",
            "Categorie",
            "Porții din rețetă",
            "Cost rețetă",
            "Cost pe porție",
            "Preț în meniu (cu TVA)",
            "Cota TVA",
            "Preț fără TVA",
            "Food cost %",
            "Marjă pe porție",
            "Preț la ținta de food cost (cu TVA)",
            "Ingredientul cel mai scump",
            "Țintă food cost",
          ],
          lineCols: [
            "Preparat",
            "Ingredient",
            "Cantitate",
            "U.M.",
            "Cantitate în U.M. de cumpărare",
            "U.M. cumpărare",
            "Cost",
          ],
          ingCols: [
            "Ingredient",
            "U.M.",
            "Preț de cumpărare fără TVA",
            "Randament (partea folosibilă)",
            "Cost pe U.M. folosibilă",
            "Furnizor",
          ],
          chkCols: ["Preparat", "Ingredient", "Problema", "Ce faci"],
          title: "Food cost și prețuri",
          subtitle: (t) =>
            `Ținta de food cost: ${t}%. Schimbă un preț în foaia Ingrediente sau ținta unui preparat și totul se recalculează. Galben = peste țintă, verde = sub țintă, roșu = date lipsă.`,
          missing: "ingredientul nu are preț în listă",
          missingDo: "Adaugă prețul de cumpărare în foaia Ingrediente.",
          unit: (d) => `unități care nu se pot transforma (${d})`,
          unitDo: "Scrie cantitatea în aceeași unitate ca prețul (kg, l sau buc).",
          noPrice: "preparatul nu are preț de vânzare",
          noPriceDo: "Trece prețul din meniu.",
        }
      : {
          sheets: ["Cost sheets", "Recipes", "Ingredients", "To check"],
          dishCols: [
            "Dish",
            "Category",
            "Portions per recipe",
            "Recipe cost",
            "Cost per portion",
            "Menu price (incl. VAT)",
            "VAT rate",
            "Price excl. VAT",
            "Food cost %",
            "Margin per portion",
            "Price at target food cost (incl. VAT)",
            "Costliest ingredient",
            "Target food cost",
          ],
          lineCols: [
            "Dish",
            "Ingredient",
            "Quantity",
            "Unit",
            "Quantity in purchase unit",
            "Purchase unit",
            "Cost",
          ],
          ingCols: [
            "Ingredient",
            "Unit",
            "Purchase price excl. VAT",
            "Yield (usable share)",
            "Cost per usable unit",
            "Supplier",
          ],
          chkCols: ["Dish", "Ingredient", "Problem", "What to do"],
          title: "Food cost and prices",
          subtitle: (t) =>
            `Target food cost: ${t}%. Change a price on the Ingredients sheet or a dish target and everything recalculates. Yellow = above target, green = below, red = missing data.`,
          missing: "the ingredient has no price in the list",
          missingDo: "Add its purchase price on the Ingredients sheet.",
          unit: (d) => `units that do not convert (${d})`,
          unitDo: "Write the quantity in the same unit as the price (kg, l or pcs).",
          noPrice: "the dish has no selling price",
          noPriceDo: "Add the menu price.",
        };
  const targetPct = Math.round(Number(data.target_food_cost ?? 30));
  // Ingredients sheet: rows from 2.
  const ingList = [...ingredients.values()];
  const ingLast = ingList.length + 1;
  const ingRef = `'${L.sheets[2]}'`;
  const ingSheet = {
    name: L.sheets[2],
    columns: [
      { header: L.ingCols[0], width: 28 },
      { header: L.ingCols[1], width: 8 },
      { header: L.ingCols[2], type: "money", width: 16 },
      { header: L.ingCols[3], type: "percent", width: 16 },
      { header: L.ingCols[4], type: "money", width: 16 },
      { header: L.ingCols[5], width: 24 },
    ],
    rows: ingList.map((ing, i) => [
      ing.name,
      ing.unit,
      ing.net === null ? { v: null, s: "bad" } : round2(ing.net * 10000) / 10000,
      ing.yieldShare,
      {
        f: `IF(D${i + 2}>0,C${i + 2}/D${i + 2},C${i + 2})`,
        v: ing.net === null ? 0 : ing.net / ing.yieldShare,
      },
      ing.supplier ?? "",
    ]),
  };
  // Recipe lines: rows from 2.
  const lineRows = [];
  for (const dish of dishes) {
    for (const line of dish.lines) {
      const r = lineRows.length + 2;
      lineRows.push([
        dish.name,
        line.ingredient,
        { v: Number(line.qty), t: "qty" },
        line.unit ?? "",
        line.qtyInUnit === null
          ? { v: null, s: "bad" }
          : { v: round2(line.qtyInUnit * 10000) / 10000, t: "qty" },
        line.ingredientUnit ?? "",
        line.cost === null
          ? { v: null, s: "bad", t: "money" }
          : {
              f: `IFERROR(E${r}*INDEX(${ingRef}!$E$2:$E$${ingLast},MATCH(B${r},${ingRef}!$A$2:$A$${ingLast},0)),0)`,
              v: round2(line.cost * 100) / 100,
            },
      ]);
    }
  }
  const lineLast = lineRows.length + 1;
  const lineRef = `'${L.sheets[1]}'`;
  const linesSheet = {
    name: L.sheets[1],
    columns: [
      { header: L.lineCols[0], width: 30 },
      { header: L.lineCols[1], width: 26 },
      { header: L.lineCols[2], type: "qty" },
      { header: L.lineCols[3], width: 7 },
      { header: L.lineCols[4], type: "qty", width: 16 },
      { header: L.lineCols[5], width: 10 },
      { header: L.lineCols[6], type: "money" },
    ],
    rows: lineRows,
  };
  // Cost sheets: title + subtitle -> header on row 4, data from 5; target in the subtitle and in M2.
  const first = 5;
  const dishRows = dishes.map((d, i) => {
    const r = first + i;
    const over = d.foodCost !== null && d.foodCost > d.target + 0.02;
    const under = d.foodCost !== null && d.foodCost <= d.target;
    const fcStyle =
      !d.complete || d.foodCost === null ? "bad" : over ? "check" : under ? "good" : undefined;
    return [
      d.name,
      d.category,
      d.portions,
      {
        f: `SUMIF(${lineRef}!$A$2:$A$${lineLast},A${r},${lineRef}!$G$2:$G$${lineLast})`,
        v: round2(d.batchCost),
      },
      { f: `D${r}/C${r}`, v: round2(d.portionCost) },
      d.priceWithVat === null ? { v: null, s: "bad", t: "money" } : round2(d.priceWithVat),
      d.vat / 100,
      { f: `IF(F${r}>0,F${r}/(1+G${r}),0)`, v: d.netPrice === null ? 0 : round2(d.netPrice) },
      {
        f: `IF(H${r}>0,E${r}/H${r},0)`,
        v: d.foodCost === null ? 0 : Math.round(d.foodCost * 1000) / 1000,
        ...(fcStyle ? { s: fcStyle } : {}),
      },
      d.target,
      { f: `H${r}-E${r}`, v: d.margin === null ? 0 : round2(d.margin) },
      {
        f: `IF(AND(E${r}>0,J${r}>0),IF(E${r}/J${r}*(1+G${r})<20,CEILING(E${r}/J${r}*(1+G${r}),0.5),CEILING(E${r}/J${r}*(1+G${r}),1)),0)`,
        v: d.suggested ?? 0,
      },
      d.driver ? `${d.driver.ingredient} (${Math.round(d.driver.share * 100)}%)` : "",
    ];
  });
  const costSheet = {
    name: L.sheets[0],
    title: data.title ?? L.title,
    subtitle: L.subtitle(targetPct),
    columns: [
      { header: L.dishCols[0], width: 30 },
      { header: L.dishCols[1], width: 14 },
      { header: L.dishCols[2], type: "qty", width: 10 },
      { header: L.dishCols[3], type: "money" },
      { header: L.dishCols[4], type: "money" },
      { header: L.dishCols[5], type: "money" },
      { header: L.dishCols[6], type: "percent", width: 8 },
      { header: L.dishCols[7], type: "money" },
      { header: L.dishCols[8], type: "percent" },
      { header: L.dishCols[12], type: "percent", width: 10 },
      { header: L.dishCols[9], type: "money" },
      { header: L.dishCols[10], type: "money", width: 14 },
      { header: L.dishCols[11], width: 30 },
    ],
    rows: dishRows,
  };
  const checkRows = [
    ...problems.map((p) =>
      p.why === "missing-price"
        ? [p.dish, p.ingredient, L.missing, L.missingDo]
        : [p.dish, p.ingredient, L.unit(p.detail), L.unitDo],
    ),
    ...dishes.filter((d) => d.netPrice === null).map((d) => [d.name, "", L.noPrice, L.noPriceDo]),
  ];
  const checkSheet = {
    name: L.sheets[3],
    columns: [
      { header: L.chkCols[0], width: 30 },
      { header: L.chkCols[1], width: 24 },
      { header: L.chkCols[2], type: "wrap", width: 44 },
      { header: L.chkCols[3], type: "wrap", width: 44 },
    ],
    rows: checkRows,
  };
  const bytes = writeXlsx({
    title: costSheet.title,
    sheets: [costSheet, linesSheet, ingSheet, checkSheet],
  });
  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(out)), { recursive: true });
  NodeFS.writeFileSync(out, bytes);
  const summary = {
    xlsx: NodePath.resolve(out),
    targetFoodCost: targetPct,
    dishes: dishes.map((d) => ({
      name: d.name,
      portionCost: round2(d.portionCost),
      priceWithVat: d.priceWithVat === null ? null : round2(d.priceWithVat),
      foodCostPct: d.foodCost === null ? null : Math.round(d.foodCost * 1000) / 10,
      marginPerPortion: d.margin === null ? null : round2(d.margin),
      suggestedPrice: d.suggested,
      costliest: d.driver ? `${d.driver.ingredient} ${Math.round(d.driver.share * 100)}%` : null,
      complete: d.complete,
    })),
    problems: checkRows.map((r) => ({ dish: r[0], ingredient: r[1], problem: r[2] })),
  };
  NodeFS.writeFileSync(
    out.replace(/\.xlsx$/i, "") + ".summary.json",
    JSON.stringify(summary, null, 1),
  );
  console.log(JSON.stringify(summary, null, 1));
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("foodcost.mjs")) main();
