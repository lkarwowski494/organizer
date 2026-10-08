import { monthGrid, monthOf, shiftMonth } from '../month-grid';

describe('siatka miesiąca (D103)', () => {
  it('październik 2026: od pon. 28 września, 5 tygodni, poza miesiącem oznaczone', () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(35);
    expect(g[0]).toEqual({ date: '2026-09-28', d: 28, inMonth: false, holiday: null });
    expect(g[3]).toMatchObject({ date: '2026-10-01', inMonth: true });
    expect(g.at(-1)).toMatchObject({ date: '2026-11-01', inMonth: false, holiday: 'Wszystkich Świętych' });
  });

  it('6 tygodni (sierpień 2026), 4 (luty 2021 od poniedziałku), Wigilia jako święto', () => {
    expect(monthGrid(2026, 8)).toHaveLength(42);
    expect(monthGrid(2021, 2)).toHaveLength(28);
    expect(monthGrid(2026, 12).find((d) => d.date === '2026-12-24')!.holiday).toBe('Wigilia Bożego Narodzenia');
  });

  it('przesuwanie miesiąca przez granicę roku; miesiąc z wartości albo dzisiejszy', () => {
    expect(shiftMonth({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    expect(shiftMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(shiftMonth({ y: 2026, m: 10 }, 0)).toEqual({ y: 2026, m: 10 });
    const today = { y: 2026, m: 10, d: 8 };
    expect(monthOf(' 2027-03-15 ', today)).toEqual({ y: 2027, m: 3 });
    expect(monthOf('', today)).toEqual({ y: 2026, m: 10 });
    expect(monthOf('2026-02-30', today)).toEqual({ y: 2026, m: 10 });
  });
});
