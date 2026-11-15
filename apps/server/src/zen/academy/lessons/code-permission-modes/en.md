---
learn:
  - What each of the four permission modes really allows
  - Where the agent may run fully on its own and where it may not
  - How to write allow, ask and deny rules and what they cannot stop
  - How to use hooks and how to clean up the rules you approved
---

## The four modes

Claude Code runs in one of four permission modes. In Zen Staff, the project's runtime mode maps to one of them.

- **default**: asks before every file edit and every command that isn't already allowed. Slow, safe. Good for unfamiliar repos.
- **acceptEdits**: edits files without asking, still asks before shell commands. Good for everyday work, if you review the diff before commit.
- **plan**: read-only. The agent explores and proposes a plan, changes nothing. Use it first on anything risky: migrations, auth, refactors.
- **bypassPermissions**: everything allowed, no questions. Claude refuses to start this way as root, for good reason.

:::picture permissions
From "ask every time" to full access.
:::

:::tip
Codex has the same idea in two knobs: approval policy (`untrusted`, `on-request`, `never`) and sandbox (`read-only`, `workspace-write`, `danger-full-access`).
:::

## Where bypass belongs

Full autonomy is useful for long tasks. It belongs where the worst case is "throw it away": a container, a VM, a devcontainer, a cloud sandbox.

:::dont
You run bypassPermissions on your laptop with SSH keys, browser cookies and a `~/.aws/credentials` file, or on a server running production.
:::

:::do
You run it in a container or VM you can throw away at any time.
:::

:::warn
A git worktree isolates the code, not the machine. The agent can still read your home folder and reach the network.
:::

## Allow, ask, deny

Rules live in `.claude/settings.json` (shared with the team, committed) and `.claude/settings.local.json` (yours, not committed). Deny wins over allow.

:::example A starting settings.json
```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": ["Bash(pnpm test:*)", "Bash(pnpm typecheck)", "Bash(git status)", "Bash(git diff:*)"],
    "ask": ["Bash(git push:*)", "Bash(pnpm add:*)", "WebFetch"],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)",
      "Bash(rm -rf:*)",
      "Bash(git push --force:*)",
      "Bash(curl:*)",
      "Bash(wget:*)",
      "Bash(sudo:*)"
    ]
  }
}
```
:::

:::warn
Prefix rules on Bash are not a sandbox. `Bash(npm run:*)` also allows whatever is in `package.json` scripts, and a deny on `curl` doesn't stop `node -e "fetch(...)"`. They cut noise and catch mistakes. For real isolation you need a real sandbox.
:::

## Hooks as guardrails

A `PreToolUse` hook runs before each tool call and can block it: it exits with code 2 and writes the reason to stderr.

Use it for rules that are hard to express as patterns:

- block edits to `migrations/` already applied;
- block any command containing a production hostname;
- block writes outside the project.

:::warn
Hooks run code with your permissions. Review them in repos you clone, the same as you would a `postinstall`.
:::

## Review what you clicked

Every "Yes, and don't ask again" adds an allow rule, usually to `settings.local.json`. After a few weeks there's a long list nobody remembers approving, often with `Bash(*)`-style wildcards.

:::do
Run `/permissions` in Claude Code once in a while and delete what you don't need.
:::

:::tip
Also check `.mcp.json`. Each MCP server is a set of tools the agent can call.
:::

## Try it now

:::try
You pick a project and the agent reads its agent configuration: settings, local settings, MCP config, CLAUDE.md and hooks. It lists what's allowed and which risky actions have no deny rule, then proposes a least-privilege `settings.json` with one line explaining each rule. It doesn't change any files. Read the proposal and keep only the rules you understand.
:::

:::quiz
You want the agent to work alone for a few hours, no questions. Where do you run bypassPermissions?

- [ ] On your laptop, in a separate git worktree.
- [x] In a container or VM you can throw away.
- [ ] On the production server, so it sees real data.

> A worktree only isolates the code. A container or VM isolates the machine, so the worst case is throwing it away.
:::

:::quiz
You added a deny on `Bash(curl:*)`. Can the agent still send data over the network?

- [ ] No, deny wins over allow, so the network is blocked.
- [x] Yes, for example with `node -e "fetch(...)"`.
- [ ] Only if it runs as root.

> Prefix rules catch mistakes, but they are not a sandbox. For real isolation you use a sandbox.
:::

:::quiz
A risky database migration is next. Which mode do you start in?

- [ ] acceptEdits, so it goes faster.
- [ ] bypassPermissions, so it doesn't interrupt you.
- [x] plan, so the agent reads and proposes without changing anything.

> In plan mode the agent only explores and proposes. You let it edit only after reading the plan.
:::
