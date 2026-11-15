// @effect-diagnostics nodeBuiltinImport:off -- Plain unit test that loads the zen/packs-3 scripts from disk.
// The third batch of packs: the manifests are translated and declare what they need, the shared
// tables.mjs copies are identical, and the scripts that do the arithmetic get it right.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { parseRequires } from "../toolchains/workflowRequirements.ts";

const here = import.meta.dirname;
const packs = NodePath.join(here, "packs");
const file = (...parts: string[]) => NodePath.join(packs, ...parts);

const WORKFLOWS: ReadonlyArray<readonly [string, string]> = [
  ["marketing-content", "content-calendar-month"],
  ["marketing-content", "seo-blog-article"],
  ["finance-paperwork", "invoices-to-spreadsheet"],
  ["finance-paperwork", "monthly-expenses-report"],
  ["before-you-sign", "company-check"],
  ["before-you-sign", "contract-review"],
  ["team-kit", "interview-kit"],
  ["team-kit", "employee-onboarding-kit"],
  ["team-kit", "write-sop"],
  ["customer-comms", "support-faq-macros"],
  ["customer-comms", "crisis-communication"],
  ["sales-kit", "proposal-deck"],
  ["sales-kit", "sales-follow-up"],
  ["horeca-kit", "daily-menu-posts"],
  ["horeca-kit", "food-cost-pricing"],
  ["horeca-kit", "shift-sales-report"],
  ["horeca-kit", "supplier-order"],
  ["horeca-kit", "restaurant-review-replies"],
  ["newsletter-issue", ""],
];

const TABLE_COPIES = [
  "finance-paperwork/invoices-to-spreadsheet",
  "finance-paperwork/monthly-expenses-report",
  "team-kit/interview-kit",
  "horeca-kit/food-cost-pricing",
  "horeca-kit/shift-sales-report",
  "horeca-kit/supplier-order",
];

interface Input {
  readonly id: string;
  readonly options?: ReadonlyArray<string>;
  readonly placeholder?: string;
  readonly help?: string;
}
interface Manifest {
  readonly id: string;
  readonly inputs: ReadonlyArray<Input>;
  readonly i18n?: {
    readonly ro?: {
      readonly name?: string;
      readonly description?: string;
      readonly output?: string;
      readonly inputs?: Record<
        string,
        { label?: string; placeholder?: string; help?: string; options?: string[] }
      >;
    };
  };
}

type Fn = (...args: never[]) => unknown;
const load = async (relative: string) =>
  (await import(file(relative))) as Record<string, Fn | undefined>;
const call = <T>(module: Record<string, Fn | undefined>, name: string, ...args: unknown[]): T => {
  const fn = module[name];
  if (!fn) throw new Error(`${name} is not exported`);
  return (fn as (...a: unknown[]) => T)(...args);
};

describe("packs-3 manifests", () => {
  it("every workflow is translated, declares its requirements and uses comma-below ș ț", () => {
    for (const [pack, id] of WORKFLOWS) {
      const folder = id ? file(pack, id) : file(pack);
      const text = NodeFS.readFileSync(NodePath.join(folder, "workflow.json"), "utf8");
      const manifest = JSON.parse(text) as Manifest;
      expect(manifest.id).toBe(id || pack);
      const ro = manifest.i18n?.ro;
      expect(ro?.name && ro.description && ro.output, manifest.id).toBeTruthy();
      for (const input of manifest.inputs) {
        const t = ro?.inputs?.[input.id];
        expect(t?.label, `${manifest.id}.${input.id}`).toBeTruthy();
        if (input.placeholder) expect(t?.placeholder, `${manifest.id}.${input.id}`).toBeTruthy();
        if (input.help) expect(t?.help, `${manifest.id}.${input.id}`).toBeTruthy();
        if (input.options) expect(t?.options?.length).toBe(input.options.length);
      }
      const parsed = parseRequires(text);
      expect(parsed.problem ?? null, manifest.id).toBeNull();
      expect(parsed.requires, manifest.id).toBeTruthy();
      for (const name of NodeFS.readdirSync(folder)) {
        if (!/\.(md|json|mjs|py)$/.test(name)) continue;
        expect(
          NodeFS.readFileSync(NodePath.join(folder, name), "utf8"),
          `${id}/${name}`,
        ).not.toMatch(/[şţŞŢ]/);
      }
      const prompt = NodeFS.readFileSync(NodePath.join(folder, "prompt.md"), "utf8");
      expect(prompt).toContain("self-review");
    }
  });

  it("the contract review says it is not legal advice", () => {
    const prompt = NodeFS.readFileSync(file("before-you-sign/contract-review/prompt.md"), "utf8");
    const skill = NodeFS.readFileSync(file("before-you-sign/contract-review/SKILL.md"), "utf8");
    expect(prompt).toContain("Nu e consultanță juridică");
    expect(skill).toContain("**Nu e consultanță juridică.**");
  });

  it("ships one identical tables.mjs in every workflow that needs it", () => {
    const [first, ...rest] = TABLE_COPIES.map((dir) =>
      NodeFS.readFileSync(file(dir, "tables.mjs"), "utf8"),
    );
    for (const copy of rest) expect(copy).toBe(first);
  });
});

