# 01. Przepływy użytkownika i nawigacja (audyt UX, 12.10.2026)

Rola: Projektant UX (audyt przepływów) i Analityk produktu. Zlecenie właściciela „po buildzie 24”. Stan kodu: gałąź `main`
w chwili audytu (commit `48a2cfe`). Nic w kodzie nie zmieniono — to jest wyłącznie opis i propozycja.

**Skąd wiem.** Każdy przepływ sprawdziłem w kodzie: `src/app/navigation.tsx` i `routes.ts` (trasy, linki), ekrany
w `src/features/*`, teksty w `src/i18n/strings.pl.ts`, scenariusze `.maestro/*.yaml`, `src/app/__tests__/*` (testy ekranów)
i decyzje w `docs/adr/`. Aplikacji nie uruchamiałem na telefonie ani symulatorze — „udokumentowane ≠ zaimplementowane”,
więc liczby stuknięć to odczyt z kodu, nie pomiar. Gdzie czegoś nie sprawdziłem, piszę to wprost.

**Jak liczę stuknięcia.** Start: aplikacja otwarta na zakładce Moje sprawy, ekran na górze. Liczę dotknięcia
przycisków, wierszy, zakładek i przełączników, jedno przesunięcie wiersza (gest) jako 1 i okno systemowe jako 1.
Nie liczę wpisywania tekstu. **+P** = trzeba przewinąć (zwykle przy dużym tekście; przy AX5 często kilka ekranów — tak
mówią komentarze w scenariuszach E2E, np. `04-event-form.yaml`, `07-keyboard.yaml`).

**Częstość** to moje założenie (codziennie / kilka razy w tygodniu / rzadko / raz), nie dane: aplikacja nie zbiera
statystyk użycia (D80 — tylko błędy i uwagi). Patrz [DO WYJAŚNIENIA] 1.

## Skrót dla właściciela

1. Codzienne rzeczy są krótkie: odhaczenie to 1 stuknięcie, dodanie zadania, wydarzenia albo produktu z pola
   w Moich sprawach — 2, przyjęcie przekazania — 1. Tu nie ma czego skracać.
2. Najwięcej kłopotu jest w miejscach planowania i zarządzania. „Dodaj wydarzenie” i „Dodaj rutynę” stoją na samym
   dole Kalendarza i ekranu grupy, pod listą dnia (przy dużym tekście za paskiem zakładek). Z Kalendarza nie da się
   dodać zadania na wybrany dzień.
3. Ekran grupy ma kilkanaście sekcji jedna pod drugą: osoby, zaproszenia, dzieci, nazwa, kolor, listy, wydarzenia,
   plany lekcji, wyjście, usunięcie. Rzadkie ustawienia mieszają się z treścią.
4. Kilka napisów obiecuje co innego, niż robi przycisk. Podpowiedź „Więcej” mówi o wyborze listy, którego w formularzu
   nie ma (D97). „Zaplanuj zakupy” na karcie „Następne kroki” tylko otwiera listę. Ta sama rzecz ma kilka nazw:
   „Nowa lista zakupów” / „Utwórz listę zakupów”, „Zaproś jako administratora” / „Zaproś partnera (administrator)”.
5. Ślepy zaułek: odwołany termin serii znika z Kalendarza i Moich spraw. Przywrócić go można tylko z „Ostatnich zmian”
   na telefonie osoby, która go odwołała. Inny dorosły w grupie nie ma do niego drogi.
6. Rekomenduję wariant B: te same cztery zakładki, dodawanie na górze ekranów, osobna podstrona „Ustawienia grupy”
   i Kosz jako osobny ekran. Wdrożenie w 6 małych krokach, każdy do osobnego sprawdzenia i wydania. Tekstów
   w zaproszeniach, które ludzie już dostali („Grupy → „Dołącz do grupy””), nic nie unieważnia.
7. Pytania do Ciebie są na końcu (Q1–Q8), każde z opcjami i rekomendacją.

---

## Krok 1. Przepływy

### 1.0 Stany wspólne (sprawdzone w kodzie, żeby nie powtarzać ich w każdym wierszu)

| Stan | Jak działa dziś | Skąd |
|---|---|---|
| Pierwszy raz | Imię (konto bez imienia, D100) → Wprowadzenie (D79) → wybór startu. Na Moich sprawach karta „Przypomnienia i powiadomienia” (do zgody albo „Nie teraz”), na Kalendarzu karta połączenia z kalendarzem iPhone’a, po aktualizacji karta „Co nowego”, w nowej grupie karta „Następne kroki”. | `TodayScreen.tsx` (efekt z `WELCOME_SEEN`, `NAME_ASKED`), `PushPrompt.tsx`, `DeviceCalendarCard.tsx`, `WhatsNew.tsx`, `GroupScreen.tsx` |
| Pusto | Moje sprawy: „Na dziś nic. Dodaj coś polem powyżej…” (dzień) / „Brak spraw w tym okresie.”. Listy: „Nie masz jeszcze list. Zacznij od listy zakupów…”. Kalendarz: „Tego dnia nic nie ma.”. Grupa: „Brak list…”, „Brak wydarzeń…”. Lista: „Lista jest pusta…”. | `strings.pl.ts` (`today.empty`, `lists.empty`, `calendar.empty`, `groups.noLists`, `lists.emptyItems`) |
| Offline | Zmiany zapisują się na telefonie i czekają w kolejce. Pasek pokazuje „Offline · N zmian czeka”, a VoiceOver to ogłasza. **Bez serwera nie działa:** nowa grupa, dołączanie, kody zaproszeń (nowy, unieważnienie, zmiana ID), przywrócenie grupy z Kosza, „Wyślij uwagę”, usunięcie konta, wyciszenia (ładują się z serwera) i „Wyczyść dane na telefonie” (zablokowane). | `Root.tsx` (NetInfo, M-10), `SettingsScreen.tsx` (`noServer`), `NewGroupScreen.tsx` („wymaga internetu”), `TrashSection.tsx` (grupa przez RPC), `MuteSettings.tsx` |
| Ciemny wygląd | Jeden motyw dla wszystkich ekranów (`useTheme`, motyw nawigacji z tych samych kolorów). Ustawienie: Ustawienia → Wygląd. E2E robi zrzuty jasne i ciemne nocą. Nie znalazłem przepływu, który działa inaczej w ciemnym. | `navigation.tsx` (`AppNavigation`), `.github/workflows/e2e.yml` (2 × 2 × 2 warianty) |
| Duży tekst / AX5 | Napisy na pasku zakładek mają stałą wielkość, a przytrzymanie zakładki pokazuje nazwę w Large Content Viewer. Treść rośnie, więc przyciski na końcu ekranów (Kalendarz, ekran grupy, Konto i dane) są kilka ekranów niżej. | `navigation.tsx` (`TabBar`), komentarze w `.maestro/04`, `06`, `07`, `08` |
| VoiceOver | Pasek ma cechę paska kart („karta 1 z 4”). Plakietka przekazań jest w etykiecie zakładki. Fokus wraca po zamknięciu paneli (`useA11yFocus`). Zmiany synchronizacji są ogłaszane. Kropki Wprowadzenia czyta jako „Krok N z M”. | `navigation.tsx`, `Root.tsx` (`syncAnnouncer`), `WelcomeScreen.tsx` |
| Dziecko z kontem (rola „dziecko”) | Widzi tylko swoje sprawy i wydarzenia. Nie usuwa (wiersze się nie przesuwają) i nie kończy zakupów. Dopisuje produkty, odpowiada o obecności za siebie. W grupie nie ma zakresu „W Moich sprawach”, „Nowa lista”, „Dodaj wydarzenie”, „Dodaj rutynę” ani planów lekcji. Z grupy nie wychodzi samo. | `GroupScreen.tsx`, `TodayScreen.tsx` (`canDelete`), `ListsScreen.tsx` |
| Dziecko bez konta (profil) | Samo nie używa aplikacji. Dorośli dodają je w grupie, prowadzą plan lekcji, odpowiadają za nie o obecności, przypisują mu zadania (widać je w Moich sprawach dorosłych tylko przy zakresie „Wszystko”, ADR 0038 p. 1). | `RsvpBox.tsx`, `TimetableScreen.tsx`, ADR 0038 |

### 1.1 Pierwsze uruchomienie (S)

