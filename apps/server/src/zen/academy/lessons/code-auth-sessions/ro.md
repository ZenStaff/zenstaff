---
learn:
  - Cum verifici corect un JWT și ce secret îi dai
  - Unde ții tokenul și ce flag-uri pui pe cookie
  - Cum rotești și închizi sesiunile
  - De ce fiecare rută are nevoie de autorizare, nu doar de login
---

## Codul de auth care „merge” e des greșit

Un flux de login e ușor de făcut să meargă și greu de făcut sigur. Agentul îți scrie fără probleme un login care întoarce un token și un middleware care îl citește. Bugurile sunt în detaliile pe care le-a sărit.

Lecția trece prin ele pe rând: tokenuri, cookie-uri, sesiuni, resetarea parolei și autorizarea pe rute.

## Tokenuri

:::dont
`jwt.decode(token)`. Doar decodează payload-ul din base64. Oricine poate falsifica `{"sub":"1","role":"admin"}`.
:::

:::do
`jwt.verify(token, publicKey, { algorithms: ["RS256"] })`, mereu cu lista de algoritmi dată explicit.
:::

- **Confuzia de algoritm.** Nu accepta niciodată `alg: none`. Dacă folosești RS256, fixează-l. Altfel, pe biblioteci vechi sau configurate prost, atacatorul semnează un token HS256 folosind cheia ta publică drept secret HMAC.
- **Secrete slabe.** `"secret"`, `"changeme"` sau numele aplicației. Secretele HS256 se pot sparge offline. Folosește minim 32 de bytes aleatori, ținuți într-un secret store.
- **Expirarea.** Access token scurt (5-15 minute), refresh token mai lung, care se rotește la fiecare folosire și poate fi revocat.

:::picture secrets
Secretul de semnare stă într-un secret store, nu în cod.
:::

## Unde stă tokenul

`localStorage` poate fi citit de orice script din pagină, deci un singur XSS scurge toate sesiunile. La aplicațiile de browser, mai bine un cookie de sesiune:

```js
res.cookie("sid", id, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 8 * 3600e3,
});
```

`HttpOnly` blochează accesul din JavaScript, `Secure` nu-l lasă pe HTTP simplu, `SameSite=Lax` oprește mare parte din CSRF.

:::tip
Pentru cereri care modifică date venite din alte origini tot îți trebuie protecție CSRF.
:::

## Sesiuni, resetare și login

- **Rotești id-ul de sesiune la login** (`req.session.regenerate()`) și la schimbarea drepturilor. Altfel ai session fixation: atacatorul îți pune un id de sesiune înainte să te loghezi.
- **Logout-ul invalidează pe server.** Nu ajunge să ștergi cookie-ul dacă sesiunea sau refresh tokenul încă merg. La JWT îți trebuie o listă de tokenuri revocate sau o versiune de token pe user.
- **Schimbarea și resetarea parolei închid celelalte sesiuni.**
- **Tokenuri de resetare:** `crypto.randomBytes(32)`, salvezi doar hash-ul, expiră în 15-60 de minute, merg o singură dată. Nu `Math.random()`, nu id-ul userului, nu un timestamp.
- **Același răspuns** pentru „nu există userul” și „parolă greșită”. La fel la „ți-am trimis emailul de resetare”, fie că există contul, fie că nu.
- **Rate limit** pe login, resetare și OTP, pe IP și pe cont. Fără el, un OTP de 6 cifre cade în câteva minute.
- **Parolele** le hash-uiești cu argon2id sau bcrypt (cost 12+). Niciodată md5 sau doar sha256.
- **MFA** (TOTP sau passkeys), măcar pentru admini.

## Autorizare pe fiecare rută

Autentificarea spune cine ești. Autorizarea spune ce ai voie să faci. Cel mai des bug în API-urile scrise de agenți e o rută care verifică dacă ești logat, dar nu și dacă resursa e a ta sau dacă ai rolul potrivit.

:::dont
```js
app.delete("/api/users/:id", requireLogin, deleteUser);
```
:::

:::do
```js
app.delete("/api/users/:id", requireLogin, requireRole("admin"), deleteUser);
```
:::

Pune verificarea într-un middleware care rulează implicit și ține o listă cu rutele care sunt publice intenționat.

## Încearcă acum

:::try
Butonul pornește un audit de autentificare pe un proiect de exercițiu: o aplicație Express mică, cu majoritatea greșelilor de mai sus. Agentul doar citește codul, nu pornește serverul și nu modifică nimic. Numără câte găsește auditul, apoi încearcă pe proiectul tău.
:::

:::quiz
Middleware-ul citește userul din token cu `jwt.decode`. Ce faci?

- [ ] Nimic, tokenul vine de la serverul tău.
- [x] Treci pe `jwt.verify`, cu lista de algoritmi dată explicit.
- [ ] Adaugi o verificare că payload-ul are câmpul `sub`.

> `decode` nu verifică semnătura, deci oricine își poate scrie singur un token de admin.
:::

:::quiz
Userul apasă Logout și aplicația șterge cookie-ul din browser. E gata?

- [ ] Da, fără cookie nu mai e logat.
- [ ] Da, dacă tokenul expiră în 15 minute.
- [x] Nu, sesiunea sau tokenul trebuie invalidate și pe server.

> Cine are o copie a cookie-ului sau a refresh tokenului poate continua să-l folosească până îl invalidezi pe server.
:::

:::quiz
La resetarea parolei, ce mesaj afișezi când emailul nu există în baza de date?

- [ ] „Nu există niciun cont cu acest email.”
- [x] Același mesaj ca atunci când contul există: „Ți-am trimis emailul de resetare.”
- [ ] Un mesaj de eroare generic, cu cod 404.

> Mesajele diferite îi spun atacatorului ce conturi există.
:::
