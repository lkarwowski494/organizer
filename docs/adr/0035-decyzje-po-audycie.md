# 0035. Decyzje po audycie (właściciel, 8.10.2026)

Rejestr D126–D143 (audyt 1) z notatkami wykonania kolejnych paczek. Decyzje D144–D200 z audytu 2 i decyzje podjęte
potem z upoważnienia właściciela: ADR 0041.

| ID | Sprawa (audyt) | Decyzja | Odrzucone |
|---|---|---|---|
| D126 | A. Obecność przy rutynach i lekcjach | Bez obecności przy rutynach (wydarzenie ze stałymi krokami) i lekcjach z planu lekcji | Przełącznik przy wydarzeniu; zostaje |
| D127 | B. Lekcje zalewają Moje sprawy dorosłych | Jeden wiersz na dzień na dziecko („Tymek: 5 lekcji 8:00–12:35”, rozwijany); w Kalendarzu lekcje osobno | Tylko w Kalendarzu; zostaje |
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
| D138 | L. Dziecko wraca przez zaproszenie | Rola dziecka zostaje (zmienia ją tylko admin) — **od audytu 2 (PW-14 B, D155) rolę zmienia tylko owner** | Powrót do zatwierdzenia |
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
  jedno przypomnienie „Tymek: lekcje od 8:00” (codzienny szum).
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
- **D155 (audyt 2, PW-14 B — dziecko z własnym kontem).** Konto dziecka powstaje przez połączenie istniejącego profilu:
  owner albo admin przy profilu dziecka dotyka „Połącz z kontem dziecka” i dostaje jednorazowy kod do ID grupy
  (`create_child_code` / `renew_child_code`, 24 h, jeden aktywny na profil); dziecko loguje się przez Apple (D177)
  i dołącza tym kodem jak zwykłym — staje się tym samym `member_id` z rolą dziecko (plan lekcji, zadania, obecność
  zostają). Konto, które jest albo było w grupie, nie łączy się z profilem (`invite_child_account`). Zasady dziecka
  z kontem: tylko odhacza (D34; od audytu 3 dopisuje też produkty do list zakupów — niżej), obecność za siebie, nie wychodzi samo z grupy (`forbidden:child`), rolę osób z kontem
  (admin / członek / dziecko) zmienia tylko owner (admin: `forbidden:role`); w Moich sprawach, przypomnieniach,
  Kalendarzu i na liście wydarzeń grupy — tylko swoje sprawy (przypisane do niego, ich podzadania, zadania przy
  wydarzeniach, które go dotyczą) i wydarzenia, w których uczestniczy (albo całej grupy); zakupy grupy widzi bez pola
  odhaczenia; swoje lekcje — jednym wierszem bez przypomnień (D127). Listy grupy otwiera jak dotąd, ale odhacza
  (i cofa odhaczenie) tylko swoje sprawy i pozycje przypisane do niego albo z zakupów, za które odpowiada — serwer
  `forbidden:not_own` (`private.child_owns_task`, migracja `20261008441000_child_check_off.sql`), ekrany bez pola
  odhaczenia przy cudzych (decyzja koordynatora z 8.10.2026, zasada właściciela; odrzucone: odhacza wszystko, D34). Migracja
  `20261008440000_child_account.sql`, testy `supabase/tests/child_account.test.sql`, `src/domain/views/child.ts`.
  Odrzucone: osobne zaproszenie dziecka (nowy wiersz obok profilu — A), na razie bez kont dzieci (C); ukrywanie cudzych
  spraw przed dzieckiem w RLS (zmiana widoczności przy każdej zmianie roli — wymagałaby sygnału nowego zakresu jak D139;
  dziś to reguła widoków).

## Decyzje właściciela po audycie 2 (8.10.2026) — listy i zakupy
| Pytanie | Decyzja | Odrzucone |
|---|---|---|
| PW-15. Okno „Do koszyka?” przy każdej pozycji (zmiana D59) | A: do koszyka bez pytania, z paskiem „Cofnij” | Zostaje jak jest; przełącznik w Ustawieniach |
| PW-17. Zarządzanie listą | B: teraz zmiana nazwy listy, edycja pozycji zakupów, oznaczenie „Tylko ja”; „Kto widzi” i „wybrane osoby” po poprawkach synchronizacji | A: od razu pełne „Ustawienia listy” |
| PW-18. Wyjątki od D68 | A: lista „Tylko ja” poza regułą; b: „kiedyś, ktokolwiek” dozwolone z dopiskiem | B: D68 także na liście prywatnej; (a) zakaz |
| PWD-14. Minione kopie „Tylko tego dnia” (D133) | A: na liście zwinięte („12 razy minęło”, rozwijane) | Same do kosza po N dniach; bez zmian |
| PWD-19. Stałe zakupy a koszyk | A: w koszyku = już na liście; stałe bez ilości | Bez zmian |

