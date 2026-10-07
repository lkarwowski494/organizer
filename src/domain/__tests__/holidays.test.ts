import { HOLIDAYS_PL } from '../../config/holidays.pl';
import { formatIsoDate } from '../civil-date';
import { easterSunday, polishHolidays } from '../holidays';
import corpus from './fixtures/holidays.pl.json';

describe('polskie dni wolne od pracy', () => {
  it.each(Object.entries(corpus.easter))('Wielkanoc %s = dateutil.easter', (y, iso) => {
    expect(formatIsoDate(easterSunday(Number(y)))).toBe(iso);
  });

  it.each(Object.entries(corpus.holidays))('rok %s = biblioteka holidays (niezależna implementacja)', (y, dates) => {
    expect(polishHolidays(Number(y)).map((h) => h.date)).toEqual(dates);
  });

  it('2026: nazwy i daty zgodne z ustawą (Dz. U. 2025 poz. 296)', () => {
    expect(polishHolidays(2026)).toEqual([
      { date: '2026-01-01', name: 'Nowy Rok' },
      { date: '2026-01-06', name: 'Święto Trzech Króli' },
      { date: '2026-04-05', name: 'pierwszy dzień Wielkiej Nocy' },
      { date: '2026-04-06', name: 'drugi dzień Wielkiej Nocy' },
      { date: '2026-05-01', name: 'Święto Państwowe' },
      { date: '2026-05-03', name: 'Święto Narodowe Trzeciego Maja' },
      { date: '2026-05-24', name: 'pierwszy dzień Zielonych Świątek' },
      { date: '2026-06-04', name: 'dzień Bożego Ciała' },
      { date: '2026-08-15', name: 'Wniebowzięcie Najświętszej Maryi Panny' },
      { date: '2026-11-01', name: 'Wszystkich Świętych' },
      { date: '2026-11-11', name: 'Narodowe Święto Niepodległości' },
      { date: '2026-12-24', name: 'Wigilia Bożego Narodzenia' },
      { date: '2026-12-25', name: 'pierwszy dzień Bożego Narodzenia' },
      { date: '2026-12-26', name: 'drugi dzień Bożego Narodzenia' },
    ]);
  });

  it('Wigilia wolna od 2025, nie w 2024; ustawa wymienia 14 dni', () => {
    expect(polishHolidays(2024).some((h) => h.date === '2024-12-24')).toBe(false);
    expect(polishHolidays(2025).some((h) => h.date === '2025-12-24')).toBe(true);
    expect(HOLIDAYS_PL.filter((h) => h.kind !== 'single')).toHaveLength(14);
    expect(polishHolidays(2018).find((h) => h.date === '2018-11-12')?.name).toMatch(/Setnej Rocznicy/);
    expect(polishHolidays(2019).some((h) => h.date === '2019-11-12')).toBe(false);
  });

  it('lata spoza zakresu reguł', () => {
    expect(() => polishHolidays(2010)).toThrow('od 2011');
    expect(() => polishHolidays(2026.5)).toThrow(RangeError);
  });
});
