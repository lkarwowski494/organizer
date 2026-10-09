# 0039. VoiceOver: ogłoszenia, fokus, etykiety i klawiatura (audyt 2, 8.10.2026)

Decyzje techniczne Claude'a przy paczce P14a (M-37…M-44, M-125, M-141…M-150, M-263…M-269, część D194 o VoiceOverze);
właściciel może je zawetować. Numer D nada koordynator przy scaleniu.

Na iOS rola „alert”, `accessibilityLiveRegion` oraz role „tab”/„tablist”/„radiogroup” niczego nie dają (React Native
0.86, `accessibilityPropsConversions.h` — brak gałęzi; `accessibilityLiveRegion` „Android”), a stan „zwinięte” nie jest
czytany (RN dopisuje tylko „rozwinięte”). Dlatego jeden wspólny mechanizm w `src/ui/a11y.ts` i w klockach
`src/ui/components.tsx`, bez kodu na poszczególnych ekranach:

| Sprawa | Decyzja | Odrzucone |
|---|---|---|
| Ogłoszenia (M-37, M-39) | `announce()` = `announceForAccessibilityWithOptions(…, { queue: true })` — nie przerywa bieżącej wypowiedzi. `ErrorText` (czerwony) i `StatusText` (potwierdzenie, np. „Dodano do kalendarza.”) ogłaszają się, gdy się pojawią albo zmienią; wszystkie błędy formularzy idą przez `ErrorText`. Wskaźnik synchronizacji ogłasza tylko wejście w problem (offline, błąd, wygasła sesja, „zaktualizuj”) i powrót do normy (`syncAnnouncement`, `Root.tsx`) | Ogłoszenie przy każdej zmianie chipu („Synchronizuję…”, „5 min temu”) |
| Pasek „Cofnij” przy VoiceOverze (D194) | Bez zmian względem D194 (nie znika sam, fokus na treść, „Zamknij”); fokus przez wspólne `focusLater`. Pasek pokazany tuż przed przejściem na inny ekran ma pierwszeństwo przed tytułem nowego ekranu przez `config.a11y.PIN_MS` | Ogłoszenie treści paska obok fokusu (dwa razy to samo) |
| Fokus paneli (M-44) | Panel w miejscu przycisku (pytanie o zakres, wybór osoby, spotkania, potwierdzenia, Pierwsze kroki) przenosi fokus VoiceOvera na swój nagłówek (`PanelTitle`), pytanie (`ConfirmText`), pole (`Field a11yFocus`) albo przycisk (`Button a11yFocus`) po `config.a11y.FOCUS_DELAY_MS` | Same ogłoszenia (przycisk z fokusem znika, iOS przenosi fokus na początek ekranu) |
| Tytuł ekranu (M-269) | `Title` dostaje fokus po zakończeniu przejścia na stosie (`transitionEnd`, także powrót); przełączenie zakładki fokusu nie przenosi (jak w aplikacjach systemowych) | Pozostawienie fokusu na „Wróć” / chipie synchronizacji |
| Zakładki (M-40) | Pasek `tabbar` (cecha paska kart), zakładki `button` na iOS (jak React Navigation) | Powrót do standardowego paska (zmiana wyglądu) |
| Klawiatura (M-41, M-268) | `automaticallyAdjustKeyboardInsets` na przewijanym `Screen`; pole z klawiaturą numeryczną ma nad nią „Gotowe” (`InputAccessoryView`); pola mojego imienia `textContentType="givenName"` | Nowa zależność natywna (keyboard-controller) |
| Wiersze (M-142, M-150, M-263) | Etykieta od tytułu, czynność w podpowiedzi („Otwiera zadanie”), dopiski słowami (`spoken`: „podzadanie:”, „2 z 3 zrobione”, „1 godzina 30 minut”, przecinek zamiast „·”), „czeka na wysłanie”, „minione”; bez niewidocznego „powtarza się”. Wiersz bez otwierania to zwykły element z etykietą. Usuwanie przesunięciem to czynność VoiceOvera wiersza („Usuń”/„Odwołaj”), a przycisk poza ekranem znika z kolejności VoiceOvera. Pole odhaczenia zostaje osobnym elementem (widoczne, ze stanem, dostępne dla Sterowania głosem) | Odhaczanie też jako czynność wiersza z ukrytym polem (stan „zrobione” tylko w etykiecie, Sterowanie głosem traci pole) |
| Rozwijanie (M-141, M-144) | `accessibilityState.expanded` (zmienione w audycie 3 — niżej) i podpowiedź zależna od stanu („Rozwija kalendarz” / „Zwija kalendarz”, „Pokazuje lekcje” / „Chowa lekcje”); wiersz lekcji ma ˅/˄ zamiast „›” i bez „dotknij, by…”. Pola daty i godziny: etykieta = podpis, wartość raz i słownie | „zwinięte” w etykiecie |
| „Bez dnia” (M-125) | `DateField optional` — „Bez dnia” w rozwiniętym kalendarzu, jak „Bez godziny”; w każdym terminie (`DueFields`) i w „Do dnia” planu lekcji | Osobne przyciski na ekranach |
| Kontekst opcji (M-264, M-265) | `Segmented contextual`, gdy kilka pól ma te same opcje (kalendarze, wyciszenia, obecność kilku osób): „Włączone, Praca”. Przyciski kart przekazań z tytułem („Przyjmij: Basen”) | Kontekst w każdej opcji każdego pola (dłuższe wypowiedzi bez potrzeby) |
| Zajętość (M-267) | `Button busy` — wskaźnik postępu i `accessibilityState.busy` (zmienione w audycie 3 — niżej) | Samo wyszarzenie |

