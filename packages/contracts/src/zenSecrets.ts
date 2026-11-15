// Zen Staff: spots (and redacts) text that looks like a password, API key or personal identifier.
// The Academy warns before sending; company memory redacts summaries before they leave the
// machine. Few false alarms: known key formats, values assigned to a secret name, checksummed
// numbers (CNP, card). Pure, shared by web and server.

export type SensitiveKind =
  | "private-key"
  | "api-key"
  | "token"
  | "connection-string"
  | "password"
  | "cnp"
  | "card";

/** Formats with a recognizable prefix or shape. */
const KEY_PATTERNS: ReadonlyArray<{ readonly kind: SensitiveKind; readonly pattern: RegExp }> = [
  { kind: "private-key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { kind: "api-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "api-key", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { kind: "api-key", pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { kind: "api-key", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "api-key", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "api-key", pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: "api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "api-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: "api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "api-key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { kind: "api-key", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { kind: "token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    kind: "connection-string",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s:/@]+:[^\s@/]{3,}@/i,
  },
];

/** `password = X`, `API_KEY: "X"`, `parola: X`. */
const ASSIGNMENT =
  /(?:^|[\s"'`{,;(])(?:[A-Za-z0-9_.-]*?)(password|passwd|pwd|pass|parola|parolă|secret|api[_-]?key|apikey|access[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|token)["'`]?\s*[:=]\s*["'`]?([^\s"'`,;]{6,})/giu;

/** "my password is X", "parola mea este X", "parola de la contul furnizorului e X". */
const SENTENCE =
  /\b(?:password|passcode|parola|parolă)(?:\s+[^\s:=.!?]+){0,6}?\s+(?:is|este|e)\s*:?\s+["'`]?([^\s"'`,;]{6,})/giu;

const PLACEHOLDER =
  /^(?:<.*>|\[.*\]|\{.*\}|\$\{?.*|\*+|x{3,}|\.{3,}|(?:your|my|the)[-_].*|.*example.*|.*placeholder.*|changeme|redacted|hidden|secret|password|required|optional|undefined|null|none|true|false|process\.env.*|env\..*|os\.environ.*)$/i;

/** A value that reads like a real secret: long enough, not a placeholder, mixes character kinds. */
function looksLikeSecretValue(value: string): boolean {
  if (PLACEHOLDER.test(value.trim())) return false;
  const trimmed = value.trim().replace(/[.)\]}]+$/, "");
  if (trimmed.length < 6 || trimmed.length > 200) return false;
  if (PLACEHOLDER.test(trimmed)) return false;
  // Code that reads a secret is not the secret: `response.data.token`, `getToken()`, `opts.key`.
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(.*)?$/.test(trimmed) && !/\d/.test(trimmed)) {
    return false;
  }
  const hasLetter = /\p{L}/u.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const hasSymbol = /[^\p{L}\d]/u.test(trimmed);
  const hasUpper = /\p{Lu}/u.test(trimmed);
  const hasLower = /\p{Ll}/u.test(trimmed);
  // Plain words ("weak", "required", "parolamea") are not secrets.
  if (hasLetter && !hasDigit && !hasSymbol && !(hasUpper && hasLower && trimmed.length >= 12)) {
    return false;
  }
  // Pure numbers shorter than a PIN-like secret: years, amounts.
  if (!hasLetter && !hasSymbol && trimmed.length < 8) return false;
  return true;
}

/** Valid Romanian CNP: 13 digits, first 1-9, a plausible date, and the control digit. */
export function isValidCnp(digits: string): boolean {
  if (!/^[1-9]\d{12}$/.test(digits)) return false;
  const month = Number(digits.slice(3, 5));
  const day = Number(digits.slice(5, 7));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const weights = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  let sum = 0;
  for (let index = 0; index < 12; index++) sum += Number(digits[index]) * weights[index]!;
  const control = sum % 11 === 10 ? 1 : sum % 11;
  return control === Number(digits[12]);
}

/** Luhn check for card numbers (13-19 digits). */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** The kinds of secret found in `text` (empty for normal text). */
export function detectSecrets(text: string): ReadonlyArray<SensitiveKind> {
  if (text.length < 6) return [];
  const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
  const found = new Set<SensitiveKind>();
  for (const { kind, pattern } of KEY_PATTERNS) if (pattern.test(sample)) found.add(kind);
  for (const match of sample.matchAll(ASSIGNMENT)) {
    if (looksLikeSecretValue(match[2] ?? "")) found.add("password");
  }
  for (const match of sample.matchAll(SENTENCE)) {
    if (looksLikeSecretValue(match[1] ?? "")) found.add("password");
  }
  return [...found];
}

/** Personal identifiers with a checksum: Romanian CNP and payment card numbers. */
export function detectPersonalData(text: string): ReadonlyArray<SensitiveKind> {
  const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
  const found = new Set<SensitiveKind>();
  for (const match of sample.matchAll(/(?<![\d.,])\d{13}(?!\d|[.,]\d)/g)) {
    if (isValidCnp(match[0])) found.add("cnp");
  }
  for (const match of sample.matchAll(/(?<![\d.,])(?:\d[ -]?){12,18}\d(?!\d|[.,]\d)/g)) {
    const digits = match[0].replace(/[ -]/g, "");
    // Card numbers start with 2-6; a 13-digit run that is a CNP is reported as a CNP above.
    if (/^[2-6]/.test(digits) && passesLuhn(digits) && !isValidCnp(digits)) found.add("card");
  }
  return [...found];
}

export function looksLikeSecret(text: string): boolean {
  return detectSecrets(text).length > 0;
}

/** What replaces a redacted value; the kind stays so a reader knows something was removed. */
function redactionMarker(kind: SensitiveKind): string {
  return `[redacted ${kind}]`;
}

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g;

function replaceValueInMatch(match: string, value: string, marker: string): string {
  const at = match.lastIndexOf(value);
  return at < 0 ? match : match.slice(0, at) + marker + match.slice(at + value.length);
}

/**
 * The text with every detected secret and personal identifier replaced by a marker, and the kinds
 * that were found. Unlike the detectors it reads the whole text (no 20,000-character sample).
 */
export function redactSensitive(text: string): {
  readonly text: string;
  readonly kinds: ReadonlyArray<SensitiveKind>;
} {
  const found = new Set<SensitiveKind>();
  let result = text.replace(PRIVATE_KEY_BLOCK, () => {
    found.add("private-key");
    return redactionMarker("private-key");
  });
  for (const { kind, pattern } of KEY_PATTERNS) {
    if (kind === "private-key") continue;
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    result = result.replace(global, (match) => {
      found.add(kind);
      if (kind === "connection-string") {
        const scheme = /^[a-z+]+:\/\//i.exec(match)?.[0] ?? "";
        return `${scheme}${redactionMarker(kind)}@`;
      }
      return redactionMarker(kind);
    });
  }
  result = result.replace(ASSIGNMENT, (match, _name: string, value: string) => {
    if (!looksLikeSecretValue(value)) return match;
    found.add("password");
    return replaceValueInMatch(match, value, redactionMarker("password"));
  });
  result = result.replace(SENTENCE, (match, value: string) => {
    if (!looksLikeSecretValue(value)) return match;
    found.add("password");
    return replaceValueInMatch(match, value, redactionMarker("password"));
  });
  result = result.replace(/(?<![\d.,])\d{13}(?!\d|[.,]\d)/g, (match) => {
    if (!isValidCnp(match)) return match;
    found.add("cnp");
    return redactionMarker("cnp");
  });
  result = result.replace(/(?<![\d.,])(?:\d[ -]?){12,18}\d(?!\d|[.,]\d)/g, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (!/^[2-6]/.test(digits) || !passesLuhn(digits) || isValidCnp(digits)) return match;
    found.add("card");
    return redactionMarker("card");
  });
  return { text: result, kinds: [...found] };
}
