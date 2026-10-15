# 0050. Widżet iOS dla widoku „Moje sprawy” (15.10.2026)

Decyzja właściciela z 15.10.2026: wdrożenie widżetu iOS (D17, BRD B4) dla widoku „Moje sprawy” na ekran początkowy oraz ekran blokady iPhone'a (WidgetKit + SwiftUI).

## Kontekst i problem

Użytkownicy potrzebują szybkiego dostępu do listy najważniejszych spraw i wydarzeń na dany dzień bez konieczności każdorazowego otwierania aplikacji.
Dotychczasowe wymaganie (D17, BRD B4, ADR 0049 Q8) czekało w backlogu na decyzję architektoniczną dotyczącą sposobu dostarczania danych do rozszerzenia Widget Extension.

Rozważano dwa warianty architektoniczne:
1. **Wariant 1 (Zatwierdzony): Lekki zrzut JSON do pamięci współdzielonej App Group (`UserDefaults` + plik `today-widget.json`).**
   Aplikacja przy każdej zmianie stanu, przy wejściu w tło (`AppState === 'background'`) oraz po cichym powiadomieniu w tle generuje precyzyjny zrzut danych JSON dla bieżącego dnia i wywołuje `WidgetCenter.shared.reloadAllTimelines()`.
2. **Wariant 2 (Odrzucony): Współdzielona baza SQLite w kontenerze App Group.**
   Wymagałby migracji plików baz danych wszystkich użytkowników, nieliniowej synchronizacji połączeń SQLite oraz niósł ryzyko przekroczenia limitu 30 MB pamięci RAM narzucanego procesom WidgetKit przez system iOS.

## Decyzja

1. **Format danych:** Zrzut JSON w formacie `WidgetPayload` (wersja 1):
   - `today` (data ISO), `dayLabel` (sformatowany dzień tygodnia i data w języku polskim),
   - `totalRemainingCount` (liczba pozostałych spraw na dziś),
   - `items`: lista do 5 najbliższych spraw z identyfikatorami, tytułem, godziną, kolorem wstążki grupy (`groupColor`), oznaczeniem zaległości (`isOverdue`) oraz deep linkami (`organizer://task/<id>`, `organizer://event/<id>`, `organizer://list/<id>`, `organizer://today`).
2. **Domena:** Czysty moduł domeny `src/domain/views/widget.ts` (`buildWidgetPayload`) korzystający z silnika `myDays` w trybie `'day'`. Gwarantuje 100% spójności reguł z głównym ekranem „Moje sprawy” (filtry, uprawnienia, rolowanie zaległości, podgląd zadań dzieci).
3. **Aktualizacja i prywatność:**
   - Moduł `src/app/widget-updater.ts` wywoływany w `SignedInApp`, po przejściu w tło oraz w zadaniu tła `refreshInBackground`.
   - Przy wylogowaniu lub usunięciu konta wywoływane jest `clearSnapshot()`, usuwające dane z App Group i czyszczące widżet.
4. **Mostek natywny:** Lokalny moduł Expo `modules/widget-bridge` z `WidgetBridgeModule.swift` i `WidgetBridge.podspec`.
5. **Widżet SwiftUI:** Kod rozszerzenia WidgetKit w `targets/widget/OrganizerWidget.swift`:
   - `systemSmall`: licznik spraw, status wykonania („Wszystko zrobione!”), pierwsza sprawa z godziną i kolorem grupy,
   - `systemMedium`: nagłówek z datą i licznikiem, lista do 3 spraw z kolorowymi wstążkami, godzinami i bezpośrednimi deep linkami,
   - `accessoryInline` oraz `accessoryRectangular`: widżety ekranu blokady iOS 16+.
