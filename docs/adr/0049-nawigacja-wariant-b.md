# 0049. Nawigacja po audycie przepływów: wariant B (12.10.2026)

Decyzja właściciela z 12.10.2026: zatwierdzone wszystkie rekomendacje z audytu przepływów i nawigacji
(`docs/01-przeplywy-i-nawigacja.md`, pytania Q1–Q8). Wdrożenie w krokach K1–K8 z sekcji 3.7 tego dokumentu, każdy krok
osobnym commitem z testami. Problemy Z-1…Z-12, przepływy (S, C, P, Z, G, H, U) i liczby stuknięć — w tym dokumencie.

## Decyzje

| Pytanie | Decyzja | Odrzucone warianty (z dokumentu) |
|---|---|---|
| Q1. Wariant nawigacji | **B — „Uporządkowane miejsca”**: wszystko z A, ekran grupy w dwóch częściach (treść i podstrona „Ustawienia grupy”), Kosz na osobnym ekranie, „Do potwierdzenia” nad polem, odwołany termin w Kalendarzu. | A — poprawki w miejscu (ekran grupy zostaje długi, Kosz rośnie na końcu Grup); C — wspólny przycisk „Dodaj” w nagłówku (każde dodanie z formularza o 1 stuknięcie dłuższe, dwie drogi do tego samego obok pola dodawania, nowy wzorzec dla testerów). |
| Q2. Zakładki | **Bez zmian**: Moje sprawy · Listy · Kalendarz · Grupy, w tej kolejności. | b) zamiana Listy i Kalendarz (bez danych o użyciu to zgadywanie); c) Listy scalone z Grupami (zakupy o 1–2 stuknięcia dalej). |
| Q3. Odwołany termin serii | **a) W Kalendarzu wyszarzony wiersz „Odwołany: …”**, który otwiera ekran wydarzenia z „Przywróć” — dla każdego dorosłego w grupie. Moje sprawy, przypomnienia i lustro w kalendarzu iPhone’a nie biorą odwołanych terminów. | b) jak dotąd — tylko „Ostatnie zmiany” u osoby, która odwołała (inny dorosły nie ma drogi); c) w Koszu jako „Odwołane terminy” (Kosz trzyma tylko usunięte rzeczy). |
| Q4. Kosz i „Ostatnie zmiany” | **a) Dwa wiersze w Grupach pod listą grup; Kosz na osobnym ekranie.** Ścieżki „Grupy → Kosz” i „Grupy → Ostatnie zmiany” w „Co nowego” i w polityce prywatności zostają prawdziwe. | b) w Ustawieniach (to nie są ustawienia, teksty i polityka do zmiany); c) jak dotąd (Kosz rozwinięty na końcu Grup). |
| Q5. „Do potwierdzenia” | **a) Nad polem dodawania** w Moich sprawach — pilne przekazania na pierwszym ekranie także przy dużym tekście. | b) jak dotąd (PWD-31 A: pod paskiem okresu). |
| Q6. Dodawanie w Kalendarzu | **a) Jeden przycisk „Dodaj na <dzień>” pod siatką dni**; rodzaj (wydarzenie, zadanie, rutyna) w formularzu. „Dodaj rutynę” znika z Kalendarza. | b) dwa przyciski („Dodaj wydarzenie”, „Dodaj zadanie”) — więcej elementów na ekranie; c) jak dotąd (na końcu treści). |
| Q7. Zaproszenie administratora na karcie „Następne kroki” | **a) „Zaproś jako administratora” wszędzie, z dopiskiem „np. drugi rodzic”.** | b) „Zaproś partnera (administrator)” na karcie — dwie nazwy jednej rzeczy. |
| Q8. Przepływy „NOWY” (widżet, import ze zdjęcia, ICS, pochwała, logowanie e-mailem) | **a) Zostają w backlogu** do opinii testerów po zmianach nawigacji. O skreśleniu pochwały (D19) właściciel zdecyduje osobno. | b) widżet teraz (migracja bazy do kontenera app group); c) skreślić pochwałę. |

## Kroki wdrożenia (sekcja 3.7)

- **K1** — teksty: podpowiedź „Więcej” (Z-5), jedna nazwa na rzecz (Z-7), słownik (Z-8).
- **K2** — „Zaplanuj zakupy” z karty „Następne kroki” otwiera listę z otwartym planowaniem (Z-6).
- **K3** — Kalendarz: „Dodaj na <dzień>” pod siatką, rutyna przez „Rodzaj” (Z-2, Z-3).
- **K4** — ekran grupy: nowa kolejność sekcji, dodawanie pod nagłówkami (B1 bez podstrony).
- **K5** — „Ustawienia grupy” jako podstrona ekranu grupy (B1).
- **K6** — Kosz jako osobny ekran z wiersza w Grupach (B2).
- **K7** — odwołany termin w Kalendarzu z „Przywróć” (B4).
- **K8** — „Do potwierdzenia” nad polem dodawania (B3).