| ID | Przepływ i cel | Częstość | Wejście dziś | Kroki (stuknięcia) | Ekrany | Koniec | Stany szczególne |
|---|---|---|---|---|---|---|---|
| S1 | Logowanie — wejść do aplikacji | raz | start bez sesji | przycisk Apple (1) + okno Apple (1–2) = **2–3** | Logowanie | S2 albo Moje sprawy → S3 | Offline: komunikat o internecie. Zamknięte okno Apple to nie błąd. Po usunięciu konta jednorazowo „Konto zostało usunięte.”. Link dotknięty przed zalogowaniem czeka (M-221). |
| S2 | Imię przy starcie — żeby inni wiedzieli, kto to | raz (konto bez imienia) | samo po S1 | pole + „Zapisz imię” (1) albo „Nie teraz” (1) = **1** | „Jak masz na imię?” | Wprowadzenie | Bez gestu cofania (M-242). Zapis idzie do profilu na serwerze i do kolejki; komunikatu bez sieci nie sprawdzałem. |
| S3 | Wprowadzenie — zrozumieć, co robi aplikacja | raz | samo po S1/S2 | „Dalej” ×3 = **3**; „Pomiń” = **1** | Wprowadzenie (3 strony + wybór startu) | wybór startu (S4–S6); kto ma już grupę wspólną — Moje sprawy | VoiceOver: fokus na nagłówek każdej strony (M-44). |
| S4 | Start „Utwórz grupę rodzinną” | raz | wybór startu | przycisk (1) + moje imię + „Utwórz grupę” (1) = **2** (nazwa „Rodzina” podpowiedziana) | Nowa grupa → Grupa | Grupa z kartą „Następne kroki” | Wymaga internetu. Do pierwszego pobrania „Pobieramy grupę…”. |
| S5 | Start „Mam kod zaproszenia” | raz | wybór startu | przycisk (1) + ID i kod albo wklejona wiadomość + imię + „Dołącz” (1) = **2** | Dołącz do grupy → Grupa | Grupa | Wymaga internetu. Grupa od 10 osób: podpowiedź zakresu (D149). |
| S6 | Start „Na razie bez grupy wspólnej” | raz | wybór startu | **1** | — | Moje sprawy, pusto | — |
| S7 | Następne kroki nowej grupy — zaprosić bliskich, dodać dziecko, zaplanować zakupy | raz na grupę | karta na ekranie grupy | zaproszenie: **1** + „Wyślij zaproszenie” (1); „Dodaj dziecko” stawia kursor w polu niżej (+P); „Zaplanuj zakupy” otwiera listę (1), a tam drugi raz „Zaplanuj zakupy” (1) + dzień + osoba + „Zapisz zakupy” (1) = **5**; „Nie teraz” (1) | Grupa, Lista | Grupa / Lista | Kartę widzi tylko ten, kto może zapraszać. |
| S8 | Zgoda na przypomnienia | raz | karta w Moich sprawach | „Włącz powiadomienia” (1) + okno iOS (1) = **2**; „Nie teraz” (1) | Moje sprawy | Moje sprawy | Po „Nie teraz” albo odmowie droga przez Ustawienia → Powiadomienia (U1). |
| S9 | Połączenie z kalendarzem iPhone’a | raz | karta w Kalendarzu | zakładka (1) + „Połącz z kalendarzem” (1) + okno iOS (1) = **3** | Kalendarz | Kalendarz z wydarzeniami z iPhone’a | Odmowa: „Otwórz Ustawienia iPhone’a”. Potem w Ustawieniach → Kalendarz i dojazd. |
| S10 | „Co nowego” po aktualizacji | po każdej aktualizacji | karta w Moich sprawach | „OK” (1) albo „Wyślij uwagę” (1 → U7) | Moje sprawy | Moje sprawy / Twoja uwaga | — |
| S11 | Zaproszenie z linku | rzadko | link w wiadomości | link (1) + [S1] + imię + „Dołącz” (1) = **2** po zalogowaniu | Dołącz do grupy (wypełniony) → Grupa | Grupa; „Wróć” prowadzi na zakładki (N-37) | Wymaga internetu. |
| S12 | Dane z nowszej wersji (powrót do starszego buildu) | wyjątkowo | start | jeden przycisk czyszczący dane (1) | „Dane z nowszej wersji” | aplikacja pobiera wszystko od nowa | Brak drugiego wyjścia (patrz krok 2, problem Z-6). |

### 1.2 Codzienne czynności (C) — minimum stuknięć

| ID | Przepływ i cel | Częstość | Wejście dziś | Kroki (stuknięcia) | Ekrany | Koniec | Stany szczególne |
|---|---|---|---|---|---|---|---|
| C1 | Przegląd dnia — co mam dziś | codziennie | Moje sprawy (domyślna zakładka) | **0** | Moje sprawy | — | AX5: nad treścią są pasek, tytuł, chipy grup, pole, „Więcej”, „Zakres”, pasek okresu i karty (+P). |
| C2 | Odhaczenie zadania / kroku rutyny | codziennie | wiersz | **1** (+1 pytanie o niezrobione podzadania, D154) | Moje sprawy | pasek „Cofnij” | Zrobione — „Zrobione dziś (N)” (H2). |
| C3 | Szybkie dodanie zadania tekstem | codziennie | pole w Moich sprawach | pole (1) + „Dodaj” albo Return (1) = **2**; inna grupa: chip (1) + grupa (1) → **4**, albo „#Rodzina” w tekście → **2** | Moje sprawy | pasek „Dodano zadanie: … · Zmień” | Kilka osób albo grup pasuje — panel z pytaniem (+1). Napis, gdy nikt tego nie zobaczy. |
| C4 | Szybkie dodanie wydarzenia („basen jutro 17–18”) | kilka razy w tygodniu | pole | **2** | Moje sprawy | pasek „Dodano wydarzenie… · Zmień” (otwiera formularz) | Podgląd mówi, że powstanie wydarzenie (M-256). |
| C5 | Produkt na listę zakupów z Moich spraw | kilka razy w tygodniu | pole | pole (1) + chip „Na listę: …” (1) = **2** | Moje sprawy | pasek „Dodano produkt…” (otwiera listę) | Grupa bez listy: lista innej grupy z nazwą albo napis „brak listy”. Dziecko: panel „#Rodzina…” (N-44). |
| C6 | Poprawka zaraz po dodaniu | codziennie | pasek „Cofnij/Zmień” | **1** („Zmień”) | Zadanie / formularz wydarzenia / Lista | — | Pasek znika po `config.UNDO_MS`. |
| C7 | Zmiana terminu zadania | kilka razy w tygodniu | wiersz | wiersz (1) + „Jutro” (1) + „Wróć” (1) = **3** | Zadanie | Moje sprawy | Zmiana dnia serii: pytanie „Tylko ten raz / Też kolejne” (D181, +1). |
| C8 | Usunięcie zadania / terminu z listy | kilka razy w tygodniu | wiersz | przesunięcie (1) + „Usuń”/„Odwołaj” (1) = **2**; cofnięcie +1 | Moje sprawy / Kalendarz | pasek „Usunięto… · Cofnij” | Dziecko: wiersz się nie przesuwa. Przesunięcie ma też akcję VoiceOvera. |
| C9 | Zaległe na dziś | codziennie, gdy są | przycisk nad listą dnia | **1** | Moje sprawy | pasek „Cofnij” | — |
| C10 | Przekazanie — przyjąć albo odrzucić | kilka razy w tygodniu | plakietka na zakładce, karta „Do potwierdzenia” | **1** (Przyjmij / Odrzuć / OK) | Moje sprawy | — | Karta jest pod paskiem okresu (AX5: +P). |
| C11 | Przekazanie — oddać komuś zadanie | kilka razy w tygodniu | wiersz | wiersz (1) + „Przekaż zadanie” (1) + osoba (1) = **3** (+P) | Zadanie | Zadanie „czeka na…” | Tylko dorośli z kontem. |
| C12 | „Biorę to” (zadanie bez osoby, zaległe u wszystkich) | rzadko | wiersz | wiersz (1) + „Biorę to” (1) = **2** | Zadanie | — | — |
| C13 | Obecność na terminie | kilka razy w tygodniu | wiersz wydarzenia | wiersz (1) + „Będę” (1) + „Wróć” (1) = **3** (+P) | Wydarzenie | — | Za dzieci bez konta osobne wybory w tym samym polu (G14). |
| C14 | Nawigacja na wydarzenie / „Wyjdź o …” | kilka razy w tygodniu | wiersz wydarzenia z miejscem | wiersz (1) + „Nawiguj” (1) = **2** | Wydarzenie → Mapy Apple | Mapy Apple | „Pokaż, kiedy wyjść” włącza dojazd (P20). |
| C15 | Lekcje dziecka w ciągu dnia | codziennie (w roku szkolnym) | wiersz „Tymek: 6 lekcji” | **1** (rozwinięcie) | Moje sprawy | — | VoiceOver: „Pokazano N lekcji”. |
| C16 | Odświeżenie | codziennie | gest | **1** | każda zakładka | — | Offline: kółko kręci się najkrócej `REFRESH_SPIN_MS`. |
| C17 | Otwarcie sprawy z powiadomienia (przypomnienie, przypisanie, przekazanie, poranne podsumowanie) | codziennie | powiadomienie | **1** | Zadanie / Lista / Wydarzenie / Moje sprawy | ten ekran; „Wróć” na zakładki | Sprawa jeszcze niepobrana: „Tego zadania już nie ma…”, potem już ona (PWD-16). |
| C18 | Zakupy z Moich spraw (wiersz „Zakupy: …”) | kilka razy w tygodniu | wiersz zakupów | odhaczenie z potwierdzeniem (2) albo wiersz → lista (1) | Moje sprawy / Lista | — | Dziecko z kontem: bez pola odhaczenia. |

### 1.3 Planowanie (P) — kalendarz, wydarzenia, serie

