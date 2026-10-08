# 0035. Decyzje po audycie (właściciel, 8.10.2026)

| ID | Sprawa (audyt) | Decyzja | Odrzucone |
|---|---|---|---|
| D126 | A. Obecność przy rutynach i lekcjach | Bez obecności przy rutynach (wydarzenie ze stałymi krokami) i lekcjach z planu lekcji | Przełącznik przy wydarzeniu; zostaje |
| D127 | B. Lekcje zalewają Moje sprawy dorosłych | Jeden wiersz na dzień na dziecko („Kuba: 6 lekcji 8:00–13:30”, rozwijany); w Kalendarzu lekcje osobno | Tylko w Kalendarzu; zostaje |
| D128 | B'. Ponowne otwarcie planu lekcji dubluje lekcje | Ekran planu pokazuje istniejące lekcje do edycji; przycisk tylko przy dzieciach | Ostrzeżenie przed zapisem |
| D129 | C. Przeładowany wiersz | „Wyjdź o” w osobnej, wyróżnionej linii; bez „powtarza się”; obecność w wierszu tylko przy „nie” | Tylko bez „powtarza się”; zostaje |
| D130 | D. Zapis zadania | Każda zmiana zapisuje się od razu (tytuł/notatka po wyjściu z pola), bez „Zapisz” | „Zapisz” + pytanie przy wyjściu |
| D131 | E. Ustawienia | Podstrony: Powiadomienia / Kalendarz i dojazd / Wygląd / Konto i dane | Jedna zwarta strona |
| D132 | F. Osoba usunięta z grupy | Jej zadania i wydarzenia wracają do „Nikt konkretny” | Następca wskazywany przy usuwaniu |
| D133 | G. Powtarzanie + „Tylko tego dnia” | Następny termin powstaje także po przeminięciu | Zakaz łączenia |
| D134 | H. Przypomnienia | Jedno zbiorcze dla wydarzenia / zadania-rodzica (z podzadaniami w treści), przed „Wyjdź o” | Osobne przesunięte; zostaje |
| D135 | I. Rola Kalendarza | Kalendarz = co było zaplanowane (także odhaczone i minione); Moje sprawy = do zrobienia | Te same reguły wszędzie |
| D136 | J. Całodniowy pojedynczy termin serii | Dodać (znacznik w wyjątku od serii) | Zostaje |
| D137 | K. „Przenieś zaległe” a miesięczne powtarzanie | Reguła pamięta dzień miesiąca; przeniesienie zmienia tylko ten raz | Nie przenosić powtarzanych |
| D138 | L. Dziecko wraca przez zaproszenie | Rola dziecka zostaje (zmienia ją tylko admin) | Powrót do zatwierdzenia |
| D139 | M. Lista poszerzona do „cała grupa” pusta u innych | Naprawić (sygnał nowego dostępu, telefon pobiera zawartość) | Zostaje |
| D140 | N. Blokowanie dołączania złymi kodami | Zostaje jak jest | Poprawny kod zawsze przechodzi |
| D141 | O. Martwy link w zaproszeniu | Ukryć link w wiadomości, dopóki strona nie będzie gotowa | Kroki właściciela teraz |
| D142 | P. Polityka prywatności | Uzupełnić teraz, do akceptu właściciela | Przed publikacją |
| D143 | Q. Testy E2E i zrzuty ekranu | Wdrożyć przy każdej zmianie (repo publiczne — standardowe maszyny GitHub Actions, także macOS, bez opłat: „GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners”, https://docs.github.com/en/billing/concepts/product-billing/github-actions) | Tylko w nocy; usunąć z zasad |

## Wdrożenie (8.10.2026)

Decyzje techniczne podjęte przy wdrożeniu — z odrzuconymi wariantami, do sprawdzenia i cofnięcia.

- **D126 rodzaj wydarzenia.** Kolumna `events.kind` (`event` / `lesson` / `routine`), ustawiana tylko przy tworzeniu
  (GRANT insert, bez update); „to i następne” zachowuje rodzaj. Odrzucone: wnioskowanie z danych (zwykłe wydarzenie też
  może mieć stałe zadania serii, więc rutyny nie da się odróżnić). Wydarzenia sprzed migracji mają `event` — lekcje
  i rutyny dodane przed tą wersją nadal pytają o obecność, dopóki nie zostaną dodane od nowa (otwarte pytanie: czy
  oznaczać je wstecz po uczestniku-dziecku i powtarzaniu co tydzień).
- **D127.** Zwijane tylko lekcje, w których sam nie uczestniczę, a uczestnikiem jest dziecko; blok od pierwszego
  początku do ostatniego końca. Zwinięte lekcje nie mają przypomnień ani miejsca w porannym podsumowaniu. Odrzucone:
  jedno przypomnienie „Kuba: lekcje od 8:00” (codzienny szum).
- **D128.** Zapis kończy stare serie przed dziś (UNTIL = wczoraj, nierozpoczęte do kosza), nowe zaczynają się od
  pierwszego pasującego dnia od dziś; cofnięcie przywraca stary plan. Odrzucone: zmiana serii w miejscu (gubiłaby
  minione terminy, do których są przypięte zadania i obecność) i cięcie od poniedziałku (zmieniałoby minione dni tygodnia).
  Litery A/B nie są zapisywane: przy otwarciu bieżący tydzień to A.
- **D130.** Tytuł i notatka zapisują się po wyjściu z pola i przy opuszczeniu ekranu; termin po wyborze daty albo
  poprawnej godziny (niepoprawna — komunikat, bez zapisu). Odrzucone: zapis po każdym znaku (wiele zmian w kolejce).
- **D131.** Jedna trasa `Settings` z parametrem `section`; wylogowanie z potwierdzeniem. Przy okazji (audyt):
  wylogowanie wyrejestrowuje token powiadomień tego telefonu (`unregister_push_token`) — od audytu 2 także token
  zarejestrowany w poprzednim uruchomieniu (zapamiętany w pęku kluczy); bez sieci wylogowanie i tak następuje.
- **D134.** Podzadania i zadania wystąpienia stojące w planie pod rodzicem nie mają własnych przypomnień; treść
  przypomnienia rodzica (także „Czas wyjść”) kończy się „do zrobienia: …”. Poranne podsumowanie liczy tylko rodziców.
  Wyjątek (audyt 2, N-2, N-3; potwierdzony przez właściciela 8.10.2026): podzadanie z własną godziną, którego rodzic nie
  ma przypomnienia albo ma je później, przypomina samo (z dopiskiem rodzica) i liczy się w porannym podsumowaniu.
  Potwierdzone tego dnia także: powiadomienia przy otwartej aplikacji pokazują baner i grają dźwięk (N-1).
- **D135.** `calendarMonth` bierze też zrobione zadania (odhaczone w wierszu) w dniu ich terminu.
- **D136.** `event_overrides.all_day`; telefon wysyła pole tylko, gdy coś zmienia (nowy całodniowy termin w serii
  z godziną albo zdjęcie znacznika). Wymaga wdrożenia migracji 20261008300000 przed wydaniem buildu, który je wysyła.
  To samo dotyczy `events.kind` (D126): lekcje z planu i rutyny wysyłają `kind` przy tworzeniu (audyt 2, D-2).
  Odrzucone: pusta godzina w wyjątku jako „cały dzień” (dotąd znaczyła „jak w serii” — zmiana znaczenia starych danych).
- **D141.** `config.invites.LINK_LIVE = false`: wiadomość z zaproszeniem bez linku, z ID grupy i kodem.
