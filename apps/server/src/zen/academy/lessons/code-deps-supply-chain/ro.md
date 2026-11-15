---
learn:
  - Cum verifici un pachet nou înainte să-l accepți
  - De ce ții lockfile-ul în commit și cum scanezi CVE-urile
  - Cum te ferești de scripturile de instalare
  - Cum folosești boții de update fără să le dai mână liberă
---

## Cea mai mare parte din cod e scrisă de alții

O aplicație Node obișnuită are vreo 30 de dependențe directe și 800 indirecte. Oricare dintre ele poate avea o vulnerabilitate, poate fi abandonată sau preluată de altcineva.

Cu agenții de cod apare un risc în plus: agentul adaugă pachete repede și uneori adaugă pachete care nu există.

## Pachete inventate de agent

Modelele propun uneori un nume care sună bine, gen `express-jwt-validator-pro` sau `react-use-clipboard-hook`. Atacatorii urmăresc numele pe care modelele le inventează des și le publică ei, cu malware înăuntru. Asta se cheamă slopsquatting. Și typosquatting-ul clasic (`lodahs`, `cross-env.js`, `reqeusts`) merge în continuare.

Înainte să accepți o dependență nouă:

- Caut-o pe npmjs.com: descărcări pe săptămână, link spre repo, cine o întreține, când a fost publicată prima dată.
- Întreabă agentul „de ce pachetul ăsta și există ceva mai mic sau deja inclus?”. Node are acum `fetch`, `crypto.randomUUID`, `node:test`, `structuredClone`.
- Dacă nu ești sigur, instalează întâi cu `npm install --ignore-scripts` și apoi te uiți în el.

:::warn
Un pachet publicat săptămâna trecută cu 40 de descărcări e semnal de alarmă.
:::

## Lockfile și versiuni fixe

- Pune mereu lockfile-ul în commit (`package-lock.json`, `pnpm-lock.yaml`). Fără el, fiecare instalare poate aduce alte versiuni.
- Un interval `^1.2.3` lasă să intre versiuni minore noi. Cu lockfile e ok. Fără lockfile e la noroc.

:::dont
În CI rulezi `npm install`, care poate schimba versiunile pe tăcute.
:::

:::do
În CI rulezi `npm ci` sau `pnpm install --frozen-lockfile`. Pică în loc să schimbe ceva.
:::

## Scanare de CVE-uri cunoscute

```
npm audit --omit=dev
pnpm audit --prod
osv-scanner scan source -r .
```

`osv-scanner` acoperă npm, PyPI, Go și altele cu o singură unealtă. Pune una dintre ele în CI și fă build-ul să pice la high și critical.

Nu orice advisory se poate exploata în aplicația ta, dar citește-l înainte să-l ignori. Problemele din dependențele indirecte le rezolvi actualizând pachetul părinte sau cu `overrides` (npm) / `pnpm.overrides`.

## Scripturi de instalare și boți de update

`preinstall` și `postinstall` rulează cu drepturile userului tău la fiecare instalare. Acolo stă mare parte din malware-ul real de pe npm. pnpm 10 nu mai rulează scripturile dependențelor decât dacă le permiți (`onlyBuiltDependencies`). Cu npm, ia în calcul `ignore-scripts=true` în `.npmrc` și permite doar cele câteva care chiar au nevoie. Un script din `package.json`-ul tău care face `curl ... | sh` nu trece de review. Niciodată.

Dependabot sau Renovate te țin la zi. Doar că un update cu auto-merge e și un atac cu auto-merge, dacă cineva preia contul unui maintainer.

:::do
Grupezi update-urile minore, ceri ca CI-ul să treacă, pui o mică întârziere înainte să iei versiunile noi (în Renovate, `minimumReleaseAge: "3 days"`) și citești changelog-ul la versiunile majore.
:::

:::tip
Alege pachete publicate cu provenance pe npm. `npm audit signatures` verifică asta.
:::

## Încearcă acum

:::try
Butonul pornește un audit de dependențe pe un proiect de exercițiu care are versiuni vechi cu CVE-uri cunoscute, un pachet cu nume suspect, un `postinstall` care descarcă un script și nu are lockfile. Agentul citește doar `package.json`, nu se instalează nimic și nu se modifică niciun fișier. Verifică dacă a prins toate patru problemele.
:::

:::quiz
Agentul adaugă un pachet de care n-ai auzit, publicat acum o săptămână, cu 40 de descărcări. Ce faci?

- [ ] Îl accepți, agentul știe ce pachete există.
- [x] Îl verifici pe npmjs.com și întrebi agentul dacă există ceva mai cunoscut sau deja inclus în Node.
- [ ] Îl instalezi normal și vezi dacă merg testele.

> Pachetele noi și necunoscute pot fi nume inventate de modele și publicate de atacatori cu malware.
:::

:::quiz
De ce folosești `npm ci` în CI în loc de `npm install`?

- [ ] E mai rapid, atât.
- [ ] Instalează automat ultimele versiuni.
- [x] Instalează exact ce e în lockfile și pică dacă nu se potrivește.

> Așa build-ul din CI folosește aceleași versiuni ca tine, fără schimbări pe tăcute.
:::

:::quiz
Renovate deschide un PR cu o versiune publicată acum o oră. Care e setarea prudentă?

- [ ] Auto-merge pe orice update, ca să fii mereu la zi.
- [x] O mică întârziere înainte de a lua versiuni noi, cu CI obligatoriu.
- [ ] Oprești botul și actualizezi manual o dată pe an.

> Dacă un maintainer e compromis, versiunea rea apare întâi. Întârzierea îi lasă timp comunității s-o observe.
:::
