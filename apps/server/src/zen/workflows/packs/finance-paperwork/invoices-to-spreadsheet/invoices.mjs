// Checks invoices and receipts read from scans and builds the workbook (format in SKILL.md).
//   node invoices.mjs --data invoices.json --ocr <ocr folder> --out file.xlsx [--period YYYY-MM] [--buyer CUI] [--lang en]
// Each value is looked up again in the OCR words: confidence under 80 or not found marks it yellow.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseDate, parseNumber, round2, writeXlsx } from "./tables.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const LOW = 80;

/** Romanian CUI/CIF control digit (key 753217532). */
export function validCui(value) {
  const digits = String(value ?? "")
    .toUpperCase()
    .replace(/^RO/, "")
    .replace(/\s/g, "");
  if (!/^\d{2,10}$/.test(digits)) return false;
  const body = digits.slice(0, -1).padStart(9, "0");
  const key = "753217532";
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * Number(key[i]);
  let control = (sum * 10) % 11;
  if (control === 10) control = 0;
  return control === Number(digits.at(-1));
}

/** VAT rates in force in Romania on a date (from 1 August 2025: 21, 11; before: 19, 9, 5). */
export function vatRatesOn(iso) {
  if (iso && iso < "2025-08-01") return [19, 9, 5, 0];
  return [21, 11, 0];
}

const fold = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** All words of an OCR result (lines and the sparse extra words) with confidences. */
function ocrWords(ocr) {
  const words = [];
  for (const page of ocr?.pages ?? []) {
    for (const line of page.lines ?? []) for (const w of line.words ?? []) words.push(w);
    for (const w of page.extra_words ?? []) words.push(w);
  }
  return words.map((w) => ({
    text: w.text,
    conf: Number(w.conf ?? 0),
    folded: fold(w.text).replace(/[|[\]()]/g, ""),
    number: parseNumber(w.text),
    date: parseDate(w.text.replace(/[^\d./-]/g, "")),
  }));
}

/** Confidence of a value: number, date, CUI or text; null when it is not in the OCR words. */
export function confidenceOf(kind, value, words) {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "number") {
    const target = Number(value);
    const hits = words.filter(
      (w) => w.number !== null && Math.abs(Math.abs(w.number) - Math.abs(target)) < 0.005,
    );
    return hits.length ? Math.max(...hits.map((w) => w.conf)) : null;
  }
  if (kind === "date") {
    const hits = words.filter((w) => w.date === value);
    return hits.length ? Math.max(...hits.map((w) => w.conf)) : null;
  }
  if (kind === "cui") {
    const digits = String(value).replace(/\D/g, "");
    const hits = words.filter(
      (w) => w.text.replace(/\D/g, "").includes(digits) && digits.length >= 2,
    );
    return hits.length ? Math.max(...hits.map((w) => w.conf)) : null;
  }
  const tokens = fold(value)
    .split(/[\s,./\\-]+/)
    .filter((t) => t.length >= 2 && !["srl", "sa", "s.r.l", "pfa", "ii"].includes(t));
  if (tokens.length === 0) return null;
  const confs = [];
  for (const token of tokens) {
    const hits = words.filter((w) => w.folded.includes(token));
    if (hits.length) confs.push(Math.max(...hits.map((w) => w.conf)));
  }
  if (confs.length / tokens.length < 0.6) return null;
  return Math.min(...confs);
}

