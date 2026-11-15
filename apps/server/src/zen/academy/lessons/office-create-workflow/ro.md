---
learn:
  - Când merită să faci un card din cererea ta
  - Cum scrii întrebările și instrucțiunile unui card
  - Cum îl testezi înainte să-l dai colegilor
---

## Când merită un card

Dacă ai scris de trei ori aproape aceeași cerere, e timpul pentru un card. Semne clare:

- copiezi un mesaj vechi din altă conversație și schimbi două detalii;
- colegii te întreabă „cum l-ai făcut pe agent să scrie așa?”;
- rezultatul iese bine doar când îți amintești să adaugi cinci instrucțiuni anume.

Un card ține instrucțiunile bune într-un singur loc. Așa toată lumea primește aceeași calitate, fără să le țină minte. Îl faci din **Creează card**, în Birou.

:::picture office-cards
Cardul tău apare în Birou, lângă cele gata făcute.
:::

## Cele două părți ale unui card

**Întrebările** sunt ce se schimbă de la o dată la alta. Fiecare are un id (un nume scurt, de exemplu `nume_client`), un text pe care îl văd oamenii și poate fi obligatorie sau nu. Pune între trei și șase. Fiecare câmp în plus e încă un motiv să nu folosească nimeni cardul.

**Instrucțiunile** sunt ce rămâne la fel. Le scrii o singură dată, ca pe o cerere foarte bună. Unde vin răspunsurile pui câmpuri de completat: `{{nume_client}}` se înlocuiește cu ce a scris omul.

:::tip
Pentru ceva ce se completează doar uneori, folosește o secțiune opțională. Textul dintre `{{#numar_comanda}}` și `{{/numar_comanda}}` apare doar dacă acel câmp are o valoare.
:::

:::picture workflow
Editorul de carduri: numele, întrebările și instrucțiunile.
:::

## Exemplu: răspuns la o reclamație

Întrebările cardului:

- `reclamatie` (obligatoriu): lipești mesajul clientului
- `nume_client` (obligatoriu)
- `ce_s_a_intamplat` (obligatoriu): ce ai aflat tu în firmă
- `oferta`: ce îi poți oferi (banii înapoi, voucher, înlocuire)
- `numar_comanda`

:::example Instrucțiunile cardului
```text
Scrii răspunsuri la reclamațiile clienților pentru firma noastră.
Client: {{nume_client}}
Mesajul lui: {{reclamatie}}
Ce am aflat noi: {{ce_s_a_intamplat}}
{{#numar_comanda}}Numărul comenzii: {{numar_comanda}}.{{/numar_comanda}}
{{#oferta}}Putem oferi: {{oferta}}. Oferă doar atât, nimic în plus.{{/oferta}}

Scrie un răspuns de cel mult 150 de cuvinte. Cere-ți scuze o singură
dată, explică simplu ce s-a întâmplat, spune ce facem mai departe
și până când. Nu promite nimic ce nu e scris mai sus. Nu da vina
pe client. Salvează-l ca raspuns-{{nume_client}}.md.
```
:::

Uită-te la limite: „oferă doar atât”, „nu promite nimic ce nu e scris mai sus”. Rândurile astea te feresc de cele mai scumpe greșeli.

## Testează-l înainte să-l dai mai departe

1. Rulează cardul tu, pe două cazuri reale: unul simplu, unul încurcat.
2. Dă-l unui coleg fără să-i explici nimic. Vezi unde se oprește să se gândească. De obicei e un câmp cu un nume neclar, așa că îl redenumești („Ce am aflat?” în loc de „Intern”).
3. Repari instrucțiunile, nu rezultatul.

:::dont
Toate răspunsurile ies prea lungi, iar tu le scurtezi de mână de fiecare dată.
:::

:::do
Pui limita de lungime în instrucțiunile cardului, o singură dată.
:::

## Ține-l scurt

Un card cu 15 întrebări și două pagini de instrucțiuni e un formular pe care nu-l completează nimeni. Un card, o treabă.

:::example Două treburi, două carduri
Ai nevoie și de „răspuns la reclamație”, și de „raport de reclamație pentru șef”? Fă două carduri, nu unul care le face pe amândouă.
:::

## Încearcă acum

:::try
Se deschide editorul de carduri. Fă cardul de reclamații din exemplul de mai sus, sau unul pentru o treabă pe care o repeți în fiecare săptămână. Apoi pornește-l o dată cu o reclamație inventată și vezi ce iese.
:::

:::quiz
Copiezi în fiecare luni același mesaj vechi și schimbi doar data și numele clientului. Ce faci?

- [ ] Continui așa, merge.
- [x] Faci din el un card, cu data și numele clientului ca întrebări.
- [ ] Îi ceri agentului să țină minte mesajul pentru săptămâna viitoare.

> Când repeți aceeași cerere, cardul ține instrucțiunile bune într-un loc și le dă aceeași calitate tuturor.
:::

:::quiz
Rezultatele cardului tău ies mereu prea lungi. Ce repari?

- [ ] Scurtezi de mână fiecare rezultat.
- [ ] Adaugi încă cinci întrebări în card.
- [x] Pui o limită de lungime în instrucțiunile cardului.

> Repari instrucțiunile, nu rezultatul. Așa se rezolvă pentru toți cei care folosesc cardul.
:::

:::quiz
Un coleg se oprește la un câmp numit „Intern” și nu știe ce să scrie. Ce faci?

- [x] Redenumești câmpul într-o întrebare clară, de exemplu „Ce am aflat?”.
- [ ] Îi explici o dată și lași câmpul cum e.
- [ ] Scoți toate întrebările din card.

> Testul cu un coleg arată exact ce nu e clar. Un nume de câmp bun nu mai are nevoie de explicații.
:::