describe("tables.mjs", () => {
  it("writes a workbook it can read back, with numbers, dates and formulas", async () => {
    const tables = await load("finance-paperwork/invoices-to-spreadsheet/tables.mjs");
    const bytes = call<Buffer>(tables, "writeXlsx", {
      sheets: [
        {
          name: "Facturi",
          title: "Test",
          columns: [
            { header: "Furnizor" },
            { header: "Data", type: "date" },
            { header: "Total", type: "money" },
          ],
          rows: [
            ["Fresh Legume <SRL> & Co", "03.10.2026", 382.4],
            { style: "total", cells: ["Total", null, { f: "SUM(C4:C4)", v: 382.4 }] },
          ],
        },
      ],
    });
    const sheets = call<Array<{ name: string; rows: unknown[][] }>>(tables, "readXlsx", bytes);
    expect(sheets[0]?.name).toBe("Facturi");
    expect(sheets[0]?.rows).toEqual([
      ["Test"],
      ["Furnizor", "Data", "Total"],
      ["Fresh Legume <SRL> & Co", 46298, 382.4],
      ["Total", null, 382.4],
    ]);
    expect(
      call(tables, "specProblems", { sheets: [{ name: "x", columns: [], rows: [] }] }),
    ).toHaveLength(1);
  });

  it("reads Romanian and English numbers and dates", async () => {
    const tables = await load("finance-paperwork/invoices-to-spreadsheet/tables.mjs");
    const num = (v: unknown) => call<number | null>(tables, "parseNumber", v);
    expect(num("1.234,56")).toBe(1234.56);
    expect(num("1,234.56")).toBe(1234.56);
    expect(num("-45,00 lei")).toBe(-45);
    expect(num("0,500")).toBe(0.5);
    expect(num("12.345")).toBe(12345);
    expect(num("(12.50)")).toBe(-12.5);
    const date = (v: unknown) => call<string | null>(tables, "parseDate", v);
    expect(date("07.11.2026")).toBe("2026-11-07");
    expect(date("2026-11-07 12:30")).toBe("2026-11-07");
    expect(date("7 nov. 2026")).toBe("2026-11-07");
    expect(date("31.02.2026")).toBeNull();
    expect(date(46298)).toBe("2026-10-03");
  });

  it("reads CSV with a detected delimiter and quotes", async () => {
    const tables = await load("finance-paperwork/invoices-to-spreadsheet/tables.mjs");
    const parsed = call<{ rows: string[][]; delimiter: string }>(
      tables,
      "parseCsv",
      'Data;Descriere;Suma\n01.10.2026;"Plata; cu ""ghilimele""";-12,50\n',
    );
    expect(parsed.delimiter).toBe(";");
    expect(parsed.rows[1]).toEqual(["01.10.2026", 'Plata; cu "ghilimele"', "-12,50"]);
  });
});