Wykonanie (Claude; właściciel może zawetować):
- **Audyt 3 (PK-12) — zmiany D155 (decyzje Q6 a, b, d; Q14):**
  - *Q6a A (N-43):* zadania dziecka z kontem są w Moich sprawach, przypomnieniach i podsumowaniach dorosłych grupy jak
    zadania profilu bez konta (z imieniem dziecka, w zakresie „Wszystko”) — połączenie z kontem nic rodzicom nie zabiera,
    tak jak dotąd wydarzenia i lekcje dziecka (`concernsMeTask`). Odrzucone: tylko dziecko (B), zakres per dziecko (C, później).
  - *Q6b A (N-42):* rolę „Dziecko” dostaje tylko konto połączone kodem profilu dziecka — serwer zapisuje chwilę
    połączenia (`group_members.child_linked_at`, ustawia ją wyłącznie wyzwalacz `group_members_t_child_link`), a zmianę
    innego konta na dziecko odrzuca (`forbidden:role`); telefon chowa wtedy wybór „Dziecko” (`childRoleAllowed`) i mówi
    dlaczego. Połączone dziecko, które „dorosło” do członka, może wrócić do roli dziecka. Zmiana roli ma pasek „Cofnij”.
    Migracja `20261010120000_child_role_shopping.sql`. Odrzucone: konto, które dołączyło samo, zawsze może wyjść (B);
    ostrzeżenie przy zmianie (C).
  - *Q6d A (N-44):* dziecko z kontem dopisuje produkty do list zakupów, które widzi (pole na liście zakupów, „Na listę: …”
    w Moich sprawach, „#Grupa produkt”) — tylko pozycję główną bez osoby, terminu, wydarzenia, powtarzania i notatki
    (`tasks_guard`, ta sama migracja); dopisanej pozycji nie zmienia ani nie usuwa (D34). „#Grupa”, w której jestem
    dzieckiem, nie daje już nieprawdziwego „Nie ma grupy” — panel mówi, że spraw tam nie dodaję, i proponuje listę zakupów.
  - *Q14 A+B (N-45):* nowo utworzona albo dołączona grupa zostaje „ostatnio użytą” (chip „Do: …” w Moich sprawach);
    gdy grupa z chipa nie ma listy zakupów, podpowiedź „Na listę” bierze listę innej grupy (ostatnio użytej, potem
    w kolejności ekranu Grupy) z jej nazwą w nawiasie. Grupa wskazana tekstem („#…”) zostaje.
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

## Audyt 2 — odporność synchronizacji na telefonie (paczka P2, 8.10.2026)
Decyzje techniczne (Claude; właściciel może zawetować):
- **Telefon odtworzony z kopii iCloud (M-8).** Identyfikator instalacji także w pęku kluczy „tylko to urządzenie”
  (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` — nie przechodzi do kopii ani na nowy telefon). Inny niż w bazie → nowy
  identyfikator; niewysłane operacje z kopii idą jeszcze pod starym (`ClientState.legacy`), więc serwer rozpozna te,
  które stary telefon zdążył wysłać („duplicate”), a potwierdzenie starej instalacji sięga najwyżej końca zakresu
  z kopii. Bez zmian na serwerze. Odrzucone: wyłączenie bazy z kopii (gubi niewysłane zmiany); dziennik `op_id` na
  serwerze z kodem `client_reused` (tabela i sprzątanie po stronie serwera; zakres z kopii daje to samo bez nich);
  przenumerowanie kolejki pod nowym identyfikatorem (stara zmiana wysłana drugi raz nadpisałaby nowsze zmiany innych).
  Pierwsze uruchomienie buildu z tym mechanizmem nadaje każdemu telefonowi nowy identyfikator — bez szkody.
  Do sprawdzenia na urządzeniu: że plik bazy (Documents/SQLite) wraca z kopii, a wpis pęku kluczy nie.
- **Grupa pobierana w całości (resync, pobranie od zera).** Porcje czekają w `staged_rows` (lokalna migracja v6),
  ekran widzi dotychczasowe wiersze grupy do ostatniej porcji, potem podmiana w jednym przejściu stanu; przerwane
  pobranie wznawia się od kursora. Lustro kalendarza (M-5) widzi do końca stare wiersze. Potwierdzone operacje schodzą
  z kolejki dopiero po ostatniej porcji (zmiana nie „miga”). Odrzucone: czyszczenie grupy przed pierwszą porcją (duża
  grupa znikała ze wszystkich ekranów na czas pobierania). Nowa grupa (bez starych wierszy) też pojawia się w komplecie.
- **Nieudane pobranie udostępnionej listy (M-53).** `scopesToFetch`: lista zostaje „do pobrania” do udanego
  sync_fetch_scope, także po restarcie. Odrzucone: dopisywanie do `scopes` po pobraniu (utrata dostępu przed pobraniem
  nie czyściłaby wtedy wierszy tej listy, które przyszły zwykłym pobraniem).
- **Sieć (M-10).** `@react-native-community/netinfo` (wersja z Expo SDK 57, moduł natywny — wymaga nowego buildu):
  zdarzenie `network`; stan nieznany = sieć. Błąd sieci wstrzymuje wysyłkę i pobranie naraz. Czyszczenie danych
  zablokowane także po nieudanym żądaniu (captive portal). Odrzucone: wariant bez zależności (brak wyzwalacza
  „sieć wróciła”, zostaje czekanie do 60 s).
- **Wygasła sesja (M-9).** Po 401 jedna prośba o odświeżenie tokenu (`refreshSession`); nowy token tego samego konta
  (onAuthStateChange) wznawia pętlę; powrót do aplikacji próbuje raz. Wskaźnik tylko informuje (PW-28) — gdy sesji nie
  da się odświeżyć, Ustawienia pokazują „Zaloguj się ponownie” (wylogowanie tylko na tym telefonie, baza konta
  z kolejką zostaje).
- **Pozostałe.** „Wyczyść dane” w trakcie żądania: wynik po `stop()` przepada (M-55). „Cofnij” pola, którego wiersz
  utworzony na telefonie jeszcze nie ma, wpisuje wartość domyślną kolumny z `config.sync.PATCH_DEFAULTS` (test
  kontraktowy z bazą, M-59). Lokalne usunięcie i przywrócenie kaskadują jak `tasks_cascade`/`lists_cascade`, znacznik
  `pending:<numer operacji>` (M-60). Zapis stanu porównuje referencje zamiast serializacji (M-61). Baza z nowszej wersji
  aplikacji: ekran z wyjaśnieniem i „Wyczyść i pobierz od nowa” (zostają dane `local:*`, M-177). Odświeżenie po
  operacji serwerowej omija przerwę po błędzie (M-178). Cofnięcie zegara przesuwa terminy pętli o ten sam odcinek
  (M-179). Generator kopii stałych zadań serii nie ponawia utworzenia odrzuconego przez serwer.

## Decyzje właściciela po audycie 2 (8.10.2026) — retencja i limity serwera (paczka P16)
| Pytanie | Decyzja | Odrzucone |
|---|---|---|
| PW-42 (M-67). Usunięte wydarzenie z przypiętymi zadaniami | A (D182): po 30 dniach w koszu zadania tracą przypięcie (dzień terminu jako własny termin), wydarzenie znika | Wyczyścić treść i zostawić wiersz; poprawić politykę |
| PW-44 (M-70). Nadużycia jednego konta | A (D183): twarde limity w bazie, liczby w `src/config` (`quotas`) | Tylko monitoring |
| PW-47 (M-62). Historia zmian | A (D184): 90 dni na serwerze i na telefonach (`retention.ACTIVITY_DAYS`) | Historia na żądanie |

Wykonanie (Claude; właściciel może zawetować):
- **D182.** Zadanie „jak spotkanie” dostaje datę terminu (po przeniesieniu wyjątkiem — datę po przeniesieniu), bez godziny;
  zadanie z własnym terminem traci tylko przypięcie; kopie stałych zadań tracą wskazanie definicji. Zmiana idzie do telefonów
  jak każda inna (nowa wersja wiersza); w historii zadania wpis bez autora („Ktoś”). Odrzucone: termin z godziną wydarzenia
  (godzina wydarzenia nie była terminem zadania).
- **D183 — liczby** (wybory projektowe, uzasadnienie w `src/config/index.ts`): 50 grup wspólnych na konto (także w koszu;
  ponad limit tworzenie i dołączanie kończą się komunikatem, dołączanie nie liczy się jako nieudana próba kodu), 20 aktywnych
  zaproszeń na grupę, 10 tokenów push i 20 instalacji na konto (nadmiarowy najdawniej używany wypada — bez błędu),
  120 wywołań `sync_push` na minutę (ponad limit telefon ponawia z opóźnieniem), 120 próśb o powiadomienie na godzinę
  (ponad limit powiadomienie nie idzie). Odrzucone: limit liczby zadań i list na grupę (zwykłe użycie trudno oszacować,
  a limity wyżej już ograniczają tempo zapisów); limit Realtime osobno (sygnał idzie tylko po udanym `sync_push`).
- **D184.** Telefon usuwa u siebie historię i rozstrzygnięte przekazania w tych samych terminach co serwer (przy każdym
  pobraniu); ekran zadania mówi „Zmiany z ostatnich 90 dni.”.
- **Sprzątanie (M-66, M-194).** Procedura z COMMIT po każdej grupie, tylko grupy z czymś do zrobienia; dziennik
  `private.maintenance_runs`, problemy jako wpis diagnostyczny w `client_errors`. Odrzucone: limit grup na dobę z kursorem
  (kosz mógłby się opóźniać).
- **Instalacje (M-68).** Licznik instalacji nieużywanej 180 dni znika razem z jej odrzuceniami. Instalacja, która wróci
  później, zaczyna licznik od nowa: niepotwierdzone zmiany z jej kolejki serwer przyjmie jak zmiany po powrocie z trybu
  offline; jedyny skutek uboczny to powtórzenie zmiany, której potwierdzenie zginęło w sieci pół roku wcześniej.
  Odrzucone: kod `client_unknown` i czyszczenie kolejki na telefonie (traci zmiany zrobione offline tuż przed powrotem).
- **Dziennik dostępu (M-68).** `private.access_events` 30 dni. Odrzucone na teraz: zatrzymanie zapisu (testy kilku paczek
  sprawdzają wpisy).
