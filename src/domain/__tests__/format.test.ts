import { formatDue, formatLongDate, formatMonth, formatTime, parseIsoDate } from '../format';

const TODAY = { y: 2026, m: 10, d: 7 }; // środa

describe('daty na ekranach', () => {
  it('pełna data wg wzorca CLDR „EEEE, d MMMM y”, wielka litera na początku', () => {
    expect(formatLongDate(TODAY, TODAY)).toBe('Środa, 7 października');
    expect(formatLongDate({ y: 2027, m: 1, d: 4 }, TODAY)).toBe('Poniedziałek, 4 stycznia 2027');
    expect(formatLongDate({ y: 2026, m: 10, d: 11 }, TODAY)).toBe('Niedziela, 11 października');
  });

  it('miesiąc w mianowniku', () => {
    expect(formatMonth(2026, 10)).toBe('Październik 2026');
    expect(formatMonth(2026, 2)).toBe('Luty 2026');
  });

  it('termin względny i bezwzględny', () => {
    expect(formatDue({ date: '2026-10-07', time: null }, TODAY)).toBe('dziś');
    expect(formatDue({ date: '2026-10-07', time: '17:30:00' }, TODAY)).toBe('dziś · 17:30');
    expect(formatDue({ date: '2026-10-08', time: '07:05' }, TODAY)).toBe('jutro · 07:05');
    expect(formatDue({ date: '2026-10-06', time: null }, TODAY)).toBe('wczoraj');
    expect(formatDue({ date: '2026-10-09', time: null }, TODAY)).toBe('pt. 9 paź');
    expect(formatDue({ date: '2026-10-11', time: null }, TODAY)).toBe('niedz. 11 paź');
    expect(formatDue({ date: '2027-01-04', time: null }, TODAY)).toBe('pon. 4 sty 2027');
    expect(formatDue({ date: '2026-12-31', time: null }, { y: 2027, m: 1, d: 1 })).toBe('wczoraj');
  });

  it('godzina bez sekund', () => {
    expect(formatTime('09:00:00')).toBe('09:00');
    expect(formatTime('09:00')).toBe('09:00');
  });

  it('zła data zgłaszana wprost', () => {
    expect(parseIsoDate('2026-10-07')).toEqual(TODAY);
    for (const bad of ['2026-1-07', '07.10.2026', '', '2026-10-07T00:00']) expect(() => parseIsoDate(bad)).toThrow('oczekiwano daty');
  });
});
