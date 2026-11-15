// Checks a Romanian company by CUI in official public sources (ANAF VAT v9, ANAF balance sheets,
// portal.just.ro) and saves every answer with its fetch time. ANAF allows one request a second.
//   node company.mjs --cui RO12345678 --out <folder> [--years 4] [--no-courts]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fold = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const SOURCES = {
  tva: {
    name: "ANAF – serviciul web de verificare a plătitorilor de TVA (v9)",
    url: "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva",
    docs: "https://www.anaf.ro/anaf/internet/ANAF/servicii_online/servicii_web_anaf",
  },
  bilant: {
    name: "ANAF – serviciul web pentru situațiile financiare anuale",
    url: "https://webservicesp.anaf.ro/bilant",
    docs: "https://www.anaf.ro/anaf/internet/ANAF/servicii_online/servicii_web_anaf",
  },
  courts: {
    name: "Ministerul Justiției – portalul instanțelor (portal.just.ro), serviciul web de căutare a dosarelor",
    url: "http://portalquery.just.ro/query.asmx",
    docs: "https://portal.just.ro/",
  },
};

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

async function fetchText(url, init, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "User-Agent": "company-check (public data lookup)", ...init?.headers },
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      if (response.status === 429 || response.status >= 500)
        throw new Error(`HTTP ${response.status}`);
      return { status: response.status, text };
    } catch (error) {
      last = error;
      await sleep(2000 * (i + 1));
    }
  }
  throw last;
}

/** Indicator value by its ANAF label (the codes I1..I20 differ between balance sheet types). */
export function indicator(list, ...names) {
  for (const name of names) {
    const hit = (list ?? []).find((i) =>
      fold(i.val_den_indicator).replace(/\s+/g, " ").trim().startsWith(fold(name)),
    );
    if (hit) return Number(hit.val_indicator);
  }
  return null;
}

