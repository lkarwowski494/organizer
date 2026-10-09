import { config } from '../../config';
import type { Row } from '../sync-engine/client';
import { calendarLook, type DeviceEntry, deviceCalendars, type DeviceEvent, deviceDays, isDuplicate, isMirrorCalendar, normalizeTitle, splitDuplicates, emptyMirror, type MirrorItem, mirrorCalendarTitle, mirrorGroups, mirrorCalendarOf, mirrorHash, mirrorItems, mirrorReady, PERSONAL_NAME, planMirror } from '../views/calendar-sync';

const ME = 'u-me';
const NO_SKIP = new Set<string>();
const LESSONS = (name: string, n: number) => `${name}: ${n} ${n === 1 ? 'lekcja' : n < 5 ? 'lekcje' : 'lekcji'}`;
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

// Europe/Warsaw w październiku = UTC+2 (zmiana 25.10); w testach wystarczy stałe przesunięcie.
const toLocal = (ms: number) => {
  const d = new Date(ms + 2 * 3_600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
};
const at = (iso: string, hh: number, mm = 0) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), hh - 2, mm);

describe('moje wydarzenia z iPhone’a (D95, D96)', () => {
  const cal = { calendarId: 'c1', calendarTitle: 'Praca' };
  const events: DeviceEvent[] = [
    { id: 'a', ...cal, title: 'Dentysta', organizer: true, location: ' Wodna 1 ', allDay: false, startMs: at('2026-10-09', 16), endMs: at('2026-10-09', 17, 30) },
    { id: 'b', ...cal, title: 'Urlop', allDay: true, startDate: '2026-10-08', endDate: '2026-10-11' },
    { id: 'c', ...cal, title: 'Konferencja', allDay: false, startMs: at('2026-10-09', 20), endMs: at('2026-10-10', 12) },
    { id: 'd', ...cal, title: 'Do północy', allDay: false, startMs: at('2026-10-09', 22), endMs: at('2026-10-10', 0) },
    { id: 'm', calendarId: 'mirror', calendarTitle: 'Organizer – Rodzina', title: 'Basen', allDay: false, startMs: at('2026-10-09', 17), endMs: at('2026-10-09', 18) },
    { id: 'x', ...cal, title: 'Poza zakresem', allDay: true, startDate: '2026-11-20', endDate: '2026-11-21' },
    // Audyt 2 (M-27): kalendarz „Organizer – …” spoza stanu (drugie konto, iPad, stara instalacja) też nie jest „mój”.
    { id: 'f', calendarId: 'foreign', calendarTitle: 'Organizer – Dom', title: 'Obce', allDay: false, startMs: at('2026-10-09', 9), endMs: at('2026-10-09', 10) },
  ];
  const days = deviceDays(events, { y: 2026, m: 10, d: 8 }, { y: 2026, m: 10, d: 10 }, toLocal, new Set(['mirror']));

  const x = { date: '2026-10-09', calendarId: 'c1', calendarTitle: 'Praca', organizer: false, location: null };
  it('godziny w czasie lokalnym; całodniowe na każdy dzień; kilkudniowe z godziną tylko pierwszego dnia', () => {
    expect([...days.keys()].sort()).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    expect(days.get('2026-10-09')).toEqual([
      { ...x, key: 'd|b', title: 'Urlop', time: null, endTime: null, continued: true, part: { day: 2, days: 3 }, eventStart: null, eventEnd: null, lastDate: '2026-10-10' },
      { ...x, key: 'd|a', title: 'Dentysta', time: '16:00', endTime: '17:30', continued: false, organizer: true, location: 'Wodna 1', part: null, eventStart: '16:00', eventEnd: '17:30', lastDate: '2026-10-09' },
      // D199: który to dzień i godziny całego wydarzenia (do napisu „do 12:00 · dzień 2 z 2” zamiast „cd.”).
      { ...x, key: 'd|c', title: 'Konferencja', time: '20:00', endTime: '24:00', continued: false, part: { day: 1, days: 2 }, eventStart: '20:00', eventEnd: '12:00', lastDate: '2026-10-10' },
      { ...x, key: 'd|d', title: 'Do północy', time: '22:00', endTime: '24:00', continued: false, part: null, eventStart: '22:00', eventEnd: '24:00', lastDate: '2026-10-09' },
    ]);
    expect(days.get('2026-10-10')!.map((e) => [e.key, e.time, e.endTime, e.continued, e.part])).toEqual([
      ['d|b', null, null, true, { day: 3, days: 3 }],
      ['d|c', '00:00', '12:00', true, { day: 2, days: 2 }],
    ]);
    expect(days.get('2026-10-08')!.map((e) => [e.key, e.continued])).toEqual([['d|b', false]]);
  });

  it('kalendarze lustra pomijane (bez dubli); poza zakresem nic', () => {
    expect([...days.values()].flat().some((e) => e.key === 'd|m' || e.key === 'd|x' || e.key === 'd|f')).toBe(false);
    expect([isMirrorCalendar('Organizer – Rodzina'), isMirrorCalendar('Organizer'), isMirrorCalendar('Praca')]).toEqual([true, false, false]);
    expect(deviceDays([], { y: 2026, m: 10, d: 8 }, { y: 2026, m: 10, d: 8 }, toLocal, new Set()).size).toBe(0);
  });

  it('kalendarze do wyboru (D106): z wydarzeń, bez lustra, po nazwie, każdy raz', () => {
    expect(deviceCalendars([...events, { id: 'z', calendarId: 'c0', calendarTitle: 'Dom', title: 'x', allDay: true, startDate: '2026-10-08', endDate: '2026-10-09' }], new Set(['mirror']))).toEqual([
      { id: 'c0', title: 'Dom' },
      { id: 'c1', title: 'Praca' },
    ]);
    expect(deviceCalendars([{ ...events[0]!, calendarId: 'b' }, { ...events[0]!, calendarId: 'a' }], new Set())).toEqual([{ id: 'a', title: 'Praca' }, { id: 'b', title: 'Praca' }]);
  });

  it('dubel (D173): ta sama nazwa po ujednoliceniu i godzina ±30 min (albo obie bez godziny) albo znacznik Organizera; kolejny dzień wielodniowego tylko z kolejnym dniem', () => {
    const e = (title: string, time: string | null, more: Partial<DeviceEntry> = {}): DeviceEntry => ({ key: `d|${title}`, date: '2026-10-09', title, calendarId: 'c1', calendarTitle: 'Ł', time, endTime: null, continued: false, part: null, eventStart: null, eventEnd: null, lastDate: '2026-10-09', organizer: false, location: null, ...more });
    const app = [{ title: 'Judo Tymka', time: '19:00:00' }, { title: 'Urodziny babci', time: '17:00' }, { title: 'Bal', time: '18:00' }, { title: 'WF', time: null }];
    expect(normalizeTitle('  Żółć – JUDO!! tymka ')).toBe('zolc judo tymka');
    expect(isDuplicate(e('judo  TYMKA', '19:30'), app)).toBe(true);
    expect(isDuplicate(e('Judo Tymka', '19:31'), app)).toBe(false);
    expect(isDuplicate(e('Judo Tymka', '18:30'), app)).toBe(true);
    expect(isDuplicate(e('Judo Tymka', null), app)).toBe(false);
    // Audyt 2 (M-105, N-23): wspólne słowo już nie wystarcza — „Urodziny Ani” przy „Urodziny babci” zostaje.
    expect(isDuplicate(e('Urodziny Ani', '17:00'), app)).toBe(false);
    expect(isDuplicate(e('Dzieci - judo', '19:00'), app)).toBe(false);
    // …a krótkie nazwy z obu źródeł („Bal”, „WF”) są dublami.
    expect(isDuplicate(e('Bal', '18:00'), app)).toBe(true);
    expect(isDuplicate(e('wf', null), app)).toBe(true);
    expect(isDuplicate(e('WF', '08:00'), app)).toBe(false);
    expect(isDuplicate(e('!!!', null), [{ title: '?', time: null }])).toBe(false);
    // Kopia z „Dodaj do kalendarza” (znacznik w notatce): aplikacja ma aktualną wersję, nawet po zmianie nazwy albo terminu.
    expect(isDuplicate(e('Basen (stara nazwa)', '10:00', { organizer: true }), [])).toBe(true);
    // D199: kopia wielodniowego (znacznik) — dubel w każdym dniu; kolejny dzień — dublem kolejnego dnia wpisu aplikacji o tej
    // samej nazwie (godziny bez znaczenia), nie pierwszego dnia.
    expect(isDuplicate(e('Bal', null, { continued: true, organizer: true }), app)).toBe(true);
    expect(isDuplicate(e('Bal', '00:00', { continued: true }), app)).toBe(false);
    expect(isDuplicate(e('Obóz', null, { continued: true }), [{ title: 'obóz!', time: null, continued: true }])).toBe(true);
    expect(isDuplicate(e('!!!', null, { continued: true }), [{ title: '?', time: null, continued: true }])).toBe(false);
    const r = splitDuplicates([e('Bal', '18:00'), e('Dentysta', '09:00')], app);
    expect([r.shown.map((x) => x.title), r.hidden.map((x) => x.title)]).toEqual([['Dentysta'], ['Bal']]);
  });

  it('sortowanie w dniu: najpierw bez godziny, potem po godzinie, przy remisie po nazwie', () => {
    const d = deviceDays(
      [
        { id: '1', ...cal, title: 'B', allDay: false, startMs: at('2026-10-08', 9), endMs: at('2026-10-08', 10) },
        { id: '2', ...cal, title: 'A', allDay: false, startMs: at('2026-10-08', 9), endMs: at('2026-10-08', 10) },
      ],
      { y: 2026, m: 10, d: 8 },
      { y: 2026, m: 10, d: 8 },
      toLocal,
      new Set(),
    );
    expect(d.get('2026-10-08')!.map((e) => e.title)).toEqual(['A', 'B']);
  });
});

