# ADR 0003 — Polski parser szybkiego dodawania: zakres i reguły rozstrzygania (6.10.2026)

Status: przyjęte. Realizuje D18 (regułowy polski parser dat z chipem do odklikania).
Kod: `src/domain/quickadd.ts`, reguły i słownik: `src/config/quickadd.pl.ts`.

## Zakres MVP
dziś/dzisiaj, jutro, pojutrze (opcjonalnie z „na”); „w/we/na” + dzień tygodnia w bierniku; daty liczbowe
(15.10, 15.10.2027, 15/10) i słowne (15 października, 15 paź 2027); godziny (o 17, o 17:30, o 17.30,
o godz. 7, o godzinie 7, 17:30); „co tydzień” → `FREQ=WEEKLY;BYDAY=<dzień startu>`.
Rozpoznawanie ignoruje polskie znaki. Pierwszy fragment danego rodzaju wygrywa, kolejne zostają w tytule.
Poza MVP: „w przyszły piątek”, „za 3 dni”, „do piątku”, „rano/wieczorem”, „codziennie”, +osoba, #grupa (Faza 1).

## Źródła językowe
- Nazwy miesięcy w dopełniaczu i skróty, nazwy dni: Unicode CLDR 48.2.3 (pl, ca-gregorian).
- „we” przed [w]/[f] + spółgłoska, oboczne „we środę/we czwartek”:
  https://sjp.pwn.pl/poradnia/haslo/we-wtorek;21155.html (prof. K. Kłosińska) oraz
  https://sjp.pwn.pl/poradnia/haslo/kiedy-w-kiedy-we;23528.html (dr hab. A. Wolański).
- Biernik: środę, sobotę, niedzielę — formy odmiany na sjp.pl (środa, sobota, niedziela).

## Decyzje właściciela (6.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D42 | „w piątek” wpisane w piątek | ten dzień za tydzień | dziś |
| D43 | godzina bez dopowiedzenia („o 7”) | najbliższa przyszła: dla 1–11 rano, chyba że minęła, a po południu nie; bez dnia — najbliższe wystąpienie (dziś albo jutro); przy dniu podanym wprost godzina zostaje w tym dniu | zawsze dosłownie |
| D44 | data bez roku, która już minęła | przyszły rok (najbliższy rok, w którym data istnieje, np. 29.02) | bieżący rok |
| D45 | sam dzień bez godziny | termin całodniowy (bez godziny) | domyślna godzina |

Dopowiedzenia (moje, w duchu D43): godziny 0 i 12–23 czytane dosłownie; seria „co tydzień” bez dnia
startuje dziś; nieistniejąca data (31.04) nie jest rozpoznawana i zostaje w tytule.

## Testy
Korpus 470 fraz w `src/domain/__tests__/fixtures/quickadd.pl.json` generowany przez
`scripts/gen-quickadd-corpus.py` z niezależną implementacją reguł na `datetime` Pythona (test różnicowy;
`npm run check:corpus` pilnuje, że plik jest aktualny). Do tego testy własności (fast-check): data → fraza →
parse = ta sama data; dzień tygodnia zawsze 1–7 dni naprzód; godzina bez dnia zawsze w ciągu 24 h w przyszłości;
tokeny zawsze wskazują swój tekst. Sprawdzenie mutacyjne: zmiana D42, D43 lub D44 w kodzie łamie 12–33 testy.

## Znane ograniczenia
„2.5 kg” zostanie odczytane jako 2 maja — użytkownik odklikuje chip. Lista zakupów nie używa parsera dat.
