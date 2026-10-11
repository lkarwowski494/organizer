# 0045. Animacja przy starcie „Splątane i się rozplatają” (10.10.2026)

Decyzja właściciela z 10.10.2026: animacja przy starcie aplikacji wzorowana na jego aplikacji Trening, z ikoną Organizera
„Wstążki” (D72, D74). Wariant: **„Splątane i się rozplatają”** — na ekranie startowym trzy wstążki ikony to krótkie,
splątane kawałki porozrzucane w nieładzie; w locie na swoje miejsce każda wydłuża się do pełnej długości i wplata w „O”
ikony, kolejno niebieska, pomarańczowa, terakota. Nieład w porządek. Układ startowy zawsze ten sam, a ekran startowy
pokazuje dokładnie pierwszą klatkę. Grafika dekoracyjna — bez twierdzeń merytorycznych.

## Warunki (od właściciela, przeniesione z aplikacji Trening)
- Tylko zimny start, nie powrót z tła; proces obudzony w tle (ciche powiadomienie, D159) zużywa flagę bez animacji.
- Ok. 1 s razem ze zniknięciem (`config/intro.ts`: ruch 850 ms, zniknięcie 150 ms; wstążka 550 ms, start co 150 ms).
- Tapnięcie pomija: od razu ikona, a gdy dane gotowe — od razu aplikacja.
- „Ogranicz ruch” albo brak odpowiedzi systemu w 300 ms = bez animacji.
- Grafika ukryta dla VoiceOvera, a treść pod nakładką ukryta na czas animacji (scenariusze E2E i audyt XCUITest czekają
  na ekran, więc nie trafiają w nakładkę).
- Pierwsza klatka = ekran startowy iOS (ten sam rozmiar, położenie, tło i motyw systemu z chwili startu); ekran startowy
  chowany dopiero po zamontowaniu i narysowaniu nakładki; dane ładują się równolegle; gdy dane niegotowe po ruchu —
  ostatnia klatka (ikona) zostaje; błąd startu nie zostawia ekranu startowego na zawsze.

## Decyzje techniczne (Claude, 10–11.10.2026)
- **Jedno źródło liczb i geometrii.** Ikona jako dane: `src/config/brand-icon.ts` (ścieżki, kolory, grubość, zaokrąglone
  końce; test `brand-icon.contract.test.ts` porównuje z `assets/icon.svg`). Czasy i układ startowy: `src/config/intro.ts`.
  Klatka w chwili t: czysta funkcja `src/domain/intro.ts` (`introFrame`, `ribbonPose`), długości łuku krzywych Béziera:
  `src/domain/bezier.ts` (kwadratura Gaussa–Legendre’a). Korpus z niezależnej implementacji w Pythonie
  (`scripts/gen-intro-corpus.py`: łamana z ekstrapolacją Richardsona, macierze listy przekształceń SVG, wzór
  `Easing.inOut(Easing.cubic)` z React Native) — `npm run check:corpus`.
- **Kawałki splątane:** każda wstążka przycięta kreską `strokeDasharray [v, 2P]` + `strokeDashoffset` (dodatni, bez
  ujemnej fazy) do krótkiego odcinka, przesunięta i obrócona wokół środka ikony (skala w modelu, w układzie startowym 1);
  w ruchu przekształcenie wraca do tożsamości, a kawałek wydłuża się do pełnej ścieżki P. Przerwa 2P > P, więc widać
  dokładnie jeden kawałek — bez kropki z zaokrąglonych końców drugiej kreski. Kawałek startowy ≥ grubości wstążki (test).
  Testy: cała klatka w kwadracie ikony w każdej chwili (ekran startowy niczego nie ucina), na pierwszej klatce każde dwa
  kawałki się przecinają, ruch bez cofania.
- **Ruch w wątku UI: react-native-reanimated 4.5.1 + react-native-worklets 0.10.1** (wersje z
  `expo/bundledNativeModules.json` SDK 57; MIT), rysunek **react-native-svg 15.15.4** (MIT). `useAnimatedStyle`
  (przekształcenie widoku wstążki) i `useAnimatedProps` (kreska ścieżki) liczą pozę tym samym workletem `ribbonPose`, co
  testy i ekran startowy. Powód: `Animated` z React Native nie animuje właściwości SVG sterownikiem natywnym
  (`strokeDashoffset` szedłby klatka po klatce przez wątek JS), a start aplikacji to właśnie czas najcięższej pracy JS —
  synchroniczne otwarcie bazy i migracje (`SignedIn` w `Root.tsx`), odczyt stanu i pierwszy render nawigacji. Ruch
  w wątku JS przycinałby się dokładnie w tej sekundzie.
