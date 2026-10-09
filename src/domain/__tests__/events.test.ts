import type { CivilDate } from '../civil-date';
import { parseIsoDate } from '../format';
import { parseRule, type Rule } from '../rrule';
import { splitId } from '../event-split';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { occurrenceOwner, seriesChain } from '../views/event-rows';
import {
  asEvent,
  asOverride,
  asParticipant,
  cancelEvent,
  createEvent,
  describeRule,
  type RuleLabels,
  editEvent,
  eventDetail,
  type EventDetail,
  type EventFields,
  eventsByDate,
  expandEvents,
  fieldsOf,
  groupSeries,
  timeLabel,
  moveTooFar,
  lengthLabel,
  occurrenceState,
  overrideId,
  participantId,
  restoreOccurrence,
  ruleOf,
  todayEvents,
} from '../views/events';

const ME = 'u-me';
const TODAY: CivilDate = { y: 2026, m: 10, d: 7 }; // środa
const D = parseIsoDate;

type T = { [e: string]: { [id: string]: Row } };
function put(t: T, e: string, key: string, row: Row) {
  (t[e] ??= {})[key] = row;
}
/** Grupy jak w views.test: gp osobista, gf Rodzina (ja admin, Kuba dziecko), gk Klasa (ja członek), gx obca. */
function world(myRoleInGf = 'admin'): T {
  const t: T = {};
  put(t, 'groups', 'gp', { id: 'gp', name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gk', { id: 'gk', name: 'Klasa 2b', kind: 'shared', created_at: '2026-03-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gx', { id: 'gx', name: 'Obca', kind: 'shared', created_at: '2026-01-15T00:00:00Z', deleted_at: null });
  const m = (id: string, g: string, user: string | null, name: string, role: string, extra: Row = {}) =>
    put(t, 'group_members', id, { member_id: id, group_id: g, user_id: user, display_name: name, role, created_at: '2026-01-01T00:00:00Z', deleted_at: null, ...extra });
  m('mp', 'gp', ME, 'Ja', 'owner');
  m('mf', 'gf', ME, 'Łukasz', myRoleInGf);
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('zosia', 'gf', null, 'Zosia', 'child', { deleted_at: '2026-05-01T00:00:00Z' });
  m('mk', 'gk', ME, 'Łukasz', 'member');
  m('kx', 'gx', 'u-x', 'Obcy', 'owner');
  return t;
}

let seq = 0;
function run(t: T, ops: NewOp[]): T {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `op${seq}` } as Op);
  return t;
}
function ids() {
  let n = 0;
  return () => `id${++n}`;
}

const weekly = (byday: string): Rule => parseRule(`FREQ=WEEKLY;BYDAY=${byday}`);
const fields = (over: Partial<EventFields> = {}): EventFields => ({
  title: 'Tańce Kuby',
  date: '2026-10-05',
  startTime: '18:00',
  endTime: '19:00',
  rule: weekly('MO'),
  until: null,
  audience: 'group',
  participantIds: [],
  responsibleId: null,
  ...over,
});
const brief = (xs: ReturnType<typeof expandEvents>) => xs.map((x) => `${x.date} ${x.startTime ?? '—'} ${x.title}`);
const range = (t: T, from: string, to: string) => expandEvents(t, ME, D(from), D(to));
const detail = (t: T, id: string): EventDetail => eventDetail(t, ME, id)!;

describe('miejsce wydarzenia (D115)', () => {
  const base = { title: 'Basen', date: '2026-10-05', startTime: '17:00', endTime: null, rule: null, until: null, audience: 'group' as const, participantIds: [], responsibleId: null };
  it('nowe z miejscem i bez; zmiana całości tylko gdy inne; „to i następne” przenosi miejsce do nowej serii', () => {
    let n = 0;
    const id = () => `n${++n}`;
    expect(createEvent('gf', { ...base, location: 'ul. Wodna 1' }, id).ops[0]).toMatchObject({ set: { location: 'ul. Wodna 1' } });
    expect((createEvent('gf', base, id).ops[0] as { set: object }).set).not.toHaveProperty('location');
    const t = {} as Parameters<typeof put>[0];
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'events', 'e', { id: 'e', group_id: 'gf', title: 'Basen', start_date: '2026-10-05', start_time: '17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', location: 'ul. Wodna 1', deleted_at: null });
    const d = eventDetail(t, ME, 'e')!;
    const rule = d.rule;
    const all = (f: object) => (editEvent(d, '2026-10-05', 'all', { ...base, rule, ...f })[0] as { set: object }).set;
    expect(all({})).not.toHaveProperty('location');
    expect(all({ location: 'ul. Wodna 1' })).not.toHaveProperty('location');
    expect(all({ location: '' })).toMatchObject({ location: null });
    expect(all({ location: 'Hala, ul. Długa 5' })).toMatchObject({ location: 'Hala, ul. Długa 5' });
    const following = editEvent(d, '2026-10-12', 'following', { ...base, rule });
    expect(following[0]).toMatchObject({ kind: 'cmd', cmd: 'split_event', args: { set: { location: 'ul. Wodna 1' } } });
    expect(editEvent(d, '2026-10-12', 'following', { ...base, rule, location: 'Hala' })[0]).toMatchObject({ args: { set: { location: 'Hala' } } });
    expect(fieldsOf(d, '2026-10-05', 'all').location).toBe('ul. Wodna 1');
    // D126: rodzaj wpisu — zwykłe wydarzenie bez pola, lekcja z polem; „to i następne” zachowuje rodzaj.
    expect((createEvent('gf', { ...base, kind: 'event' }, id).ops[0] as { set: object }).set).not.toHaveProperty('kind');
    expect(createEvent('gf', { ...base, kind: 'lesson' }, id).ops[0]).toMatchObject({ set: { kind: 'lesson' } });
    put(t, 'events', 'e', { ...t.events!.e!, kind: 'lesson' });
    expect(expandEvents(t, ME, { y: 2026, m: 10, d: 5 }, { y: 2026, m: 10, d: 5 })[0]!.location).toBe('ul. Wodna 1');
    // Rodzaj nowej serii bierze polecenie z dzielonej (lekcja zostaje lekcją, także na serwerze).
    run(t, editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'following', { ...base, rule }));
    expect(t.events![splitId('e', '2026-10-12')]).toMatchObject({ kind: 'lesson', split_from: 'e', location: 'ul. Wodna 1' });
  });
});

describe('osoba usunięta z grupy w formularzu (audyt 2, E-1)', () => {
  it('„to i następne” nie przenosi usuniętej osoby odpowiedzialnej ani uczestnika do nowej serii', () => {
    const t = {} as Parameters<typeof put>[0];
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', display_name: 'Ala', role: 'member', deleted_at: '2026-10-06T10:00:00Z' });
    put(t, 'events', 'e', { id: 'e', group_id: 'gf', title: 'Basen', start_date: '2026-10-05', start_time: '17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', responsible_member_id: 'ala', deleted_at: null });
    put(t, 'event_participants', 'p1', { id: 'p1', event_id: 'e', member_id: 'ala', deleted_at: null });
    put(t, 'event_participants', 'p2', { id: 'p2', event_id: 'e', member_id: 'mf', deleted_at: null });
    put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'e', occurrence_date: '2026-10-19', responsible_member_id: 'ala', deleted_at: null });
    const d = eventDetail(t, ME, 'e')!;
    expect(fieldsOf(d, '2026-10-12', 'following')).toMatchObject({ responsibleId: null, participantIds: ['mf'] });
    expect(fieldsOf(d, '2026-10-19', 'this').responsibleId).toBeNull();
    const ops = editEvent(d, '2026-10-12', 'following', fieldsOf(d, '2026-10-12', 'following'));
    expect(JSON.stringify(ops)).not.toContain('"ala"');
  });
});

