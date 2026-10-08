/**
 * Dokąd prowadzi dotknięcie powiadomienia (PWD-16, decyzja właściciela 8.10.2026): zadanie, termin wydarzenia, lista
 * zakupów albo „Moje sprawy” (tam jest skrzynka przekazań). Ścieżka jak link głęboki aplikacji (D40, linking
 * w src/app/navigation.tsx): task/<id>, list/<id>, event/<id>/<data wystąpienia według reguły> — bez daty: cała seria,
 * today. Tę samą ścieżkę podaje serwer w powiadomieniu push (pole „path” z private.*_push_claim).
 */
export type Target = { screen: 'task'; id: string } | { screen: 'list'; id: string } | { screen: 'event'; id: string; date: string | null } | { screen: 'today' };

export function targetPath(t: Target): string {
  if (t.screen === 'today') return 'today';
  if (t.screen === 'event') return t.date ? `event/${t.id}/${t.date}` : `event/${t.id}`;
  return `${t.screen}/${t.id}`;
}

const SEGMENT = '([^/?#\\s]+)';
const PATTERNS: [RegExp, (m: RegExpExecArray) => Target][] = [
  [/^today$/, () => ({ screen: 'today' })],
  [new RegExp(`^task/${SEGMENT}$`), (m) => ({ screen: 'task', id: m[1]! })],
  [new RegExp(`^list/${SEGMENT}$`), (m) => ({ screen: 'list', id: m[1]! })],
  [new RegExp(`^event/${SEGMENT}(?:/(\\d{4}-\\d{2}-\\d{2}))?$`), (m) => ({ screen: 'event', id: m[1]!, date: m[2] ?? null })],
];

/** Ścieżka z powiadomienia → cel; cokolwiek innego (stara wersja, obcy format) — null, czyli zwykłe otwarcie aplikacji. */
export function parseTarget(path: unknown): Target | null {
  if (typeof path !== 'string') return null;
  for (const [re, make] of PATTERNS) {
    const m = re.exec(path);
    if (m) return make(m);
  }
  return null;
}
