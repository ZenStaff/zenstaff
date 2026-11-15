# Security checks (outside view)

Set `UA="Mozilla/5.0 (compatible; owner-website-check)"`, `SITE` = the address given, `HOST` = its host name, `DOMAIN` = the registered domain (example.ro for www.example.ro). DNS lookups go through DNS over HTTPS so they work everywhere:
`curl -s "https://dns.google/resolve?name=<name>&type=<TYPE>"` (read `Answer[].data`; `"AD": true` means DNSSEC validated).

## 1. HTTPS and the certificate

- `curl -sI -A "$UA" "http://$HOST/"`: plain http must redirect (301/308) to https.
- `curl -svI -A "$UA" "https://$HOST/" 2>&1`: certificate subject, issuer, start and expiry date. If curl does not show dates, use `openssl s_client -connect $HOST:443 -servername $HOST </dev/null 2>/dev/null | openssl x509 -noout -dates -subject -issuer`, or the newest entry of `https://crt.sh/?q=$HOST&output=json` (`not_after`).
- Judge expiry against the certificate's own lifetime: less than a third of it left means automatic renewal is failing (a 90-day certificate with under 30 days left). Public certificates last at most 200 days since March 2026 (100 from March 2027), so manual renewal is itself a finding.
- Old protocols: `curl -s -o /dev/null -w "%{http_code}" --tlsv1.0 --tls-max 1.1 "https://$HOST/"` should fail. A success means TLS 1.0/1.1 still work (medium).
- Mixed content: in the homepage HTML, `src="http://` or stylesheet `href="http://` on an https page (low to medium).

## 2. Security headers

From `curl -sI -A "$UA" "https://$HOST/"` (follow one redirect with `-L` if needed):

| Header                                                                                                                                                                       | Good                                                   | Missing means                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Strict-Transport-Security                                                                                                                                                    | `max-age` of at least 15552000 (180 days)              | browsers may be tricked into plain http (medium)                     |
| Content-Security-Policy                                                                                                                                                      | present, no `unsafe-inline` + `unsafe-eval` everywhere | injected scripts run freely (medium; low for a static brochure site) |
| X-Content-Type-Options                                                                                                                                                       | `nosniff`                                              | low                                                                  |
| X-Frame-Options or CSP `frame-ancestors`                                                                                                                                     | DENY / SAMEORIGIN / 'self'                             | the site can be framed for click tricks (low to medium)              |
| Referrer-Policy                                                                                                                                                              | `strict-origin-when-cross-origin` or stricter          | low                                                                  |
| Permissions-Policy                                                                                                                                                           | present                                                | info                                                                 |
| Information leaks: `Server` or `X-Powered-By` with version numbers (PHP/8.1.2, nginx/1.18) help attackers pick known holes (low; medium when the version is out of support). |
| Cookies: every `Set-Cookie` for a session or login should have `Secure`, `HttpOnly` and `SameSite` (medium when a login cookie lacks them).                                  |
| CORS: `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true` is high.                                                                       |

## 3. Files that should never be public

One GET each, stop at the first hit per file, and check the content, not only the status: many sites answer 200 with their normal page for any address. A real hit looks like the file (for `.env`: lines like `KEY=value`; for `.git/HEAD`: `ref: refs/heads/`).
`/.env`, `/.env.local`, `/.env.production`, `/.git/HEAD`, `/.git/config`, `/backup.zip`, `/backup.sql`, `/db.sql`, `/dump.sql`, `/.DS_Store`, `/wp-config.php.bak`, `/config.php.bak`, `/phpinfo.php`, `/server-status`, `/.htpasswd`.
Use `curl -s -A "$UA" -r 0-300 "https://$HOST/<path>"` (only the first 300 bytes).

- Exposed `.env`, `.git`, a database dump or `.htpasswd`: critical. Phpinfo or server-status: medium.
- `/.well-known/security.txt` present is good (info if missing).
- Directory listing: a page titled "Index of /" on `/uploads/`, `/images/` or `/wp-content/uploads/` (low to medium).

## 4. The website platform

- WordPress (`/wp-content/` in the HTML, or `/wp-login.php` answers): read the `<meta name="generator">` version and compare it with the current release (web search "WordPress latest version"); an old major version is high. `/readme.html` reachable leaks the version (low). `/wp-json/wp/v2/users` listing user names helps password guessing (medium). `/xmlrpc.php` answering a GET with "XML-RPC server accepts POST requests only" is enabled (low; medium without rate limiting). Plugins named in the HTML (`/wp-content/plugins/<name>/`) with `?ver=`: list them for the developer to update; do not probe further.
- Other platforms (Joomla, Drupal, PrestaShop, Shopify, Wix, Squarespace): name it. On hosted builders (Shopify, Wix, Squarespace, Webflow) the platform patches the server, so focus on the domain, email and account security advice.
- Admin login page reachable from anywhere (`/wp-admin`, `/administrator`, `/admin`): note it (info) and recommend two-step login for every admin account.

## 5. Domain and DNS

- `CAA` record (who may issue certificates): missing is low.
- DNSSEC: `AD` flag on an `A` lookup; missing is info (low for shops and banks).
- Subdomains from certificate logs: `curl -s "https://crt.sh/?q=%25.$DOMAIN&output=json"` (may be slow; give up after 60 seconds). Take the unique names (drop `*.`), at most 30. For each: resolve `A` and `CNAME`. A CNAME to a hosting service (github.io, herokuapp.com, azurewebsites.net, cloudfront.net, s3 buckets, netlify.app, vercel.app, myshopify.com, wordpress.com, ghost.io and similar) that answers "not found", "no such app", "NoSuchBucket" or "There isn't a GitHub Pages site here" can be taken over by a stranger: critical. Old test, staging or admin subdomains that still answer publicly: medium.
- Email spoofing protection (anyone could send mail as the domain without it): `TXT` on the domain for `v=spf1` (missing or `+all` is high; `~all` or `-all` fine) and `TXT` on `_dmarc.$DOMAIN` (missing is high; `p=none` is medium). For more, point to the "Do our emails land in spam?" check.

## 6. Leaks and breaches (searches only)

Web search `"$DOMAIN" data breach` and `"$DOMAIN" leak`. Report only credible results (news, Have I Been Pwned listings) with the link; nothing found is the normal outcome.

## Code folder (only when given)

Read, never change.

- Secrets committed to the files: search for `.env` files that are not ignored, and patterns such as `sk_live_`, `AKIA`, `-----BEGIN`, `password=`, `api_key`, `secret`. Report the file and line, not the value.
- `.gitignore` covers `.env*`, backups and build output.
- Dependency lists (`package.json`, `composer.json`, `requirements.txt`): note very old frameworks; if `npm` is installed and a lockfile exists, `npm audit --omit=dev --audit-level=high` (read-only) and summarise.
- Forms and logins: server-side validation, rate limiting on login and contact forms, passwords stored hashed.

## Severity guide

Critical: exposed secrets or source code, subdomain takeover, expired certificate. High: very outdated platform, no SPF/DMARC on a domain that sends mail, credentialed CORS. Medium: missing HSTS/CSP, login cookies without flags, TLS 1.0/1.1, directory listing. Low and info: the rest.
