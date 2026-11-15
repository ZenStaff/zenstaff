---
learn:
  - Ce e un conector și la ce folosește
  - Cum ceri unul și cine îl aprobă
  - Cum dai acces cât mai mic și cum îl retragi
---

## Ce e un conector

Din start, agentul vede doar fișierele din folderul tău. Un **conector** e o punte prin care poate lucra și într-o aplicație: citește documente din Google Drive, scrie ciorne în Gmail, caută o pagină în Notion, trimite un mesaj pe Slack.

Tehnic, e o mică extensie (îi zice „server MCP”) pe care agentul o poate folosi. Nu trebuie să știi cum funcționează. Trebuie doar să știi la ce are acces.

:::example Cu Drive-ul conectat
„Găsește în Drive lista de prețuri de luna trecută și compar-o cu asta.” Nu mai descarci și nu mai copiezi fișiere de mână.
:::

## Cum ceri unul

Echipa ta poate avea o opțiune „Conectează-mi…”, sau scrii pur și simplu într-o conversație: „Conectează-mi Google Drive.”

Ce urmează:

1. Agentul îți spune ce va putea face conectorul și cere aprobare.
2. **Aprobă un administrator.** În cele mai multe firme, cineva de la IT sau titularul contului decide ce aplicații se pot conecta. Nu e birocrație, e o plasă de siguranță.
3. **Te autentifici tu, în fereastra aplicației.** Se deschide o fereastră de browser de la Google (sau Microsoft, Slack…). Te uiți la adresă, te loghezi acolo și vezi lista cu ce permiți.
4. Te întorci în conversație și agentul poate folosi aplicația.

:::picture connect
Conectezi o aplicație și vezi ce are voie agentul să facă în ea.
:::

## Parola nu ajunge niciodată în chat

Niciun conector adevărat nu-ți cere să scrii în chat parola, codul primit prin SMS sau o „cheie API”. Singurul loc bun pentru parolă e fereastra de autentificare a aplicației.

:::warn
Dacă vezi o astfel de cerere, te oprești și întrebi pe cineva de la IT. Tot ce scrii într-o conversație rămâne în istoric, îl pot vedea și alții și ajunge la furnizorul de AI.
:::

## Dă cel mai mic acces de care ai nevoie

Pe ecranul cu permisiuni, citește ce aprobi:

- Dacă agentul doar **citește** documente, alege acces doar pentru citire sau un singur folder, nu tot Drive-ul.
- Ai grijă la „trimite e-mailuri în numele tău” sau „șterge fișiere”. Aprobă doar dacă sarcina chiar cere asta.
- Folosește contul de serviciu, nu pe cel personal.

:::dont
Aprobi acces complet la tot Drive-ul ca să citească un singur document.
:::

:::do
Alegi doar citire sau un singur folder.
:::

:::tip
Chiar și cu drept de trimitere, cere-i agentului să-ți arate ciorna înainte să trimită.
:::

## Deconectează când ai terminat

Conectorul rămâne activ până îl scoate cineva. Pentru o treabă de o singură dată, de exemplu mutat o arhivă veche, deconectează-l după aceea din setări sau întreabă agentul cum. Poți verifica și retrage accesul și din aplicație (la Google: Cont, Securitate, Conexiuni cu aplicații terțe).

După conectare, agentul poate citi și uneori modifica date reale ale firmei, nu fișiere de exercițiu. Tot ce ai învățat până acum contează și mai mult: spune exact ce document, cere-i să-ți arate înainte să schimbe sau să trimită ceva, verifică rezultatul.

:::picture approval
Înainte să trimită sau să schimbe ceva, agentul îți cere aprobarea.
:::

## Încearcă acum

:::try
Alegi un folder, iar agentul îți spune pe înțeles ce aplicații, unelte și conectori poate folosi acum acolo. Apoi îți explică pas cu pas cum ai conecta Google Drive fără riscuri: cine aprobă, unde te autentifici, ce acces alegi, ce nu lipești în chat și cum îl deconectezi. Nu conectează, nu instalează și nu modifică nimic.
:::

:::quiz
În timp ce conectezi o aplicație, în chat apare o cerere să-ți scrii parola. Ce faci?

- [ ] Scrii parola, doar o dată.
- [x] Te oprești și întrebi pe cineva de la IT.
- [ ] Scrii parola și ștergi mesajul imediat după.

> Un conector adevărat nu-ți cere parola în chat. Te autentifici doar în fereastra aplicației.
:::

:::quiz
Ai nevoie ca agentul să citească rapoartele dintr-un singur folder din Drive. Ce acces aprobi?

- [ ] Acces complet la tot Drive-ul, ca să nu mai fie nevoie de altă aprobare.
- [ ] Acces la Drive și la Gmail, ca să poată trimite și rapoartele.
- [x] Doar citire, pentru acel folder.

> Dai cel mai mic acces de care are nevoie sarcina. Ce nu e aprobat nu poate fi folosit greșit.
:::

:::quiz
Ai conectat Drive-ul ca să muți o arhivă veche și ai terminat. Ce urmează?

- [x] Deconectezi conectorul din setări sau din contul aplicației.
- [ ] Îl lași activ, poate îți mai trebuie.
- [ ] Nimic, se deconectează singur la sfârșitul zilei.

> Conectorul rămâne activ până îl scoate cineva, așa că îl scoți când nu mai ai nevoie de el.
:::
