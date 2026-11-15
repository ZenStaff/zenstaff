// Zen Staff: Romanian for the plain-language messages the Zen server sends (errors and notices of
// the Office, companies, company memory and limits services). The server stays language-neutral
// (English); Zen pages pass what they show through `zenServerText`. Unknown text is returned as it
// is. To cover a new server message, add it here. ZEN.md, "Languages".
import * as Cause from "effect/Cause";

import { getZenLocale, type ZenLocale } from "./zenI18n";

/** Exact server messages. */
const EXACT_RO: Readonly<Record<string, string>> = {
  // Office: workflows and the library (apps/server/src/zen/workflows)
  "Installed library workflows cannot be edited.":
    "Fluxurile instalate din bibliotecă nu se pot modifica.",
  "The pack was copied but is not a valid workflow.":
    "Pachetul a fost copiat, dar nu este un flux de lucru valid.",
  "This workflow is already included.": "Acest flux de lucru este deja inclus.",
  "The workflow was saved but did not load again.":
    "Fluxul a fost salvat, dar nu s-a mai putut încărca.",
  "Only your own workflows can be deleted.": "Poți șterge doar fluxurile tale.",
  "This pack is not installed.": "Acest pachet nu este instalat.",
  "This pack is not in the library.": "Acest pachet nu este în bibliotecă.",
  "The library index could not be read.": "Lista bibliotecii nu a putut fi citită.",
  "The library index is not valid.": "Lista bibliotecii nu este validă.",
  "The new version is not in the library.": "Versiunea nouă nu este în bibliotecă.",
  // Community library (communityLibrary.ts and the hub's library routes)
  "Sign in to the hub (Team > Account) to publish to the library.":
    "Conectează-te la hub (Echipă > Cont) ca să publici în bibliotecă.",
  "Only your own workflows and your customized packs can be published.":
    "Poți publica doar fluxurile tale și pachetele pe care le-ai personalizat.",
  "The version looks like 1.0.0.": "Versiunea arată ca 1.0.0.",
  "Choose why you report this pack.": "Alege de ce raportezi pachetul.",
  "The hub cannot be reached. Check your connection.":
    "Hubul nu poate fi accesat. Verifică conexiunea.",
  "The pack did not pass the automatic checks.": "Pachetul nu a trecut verificările automate.",
  "This pack id belongs to another author. Pick another one.":
    "Acest id de pachet e al altui autor. Alege altul.",
  "The submission is not signed by this device.": "Trimiterea nu e semnată de acest dispozitiv.",
  "This session has no device key; publish from Zen Staff.":
    "Această sesiune nu are cheie de dispozitiv; publică din Zen Staff.",
  "The Office edition is not available on this server.":
    "Ediția Office nu este disponibilă pe acest server.",
  "This pack is not available yet.": "Acest pachet nu este încă disponibil.",
  "The downloaded pack does not match its checksum, so nothing was installed.":
    "Pachetul descărcat nu se potrivește cu suma de control, așa că nu s-a instalat nimic.",
  "The registry address is too long.": "Adresa bibliotecii este prea lungă.",
  "The registry address is not a valid web address.":
    "Adresa magazinului nu este o adresă web validă.",
  "The registry address must start with http:// or https://.":
    "Adresa magazinului trebuie să înceapă cu http:// sau https://.",
  "Leave the user name and password out of the registry address.":
    "Scoate numele de utilizator și parola din adresa magazinului.",
  "The pack's download address is not valid.": "Adresa de descărcare a pachetului nu este validă.",
  "The pack's download address must use http or https.":
    "Adresa de descărcare a pachetului trebuie să folosească http sau https.",
  "The pack is not a valid .tar.gz archive (or it is too large).":
    "Pachetul nu este o arhivă .tar.gz validă (sau este prea mare).",
  "The pack's archive is damaged.": "Arhiva pachetului este deteriorată.",
  "The pack's archive is cut short.": "Arhiva pachetului este incompletă.",
  "The pack's archive is empty.": "Arhiva pachetului este goală.",
  "The pack's archive has no workflow.json at its root or in one folder.":
    "Arhiva pachetului nu are workflow.json la rădăcină sau într-un singur dosar.",
  // Actions in "Could not <action>: <reason>" (ZenOffice asOfficeError)
  "read Office settings": "citi setările Office",
  "save the registry address": "salva adresa bibliotecii",
  "save the edition": "salva ediția",
  "load workflows": "încărca fluxurile de lucru",
  "save the workflow": "salva fluxul de lucru",
  "delete the workflow": "șterge fluxul de lucru",
  "load the library": "încărca biblioteca",
  "read the library": "citi biblioteca",
  "install the pack": "instala pachetul",
  "uninstall the pack": "dezinstala pachetul",
  // Companies
  "Companies are not available on this server.": "Companiile nu sunt disponibile pe acest server.",
  "Could not list this company's memory files.":
    "Nu am putut lista fișierele de memorie ale acestei companii.",
  "Could not read this memory file.": "Nu am putut citi acest fișier de memorie.",
  "Could not save companies on this machine.": "Nu am putut salva companiile pe acest calculator.",
  "The Personal company cannot be deleted.": "Compania Personal nu poate fi ștearsă.",
  "This company no longer exists.": "Această companie nu mai există.",
  "This memory file is not available.": "Acest fișier de memorie nu este disponibil.",
  "This memory file no longer exists.": "Acest fișier de memorie nu mai există.",
  // Company memory
  "A company admin must confirm this.": "Trebuie să confirme un administrator al companiei.",
  "Company memory is not available on this server.":
    "Memoria companiei nu este disponibilă pe acest server.",
  "Not found in company memory.": "Nu am găsit asta în memoria companiei.",
  "Personal projects keep their local memory.":
    "Proiectele personale își păstrează memoria locală.",
  "The memory server refused the API key.": "Serverul de memorie a refuzat cheia API.",
  "Quota exceeded": "Limita a fost depășită",
  "no business content": "nimic de reținut pentru firmă",
  "not sent within 7 days": "netrimis în 7 zile",
  "no-messages": "fără mesaje",
  "no-user-message": "fără mesaj de la tine",
  "too-short": "prea scurtă",
  "small-talk": "doar politețuri",
  "question-only": "doar o întrebare",
  // Scheduled task limits
  "Could not read the scheduled task limits.": "Nu am putut citi limitele sarcinilor programate.",
  "Scheduled task limits are not available on this server.":
    "Limitele sarcinilor programate nu sunt disponibile pe acest server.",
  "This scheduled task no longer exists.": "Această sarcină programată nu mai există.",
  "All scheduled agents are paused.": "Toți agenții programați sunt opriți.",
  "The workflows that come with the app could not be read. Restart Zen Staff to see them again.":
    "Fluxurile care vin cu aplicația nu au putut fi citite. Repornește Zen Staff ca să le vezi din nou.",
};

