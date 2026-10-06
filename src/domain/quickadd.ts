/**
 * Polski parser szybkiego dodawania (D18): z tekstu „kupić prezent w piątek o 17 co tydzień”
 * wyciąga termin i powtarzanie, a resztę zostawia jako tytuł. Każdy rozpoznany fragment wraca jako
 * token z pozycją w tekście, żeby UI mógł pokazać go jako chip do odklikania; odklikany fragment
 * podaje się w `ignore` i parser traktuje go jak zwykły tekst.
 *
 * Zakres MVP (D18): dziś/dzisiaj, jutro, pojutrze, „w/we/na” + dzień tygodnia, daty liczbowe
 * (15.10, 15.10.2027, 15/10) i słowne (15 października, 15 paź 2027), godziny (o 17, o 17:30,
 * o godz. 7, 17:30), „co tydzień”. Rozpoznawanie ignoruje polskie znaki („dzis”, „srode”).
 * Pierwszy fragment danego rodzaju wygrywa; kolejne zostają w tytule.
 *
 * Reguły rozstrzygania (decyzje właściciela 6.10.2026, docs/adr/0003):
 *  - D42 dzień tygodnia równy dzisiejszemu = ten dzień za tydzień,
 *  - D43 godzina 1–11 bez dopowiedzenia = najbliższa przyszła (rano albo po południu);
 *        bez podanego dnia = najbliższe wystąpienie tej godziny (dziś albo jutro),
 *  - D44 data bez roku, która już minęła, = przyszły rok,
 *  - D45 sam dzień = termin bez godziny.
 */
import {
  MONTHS_ABBREVIATED,
  MONTHS_GENITIVE,
  QUICKADD_RULES,
  RRULE_WEEKDAYS,
  WEEKDAYS_ACCUSATIVE,
} from '../config/quickadd.pl';
import {
  addDays,
  type CivilDate,
  compareDates,
  formatIsoDate,
  isoWeekday,
  isValidDate,
  type LocalDateTime,
} from './civil-date';

export type TokenKind = 'date' | 'time' | 'recurrence';

export type Token = {
  kind: TokenKind;
  /** Pozycja w oryginalnym tekście (indeksy znaków JS, koniec wyłącznie). */
  start: number;
  end: number;
  text: string;
};

export type Due = {
  /** Data ISO „2026-10-09”. */
  date: string;
  /** Godzina „17:30”; `null` = termin całodniowy (D45). */
  time: string | null;
};

export type QuickAddResult = {
  title: string;
  due: Due | null;
  /** Reguła powtarzania RFC 5545 bez DTSTART (start = `due`), np. „FREQ=WEEKLY”. */
  rrule: string | null;
  tokens: Token[];
};

export type QuickAddOptions = {
  /** Fragmenty odklikane przez użytkownika: każdy token nachodzący na nie jest pomijany. */
  ignore?: readonly { start: number; end: number }[];
};

/** Zamiana polskich liter na łacińskie 1:1 — długość tekstu i pozycje się nie zmieniają. */
const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const fold = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c] ?? c);

const isWordChar = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);

type DateSpec =
  | { type: 'relative'; days: number }
  | { type: 'weekday'; weekday: number }
  | { type: 'explicit'; d: number; m: number; y: number | null };

type Candidate =
  | { kind: 'date'; start: number; end: number; spec: DateSpec }
  | { kind: 'time'; start: number; end: number; h: number; min: number }
  | { kind: 'recurrence'; start: number; end: number; rrule: 'FREQ=WEEKLY' };

const alt = (words: readonly string[]) => words.map(fold).join('|');

const RELATIVE: Record<string, number> = { dzis: 0, dzisiaj: 0, jutro: 1, pojutrze: 2 };

const PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => Candidate | null }[] = [
  {
    re: /(?:na )?(dzisiaj|dzis|pojutrze|jutro)/g,
    build: (m) => ({ kind: 'date', start: m.index, end: m.index + m[0].length, spec: { type: 'relative', days: RELATIVE[m[1]!]! } }),
  },
  {
    re: new RegExp(`(?:we|w|na) (${alt(WEEKDAYS_ACCUSATIVE)})`, 'g'),
    build: (m) => ({
      kind: 'date',
      start: m.index,
      end: m.index + m[0].length,
      spec: { type: 'weekday', weekday: WEEKDAYS_ACCUSATIVE.map(fold).indexOf(m[1]!) },
    }),
  },
  {
    // „15 października 2027”, „15 paź”, „15 paź. 2027”; dłuższe formy przed skrótami.
    re: new RegExp(`(?:na )?(\\d{1,2}) (${alt(MONTHS_GENITIVE)}|${alt(MONTHS_ABBREVIATED)})\\.?(?: (\\d{4}))?`, 'g'),
    build: (m) => {
      const name = m[2]!;
      let idx = MONTHS_GENITIVE.map(fold).indexOf(name);
      if (idx < 0) idx = MONTHS_ABBREVIATED.map(fold).indexOf(name);
      return explicitDate(m, Number(m[1]), idx + 1, m[3]);
    },
  },
  {
    // „o 17”, „o 17:30”, „o 17.30”, „o godz. 7”, „o godzinie 7”.
    re: /o (?:godz\. ?|godz |godzinie )?(\d{1,2})(?:[:.](\d{2}))?/g,
    build: (m) => time(m, Number(m[1]), m[2] === undefined ? 0 : Number(m[2])),
  },
  {
    re: /(\d{1,2}):(\d{2})/g,
    build: (m) => time(m, Number(m[1]), Number(m[2])),
  },
  {
    // „15.10”, „15.10.2027”, „15/10”. Uwaga: „2.5 kg” też wygląda jak data (2 maja) — chip pozwala to odkliknąć.
    re: /(?:na )?(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?/g,
    build: (m) => explicitDate(m, Number(m[1]), Number(m[2]), m[3]),
  },
  {
    re: /co tydzien/g,
    build: (m) => ({ kind: 'recurrence', start: m.index, end: m.index + m[0].length, rrule: 'FREQ=WEEKLY' }),
  },
];

function explicitDate(m: RegExpExecArray, d: number, mo: number, year: string | undefined): Candidate | null {
  const y = year === undefined ? null : Number(year);
  // Bez roku dzień i miesiąc muszą istnieć w jakimkolwiek roku (29 lutego tak, 31 kwietnia nie).
  if (!isValidDate(y ?? 2028, mo, d)) return null;
  return { kind: 'date', start: m.index, end: m.index + m[0].length, spec: { type: 'explicit', d, m: mo, y } };
}

function time(m: RegExpExecArray, h: number, min: number): Candidate | null {
  if (h > 23 || min > 59) return null;
  return { kind: 'time', start: m.index, end: m.index + m[0].length, h, min };
}

function findCandidates(folded: string): Candidate[] {
  const found: Candidate[] = [];
  for (const { re, build } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Granice słowa liczone ręcznie (bez \p{L} i lookbehind — pewniejsze w silniku Hermes).
      // Kropka lub cyfra tuż obok daty liczbowej oznacza inną liczbę (np. „1.15.10”).
      const before = folded[start - 1];
      const after = folded[end];
      const nextAfter = folded[end + 1];
      const numericNeighbour = (c: string | undefined) => c === '.' || c === '/' || c === ':';
      if (isWordChar(before) || isWordChar(after)) continue;
      if (/\d/.test(m[0][0]!) && numericNeighbour(before)) continue;
      if (numericNeighbour(after) && nextAfter !== undefined && /\d/.test(nextAfter)) continue;
      const c = build(m);
      if (c) found.push(c);
    }
  }
  return found;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

/** Wybiera nienachodzące na siebie fragmenty: wcześniejszy wygrywa, przy remisie dłuższy. */
function selectCandidates(candidates: Candidate[], ignore: QuickAddOptions['ignore']): Candidate[] {
  const sorted = candidates
    .filter((c) => !(ignore ?? []).some((i) => overlaps(c, i)))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen: Candidate[] = [];
  const usedKinds = new Set<TokenKind>();
  for (const c of sorted) {
    if (usedKinds.has(c.kind)) continue;
    if (chosen.some((x) => overlaps(x, c))) continue;
    chosen.push(c);
    usedKinds.add(c.kind);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

function resolveDate(spec: DateSpec, today: CivilDate): CivilDate | null {
  switch (spec.type) {
    case 'relative':
      return addDays(today, spec.days);
    case 'weekday': {
      const diff = (spec.weekday - isoWeekday(today) + 7) % 7;
      return addDays(today, diff === 0 ? QUICKADD_RULES.SAME_WEEKDAY_OFFSET_DAYS : diff);
    }
    case 'explicit': {
      if (spec.y !== null) return isValidDate(spec.y, spec.m, spec.d) ? { y: spec.y, m: spec.m, d: spec.d } : null;
      // D44: najbliższy rok (bieżący lub późniejszy), w którym data istnieje i nie jest w przeszłości.
      for (let y = today.y; y <= today.y + 8; y++) {
        const date = { y, m: spec.m, d: spec.d };
        if (isValidDate(y, spec.m, spec.d) && compareDates(date, today) >= 0) return date;
      }
      return null;
    }
  }
}

/** Czy dzień i godzina są ściśle po „teraz”. */
const isFuture = (date: CivilDate, h: number, min: number, now: LocalDateTime) => {
  const c = compareDates(date, now);
  return c > 0 || (c === 0 && h * 60 + min > now.hh * 60 + now.mm);
};

/** D43: rozstrzygnięcie godziny. Zwraca dzień (może się zmienić na jutro) i godzinę. */
function resolveTime(
  date: CivilDate | null,
  h: number,
  min: number,
  now: LocalDateTime,
): { date: CivilDate; h: number } {
  const ambiguous = h >= 1 && h <= QUICKADD_RULES.AMBIGUOUS_HOUR_MAX;
  const today: CivilDate = { y: now.y, m: now.m, d: now.d };
  if (date !== null) {
    if (ambiguous && !isFuture(date, h, min, now) && isFuture(date, h + 12, min, now)) return { date, h: h + 12 };
    return { date, h };
  }
  const options: { date: CivilDate; h: number }[] = [{ date: today, h }];
  if (ambiguous) options.push({ date: today, h: h + 12 });
  options.push({ date: addDays(today, 1), h });
  return options.find((o) => isFuture(o.date, o.h, min, now)) ?? options[options.length - 1]!;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function cleanTitle(text: string, tokens: Token[]): string {
  let out = '';
  let pos = 0;
  for (const t of tokens) {
    out += text.slice(pos, t.start) + ' ';
    pos = t.end;
  }
  out += text.slice(pos);
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '');
}

export function parseQuickAdd(text: string, now: LocalDateTime, options: QuickAddOptions = {}): QuickAddResult {
  const folded = fold(text);
  if (folded.length !== text.length) throw new Error('quickadd: zamiana znaków zmieniła długość tekstu');
  const chosen = selectCandidates(findCandidates(folded), options.ignore);

  const dateC = chosen.find((c) => c.kind === 'date');
  const timeC = chosen.find((c) => c.kind === 'time');
  const recC = chosen.find((c) => c.kind === 'recurrence');

  const today: CivilDate = { y: now.y, m: now.m, d: now.d };
  let date = dateC ? resolveDate(dateC.spec, today) : null;
  // Data, której nie da się rozstrzygnąć, nie jest tokenem — zostaje w tytule.
  const tokensC = chosen.filter((c) => !(c === dateC && date === null));

  let due: Due | null = null;
  if (timeC) {
    const r = resolveTime(date, timeC.h, timeC.min, now);
    date = r.date;
    due = { date: formatIsoDate(r.date), time: `${pad2(r.h)}:${pad2(timeC.min)}` };
  } else if (date) {
    due = { date: formatIsoDate(date), time: null };
  } else if (recC) {
    // Seria bez podanego dnia startuje dziś.
    due = { date: formatIsoDate(today), time: null };
  }

  let rrule: string | null = null;
  if (recC && due) {
    // Dzień tygodnia wynika ze startu serii; BYDAY dopisujemy jawnie, żeby reguła była czytelna bez DTSTART.
    const start = date ?? today;
    rrule = `${recC.rrule};BYDAY=${RRULE_WEEKDAYS[isoWeekday(start)]}`;
  }

  const tokens: Token[] = tokensC.map((c) => ({ kind: c.kind, start: c.start, end: c.end, text: text.slice(c.start, c.end) }));
  return { title: cleanTitle(text, tokens), due, rrule, tokens };
}