| ID | Przepływ i cel | Częstość | Wejście dziś | Kroki (stuknięcia) | Ekrany | Koniec | Stany szczególne |
|---|---|---|---|---|---|---|---|
| P1 | Inny dzień, tydzień, miesiąc w Moich sprawach | kilka razy w tygodniu | „Zakres”, strzałki, „Dziś” | **1** każde | Moje sprawy | — | W tygodniu i miesiącu „Bez terminu (N)” zwinięte. |
| P2 | Przegląd miesiąca w Kalendarzu | kilka razy w tygodniu | zakładka Kalendarz | zakładka (1) + dzień (1) = **2** | Kalendarz | lista dnia pod siatką | Kropki grup i kropka „z iPhone’a” mają odpowiednik w etykiecie dnia. |
| P3 | Filtr grup (wspólny dla Moich spraw i Kalendarza) | kilka razy w tygodniu | chipy „Pokaż grupy” | **1** na grupę; „Pokaż wszystkie” (1) | Moje sprawy / Kalendarz | — | Przy filtrze wydarzenia z iPhone’a schowane. Przy jednej grupie pasek znika. |
| P4 | Nowe wydarzenie z formularza w Kalendarzu | kilka razy w tygodniu | „Dodaj wydarzenie” pod listą dnia | zakładka (1) + dzień (1) + **P** + „Dodaj wydarzenie” (1) + grupa (0–1) + godziny (2 × 3) + „Zapisz wydarzenie” (1) = **10–11 + P** | Kalendarz → Wydarzenie (formularz) | Kalendarz, pasek „Cofnij” | AX5: przycisk za paskiem zakładek (`.maestro/04`). Dziecko: brak przycisku. |
| P5 | Pełny formularz z pola („Więcej”) | kilka razy w tygodniu | „Więcej” pod polem | **1** + pola + „Zapisz zadanie” (1); z zakresem godzin w tekście od razu formularz wydarzenia | Formularz zadania / wydarzenia | wraca, pasek „Dodano…” | Rodzaj zmienia formularz (Zadanie / Wydarzenie / Rutyna), wpisane dane zostają. Szkic zostaje na telefonie (D179). |
| P6 | Wydarzenie cykliczne, kilka wariantów | rzadko | jak P4 | P4 + „Powtarzanie” (1) + dni (n) + „Dodaj wariant” (1) | jak P4 | jak P4 | Każdy wariant to osobna seria. |
| P7 | Wydarzenie przez kilka dni | rzadko | jak P4 | P4 bez godzin + „Cały dzień” (1) + „Kończy się” (1) + dzień (1) | jak P4 | Kalendarz: „dzień 2 z 3” | `.maestro/08`. |
| P8 | Zmiana wydarzenia albo terminu serii | kilka razy w miesiącu | wiersz | wiersz (1) + „Zmień” (1) + zakres (1, tylko seria) + zmiany + „Zapisz wydarzenie” (1) = **3–4** + zmiany | Wydarzenie → formularz | szczegóły wydarzenia, gdy termin istnieje (M-246) | — |
| P9 | Odwołanie terminu / usunięcie wydarzenia | kilka razy w miesiącu | wiersz albo ekran wydarzenia | przesunięcie + „Odwołaj” = **2**; z ekranu: wiersz + „Odwołaj” + zakres = **3**; z podpiętymi zadaniami pytanie (+1, D14) | Moje sprawy / Kalendarz / Wydarzenie | pasek „Cofnij” | **Przywrócenie odwołanego terminu po zniknięciu paska:** tylko Grupy → +P → „Ostatnie zmiany” → „Cofnij” = **3 + P**, tylko u osoby, która odwołała. Odwołany termin nie pokazuje się w Kalendarzu (`events.ts`: `if (o?.cancelled) continue`). |
| P10 | Zadania przy terminie (podpięcie, stałe zadania serii) | kilka razy w miesiącu | ekran wydarzenia | wiersz (1) + **P** + pole (1) + „Dodaj” (1) = **3 + P**; z zadania: „Podepnij do wydarzenia” (1) + termin (1) | Wydarzenie / Zadanie | — | „Każdy termin / tylko ten” przy serii. |
| P11 | Przekazanie wydarzenia | rzadko | ekran wydarzenia | wiersz (1) + „Przekaż wydarzenie” (1) + [zakres] + osoba (1) = **3–4** | Wydarzenie | „czeka na…” | Tylko osoba odpowiedzialna. |
| P12 | Nowa rutyna z krokami | rzadko | „Dodaj rutynę” w Kalendarzu albo na ekranie grupy; Rodzaj w formularzach | Kalendarz (1) + **P** + „Dodaj rutynę” (1) + dni + kroki + „Zapisz rutynę” (1) = **3 + P** + pola | Rutyna | wraca, „Dodano rutynę…” | Dziecko: brak. |
| P13 | Plan lekcji dziecka (tygodnie A/B), kopiowanie do innej grupy | kilka razy w roku | ekran grupy („Plan lekcji — Tymek”) albo ekran osoby („Plan lekcji”) | Grupy (1) + grupa (1) + **P** + plan (1) + lekcje + „Zapisz plan” (1) + podgląd (1) = **5 + P** | Grupa → Plan lekcji → podgląd | wraca | Zmiana działa od jutra (D128). |
| P14 | Kopia wydarzenia z iPhone’a do grupy | rzadko | wiersz z iPhone’a („Dodaj do grupy”) | **1** + formularz + „Zapisz wydarzenie” (1) = **2** | Moje sprawy / Kalendarz → formularz | — | Duble ukryte (H8). |
| P15 | Zadanie z powtarzaniem | kilka razy w miesiącu | „Więcej” albo ekran zadania | Więcej (1) + termin (1) + powtarzanie (1–3) + „Zapisz zadanie” (1) = **4–6** | Formularz zadania / Zadanie | — | Bez terminu nie ma powtarzania. |
| P16 | Podzadania | kilka razy w tygodniu | ekran zadania | wiersz (1) + **P** + pole + „Dodaj” (1) = **2 + P** | Zadanie | — | Do `MAX_TASK_DEPTH` = 2. |
| P17 | Zmiana kolejności (lista, podzadania) | rzadko | „Zmień kolejność” | **1** + przeciągnięcia albo strzałki + „Gotowe” (1) | Lista / Zadanie | — | Strzałki działają z VoiceOverem i Switch Control. |
| P18 | Przeniesienie zadania do innej grupy | rzadko | ekran zadania | wiersz (1) + **P** + „Przenieś do grupy” (1) + grupa (1) = **3 + P** | Zadanie | pasek „Przeniesiono…” | — |
| P19 | Dodanie wydarzenia do kalendarza iPhone’a (jedno) | rzadko | ekran wydarzenia | wiersz (1) + „Dodaj do kalendarza iPhone’a” (1) + [okno iOS] = **2–3** | Wydarzenie | „Dodano…” | Przy lustrze napis zamiast przycisku (PWD-2). |
| P20 | Czas dojazdu dla wydarzenia | rzadko | ekran wydarzenia („Pokaż, kiedy wyjść”) albo Ustawienia | **1** + okno iOS (1) | Wydarzenie | „Wyjdź o …” | Odmowa: „Otwórz Ustawienia iPhone’a”. |

### 1.4 Zakupy (Z)

| ID | Przepływ i cel | Częstość | Wejście dziś | Kroki (stuknięcia) | Ekrany | Koniec | Stany szczególne |
|---|---|---|---|---|---|---|---|
| Z1 | Dopisanie produktu na liście | kilka razy w tygodniu | zakładka Listy → lista | Listy (1) + lista (1) + pole (1) + „Dodaj” (1) = **4**; podpowiedź (1) zamiast „Dodaj” | Listy → Lista | pasek „Dodano produkt…” | Produkt już jest: pytanie (Z9). AX5: pole poniżej nagłówka (+P). |
| Z2 | Zakupy w sklepie | raz–dwa razy w tygodniu | Listy → lista albo wiersz zakupów w Moich sprawach | lista (1–2) + „Włóż do koszyka” (1 na produkt) + „Zakupy zrobione” (1) + potwierdzenie (1) = **n + 3–4** | Lista | pasek „Zakupy zrobione · Cofnij” | Pytanie o niekupione. Dziecko: bez „Zakupy zrobione”. Offline działa. |
| Z3 | Zaplanowanie zakupów (dzień, osoba) | raz w tygodniu | lista | lista (2) + „Zaplanuj zakupy” (1) + dzień (1) + osoba (1) + „Zapisz zakupy” (1) = **6** | Lista | wiersz w Moich sprawach | We wspólnej grupie dzień albo osoba obowiązkowe. |
| Z4 | Przekazanie zakupów | rzadko | lista | lista (2) + „Przekaż zakupy” (1) + osoba (1) = **4** | Lista | „czeka na…” | — |
| Z5 | Stałe zakupy | raz w tygodniu | karta na liście | „Dodaj stałe (N)” (1); zmiana: „Zmień stałe” (1) + … + „Gotowe” (1) | Lista | — | — |
| Z6 | Kup jeszcze raz | raz w tygodniu | „Kupione w ostatnich zakupach” | rozwinięcie (1) + „Kup jeszcze raz” (1) = **2** | Lista | — | — |
| Z7 | Ilość i dział produktu | kilka razy w tygodniu | wiersz produktu | wiersz (1) + dział (1) + „Gotowe” (1) = **3** | Lista (panel) | — | Fokus VoiceOvera na pole nazwy. |
| Z8 | Nowa lista zakupów | rzadko | Listy → „Nowa lista zakupów”; grupa → „Następne kroki” | Listy (1) + przycisk (1) + grupa (0–1) + dzień/osoba (1–2) + „Utwórz listę” (1) = **4–6** | Nowa lista → Lista | otwarta lista | — |
| Z9 | Ten sam produkt drugi raz | kilka razy w miesiącu | pole na liście | panel: „Wyjmij z koszyka” albo „Dodaj jeszcze raz” (1) | Lista | — | — |
| Z10 | Lista zadań: nowa, zmiana nazwy, usunięcie | rzadko | Listy → „Nowa lista”; na liście pole nazwy i „Usuń listę” (na dole) | nowa: **3**; usunięcie: lista (2) + **P** + „Usuń listę” (1) [+ pytanie z liczbą zadań] albo przesunięcie w Listach (2) | Listy / Lista | pasek „Cofnij” | Lista „Tylko ja” oznaczona. |

### 1.5 Grupy i ludzie (G)