/** Server messages with values in them; `$1`... are the captured groups. */
const PATTERNS_RO: ReadonlyArray<readonly [RegExp, string]> = [
  [/^A workflow with the id "(.+)" already exists\.$/, "Există deja un flux cu id-ul „$1”."],
  [
    /^You already have your own workflow with the id "(.+)"\.$/,
    "Ai deja un flux propriu cu id-ul „$1”.",
  ],
  [/^The pack is not a valid workflow: (.+)$/, "Pachetul nu este un flux de lucru valid: $1"],
  [/^The pack could not be downloaded: (.+)$/, "Pachetul nu a putut fi descărcat: $1"],
  [
    /^The library at (.+) could not be reached \((.+)\)\. Showing the copy saved on (.+)\.$/,
    "Biblioteca de la $1 nu a putut fi accesată ($2). Arăt copia salvată pe $3.",
  ],
  [
    /^The library at (.+) could not be reached \((.+)\)\. Only the workflows that come with the app are shown\.$/,
    "Biblioteca de la $1 nu a putut fi accesată ($2). Arăt doar fluxurile care vin cu aplicația.",
  ],
  [
    /^The community library could not be reached \((.+)\)\. Showing the copy saved on (.+)\.$/,
    "Biblioteca comunității nu a putut fi accesată ($1). Arăt copia salvată pe $2.",
  ],
  [
    /^The community library could not be reached \((.+)\)\.$/,
    "Biblioteca comunității nu a putut fi accesată ($1).",
  ],
  [
    /^The id (.+) belongs to a Zen Staff pack; choose another one\.$/,
    "Id-ul $1 este al unui pachet Zen Staff; alege altul.",
  ],
  [
    /^Version (.+) is already published; send a higher version\.$/,
    "Versiunea $1 e deja publicată; trimite o versiune mai mare.",
  ],
  [/^(.+) could not be reached\.$/, "$1 nu a putut fi accesat."],
  [/^Could not (.+?): (.+)$/, "Nu am putut $1: $2"],
  [
    /^Could not reach the memory server \((.+)\)$/,
    "Nu am putut ajunge la serverul de memorie ($1)",
  ],
  [/^redacted before sending: (.+)$/, "ascuns înainte de trimitere: $1"],
  [/^Quiet hours, (.+) to (.+)\.$/, "Ore de liniște, $1–$2."],
  [
    /^Daily limit reached: (\d+) runs? today, limit (\d+)\.$/,
    "Limita zilnică a fost atinsă: $1 rulări azi, limita $2.",
  ],
  [
    /^Global daily cap reached: (\d+) scheduled runs? today, cap (\d+)\.$/,
    "Plafonul zilnic a fost atins: $1 rulări programate azi, plafon $2.",
  ],
  [
    /^Waiting for a free slot: (\d+) queued tasks? ahead\.$/,
    "Așteaptă un loc liber: $1 în fața ei la coadă.",
  ],
  [
    /^Waiting for a free slot: (\d+) of (\d+) scheduled runs are working\.$/,
    "Așteaptă un loc liber: $1 din $2 rulări programate lucrează.",
  ],
];

/** A server message in `locale` (Romanian when known), else the message as it came. */
export function zenServerText(text: string, locale: ZenLocale): string {
  if (locale !== "ro") return text;
  const trimmed = text.trim();
  const exact = EXACT_RO[trimmed];
  if (exact) return exact;
  for (const [pattern, template] of PATTERNS_RO) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(pattern, (...groups: ReadonlyArray<unknown>) =>
        template.replace(/\$(\d)/g, (_match, index: string) =>
          zenServerText(String(groups[Number(index)] ?? ""), locale),
        ),
      );
    }
  }
  return text;
}

/** The message of a failed Zen RPC in the app language, or `fallback` when it has none. */
export function zenErrorMessage(cause: Cause.Cause<unknown>, fallback: string): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? zenServerText(error.message, getZenLocale())
    : fallback;
}
