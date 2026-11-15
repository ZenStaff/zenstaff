// Zen Staff AI staff: the checker. Anything an agent wants to send, publish, pay or delete is
// reviewed before it reaches the manager: brand words and tone, prices against the company's
// price list and memory, leftovers and mistakes, and GDPR / consumer-protection (ANPC) basics.
// The rules are pure; an optional AI pass (Haiku) adds findings the rules cannot see.
import { detectPersonalData, detectSecrets } from "@t3tools/contracts/zenSecrets";
import type {
  StaffBrandBook,
  StaffCheckerFinding,
  StaffCheckerResult,
  StaffFindingSeverity,
  StaffLocale,
  StaffOutboundKind,
} from "@t3tools/contracts/zenStaff";

import { foldText } from "./staffModel.ts";

export interface CheckerInput {
  readonly content: string;
  readonly action: StaffOutboundKind;
  readonly target: string;
  readonly brand: StaffBrandBook;
  /** Prices found in company memory files ("item ... 25 lei" lines). */
  readonly memoryPrices: ReadonlyArray<{ readonly item: string; readonly price: number }>;
  readonly locale: StaffLocale;
}

const T = {
  en: {
    empty: "The content is empty.",
    placeholder: "A placeholder or unfinished text is left in.",
    cedilla: "Use ș and ț (comma below), not ş and ţ (cedilla).",
    price: (item: string, found: string, known: number) =>
      `${item}: the text says ${found}, the price list says ${known}.`,
    discount:
      "A discount or promotion is announced without the previous price. Consumer rules (ANPC) expect the reduced price next to the lowest price of the last 30 days.",
    free: '"Free" is used; if it comes with conditions (minimum order, limited stock), state them next to it.',
    personal: (kind: string) => `Personal data (${kind}) in content that leaves the company.`,
    secret: "Looks like a password, key or token. Never send it outside.",
    contact: "A phone number or e-mail address of a person is about to be published.",
    unsubscribe:
      "A message to many recipients without an unsubscribe line. GDPR marketing needs consent and an easy way to opt out.",
    banned: (word: string) => `"${word}" is on the brand's list of words not to use.`,
    shouting: "Shouting (capitals or !!!) does not fit a calm brand voice.",
    repeated: (word: string) => `Repeated word: "${word} ${word}".`,
    payment:
      "A payment: check the payee, the amount and the IBAN against the invoice before approving.",
    deletion: "A deletion cannot be undone; check exactly what is removed.",
  },
  ro: {
    empty: "Conținutul e gol.",
    placeholder: "A rămas un text de completat sau neterminat.",
    cedilla: "Folosește ș și ț (cu virgulă), nu ş și ţ (cu sedilă).",
    price: (item: string, found: string, known: number) =>
      `${item}: textul spune ${found}, lista de prețuri spune ${known}.`,
    discount:
      "Se anunță o reducere sau o promoție fără prețul anterior. Regulile de protecție a consumatorului (ANPC) cer prețul redus lângă cel mai mic preț din ultimele 30 de zile.",
    free: "Apare „gratuit”; dacă are condiții (comandă minimă, stoc limitat), scrie-le lângă.",
    personal: (kind: string) => `Date personale (${kind}) într-un conținut care iese din firmă.`,
    secret: "Pare o parolă, o cheie sau un token. Nu le trimite niciodată în afară.",
    contact: "Se publică numărul de telefon sau adresa de e-mail a unei persoane.",
    unsubscribe:
      "Un mesaj către mai mulți destinatari fără rândul de dezabonare. Marketingul cere consimțământ (GDPR) și o cale simplă de renunțare.",
    banned: (word: string) => `„${word}” e pe lista cuvintelor pe care brandul nu le folosește.`,
    shouting: "Strigătul (majuscule sau !!!) nu se potrivește unei voci calme a brandului.",
    repeated: (word: string) => `Cuvânt repetat: „${word} ${word}”.`,
    payment: "O plată: verifică beneficiarul, suma și IBAN-ul față de factură înainte de aprobare.",
    deletion: "O ștergere nu se poate anula; verifică exact ce se șterge.",
  },
} as const;

const PRICE_PATTERN = /(\d{1,6}(?:[.,]\d{1,2})?)\s?(lei|ron|eur|euro|€|\$|usd)(?![a-z])/gi;
const HAS_PRICE = /\d\s?(lei|ron|eur|euro|€|\$|usd)(?![a-z])/i;

