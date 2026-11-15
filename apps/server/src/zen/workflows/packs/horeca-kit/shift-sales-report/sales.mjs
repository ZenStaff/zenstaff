// Sales per day and shift from a POS export (CSV or XLSX, one row per sold line or per receipt).
//   node sales.mjs --in <file or folder> --out file.xlsx [--shifts "Lunch=10:00-15:00,..."] [--map map.json] [--lang en]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseDate, parseNumber, readTable, round2, writeXlsx } from "./tables.mjs";

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

const HEADERS = {
  datetime: [
    "data si ora",
    "data ora",
    "datetime",
    "closed at",
    "data inchidere",
    "data bon",
    "data",
    "date",
    "zi",
  ],
  time: ["ora", "time", "ora bon", "hour"],
  product: ["produs", "articol", "denumire", "denumire produs", "item", "product", "nume produs"],
  qty: ["cantitate", "cant", "cant.", "qty", "quantity", "buc"],
  value: [
    "valoare",
    "valoare totala",
    "total",
    "suma",
    "value",
    "amount",
    "valoare cu tva",
    "total cu tva",
    "vanzari",
  ],
  category: ["categorie", "grupa", "categoria", "category", "familie", "departament"],
  payment: ["metoda plata", "tip plata", "plata", "payment", "mod plata", "incasare"],
  staff: [
    "ospatar",
    "operator",
    "angajat",
    "casier",
    "user",
    "utilizator",
    "waiter",
    "staff",
    "vanzator",
  ],
  receipt: [
    "nr bon",
    "bon",
    "nr. bon",
    "numar bon",
    "comanda",
    "nr comanda",
    "order",
    "receipt",
    "id bon",
    "nota",
  ],
  discount: ["discount", "reducere", "reduceri"],
  status: ["stare", "status", "storno", "anulat"],
  table: ["masa", "table"],
};

export function detectColumns(rows, map) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 30).forEach((row, index) => {
    const cells = row.map((c) => fold(c));
    let score = 0;
    for (const words of Object.values(HEADERS)) if (cells.some((c) => words.includes(c))) score++;
    if (score > best.score) best = { index, score };
  });
  if (best.index < 0 || best.score < 2) return null;
  const header = rows[best.index].map((c) => fold(c));
  const used = new Set();
  const cols = {};
  for (const key of Object.keys(HEADERS)) {
    let i = -1;
    if (map?.[key]) i = header.indexOf(fold(map[key]));
    else
      for (const word of HEADERS[key]) {
        const at = header.findIndex((c, idx) => c === word && !used.has(idx));
        if (at >= 0) {
          i = at;
          break;
        }
      }
    if (i >= 0) used.add(i);
    cols[key] = i;
  }
  if (cols.datetime < 0 || cols.value < 0) return null;
  return { headerRow: best.index, header: rows[best.index], cols };
}

/** "Dimineață=07:00-15:00,Seară=15:00-23:30" -> shifts; a shift may cross midnight. */
export function parseShifts(text) {
  if (!text) return [];
  return text
    .split(",")
    .map((part) => {
      const m = /^\s*([^=]+)=\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(part);
      if (!m) return null;
      return {
        name: m[1].trim(),
        start: Number(m[2]) * 60 + Number(m[3] ?? 0),
        end: Number(m[4]) * 60 + Number(m[5] ?? 0),
      };
    })
    .filter(Boolean);
}

/** The business day and shift of a sale: sales after midnight inside a late shift belong to the day before. */
export function shiftOf(date, minutes, shifts) {
  for (const s of shifts) {
    const inside =
      s.start <= s.end
        ? minutes >= s.start && minutes < s.end
        : minutes >= s.start || minutes < s.end;
    if (inside) {
      if (s.start > s.end && minutes < s.end) {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return { shift: s.name, day: d.toISOString().slice(0, 10) };
      }
      return { shift: s.name, day: date };
    }
  }
  return { shift: null, day: date };
}

