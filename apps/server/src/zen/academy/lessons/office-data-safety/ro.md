---
learn:
  - Ce nu pui niciodată într-o conversație
  - Ce faci dacă ai lipit deja ceva ce nu trebuia
  - Cum lucrezi cu date personale după GDPR, pe înțeles
---

## Ce nu pui niciodată în chat

Tot ce scrii sau lipești într-o conversație rămâne în istoric, ajunge la furnizorul de AI și, într-o conversație comună, îl văd și colegii. Așa că unele lucruri nu intră niciodată acolo:

- **Parolele**, inclusiv cele „temporare” și parola de la Wi-Fi.
- **Cheile API și tokenurile**: șiruri lungi de felul `sk_live_...` sau `AKIA...`, prin care un program intră într-un cont.
- **Numerele de card**, codul CVV, datele de logare la bancă, codurile primite prin SMS.

:::picture data-safety
Ce nu lipești niciodată: parole, chei, numere de card.
:::

## Dacă ai lipit deja una

Se întâmplă. Nu ascunde și nu te mulțumi să ștergi mesajul: textul poate fi deja salvat.

1. Spune imediat celor de la IT (sau cui se ocupă de contul respectiv) ce ai lipit și unde.
2. Schimbă parola sau cere să fie înlocuită cheia. După schimbare, ce ai lipit nu mai folosește la nimic.
3. Data viitoare, dacă agentul are nevoie de acces la o aplicație, folosește un conector cu autentificare (vezi lecția despre conectat aplicații).

:::dont
Ștergi mesajul și speri că nu l-a văzut nimeni.
:::

:::do
Anunți IT-ul și schimbi parola sau cheia imediat.
:::

## Date personale: doar când chiar trebuie

Date personale înseamnă orice identifică un om: nume, telefon, e-mail, adresă, CNP. Și mai ales datele sensibile: sănătate, religie, salariu. Înainte să i le dai agentului, întreabă-te: sarcina asta chiar are nevoie de ele?

De cele mai multe ori, nu. Ca să afli media comenzilor pe oraș îți trebuie orașul și suma, nu numele sau telefonul. Deci:

- **scoți** coloanele de care nu ai nevoie înainte ca fișierul să ajungă la agent;
- **înlocuiești** numele cu coduri (C01, C02) când trebuie să deosebești rândurile;
- lași fișierul original unde era și lucrezi pe copia anonimizată.

## GDPR în patru întrebări

Nu trebuie să fii jurist. Pune-ți patru întrebări de fiecare dată când lucrezi cu date despre oameni:

1. **Scopul**: de ce folosesc datele astea? E același motiv pentru care au fost strânse?
2. **Minimul**: folosesc doar ce îmi trebuie pentru sarcina asta?
3. **Cine vede**: cine poate citi conversația asta, folderul ăsta, fișierul rezultat?
4. **Unde ajung**: rezultatul pleacă la un client, se publică, se păstrează undeva? Pleacă și datele personale odată cu el?

:::example Scopul contează
E-mailurile luate de la clienți pentru livrare nu sunt automat și pentru newsletter.
:::

:::tip
Dacă nu știi răspunsul la una dintre întrebări, întreabă-ți șeful sau omul care se ocupă de protecția datelor în firmă.
:::

## Documentele clienților și regulile firmei

Contractele, ofertele și rapoartele primite de la un client sub confidențialitate nu sunt ale tale ca să le dai mai departe. Înainte să pui unul într-un folder, verifică: folderul e personal sau comun? Contractul cu clientul permite folosirea uneltelor AI? Unii clienți interzic asta explicit.

Multe firme au și o regulă scrisă despre uneltele AI: ce date au voie să intre, ce unelte sunt aprobate.

:::warn
Dacă firma ta are o astfel de regulă, contează mai mult decât orice din lecția asta. Dacă nu știi, întreabă înainte să lucrezi cu date de clienți.
:::

## Încearcă acum

:::try
Deschizi un folder de exercițiu cu o listă de clienți inventați: nume, e-mail, telefon, CNP, oraș, valoarea comenzii. Agentul face o copie anonimizată, apoi calculează media comenzilor pe oraș folosind doar copia, fără să atingă fișierul original. Deschide ambele fișiere și compară ce a rămas.
:::

:::quiz
Ai lipit din greșeală o parolă într-o conversație. Ce faci?

- [ ] Ștergi mesajul și gata.
- [ ] Nu faci nimic, conversația e doar a ta.
- [x] Anunți IT-ul și schimbi parola imediat.

> Textul poate fi deja salvat. Doar o parolă schimbată nu mai folosește nimănui.
:::

:::quiz
Vrei să afli media comenzilor pe oraș dintr-o listă de clienți. Ce îi dai agentului?

- [x] O copie doar cu orașul și valoarea comenzii, cu numele înlocuite prin coduri.
- [ ] Lista întreagă, ca să aibă tot contextul.
- [ ] Lista întreagă, dar îi ceri să nu se uite la nume.

> Sarcina nu are nevoie de nume, telefoane sau CNP-uri, așa că ele nu ajung la agent.
:::

:::quiz
Un client ți-a trimis un contract confidențial și vrei un rezumat de la agent. Ce verifici întâi?

- [ ] Doar dacă fișierul e prea mare pentru agent.
- [x] Dacă contractul și regulile firmei permit folosirea uneltelor AI și cine vede folderul.
- [ ] Nimic, contractul e deja la tine în calculator.

> Documentele primite sub confidențialitate nu sunt ale tale ca să le dai mai departe, nici unei unelte AI.
:::
