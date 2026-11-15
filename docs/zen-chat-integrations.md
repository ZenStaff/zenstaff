# Zen Staff chat integrations ("Integrări chat")

A company talks to its AI staff from the chat tools it already uses. People mention the bot (or
DM it, or type `/zen <task>`), the agent answers in the thread, posts scheduled reports, and asks
the agent's manager to approve outbound actions with buttons. Code: `apps/server/src/zen/chat/`,
`packages/contracts/src/zenChat.ts`, `apps/web/src/zen/chat/`.

## Product rules (as built)

- **The app lives in the customer's own account.** Each platform's app/bot is created and approved
  by the customer's admin in their workspace or tenant (manifests and step-by-step guides on the
  setup page). We own no bot that talks to customers.
- **Bot tokens live only on the company runner**, in the toolchains vault
  (`<zen home>/toolchains/access/vault.json`, AES-256-GCM, key in the OS keychain or an owner-only
  file), under `chat:<connection id>`. They are sent once from the setup page to the runner, never
  returned, never put in an agent's environment, never sent to the hub.
- **Outbound transports first:** Slack Socket Mode, Discord gateway, Telegram long polling. No
  inbound port on the runner.
- **Webhook platforms through the hub relay:** Microsoft Teams (Bot Framework), Google Chat (HTTP
  endpoint) and WhatsApp Cloud API need a public HTTPS URL. That URL is on our hub, which forwards
  the raw request to the runner over the runner's existing outbound socket.
- **Company vs personal:** a company agent runs only on the company runner, on the company's AI
  account. A personal agent answers only its owner, only in a DM, and only when the owner's own
  machine runs it on the owner's account (on that machine, not a runner); otherwise the bot says it
  is unavailable. Nobody's personal subscription serves anybody else.
- **Terms of service:** official APIs and bot accounts only; no user tokens, no scraping;
  WhatsApp only through the official WhatsApp Business Cloud API, with an approved template for
  anything sent outside the 24-hour customer-service window (reports are always sent that way).

## Architecture

```
 Slack ──Socket Mode (wss, runner dials out)──┐
 Discord ──gateway (wss, runner dials out)────┤
 Telegram ──getUpdates long poll──────────────┤        company runner (Zen Staff server)
                                              ├──> adapter ──> ChatEngine ──> agent thread (orchestrator)
 Teams / Google Chat / WhatsApp               │       ^            │  follow run: typing, answers,
   └─HTTPS─> zen-hub ──runner socket frame────┘       │            │  approvals, files, reports
                                                      └─ PlatformClient (answers go straight
                                                         from the runner to the platform API)
```

- `model.ts`: platform-neutral `InboundEvent` (message / action) and `PlatformClient`.
- `adapters/*.ts`: one per platform: pure translation of recorded payload shapes, the client
  (post, update, typing, DM, upload, download, answer), the transport, `test()` and the install
  manifest. Downloads send a token only to the platform's own hosts.
