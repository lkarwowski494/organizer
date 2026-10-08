# 0019. „Moje sprawy”, szybkie i pełne dodawanie, „@imię” (8.10.2026)

Zgłoszenie właściciela:
- Napis „Dotyczy mnie” ma być zastąpiony.
- Potrzebne są dwa sposoby dodawania: szybkie oraz pełny arkusz parametrów.
- Przykład: wpisał „basen jutro 19.00”. Zadanie trafiło do grupy osobistej i nie dało się go przestawić na grupę rodzinną z żoną jako osobą odpowiedzialną.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D89 | Nazwa głównego ekranu | „Moje sprawy” | „Lista zadań” (myli się z zakładką „Listy”, a na ekranie są też wydarzenia); „Mój plan” |
| D90 | Szybkie i pełne dodawanie | Dwa przyciski: „+” dodaje od razu, „Więcej” otwiera pełny formularz wypełniony wpisanym tekstem. Po szybkim dodaniu pasek „Dodano … · Zmień” otwiera ten sam formularz. | Jedno pole z rozwijanym formularzem; tylko edycja po dodaniu |
| D91 | Mądrzejsze szybkie dodanie | „@imię” ustawia grupę i osobę. Przy kilku dopasowaniach aplikacja pyta, kogo chodzi. | Tylko formularz; ostatnio użyta grupa |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Zmiana nazwy:**
   - Zmienione teksty w aplikacji, z odmianą („w „Moich sprawach””), komentarze, testy, README, CLAUDE.md i opis TestFlight.
   - Bez zmian zostały wydane migracje i wcześniejsze ADR, bo to zapis historii.
   - Zakładka na dole nadal nazywa się „Dziś”.
2. **Zmiana grupy istniejącego zadania:**
   - Serwer trzyma zadanie w jego grupie (granica bezpieczeństwa, D3). Formularz tworzy więc kopię w nowej grupie (z notatką), a oryginał idzie do kosza, skąd można go przywrócić. Ekran mówi o tym przed zapisem.
   - Zmiana listy w tej samej grupie to zwykłe przeniesienie (`move_task`), więc historia zostaje.
   - Odrzucone: przenoszenie między grupami po stronie serwera. Wymagałoby nowego RPC przenoszącego też historię i podzadania. Do rozważenia, gdy „Zmień” będzie dostępne dla starszych zadań.
3. **„@imię”:**
   - Działa jak początek imienia, bez wielkości liter i polskich znaków, bez odmiany: „@Alę” nie pasuje do „Ala”. (Poprawka 8.10.2026: wcześniej był tu przykład „@Alą”, ale ten pasuje, bo bez polskich znaków ą → a; test w `src/domain/__tests__/mention.test.ts`.)
   - Nie pasuje do mnie samego ani do grup, w których jestem dzieckiem.
   - Bez dopasowania tekst zostaje w nazwie — ale najpierw pytanie „Nie ma @Zosia w Twoich grupach” z „Dodaj bez osoby”
     i „Anuluj” (audyt 2, M-169: wcześniej trafiało po cichu do Osobistych).
   - „Więcej” przy kilku dopasowaniach pyta w formularzu tak samo jak „+”; „@al” zostaje w nazwie, dopóki nie
     wybierzesz osoby (audyt 2, M-170: wcześniej wzmianka znikała bez śladu).
   - Sam termin albo samo „@imię” bez nazwy: pole zostaje, komunikat „Wpisz, co jest do zrobienia.” (audyt 2, M-168).
   - Parser dat (D18, korpus z niezależnym wzorcem) się nie zmienił. „@imię” jest rozpoznawane osobno (`domain/views/mention.ts`) i przed parsowaniem zastępowane spacjami, żeby odklikane fragmenty zachowały pozycje.
4. **Grupa bez listy zadań:** przy pierwszym zadaniu powstaje lista „Zadania” (nazwa projektowa, bez źródła).