function timeOf(value) {
  if (typeof value === "number" && value < 1) return Math.round(value * 1440);
  if (typeof value === "number" && value > 20000) return Math.round((value % 1) * 1440);
  const m = /(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const WEEKDAYS = {
  ro: ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

function main() {
  const lang = opt("lang", "ro") === "en" ? "en" : "ro";
  const input = opt("in");
  const out = opt("out");
  if (!input || !out)
    fail('Use --in <export> --out <file.xlsx> [--shifts "Name=07:00-15:00,..."] [--map map.json].');
  if (!NodeFS.existsSync(input)) fail(`${input} does not exist.`);
  const files = NodeFS.statSync(input).isDirectory()
    ? NodeFS.readdirSync(input)
        .filter((f) => /\.(csv|txt|xlsx)$/i.test(f))
        .map((f) => NodePath.join(input, f))
    : [input];
  const map = opt("map") ? JSON.parse(NodeFS.readFileSync(opt("map"), "utf8")) : null;
  const shifts = parseShifts(opt("shifts"));
  const lines = [];
  const sources = [];
  for (const file of files) {
    for (const sheet of readTable(file).sheets) {
      const found = detectColumns(sheet.rows, map);
      if (!found) {
        sources.push({
          file: NodePath.basename(file),
          sheet: sheet.name,
          problem: "columns not recognised",
        });
        continue;
      }
      const { cols, headerRow, header } = found;
      let count = 0;
      for (const row of sheet.rows.slice(headerRow + 1)) {
        const raw = row[cols.datetime];
        const date = parseDate(raw);
        const value = parseNumber(row[cols.value]);
        if (!date || value === null) continue;
        const minutes = cols.time >= 0 ? timeOf(row[cols.time]) : timeOf(raw);
        const status = cols.status >= 0 ? fold(row[cols.status]) : "";
        const voided =
          /storn|anulat|void|cancel|sters|retur/.test(status) ||
          (status === "da" && fold(header[cols.status]).includes("storno"));
        const where =
          minutes === null ? { shift: null, day: date } : shiftOf(date, minutes, shifts);
        lines.push({
          day: where.day,
          shift: where.shift,
          hour: minutes === null ? null : Math.floor(minutes / 60),
          product: cols.product >= 0 ? String(row[cols.product] ?? "").trim() : null,
          qty: cols.qty >= 0 ? (parseNumber(row[cols.qty]) ?? 1) : 1,
          value,
          category: cols.category >= 0 ? String(row[cols.category] ?? "").trim() || null : null,
          payment: cols.payment >= 0 ? String(row[cols.payment] ?? "").trim() || null : null,
          staff: cols.staff >= 0 ? String(row[cols.staff] ?? "").trim() || null : null,
          receipt: cols.receipt >= 0 ? String(row[cols.receipt] ?? "").trim() || null : null,
          discount: cols.discount >= 0 ? Math.abs(parseNumber(row[cols.discount]) ?? 0) : 0,
          voided: voided || value < 0,
        });
        count++;
      }
      sources.push({
        file: NodePath.basename(file),
        sheet: sheet.name,
        rows: count,
        columns: Object.fromEntries(
          Object.entries(cols)
            .filter(([, i]) => i >= 0)
            .map(([k, i]) => [k, header[i]]),
        ),
      });
    }
  }
  if (lines.length === 0)
    fail(
      `No sales rows found. Files read: ${JSON.stringify(sources)}. Write a map.json with the column names and run again with --map.`,
    );

  const L =
    lang === "ro"
      ? {
          sheets: [
            "Pe zile",
            "Pe ture",
            "Pe ore",
            "Produse",
            "Categorii",
            "Plăți",
            "Personal",
            "De verificat",
          ],
          day: "Ziua",
          weekday: "Zi a săptămânii",
          shift: "Tura",
          hour: "Ora",
          sales: "Vânzări",
          receipts: "Bonuri",
          avg: "Bon mediu",
          items: "Produse vândute",
          product: "Produs",
          qty: "Cantitate",
          share: "% din vânzări",
          category: "Categorie",
          payment: "Metoda de plată",
          staff: "Angajat",
          discounts: "Reduceri",
          voids: "Storno / anulări",
          what: "Ce am observat",
          todo: "Ce faci",
          total: "TOTAL",
          none: "(nespecificat)",
          title: "Raport de vânzări",
          subtitle: (a, b, n) =>
            `${a} – ${b}. ${n} linii din casa de marcat / POS. Sumele sunt cum apar în export.`,
          voidHigh: (s, v, p) => `${s}: storno/anulări de ${v} (${p}% din vânzările lui)`,
          voidDo: "Discută anulările cu angajatul; cere motivul pentru fiecare.",
          discHigh: (s, v, p) => `${s}: reduceri de ${v} (${p}% din vânzări)`,
          discDo: "Verifică dacă reducerile au fost aprobate.",
          weakDay: (d, p) => `${d}: vânzări cu ${p}% sub o zi obișnuită de același fel`,
          weakDo: "Caută cauza: vreme, eveniment, personal, stoc lipsă.",
          strongDay: (d, p) => `${d}: vânzări cu ${p}% peste o zi obișnuită de același fel`,
          strongDo: "Notează ce a mers, ca să repeți.",
          noShift: "vânzări în afara turelor date",
          noShiftDo: "Verifică orele turelor sau ceasul casei.",
        }
      : {
          sheets: [
            "By day",
            "By shift",
            "By hour",
            "Products",
            "Categories",
            "Payments",
            "Staff",
            "To check",
          ],
          day: "Day",
          weekday: "Weekday",
          shift: "Shift",
          hour: "Hour",
          sales: "Sales",
          receipts: "Receipts",
          avg: "Average receipt",
          items: "Items sold",
          product: "Product",
          qty: "Quantity",
          share: "% of sales",
          category: "Category",
          payment: "Payment method",
          staff: "Staff member",
          discounts: "Discounts",
          voids: "Voids / cancellations",
          what: "What we noticed",
          todo: "What to do",
          total: "TOTAL",
          none: "(not given)",
          title: "Sales report",
          subtitle: (a, b, n) =>
            `${a} – ${b}. ${n} lines from the till / POS. Amounts as in the export.`,
          voidHigh: (s, v, p) => `${s}: voids of ${v} (${p}% of their sales)`,
          voidDo: "Go through the voids with them; ask the reason for each.",
          discHigh: (s, v, p) => `${s}: discounts of ${v} (${p}% of sales)`,
          discDo: "Check the discounts were approved.",
          weakDay: (d, p) => `${d}: sales ${p}% below a usual day of the same kind`,
          weakDo: "Look for the cause: weather, event, staff, missing stock.",
          strongDay: (d, p) => `${d}: sales ${p}% above a usual day of the same kind`,
          strongDo: "Note what worked so you can repeat it.",
          noShift: "sales outside the given shifts",
          noShiftDo: "Check the shift hours or the till clock.",
        };
  const sold = lines.filter((l) => !l.voided);
  const voids = lines.filter((l) => l.voided);
  const hasReceipts = sold.some((l) => l.receipt);
  const group = (list, key) => {
    const m = new Map();
    for (const l of list) {
      const k = key(l) ?? L.none;
      const g = m.get(k) ?? {
        key: k,
        sales: 0,
        qty: 0,
        receipts: new Set(),
        discount: 0,
        lines: 0,
      };
      g.sales += l.value;
      g.qty += l.qty ?? 0;
      g.discount += l.discount ?? 0;
      g.lines++;
      if (l.receipt) g.receipts.add(`${l.day}|${l.receipt}`);
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({
      ...g,
      sales: round2(g.sales),
      receiptCount: hasReceipts ? g.receipts.size : g.lines,
    }));
  };
  const total = round2(sold.reduce((a, l) => a + l.value, 0));
  const days = group(sold, (l) => l.day).sort((a, b) => a.key.localeCompare(b.key));
  const wd = (iso) => WEEKDAYS[lang][new Date(`${iso}T12:00:00Z`).getUTCDay()];
  const flags = [];
  // A day far from the usual: compared with the same weekday when there are 3 others, otherwise
  // with the other weekdays (Mon-Thu) or weekend days (Fri-Sun); the median keeps one odd day from
  // moving the bar.
  const weekendDay = (iso) => [0, 5, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
  const median = (values) => {
    const s = [...values].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  for (const d of days) {
    const sameDay = days.filter((o) => o !== d && wd(o.key) === wd(d.key));
    const same =
      sameDay.length >= 3
        ? sameDay
        : days.filter((o) => o !== d && weekendDay(o.key) === weekendDay(d.key));
    if (same.length < 2) continue;
    const usual = median(same.map((o) => o.sales));
    const change = usual ? (d.sales - usual) / usual : 0;
    if (change <= -0.25)
      flags.push([
        `${d.key} (${wd(d.key)})`,
        L.weakDay(d.key, Math.round(-change * 100)),
        L.weakDo,
      ]);
    if (change >= 0.3)
      flags.push([
        `${d.key} (${wd(d.key)})`,
        L.strongDay(d.key, Math.round(change * 100)),
        L.strongDo,
      ]);
  }
  const staff = group(sold, (l) => l.staff).sort((a, b) => b.sales - a.sales);
  const staffVoids = group(voids, (l) => l.staff);
  for (const s of staff) {
    const v = Math.abs(staffVoids.find((x) => x.key === s.key)?.sales ?? 0);
    if (s.sales > 0 && v / s.sales > 0.03 && v > 50)
      flags.push([s.key, L.voidHigh(s.key, round2(v), Math.round((v / s.sales) * 100)), L.voidDo]);
    if (s.sales > 0 && s.discount / s.sales > 0.08)
      flags.push([
        s.key,
        L.discHigh(s.key, round2(s.discount), Math.round((s.discount / s.sales) * 100)),
        L.discDo,
      ]);
  }
  if (shifts.length && sold.some((l) => l.hour !== null && l.shift === null))
    flags.push(["", L.noShift, L.noShiftDo]);

  const money = { type: "money" };
  const daySheet = {
    name: L.sheets[0],
    title: L.title,
    subtitle: L.subtitle(days[0]?.key, days.at(-1)?.key, lines.length),
    columns: [
      { header: L.day, type: "date" },
      { header: L.weekday, width: 14 },
      { header: L.sales, ...money },
      { header: L.receipts, type: "int" },
      { header: L.avg, ...money },
      { header: L.items, type: "qty" },
    ],
    rows: [
      ...days.map((d, i) => [
        d.key,
        wd(d.key),
        d.sales,
        d.receiptCount,
        {
          f: `IF(D${i + 5}>0,C${i + 5}/D${i + 5},0)`,
          v: d.receiptCount ? round2(d.sales / d.receiptCount) : 0,
        },
        d.qty,
      ]),
      {
        style: "total",
        cells: [
          L.total,
          null,
          { f: `SUM(C5:C${days.length + 4})`, v: total },
          { f: `SUM(D5:D${days.length + 4})`, v: days.reduce((a, d) => a + d.receiptCount, 0) },
          {
            f: `IF(D${days.length + 5}>0,C${days.length + 5}/D${days.length + 5},0)`,
            v: days.reduce((a, d) => a + d.receiptCount, 0)
              ? round2(total / days.reduce((a, d) => a + d.receiptCount, 0))
              : 0,
          },
          { f: `SUM(F5:F${days.length + 4})`, v: days.reduce((a, d) => a + d.qty, 0) },
        ],
      },
    ],
    filterExcludesLast: 1,
  };
  const dayShift = [];
  for (const d of days)
    for (const s of group(
      sold.filter((l) => l.day === d.key),
      (l) => l.shift,
    ))
      dayShift.push({ day: d.key, ...s });
  const shiftSheet = {
    name: L.sheets[1],
    columns: [
      { header: L.day, type: "date" },
      { header: L.shift, width: 16 },
      { header: L.sales, ...money },
      { header: L.receipts, type: "int" },
      { header: L.avg, ...money },
    ],
    rows: dayShift.map((s, i) => [
      s.day,
      s.key,
      s.sales,
      s.receiptCount,
      {
        f: `IF(D${i + 2}>0,C${i + 2}/D${i + 2},0)`,
        v: s.receiptCount ? round2(s.sales / s.receiptCount) : 0,
      },
    ]),
  };
  const hours = group(
    sold.filter((l) => l.hour !== null),
    (l) => String(l.hour).padStart(2, "0") + ":00",
  ).sort((a, b) => a.key.localeCompare(b.key));
  const hourSheet = {
    name: L.sheets[2],
    columns: [
      { header: L.hour, width: 8 },
      { header: L.sales, ...money },
      { header: L.receipts, type: "int" },
      { header: L.share, type: "percent" },
    ],
    rows: hours.map((h) => [
      h.key,
      h.sales,
      h.receiptCount,
      total ? Math.round((h.sales / total) * 1000) / 1000 : 0,
    ]),
  };
  const products = sold.some((l) => l.product)
    ? group(sold, (l) => l.product).sort((a, b) => b.sales - a.sales)
    : [];
  const productSheet = {
    name: L.sheets[3],
    columns: [
      { header: L.product, width: 32 },
      { header: L.qty, type: "qty" },
      { header: L.sales, ...money },
      { header: L.share, type: "percent" },
    ],
    rows: products.map((p) => [
      p.key,
      p.qty,
      p.sales,
      total ? Math.round((p.sales / total) * 1000) / 1000 : 0,
    ]),
  };
  const categories = sold.some((l) => l.category)
    ? group(sold, (l) => l.category).sort((a, b) => b.sales - a.sales)
    : [];
  const catSheet = {
    name: L.sheets[4],
    columns: [
      { header: L.category, width: 24 },
      { header: L.qty, type: "qty" },
      { header: L.sales, ...money },
      { header: L.share, type: "percent" },
    ],
    rows: categories.map((c) => [
      c.key,
      c.qty,
      c.sales,
      total ? Math.round((c.sales / total) * 1000) / 1000 : 0,
    ]),
  };
  const payments = sold.some((l) => l.payment)
    ? group(sold, (l) => l.payment).sort((a, b) => b.sales - a.sales)
    : [];
  const paySheet = {
    name: L.sheets[5],
    columns: [
      { header: L.payment, width: 20 },
      { header: L.sales, ...money },
      { header: L.receipts, type: "int" },
      { header: L.share, type: "percent" },
    ],
    rows: payments.map((p) => [
      p.key,
      p.sales,
      p.receiptCount,
      total ? Math.round((p.sales / total) * 1000) / 1000 : 0,
    ]),
  };
  const staffSheet = {
    name: L.sheets[6],
    columns: [
      { header: L.staff, width: 22 },
      { header: L.sales, ...money },
      { header: L.receipts, type: "int" },
      { header: L.avg, ...money },
      { header: L.discounts, ...money },
      { header: L.voids, ...money },
    ],
    rows: staff.map((s) => [
      s.key,
      s.sales,
      s.receiptCount,
      s.receiptCount ? round2(s.sales / s.receiptCount) : 0,
      round2(s.discount),
      round2(Math.abs(staffVoids.find((x) => x.key === s.key)?.sales ?? 0)),
    ]),
  };
  const checkSheet = {
    name: L.sheets[7],
    columns: [
      { header: "", width: 24 },
      { header: L.what, type: "wrap", width: 60 },
      { header: L.todo, type: "wrap", width: 50 },
    ],
    rows: flags,
  };
  const sheets = [
    daySheet,
    shiftSheet,
    hourSheet,
    productSheet,
    catSheet,
    paySheet,
    staffSheet,
    checkSheet,
  ].filter((s, i) => i === 0 || i === 7 || s.rows.length > 0);
  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(out)), { recursive: true });
  NodeFS.writeFileSync(out, writeXlsx({ title: L.title, sheets }));
  const receipts = days.reduce((a, d) => a + d.receiptCount, 0);
  const summary = {
    xlsx: NodePath.resolve(out),
    sources,
    period: { from: days[0]?.key, to: days.at(-1)?.key, days: days.length },
    sales: total,
    receipts: hasReceipts ? receipts : null,
    averageReceipt: hasReceipts && receipts ? round2(total / receipts) : null,
    voids: round2(Math.abs(voids.reduce((a, l) => a + l.value, 0))),
    discounts: round2(sold.reduce((a, l) => a + (l.discount ?? 0), 0)),
    byDay: days.map((d) => ({
      day: d.key,
      weekday: wd(d.key),
      sales: d.sales,
      receipts: d.receiptCount,
    })),
    byShift: dayShift.map((s) => ({
      day: s.day,
      shift: s.key,
      sales: s.sales,
      receipts: s.receiptCount,
    })),
    busiestHours: [...hours]
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 4)
      .map((h) => ({ hour: h.key, sales: h.sales })),
    topProducts: products.slice(0, 10).map((p) => ({ product: p.key, qty: p.qty, sales: p.sales })),
    slowProducts: products
      .slice(-8)
      .reverse()
      .map((p) => ({ product: p.key, qty: p.qty, sales: p.sales })),
    categories: categories.map((c) => ({ category: c.key, sales: c.sales })),
    payments: payments.map((p) => ({ payment: p.key, sales: p.sales })),
    staff: staff.map((s) => ({ staff: s.key, sales: s.sales, receipts: s.receiptCount })),
    attention: flags.map((f) => f[1]),
  };
  NodeFS.writeFileSync(
    out.replace(/\.xlsx$/i, "") + ".summary.json",
    JSON.stringify(summary, null, 1),
  );
  console.log(JSON.stringify(summary, null, 1));
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("sales.mjs")) main();
