// Monthly expenses from bank statement exports (CSV or XLSX), with categories and flags.
//   node expenses.mjs --in <file or folder> --out file.xlsx [--month YYYY-MM] [--rules rules.json] [--map map.json] [--lang en]
// rules.json and map.json are described in SKILL.md; the first matching rule wins over the built-in ones.
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
    .toLowerCase();

const HEADERS = {
  date: [
    "data tranzactie",
    "data tranzactiei",
    "data operatiunii",
    "data operatiei",
    "started date",
    "completed date",
    "transaction date",
    "booking date",
    "data inregistrare",
    "data",
    "date",
  ],
  description: [
    "descriere",
    "detalii tranzactie",
    "detalii",
    "description",
    "details",
    "explicatie",
    "explicatii",
    "tranzactie",
    "beneficiar",
    "merchant",
    "payee",
    "narrative",
    "concept",
  ],
  amount: ["suma", "amount", "valoare", "value", "sum"],
  debit: ["debit", "plati", "iesiri", "withdrawals", "money out", "paid out"],
  credit: ["credit", "incasari", "intrari", "deposits", "money in", "paid in"],
  currency: ["moneda", "currency", "valuta"],
  balance: ["sold", "balance", "sold final"],
  state: ["state", "stare", "status"],
};

/** Finds the header row and which column is which. */
export function detectColumns(rows, map) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 40).forEach((row, index) => {
    const cells = row.map((c) => fold(c).trim());
    let score = 0;
    for (const words of Object.values(HEADERS))
      if (cells.some((c) => words.includes(c) || words.some((w) => c.startsWith(w)))) score++;
    if (score > best.score) best = { index, score };
  });
  if (best.index < 0 || best.score < 2) return null;
  const header = rows[best.index].map((c) => fold(c).trim());
  const find = (key) => {
    if (map?.[key]) {
      const i = header.indexOf(fold(map[key]).trim());
      return i >= 0 ? i : -1;
    }
    const words = HEADERS[key];
    for (const word of words) {
      const exact = header.indexOf(word);
      if (exact >= 0) return exact;
    }
    for (const word of words) {
      const i = header.findIndex(
        (c) => c.startsWith(word) && !(key === "date" && c.includes("valut")),
      );
      if (i >= 0) return i;
    }
    return -1;
  };
  const cols = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, find(k)]));
  if (cols.date < 0 || cols.description < 0 || (cols.amount < 0 && cols.debit < 0)) return null;
  return { headerRow: best.index, header: rows[best.index], cols };
}

