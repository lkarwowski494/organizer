# 0049. Pasek „Cofnij”: reaguje na dotknięcie, nie na przeciągnięcie (13.10.2026)

Decyzja właściciela z 13.10.2026, wariant A. Dotyczy paska na dole ekranu („W koszyku · Cofnij”, po zapisie, „Dodaj”,
„Zmień”, „Zobacz”) z D194 i M-38.

## Problem
Przy największym tekście (AX5) pasek jest wysoki. Przeciągnięcie palcem (przewijanie) zaczęte i puszczone na pasku
wykonywało akcję jak dotknięcie: otwierało „Ostatnie zmiany” (E2E 38220289381, 38237288337), a zaczęte na „Cofnij” —
cofało. Przyczyna: przyciski paska to `Pressable` z `onPress`, a React Native wykonuje `onPress` także po ruchu palca,
dopóki puszczenie mieści się w marginesie wokół przycisku (`pressRetentionOffset`, domyślnie 20/30 pt;
https://reactnative.dev/docs/0.86/pressable#pressretentionoffset). Pasek leży nad ekranem, poza `ScrollView`, więc nic
nie anulowało dotknięcia przy przewijaniu. Przy zwykłym tekście pasek jest niski i ruch rzadko kończy się na nim.

## Decyzja: (A) tylko dotknięcie
Akcja przycisków paska (treść, „Cofnij”/„Zmień”/„Zobacz”, „Zamknij”) idzie przy puszczeniu palca (`onPress`), i tylko gdy
palec między dotknięciem (`onPressIn`) a puszczeniem przesunął się o najwyżej `layout.TAP_SLOP` (10 pt). Dalej to
przeciągnięcie i nic się nie dzieje. Bez zdarzenia (dotknięcie z VoiceOvera) akcja idzie zawsze. Etykiety, role i
podpowiedzi VoiceOvera bez zmian. Kod: `isTap` w `src/domain/tap.ts`, `tap()` w `src/ui/undo.tsx`. Wartość 10 pt to
nasz wybór (nie z dokumentacji Apple); test: `undo-trash.screens.test.tsx`.

Inne miejsca ze wzorcem press-in / responder grant: `Intro` (pominięcie animacji startowej na press-in — celowo, nie ma
tam przewijania ani akcji z danymi) i `ReorderRows` (przeciąganie wierszy to właśnie gest). Nie zmieniamy.

## Odrzucony wariant
**(B) Zostawić** — przeciągnięcie na pasku dalej działa jak dotknięcie, a scenariusze E2E czekają na zniknięcie paska.
Odrzucony: to nie jest zachowanie systemowych przycisków iOS, a przypadkowe otwarcie „Ostatnich zmian” albo cofnięcie
zmiany przy przewijaniu psuje zaufanie do paska (najbardziej przy dużym tekście, którego używają osoby słabowidzące).