function parseAmount(raw: string): number {
  return Number(raw.replace(",", "."));
}

function finding(
  rule: string,
  severity: StaffFindingSeverity,
  message: string,
  excerpt: string,
): StaffCheckerFinding {
  return { rule, severity, message, excerpt: excerpt.slice(0, 200), source: "rules" };
}

/** "Pizza Margherita - 32 lei" style lines in memory files. */
export function extractPriceLines(markdown: string): Array<{ item: string; price: number }> {
  const out: Array<{ item: string; price: number }> = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match =
      /^[\s*\-•|]*([^:|\n]{3,60}?)\s*[:|\-–]\s*(\d{1,6}(?:[.,]\d{1,2})?)\s?(lei|ron|eur|euro|€)(?![a-z])/i.exec(
        line,
      );
    if (match === null) continue;
    out.push({ item: match[1]!.trim(), price: parseAmount(match[2]!) });
  }
  return out;
}

export function runCheckerRules(input: CheckerInput): StaffCheckerFinding[] {
  const t = T[input.locale];
  const text = input.content;
  const findings: StaffCheckerFinding[] = [];
  if (text.trim().length < 3) return [finding("empty", "high", t.empty, "")];

  const placeholder =
    /\[(?:[^\]\n]{1,40})\]|\{\{[^}\n]*\}\}|lorem ipsum|\bTODO\b|\bTBD\b|\bXXX\b/i.exec(text);
  // Markdown links "[text](url)" are not placeholders.
  if (placeholder !== null && !/^\[[^\]]*\]\(/.test(text.slice(placeholder.index))) {
    findings.push(finding("placeholder", "high", t.placeholder, placeholder[0]));
  }
  const cedilla = /[şţŞŢ]/.exec(text);
  if (cedilla !== null) {
    const start = Math.max(0, cedilla.index - 15);
    findings.push(finding("cedilla", "low", t.cedilla, text.slice(start, cedilla.index + 15)));
  }

  // Prices: each priced item named near a price must match the price list (brand book first,
  // then memory files).
  const known = [...input.brand.prices, ...input.memoryPrices];
  const foldedText = foldText(text);
  for (const match of text.matchAll(PRICE_PATTERN)) {
    const amount = parseAmount(match[1]!);
    const windowStart = Math.max(0, (match.index ?? 0) - 80);
    const before = foldText(text.slice(windowStart, match.index ?? 0));
    const candidate = known
      .filter(
        (entry) => entry.item.trim().length >= 3 && before.includes(foldText(entry.item.trim())),
      )
      .toSorted(
        (left, right) =>
          before.lastIndexOf(foldText(right.item.trim())) -
          before.lastIndexOf(foldText(left.item.trim())),
      )[0];
    if (candidate !== undefined && Math.abs(candidate.price - amount) > 0.001) {
      findings.push(
        finding("price", "high", t.price(candidate.item, match[0], candidate.price), match[0]),
      );
    }
  }

  const promo =
    /(reducere|discount|promo[tț]i|oferta speciala|ofertă specială|-\s?\d{1,2}\s?%|\bsale\b|black friday)/i.exec(
      text,
    );
  const hasOldPrice =
    /(pre[tț] (vechi|anterior|initial|inițial)|de la \d+[^\n]{0,20}la \d+|was \d|previous price|old price|cel mai mic pre[tț]|lowest price|~~\d)/i.test(
      text,
    );
  if (promo !== null && HAS_PRICE.test(text) && !hasOldPrice) {
    findings.push(finding("anpc-discount", "medium", t.discount, promo[0]));
  }
  const free = /\b(gratuit|gratis|free)\b/i.exec(text);
  if (free !== null && input.action !== "pay") {
    findings.push(finding("anpc-free", "low", t.free, free[0]));
  }

  for (const kind of detectPersonalData(text)) {
    findings.push(
      finding("gdpr-personal-data", "high", t.personal(kind === "cnp" ? "CNP" : kind), kind),
    );
  }
  if (detectSecrets(text).length > 0) findings.push(finding("secret", "high", t.secret, ""));
  if (input.action === "publish") {
    const contact = /(\+?40|0)7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|[\w.+-]+@[\w-]+\.[\w.]+/.exec(text);
    if (contact !== null) findings.push(finding("gdpr-contact", "medium", t.contact, contact[0]));
  }
  const massMail =
    /(newsletter|abona[tț]i|campanie|campaign|subscribers|to all customers|tuturor clien[tț]ilor)/i.test(
      `${input.target} ${text}`,
    );
  if (
    input.action === "send" &&
    massMail &&
    !/(dezabon|unsubscribe|opt[- ]out|renun[tț]a)/i.test(text)
  ) {
    findings.push(finding("gdpr-unsubscribe", "medium", t.unsubscribe, input.target));
  }

  for (const word of input.brand.bannedWords) {
    const folded = foldText(word.trim());
    if (folded.length < 2) continue;
    const index = foldedText.indexOf(folded);
    if (index !== -1)
      findings.push(
        finding("brand-word", "medium", t.banned(word), text.slice(index, index + word.length)),
      );
  }
  const shouting = /\b[A-ZĂÂÎȘȚ]{4,}(?:\s+[A-ZĂÂÎȘȚ]{2,}){2,}\b|!{3,}/.exec(text);
  if (shouting !== null) findings.push(finding("tone-shouting", "low", t.shouting, shouting[0]));
  const repeated = /\b([\p{L}]{3,})\s+\1\b/iu.exec(text);
  if (repeated !== null)
    findings.push(finding("repeated-word", "low", t.repeated(repeated[1]!), repeated[0]));

  if (input.action === "pay") findings.push(finding("payment", "medium", t.payment, input.target));
  if (input.action === "delete")
    findings.push(finding("deletion", "medium", t.deletion, input.target));
  return findings;
}

