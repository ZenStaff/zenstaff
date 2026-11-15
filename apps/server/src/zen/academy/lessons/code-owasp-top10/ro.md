---
learn:
  - Ce acoperă fiecare dintre cele zece categorii din OWASP Top 10 (2025)
  - Ce greșeală concretă face un agent la fiecare și cum o repari
  - Cum ceri cazurile de abuz în același prompt cu funcționalitatea
---

## De ce contează încă lista asta

OWASP Top 10 e vocabularul comun pentru riscurile web. Ediția din 2025 a mutat câteva lucruri: SSRF a intrat la controlul accesului, supply chain are categoria lui și a apărut una nouă pentru erorile tratate prost.

Agenții le produc pe toate zece, mai ales pentru că scriu drumul fericit și se opresc acolo. Mai jos ai fiecare categorie cu o greșeală concretă și remedierea ei.

## A01 până la A03: acces, configurare, supply chain

**A01 Broken Access Control.** `GET /api/invoices/:id` întoarce orice factură oricărui user logat (IDOR). Fix: filtrezi după proprietar în query, `WHERE id = $1 AND user_id = $2`. Tot aici stă și SSRF: `fetch(req.query.url)` îl lasă pe user să ajungă la `http://169.254.169.254/` sau la serviciile interne. Fă o listă de hosturi permise și blochează IP-urile private după rezolvarea DNS.

**A02 Security Misconfiguration.** CORS cu `origin: "*"` și credențiale, debug pornit în producție, parole de admin implicite, headere care spun prea multe. Fix: listă explicită de origini, `NODE_ENV=production`, headere de securitate (helmet).

**A03 Software Supply Chain Failures.** Fără lockfile, pachete inventate de agent, scripturi `postinstall`, GitHub Actions nefixate (`uses: some/action@main`). Fix: lockfile plus `npm ci`, actions fixate pe SHA de commit, review la dependențele noi.

## A04 până la A06: criptografie, injection, design

**A04 Cryptographic Failures.** `md5(parola)`, `Math.random()` pentru tokenuri, secrete în cod. Fix: argon2id sau bcrypt, `crypto.randomBytes`, chei dintr-un secret store, TLS peste tot.

**A05 Injection.**

:::dont
``db.all(`SELECT * FROM users WHERE name = '${q}'`)``
:::

:::do
`db.all("... WHERE name = ?", [q])`, cu parametri.
:::

La fel la shell (`execFile` cu argumente în array, nu `exec` cu string) și la HTML (escape la output).

**A06 Insecure Design.** Un endpoint de cupoane fără limită pe user, un transfer care verifică soldul și debitează în două cereri separate. Fix: scrii cazurile de abuz lângă funcționalitate, înainte de cod.

## A07 până la A10: auth, integritate, loguri, erori

**A07 Authentication Failures.** Fără rate limit la login, `jwt.decode` în loc de `verify`, sesiuni nerotite. Vezi lecția despre auth.

**A08 Software or Data Integrity Failures.** Deserializare de date nesigure, update-uri automate fără verificarea semnăturii, webhook-uri acceptate fără să verifici semnătura. Fix: verifici semnătura HMAC pe webhook-uri și semnăturile artefactelor.

**A09 Security Logging and Alerting Failures.** Login-urile eșuate și accesul refuzat nu se loghează, sau se loghează și nu se uită nimeni. Fix: loguri structurate pentru evenimentele de auth, alertă la vârfuri, fără secrete sau date personale în loguri.

**A10 Mishandling of Exceptional Conditions.** Stack trace trimis la client, blocuri `catch` care lasă să treacă (`catch { return next() }` într-o verificare de auth), crash la input neașteptat. Fix: un singur error handler care loghează detaliile și întoarce un mesaj generic. La eroare, refuzi.

:::dont
```js
app.use((err, req, res, next) => res.status(500).json({ error: err.message, stack: err.stack }));
```
:::

:::do
```js
app.use((err, req, res, next) => {
  log.error({ err, reqId: req.id });
  res.status(500).json({ error: "Internal error", reqId: req.id });
});
```
:::

## Cum folosești lista cu un agent

Agenții respectă bine constrângerile spuse explicit. Rar și le inventează singuri. Așa că ceri cazurile de abuz în același prompt cu funcționalitatea.

:::dont
„Adaugă un endpoint de descărcat facturi.”
:::

:::do
„Adaugă un endpoint de descărcat facturi. Doar proprietarul are voie. Scrie un test în care userul B primește 404 pe factura userului A.”
:::

:::picture code-diff
În diff cauți și testul pentru cazul de abuz, nu doar codul nou.
:::

## Încearcă acum

:::try
Butonul pornește un audit de securitate axat pe Top 10, pe un proiect de exercițiu: o aplicație mică Express cu SQLite, cu SQL injection, IDOR, SSRF, stack trace trimis la client și parole în md5. Agentul se uită doar la cod, nu pornește aplicația și nu modifică nimic. Pentru fiecare problemă găsită, caută în lecție categoria ei.
:::

:::quiz
Agentul a scris o căutare cu ``db.all(`SELECT * FROM users WHERE name = '${q}'`)``. Ce ceri să schimbe?

- [ ] Să scoată ghilimelele din `q` înainte de query.
- [x] Să folosească parametri: `db.all("... WHERE name = ?", [q])`.
- [ ] Să limiteze `q` la 50 de caractere.

> Doar parametrii separă datele de comanda SQL. Curățarea manuală scapă mereu un caz.
:::

:::quiz
Middleware-ul de auth are `catch { return next() }`. Ce se întâmplă când verificarea dă eroare?

- [ ] Userul primește un mesaj de eroare și e trimis la login.
- [x] Cererea trece mai departe ca și cum userul ar fi verificat.
- [ ] Aplicația se oprește și o repornește serverul.

> E un bloc care lasă să treacă la eroare. Corect e invers: la eroare, refuzi.
:::

:::quiz
Vrei un endpoint nou pentru facturi. Cum obții cel mai sigur cod de la agent?

- [ ] Ceri endpoint-ul, apoi rulezi un scanner.
- [ ] Îi spui să „fie atent la securitate”.
- [x] Scrii în prompt cine are voie și ceri un test pentru cazul de abuz.

> Agenții respectă constrângerile spuse explicit, dar rar le inventează singuri.
:::
