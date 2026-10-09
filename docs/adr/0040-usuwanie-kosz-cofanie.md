# 0040. Usuwanie, kosz i cofanie (audyt 2, 8.10.2026)

Decyzje właściciela (koordynator przekazał 8.10.2026); wykonanie i decyzje techniczne — Claude, właściciel może je
zawetować.

| ID | Sprawa (audyt) | Decyzja | Odrzucone |
|---|---|---|---|
| D151 | Kosz (PW-4 A, M-34) | Sekcja „Kosz” na ekranie Grupy: obok grup także listy, zadania, pozycje zakupów, wydarzenia i osoby z ostatnich 30 dni (tyle serwer trzyma usunięte, `config.sync.TOMBSTONE_DAYS`), w sekcjach według rodzaju, każda z „Przywróć” | Dłuższy pasek „Cofnij” bez kosza |
| D187 | Kiedy pytać przy usuwaniu (PW-16 A, M-121) | Bez „Na pewno?” — zawsze pasek „Cofnij” i kosz. Pytanie tylko przy rzeczach nieodwracalnych (usunięcie konta, wyjście z grupy, przekazanie własności, zmiana ID grupy, unieważnienie kodu) i przy liście z zadaniami („Usunąć listę „Dom” i 23 zadania?”). Wspólną listę usuwa każdy dorosły | Pytanie przy wszystkim, co dotyczy innych; usuwanie listy tylko przez autora albo admina |
| D189 | Pasek po dodaniu (PW-29 A, M-126) | Po utworzeniu z formularza „Dodano … · Cofnij”; po szybkim dodaniu „Dodano … · Zmień” (D90); „Zmień” przy wydarzeniu otwiera od razu edycję | „Zmień · Cofnij” w jednym pasku |
| D190 | Odrzucone zmiany (PW-30 A, M-137) | Jednorazowy pasek „Serwer nie przyjął N zmian — Zobacz”, nazwy rzeczy na liście, „Wyczyść listę” | Bez powiadamiania |
| D194 | Cofanie przy VoiceOverze (PW-10 C+A, M-38) | Lista „Ostatnie zmiany” z „Cofnij” bez limitu czasu i sprawdzeniem, czy rzecz się nie zmieniła, zapisana w bazie konta (b, koordynator 8.10.2026); przy VoiceOverze pasek nie znika sam, dostaje fokus i ma „Zamknij” | Dłuższy pasek dla wszystkich (60 s) |

## Wykonanie

- **Kosz (D151, `src/domain/views/trash.ts`, `src/features/groups/TrashSection.tsx`).** Widać tylko to, co mogę
  przywrócić: dziecko nic (D34), osoby — jak przy usuwaniu (`removedMembers`, D165). Zadanie z usuniętej listy albo pod
  usuniętym rodzicem nie stoi osobno — wraca z listą albo rodzicem (wyzwalacze `lists_cascade`, `tasks_cascade`), a samo
  byłoby odrzucone. Lista mówi, z iloma zadaniami (pozycjami) wróci. W sekcji najnowsze `config.TRASH_PREVIEW` (5), dalej
  „Pokaż wszystkie (N)”. Przywrócenie listy, zadania, wydarzenia i osoby to zwykła zmiana (działa bez internetu, prawa
  sprawdza serwer — odrzuconą pokaże D190), grupy — RPC jak dotąd (D54). Po przywróceniu „Przywrócono: … · Cofnij”.
  Odrzucone: osobny ekran kosza (decyzja mówi o sekcji na ekranie Grupy; podgląd 5 wpisów trzyma ekran krótkim).
- **Usuwanie (D187).** Wydarzenie jednorazowe — bez pytania (wcześniej „Usunąć to wydarzenie u wszystkich?”); grupa —
  bez pytania, z „Cofnij” (przywrócenie przez serwer, więc wymaga internetu); od audytu 3 (N-156, decyzja Q19 A) grupa,
  w której są inni, najpierw pyta oknem systemowym z liczbą pozostałych osób („Usunąć grupę „Rodzina” także dla
  pozostałych osób (3)?”), bo zabiera grupę także im — ten sam kod z przycisku i z przesunięcia
  (`src/features/groups/delete-group.ts`); osoba — bez pytania (D165); stała pozycja
  zakupów — z „Cofnij” (wraca poleceniem `staple_add`, na koniec listy stałych); „Usuń zadanie” na ekranie zadania —
  pasek „Cofnij” i powrót, jak przesunięcie (M-254). Pytanie przy liście z zadaniami to okno systemowe (to samo z ekranu
  listy i z przesunięcia wiersza); pusta lista — bez pytania. Unieważnienie kodu zaproszenia pyta, bo serwer nie umie
  go przywrócić (a „Nowy kod” daje inny kod) — to rzecz nieodwracalna w rozumieniu D187; od audytu 3 (N-153, Q32 A)
  oknem systemowym jak „Zmień ID grupy” (wcześniej panel w karcie kodu). Przekazanie własności zostaje panelem (dłuższe
  wyjaśnienie). Zmiana roli osoby — bez pytania, z paskiem „Cofnij” (audyt 3, Q6b A).