| ID | Przepływ i cel | Częstość | Wejście dziś | Kroki (stuknięcia) | Ekrany | Koniec | Stany szczególne |
|---|---|---|---|---|---|---|---|
| G1 | Nowa grupa | rzadko | Grupy → „Nowa grupa” | Grupy (1) + „Nowa grupa” (1) + nazwa + imię + „Utwórz grupę” (1) = **3** | Nowa grupa → Grupa | Grupa z „Następnymi krokami” | Wymaga internetu. |
| G2 | Zaproszenie dorosłego | rzadko | ekran grupy („Zaproś”, „Zaproś jako administratora”) | Grupy (1) + grupa (1) + **P** + „Zaproś” (1) + „Wyślij zaproszenie” (1) = **4 + P** | Grupa | systemowe udostępnianie | Wymaga internetu. Przy dzieciach w grupie pierwszy jest przycisk administratora (PW-34 A). |
| G3 | Nowy kod / unieważnienie | rzadko | karta zaproszenia | „Nowy kod” (1); „Unieważnij kod” (1) + potwierdzenie (1) | Grupa | — | Wymaga internetu. |
| G4 | Dołączenie do grupy | rzadko | Grupy → „Dołącz do grupy” | Grupy (1) + przycisk (1) + ID i kod + imię + „Dołącz” (1) = **3** | Dołącz do grupy → Grupa | Grupa | Wymaga internetu. Już w grupie: „Otwórz grupę”. |
| G5 | Dodanie dziecka bez konta | rzadko | ekran grupy (pole „Imię dziecka”) | Grupy (1) + grupa (1) + **P** + pole (1) + „Dodaj dziecko (bez konta)” (1) = **4 + P** | Grupa | pasek „Dodano…” | Tylko właściciel i administrator. |
| G6 | Połączenie profilu dziecka z kontem dziecka | raz na dziecko | ekran osoby | Grupy (1) + grupa (1) + **P** + osoba (1) + „Połącz z kontem dziecka” (1) + „Wyślij zaproszenie” (1) = **5 + P**; na telefonie dziecka G4 | Grupa → Osoba | — | Dziecko dołącza przez „Dołącz do grupy” (nazwa nie mówi o łączeniu profilu). |
| G7 | Osoba: imię w grupie, rola, usunięcie z grupy, przekazanie własności | rzadko | ekran osoby | Grupy (1) + grupa (1) + osoba (1) + zmiana (1–2) = **4–5** | Osoba | — | Własność: potwierdzenie w panelu. |
| G8 | Zakres „W Moich sprawach” dla grupy | raz na grupę | ekran grupy | Grupy (1) + grupa (1) + wybór (1) = **3** | Grupa | — | Bez zakresu w grupie osobistej i u dziecka. |
| G9 | Nazwa i kolor grupy | rzadko | ekran grupy (pole, kolory) | Grupy (1) + grupa (1) + **P** + pole/kolor (1) = **3 + P** | Grupa | — | Nazwa zapisuje się po wyjściu z pola. |
| G10 | Zmiana ID grupy | wyjątkowo | ekran grupy | 2 + **P** + przycisk (1) + potwierdzenie (1) = **4 + P** | Grupa | — | Tylko właściciel; wymaga internetu. |
| G11 | Wyjście z grupy | rzadko | ekran grupy (na dole) | 2 + **P** + „Wyjdź z grupy” (1) + potwierdzenie (1) = **4 + P** | Grupa | Grupy | Właściciel i dziecko: napis zamiast przycisku. |
| G12 | Usunięcie grupy | rzadko | przesunięcie w Grupach albo przycisk na dole ekranu grupy | przesunięcie (1) + „Usuń” (1) [+ pytanie, gdy są inni] = **2–3** | Grupy / Grupa | pasek „Cofnij”, Kosz | — |
| G13 | Utrata dostępu do grupy | wyjątkowo | samo | **0** (komunikat) | — | — | `GroupLossNotice`. |
| G14 | Obecność za dziecko bez konta | kilka razy w miesiącu | ekran wydarzenia | wiersz (1) + odpowiedź przy imieniu (1) = **2** (+P) | Wydarzenie | — | — |

### 1.6 Przegląd i historia (H)

| ID | Przepływ i cel | Częstość | Wejście dziś | Kroki (stuknięcia) | Ekrany | Koniec | Stany szczególne |
|---|---|---|---|---|---|---|---|
| H1 | Minione dni — co było | kilka razy w tygodniu | strzałka wstecz w Moich sprawach; Kalendarz | **1** | Moje sprawy / Kalendarz | — | Minione wyszarzone; „Minęło: …” raz (U-63). |
| H2 | Zrobione dziś (odznaczenie pomyłki) | codziennie | „Zrobione dziś (N)” | rozwinięcie (1) + odznaczenie (1) = **2** | Moje sprawy | — | — |
| H3 | Zrobione na liście, starsze | rzadko | „Zrobione (N)” na liście | lista (2) + **P** + rozwinięcie (1) [+ „Pokaż starsze” (1)] = **3–4 + P** | Lista | — | — |
| H4 | Historia zadania (kto, co, kiedy) | rzadko | ekran zadania | wiersz (1) + **P** = **1 + P** | Zadanie | — | — |
| H5 | Ostatnie zmiany i „Cofnij” bez limitu czasu | rzadko | Grupy → „Ostatnie zmiany”; treść paska „Cofnij” | Grupy (1) + **P** + wiersz (1) + „Cofnij” (1) = **3 + P**; z paska: **2** | Ostatnie zmiany | — | Tylko zmiany z tego telefonu (D194 b). Rzecz zmieniona od tamtej chwili nie jest nadpisywana. |
| H6 | Kosz — przywrócenie | rzadko | Grupy (sekcja na samym dole); otwarta z linku usunięta rzecz („W koszu” + „Przywróć”) | Grupy (1) + **P** (do końca) + [„Pokaż wszystkie (N)” (1)] + „Przywróć” (1) = **2–3 + P** | Grupy | pasek „Przywrócono… · Cofnij” | Grupa wraca przez serwer (internet). |
| H7 | Odrzucone zmiany | wyjątkowo | pasek „Serwer nie przyjął N zmian — Zobacz”; Ustawienia → Konto i dane → „Odrzucone zmiany” | z paska **1**; z Ustawień: ikona (1) + „Konto i dane” (1) + wiersz (1) = **3** | Odrzucone zmiany | — | — |
| H8 | Ukryte duble z iPhone’a | rzadko | wiersz „Ukryto N…” pod dniem | **1** | Moje sprawy / Kalendarz | — | — |
| H9 | Zrobione zakupy w Kalendarzu | rzadko | Kalendarz → dzień | **2** | Kalendarz | — | Przekreślone, bez odhaczania (PWD-11 A). |

### 1.7 Dane i ustawienia (U)

| ID | Przepływ i cel | Częstość | Wejście dziś | Kroki (stuknięcia) | Ekrany | Koniec | Stany szczególne |
|---|---|---|---|---|---|---|---|
| U1 | Powiadomienia: wyprzedzenie, poranne podsumowanie, „Czas wyjść”, wyciszenia grup | rzadko | ikona Ustawień → „Powiadomienia” | ikona (1) + wiersz (1) + wybór (1) = **3** | Ustawienia → Powiadomienia | — | Bez zgody: „Włącz powiadomienia” / „Otwórz Ustawienia iPhone’a”. Wyciszenia z serwera (offline: komunikat). |
| U2 | Kalendarz iPhone’a (odczyt, lustro, wybór grup i kalendarzy) i dojazd | rzadko | „Kalendarz i dojazd” | **3** | Ustawienia → Kalendarz i dojazd | — | Tablet: dopisek o lustrze. |
| U3 | Wygląd (systemowy, jasny, ciemny) | raz | „Wygląd” | **3** | Ustawienia → Wygląd | — | — |
| U4 | Grupa domyślna pola dodawania | raz | „Dodawanie” (tylko przy kilku grupach) | **3** | Ustawienia → Dodawanie | — | — |
| U5 | Twoje imię (we wszystkich grupach) | rzadko | „Konto i dane” → „Twoje imię” | ikona (1) + „Konto i dane” (1) + wiersz (1) + „Zapisz imię” (1) = **4** | Konto i dane → Imię | — | Imię w jednej grupie — ekran osoby (G7). |
| U6 | Raporty błędów, polityka prywatności | rzadko | „Konto i dane” | **3** | Konto i dane | przeglądarka (polityka) | — |
| U7 | Wyślij uwagę | rzadko | Ustawienia → „Wyślij uwagę”; karta „Co nowego” | ikona (1) + wiersz (1) + tekst + „Wyślij” (1) = **3** | Twoja uwaga | — | Wymaga internetu; limit dzienny. |
| U8 | Licencje | wyjątkowo | Ustawienia → „Licencje” | **2–3** + P | Licencje | — | Ponad 80 pozycji. |
| U9 | Pokaż wprowadzenie | wyjątkowo | Ustawienia | **2** | Wprowadzenie | — | Kto ma grupę wspólną, nie dostaje wyboru startu. |
| U10 | Wyloguj | rzadko | Konto i dane | ikona (1) + wiersz (1) + „Wyloguj” (1) + potwierdzenie (1) = **4** | Konto i dane | Logowanie | Offline i czekające zmiany: ostrzeżenie w oknie. Konto bez Apple: ostrzeżenie (D177). |
| U11 | Ponowne logowanie po wygaśnięciu sesji | wyjątkowo | strona główna Ustawień (przycisk „Zaloguj się ponownie”) | ikona (1) + przycisk (1) = **2** | Ustawienia | Logowanie | Pasek w zakładkach tylko informuje (PW-28); drogi do Ustawień nie podpowiada. |
| U12 | Wyczyść dane na telefonie | wyjątkowo | Konto i dane | **3** + **P** + „Wyczyść…” (1) + potwierdzenie (1) = **5 + P** | Konto i dane | Moje sprawy (pobieranie od nowa) | Zablokowane bez serwera. |
| U13 | Usuń konto | raz | Konto i dane (na końcu) | **3** + **P** + „Usuń konto” (1) + „USUŃ” + potwierdzenie (1) [+ okno Apple] = **5–6 + P** | Konto i dane | Logowanie z „Konto zostało usunięte.” | Wymaga internetu (App Store 5.1.1(v), D49). |
| U14 | Cofnięta zgoda Apple | wyjątkowo | samo | **0** | — | Logowanie | N-225. |

### 1.8 Przepływy brakujące, a wynikające z decyzji (NOWY)

