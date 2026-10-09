import { config } from '../../config';
import * as fc from 'fast-check';

import { formatRule, parseRule } from '../rrule';
import { emptyForm, type EventForm, formOf, moveStart, validateForm, weekdayPosition } from '../views/event-form';
import type { EventFields } from '../views/events';

const WD = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const form = (over: Partial<EventForm> = {}): EventForm => ({ ...emptyForm('2026-10-05'), title: 'Tańce', slots: [{ days: [0], start: '18:00', end: '19:00' }], ...over });
const ok = (s: EventForm) => {
  const r = validateForm(s);
  if ('error' in r) throw new Error(r.error);
  return r.fields;
};
const rules = (s: EventForm) => ok(s).map((f) => (f.rule ? formatRule({ ...f.rule, until: f.until }) : null));

describe('formularz wydarzenia', () => {
  it('pusty formularz: dzień tygodnia z daty, cała grupa albo wskazane osoby', () => {
    expect(emptyForm('2026-10-10')).toMatchObject({ slots: [{ days: [5], start: '', end: '' }], repeat: 'none', interval: '1', ends: 'never', audience: 'group', participantIds: [] });
    expect(emptyForm('2026-10-10', ['kuba'])).toMatchObject({ audience: 'members', participantIds: ['kuba'] });
  });

  it('scenariusz właściciela: dwa terminy co tydzień → dwie serie z różnymi godzinami', () => {
    const fields = ok(form({ repeat: 'weekly', slots: [{ days: [0], start: '18:00', end: '19:00' }, { days: [5], start: ' 12:00 ', end: '' }], audience: 'members', participantIds: ['kuba'] }));
    expect(fields).toEqual([
      { title: 'Tańce', date: '2026-10-05', startTime: '18:00', endTime: '19:00', rule: parseRule('FREQ=WEEKLY;BYDAY=MO'), until: null, audience: 'members', participantIds: ['kuba'], responsibleId: null, location: null, days: 1 },
      { title: 'Tańce', date: '2026-10-05', startTime: '12:00', endTime: null, rule: parseRule('FREQ=WEEKLY;BYDAY=SA'), until: null, audience: 'members', participantIds: ['kuba'], responsibleId: null, location: null, days: 1 },
    ]);
  });

  it('reguły: bez powtarzania, codziennie co 2 dni, tydzień (dni posortowane, bez powtórzeń), miesiąc, rok, koniec', () => {
    expect(rules(form())).toEqual([null]);
    expect(rules(form({ repeat: 'daily', interval: ' 2 ' }))).toEqual(['FREQ=DAILY;INTERVAL=2']);
    expect(rules(form({ repeat: 'weekly', slots: [{ days: [5, 0, 5], start: '18:00', end: '' }] }))).toEqual(['FREQ=WEEKLY;BYDAY=MO,SA']);
    expect(rules(form({ repeat: 'monthly' }))).toEqual(['FREQ=MONTHLY']);
    expect(rules(form({ repeat: 'monthly', monthly: 'nth' }))).toEqual(['FREQ=MONTHLY;BYDAY=1MO']);
    expect(rules(form({ date: '2026-10-26', repeat: 'monthly', monthly: 'last' }))).toEqual(['FREQ=MONTHLY;BYDAY=-1MO']);
    expect(rules(form({ repeat: 'yearly', ends: 'until', until: '2030-10-05' }))).toEqual(['FREQ=YEARLY;UNTIL=20301005']);
    // Bez powtarzania koniec serii się nie liczy; inne niż „co tydzień” mają jeden termin.
    expect(ok(form({ ends: 'until', until: 'zła' }))[0]!.until).toBeNull();
    expect(ok(form({ repeat: 'daily', slots: [{ days: [], start: '08:00', end: '' }, { days: [], start: 'x', end: '' }] }))).toHaveLength(1);
  });

  it('cały dzień: bez godzin (pola godzin ignorowane); cała grupa: bez listy uczestników', () => {
    expect(ok(form({ allDay: true, slots: [{ days: [0], start: 'zła', end: 'zła' }], participantIds: ['kuba'] }))[0]).toMatchObject({ startTime: null, endTime: null, participantIds: [] });
  });

  it.each<[Partial<EventForm>, string]>([
    [{ title: '  ' }, 'title'],
    [{ date: '2026-02-30' }, 'date'],
    [{ date: 'jutro' }, 'date'],
    [{ slots: [{ days: [0], start: '', end: '' }] }, 'time'],
    [{ slots: [{ days: [0], start: '24:00', end: '' }] }, 'time'],
    [{ slots: [{ days: [0], start: '18:00', end: '7:00' }] }, 'time'],
    [{ slots: [{ days: [0], start: '18:00', end: '18:00' }] }, 'endBeforeStart'],
    [{ slots: [{ days: [0], start: '18:00', end: '17:59' }] }, 'endBeforeStart'],
    [{ repeat: 'weekly', slots: [{ days: [0], start: '18:00', end: '' }, { days: [], start: '12:00', end: '' }] }, 'days'],
    [{ repeat: 'daily', interval: '0' }, 'interval'],
    [{ repeat: 'daily', interval: '100' }, 'interval'],
    [{ repeat: 'daily', interval: 'x' }, 'interval'],
    [{ date: '2026-10-29', repeat: 'monthly', monthly: 'nth' }, 'monthly'], // 29.10 to 5. czwartek
    [{ date: '2026-10-05', repeat: 'monthly', monthly: 'last' }, 'monthly'],
    // PWD-37: ostatni dzień miesiąca — start musi nim być (RFC: DTSTART to pierwsze wystąpienie).
    [{ date: '2026-10-30', repeat: 'monthly', monthly: 'lastDay' }, 'monthly'],
    [{ repeat: 'daily', ends: 'until', until: '2026-10-04' }, 'until'],
    [{ repeat: 'daily', ends: 'until', until: '' }, 'until'],
    [{ audience: 'members', participantIds: [] }, 'participants'],
  ])('błąd %j → %s', (over, error) => expect(validateForm(form(over))).toEqual({ error }));

  it('ostatni dzień miesiąca (PWD-37) → BYMONTHDAY=-1; z powrotem w formularzu', () => {
    const f = form({ date: '2026-10-31', repeat: 'monthly', monthly: 'lastDay' });
    const [fields] = ok(f);
    expect(formatRule(fields!.rule!)).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
    expect(formOf(fields!).monthly).toBe('lastDay');
    expect(formatRule(ok(form({ date: '2026-11-30', repeat: 'monthly', monthly: 'lastDay' }))[0]!.rule!)).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
  });

  it('koniec w dniu startu jest poprawny', () => {
    expect(ok(form({ repeat: 'daily', ends: 'until', until: '2026-10-05' }))[0]!.until).toBe('2026-10-05');
  });

  it('audyt 2 (E-16): koniec przed pierwszym terminem serii (start wyrównany do reguły) — błąd, seria bez terminów nie powstaje', () => {
    // „Co tydzień w pt.”, data czw. 8.10, koniec 8.10: pierwszy termin to pt. 9.10.
    const fri = (until: string, slots = [{ days: [4], start: '10:00', end: '' }]) => form({ date: '2026-10-08', repeat: 'weekly', slots, ends: 'until', until });
    expect(validateForm(fri('2026-10-08'))).toEqual({ error: 'until' });
    expect(ok(fri('2026-10-09'))[0]!.until).toBe('2026-10-09');
    // Kilka terminów: wystarczy jeden bez terminu przed końcem.
    expect(validateForm(fri('2026-10-09', [{ days: [4], start: '10:00', end: '' }, { days: [5], start: '12:00', end: '' }]))).toEqual({ error: 'until' });
    // Bez powtarzania koniec się nie liczy.
    expect(ok(form({ date: '2026-10-08', ends: 'until', until: '2026-10-01' }))[0]!.until).toBeNull();
  });

  it('pozycja dnia tygodnia w miesiącu', () => {
    expect(weekdayPosition('2026-10-05')).toEqual({ n: 1, last: false, wd: 0, lastDay: false });
    expect(weekdayPosition('2026-10-26')).toEqual({ n: 4, last: true, wd: 0, lastDay: false });
    expect(weekdayPosition('2026-10-31')).toEqual({ n: 5, last: true, wd: 5, lastDay: true });
    expect(weekdayPosition('2026-02-22')).toEqual({ n: 4, last: true, wd: 6, lastDay: false });
    expect(weekdayPosition('2028-02-29')).toMatchObject({ lastDay: true });
  });

  it('formOf: zapisane wydarzenie → formularz (godziny bez sekund, dni z reguły, miesięczne warianty)', () => {
    const base: EventFields = { title: 'T', date: '2026-10-05', startTime: '18:00:00', endTime: null, rule: null, until: null, audience: 'group', participantIds: [], responsibleId: null };
    expect(formOf(base)).toMatchObject({ allDay: false, slots: [{ days: [0], start: '18:00', end: '' }], repeat: 'none', interval: '1', monthly: 'day', ends: 'never', until: '' });
    expect(formOf({ ...base, startTime: null })).toMatchObject({ allDay: true, slots: [{ start: '', end: '' }] });
    expect(formOf({ ...base, rule: parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA,MO'), until: '2026-12-31', endTime: '19:00:00' })).toMatchObject({ repeat: 'weekly', interval: '2', slots: [{ days: [0, 5], end: '19:00' }], ends: 'until', until: '2026-12-31' });
    expect(formOf({ ...base, rule: parseRule('FREQ=WEEKLY') }).slots[0]!.days).toEqual([0]);
    expect(formOf({ ...base, rule: parseRule('FREQ=MONTHLY;BYDAY=1MO') }).monthly).toBe('nth');
    expect(formOf({ ...base, rule: parseRule('FREQ=MONTHLY;BYDAY=-1MO') }).monthly).toBe('last');
    expect(formOf({ ...base, rule: parseRule('FREQ=MONTHLY;BYMONTHDAY=-1') }).monthly).toBe('lastDay');
    expect(formOf({ ...base, rule: parseRule('FREQ=MONTHLY;BYMONTHDAY=15') }).monthly).toBe('day');
    expect(formOf({ ...base, rule: parseRule('FREQ=DAILY') }).repeat).toBe('daily');
    expect(formOf({ ...base, rule: parseRule('FREQ=YEARLY') }).repeat).toBe('yearly');
  });

  it('własność: formularz z zapisanego wydarzenia daje te same wartości (dla reguł, które tworzy aplikacja)', () => {
    const time = fc.tuple(fc.integer({ min: 0, max: 22 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    const ruleText = fc.oneof(
      fc.constant(null),
      fc.integer({ min: 1, max: 99 }).map((n) => `FREQ=DAILY${n > 1 ? `;INTERVAL=${n}` : ''}`),
      fc.uniqueArray(fc.constantFrom(...WD), { minLength: 1 }).map((d) => `FREQ=WEEKLY;BYDAY=${WD.filter((x) => d.includes(x)).join(',')}`),
      fc.constant('FREQ=MONTHLY'),
      fc.constant('FREQ=YEARLY;INTERVAL=3'),
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 28 }), time, fc.boolean(), ruleText, fc.boolean(), fc.integer({ min: 1, max: config.events.MAX_DAYS }), (day, start, allDay, rt, withUntil, length) => {
        const rule = rt === null ? null : parseRule(rt);
        // D199: całodniowe przez kilka dni — jednorazowe i co 3 lata (bez nakładania się terminów).
        const days = allDay && (rule === null || rule.freq === 'YEARLY') ? length : 1;
        const f: EventFields = {
          title: 'X',
          date: `2026-10-${String(day).padStart(2, '0')}`,
          startTime: allDay ? null : start,
          endTime: allDay ? null : `23:${start.slice(3)}`,
          rule,
          until: rule && withUntil ? '2027-01-31' : null,
          audience: 'group',
          participantIds: [],
          responsibleId: null,
          location: null,
          days,
        };
        const back = ok(formOf(f))[0]!;
        expect({ ...back, rule: back.rule && formatRule(back.rule) }).toEqual({ ...f, rule: rule && formatRule(rule) });
      }),
    );
  });
});

describe('miejsce w formularzu (D115)', () => {
  it('przycięte, puste = brak, za długie — błąd', () => {
    const f = { ...emptyForm('2026-10-05'), title: 'Basen', slots: [{ days: [0], start: '17:00', end: '' }] };
    expect(ok({ ...f, location: '  ul. Wodna 1 ' })[0]!.location).toBe('ul. Wodna 1');
    expect(ok({ ...f, location: '   ' })[0]!.location).toBeNull();
    expect(validateForm({ ...f, location: 'x'.repeat(config.events.LOCATION_MAX_LENGTH + 1) })).toEqual({ error: 'location' });
    expect(formOf({ ...ok(f)[0]!, location: undefined }).location).toBe('');
  });

  describe('D199: przez kilka dni i przez północ', () => {
    const allDay = (over: Partial<EventForm> = {}) => form({ allDay: true, ...over });
    it('„Kończy się”: ostatni dzień włącznie → liczba dni; pusty albo ten sam dzień = jeden', () => {
      expect(ok(allDay({ endDate: '2026-10-09' }))[0]).toMatchObject({ startTime: null, days: 5 });
      expect(ok(allDay({ endDate: '' }))[0]!.days).toBe(1);
      expect(ok(allDay({ endDate: ' 2026-10-05 ' }))[0]!.days).toBe(1);
      // Z godziną „Kończy się” się nie liczy (pole jest tylko przy „Cały dzień”).
      expect(ok(form({ endDate: '2026-10-09' }))[0]!.days).toBe(1);
      // Przez koniec roku i miesiąca: 30.12–2.01 = 4 dni.
      expect(ok(allDay({ date: '2026-12-30', endDate: '2027-01-02' }))[0]!.days).toBe(4);
    });
    it('błędy: koniec przed początkiem, zła data, ponad limit, nachodzące powtórzenia', () => {
      expect(validateForm(allDay({ endDate: '2026-10-04' }))).toEqual({ error: 'endDate' });
      expect(validateForm(allDay({ endDate: '2026-02-30' }))).toEqual({ error: 'endDate' });
      expect(validateForm(allDay({ endDate: '2026-11-05' }))).toEqual({ error: 'tooLong' });
      expect(ok(allDay({ endDate: '2026-11-04' }))[0]!.days).toBe(config.events.MAX_DAYS);
      // Codziennie po 2 dni — terminy nachodzą na siebie; co tydzień w pon. i śr. po 3 dni też.
      expect(validateForm(allDay({ endDate: '2026-10-06', repeat: 'daily' }))).toEqual({ error: 'overlap' });
      expect(validateForm(allDay({ endDate: '2026-10-07', repeat: 'weekly', slots: [{ days: [0, 2], start: '', end: '' }] }))).toEqual({ error: 'overlap' });
      // …a po 2 dni w pon. i śr. albo weekend co dwa tygodnie — nie.
      expect(ok(allDay({ endDate: '2026-10-06', repeat: 'weekly', slots: [{ days: [0, 2], start: '', end: '' }] }))[0]!.days).toBe(2);
      expect(ok(allDay({ date: '2026-10-16', endDate: '2026-10-18', repeat: 'weekly', interval: '2', slots: [{ days: [4], start: '', end: '' }] }))[0]!.days).toBe(3);
      // Co 2 dni, każdy na 2 dni — styka się, nie nachodzi.
      expect(ok(allDay({ endDate: '2026-10-06', repeat: 'daily', interval: '2' }))[0]!.days).toBe(2);
      // Seria z jednym terminem (koniec powtarzania w dniu startu) nie ma odstępu.
      expect(ok(allDay({ endDate: '2026-10-06', repeat: 'daily', ends: 'until', until: '2026-10-05' }))[0]!.days).toBe(2);
    });
    it('przez północ: tylko w formularzu wydarzenia; koniec równy początkowi = doba', () => {
      expect(validateForm(form({ slots: [{ days: [0], start: '22:00', end: '06:00' }] }))).toEqual({ error: 'endBeforeStart' });
      const night = validateForm(form({ slots: [{ days: [0], start: '22:00', end: '06:00' }] }), { overnight: true });
      expect(night).toMatchObject({ fields: [{ startTime: '22:00', endTime: '06:00', days: 1 }] });
      expect(validateForm(form({ slots: [{ days: [0], start: '08:00', end: '08:00' }] }), { overnight: true })).toMatchObject({ fields: [{ startTime: '08:00', endTime: '08:00' }] });
    });
    it('formularz z zapisanego: ostatni dzień z długości; przesunięcie startu przesuwa koniec', () => {
      const f = ok(allDay({ endDate: '2026-10-09' }))[0]!;
      expect(formOf(f)).toMatchObject({ allDay: true, endDate: '2026-10-09' });
      expect(formOf({ ...f, days: 1 }).endDate).toBe('');
      expect(formOf({ ...f, days: undefined }).endDate).toBe('');
      expect(moveStart({ date: '2026-10-05', endDate: '2026-10-09' }, '2026-10-30')).toEqual({ date: '2026-10-30', endDate: '2026-11-03' });
      expect(moveStart({ date: '2026-10-05', endDate: '' }, '2026-10-30')).toEqual({ date: '2026-10-30', endDate: '' });
      expect(moveStart({ date: '', endDate: '2026-10-09' }, '2026-10-30')).toEqual({ date: '2026-10-30', endDate: '2026-10-09' });
    });
  });
});
