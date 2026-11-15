# Is my website safe?: how to run this check

## Before anything

- Continue only when the answer to "Is this website yours?" is the first or the second choice (the answer may be in another language). Otherwise stop: explain in two sentences that this check runs only on websites the person owns or is allowed to check, and write no file.
- Scope: the domain of the address given and its subdomains, nothing else. The public lookup services named in the checks file (DNS over HTTPS, certificate logs, PageSpeed) are fine to call; never send requests to other people's sites.

## Safety rules (always)

- Light and passive only: the GET and HEAD requests a normal visitor's browser makes, DNS lookups, one TLS handshake per host. No port scans, no brute force, no wordlists, no login attempts, no submitted forms, no attack payloads, no load tests.
- At most about 80 requests to the site per run, one at a time. If it answers 429 or 503, stop asking it and report what you have.
- Identify yourself: `-A "Mozilla/5.0 (compatible; owner-website-check)"` on every curl call.
- Read only: never change the site, its DNS, its settings or any account.
- If something secret is exposed (a password, key, database dump), fetch no more than needed to confirm it, never copy the secret into the report (at most its first 4 characters) and put it first in the report.

## How

1. Read `{{workflow_folder}}/references/checks.md` and run its checks in order. Use `curl` in the terminal (it ships with Windows, macOS and Linux). When a tool is missing, use the web fetch tool instead or list the check under "What we could not check".
2. If a folder with the site's files was given, also do the "Code folder" part of that file. Only read; change nothing.
3. Keep a note of each check: what you ran, the line of output that matters, your verdict.

## The report

Write `website-checks/security-<YYYY-MM-DD>.md` in this folder (create the folder). The reader runs a small business and is not technical: short sentences, no jargon (if a technical word is unavoidable, explain it in brackets the first time), concrete next steps.

```
# Is my website safe?: <domain>, <date>

**In one sentence:** the overall verdict (for example "Mostly fine, two things to fix this month").

## The 3 problems that matter most
### 1. <problem in plain words>
- What it means for the business: customers, money, reputation or legal risk, honestly sized.
- What to do: concrete steps.
- Who does it: you / your web developer / your hosting company / whoever manages your domain name / your email provider / a lawyer.
- How urgent: this week / this month / when convenient.
(2 and 3 the same way. If there are fewer than 3 real problems, say so; never pad the list.)

## What is already good
3 to 6 short points.

## What we could not check
What was out of reach (and why) and how to check it by hand.

## Technical appendix (for your web developer)
| Check | Result | Severity | Evidence | Fix |
Severity is critical, high, medium, low or info. Evidence is the command and the line of output that proves it. Fix is the exact header, DNS record or setting.
```

Rank the problems by real impact for this business, not by how technical they sound. Do not invent findings: every problem needs evidence in the appendix. If everything checks out, say so plainly.
