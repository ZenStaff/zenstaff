// Supplier orders from stock: target = par, or daily use x (lead + cover days) + min; rounded up to packs.
//   node order.mjs --data order-input.json --out order.xlsx [--lang en]   (order-input.json: see SKILL.md)
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
const num = (v) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

export function orderLine(item, coverDays) {
  const stock = num(item.stock);
  const par = num(item.par);
  const daily = num(item.daily_use);
  const min = num(item.min) ?? 0;
  const lead = num(item.lead_days) ?? 1;
  const pack = num(item.pack) && num(item.pack) > 0 ? num(item.pack) : 1;
  const problems = [];
  if (stock === null) problems.push("no-stock");
  if (stock !== null && stock < 0) problems.push("negative-stock");
  let target = null;
  if (par !== null) target = par;
  else if (daily !== null) target = daily * (lead + coverDays) + min;
  else problems.push("no-usage");
  let qty = 0;
  if (target !== null && stock !== null) {
    const need = Math.max(0, target - Math.max(0, stock));
    qty = need > 0 ? Math.ceil(need / pack - 1e-9) * pack : 0;
  }
  const daysLeft = daily && stock !== null && daily > 0 ? Math.max(0, stock) / daily : null;
  if (daysLeft !== null && daysLeft < lead) problems.push("runs-out");
  const price = num(item.price);
  return {
    ...item,
    stock,
    par,
    daily,
    min,
    lead,
    pack,
    target,
    qty: round2(qty),
    value: price !== null ? round2(qty * price) : null,
    daysLeft,
    problems,
  };
}

