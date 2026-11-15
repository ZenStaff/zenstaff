# Zen Staff

Zen Staff is a desktop app for working with AI agents: chats, documents, workflows and "AI staff"
that run on your own computer with your own AI account (Claude Code, Codex and others). It is free
and open source (MIT) on Windows, macOS and Linux.

Teams add the hub (shared chats, approvals, company memory, AI staff of the company). The hub is
hosted by us as the paid Team plan, or self-hosted for free for your own company:
[ZenStaff/zenstaff-selfhost](https://github.com/ZenStaff/zenstaff-selfhost).

- Download: [zenstaff.app/descarca](https://zenstaff.app/descarca)
- Website: [zenstaff.app](https://zenstaff.app)
- Support: support@zenstaff.app

## Based on T3 Code

Zen Staff is a distribution of [T3 Code](https://github.com/pingdotgg/t3code), the open source GUI
for coding agents built by Theo, Julius and the T3 Code contributors. All credit for the core of
the product goes to them. T3 Code is MIT licensed and its license notice is kept unchanged in
[LICENSE](LICENSE). What Zen Staff adds (the Office edition, AI staff, workflows and packs, the
Academy, companies and memory, the hub client, Romanian) is described in [ZEN.md](ZEN.md).

Agents never run on our servers and Zen Staff never routes your AI traffic: the app starts the
official CLI of your AI provider on your machine, signed in with your own account.

## Command line

The desktop app can install the `zs` command (Settings). A standalone CLI for servers:

```sh
curl -fsSL https://zenstaff.app/install.sh | sh                 # macOS, Linux
irm https://zenstaff.app/install.ps1 | iex                      # Windows PowerShell
```

The scripts download the archive of the latest release from this repository and verify its
SHA-256 against the release's `SHA256SUMS`.

## Build from source

Requirements: Node.js (the version in `package.json` `engines`), pnpm via Corepack, Rust (stable)
for the native helpers, and on Linux `libsecret-1-dev` and `pkg-config`.

```sh
corepack enable
pnpm install
pnpm dev            # server + web client in development mode
pnpm dev:desktop    # the desktop app in development mode
pnpm typecheck
pnpm test
```

Desktop installers: `node scripts/build-desktop-artifact.ts --platform <linux|win|mac>`.
CLI archive: see `.github/workflows/release-cli.yml`.

## Telemetry

Nothing is sent before you choose. With your consent the app sends one anonymous report per day
(version, OS, counts of chats and workflows; never content, names or paths). Details in ZEN.md.

## License

MIT, see [LICENSE](LICENSE): copyright T3 Tools Inc. (T3 Code) and FORTITUDO VINCIT S.R.L. (Zen
Staff modifications). Third-party notices are in `third-party-licenses/`. The self-hosted hub and
memory are a separate project under the Sustainable Use License.

## Security

Please report vulnerabilities to security@zenstaff.app; see [SECURITY.md](SECURITY.md).
