# Zen Staff toolchains: security design

Workflows run open-source tools (FFmpeg, Chromium via Remotion, yt-dlp, pandoc, PyAV) on files
and pages that come from outside. This document says what the app enforces today, what the hub
will add, and what each operating system can and cannot confine. Code lives in
`apps/server/src/zen/toolchains/`; the overview is in ZEN.md, "Toolchains for workflows".

## 1. Supply chain: what gets installed

- Recipes are data with a closed list of step types (`download`, `npm`, `uvPython`, `venv`,
  `pip`, `remotionBrowser`). There is no "run this script" step; `catalog.ts` rejects unknown
  step types, http URLs, missing or malformed sha256 values and paths that leave the toolchain
  folder. A workflow can only name catalog tools and version ranges.
- Downloads are hashed while streaming and thrown away on mismatch, before unpacking. Zip
  entries with absolute or `..` paths are refused; tar archives come only from pinned hashes.
- npm installs run `npm ci --ignore-scripts` from a lockfile we ship (sha512 integrity for every
  package); pip installs run `uv pip install --require-hashes --only-binary :all:` (no sdist,
  no `setup.py`). Remotion's headless Chromium comes from Remotion's own `browser ensure`
  (Remotion pins the version; no checksum is published, which is the one unpinned download).
- Package-manager caches and the download cache live under `<zen home>/toolchains/.cache`.
  Nothing is written to the global PATH, the registry or system package managers.

## 2. Vulnerable versions: advisories, blocking, updates

- Each catalog entry may carry `minSafeVersion` and `blockedVersions` (exact versions or ranges
  with a reason and advisory ids).
- **Scanner** (`osvScanner.ts`, run daily as a night-ops job on the hub, or here):
  `node apps/server/src/zen/toolchains/osvScanner.ts --out advisories.json`. It queries OSV.dev
  (`/v1/querybatch`, then `/v1/vulns/{id}`) for every catalog tool version (`osv` packages: PyPI
  yt-dlp, uv, faster-whisper; Hackage pandoc; npm remotion packages) and for every package pinned
  in the shipped npm lockfile and pip requirements. GitHub Advisories reach it as GHSA records.
  CRITICAL, HIGH and unknown severities block the tool version (`--block-moderate` adds
  MODERATE); fixes of the tool's own package raise `minSafeVersion`. Its first real run blocked
  Remotion 4.0.538 because the lockfile pinned zod 4.5.4 (GHSA-mrhx-c7xc-m3w5, HIGH); the
  shipped lockfile now overrides zod to 4.6.6 and the scan is clean.
