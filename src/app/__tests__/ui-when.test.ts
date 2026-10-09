/** Napisy „kiedy” wierszy wydarzeń (src/ui/when.ts, D199) — czysta logika pod progiem 100% (audyt 2, M-51). */
import { occurrenceRow, partText, whenText } from '../../ui/when';

describe('napisy „kiedy” wydarzeń', () => {
  it('każdy rodzaj dnia: cały dzień, godzina, od–do, od, do', () => {
    expect(whenText({ kind: 'allDay' })).toBeNull();
    expect(whenText({ kind: 'time', start: '17:00', end: null })).toBe('17:00');
    expect(whenText({ kind: 'time', start: '17:00', end: '18:00' })).toBe('17:00–18:00');
    expect(whenText({ kind: 'from', start: '22:00' })).toBe('od 22:00');
    expect(whenText({ kind: 'until', end: '06:00' })).toBe('do 06:00');
    expect([partText(null), partText({ day: 2, days: 3 })]).toEqual([null, 'dzień 2 z 3']);
  });

  it('wiersz: długość tylko przy godzinach od–do; dzień wielodniowego', () => {
    expect(occurrenceRow({ startTime: '22:00:00', endTime: '06:00:00', part: { day: 1, days: 2 } })).toEqual({ time: '22:00–06:00', length: '8 h', part: 'dzień 1 z 2' });
    expect(occurrenceRow({ startTime: '22:00:00', endTime: '06:00:00', part: { day: 2, days: 2 } })).toEqual({ time: 'do 06:00', length: null, part: 'dzień 2 z 2' });
    expect(occurrenceRow({ startTime: '10:00', endTime: null, part: { day: 1, days: 3 } })).toEqual({ time: 'od 10:00', length: null, part: 'dzień 1 z 3' });
    expect(occurrenceRow({ startTime: null, endTime: null, part: null })).toEqual({ time: null, length: null, part: null });
  });
});
