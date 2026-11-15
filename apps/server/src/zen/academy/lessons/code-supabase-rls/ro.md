---
learn:
  - De ce RLS e singurul zid dintre browser și tabelele tale
  - Ce greșeli de politici fac agenții cel mai des
  - Ce ocolește RLS fără să-ți dai seama
  - Cum testezi politicile ca un atacator
---

## De ce RLS e toată securitatea

În Supabase, browserul vorbește cu Postgres prin API-ul generat automat, cu cheia publică `anon` (publishable). Oricine o poate copia din bundle.

Singurul lucru dintre el și tabelele tale e Row Level Security. Dacă o politică e greșită, nu mai e niciun backend care s-o prindă.

:::warn
Agenții scriu multe migrări. Și au obiceiul să „repare” o eroare de permisiune slăbind politica până dispare eroarea.
:::

## Greșeli în politici

- **RLS neactivat.** Un tabel creat într-o migrare fără `alter table ... enable row level security` poate fi citit și scris de oricine are cheia anon.
- **`using (true)`.** Politica de „să meargă”. Înseamnă toate rândurile, pentru toate rolurile la care se aplică.
- **Doar politică de SELECT sau fără `WITH CHECK`.** `USING` filtrează ce rânduri vezi sau atingi. `WITH CHECK` validează valorile noi. O politică de UPDATE fără `WITH CHECK` îl lasă pe user să mute un rând pe alt `user_id` sau pe alt tenant.
- **Auto-promovare.** Un tabel `profiles` cu coloană `role` și o politică „userul își poate modifica profilul”. Userul trimite `{ role: "admin" }` și gata, e admin. Ține rolurile într-un tabel separat în care userul nu poate scrie, sau limitează coloanele cu `grant update (display_name, avatar_url)`.

:::dont
```sql
create policy "update own" on profiles for update using (auth.uid() = id);
```
:::

:::do
```sql
create policy "update own" on profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
revoke update on profiles from authenticated;
grant update (display_name, avatar_url) on profiles to authenticated;
```
:::

## Ce ocolește RLS

- **Funcții SECURITY DEFINER.** Rulează ca owner și sar peste RLS. Fără `set search_path = ''` și fără o verificare explicită de `auth.uid()` înăuntru, orice user logat (sau anon, dacă are drept de execuție) le poate apela prin `rpc()`. Scoate dreptul de execute de la `anon` și `public` când nu sunt pentru ei.
- **View-uri.** Un view simplu rulează cu drepturile celui care l-a creat și ignoră RLS-ul tabelului de bază. Folosește `create view ... with (security_invoker = true)` (Postgres 15+).
- **Bucket-uri de storage publice**, cu facturi sau copii de buletin în ele.

:::warn
Cheia service_role în codul de client ocolește tot RLS-ul. Locul ei e doar pe server sau în edge functions.
:::

## Testează ca atacatorul

Nu testa politicile în SQL editor ca `postgres`. Rolul ăsta ocolește RLS. Testează cu rolurile reale, între `begin;` și `rollback;`:

:::example Test cu rolurile reale
```sql
set local role anon;
select * from invoices;          -- te aștepți la 0 rânduri
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid-alt-user>"}';
update profiles set role = 'admin' where id = '<uuid-alt-user>';  -- te aștepți la eroare
```
:::

:::tip
Uită-te și în Security Advisor din dashboard-ul Supabase: semnalează tabelele fără RLS și view-urile cu drepturile creatorului. Cere-i agentului un test pgTAP pentru fiecare politică nouă, nu doar politica.
:::

## Încearcă acum

:::try
Pornește un audit RLS pe proiectul de exercițiu: o migrare cu mai multe dintre greșelile de mai sus și un fișier de client care folosește cheia service role. E o verificare statică, nu se conectează la nicio bază de date. Agentul îți dă fiecare problemă cu fișier:linie, severitate, cum poate fi abuzată și un fix SQL.
:::

:::quiz
Agentul a primit o eroare de permisiune și a schimbat politica în `using (true)`. Acum merge. Ce faci?

- [ ] Lași așa, eroarea a dispărut.
- [x] Respingi schimbarea: politica dă acum toate rândurile tuturor rolurilor.
- [ ] Adaugi doar un comentariu în migrare.

> Eroarea a dispărut pentru că a dispărut și protecția. Ceri o politică care verifică `auth.uid()`.
:::

:::quiz
Tabelul `profiles` are coloana `role`, iar userul își poate modifica profilul. Care e riscul?

- [ ] Niciunul, userul își modifică doar propriul rând.
- [ ] Doar că poate scrie un nume urât.
- [x] Userul își trimite singur `role: "admin"` și devine admin.

> Ține rolurile într-un tabel separat sau limitează coloanele cu `grant update (...)`.
:::

:::quiz
Testezi politicile în SQL editor și vezi toate rândurile. Ce înseamnă?

- [ ] Politicile sunt greșite, sigur.
- [x] Probabil rulezi ca `postgres`, care ocolește RLS. Testezi cu `set local role anon`.
- [ ] Supabase are RLS oprit implicit în editor, deci e normal pentru toți.

> Doar cu rolurile reale (`anon`, `authenticated`) vezi ce vede un atacator.
:::
