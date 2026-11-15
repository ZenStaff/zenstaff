---
learn:
  - Why you read the diff and not the agent's summary
  - What to check line by line before you merge
  - Habits that keep a diff small enough to actually read
---

## The summary is not the change

An agent's final message says "Fixed the login bug and added tests". The diff may also bump three packages, delete a flaky test, add `// @ts-ignore` in two places and widen a CORS rule.

Agents optimize for "task looks done". Your job at review time is to check what actually changed, line by line.

In Zen Staff, open the diff panel for the thread, or run `git diff main...HEAD` in the terminal. Read every hunk.

:::picture code-diff
The green and red lines are the real change. The summary is only an opinion.
:::

:::tip
If the diff is too big to read, it is too big to merge.
:::

## What slipped in next to the task

- **Scope creep.** Files that have nothing to do with the task. Reformatted files hide real changes. Ask for formatting in a separate commit.
- **Tests removed or weakened.** `it.skip`, `xit`, deleted test files, `expect(x).toBeTruthy()` replacing a precise assertion, snapshots updated without reason. An agent stuck on a red test sometimes "fixes" the test.
- **Checks disabled.** `eslint-disable`, `@ts-ignore`, `as any`, a CI step commented out, `--no-verify` in a script.
- **New dependencies.** Every new line in `package.json` needs a reason. Check the name exists and is the real package: agents invent names.

## What can break security

- **Secrets.** Keys pasted into config, test fixtures with real tokens, `.env` staged.
- **Auth and permissions.** Changes to middleware, route guards, RLS policies, role checks. A missing `requireAuth` is one line and easy to miss.
- **Migrations.** `DROP`, `ALTER ... TYPE`, new tables without RLS, data backfills without a `WHERE`.
- **Swallowed errors.** `catch {}` or `catch (e) { return { ok: true } }` makes the bug disappear from your logs, not from production.

:::example Looks like a fix, is a hidden bug
```ts
try {
  await chargeCard(order);
} catch (e) {
  console.log(e);
}
return { status: "paid" };
```

The charge failed, but the order shows as paid.
:::

## Habits that make review possible

- **Small PRs.** One task per thread, one branch per thread (use worktrees). 200 lines is reviewable, 2,000 is not.
- **Run the tests yourself.** Run `pnpm test` and the typecheck in the terminal.
- **Ask about risky hunks.** Good answers are specific. Vague ones are a signal.
- **Second opinion.** Ask a different model, or a fresh thread with no history, to review the same diff. It won't share the first agent's blind spots.
- **Check the commit, not the working tree.** Agents sometimes leave changes unstaged. Review what will actually be merged.

:::dont
You trust "all tests pass" in the agent's message.
:::

:::do
"Why did you change `auth.ts` line 42? What breaks if I revert it?"
:::

## Try it now

:::try
You pick a project and the agent gets a strict review prompt. It reads `git status`, `git diff` and the last commit, checks them against the list in this lesson and gives you findings with file:line, severity and a verdict. It doesn't modify, stage or commit anything. Then open the diff yourself and check the findings marked as blockers.
:::

:::quiz
The agent writes "Fixed the bug, all tests pass". What do you do before merging?

- [ ] Merge, the message is clear.
- [x] Read the diff hunk by hunk and run the tests yourself in the terminal.
- [ ] Ask the agent to confirm once more that the tests pass.

> Agents optimize for "looks done". Only the diff and tests you run yourself show what actually changed.
:::

:::quiz
In the diff, an old test changed from `expect(total).toBe(120)` to `expect(total).toBeTruthy()`. What does that mean?

- [x] The test was weakened, probably to make it pass. You ask why.
- [ ] It is a harmless simplification.
- [ ] It is better, the test now covers more cases.

> An agent stuck on a red test sometimes "fixes" the test instead of the code.
:::

:::quiz
The diff has 2,000 lines, mostly reformatting. What do you ask for?

- [ ] Nothing, reformatting doesn't change logic.
- [ ] More tests in the same PR.
- [x] Formatting in a separate commit and a smaller PR you can actually read.

> Reformatted files hide real changes. If you can't read the diff, you don't merge it.
:::
