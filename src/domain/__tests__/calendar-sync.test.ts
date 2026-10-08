import type { Row } from '../sync-engine/client';
import { type DeviceEntry, deviceCalendars, type DeviceEvent, deviceDays, isDuplicate, withoutDuplicates, emptyMirror, type MirrorItem, mirrorCalendarTitle, mirrorGroups, mirrorHash, mirrorItems, mirrorReady, PERSONAL_NAME, planMirror } from '../views/calendar-sync';

const ME = 'u-me';
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
    { id: 'a', ...cal, title: 'Dentysta', allDay: false, startMs: at('2026-10-09', 16), endMs: at('2026-10-09', 17, 30) },
    { id: 'b', ...cal, title: 'Urlop', allDay: true, startDate: '2026-10-08', endDate: '2026-10-11' },
    { id: 'c', ...cal, title: 'Konferencja', allDay: false, startMs: at('2026-10-09', 20), endMs: at('2026-10-10', 12) },
    { id: 'd', ...cal, title: 'Do północy', allDay: false, startMs: at('2026-10-09', 22), endMs: at('2026-10-10', 0) },
    { id: 'm', calendarId: 'mirror', calendarTitle: 'Organizer – Rodzina', title: 'Basen', allDay: false, startMs: at('2026-10-09', 17), endMs: at('2026-10-09', 18) },
    { id: 'x', ...cal, title: 'Poza zakresem', allDay: true, startDate: '2026-11-20', endDate: '2026-11-21' },
  ];
  const days = deviceDays(events, { y: 2026, m: 10, d: 8 }, { y: 2026, m: 10, d: 10 }, toLocal, new Set(['mirror']));

  it('godziny w czasie lokalnym; całodniowe na każdy dzień; kilkudniowe z godziną tylko pierwszego dnia', () => {
    expect([...days.keys()].sort()).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    expect(days.get('2026-10-09')).toEqual([
      { key: 'd|b', title: 'Urlop', calendarId: 'c1', calendarTitle: 'Praca', time: null, endTime: null, continued: true },
      { key: 'd|a', title: 'Dentysta', calendarId: 'c1', calendarTitle: 'Praca', time: '16:00', endTime: '17:30', continued: false },
      { key: 'd|c', title: 'Konferencja', calendarId: 'c1', calendarTitle: 'Praca', time: '20:00', endTime: '24:00', continued: false },
      { key: 'd|d', title: 'Do północy', calendarId: 'c1', calendarTitle: 'Praca', time: '22:00', endTime: '24:00', continued: false },
    ]);
    expect(days.get('2026-10-10')!.map((e) => [e.key, e.time, e.endTime, e.continued])).toEqual([
      ['d|b', null, null, true],
      ['d|c', '00:00', '12:00', true],
    ]);
    expect(days.get('2026-10-08')!.map((e) => [e.key, e.continued])).toEqual([['d|b', false]]);
  });

  it('kalendarze lustra pomijane (bez dubli); poza zakresem nic', () => {
    expect([...days.values()].flat().some((e) => e.key === 'd|m' || e.key === 'd|x')).toBe(false);
    expect(deviceDays([], { y: 2026, m: 10, d: 8 }, { y: 2026, m: 10, d: 8 }, toLocal, new Set()).size).toBe(0);
  });

  it('kalendarze do wyboru (D106): z wydarzeń, bez lustra, po nazwie, każdy raz', () => {
    expect(deviceCalendars([...events, { id: 'z', calendarId: 'c0', calendarTitle: 'Dom', title: 'x', allDay: true, startDate: '2026-10-08', endDate: '2026-10-09' }], new Set(['mirror']))).toEqual([
      { id: 'c0', title: 'Dom' },
      { id: 'c1', title: 'Praca' },
    ]);
    expect(deviceCalendars([{ ...events[0]!, calendarId: 'b' }, { ...events[0]!, calendarId: 'a' }], new Set())).toEqual([{ id: 'a', title: 'Praca' }, { id: 'b', title: 'Praca' }]);
  });

  it('dubel z wpisem aplikacji (D107): godzina ±30 min i wspólne słowo; bez godziny z bez godziny; „cd.” nigdy', () => {
    const e = (title: string, time: string | null, continued = false): DeviceEntry => ({ key: `d|${title}`, title, calendarId: 'c1', calendarTitle: 'Ł', time, endTime: null, continued });
    const app = [{ title: 'Kuba i Róża - Basen - 19.30', time: '19:00:00' }, { title: 'Urodziny Ali', time: null }];
    expect(isDuplicate(e('Dzieci - basen', '19:00'), app)).toBe(true);
    expect(isDuplicate(e('Dzieci - BASEN', '19:30'), app)).toBe(true);
    expect(isDuplicate(e('Dzieci - basen', '19:31'), app)).toBe(false);
    expect(isDuplicate(e('Dzieci - basen', '18:30'), app)).toBe(true);
    expect(isDuplicate(e('Dentysta', '19:00'), app)).toBe(false);
    expect(isDuplicate(e('Róża 19.30 i', '19:00'), app)).toBe(true); // „róża” = „roza” (4 litery)
    expect(isDuplicate(e('Kuba 1930', '19:00'), app)).toBe(true);
    expect(isDuplicate(e('Ala 19', '19:00'), [{ title: 'Ala 19', time: '19:00' }])).toBe(false); // krótkie słowa i liczby się nie liczą
    expect(isDuplicate(e('Urodziny', null), app)).toBe(true);
    expect(isDuplicate(e('Urodziny', '10:00'), app)).toBe(false);
    expect(isDuplicate(e('Basen', null), app)).toBe(false);
    expect(isDuplicate(e('Urodziny', null, true), app)).toBe(false);
    expect(withoutDuplicates([e('Dzieci - basen', '19:00'), e('Dentysta', '9:00')], app).map((x) => x.title)).toEqual(['Dentysta']);
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
  put(t, 'events', 'e1', { id: 'e1', group_id: 'gf', title: 'Basen', start_date: '2026-10-05', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: 'ala', deleted_at: null });
  put(t, 'events', 'e2', { id: 'e2', group_id: ME, title: 'Przegląd auta', start_date: '2026-10-09', start_time: null, end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null });
  put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'e1', group_id: 'gf', occurrence_date: '2026-10-12', cancelled: true, deleted_at: null });
  return t;
}