describe('całodniowy pojedynczy termin (D136)', () => {
  it('„tylko to” bez godziny w serii z godziną: znacznik, widoki bez godzin; powrót godziny zdejmuje znacznik; „to i następne” go przenosi', () => {
    const base = { title: 'Basen', date: '2026-10-05', startTime: '17:00', endTime: '18:00', rule: null, until: null, audience: 'group' as const, participantIds: [], responsibleId: null };
    const t = {} as Parameters<typeof put>[0];
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'events', 'e', { id: 'e', group_id: 'gf', title: 'Basen', start_date: '2026-10-05', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', deleted_at: null });
    const rule = eventDetail(t, ME, 'e')!.rule;
    const [op] = editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'this', { ...base, rule, date: '2026-10-12', startTime: null, endTime: null });
    expect(op).toMatchObject({ kind: 'create', entity: 'event_overrides', set: { all_day: true, start_time: null } });
    put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'e', occurrence_date: '2026-10-12', ...(op as { set: object }).set, deleted_at: null });
    const occ = expandEvents(t, ME, { y: 2026, m: 10, d: 12 }, { y: 2026, m: 10, d: 12 })[0]!;
    expect([occ.startTime, occ.endTime]).toEqual([null, null]);
    expect(fieldsOf(eventDetail(t, ME, 'e')!, '2026-10-12', 'this')).toMatchObject({ startTime: null, endTime: null });
    // Godzina wraca: znacznik zdjęty, godziny jak w serii (PW-33: bez własnych godzin w wyjątku).
    const back = editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'this', { ...base, rule, date: '2026-10-12' });
    expect(back).toEqual([{ kind: 'patch', entity: 'event_overrides', id: 'o1', set: { all_day: false } }]);
    // „To i następne” od 5.10 (wcześniej) = cała seria; od 12.10 — polecenie podziału przenosi wyjątek ze znacznikiem.
    expect(editEvent(eventDetail(t, ME, 'e')!, '2026-10-05', 'following', { ...base, rule })[0]).toMatchObject({ kind: 'patch', entity: 'events' });
    const split = run(structuredClone(t), editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'following', { ...base, rule }));
    expect(split.event_overrides!.o1).toMatchObject({ event_id: splitId('e', '2026-10-12'), all_day: true });
    // Seria całodniowa: bez znacznika (nic nie zmienia) — i bez wyjątku, gdy nic innego się nie zmienia.
    put(t, 'events', 'e', { ...t.events!.e!, start_time: null, end_time: null });
    put(t, 'event_overrides', 'o1', { ...t.event_overrides!.o1!, all_day: false });
    expect(editEvent(eventDetail(t, ME, 'e')!, '2026-10-19', 'this', { ...base, rule, date: '2026-10-19', startTime: null, endTime: null })).toEqual([]);
    const renamed = editEvent(eventDetail(t, ME, 'e')!, '2026-10-19', 'this', { ...base, rule, title: 'Basen — zawody', date: '2026-10-19', startTime: null, endTime: null });
    expect((renamed[0] as { set: object }).set).not.toHaveProperty('all_day');
  });
});