- **Ekran startowy:** wtyczka `expo-splash-screen` (SDK 57 bez niej: storyboard z szablonu z kolorem systemowym i bez
  obrazu). Obraz `assets/splash.png` = klatka 0 (`introSvg(0)` → `assets/brand/splash.svg` → `scripts/brand/splash.mjs`),
  przezroczysty; `imageWidth` = `intro.SPLASH_SIZE` (260 pt) — wtyczka stawia obraz o tym boku na środku ekranu
  (więzy centerX/centerY w `InterfaceBuilder.js`), nakładka rysuje ten sam kwadrat w tym samym miejscu (1 jednostka
  viewBox = 1 pt). Tło jasne `palettes.light.ground` (= tło ikony), ciemne `palettes.dark.ground`; kolory wstążek te same
  w obu motywach (do ciemnego tła każda ≥ 3:1, korpus). Bez trybu `enableFullScreenImage_legacy` („Legacy transition
  helper, will be removed”, expo-splash-screen 57 `plugin/build/types.d.ts`, https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/). `App.tsx` zatrzymuje samoczynne chowanie (`preventAutoHideAsync` w zasięgu modułu), chowa
  `Intro` po `HIDE_AFTER_FRAMES` klatkach od zamontowania, a `Root` od razu, gdy animacji nie ma.
- **Błąd startu:** „Dane z nowszej wersji” i ekran logowania liczą się jako gotowe dane (nakładka znika). Zawieszone
  ładowanie (np. sesja bez odpowiedzi) — ikona czeka najwyżej `HOLD_MAX_MS` (4 s), potem nakładka i tak znika. Wyjątek
  przy renderze bez granicy błędów kończy proces jak dotąd (ekran startowy nie zostaje na zawsze).
- **Zależność w testach:** w Jest oficjalna atrapa `react-native-worklets/src/mock` (`jest.app-setup.js`), z przywróconym
  `requestAnimationFrame` presetu React Native; `Root` bez `deps.intro` (testy ekranów) działa bez animacji.

## Odrzucone warianty animacji (wybór właściciela)
- **„Wstążki się rysują”** — wstążki rysują się po kolei wzdłuż linii; pierwszy wybór z 10.10.2026, zastąpiony pomysłem
  „Organizer składa nieład w porządek”.
- **„Rozrzucone, zawsze tak samo”** — całe wstążki płyną na miejsce; bez nowej biblioteki (obrazy w `Animated` z
  natywnym sterownikiem), ale bez wydłużania kawałków.
- **„Inny nieład przy każdym starcie”** — losowy układ; ekran startowy nie mógłby pokazać pierwszej klatki.
- **„Wstążki wjeżdżają”** — obrazki wjeżdżające z boków, bez nowej biblioteki.
- **„Cała ikona naraz”** — jedno pojawienie się ikony.

## Odrzucone rozwiązania techniczne
- **`Animated` z React Native i `useNativeDriver: false` dla kreski** — przycina się przy pracy JS w czasie startu (wyżej).
- **Mieszane: przekształcenie natywnym sterownikiem, kreska w JS** — lot płynny, ale wydłużanie skokami; nadal przycięcia.
- **Odłożenie ciężkiej pracy (baza, nawigacja) na po ruchu** — prostsze (bez Reanimated), ale start aplikacji dłuższy
  o czas animacji (~0,85 s) i kłóci się z warunkiem „dane ładują się równolegle”; nakład pracy nie był argumentem.
- **Tryb pełnoekranowy obrazu ekranu startowego (`enableFullScreenImage_legacy`, jak w aplikacji Trening)** — oznaczony
  w SDK 57 do usunięcia; obraz o stałym boku na środku daje to samo położenie na iPhonie i iPadzie.

## Co wymaga nowego buildu natywnego
react-native-svg, react-native-reanimated, react-native-worklets i expo-splash-screen mają kod natywny (Pody) — działają
dopiero w nowym buildzie (TestFlight, build 24); ekran startowy z app.json też.
