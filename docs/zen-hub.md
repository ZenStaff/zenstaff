# Zen Staff hub (v2)

The hub is the part ZED-ZEN hosts (or a customer self-hosts): accounts, companies and membership,
invitations, the relay between people and runners, chat sharing records, and later the
marketplace and the company memory (`memory/` in the public repository, a separate service). **Agents never run on the hub
and the hub never holds an AI account.** They run on the customer's side: the person's desktop
app, or an always-on runner (their PC, their server, or a per-company VM we provision later).

Code: hub service in `hub/` of the public repository; app side in `apps/server/src/zen/hub/`,
`apps/web/src/zen/hub/`, `packages/contracts/src/zenHub.ts` (branch `zen/hub`).

## Components

```
 phone / browser / colleague's app            customer side (agents run here)
        |  HTTPS (session token)              +------------------------------+
        v                                     | Zen Staff server (= runner)  |
 +-------------+  outbound WebSocket (wss)    |  orchestrator, Claude Code,  |
 |   zen-hub   | <--------------------------- |  company AI account / key    |
 |  API+relay  |    runner dials out, keeps   |  zen/hub: allow-list, relay  |
 |  SQLite     |    one socket open           |  handlers, copy import       |
 +-------------+                              +------------------------------+
```

- **zen-hub** (Node 24+, TypeScript run directly, `node:sqlite`, `ws`): HTTP JSON API + the runner
  socket at `/v1/runner`. One process, one SQLite file.
- **App server, `zen/hub` module**: signs in to the hub, registers the machine, keeps the runner
  socket, shares chats, answers relay requests, imports copies. One RPC `zen.hub.call {op, input}`
  so upstream files gain one entry each.
- **Web, `/hub` page ("Team")**: account, companies, members, invitations, runner switch, sharing,
  chats shared with me, hand-overs, the live shared-chat view. Settings > General shows hub URL and
  account. The browser never sees the hub session or the runner credential; its own server does
  every hub call.

## Data model (hub)

| Table          | Fields (main)                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`        | id, email (unique), name                                                                                                                           |
| `login_codes`  | email, sha256(code), sha256(link), sha256(poll secret), approved_at, attempts, expiry                                                              |
| `sessions`     | sha256(token), user, label, expiry (90 days)                                                                                                       |
| `companies`    | id, name, created_by                                                                                                                               |
| `memberships`  | company, user, role `owner` / `admin` / `member` / `guest`                                                                                         |
| `invites`      | company, email (null = link invite), role, sha256(token), expiry 14 days, accepted/revoked                                                         |
| `environments` | id, owner user, name, sha256(runner credential), `runner_company_id` (null = personal only), last_seen                                             |
| `shares`       | environment, thread id, owner, company, kind `personal` / `company` / `handover`, audience user (null = whole company), handover_state, revoked_at |
| `comments`     | share, author, sealed body + author's device signature (v4); legacy rows: message id, plaintext body                                               |

Every secret (session, runner credential, invite, login code/link) is 256-bit random (codes: 6
digits, 5 tries) and stored only as SHA-256. Each machine that signs in is one **environment**; it
becomes a **company runner** when its owner (an owner/admin of that company) says so. A local
company (companies feature) is **linked** to a hub company on the machine (`hub.json`).

## Auth

- **e-mail code + magic link** in one e-mail, or **Google / Microsoft** (OIDC code + PKCE; the app
  opens the provider page and collects the session by polling, like the link), then **TOTP** when
  the account has it (mandatory for owners/admins). The app asks the hub to start a login; the user
  types the 6-digit code, or opens the link on any device, which approves the pending request that
  the app collects by polling with a secret only it holds. Sessions are bearer tokens kept by the
  app server in `<state>/zen/hub.json` (mode 0600). Mail goes through Resend when
  `RESEND_API_KEY` is set, otherwise it is only logged (`HUB_DEV_OUTBOX=1` keeps it in memory for
  loopback tests).
- **Passkeys (WebAuthn, hub v5)**, on the hub's own pages (the hub is the relying party: RP ID
  `HUB_WEBAUTHN_RP_ID`, default the hostname of `HUB_PUBLIC_URL`; name `HUB_WEBAUTHN_RP_NAME`,
  default "Zen Staff"; expected origin `HUB_WEBAUTHN_ORIGIN`, default the origin of
  `HUB_PUBLIC_URL`). Hub side: `@simplewebauthn/server` 14.0.3, and `@simplewebauthn/browser`
  14.0.0 vendored into the hub and served by it with subresource integrity (no CDN).
  - _Sign in:_ "Sign in with a passkey" on the Team sign-in screen (op `signIn.passkey`) asks the
    hub for a pending login, exactly like Google / Microsoft: the hub returns a page address and a
    poll secret, the app opens the page in the browser, the page runs `navigator.credentials.get`
    (discoverable credentials, no e-mail typed), and on success approves the pending login, which
    the app collects with `signIn.poll`. The page says to continue only if you started the sign-in
    yourself on that computer (same caveat as the e-mailed link).
  - _Add one:_ Team > Account > Passkeys (op `passkeys.register`) gets a link that is short-lived
    (10 minutes), single use and bound to the session that asked (it dies when that session ends);
    the page runs `navigator.credentials.create`. List and remove: `passkeys.list`,
    `passkeys.remove`. The app opens only addresses that are the hub's own passkey pages
    (`hubPasskeys.ts`, https or http on localhost).
  - Links stored as SHA-256, challenges hashed and single use (a new one each time the page asks;
    an old response cannot finish), five failures use a link up, rate limits per address and per
    person. User verification is required in both ceremonies; the signature counter must go up
    (authenticators that keep none, such as synced passkeys, report 0 and are accepted), unknown or
    removed passkeys are refused. Adding and removing a passkey is e-mailed to the person and
    written to the hub's audit log.
  - **Two-factor decision:** a passkey sign-in counts as two-factor for that session (it is
    possession plus fingerprint, face or PIN), so its session gets `mfa_at` and needs no TOTP code.
    Owners and admins must still keep TOTP on: it is the fallback with recovery codes, and a passkey
    alone does not satisfy "set up two-factor first". Adding a passkey needs a session that already
    passed two-factor, so a passkey can never be used to get around TOTP.
- Later: SSO per company.
- Rate limits on the login routes; not-a-member and no-such-company answer the same 404.

## How runners connect

Outbound only: the runner opens `wss://hub/v1/runner` and sends `{t:"hello", credential}` as the
first frame (never in the URL, so never in access logs). The hub answers `welcome`, pings every
25 s, and drops dead sockets; the runner reconnects with backoff (1 s to 30 s). No inbound port, no
public address, no VPN, no tunnel. Requests travel down the socket as `{t:"req", id, op, shareId,
threadId, companyId, actor, input}` and come back as `{t:"res", id, ok, result | error}`.

