import { localNow } from '../clock';

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
