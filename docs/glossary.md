# Słownik i konwencje tekstów (audyt 2, 8.10.2026)

Jedno pojęcie — jedno słowo. Teksty mieszkają w `src/i18n/strings.pl.ts` (D30); nazwy, których potrzebuje domena, w
`src/config/*.pl.ts` (np. `names.pl.ts`, `calendar.pl.ts`), skąd bierze je też `strings.pl.ts`. Część reguł pilnuje
test `src/app/__tests__/texts.test.ts` (płeć, cudzysłów przy nazwach ekranów, półpauza, ścieżki „A → B”, nieużywane klucze).

## Słownik

| Pojęcie | Słowo w aplikacji | Nie używamy | Przykład |
|---|---|---|---|
| Rzecz w kalendarzu z dniem (i godziną) | **wydarzenie** | spotkanie | „Nowe wydarzenie”, „Usuń wydarzenie” |
| Jeden dzień wydarzenia cyklicznego | **termin** | wystąpienie, „to wydarzenie” | „Tylko ten termin”, „Ten termin jest odwołany.” |
| Kiedy coś ma się stać (zadanie, termin wydarzenia) | **termin** | — | „Termin”, „Bez terminu”, „Przenieś zaległe” |
| Wszystkie terminy wydarzenia cyklicznego | **seria** | „wszystkie w serii”, „serie wydarzeń” w komunikatach | „Całą serię”, „Usuń całą serię”, „Usunięto serię: Tańce” |
| Zakres zmiany terminu serii | **Tylko ten termin / Ten i następne / Całą serię** | „Tylko to wydarzenie”, „To i następne”, „Wszystkie w serii” | pytania „Co zmienić?”, „Co odwołać?”, „Co przekazać?” |
| Odwołanie całej serii | **Usuń całą serię** (wydarzenie idzie do kosza) | „Odwołaj → Wszystkie w serii” | |
| Dni i godzina w formularzu, z których powstaje osobna seria | **wariant** | „Termin 2”, „Usuń termin 2” | „Wariant 2”, „Dodaj wariant (inne dni albo godzina)” |
| Ile razy z rzędu wszystko zrobione (rutyna, zadanie powtarzane) | **N razy z rzędu** | „seria: N z rzędu” | „3 razy z rzędu” |
| Zadanie przy wydarzeniu | **podpięte** (Podepnij / Odepnij / Przepnij) | przypięte | „1 zadanie jest podpięte do odwoływanych terminów” |
| Zadanie bez terminu w Moich sprawach | **Przypięte** | podpięte | sekcja „Przypięte” |
| Osoba od zadania i zakupów (w wierszu) | **dla Ciebie / dla: Ala** | „robi: Ala” | zadanie i zakupy tym samym wzorem |
| Osoba od wydarzenia (w wierszu) | **Ty odpowiadasz / odpowiada: Ala** | „odpowiadasz Ty” | |
| Brak osoby | **Nikt konkretny** (w zdaniu: „nikt konkretny”) | ktokolwiek | „dziś · nikt konkretny” |
| Ja na listach osób | **Ty**, przy imieniu **(Ty)** | samo imię | „Łukasz (Ty)”, „Osoba odpowiedzialna: Ty” |
| Role | **właściciel, administrator, członek, dziecko** | admin | opcje wyboru wielką literą: „Administrator / Członek / Dziecko” |
| Wycofanie wysłanego przekazania | **Wycofaj przekazanie** | „Anuluj przekazanie” („Anuluj” tylko zamyka panel) | |
| Przekazanie | **Przekaż zadanie / Przekaż zakupy / Przekaż wydarzenie** | samo „Przekaż” | |
| Zmiana istniejącej rzeczy | **Zmień** | Edytuj | „Zmień stałe”, „Zmień wydarzenie” |
| Zapis formularza | **Zapisz + rzecz** | samo „Zapisz” | „Zapisz zadanie”, „Zapisz wydarzenie”, „Zapisz imię” |
| Zamknięcie panelu, w którym wybór zapisał się od razu | **Gotowe** | Anuluj | panel pozycji zakupów, stałe zakupy |
| Komunikat po dodaniu | **Dodano + rodzaj: tytuł · gdzie** | „Dodano: X” | „Dodano zadanie: Basen · Rodzina”, „Dodano produkt: mleko · Zakupy” |
| Głos aplikacji | **my** | ja | „Synchronizujemy…”, „Pobieramy grupę…”, „spróbujemy ponownie” |
| Etykiety pól | **bezosobowo** | głos użytkownika („Zwykle jadę”, „Liczę”) | „Domyślny dojazd”, „Jednostka” |

