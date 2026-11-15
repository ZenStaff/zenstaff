# Zen Staff: notes on the fork

Zen Staff is a distribution of [T3 Code](https://github.com/pingdotgg/t3code) (MIT). The upstream
`LICENSE` notice is kept unchanged; Zen Staff's changes are released under the same MIT terms
(copyright FORTITUDO VINCIT S.R.L., operator of Zen Staff).

## How the fork is kept mergeable

Upstream ships many commits a week and is merged daily, so every changed line in an upstream file is
a future conflict. Three rules:

1. **Brand values live in Zen-owned files**; upstream files only import them.
   - `packages/contracts/src/zen.ts`: the product name (`ZEN_APP_BASE_NAME = "Zen Staff"`), the
     home folder `~/.zen`, port `3873`, URL scheme `zen`, product and download URLs, the CLI name
     `zs` (aliases `zen`, `zenstaff`), the release repository of the CLI.
   - `apps/desktop/src/zen.ts`, `apps/server/src/zen.ts`, `scripts/lib/zen-brand-assets.ts`,
     `apps/mobile/src/zen/config.ts`: platform-specific ids, icons and settings.
2. **Internal identifiers stay upstream's**: package names (`@t3tools/*`, server package `t3`),
   Effect service names, the `T3CODE_*` environment variables, storage keys, the CLI archive's
   executable file `t3`.
3. **User-visible "T3 Code" text is rewritten by a codemod** (`scripts/zen-rebrand.ts`), not by
   hand, so a conflicted string is resolved by taking upstream's line and running the codemod again.

New features live in `zen/` folders (`apps/server/src/zen`, `apps/web/src/zen`, ...) and in
`packages/contracts/src/zen*.ts`; upstream files get a one- to five-line hook.

## Isolation from an installed T3 Code

Zen Staff can run next to T3 Code: its own home (`~/.zen`, `ZEN_HOME`), its own config file
(`zen.json`, falling back to `t3.json`), port 3873, URL scheme `zen://`, app ids, Electron profile
and updater cache. It never installs or shadows a `t3` command.

## What Zen Staff adds

- **Office edition**: a non-technical workspace (Birou, AI staff, Academy, documents with inline
  editing) next to the Code edition upstream offers.
- **Workflows and packs**: ready-made workflows with their toolchains, a signed remote pack
  registry and a community library.
- **Companies**: one person can work for several companies; each company has its own memory,
  projects, members and AI staff. The hub (separate repository) connects colleagues.
- **Company memory client**: one short summary per finished conversation goes to the company's
  memory server, which agents search later.
- **Languages**: Romanian next to upstream's languages.
- **Voice input, chat integrations, scheduled workflows, client approval links.**

## Updates

The desktop app updates from our own feed (`ZEN_RELEASES_BASE_URL` in
`packages/contracts/src/zenReleases.ts`, public at `releases.zed-zen.com`), never from upstream's.
Windows (NSIS) and Linux AppImage update in place; deb/rpm show a download link; macOS updates
are off until a signed, notarized build exists. Channels: Stable and Beta (Settings > Updates).
The `zs` CLI and the SSH remote install use the GitHub releases of this repository.

## Telemetry

Upstream's PostHog telemetry is replaced and never used. Nothing is counted or sent before the
person chooses on the first-run screen (or later in Settings > Privacy). With consent, one report
per day: app version, OS, architecture, edition, language, and counts (chats, messages, approvals,
workflows, packs by bundled id, errors by type). The daily id is a hash of a random install id that
never leaves the machine, so days cannot be linked. Never content, prompts, file names, paths,
e-mail addresses or company names. A managed policy can turn it off for a whole organization.

## Tests

Some upstream tests check T3 Code's identity (names, URLs); in this fork they are adjusted to the
Zen values or expected to fail. Run the tests of the packages you change.