describe("invoices and company checks", () => {
  it("checks the Romanian CUI control digit the same way in both scripts", async () => {
    const invoices = await load("finance-paperwork/invoices-to-spreadsheet/invoices.mjs");
    const company = await load("before-you-sign/company-check/company.mjs");
    for (const module of [invoices, company]) {
      expect(call(module, "validCui", "RO44712353")).toBe(true);
      expect(call(module, "validCui", "160796")).toBe(true);
      expect(call(module, "validCui", "RO33552011")).toBe(false);
      expect(call(module, "validCui", "abc")).toBe(false);
    }
    expect(call(invoices, "vatRatesOn", "2025-07-31")).toContain(19);
    expect(call(invoices, "vatRatesOn", "2026-10-03")).toEqual([21, 11, 0]);
  });

  it("takes a field's confidence from the OCR words it was read from", async () => {
    const invoices = await load("finance-paperwork/invoices-to-spreadsheet/invoices.mjs");
    const words = [
      { text: "382.40", conf: 64, folded: "382.40", number: 382.4, date: null },
      { text: "03.10.2026", conf: 95, folded: "03.10.2026", number: null, date: "2026-10-03" },
      { text: "Fresh", conf: 91, folded: "fresh", number: null, date: null },
      { text: "Legume", conf: 88, folded: "legume", number: null, date: null },
    ];
    expect(call(invoices, "confidenceOf", "number", 382.4, words)).toBe(64);
    expect(call(invoices, "confidenceOf", "date", "2026-10-03", words)).toBe(95);
    expect(call(invoices, "confidenceOf", "text", "Fresh Legume SRL", words)).toBe(88);
    expect(call(invoices, "confidenceOf", "number", 999, words)).toBeNull();
  });

  it("marks the rows to check and compares the VAT lines with the printed totals", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "zen-invoices-"));
    try {
      const data = {
        invoices: [
          {
            file: "a.jpg",
            type: "invoice",
            supplier: "Fresh Legume Ardeal SRL",
            supplier_cui: "RO44712353",
            number: "FLA 1",
            date: "2026-10-03",
            vat: [{ rate: 11, base: 344.5, vat: 37.9 }],
            net: 344.5,
            vat_total: 37.9,
            total: 382.4,
          },
          {
            file: "b.jpg",
            type: "receipt",
            supplier: "Mega Image SA",
            supplier_cui: "RO6719278",
            number: "0042",
            date: "2026-10-04",
            vat: [
              { rate: 21, base: 100, vat: 21 },
              { rate: 11, base: 50, vat: 5.5 },
            ],
            net: 150,
            vat_total: 26.5,
            // Misread: the lines add up to 176.50.
            total: 186.5,
          },
        ],
      };
      NodeFS.writeFileSync(NodePath.join(dir, "invoices.json"), JSON.stringify(data));
      const out = NodePath.join(dir, "out.xlsx");
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [
          file("finance-paperwork", "invoices-to-spreadsheet", "invoices.mjs"),
          "--data",
          NodePath.join(dir, "invoices.json"),
          "--ocr",
          NodePath.join(dir, "ocr"),
          "--out",
          out,
        ],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      const summary = JSON.parse(
        NodeFS.readFileSync(NodePath.join(dir, "out.summary.json"), "utf8"),
      ) as {
        rowsToCheck: number;
        rowsOk: number;
        issues: ReadonlyArray<{ no: number; why: string }>;
      };
      expect(summary.rowsToCheck).toBe(1);
      expect(summary.rowsOk).toBe(1);
      expect(summary.issues.map((issue) => issue.no)).not.toContain(1);
      expect(summary.issues.some((issue) => issue.why.includes("176.5"))).toBe(true);
      expect(NodeFS.statSync(out).size).toBeGreaterThan(1000);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads ANAF balance sheets and court cases without naming private persons", async () => {
    const company = await load("before-you-sign/company-check/company.mjs");
    const year = call<Record<string, number | null>>(company, "financialYear", {
      an: 2025,
      i: [
        { indicator: "I13", val_indicator: 1000, val_den_indicator: "Cifra de afaceri neta" },
        { indicator: "I18", val_indicator: 0, val_den_indicator: "Profit net" },
        { indicator: "I19", val_indicator: 50, val_den_indicator: "Pierdere neta" },
        { indicator: "I20", val_indicator: 3, val_den_indicator: "Numar mediu de salariati" },
      ],
    });
    expect(year).toMatchObject({ year: 2025, revenue: 1000, profit: -50, employees: 3 });
    const xml =
      "<CautareDosareResult><Dosar><parti><DosarParte><nume>POPESCU ION</nume><calitateParte>Reclamant</calitateParte></DosarParte><DosarParte><nume>EXEMPLU DISTRIBUTIE SRL</nume><calitateParte>Pârât</calitateParte></DosarParte></parti><sedinte><DosarSedinta><data>2027-01-10T00:00:00</data><solutie>Amână</solutie></DosarSedinta></sedinte><numar>12/109/2026</numar><data>2026-03-02T00:00:00</data><institutie>TribunalulARGES</institutie><obiect>pretenții</obiect></Dosar></CautareDosareResult>";
    const cases = call<Array<Record<string, unknown>>>(
      company,
      "parseCases",
      xml,
      "EXEMPLU DISTRIBUTIE SRL",
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      number: "12/109/2026",
      started: "2026-03-02",
      court: "Tribunalul ARGES",
      role: "Pârât",
    });
    expect(JSON.stringify(cases)).not.toContain("POPESCU");
  });
});

