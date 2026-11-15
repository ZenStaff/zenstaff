---
learn:
  - De ce citești diff-ul și nu rezumatul agentului
  - La ce te uiți linie cu linie înainte de merge
  - Obiceiuri care țin diff-ul destul de mic ca să-l poți citi
---

## Rezumatul nu e schimbarea

Mesajul final al agentului spune „Am reparat bugul de login și am adăugat teste”. În diff s-ar putea să mai fie trei pachete actualizate, un test instabil șters, două `// @ts-ignore` și o regulă CORS lărgită.

Agentul trage spre „pare gata”. Treaba ta la review e să vezi ce s-a schimbat de fapt, linie cu linie.

În Zen Staff deschizi panoul de diff al threadului sau rulezi `git diff main...HEAD` în terminal. Citești fiecare hunk.

:::picture code-diff
Liniile verzi și roșii sunt schimbarea reală. Rezumatul e doar o părere.
:::

:::tip
Dacă diff-ul e prea mare ca să-l citești, e prea mare ca să-l bagi în main.
:::

## Ce s-a strecurat pe lângă task

- **Scope creep.** Fișiere care n-au treabă cu taskul. Fișierele reformatate ascund schimbări reale. Cere formatarea într-un commit separat.
- **Teste scoase sau slăbite.** `it.skip`, `xit`, fișiere de test șterse, `expect(x).toBeTruthy()` în locul unei aserțiuni precise, snapshot-uri actualizate fără motiv. Un agent blocat pe un test roșu uneori „repară” testul.
- **Verificări dezactivate.** `eslint-disable`, `@ts-ignore`, `as any`, un pas din CI pus în comentariu, `--no-verify` într-un script.
- **Dependențe noi.** Fiecare linie nouă din `package.json` are nevoie de un motiv. Verifică dacă numele există și e pachetul corect: agenții inventează nume.

## Ce poate strica securitatea

- **Secrete.** Chei lipite în config, fixture-uri de test cu tokenuri reale, `.env` pus în stage.
- **Auth și permisiuni.** Schimbări în middleware, în guard-urile de rute, în politicile RLS, în verificările de rol. Un `requireAuth` lipsă e o singură linie și scapă ușor.
- **Migrări.** `DROP`, `ALTER ... TYPE`, tabele noi fără RLS, actualizări de date fără `WHERE`.
- **Erori înghițite.** `catch {}` sau `catch (e) { return { ok: true } }` scoate bugul din loguri, nu din producție.

:::example Arată a fix, e un bug ascuns
```ts
try {
  await chargeCard(order);
} catch (e) {
  console.log(e);
}
return { status: "paid" };
```

Plata a eșuat, dar comanda apare plătită.
:::

## Obiceiuri care fac review-ul posibil

- **PR-uri mici.** Un task pe thread, un branch pe thread (folosește worktree-uri). 200 de linii se pot citi, 2.000 nu.
- **Rulezi testele tu.** Rulezi `pnpm test` și typecheck-ul în terminal.
- **Întrebi de bucățile riscante.** Răspunsurile bune sunt concrete. Cele vagi sunt un semnal.
- **A doua părere.** Cere unui alt model, sau unui thread nou fără istoric, să verifice același diff. Nu are aceleași puncte oarbe ca primul agent.
- **Verifici commitul, nu doar folderul.** Agenții mai lasă schimbări nepuse în stage. Uită-te la ce intră de fapt în merge.

:::dont
Te bazezi pe „toate testele trec” din mesajul agentului.
:::

:::do
„De ce ai schimbat linia 42 din `auth.ts`? Ce se strică dacă o dau înapoi?”
:::

## Încearcă acum

:::try
Alegi un proiect, iar agentul primește un prompt de review strict. Citește `git status`, `git diff` și ultimul commit, le trece prin lista din lecția asta și îți dă problemele cu fișier:linie, severitate și un verdict. Nu modifică, nu face stage și nu face commit la nimic. Deschide apoi tu diff-ul și verifică problemele marcate ca blocker.
:::

:::quiz
Agentul scrie „Am reparat bugul și toate testele trec”. Ce faci înainte de merge?

- [ ] Faci merge, mesajul e clar.
- [x] Citești diff-ul hunk cu hunk și rulezi testele tu în terminal.
- [ ] Îi ceri agentului să confirme încă o dată că testele trec.

> Agentul trage spre „pare gata”. Doar diff-ul și testele rulate de tine arată ce s-a schimbat de fapt.
:::

:::quiz
În diff vezi un test vechi schimbat din `expect(total).toBe(120)` în `expect(total).toBeTruthy()`. Ce înseamnă?

- [x] Testul a fost slăbit, probabil ca să treacă. Ceri explicații.
- [ ] E o simplificare inofensivă.
- [ ] E mai bine, testul acoperă acum mai multe cazuri.

> Un agent blocat pe un test roșu uneori „repară” testul în loc de cod.
:::

:::quiz
Diff-ul are 2.000 de linii, majoritatea reformatare. Ce ceri?

- [ ] Nimic, reformatarea nu schimbă logica.
- [ ] Să adauge și mai multe teste în același PR.
- [x] Formatarea într-un commit separat și un PR mai mic, pe care îl poți citi.

> Fișierele reformatate ascund schimbări reale. Dacă nu poți citi diff-ul, nu-l bagi în main.
:::
