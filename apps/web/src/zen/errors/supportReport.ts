// Zen Staff: where an error report goes. No public issue tracker (the repository is private): the
// error screens open an e-mail to ZED-ZEN with the technical details filled in, and offer to copy
// them. Dependency-free, so the boot error screen can use it before the app loads.

/** Zen Staff support address (mirrors ZEN_SUPPORT_EMAIL in @t3tools/contracts/zen). */
const ZEN_SUPPORT_EMAIL = "support@zenstaff.app";

/** Long reports are cut so the mail link stays under the limits of mail apps (about 2,000 chars). */
const MAX_BODY_CHARS = 1_500;

/** A mailto: link with the subject and the start of the report; the full report is copied. */
export function supportMailto(subject: string, intro: string, report: string): string {
  const trimmed =
    report.length > MAX_BODY_CHARS ? `${report.slice(0, MAX_BODY_CHARS)}\n[...]` : report;
  const body = `${intro}\n\n\n---\n${trimmed}`;
  return `mailto:${ZEN_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * The language of the error screens before the app's own i18n loads: the saved choice
 * ("zen:locale"), else Romanian for a Romanian browser or a Romanian time zone, else English.
 */
export function bootLocale(): "ro" | "en" {
  try {
    const saved = globalThis.localStorage?.getItem("zen:locale");
    if (saved === "ro" || saved === "en") return saved;
  } catch {
    // Blocked storage: fall through to the browser's languages.
  }
  const languages = globalThis.navigator?.languages ?? [];
  if (languages.some((language) => language.toLowerCase().startsWith("ro"))) return "ro";
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === "Europe/Bucharest" || zone === "Europe/Chisinau") return "ro";
  } catch {
    // No Intl time zone: English.
  }
  return "en";
}
