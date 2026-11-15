---
learn:
  - What each of the ten categories of the OWASP Top 10 (2025) covers
  - One concrete mistake an agent makes in each, and the fix
  - How to ask for the abuse cases in the same prompt as the feature
---

## Why this list still matters

The OWASP Top 10 is the shared vocabulary for web risk. The 2025 edition moved things around: SSRF is now part of access control, supply chain got its own slot, and there's a new category for mishandled errors.

Agents produce all ten, mostly because they write the happy path and stop. Below is each category with one concrete mistake and its fix.

## A01 to A03: access, configuration, supply chain

**A01 Broken Access Control.** `GET /api/invoices/:id` returns any invoice to any logged-in user (IDOR). Fix: filter by owner in the query, `WHERE id = $1 AND user_id = $2`. SSRF lives here too: `fetch(req.query.url)` lets a user reach `http://169.254.169.254/` or your internal services. Allowlist hosts and block private IP ranges after DNS resolution.

**A02 Security Misconfiguration.** CORS `origin: "*"` with credentials, debug mode in production, default admin passwords, verbose headers. Fix: explicit origin list, `NODE_ENV=production`, security headers (helmet).

**A03 Software Supply Chain Failures.** No lockfile, hallucinated package names, `postinstall` scripts, unpinned GitHub Actions (`uses: some/action@main`). Fix: lockfile plus `npm ci`, pin actions to a commit SHA, review new deps.

## A04 to A06: crypto, injection, design

**A04 Cryptographic Failures.** `md5(password)`, `Math.random()` for tokens, secrets in code. Fix: argon2id or bcrypt, `crypto.randomBytes`, keys from a secret store, TLS everywhere.

**A05 Injection.**

:::dont
``db.all(`SELECT * FROM users WHERE name = '${q}'`)``
:::

:::do
`db.all("... WHERE name = ?", [q])`, with parameters.
:::

Same for shell (`execFile` with an args array, not `exec` with a string) and HTML (escape output).

**A06 Insecure Design.** A coupon endpoint with no limit per user, a transfer that checks the balance and debits in two separate requests. Fix: write the abuse cases next to the feature, before the code.

## A07 to A10: auth, integrity, logs, errors

**A07 Authentication Failures.** No login rate limit, `jwt.decode` instead of `verify`, sessions not rotated. See the auth lesson.

**A08 Software or Data Integrity Failures.** Deserializing untrusted data, auto-updates without signature checks, trusting a webhook without verifying its signature. Fix: verify HMAC signatures on webhooks and check artifact signatures.

**A09 Security Logging and Alerting Failures.** Failed logins and permission denials aren't logged, or are logged with no one looking. Fix: structured logs for auth events, an alert on spikes, no secrets or personal data in logs.

**A10 Mishandling of Exceptional Conditions.** Stack traces returned to the client, `catch` blocks that fail open (`catch { return next() }` in an auth check), crashes on unexpected input. Fix: one error handler that logs the details and returns a generic message. On error, deny.

:::dont
```js
app.use((err, req, res, next) => res.status(500).json({ error: err.message, stack: err.stack }));
```
:::

:::do
```js
app.use((err, req, res, next) => {
  log.error({ err, reqId: req.id });
  res.status(500).json({ error: "Internal error", reqId: req.id });
});
```
:::

## How to use this with an agent

Agents follow explicit constraints well. They rarely invent them. So ask for the abuse cases in the same prompt as the feature.

:::dont
"Add an endpoint to download invoices."
:::

:::do
"Add an endpoint to download invoices. Only the owner may download. Write a test that user B gets 404 for user A's invoice."
:::

:::picture code-diff
In the diff, look for the abuse-case test too, not just the new code.
:::

## Try it now

:::try
The button runs a security audit focused on the Top 10, on a practice project: a small Express and SQLite app with SQL injection, IDOR, SSRF, leaked stack traces and md5 passwords. The agent only looks at the code, it doesn't start the app or change anything. For each finding, look up its category in the lesson.
:::

:::quiz
The agent wrote a search with ``db.all(`SELECT * FROM users WHERE name = '${q}'`)``. What do you ask it to change?

- [ ] Strip the quotes from `q` before the query.
- [x] Use parameters: `db.all("... WHERE name = ?", [q])`.
- [ ] Limit `q` to 50 characters.

> Only parameters keep data apart from the SQL command. Manual cleaning always misses a case.
:::

:::quiz
The auth middleware has `catch { return next() }`. What happens when the check throws?

- [ ] The user gets an error message and is sent to login.
- [x] The request goes through as if the user had been verified.
- [ ] The app crashes and the server restarts it.

> That block fails open. The right way is the opposite: on error, deny.
:::

:::quiz
You want a new endpoint for invoices. How do you get the safest code from the agent?

- [ ] Ask for the endpoint, then run a scanner.
- [ ] Tell it to "be careful about security".
- [x] Say in the prompt who is allowed, and ask for a test for the abuse case.

> Agents follow explicit constraints, but rarely invent them on their own.
:::
