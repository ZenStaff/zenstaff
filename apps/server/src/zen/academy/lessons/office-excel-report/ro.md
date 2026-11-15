---
learn:
  - Pui tabelul acolo unde îl vede agentul și îi spui exact ce fișier să folosească
  - Ceri un raport pentru o perioadă și un cititor anume
  - Îl faci să calculeze cifrele, nu să le ghicească, și verifici totalurile
---

## Pune fișierul unde îl vede agentul

Agentul lucrează doar cu fișierele din folderul conversației sau dintr-o aplicație pe care firma a conectat-o.

Copiază întâi tabelul în folder. Apoi scrie-i exact numele în cerere: „folosește vanzari-octombrie.csv”.

:::picture folder
Tabelul trebuie să fie în folderul în care lucrează agentul.
:::

:::tip
Ai mai multe versiuni ale aceluiași tabel? Șterge-le sau mută-le pe cele vechi. Altfel s-ar putea ca agentul să o ia pe cea greșită.
:::

## CSV sau XLSX?

- **CSV** e un tabel simplu: rânduri și coloane, atât. Agentul îl citește fără probleme. Dacă poți, salvează tabelul ca CSV (în Excel: Fișier, Salvare ca, CSV UTF-8).
- **XLSX** e fișierul Excel complet, cu mai multe foi, formule, celule îmbinate și culori. De obicei agentul îl citește, dar se încurcă în capete de tabel îmbinate, foi ascunse sau totaluri scrise în mijlocul datelor.

:::example Dacă îi dai un XLSX
„Foaia Octombrie, datele încep de la rândul 3, ignoră rândul de total de jos.”
:::

## Spune perioada și cine citește

Aceleași cifre dau rapoarte diferite pentru oameni diferiți:

- **Conducerea** vrea trei-patru cifre, tendința și ce are de decis.
- **Echipa** vrea detalii: ce produs, ce zi, ce schimbăm.
- **Clientul** vrea doar ce îl privește pe el.

Scrie-le pe amândouă clar: „perioada: 1-31 octombrie 2026; citește patronul, care are două minute”.

:::dont
„Fă un raport din fișierul de vânzări.”
:::

:::do
„Folosește vanzari-octombrie.csv. Scrie un raport de o pagină pentru patron despre octombrie 2026: vânzări totale, vânzări pe magazin, primele 3 produse, magazinul cel mai slab și un motiv posibil, doar din date. Calculează totul din fișier și arată metoda. Salvează ca raport-octombrie.md.”
:::

## Să calculeze, nu să ghicească

Agentul poate „citi” un tabel din priviri și să scrie un total care arată bine, dar nu e corect. Cere-i cifre calculate.

:::example Rândurile de pus în cerere
„Calculează fiecare cifră din fișier. Nu estima și nu rotunji decât la final. Sub fiecare tabel, arată cum ai calculat (ce coloană, ce rânduri, sumă sau medie).”
:::

Așa agentul chiar face calculul pe fișier, nu îl aproximează. Iar dacă îți arată metoda, o poți verifica.

## Verifică tu totalurile

Înainte să trimiți raportul:

1. Deschide CSV-ul în Excel și adună coloana de total. Trebuie să iasă fix cât totalul din raport.
2. Alege un magazin sau un produs și filtrează-l. Compară.
3. Caută cifre care nu au cum să fie în fișier.

:::picture check
Totalul din raport trebuie să iasă la fel ca în fișier.
:::

:::warn
Procente „față de anul trecut” când i-ai dat o singură lună sau „creștere” fără nimic cu care să compare sunt inventate. Scoate-le sau dă-i datele care lipsesc.
:::

## Încearcă acum

:::try
Butonul pornește cardul „Raport săptămânal din fișiere” într-un folder de exercițiu cu vânzările inventate pe octombrie ale unei brutării cu trei magazine. Câmpurile sunt deja completate. Când e gata raportul, deschide CSV-ul și verifică dacă totalul general se potrivește.
:::

:::quiz
Raportul spune că vânzările au crescut cu 12% față de anul trecut, dar i-ai dat doar fișierul pe octombrie 2026. Ce faci?

- [ ] Lași cifra, sună credibil.
- [ ] Rotunjești la 10%, ca să fie mai prudent.
- [x] Scoți cifra sau îi dai agentului și datele de anul trecut.

> Fișierul nu are cu ce să compare, deci procentul e inventat.
:::

:::quiz
Ce adaugi în cerere ca să poți verifica totalurile?

- [x] Să calculeze fiecare cifră din fișier și să arate cum a calculat.
- [ ] Să scrie mai profesionist.
- [ ] Să facă raportul mai lung.

> Când îți arată coloana, rândurile și operația, poți reface calculul în Excel.
:::

:::quiz
Îi dai un fișier XLSX cu mai multe foi și un rând de total la final. Ce îi spui?

- [ ] Nimic, se descurcă singur.
- [ ] Să citească toate foile și să adune tot.
- [x] Ce foaie, de la ce rând încep datele și să ignore rândul de total.

> Foile ascunse, capetele îmbinate și totalurile din tabel îl încurcă pe agent.
:::