export function financialYear(json) {
  const list = json?.i ?? [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const profit = indicator(list, "Profit net", "Profitul net");
  const loss = indicator(list, "Pierdere neta", "Pierderea neta");
  return {
    year: json.an,
    caen: json.caen ?? null,
    caenName: json.den_caen ?? null,
    revenue: indicator(list, "Cifra de afaceri neta", "Cifra de afaceri"),
    totalIncome: indicator(list, "VENITURI TOTALE"),
    totalExpenses: indicator(list, "CHELTUIELI TOTALE"),
    profit:
      profit !== null && profit > 0
        ? profit
        : loss !== null && loss > 0
          ? -loss
          : (profit ?? 0) - (loss ?? 0),
    employees: indicator(list, "Numar mediu de salariati", "Numarul mediu de salariati"),
    debts: indicator(list, "DATORII"),
    equity: indicator(list, "CAPITALURI - TOTAL", "CAPITALURI PROPRII", "Capitaluri - total"),
    cash: indicator(list, "Casa si conturi la banci"),
    receivables: indicator(list, "Creante"),
    stocks: indicator(list, "Stocuri"),
    subscribedCapital: indicator(list, "Capital subscris varsat"),
  };
}

/** Court cases from the SOAP answer, without the names of private persons. */
export function parseCases(xml, companyName) {
  const cases = [];
  const tag = (block, name) => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
    return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
  };
  const want = fold(companyName)
    .replace(/\b(s\.?r\.?l\.?|s\.?a\.?|sc|s\.c\.)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const isCompany = (name) =>
    /\b(s\.?r\.?l|s\.?a|s\.?c|srl|sa|sca|snc|pfa|ii|if|regia|primaria|anaf|directia|ministerul|unitatea|banca|bank|ifn|asociatia|fundatia|cooperativa|societatea|ltd|gmbh|inc|company|consiliul|agentia|casa|institutia|oficiul)\b/i.test(
      fold(name),
    );
  for (const block of xml.split("<Dosar>").slice(1)) {
    const parts = [...block.matchAll(/<DosarParte>([\s\S]*?)<\/DosarParte>/g)].map((m) => ({
      name: tag(m[1], "nume"),
      role: tag(m[1], "calitateParte"),
    }));
    const ours = parts.find((p) =>
      fold(p.name)
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .includes(want),
    );
    if (!ours) continue;
    const own = block.replace(/<(parti|sedinte|caiAtac)>[\s\S]*?<\/\1>/g, "");
    const sessions = [...block.matchAll(/<DosarSedinta>([\s\S]*?)<\/DosarSedinta>/g)].map((m) => ({
      date: tag(m[1], "data").slice(0, 10),
      outcome: tag(m[1], "solutie"),
    }));
    sessions.sort((a, b) => b.date.localeCompare(a.date));
    const object = tag(own, "obiect");
    cases.push({
      number: tag(own, "numar"),
      started: tag(own, "data").slice(0, 10),
      court: courtName(tag(own, "institutie")),
      object,
      category: tag(own, "categorieCazNume") || tag(own, "categorieCaz"),
      stage: tag(own, "stadiuProcesualNume") || tag(own, "stadiuProcesual"),
      role: ours.role,
      otherParties: parts
        .filter((p) => p !== ours)
        .map((p) => (isCompany(p.name) ? `${p.name} (${p.role})` : `persoană fizică (${p.role})`)),
      lastHearing: sessions[0] ?? null,
      insolvency: /insolven|faliment|85\/2014|reorganizare judiciara|lichidare/i.test(
        fold(object) + " " + fold(tag(own, "categorieCazNume")),
      ),
    });
  }
  cases.sort((a, b) => b.started.localeCompare(a.started));
  return cases;
}

/** "TribunalulARGES" -> "Tribunalul ARGES", "CurteadeApelPITESTI" -> "Curtea de Apel PITESTI". */
export function courtName(raw) {
  return String(raw ?? "")
    .replace(/^Curteade/, "Curtea de ")
    .replace(/([a-zăâîșț])([A-ZĂÂÎȘȚ0-9])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

const xmlEscape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  const raw = opt("cui");
  const outDir = opt("out");
  const years = Math.min(6, Math.max(1, Number(opt("years", "4"))));
  if (!raw || !outDir) fail("Use --cui <CUI> --out <folder> [--years 4] [--no-courts].");
  const cui = String(raw).toUpperCase().replace(/^RO/, "").replace(/\D/g, "");
  NodeFS.mkdirSync(outDir, { recursive: true });
  const evidence = [];
  const save = (name, text, source, url) => {
    const file = NodePath.join(outDir, name);
    NodeFS.writeFileSync(file, text);
    evidence.push({
      source: source.name,
      url,
      file: NodePath.resolve(file),
      fetchedAt: new Date().toISOString(),
    });
  };
  const result = {
    cui,
    cuiValid: validCui(cui),
    checkedAt: new Date().toISOString(),
    sources: SOURCES,
    evidence,
    problems: [],
  };
  if (!result.cuiValid) {
    result.problems.push(
      `CUI ${cui} fails the control digit check: it is mistyped or not a Romanian company code.`,
    );
    NodeFS.writeFileSync(NodePath.join(outDir, "company.json"), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);

  // 1. ANAF registry and VAT
  try {
    const { status, text } = await fetchText(SOURCES.tva.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ cui: Number(cui), data: today }]),
    });
    save(`anaf-tva-${today}.json`, text, SOURCES.tva, SOURCES.tva.url);
    const json = JSON.parse(text);
    const found = json.found?.[0];
    if (status !== 200 || !found) {
      result.registry = null;
      result.problems.push(
        `ANAF does not know CUI ${cui} (${json.notFound?.length ? "not found" : `HTTP ${status}`}).`,
      );
    } else {
      const g = found.date_generale ?? {};
      const inactive = found.stare_inactiv ?? {};
      result.registry = {
        name: g.denumire,
        address: g.adresa,
        regCom: g.nrRegCom,
        caen: g.cod_CAEN,
        registeredOn: g.data_inregistrare,
        status: g.stare_inregistrare,
        legalForm: g.forma_juridica,
        organization: g.forma_organizare,
        ownership: g.forma_de_proprietate,
        taxOffice: g.organFiscalCompetent,
        phone: g.telefon || null,
        vatPayer: found.inregistrare_scop_Tva?.scpTVA === true,
        vatPeriods: found.inregistrare_scop_Tva?.perioade_TVA ?? [],
        vatOnCollection: found.inregistrare_RTVAI?.statusTvaIncasare === true,
        splitVat: found.inregistrare_SplitTVA?.statusSplitTVA === true,
        inactive: inactive.statusInactivi === true,
        inactiveSince: inactive.dataInactivare || null,
        reactivatedOn: inactive.dataReactivare || null,
        deregisteredOn: inactive.dataRadiere || null,
      };
    }
  } catch (error) {
    result.problems.push(
      `ANAF VAT service did not answer (${error.message}); try again in a few minutes.`,
    );
  }

  // 2. ANAF financial statements, newest first
  result.financials = [];
  const thisYear = new Date().getFullYear();
  for (let year = thisYear - 1; year >= thisYear - years; year--) {
    await sleep(1200);
    const url = `${SOURCES.bilant.url}?an=${year}&cui=${cui}`;
    try {
      const { text } = await fetchText(url, {});
      save(`anaf-bilant-${year}.json`, text, SOURCES.bilant, url);
      const parsed = financialYear(JSON.parse(text));
      result.financials.push(parsed ?? { year, missing: true });
    } catch (error) {
      result.financials.push({ year, error: error.message });
    }
  }

  // 3. Court cases (portal.just.ro), last 3 years, by the official name
  if (!args.includes("--no-courts") && result.registry?.name) {
    const start = `${thisYear - 3}-01-01T00:00:00`;
    const name = result.registry.name.replace(/\b(S\.?R\.?L\.?|S\.?A\.?)$/i, "").trim();
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CautareDosare xmlns="portalquery.just.ro"><numeParte>${xmlEscape(name)}</numeParte><dataStart>${start}</dataStart><dataStop>${today}T00:00:00</dataStop></CautareDosare></soap:Body></soap:Envelope>`;
    try {
      const { status, text } = await fetchText(SOURCES.courts.url, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '"portalquery.just.ro/CautareDosare"',
        },
        body,
      });
      save(
        `portal-just-dosare-${today}.xml`,
        text,
        SOURCES.courts,
        `${SOURCES.courts.url} (CautareDosare, numeParte="${name}", from ${start.slice(0, 10)})`,
      );
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const cases = parseCases(text, result.registry.name);
      result.courts = {
        searchedName: name,
        since: start.slice(0, 10),
        total: cases.length,
        insolvency: cases.filter((c) => c.insolvency).length,
        byRole: Object.fromEntries(
          [...new Set(cases.map((c) => c.role))].map((role) => [
            role,
            cases.filter((c) => c.role === role).length,
          ]),
        ),
        recent: cases.slice(0, 15),
        capped: (text.match(/<Dosar>/g) ?? []).length >= 1000,
      };
    } catch (error) {
      result.courts = null;
      result.problems.push(
        `Court portal did not answer (${error.message}); check by hand on portal.just.ro.`,
      );
    }
  }

  // 4. Plain signals for the report (the assistant explains them; it does not add new ones)
  const signals = [];
  const r = result.registry;
  const fin = result.financials.filter(
    (f) => f && f.revenue !== undefined && !f.missing && !f.error,
  );
  if (r) {
    if (r.deregisteredOn)
      signals.push({ level: "red", code: "deregistered", fact: `radiată la ${r.deregisteredOn}` });
    if (r.inactive)
      signals.push({
        level: "red",
        code: "inactive",
        fact: `declarată inactivă fiscal din ${r.inactiveSince}`,
      });
    if (/radiat|dizolv|lichid|insolv|suspend/i.test(fold(r.status)))
      signals.push({ level: "red", code: "status", fact: `stare: ${r.status}` });
    const age = r.registeredOn
      ? (Date.now() - Date.parse(r.registeredOn)) / (365.25 * 86400000)
      : null;
    if (age !== null && age < 1)
      signals.push({
        level: "amber",
        code: "young",
        fact: `înființată de mai puțin de un an (${r.registeredOn})`,
      });
    else if (age !== null && age >= 5)
      signals.push({
        level: "green",
        code: "established",
        fact: `activă din ${r.registeredOn} (${Math.floor(age)} ani)`,
      });
    if (!r.vatPayer)
      signals.push({
        level: "info",
        code: "no-vat",
        fact: "nu e plătitoare de TVA (facturile ei nu au TVA)",
      });
    if (r.vatOnCollection)
      signals.push({ level: "info", code: "vat-collection", fact: "aplică TVA la încasare" });
    if (r.splitVat)
      signals.push({
        level: "amber",
        code: "split-vat",
        fact: "înscrisă în registrul de plată defalcată a TVA",
      });
  }
  const latest = fin[0];
  if (r && fin.length === 0)
    signals.push({
      level: "amber",
      code: "no-statements",
      fact: "nu apar situații financiare publicate la ANAF pentru anii căutați",
    });
  if (latest) {
    if (latest.equity !== null && latest.equity < 0)
      signals.push({
        level: "red",
        code: "negative-equity",
        fact: `capitaluri proprii negative în ${latest.year}: ${latest.equity} lei`,
      });
    if (
      latest.revenue !== null &&
      latest.debts !== null &&
      latest.revenue > 0 &&
      latest.debts > 2 * latest.revenue
    )
      signals.push({
        level: "amber",
        code: "debts",
        fact: `datorii de ${Math.round(latest.debts / latest.revenue)} ori cifra de afaceri în ${latest.year}`,
      });
    if (latest.profit !== null && latest.profit < 0)
      signals.push({
        level: "amber",
        code: "loss",
        fact: `pierdere în ${latest.year}: ${latest.profit} lei`,
      });
    if (latest.revenue === 0)
      signals.push({
        level: "amber",
        code: "no-revenue",
        fact: `cifră de afaceri zero în ${latest.year}`,
      });
    if (latest.employees === 0 && latest.revenue > 1000000)
      signals.push({
        level: "info",
        code: "no-staff",
        fact: `fără angajați declarați, cu cifră de afaceri de ${latest.revenue} lei în ${latest.year}`,
      });
    const previous = fin[1];
    if (previous?.revenue > 0 && latest.revenue !== null) {
      const change = (latest.revenue - previous.revenue) / previous.revenue;
      if (change <= -0.3)
        signals.push({
          level: "amber",
          code: "revenue-drop",
          fact: `cifra de afaceri a scăzut cu ${Math.round(-change * 100)}% în ${latest.year} față de ${previous.year}`,
        });
      if (change >= 0.2)
        signals.push({
          level: "green",
          code: "revenue-growth",
          fact: `cifra de afaceri a crescut cu ${Math.round(change * 100)}% în ${latest.year} față de ${previous.year}`,
        });
    }
    if (latest.profit > 0 && latest.equity > 0)
      signals.push({
        level: "green",
        code: "profitable",
        fact: `profit și capitaluri proprii pozitive în ${latest.year}`,
      });
  }
  if (result.courts?.insolvency)
    signals.push({
      level: "red",
      code: "insolvency-case",
      fact: `${result.courts.insolvency} dosar(e) cu obiect de insolvență în ultimii 3 ani`,
    });
  else if (result.courts && result.courts.total >= 10)
    signals.push({
      level: "amber",
      code: "many-cases",
      fact: `${result.courts.total} dosare în instanță în ultimii 3 ani`,
    });
  result.signals = signals;
  NodeFS.writeFileSync(NodePath.join(outDir, "company.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ ...result, sources: undefined }, null, 1));
}

if (process.argv[1] && NodePath.resolve(process.argv[1]).endsWith("company.mjs")) main();