## Grupa wpisu: chip, „#Grupa”, „@ja”, grupa domyślna (decyzja właściciela 8.10.2026, PW-3 / audyt 2 M-24)
Problem: każdy wpis z Moich spraw trafiał do Osobistych (chyba że przez „@kogoś-innego”), a zmiana grupy była możliwa
tylko przez „Zmień” w ciągu 6 s, a produktu nie dało się dopisać do listy zakupów. Właściciel wybrał chip, skróty
i grupę domyślną; podpowiedź listy zakupów (wariant D) dołączył koordynator z upoważnienia właściciela (rekomendowana,
odłożona tylko z powodu pracy). Odrzucone: tylko jeden z wariantów. Częściowo zastępuje to „ostatnio użytą grupę”
odrzuconą przy D91.
- **Chip** „Do: <grupa> ▾” pod polem pokazuje, dokąd trafi wpis; dotknięcie rozwija wybór grupy. Gdy grupę wskazuje
  tekst („#Klasa” albo „@Ala” z innej grupy), chip pokazuje ją i jest nieaktywny — zmienia się ją w tekście.
- **Ustawienia → Dodawanie → „Grupa domyślna”**: „Ostatnio użyta” (domyślnie — zmiana chipem albo dodanie z „#Grupa”
  zostaje ostatnio użytą) albo konkretna grupa (chip zawsze od niej startuje; zmiana chipem dotyczy tylko bieżącego
  wpisu). Ustawiona grupa, której już nie ma albo w której jestem dzieckiem, działa jak „Ostatnio użyta”.
  Start liczy `startGroup` (`domain/views/default-group.ts`), a ostatnio użytą zapisuje tylko
  `useDefaultGroup().remember` (`app/default-group.tsx`) — z tego samego mają później startować formularze
  wydarzenia, rutyny i listy (PW-37 / M-118).
- **„#nazwa”** (`domain/views/quick-target.ts`): początek nazwy grupy bez wielkości liter, polskich znaków i spacji
  („#klasa2b” → „Klasa 2b”, osobista jako „#Osobiste”); dokładna nazwa wygrywa z początkiem innej; kilka pasujących —
  pytanie „Którą grupę masz na myśli”; żadna — „Nie ma grupy #kino” z „Dodaj do: <grupa chipa>” („#kino” zostaje
  w nazwie). Grup, w których jestem dzieckiem, nie da się wybrać (D34).
- **„@ja”**: ja jako osoba we wspólnej grupie (w osobistej bez osoby); ma pierwszeństwo przed imionami na „Ja…”
  („@jan” nadal znajduje Jana). **„@imię”**: najpierw osoba z grupy wpisu (z „#” albo z chipa), dopiero bez niej
  wszystkie grupy (D91); po „#” — tylko osoby z tej grupy.
- Wspólna grupa z chipa albo „#” bez osoby i terminu — pytanie „Dla kogo albo na kiedy?” (D68), jak na liście.
- **Podpowiedź „Na listę: <lista>”** (`domain/views/quick-shopping.ts`) obok chipa grupy, gdy cały wpis (po zdjęciu
  rozpoznanego terminu, „#…”, bez osoby i bez zakresu godzin) to jeden produkt ze słownika działów, z ilością albo bez
  („mleko”, „chleb 2 szt.”, „mąka 1.5 kg”, „papier toaletowy”). Nigdy nie przenosi sama: „+” dodaje zadanie, dotknięcie
  podpowiedzi — pozycję na tej liście zakupów grupy wpisu, której ostatnio używano (najwyższa wersja listy albo
  pozycji), z tytułem dosłownym (ilość zostaje, termin nie — termin ma lista, D73). Grupa bez listy zakupów — napis,
  że zostanie zadanie. Bez podpowiedzi dla zdań („kupić mleko dla babci”, „karmić kota”), czasowników i rzeczowników
  odczasownikowych („mopować”, „karmienie” — słownik ma rdzenie z „*”) i dwóch słów, z których tylko jedno jest
  w słowniku („ser żółty”: bezpieczniej przeoczyć produkt, niż zabrać zadanie).
- „Więcej” otwiera formularz w grupie z chipa (albo z tekstu); te same skróty działają w formularzu.

Decyzje wykonawcze (Claude; właściciel może zawetować):
- Ustawienie i ostatnio użyta grupa tylko na tym telefonie (lokalna baza, klucze `local:*`, jak stan lustra
  kalendarza). Odrzucone: zapis na koncie (synchronizacja) — to wygoda jednego telefonu, a nie dane grupy.
- Dotknięcie chipa rozwija wybór (zmiana = dwa dotknięcia). Odrzucone: przełączanie po kolei jednym dotknięciem —
  przy trzech i więcej grupach łatwo przeskoczyć i nie widać, co będzie dalej.
- Przy jednej grupie chipa nie ma (nie ma czego wybierać). Ustawienia mają piątą podstronę „Dodawanie” (D131).
- „@imię” osoby z innej grupy niż chip zmienia grupę tego wpisu, ale nie zostaje ostatnio użytą — właściciel wymienił
  tylko chip i „#Grupa”. „@mnie” nie jest skrótem (wskazany był „@ja”).