function main() {
  const lang = opt("lang", "ro") === "en" ? "en" : "ro";
  const dataFile = opt("data");
  const out = opt("out");
  if (!dataFile || !out) fail("Use --data order-input.json --out order.xlsx [--lang ro|en].");
  let data;
  try {
    data = JSON.parse(NodeFS.readFileSync(dataFile, "utf8"));
  } catch (error) {
    fail(`${dataFile} could not be read: ${error.message}`);
  }
  if (!Array.isArray(data.items) || data.items.length === 0)
    fail('order-input.json needs "items": [...]');
  const cover = num(data.cover_days) ?? 3;
  const lines = data.items.map((item) => orderLine(item, cover));
  const L =
    lang === "ro"
      ? {
          all: "Toate",
          check: "De verificat",
          cols: [
            "Produs",
            "U.M.",
            "Stoc acum",
            "Consum pe zi",
            "Stoc țintă",
            "Ambalaj",
            "De comandat",
            "Preț",
            "Valoare",
            "Ajunge (zile)",
            "Observații",
          ],
          supplier: "Furnizor",
          total: "TOTAL",
          none: "(fără furnizor)",
          title: (d) => `Comandă la furnizori${d ? ` pentru ${d}` : ""}`,
          subtitle: (c) =>
            `Stocul țintă acoperă ${c} zile după livrare, plus stocul minim. Cantitățile sunt rotunjite la ambalajul furnizorului. Galben = de verificat.`,
          why: {
            "no-stock": "lipsește stocul",
            "negative-stock": "stoc negativ (inventar de corectat)",
            "no-usage": "nu știm consumul sau stocul țintă",
            "runs-out": "se termină înainte de livrare",
          },
          todo: {
            "no-stock": "Numără produsul și trece stocul.",
            "negative-stock": "Corectează stocul după o numărătoare.",
            "no-usage": "Trece consumul pe zi sau stocul țintă.",
            "runs-out": "Comandă azi sau cumpără din altă parte până vine livrarea.",
          },
          minOrder: (s, v, m) => `comanda de ${v} lei e sub minimul de ${m} lei`,
          minDo: "Adaugă produse care oricum se termină curând sau unește cu comanda următoare.",
          chkCols: ["Produs / furnizor", "Ce am observat", "Ce faci"],
        }
      : {
          all: "All",
          check: "To check",
          cols: [
            "Item",
            "Unit",
            "Stock now",
            "Daily use",
            "Target stock",
            "Pack",
            "To order",
            "Price",
            "Value",
            "Lasts (days)",
            "Notes",
          ],
          supplier: "Supplier",
          total: "TOTAL",
          none: "(no supplier)",
          title: (d) => `Supplier order${d ? ` for ${d}` : ""}`,
          subtitle: (c) =>
            `Target stock covers ${c} days after delivery plus the minimum stock. Quantities are rounded up to the supplier's pack. Yellow = check.`,
          why: {
            "no-stock": "stock missing",
            "negative-stock": "negative stock (inventory to correct)",
            "no-usage": "daily use or target stock unknown",
            "runs-out": "runs out before the delivery",
          },
          todo: {
            "no-stock": "Count the item and enter the stock.",
            "negative-stock": "Correct the stock after a count.",
            "no-usage": "Enter the daily use or a target stock.",
            "runs-out": "Order today or buy elsewhere until the delivery arrives.",
          },
          minOrder: (s, v, m) => `the order of ${v} is below the minimum of ${m}`,
          minDo: "Add items that will run out soon anyway, or join it with the next order.",
          chkCols: ["Item / supplier", "What we noticed", "What to do"],
        };
  const columns = [
    { header: L.cols[0], width: 28 },
    { header: L.cols[1], width: 7 },
    { header: L.cols[2], type: "qty" },
    { header: L.cols[3], type: "qty" },
    { header: L.cols[4], type: "qty" },
    { header: L.cols[5], type: "qty", width: 9 },
    { header: L.cols[6], type: "qty" },
    { header: L.cols[7], type: "money", width: 10 },
    { header: L.cols[8], type: "money" },
    { header: L.cols[9], type: "qty", width: 10 },
    { header: L.cols[10], type: "wrap", width: 36 },
  ];
  const row = (l, r) => {
    const flagged = l.problems.length > 0;
    const mark = (v, t) => (flagged ? { v, s: "check", ...(t ? { t } : {}) } : v);
    return [
      l.name,
      l.unit ?? "",
      mark(l.stock),
      l.daily,
      l.target === null ? null : round2(l.target),
      l.pack,
      l.qty > 0 ? { v: l.qty, s: "good" } : 0,
      l.price ?? null,
      { f: `IF(H${r}="",0,G${r}*H${r})`, v: l.value ?? 0 },
      l.daysLeft === null ? null : Math.round(l.daysLeft * 10) / 10,
      l.problems.map((p) => L.why[p]).join("; "),
    ];
  };
  const suppliers = new Map();
  for (const l of lines) {
    const key = l.supplier || L.none;
    suppliers.set(key, [...(suppliers.get(key) ?? []), l]);
  }
  const sheets = [];
  const allRows = lines.map((l, i) => row(l, i + 5));
  sheets.push({
    name: L.all,
    title: L.title(data.delivery_date),
    subtitle: L.subtitle(cover),
    columns: [...columns, { header: L.supplier, width: 24 }],
    rows: [
      ...allRows.map((r, i) => [...r, lines[i].supplier || L.none]),
      {
        style: "total",
        cells: [
          L.total,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          {
            f: `SUM(I5:I${lines.length + 4})`,
            v: round2(lines.reduce((a, l) => a + (l.value ?? 0), 0)),
          },
          null,
          null,
          null,
        ],
      },
    ],
    filterExcludesLast: 1,
  });
  const checks = [];
  const perSupplier = [];
  for (const [name, list] of suppliers) {
    const ordered = list.filter((l) => l.qty > 0);
    const value = round2(ordered.reduce((a, l) => a + (l.value ?? 0), 0));
    const info = (data.suppliers ?? []).find((s) => s.name === name) ?? {};
    if (num(info.min_order) && value > 0 && value < num(info.min_order))
      checks.push([name, L.minOrder(name, value, info.min_order), L.minDo]);
    perSupplier.push({
      supplier: name,
      contact: info.contact ?? null,
      deliveryDays: info.delivery_days ?? null,
      value,
      items: ordered.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, pack: l.pack })),
    });
    if (ordered.length === 0) continue;
    sheets.push({
      name: name.slice(0, 31),
      title: `${name}${info.delivery_days ? ` (${info.delivery_days})` : ""}`,
      columns,
      rows: [
        ...ordered.map((l, i) => row(l, i + 4)),
        {
          style: "total",
          cells: [
            L.total,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            { f: `SUM(I4:I${ordered.length + 3})`, v: value },
            null,
            null,
          ],
        },
      ],
      filterExcludesLast: 1,
    });
  }
  for (const l of lines) for (const p of l.problems) checks.push([l.name, L.why[p], L.todo[p]]);
  sheets.push({
    name: L.check,
    columns: [
      { header: L.chkCols[0], width: 28 },
      { header: L.chkCols[1], type: "wrap", width: 50 },
      { header: L.chkCols[2], type: "wrap", width: 50 },
    ],
    rows: checks,
  });
  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(out)), { recursive: true });
  NodeFS.writeFileSync(out, writeXlsx({ title: L.title(data.delivery_date), sheets }));
  const summary = {
    xlsx: NodePath.resolve(out),
    coverDays: cover,
    suppliers: perSupplier,
    toCheck: checks.map((c) => `${c[0]}: ${c[1]}`),
  };
  NodeFS.writeFileSync(
    out.replace(/\.xlsx$/i, "") + ".summary.json",
    JSON.stringify(summary, null, 1),
  );
  console.log(JSON.stringify(summary, null, 1));
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("order.mjs")) main();