## How clients reach a runner

The client calls the hub over HTTPS with its session (`POST /v1/shares/:id/view|export|prompt`).
The hub loads the share, checks `policy.ts`, and forwards one request to the share's environment
with the thread id **from the share record** (the client never names a thread on someone else's
machine) and the authenticated actor. Live view is a long-poll: the runner holds `thread.view`
until the chat's version changes (or 25 s), so a viewer sees new messages within a second.
An offline runner gives a clear 503.

## Security: what the hub can and cannot see

- Transport: TLS to the hub (https/wss required by the app, except a hub on localhost).
- **Runner-side allow-list:** a runner answers only for share ids it created itself, with the
  matching thread and company (`authorizeRelayRequest`). A compromised or buggy hub cannot read
  chats nobody shared, cannot prompt a personal chat (the runner refuses `thread.prompt` for
  anything but a company share whose project is still in the linked company and whose machine is
  still that company's runner), and cannot archive a chat that was not handed over.
- The hub **stores**: accounts, companies, memberships, invitations, environment names, share
  records (thread id, sealed title), sealed comments. It **never stores** chat content, files,
  plaintext titles or comments (since hub v4), AI credentials or provider tokens. Company AI accounts (Team/Enterprise seat or API key) live on the runner.
- **v2, built: signed requests and end-to-end content.** Every sign-in creates a device identity
  (Ed25519 signing + X25519 box key; private halves only in the app's `hub.json`), registered on
  the hub with the session. Each machine also has runner keys (made with its environment, kept
  across sign-ins of the same account) published with `PUT /v1/environments/:id/keys`.
  - The client signs `zen-hub-request-v1\n{op, shareId, userId, keyId, ts, nonce, body: sha256(input)}`
    (canonical JSON, same bytes in `zen-hub/src/signing.ts` and `hubCrypto.ts`, pinned by a test
    vector). The hub checks it (key of this session, 5-minute window, nonce once) and forwards the
    signature, the device's public keys and any certificates.
  - The runner (`relayTrust.ts`) accepts the request only from a device it pinned for that person:
    the first device it sees for them, or one cross-signed (`zen-hub-device-v1`) by a device it
    already approved. A device signed out from the sessions list is unpinned on every runner
    (`device.revoked` notice). A re-sign-in on the same machine is cross-signed by the previous key.
  - **First-device approval.** A person's first device on a runner is pinned as **pending**: it
    may only read (`thread.view`, and `thread.meta` for title and comments). `thread.prompt`,
    `thread.export` (copy and hand-over: the whole history and its files, and a hand-over archives
    the original), `thread.attachment`, `thread.handedOver` and Enterprise grants signed by it are
    refused with "Waiting for approval of this device on the runner...". The runner asks the hub,
    authenticated with its runner credential (`POST /v1/runner/pending-device`, rate limited), to
    alert its owner and the company's owners/admins (in-app + e-mail, with the key fingerprint:
    8 groups of 4 hex digits of SHA-256 over the signing key, same on both sides). It becomes
    approved when the runner's owner (or an owner/admin of the runner's company signed in there)
    approves it in Team > Account > "Waiting for approval on this machine" after comparing the
    fingerprint (the person sees theirs under Device keys), or when one of that person's
    **approved** devices cross-signs it (a cross-signature from a pending device leaves it pending;
    it is upgraded on the next request once the signer is approved). Rejecting unpins it and the
    key is never pinned again on that runner. Once a person has an approved device, an unvouched
    new device is refused outright (as before); at most 5 of one person's devices wait at a time.
    Pins made before this rule have no state and count as approved (no migration step needed).
  - Content ops (`thread.view`, `thread.export`, `thread.prompt`, `thread.meta`,
    `thread.attachment`) carry `{sealed}`: X25519 with an ephemeral key, HKDF-SHA256, AES-256-GCM,
    bound to op, share, nonce and direction. The runner answers `{sealed, sig}`, sealed to the
    pinned device key and signed with the runner key over the request nonce; clients pin runner
    keys on first use and refuse changed ones.
  - **Comments** are sealed by the author's app to the share's runner key (context
    `zen-hub-e2e-v1|request|comment|<share>|<nonce>`, plaintext `{body, messageId}`) and signed by
    the author's device as op `comment.add` over `{sealed}`. The hub stores only the ciphertext and
    the signature. A reader's app asks `thread.meta` through the hub, which attaches the stored
    comments; the runner checks each signature (dropping any that fail: a swapped, re-attributed
    or replayed comment), opens it and answers sealed to the reader. A comment from a device the
    runner has not approved shows as "unverified device". When the runner is offline the app shows
    only legacy comments and how many encrypted ones wait.
  - **Titles**: the owner's runner seals a new share's title to its own key (context
    `...|share.title|<environment>|<thread>`); the hub keeps that and no plaintext. Viewers get the
    current title through the runner (`thread.meta`, also inside the sealed live view); the app
    keeps them in memory (5 minutes) to fill lists and notifications, and shows "Shared chat" when
    the runner is offline and nothing is cached.
  - **Notifications and e-mails** carry routing only: who acted, which share, which kind
    (`share`, `comment`, `handover`, `handover.accepted`, `handover.declined`, `device`). The app
    writes the text in the person's language with the title from the runner.
  - **What the hub still sees:** accounts, companies, roles, invitations, environment names,
    device public keys and certificates, share records (environment, thread id, owner, company,
    kind, audience, hand-over state, times), who commented on which share and when (not the text,
    not which message), notification routing, the size and timing of relay traffic, the company
    name in e-mails, the runner's AI account label, Enterprise grant statements, company memory
    address, Academy progress and the audit log. Rows written before hub v4 (plaintext titles,
    comments, notification texts) stay readable and are marked legacy; nothing new is stored in
    clear.
  - Limits: the first device per (runner, person) waits for an out-of-band approval, so a hub
    that injects a key gets at most read access until someone approves it; the hub could refuse
    or delay requests, drop comments, not forge or read them.