Do sprawdzenia na iPhonie z VoiceOverem: czy fokus po `FOCUS_DELAY_MS` (100 ms) trafia w panel i tytuł (a nie wraca
na „Wróć” po ogłoszeniu zmiany ekranu przez iOS), czy pasek kart mówi „karta 1 z 4”, wymowa dopisków, czynność „Usuń”
w pokrętle, „Gotowe” nad klawiaturą numeryczną.

## Audyt 3 (9.10.2026, paczka PK-21)

RN 0.86 na iOS dopisuje do wartości elementu **angielskie** słowa: rola „checkbox” → „checkbox”, „radio” → „radio button”,
`accessibilityState.checked` → „checked/unchecked”, `expanded: true` → „expanded”, `busy: true` → „busy”
(`RCTViewComponentView.mm`, `accessibilityValue`; `React/I18n/strings/pl.lproj/Localizable.strings` jest pusty). Opis
„role czytane jak tekst” wyżej był niepełny.

| Sprawa | Decyzja | Odrzucone |
|---|---|---|
| Stany (N-9) | Jeden helper `buttonA11y` (`src/ui/a11y.ts`): rola zawsze „button”; zaznaczenie i wybór (pole odhaczenia, opcje, dni tygodnia, uczestnicy) — cechą `selected`; rozwinięcie i „w toku” — polską wartością („rozwinięte”, „w toku”) po wartości pola. Bez ról „radiogroup”/„radio”/„checkbox”. `checked` tylko przy systemowym przełączniku (`SwitchRow`) | Tłumaczenia w pakiecie RN (patch-package; zależne od wnętrza RN, role dalej bez „przycisk”) |
| Audyt drzewa (N-59, N-202) | Reguły 10–17 w `a11y-audit.ts` (pole tekstowe z etykietą, przycisk w elemencie `accessible`, `accessible={false}` nie ukrywa dzieci, kontrast zagnieżdżonego tekstu, powtórzone etykiety na ekranie, szerokość procentowa od rodzica, `minimumFontScale`, zakaz stanów ze słowami RN); kontrast pola stanu według stanu, nie roli; znane odstępstwa z limitem liczby; osobny test z „Zwiększ kontrast” i „Pogrubionym tekstem” (`a11y-prefs.test.tsx`) | Część reguł tylko w XCUITest na symulatorze (wolniej, tylko macOS) |
| Ogłoszenia (N-60, N-194, N-198) | Nowy okres po strzałkach/„Dziś” ogłasza `PeriodTitle`; ten sam błąd przy kolejnym „Zapisz” — licznik prób `useFormError` → `ErrorText attempt`; powrót synchronizacji do normy dopiero po `config.a11y.SYNC_CALM_MS` bez problemu (`syncAnnouncer`) | Ogłaszanie tylko wejścia w problem |
| Fokus (N-62, N-63) | Po zamknięciu panelu fokus wraca na pole albo przycisk, który go otworzył (`useClosedPanel` + `a11yFocus`/`useA11yFocus`; po „Anuluj” w pytaniu pod polem dodawania — do pola); nagłówek ekranu zadania (linia grupy) i powód na ekranie „brak obiektu” dostają fokus po przejściu jak `Title` | Samo ogłoszenie wybranej wartości |
| Etykiety (N-64…N-66, N-195, N-196, N-199) | Dzień tygodnia: widoczny skrót i dzień z przyimkiem („wt., we wtorek”, `WEEKDAYS_ON`); `spoken()` także w ostrzeżeniu wiersza, „Wyjdź o…”, pasku „Dodano”, podpisie `NavRow` i szczegółach wydarzenia, skrót dnia słowem; chipy szybkiego dodawania — etykieta = widoczny napis, podpowiedź bez nazwy gestu; widoczny podpis pola ukryty (pole ma tę samą etykietę); powód nieaktywnej godziny tylko w notce; kontekst w opcjach lekcji, wariantach wydarzenia i „Dodaj stałą pozycję” | Etykiety bez skrótu („w środę”) — niezgodne z WCAG 2.5.3 |
| Cel dotyku (N-193) | Planowanie zakupów (pola) na tle ekranu, nie w karcie — dni mini kalendarza ≥ 44 pt | Mniejsze marginesy panelu w karcie (43 pt) |

Do sprawdzenia na iPhonie z polskim VoiceOverem: brzmienie cechy „wybrane” na polu odhaczenia i opcjach, „rozwinięte”
i „w toku” po wartości, odczyt „wt., we wtorek”, fokus po zamknięciu paneli; „Odwróć kolory (inteligentnie)” a kolory
grup (N-201 — bez zmian w kodzie do obejrzenia na urządzeniu).