| ID | Przepływ i cel | Decyzja | Stan w kodzie | Uwagi do nawigacji |
|---|---|---|---|---|
| N1 | **NOWY** — Widżet na ekranie głównym: dzisiejsze sprawy bez otwierania aplikacji | D17 („Faza 1”), backlog O-005 (ADR 0018), D124 (do backlogu) | niezrobione: baza konta nie leży w kontenerze app group (ADR 0001) | Dotknięcie wiersza w widżecie otwiera sprawę tą samą ścieżką co powiadomienie (C17) — nowej trasy nie trzeba. |
| N2 | **NOWY** — Import ze zdjęcia (np. kartki z planem) | D20 („później, bez ustalonej fazy”) | brak | Miejsce wejścia do decyzji: pole dodawania albo formularz. |
| N3 | **NOWY** — Eksport ICS / subskrypcja kalendarza | D7 („ICS po MVP”) | jest lustro w kalendarzu iPhone’a (D95–D96), ICS — brak | Miejsce: Ustawienia → Kalendarz i dojazd. |
| N4 | **NOWY** — Pochwała dla dziecka | D19 | niezrobione (ADR 0001: licznik „N razy z rzędu” niczego nie nagradza) | Do potwierdzenia, czy nadal chcesz (pytanie Q8). |
| N5 | **NOWY** — Logowanie linkiem z e-maila | D5 → D177 („wróci razem z własnym dostawcą wysyłki”) | wyłączone w becie | Ekran logowania: drugi przycisk. |

Bez decyzji w `docs/adr/` (więc nie „NOWY”, tylko obserwacja): wyszukiwanie spraw we wszystkich grupach, zadanie na wybrany
dzień z Kalendarza, dojście do odwołanego terminu dla innych dorosłych (patrz krok 2).

---

## Krok 2. Mapa ekranów i problemy

Oznaczenia: **DUP** — to samo miejsce z kilku stron, **ZAUŁEK** — ślepy zaułek albo brak drogi dalej, **NIEUŻ** — element
bez przepływu, **NAZWA** — niespójna nazwa tego samego miejsca, **MYLĄCY** — przycisk robi coś innego, niż mówi.

### 2.1 Mapa: ekran → elementy nawigacyjne → cel

| Ekran (trasa) | Element nawigacyjny | Dokąd / co robi | Przepływy | Uwagi |
|---|---|---|---|---|
| Pasek zakładek | Moje sprawy · Listy · Kalendarz · Grupy (plakietka przekazań na pierwszej) | zakładki | wszystkie | — |
| Nagłówek każdej zakładki (`TabHeader`) | stan synchronizacji (tylko informuje), ikona Ustawień | Ustawienia | U1–U13 | Stan synchronizacji jest też na stronie głównej Ustawień i na liście (DUP, celowo: tam nie ma nagłówka zakładki). |
| Moje sprawy (`Today`) | chipy grup, pole + chip grupy + chip „Na listę”, „Więcej”, panele pytań, „Zakres”, strzałki, „Dziś”, „Do potwierdzenia”, „Co nowego”, karta powiadomień, „Przenieś zaległe”, wiersze (zadanie → Zadanie, wydarzenie → Wydarzenie, zakupy → Lista, lekcje → rozwinięcie, z iPhone’a → „Dodaj do grupy”), „Bez terminu”, „Zrobione dziś” | jw. | C1–C18, P1, P3, P5, P14, H1, H2, H8, S8, S10 | „Więcej”: podpowiedź „Pełny formularz: grupa, lista, osoba, powtarzanie” — w formularzu nie ma wyboru listy (D97) — **MYLĄCY**. Brak przycisku „nowe wydarzenie” — tylko tekst z godzinami albo „Więcej” → Rodzaj (świadomie, D90). |
| Listy (`Lists`) | wiersze list → Lista; przesunięcie → usuń; „Nowa lista”, „Nowa lista zakupów” | Nowa lista | Z1–Z3, Z8, Z10 | Dwa przyciski do tego samego formularza, który i tak ma „Rodzaj listy” (**DUP**, ale skraca Z8 o 1). „Nowa lista” nie mówi, że to lista zadań (**NAZWA**). |
| Kalendarz (`Calendar`) | chipy grup, karta kalendarza iPhone’a, strzałki, „Dziś”, dni, wiersze dnia, „Dodaj wydarzenie”, „Dodaj rutynę” (oba na końcu treści) | Wydarzenie (formularz), Rutyna | P2–P4, P12, P14, H1, H8, H9, S9 | Dodawanie pod listą dnia — przy AX5 za paskiem zakładek (komentarz `.maestro/04`). Nie da się dodać zadania na wybrany dzień (**ZAUŁEK**). „Dodaj wydarzenie” nie mówi, na który dzień. |
| Grupy (`Groups`) | wiersze grup → Grupa; przesunięcie → usuń; „Nowa grupa”, „Dołącz do grupy”, „Ostatnie zmiany”, Kosz (cała sekcja na końcu) | Nowa grupa, Dołącz, Ostatnie zmiany | G1, G4, G12, H5, H6 | Kosz i „Ostatnie zmiany” dotyczą też zadań, list i wydarzeń, a są w Grupach. Ludzie dowiadują się o nich z „Co nowego” („Grupy → Kosz”). Kosz rośnie w dół, nad nim lista grup. |
| Lista (`List`) | „Wróć”, stan synchronizacji, zakupy (Zaplanuj / Zmień / Przekaż / Zakupy zrobione), stałe zakupy, pole, panele, „Zmień kolejność”, wiersze (zadanie → Zadanie; produkt → panel), „Zrobione (N)”, „Kupione…”, pole nazwy, „Usuń listę” | Zadanie | Z1–Z10, H3, P17 | „Zakupy zrobione” jest w dwóch miejscach ekranu (przy zaplanowanych zakupach i bez nich) — wzajemnie się wykluczają, w porządku. |
| Zadanie (`Task`) | „Wróć”, pole odhaczenia, tytuł, notatka, termin, powtarzanie, „Podepnij do wydarzenia” / „Otwórz wydarzenie” / „Przepnij…” / „Odepnij”, „Biorę to”, osoba, „Przekaż zadanie”, „Przenieś do grupy”, podzadania (→ Zadanie), „Zmień kolejność”, historia, „Usuń zadanie” | Wydarzenie, Zadanie | C7, C11, C12, P10, P15–P18, H4 | Długi ekran; kolejność sekcji zgodna z ważnością. Bez uwag do nawigacji. |
| Wydarzenie (`Event`) | „Wróć”, miejsce („Nawiguj”, dojazd), „Przekaż wydarzenie”, obecność, „Dodaj do kalendarza iPhone’a”, zadania (→ Zadanie), pole zadania, „Zmień”, „Odwołaj” / „Usuń wydarzenie”, „Przywróć” (odwołany) | formularz, Zadanie | C13, C14, P8–P11, P19, P20, G14 | „Przywróć” odwołanego terminu jest, ale do odwołanego terminu nie prowadzi żaden wiersz (**ZAUŁEK**, P9). |
| Formularz wydarzenia (`EventEdit`) | „Wróć”, Rodzaj (→ Formularz zadania / Rutyna), grupa, pola, „Zapisz wydarzenie”, podgląd zmian serii | — | P4–P8, P14 | — |
| Formularz zadania (`AddTask`) | „Wróć”, Rodzaj (→ Formularz wydarzenia / Rutyna), pola, „Zapisz zadanie” | — | P5, P15 | — |
| Rutyna (`Routine`) | „Wróć”, Rodzaj, pola, „Dodaj krok”, „Zapisz rutynę” | — | P12 | — |
| Nowa lista (`NewList`) | „Wróć”, pola, „Utwórz listę” | Lista (zastępuje) | Z8, Z10 | — |
| Grupa (`Group`) | „Wróć”, „Następne kroki” (Zaproś…, „Dodaj dziecko” — kursor w polu niżej, „Zaplanuj zakupy” / „Utwórz listę zakupów”, „Nie teraz”), zakres „W Moich sprawach”, osoby (→ Osoba), „Zaproś”, „Zaproś jako administratora”, karta kodu, „Zmień ID grupy”, pole „Imię dziecka” + „Dodaj dziecko (bez konta)”, nazwa, kolor + „Automatyczny”, listy (→ Lista) + „Nowa lista”, wydarzenia grupy (→ Wydarzenie) + „Dodaj wydarzenie” + „Dodaj rutynę”, „Plan lekcji — imię” (na dziecko), „Wyjdź z grupy”, „Usuń grupę” | Osoba, Lista, Nowa lista, Wydarzenie, formularz, Rutyna, Plan lekcji | S7, G2–G12, P12, P13, Z8 | Kilkanaście sekcji; ustawienia (nazwa, kolor, ID, wyjście, usunięcie) między treścią. „Zaplanuj zakupy” tylko otwiera listę (**MYLĄCY**). „Zaproś partnera (administrator)” i „Zaproś jako administratora” to to samo (**NAZWA**); tak samo „Utwórz listę zakupów” i „Nowa lista zakupów”, „Dodaj dziecko” i „Dodaj dziecko (bez konta)”. „Plan lekcji” jest i tu, i na ekranie osoby (**DUP**, skraca P13 o 1). „Dodaj wydarzenie” i „Dodaj rutynę” są i tu, i w Kalendarzu (**DUP**). |
| Osoba (`Member`) | „Wróć”, „Plan lekcji”, imię w grupie, rola, „Połącz z kontem dziecka”, „Przekaż własność grupy”, „Usuń z grupy” | Plan lekcji | G6, G7, P13 | — |
| Plan lekcji (`Timetable`) | „Wróć”, lekcje, „Zapisz plan”, podgląd, „Skopiuj plan lekcji do…” (→ Plan lekcji innej grupy) | — | P13 | — |
| Dołącz do grupy (`Invite`) | „Wróć”, pola, „Dołącz”, „Otwórz grupę” | Grupa (zastępuje) | G4, S5, S11, G6 (telefon dziecka) | Ten sam ekran łączy konto dziecka z profilem, a nazywa się „Dołącz do grupy” — w tekście `member.linkInfo` jest to wyjaśnione; niewielki problem (**NAZWA**). |
| Nowa grupa (`NewGroup`) | „Wróć”, pola, „Utwórz grupę” | Grupa (zastępuje) | G1, S4 | — |
| Ostatnie zmiany (`Recent`) | „Wróć”, „Cofnij” przy wpisach | — | H5, P9 | — |
| Ustawienia (`Settings`) | „Wróć”, stan synchronizacji, „Zaloguj się ponownie”, Powiadomienia, Kalendarz i dojazd, Wygląd, Dodawanie, Konto i dane, „Wyślij uwagę”, „Licencje”, „Pokaż wprowadzenie” | podstrony, Twoja uwaga, Licencje, Wprowadzenie | U1–U13 | — |
| Konto i dane (`Settings`, `account`) | „Twoje imię”, „Odrzucone zmiany”, raporty błędów, polityka prywatności, „Wyloguj”, „Wyczyść dane na telefonie”, „Usuń konto” | Imię, Odrzucone zmiany | U5, U6, U10, U12, U13, H7 | „Wyloguj” (czerwony) stoi nad „Wyczyść dane” i „Usuń konto” — zgodnie z PWD-4 A. |
| Odrzucone zmiany, Twoja uwaga, Licencje, Imię | „Wróć” + własne przyciski | — | H7, U7, U8, U5, S2 | — |
| Wprowadzenie (`Welcome`) | „Dalej”, „Pomiń”, „Zaczynamy”, „Utwórz grupę rodzinną”, „Mam kod zaproszenia”, „Na razie bez grupy wspólnej” | Nowa grupa, Dołącz do grupy | S3–S6, U9 | „Mam kod zaproszenia” i „Dołącz do grupy” prowadzą w to samo miejsce (**DUP**, celowo — inne miejsce wejścia). |
| Logowanie, „Dane z nowszej wersji” | Apple, polityka; jeden przycisk czyszczący | — | S1, S12 | „Dane z nowszej wersji” ma tylko wyjście niszczące (**ZAUŁEK**, łagodny: można zamknąć aplikację i zaktualizować). |
| Pasek „Cofnij” (poza ekranami) | „Cofnij”, „Zmień”, treść → Ostatnie zmiany, „Zobacz” (odrzucone) | Ostatnie zmiany, Odrzucone zmiany, Zadanie, Lista, formularz | C2–C9, H5, H7 | Treść paska otwiera „Ostatnie zmiany” — przy AX5 przeciągnięcie po wysokim pasku to dotknięcie (komentarze `.maestro/02`, `05`); nie jest to błąd nawigacji, ale łatwo tam trafić przypadkiem. |

