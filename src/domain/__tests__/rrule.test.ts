import * as fc from 'fast-check';

import { addDays, compareDates, formatIsoDate } from '../civil-date';
import { parseIsoDate } from '../format';
import { alignStart, endBefore, formatRule, occurrences, parseRule, RuleError } from '../rrule';
import corpus from './fixtures/rrule.json';

const D = parseIsoDate;
const iso = (xs: { y: number; m: number; d: number }[]) => xs.map(formatIsoDate);

describe('reguły powtarzania (RFC 5545) vs python-dateutil', () => {
  it.each(corpus.map((c) => [c.rule, c]))('%s', (_r, c) => {
    const rule = parseRule(c.rule);
    expect(formatIsoDate(alignStart(D(c.anchor), rule))).toBe(c.start);
    expect(iso(occurrences(D(c.start), rule, D(c.from), D(c.to)))).toEqual(c.expected);
  });
});

describe('reguły — przypadki i błędy', () => {
  it('przypadek właściciela: tańce w poniedziałki i soboty', () => {
    const r = parseRule('FREQ=WEEKLY;BYDAY=MO,SA');
    expect(iso(occurrences(D('2026-10-05'), r, D('2026-10-05'), D('2026-10-18')))).toEqual(['2026-10-05', '2026-10-10', '2026-10-12', '2026-10-17']);
  });

  it('bez reguły: jedno wystąpienie, jeśli w zakresie', () => {
    expect(iso(occurrences(D('2026-10-05'), null, D('2026-10-01'), D('2026-10-31')))).toEqual(['2026-10-05']);
    expect(occurrences(D('2026-10-05'), null, D('2026-10-06'), D('2026-10-31'))).toEqual([]);
  });

  it('formatowanie w obie strony', () => {
    for (const s of ['FREQ=DAILY', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SA', 'FREQ=MONTHLY;BYDAY=-1FR;COUNT=5', 'FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20271231', 'FREQ=YEARLY']) {
      expect(formatRule(parseRule(s))).toBe(s);
    }
    expect(formatRule(parseRule('FREQ=WEEKLY;WKST=MO'))).toBe('FREQ=WEEKLY');
  });

  it('zakończenie przed dniem: UNTIL = dzień wcześniej, COUNT znika', () => {
    expect(formatRule(endBefore(parseRule('FREQ=WEEKLY;BYDAY=MO;COUNT=10'), D('2026-11-02')))).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101');
  });

  it('reguła bez wystąpień nie zapętla się, alignStart wraca do daty', () => {
    const r = parseRule('FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=31');
    expect(formatIsoDate(alignStart(D('2026-02-01'), r))).toBe('2026-02-01');
  });

  it.each([
    ['', 'zła część'],
    ['FREQ=HOURLY', 'FREQ'],
    ['FREQ=DAILY;FREQ=DAILY', 'zła część'],
    ['FREQ=DAILY;X', 'zła część'],
    ['FREQ=DAILY;A=b=c', 'zła część'],
    ['FREQ=DAILY;BYHOUR=5', 'nieobsługiwane BYHOUR'],
    ['FREQ=DAILY;WKST=SU', 'WKST'],
    ['FREQ=DAILY;INTERVAL=0', 'INTERVAL'],
    ['FREQ=DAILY;INTERVAL=x', 'INTERVAL'],
    ['FREQ=DAILY;COUNT=1001', 'COUNT'],
    ['FREQ=DAILY;UNTIL=2026-01-01', 'UNTIL'],
    ['FREQ=DAILY;UNTIL=20260230', 'UNTIL'],
    ['FREQ=DAILY;COUNT=2;UNTIL=20260101', 'COUNT i UNTIL'],
    ['FREQ=WEEKLY;BYDAY=XX', 'BYDAY XX'],
    ['FREQ=WEEKLY;BYDAY=1MO', 'z liczbą'],
    ['FREQ=DAILY;BYDAY=MO', 'BYDAY'],
    ['FREQ=MONTHLY;BYMONTHDAY=0', 'BYMONTHDAY 0'],
    ['FREQ=MONTHLY;BYMONTHDAY=32', 'BYMONTHDAY 32'],
    ['FREQ=MONTHLY;BYMONTHDAY=a', 'BYMONTHDAY a'],
    ['FREQ=WEEKLY;BYMONTHDAY=1', 'BYMONTHDAY'],
    ['FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1', 'BYMONTHDAY'],
  ])('„%s” odrzucone (%s)', (s, msg) => {
    expect(() => parseRule(s)).toThrow(RuleError);
    expect(() => parseRule(s)).toThrow(msg);
  });

  it('własności: wynik rosnący, bez powtórzeń, w zakresie; zakres sumy = suma zakresów', () => {
    const arbRule = fc.constantFrom('FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY;BYDAY=MO,WE,SA', 'FREQ=MONTHLY;BYDAY=2TU', 'FREQ=MONTHLY;BYMONTHDAY=31', 'FREQ=YEARLY;COUNT=4', 'FREQ=WEEKLY;INTERVAL=2;UNTIL=20271001');
    fc.assert(
      fc.property(arbRule, fc.integer({ min: 0, max: 600 }), fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), (s, a, b, c) => {
        const r = parseRule(s);
        const start = alignStart(D('2026-01-01'), r);
        const base = Date.UTC(2026, 0, 1);
        const at = (n: number) => D(new Date(base + n * 86_400_000).toISOString().slice(0, 10));
        const [f, mid, t] = [at(a), at(a + b), at(a + b + c)];
        const whole = iso(occurrences(start, r, f, t));
        expect([...whole].sort()).toEqual(whole);
        expect(new Set(whole).size).toBe(whole.length);
        const left = iso(occurrences(start, r, f, mid));
        const right = iso(occurrences(start, r, at(a + b + 1), t));
        expect([...left, ...right]).toEqual(whole);
      }),
    );
  });
});

