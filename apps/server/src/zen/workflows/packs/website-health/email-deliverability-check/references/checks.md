# Email delivery checks ("Do our emails land in spam?")

Everything is a public DNS lookup or reading what the person pasted; nothing is sent. `DOMAIN` = the email domain (the part after @; the website's domain unless another one was given). DNS over HTTPS works everywhere:
`curl -s "https://dns.google/resolve?name=<name>&type=<TYPE>"` (read `Answer[].data`).

## 1. Who receives and who sends

- `MX` of `DOMAIN`: which provider receives mail (google.com = Google Workspace, outlook.com/protection.outlook.com = Microsoft 365, zoho, a hosting company...). No MX: mail to the domain bounces (high if they use addresses on it).
- Senders: the person's answer, plus clues in SPF (`include:_spf.google.com`, `spf.protection.outlook.com`, `servers.mcsv.net` Mailchimp, `sendinblue.com`/`brevo`, `sendgrid.net`, `mailgun.org`, `amazonses.com`, `spf.mandrillapp.com`, `_spf.resend.com` or `amazonses` for Resend, `shops.shopify.com`, the hosting company's servers for website forms).

## 2. SPF (the list of servers allowed to send as the domain)

`TXT` on `DOMAIN`, the record starting `v=spf1`.

- None: high. Two or more `v=spf1` records: high (both are ignored).
- Ends in `+all`: critical (anyone may send). `?all`: medium. `~all` or `-all`: fine.
- Every real sender included? A service the person uses but SPF does not list (a newsletter tool, the website's contact form, the invoicing app) fails: high.
- At most 10 DNS lookups: count `include:`, `a`, `mx`, `ptr`, `exists:`, `redirect=`, following each include one level down (resolve its TXT too). Over 10 makes SPF fail everywhere: high.

## 3. DKIM (a signature that proves the mail was not altered)

Selectors are not public, so try the usual ones: `TXT` on `<selector>._domainkey.DOMAIN` for `google`, `selector1`, `selector2` (Microsoft), `k1`, `k2`, `k3` (Mailchimp), `s1`, `s2` (SendGrid), `mail`, `default`, `dkim`, `resend`, `brevo`, `mailjet`, `zoho`, `smtp`, `mx`, `pm` (Postmark), `mte1`. Also `CNAME` lookups for the same names. If pasted headers show `DKIM-Signature: ... s=<selector>; d=<domain>`, use that selector.

- None found for a sender in use: high (say it might use an unusual selector; the pasted headers settle it).
- Key shorter than 1024 bits (the `p=` value under about 200 characters): medium.

## 4. DMARC (what receivers should do with fakes, and reports to you)

`TXT` on `_dmarc.DOMAIN`.

- None: high. Gmail, Yahoo and Microsoft require it for anyone sending in volume, and it is the main protection against people faking the domain.
- `p=none` for many months: medium (reports only, no protection). `quarantine` or `reject`: good.
- `rua=` missing: low (no reports, nobody sees failures).
- `pct` below 100: legacy pattern (the 2026 DMARC standard, RFC 9989, replaced it with `t=y`): low.
- `np=reject` (fake subdomains) recommended: info.
- Never advise a direct jump to `p=reject`: the safe path is `p=none` with reports, fix every real sender, then `quarantine`, then `reject`.

## 5. Extras

- MTA-STS and TLS reporting (`TXT` on `_mta-sts.DOMAIN` and `_smtp._tls.DOMAIN`): info, nice to have.
- BIMI (logo next to emails; needs DMARC quarantine or reject): info.
- Blocklists: public resolvers are refused by Spamhaus (an answer `127.255.255.25x` means "query refused", not "listed"), so do not guess. List how to check by hand: the "Domain" lookup at check.spamhaus.org and a blacklist check at mxtoolbox.com. If the person gave the sending IP (from headers), mention it.

## 6. Pasted email headers (only when given)

Read `Authentication-Results`, `ARC-Authentication-Results` and `Received-SPF`: `spf=pass/fail`, `dkim=pass/fail` with `header.d=`, `dmarc=pass/fail`. Alignment matters: DMARC passes only if the SPF domain (`smtp.mailfrom`) or the DKIM domain (`header.d`) matches the visible From domain. A newsletter tool signing with its own domain (`d=mcsv.net`, `d=sendgrid.net`) passes DKIM but fails alignment: high. Also note `List-Unsubscribe` and `List-Unsubscribe-Post` on marketing mail.

## 7. The bulk-sender rules (Gmail, Yahoo, Microsoft, Apple)

Above about 5,000 messages a day to one provider these are conditions, not advice; failing them means rejection, not just spam: SPF, DKIM and DMARC all present and aligned; a spam complaint rate below 0.3% (Google advises below 0.1%); one-click unsubscribe (RFC 8058) on marketing mail, honoured within 2 days. Password resets, receipts and order confirmations need no unsubscribe link. Below 5,000 a day, treat them as the price of reaching the inbox anyway.

## 8. Habits that send mail to spam (ask, do not test)

Mention briefly when relevant to the person's answers: marketing and transactional mail from the same address (a newsletter complaint can sink invoices; use a subdomain such as `news.DOMAIN` for marketing), bought or scraped lists (also illegal under GDPR), no bounce cleaning, sudden big sends from a new domain, image-only emails, link shorteners, no plain-text part. Recommend Google Postmaster Tools (free) to see the real spam rate at Gmail.

## Code folder (only when given)

How the site sends mail: PHP `mail()` or a WordPress plugin sending from the web server (often unauthenticated: high), SMTP settings, the From address used by forms.

## Who fixes what

DNS records (SPF, DKIM, DMARC): whoever manages the domain name (registrar, hosting company or web developer), with the exact record from the email provider's help page. Sending settings in the newsletter tool: whoever runs the newsletters. Website forms: the web developer.

## Severity guide

Critical: `+all`, the domain on a blocklist (confirmed by hand). High: no SPF, no DMARC, missing DKIM for a sender in use, over 10 SPF lookups, unaligned newsletter tool, website forms sending unauthenticated. Medium: `p=none` for months, `?all`, short DKIM key. Low and info: the rest.