**NIEUŻ — elementy bez przepływu:** nie znalazłem żadnego elementu, który nie służy żadnemu przepływowi.

### 2.2 Problemy (posortowane według wpływu)

| Nr | Problem | Rodzaj | Gdzie | Przepływy | Waga (próg z CLAUDE.md) |
|---|---|---|---|---|---|
| Z-1 | Odwołany termin serii znika ze wszystkich widoków. „Przywróć” na ekranie wydarzenia jest nieosiągalne (poza linkiem). Inny dorosły nie przywróci terminu wcale, autor — tylko z „Ostatnich zmian” na tym samym telefonie. | ZAUŁEK | `domain/views/events.ts` (`cancelled` pomijane), `EventScreen.tsx` | P9 | średnia (nic nie ginie, ale droga powrotu jest ukryta) |
| Z-2 | Dodawanie w Kalendarzu i na ekranie grupy na końcu treści, pod listą dnia / pod listami. Przy AX5 kilka ekranów przewijania, przycisk za paskiem zakładek. | — | `CalendarScreen.tsx`, `GroupScreen.tsx` | P4, P12, G-sekcje | średnia (dostępność: utrudnione, nie zablokowane) |
| Z-3 | Z Kalendarza nie da się dodać zadania na wybrany dzień — tylko wydarzenie albo rutynę. | ZAUŁEK | `CalendarScreen.tsx` | P2→P4 | niska |
| Z-4 | Ekran grupy: kilkanaście sekcji; rzadkie ustawienia (nazwa, kolor, ID, wyjście, usunięcie) przemieszane z treścią (osoby, listy, wydarzenia, plany). Przy AX5 bardzo długi. | — | `GroupScreen.tsx` | G2–G12, P13 | średnia |
| Z-5 | Podpowiedź „Więcej” obiecuje wybór listy, którego nie ma (D97). | MYLĄCY | `strings.pl.ts` `form.moreHint` | P5 | średnia (twierdzenie niezgodne z aplikacją, VoiceOver je czyta) |
| Z-6 | „Zaplanuj zakupy” na karcie „Następne kroki” otwiera listę, a planowanie trzeba otworzyć drugi raz tym samym napisem. | MYLĄCY | `GroupScreen.tsx` | S7, Z3 | niska |
| Z-7 | Jedna rzecz — kilka nazw: „Nowa lista zakupów” / „Utwórz listę zakupów”; „Zaproś jako administratora” / „Zaproś partnera (administrator)”; „Dodaj dziecko” / „Dodaj dziecko (bez konta)”; „Nowa lista” (bez rodzaju) obok „Nowa lista zakupów”. | NAZWA | `strings.pl.ts` (`groups.nextSteps.*`, `lists.new`) | S7, Z8, Z10, G2, G5 | niska |
| Z-8 | Słownik (`docs/glossary.md`) mówi, że sekcja bez terminu nazywa się „Przypięte”, a aplikacja od PWD-13 A mówi „Bez terminu” (`today.pinnedCount`, komentarz w `strings.pl.ts`), a w terminie zadania „Bez terminu (przypięte)”. | NAZWA | `docs/glossary.md`, `strings.pl.ts` | C1, P1 | niska (dokumentacja niezgodna z aplikacją) |
| Z-9 | Kosz i „Ostatnie zmiany” dotyczą wszystkiego, a stoją w Grupach; Kosz jest rozwiniętą sekcją na końcu zakładki, pod listą grup. Odrzucone zmiany — w innym miejscu (Konto i dane). | — | `GroupsScreen.tsx`, `TrashSection.tsx` | H5–H7 | niska (teksty „Co nowego” i polityka prywatności już kierują do „Grupy → Kosz”) |
| Z-10 | „Do potwierdzenia” (pilne, z plakietką na zakładce) jest pod polem dodawania, „Zakresem” i paskiem okresu — przy AX5 poniżej pierwszego ekranu. | — | `TodayScreen.tsx` (PWD-31 A ustawiło ją nad kartami informacyjnymi, nie nad polem) | C10 | niska |
| Z-11 | „Dane z nowszej wersji”: jedyne wyjście czyści dane telefonu; brak napisu „zaktualizuj aplikację i wróć”. | ZAUŁEK (łagodny) | `Root.tsx` `NewerData` | S12 | niska (czyści tylko kopię; dane są na serwerze, ale zmiany czekające w kolejce przepadną — [DO WYJAŚNIENIA] 6) |
| Z-12 | Wygasła sesja: pasek w zakładkach mówi o stanie, ale nie prowadzi do „Zaloguj się ponownie” (jest na stronie głównej Ustawień). | — | `TabHeader.tsx`, `SettingsScreen.tsx` | U11 | niska (decyzja PW-28 / D188: pasek tylko informuje) |

---

## Krok 3. Nowa architektura informacji

Wspólne dla wszystkich wariantów: **cztery zakładki zostają w tej samej kolejności i z tymi samymi nazwami** (Moje sprawy ·
Listy · Kalendarz · Grupy). Powody: nazwy i ikona Ustawień to świeże decyzje (D188, D193); ścieżki „Grupy → „Dołącz do
grupy”” są w wiadomościach z zaproszeniami, które ludzie już dostali (`groups.joinMessage`), i w tekstach pilnowanych testem
`texts.test.ts`; nie mam danych o użyciu, które uzasadniałyby inną kolejność. Inną kolejność albo liczbę zakładek opisuję
jako pytanie Q2.

### 3.1 Wariant A — „Poprawki w miejscu”

Bez nowych ekranów. Zmienia się:

- **A1 (Z-2, Z-3):** w Kalendarzu jeden przycisk **„Dodaj na <dzień>”** (np. „Dodaj na wtorek, 13 października”) od razu pod
  siatką dni, nad listą dnia. Otwiera formularz wydarzenia z tym dniem; „Rodzaj” prowadzi do zadania (z tym dniem — formularz
  już przenosi datę przy zmianie rodzaju, `EventEditScreen.tsx`) albo rutyny. „Dodaj rutynę” znika z Kalendarza.
- **A2 (Z-5):** podpowiedź „Więcej”: „Pełny formularz: rodzaj, grupa, osoba, termin, powtarzanie”.
- **A3 (Z-6):** „Zaplanuj zakupy” na karcie otwiera listę z otwartym planowaniem.
- **A4 (Z-7):** jedna nazwa na rzecz: „Nowa lista zadań” (Listy, ekran grupy), „Nowa lista zakupów” (też na karcie),
  „Zaproś jako administratora” (też na karcie, z dopiskiem pod przyciskiem „np. drugi rodzic”), „Dodaj dziecko (bez konta)”.
- **A5 (Z-8):** poprawka słownika (dokument, nie aplikacja).

### 3.2 Wariant B — „Uporządkowane miejsca” (rekomendowany)

Wszystko z A, a do tego:

- **B1 (Z-4):** ekran grupy w dwóch częściach, tym samym wzorem co Ustawienia (D131: strona główna i podstrony,
  `navigation.push` z parametrem `section`):
  - **Grupa** (treść, w tej kolejności): „Następne kroki” → **Osoby** (nagłówek, pod nim „Zaproś” / „Zaproś jako administratora”,
    karta kodu, „Dodaj dziecko (bez konta)” z polem, potem lista osób) → **Plany lekcji** (wiersz na dziecko; tylko grupa wspólna
    z dziećmi) → **Listy grupy** („Nowa lista zadań” / „Nowa lista zakupów” zaraz pod nagłówkiem) → **Wydarzenia grupy**
    („Dodaj wydarzenie” zaraz pod nagłówkiem, rutyna przez „Rodzaj”) → wiersz **„Ustawienia grupy”**.
  - **Ustawienia grupy** (podstrona): „W Moich sprawach” (zakres), nazwa, kolor, „Zmień ID grupy”, „Wyjdź z grupy”,
    „Usuń grupę”. Podpowiedź zakresu po dołączeniu do dużej grupy (D149) zostaje na ekranie grupy, z przyciskiem do podstrony.
