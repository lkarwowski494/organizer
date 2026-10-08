import { findTimeRange, withoutRange } from '../time-range';

const r = (text: string, ignore?: { start: number; end: number }[]) => {
  const x = findTimeRange(text, ignore);
  return x && [x.from, x.to, x.text];
};

describe('zakres godzin w szybkim dodawaniu (D99)', () => {
  it.each([
    ['basen 17-18', ['17:00', '18:00', '17-18']],
    ['basen 17–18', ['17:00', '18:00', '17–18']],
    ['basen 17 — 18', ['17:00', '18:00', '17 — 18']],
    ['basen 15:30-16:00', ['15:30', '16:00', '15:30-16:00']],
    ['basen o 17.00–18.30', ['17:00', '18:30', 'o 17.00–18.30']],
    ['basen godz. 7-8', ['07:00', '08:00', 'godz. 7-8']],
    ['basen w godz. 9:15-10', ['09:15', '10:00', 'w godz. 9:15-10']],
    ['basen od 17 do 18', ['17:00', '18:00', 'od 17 do 18']],
    ['basen OD godz. 9 do 10:30', ['09:00', '10:30', 'OD godz. 9 do 10:30']],
    ['basen do 17-18', ['17:00', '18:00', '17-18']],
    ['17-18 basen', ['17:00', '18:00', '17-18']],
  ])('%s', (text, want) => expect(r(text)).toEqual(want));

  it.each([
    'basen 18-17', // koniec przed początkiem
    'basen 22-1',
    'basen 17-17',
    'basen 15.10-16.10', // daty, nie godziny
    'basen 24-25',
    'basen 17-185',
    'basen 1.10-18', // kropka i minuty ≤ 12 — raczej data
    'nr17-18',
    'od 17 do',
    'basen 17:5-18',
    'basen o 17',
  ])('nie zakres: %s', (text) => expect(findTimeRange(text)).toBeNull());

  it('pierwszy zakres wygrywa; odklikany pomijany; wycięcie zachowuje pozycje', () => {
    expect(r('od 9 do 10 i 17-18')).toEqual(['09:00', '10:00', 'od 9 do 10']);
    expect(r('17-18 i od 9 do 10')).toEqual(['17:00', '18:00', '17-18']);
    expect(r('17-18 i od 9 do 10', [{ start: 0, end: 5 }])).toEqual(['09:00', '10:00', 'od 9 do 10']);
    const t = 'basen 17-18 jutro';
    const x = findTimeRange(t)!;
    expect(withoutRange(t, x)).toBe('basen       jutro');
  });
});
