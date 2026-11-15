---
learn:
  - Pe unde scapă cheile API, inclusiv prin conversațiile cu agentul
  - De ce o cheie ștearsă din cod trebuie totuși rotită
  - Ce obiceiuri prind cheile înainte de push
  - Ce faci în prima oră după o scurgere
---

## Pe unde scapă de fapt secretele

Cele mai multe scurgeri sunt banale. Cineva pune `.env` în commit din prima zi, înainte să existe `.gitignore`. O cheie ajunge în `config.ts` „doar ca să testez”. O linie de debug afișează tot headerul `Authorization`.

Cu agenții de cod apar și drumuri noi:

- **Prompturi și conversații.** Dacă lipești o cheie în chat, ea rămâne în istoricul threadului, poate într-un chat partajat, poate în logurile furnizorului.
- **Output-ul uneltelor.** Când agentul rulează `cat .env`, `env` sau `docker inspect`, valorile ajung în conversație.
- **Codul generat.** Agentul scrie liniștit `const STRIPE_KEY = "sk_live_..."` dacă are cheia în context.

## Dacă ștergi, n-ai rezolvat

Odată ce o cheie a ajuns pe remote, consider-o compromisă. Boții scanează GitHub-ul public în câteva minute. Un commit nou care șterge linia nu ajută: cheia rămâne în `git log -p`.

Rescrierea istoricului (`git filter-repo`) e curățenie, nu remediere. **Remedierea e rotirea**: revoci cheia veche la furnizor, generezi una nouă, faci deploy.

:::dont
`git rm .env && git commit -m "scot env"`
:::

:::do
Revoci cheia în Stripe sau AWS, pui cheia nouă în secret store, faci redeploy și abia apoi cureți istoricul.
:::

## Obiceiuri care opresc majoritatea scurgerilor

- Pune `.env*` (cu `!.env.example`) în `.gitignore` înainte de primul commit. Ține un `.env.example` cu valori goale.
- Rulează un scanner local și în CI: `gitleaks git .` sau `trufflehog git file://. --only-verified`. Pune gitleaks ca pre-commit hook.
- Activează secret scanning în GitHub și **push protection**. Îți blochează push-ul, nu te anunță după.
- Nu loga tokenuri. Dacă ai nevoie să le corelezi, logează `token.slice(0, 6) + "..."`.

:::picture secrets
Cheia stă în `.env`, mascată, și nu intră niciodată în commit.
:::

:::tip
Știi ce tip de cheie ai în mână. În Supabase, cheia `anon` / publishable e făcută pentru browser (datele le apără RLS). Cheia `service_role` / secret ocolește RLS și stă doar pe server. La Stripe e la fel: `pk_` vs `sk_`.
:::

## Secretele și agentul

:::dont
Lipești cheia direct în chat ca agentul să o folosească.
:::

:::do
„Cheia e în `STRIPE_SECRET_KEY`, citește-o din `process.env`.”
:::

- Pune o regulă de deny ca agentul să nu poată citi fișierul: `Read(./.env)` și `Read(./.env.*)` în `.claude/settings.json`.
- Nu da credențiale de producție unui agent de dev. Agentul de dev primește chei de test.

:::warn
Dacă agentul a afișat un secret într-un thread, consideră-l scăpat și rotește-l.
:::

## Prima oră după o scurgere

1. Revoci și rotești cheia. Asta e primul pas, nu al treilea.
2. Te uiți în logurile furnizorului dacă cheia a fost folosită (AWS CloudTrail, evenimentele din Stripe).
3. Cauți toate copiile: alte repo-uri, variabile din CI, threaduri, capturi de ecran.
4. Cureți istoricul dacă repo-ul e partajat și le spui colegilor de ce.
5. Adaugi scannerul sau regula care ar fi prins-o.

## Încearcă acum

:::try
Pornește un audit axat pe secrete. Alege „Practice project” ca să scanezi o aplicație mică cu `.env` pus în commit, chei în config și un token în loguri, sau alege unul dintre proiectele tale. Agentul raportează fiecare secret cu fișier:linie, severitate și dacă cheia trebuie rotită, fără să modifice nimic.
:::

:::quiz
Ai dat push cu o cheie Stripe în `config.ts`. Care e primul pas?

- [ ] Un commit nou care șterge linia.
- [ ] Rescrii istoricul cu `git filter-repo`.
- [x] Revoci cheia la Stripe și generezi una nouă.

> Odată ajunsă pe remote, cheia e compromisă. Ștergerea și curățarea istoricului vin după rotire.
:::

:::quiz
Agentul are nevoie de cheia API ca să testeze o integrare. Cum i-o dai?

- [ ] O lipești în chat, threadul e privat.
- [x] Îi spui în ce variabilă de mediu e și să o citească din `process.env`.
- [ ] O scrii în cod, o scoți după test.

> Ce lipești în chat rămâne în istoricul threadului și poate în logurile furnizorului.
:::

:::quiz
Care cheie Supabase are voie în codul care rulează în browser?

- [x] Cheia `anon` / publishable, cu datele apărate de RLS.
- [ ] Cheia `service_role`, ca să meargă toate cererile.
- [ ] Niciuna, Supabase nu se poate folosi din browser.

> Cheia `service_role` ocolește RLS și stă doar pe server.
:::