- **B2 (Z-9):** Kosz staje się osobnym ekranem otwieranym wierszem **„Kosz”** w Grupach, zaraz pod „Ostatnie zmiany”. Ścieżki
  „Grupy → Kosz” w tekstach i w polityce prywatności dalej są prawdziwe. Otwarcie usuniętej rzeczy z linku dalej pokazuje
  „W koszu” z „Przywróć”.
- **B3 (Z-10, po Twojej decyzji Q5):** „Do potwierdzenia” nad polem dodawania.
- **B4 (Z-1, po Twojej decyzji Q3):** odwołany termin widoczny w Kalendarzu jako wyszarzony wiersz „Odwołany: Basen”, który
  otwiera ekran wydarzenia z „Przywróć” (tylko dla dorosłych; w Moich sprawach bez zmian).

### 3.3 Wariant C — „Jeden przycisk Dodaj”

Wszystko z B, a do tego przycisk **„Dodaj”** (ikona plusa, etykieta VoiceOver „Dodaj”, Large Content Viewer jak na pasku) w
nagłówku każdej zakładki, obok Ustawień. Otwiera wybór: Zadanie · Wydarzenie · Rutyna · Produkt na listę zakupów · Lista ·
Grupa · Dołącz do grupy. Podpowiada z kontekstu: dzień wybrany w Kalendarzu, grupę z ekranu grupy. Znikają przyciski
dodawania z Kalendarza, Wydarzeń grupy i dół zakładek Listy i Grupy. Pole dodawania w Moich sprawach i na listach zostaje.

### 3.4 Kompromisy wariantów

| | A | B (rekomendowany) | C |
|---|---|---|---|
| Co naprawia | Z-2, Z-3, Z-5, Z-6, Z-7, Z-8 | A + Z-4, Z-9; Z-1 i Z-10 po decyzji | B + jedno miejsce dodawania |
| Nowe ekrany | 0 | 2 (podstrona grupy — ten sam komponent z parametrem; ekran Kosza) | 3 (B + arkusz wyboru) |
| Obecni testerzy | Przycisk w Kalendarzu przesunięty wyżej i przemianowany; reszta bez zmian | Jak A + nazwa, kolor, zakres, wyjście i usunięcie grupy przenoszą się o 1 stuknięcie głębiej (do „Ustawień grupy”); Kosz pod wierszem | Jak B + nowy wzorzec dodawania; każde dodanie z formularza o 1 stuknięcie dłuższe |
| Dostępność (VoiceOver) | Nowa etykieta przycisku z dniem — czytelniejsza | Krótsza kolejność na ekranie grupy; nowa podstrona potrzebuje fokusu na tytuł (jak inne podstrony) | Ikona bez napisu: wymaga etykiety, podpowiedzi i Large Content Viewer; arkusz wyboru to kolejny ekran do audytu XCUITest |
| Małe ekrany | Bez zmian | Lepiej: krótszy ekran grupy | Nagłówek z dwiema ikonami i stanem synchronizacji — mniej miejsca na tekst stanu |
| Duży tekst / AX5 | Lepiej: przycisk dodawania na pierwszym–drugim ekranie Kalendarza | Lepiej: rzadkie ustawienia grupy nie wydłużają treści | Najlepiej dla dodawania (zawsze na górze), ale „Dodaj na wtorek, 13 października” przy AX5 to 2–3 linie |
| Ciemny wygląd | Bez nowych kolorów | Bez nowych kolorów | Nowa ikona — sprawdzenie kontrastu w obu trybach |
| Tłumaczenia | Aplikacja jest tylko po polsku (D30); dłuższe etykiety z datą trzeba sprawdzić przy AX5 | jw. | jw. + krótkie nazwy w arkuszu |
| Teksty ze ścieżkami („A → B”, test `texts.test.ts`) | bez zmian | Ścieżki do nazwy, koloru i wyjścia z grupy zmieniają się: „Grupy → grupa → Ustawienia grupy”; „Co nowego” i polityka (Kosz, zakres) — do przejrzenia | jw. |
| E2E (.maestro) | 04 i 08 dotykają `calendar-add-event` przez przewijanie — prościej (bez `scroll-tap`); nowe zrzuty 04 i 08 w 8 wariantach | jw.; scenariuszy grup nie ma, więc E2E bez zmian poza 04 i 08 | 02, 04, 05, 08 do przepisania (inne dodawanie); nowe zrzuty wszystkich zakładek (nagłówek) w 8 wariantach |
| Testy ekranów (RNTL) | `calendar-add-event` w 10 plikach (24 wystąpienia), `calendar-add-routine` w 8 (12) | A + `groups.screens`, `child`, `undo-trash` i inne z polami grupy; `screen-groups` w 5 plikach | B + wszystkie testy dodawania (`add-more` 7 plików / 36, „Nowa lista” 10 / 16) |
| Nakład agenta (z pracą równoległą) | ok. 1 sesji | ok. 2–3 sesji | ok. 4–5 sesji |
| Na co się czeka | CI; nocne E2E (ok. 2 h 10 min, maszyny macOS bez opłat w repozytorium publicznym); build TestFlight | jw. | jw. |
| Czas właściciela | decyzje Q1, Q6, Q7; test na telefonie | + Q3, Q4, Q5 | + przyzwyczajenie testerów |

**Rekomendacja: B.** Naprawia wszystkie problemy z kroku 2 poza Z-11 i Z-12 (te zostawiam, bo wynikają z decyzji
PW-28 / D188 albo są wyjątkowe). Nie dokłada stuknięć do częstych przepływów. Zmiany wydłużają tylko rzadkie
(ustawienia grupy: +1, bez przewijania). C daje jedno miejsce dodawania, ale każde dodanie z formularza jest dłuższe o 1,
a pole dodawania i tak zostaje — byłyby dwie drogi do tego samego, a nowy wzorzec musieliby poznać wszyscy testerzy.

### 3.5 Każdy przepływ na nowej ścieżce (stuknięcia przed → po)

Przepływy niewymienione z nazwą w kolumnie „Ścieżka w B” mają tę samą ścieżkę co dziś.

| ID | Ścieżka w wariancie B | Dziś | A | B | C |
|---|---|---|---|---|---|
| S1–S6, S8–S12 | bez zmian | 0–5 | = | = | = |
| S7 | „Zaplanuj zakupy” na karcie → lista z otwartym planowaniem | 5 | 4 | 4 | 4 |
| C1–C9, C11–C18 | bez zmian (Moje sprawy) | 0–3 | = | = | = (C3–C5: pole zostaje) |
| C10 | „Do potwierdzenia” nad polem (po Q5) | 1 (+P przy AX5) | 1 (+P) | 1 | 1 |
| P1–P3 | bez zmian | 1–2 | = | = | = |
| P4 | Kalendarz → dzień → „Dodaj na <dzień>” (pod siatką) → formularz | 10–11 + P | 10–11 | 10–11 | 11–12 (Dodaj + Wydarzenie; dzień z kontekstu) |
| P4′ (nowe: zadanie na dzień z Kalendarza) | Kalendarz → dzień → „Dodaj na <dzień>” → Rodzaj: Zadanie → „Zapisz zadanie” | brak (z pola: 2) | 5 | 5 | 4 |
| P5–P11, P14–P20 | bez zmian | jw. | = | = | = |
| P12 (z Kalendarza) | Kalendarz → „Dodaj na <dzień>” → Rodzaj: Rutyna | 3 + P | 4 | 4 | 3 |
| P12 (z grupy) | Grupy → grupa → „Dodaj wydarzenie” (pod nagłówkiem) → Rodzaj: Rutyna | 4 + P | 4 + P | 5 | 5 |
| P9 (przywrócenie odwołanego terminu, każdy dorosły) | Kalendarz → dzień → wiersz „Odwołany: …” → „Przywróć” (po Q3) | 3 + P (tylko autor) | = | 4 | 4 |
| P13 | Grupy → grupa → „Plany lekcji” (wyżej na ekranie) → plan | 5 + P | 5 + P | 5 | 5 |
| Z1–Z7, Z9 | bez zmian | jw. | = | = | = |
| Z8 | Listy → „Nowa lista zakupów” | 4–6 | = | = | 5–7 |
| Z10 | Listy → „Nowa lista zadań” | 3 | 3 | 3 | 4 |
| G1, G4 | Grupy → „Nowa grupa” / „Dołącz do grupy” | 3 | = | = | 3 (z „Dodaj” też 3) |
| G2 | Grupy → grupa → „Zaproś” (pod nagłówkiem Osoby) | 4 + P | 4 + P | 4 | 4 |
| G3 | bez zmian (karta kodu) | 1–2 | = | = | = |
| G5 | Grupy → grupa → pole „Imię dziecka” (pod nagłówkiem Osoby) | 4 + P | 4 + P | 4 | 4 |
| G6, G7 | Grupy → grupa → osoba | 4–5 + P | = | 4–5 | 4–5 |
| G8 | Grupy → grupa → „Ustawienia grupy” → zakres | 3 | 3 | 4 | 4 |
| G9 | Grupy → grupa → „Ustawienia grupy” → nazwa / kolor | 3 + P | 3 + P | 4 | 4 |
| G10, G11 | Grupy → grupa → „Ustawienia grupy” → przycisk → potwierdzenie | 4 + P | 4 + P | 5 | 5 |
| G12 | przesunięcie w Grupach albo „Ustawienia grupy” → „Usuń grupę” | 2–3 | = | 2–3 | 2–3 |
| G13, G14 | bez zmian | 0–2 | = | = | = |
| H1–H4, H7–H9 | bez zmian | jw. | = | = | = |
| H5 | Grupy → „Ostatnie zmiany” (Kosz już nie wydłuża zakładki) | 3 + P | 3 + P | 3 | 3 |
| H6 | Grupy → „Kosz” → „Przywróć” | 2–3 + P | 2–3 + P | 3 | 3 |
| U1–U14 | bez zmian | jw. | = | = | = |
| N1–N5 | poza tym zakresem (pytanie Q8) | — | — | — | — |