- `policy.ts` (pure): workspace/channel allow-lists, channel -> agent bindings, mention rules,
  platform user -> company member (explicit identity link, else the e-mail the platform vouches
  for), company/personal rules, approvals (only the agent's manager), quiet hours, report schedule,
  conversation keys.
- `text.ts` (pure): Markdown -> Slack mrkdwn / Telegram HTML / WhatsApp / Google Chat / Teams,
  long-answer chunking that keeps code blocks valid, inbound decoding, `/zen` parsing, the files
  an answer embeds.
- `engine.ts`: routes events, maps a platform thread (or DM) to one Zen thread per agent, follows
  the run every second (typing or a "Working..." placeholder, finished messages, approvals),
  formats, redacts (`redactSensitive`, `packages/contracts/src/zenSecrets.ts`), chunks and posts;
  inbound files are downloaded (size-limited) to `<state>/zen/chat/inbox/` and listed in the
  message; outbound files are those the answer embeds (`![title](/abs/path)`), only from the
  agent's project folder or the chat inbox, within the platform's limit.
- `ZenChat.ts`: the Effect service: connection lifecycle, the `AgentRuntime` on the orchestrator
  (`ThreadLaunchService.launch`, `sendToThread` queue mode, `getThreadRecords`,
  `runtime-request.respond`), RPC `zen.chat.call {op, input}`.
- `store.ts`: `chat.json` (config, no secrets), `runtime.json` (conversations, approvals, runs
  being followed: survives restarts), `audit.log` (JSONL, 5 MB rotation). All mode 0600.

### Approvals

With `auto-accept-edits` (the default for chat agents) the provider asks before commands and
actions outside the folder. Each pending runtime request becomes an approval: a card with
Approve/Decline goes to the agent's manager as a DM when the manager's identity on that platform is
known (Slack, Telegram after /start, Teams with the app installed, Discord, Google Chat; WhatsApp
inside the 24 h window), and the thread gets "Waiting for approval from X"; otherwise the card is
posted in the thread. Either way a click is accepted only from the platform user that maps to the
manager's member e-mail; anybody else gets a private "Only X can answer". The decision goes to the
provider (`runtime-request.respond`), every card is updated, replays are refused.

### Hub relay contract (hub v2 side to build)

The platform calls `{hub}/v1/chat/webhook/{environmentId}/{connectionId}` (shown on the setup page
as the connection's webhook URL). The hub forwards one frame on the environment's runner socket:

```json
{
  "t": "req",
  "id": "...",
  "op": "chat.webhook",
  "input": {
    "connectionId": "teams-ab12",
    "method": "POST",
    "path": "/",
    "query": {},
    "headers": { "authorization": "Bearer ...", "content-type": "application/json" },
    "bodyBase64": "..."
  }
}
```

and answers the platform with the runner's `{status, headers, body}` (503 when the runner is
offline; the platforms retry). Runner side: `ZenHub` sends every `chat.*` op to
`zen/chat/relay.ts` before its share checks; the connection's adapter verifies the platform's
signature (Teams: Bot Framework JWT with issuer, audience = app id, `msteams` endorsement and the
`serviceUrl` claim; Google Chat: Google's JWT with audience = project number; WhatsApp:
`X-Hub-Signature-256` with the app secret, plus the GET verify-token handshake) and only then reads
the body. Body limit 4 MB.

**What the hub sees:** in transit and in memory only, the request metadata (environment and
connection id, headers including the platform's token or signature, size, timing) and the message
payload (text, sender ids and display names, e-mails Google sends, file links). It must not log or
store bodies. It cannot forge or alter events (signatures are checked on the runner with secrets
the hub never has), and it never sees answers: those go from the runner straight to the platform.

## Security

- Inbound: signature/JWT checks above; Socket Mode, gateway and long polling are authenticated by
  the runner's own token on an outbound connection.
- Allow-lists: an event from a workspace/tenant/guild not on the connection's list is ignored;
  only bound (or allow-listed) channels are answered; bot messages are ignored.
- People: unknown platform users and guests cannot give tasks (the bot tells them their platform
  id so an admin can link it); approvals only from the manager.
- Rate limit: 12 messages per person per minute per connection.
- Logging: every inbound and outbound message, approval and secret change in `audit.log`,
  metadata only (ids, sizes, outcome, redaction kinds); message text only when "Log message text"
  is on, and then redacted.
- Outbound redaction of keys, tokens, passwords, connection strings, CNP and card numbers in every
  answer, card and log line.
- Access tier (enterprise): company connections start only on the company runner (hub runner or
  the local "company's always-on server" switch); managing integrations needs a grant
  (`packId: "chat-integrations"` in the runner's `toolchains/access/ledger.json`; the first admin
  who confirms becomes the first grant); storing a token and granting require the admin
  confirmation.
- Dev override `ZEN_CHAT_<PLATFORM>_API_URL` (fake harness only) points an adapter at another API
  base; it is read from the server's environment, never from the page.

## Platforms

| Platform    | Transport                        | Threads                     | Typing                  | Buttons                                   | Slash        | Files in / out                           |
| ----------- | -------------------------------- | --------------------------- | ----------------------- | ----------------------------------------- | ------------ | ---------------------------------------- |
| Slack       | Socket Mode                      | thread_ts                   | "Working..." then edit  | Block Kit                                 | `/zen`       | yes / yes (files.\*UploadExternal)       |
| Teams       | hub relay (Bot Framework)        | channel `;messageid=`       | native                  | Adaptive Card Action.Submit               | command list | yes / images inline only                 |
| Discord     | gateway v10                      | Discord threads = channels  | native                  | components                                | `/zen`       | yes / yes                                |
| Telegram    | long polling                     | reply chains                | native                  | inline keyboard                           | `/zen`       | yes (20 MB) / yes                        |
| Google Chat | hub relay                        | thread.name                 | "Working..." then edit  | cardsV2                                   | `/zen`       | yes / no (API needs user auth)           |
| WhatsApp    | hub relay (Cloud API)            | one conversation per number | read + typing indicator | reply buttons (3)                         | no           | yes / yes (inside 24 h)                  |
| E-mail      | polling (Gmail API, Graph, IMAP) | References / Gmail threadId | none                    | approvals on the page + manager's chat DM | no           | yes (25 MB) / attachments after approval |

## E-mail (the company's own mailbox)

The runner polls the mailbox (default every 60 s) and never answers on its own: each agent answer is
a draft the agent's manager approves (Aprobări e-mail tab, or a chat card when linked). Tokens stay
in the runner's vault (`chat:<connection>`): `password` (IMAP/SMTP app password) or `clientSecret` +
`refreshToken` (OAuth). Nothing passes through the hub.

Admin steps, Gmail (Google Workspace):

1. In the company's own Google Cloud project: APIs & Services > enable **Gmail API**.
2. OAuth consent screen: **Internal**; scopes `https://www.googleapis.com/auth/gmail.modify` and
   `https://www.googleapis.com/auth/gmail.send`.
3. Credentials > OAuth client ID > Web application; redirect URI
   `https://developers.google.com/oauthplayground`.
4. OAuth Playground > settings > "Use your own OAuth credentials"; authorize both scopes signed in
   as the mailbox; exchange the code; copy the refresh token.
5. Zen: mailbox type `gmail`, address, client ID; tokens: client secret, refresh token.

Admin steps, Microsoft 365:

1. entra.microsoft.com > App registrations > New registration, single tenant, redirect URI (Web)
   `https://localhost`.
2. API permissions > Microsoft Graph > Delegated: `Mail.ReadWrite`, `Mail.Send`, `offline_access`;
   **Grant admin consent**.
3. Certificates & secrets > New client secret.
4. Sign in once as the mailbox with the authorization code flow
   (`https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize?client_id=...&response_type=code&redirect_uri=https://localhost&scope=offline_access%20Mail.ReadWrite%20Mail.Send`),
   exchange the code at `/oauth2/v2.0/token` and keep the refresh token.
5. Zen: mailbox type `graph`, address, client ID, tenant ID; tokens: client secret, refresh token.
   A label `Zen/Ana` is the folder `Ana` under `Zen`.

Any other mailbox: type `imap`, IMAP host/port (993 TLS), SMTP host/port (465 TLS or 587
STARTTLS), an **app password** (never the account password).

Routing: aliases delivered to the mailbox (`ana@firma.example`) or labels / folders (`Zen/Ana`) bound to
agents under Channels; `inbox` takes the rest. Allow-list = senders (`ana@client.example`, `@client.example`,
`*.grup.example`). Every mail is untrusted input (see ZEN.md "E-mail as a channel" for the checks).

Local test mailbox: `node apps/server/src/zen/chat/dev/fakeMail.ts 3991 3992 3993 office@x.example
app-pass` (IMAP, SMTP, control: `POST /deliver?folder=INBOX` with a raw mail, `GET /sent`); set the
connection's security to `plain-local-test` and `ZEN_CHAT_EMAIL_POLL_MS=3000`.

## Testing without a real workspace

`apps/server/src/zen/chat/dev/fakePlatforms.ts` is a local fake of the Slack Web API + Socket Mode
(its own RFC 6455 socket) and the Telegram Bot API (long polling), with a control API to inject
mentions and button presses. `dev/e2eChat.ts setup` writes a throwaway configuration and tokens;
`dev/e2eChat.ts run <fake> slack|telegram` drives: mention -> agent answers in the thread ->
approval card to the manager -> refused click from the requester -> manager approves -> the action
runs -> final answer.