## Sharing semantics

| Chat                           | Who sees it live                    | Comment | Prompt                          | Copy ("Continue on my side") |
| ------------------------------ | ----------------------------------- | ------- | ------------------------------- | ---------------------------- |
| Personal, shared to company    | full members (not guests)           | yes     | **only the owner**              | yes                          |
| Personal, shared to one person | that person (a guest too)           | yes     | **only the owner**              | yes                          |
| Company (on company runner)    | members (or the named person)       | yes     | every full member, never guests | yes                          |
| Hand-over                      | the named colleague, until accepted | no      | nobody                          | accepting it is the copy     |

- **Personal vs company** is decided on the runner: a chat is a company chat when its project
  belongs to a local company linked to hub company C and this machine is C's runner. Everything
  else is personal and runs on the person's own AI account.
- **Continue on my side:** the viewer's server fetches `thread.export` (up to 1000 messages, done
  messages only, each with its attachments listed) and writes a new local thread shaped like
  upstream's v1 import (`historyOrigin: "v1_import"`, run-less items, no provider thread, a system
  notice "Copied from Alex's chat", in the viewer's language). Attachments (images, audio, video,
  files) are fetched one by one with `thread.attachment` (sealed like the export) within the copy
  limits, **5 MB per file, 20 MB and 40 files per copy, newest first** (the live view inlines 3 MB
  each, 8 MB per view; a copy keeps files, and one sealed 5 MB file stays well under the hub's 16 MB
  frame), and stored for the new thread the way upstream stores uploads (`createAttachmentId`,
  `resolveAttachmentPath`; images as image attachments, everything else as file attachments).
  Files over the limits, or that fail, are listed in the copied message as "Not copied (over the
  size limits): name (size)". On its first turn upstream's `ContextHandoffService.prepareLegacyImport` gives the
  whole history to the viewer's own agent and account. The original is untouched.
