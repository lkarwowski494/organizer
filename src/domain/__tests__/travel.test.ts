import { config } from '../../config';
import { isTravelMode, leaveAt, navigationUrl, travelMinutes, travelTargets } from '../travel';

describe('nawigacja i „wyjdź o” (D115–D117)', () => {
  it('Mapy Apple: nowe linki od iOS 18.4, starsze dawne; Google — link uniwersalny', () => {
    expect(navigationUrl('apple', ' Basen Delfin, ul. Wodna 1 ', 'transit', '18.4')).toBe('https://maps.apple.com/directions?destination=Basen%20Delfin%2C%20ul.%20Wodna%201&mode=transit');
    expect(navigationUrl('apple', 'Wodna 1', 'driving', '26.0')).toBe('https://maps.apple.com/directions?destination=Wodna%201&mode=driving');
    expect(navigationUrl('apple', 'Wodna 1', 'walking', '18.3.2')).toBe('https://maps.apple.com/?daddr=Wodna%201&dirflg=w');
    expect(navigationUrl('apple', 'Wodna 1', 'transit', '17')).toBe('https://maps.apple.com/?daddr=Wodna%201&dirflg=r');
    expect(navigationUrl('apple', 'Wodna 1', 'driving', '')).toBe('https://maps.apple.com/?daddr=Wodna%201&dirflg=d');
    expect(navigationUrl('google', 'Wodna 1', 'walking', '18.4')).toBe('https://www.google.com/maps/dir/?api=1&destination=Wodna%201&travelmode=walking');
  });

  it('wyjdź o: start − dojazd − zapas, w dół do minuty; minuty dojazdu w górę', () => {
    const start = Date.UTC(2026, 9, 8, 15, 0);
    expect(leaveAt(start, 25 * 60 + 10)).toBe(start - (26 + config.travel.BUFFER_MIN) * 60_000);
    expect(leaveAt(start, 600, 0)).toBe(start - 600_000);
    expect(travelMinutes(61)).toBe(2);
    expect(travelMinutes(0)).toBe(1);
    expect(isTravelMode('transit')).toBe(true);
    expect(isTravelMode('bike')).toBe(false);
  });
});

describe('dla których wydarzeń liczyć dojazd (D116)', () => {
  const now = Date.UTC(2026, 9, 8, 8, 0); // 10:00 w Warszawie
  const toMs = (date: string, time: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)) - 2, Number(time.slice(3, 5)));
  const o = (id: string, x: Partial<{ date: string; startTime: string | null; location: string | null; concernsMe: boolean }> = {}) => ({ eventId: id, occurrenceDate: '2026-10-08', date: '2026-10-08', startTime: '17:00:00', title: id, location: 'Wodna 1', concernsMe: true, ...x });
  it('dziś, mnie dotyczy, z miejscem i godziną, od teraz do AHEAD_HOURS; najbliższe najpierw; tryb na wydarzenie', () => {
    const r = travelTargets(
      [o('b', { startTime: '12:00' }), o('a'), o('past', { startTime: '09:00' }), o('late', { startTime: '23:30' }), o('tomorrow', { date: '2026-10-09' }), o('other', { concernsMe: false }), o('allday', { startTime: null }), o('noplace', { location: '  ' }), o('nullplace', { location: null })],
      '2026-10-08',
      now,
      toMs,
      (id) => (id === 'a' ? 'walking' : 'driving'),
    );
    expect(r.map((t) => [t.eventId, t.mode, t.location])).toEqual([['b', 'driving', 'Wodna 1'], ['a', 'walking', 'Wodna 1']]);
    expect(r[1]).toMatchObject({ key: 'a|2026-10-08', startMs: Date.UTC(2026, 9, 8, 15, 0) });
    const many = Array.from({ length: config.travel.MAX_EVENTS + 3 }, (_, i) => o(`e${String(i).padStart(2, '0')}`, { startTime: '15:00' }));
    expect(travelTargets(many, '2026-10-08', now, toMs, () => 'driving')).toHaveLength(config.travel.MAX_EVENTS);
  });
});