## Konwencje zapisu

| Reguła | Źródło (przeczytane 8.10.2026) |
|---|---|
| Aplikacja nie zakłada płci użytkownika: formy neutralne („Masz…”, „konto zostaje zalogowane”, „Na razie bez grupy wspólnej”), bez „-łeś/-łaś”, „sam(a)”. | Poradnia PWN, M. Bańko, „Pan, Pani, Państwo” (https://sjp.pwn.pl/poradnia/haslo/;13906.html): „natłok ukośników czy też nawiasów nie robi dobrego wrażenia […] (najlepiej byłoby użyć formy neutralnej płciowo)”; tamże o formach 2. osoby w tekstach dla dorosłych: „Powtórz wolno za lektorem…”. |
| Myślnik w zdaniu: pauza „—” ze spacjami (22 teksty już tak). Półpauza „–” bez spacji tylko w zakresach („17:00–18:00”). Wyjątek: nazwa kalendarza w iPhonie „Organizer – nazwa grupy” — identyfikator lustra (D172), cytowany dosłownie. | Zasady pisowni PWN, 93. Myślnik (https://sjp.pwn.pl/zasady/93-myślnik;629819.html): „Myślnik (—) bywa często w druku zastępowany półpauzą (–)”; [408] 93.12 (https://sjp.pwn.pl/zasady/408-93-12-myślnik-wyznaczający-relacje-między-dwoma-wyrazami-lub-wartościami;629831.html): „W druku liczby arabskie oznaczające przedział od — do rozdziela się półpauzą […] niemającą po bokach odstępów, np. 1914–1918. Półpauza używana w funkcji myślnika ma po bokach spacje.” |
| Cudzysłów „…” (apostrofowy). Nazwa ekranu albo zakładki sama — bez cudzysłowu, wielką literą („w Moich sprawach”, „w Kalendarzu”); po określeniu rodzajowym — w cudzysłowie („ekran „Moje sprawy””, „lista „Zakupy””); cytowane etykiety przycisków — w cudzysłowie („„Dołącz do grupy””). | Zasady pisowni PWN, 98. Cudzysłów (https://sjp.pwn.pl/zasady/98-cudzysłów;629866.html): „W druku i w rękopisach używa się najczęściej cudzysłowu o postaci: „ ” […] w publikacjach jednak wskazane jest użycie tego pierwszego”; [446] 98.C.3 (https://sjp.pwn.pl/zasady/446-98-c-3-cudzysłowu-możemy-używać-do-wyodrębniania;629878.html): cudzysłowem wyodrębnia się „c) nazw występujących po pisanym małą literą określeniu rodzajowym, np. hala widowiskowo-sportowa „Spodek”, schronisko PTTK „Murowaniec””. |
| Apostrof typograficzny „’” („iPhone’a”), nie „'”. | Jak wyżej, 98: symbol „"” jest „niepoprawny z punktu widzenia typograficznego”; ta sama zasada dla apostrofu — decyzja audytu (U-34), jeden znak w całej aplikacji. |
| Godzina zawsze z zerem: „07:30”. | CLDR pl, wzorzec `HH:mm` (src/config/calendar.pl.ts, U-52). |
| Data w środku zdania małą literą („Przeniesione z: środa, 7 października”), na początku — wielką (`formatDateInline` / `formatLongDate`). | Zasady pisowni PWN: nazwy dni tygodnia i miesięcy piszemy małą literą (wielka tylko na początku zdania). Brak przeczytanego paragrafu z numerem — **otwarte pytanie** o cytat; reguła zgodna z CLDR pl (`EEEE, d MMMM`, małe litery). |
| Wielka litera: przyciski, opcje wyboru, nagłówki i etykiety pól zaczynają się wielką literą (dalej małymi); podpisy w wierszach (np. „dla: Ala”, „administrator”) — małą. Jeden styl na rodzaj elementu. | Apple HIG, Writing (https://developer.apple.com/design/human-interface-guidelines/writing): „Adopt capitalization rules that align with your app’s style, then apply them consistently. […] Choose a style for each UI element type and use it consistently throughout your app”; „When labeling buttons and links, it’s almost always best to use a verb.” |
| Instrukcja „gdzie włączyć w iPhonie”: „Włączysz to w Ustawieniach iPhone’a → Organizer → X.” | Decyzja audytu (U-47), jeden wzór. |