describe("expenses", () => {
  it("finds the columns of a bank export, names merchants and flags double charges", async () => {
    const expenses = await load("finance-paperwork/monthly-expenses-report/expenses.mjs");
    const rows = [
      ["Extras de cont"],
      ["Data tranzactie", "Data valuta", "Descriere", "Debit", "Credit"],
      ["01.10.2026", "01.10.2026", "Plata la POS KAUFLAND BRASOV 4140****1234", "120,00", ""],
    ];
    const found = call<{ headerRow: number; cols: Record<string, number> }>(
      expenses,
      "detectColumns",
      rows,
      null,
    );
    expect(found.headerRow).toBe(1);
    expect(found.cols).toMatchObject({ date: 0, description: 2, debit: 3, credit: 4 });
    expect(call(expenses, "merchantOf", "Plata la POS KAUFLAND BRASOV 4140****1234")).toBe(
      "KAUFLAND BRASOV",
    );
    expect(call(expenses, "categorize", "ENEL ENERGIE plata factura", "ENEL ENERGIE", [])).toEqual({
      category: "Utilități și telecom",
    });
    expect(
      call(expenses, "categorize", "Transfer intre conturi proprii", "X", [
        { match: "intre conturi", ignore: true },
      ]),
    ).toEqual({ ignore: true });
    const t = (date: string, amount: number) => ({
      date,
      amount,
      merchant: "FAN COURIER",
      category: "Curierat și livrare",
      currency: "RON",
      description: "",
    });
    const L = {
      dup: (d: string) => `dup ${d}`,
      largeMerchant: () => "",
      largeCategory: () => "",
      newMerchant: "",
      priceChange: () => "",
      fx: () => "",
      uncategorised: "",
    };
    const flags = call<Array<{ kind: string }>>(
      expenses,
      "findAnomalies",
      [t("2026-10-21", -48.5), t("2026-10-21", -48.5)],
      "2026-10",
      L,
    );
    expect(flags.map((f) => f.kind)).toEqual(["duplicate"]);
  });
});

describe("restaurant scripts", () => {
  it("costs recipes with unit conversion and yield, and rounds menu prices", async () => {
    const foodcost = await load("horeca-kit/food-cost-pricing/foodcost.mjs");
    expect(call(foodcost, "convert", 800, "g", "kg")).toBe(0.8);
    expect(call(foodcost, "convert", 1, "buc", "kg")).toBeNull();
    expect(call(foodcost, "menuPrice", 15.2)).toBe(15.5);
    expect(call(foodcost, "menuPrice", 23.1)).toBe(24);
    const result = call<{ dishes: Array<Record<string, number>> }>(foodcost, "costRecipes", {
      target_food_cost: 30,
      vat: 11,
      ingredients: [
        { name: "Carne", unit: "kg", price: 30 },
        { name: "Ceapă", unit: "kg", price: 3, yield: 0.75 },
      ],
      recipes: [
        {
          name: "X",
          portions: 2,
          price: 22.2,
          price_includes_vat: true,
          lines: [
            { ingredient: "Carne", qty: 200, unit: "g" },
            { ingredient: "Ceapă", qty: 300, unit: "g" },
          ],
        },
      ],
    });
    const dish = result.dishes[0]!;
    // (0.2 * 30 + 0.3 / 0.75 * 3) / 2 = 3.6; net price 22.2 / 1.11 = 20
    expect(dish.portionCost).toBeCloseTo(3.6, 6);
    expect(dish.netPrice).toBeCloseTo(20, 6);
    expect(dish.foodCost).toBeCloseTo(0.18, 6);
  });

  it("puts late-night sales on the business day of the shift", async () => {
    const sales = await load("horeca-kit/shift-sales-report/sales.mjs");
    const shifts = call<unknown[]>(sales, "parseShifts", "Prânz=10:00-15:00,Noapte=18:00-02:00");
    expect(shifts).toHaveLength(2);
    expect(call(sales, "shiftOf", "2026-10-11", 60, shifts)).toEqual({
      shift: "Noapte",
      day: "2026-10-10",
    });
    expect(call(sales, "shiftOf", "2026-10-11", 12 * 60, shifts)).toEqual({
      shift: "Prânz",
      day: "2026-10-11",
    });
  });

  it("orders up to the target, rounded to packs, never on a guessed usage", async () => {
    const order = await load("horeca-kit/supplier-order/order.mjs");
    const line = call<Record<string, unknown>>(
      order,
      "orderLine",
      { name: "Cartofi", stock: 12, daily_use: 9, min: 10, pack: 10, lead_days: 1, price: 2.8 },
      3,
    );
    // 9 * (1 + 3) + 10 = 46; need 34 -> 4 sacks of 10
    expect(line.qty).toBe(40);
    expect(line.value).toBe(112);
    const unknown = call<Record<string, unknown>>(
      order,
      "orderLine",
      { name: "Leuștean", stock: 3 },
      3,
    );
    expect(unknown.qty).toBe(0);
    expect(unknown.problems).toEqual(["no-usage"]);
  });
});

