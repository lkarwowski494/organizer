import type { CivilDate } from '../civil-date';
import { parseIsoDate } from '../format';
import { parseRule, type Rule } from '../rrule';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import {
  asEvent,
  asOverride,
  asParticipant,
  cancelEvent,
  createEvent,
  describeRule,
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
    const all = (f: object) => (editEvent(d, '2026-10-05', 'all', { ...base, rule, ...f }, id)[0] as { set: object }).set;
    expect(all({})).not.toHaveProperty('location');
    expect(all({ location: 'ul. Wodna 1' })).not.toHaveProperty('location');
    expect(all({ location: '' })).toMatchObject({ location: null });
    expect(all({ location: 'Hala, ul. Długa 5' })).toMatchObject({ location: 'Hala, ul. Długa 5' });
    const following = editEvent(d, '2026-10-12', 'following', { ...base, rule }, id);
    expect(following[1]).toMatchObject({ kind: 'create', entity: 'events', set: { location: 'ul. Wodna 1' } });
    expect(editEvent(d, '2026-10-12', 'following', { ...base, rule, location: 'Hala' }, id)[1]).toMatchObject({ set: { location: 'Hala' } });
    expect(fieldsOf(d, '2026-10-05', 'all').location).toBe('ul. Wodna 1');
    // D126: rodzaj wpisu — zwykłe wydarzenie bez pola, lekcja z polem; „to i następne” zachowuje rodzaj.
    expect((createEvent('gf', { ...base, kind: 'event' }, id).ops[0] as { set: object }).set).not.toHaveProperty('kind');
    expect(createEvent('gf', { ...base, kind: 'lesson' }, id).ops[0]).toMatchObject({ set: { kind: 'lesson' } });
    put(t, 'events', 'e', { ...t.events!.e!, kind: 'lesson' });
    expect(editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'following', { ...base, rule }, id)[1]).toMatchObject({ kind: 'create', set: { kind: 'lesson' } });
    expect(expandEvents(t, ME, { y: 2026, m: 10, d: 5 }, { y: 2026, m: 10, d: 5 })[0]!.location).toBe('ul. Wodna 1');
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
    let n = 0;
    const ops = editEvent(d, '2026-10-12', 'following', fieldsOf(d, '2026-10-12', 'following'), () => `n${++n}`);
    expect(JSON.stringify(ops)).not.toContain('"ala"');
  });
});