- **Hand over:** the owner creates a `handover` share for one full member. On accept, the
  colleague's server copies the chat the same way, attachments included (notice "Handed over by
  Alex"), then the hub
  marks it completed, revokes every share of that thread and tells the source runner
  (`thread.handedOver`), which archives its copy. Declining leaves everything as it was.
- A company prompt arrives in the thread as `Maria Pop (maria@...):\n<text>` through upstream's
  `ThreadManagementService.sendToThread` (queue mode), so the agent and readers see who wrote it.
- Removing a member revokes their shares in that company and their runner role; un-registering a
  runner revokes its company shares.

## Self-host

`zen-hub` ships a Dockerfile and `docker-compose.yml` (one service, one volume for the SQLite
file, health check `/health`, memory limit, bound to 127.0.0.1 by default; put any TLS reverse
proxy in front). Config: `HUB_PUBLIC_URL`, `HUB_DB_PATH`, `RESEND_API_KEY`, `HUB_MAIL_FROM`. The app
uses any hub: the address is entered at sign-in (or `ZEN_HUB_URL` as the default). Backup = copy
the SQLite file (WAL mode; use `sqlite3 .backup`).

**Why SQLite, not the Postgres/Supabase stack:** the hub stores small relational metadata (users,
memberships, shares), never chat content; one file means a self-hosted hub is one container with
no database to run, and backups are a file copy. All SQL is in `store.ts`; moving our hosted hub to
Postgres (Supabase stack per the ZED-ZEN standard) when one process is no longer enough is a
contained change. The relay keeps sockets in process memory, so v1 runs as **one** hub instance.

## Reuse from upstream vs new

Reused: the orchestrator projections and `getThreadRecords` for live view and export;
`ThreadManagementService.sendToThread` for company prompts; `thread.archive` for hand-over; the
v1-import thread shape and `prepareLegacyImport` for copies (same idea as Zen's terminal sessions
import, `zen/cliSessions/CliSessionImport.ts`); the existing companies feature for personal vs
company; the RPC/auth-scope plumbing (`RpcAuthorization`, `RpcInstrumentation`) for one new RPC.

Not reused, on purpose: **T3 Connect** (`apps/server/src/cloud`, `relay/`) is a Cloudflare-tunnel
product with Clerk identity at `clerk.t3.codes` / `app.t3.codes`: each environment gets a public
hostname and clients connect to it directly. We may not use that infrastructure, and the tunnel
model (inbound reachability per machine) is what we replace with an outbound socket to the hub.
Upstream's **guest share** (`guest/GuestShareService.ts`) needs a Connect hostname, is one guest
per thread, and lets that guest post messages; our sharing is per company and member, and personal
chats must never take colleagues' prompts. Upstream **peer links / transfer** (`peer/`,
`t3_thread_transfer`) move context between threads of linked environments over Connect; our copy
goes through the hub instead. All upstream code stays untouched; the fork gains 1-2 lines per
shared file (see ZEN.md).

## Not yet (after v2)

Approving a pending device remotely (today it is approved on the runner itself, or by
the person's own approved device); a hub web UI for phones (the API is ready, the app's own page is the
only client today); several hub instances; the hub-provisioned company VM; injecting a Codex
company API key (Claude keys are injected; Codex runners use their seat login).

v2 added: TOTP two-factor (mandatory for owners/admins) with recovery codes, Google and Microsoft
sign-in (OIDC, env-configured), sessions and devices with revoke, e-mail alerts and audit log for
admin actions, rate limits, the hub as source of truth for roles, Enterprise grants (signed),
company memory settings, per-person edition/language and Academy team progress, the runner's AI
account picker (metadata only on the hub), rich shared views (folded tool rows, images, audio,
video), notifications (in-app + e-mail), and a Docker deployment with nightly backup
(`deploy/` and `docs/self-host.md` in the public repository).
