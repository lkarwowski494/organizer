import { config } from '../../config';
import { departureMs, geoLookup, geoStore, isTravelMode, leaveAt, navigationUrl, readGeoCache, readTravelResults, travelInfoFor, travelMinutes, travelTargets } from '../travel';

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
  const o = (id: string, x: Partial<{ date: string; occurrenceDate: string; startTime: string | null; location: string | null; concernsMe: boolean; assignedToMe: boolean; groupId: string; lessonFor: { memberId: string }[] | null }> = {}) => ({ eventId: id, occurrenceDate: '2026-10-08', date: '2026-10-08', startTime: '17:00:00', title: id, location: 'Wodna 1', concernsMe: true, assignedToMe: false, groupId: 'g', ...x });
  it('PW-2: zakres „Tylko przypisane do mnie” — dojazd tylko do moich (jak Moje sprawy)', () => {
    const scope = (g: string) => (g === 'klasa' ? ('mine' as const) : ('all' as const));
    const r = travelTargets([o('mine', { groupId: 'klasa', assignedToMe: true }), o('class', { groupId: 'klasa' }), o('home')], now, toMs, () => 'driving', new Set(), scope);
    expect(r.map((x) => x.eventId)).toEqual(['home', 'mine']);
  });
  it('mnie dotyczy, z miejscem i godziną, od teraz do AHEAD_HOURS; najbliższe najpierw; tryb na wydarzenie', () => {
    const r = travelTargets(
      [o('b', { startTime: '12:00' }), o('a'), o('past', { startTime: '09:00' }), o('late', { startTime: '23:30' }), o('tomorrow', { date: '2026-10-09' }), o('other', { concernsMe: false }), o('allday', { startTime: null }), o('noplace', { location: '  ' }), o('nullplace', { location: null })],
      now,
      toMs,
      (id) => (id === 'a' ? 'walking' : 'driving'),
    );
    expect(r.map((t) => [t.eventId, t.mode, t.location])).toEqual([['b', 'driving', 'Wodna 1'], ['a', 'walking', 'Wodna 1']]);
    expect(r[1]).toMatchObject({ key: 'a|2026-10-08', startMs: Date.UTC(2026, 9, 8, 15, 0) });
    const many = Array.from({ length: config.travel.MAX_EVENTS + 3 }, (_, i) => o(`e${String(i).padStart(2, '0')}`, { startTime: '15:00' }));
    expect(travelTargets(many, now, toMs, () => 'driving')).toHaveLength(config.travel.MAX_EVENTS);
    // Audyt 2 (M-211, E-24): wieczorem wydarzenie jutro o 0:30 mieści się w oknie AHEAD_HOURS — dojazd liczony mimo innej daty.
    const evening = Date.UTC(2026, 9, 8, 21, 0); // 23:00 w Warszawie
    expect(travelTargets([o('night', { date: '2026-10-09', occurrenceDate: '2026-10-09', startTime: '00:30' }), o('far', { date: '2026-10-09', startTime: '17:00' })], evening, toMs, () => 'driving').map((t) => t.key)).toEqual(['night|2026-10-09']);
    // PW-23 (decyzja właściciela 8.10.2026): na termin, na który odpowiedziałem „nie będę”, dojazdu nie liczymy.
    expect(travelTargets([o('a'), o('b', { startTime: '12:00' })], now, toMs, () => 'driving', new Set(['a|2026-10-08'])).map((t) => t.eventId)).toEqual(['b']);
  });
  it('audyt 3 (N-189): lekcje dziecka — jeden cel na dziecko i dzień (pierwsza lekcja z miejscem), także po jej początku', () => {
    const tymek = [{ memberId: 'tymek' }];
    const zosia = [{ memberId: 'zosia' }];
    const lessons = [
      o('mat', { startTime: '11:00', lessonFor: tymek }),
      o('pol', { startTime: '11:55', lessonFor: tymek }),
      o('bez', { startTime: '10:30', lessonFor: tymek, location: null }),
      // Wspólna lekcja rodzeństwa: pierwsza dla Zosi, druga dla Tymka — jeden cel.
      o('wf', { startTime: '12:50', lessonFor: [...tymek, ...zosia] }),
      o('ang', { startTime: '13:45', lessonFor: zosia }),
      o('jutro', { date: '2026-10-09', occurrenceDate: '2026-10-09', startTime: '08:00', lessonFor: tymek }),
      o('basen', { startTime: '16:00' }),
    ];
    expect(travelTargets(lessons, now, toMs, () => 'driving').map((t) => t.eventId)).toEqual(['mat', 'wf', 'basen']);
    // Po początku pierwszej lekcji dziecko jest na miejscu — następna lekcja nie dostaje „Wyjdź o”.
    expect(travelTargets(lessons, Date.UTC(2026, 9, 8, 9, 30), toMs, () => 'driving').map((t) => t.eventId)).toEqual(['wf', 'basen']);
  });
});

