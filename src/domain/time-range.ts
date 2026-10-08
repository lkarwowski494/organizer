/**
 * Zakres godzin w polu szybkiego dodawania (D99): „17–18”, „15:30-16:00”, „o 17.00–18.30”, „od 17 do 18”,
 * „od godz. 9 do 10:30”. Zakres oznacza czas trwania, więc szybkie dodanie tworzy wtedy wydarzenie, nie zadanie (D98).
 * Parser terminów (src/domain/quickadd.ts) zostaje bez zmian — zakres wycinamy przed nim (spacjami tej samej
 * długości, żeby pozycje odklikanych fragmentów się nie przesunęły).
 *
 * Reguły (D99):
 *  - godziny liczone jak na zegarze 24-godzinnym (bez zgadywania rano/po południu — D43 dotyczy jednej godziny);
 *  - koniec musi być późniejszy niż początek („22–1” to nie zakres, wydarzenie przez północ ustawia się w formularzu);
 *  - minuty po kropce tylko 00 albo większe niż 12 — jak w parserze terminów, żeby „15.10–16.10” nie było godzinami
 *    (to raczej daty);
 *  - pierwszy zakres w tekście wygrywa; zakres nachodzący na odklikany fragment jest pomijany.
 */
export type TimeRange = {
  /** Pozycja w oryginalnym tekście (koniec wyłącznie). */
  start: number;
  end: number;
  text: string;
  /** „17:00”, „18:30”. */
  from: string;
  to: string;
};

const H = '([01]?\\d|2[0-3])';
const M = '(?:([:.])([0-5]\\d))?';
// Bez lookbehind i \p{…} (pewność w silniku Hermes) — znak przed dopasowaniem sprawdzamy ręcznie.
const PATTERNS = [
  `od\\s+(?:godz\\.?\\s*)?${H}${M}\\s+do\\s+(?:godz\\.?\\s*)?${H}${M}(?![\\d:.]?\\d)`,
  `(?:(?:o|godz\\.?|w\\s+godz\\.?)\\s*)?${H}${M}\\s*[-–—]\\s*${H}${M}(?![\\d:.]?\\d)`,
];
const BEFORE = /[a-ząćęłńóśźż\d.:]/i;

const clock = (h: string, sep: string | undefined, mm: string | undefined): string | null => {
  if (sep === '.' && mm !== '00' && Number(mm) <= 12) return null;
  return `${h.padStart(2, '0')}:${mm ?? '00'}`;
};

export function findTimeRange(text: string, ignore: readonly { start: number; end: number }[] = []): TimeRange | null {
  const found: TimeRange[] = [];
  for (const source of PATTERNS) {
    const re = new RegExp(source, 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      // Środek słowa albo liczby („do 17–18”: nie „o 17–18”) — szukamy dalej od następnego znaku.
      if (start > 0 && BEFORE.test(text[start - 1]!)) {
        re.lastIndex = start + 1;
        continue;
      }
      const from = clock(m[1]!, m[2], m[3]);
      const to = clock(m[4]!, m[5], m[6]);
      if (!from || !to || to <= from) continue;
      if (ignore.some((x) => x.start < end && start < x.end)) continue;
      found.push({ start, end, text: m[0], from, to });
    }
  }
  return found.sort((a, b) => a.start - b.start)[0] ?? null;
}

/** Tekst z zakresem zastąpionym spacjami (długość i pozycje bez zmian). */
export const withoutRange = (text: string, r: TimeRange) => text.slice(0, r.start) + ' '.repeat(r.end - r.start) + text.slice(r.end);
