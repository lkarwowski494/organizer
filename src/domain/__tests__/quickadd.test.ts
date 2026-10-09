import * as fc from 'fast-check';

import { NEXT_FORMS, WEEKDAY_FORMS } from '../../config/quickadd.pl';
import { type LocalDateTime } from '../civil-date';
import { parseQuickAdd } from '../quickadd';
import corpus from './fixtures/quickadd.pl.json';

const at = (iso: string): LocalDateTime => {
  const [date, time] = iso.split('T') as [string, string];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return { y, m, d, hh, mm };
};

describe('parseQuickAdd — korpus (oczekiwania liczone niezależnie w Pythonie)', () => {
  it('ma co najmniej 200 fraz', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(200);
  });

  it.each(corpus.map((c) => [`${c.now} | ${c.text}`, c] as const))('%s', (_, c) => {
    const r = parseQuickAdd(c.text, at(c.now));
    expect({ title: r.title, due: r.due, rrule: r.rrule }).toEqual(c.expected);
  });
});

describe('parseQuickAdd — tokeny i odklikiwanie', () => {
  const now = at('2026-10-06T10:00'); // wtorek

  it('zwraca pozycje fragmentów w oryginalnym tekście', () => {
    const text = 'Kupić prezent w Piątek o 17 co tydzień';
    const r = parseQuickAdd(text, now);
    expect(r.tokens.map((t) => [t.kind, t.text])).toEqual([
      ['date', 'w Piątek'],
      ['time', 'o 17'],
      ['recurrence', 'co tydzień'],
    ]);
    for (const t of r.tokens) expect(text.slice(t.start, t.end)).toBe(t.text);
    expect(r).toMatchObject({ title: 'Kupić prezent', due: { date: '2026-10-09', time: '17:00' }, rrule: 'FREQ=WEEKLY;BYDAY=FR' });
  });

  it('odklikany fragment zostaje w tytule', () => {
    const text = 'kino w piątek o 20';
    const first = parseQuickAdd(text, now);
    const dateToken = first.tokens.find((t) => t.kind === 'date')!;
    const r = parseQuickAdd(text, now, { ignore: [dateToken] });
    expect(r.title).toBe('kino w piątek');
    expect(r.due).toEqual({ date: '2026-10-06', time: '20:00' });
  });

  it('drugi termin w tekście zostaje w tytule', () => {
    const r = parseQuickAdd('jutro przenieść spotkanie na pojutrze', now);
    expect(r.due).toEqual({ date: '2026-10-07', time: null });
    expect(r.title).toBe('przenieść spotkanie na pojutrze');
  });

  it('nie rozpoznaje słów zawierających frazy', () => {
    for (const text of ['jutrzejsze zakupy', 'dzisiejszy plan', 'kupić 2,5 kg', 'pokój nr 12:30a', 'bilet 1.15.10']) {
      expect(parseQuickAdd(text, now).tokens.filter((t) => t.kind === 'date')).toHaveLength(0);
    }
  });

  it('pusty tekst', () => {
    expect(parseQuickAdd('', now)).toEqual({ title: '', due: null, rrule: null, tokens: [], unrecognizedDay: null, farDate: null });
  });
});

describe('parseQuickAdd — bezpiecznik dnia (audyt 2, M-23)', () => {
  const now = at('2026-10-07T10:00'); // środa

  it('„dentysta w przyszły wtorek o 15”: nie dziś 15:00 — godzina zostaje w tytule, termin pusty, fragment do pokazania', () => {
    const text = 'dentysta w przyszły wtorek o 15';
    const r = parseQuickAdd(text, now);
    expect(r).toMatchObject({ title: text, due: null, rrule: null, tokens: [] });
    expect(r.unrecognizedDay).toEqual({ start: 11, end: 26, text: 'przyszły wtorek' });
  });

  it('fragment: sama nazwa dnia, „następnym tygodniu”, wielkie litery; bez godziny nic nie odpada', () => {
    expect(parseQuickAdd('rachunek za prąd piątek', now)).toMatchObject({ title: 'rachunek za prąd piątek', due: null, unrecognizedDay: { text: 'piątek' } });
    expect(parseQuickAdd('zebranie w następnym tygodniu o 9', now).unrecognizedDay?.text).toBe('następnym tygodniu');
    expect(parseQuickAdd('Basen Środy o 17', now).unrecognizedDay?.text).toBe('Środy');
    // „przyszłego” tuż przed godziną: godzina nie jest częścią fragmentu.
    expect(parseQuickAdd('zadanie przyszłego o 7', now).unrecognizedDay?.text).toBe('przyszłego');
    expect(parseQuickAdd('następny, czwartek o 9', now).unrecognizedDay?.text).toBe('następny');
  });

  it('rozpoznana data wyłącza bezpiecznik; odklikany dzień to zwykły tekst (godzina jak zwykle, D43)', () => {
    expect(parseQuickAdd('basen jutro o 17, nie w przyszły czwartek', now)).toMatchObject({ due: { date: '2026-10-08', time: '17:00' }, unrecognizedDay: null });
    const text = 'kino w piątek o 20';
    const dateToken = parseQuickAdd(text, now).tokens.find((t) => t.kind === 'date')!;
    expect(parseQuickAdd(text, now, { ignore: [dateToken] })).toMatchObject({ title: 'kino w piątek', due: { date: '2026-10-07', time: '20:00' }, unrecognizedDay: null });
    // Odklikane słowo dnia też nie uruchamia bezpiecznika.
    const t2 = 'spotkanie z p. Środą o 15';
    const word = { start: t2.indexOf('Środą'), end: t2.indexOf('Środą') + 5 };
    expect(parseQuickAdd(t2, now).due).toBeNull();
    expect(parseQuickAdd(t2, now, { ignore: [word] }).due).toEqual({ date: '2026-10-07', time: '15:00' });
  });

  it('nie myli dni z podobnymi słowami', () => {
    for (const text of ['środki czystości o 17', 'wśród znajomych o 17', 'kupić wtórnik o 17', 'piątka z matmy o 17', 'następnie zadzwonić o 17']) {
      expect(parseQuickAdd(text, now).unrecognizedDay).toBeNull();
      expect(parseQuickAdd(text, now).due).not.toBeNull();
    }
  });

  it('własność: każda forma dnia bez przyimka i dowolna godzina → bez terminu, tytuł = tekst', () => {
    const forms = [...WEEKDAY_FORMS.flat(), ...NEXT_FORMS];
    fc.assert(
      fc.property(fc.constantFrom(...forms), fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (form, h, m) => {
        const text = `zadanie ${form} o ${h}:${String(m).padStart(2, '0')}`;
        const r = parseQuickAdd(text, now);
        expect(r).toMatchObject({ title: text, due: null, rrule: null, tokens: [] });
        expect(r.unrecognizedDay?.text.startsWith(form)).toBe(true);
      }),
    );
  });
});

