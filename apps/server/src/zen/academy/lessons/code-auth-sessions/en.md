---
learn:
  - How to verify a JWT properly and what secret to give it
  - Where to keep the token and which cookie flags to set
  - How to rotate and end sessions
  - Why every route needs authorization, not just login
---

## Auth code that "works" is often wrong

Login flows are easy to make work and hard to make safe. An agent will happily produce a login that returns a token and a middleware that reads it. The bugs are in the details it skipped.

This lesson goes through them one by one: tokens, cookies, sessions, password reset and authorization on routes.

## Tokens

:::dont
`jwt.decode(token)`. It just base64-decodes the payload. Anyone can forge `{"sub":"1","role":"admin"}`.
:::

:::do
`jwt.verify(token, publicKey, { algorithms: ["RS256"] })`, always with an explicit algorithm list.
:::

- **Algorithm confusion.** Never accept `alg: none`. If you use RS256, pin it. Otherwise, on old or misconfigured libraries, an attacker can sign an HS256 token using your public key as the HMAC secret.
- **Weak secrets.** `"secret"`, `"changeme"` or the app name. HS256 secrets can be brute-forced offline. Use 32+ random bytes from a secret store.
- **Expiry.** Short-lived access tokens (5-15 min), longer refresh tokens that rotate on use and can be revoked.

:::picture secrets
The signing secret lives in a secret store, not in the code.
:::

## Where the token lives

`localStorage` is readable by any script on the page, so one XSS leaks every session. For browser apps, prefer a session cookie:

```js
res.cookie("sid", id, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 8 * 3600e3,
});
```

`HttpOnly` blocks JavaScript access, `Secure` keeps it off plain HTTP, `SameSite=Lax` blocks most CSRF.

:::tip
For state-changing requests from other origins you still need CSRF protection.
:::

## Sessions, reset and login

- **Rotate the session id on login** (`req.session.regenerate()`) and on privilege changes. Otherwise you get session fixation: the attacker plants a session id before the victim logs in.
- **Logout invalidates server-side.** Clearing the cookie isn't enough if the session or refresh token still works. For JWTs you need a denylist or a token version on the user.
- **Password change and reset kill the other sessions.**
- **Reset tokens:** `crypto.randomBytes(32)`, store only a hash, expire in 15-60 minutes, single use. Not `Math.random()`, not the user id, not a timestamp.
- **Same response** for "no such user" and "wrong password", and for "reset email sent" whether the account exists or not.
- **Rate limit** login, reset and OTP endpoints per IP and per account. Without it, a 6-digit OTP falls in minutes.
- **Passwords** are hashed with argon2id or bcrypt (cost 12+). Never md5 or sha256 alone.
- **MFA** (TOTP or passkeys), at least for admins.

## Authorization on every route

Authentication says who you are. Authorization says what you may do. The most common bug in agent-written APIs is a route that checks login but not ownership or role.

:::dont
```js
app.delete("/api/users/:id", requireLogin, deleteUser);
```
:::

:::do
```js
app.delete("/api/users/:id", requireLogin, requireRole("admin"), deleteUser);
```
:::

Put the check in middleware that runs by default, and keep a list of the routes that are deliberately public.

## Try it now

:::try
The button runs an auth audit on a practice project: a small Express app with most of the mistakes above. The agent only reads the code, it doesn't start the server or change anything. Count how many the audit finds, then try it on your own project.
:::

:::quiz
The middleware reads the user from the token with `jwt.decode`. What do you do?

- [ ] Nothing, the token comes from your own server.
- [x] Switch to `jwt.verify`, with an explicit algorithm list.
- [ ] Add a check that the payload has a `sub` field.

> `decode` doesn't check the signature, so anyone can write their own admin token.
:::

:::quiz
The user presses Logout and the app deletes the cookie in the browser. Done?

- [ ] Yes, without the cookie they are logged out.
- [ ] Yes, as long as the token expires in 15 minutes.
- [x] No, the session or token must be invalidated on the server too.

> Anyone with a copy of the cookie or refresh token can keep using it until the server invalidates it.
:::

:::quiz
On password reset, what do you show when the email is not in the database?

- [ ] "There is no account with this email."
- [x] The same message as when the account exists: "We sent you the reset email."
- [ ] A generic error message with a 404 code.

> Different messages tell an attacker which accounts exist.
:::
