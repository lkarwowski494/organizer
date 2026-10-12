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

// Limit czasu testu ekranów: 30 s (audyt 2: 15 s zamiast domyślnych 5 s; podniesiony 9.10.2026 na podstawie pomiaru).
// Limit łapie zawieszenie, nie mierzy szybkości: testy zależne od czasu używają zegara symulowanego albo jawnych limitów
// w waitFor. Pomiar 9.10.2026 (--json, 4 procesory, obciążenie ~20 od innych przebiegów):
//  - sam plik (--runInBand): najdłuższe testy 1,5–4,9 s („rok zrobionych” w shopping-basket 4,9 s), większość < 1 s;
//  - dwa pełne przebiegi Jest naraz (--maxWorkers=2 każdy, jak przy równoległej pracy kilku sesji): 4 z 707 testów
//    trwały 15,4–18,2 s (3 przekroczyły dawny limit), reszta < 11 s; wśród nich testy, które same trwają < 1 s (25×
//    dłużej) — przestój maszyny (presja CPU 97%, przestoje pamięci w /proc/pressure/memory), a nie wolny test, więc
//    przyspieszanie pojedynczych testów nie pomaga. 30 s to ~1,6× najgorszy pomiar i ~6× najdłuższy test solo.
// Przyspieszenia: workerIdleMemoryLimit (jest.config.js) i jedne tabele na stan (app/context.tsx: tablesOf).
// Własny limit w teście tylko powyżej wspólnego (dawne 15–20 s w calendar-sync, root-calendar i undo-trash usunięte).
jest.setTimeout(30_000);