function main() {
  const lang = opt("lang", "ro") === "en" ? "en" : "ro";
  const dataFile = opt("data");
  const ocrDir = opt("ocr", "invoices/ocr");
  const out = opt("out");
  const period = opt("period");
  const buyer = opt("buyer")
    ? String(opt("buyer")).toUpperCase().replace(/^RO/, "").replace(/\D/g, "")
    : null;
  if (!dataFile || !out)
    fail(
      "Use --data invoices.json --ocr <ocr folder> --out <file.xlsx> [--lang ro|en] [--period YYYY-MM].",
    );
  let data;
  try {
    data = JSON.parse(NodeFS.readFileSync(dataFile, "utf8"));
  } catch (error) {
    fail(`${dataFile} could not be read: ${error.message}`);
  }
  const docs = Array.isArray(data) ? data : data.invoices;
  if (!Array.isArray(docs) || docs.length === 0)
    fail('invoices.json needs "invoices": [ ... ] with at least one document.');

  const L =
    lang === "ro"
      ? {
          docs: "Documente",
          vat: "TVA pe cote",
          vatLines: "Linii TVA",
          check: "De verificat",
          suppliers: "Furnizori",
          cols: [
            "Nr.",
            "Fișier",
            "Tip",
            "Furnizor",
            "CUI furnizor",
            "Nr. document",
            "Data",
            "Scadența",
            "Monedă",
            "Bază (fără TVA)",
            "TVA",
            "Total",
            "Plată",
            "Încredere minimă",
            "De verificat",
            "Observații",
          ],
          vatCols: ["Cota TVA", "Bază", "TVA", "Documente"],
          lineCols: ["Nr.", "Furnizor", "Cota TVA", "Bază", "TVA"],
          checkCols: ["Nr.", "Fișier", "Câmp", "Valoare citită", "Încredere", "De ce", "Ce faci"],
          supCols: ["Furnizor", "CUI", "Documente", "Total"],
          total: "TOTAL",
          invoice: "factură",
          receipt: "bon fiscal",
          other: "alt document",
          field: {
            supplier: "Furnizor",
            supplier_cui: "CUI furnizor",
            number: "Nr. document",
            date: "Data",
            net: "Bază",
            vat_total: "TVA",
            total: "Total",
            base: "Bază TVA",
            vat: "TVA pe cotă",
          },
          title: "Facturi și bonuri citite din scanări",
          subtitle: (n) =>
            `${n} documente. Galben = de verificat cu ochii pe document. Roșu = calcul sau cod greșit. Fișierele originale rămân neschimbate.`,
          lowConf: (c) => `citit cu încredere ${c}%`,
          notFound: "nu apare clar în textul citit (luat de pe imagine sau dedus)",
          lookAt: "Compară cu documentul și corectează celula.",
          missing: "lipsește",
          missingDo: "Caută pe document; dacă nu e trecut, lasă gol.",
          badCui: "codul fiscal nu trece verificarea cifrei de control",
          badCuiDo: "Recitește CUI-ul de pe document; o cifră e greșită.",
          sum: (n, v, t) => `bază + TVA (${n} + ${v}) nu dă totalul ${t}`,
          sumDo: "Verifică totalul și TVA-ul pe document.",
          linesTotal: (lines, t) =>
            `cotele de TVA adunate (${lines}) nu dau totalul de pe document (${t})`,
          linesVat: (lines, v) => `TVA-ul pe cote adunat (${lines}) nu dă TVA-ul total (${v})`,
          linesDo:
            "Compară fiecare cotă cu totalul de pe bon sau factură; o cifră e citită greșit.",
          yes: "DA",
          rate: (r, d) => `cota de ${r}% nu era în vigoare la ${d}`,
          rateDo: "Verifică cota; poate fi o greșeală de citire sau de facturare.",
          lineVat: (r) => `TVA-ul la ${r}% nu se potrivește cu baza`,
          lineVatDo: "Verifică baza și TVA-ul pe cota respectivă.",
          future: "data e în viitor",
          outOfPeriod: (p) => `data nu e în perioada ${p}`,
          dateDo: "Verifică data; poate fi pusă în altă lună.",
          dup: (n) => `pare același document ca nr. ${n}`,
          dupDo: "Păstrează-l o singură dată (al doilea e probabil o poză în plus).",
          currency: (c) => `în ${c}, nu în lei`,
          currencyDo: "Contabilul îl trece la cursul BNR din ziua facturii.",
          receiptNote: "bon cu CIF client: ține loc de factură simplificată dacă e sub 100 euro",
          derived: (f) => `${f} calculată din cifrele de pe document`,
          otherBuyer: (c) => `cumpărătorul de pe document (${c}) nu e firma voastră`,
          otherBuyerDo:
            "Verifică dacă documentul e pe firma voastră; altfel nu intră la contabilitate.",
        }
      : {
          docs: "Documents",
          vat: "VAT by rate",
          vatLines: "VAT lines",
          check: "To check",
          suppliers: "Suppliers",
          cols: [
            "No.",
            "File",
            "Type",
            "Supplier",
            "Supplier tax ID",
            "Document no.",
            "Date",
            "Due",
            "Currency",
            "Net",
            "VAT",
            "Total",
            "Payment",
            "Lowest confidence",
            "To check",
            "Notes",
          ],
          vatCols: ["VAT rate", "Net", "VAT", "Documents"],
          lineCols: ["No.", "Supplier", "VAT rate", "Net", "VAT"],
          checkCols: ["No.", "File", "Field", "Value read", "Confidence", "Why", "What to do"],
          supCols: ["Supplier", "Tax ID", "Documents", "Total"],
          total: "TOTAL",
          invoice: "invoice",
          receipt: "receipt",
          other: "other document",
          field: {
            supplier: "Supplier",
            supplier_cui: "Supplier tax ID",
            number: "Document no.",
            date: "Date",
            net: "Net",
            vat_total: "VAT",
            total: "Total",
            base: "VAT base",
            vat: "VAT at rate",
          },
          title: "Invoices and receipts read from scans",
          subtitle: (n) =>
            `${n} documents. Yellow = check against the document. Red = wrong sum or code. The original files are unchanged.`,
          lowConf: (c) => `read with ${c}% confidence`,
          notFound: "not clearly in the text read (taken from the image or inferred)",
          lookAt: "Compare with the document and correct the cell.",
          missing: "missing",
          missingDo: "Look on the document; leave it empty if it is not there.",
          badCui: "the tax ID fails the control digit check",
          badCuiDo: "Re-read the tax ID on the document; a digit is wrong.",
          sum: (n, v, t) => `net + VAT (${n} + ${v}) does not equal the total ${t}`,
          sumDo: "Check the total and the VAT on the document.",
          linesTotal: (lines, t) =>
            `the VAT lines add up to ${lines}, not the document's total ${t}`,
          linesVat: (lines, v) =>
            `the VAT of the lines adds up to ${lines}, not the total VAT ${v}`,
          linesDo:
            "Compare each rate with the total on the receipt or invoice; a digit is misread.",
          yes: "YES",
          rate: (r, d) => `a ${r}% VAT rate was not in force on ${d}`,
          rateDo: "Check the rate; it may be a reading or billing error.",
          lineVat: (r) => `the VAT at ${r}% does not match its base`,
          lineVatDo: "Check the base and VAT for that rate.",
          future: "the date is in the future",
          outOfPeriod: (p) => `the date is outside ${p}`,
          dateDo: "Check the date; it may belong to another month.",
          dup: (n) => `looks like the same document as no. ${n}`,
          dupDo: "Keep it once (the second is probably an extra photo).",
          currency: (c) => `in ${c}, not RON`,
          currencyDo: "Your accountant converts it at the BNR rate of the invoice date.",
          receiptNote:
            "receipt with the buyer's tax ID: counts as a simplified invoice under 100 EUR",
          derived: (f) => `${f} calculated from the numbers on the document`,
          otherBuyer: (c) => `the buyer on the document (${c}) is not your company`,
          otherBuyerDo:
            "Check the document is made out to your company; otherwise it does not go to the accountant.",
        };

  const today = new Date().toISOString().slice(0, 10);
  const issues = [];
  const rows = [];
  const lineRows = [];
  const seen = new Map();
  const ocrCache = new Map();
  const loadOcr = (file) => {
    const base = NodePath.basename(String(file ?? ""), NodePath.extname(String(file ?? "")));
    if (!ocrCache.has(base)) {
      const path = NodePath.join(ocrDir, `${base}.json`);
      ocrCache.set(
        base,
        NodeFS.existsSync(path) ? JSON.parse(NodeFS.readFileSync(path, "utf8")) : null,
      );
    }
    return ocrCache.get(base);
  };

  docs.forEach((doc, index) => {
    const no = index + 1;
    const ocr = loadOcr(doc.file);
    const words = ocrWords(ocr);
    const notes = [];
    const cellStyle = {};
    const add = (field, value, why, todo, style = "check", conf = null) => {
      issues.push({
        no,
        file: NodePath.basename(String(doc.file ?? "")),
        field: L.field[field] ?? field,
        value,
        conf,
        why,
        todo,
      });
      cellStyle[field] = style === "bad" || cellStyle[field] === "bad" ? "bad" : "check";
      if (!notes.includes(why)) notes.push(why);
    };
    const date = parseDate(doc.date);
    const due = parseDate(doc.due_date);
    const net = parseNumber(doc.net);
    const vatTotal = parseNumber(doc.vat_total);
    const total = parseNumber(doc.total);
    const currency = String(doc.currency ?? "RON").toUpperCase();
    const confs = [];
    const vatParts = (Array.isArray(doc.vat) ? doc.vat : []).map((line) => ({
      base: parseNumber(line.base),
      vat: parseNumber(line.vat),
    }));
    const found = (v) => v !== null && confidenceOf("number", v, words) !== null;
    // A total that is not printed but follows from printed numbers is fine (and said in the notes).
    const derived = (field) => {
      if (field === "vat_total" && vatParts.length > 1 && vatParts.every((p) => found(p.vat)))
        return Math.abs(round2(vatParts.reduce((a, p) => a + p.vat, 0)) - vatTotal) <= 0.02;
      if (field === "net" && vatParts.length > 1 && vatParts.every((p) => found(p.base)))
        return Math.abs(round2(vatParts.reduce((a, p) => a + p.base, 0)) - net) <= 0.02;
      if (field === "net" && found(total) && found(vatTotal) && net !== null)
        return Math.abs(round2(total - vatTotal) - net) <= 0.02;
      return false;
    };
    const fields = [
      ["supplier", "text", doc.supplier],
      ["supplier_cui", "cui", doc.supplier_cui],
      ["number", "text", doc.number],
      ["date", "date", date],
      ["net", "number", net],
      ["vat_total", "number", vatTotal],
      ["total", "number", total],
    ];
    for (const [field, kind, value] of fields) {
      if (value === null || value === undefined || value === "") {
        if (["supplier", "date", "total"].includes(field)) add(field, "", L.missing, L.missingDo);
        continue;
      }
      if (!ocr) continue;
      const conf = confidenceOf(kind, value, words);
      if (conf === null && derived(field)) {
        notes.push(L.derived(L.field[field]));
        continue;
      }
      if (conf === null) add(field, value, L.notFound, L.lookAt);
      else {
        confs.push(conf);
        if (conf < LOW) add(field, value, L.lowConf(Math.round(conf)), L.lookAt, "check", conf);
      }
    }
    for (const field of doc.uncertain ?? []) {
      if (!cellStyle[field]) add(field, doc[field] ?? "", L.notFound, L.lookAt);
    }
    if (doc.supplier_cui && !validCui(doc.supplier_cui))
      add("supplier_cui", doc.supplier_cui, L.badCui, L.badCuiDo, "bad");
    if (
      net !== null &&
      vatTotal !== null &&
      total !== null &&
      Math.abs(round2(net + vatTotal) - total) > 0.05
    )
      add("total", total, L.sum(net, vatTotal, total), L.sumDo, "bad");
    // The amounts read per VAT rate must add up to the totals printed on the document.
    const complete =
      vatParts.length > 0 && vatParts.every((p) => p.base !== null && p.vat !== null);
    if (complete) {
      const linesVat = round2(vatParts.reduce((a, p) => a + p.vat, 0));
      const linesTotal = round2(vatParts.reduce((a, p) => a + p.base + p.vat, 0));
      if (total !== null && Math.abs(linesTotal - total) > 0.05)
        add("total", total, L.linesTotal(linesTotal, total), L.linesDo, "bad");
      if (vatTotal !== null && Math.abs(linesVat - vatTotal) > 0.05)
        add("vat_total", vatTotal, L.linesVat(linesVat, vatTotal), L.linesDo, "bad");
    }
    const vatLines = Array.isArray(doc.vat) ? doc.vat : [];
    for (const line of vatLines) {
      const rate = parseNumber(line.rate);
      const base = parseNumber(line.base);
      const vat = parseNumber(line.vat);
      if (rate !== null && date && !vatRatesOn(date).includes(rate))
        add("vat_total", rate, L.rate(rate, date), L.rateDo);
      if (
        rate !== null &&
        base !== null &&
        vat !== null &&
        Math.abs(round2((base * rate) / 100) - vat) > Math.max(0.06, vat * 0.004)
      )
        add("vat_total", vat, L.lineVat(rate), L.lineVatDo);
      if (
        ocr &&
        base !== null &&
        confidenceOf("number", base, words) === null &&
        vatLines.length > 1
      )
        add("vat_total", base, `${L.field.base} ${rate}%: ${L.notFound}`, L.lookAt);
      lineRows.push([no, doc.supplier ?? "", rate === null ? null : rate / 100, base, vat]);
    }
    if (vatLines.length === 0 && net !== null && vatTotal !== null) {
      const rate = net ? Math.round((vatTotal / net) * 100) : 0;
      lineRows.push([no, doc.supplier ?? "", rate / 100, net, vatTotal]);
    }
    if (buyer && doc.buyer_cui && String(doc.buyer_cui).replace(/\D/g, "") !== buyer)
      add("supplier_cui", doc.buyer_cui, L.otherBuyer(doc.buyer_cui), L.otherBuyerDo);
    if (date && date > today) add("date", date, L.future, L.dateDo);
    if (date && period && !date.startsWith(period))
      add("date", date, L.outOfPeriod(period), L.dateDo);
    if (currency !== "RON") notes.push(L.currency(currency));
    const key1 =
      doc.supplier_cui && doc.number
        ? `${String(doc.supplier_cui).replace(/\D/g, "")}|${fold(doc.number).replace(/\s/g, "")}`
        : null;
    const key2 = `${fold(doc.supplier)}|${date}|${total}`;
    const twin = (key1 && seen.get(key1)) ?? seen.get(key2);
    if (twin) add("number", doc.number ?? "", L.dup(twin), L.dupDo, "bad");
    if (key1 && !seen.has(key1)) seen.set(key1, no);
    if (!seen.has(key2)) seen.set(key2, no);
    if (doc.type === "receipt" && doc.buyer_cui) notes.push(L.receiptNote);
    const minConf = confs.length ? Math.round(Math.min(...confs)) / 100 : null;
    const flagged = Object.keys(cellStyle).length > 0;
    const shownConf =
      minConf === null ? (ocr?.pages?.[0]?.source === "pdf-text" ? 1 : null) : minConf;
    const cell = (field, v, t) =>
      cellStyle[field] ? { v, s: cellStyle[field], ...(t ? { t } : {}) } : t ? { v, t } : v;
    rows.push({
      flagged,
      bad: Object.values(cellStyle).includes("bad"),
      cells: [
        no,
        NodePath.basename(String(doc.file ?? "")),
        doc.type === "receipt" ? L.receipt : doc.type === "other" ? L.other : L.invoice,
        cell("supplier", doc.supplier ?? ""),
        cell("supplier_cui", doc.supplier_cui ?? ""),
        cell("number", doc.number ?? ""),
        cell("date", date ?? doc.date ?? "", "date"),
        due ?? "",
        currency,
        cell("net", net),
        cell("vat_total", vatTotal),
        cell("total", total),
        doc.payment ?? "",
        // A marked row shows its confidence and "DA" in yellow: the only rows to check.
        flagged ? { v: shownConf, s: "check" } : shownConf,
        flagged ? { v: L.yes, s: Object.values(cellStyle).includes("bad") ? "bad" : "check" } : "",
        notes.join("; "),
      ],
    });
  });

  const n = rows.length;
  const first = 5;
  const last = first + n - 1;
  const sum = (col) => {
    const values = rows
      .map((r) => r.cells[col])
      .map((c) => (c && typeof c === "object" ? c.v : c))
      .filter((v) => typeof v === "number");
    return round2(values.reduce((a, b) => a + b, 0));
  };
  const docsSheet = {
    name: L.docs,
    title: data.title ?? L.title,
    subtitle: L.subtitle(n),
    columns: [
      { header: L.cols[0], type: "int", width: 6 },
      { header: L.cols[1], width: 26 },
      { header: L.cols[2], width: 12 },
      { header: L.cols[3], width: 30 },
      { header: L.cols[4], width: 15 },
      { header: L.cols[5], width: 16 },
      { header: L.cols[6], type: "date" },
      { header: L.cols[7], type: "date" },
      { header: L.cols[8], width: 9 },
      { header: L.cols[9], type: "money" },
      { header: L.cols[10], type: "money" },
      { header: L.cols[11], type: "money" },
      { header: L.cols[12], width: 12 },
      { header: L.cols[13], type: "percent", width: 12 },
      { header: L.cols[14], width: 12 },
      { header: L.cols[15], type: "wrap", width: 60 },
    ],
    rows: [
      ...rows.map((r) => r.cells),
      {
        style: "total",
        cells: [
          null,
          L.total,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          { f: `SUBTOTAL(9,J${first}:J${last})`, v: sum(9) },
          { f: `SUBTOTAL(9,K${first}:K${last})`, v: sum(10) },
          { f: `SUBTOTAL(9,L${first}:L${last})`, v: sum(11) },
          null,
          null,
          null,
          null,
        ],
      },
    ],
    filterExcludesLast: 1,
  };
  const rates = [...new Set(lineRows.map((r) => r[2]).filter((r) => r !== null))].sort(
    (a, b) => b - a,
  );
  const lfirst = 2;
  const llast = lfirst + Math.max(lineRows.length, 1) - 1;
  const vatSheet = {
    name: L.vat,
    columns: [
      { header: L.vatCols[0], type: "percent" },
      { header: L.vatCols[1], type: "money" },
      { header: L.vatCols[2], type: "money" },
      { header: L.vatCols[3], type: "int" },
    ],
    rows: [
      ...rates.map((rate) => {
        const these = lineRows.filter((r) => r[2] === rate);
        const ref = `'${L.vatLines}'`;
        return [
          rate,
          {
            f: `SUMIF(${ref}!C${lfirst}:C${llast},A${rates.indexOf(rate) + 2},${ref}!D${lfirst}:D${llast})`,
            v: round2(these.reduce((a, r) => a + (r[3] ?? 0), 0)),
          },
          {
            f: `SUMIF(${ref}!C${lfirst}:C${llast},A${rates.indexOf(rate) + 2},${ref}!E${lfirst}:E${llast})`,
            v: round2(these.reduce((a, r) => a + (r[4] ?? 0), 0)),
          },
          these.length,
        ];
      }),
      {
        style: "total",
        cells: [
          L.total,
          {
            f: `SUM(B2:B${rates.length + 1})`,
            v: round2(lineRows.reduce((a, r) => a + (r[3] ?? 0), 0)),
          },
          {
            f: `SUM(C2:C${rates.length + 1})`,
            v: round2(lineRows.reduce((a, r) => a + (r[4] ?? 0), 0)),
          },
          null,
        ],
      },
    ],
    filter: false,
  };
  const lineSheet = {
    name: L.vatLines,
    columns: [
      { header: L.lineCols[0], type: "int", width: 6 },
      { header: L.lineCols[1], width: 30 },
      { header: L.lineCols[2], type: "percent" },
      { header: L.lineCols[3], type: "money" },
      { header: L.lineCols[4], type: "money" },
    ],
    rows: lineRows,
  };
  const checkSheet = {
    name: L.check,
    columns: [
      { header: L.checkCols[0], type: "int", width: 6 },
      { header: L.checkCols[1], width: 26 },
      { header: L.checkCols[2], width: 16 },
      { header: L.checkCols[3], width: 22 },
      { header: L.checkCols[4], type: "percent", width: 11 },
      { header: L.checkCols[5], type: "wrap", width: 46 },
      { header: L.checkCols[6], type: "wrap", width: 46 },
    ],
    rows: issues.map((i) => [
      i.no,
      i.file,
      i.field,
      i.value === null ? "" : String(i.value),
      i.conf === null ? null : i.conf / 100,
      i.why,
      i.todo,
    ]),
  };
  const bySupplier = new Map();
  docs.forEach((doc, i) => {
    const key = fold(doc.supplier);
    const entry = bySupplier.get(key) ?? {
      name: doc.supplier ?? "",
      cui: doc.supplier_cui ?? "",
      count: 0,
      total: 0,
      rows: [],
    };
    entry.count++;
    entry.total += parseNumber(doc.total) ?? 0;
    bySupplier.set(key, entry);
    void i;
  });
  const supSheet = {
    name: L.suppliers,
    columns: [
      { header: L.supCols[0], width: 32 },
      { header: L.supCols[1], width: 15 },
      { header: L.supCols[2], type: "int" },
      { header: L.supCols[3], type: "money" },
    ],
    rows: [...bySupplier.values()]
      .sort((a, b) => b.total - a.total)
      .map((s) => [
        s.name,
        s.cui,
        { f: `COUNTIF('${L.docs}'!D${first}:D${last},A__ROW__)`, v: s.count },
        {
          f: `SUMIF('${L.docs}'!D${first}:D${last},A__ROW__,'${L.docs}'!L${first}:L${last})`,
          v: round2(s.total),
        },
      ]),
  };
  supSheet.rows = supSheet.rows.map((row, i) =>
    row.map((c) =>
      c && typeof c === "object" && c.f ? { ...c, f: c.f.replace(/__ROW__/g, String(i + 2)) } : c,
    ),
  );

  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(out)), { recursive: true });
  NodeFS.writeFileSync(
    out,
    writeXlsx({
      title: docsSheet.title,
      sheets: [docsSheet, vatSheet, checkSheet, supSheet, lineSheet],
    }),
  );
  const summary = {
    xlsx: NodePath.resolve(out),
    documents: n,
    totals: { net: sum(9), vat: sum(10), total: sum(11) },
    vatByRate: rates.map((rate) => ({
      rate: Math.round(rate * 100),
      base: round2(lineRows.filter((r) => r[2] === rate).reduce((a, r) => a + (r[3] ?? 0), 0)),
      vat: round2(lineRows.filter((r) => r[2] === rate).reduce((a, r) => a + (r[4] ?? 0), 0)),
    })),
    toCheck: issues.length,
    // Documents (rows of the first sheet) with at least one marked field: the only ones to check.
    rowsToCheck: rows.filter((r) => r.flagged).length,
    rowsOk: rows.filter((r) => !r.flagged).length,
    issues,
  };
  NodeFS.writeFileSync(
    out.replace(/\.xlsx$/i, "") + ".summary.json",
    JSON.stringify(summary, null, 1),
  );
  console.log(JSON.stringify({ ...summary, issues: issues.slice(0, 40) }, null, 1));
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("invoices.mjs")) main();
