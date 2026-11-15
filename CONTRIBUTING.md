# Contributing to Zen Staff

Thank you for helping. A few things make a contribution easy to accept:

- **Bugs first.** Open an issue with the version, your OS and the steps to reproduce. Bugs that
  also exist in upstream T3 Code are usually best fixed there; tell us and we will follow.
- **Talk before big changes.** For a new feature or a redesign, open an issue first so we can agree
  on the approach before you spend time on it.
- **Keep the fork mergeable.** Zen Staff merges upstream T3 Code daily. Change upstream files as
  little as possible (a few lines, importing from a Zen file); put new code in Zen-owned files
  (`zen/` folders, `packages/contracts/src/zen*.ts`). See ZEN.md, "How the fork is kept mergeable".
- **Checks.** `pnpm typecheck`, `pnpm lint` and the tests of the packages you touched must pass.
- **No secrets, no personal data** in code, tests or screenshots. Use `example.com` / `.example`
  addresses and obviously fictional phone numbers (0700 000 xxx).
- **License.** By contributing you agree that your contribution is licensed under the MIT license
  of this repository.

Security problems: security@zenstaff.app, never a public issue.
