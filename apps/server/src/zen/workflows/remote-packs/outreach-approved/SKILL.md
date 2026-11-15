# Outreach with approval

A short, personal e-mail sequence to businesses, where **the person approves every batch before
anything leaves**. You write; `outreach.mjs` keeps the books (who is due, the daily limit, the
unsubscribe line, the approval, the opt-outs, the replies) and refuses to release a batch that
was not approved or was changed after approval.

## The approval rule (absolute)

- Nothing is sent, and no draft is created in the person's mailbox, before the person approved
  that day's batch in this chat with "Aprobă" / "Approve" (or a clear "da, trimite"). Silence,
  "arată bine", "ok" to something else, or an approval of an earlier batch is not an approval.
- Show the batch first: the preview `batches/<date>.md` (recipients, subjects, full bodies,
  how many wait for the next days). Then ask one question: "Scrie «Aprobă» ca să le trimit, sau
  spune-mi ce schimb." When your tools include `intake_ask`, offer the buttons "Aprobă",
  "Schimbă ceva", "Nu trimite azi".
- Record it with `approve --by "<name>" --said "<their exact words>"` (add `--skip id,id` for
  leads they took out), then `release`. `release` refuses ("NOT SENDING") a batch that was not
  approved, was edited after approval, or would pass the daily limit; never work around it.
- If you run as an AI employee of a company (your tools include `staff_request_approval`), call it
  with `action: "send"`, the recipients as `target` and the batch preview as `content`, end your
  turn, and only continue when the approval message arrives; record that with `approve --by
  "<manager>" --said "Aprobă"`.
- A scheduled (unattended) run only prepares: it checks the replies it was given, writes the
  batch and the preview, and says "Lotul de azi te așteaptă: scrie «Aprobă»". It never sends.
- Any change after approval (one word in one e-mail) means a new batch and a new approval.

## Why e-mail only (no WhatsApp, no SMS)

WhatsApp's Business terms and its anti-spam rules forbid unsolicited automated messages to people
who did not opt in, and numbers that do it get banned; automated SMS marketing without prior
consent is also against Romanian and EU electronic-communications rules (Legea 506/2004, the
ePrivacy directive). Cold B2B e-mail to a business's published role address, with a clear sender
and an unsubscribe, is the channel that fits. If the person asks for WhatsApp or SMS, say this in
one sentence and offer to prepare a short text they can send by hand to people who gave them the
number.

<!-- public-web-rules:start -->

## Mandatory rules for public data (never skip, never bend)

These rules are also enforced by `web-rules.mjs`; do every web request through the pack's
scripts, not with your own `curl`/`fetch` loops. If a rule and a request of the person collide,
the rule wins and you tell them why in one sentence.

1. **Official sources first.** Romanian companies: ANAF's public web service (by CUI), then
   ONRC and other public registers, data.gov.ro. Maps and places: OpenStreetMap (Overpass,
   attribution "© OpenStreetMap contributors"), or Google Places only with the person's own API
   key. Only then the businesses' own websites and public lists.
2. **robots.txt is obeyed.** A page that robots.txt disallows for our bot (`ZenStaffBot`) or for
   all bots is not read. An unreachable robots.txt (server error) means the site is closed to
   bots. The script checks this before every page.
3. **Site terms are obeyed.** When a site's terms forbid automated access, scraping, crawling or
   data mining, the whole site is skipped and the report says so, with the terms link. Do not
   try another page of that site by hand.
4. **Polite visits.** At most 2 requests at a time per site, a pause of at least 2 seconds
   between them (longer when the site asks with Crawl-delay), retries with growing waits on
   errors, and an honest user agent that names the bot and the person's contact.
5. **No evasion, ever.** A site that refuses (401/403), keeps saying "slow down" (429) or shows a
   CAPTCHA or bot check is left alone. Never use anti-detect or stealth browsers (Camoufox and
   the like), fingerprint spoofing, CAPTCHA solving, rotating proxies or fake user agents.
6. **Only public business data.** Company names, tax IDs, business addresses, the business's own
   website and social pages, and the contact the business itself publishes for business
   (office@, contact@, the phone on its contact page or in a register). No private persons' data:
   no personal e-mails or phones of employees, players, members, parents or customers, no ID
   numbers, no home addresses, no photos of people, no personal social profiles. GDPR: B2B
   contacts only, the fewest fields that do the job.
