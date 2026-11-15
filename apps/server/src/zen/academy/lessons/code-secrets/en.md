---
learn:
  - Where API keys leak, including through agent conversations
  - Why a key deleted from the code still has to be rotated
  - Which habits catch keys before you push
  - What to do in the first hour after a leak
---

## Where secrets actually leak

Most leaks are boring. Someone commits `.env` on the first day, before `.gitignore` exists. A key gets pasted into `config.ts` "just to test". A debug line prints the full `Authorization` header.

With coding agents there are new paths too:

- **Prompts and transcripts.** If you paste a key into the chat, it is now in the thread history, maybe in a shared chat, maybe in logs on the provider side.
- **Tool output.** When the agent runs `cat .env`, `env` or `docker inspect`, the values land in the conversation.
- **Generated code.** Agents happily write `const STRIPE_KEY = "sk_live_..."` if the key is in their context.

## Deleting is not fixing

Once a key has been pushed, assume it is compromised. Bots scan public GitHub within minutes. A new commit that removes the line does not help: the key stays in `git log -p`.

Rewriting history (`git filter-repo`) is cleanup, not the fix. **The fix is rotation**: revoke the old key at the provider, issue a new one, deploy it.

:::dont
`git rm .env && git commit -m "remove env"`
:::

:::do
Revoke the key in the Stripe or AWS dashboard, put the new key in your secret store, redeploy, then clean history.
:::

## Habits that prevent most leaks

- Add `.env*` (with `!.env.example`) to `.gitignore` before the first commit. Keep a `.env.example` with empty values.
- Run a scanner locally and in CI: `gitleaks git .` or `trufflehog git file://. --only-verified`. Add gitleaks as a pre-commit hook.
- Turn on GitHub secret scanning and **push protection**. It blocks the push instead of telling you afterwards.
- Never log tokens. Log `token.slice(0, 6) + "..."` if you need to correlate.

:::picture secrets
The key lives in `.env`, masked, and never gets committed.
:::

:::tip
Know your key types. In Supabase the `anon` / publishable key is meant for the browser (RLS protects the data). The `service_role` / secret key bypasses RLS and must only live on the server. Same idea with Stripe `pk_` vs `sk_`.
:::

## Secrets and the agent

:::dont
You paste the key straight into the chat so the agent can use it.
:::

:::do
"The key is in `STRIPE_SECRET_KEY`, read it from `process.env`."
:::

- Add a deny rule so the agent cannot read the file: `Read(./.env)` and `Read(./.env.*)` in `.claude/settings.json`.
- Don't give a dev agent production credentials. A dev agent gets test keys.

:::warn
If the agent printed a secret in a thread, treat it as leaked and rotate it.
:::

## The first hour after a leak

1. Revoke and rotate the key. This comes first, not third.
2. Check the provider's logs for use since the leak (AWS CloudTrail, Stripe events).
3. Find every copy: other repos, CI variables, chat threads, screenshots.
4. Clean history if the repo is shared, and tell the team why.
5. Add the scanner or rule that would have caught it.

## Try it now

:::try
Start a secrets-focused audit. Pick "Practice project" to scan a small app with a committed `.env`, keys in config and a token in the logs, or pick one of your own projects. The agent reports each secret with file:line, severity and whether the key must be rotated, without changing anything.
:::

:::quiz
You pushed a Stripe key in `config.ts`. What is the first step?

- [ ] A new commit that removes the line.
- [ ] Rewrite history with `git filter-repo`.
- [x] Revoke the key at Stripe and issue a new one.

> Once pushed, the key is compromised. Deleting it and cleaning history come after rotation.
:::

:::quiz
The agent needs an API key to test an integration. How do you give it?

- [ ] Paste it in the chat, the thread is private.
- [x] Tell it which env var holds the key and to read it from `process.env`.
- [ ] Write it in the code and remove it after the test.

> Whatever you paste into the chat stays in the thread history and maybe in provider logs.
:::

:::quiz
Which Supabase key may go in code that runs in the browser?

- [x] The `anon` / publishable key, with data protected by RLS.
- [ ] The `service_role` key, so every request works.
- [ ] None, Supabase can't be used from the browser.

> The `service_role` key bypasses RLS and must only live on the server.
:::
