---
learn:
  - How to check a new package before you accept it
  - Why you commit the lockfile and how to scan for CVEs
  - How to guard against install scripts
  - How to use update bots without giving them a free hand
---

## Most of your code is someone else's code

A typical Node app has 30 direct dependencies and 800 transitive ones. Any of them can ship a vulnerability, get abandoned, or be taken over.

With coding agents there's a new risk on top: the agent adds packages fast, and sometimes adds packages that don't exist.

## Packages the agent made up

Models sometimes suggest a plausible name, like `express-jwt-validator-pro` or `react-use-clipboard-hook`. Attackers watch for names that models hallucinate repeatedly and publish them with malware inside. This is called slopsquatting. Classic typosquatting (`lodahs`, `cross-env.js`, `reqeusts`) still works too.

Before you accept a new dependency:

- Check it on npmjs.com: weekly downloads, repo link, maintainers, first publish date.
- Ask the agent "why this package, and is there a smaller or built-in option?" Node now has `fetch`, `crypto.randomUUID`, `node:test`, `structuredClone`.
- If you're unsure, install with `npm install --ignore-scripts` first, then inspect.

:::warn
A package published last week with 40 downloads is a red flag.
:::

## Lockfiles and pinning

- Always commit the lockfile (`package-lock.json`, `pnpm-lock.yaml`). Without it, every install can resolve different versions.
- A `^1.2.3` range lets minor updates in. That's fine with a lockfile. Without one, it's a lottery.

:::dont
In CI you run `npm install`, which can silently change versions.
:::

:::do
In CI you run `npm ci` or `pnpm install --frozen-lockfile`. It fails instead of changing anything.
:::

## Scanning for known CVEs

```
npm audit --omit=dev
pnpm audit --prod
osv-scanner scan source -r .
```

`osv-scanner` covers npm, PyPI, Go and others from one tool. Run one of these in CI and fail the build on high and critical.

Not every advisory is exploitable in your app, but read each one before you dismiss it. Transitive issues are fixed by updating the parent package, or with `overrides` (npm) / `pnpm.overrides`.

## Install scripts and update bots

`preinstall` and `postinstall` run with your user's permissions on every install. Most real-world npm malware lives there. pnpm 10 doesn't run dependency install scripts unless you allow them (`onlyBuiltDependencies`). With npm, consider `ignore-scripts=true` in `.npmrc` and allow the few that need it. A script in your own `package.json` that does `curl ... | sh` never passes review.

Dependabot or Renovate keep you current. But an auto-merged update is also an auto-merged attack if a maintainer gets compromised.

:::do
Group minor updates, require CI to pass, add a short delay before adopting new releases (Renovate `minimumReleaseAge: "3 days"`), and read the changelog for majors.
:::

:::tip
Prefer packages published with npm provenance. `npm audit signatures` checks it.
:::

## Try it now

:::try
The button runs a dependency audit on a practice project that has old versions with known CVEs, a typo-like package name, a `postinstall` that downloads a script and no lockfile. The agent only reads `package.json`, nothing gets installed and no file is changed. Check whether it caught all four problems.
:::

:::quiz
The agent adds a package you've never heard of, published a week ago, with 40 downloads. What do you do?

- [ ] Accept it, the agent knows which packages exist.
- [x] Check it on npmjs.com and ask the agent whether there is a better-known or built-in option.
- [ ] Install it normally and see if the tests pass.

> New, unknown packages can be names that models made up and attackers published with malware.
:::

:::quiz
Why do you use `npm ci` in CI instead of `npm install`?

- [ ] It's faster, that's all.
- [ ] It installs the latest versions automatically.
- [x] It installs exactly what is in the lockfile and fails if it doesn't match.

> That way the CI build uses the same versions you do, with no silent changes.
:::

:::quiz
Renovate opens a PR with a version published an hour ago. What is the careful setting?

- [ ] Auto-merge every update so you're always current.
- [x] A short delay before adopting new releases, with CI required.
- [ ] Turn the bot off and update by hand once a year.

> If a maintainer is compromised, the bad version shows up first. The delay gives the community time to notice it.
:::