describe('lustro grup w kalendarzu iPhone’a (D95)', () => {
  const today = { y: 2026, m: 10, d: 8 };
  const items = mirrorItems(base(), ME, today, 7, 14);

  it('wystąpienia wszystkich moich grup w oknie, bez odwołanych, z osobą odpowiedzialną w nazwie', () => {
    expect(items).toEqual([
      { key: 'e1|2026-10-05', groupId: 'gf', title: 'Basen (Ala)', date: '2026-10-05', startTime: '17:00', endTime: '18:00', notes: 'Rodzina' },
      { key: 'e2|2026-10-09', groupId: ME, title: 'Przegląd auta', date: '2026-10-09', startTime: null, endTime: null, notes: 'Osobiste' },
      { key: 'e1|2026-10-19', groupId: 'gf', title: 'Basen (Ala)', date: '2026-10-19', startTime: '17:00', endTime: '18:00', notes: 'Rodzina' },
    ]);
    expect(mirrorGroups(base(), ME)).toEqual([{ id: ME, name: PERSONAL_NAME }, { id: 'gf', name: 'Rodzina' }]);
    expect(mirrorCalendarTitle('Rodzina')).toBe('Organizer – Rodzina');
  });

  it('pierwsze uruchomienie: kalendarze dla grup z wydarzeniami i wszystkie wydarzenia do utworzenia', () => {
    const p = planMirror(items, emptyMirror(), mirrorGroups(base(), ME), '2026-10-08', 100);
    expect(p.createCalendars).toEqual([{ groupId: ME, title: 'Organizer – Osobiste' }, { groupId: 'gf', title: 'Organizer – Rodzina' }]);
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
    expect(planMirror(items, emptyMirror(), [], '2026-10-08', 10)).toEqual({ createCalendars: [], removeCalendars: [], create: [], update: [], remove: [] });
  });

  it('wystąpienie bez godziny końca i bez osoby odpowiedzialnej', () => {
    const t = base();
    put(t, 'events', 'e3', { id: 'e3', group_id: 'gf', title: 'Zebranie', start_date: '2026-10-10', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null });
    expect(mirrorItems(t, ME, today, 0, 3).find((i) => i.key === 'e3|2026-10-10')).toEqual({ key: 'e3|2026-10-10', groupId: 'gf', title: 'Zebranie', date: '2026-10-10', startTime: '18:00', endTime: null, notes: 'Rodzina' });
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
