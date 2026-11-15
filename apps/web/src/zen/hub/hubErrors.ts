// Zen Staff: the hub's and the company server's refusals in the person's language (review 0.2.3,
// P1-18). The hub answers in English ("Your role does not allow this (angajati: creeaza).",
// "You cannot invite with that role."); a member then reads the Romanian sentence with who to ask.
// Unknown messages pass through unchanged. Pure; hubErrors.test.ts.
import { getZenLocale, zenMessagesFor, zenText, type ZenLocale } from "../i18n/zenI18n";
import { hubErrorText } from "./hubErrors.i18n";
import { securityText } from "./security.i18n";

/** Exact sentences the hub and the company server send, with their Romanian. */
const KNOWN_RO: ReadonlyArray<readonly [RegExp, string]> = [
  [/^You cannot invite with that role\.?$/i, "Nu poți invita cu acest rol."],
  [
    /^Only owners and admins change the company'?s details\.?$/i,
    "Doar proprietarii și administratorii schimbă datele firmei.",
  ],
  [
    /^Only owners and admins change company settings\.?$/i,
    "Doar proprietarii și administratorii schimbă setările firmei.",
  ],
  [
    /^Only owners and admins can register a company runner\.?$/i,
    "Doar proprietarii și administratorii pot face un calculator serverul firmei.",
  ],
  [
    /^Only owners and admins unlock Enterprise packs\.?$/i,
    "Doar proprietarii și administratorii deblochează pachetele Enterprise.",
  ],
  [
    /^Only owners and admins install packs for the whole company\.?$/i,
    "Doar proprietarii și administratorii instalează pachete pentru toată firma.",
  ],
  [
    /^Only owners and admins define roles\.?$/i,
    "Doar proprietarii și administratorii definesc rolurile.",
  ],
  [
    /^Only the company's members use its AI staff\.?$/i,
    "Doar membrii firmei folosesc angajații AI ai firmei.",
  ],
  [
    /^The company server is not set up yet/i,
    "Serverul firmei nu e încă pregătit: un proprietar sau un administrator trebuie să confirme ce cont AI și ce conexiuni folosește pentru firmă.",
  ],
  [
    /^The company has no AI account yet/i,
    "Firma nu are încă un cont AI: un proprietar sau un administrator îl alege în Echipă > Cont AI.",
  ],
  [
    /^Confirm which AI account and which connections the company server uses first\.?$/i,
    "Confirmă întâi ce cont AI și ce conexiuni folosește serverul firmei.",
  ],
  [
    /^Make this machine the company (server|runner) first\.?$/i,
    "Fă întâi din acest calculator serverul firmei.",
  ],
  [
    /^The company runner has not synced with the hub yet/i,
    "Serverul firmei nu s-a sincronizat încă. Încearcă din nou într-un minut.",
  ],
  [
    /^This machine is not the runner of that company\.?$/i,
    "Acest calculator nu e serverul firmei.",
  ],
  [/^Sign in to a hub first\.?$/i, "Conectează-te întâi la contul tău Zen Staff (Echipă)."],
];

const PERMISSION = /^Your role does not allow (?:this|comments here)\s*(?:\(([^)]+)\))?\.?$/i;

/** The message to show for a hub or company-server error, in `locale`. */
export function hubErrorFor(message: string, locale: ZenLocale): string {
  const text = zenMessagesFor(hubErrorText, locale);
  const trimmed = message.trim();
  const permission = PERMISSION.exec(trimmed);
  if (permission !== null) {
    const what = permission[1]?.trim();
    // Without a detail: the sentence the roles screen already has (security.i18n.ts).
    const sentence =
      what === undefined || what === ""
        ? zenMessagesFor(securityText, locale).noPermission
        : text.noPermission(what);
    return `${sentence} ${text.askOwner}`;
  }
  if (/^Try again\.?$/i.test(trimmed)) return text.tryAgain;
  if (/^No machine is connected\.?$/i.test(trimmed)) return text.noMachine;
  if (/^The hub is not available\.?$/i.test(trimmed)) return text.hubDown;
  if (locale !== "ro") return trimmed;
  for (const [pattern, ro] of KNOWN_RO) {
    if (pattern.test(trimmed)) return /^Only /.test(trimmed) ? `${ro} ${text.askOwner}` : ro;
  }
  return trimmed;
}

/** The error's message (or `fallback`), in the app's language. */
export function hubPermissionMessage(error: unknown, fallback?: string): string {
  const raw =
    error instanceof Error && error.message.trim() !== ""
      ? error.message
      : (fallback ?? zenText(hubErrorText).tryAgain);
  return hubErrorFor(raw, getZenLocale());
}
