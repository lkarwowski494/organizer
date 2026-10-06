import * as fc from 'fast-check';

import { addDays, daysInMonth, fromDayNumber, isoWeekday, isValidDate, toDayNumber } from '../civil-date';

// Wzorzec: Date.UTC w JS (kalendarz gregoriański proleptyczny, ECMA-262 §21.4.1).
const utcDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;

describe('civil-date', () => {
  it('numer dnia zgodny z Date.UTC i odwracalny', () => {
    fc.assert(
      fc.property(fc.integer({ min: -200_000, max: 200_000 }), (z) => {
        const c = fromDayNumber(z);
        expect(utcDay(c.y, c.m, c.d)).toBe(z);
        expect(toDayNumber(c)).toBe(z);
      }),
    );
  });

  it('znane punkty', () => {
    expect(toDayNumber({ y: 1970, m: 1, d: 1 })).toBe(0);
    expect(isoWeekday({ y: 2026, m: 10, d: 6 })).toBe(1); // wtorek
    expect(addDays({ y: 2028, m: 2, d: 28 }, 1)).toEqual({ y: 2028, m: 2, d: 29 });
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
  });

  it('lata przestępne i długości miesięcy', () => {
    expect([daysInMonth(2028, 2), daysInMonth(2026, 2), daysInMonth(1900, 2), daysInMonth(2000, 2)]).toEqual([29, 28, 28, 29]);
    expect(isValidDate(2026, 4, 31)).toBe(false);
    expect(isValidDate(2026, 13, 1)).toBe(false);
  });
});
