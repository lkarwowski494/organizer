/* global jest, beforeEach, afterEach */
// Testy ekranów bez ostrzeżeń „not wrapped in act” (audyt 2, M-196): takie ostrzeżenie to aktualizacja ekranu po
// asercjach (albo po końcu testu), więc test sprawdzał niepełny stan — oblewa test, w którym wystąpiło.
// Jawne wyjątki (biblioteki, nie nasz kod):
//  - BottomTabView (@react-navigation/bottom-tabs 7.20, src/views/BottomTabView.tsx): po przejściu między zakładkami
//    czyści poprzednią zakładkę timerem `setTimeout(() => setLastUpdate(…), 32)` po klatkach animacji — stan
//    wewnętrzny nawigacji, którego testy nie sprawdzają, a czekanie na niego po każdym przejściu wydłużało testy.
const ALLOWED = ['BottomTabView'];
const original = console.error;
let found = [];
console.error = (...args) => {
  const text = String(args[0] ?? '');
  if (text.includes('not wrapped in act') && !ALLOWED.includes(String(args[1]))) found.push(text.split('\n')[0].replace('%s', String(args[1] ?? '')));
  original(...args);
};
beforeEach(() => {
  found = [];
});
afterEach(() => {
  const seen = found;
  found = [];
  if (seen.length) throw new Error(`Ostrzeżenia act(...) w teście (M-196):\n${[...new Set(seen)].join('\n')}`);
});

// Limit czasu testu ekranów: 15 s zamiast domyślnych 5 s (audyt 2, decyzja koordynatora z 9.10.2026). Test ekranu
// wyświetla całą aplikację (RootStack) i trwa samodzielnie 0,2–2,6 s (pomiar --verbose 9.10.2026, najdłuższe:
// „pamięta najwyżej config.RECENT_MAX zmian” 1,5–2,6 s, pierwszy test pliku 1,2–2,5 s przez leniwe ładowanie modułów).
// Na współdzielonej maszynie (4 procesory, kilka przebiegów Jest naraz) ten sam test „Moje sprawy: tydzień” (0,3 s)
// przekraczał 5 s — to przestój maszyny, nie błąd. Testy zależne od czasu używają zegara symulowanego albo jawnych
// limitów w waitFor, więc dłuższy limit nie ukrywa czekania na timery. Przyspieszenia: workerIdleMemoryLimit
// (jest.config.js) i jedne tabele na stan (app/context.tsx: tablesOf).
jest.setTimeout(15_000);
