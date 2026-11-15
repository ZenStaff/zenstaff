---
learn:
  - De ce bugurile de API trec de teste și de scannere
  - Cum recunoști cele șase greșeli care contează cel mai mult
  - Cum găsești endpoint-urile uitate
  - Cum îi ceri agentului un API mai sigur
---

## De ce trec bugurile de API de teste

Majoritatea vulnerabilităților de API sunt de logică, nu de sintaxă. Codul rulează, testele trec, drumul fericit merge. Bugul apare abia când userul A trimite id-ul userului B.

Scannerele statice rar îl prind. Agenții rar scriu testul ăsta dacă nu le ceri.

:::tip
Testul care lipsește cel mai des: „userul B cere obiectul userului A”. Dacă nu există, cere-l.
:::

## Autorizarea pe obiect (BOLA / IDOR)

E bugul de API numărul unu, în fiecare an. Ruta primește un id și întoarce obiectul, fără să verifice al cui e.

:::dont
```js
const order = await db.order.findUnique({ where: { id: req.params.id } });
```
:::

:::do
```js
const order = await db.order.findFirst({ where: { id: req.params.id, userId: req.user.id } });
if (!order) return res.status(404).end();
```
:::

Întoarce 404, nu 403, ca să nu confirmi că id-ul există. Cu id-uri consecutive, enumerarea e banală. UUID-urile ajută, dar nu înlocuiesc verificarea.

:::picture code-diff
La review, caută în fiecare query și condiția pe proprietar.
:::

## Ce intră și ce iese

**Mass assignment.** `db.user.update({ data: req.body })` îl lasă pe client să seteze `role`, `isVerified`, `balance` sau `tenantId`. Validează body-ul cu o schemă (zod, valibot) care listează doar câmpurile permise și pune `.strict()`, ca orice câmp necunoscut să dea eroare.

**Răspunsuri care dau prea mult.** Hash-ul parolei, notițele interne și emailurile altor useri ajung toate în tabul Network.

:::dont
Întorci tot rândul din baza de date și lași frontend-ul să aleagă ce afișează.
:::

:::do
Mapezi pe un DTO de răspuns explicit. La GraphQL e la fel: limitezi câmpurile pe rol și adâncimea pe query.
:::

## Limite, roluri și SSRF

**Rate limit și limite de resurse.** Nicio limită la login, OTP, căutare sau export, `?limit=1000000` acceptat, upload fără limită de mărime. Pune limite pe user și pe IP, o mărime maximă de pagină, limită la body și timeout-uri. La endpoint-urile care cheamă un LLM, și o limită de cost.

**Autorizare pe funcție.** Interfața de admin ascunde butonul, dar `POST /api/admin/users/:id/ban` verifică doar că ești logat. Fiecare rută privilegiată are nevoie de verificare de rol pe server. Grupează-le sub un singur router și pune verificarea o dată.

**SSRF.** Webhook-uri, preview de linkuri, „importă de la URL”, generatoare de PDF. Serverul descarcă orice îi trimite userul, inclusiv `http://localhost:5432` sau metadatele de cloud de la `169.254.169.254`.

:::warn
Ține o listă de hosturi și scheme permise, rezolvă DNS-ul și respinge IP-urile private, oprește redirect-urile sau verifică din nou după fiecare.
:::

## Endpoint-uri uitate și cereri mai bune

Agenții lasă lucruri în urmă: `/api/v1/` lângă `/api/v2/`, o rută `/debug/env` dintr-o sesiune de depanare, o rută de test care bagă date. Ține un inventar. Generează un spec OpenAPI din cod, compară-l în CI și întreabă „ce rute sunt montate și nu apar în spec?”. Versiunile vechi le scoți la o dată fixă, nu „cândva”.

Pune cerințele de securitate direct în task. Iese alt cod.

:::dont
„Adaugă un endpoint de editat proiecte.”
:::

:::do
„Adaugă `PATCH /api/projects/:id`. Doar membrii proiectului pot edita. Câmpuri permise: name, description. Întoarce DTO-ul de proiect fără câmpurile interne. Adaugă teste: un non-membru primește 404, câmpurile în plus sunt respinse.”
:::

## Încearcă acum

:::try
Butonul pornește un audit de securitate API pe un proiect de exercițiu: un API REST mic, cu IDOR, mass assignment, răspunsuri care dau prea mult, o rută de admin neprotejată, un tester de webhook cu SSRF și un endpoint v1 uitat. Agentul doar citește codul, nu pornește serverul și nu modifică nimic. Verifică dacă le-a găsit pe toate șase.
:::

:::quiz
O rută `GET /api/orders/:id` caută comanda doar după id. Ce schimbi?

- [ ] Treci la UUID-uri, ca id-urile să nu mai poată fi ghicite.
- [x] Cauți după id și după userul logat, iar dacă nu găsești întorci 404.
- [ ] Întorci 403 când comanda e a altcuiva.

> Verificarea de proprietar oprește bugul. UUID-urile doar îl ascund, iar 403 confirmă că id-ul există.
:::

:::quiz
Butonul de ban e ascuns în interfață pentru userii obișnuiți. E suficient?

- [ ] Da, dacă butonul nu se vede, nimeni nu poate trimite cererea.
- [ ] Da, dacă ruta cere login.
- [x] Nu, ruta de admin are nevoie de verificare de rol pe server.

> Oricine poate trimite cererea direct. Doar serverul poate decide cine are voie.
:::

:::quiz
Agentul scrie `db.user.update({ data: req.body })`. Care e riscul?

- [x] Clientul își poate seta singur câmpuri ca `role` sau `balance`.
- [ ] Cererea devine prea lentă.
- [ ] Nu e niciun risc dacă userul e logat.

> Validează body-ul cu o schemă strictă care permite doar câmpurile pe care userul are voie să le schimbe.
:::