- **Przesuwanie (M-124, M-239, M-249).** Ten sam wiersz przesuwa się tak samo wszędzie: zadania (także zrobione, także
  w Moich sprawach), podzadania na ekranie zadania, zadania terminu na ekranie wydarzenia, listy (Listy, ekran grupy),
  osoby (ekran grupy, z prawami jak na ekranie osoby), grupy (lista grup, tylko właściciel grupy wspólnej), wydarzenia
  (Moje sprawy, Kalendarz, ekran grupy). Wiersz terminu: jednorazowe „Usuń”, termin serii „Odwołaj” (tylko ten termin,
  D57); wiersz serii na ekranie grupy usuwa całą serię. Termin z podpiętymi zadaniami otwiera ekran wydarzenia z pytaniem
  D14. Otwarty jest najwyżej jeden wiersz na ekranie; przewinięcie ekranu go zamyka, dotknięcie przycisku też.
  Dziecko niczego nie przesuwa (D34). Zakupy w Moich sprawach i Kalendarzu (wiersz „Zakupy: …”) się nie przesuwają —
  to lista, nie sprawa do zrobienia.
- **Czerwone przyciski (M-241).** Czerwony jest przycisk, który usuwa albo unieważnia, w obu krokach (otwarcie
  i potwierdzenie): także „Wyloguj”, „Wyczyść dane na telefonie”, „Zmień ID grupy”, „Usuń krok / lekcję / termin”
  w formularzach.
- **Paski po dodaniu (D189, `src/app/added.ts`).** Formularz zadania, wydarzenia i listy — „Dodano … · Cofnij” (cofnięcie
  usuwa utworzone, także listę, jeśli powstała przy okazji). Szybkie dodanie na liście zadań — „Dodano … ·
  Zmień” jak w Moich sprawach; na liście zakupów bez paska (pozycje dodaje się seriami, a dotknięcie pozycji ją edytuje).
  Nowa grupa — bez paska (powstaje na serwerze; usunąć ją można przesunięciem albo na jej ekranie).
- **Odrzucone zmiany (D190, `src/app/UndoLinks.tsx`).** Pasek pokazuje się raz na nowe odrzucenia (te sprzed uruchomienia
  aplikacji widać na liście). Nazwa rzeczy przy zmianie, usunięciu i przywróceniu bierze się z danych na telefonie.
  „Wyczyść listę” usuwa wpisy także z bazy telefonu (`clearRejected`, `rejected_ops`).
- **Ostatnie zmiany (D194, `src/ui/undo.tsx`, `src/domain/views/recent.ts`).** Każdy pasek „Cofnij” jest też wpisem
  listy (najwyżej `config.RECENT_MAX` = 30). Decyzja koordynatora z 8.10.2026 (D194 b): lista jest w bazie konta
  (`local:recent.changes`) i przeżywa ponowne uruchomienie. Cofnięcie zapisujemy jako operacje — stałe albo według
  przepisu liczone w chwili cofnięcia (rutyna: `routineUndoOps`, z kopiami kroków dołożonymi w międzyczasie); hurtowe
  odhaczenie z podzadaniami liczy cofnięcie zaraz po zmianie. Cofnięcia, których nie da się zapisać, po ponownym
  uruchomieniu zostają w historii z wyjaśnieniem: grupa (usunięcie i przywrócenie idą przez serwer — wskazanie na Kosz)
  i plan lekcji (cofnięcie liczone z całego planu w chwili cofnięcia). Paski „Zmień” i „Zobacz” to nie zmiany — nie
  trafiają na listę. Przed cofnięciem (z listy i z paska) porównujemy pola, które zmiana ustawiła, i to, czy rzecz istnieje,
  z chwilą zaraz po zmianie (odcisk też jest w zapisie); inna wartość = ktoś (albo ja) zmienił to od tamtej pory — nie
  cofamy i mówimy dlaczego. Porównanie zna zapis serwera (godzina z sekundami, znacznik czasu w innej strefie). Wejście:
  „Ostatnie zmiany” na ekranie Grupy i treść paska (strzałka „›”). Uszkodzony zapis — pusta lista (to wygoda, nie dane).
- **VoiceOver (D194).** Pasek przy włączonym czytniku nie znika sam, dostaje fokus (`AccessibilityInfo
  .sendAccessibilityEvent(…, 'focus')`, React Native 0.86) i ma „Zamknij”; `accessibilityLiveRegion` działa tylko na
  Androidzie. Do sprawdzenia na iPhonie: czy VoiceOver czyta treść paska od razu po przeniesieniu fokusu.