function base(): T {
  const t: T = {};
  put(t, 'groups', ME, { id: ME, name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', ME, { member_id: ME, group_id: ME, user_id: ME, display_name: 'Łukasz', role: 'owner', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', display_name: 'Ala', role: 'owner', deleted_at: null });
  put(t, 'events', 'e1', { id: 'e1', group_id: 'gf', title: 'Basen', start_date: '2026-10-05', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', responsible_member_id: 'ala', location: ' Wodna 1', deleted_at: null });
  // Zawozi Ala, ale jadę też ja (uczestnik) — sprawa mnie dotyczy (D66), więc jest w lustrze (D174).
  put(t, 'event_participants', 'p1', { id: 'p1', event_id: 'e1', group_id: 'gf', member_id: 'mf', deleted_at: null });
  put(t, 'events', 'e2', { id: 'e2', group_id: ME, title: 'Przegląd auta', start_date: '2026-10-09', start_time: null, end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null });
  put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'e1', group_id: 'gf', occurrence_date: '2026-10-12', cancelled: true, deleted_at: null });
  return t;
}

describe('lustro grup w kalendarzu iPhone’a (D95)', () => {
  const today = { y: 2026, m: 10, d: 8 };
  const items = mirrorItems(base(), ME, today, 7, 14, NO_SKIP, LESSONS);

  it('wystąpienia moich grup w oknie, bez odwołanych, z osobą odpowiedzialną w nazwie i miejscem', () => {
    expect(items).toEqual([
      { key: 'e1|2026-10-05', groupId: 'gf', title: 'Basen (Ala)', date: '2026-10-05', startTime: '17:00', endTime: '18:00', days: 1, durationMin: null, location: 'Wodna 1', notes: 'Rodzina' },
      { key: 'e2|2026-10-09', groupId: ME, title: 'Przegląd auta', date: '2026-10-09', startTime: null, endTime: null, days: 1, durationMin: null, location: null, notes: 'Osobiste' },
      { key: 'e1|2026-10-19', groupId: 'gf', title: 'Basen (Ala)', date: '2026-10-19', startTime: '17:00', endTime: '18:00', days: 1, durationMin: null, location: 'Wodna 1', notes: 'Rodzina' },
    ]);
    expect(mirrorGroups(base(), ME).map((g) => [g.id, g.name])).toEqual([[ME, PERSONAL_NAME], ['gf', 'Rodzina']]);
    expect(mirrorGroups(base(), ME)[0]!.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(mirrorCalendarTitle('Rodzina')).toBe('Organizer – Rodzina');
  });

  it('D174: tylko sprawy, które mnie dotyczą; wybrane grupy; lekcje dziecka jednym wpisem na dzień', () => {
    const t = base();
    put(t, 'events', 'e4', { id: 'e4', group_id: 'gf', title: 'Wywiadówka Ali', start_date: '2026-10-10', start_time: '18:00:00', end_time: null, rrule: null, audience: 'members', responsible_member_id: null, deleted_at: null });
    put(t, 'event_participants', 'p4', { id: 'p4', event_id: 'e4', group_id: 'gf', member_id: 'ala', deleted_at: null });
    put(t, 'group_members', 'tymek', { member_id: 'tymek', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
    put(t, 'group_members', 'zosia', { member_id: 'zosia', group_id: 'gf', user_id: null, display_name: 'Zosia', role: 'child', deleted_at: null });
    const lesson = (id: string, title: string, start: string | null, end: string | null, kids: string[]) => {
      put(t, 'events', id, { id, group_id: 'gf', title, start_date: '2026-10-12', start_time: start, end_time: end, rrule: null, audience: 'members', kind: 'lesson', responsible_member_id: null, deleted_at: null });
      for (const k of kids) put(t, 'event_participants', `${id}-${k}`, { id: `${id}-${k}`, event_id: id, group_id: 'gf', member_id: k, deleted_at: null });
    };
    lesson('l2', 'Polski', '08:55:00', '09:40:00', ['tymek']);
    lesson('l1', 'Matematyka', '08:00:00', '08:45:00', ['tymek', 'zosia']);
    lesson('l3', 'Basen', '13:00:00', null, ['tymek']);
    lesson('l4', 'Wycieczka', null, null, ['zosia']);
    lesson('l5', 'Angielski', '08:00:00', '08:45:00', ['zosia']);
    put(t, 'group_members', 'ola', { member_id: 'ola', group_id: 'gf', user_id: null, display_name: 'Ola', role: 'child', deleted_at: null });
    lesson('l6', 'Dzień sportu', null, null, ['ola']);
    const all = mirrorItems(t, ME, today, 0, 7, NO_SKIP, LESSONS);
    expect(all.some((i) => i.key.startsWith('e4|'))).toBe(false);
    expect(all.filter((i) => i.key.startsWith('lessons|')).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'lessons|ola|2026-10-12', groupId: 'gf', title: 'Ola: 1 lekcja', date: '2026-10-12', startTime: null, endTime: null, days: 1, durationMin: null, location: null, notes: 'Rodzina\nDzień sportu' },
      { key: 'lessons|tymek|2026-10-12', groupId: 'gf', title: 'Tymek: 3 lekcje', date: '2026-10-12', startTime: '08:00', endTime: '13:00', days: 1, durationMin: null, location: null, notes: 'Rodzina\n08:00 Matematyka\n08:55 Polski\n13:00 Basen' },
      { key: 'lessons|zosia|2026-10-12', groupId: 'gf', title: 'Zosia: 3 lekcje', date: '2026-10-12', startTime: '08:00', endTime: '08:45', days: 1, durationMin: null, location: null, notes: 'Rodzina\n08:00 Angielski\n08:00 Matematyka\nWycieczka' },
    ]);
    expect(all.some((i) => i.key.startsWith('l1|'))).toBe(false);
    const onlyMine = mirrorItems(t, ME, today, 0, 7, new Set(['gf']), LESSONS);
    expect(onlyMine.every((i) => i.groupId === ME)).toBe(true);
    expect(mirrorGroups(t, ME, new Set(['gf'])).map((g) => g.id)).toEqual([ME]);
  });

  it('pierwsze uruchomienie: kalendarze dla grup z wydarzeniami i wszystkie wydarzenia do utworzenia', () => {
    const p = planMirror(items, emptyMirror(), mirrorGroups(base(), ME), '2026-10-08', 100);
    expect(p.createCalendars.map((c) => [c.groupId, c.title])).toEqual([[ME, 'Organizer – Osobiste'], ['gf', 'Organizer – Rodzina']]);
    expect(p.updateCalendars).toEqual([]);
    expect(p.create.map((i) => i.key)).toEqual(['e1|2026-10-05', 'e1|2026-10-19', 'e2|2026-10-09']);
    expect([p.update, p.remove, p.removeCalendars]).toEqual([[], [], []]);
  });

  it('kolejne: zmienione → update, zniknięte i przeniesione do innej grupy → remove, nowe → create; usunięta grupa → kalendarz do usunięcia', () => {
    const [e5, e9, e19] = items as [MirrorItem, MirrorItem, MirrorItem];
    const state = {
      calendars: { gf: 'cal-f', [ME]: 'cal-p', old: 'cal-old' },
      events: {
        [e5.key]: { id: 'd5', calendarId: 'cal-f', hash: mirrorHash(e5) },
        [e9.key]: { id: 'd9', calendarId: 'cal-f', hash: mirrorHash(e9) },
        [e19.key]: { id: 'd19', calendarId: 'cal-f', hash: 'stary' },
        'e1|2026-10-12': { id: 'd12', calendarId: 'cal-f', hash: 'x' },
        'z|2026-10-01': { id: 'dz', calendarId: 'cal-old', hash: 'x' },
      },
    };
    const p = planMirror(items, state, mirrorGroups(base(), ME), '2026-10-08', 100);
    expect(p.createCalendars).toEqual([]);
    // Stan sprzed audytu 2 (bez nazw i kolorów) — jedno odświeżenie kalendarzy obu grup.
    expect(p.updateCalendars.map((c) => [c.groupId, c.calendarId, c.title])).toEqual([[ME, 'cal-p', 'Organizer – Osobiste'], ['gf', 'cal-f', 'Organizer – Rodzina']]);
    expect(p.removeCalendars).toEqual([{ groupId: 'old', calendarId: 'cal-old' }]);
    expect(p.update).toEqual([{ deviceId: 'd19', item: e19 }]);
    expect(p.remove).toEqual([{ key: e9.key, deviceId: 'd9' }, { key: 'e1|2026-10-12', deviceId: 'd12' }]);
    expect(p.create).toEqual([e9]);
  });

  it('limit: najbliższe dzisiejszej dacie; poza limitem — usuwane z iPhone’a', () => {
    const p = planMirror(items, { calendars: { gf: 'cal-f' }, events: { 'e1|2026-10-19': { id: 'd19', calendarId: 'cal-f', hash: 'h' } } }, mirrorGroups(base(), ME), '2026-10-08', 2);
    expect(p.create.map((i) => i.key)).toEqual(['e1|2026-10-05', 'e2|2026-10-09']);
    expect(p.remove).toEqual([{ key: 'e1|2026-10-19', deviceId: 'd19' }]);
    // Remis odległości: po kluczu.
    const tie = [{ ...items[0]!, key: 'b', date: '2026-10-07' }, { ...items[0]!, key: 'a', date: '2026-10-09' }];
    expect(planMirror(tie, emptyMirror(), mirrorGroups(base(), ME), '2026-10-08', 1).create.map((i) => i.key)).toEqual(['a']);
    expect(planMirror(items, emptyMirror(), [], '2026-10-08', 10)).toEqual({ createCalendars: [], updateCalendars: [], removeCalendars: [], create: [], update: [], remove: [] });
  });

  it('audyt 2 (M-27, P-27): nazwa i kolor kalendarza nadążają za grupą', () => {
    const groups = mirrorGroups(base(), ME);
    const gf = groups.find((g) => g.id === 'gf')!;
    const state = { calendars: { gf: 'cal-f' }, events: {}, looks: { gf: calendarLook('Organizer – Rodzina', gf.color) } };
    expect(planMirror(items, state, groups, '2026-10-08', 100).updateCalendars).toEqual([]);
    const renamed = groups.map((g) => (g.id === 'gf' ? { ...g, name: 'Dom' } : g));
    expect(planMirror(items, state, renamed, '2026-10-08', 100).updateCalendars).toEqual([{ groupId: 'gf', calendarId: 'cal-f', title: 'Organizer – Dom', color: gf.color }]);
    const recolored = groups.map((g) => (g.id === 'gf' ? { ...g, color: '#000000' } : g));
    expect(planMirror(items, state, recolored, '2026-10-08', 100).updateCalendars).toHaveLength(1);
  });

  it('PWD-2: w którym kalendarzu lustra jest wystąpienie (mnie dotyczy, grupa włączona, w oknie)', () => {
    const t = base();
    const none = new Set<string>();
    expect(mirrorCalendarOf(t, ME, 'e1', '2026-10-12', '2026-10-12', today, none)).toBeNull(); // odwołane
    expect(mirrorCalendarOf(t, ME, 'e1', '2026-10-19', '2026-10-19', today, none)).toBe('Organizer – Rodzina');
    expect(mirrorCalendarOf(t, ME, 'e2', '2026-10-09', '2026-10-09', today, none)).toBe('Organizer – Osobiste');
    expect(mirrorCalendarOf(t, ME, 'e1', '2026-10-19', '2026-10-19', today, new Set(['gf']))).toBeNull();
    expect(mirrorCalendarOf(t, ME, 'e1', '2027-03-01', '2027-03-01', today, none)).toBeNull(); // poza oknem (+90 dni)
    expect(mirrorCalendarOf(t, ME, 'e1', '2026-09-28', '2026-09-28', today, none)).toBeNull(); // poza oknem (−7 dni)
    put(t, 'event_participants', 'p1', { ...t.event_participants!.p1!, deleted_at: '2026-10-01T00:00:00Z' });
    expect(mirrorCalendarOf(t, ME, 'e1', '2026-10-19', '2026-10-19', today, none)).toBeNull(); // zawozi Ala, mnie nie dotyczy
  });

  it('audyt 2 (P8): „Jest w kalendarzu” tylko dla wpisów, które lustro naprawdę trzyma (limit MIRROR_MAX)', () => {
    const t = base();
    // Codzienne serie w osobistej: razem więcej wystąpień w oknie (−7…+90 dni) niż config.calendar.MIRROR_MAX.
    const series = Math.ceil(config.calendar.MIRROR_MAX / (config.calendar.MIRROR_DAYS_BACK + config.calendar.MIRROR_DAYS_AHEAD + 1)) + 1;
    for (let i = 0; i < series; i++) put(t, 'events', `d${i}`, { id: `d${i}`, group_id: ME, title: `Seria ${i}`, start_date: '2026-09-01', start_time: '07:00:00', end_time: null, rrule: 'FREQ=DAILY', audience: 'group', responsible_member_id: null, deleted_at: null });
    const none = new Set<string>();
    expect(mirrorCalendarOf(t, ME, 'd0', '2026-10-09', '2026-10-09', today, none)).toBe('Organizer – Osobiste');
    // Ostatni dzień okna jest najdalej od dziś — poza limitem, więc nie ma go w iPhonie.
    expect(mirrorCalendarOf(t, ME, 'd0', '2027-01-06', '2027-01-06', today, none)).toBeNull();
    expect(mirrorCalendarOf(t, ME, 'nie-ma', '2026-10-09', '2026-10-09', today, none)).toBeNull();
  });

  it('PW-2: lustro i „Jest w kalendarzu” w zakresie grupy; lekcje dziecka — w bloku dnia', () => {
    const t = base();
    // „Tylko przypisane do mnie”: Basen (jestem uczestnikiem) zostaje, zebranie całej grupy — nie.
    put(t, 'events', 'e3', { id: 'e3', group_id: 'gf', title: 'Zebranie', start_date: '2026-10-10', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null });
    const mine = (g: string) => (g === 'gf' ? ('mine' as const) : ('all' as const));
    const keys = mirrorItems(t, ME, today, 7, 14, NO_SKIP, LESSONS, mine).map((i) => i.key);
    expect(keys).toEqual(['e1|2026-10-05', 'e2|2026-10-09', 'e1|2026-10-19']);
    expect(mirrorItems(t, ME, today, 7, 14, NO_SKIP, LESSONS, () => 'mineAndEvents').map((i) => i.key)).toContain('e3|2026-10-10');
    expect(mirrorCalendarOf(t, ME, 'e3', '2026-10-10', '2026-10-10', today, new Set(), mine)).toBeNull();
    expect(mirrorCalendarOf(t, ME, 'e3', '2026-10-10', '2026-10-10', today, new Set())).toBe('Organizer – Rodzina');
    put(t, 'group_members', 'tymek', { member_id: 'tymek', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
    put(t, 'events', 'l1', { id: 'l1', group_id: 'gf', kind: 'lesson', title: 'Matematyka', start_date: '2026-10-12', start_time: '08:00:00', end_time: '08:45:00', rrule: null, audience: 'members', responsible_member_id: null, deleted_at: null });
    put(t, 'event_participants', 'pl1', { id: 'pl1', event_id: 'l1', group_id: 'gf', member_id: 'tymek', deleted_at: null });
    expect(mirrorCalendarOf(t, ME, 'l1', '2026-10-12', '2026-10-12', today, new Set())).toBe('Organizer – Rodzina');
  });

  it('wystąpienie bez godziny końca i bez osoby odpowiedzialnej', () => {
    const t = base();
    put(t, 'events', 'e3', { id: 'e3', group_id: 'gf', title: 'Zebranie', start_date: '2026-10-10', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null });
    expect(mirrorItems(t, ME, today, 0, 3, NO_SKIP, LESSONS).find((i) => i.key === 'e3|2026-10-10')).toEqual({ key: 'e3|2026-10-10', groupId: 'gf', title: 'Zebranie', date: '2026-10-10', startTime: '18:00', endTime: null, days: 1, durationMin: null, location: null, notes: 'Rodzina' });
  });
});

describe('lustro czeka na pobranie (audyt 8.10.2026)', () => {
  const t = {
    groups: { g1: { id: 'g1', name: 'Rodzina', kind: 'shared' }, g2: { id: 'g2', name: 'Osobiste', kind: 'personal' } },
    group_members: {
      m1: { member_id: 'm1', group_id: 'g1', user_id: 'u1', display_name: 'A', role: 'admin', deleted_at: null },
      m2: { member_id: 'm2', group_id: 'g2', user_id: 'u1', display_name: 'A', role: 'owner', deleted_at: null },
    },
  };
  it('po wyczyszczeniu (bez grup) i przy niepełnym pobraniu — nie; gdy każda grupa ma kursor — tak', () => {
    expect(mirrorReady({}, 'u1', {})).toBe(false);
    expect(mirrorReady(t, 'u1', { g1: 4 })).toBe(false);
    expect(mirrorReady(t, 'u1', { g1: 4, g2: 0 })).toBe(true);
  });

  it('audyt 2 (M-5): duża grupa w trakcie pobierania porcjami albo resync (kursor jest, wiersza grupy jeszcze nie) — nie', () => {
    // Po pierwszej porcji: osobista kompletna, „Rodzina” ma kursor i część wierszy, ale wiersz grupy przyjdzie na końcu.
    const partial = { ...t, groups: { g2: t.groups.g2 } };
    expect(mirrorReady(partial, 'u1', { g1: 4, g2: 0 })).toBe(false);
    // Także gdy mojego członkostwa w tej grupie jeszcze nie ma (wtedy grupy nie widać nawet w liście grup).
    const noMember = { groups: partial.groups, group_members: { m2: t.group_members.m2 } };
    expect(mirrorReady(noMember, 'u1', { g1: 4, g2: 0 })).toBe(false);
    expect(mirrorReady(t, 'u1', { g1: 9, g2: 0 })).toBe(true);
  });
});
