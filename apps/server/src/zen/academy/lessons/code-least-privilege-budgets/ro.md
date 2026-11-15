---
learn:
  - Cum dai fiecărui agent propria credențială, cu drepturi minime
  - Cum limitezi rețeaua unui agent autonom
  - Ce limite setezi pe pagina /limits și unde e oprirea de urgență
  - Ce păstrezi ca să știi ce a făcut un agent
---

## Pregătește-te pentru ziua proastă a agentului

Un agent poate înțelege greșit un task, se poate învârti în jurul unui pas care pică sau poate fi condus de un text injectat. Nu poți face asta imposibil.

Poți face ca paguba să fie mică, să se vadă și să se oprească singură. Pentru asta sunt drepturile minime și bugetele.

## Un agent, o identitate, cât mai puține drepturi

- **Credențiale separate pentru fiecare agent.** Agentul de noapte care actualizează dependențe și agentul care triază tichetele de suport nu folosesc același token. Când unul o ia razna, revoci o singură cheie și știi exact la ce avea acces.
- **Tokenuri GitHub fine-grained.** Un PAT fine-grained (sau un GitHub App) limitat la un repo, doar cu `contents: read/write` și `pull_requests: write`. Pune-i dată de expirare.
- **Roluri de cloud doar pentru treaba lor.** Un agent care urcă artefacte de build poate face `PutObject` pe un prefix dintr-un bucket. Nu poate lista userii din IAM.

:::dont
Un token GitHub clasic cu `repo` pe toate repo-urile tale, folosit de toți agenții.
:::

:::do
Câte un token fine-grained pe agent, pe un singur repo, cu expirare.
:::

## Baza de date și producția

Un agent care răspunde la întrebări despre date primește un rol cu `SELECT` pe anumite tabele sau view-uri și atât:

```sql
create role agent_reports login password '...';
grant usage on schema reporting to agent_reports;
grant select on reporting.daily_sales, reporting.stock_levels to agent_reports;
alter role agent_reports set statement_timeout = '15s';
```

Agenții de dev nu primesc credențiale de producție. Primesc chei de test (`sk_test_`), o bază locală sau de staging, conturi sandbox. Dacă un task chiar are nevoie de producție, trece printr-un script verificat sau printr-un om.

:::picture secrets
Fiecare agent cu cheia lui, iar cheile de dev sunt chei de test.
:::

## Rețea

Aproape orice exfiltrare are nevoie de o cerere spre exterior. Agenții autonomi rulează într-un container cu o listă de destinații permise: hostul de git, registry-ul de pachete, API-ul modelului.

:::warn
Blochează metadatele de cloud (`169.254.169.254`) și panourile interne de admin. Dacă taskul nu are nevoie de internet, oprește-l.
:::

## Bugete, limite și evidență

Agenții programați rulează când nu se uită nimeni, așa că limitele se uită în locul tău. În Zen Staff le setezi pe pagina `/limits`:

- **Număr maxim de rulări pe zi** pentru fiecare agent programat, ca un trigger stricat să nu-l pornească de 200 de ori.
- **Minute maxime pe rulare**, ca o buclă să se termine singură.
- **Rulări simultane maxime**, ca zece agenți să nu se bată pe același repo sau pe aceleași rate limit-uri.
- **Ore de liniște**, ca nimic să nu pornească în timpul deploy-urilor, backup-urilor, la trafic maxim sau când nu e nimeni să reacționeze.
- **Pause all**: butonul de oprire de urgență. Află unde e înainte să ai nevoie de el.

Pe lângă astea, pune o limită de cost la furnizorul de modele și o limită de pași sau de tokenuri la taskurile lungi. Un agent scăpat de sub control costă bani înainte să strice ceva.

:::tip
Trebuie să poți răspunde la „ce a făcut agentul la 03:12?” fără să ghicești. Păstrează conversația din thread, comenzile rulate, commiturile și PR-urile și apelurile de API făcute cu credențiala lui. Agenții deschid PR-uri, nu fac push direct în main: istoricul de PR-uri e jurnalul tău de audit. Uită-te săptămânal pe ce au produs agenții programați, chiar dacă n-a picat nimic.
:::

## Încearcă acum

:::try
Butonul deschide pagina `/limits`. Ia fiecare agent programat și pune un număr maxim de rulări pe zi și de minute pe rulare pe măsura a ce are nevoie de fapt. Adaugă ore de liniște și găsește butonul „Pause all”.
:::

:::quiz
Un agent programat a scris lucruri ciudate în repo. Toți agenții folosesc același token GitHub. Care e problema?

- [ ] Niciuna, revoci tokenul și gata.
- [x] Ca să-l oprești trebuie să-i oprești pe toți, și nu știi sigur ce a făcut fiecare.
- [ ] Tokenul ar fi trebuit să fie clasic, nu fine-grained.

> Cu o credențială pe agent revoci o singură cheie și vezi exact ce a făcut cu ea.
:::

:::quiz
Un trigger stricat pornește același agent iar și iar, noaptea. Ce te protejează?

- [ ] Faptul că agentul își dă seama singur că a mai rulat.
- [ ] Un review săptămânal al PR-urilor.
- [x] Numărul maxim de rulări pe zi și minutele maxime pe rulare setate în `/limits`.

> Limitele lucrează și când nu se uită nimeni. Review-ul săptămânal vine după.
:::
