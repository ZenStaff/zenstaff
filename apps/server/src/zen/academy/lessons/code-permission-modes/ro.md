---
learn:
  - Ce permite de fapt fiecare din cele patru moduri de permisiuni
  - Unde are voie agentul să lucreze complet liber și unde nu
  - Cum scrii reguli allow, ask și deny și ce nu pot ele opri
  - Cum folosești hook-urile și cum faci curat în regulile aprobate
---

## Cele patru moduri

Claude Code rulează într-unul din patru moduri de permisiuni. În Zen Staff, modul de rulare al proiectului corespunde unuia dintre ele.

- **default**: întreabă înainte de fiecare modificare de fișier și de fiecare comandă care nu e deja permisă. Încet, dar sigur. Bun pentru repo-uri pe care nu le știi.
- **acceptEdits**: modifică fișiere fără să întrebe, dar întreabă înainte de comenzile de shell. Bun de zi cu zi, dacă te uiți pe diff înainte de commit.
- **plan**: doar citire. Agentul explorează și propune un plan, nu schimbă nimic. Începe cu el la orice e riscant: migrări, auth, refactorizări.
- **bypassPermissions**: totul e permis, fără întrebări. Claude refuză să pornească așa ca root, și bine face.

:::picture permissions
De la „întreabă de fiecare dată” până la acces total.
:::

:::tip
Codex are aceeași idee pe două butoane: politica de aprobare (`untrusted`, `on-request`, `never`) și sandbox-ul (`read-only`, `workspace-write`, `danger-full-access`).
:::

## Unde are voie bypass

Autonomia totală e utilă la taskuri lungi. Locul ei e acolo unde cel mai rău caz e „îl arunc și gata”: un container, un VM, un devcontainer, un sandbox în cloud.

:::dont
Pornești bypassPermissions pe laptopul cu chei SSH, cookie-uri în browser și un `~/.aws/credentials`, sau pe un server care ține producția.
:::

:::do
Îl pornești într-un container sau un VM pe care îl poți arunca oricând.
:::

:::warn
Un worktree de git izolează codul, nu mașina. Agentul tot îți poate citi folderul home și tot iese pe rețea.
:::

## Allow, ask, deny

Regulile stau în `.claude/settings.json` (comun cu echipa, pus în commit) și în `.claude/settings.local.json` (al tău, nu intră în commit). Deny bate allow.

:::example Un settings.json de pornire
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
Regulile cu prefix pe Bash nu sunt sandbox. `Bash(npm run:*)` permite și tot ce e în scripturile din `package.json`, iar un deny pe `curl` nu oprește `node -e "fetch(...)"`. Ele taie din întrebări și prind greșeli. Pentru izolare adevărată îți trebuie un sandbox adevărat.
:::

## Hooks ca parapet

Un hook `PreToolUse` rulează înainte de fiecare apel de unealtă și îl poate bloca: iese cu exit code 2 și scrie motivul pe stderr.

Folosește-l pentru reguli greu de prins în tipare:

- blochezi modificări în `migrations/` deja aplicate;
- blochezi orice comandă care conține hostname-ul de producție;
- blochezi scrieri în afara proiectului.

:::warn
Hook-urile rulează cod cu drepturile tale. Verifică-le în repo-urile pe care le clonezi, la fel cum ai verifica un `postinstall`.
:::

## Verifică pe ce ai dat click

Fiecare „Yes, and don't ask again” adaugă o regulă allow, de obicei în `settings.local.json`. După câteva săptămâni ai o listă lungă pe care nu mai ține nimeni minte s-o fi aprobat, des cu wildcard-uri gen `Bash(*)`.

:::do
Rulează din când în când `/permissions` în Claude Code și șterge ce nu-ți trebuie.
:::

:::tip
Uită-te și în `.mcp.json`. Fiecare server MCP e un set de unelte pe care agentul le poate apela.
:::

## Încearcă acum

:::try
Alegi un proiect, iar agentul îi citește configurația de agent: settings, settings locale, config MCP, CLAUDE.md și hooks. Îți spune ce e permis, ce acțiuni riscante n-au regulă de deny și propune un `settings.json` cu drepturi minime, cu un rând de explicație pentru fiecare regulă. Nu modifică niciun fișier. Citește propunerea și păstrează doar regulile pe care le înțelegi.
:::

:::quiz
Vrei să lași agentul să lucreze singur câteva ore, fără întrebări. Unde rulezi bypassPermissions?

- [ ] Pe laptopul tău, într-un worktree de git separat.
- [x] Într-un container sau VM pe care îl poți arunca.
- [ ] Pe serverul de producție, ca să vadă datele reale.

> Worktree-ul izolează doar codul. Un container sau un VM izolează mașina, iar cel mai rău caz e să-l arunci.
:::

:::quiz
Ai pus deny pe `Bash(curl:*)`. Agentul mai poate trimite date pe rețea?

- [ ] Nu, deny bate allow, deci rețeaua e blocată.
- [x] Da, de exemplu cu `node -e "fetch(...)"`.
- [ ] Doar dacă rulează ca root.

> Regulile pe prefix prind greșeli, dar nu sunt sandbox. Pentru izolare adevărată folosești un sandbox.
:::

:::quiz
Urmează o migrare de bază de date cu risc. Ce mod alegi la început?

- [ ] acceptEdits, ca să meargă mai repede.
- [ ] bypassPermissions, ca să nu te întrerupă.
- [x] plan, ca agentul să citească și să propună fără să schimbe nimic.

> În plan agentul doar explorează și propune. Abia după ce citești planul îl lași să modifice.
:::