## Ustalenia przy wdrożeniu (Claude, 12.10.2026)

Rozstrzygnięcia, których dokument nie opisuje wprost; przyjęty wariant najbliższy rekomendacji.

- **K1, jedna nazwa na rzecz.** Na karcie „Następne kroki” te same przyciski co na ekranie grupy: „Zaproś jako
  administratora” (z dopiskiem „np. drugi rodzic”, Q7) i „Zaproś” (zamiast „Zaproś kogoś innego (członek)” i „Zaproś do
  grupy” — to ta sama czynność co „Zaproś” na ekranie grupy). „Dodaj dziecko” na karcie → „Dodaj dziecko (bez konta)”,
  „Utwórz listę zakupów” → „Nowa lista zakupów”, „Nowa lista” → „Nowa lista zadań” (Listy, ekran grupy). Odrzucone:
  zostawić „Zaproś kogoś innego (członek)” — dokument wymienia go w Z-7 tylko pośrednio, ale to druga nazwa „Zaproś”.
  **Do potwierdzenia przez właściciela** (brzmienie przycisku członka na karcie).
- **K3, etykieta.** „Dodaj na <dzień tygodnia w bierniku>, <dzień> <miesiąc w dopełniaczu>”, np. „Dodaj na środę,
  7 października” — także dla dziś i jutra (stała forma, bez „Dodaj na dziś”); rok tylko spoza bieżącego. Przycisk
  widzi każdy, jak dotąd „Dodaj wydarzenie” w Kalendarzu (formularz pokazuje tylko grupy, w których wolno dodawać).
  testID zostaje `calendar-add-event` (otwiera formularz wydarzenia; scenariusze E2E i audyt XCUITest bez zmian).
  Rutyna jest już tylko pod „Rodzajem”: przełączenie z niezmienionego formularza wydarzenia (bez nazwy, z grupą
  domyślną) otwiera rutynę tak jak dawniej „Dodaj rutynę” — z jej szkicem (D179) i grupą domyślną.
- **K4/K5, ekran grupy.** Kolejność z B1: „Następne kroki” → Osoby (zaproszenia, kod, dziecko bez konta, lista osób) →
  Plany lekcji → Listy grupy („Nowa lista zadań”, „Nowa lista zakupów”) → Wydarzenia grupy („Dodaj wydarzenie”) →
  wiersz „Ustawienia grupy”. „Dodaj rutynę” na ekranie grupy znika — rutyna przez „Rodzaj” w formularzu wydarzenia (B1).
  Podstrona „Ustawienia grupy”: zakres „W Moich sprawach”, nazwa, kolor, „Zmień ID grupy”, „Wyjdź z grupy”,
  „Usuń grupę”. Wiersz „Ustawienia grupy” widzi każdy, kto ma tam cokolwiek do zrobienia (także dziecko z kontem —
  napis, że z grupy usuwa je dorosły); grupa osobista — tylko kolor i nazwa, jeśli wolno je zmieniać.
- **K6, Kosz.** Wiersz „Kosz” z liczbą rzeczy w podpisie; pusty Kosz — wiersz zostaje (ścieżka „Grupy → Kosz” z polityki
  prywatności ma zawsze dokąd prowadzić), ekran mówi, że jest pusty.
- **K7, odwołany termin.** Wiersz „Odwołany: <tytuł>” tylko w Kalendarzu, tylko dla dorosłych grupy (dziecko z kontem nie
  odwołuje i nie przywraca), wyszarzony, bez przesuwania i bez odhaczania; nie liczy się do kropek ani etykiety dnia
  w siatce (nic się wtedy nie dzieje). Domena: osobna funkcja `cancelledEventDays`, a `expandEvents`/`expandEventDays`
  (Moje sprawy, przypomnienia, lustro, dojazd, zadania serii) dalej pomijają odwołane — testy to sprawdzają.

## Testy
Każdy krok: najpierw test RNTL albo domeny opisujący nowe zachowanie (czerwony przed zmianą), potem kod; logika
w `src/domain` ze 100% pokrycia. Scenariusze Maestro 01, 04, 08 i kontrakty `e2e-flows.test.ts` zmienione tam, gdzie
zmienia się nawigacja. Wzorce zrzutów nie są jeszcze przyjęte, więc nowych nie tworzymy.
