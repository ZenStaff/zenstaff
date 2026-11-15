# Press kit: details

## Release versions

- Romanian: Romanian press conventions ("COMUNICAT DE PRESĂ" above the headline, dateline "Brașov, 20 noiembrie 2026 –", quotes with „ ”, "Despre <organizație>", "Date de contact pentru presă"), correct diacritics (ă, â, î, ș, ț with comma below).
- English: "FOR IMMEDIATE RELEASE" (or "EMBARGOED UNTIL <date, time, time zone>" when the person gives an embargo), dateline "BRASOV, Romania, November 20, 2026 –", "About <organization>", "Media contact". Explain local names once ("Brasov, Romania's seventh-largest city" only if true and useful).
- Both under 450 words, same facts, same [CHECK] marks.

## Pitch emails

- One idea per email: why this matters to the outlet's readers now.
- Personal greeting placeholder `<first name>` (the only placeholder allowed, since the person fills it per journalist).
- Release pasted as text below the signature (many newsrooms do not open attachments); photos as a link to a folder, not attachments over 2 MB.
- Offer: interview, photos, a visit or data.
- Follow-up: one short, polite message after 3 working days with a new angle or asset; never more than one.

## Fact sheet

Headings: The news in one sentence · Key facts and numbers · Dates · Places · People (name, role, one line each) · About the organization (founded, size, what it does, only known facts) · Links · Press contact. Every number from the answers or sources; anything assumed marked [CHECK].

## Media kit checklist (`media-kit-checklist.md`)

A table: item, why journalists need it, status (present / missing / [CHECK]), file or note.

- Logo: vector (SVG or PDF) and PNG with transparent background, light and dark versions.
- Photos: 3 to 6 high-resolution (at least 2000 px wide, JPEG), horizontal and vertical, with captions and photo credit, people's consent to publication.
- Portrait of the spokesperson, captioned.
- Short video or B-roll (optional), with a download link.
- The release (both languages), the fact sheet, the boilerplate.
- File names that say what they are (`organization-logo-dark.png`, `opening-photo-1-credit-name.jpg`), one shareable folder link, total download under 50 MB.
  When an assets folder was given, list its files (name, type, size, image dimensions when a tool such as `file` or `identify` is available) against the checklist.

## Media list template (`media-list.csv`)

UTF-8 with header row:
`outlet,segment,journalist,role,email,source_url,verified_on,status,relevance,embargo_ok,sent_on,follow_up_on,reply,notes`

- `segment`: national business, local, trade, tech, lifestyle, radio/TV, community.
- `source_url`: the public page where the address was found (needed to show the address is public and professional).
- `status`: ok, to check, duplicate, dead.
- Add 3 rows marked `EXAMPLE` in the outlet column with clearly fake addresses (`name@example.com`), never real journalists.

## Distribution guide (`distribution-guide.md`)

- Who to contact: journalists who cover this topic, via addresses they publish for this purpose (newsroom, desk or their professional address on the outlet's site). No private addresses, no bought lists.
- Lawful basis (GDPR, and in Romania Law 506/2004 on electronic communications): legitimate interest for relevant press contacts; keep the source of each address; every email says how to opt out, and opt-outs are honoured and kept.
- How to send: one email per journalist (never a long To or CC list), from a real person's address on the organization's domain, in small batches (for example 20 to 30 a day), at a sensible hour (9 to 11 on weekdays). Record `sent_on` and replies in the CSV.
- Embargo: only to journalists who accepted it, with the exact date and time.
- Before sending: the domain's email setup (SPF, DKIM, DMARC) should be in order, or the emails land in spam.
- After: follow up once; publish the release on the organization's own website or newsroom page; save coverage links.

## Checking a media list (only when given)

Passive only: never send a test email, never probe mail servers.

- Read the CSV or Excel file; map its columns to the template.
- Email syntax; duplicates (same address on several rows); role addresses (redactie@, office@, contact@, news@: fine for press, just noted); free-mail domains (gmail, yahoo: flag "personal address?").
- Domain check: for each distinct email domain, one DNS lookup for MX (`curl -s "https://dns.google/resolve?name=<domain>&type=MX"`); no MX and no A record means "dead".
- Write `press-kit/media-list-checked.csv` in the template's columns plus `check_notes`, and a short summary in `distribution-guide.md` (rows ok, to check, duplicate, dead).