describe('wiersze lokalne: wartości domyślne', () => {
  it('as*', () => {
    expect(asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05' })).toEqual({
      id: 'e',
      group_id: 'g',
      title: '',
      note: null,
      start_date: '2026-10-05',
      start_time: null,
      end_time: null,
      rrule: null,
      audience: 'group',
      responsible_member_id: null,
      location: null,
      kind: 'event',
      split_from: null,
      days: 1,
      duration_min: null,
      deleted_at: null,
    });
    // D199: długość z wiersza; brak, zero albo nie liczba całkowita = jeden dzień (wyjątek: jak w serii).
    expect(asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05', days: 14 }).days).toBe(14);
    expect([0, 1.5, '3', null].map((days) => asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05', days }).days)).toEqual([1, 1, 1, 1]);
    expect(asOverride({ id: 'o', event_id: 'e', occurrence_date: '2026-10-05', days: 2 }).days).toBe(2);
    expect(asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05', split_from: 'e0' }).split_from).toBe('e0');
    expect(asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05', kind: 'lesson' }).kind).toBe('lesson');
    expect(asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05', kind: 'routine' }).kind).toBe('routine');
    expect(asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05', kind: 'cos' }).kind).toBe('event');
    expect(asEvent({ id: 'e', group_id: 'g', start_date: '2026-10-05', audience: 'members', note: 'x', title: 'T', location: 'Basen, ul. Wodna 1' })).toMatchObject({ audience: 'members', note: 'x', title: 'T', location: 'Basen, ul. Wodna 1' });
    expect(asParticipant({ id: 'p', event_id: 'e', member_id: 'm' })).toEqual({ id: 'p', event_id: 'e', member_id: 'm', deleted_at: null });
    expect(asOverride({ id: 'o', event_id: 'e', occurrence_date: '2026-10-05' })).toEqual({
      id: 'o',
      event_id: 'e',
      occurrence_date: '2026-10-05',
      cancelled: false,
      start_date: null,
      start_time: null,
      end_time: null,
      title: null,
      responsible_member_id: null,
      all_day: false,
      responsible_cleared: false,
      days: null,
      duration_min: null,
      deleted_at: null,
    });
    expect(asOverride({ id: 'o', event_id: 'e', occurrence_date: '2026-10-05', cancelled: true }).cancelled).toBe(true);
    expect(asOverride({ id: 'o', event_id: 'e', occurrence_date: '2026-10-05', all_day: true }).all_day).toBe(true);
    expect(asOverride({ id: 'o', event_id: 'e', occurrence_date: '2026-10-05', responsible_cleared: true }).responsible_cleared).toBe(true);
  });

  it('ruleOf: brak reguły, poprawna, niezrozumiała = jednorazowe; inny błąd leci dalej', () => {
    expect(ruleOf({ rrule: null })).toBeNull();
    expect(ruleOf({ rrule: 'FREQ=DAILY' })).toMatchObject({ freq: 'DAILY' });
    expect(ruleOf({ rrule: 'FREQ=HOURLY' })).toBeNull();
    expect(() => ruleOf({ rrule: { split: () => { throw new TypeError('x'); } } as unknown as string })).toThrow(TypeError);
  });
});

describe('scenariusz właściciela: tańce w poniedziałki 18:00 i soboty 12:00', () => {
  function dances() {
    const t = world();
    const newId = ids();
    const mo = createEvent('gf', fields(), newId);
    const sa = createEvent('gf', fields({ date: '2026-10-05', startTime: '12:00', endTime: '13:00', rule: weekly('SA') }), newId);
    run(t, [...mo.ops, ...sa.ops]);
    return { t, mo: mo.id, sa: sa.id, newId };
  }

  it('dwie serie: start wyrównany do pierwszego pasującego dnia, wystąpienia po kolei', () => {
    const { t, sa } = dances();
    expect(t.events![sa]!.start_date).toBe('2026-10-10'); // sobota po 5.10
    expect(brief(range(t, '2026-10-05', '2026-10-19'))).toEqual([
      '2026-10-05 18:00 Tańce Kuby',
      '2026-10-10 12:00 Tańce Kuby',
      '2026-10-12 18:00 Tańce Kuby',
      '2026-10-17 12:00 Tańce Kuby',
      '2026-10-19 18:00 Tańce Kuby',
    ]);
    const x = range(t, '2026-10-05', '2026-10-05')[0]!;
    expect(x).toMatchObject({ occurrenceDate: '2026-10-05', endTime: '19:00', recurring: true, overrideId: null, groupId: 'gf', groupName: 'Rodzina', concernsMe: true });
    expect(typeof x.line).toBe('number');
  });

  it('„tylko to”: przeniesienie zajęć 12.10 na wtorek 13.10 17:00, reszta bez zmian', () => {
    const { t, mo } = dances();
    const ops = editEvent(detail(t, mo), '2026-10-12', 'this', fields({ date: '2026-10-13', startTime: '17:00', endTime: '18:00' }));
    // Audyt 2 (S-8): identyfikator z serii i daty, utworzenie i zaraz zmiana tych samych pól (drugi telefon scala).
    const oid = overrideId(mo, '2026-10-12');
    const changed = { start_date: '2026-10-13', start_time: '17:00', end_time: '18:00' };
    expect(ops).toEqual([
      { kind: 'create', entity: 'event_overrides', id: oid, group_id: 'gf', set: { event_id: mo, occurrence_date: '2026-10-12', start_date: '2026-10-13', start_time: '17:00', end_time: '18:00', title: null, responsible_member_id: null, cancelled: false } },
      { kind: 'patch', entity: 'event_overrides', id: oid, set: changed },
    ]);
    run(t, ops);
    const out = range(t, '2026-10-12', '2026-10-19').filter((x) => x.eventId === mo);
    expect(brief(out)).toEqual(['2026-10-13 17:00 Tańce Kuby', '2026-10-19 18:00 Tańce Kuby']);
    expect(out[0]).toMatchObject({ occurrenceDate: '2026-10-12', overrideId: oid, endTime: '18:00' });
    // Druga zmiana tego samego wystąpienia poprawia istniejący wyjątek (bez drugiego wiersza), tylko zmienione pola.
    const again = editEvent(detail(t, mo), '2026-10-12', 'this', fields({ date: '2026-10-12', title: 'Tańce — próba', startTime: '17:30', endTime: null }));
    expect(again).toEqual([{ kind: 'patch', entity: 'event_overrides', id: oid, set: { start_date: null, start_time: '17:30', end_time: null, title: 'Tańce — próba' } }]);
    run(t, again);
    expect(brief(range(t, '2026-10-12', '2026-10-12'))).toEqual(['2026-10-12 17:30 Tańce — próba']);
    expect(range(t, '2026-10-12', '2026-10-12')[0]!.endTime).toBeNull();
  });

  it('przeniesione wystąpienie widać także, gdy dzień pierwotny jest poza zakresem', () => {
    const { t, mo } = dances();
    run(t, editEvent(detail(t, mo), '2026-10-12', 'this', fields({ date: '2026-11-20' })));
    expect(brief(range(t, '2026-11-20', '2026-11-20'))).toEqual(['2026-11-20 18:00 Tańce Kuby']);
    expect(range(t, '2026-10-12', '2026-10-12')).toEqual([]);
    // Audyt 8.10.2026: dalej niż okno rozwijania formularz nie pozwala (zniknęłoby z widoków).
    expect(moveTooFar('2026-10-12', '2026-12-13')).toBe(false);
    expect(moveTooFar('2026-10-12', '2026-12-14')).toBe(true);
    expect(moveTooFar('2026-10-12', '2026-08-10')).toBe(true);
  });

  it('„tylko to”: odwołanie jednych zajęć; ponowne odwołanie zmienionego wystąpienia patchuje wyjątek', () => {
    const { t, mo, sa } = dances();
    const ops = cancelEvent(detail(t, sa), '2026-10-17', 'this');
    const oid = overrideId(sa, '2026-10-17');
    expect(ops).toEqual([
      { kind: 'create', entity: 'event_overrides', id: oid, group_id: 'gf', set: { event_id: sa, occurrence_date: '2026-10-17', start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, cancelled: true } },
      { kind: 'patch', entity: 'event_overrides', id: oid, set: { cancelled: true } },
    ]);
    run(t, ops);
    expect(brief(range(t, '2026-10-17', '2026-10-17'))).toEqual([]);
    run(t, editEvent(detail(t, mo), '2026-10-19', 'this', fields({ date: '2026-10-20' })));
    const o = detail(t, mo).overrides[0]!;
    expect(cancelEvent(detail(t, mo), '2026-10-19', 'this')).toEqual([{ kind: 'patch', entity: 'event_overrides', id: o.id, set: { cancelled: true } }]);
  });

  it('„to i następne”: od 19.10 zajęcia o 17:00 — stara seria kończy się 18.10, nowa zaczyna 19.10, wyjątki przechodzą', () => {
    const { t, mo } = dances();
    run(t, editEvent(detail(t, mo), '2026-10-26', 'this', fields({ date: '2026-10-27' })));
    run(t, editEvent(detail(t, mo), '2026-10-05', 'this', fields({ title: 'Pierwsze' })));
    const ops = editEvent(detail(t, mo), '2026-10-19', 'following', fields({ startTime: '17:00', endTime: '18:00' }));
    // Audyt 2 (M-3): jedno polecenie (serwer wykonuje je w jednej transakcji, telefon od razu u siebie).
    const sid = splitId(mo, '2026-10-19');
    expect(ops).toEqual([
      {
        kind: 'cmd',
        cmd: 'split_event',
        args: {
          id: sid,
          event_id: mo,
          date: '2026-10-19',
          set: { title: 'Tańce Kuby', start_date: '2026-10-19', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: null, location: null, days: 1, duration_min: null },
          participants: [],
          drop_overrides: [],
          tasks: [],
        },
      },
    ]);
    const moved = detail(t, mo).overrides.find((o) => o.occurrence_date === '2026-10-26')!;
    run(t, ops);
    expect(t.events![mo]!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018');
    expect(t.events![sid]).toMatchObject({ split_from: mo, start_date: '2026-10-19', start_time: '17:00' });
    // Wyjątek z 26.10 przechodzi z tym samym identyfikatorem, ten z 5.10 zostaje.
    expect(t.event_overrides![moved.id]).toMatchObject({ event_id: sid, occurrence_date: '2026-10-26' });
    expect(detail(t, mo).overrides.map((o) => o.occurrence_date)).toEqual(['2026-10-05']);
    expect(brief(range(t, '2026-10-05', '2026-11-02').filter((x) => x.startTime !== '12:00'))).toEqual([
      '2026-10-05 18:00 Pierwsze',
      '2026-10-12 18:00 Tańce Kuby',
      '2026-10-19 17:00 Tańce Kuby',
      // PW-33 (wariant A): przeniesiony tylko dzień — termin idzie za godziną (nowej) serii.
      '2026-10-27 17:00 Tańce Kuby',
      '2026-11-02 17:00 Tańce Kuby',
    ]);
  });

  it('„to i następne” od pierwszego wystąpienia = cała seria; bez reguły — po prostu zmiana', () => {
    const { t, mo, newId } = dances();
    const ops = editEvent(detail(t, mo), '2026-10-05', 'following', fields({ startTime: '17:00' }));
    expect(ops).toEqual([{ kind: 'patch', entity: 'events', id: mo, set: { title: 'Tańce Kuby', start_date: '2026-10-05', start_time: '17:00', end_time: '19:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: null } }]);
    const one = createEvent('gf', fields({ rule: null, date: '2026-10-08' }), newId);
    run(t, one.ops);
    expect(editEvent(detail(t, one.id), '2026-10-08', 'this', fields({ rule: null, date: '2026-10-09' }))[0]).toMatchObject({ kind: 'patch', entity: 'events', set: { start_date: '2026-10-09', rrule: null } });
    // Jednorazowe → seria: start od dnia z formularza, wyrównany do reguły (czw. 8.10 → pon. 12.10).
    expect(editEvent(detail(t, one.id), '2026-10-08', 'all', fields({ date: '2026-10-08' }))[0]).toMatchObject({ set: { start_date: '2026-10-12', rrule: 'FREQ=WEEKLY;BYDAY=MO' } });
  });

  it('„wszystkie”: zmiana dni na wt. i czw. — start zostaje początkiem serii (wyrównany), koniec serii datą', () => {
    const { t, mo } = dances();
    const ops = editEvent(detail(t, mo), '2026-10-19', 'all', fields({ rule: weekly('TU,TH'), until: '2026-10-31' }));
    expect(ops).toEqual([{ kind: 'patch', entity: 'events', id: mo, set: { title: 'Tańce Kuby', start_date: '2026-10-06', start_time: '18:00', end_time: '19:00', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261031', audience: 'group', responsible_member_id: null } }]);
    run(t, ops);
    const out = range(t, '2026-10-01', '2026-12-31').filter((x) => x.eventId === mo);
    expect(out.map((x) => x.date)).toEqual(['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
    // „Wszystkie” bez powtarzania: seria staje się jednym wydarzeniem w dniu z formularza.
    expect(editEvent(detail(t, mo), '2026-10-13', 'all', fields({ rule: null, date: '2026-10-13' }))[0]).toMatchObject({ set: { start_date: '2026-10-13', rrule: null } });
  });

  it('odwołanie „to i następne”, od pierwszego wystąpienia i „wszystkie” — usunięcie serii', () => {
    const { t, mo, sa, newId } = dances();
    expect(cancelEvent(detail(t, mo), '2026-10-19', 'following')).toEqual([{ kind: 'patch', entity: 'events', id: mo, set: { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018' } }]);
    expect(cancelEvent(detail(t, mo), '2026-10-05', 'following')).toEqual([{ kind: 'delete', entity: 'events', id: mo }]);
    expect(cancelEvent(detail(t, sa), '2026-10-17', 'all')).toEqual([{ kind: 'delete', entity: 'events', id: sa }]);
    run(t, cancelEvent(detail(t, sa), '2026-10-17', 'all'));
    expect(range(t, '2026-10-01', '2026-10-31').filter((x) => x.eventId === sa)).toEqual([]);
    const one = createEvent('gf', fields({ rule: null, date: '2026-10-08' }), newId);
    run(t, one.ops);
    expect(cancelEvent(detail(t, one.id), '2026-10-08', 'this')).toEqual([{ kind: 'delete', entity: 'events', id: one.id }]);
  });
});

describe('uczestnicy i „dotyczy mnie” (D58)', () => {
  it('wybrane osoby: tworzenie, zmiana listy — dodanie, przywrócenie usuniętego, usunięcie zbędnego', () => {
    const t = world();
    const newId = ids();
    const e = createEvent('gf', fields({ audience: 'members', participantIds: ['kuba', 'ala'] }), newId);
    expect(e.ops.slice(1)).toEqual([
      { kind: 'create', entity: 'event_participants', id: 'id2', group_id: 'gf', set: { event_id: e.id, member_id: 'kuba' } },
      { kind: 'create', entity: 'event_participants', id: 'id3', group_id: 'gf', set: { event_id: e.id, member_id: 'ala' } },
    ]);
    run(t, e.ops);
    const drop = editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'members', participantIds: ['kuba'] }));
    expect(drop.slice(1)).toEqual([{ kind: 'delete', entity: 'event_participants', id: 'id3' }]);
    run(t, drop);
    const back = editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'members', participantIds: ['kuba', 'ala', 'mf'] }));
    // Audyt 2 (S-8): nowy uczestnik zmienianego wydarzenia — identyfikator z wydarzenia i osoby, utworzenie i przywrócenie
    // (gdy drugi telefon w międzyczasie dopisał i usunął tę osobę).
    expect(back.slice(1)).toEqual([
      { kind: 'restore', entity: 'event_participants', id: 'id3' },
      { kind: 'create', entity: 'event_participants', id: participantId(e.id, 'mf'), group_id: 'gf', set: { event_id: e.id, member_id: 'mf' } },
      { kind: 'restore', entity: 'event_participants', id: participantId(e.id, 'mf') },
    ]);
    // Cała grupa: uczestnicy zbędni (usuwani).
    run(t, back);
    const all = editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'group', participantIds: ['kuba'] }));
    expect(all.slice(1).map((o) => o.kind)).toEqual(['delete', 'delete', 'delete']);
    expect(createEvent('gf', fields({ audience: 'group', participantIds: ['kuba'] }), newId).ops).toHaveLength(1);
  });

  function withAudience(t: T, ids_: string[], g = 'gf') {
    const e = createEvent(g, fields({ audience: 'members', participantIds: ids_, rule: null, date: '2026-10-07' }), ids());
    run(t, e.ops.map((o) => ('id' in o ? { ...o, id: `${o.id}-${ids_.join('-')}-${g}` } : o)).map((o) => (o.kind === 'create' && o.entity === 'event_participants' ? { ...o, set: { ...o.set, event_id: `${e.id}-${ids_.join('-')}-${g}` } } : o)));
    return `${e.id}-${ids_.join('-')}-${g}`;
  }
  const concerns = (t: T, id: string) => range(t, '2026-10-07', '2026-10-07').find((x) => x.eventId === id)!.concernsMe;

  it('cała grupa → dotyczy; ja uczestnikiem → dotyczy; dziecko uczestnikiem → dotyczy dorosłych; inni dorośli → nie', () => {
    const t = world();
    expect(concerns(t, withAudience(t, ['mf']))).toBe(true);
    expect(concerns(t, withAudience(t, ['kuba']))).toBe(true);
    expect(concerns(t, withAudience(t, ['ala']))).toBe(false);
    expect(concerns(t, withAudience(t, ['zosia']))).toBe(false); // dziecko usunięte z grupy
    expect(concerns(t, withAudience(t, ['nieznany']))).toBe(false);
  });

  it('jako dziecko w grupie (z kontem, PW-14 B): zajęcia innego dziecka mnie nie dotyczą i nie widać ich nawet w Kalendarzu', () => {
    const t = world('child');
    const other = withAudience(t, ['kuba']);
    expect(range(t, '2026-10-07', '2026-10-07').find((x) => x.eventId === other)).toBeUndefined();
    expect(concerns(t, withAudience(t, ['mf']))).toBe(true);
  });

  it('obca grupa i grupa w koszu: nie widać; usunięte wydarzenie i usunięty uczestnik nie liczą się', () => {
    const t = world();
    const x = withAudience(t, ['kx'], 'gx');
    expect(range(t, '2026-10-07', '2026-10-07').find((o) => o.eventId === x)).toBeUndefined();
    const e = withAudience(t, ['mf']);
    const p = Object.values(t.event_participants!).find((r) => r.event_id === e)!;
    run(t, [{ kind: 'delete', entity: 'event_participants', id: String(p.id) }]);
    expect(concerns(t, e)).toBe(false);
    run(t, [{ kind: 'delete', entity: 'events', id: e }]);
    expect(range(t, '2026-10-07', '2026-10-07').find((o) => o.eventId === e)).toBeUndefined();
  });

  it('usunięty wyjątek nie działa (wystąpienie wraca na swoje miejsce)', () => {
    const t = world();
    const newId = ids();
    const e = createEvent('gf', fields(), newId);
    run(t, e.ops);
    run(t, cancelEvent(detail(t, e.id), '2026-10-12', 'this'));
    const o = detail(t, e.id).overrides[0]!;
    run(t, [{ kind: 'delete', entity: 'event_overrides', id: o.id }]);
    expect(brief(range(t, '2026-10-12', '2026-10-12'))).toEqual(['2026-10-12 18:00 Tańce Kuby']);
  });
});

describe('widoki: dziś i jutro, kalendarz', () => {
  it('todayEvents: tylko to, co mnie dotyczy, dziś i jutro; eventsByDate: wszystko z moich grup po dniach', () => {
    const t = world();
    const newId = ids();
    run(t, createEvent('gp', fields({ title: 'Basen', date: '2026-10-07', rule: null, startTime: null, endTime: null }), newId).ops);
    run(t, createEvent('gf', fields({ title: 'Ala: lekarz', date: '2026-10-08', rule: null, audience: 'members', participantIds: ['ala'] }), newId).ops);
    run(t, createEvent('gk', fields({ title: 'Wywiadówka', date: '2026-10-08', rule: null, startTime: '17:00' }), newId).ops);
    run(t, createEvent('gk', fields({ title: 'Wycieczka', date: '2026-10-09', rule: null }), newId).ops);
    const v = todayEvents(t, ME, TODAY);
    expect(v.today.map((x) => x.title)).toEqual(['Basen']);
    expect(v.tomorrow.map((x) => x.title)).toEqual(['Wywiadówka']);
    const m = eventsByDate(t, ME, D('2026-10-07'), D('2026-10-09'));
    expect([...m.keys()]).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(m.get('2026-10-08')!.map((x) => x.title)).toEqual(['Wywiadówka', 'Ala: lekarz']);
  });

  it('kolejność: dzień, godzina (całodniowe najpierw), tytuł, id', () => {
    const t = world();
    const newId = ids();
    for (const [title, time] of [['B', '10:00'], ['A', '10:00'], ['C', null], ['A', '10:00']] as const) run(t, createEvent('gp', fields({ title, date: '2026-10-07', rule: null, startTime: time, endTime: null }), newId).ops);
    const out = range(t, '2026-10-07', '2026-10-07');
    expect(out.map((x) => x.title)).toEqual(['C', 'A', 'A', 'B']);
    expect(out[1]!.eventId < out[2]!.eventId).toBe(true);
  });
});

describe('szczegóły i formularz', () => {
  it('eventDetail: brak, obca grupa, uprawnienia (dziecko i usunięte nie edytują)', () => {
    const t = world();
    const newId = ids();
    expect(eventDetail(t, ME, 'nie-ma')).toBeNull();
    const x = createEvent('gx', fields(), newId);
    run(t, x.ops);
    expect(eventDetail(t, ME, x.id)).toBeNull();
    const e = createEvent('gf', fields({ audience: 'members', participantIds: ['kuba'] }), newId);
    run(t, e.ops);
    const d = detail(t, e.id);
    expect(d).toMatchObject({ groupName: 'Rodzina', canEdit: true, rule: { freq: 'WEEKLY' } });
    expect(d.members.map((m) => m.member_id).sort()).toEqual(['ala', 'kuba', 'mf']);
    expect(d.participants.map((p) => p.member_id)).toEqual(['kuba']);
    expect(eventDetail(world('child') as T, ME, e.id)).toBeNull();
    const tc = run(world('child'), e.ops);
    expect(detail(tc, e.id).canEdit).toBe(false);
    run(t, [{ kind: 'delete', entity: 'events', id: e.id }]);
    expect(detail(t, e.id).canEdit).toBe(false);
  });

  it('fieldsOf: to wystąpienie (z wyjątkiem), następne, wszystkie; COUNT → data ostatniego', () => {
    const t = world();
    const newId = ids();
    const e = createEvent('gf', fields({ audience: 'members', participantIds: ['kuba', 'ala'] }), newId);
    run(t, e.ops);
    run(t, editEvent(detail(t, e.id), '2026-10-12', 'this', fields({ date: '2026-10-13', startTime: '17:00', endTime: '18:00', title: 'Inne' })));
    run(t, editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'members', participantIds: ['kuba'] })));
    const d = detail(t, e.id);
    expect(fieldsOf(d, '2026-10-12', 'this')).toEqual({ title: 'Inne', date: '2026-10-13', startTime: '17:00', endTime: '18:00', rule: { ...weekly('MO') }, until: null, audience: 'members', participantIds: ['kuba'], responsibleId: null, location: null, days: 1, durationMin: null });
    expect(fieldsOf(d, '2026-10-12', 'following')).toMatchObject({ title: 'Tańce Kuby', date: '2026-10-12', startTime: '18:00', endTime: '19:00' });
    expect(fieldsOf(d, '2026-10-19', 'this')).toMatchObject({ date: '2026-10-19', startTime: '18:00' });
    expect(fieldsOf(d, '2026-10-19', 'all').date).toBe('2026-10-05');
    t.events![e.id] = { ...t.events![e.id]!, rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3' };
    expect(fieldsOf(detail(t, e.id), '2026-10-05', 'all')).toMatchObject({ rule: weekly('MO'), until: '2026-10-19' });
    t.events![e.id] = { ...t.events![e.id]!, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231' };
    expect(fieldsOf(detail(t, e.id), '2026-10-05', 'all').until).toBe('2026-12-31');
    t.events![e.id] = { ...t.events![e.id]!, rrule: null };
    expect(fieldsOf(detail(t, e.id), '2026-10-05', 'all')).toMatchObject({ rule: null, until: null });
  });
});

/** Słowa opisu są w strings.pl.ts (M-158; polskie przypadki: src/app/__tests__/texts.test.ts) — tu tylko kształt. */
const RL: RuleLabels = {
  every: (f, n) => `${f}/${n}`,
  weekdays: (b, d) => `${b}:${d.join(',')}`,
  nth: (b, n, w) => `${b}#${n}@${w}`,
  monthDay: (b, d) => `${b}@${d}`,
  until: (u) => ` do ${u.y}-${u.m}-${u.d}`,
  count: (n) => ` x${n}`,
};

describe('opis reguły (kształt)', () => {
  const at = D('2026-10-05');
  const cases: [string, string][] = [
    ['FREQ=DAILY', 'DAILY/1'],
    ['FREQ=DAILY;INTERVAL=3', 'DAILY/3'],
    ['FREQ=WEEKLY', 'WEEKLY/1'],
    ['FREQ=WEEKLY;BYDAY=SA,MO,MO', 'WEEKLY/1:0,5'],
    ['FREQ=MONTHLY', 'MONTHLY/1@5'],
    ['FREQ=MONTHLY;BYMONTHDAY=15', 'MONTHLY/1@15'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'MONTHLY/1@-1'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'MONTHLY/1#-1@4'],
    ['FREQ=MONTHLY;BYDAY=2MO', 'MONTHLY/1#2@0'],
    ['FREQ=MONTHLY;BYDAY=MO,TH', 'MONTHLY/1:0,3'],
    ['FREQ=YEARLY;INTERVAL=2', 'YEARLY/2'],
    ['FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231', 'WEEKLY/1:0 do 2026-12-31'],
    ['FREQ=DAILY;COUNT=3', 'DAILY/1 x3'],
  ];
  it.each(cases)('%s → %s', (r, text) => expect(describeRule(parseRule(r), at, RL)).toBe(text));
});

describe('godziny i lista wydarzeń grupy', () => {
  it('timeLabel', () => {
    expect(timeLabel(null, null)).toBeNull();
    expect(timeLabel('18:00:00', null)).toBe('18:00');
    expect(timeLabel('18:00:00', '19:30:00')).toBe('18:00–19:30');
  });

  it('lengthLabel (D120)', () => {
    expect(lengthLabel(null, null)).toBeNull();
    expect(lengthLabel('18:00:00', null)).toBeNull();
    expect(lengthLabel('18:00:00', '19:30:00')).toBe('1 h 30 min');
  });

  it('groupSeries: najbliższy termin od dziś, opis; zakończone na końcu; inne grupy i usunięte pominięte', () => {
    const t = world();
    const newId = ids();
    const mo = createEvent('gf', fields(), newId);
    const sa = createEvent('gf', fields({ startTime: '12:00', endTime: '13:00', rule: weekly('SA') }), newId);
    const old = createEvent('gf', fields({ title: 'Stare', rule: null, date: '2026-09-01', startTime: null, endTime: null }), newId);
    const old2 = createEvent('gf', fields({ title: 'Archiwum', rule: null, date: '2026-09-02' }), newId);
    const old3 = createEvent('gf', fields({ title: 'Archiwum', rule: null, date: '2026-09-02' }), newId);
    const gone = createEvent('gf', fields({ title: 'Usunięte' }), newId);
    const other = createEvent('gk', fields({ title: 'Klasa' }), newId);
    run(t, [...mo.ops, ...sa.ops, ...old.ops, ...old2.ops, ...old3.ops, ...gone.ops, ...other.ops, { kind: 'delete', entity: 'events', id: gone.id }]);
    expect(groupSeries(t, ME, 'gf', TODAY, RL)).toEqual([
      { id: sa.id, title: 'Tańce Kuby', summary: 'WEEKLY/1:5', time: '12:00–13:00', start: '2026-10-10', next: '2026-10-10', nextOccurrence: '2026-10-10' },
      { id: mo.id, title: 'Tańce Kuby', summary: 'WEEKLY/1:0', time: '18:00–19:00', start: '2026-10-05', next: '2026-10-12', nextOccurrence: '2026-10-12' },
      { id: old2.id, title: 'Archiwum', summary: 'Środa, 2 września', time: '18:00–19:00', start: '2026-09-02', next: null, nextOccurrence: null },
      { id: old3.id, title: 'Archiwum', summary: 'Środa, 2 września', time: '18:00–19:00', start: '2026-09-02', next: null, nextOccurrence: null },
      { id: old.id, title: 'Stare', summary: 'Wtorek, 1 września', time: null, start: '2026-09-01', next: null, nextOccurrence: null },
    ]);
    expect(groupSeries(t, ME, 'gx', TODAY, RL)).toEqual([]);
  });

  it('groupSeries u dziecka z kontem (PW-14 B): tylko wydarzenia, które go dotyczą', () => {
    const t = world('child');
    const newId = ids();
    const kuby = createEvent('gf', fields({ title: 'Basen Kuby', audience: 'members', participantIds: ['kuba'] }), newId);
    const moje = createEvent('gf', fields({ title: 'Moje tańce', audience: 'members', participantIds: ['mf'] }), newId);
    const wszyscy = createEvent('gf', fields({ title: 'Obiad', audience: 'group' }), newId);
    const ali = createEvent('gf', fields({ title: 'Zebranie', audience: 'group', responsibleId: 'ala' }), newId);
    const ja = createEvent('gf', fields({ title: 'Sprzątanie', audience: 'group', responsibleId: 'mf' }), newId);
    const dawna = createEvent('gf', fields({ title: 'Po Zosi', audience: 'group', responsibleId: 'zosia' }), newId);
    run(t, [...kuby.ops, ...moje.ops, ...wszyscy.ops, ...ali.ops, ...ja.ops, ...dawna.ops]);
    expect(groupSeries(t, ME, 'gf', TODAY, RL).map((x) => x.title).sort()).toEqual(['Moje tańce', 'Obiad', 'Po Zosi', 'Sprzątanie']);
    // Dorosły w tej grupie widzi wszystkie.
    t.group_members!.mf = { ...t.group_members!.mf!, role: 'admin' };
    expect(groupSeries(t, ME, 'gf', TODAY, RL)).toHaveLength(6);
  });
});

describe('osoba odpowiedzialna (D66)', () => {
  it('wskazana osoba: tylko u niej (i u dorosłych wskazanych imiennie); bez osoby — jak dotąd; inna w jednym wystąpieniu', () => {
    const t = world();
    const newId = ids();
    const e = createEvent('gf', fields({ title: 'Logopeda', rule: weekly('WE'), date: '2026-10-07', audience: 'members', participantIds: ['kuba'], responsibleId: 'ala' }), newId);
    run(t, e.ops);
    const at = (d: string) => range(t, d, d).find((x) => x.eventId === e.id)!;
    expect(at('2026-10-07')).toMatchObject({ concernsMe: false, responsibleId: 'ala', responsibleName: 'Ala' });
    // W jednym terminie odpowiada Łukasz (ja).
    run(t, editEvent(detail(t, e.id), '2026-10-14', 'this', fields({ title: 'Logopeda', date: '2026-10-14', responsibleId: 'mf' })));
    expect(at('2026-10-14')).toMatchObject({ concernsMe: true, responsibleId: 'mf', responsibleName: 'Łukasz' });
    expect(fieldsOf(detail(t, e.id), '2026-10-14', 'this').responsibleId).toBe('mf');
    expect(fieldsOf(detail(t, e.id), '2026-10-21', 'this').responsibleId).toBe('ala');
    // Ta sama osoba co w serii (i nic innego) → wyjątek niepotrzebny.
    expect(editEvent(detail(t, e.id), '2026-10-21', 'this', fields({ title: 'Logopeda', date: '2026-10-21', responsibleId: 'ala' }))).toEqual([]);
    // Imienny uczestnik-dorosły widzi mimo osoby odpowiedzialnej; cała grupa z osobą — tylko ona.
    const both = createEvent('gf', fields({ rule: null, date: '2026-10-08', audience: 'members', participantIds: ['mf'], responsibleId: 'ala' }), newId);
    const all = createEvent('gf', fields({ rule: null, date: '2026-10-08', audience: 'group', responsibleId: 'ala' }), newId);
    run(t, [...both.ops, ...all.ops]);
    expect(at('2026-10-08')).toBeUndefined();
    const d8 = range(t, '2026-10-08', '2026-10-08');
    expect(d8.find((x) => x.eventId === both.id)!.concernsMe).toBe(true);
    expect(d8.find((x) => x.eventId === all.id)!.concernsMe).toBe(false);
    // D132: nieznana albo usunięta z grupy osoba = nikt konkretny — wydarzenie wraca do reguły grupy (nie znika wszystkim).
    t.events![all.id] = { ...t.events![all.id]!, responsible_member_id: 'nie-ma' };
    expect(range(t, '2026-10-08', '2026-10-08').find((x) => x.eventId === all.id)).toMatchObject({ responsibleId: null, responsibleName: null, concernsMe: true });
    t.events![all.id] = { ...t.events![all.id]!, responsible_member_id: 'ala' };
    t.group_members!.ala = { ...t.group_members!.ala!, deleted_at: '2026-10-07T10:00:00Z' };
    expect(range(t, '2026-10-08', '2026-10-08').find((x) => x.eventId === all.id)).toMatchObject({ responsibleId: null, concernsMe: true });
  });
});

describe('audyt 2: zmiany pojedynczych terminów i serii', () => {
  function chor(extra: Row = {}) {
    const t = world();
    put(t, 'events', 'chor', { id: 'chor', group_id: 'gf', title: 'Chór', start_date: '2026-10-05', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: 'ala', deleted_at: null, ...extra });
    return t;
  }
  const occ = (t: T, date: string) => range(t, date, date).find((x) => x.eventId === 'chor')!;
  const form = (t: T, date: string, over: Partial<EventFields> = {}) => ({ ...fieldsOf(detail(t, 'chor'), date, 'this'), ...over });

  it('M-94 (E-8): „tylko to” z „nikt konkretny”, gdy seria ma osobę — znacznik; wybór osoby go zdejmuje', () => {
    const t = chor();
    const ops = editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12', { responsibleId: null }));
    expect(ops[1]).toEqual({ kind: 'patch', entity: 'event_overrides', id: overrideId('chor', '2026-10-12'), set: { responsible_cleared: true } });
    run(t, ops);
    expect(occ(t, '2026-10-12')).toMatchObject({ responsibleId: null, concernsMe: true });
    expect(occ(t, '2026-10-19').responsibleId).toBe('ala');
    expect(fieldsOf(detail(t, 'chor'), '2026-10-12', 'this').responsibleId).toBeNull();
    // Zmiana osoby serii nie rusza tego terminu.
    put(t, 'events', 'chor', { ...t.events!.chor!, responsible_member_id: 'mf' });
    expect(occ(t, '2026-10-12').responsibleId).toBeNull();
    const back = editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12', { responsibleId: 'ala' }));
    expect(back).toEqual([{ kind: 'patch', entity: 'event_overrides', id: overrideId('chor', '2026-10-12'), set: { responsible_member_id: 'ala', responsible_cleared: false } }]);
    // Seria bez osoby: „nikt konkretny” to po prostu brak zmiany.
    const free = chor({ responsible_member_id: null });
    expect(editEvent(detail(free, 'chor'), '2026-10-12', 'this', form(free, '2026-10-12', { responsibleId: null }))).toEqual([]);
  });

  it('M-95 (PW-33, wariant A): termin ze zmienioną nazwą, osobą albo dniem idzie za godziną serii; własna godzina zostaje', () => {
    const t = chor();
    run(t, editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12', { title: 'Chór — próba generalna' })));
    run(t, editEvent(detail(t, 'chor'), '2026-10-19', 'this', form(t, '2026-10-19', { date: '2026-10-20' })));
    run(t, editEvent(detail(t, 'chor'), '2026-10-26', 'this', form(t, '2026-10-26', { startTime: '16:00', endTime: '17:00' })));
    expect(detail(t, 'chor').overrides.map((o) => [o.occurrence_date, o.start_time, o.end_time])).toEqual([
      ['2026-10-12', null, null],
      ['2026-10-19', null, null],
      ['2026-10-26', '16:00', '17:00'],
    ]);
    // Cała seria na 18:00: przemianowany i przeniesiony termin idą za nią, termin z własną godziną nie.
    run(t, editEvent(detail(t, 'chor'), '2026-10-05', 'all', { ...fieldsOf(detail(t, 'chor'), '2026-10-05', 'all'), startTime: '18:00', endTime: '19:00' }));
    expect(brief(range(t, '2026-10-12', '2026-10-26'))).toEqual(['2026-10-12 18:00 Chór — próba generalna', '2026-10-20 18:00 Chór', '2026-10-26 16:00 Chór']);
    // Powrót do godziny serii zdejmuje własną godzinę.
    expect(editEvent(detail(t, 'chor'), '2026-10-26', 'this', form(t, '2026-10-26', { startTime: '18:00', endTime: '19:00' }))).toEqual([
      { kind: 'patch', entity: 'event_overrides', id: overrideId('chor', '2026-10-26'), set: { start_time: null, end_time: null } },
    ]);
  });

  it('zapis bez zmian istniejącego wyjątku — nic; „to i następne” jako jednorazowe — jedno wydarzenie od tego dnia', () => {
    const t = chor();
    run(t, editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12', { title: 'Próba' })));
    expect(editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12'))).toEqual([]);
    const [op] = editEvent(detail(t, 'chor'), '2026-10-19', 'following', { ...fieldsOf(detail(t, 'chor'), '2026-10-19', 'following'), rule: null });
    expect(op).toMatchObject({ kind: 'cmd', args: { set: { start_date: '2026-10-19', rrule: null } } });
    run(t, [op!]);
    expect(brief(range(t, '2026-10-12', '2026-11-30'))).toEqual(['2026-10-12 17:00:00 Próba', '2026-10-19 17:00:00 Chór']);
  });

  it('S-8: zmiana terminu z wyjątkiem w koszu przywraca ten wiersz; odwołanie też', () => {
    const t = chor();
    put(t, 'event_overrides', 'stary', { id: 'stary', group_id: 'gf', event_id: 'chor', occurrence_date: '2026-10-12', cancelled: true, title: 'Stary', deleted_at: '2026-10-01T00:00:00Z' });
    expect(editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12', { title: 'Nowy' }))).toEqual([
      { kind: 'restore', entity: 'event_overrides', id: 'stary' },
      { kind: 'patch', entity: 'event_overrides', id: 'stary', set: { title: 'Nowy', cancelled: false } },
    ]);
    // Bez zmian względem serii — wyjątek z kosza zostaje w koszu.
    expect(editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12'))).toEqual([]);
    expect(cancelEvent(detail(t, 'chor'), '2026-10-12', 'this')).toEqual([{ kind: 'restore', entity: 'event_overrides', id: 'stary' }, { kind: 'patch', entity: 'event_overrides', id: 'stary', set: { title: null } }]);
    put(t, 'event_overrides', 'pusty', { id: 'pusty', group_id: 'gf', event_id: 'chor', occurrence_date: '2026-10-19', cancelled: false, deleted_at: 'x' });
    expect(cancelEvent(detail(t, 'chor'), '2026-10-19', 'this')).toEqual([{ kind: 'restore', entity: 'event_overrides', id: 'pusty' }, { kind: 'patch', entity: 'event_overrides', id: 'pusty', set: { cancelled: true } }]);
  });

  it('M-208 (E-18): stan terminu i przywrócenie odwołanego', () => {
    const t = chor();
    expect(occurrenceState(detail(t, 'chor'), '2026-10-12')).toBe('active');
    expect(occurrenceState(detail(t, 'chor'), '2026-10-13')).toBe('missing');
    expect(restoreOccurrence(detail(t, 'chor'), '2026-10-12')).toEqual([]);
    run(t, cancelEvent(detail(t, 'chor'), '2026-10-12', 'this'));
    expect(occurrenceState(detail(t, 'chor'), '2026-10-12')).toBe('cancelled');
    const restore = restoreOccurrence(detail(t, 'chor'), '2026-10-12');
    expect(restore).toEqual([{ kind: 'patch', entity: 'event_overrides', id: overrideId('chor', '2026-10-12'), set: { cancelled: false } }]);
    run(t, restore);
    expect(occurrenceState(detail(t, 'chor'), '2026-10-12')).toBe('active');
    const once = chor({ rrule: null });
    expect([occurrenceState(detail(once, 'chor'), '2026-10-05'), occurrenceState(detail(once, 'chor'), '2026-10-12')]).toEqual(['active', 'missing']);
  });

  it('M-210 (E-20) i M-93 (E-7): zmiana reguły „wszystkich” — wyjątki spoza nowej reguły do kosza; na jednorazowe — wszystkie', () => {
    const t = chor();
    run(t, cancelEvent(detail(t, 'chor'), '2026-10-12', 'this'));
    run(t, editEvent(detail(t, 'chor'), '2026-10-19', 'this', form(t, '2026-10-19', { date: '2026-10-21' })));
    const tuesdays = editEvent(detail(t, 'chor'), '2026-10-19', 'all', { ...fieldsOf(detail(t, 'chor'), '2026-10-19', 'all'), rule: weekly('MO,TU') });
    expect(tuesdays.filter((o) => o.kind === 'delete')).toEqual([]);
    const fridays = editEvent(detail(t, 'chor'), '2026-10-19', 'all', { ...fieldsOf(detail(t, 'chor'), '2026-10-19', 'all'), rule: weekly('FR') });
    expect(fridays.slice(1)).toEqual([
      { kind: 'delete', entity: 'event_overrides', id: overrideId('chor', '2026-10-12') },
      { kind: 'delete', entity: 'event_overrides', id: overrideId('chor', '2026-10-19') },
    ]);
    // „Nie powtarza się”: jedno wydarzenie w dniu z formularza; wszystkie wyjątki do kosza (także ten z tego dnia).
    const once = editEvent(detail(t, 'chor'), '2026-10-19', 'all', { ...fieldsOf(detail(t, 'chor'), '2026-10-19', 'all'), rule: null, date: '2026-10-12' });
    expect(once[0]).toMatchObject({ set: { start_date: '2026-10-12', rrule: null } });
    expect(once.slice(1).map((o) => o.kind)).toEqual(['delete', 'delete']);
    run(t, once);
    expect(brief(range(t, '2026-09-01', '2026-12-31'))).toEqual(['2026-10-12 17:00:00 Chór']);
  });

  it('M-210 (E-20) przy „to i następne”: wyjątki z dni, których nowa seria nie ma, idą do kosza w tym samym poleceniu', () => {
    const t = chor();
    run(t, editEvent(detail(t, 'chor'), '2026-10-19', 'this', form(t, '2026-10-19', { title: 'Próba' })));
    run(t, editEvent(detail(t, 'chor'), '2026-10-05', 'this', form(t, '2026-10-05', { title: 'Pierwsze' })));
    const ops = editEvent(detail(t, 'chor'), '2026-10-12', 'following', { ...fieldsOf(detail(t, 'chor'), '2026-10-12', 'following'), rule: weekly('FR') });
    expect(ops[0]).toMatchObject({ args: { drop_overrides: [overrideId('chor', '2026-10-19')], set: { start_date: '2026-10-16' } } });
    run(t, ops);
    expect(t.event_overrides![overrideId('chor', '2026-10-19')]).toMatchObject({ event_id: splitId('chor', '2026-10-12'), deleted_at: 'pending' });
    expect(t.event_overrides![overrideId('chor', '2026-10-05')]!.deleted_at).toBeNull();
  });

  it('M-209 (E-19): najbliższy termin na ekranie grupy — dzień po przeniesieniu, otwarcie po dniu wystąpienia', () => {
    const t = chor();
    run(t, editEvent(detail(t, 'chor'), '2026-10-12', 'this', form(t, '2026-10-12', { date: '2026-10-14' })));
    put(t, 'events', 'wt', { id: 'wt', group_id: 'gf', title: 'Wtorek', start_date: '2026-10-13', start_time: null, end_time: null, rrule: null, audience: 'group', deleted_at: null });
    expect(groupSeries(t, ME, 'gf', D('2026-10-08'), RL).map((x) => [x.id, x.next, x.nextOccurrence])).toEqual([
      ['wt', '2026-10-13', '2026-10-13'],
      ['chor', '2026-10-14', '2026-10-12'],
    ]);
  });

  it('M-96 (E-17): zakończona część serii z następczynią bez osobnego wiersza; część z terminami przed podziałem — z wierszem', () => {
    const t = chor();
    run(t, editEvent(detail(t, 'chor'), '2026-10-19', 'following', { ...fieldsOf(detail(t, 'chor'), '2026-10-19', 'following'), startTime: '18:00' }));
    const sid = splitId('chor', '2026-10-19');
    expect(groupSeries(t, ME, 'gf', D('2026-10-08'), RL).map((x) => [x.id, x.next])).toEqual([
      ['chor', '2026-10-12'],
      [sid, '2026-10-19'],
    ]);
    expect(groupSeries(t, ME, 'gf', D('2026-10-20'), RL).map((x) => [x.id, x.next])).toEqual([[sid, '2026-10-26']]);
  });

  it('łańcuch serii i właściciel terminu (stary link po „to i następne”)', () => {
    const t = chor();
    run(t, editEvent(detail(t, 'chor'), '2026-10-19', 'following', { ...fieldsOf(detail(t, 'chor'), '2026-10-19', 'following'), startTime: '18:00' }));
    const sid = splitId('chor', '2026-10-19');
    run(t, editEvent(detail(t, sid), '2026-11-02', 'following', { ...fieldsOf(detail(t, sid), '2026-11-02', 'following'), startTime: '19:00' }));
    const third = splitId(sid, '2026-11-02');
    put(t, 'events', 'inne', { id: 'inne', group_id: 'gf', title: 'Inne', start_date: '2026-10-05', rrule: null, deleted_at: null });
    expect([...seriesChain(t, third)].sort()).toEqual(['chor', sid, third].sort());
    expect([...seriesChain(t, 'inne')]).toEqual(['inne']);
    expect(occurrenceOwner(t, 'chor', '2026-10-12')).toBe('chor');
    expect(occurrenceOwner(t, 'chor', '2026-10-26')).toBe(sid);
    expect(occurrenceOwner(t, 'chor', '2026-11-09')).toBe(third);
    expect(occurrenceOwner(t, 'chor', '2026-11-10')).toBe('chor'); // wtorek — żadna część go nie ma
    expect(occurrenceOwner(t, 'nie-ma', '2026-11-09')).toBe('nie-ma');
    run(t, [{ kind: 'delete', entity: 'events', id: third }]);
    expect(occurrenceOwner(t, 'chor', '2026-11-09')).toBe('chor');
  });
});