describe("content scripts", () => {
  it("knows the Orthodox Easter and the weekdays of a month", async () => {
    const month = await load("marketing-content/content-calendar-month/month.mjs");
    expect([2025, 2026, 2027].map((y) => call(month, "orthodoxEaster", y))).toEqual([
      "2025-04-20",
      "2026-04-12",
      "2027-05-02",
    ]);
    const days = call<Array<{ date: string; special: string[] }>>(month, "monthDays", "2026-12");
    expect(days).toHaveLength(31);
    expect(days[0]?.special.join(" ")).toMatch(/Ziua Națională|National Day/);
  });

  it("builds the FAQ data and checks an article", async () => {
    const article = await load("marketing-content/seo-blog-article/article.mjs");
    const md =
      "## Întrebări frecvente\n\n### Ce e food cost?\n\nCostul ingredientelor.\n\n### Cum îl scad?\n\nCu porții corecte.\n";
    expect(call(article, "faqOf", md)).toEqual([
      { q: "Ce e food cost?", a: "Costul ingredientelor." },
      { q: "Cum îl scad?", a: "Cu porții corecte." },
    ]);
    const { meta, body } = call<{ meta: Record<string, string>; body: string }>(
      article,
      "parseFrontmatter",
      '---\ntitle: "Food cost"\nslug: food-cost\n---\n' + md,
    );
    expect(meta.slug).toBe("food-cost");
    const report = call<{ passed: boolean; checks: Array<{ ok: boolean; message: string }> }>(
      article,
      "checkArticle",
      meta,
      body,
      "https://exemplu.ro",
      "ro",
    );
    expect(report.passed).toBe(false);
    expect(call<string>(article, "markdownToHtml", "Vezi [meniul](/meniu/) **azi**.")).toBe(
      '<p>Vezi <a href="/meniu/">meniul</a> <strong>azi</strong>.</p>',
    );
  });
});

describe("scripts run end to end", () => {
  it("food cost writes a workbook and a summary", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "packs3-"));
    const data = NodePath.join(dir, "recipes.json");
    NodeFS.writeFileSync(
      data,
      JSON.stringify({
        ingredients: [{ name: "Orez", unit: "kg", price: 6 }],
        recipes: [
          {
            name: "Pilaf",
            portions: 4,
            price: 20,
            price_includes_vat: true,
            lines: [
              { ingredient: "Orez", qty: 400, unit: "g" },
              { ingredient: "Lipsă", qty: 1, unit: "kg" },
            ],
          },
        ],
      }),
    );
    const out = NodePath.join(dir, "fc.xlsx");
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.execPath, [
      file("horeca-kit/food-cost-pricing/foodcost.mjs"),
      "--data",
      data,
      "--out",
      out,
    ]);
    const summary = JSON.parse(
      NodeFS.readFileSync(NodePath.join(dir, "fc.summary.json"), "utf8"),
    ) as { problems: unknown[]; dishes: Array<{ complete: boolean }> };
    expect(NodeFS.statSync(out).size).toBeGreaterThan(1000);
    expect(summary.dishes[0]?.complete).toBe(false);
    expect(summary.problems).toHaveLength(1);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
});