const NOISE = [
  /\b(plata|cumparare|tranzactie|tranzactii|achizitie)\s+(la\s+)?(pos|comerciant|card|online)\b/g,
  /\b(pos|epos|e-commerce|ecommerce|contactless|card nr\.?|card)\b/g,
  /\b\d{4}\*+\d{2,4}\b|\b\d{6}\*{4,}\d{4}\b|\*{2,}\d+/g,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  /\b(ref|referinta|ref\.|auth|autorizare|id|tid|mid|rrn)[:.\s]*[a-z0-9]+\b/g,
  /\b(ron|eur|usd|lei)\b/g,
  /\b\d{5,}\b/g,
  /[|;:#*]/g,
  /\b(plata|plati|op|ordin de plata|online|factura|fact|fc|nr|cumparare|servicii|sc|srl|sa|catre|din|pentru|luna|the)\b/g,
];
/** A short, stable name for whoever got paid, from the bank's description. */
export function merchantOf(description) {
  let text = fold(description);
  for (const pattern of NOISE) text = text.replace(pattern, " ");
  const words = text
    .replace(/[^a-z0-9.&' -]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^\d+([.,]\d+)?$/.test(w));
  return words.slice(0, 3).join(" ").toUpperCase() || "(fără nume)";
}

const BUILTIN_RULES = [
  [
    "Taxe și impozite",
    [
      "anaf",
      "trezorerie",
      "trezoreria",
      "buget de stat",
      "impozit",
      "ghiseul",
      "cass ",
      "cas ",
      "contributii",
    ],
  ],
  [
    "Salarii și colaboratori",
    ["salariu", "salarii", "salar ", "payroll", "drepturi salariale", "avans salarial"],
  ],
  ["Chirie", ["chirie", "rent ", "inchiriere"]],
  [
    "Utilități și telecom",
    [
      "enel",
      "engie",
      "electrica",
      "e.on",
      "eon energie",
      "hidroelectrica",
      "ppc ",
      "apa nova",
      "compania de apa",
      "aquatim",
      "digi",
      "rcs",
      "orange",
      "vodafone",
      "telekom",
      "gaz",
      "salubr",
      "energie",
    ],
  ],
  [
    "Combustibil și auto",
    [
      "petrom",
      "omv",
      "mol ",
      "rompetrol",
      "lukoil",
      "socar",
      "gazprom",
      "benzin",
      "motorina",
      "itp",
      "service auto",
      "vulcaniz",
      "rovinieta",
      "parcare",
      "parking",
    ],
  ],
  [
    "Marfă și consumabile",
    [
      "metro",
      "selgros",
      "kaufland",
      "lidl",
      "carrefour",
      "mega image",
      "profi",
      "auchan",
      "penny",
      "cora",
      "dedeman",
      "hornbach",
      "leroy",
      "ikea",
      "jysk",
    ],
  ],
  [
    "Software și abonamente",
    [
      "google",
      "microsoft",
      "adobe",
      "canva",
      "zoom",
      "slack",
      "dropbox",
      "apple.com",
      "notion",
      "openai",
      "anthropic",
      "claude.ai",
      "chatgpt",
      "github",
      "shopify",
      "wix",
      "hostinger",
      "godaddy",
      "rotld",
      "smartbill",
      "oblio",
      "saga",
      "netflix",
      "spotify",
      "atlassian",
      "figma",
      "mailchimp",
      "brevo",
    ],
  ],
  [
    "Marketing și publicitate",
    [
      "facebk",
      "facebook",
      "meta platforms",
      "google ads",
      "tiktok",
      "linkedin",
      "olx",
      "publi24",
      "tipografie",
    ],
  ],
  [
    "Curierat și livrare",
    ["fan courier", "fancourier", "sameday", "dpd", "cargus", "gls", "posta romana", "dhl", "ups"],
  ],
  [
    "Transport și deplasări",
    [
      "uber",
      "bolt",
      "taxi",
      "cfr",
      "wizz",
      "tarom",
      "ryanair",
      "booking.com",
      "airbnb",
      "hotel",
      "autogara",
    ],
  ],
  [
    "Mese și protocol",
    [
      "restaurant",
      "glovo",
      "tazz",
      "wolt",
      "bolt food",
      "mcdonald",
      "kfc",
      "starbucks",
      "cafe",
      "cafenea",
      "pizza",
      "bistro",
    ],
  ],
  [
    "Echipamente și IT",
    ["emag", "altex", "flanco", "media galaxy", "pc garage", "cel.ro", "evomag"],
  ],
  [
    "Comisioane bancare",
    ["comision", "taxa administrare", "taxa lunara", "abonament cont", "dobanda", "fee "],
  ],
  ["Retrageri numerar", ["atm", "retragere numerar", "retragere de numerar", "cash withdrawal"]],
  ["Asigurări", ["asigur", "allianz", "groupama", "omniasig", "generali", "euroins", "rca"]],
  [
    "Contabilitate și servicii",
    ["contabil", "expertiza", "consultanta", "avocat", "notar", "onrc", "registrul comertului"],
  ],
];

const RECURRING = new Set([
  "Software și abonamente",
  "Utilități și telecom",
  "Asigurări",
  "Chirie",
  "Marketing și publicitate",
  "Contabilitate și servicii",
]);

export function categorize(description, merchant, rules) {
  const text = ` ${fold(description)} ${fold(merchant)} `;
  for (const rule of rules) {
    if (rule.match && text.includes(fold(rule.match)))
      return rule.ignore ? { ignore: true } : { category: rule.category };
  }
  for (const [category, words] of BUILTIN_RULES)
    if (words.some((w) => text.includes(w))) return { category };
  if (/\b(plata op|ordin de plata|op catre|transfer catre)\b/.test(text))
    return { category: "Plăți către furnizori" };
  return { category: null };
}

function loadTransactions(files, map) {
  const transactions = [];
  const sources = [];
  for (const file of files) {
    const table = readTable(file);
    for (const sheet of table.sheets) {
      const found = detectColumns(sheet.rows, map);
      if (!found) {
        sources.push({
          file: NodePath.basename(file),
          sheet: sheet.name,
          rows: 0,
          problem: "columns not recognised",
        });
        continue;
      }
      const { cols, headerRow } = found;
      let count = 0;
      let last = null;
      for (const row of sheet.rows.slice(headerRow + 1)) {
        const date = parseDate(row[cols.date]);
        const description = String(row[cols.description] ?? "").trim();
        if (!date) {
          // Banks such as ING continue the details on the next rows without a date.
          const noAmount =
            cols.amount >= 0 ? !row[cols.amount] : !row[cols.debit] && !row[cols.credit];
          if (last && description && noAmount)
            last.description = `${last.description} ${description}`.trim();
          continue;
        }
        if (
          cols.state >= 0 &&
          /revert|declin|fail|anulat|respins/i.test(String(row[cols.state] ?? ""))
        )
          continue;
        let amount;
        if (cols.amount >= 0) amount = parseNumber(row[cols.amount]);
        else {
          const debit = parseNumber(row[cols.debit]);
          const credit = parseNumber(row[cols.credit]);
          amount = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
          if (!debit && !credit) amount = null;
        }
        if (amount === null || amount === 0) continue;
        const currency =
          cols.currency >= 0
            ? String(row[cols.currency] ?? "")
                .trim()
                .toUpperCase() || "RON"
            : "RON";
        last = {
          date,
          description,
          amount: round2(amount),
          currency,
          source: NodePath.basename(file),
        };
        transactions.push(last);
        count++;
      }
      sources.push({
        file: NodePath.basename(file),
        sheet: sheet.name,
        rows: count,
        columns: Object.fromEntries(
          Object.entries(cols)
            .filter(([, i]) => i >= 0)
            .map(([k, i]) => [k, found.header[i]]),
        ),
      });
    }
  }
  return { transactions, sources };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length
    ? sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2
    : 0;
};

/** The things worth a second look, each with a plain reason. */
export function findAnomalies(items, month, L) {
  const flags = [];
  const outs = items.filter((t) => t.amount < 0 && !t.ignore);
  const inMonth = (t) => !month || t.date.startsWith(month);
  // Same merchant, same amount, same or next day: maybe charged twice.
  const sorted = [...outs].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const days = (Date.parse(b.date) - Date.parse(a.date)) / 86400000;
      if (days > 1) break;
      if (a.merchant === b.merchant && a.amount === b.amount && inMonth(b))
        flags.push({ t: b, kind: "duplicate", why: L.dup(a.date) });
    }
  }
  // Much bigger than usual for the merchant or the category.
  const byMerchant = new Map();
  for (const t of outs) byMerchant.set(t.merchant, [...(byMerchant.get(t.merchant) ?? []), t]);
  const byCategory = new Map();
  for (const t of outs) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  for (const t of outs.filter(inMonth)) {
    const others = (byMerchant.get(t.merchant) ?? []).filter((o) => o !== t).map((o) => -o.amount);
    if (others.length >= 2 && -t.amount > 2 * median(others) && -t.amount - median(others) > 50) {
      flags.push({ t, kind: "large", why: L.largeMerchant(round2(median(others))) });
      continue;
    }
    if (others.length >= 2) continue;
    const cat = (byCategory.get(t.category) ?? []).filter((o) => o !== t).map((o) => -o.amount);
    if (cat.length >= 4 && -t.amount > 4 * median(cat) && -t.amount > 300)
      flags.push({ t, kind: "large", why: L.largeCategory(round2(median(cat))) });
  }
  // Monthly charges that changed price, and merchants seen for the first time this month.
  const months = [...new Set(items.map((t) => t.date.slice(0, 7)))].sort();
  if (month && months.length > 1) {
    for (const list of byMerchant.values()) {
      const before = list.filter((t) => t.date.slice(0, 7) < month);
      const now = list.filter((t) => t.date.startsWith(month));
      if (now.length && before.length === 0 && -now.reduce((a, t) => a + t.amount, 0) > 100)
        flags.push({ t: now[0], kind: "new", why: L.newMerchant });
      const lastBefore = before.filter(
        (t) => t.date.slice(0, 7) === before.at(-1)?.date.slice(0, 7),
      );
      if (now.length === 1 && lastBefore.length === 1) {
        const prev = -lastBefore[0].amount;
        const cur = -now[0].amount;
        const change = prev > 0 ? (cur - prev) / prev : 0;
        const recurring = RECURRING.has(now[0].category ?? "");
        if (
          (recurring && Math.abs(change) > 0.05 && Math.abs(cur - prev) > 5) ||
          (change > 0.5 && cur - prev > 200)
        )
          flags.push({
            t: now[0],
            kind: "price",
            why: L.priceChange(round2(prev), round2(cur), Math.round(change * 100)),
          });
      }
    }
  }
  for (const t of outs.filter(inMonth)) {
    if (t.currency !== "RON") flags.push({ t, kind: "fx", why: L.fx(t.currency) });
    if (!t.category) flags.push({ t, kind: "uncategorised", why: L.uncategorised });
  }
  const merged = new Map();
  for (const f of flags) {
    const existing = merged.get(f.t);
    if (!existing) merged.set(f.t, { ...f });
    else if (!existing.why.includes(f.why)) existing.why = `${existing.why}; ${f.why}`;
  }
  return [...merged.values()];
}

function main() {
  const lang = opt("lang", "ro") === "en" ? "en" : "ro";
  const input = opt("in");
  const out = opt("out");
  const month = opt("month");
  if (!input || !out)
    fail(
      "Use --in <statement file or folder> --out <file.xlsx> [--month YYYY-MM] [--rules rules.json] [--map map.json].",
    );
  if (!NodeFS.existsSync(input)) fail(`${input} does not exist.`);
  const files = NodeFS.statSync(input).isDirectory()
    ? NodeFS.readdirSync(input)
        .filter((f) => /\.(csv|txt|xlsx)$/i.test(f))
        .map((f) => NodePath.join(input, f))
    : [input];
  if (files.length === 0)
    fail(
      `No CSV or XLSX files in ${input}. A PDF statement must first be written out as CSV (see the guidance).`,
    );
  const readJson = (file) => {
    if (!file) return null;
    try {
      return JSON.parse(NodeFS.readFileSync(file, "utf8"));
    } catch (error) {
      fail(`${file} could not be read: ${error.message}`);
    }
  };
  const map = readJson(opt("map"));
  const rules = readJson(opt("rules")) ?? [];
  const { transactions, sources } = loadTransactions(files, map);
  if (transactions.length === 0)
    fail(
      `No transactions found. Files read: ${JSON.stringify(sources)}. Write a map.json with the column names (see the top of expenses.mjs) and run again with --map.`,
    );

  const ron = (n) =>
    `${Number(n).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`;
  const L =
    lang === "ro"
      ? {
          sum: "Rezumat",
          tx: "Tranzacții",
          att: "De verificat",
          mer: "Comercianți",
          sumCols: ["Categorie", "Cheltuieli", "% din total", "Tranzacții"],
          txCols: [
            "Data",
            "Descriere (din bancă)",
            "Comerciant",
            "Categorie",
            "Ieșiri",
            "Intrări",
            "Monedă",
            "Fișier",
            "Atenție",
          ],
          attCols: ["Data", "Comerciant", "Sumă", "Categorie", "Ce am observat", "Ce faci"],
          merCols: ["Comerciant", "Categorie", "Tranzacții", "Total cheltuit"],
          income: "Încasări",
          expenses: "Cheltuieli",
          net: "Diferență (încasări − cheltuieli)",
          total: "TOTAL",
          none: "Necategorisite",
          title: (m) => `Cheltuieli ${m ?? ""}`.trim(),
          subtitle: (n, f) =>
            `${n} tranzacții din ${f}. Sumele în lei; cele în altă monedă sunt marcate. Galben = de verificat.`,
          dup: (d) => `aceeași sumă la același comerciant și pe ${d}: poate fi plătită de două ori`,
          largeMerchant: (m) =>
            `mult peste suma obișnuită la acest comerciant (de obicei ${ron(m)})`,
          largeCategory: (m) =>
            `mult peste o cheltuială obișnuită din categorie (de obicei ${ron(m)})`,
          newMerchant: "comerciant nou luna aceasta",
          priceChange: (a, b, p) =>
            `față de luna trecută: ${ron(a)} → ${ron(b)} (${p > 0 ? "+" : ""}${p}%)`,
          fx: (c) => `plată în ${c}: are curs și poate comision de schimb`,
          uncategorised: "fără categorie",
          todo: {
            duplicate: "Verifică în extras sau la comerciant; cere banii înapoi dacă e dublă.",
            large: "Verifică factura sau bonul pentru plata asta.",
            new: "Confirmă că o știi.",
            price:
              "Verifică de ce a crescut (consum, scumpire, campanie mai mare) și dacă era plănuit.",
            fx: "Păstrează factura în valută pentru contabil.",
            uncategorised: "Spune ce e, ca să intre la categoria potrivită.",
          },
        }
      : {
          sum: "Summary",
          tx: "Transactions",
          att: "To check",
          mer: "Merchants",
          sumCols: ["Category", "Spent", "% of total", "Transactions"],
          txCols: [
            "Date",
            "Description (from the bank)",
            "Merchant",
            "Category",
            "Out",
            "In",
            "Currency",
            "File",
            "Flag",
          ],
          attCols: ["Date", "Merchant", "Amount", "Category", "What we noticed", "What to do"],
          merCols: ["Merchant", "Category", "Transactions", "Total spent"],
          income: "Income",
          expenses: "Expenses",
          net: "Difference (income − expenses)",
          total: "TOTAL",
          none: "Uncategorised",
          title: (m) => `Expenses ${m ?? ""}`.trim(),
          subtitle: (n, f) =>
            `${n} transactions from ${f}. Amounts in RON; other currencies are marked. Yellow = check.`,
          dup: (d) => `same amount at the same merchant on ${d} too: may be charged twice`,
          largeMerchant: (m) => `much more than usual at this merchant (usually ${m})`,
          largeCategory: (m) => `much more than a usual expense in this category (usually ${m})`,
          newMerchant: "new merchant this month",
          priceChange: (a, b, p) =>
            `compared with last month: ${a} → ${b} (${p > 0 ? "+" : ""}${p}%)`,
          fx: (c) => `paid in ${c}: exchange rate and maybe a conversion fee`,
          uncategorised: "no category",
          todo: {
            duplicate:
              "Check the statement or ask the merchant; get it refunded if it is a double charge.",
            large: "Check the invoice or receipt for this payment.",
            new: "Confirm you know it.",
            price:
              "Check why it changed (usage, a price rise, a bigger campaign) and whether it was planned.",
            fx: "Keep the foreign-currency invoice for your accountant.",
            uncategorised: "Say what it is so it lands in the right category.",
          },
        };

  // Same transaction in two overlapping exports: keep one.
  // (identical rows inside one file are real, e.g. a double charge, and stay).
  const firstFile = new Map();
  const all = transactions
    .filter((t) => {
      const key = `${t.date}|${t.amount}|${fold(t.description).replace(/\s+/g, " ").slice(0, 60)}`;
      const owner = firstFile.get(key);
      if (owner === undefined) firstFile.set(key, t.source);
      return owner === undefined || owner === t.source;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const t of all) {
    t.merchant = merchantOf(t.description);
    const c = categorize(t.description, t.merchant, rules);
    t.ignore = Boolean(c.ignore);
    t.category = t.amount > 0 ? null : c.category;
  }
  const items = month ? all.filter((t) => t.date.startsWith(month)) : all;
  const flags = findAnomalies(all, month, L);
  const flagged = new Map(flags.map((f) => [f.t, f]));
  const counted = items.filter((t) => !t.ignore);
  const spent = counted.filter((t) => t.amount < 0);
  const income = counted.filter((t) => t.amount > 0);
  const categories = new Map();
  for (const t of spent) {
    const key = t.category ?? L.none;
    categories.set(key, [...(categories.get(key) ?? []), t]);
  }
  const catRows = [...categories.entries()]
    .map(([name, list]) => ({
      name,
      total: round2(-list.reduce((a, t) => a + t.amount, 0)),
      count: list.length,
    }))
    .sort((a, b) => b.total - a.total);
  const totalSpent = round2(catRows.reduce((a, c) => a + c.total, 0));
  const totalIncome = round2(income.reduce((a, t) => a + t.amount, 0));

  const first = 2;
  const last = first + Math.max(items.length, 1) - 1;
  const txRef = `'${L.tx}'`;
  const summary = {
    name: L.sum,
    title: L.title(month),
    subtitle: L.subtitle(
      items.length,
      sources
        .map((s) => s.file)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", "),
    ),
    columns: [
      { header: L.sumCols[0], width: 30 },
      { header: L.sumCols[1], type: "money" },
      { header: L.sumCols[2], type: "percent", width: 12 },
      { header: L.sumCols[3], type: "int", width: 13 },
    ],
    rows: [
      ...catRows.map((c, i) => [
        c.name === L.none ? { v: c.name, s: "check" } : c.name,
        {
          f: `SUMIF(${txRef}!D${first}:D${last},A${i + 5},${txRef}!E${first}:E${last})`,
          v: c.total,
        },
        {
          f: `IF($B$${catRows.length + 5}=0,0,B${i + 5}/$B$${catRows.length + 5})`,
          v: totalSpent ? round2((c.total / totalSpent) * 10000) / 10000 : 0,
        },
        {
          f: `COUNTIFS(${txRef}!D${first}:D${last},A${i + 5},${txRef}!E${first}:E${last},">0")`,
          v: c.count,
        },
      ]),
      {
        style: "total",
        cells: [
          L.expenses,
          { f: `SUM(B5:B${catRows.length + 4})`, v: totalSpent },
          null,
          { f: `SUM(D5:D${catRows.length + 4})`, v: spent.length },
        ],
      },
      {
        style: "total",
        cells: [
          L.income,
          { f: `SUM(${txRef}!F${first}:F${last})`, v: totalIncome },
          null,
          income.length,
        ],
      },
      {
        style: "total",
        cells: [
          L.net,
          {
            f: `B${catRows.length + 6}-B${catRows.length + 5}`,
            v: round2(totalIncome - totalSpent),
          },
          null,
          null,
        ],
      },
    ],
    filter: false,
  };
  const txSheet = {
    name: L.tx,
    columns: [
      { header: L.txCols[0], type: "date" },
      { header: L.txCols[1], type: "wrap", width: 52 },
      { header: L.txCols[2], width: 24 },
      { header: L.txCols[3], width: 24 },
      { header: L.txCols[4], type: "money" },
      { header: L.txCols[5], type: "money" },
      { header: L.txCols[6], width: 9 },
      { header: L.txCols[7], width: 18 },
      { header: L.txCols[8], type: "wrap", width: 40 },
    ],
    rows: items.map((t) => {
      const f = flagged.get(t);
      const mark = (v, type) => (f ? { v, s: "check", ...(type ? { t: type } : {}) } : v);
      return [
        t.date,
        t.description,
        t.merchant,
        t.ignore ? "-" : t.amount < 0 ? (t.category ?? { v: L.none, s: "check" }) : L.income,
        t.amount < 0 && !t.ignore ? mark(-t.amount) : null,
        t.amount > 0 && !t.ignore ? t.amount : null,
        t.currency,
        t.source,
        f ? f.why : t.ignore ? "-" : "",
      ];
    }),
  };
  const attention = flags.filter((f) => !month || f.t.date.startsWith(month));
  const attSheet = {
    name: L.att,
    columns: [
      { header: L.attCols[0], type: "date" },
      { header: L.attCols[1], width: 24 },
      { header: L.attCols[2], type: "money" },
      { header: L.attCols[3], width: 22 },
      { header: L.attCols[4], type: "wrap", width: 50 },
      { header: L.attCols[5], type: "wrap", width: 50 },
    ],
    rows: attention.map((f) => [
      f.t.date,
      f.t.merchant,
      -f.t.amount,
      f.t.category ?? L.none,
      f.why,
      L.todo[f.kind],
    ]),
  };
  const merchants = new Map();
  for (const t of spent) {
    const m = merchants.get(t.merchant) ?? {
      name: t.merchant,
      category: t.category ?? L.none,
      count: 0,
      total: 0,
    };
    m.count++;
    m.total += -t.amount;
    merchants.set(t.merchant, m);
  }
  const merSheet = {
    name: L.mer,
    columns: [
      { header: L.merCols[0], width: 28 },
      { header: L.merCols[1], width: 24 },
      { header: L.merCols[2], type: "int" },
      { header: L.merCols[3], type: "money" },
    ],
    rows: [...merchants.values()]
      .sort((a, b) => b.total - a.total)
      .map((m) => [m.name, m.category, m.count, round2(m.total)]),
  };
  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(out)), { recursive: true });
  NodeFS.writeFileSync(
    out,
    writeXlsx({ title: summary.title, sheets: [summary, txSheet, attSheet, merSheet] }),
  );
  const months = [...new Set(all.map((t) => t.date.slice(0, 7)))].sort();
  const result = {
    xlsx: NodePath.resolve(out),
    sources,
    monthsInFiles: months,
    month: month ?? null,
    transactions: items.length,
    spent: totalSpent,
    income: totalIncome,
    categories: catRows,
    topExpenses: [...spent]
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 8)
      .map((t) => ({
        date: t.date,
        merchant: t.merchant,
        amount: -t.amount,
        category: t.category,
      })),
    uncategorisedMerchants: [...merchants.values()]
      .filter((m) => m.category === L.none)
      .sort((a, b) => b.total - a.total)
      .slice(0, 25)
      .map((m) => ({
        merchant: m.name,
        count: m.count,
        total: round2(m.total),
        example: spent.find((t) => t.merchant === m.name)?.description,
      })),
    attention: attention.map((f) => ({
      date: f.t.date,
      merchant: f.t.merchant,
      amount: -f.t.amount,
      kind: f.kind,
      why: f.why,
    })),
  };
  NodeFS.writeFileSync(
    out.replace(/\.xlsx$/i, "") + ".summary.json",
    JSON.stringify(result, null, 1),
  );
  console.log(JSON.stringify(result, null, 1));
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("expenses.mjs")) main();
