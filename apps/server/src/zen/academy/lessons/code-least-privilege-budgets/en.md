---
learn:
  - How to give each agent its own credential with the smallest scope
  - How to limit the network of an autonomous agent
  - What limits to set on the /limits page and where the kill switch is
  - What to keep so you know what an agent did
---

## Plan for the agent having a bad day

An agent can misread a task, loop on a failing step, or get steered by injected text. You can't make that impossible.

You can make sure the damage is small, visible and stops on its own. That's what least privilege and budgets are for.

## One agent, one identity, smallest scope

- **Separate credentials per agent.** The nightly dependency-update agent and the support-triage agent don't share a token. When one misbehaves, you revoke one key and know exactly what it could touch.
- **Fine-grained GitHub tokens.** A fine-grained PAT (or a GitHub App) limited to one repo, with only `contents: read/write` and `pull_requests: write`. Set an expiry.
- **Cloud roles scoped to the job.** An agent that uploads build artifacts can `PutObject` on one bucket prefix. It can't list IAM users.

:::dont
A classic GitHub token with `repo` on every repo you own, shared by all agents.
:::

:::do
One fine-grained token per agent, on one repo, with an expiry.
:::

## The database and production

An agent that answers questions about data gets a role with `SELECT` on specific tables or views, nothing else:

```sql
create role agent_reports login password '...';
grant usage on schema reporting to agent_reports;
grant select on reporting.daily_sales, reporting.stock_levels to agent_reports;
alter role agent_reports set statement_timeout = '15s';
```

Dev agents get no production credentials. They get test keys (`sk_test_`), a local or staging database, sandbox accounts. If a task truly needs production, it goes through a reviewed script or a human.

:::picture secrets
Every agent has its own key, and dev keys are test keys.
:::

## Network

Most exfiltration needs an outbound request. Run autonomous agents in a container with an egress allowlist: your git host, the package registry, the model API.

:::warn
Block cloud metadata (`169.254.169.254`) and internal admin panels. If the task doesn't need the internet, turn it off.
:::

## Budgets, limits and records

Scheduled agents run while nobody watches, so limits do the watching. In Zen Staff, you set them on the `/limits` page:

- **Max runs per day** per scheduled agent, so a misfiring trigger can't run it 200 times.
- **Max minutes per run**, so a loop ends on its own.
- **Max concurrent runs**, so ten agents don't fight over the same repo or rate limits.
- **Quiet hours**, so nothing starts during deploys, backups or peak traffic, or when no one is around to react.
- **Pause all**: the kill switch. Know where it is before you need it.

On top of that, set a spend limit with your model provider and a max-turns or max-tokens setting on long tasks. A runaway agent costs money before it does damage.

:::tip
You need to answer "what did the agent do at 03:12?" without guessing. Keep the thread transcript, the commands it ran, the commits and PRs it opened, and API calls under its own credential. Agents open PRs, they don't push to main: the PR history is your audit log. Review the scheduled agents' output weekly, even when nothing failed.
:::

## Try it now

:::try
The button opens the `/limits` page. Go through each scheduled agent and set a max runs per day and max minutes per run that match what it really needs. Add quiet hours and find the "Pause all" switch.
:::

:::quiz
A scheduled agent wrote strange things to the repo. All agents share the same GitHub token. What is the problem?

- [ ] None, you revoke the token and you're done.
- [x] To stop it you have to stop all of them, and you can't be sure what each one did.
- [ ] The token should have been classic, not fine-grained.

> With one credential per agent you revoke a single key and see exactly what was done with it.
:::

:::quiz
A broken trigger starts the same agent again and again, at night. What protects you?

- [ ] The agent noticing on its own that it already ran.
- [ ] A weekly review of the PRs.
- [x] The max runs per day and max minutes per run set in `/limits`.

> Limits work even when nobody is watching. The weekly review comes after.
:::
