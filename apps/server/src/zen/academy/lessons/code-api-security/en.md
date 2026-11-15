---
learn:
  - Why API bugs get past tests and scanners
  - How to spot the six mistakes that matter most
  - How to find forgotten endpoints
  - How to ask the agent for a safer API
---

## Why API bugs survive testing

Most API vulnerabilities are logic, not syntax. The code runs, the tests pass, the happy path works. The bug only shows when user A sends user B's id.

Static scanners rarely catch that. Agents rarely write that test unless you ask.

:::tip
The test that is missing most often: "user B asks for user A's object". If it isn't there, ask for it.
:::

## Object-level authorization (BOLA / IDOR)

The number one API bug, every year. The route takes an id and returns the object without checking whose it is.

:::dont
```js
const order = await db.order.findUnique({ where: { id: req.params.id } });
```
:::

:::do
```js
const order = await db.order.findFirst({ where: { id: req.params.id, userId: req.user.id } });
if (!order) return res.status(404).end();
```
:::

Return 404, not 403, so you don't confirm the id exists. Sequential ids make it trivial to enumerate. UUIDs help but don't replace the check.

:::picture code-diff
In review, look for the owner condition in every query.
:::

## What goes in and what comes out

**Mass assignment.** `db.user.update({ data: req.body })` lets the client set `role`, `isVerified`, `balance` or `tenantId`. Validate the body with a schema (zod, valibot) that lists only allowed fields, and use `.strict()` so unknown fields fail.

**Excessive data exposure.** The password hash, internal notes and other users' emails all end up in the network tab.

:::dont
You return the whole database row and let the frontend pick what to show.
:::

:::do
Map to an explicit response DTO. Same for GraphQL: limit fields per role and depth per query.
:::

## Limits, roles and SSRF

**Rate limits and resource limits.** No limit on login, OTP, search or export, `?limit=1000000` accepted, file uploads without a size cap. Add per-user and per-IP limits, a max page size, request body limits and timeouts. For LLM-backed endpoints, a cost limit too.

**Function-level authorization.** The admin UI hides the button, but `POST /api/admin/users/:id/ban` only checks that you're logged in. Every privileged route needs a role check on the server. Group them under one router with the check applied once.

**SSRF.** Webhooks, link previews, "import from URL", PDF renderers. The server fetches whatever the user sends, including `http://localhost:5432` or cloud metadata at `169.254.169.254`.

:::warn
Allowlist hosts and schemes, resolve DNS and reject private ranges, disable redirects or re-check after each one.
:::

## Forgotten endpoints and better requests

Agents leave things behind: `/api/v1/` next to `/api/v2/`, a `/debug/env` route from a debugging session, a test route that seeds data. Keep an inventory. Generate an OpenAPI spec from code, diff it in CI, and ask "which routes are mounted that aren't in the spec?" Remove old versions on a date, not "someday".

Put the security requirements right in the task. You get different code.

:::dont
"Add an endpoint to edit projects."
:::

:::do
"Add `PATCH /api/projects/:id`. Only members of the project can edit. Allowed fields: name, description. Return the project DTO without internal fields. Add tests: non-member gets 404, extra fields are rejected."
:::

## Try it now

:::try
The button runs an API security audit on a practice project: a small REST API with IDOR, mass assignment, overshared responses, an unprotected admin route, an SSRF webhook tester and a forgotten v1 endpoint. The agent only reads the code, it doesn't start the server or change anything. Check whether it found all six.
:::

:::quiz
A `GET /api/orders/:id` route looks up the order by id only. What do you change?

- [ ] Switch to UUIDs so ids can't be guessed.
- [x] Look it up by id and by the logged-in user, and return 404 if nothing is found.
- [ ] Return 403 when the order belongs to someone else.

> The owner check is what stops the bug. UUIDs only hide it, and 403 confirms the id exists.
:::

:::quiz
The ban button is hidden in the UI for regular users. Is that enough?

- [ ] Yes, if the button isn't visible, nobody can send the request.
- [ ] Yes, as long as the route requires login.
- [x] No, the admin route needs a role check on the server.

> Anyone can send the request directly. Only the server can decide who is allowed.
:::

:::quiz
The agent writes `db.user.update({ data: req.body })`. What is the risk?

- [x] The client can set fields like `role` or `balance` on its own.
- [ ] The request gets too slow.
- [ ] There is no risk if the user is logged in.

> Validate the body with a strict schema that allows only the fields the user may change.
:::