- **NVD** (`nvdScanner.ts`) covers what OSV does not: catalog entries name CPE products (`nvd`:
  FFmpeg, Node.js, Chrome headless shell with the component version per tool version). The
  scanner asks the NVD 2.0 API (`virtualMatchString`, all pages) one request at a time, 6.5 s apart
  without a key (NVD allows 5 per 30 s), and decides coverage itself from the CVE's version ranges.
  The night job publishes the merged file to the hub (`GET /v1/toolchains/advisories` is public).
  First run (08.11.2026): FFmpeg 8.1.3 (6 HIGH/CRITICAL CVEs fixed in 9.0), Playwright's Chrome
  156.0.8078.4 and Remotion's Chrome 157.0.8080.0 were blocked. The pins moved to Playwright 1.65.0
  with Chrome headless shell 158.0.8127.18 (Chrome for Testing, sha256 computed after download),
  Remotion 4.0.541 (its `browser ensure` fetches Chrome 158.0.8127.2) and FFmpeg 9.1-dev.128560:
  FFmpeg 9.0.2, the newest release, is still covered by CVE-2026-107696 (RTSP redirect loop, HIGH;
  fixed on master in f5d4fd186c, not backported to release/9.0), so the catalog pins BtbN's dated
  master build N-128560-g967f0ffb10 (autobuild-2026-11-07-12-47; sha256 equals GitHub's digest).
  Move back to a release once one contains that fix. The rescan is clean for every Linux x64
  recipe; FFmpeg 6.1.1 (the macOS recipe, eugeneware, no newer build there) stays blocked. The
  tesseract entry no longer lists its pip packages under `osv` (that queried Pillow at the tool's
  version, 5.5.3); its pinned requirements are scanned like every lockfile.
- **App side** (`advisories.ts`, `manager.ts`): rules = catalog + shipped `advisories.json` +
  the hub file from `ZEN_TOOLCHAIN_ADVISORIES_URL` (https only, cached in
  `toolchains/advisories.json`, never replaced by an older file). Checked every 12 h.
- **Enforcement:** a blocked installed version makes the check say "Updating for safety"; the
  Preparing step installs the safe version automatically, and a background job does the same for
  workflows that use it. If no safe version exists for the machine, the workflow is blocked with
  a plain sentence. `prepareThread` re-checks at thread start and refuses blocked versions, so a
  stale UI cannot start one.

## 3. Runtime isolation

| Platform            | What the tool launcher does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Strength                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Linux + bubblewrap  | `bwrap` as uid 65534 in a user namespace with no capabilities, read-only `/usr`, `/lib*`, `/etc/ssl`, fonts, `/etc/hosts` and `/etc/nsswitch.conf` (so `localhost` resolves offline), the toolchains, the thread's launchers and the workflow folder read-only (a launcher called from inside runs its command in the same sandbox: bubblewrap does not nest), the task folder read-write, private `/tmp` and `/dev/shm`, new PID/IPC/UTS namespaces, `--unshare-net` unless the workflow declares `network` or uses the credential proxy, `--die-with-parent`, never root inside. Home, other projects and SSH keys are not mounted. | Strong for file and network access of the tools.          |
| Linux without bwrap | Plain launcher (the probe reports `sandbox: none`; Settings > Tools says so).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | None beyond the user's permissions.                       |
| macOS               | `sandbox-exec` with a generated profile: no outbound network unless declared, writes only in the task folder and temp, no reads of `$HOME` except the task, toolchain and workflow folders. Apple marks `sandbox-exec` deprecated but still ships it.                                                                                                                                                                                                                                                                                                                                                                                 | Medium; untested.                                         |
| Windows             | Plain `.cmd` launcher. Job Objects (process limits, kill-on-close) need native code or a helper binary; AppContainer needs a signed helper. Not built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | None beyond the user's permissions.                       |
| Company server      | Run the Zen server itself in a container (Docker/Podman) with the zen home on a volume and no host mounts; the per-tool bwrap layer still applies inside.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Strongest; recommended for tools marked `untrustedInput`. |

Tools that parse outside input are marked `untrustedInput` (FFmpeg, Remotion/Chromium, yt-dlp,
pandoc, faster-whisper/PyAV). When a company server is connected, the Preparing step recommends
running there.

**Agent-level rules.** The agent itself (Claude Code) is not inside the tool sandbox. For
workflow threads the flag settings add permission rules: the declared commands (and their
launcher paths) are allowed without prompts; `sudo`, `su`, package managers (`apt`, `brew`,
`choco`, `winget`, `pip install`, `npm install`, `npx`, `pnpm`, `uv pip`...), `curl`, `wget`,
`Invoke-WebRequest` and `setcap` are denied. Deny rules hold in every runtime mode. Other
commands still follow the thread's approval mode; an allow-list-only mode ("dontAsk") would
break normal file work and is not used. Gap: an agent could still write and run its own script
with an allowed interpreter (`node`, `whisper-python`); the tool sandbox then confines it.

**Company agent threads ("Aprobări").** Company AI staff agents (`zen/staff`) must not send data
out of the company without their manager. Outbound connector tools are held by the staff gate
(`withZenStaffToolGate`); the shell is closed at the sandbox level, without guessing which
commands are dangerous (`apps/server/src/zen/staff/staffNetwork.ts`). While the company's
"Aprobări" switch is on (AI staff > Settings, default on), every company agent thread gets:

| Platform               | What is enforced for the agent's shell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Tested                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Linux + bubblewrap     | Claude Code's Bash tool (and its background commands and Monitor) starts its shell through `CLAUDE_CODE_SHELL` = a per-thread launcher named `bash` (`<state>/zen/staff/shell/<thread>/bash`) that runs the real bash in `bwrap`: empty network namespace (`--unshare-net`: no internet, not even the host's loopback services), user namespace as uid 65534 with no capabilities (no `nsenter`, no remount), new PID/IPC/UTS namespaces, seccomp filter refusing `socket(AF_UNIX)` and `io_uring_setup` (no docker.sock, tmux, ssh-agent or D-Bus doing the request instead), `/` read-only except the project folder, `/tmp`, `/var/tmp` and the toolchain task folder; the project's `.claude`, `.mcp.json`, `.git/config` and `.git/hooks` stay read-only, and `~/.claude/shell-snapshots` is a private tmpfs (no planted hooks, fsmonitor commands or shell snapshots that run later outside the sandbox). The launcher is test-run once; if it cannot start, the shell is denied. Hooks and stdio MCP servers do not use `CLAUDE_CODE_SHELL` and keep working. | Yes (Ubuntu 24.04, bubblewrap 0.9, real Claude Code 2.1.319)             |
| macOS                  | The same launcher runs bash under `sandbox-exec`: outbound and inbound network denied, writes only in the project folder, temp folders and the task folder, the project's Claude Code / git config read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | No (no Mac); Seatbelt does not stop `open <url>` through LaunchServices. |
| Windows, or no sandbox | No OS mechanism without admin rights or a signed helper (Claude Code's own sandbox does not run on native Windows). Fail closed: the `Bash`, `PowerShell` and `Monitor` tools are denied in these threads; work goes through connectors and file tools, or the company runs its runner on Linux / WSL2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Rules only (unit tests).                                                 |

Every platform also denies `WebFetch` (it runs inside the Claude Code process, outside any shell
sandbox, and a URL can carry data out) and `PowerShell`, and denies file-tool edits of the
project's `.claude/**`, `.mcp.json`, `.git/config` and `.git/hooks/**`. The rules go into the
session's flag settings (`withZenToolchainSettings`), `CLAUDE_CODE_SHELL` both into those settings'
`env` (a user's settings.json cannot override it) and the process environment. The toolchain
launchers notice the outer sandbox (`ZEN_TOOL_SANDBOXED=bwrap`; bubblewrap cannot nest under
AppArmor) and run their tool directly inside it; installs still go through the toolchain
installer in the server, outside the agent's shell. Verified inside the sandbox: FFmpeg render,
pandoc to .docx, Node, Playwright headless Chromium to PDF; `curl` fails. Switch off: no gate,
the shell has the machine's network. The shell mode is part of the session options (a header of
the `zen-staff` MCP entry), so flipping the switch restarts the agent's Claude Code process on its
next turn. While the switch is on, agent tasks never start in full access (Claude Code never asks
the permission callback in bypass mode, so the connector gate would be skipped). Personal
agents and every other thread are unchanged.

Gaps: `WebSearch` stays allowed (the query text reaches the search provider); MCP tools that
open web pages (preview browser, Playwright MCP) are classified by name like other connector
tools; toolchain tools that declare `network` (yt-dlp, scraping) have no internet in these
threads; files the agent writes in the project folder (scripts, `package.json`) can still be run
later by a person outside the sandbox; Windows has no shell for company agents while the switch
is on; macOS is untested.

## 4. Enterprise workflows

- **Who and where:** an enterprise workflow runs only when (1) the thread runs on the company's
  registered runner (hub registration `runnerCompanyId`; without any hub, the local "company
  server" switch, which is weaker) and (2) the person is unlocked for that specific pack (a
  per-pack grant). Both are checked by the runner itself in `checkWorkflow` and again in
  `prepareThread`; a laptop is refused even for an admin.
- **Grants and approvals** are stored on the runner (`toolchains/access/ledger.json`, mode
  600). Seam: when the hub exposes per-pack grants and roles, the runner should mirror them and
  still require its own ledger entry and its own runner status. Today the admin role is a local
  confirmation and the requester is the client's hub e-mail (a claim matched against the
  ledger); a hub-signed identity token is the next step.
- **Secrets** are stored only on the runner, encrypted with AES-256-GCM in
  `toolchains/access/vault.json` (600). The vault key is in the OS keychain when one answers
  (`secret-tool` on Linux, `security` on macOS, DPAPI on Windows), else in `vault.key` (600).
  Values never go into chat, pack files, the saved thread state or RPC replies.
- **Credential proxy:** a secret with `apiHosts` is served through a proxy on 127.0.0.1 started
  for that thread; the agent sees only `ZEN_SECRET_<ID>_URL`. The proxy forwards only to the
  declared hosts over https and adds the header (`Authorization: Bearer {secret}` or the pack's
  template). Gap: the proxy is an allowlist for API calls, not a firewall; a thread that uses
  the proxy keeps network access in the bwrap launcher (loopback is needed). A per-thread network
  namespace with only the proxy socket mounted is the planned fix.
- **Fallback:** a secret without `apiHosts` is injected as `ZEN_SECRET_<ID>` into that thread's
  Claude process only (memory; gone after a restart, then the thread must be prepared again).
- **Audit:** every preparation and every proxied call is logged in
  `toolchains/access/usage.log` (time, workflow, person, thread, secret id, host; never values).
- **Validation:** a secret marked `readOnly` whose scopes include write-like words (write,
  manage, publish, post, send, delete, admin, full, `*`, or Google scopes without `.readonly`)
  makes the pack invalid; it neither loads nor installs.

## 5. Unused software

Toolchains not used for N days (Settings > Tools, default 60, 0 = never) are removed by a
background job; the next workflow that needs them installs them again. "Clean up unused" removes
toolchains no workflow references.
