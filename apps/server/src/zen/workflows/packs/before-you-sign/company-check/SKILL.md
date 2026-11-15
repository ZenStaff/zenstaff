# Company check by CUI

A two-page answer to "is it safe to work with them, and on what terms?", every fact with its
official source and the moment it was read. This is not a credit rating and not legal advice;
it says what public records show today.

## Sources (only these)

| What                                                                                         | Source                                                                                                    | Where it is in company.json |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------- |
| Name, address, trade register no., CAEN, status, VAT, VAT on collection, split VAT, inactive | ANAF, serviciul web de verificare a plătitorilor de TVA (webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva) | `registry`                  |
| Revenue, profit or loss, employees, debts, equity, cash, per year                            | ANAF, serviciul web pentru situațiile financiare (webservicesp.anaf.ro/bilant)                            | `financials`                |
| Court cases in the last 3 years (role, court, subject, stage, last hearing)                  | Ministerul Justiției, portal.just.ro (serviciul web de căutare a dosarelor)                               | `courts`                    |

Cite each fact as "(ANAF, citit la 08.11.2026 14:32)" with the time from `evidence`. Link the
saved raw files at the end. ANAF's data is what the company filed: a missing year means no
statement was published for it yet (the current year's appears from about mid-year).

## By hand (list them, do not do them)

- Insolvency notices: Buletinul procedurilor de insolvență, bpi.ro (paid search; the courts
  portal already shows insolvency cases).
- Tax debts: ANAF publishes the list of debtors each quarter at anaf.ro/restante.
- Who owns and runs the company (shareholders, administrators): a paid "certificat
  constatator" from ONRC (onrc.ro), or ask the company for one dated this month.
- The person signing: ask for their ID and the document that gives them the right to sign.

## The report (`raport.md`)

1. **Verdict** in one line: `Fără semnale de alarmă` / `Atenție` / `Risc mare`, then 2-3
   sentences why. Red signals (radiată, inactivă, insolvență, capitaluri negative) give
   "Risc mare"; amber ones "Atenție"; none "Fără semnale de alarmă". Never more reassuring
   than the data.
2. **Identity**: name, CUI, trade register number, address, status, registered since, CAEN
   with its meaning, VAT payer since. (Do not report the old optional "Registrul RO e-Factura":
   since 2024 every Romanian company invoices other companies through e-Factura, so it says
   nothing.) If the name given by the person differs
   from ANAF's, say so first: they may be talking to someone else.
3. **Money, last years**: a table per year (revenue, profit/loss, employees, debts, equity),
   amounts in lei with thousands separators, newest first; then 2-3 lines on the trend.
4. **Courts**: the count, roles (reclamant, pârât, creditor, debitor...), insolvency cases
   first, the most recent 5 with court, subject, stage and last outcome. Private persons are
   never named: the script already writes "persoană fizică". A big company with many cases is
   normal (the script flags the count only above about one case per 20 employees); say what is
   unusual for its size. The search is by name, so similar names can add cases: say so.
5. **What it means for this deal** (from the form: supplier, client buying on credit,
   partner, landlord, employer...): concrete terms, e.g. advance payment instead of 30 days
   credit, a smaller first order, a guarantee, a written contract with penalties; scaled to
   the amount at stake.
6. **Check by hand**: the list above, only what matters for this deal.
7. **Sources**: the table of evidence files with their fetch time.

A line at the end: "Informații din surse publice oficiale la data verificării; nu sunt
consultanță juridică sau financiară." (in English when the report is English).

## Self-review (do it, then fix what fails)

1. Every number in the report is in `company.json`; nothing estimated or remembered.
2. Every fact has its source and time; the raw files are linked.
3. The verdict follows the signals (no red signal, no "Risc mare"; a red signal, never
   "Fără semnale de alarmă").
4. No private person is named; no paid or unofficial site was used.
5. If the CUI failed the control digit or ANAF did not find it, the report says so plainly
   and stops there, with how to get the right CUI (invoice, website footer, contract).
6. Romanian text uses ș and ț (comma below).