describe('pamięć adresów i pora odjazdu (audyt 2, M-106)', () => {
  const H = 3_600_000;
  const p = { lat: 50, lng: 20 };
  it('dawny zapis przechodzi; nieznany adres sprawdzany znowu po GEO_RETRY_H; zepsute wpisy pomijane', () => {
    const c = readGeoCache({ 'Wodna 1': p, 'Brak 2': null, nowy: { c: p, at: 5 }, zly: { c: 'x', at: 1 }, zly2: 3, bezDaty: { c: p } });
    expect(c).toEqual({ 'Wodna 1': { c: p, at: 0 }, 'Brak 2': { c: null, at: 0 }, nowy: { c: p, at: 5 } });
    expect([readGeoCache(null), readGeoCache([1]), readGeoCache('x')]).toEqual([{}, {}, {}]);
    const now = 100 * H;
    expect(geoLookup(c, 'Wodna 1', now)).toEqual(p);
    expect(geoLookup(c, 'Brak 2', now)).toBeUndefined(); // stary „brak” — sprawdzić znowu
    expect(geoLookup(c, 'inny', now)).toBeUndefined();
    const miss = geoStore(c, 'Literówka', null, now);
    expect(geoLookup(miss, 'Literówka', now + (config.travel.GEO_RETRY_H * H - 1))).toBeNull();
    expect(geoLookup(miss, 'Literówka', now + config.travel.GEO_RETRY_H * H)).toBeUndefined();
  });

  it('najwyżej GEO_MAX adresów — zostają najświeżej sprawdzone', () => {
    let c = {};
    for (let i = 0; i <= config.travel.GEO_MAX; i++) c = geoStore(c, `a${String(i).padStart(4, '0')}`, p, i);
    expect(Object.keys(c)).toHaveLength(config.travel.GEO_MAX);
    expect(geoLookup(c, 'a0000', 0)).toBeUndefined();
    expect(geoLookup(c, `a${String(config.travel.GEO_MAX).padStart(4, '0')}`, 0)).toEqual(p);
    // Remis chwili: po adresie.
    const tie = geoStore(Object.fromEntries(Array.from({ length: config.travel.GEO_MAX }, (_, i) => [`b${String(i).padStart(4, '0')}`, { c: p, at: 7 }])), 'a', p, 7);
    expect(geoLookup(tie, 'a', 7)).toEqual(p);
    expect(geoLookup(tie, `b${String(config.travel.GEO_MAX - 1).padStart(4, '0')}`, 7)).toBeUndefined();
  });

  it('odjazd o porze wyjścia z poprzedniego wyniku, nie wcześniej niż teraz; bez wyniku — teraz', () => {
    const start = Date.UTC(2026, 9, 8, 17, 0);
    const now = Date.UTC(2026, 9, 8, 6, 0);
    expect(departureMs(start, null, now)).toBe(now);
    expect(departureMs(start, 1800, now)).toBe(leaveAt(start, 1800));
    expect(departureMs(start, 12 * 3600, now)).toBe(now);
  });
});

describe('zapamiętany dojazd do planowania w tle (D159)', () => {
  const target = { key: 'e|2026-10-07', eventId: 'e', title: 'Basen', location: 'Pływalnia', startMs: Date.UTC(2026, 9, 7, 15), mode: 'driving' as const };

  it('odczyt: tylko pełne pozycje; nie-obiekt — pusto', () => {
    expect(readTravelResults(null)).toEqual({});
    expect(readTravelResults([1])).toEqual({});
    expect(readTravelResults('x')).toEqual({});
    const ok = { seconds: 600, mode: 'walking', location: 'Szkoła' };
    expect(readTravelResults({ a: ok, b: { seconds: '600', mode: 'walking', location: 'x' }, c: { seconds: 1, mode: 'rower', location: 'x' }, d: { seconds: 1, mode: 'driving' }, e: null })).toEqual({ a: ok });
  });

  it('ten sam środek i miejsce — „wyjdź o” od bieżącej godziny terminu; inaczej brak', () => {
    const r = { [target.key]: { seconds: 1200, mode: 'driving' as const, location: 'Pływalnia' } };
    expect(travelInfoFor([target], r, target.key)).toEqual({ minutes: 20, leaveMs: leaveAt(target.startMs, 1200), mode: 'driving' });
    expect(travelInfoFor([{ ...target, startMs: target.startMs + 3_600_000 }], r, target.key)!.leaveMs).toBe(leaveAt(target.startMs + 3_600_000, 1200));
    expect(travelInfoFor([{ ...target, mode: 'transit' }], r, target.key)).toBeNull();
    expect(travelInfoFor([{ ...target, location: 'Inna' }], r, target.key)).toBeNull();
    expect(travelInfoFor([], r, target.key)).toBeNull();
    expect(travelInfoFor([target], {}, target.key)).toBeNull();
  });
});