/** The prompt for the AI pass: returns a JSON array, which `parseAiFindings` reads. */
export function checkerAiPrompt(input: CheckerInput): string {
  const lang = input.locale === "ro" ? "Romanian" : "English";
  return [
    "You review content an AI employee wants to send or publish for a company, before a human manager approves it.",
    "Check: brand tone, factual mistakes, wrong or invented prices/dates compared to the price list, unclear or rude wording, legal basics (GDPR consent and personal data, Romanian consumer protection ANPC: discounts, free offers, prices with currency).",
    'Answer ONLY with a JSON array (possibly empty) of objects {"rule": short-kebab-id, "severity": "high"|"medium"|"low", "message": one sentence in ' +
      lang +
      ', "excerpt": the exact words from the content}.',
    "Report only real problems; at most 6.",
    "",
    `Action: ${input.action}. Target: ${input.target || "(not given)"}.`,
    input.brand.tone ? `Brand tone: ${input.brand.tone}` : "Brand tone: not given.",
    input.brand.prices.length + input.memoryPrices.length > 0
      ? `Price list: ${[...input.brand.prices, ...input.memoryPrices]
          .slice(0, 60)
          .map((entry) => `${entry.item} = ${entry.price}`)
          .join("; ")}`
      : "Price list: not given.",
    "",
    "Content:",
    "<<<",
    input.content.slice(0, 12_000),
    ">>>",
  ].join("\n");
}

export function parseAiFindings(raw: string): StaffCheckerFinding[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 6).flatMap((item): StaffCheckerFinding[] => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message === "") return [];
    const severity: StaffFindingSeverity =
      record.severity === "high" || record.severity === "low" ? record.severity : "medium";
    return [
      {
        rule: typeof record.rule === "string" ? record.rule.slice(0, 40) : "ai",
        severity,
        message: message.slice(0, 400),
        excerpt: typeof record.excerpt === "string" ? record.excerpt.slice(0, 200) : "",
        source: "ai",
      },
    ];
  });
}

const SEVERITY_ORDER: Record<StaffFindingSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Rules + AI findings, deduplicated (same excerpt and rule family), most severe first. */
export function mergeCheckerResult(
  rules: ReadonlyArray<StaffCheckerFinding>,
  ai: ReadonlyArray<StaffCheckerFinding> | null,
  at: string,
): StaffCheckerResult {
  const all: StaffCheckerFinding[] = [...rules];
  for (const item of ai ?? []) {
    const duplicate = all.some(
      (existing) =>
        existing.excerpt !== "" &&
        item.excerpt !== "" &&
        (existing.excerpt.includes(item.excerpt) || item.excerpt.includes(existing.excerpt)) &&
        existing.rule.split("-")[0] === item.rule.split("-")[0],
    );
    if (!duplicate) all.push(item);
  }
  const findings = all.toSorted(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );
  return {
    status: findings.some((item) => item.severity !== "low") ? "issues" : "ok",
    findings,
    aiChecked: ai !== null,
    at,
  };
}
