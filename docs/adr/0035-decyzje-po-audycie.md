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
| D140 | N. Blokowanie dołączania złymi kodami | Zostaje jak jest — **odwrócona 8.10.2026 (audyt 2): poprawny kod przechodzi, limit na konto i na kod, ADR 0020** | Poprawny kod zawsze przechodzi |
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
  Litery A/B nie są zapisywane: przy otwarciu bieżący tydzień to A. **Zmienione w audycie 2** (ADR 0027): zmiany od jutra,
  zmieniona seria przechodzi poleceniem „to i następne” z wyjątkami i zadaniami (M-14), tydzień A zapisany przy osobie (D171).
- **D130.** Tytuł i notatka zapisują się po wyjściu z pola i przy opuszczeniu ekranu; termin po wyborze daty albo
  poprawnej godziny (niepoprawna — komunikat, bez zapisu). Odrzucone: zapis po każdym znaku (wiele zmian w kolejce).
  Audyt 2 (PW-20 A): tak samo nazwa grupy i imię osoby — pole podąża za danymi, dopóki go nie zmienię, zapis tylko
  zmienionego pola, bez „Zapisz”; pustej nazwy (i pustego albo za długiego imienia) nie zapisujemy — komunikat.
- **D131.** Jedna trasa `Settings` z parametrem `section`; wylogowanie z potwierdzeniem. Przy okazji (audyt):
  wylogowanie wyrejestrowuje token powiadomień tego telefonu (`unregister_push_token`) — od audytu 2 także token
  zarejestrowany w poprzednim uruchomieniu (zapamiętany w pęku kluczy); bez sieci wylogowanie i tak następuje.
- **D132.** Audyt 2 (M-22): ta sama reguła dla zakupów — osoba odpowiedzialna za zakupy usunięta z grupy to „Nikt
  konkretny” (zakupy z dniem widzi każdy w grupie, edytor zakupów pokazuje „Nikt konkretny”). Jedna funkcja dla zadań
  i zakupów (`src/domain/views/concerns.ts`).
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

## Decyzje właściciela po audycie 2 (8.10.2026) — listy i zakupy
| Pytanie | Decyzja | Odrzucone |
|---|---|---|
| PW-15. Okno „Do koszyka?” przy każdej pozycji (zmiana D59) | A: do koszyka bez pytania, z paskiem „Cofnij” | Zostaje jak jest; przełącznik w Ustawieniach |
| PW-17. Zarządzanie listą | B: teraz zmiana nazwy listy, edycja pozycji zakupów, oznaczenie „Tylko ja”; „Kto widzi” i „wybrane osoby” po poprawkach synchronizacji | A: od razu pełne „Ustawienia listy” |
| PW-18. Wyjątki od D68 | A: lista „Tylko ja” poza regułą; b: „kiedyś, ktokolwiek” dozwolone z dopiskiem | B: D68 także na liście prywatnej; (a) zakaz |
| PWD-14. Minione kopie „Tylko tego dnia” (D133) | A: na liście zwinięte („12 razy minęło”, rozwijane) | Same do kosza po N dniach; bez zmian |
| PWD-19. Stałe zakupy a koszyk | A: w koszyku = już na liście; stałe bez ilości | Bez zmian |

Wykonanie (Claude; właściciel może zawetować):
- **PW-17 B.** Nazwa listy — pole „Nazwa listy” na dole ekranu listy, zapis od razu jak tytuł zadania (D130); pozycja
  zakupów — dotknięcie otwiera panel z polem „Nazwa i ilość” (jeden tekst, jak przy dodawaniu: ilość zostaje w nazwie,
  D77), działem i stałą pozycją; panel zamyka „Gotowe” (zmiany są już zapisane). „Tylko ja” na ekranie List, w grupie
  i w nagłówku listy. Odrzucone: osobne pole ilości (drugi format do pilnowania, D77 trzyma ilość w nazwie).
- **PWD-14 A.** Zwinięte są minione, nieodhaczone kopie jednego łańcucha powtarzania (identyfikatory nextId), od dwóch
  w górę; odhaczone kopie zostają osobno. Kalendarz bez zmian (D135: co było zaplanowane).
- **PW-18, PW-15** — szczegóły w ADR 0012 (D68) i 0007 (D59).

## Decyzje właściciela po audycie 2 (8.10.2026) — konto i dane na telefonie
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D175 | Ustawienia na telefonie (M-165) | Ustawienia konta (pytanie o imię, wprowadzenie, „Co nowego”, „Nie teraz”, przypomnienia, kalendarz iPhone'a, dojazd, grupa domyślna) osobno dla konta — w bazie konta (`local:pref.*`); wygląd wspólny dla telefonu; zgody iOS zawsze z systemu. Dawne wspólne ustawienia z pęku kluczy przejmuje raz pierwsze zalogowane konto | Wspólne dla telefonu |
| D176 | Zakres wylogowania (M-63) | Tylko ten telefon (`signOut({ scope: 'local' })`) | Wszystkie urządzenia |
| D177 | Logowanie w becie (M-77) | Tylko „Zaloguj przez Apple”; logowanie linkiem z e-maila usunięte z aplikacji (także przyjmowanie sesji z linku — M-76). Dostawcę Email w Supabase Auth właściciel wyłącza po wydaniu buildu (O-110); do tego czasu aplikacja go nie używa | CAPTCHA z limitem 2/h; własna domena + Resend (płatna domena) |
| PWD-34 | Usunięcie konta (M-303) | Konto z Apple potwierdza usunięcie świeżym kodem Apple; serwer sprawdza go w Apple (`/auth/token`, `sub` = tożsamość Apple konta). Bez klucza Sign in with Apple w sekretach — sama obecność kodu (błąd konfiguracji nie blokuje prawa do usunięcia) | Sama sesja |

Wykonanie (Claude): wylogowanie bez internetu zostawia zadanie „wyrejestruj token push” z tokenem odświeżania starej
sesji w pęku kluczy (tylko to urządzenie); telefon wykonuje je tą starą sesją po powrocie sieci (start, zmiana konta,
powrót do aplikacji, co minutę) i zamyka ją — bez funkcji serwera dostępnych bez logowania (D41). Po usunięciu konta
z telefonu znika plik bazy konta (M-64). Link dotknięty, gdy nikt nie był zalogowany, otwiera się po zalogowaniu (M-221).