describe('parseQuickAdd — własności', () => {
  const nowArb = fc
    .record({
      day: fc.integer({ min: 0, max: 365 * 40 }),
      hh: fc.integer({ min: 0, max: 23 }),
      mm: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ day, hh, mm }): LocalDateTime => {
      const dt = new Date(Date.UTC(2000, 0, 1) + day * 86_400_000);
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh, mm };
    });

  it('data słowna z rokiem → fraza → parse = ta sama data', () => {
    const months = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
    fc.assert(
      fc.property(nowArb, fc.integer({ min: 0, max: 365 * 50 }), (now, day) => {
        const dt = new Date(Date.UTC(2000, 0, 1) + day * 86_400_000);
        const iso = dt.toISOString().slice(0, 10);
        const text = `spotkanie ${dt.getUTCDate()} ${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
        expect(parseQuickAdd(text, now).due).toEqual({ date: iso, time: null });
      }),
    );
  });

  it('termin z dniem tygodnia jest zawsze 1–7 dni po dziś i ma ten dzień tygodnia', () => {
    const words = ['poniedziałek', 'wtorek', 'środę', 'czwartek', 'piątek', 'sobotę', 'niedzielę'];
    fc.assert(
      fc.property(nowArb, fc.integer({ min: 0, max: 6 }), (now, wd) => {
        const due = parseQuickAdd(`zadanie w ${words[wd]}`, now).due!;
        const todayMs = Date.UTC(now.y, now.m - 1, now.d);
        const dueMs = Date.parse(`${due.date}T00:00:00Z`);
        const diff = (dueMs - todayMs) / 86_400_000;
        expect(diff).toBeGreaterThanOrEqual(1);
        expect(diff).toBeLessThanOrEqual(7);
        expect((new Date(dueMs).getUTCDay() + 6) % 7).toBe(wd);
      }),
    );
  });

  it('godzina bez dnia jest zawsze w przyszłości i najpóźniej jutro', () => {
    fc.assert(
      fc.property(nowArb, fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (now, h, m) => {
        const due = parseQuickAdd(`zadanie o ${h}:${String(m).padStart(2, '0')}`, now).due!;
        const nowMs = Date.UTC(now.y, now.m - 1, now.d, now.hh, now.mm);
        const dueMs = Date.parse(`${due.date}T${due.time}:00Z`);
        expect(dueMs).toBeGreaterThan(nowMs);
        expect(dueMs - nowMs).toBeLessThanOrEqual(24 * 3_600_000);
      }),
    );
  });

  it('tytuł nigdy nie jest dłuższy od tekstu, a tokeny wskazują swój tekst', () => {
    fc.assert(
      fc.property(nowArb, fc.string({ maxLength: 60 }), (now, text) => {
        const r = parseQuickAdd(text, now);
        expect(r.title.length).toBeLessThanOrEqual(text.length);
        for (const t of r.tokens) expect(text.slice(t.start, t.end)).toBe(t.text);
      }),
    );
  });
});

describe('parseQuickAdd — przypadki brzegowe', () => {
  const now = at('2026-10-06T10:00'); // wtorek
  const due = (text: string) => parseQuickAdd(text, now).due;

  it('skróty miesięcy (CLDR), z kropką i rokiem', () => {
    expect(due('urodziny 15 paź')).toEqual({ date: '2026-10-15', time: null });
    expect(due('urodziny 3 lis. 2027')).toEqual({ date: '2027-11-03', time: null });
    expect(due('ferie 1 sty')).toEqual({ date: '2027-01-01', time: null });
    expect(due('rocznica 29 lut')).toEqual({ date: '2028-02-29', time: null });
  });

  it('nieistniejące godziny nie są rozpoznawane', () => {
    expect(due('zadanie o 25')).toBeNull();
    expect(due('zadanie o 7:61')).toBeNull();
    expect(due('zadanie 24:00')).toBeNull();
  });

  it('nieistniejąca data z rokiem nie jest rozpoznawana', () => {
    expect(due('zadanie 29.02.2027')).toBeNull();
    expect(due('zadanie 31 kwietnia 2027')).toBeNull();
  });

  it('liczba poprzedzona kropką nie jest datą', () => {
    expect(due('wersja v.15.10')).toBeNull();
  });

  it('godzina z kropką wygrywa z nakładającą się datą', () => {
    const r = parseQuickAdd('telefon o 3.10', now);
    expect(r.tokens.map((t) => t.kind)).toEqual(['time']);
    expect(r.due).toEqual({ date: '2026-10-06', time: '15:10' });
  });

  it('„dziś o 7” po 19:00 zostaje 7:00 tego dnia (dzień podany wprost)', () => {
    expect(parseQuickAdd('dziś o 7', at('2026-10-06T20:00')).due).toEqual({ date: '2026-10-06', time: '07:00' });
  });

  it('polskie litery w tytule nie przesuwają pozycji fragmentów', () => {
    const text = 'Żółw do weterynarza, kupić żółtą miskę jutro o 9';
    const r = parseQuickAdd(text, now);
    expect(r.title).toBe('Żółw do weterynarza, kupić żółtą miskę');
    for (const t of r.tokens) expect(text.slice(t.start, t.end)).toBe(t.text);
    expect(r.due).toEqual({ date: '2026-10-07', time: '09:00' });
  });

  it('„o godz.7” bez spacji', () => {
    expect(due('zadanie jutro o godz.7')).toEqual({ date: '2026-10-07', time: '07:00' });
  });

  it('interpunkcja po usuniętym fragmencie', () => {
    expect(parseQuickAdd('zakupy jutro, potem kino', now).title).toBe('zakupy, potem kino');
    expect(parseQuickAdd('jutro: przegląd auta', now).title).toBe('przegląd auta');
    expect(parseQuickAdd('przegląd auta ,; jutro', now).title).toBe('przegląd auta');
  });
});

describe('parseQuickAdd — audyt 3', () => {
  const now = at('2026-10-09T10:00'); // piątek
  const p = (text: string, o?: Parameters<typeof parseQuickAdd>[2]) => parseQuickAdd(text, now, o);

  it('N-28: „dziś/jutro/pojutrze” i dzień tygodnia wygrywają z liczbą bez roku („1.5”, „1/2”)', () => {
    expect(p('raport 1.5 strony jutro')).toMatchObject({ title: 'raport 1.5 strony', due: { date: '2026-10-10', time: null }, farDate: null });
    expect(p('1/2 kostki masła w środę')).toMatchObject({ title: '1/2 kostki masła', due: { date: '2026-10-14', time: null } });
    // Data liczbowa z rokiem albo słowna dalej jest pierwszą datą.
    expect(p('jutro przenieść na 15.10.2026').due?.date).toBe('2026-10-10');
    expect(p('15.10.2026 zamiast jutro').due?.date).toBe('2026-10-15');
    // Odklikane „jutro” oddaje termin liczbie.
    expect(p('raport 1.5 strony jutro', { ignore: [{ start: 18, end: 23 }] }).due?.date).toBe('2027-05-01');
  });

  it('N-28 (B): data liczbowa bez roku w przyszłym roku — ostrzeżenie z pełną datą', () => {
    expect(p('1/2 kostki masła').farDate).toEqual({ text: '1/2', label: 'poniedziałek, 1 lutego 2027' });
    expect(p('mąka 2.5 kg').farDate).toEqual({ text: '2.5', label: 'niedziela, 2 maja 2027' });
    expect(p('rachunek 31.12').farDate).toBeNull();
    expect(p('urlop 1.05.2027').farDate).toBeNull();
    expect(p('urlop 1 maja').farDate).toBeNull();
    expect(p('bez daty').farDate).toBeNull();
    expect(p('x 1.01').farDate).toMatchObject({ text: '1.01' });
  });

  it('N-124: bez rozpoznawania powtarzania (pole podzadania) — „co tydzień” zostaje w nazwie, bez terminu', () => {
    expect(p('podlać kwiaty co tydzień', { recurrence: false })).toMatchObject({ title: 'podlać kwiaty co tydzień', due: null, rrule: null, tokens: [] });
    expect(p('podlać kwiaty jutro co tydzień', { recurrence: false })).toMatchObject({ title: 'podlać kwiaty co tydzień', due: { date: '2026-10-10' }, rrule: null });
  });
});