describe('całodniowy pojedynczy termin (D136)', () => {
  it('„tylko to” bez godziny w serii z godziną: znacznik, widoki bez godzin; powrót godziny zdejmuje znacznik; „to i następne” go przenosi', () => {
    const base = { title: 'Basen', date: '2026-10-05', startTime: '17:00', endTime: '18:00', rule: null, until: null, audience: 'group' as const, participantIds: [], responsibleId: null };
    let n = 0;
    const id = () => `o${++n}`;
    const t = {} as Parameters<typeof put>[0];
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'events', 'e', { id: 'e', group_id: 'gf', title: 'Basen', start_date: '2026-10-05', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', deleted_at: null });
    const rule = eventDetail(t, ME, 'e')!.rule;
    const [op] = editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'this', { ...base, rule, date: '2026-10-12', startTime: null, endTime: null }, id);
    expect(op).toMatchObject({ kind: 'create', entity: 'event_overrides', set: { all_day: true, start_time: null } });
    put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'e', occurrence_date: '2026-10-12', ...(op as { set: object }).set, deleted_at: null });
    const occ = expandEvents(t, ME, { y: 2026, m: 10, d: 12 }, { y: 2026, m: 10, d: 12 })[0]!;
    expect([occ.startTime, occ.endTime]).toEqual([null, null]);
    expect(fieldsOf(eventDetail(t, ME, 'e')!, '2026-10-12', 'this')).toMatchObject({ startTime: null, endTime: null });
    // Godzina wraca: znacznik zdjęty.
    expect(editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'this', { ...base, rule, date: '2026-10-12' }, id)[0]).toMatchObject({ kind: 'patch', set: { all_day: false, start_time: '17:00' } });
    // „To i następne” od 5.10 (wcześniej) przenosi znacznik do nowej serii.
    const following = editEvent(eventDetail(t, ME, 'e')!, '2026-10-05', 'following', { ...base, rule }, id);
    expect(following.find((o) => o.kind === 'create' && o.entity === 'event_overrides')).toBeUndefined(); // 5.10 = początek → cała seria
    const later = editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'following', { ...base, rule }, id);
    expect(later.find((o) => o.kind === 'create' && o.entity === 'event_overrides')).toMatchObject({ set: { all_day: true } });
    // Seria całodniowa: bez znacznika (nic nie zmienia).
    put(t, 'events', 'e', { ...t.events!.e!, start_time: null, end_time: null });
    put(t, 'event_overrides', 'o1', { ...t.event_overrides!.o1!, all_day: false });
    const plain = editEvent(eventDetail(t, ME, 'e')!, '2026-10-19', 'this', { ...base, rule, date: '2026-10-19', startTime: null, endTime: null }, id)[0] as { set: object };
    expect(plain.set).not.toHaveProperty('all_day');
    expect((editEvent(eventDetail(t, ME, 'e')!, '2026-10-12', 'following', { ...base, rule }, id).find((o) => o.kind === 'create' && o.entity === 'event_overrides') as { set: object }).set).not.toHaveProperty('all_day');
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
      deleted_at: null,
    });
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
      deleted_at: null,
    });
    expect(asOverride({ id: 'o', event_id: 'e', occurrence_date: '2026-10-05', cancelled: true }).cancelled).toBe(true);
    expect(asOverride({ id: 'o', event_id: 'e', occurrence_date: '2026-10-05', all_day: true }).all_day).toBe(true);
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
    const { t, mo, newId } = dances();
    const ops = editEvent(detail(t, mo), '2026-10-12', 'this', fields({ date: '2026-10-13', startTime: '17:00', endTime: '18:00' }), newId);
    expect(ops).toEqual([
      { kind: 'create', entity: 'event_overrides', id: expect.any(String), group_id: 'gf', set: { event_id: mo, occurrence_date: '2026-10-12', start_date: '2026-10-13', start_time: '17:00', end_time: '18:00', title: null, responsible_member_id: null, cancelled: false } },
    ]);
    run(t, ops);
    const out = range(t, '2026-10-12', '2026-10-19').filter((x) => x.eventId === mo);
    expect(brief(out)).toEqual(['2026-10-13 17:00 Tańce Kuby', '2026-10-19 18:00 Tańce Kuby']);
    expect(out[0]).toMatchObject({ occurrenceDate: '2026-10-12', overrideId: expect.any(String), endTime: '18:00' });
    // Druga zmiana tego samego wystąpienia poprawia istniejący wyjątek (bez drugiego wiersza); ten sam dzień i tytuł → null.
    const again = editEvent(detail(t, mo), '2026-10-12', 'this', fields({ date: '2026-10-12', title: 'Tańce — próba', startTime: '17:30', endTime: null }), newId);
    expect(again).toEqual([{ kind: 'patch', entity: 'event_overrides', id: out[0]!.overrideId, set: { start_date: null, start_time: '17:30', end_time: null, title: 'Tańce — próba', responsible_member_id: null, cancelled: false } }]);
    run(t, again);
    expect(brief(range(t, '2026-10-12', '2026-10-12'))).toEqual(['2026-10-12 17:30 Tańce — próba']);
    expect(range(t, '2026-10-12', '2026-10-12')[0]!.endTime).toBeNull();
  });

  it('przeniesione wystąpienie widać także, gdy dzień pierwotny jest poza zakresem', () => {
    const { t, mo, newId } = dances();
    run(t, editEvent(detail(t, mo), '2026-10-12', 'this', fields({ date: '2026-11-20' }), newId));
    expect(brief(range(t, '2026-11-20', '2026-11-20'))).toEqual(['2026-11-20 18:00 Tańce Kuby']);
    expect(range(t, '2026-10-12', '2026-10-12')).toEqual([]);
    // Audyt 8.10.2026: dalej niż okno rozwijania formularz nie pozwala (zniknęłoby z widoków).
    expect(moveTooFar('2026-10-12', '2026-12-13')).toBe(false);
    expect(moveTooFar('2026-10-12', '2026-12-14')).toBe(true);
    expect(moveTooFar('2026-10-12', '2026-08-10')).toBe(true);
  });

  it('„tylko to”: odwołanie jednych zajęć; ponowne odwołanie zmienionego wystąpienia patchuje wyjątek', () => {
    const { t, mo, sa, newId } = dances();
    const ops = cancelEvent(detail(t, sa), '2026-10-17', 'this', newId);
    expect(ops).toEqual([{ kind: 'create', entity: 'event_overrides', id: expect.any(String), group_id: 'gf', set: { event_id: sa, occurrence_date: '2026-10-17', cancelled: true } }]);
    run(t, ops);
    expect(brief(range(t, '2026-10-17', '2026-10-17'))).toEqual([]);
    run(t, editEvent(detail(t, mo), '2026-10-19', 'this', fields({ date: '2026-10-20' }), newId));
    const o = detail(t, mo).overrides[0]!;
    expect(cancelEvent(detail(t, mo), '2026-10-19', 'this', newId)).toEqual([{ kind: 'patch', entity: 'event_overrides', id: o.id, set: { cancelled: true } }]);
  });

  it('„to i następne”: od 19.10 zajęcia o 17:00 — stara seria kończy się 18.10, nowa zaczyna 19.10, wyjątki przechodzą', () => {
    const { t, mo, newId } = dances();
    run(t, editEvent(detail(t, mo), '2026-10-26', 'this', fields({ date: '2026-10-27' }), newId));
    run(t, editEvent(detail(t, mo), '2026-10-05', 'this', fields({ title: 'Pierwsze' }), newId));
    const ops = editEvent(detail(t, mo), '2026-10-19', 'following', fields({ startTime: '17:00', endTime: '18:00' }), newId);
    expect(ops[0]).toEqual({ kind: 'patch', entity: 'events', id: mo, set: { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018' } });
    expect(ops[1]).toMatchObject({ kind: 'create', entity: 'events', set: { start_date: '2026-10-19', start_time: '17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' } });
    const moved = ops.filter((o) => 'entity' in o && o.entity === 'event_overrides');
    expect(moved.map((o) => o.kind)).toEqual(['delete', 'create']); // tylko wyjątek z 26.10, ten z 5.10 zostaje
    run(t, ops);
    expect(brief(range(t, '2026-10-05', '2026-11-02').filter((x) => x.startTime !== '12:00'))).toEqual([
      '2026-10-05 18:00 Pierwsze',
      '2026-10-12 18:00 Tańce Kuby',
      '2026-10-19 17:00 Tańce Kuby',
      '2026-10-27 18:00 Tańce Kuby',
      '2026-11-02 17:00 Tańce Kuby',
    ]);
  });

  it('„to i następne” od pierwszego wystąpienia = cała seria; bez reguły — po prostu zmiana', () => {
    const { t, mo, newId } = dances();
    const ops = editEvent(detail(t, mo), '2026-10-05', 'following', fields({ startTime: '17:00' }), newId);
    expect(ops).toEqual([{ kind: 'patch', entity: 'events', id: mo, set: { title: 'Tańce Kuby', start_date: '2026-10-05', start_time: '17:00', end_time: '19:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: null } }]);
    const one = createEvent('gf', fields({ rule: null, date: '2026-10-08' }), newId);
    run(t, one.ops);
    expect(editEvent(detail(t, one.id), '2026-10-08', 'this', fields({ rule: null, date: '2026-10-09' }), newId)[0]).toMatchObject({ kind: 'patch', entity: 'events', set: { start_date: '2026-10-09', rrule: null } });
    // Jednorazowe → seria: start od dnia z formularza, wyrównany do reguły (czw. 8.10 → pon. 12.10).
    expect(editEvent(detail(t, one.id), '2026-10-08', 'all', fields({ date: '2026-10-08' }), newId)[0]).toMatchObject({ set: { start_date: '2026-10-12', rrule: 'FREQ=WEEKLY;BYDAY=MO' } });
  });

  it('„wszystkie”: zmiana dni na wt. i czw. — start zostaje początkiem serii (wyrównany), koniec serii datą', () => {
    const { t, mo, newId } = dances();
    const ops = editEvent(detail(t, mo), '2026-10-19', 'all', fields({ rule: weekly('TU,TH'), until: '2026-10-31' }), newId);
    expect(ops).toEqual([{ kind: 'patch', entity: 'events', id: mo, set: { title: 'Tańce Kuby', start_date: '2026-10-06', start_time: '18:00', end_time: '19:00', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261031', audience: 'group', responsible_member_id: null } }]);
    run(t, ops);
    const out = range(t, '2026-10-01', '2026-12-31').filter((x) => x.eventId === mo);
    expect(out.map((x) => x.date)).toEqual(['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
    // „Wszystkie” bez powtarzania: seria staje się jednym wydarzeniem w dniu z formularza.
    expect(editEvent(detail(t, mo), '2026-10-13', 'all', fields({ rule: null, date: '2026-10-13' }), newId)[0]).toMatchObject({ set: { start_date: '2026-10-13', rrule: null } });
  });

  it('odwołanie „to i następne”, od pierwszego wystąpienia i „wszystkie” — usunięcie serii', () => {
    const { t, mo, sa, newId } = dances();
    expect(cancelEvent(detail(t, mo), '2026-10-19', 'following', newId)).toEqual([{ kind: 'patch', entity: 'events', id: mo, set: { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018' } }]);
    expect(cancelEvent(detail(t, mo), '2026-10-05', 'following', newId)).toEqual([{ kind: 'delete', entity: 'events', id: mo }]);
    expect(cancelEvent(detail(t, sa), '2026-10-17', 'all', newId)).toEqual([{ kind: 'delete', entity: 'events', id: sa }]);
    run(t, cancelEvent(detail(t, sa), '2026-10-17', 'all', newId));
    expect(range(t, '2026-10-01', '2026-10-31').filter((x) => x.eventId === sa)).toEqual([]);
    const one = createEvent('gf', fields({ rule: null, date: '2026-10-08' }), newId);
    run(t, one.ops);
    expect(cancelEvent(detail(t, one.id), '2026-10-08', 'this', newId)).toEqual([{ kind: 'delete', entity: 'events', id: one.id }]);
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
    const drop = editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'members', participantIds: ['kuba'] }), newId);
    expect(drop.slice(1)).toEqual([{ kind: 'delete', entity: 'event_participants', id: 'id3' }]);
    run(t, drop);
    const back = editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'members', participantIds: ['kuba', 'ala', 'mf'] }), newId);
    expect(back.slice(1)).toEqual([
      { kind: 'restore', entity: 'event_participants', id: 'id3' },
      { kind: 'create', entity: 'event_participants', id: expect.any(String), group_id: 'gf', set: { event_id: e.id, member_id: 'mf' } },
    ]);
    // Cała grupa: uczestnicy zbędni (usuwani).
    run(t, back);
    const all = editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'group', participantIds: ['kuba'] }), newId);
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

  it('jako dziecko w grupie: zajęcia innego dziecka mnie nie dotyczą', () => {
    const t = world('child');
    expect(concerns(t, withAudience(t, ['kuba']))).toBe(false);
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
    run(t, cancelEvent(detail(t, e.id), '2026-10-12', 'this', newId));
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
    run(t, editEvent(detail(t, e.id), '2026-10-12', 'this', fields({ date: '2026-10-13', startTime: '17:00', endTime: '18:00', title: 'Inne' }), newId));
    run(t, editEvent(detail(t, e.id), '2026-10-05', 'all', fields({ audience: 'members', participantIds: ['kuba'] }), newId));
    const d = detail(t, e.id);
    expect(fieldsOf(d, '2026-10-12', 'this')).toEqual({ title: 'Inne', date: '2026-10-13', startTime: '17:00', endTime: '18:00', rule: { ...weekly('MO') }, until: null, audience: 'members', participantIds: ['kuba'], responsibleId: null, location: null });
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

describe('opis reguły po polsku', () => {
  const at = D('2026-10-05');
  const cases: [string, string][] = [
    ['FREQ=DAILY', 'Codziennie'],
    ['FREQ=DAILY;INTERVAL=3', 'Co 3 dni'],
    ['FREQ=WEEKLY', 'Co tydzień'],
    ['FREQ=WEEKLY;BYDAY=SA,MO,MO', 'Co tydzień: pon., sob.'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'Co 2 tygodnie: wt.'],
    ['FREQ=WEEKLY;INTERVAL=5', 'Co 5 tygodni'],
    ['FREQ=MONTHLY', 'Co miesiąc, 5. dnia'],
    ['FREQ=MONTHLY;INTERVAL=2', 'Co 2 miesiące, 5. dnia'],
    ['FREQ=MONTHLY;INTERVAL=6', 'Co 6 miesięcy, 5. dnia'],
    ['FREQ=MONTHLY;BYMONTHDAY=15', 'Co miesiąc, 15. dnia'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'Co miesiąc, ostatniego dnia'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'Co miesiąc, w ostatni piątek'],
    ['FREQ=MONTHLY;BYDAY=-1SA', 'Co miesiąc, w ostatnią sobotę'],
    ['FREQ=MONTHLY;BYDAY=-1WE', 'Co miesiąc, w ostatnią środę'],
    ['FREQ=MONTHLY;BYDAY=-1SU', 'Co miesiąc, w ostatnią niedzielę'],
    ['FREQ=MONTHLY;BYDAY=2MO', 'Co miesiąc, w 2. poniedziałek'],
    ['FREQ=MONTHLY;BYDAY=MO,TH', 'Co miesiąc: pon., czw.'],
    ['FREQ=YEARLY', 'Co roku'],
    ['FREQ=YEARLY;INTERVAL=2', 'Co 2 lata'],
    ['FREQ=YEARLY;INTERVAL=5', 'Co 5 lat'],
    ['FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231', 'Co tydzień: pon., do 31.12.2026'],
    ['FREQ=WEEKLY;UNTIL=20270105', 'Co tydzień, do 5.01.2027'],
    ['FREQ=DAILY;COUNT=1', 'Codziennie, 1 raz'],
    ['FREQ=DAILY;COUNT=3', 'Codziennie, 3 razy'],
    ['FREQ=DAILY;COUNT=12', 'Codziennie, 12 razy'],
  ];
  it.each(cases)('%s → %s', (r, text) => expect(describeRule(parseRule(r), at)).toBe(text));
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
    expect(groupSeries(t, ME, 'gf', TODAY)).toEqual([
      { id: sa.id, title: 'Tańce Kuby', summary: 'Co tydzień: sob.', time: '12:00–13:00', start: '2026-10-10', next: '2026-10-10' },
      { id: mo.id, title: 'Tańce Kuby', summary: 'Co tydzień: pon.', time: '18:00–19:00', start: '2026-10-05', next: '2026-10-12' },
      { id: old2.id, title: 'Archiwum', summary: 'Środa, 2 września', time: '18:00–19:00', start: '2026-09-02', next: null },
      { id: old3.id, title: 'Archiwum', summary: 'Środa, 2 września', time: '18:00–19:00', start: '2026-09-02', next: null },
      { id: old.id, title: 'Stare', summary: 'Wtorek, 1 września', time: null, start: '2026-09-01', next: null },
    ]);
    expect(groupSeries(t, ME, 'gx', TODAY)).toEqual([]);
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
    run(t, editEvent(detail(t, e.id), '2026-10-14', 'this', fields({ title: 'Logopeda', date: '2026-10-14', responsibleId: 'mf' }), newId));
    expect(at('2026-10-14')).toMatchObject({ concernsMe: true, responsibleId: 'mf', responsibleName: 'Łukasz' });
    expect(fieldsOf(detail(t, e.id), '2026-10-14', 'this').responsibleId).toBe('mf');
    expect(fieldsOf(detail(t, e.id), '2026-10-21', 'this').responsibleId).toBe('ala');
    // Ta sama osoba co w serii → wyjątek bez zmiany osoby.
    expect(editEvent(detail(t, e.id), '2026-10-21', 'this', fields({ title: 'Logopeda', date: '2026-10-21', responsibleId: 'ala' }), newId)[0]).toMatchObject({ set: { responsible_member_id: null } });
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