describe('audyt 3, N-16: skok do okresu zawierającego „od”', () => {
  // Wzorzec: ta sama funkcja od dnia startu (skok k = 0, czyli dawny algorytm przeglądający serię od początku),
  // przycięta do [od, do]. Bez COUNT wynik nie zależy od okresów sprzed „od”.
  const arbFreq = fc.constantFrom('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');
  const arbRule = fc
    .record({
      freq: arbFreq,
      interval: fc.integer({ min: 1, max: 14 }),
      byday: fc.subarray(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'], { maxLength: 3 }),
      nth: fc.constantFrom(null, 1, 2, -1),
      bymonthday: fc.constantFrom(null, 1, 15, 29, 31, -1),
      until: fc.option(fc.integer({ min: 0, max: 4000 })),
      count: fc.option(fc.integer({ min: 1, max: 40 })),
    })
    .map(({ freq, interval, byday, nth, bymonthday, until, count }) => {
      const parts = [`FREQ=${freq}`, `INTERVAL=${interval}`];
      if (freq === 'WEEKLY' && byday.length) parts.push(`BYDAY=${byday.join(',')}`);
      if (freq === 'MONTHLY' && byday.length) parts.push(`BYDAY=${byday.map((d) => `${nth ?? ''}${d}`).join(',')}`);
      else if (freq === 'MONTHLY' && bymonthday !== null) parts.push(`BYMONTHDAY=${bymonthday}`);
      if (count !== null) parts.push(`COUNT=${count}`);
      else if (until !== null) parts.push(`UNTIL=${formatIsoDate(addDays(D('2020-01-01'), until)).replaceAll('-', '')}`);
      return parseRule(parts.join(';'));
    });

  it('wynik jak przy przeglądaniu od początku serii (losowe reguły, start i zakres)', () => {
    fc.assert(
      fc.property(arbRule, fc.integer({ min: 0, max: 3000 }), fc.integer({ min: -400, max: 4000 }), fc.integer({ min: 0, max: 120 }), (rule, s, f, len) => {
        const start = alignStart(addDays(D('2020-01-01'), s), rule);
        const from = addDays(start, f);
        const to = addDays(from, len);
        const all = occurrences(start, rule, start, to).filter((d) => compareDates(d, from) >= 0);
        expect(iso(occurrences(start, rule, from, to))).toEqual(iso(all));
      }),
      { numRuns: 3000 },
    );
  });

  it('limit: pierwsze wystąpienia tak samo jak początek pełnego wyniku (następny termin zadania bierze jedno)', () => {
    fc.assert(
      fc.property(arbRule, fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 5 }), (rule, s, len, limit) => {
        const start = alignStart(addDays(D('2020-01-01'), s), rule);
        const to = addDays(start, len);
        expect(iso(occurrences(start, rule, start, to, limit))).toEqual(iso(occurrences(start, rule, start, to)).slice(0, limit));
      }),
      { numRuns: 1000 },
    );
  });

  it('codzienna seria sprzed lat: zakres jednego dnia bez przeglądania lat', () => {
    const daily = parseRule('FREQ=DAILY');
    expect(iso(occurrences(D('2000-01-01'), daily, D('2026-10-09'), D('2026-10-09')))).toEqual(['2026-10-09']);
    // Co 10 dni od 1.01: 9.10 nie pasuje, 18.10 — tak.
    expect(iso(occurrences(D('2026-01-01'), parseRule('FREQ=DAILY;INTERVAL=10'), D('2026-10-09'), D('2026-10-20')))).toEqual(['2026-10-18']);
    expect(iso(occurrences(D('2020-02-29'), parseRule('FREQ=YEARLY'), D('2026-01-01'), D('2028-12-31')))).toEqual(['2028-02-29']);
  });
});
