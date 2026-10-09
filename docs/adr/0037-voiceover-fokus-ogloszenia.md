# 0037. VoiceOver: ogłoszenia, fokus, etykiety i klawiatura (audyt 2, 8.10.2026)

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
| Rozwijanie (M-141, M-144) | `accessibilityState.expanded` i podpowiedź zależna od stanu („Rozwija kalendarz” / „Zwija kalendarz”, „Pokazuje lekcje” / „Chowa lekcje”); wiersz lekcji ma ˅/˄ zamiast „›” i bez „dotknij, by…”. Pola daty i godziny: etykieta = podpis, wartość raz i słownie | „zwinięte” w etykiecie |
| „Bez dnia” (M-125) | `DateField optional` — „Bez dnia” w rozwiniętym kalendarzu, jak „Bez godziny”; w każdym terminie (`DueFields`) i w „Do dnia” planu lekcji | Osobne przyciski na ekranach |
| Kontekst opcji (M-264, M-265) | `Segmented contextual`, gdy kilka pól ma te same opcje (kalendarze, wyciszenia, obecność kilku osób): „Włączone, Praca”. Przyciski kart przekazań z tytułem („Przyjmij: Basen”) | Kontekst w każdej opcji każdego pola (dłuższe wypowiedzi bez potrzeby) |
| Zajętość (M-267) | `Button busy` — wskaźnik postępu i `accessibilityState.busy` | Samo wyszarzenie |

Do sprawdzenia na iPhonie z VoiceOverem: czy fokus po `FOCUS_DELAY_MS` (100 ms) trafia w panel i tytuł (a nie wraca
na „Wróć” po ogłoszeniu zmiany ekranu przez iOS), czy pasek kart mówi „karta 1 z 4”, wymowa dopisków, czynność „Usuń”
w pokrętle, „Gotowe” nad klawiaturą numeryczną.