### 3.6 Każdy element nawigacyjny w B wynika z przepływu

| Element (B) | Przepływy |
|---|---|
| Zakładki Moje sprawy · Listy · Kalendarz · Grupy | C1–C18 · Z1–Z10 · P2–P4, P12 · G1–G14, H5, H6 |
| Ikona Ustawień; stan synchronizacji | U1–U13, H7 · C16, U11 |
| Moje sprawy: pole, „Więcej”, chipy, „Zakres”, strzałki, „Dziś”, „Do potwierdzenia”, karty | C1–C18, P1, P3, P5, S8, S10 |
| Kalendarz: „Dodaj na <dzień>” | P4, P4′, P12 |
| Listy: „Nowa lista zakupów”, „Nowa lista zadań” | Z8, Z10 |
| Grupy: „Nowa grupa”, „Dołącz do grupy”, „Ostatnie zmiany”, „Kosz” | G1, G4, H5, H6 |
| Grupa: Osoby + „Zaproś…”, „Dodaj dziecko (bez konta)”, „Plany lekcji”, „Listy grupy” + nowe listy, „Wydarzenia grupy” + „Dodaj wydarzenie”, „Ustawienia grupy” | G2, G3, G5–G7, P13, Z8, Z10, P4, P12, G8–G12 |
| Ustawienia grupy: zakres, nazwa, kolor, „Zmień ID grupy”, „Wyjdź z grupy”, „Usuń grupę” | G8–G12 |
| Kosz | H6 |

### 3.7 Kolejność wdrożenia (wariant B), małe kroki

Każdy krok: osobny commit z testami (najpierw test, który pokazuje stary błąd — tam, gdzie to błąd), `npm run check`
zielone, E2E wariant bazowy w PR, wszystkie 8 wariantów nocą, potem wydanie. Kroki 1–3 mogą iść w jednym buildzie TestFlight.

| Krok | Zakres | Testy do zmiany | Ryzyko | Wydawalny sam? |
|---|---|---|---|---|
| K1 | Teksty: podpowiedź „Więcej” (Z-5), jedna nazwa na rzecz (Z-7); słownik (Z-8) | `texts.test.ts` (ścieżki, cudzysłowy), testy ekranów szukające napisów „Nowa lista” (10 plików), „Zaproś partnera…” | niskie | tak |
| K2 | „Zaplanuj zakupy” z karty otwiera planowanie (parametr trasy `List`) (Z-6) | `groups.screens`, `shopping-trip.screens` | niskie | tak |
| K3 | Kalendarz: „Dodaj na <dzień>” pod siatką; „Dodaj rutynę” do „Rodzaju” (Z-2, Z-3) | RNTL: `calendar-add-event` (10 plików), `calendar-add-routine` (8); E2E 04, 08 + nowe zrzuty | średnie (dwa scenariusze E2E, zrzuty w 8 wariantach) | tak |
| K4 | Ekran grupy: nowa kolejność sekcji i dodawanie pod nagłówkami (część B1 bez podstrony) | `groups.screens`, `child.screens`, `routine.screens`, `timetable.screens` | średnie (VoiceOver: nowa kolejność czytania) | tak |
| K5 | „Ustawienia grupy” jako podstrona (B1) + teksty ze ścieżkami („Co nowego” na nowy build, polityka — jeśli wymienia te miejsca) | `groups.screens`, `undo-trash.screens`, `texts.test.ts`, `privacy-policy.contract.test.ts` | średnie (przyzwyczajenia testerów: +1 stuknięcie) | tak |
| K6 | Kosz jako osobny ekran (B2) | `undo-trash.screens`, `groups.screens`, `screen-groups` (5 plików) | niskie | tak |
| K7 | Po Q3: odwołany termin w Kalendarzu z „Przywróć” (B4) | logika `events.ts` (100% pokrycia, mutacje), `events.screens`, `series-chain.screens` | średnie (logika serii; przypomnienia i lustro nie mogą brać odwołanych) | tak |
| K8 | Po Q5: „Do potwierdzenia” nad polem (B3) | `handoffs.screens`, E2E 01 (zrzut), `my-days.screens` | niskie | tak |

Po każdym kroku: backlog (04) i changelog (05) aktualizuje sesja koordynująca.

---

## [DO WYJAŚNIENIA]

1. **Częstość przepływów.** Wszystkie „codziennie / kilka razy w tygodniu / rzadko” to założenia. Aplikacja nie mierzy
   użycia (D80 — tylko błędy i uwagi). Gdy zechcesz to sprawdzić: krótka ankieta wśród testerów albo zliczanie otwarć ekranów
   (zmiana prywatności, trzeba by dopisać do polityki).
2. **Liczba stuknięć w oknach systemowych** (logowanie Apple, zgody iOS) zależy od ustawień telefonu — liczę 1–2, nie mierzyłem.
3. **Najmniejszy ekran.** Aplikacja wymaga iOS 16.4 (`app.json`). Czy obejmuje to iPhone’y węższe niż najmniejszy telefon
   w E2E (iPhone 17e)? Nie sprawdzałem tego na liście urządzeń Apple. iPad: `supportsTablet: true`, a układu iPada E2E nie
   sprawdza.
4. **Ile przewijania przy AX5** do treści Moich spraw i do przycisków na końcu ekranów — oceniam tylko z komentarzy
   w scenariuszach E2E, bez pomiaru zrzutów.
5. **Zapis imienia przy starcie bez sieci (S2)** — komunikatu nie sprawdzałem w kodzie domeny (`domain/views/my-name`).
6. **„Dane z nowszej wersji” (S12):** czy czyszczenie zabiera zmiany czekające w kolejce — nie sprawdzałem `rebuildNewer`.

## Pytania do właściciela (pojedynczo)

**Q1. Który wariant nowej nawigacji?**
- A — poprawki w miejscu: najmniej zmian dla testerów, ale ekran grupy zostaje długi.
- B — uporządkowane miejsca: krótszy ekran grupy, Kosz osobno; rzadkie ustawienia grupy o 1 stuknięcie dalej.
- C — wspólny przycisk „Dodaj”: jedno miejsce dodawania, ale każde dodanie z formularza dłuższe o 1 i nowy wzorzec.
- **Rekomendacja: B**, w krokach K1–K8.

**Q2. Czy zmieniać zakładki?**
- a) Zostawić cztery w obecnej kolejności: bez zmian w przyzwyczajeniach i w tekstach ze ścieżkami.
- b) Zamienić miejscami Listy i Kalendarz: planowanie obok przeglądu dnia; bez danych o użyciu to zgadywanie.
- c) Scalić Listy z Grupami: o jedną zakładkę mniej, ale zakupy (częste) o 1–2 stuknięcia dalej.
- **Rekomendacja: a.**

**Q3. Odwołany termin serii — gdzie ma być widać, że go odwołano?**
- a) W Kalendarzu wyszarzony wiersz „Odwołany: …”, który otwiera ekran wydarzenia z „Przywróć” (każdy dorosły w grupie).
  Kosztuje zmianę logiki serii i jej testy.
- b) Jak dziś: tylko „Ostatnie zmiany” u osoby, która odwołała.
- c) W Koszu jako osobny rodzaj „Odwołane terminy”: jedno miejsce przywracania, ale Kosz dziś trzyma tylko usunięte rzeczy.
- **Rekomendacja: a.**

**Q4. Gdzie Kosz i „Ostatnie zmiany”?**
- a) W Grupach, jako dwa wiersze pod listą grup; Kosz na osobnym ekranie. Teksty „Grupy → Kosz” zostają prawdziwe.
- b) W Ustawieniach (strona główna): ładnie razem z „Odrzuconymi zmianami”, ale to nie są ustawienia, a teksty i polityka
  prywatności do zmiany.
- c) Jak dziś (Kosz rozwinięty na końcu Grup).
- **Rekomendacja: a.**

**Q5. „Do potwierdzenia” w Moich sprawach — nad polem dodawania?**
- a) Tak: pilne przekazania na pierwszym ekranie także przy dużym tekście; pole dodawania przesuwa się niżej, gdy coś czeka.
- b) Nie, jak dziś (PWD-31 A: nad kartami informacyjnymi, pod paskiem okresu).
- **Rekomendacja: a.**

**Q6. Dodawanie w Kalendarzu.**
- a) Jeden przycisk „Dodaj na <dzień>” pod siatką, rodzaj w formularzu (wydarzenie, zadanie, rutyna).
- b) Dwa przyciski pod siatką („Dodaj wydarzenie”, „Dodaj zadanie”) i rutyna przez rodzaj: o jedno stuknięcie krócej
  do zadania, więcej elementów na ekranie.
- c) Jak dziś (na końcu treści).
- **Rekomendacja: a.**

**Q7. Nazwa przycisku zaproszenia administratora na karcie „Następne kroki”.**
- a) „Zaproś jako administratora” wszędzie, z dopiskiem „np. drugi rodzic”: jedna nazwa.
- b) Zostawić „Zaproś partnera (administrator)” na karcie: cieplej, ale dwie nazwy jednej rzeczy.
- **Rekomendacja: a.**

**Q8. Przepływy „NOWY” z dawnych decyzji (widżet, import ze zdjęcia, ICS, pochwała dla dziecka, logowanie e-mailem).**
- a) Zostawić w backlogu do opinii testerów po zmianach nawigacji.
- b) Zaplanować teraz widżet (D17, „Faza 1”): najbardziej widoczny, ale wymaga przeniesienia pliku bazy do kontenera app group
  (migracja danych — próg wydania „utrata danych”).
- c) Skreślić pochwałę (D19), skoro licznik „N razy z rzędu” celowo niczego nie nagradza (ADR 0028).
- **Rekomendacja: a**, a o c zdecyduj osobno.
