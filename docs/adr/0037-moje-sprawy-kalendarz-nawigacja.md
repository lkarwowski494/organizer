# 0037. Moje sprawy, Kalendarz, nawigacja i formularze (audyt 2, paczka P13, 8.10.2026)

## Decyzje właściciela
| ID | Sprawa (audyt 2) | Decyzja | Odrzucone |
|---|---|---|---|
| D149 | M-35 / PW-2: duże grupy zalewają Moje sprawy | Przy grupie wspólnej „W Moich sprawach: Wszystko / Przypisane do mnie i wydarzenia / Tylko przypisane do mnie”, domyślnie Wszystko; podpowiedź po dołączeniu do grupy od `config.myDays.LARGE_GROUP_MEMBERS` osób | Reguła automatyczna wg wielkości |
| D188 | M-127 / PW-28: wejście do Ustawień | Ikona w prawym górnym rogu każdej zakładki; chip synchronizacji tylko informuje | Piąta zakładka „Ja”; bez zmian |
| D191 | M-118 / PW-37: grupa w formularzach | Wydarzenie, rutyna i lista startują z „Grupy domyślnej” (jak szybkie dodawanie) | Wspólna, gdy jedna; bez zmian |
| D192 | M-119 / PW-38: chipy grup | Chipy filtrują Moje sprawy i Kalendarz (pamiętane na telefonie), znak „Filtr włączony” i „Pokaż wszystkie” | Sama legenda |
| D193 | M-133 / PW-27: nazwa zakładki | Zakładka „Moje sprawy”, przycisk „Dziś” zostaje | Zakładka „Dziś”; tylko etykieta |
| PWD-1 C, 4 A, 5 A, 7 A, 8 A, 10 A, 11 A, 13 A, 15 A, 20 A, 30 A, 31 A, 32 B | M-173, M-273, M-274, M-276, M-277, M-279, M-280, M-282, M-284, M-289, M-299, M-300, M-301 | Jak w opisie niżej | Warianty B (A przy PWD-32) |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Zakres (D149) — gdzie zapisany:** w lokalnej bazie konta (`local:myDaysScope`, `app/my-scope.tsx`), jak „Grupa
   domyślna”. Odrzucone: kolumna w `group_members` — wiersz członka widzi cała grupa (inni widzieliby, kto „wyciszył”
   grupę), a zmiana protokołu dotknęłaby buildu 21. Koszt: drugi telefon konta ustawia się osobno. Jedna reguła
   (`domain/views/my-scope.ts`, `concernsMe`, `Occurrence.assignedToMe`) dla Moich spraw, przypomnień, porannego
   podsumowania, lustra w iPhonie i dojazdu. „Przypisane do mnie” = moja osoba albo moja lista „Tylko ja”; zadanie
   dziecka bez konta tylko w „Wszystko”. W wydarzeniach „Tylko przypisane do mnie” = odpowiadam albo jestem imiennie
   uczestnikiem.
2. **Filtr grup (D192):** jeden dla obu ekranów (te same chipy), kilka grup naraz, wydarzenia z iPhone'a przy filtrze
   schowane (nie należą do grupy). Grupa, której już nie mam, wypada sama.
3. **Opis wiersza (M-128, M-129):** jeden budowniczy `app/row-meta.ts` dla Moich spraw, Kalendarza i zadań na ekranie
   wydarzenia: czas pierwszy (w liście dnia przy zadaniu z terminem tego dnia sama godzina), grupa, osoba, seria,
   „zaległe od …”, „minęło”, „Wyjdź o …”; jeden separator `META_SEP`; dzień i godzina terminu przecinkiem („jutro, 17:00”).
   Świadome różnice Kalendarza: zrobione w dniu terminu z „zrobione <dzień>” (PWD-1 C), blade kolejne terminy zadań
   powtarzanych według kalendarza — od wykonania się nie da przewidzieć (PWD-15 A), zrobione zakupy przekreślone
   (PWD-11 A, kolumny `lists.trip_done_at`, `trip_done_date`; pamiętane ostatnie zakupy listy).
4. **Wydarzenie dziecka u drugiego rodzica (PWD-32 B):** wyszarzone „Kuba: Basen” z „odpowiada: Ala” (to samo słowo
   co przy osobie odpowiedzialnej, zamiast „zawozi”), bez przypomnień, lustra i dojazdu.
5. **Potwierdzenia (PWD-4 A):** proste tak/nie — okno systemowe (wyjście z grupy, kosz grupy, wylogowanie); panel w
   ekranie tylko przy wyborze z kilku opcji albo dłuższym wyjaśnieniu (czyszczenie danych, usunięcie konta).
6. **Walidacja (PWD-5 A):** przycisk zawsze aktywny (poza wysyłaniem), po naciśnięciu komunikat przy polu (rola alert).
7. **Po zapisie (M-246):** „pojemniki” (lista, grupa) otwierają się, „wpisy” (zadanie, wydarzenie, rutyna) wracają;
   po zmianie wydarzenia — do jego szczegółów, gdy termin nadal istnieje, inaczej o ekran dalej.
8. **Formularze (M-243, M-247):** kursor w pierwszym polu pustego formularza tworzenia; Return w ostatnim polu zatwierdza,
   w formularzu z kilkoma polami tekstowymi przechodzi do następnego.
9. **Północ (M-203):** zegar dnia w `AppProvider` (timer do najbliższej północy w Warszawie i powrót aplikacji).
