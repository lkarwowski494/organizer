/**
 * Audyt 3 (N-114): długość wydarzenia z godziną w noc zmiany czasu — rzeczywisty czas, nie różnica godzin na zegarze.
 * Oczekiwania liczy niezależnie Python zoneinfo (scripts/gen-dst-corpus.py), a nie Intl z silnika JS.
 */
import corpus from './fixtures/dst-lengths.json';
import { exactMinutes } from '../span';
import { lengthLabel } from '../views/events';

describe('N-114: długość przez zmianę czasu (Europe/Warsaw)', () => {
  it('nocny dyżur 22:00–06:00 w noc 24/25.10.2026 trwa 9 h, 28/29.03.2026 — 7 h; zwykła noc — 8 h', () => {
    expect(lengthLabel('22:00', '06:00', null, '2026-10-24')).toBe('9 h');
    expect(lengthLabel('22:00:00', '06:00:00', null, '2026-03-28')).toBe('7 h');
    expect(lengthLabel('22:00', '06:00', null, '2026-10-23')).toBe('8 h');
  });

  it('wyjazd pt. 23.10 18:00 – nd. 25.10 16:00 — 47 h', () => {
    expect(lengthLabel('18:00', '16:00', 46 * 60, '2026-10-23')).toBe('47 h');
  });

  it('zajęcia 02:00–03:00 w luce wiosennej (02:xx nie istnieje) — długość na zegarze, nie „0 min”', () => {
    expect(exactMinutes('2026-03-29', '02:00', '03:00', null)).toBe(60);
    expect(lengthLabel('02:00', '03:00', null, '2026-03-29')).toBe('1 h');
  });

  it('bez godziny albo bez końca — brak długości; bez dnia — na zegarze (jak dotąd)', () => {
    expect(exactMinutes('2026-10-24', null, null, null)).toBeNull();
    expect(exactMinutes('2026-10-24', '22:00', null, null)).toBeNull();
    expect(lengthLabel('22:00', '06:00')).toBe('8 h');
  });

  it.each(corpus as { date: string; start: string; end: string; duration: number | null; minutes: number }[])('korpus zoneinfo: $date $start–$end ($duration) → $minutes min', (c) => {
    expect(exactMinutes(c.date, c.start, c.end, c.duration)).toBe(c.minutes);
  });
});
