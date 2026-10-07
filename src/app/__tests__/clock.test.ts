import { localNow, localToMs } from '../clock';

describe('czas Europe/Warsaw', () => {
  it('lato (UTC+2), zima (UTC+1), północ i zmiana czasu', () => {
    expect(localNow(Date.UTC(2026, 9, 7, 8, 0))).toEqual({ y: 2026, m: 10, d: 7, hh: 10, mm: 0 });
    expect(localNow(Date.UTC(2026, 11, 31, 23, 30))).toEqual({ y: 2027, m: 1, d: 1, hh: 0, mm: 30 });
    // Oczekiwania policzone niezależnie: Python zoneinfo (baza IANA), ZoneInfo("Europe/Warsaw").
    expect(localNow(Date.UTC(2026, 9, 25, 0, 59))).toEqual({ y: 2026, m: 10, d: 25, hh: 2, mm: 59 });
    expect(localNow(Date.UTC(2026, 9, 25, 1, 0))).toEqual({ y: 2026, m: 10, d: 25, hh: 2, mm: 0 });
    expect(localNow(Date.UTC(2026, 2, 29, 1, 0))).toEqual({ y: 2026, m: 3, d: 29, hh: 3, mm: 0 });
  });
});

describe('czas lokalny → chwila (kalendarz iPhone’a, D7)', () => {
  // Oczekiwania policzone niezależnie: Python zoneinfo, datetime(..., tzinfo=ZoneInfo("Europe/Warsaw")).timestamp().
  it.each([
    [{ y: 2026, m: 10, d: 12, hh: 18, mm: 0 }, Date.UTC(2026, 9, 12, 16, 0)],
    [{ y: 2026, m: 12, d: 5, hh: 12, mm: 0 }, Date.UTC(2026, 11, 5, 11, 0)],
    [{ y: 2027, m: 1, d: 1, hh: 0, mm: 30 }, Date.UTC(2026, 11, 31, 23, 30)],
    // Jesień: 2:30 występuje dwa razy — pierwsze (czas letni, UTC+2), jak fold=0 w Pythonie.
    [{ y: 2026, m: 10, d: 25, hh: 2, mm: 30 }, Date.UTC(2026, 9, 25, 0, 30)],
    [{ y: 2026, m: 10, d: 25, hh: 3, mm: 0 }, Date.UTC(2026, 9, 25, 2, 0)],
    // Wiosna: 2:30 nie istnieje — przesunięcie o godzinę do przodu (3:30 czasu letniego).
    [{ y: 2026, m: 3, d: 29, hh: 2, mm: 30 }, Date.UTC(2026, 2, 29, 1, 30)],
  ])('%j', (local, ms) => expect(localToMs(local)).toBe(ms));

  it('powrót: localNow(localToMs(x)) = x dla zwykłych godzin', () => {
    for (let h = 0; h < 24; h++) expect(localNow(localToMs({ y: 2026, m: 7, d: 1, hh: h, mm: 15 }))).toEqual({ y: 2026, m: 7, d: 1, hh: h, mm: 15 });
  });
});