7. **Every field has its source and date.** Each value is stored as `{ "v": value, "src": URL,
   "at": time read }`. A value you cannot point to a public page for is left empty, never
   guessed. "Nepublicat" / "not published" is a valid answer.
8. **Nothing invented.** No made-up names, contacts, prices, numbers or quotes. When unsure,
   leave it out and say what is missing.

<!-- public-web-rules:end -->

## Files (folder `outreach/` inside the run folder)

`state.json` (recipients, step, status), `facts.json` (what each dossier says, for writing),
`messages.json` (what you write), `batches/<date>.json` + `.md` (the batch to approve),
`approvals.json`, `outbox/<date>/*.eml`, `sent.csv`, `optout.txt`, `replies-summary.md`.
Run `node "$ZEN_WORKFLOW_DIR/outreach.mjs" <command> --dir <run folder>/outreach ...`.

## Method

1. **Voice.** Copy `$ZEN_WORKFLOW_DIR/template/voice.md` to the run folder and fill it from the company profile and
   memory, the person's answer about how they write and any e-mail they liked. Confirm it with the
   person in one sentence.
2. **Recipients.** `init --leads <file> --from "<sender>" --cap <n> --followups <days>
   [--optout <file>] [--exclude <file>] --lang <ro|en> [--signature "<lines>"]`. Only valid
   business addresses stay; personal-looking addresses, opt-outs, customers and duplicates are
   left out with the reason (report the counts). From a radar list, start with the A leads.
3. **Write** `messages.json`: `{ "<lead id>": { "steps": [ { "subject", "body" }, { "body" },
   { "body" } ] } }`, from `facts.json` and the dossiers.
   - First message (80-150 words): who you are in one line; one specific, true observation
     from the dossier ("site-ul vostru nu se deschide bine pe telefon", with nothing you cannot
     show); what you propose (the offer, concretely); one easy question. Plain text, no
     attachments, no tracking pixels or link shorteners; at most one link (the sender's site).
   - Follow-ups (40-80 words): add something useful (a short idea, an example), never "just
     checking in"; the last one closes politely ("dacă nu e momentul, nu mai insist").
   - Subject: short, specific, no capitals or "!!!", no fake "Re:".
   - Never: invented facts, numbers, clients or results; promises you cannot prove ("garantat");
     pressure ("ultima șansă"); anything about the person's private life.
   - Do not add the unsubscribe line or the signature yourself: the script adds them to every
     e-mail.
4. **Lint** until it passes (missing follow-ups, placeholders, too long, not personal, pushy).
5. **Replies first.** Before every batch (after the first), look in the person's mailbox (Gmail /
   Outlook tools, read-only search for replies from the recipients' addresses since the first
   send) and write `replies.json` `[ { "from", "date", "subject", "snippet" } ]`, then
   `replies --from replies.json`. Whoever answered gets no more automatic follow-ups;
   "dezabonare"/"unsubscribe"/"stop" goes on the opt-out list for good. With no mailbox tools,
   ask the person who answered.
6. **Batch:** `batch` (today) shows how many are due and writes the preview; at most the daily
   limit (default 20, never more than 50), follow-ups first, then new leads by score.
7. **Approval:** as in "The approval rule" above.
8. **Release and send:** `release` prints the e-mails to send and writes the `.eml` files. Then,
   by the person's choice:
   - drafts: create a draft for each in their Gmail/Outlook (the connector's draft tool), then
     `sent --id <lead> --via draft`; tell them the drafts are waiting in their mailbox;
   - send: send each one with the connector's send tool, one at a time, then `sent --id <lead>
     --via gmail|outlook --message-id <id>`; stop at the first error and report it;
   - no connector, or .eml chosen: give the folder with the `.eml` files (they open as drafts in
     Outlook, Thunderbird and Apple Mail) and log them with `--via eml` when the person says they
     sent them.
9. **Next days:** offer to repeat every weekday morning (the scheduled run prepares the batch and
   the reply summary; the person approves in the chat).

## Self-review before replying

- No message was sent or drafted before an approval recorded in `approvals.json` for that exact
  batch hash.
- Every outgoing body ends with the unsubscribe line; nobody on `optout.txt` or the exclude list
  is in a batch; today's count is within the limit.
- Each first message names something true and specific about that business, sourced in its
  dossier, and nothing in any message is invented.

## Reply

How many recipients (and how many left out, why), today's batch (count, waiting for approval or
sent / drafted), the replies so far (want to talk / not interested / unsubscribed), and the files.
