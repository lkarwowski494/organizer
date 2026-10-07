# 0009. „Dotyczy mnie”: dzień / tydzień / miesiąc, rolowanie, godziny z kropką (7.10.2026)

Zgłoszenie właściciela po buildzie 2: brakuje przechodzenia na wczoraj i jutro oraz widoku tygodnia i miesiąca. Do tego „Logopeda 18.00” i „Kolacja 22.00” stały w złej kolejności.

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D61 | Niezrobione zadanie po terminie | Domyślnie przechodzi na kolejne dni i do odhaczenia jest widoczne „dziś” z czerwonym znacznikiem „zaległe od N dni”. Termin zostaje pierwotny. Przy zadaniu można wybrać „Tylko tego dnia”, wtedy mija jak wydarzenie. | Domyślnie przepada, z opcją rolowania; zawsze roluje, bez opcji; przestawianie terminu na dziś |
| D62 | Nawigacja w „Dotyczy mnie” | Przełącznik Dzień / Tydzień / Miesiąc, strzałki ‹ › (dzień, tydzień albo miesiąc) i przycisk „Dziś” do powrotu | Pasek dni tygodnia; przesuwanie całego ekranu palcem, które koliduje z usuwaniem z D60 |
| D63 | Miniony dzień | Pokazuje zadania odhaczone tego dnia i wyszarzone wydarzenia. Niezrobione przeszły na dziś. | Także niezrobione; bez wydarzeń |
| D64 | Zadanie na spotkaniu po spotkaniu | Przepada: znika z „Dotyczy mnie”, a na liście trafia do zrobionych z dopiskiem „minęło”. Każde spotkanie w serii ma mieć osobne zadanie, bo zrobione w poniedziałek nie znaczy zrobione za tydzień. | Roluje jak inne zadania |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Rolowanie liczy telefon w widoku.** Nie przestawia terminu w danych (D61 zachowuje termin pierwotny), więc nie ma zapisów, nie ma konfliktów i nie ma też zadania po stronie serwera.
   - Serwer przechowuje tylko `tasks.rollover` (migracja 20261008120000).
2. **Miniony dzień bierze datę odhaczenia, nie termin zadania.** Datą odhaczenia jest `completed_at` w czasie Europe/Warsaw. Odhaczone dziś, jak dotąd, znika z dzisiejszego widoku.
3. **Tydzień liczy się od poniedziałku** (PN-EN ISO 8601, tak samo jak w kalendarzu).
   - W tygodniu i miesiącu widać tylko dni, w których coś jest, i zawsze dziś.
   - „Przypięte” pojawiają się tylko w widoku dnia dzisiejszego.
4. **Zakres dat** zapisujemy według CLDR 48.2.3 pl, intervalFormats MMMMd i yMMMMd: „5–11 października”, „28 września – 4 października”.
5. **Godzina z kropką bez „o”** („18.00”, „22.30”).
   - Źródło: Poradnia PWN, dr hab. A. Wolański (https://sjp.pwn.pl/poradnia/haslo/Separator-godzin-i-minut;18358.html), cytat: „Godziny i minuty zapisane cyfrowo można separować zarówno z użyciem kropki, jak i dwukropka. Zapis z użyciem dwukropka jest rzadszy.”
   - Ten sam zapis bywa też datą („10.11” to 10 listopada). Bez „o” odczytujemy go więc jako godzinę tylko wtedy, gdy minuty nie mogą być miesiącem (00 oraz 13–59).
   - „o 10.11” to nadal godzina. Rozpoznaną część widać jako chip do odklikania.
   - Korpus testowy (Python, niezależna implementacja) uzupełniony.
