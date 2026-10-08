import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { createList } from '../views/commands';
import { asHandoff, incomingHandoffs } from '../views/handoffs';
import { calendarMonth, groupsView } from '../views';
import { myDays } from '../views/my-days';
import { asTrip, finishTripOps, finishTripUndoOps, hasTrip, planTrip, tripAdults, tripEntries, tripItems, tripLacksAddressee, tripSet } from '../views/shopping-trip';
import { planReminders } from '../views/reminders';

const ME = 'u-me';
const setOf = (op: NewOp) => (op as { set: Row }).set;
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
let seq = 0;
const run = (t: T, ops: NewOp[]) => {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `o${seq}` } as Op);
  return t;
};
const list = (id: string, g: string, extra: Row = {}): Row => ({ id, group_id: g, kind: 'shopping', name: 'Biedronka', visibility: 'group', sort_key: 'a0', deleted_at: null, ...extra });
function world(): T {
  const t: T = {};
  put(t, 'groups', ME, { id: ME, name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  const m = (id: string, g: string, user: string | null, name: string, role: string, extra: Row = {}) =>
    put(t, 'group_members', id, { member_id: id, group_id: g, user_id: user, display_name: name, role, deleted_at: null, ...extra });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('mm', 'gf', 'u-m', 'Magdalena', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('babcia', 'gf', null, 'Babcia', 'member');
  m('dawny', 'gf', 'u-d', 'Dawny', 'member', { deleted_at: 'x' });
  return t;
}
const item = (t: T, id: string, l: string, done: boolean, extra: Row = {}) =>
  put(t, 'tasks', id, { id, group_id: 'gf', list_id: l, parent_id: null, title: id, completed_at: done ? '2026-10-07T08:00:00Z' : null, deleted_at: null, ...extra });
const groups = (t: T) => new Map(groupsView(t, ME).map((g) => [g.id, g]));

describe('zakupy na liście zakupów (D73)', () => {
  it('odczyt pól i czy są zaplanowane', () => {
    expect(asTrip({})).toEqual({ date: null, time: null, responsibleId: null });
    expect(asTrip({ due_date: '2026-10-08', due_time: '17:00:00', responsible_member_id: 'mf' })).toEqual({ date: '2026-10-08', time: '17:00:00', responsibleId: 'mf' });
    expect(hasTrip({ date: null, time: null, responsibleId: null })).toBe(false);
    expect(hasTrip({ date: '2026-10-08', time: null, responsibleId: null })).toBe(true);
    expect(hasTrip({ date: null, time: null, responsibleId: 'mf' })).toBe(true);
  });

  it('we wspólnej grupie osoba albo dzień obowiązkowe, w osobistej nie', () => {
    expect(tripLacksAddressee('shared', { date: null, responsibleId: null })).toBe(true);
    expect(tripLacksAddressee('shared', { date: '2026-10-08', responsibleId: null })).toBe(false);
    expect(tripLacksAddressee('shared', { date: null, responsibleId: 'mf' })).toBe(false);
    expect(tripLacksAddressee('personal', { date: null, responsibleId: null })).toBe(false);
  });

  it('pola: godzina tylko z dniem; nowa lista i planowanie', () => {
    expect(tripSet({ date: null, time: '17:00', responsibleId: 'mf' })).toEqual({ due_date: null, due_time: null, responsible_member_id: 'mf' });
    expect(planTrip('l', { date: '2026-10-08', time: '17:00', responsibleId: null })).toEqual({ kind: 'patch', entity: 'lists', id: 'l', set: { due_date: '2026-10-08', due_time: '17:00', responsible_member_id: null } });
    expect(setOf(createList({ id: 'l', groupId: 'gf', kind: 'shopping', name: 'B', trip: { date: '2026-10-08', time: '17:00', responsibleId: 'mm' } }))).toEqual({
      kind: 'shopping', name: 'B', visibility: 'group', due_date: '2026-10-08', due_time: '17:00', responsible_member_id: 'mm',
    });
    expect(setOf(createList({ id: 'l', groupId: 'gf', kind: 'shopping', name: 'B', trip: { date: null, time: '17:00', responsibleId: 'mm' } }))).toMatchObject({ due_date: null, due_time: null });
    // Lista zadań nie dostaje pól zakupów (serwer by ją odrzucił).
    expect(setOf(createList({ id: 'l', groupId: 'gf', kind: 'tasks', name: 'B', trip: { date: '2026-10-08', time: null, responsibleId: null } }))).toEqual({ kind: 'tasks', name: 'B', visibility: 'group' });
  });

  it('kto robi zakupy: aktywni dorośli grupy (także bez konta), po imieniu', () => {
    expect(tripAdults(world(), 'gf').map((m) => m.member_id)).toEqual(['babcia', 'mf', 'mm']);
  });

  it('wpisy „Moje sprawy”: moje, bez osoby z dniem, bez osoby w grupie osobistej', () => {
    const t = world();
    put(t, 'lists', 'mine', list('mine', 'gf', { due_date: '2026-10-08', due_time: '17:00:00', responsible_member_id: 'mf' }));
    put(t, 'lists', 'any', list('any', 'gf', { name: 'Lidl', due_date: '2026-10-07' }));
    put(t, 'lists', 'hers', list('hers', 'gf', { responsible_member_id: 'mm' }));
    put(t, 'lists', 'none', list('none', 'gf'));
    put(t, 'lists', 'pers', list('pers', ME, { name: 'Moje', responsible_member_id: null, due_date: null }));
    put(t, 'lists', 'persPlanned', list('persPlanned', ME, { name: 'Apteka', responsible_member_id: ME }));
    put(t, 'lists', 'tasks', { ...list('tasks', 'gf'), kind: 'tasks', due_date: '2026-10-07' });
    put(t, 'lists', 'gone', list('gone', 'gf', { due_date: '2026-10-07', deleted_at: 'x' }));
    put(t, 'lists', 'alien', list('alien', 'obca', { due_date: '2026-10-07' }));
    item(t, 'mleko', 'mine', false);
    item(t, 'chleb', 'mine', true);
    item(t, 'sub', 'mine', false, { parent_id: 'mleko' });
    item(t, 'old', 'mine', false, { deleted_at: 'x' });
    const e = tripEntries(t, groups(t));
    expect(e.map((x) => x.id).sort()).toEqual(['any', 'mine', 'persPlanned']);
    expect(e.find((x) => x.id === 'mine')).toMatchObject({ title: 'Biedronka', due: { date: '2026-10-08', time: '17:00:00' }, assignee: 'Łukasz', groupName: 'Rodzina', trip: { listId: 'mine', open: 1 }, deadline_mode: 'own' });
    expect(e.find((x) => x.id === 'persPlanned')).toMatchObject({ due: null, deadline_mode: 'none' });
    expect(e.find((x) => x.id === 'any')!.assignee).toBeNull();
    expect(tripEntries({}, new Map())).toEqual([]);
  });

  it('„Moje sprawy”: bez dnia przypięte, po dniu zaległe, inaczej w swoim dniu', () => {
    const t = world();
    put(t, 'lists', 'a', list('a', 'gf', { responsible_member_id: 'mf' }));
    put(t, 'lists', 'b', list('b', 'gf', { name: 'Lidl', due_date: '2026-10-05', responsible_member_id: 'mf' }));
    put(t, 'lists', 'c', list('c', 'gf', { name: 'Rossmann', due_date: '2026-10-07', due_time: '18:00', responsible_member_id: 'mf' }));
    const v = myDays(t, ME, { y: 2026, m: 10, d: 7 }, 'day', { y: 2026, m: 10, d: 7 }, (iso) => iso.slice(0, 10));
    expect(v.pinned.map((x) => x.id)).toEqual(['a']);
    expect(v.days[0]!.entries.map((x) => (x.kind === 'event' || x.kind === 'lessons' ? x.key : x.kind === 'overdue' ? `o:${x.task.id}:${x.task.overdueDays}` : `t:${x.task.id}`))).toEqual(['o:b:2', 't:c']);
  });

  it('pozycje: niekupione i w koszyku (bez podpozycji i usuniętych)', () => {
    const t = world();
    item(t, 'a', 'l', false);
    item(t, 'b', 'l', true);
    item(t, 'c', 'x', false);
    item(t, 'd', 'l', false, { parent_id: 'a' });
    item(t, 'e', 'l', true, { deleted_at: 'x' });
    expect(tripItems(t, 'l')).toMatchObject({ open: [{ id: 'a' }], inCart: [{ id: 'b' }] });
  });

  it('zakupy zrobione: kupione do kosza, niekupione zostają; „wszystko” — też kupione; czyści dzień i osobę', () => {
    const t = world();
    put(t, 'lists', 'l', list('l', 'gf', { due_date: '2026-10-07', responsible_member_id: 'mf' }));
    item(t, 'mleko', 'l', false);
    item(t, 'chleb', 'l', true);
    const now = '2026-10-07T10:00:00.000Z';
    const clear = { kind: 'patch', entity: 'lists', id: 'l', set: { due_date: null, due_time: null, responsible_member_id: null } };
    expect(finishTripOps(t, ME, 'l', false, now)).toEqual([{ kind: 'delete', entity: 'tasks', id: 'chleb' }, clear]);
    expect(finishTripOps(t, ME, 'l', true, now)).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'mleko', set: { completed_at: now } },
      { kind: 'delete', entity: 'tasks', id: 'chleb' },
      { kind: 'delete', entity: 'tasks', id: 'mleko' },
      clear,
    ]);
    // Oczekujące przekazanie zakupów — anulowane.
    put(t, 'handoffs', 'h', { id: 'h', group_id: 'gf', entity: 'lists', entity_id: 'l', occurrence_date: null, from_member: 'mf', to_member: 'mm', status: 'pending', closed: false });
    expect(finishTripOps(t, ME, 'l', false, now).at(-1)).toEqual({ kind: 'patch', entity: 'handoffs', id: 'h', set: { status: 'cancelled' } });
    run(t, finishTripOps(t, ME, 'l', false, now));
    expect(asTrip(t.lists!.l!)).toEqual({ date: null, time: null, responsibleId: null });
    expect(tripEntries(t, groups(t))).toEqual([]);
  });

  it('przekazanie zakupów: wiersz „lists”, tytuł z nazwy listy', () => {
    const t = world();
    put(t, 'lists', 'l', list('l', 'gf', { responsible_member_id: 'mm' }));
    put(t, 'handoffs', 'h', { id: 'h', group_id: 'gf', entity: 'lists', entity_id: 'l', occurrence_date: null, from_member: 'mm', to_member: 'mf', status: 'pending', closed: false });
    expect(asHandoff(t.handoffs!.h!).entity).toBe('lists');
    expect(incomingHandoffs(t, ME)).toMatchObject([{ id: 'h', entity: 'lists', title: 'Biedronka', otherName: 'Magdalena' }]);
  });

  it('Kalendarz: wszystkie zakupy z dniem w moich grupach (także cudze); bez dnia — nie', () => {
    const t = world();
    put(t, 'lists', 'mine', list('mine', 'gf', { due_date: '2026-10-08', responsible_member_id: 'mf' }));
    put(t, 'lists', 'hers', list('hers', 'gf', { name: 'Lidl', due_date: '2026-10-08', responsible_member_id: 'mm' }));
    put(t, 'lists', 'nodate', list('nodate', 'gf', { responsible_member_id: 'mf' }));
    const day = calendarMonth(t, ME, 2026, 10).find((d) => d.date === '2026-10-08')!;
    // Kolejność jak zadania dnia: termin, potem nazwa (Biedronka przed Lidlem).
    expect(day.items.map((x) => [x.id, x.trip?.listId])).toEqual([['mine', 'mine'], ['hers', 'hers']]);
    expect(calendarMonth(t, ME, 2026, 10).flatMap((d) => d.items.map((x) => x.id))).not.toContain('nodate');
    expect(tripEntries(t, groups(t), true).map((x) => x.id).sort()).toEqual(['hers', 'mine', 'nodate']);
  });

  it('audyt 2 (M-22, R-7): zakupy osoby usuniętej z grupy wracają do „nikt konkretny” (D132), nie znikają wszystkim', () => {
    const t = world();
    put(t, 'lists', 'l1', list('l1', 'gf', { due_date: '2026-10-08', due_time: '17:00:00', responsible_member_id: 'dawny' }));
    put(t, 'lists', 'l2', list('l2', 'gf', { name: 'Lidl', responsible_member_id: 'dawny' }));
    put(t, 'lists', 'l3', list('l3', ME, { name: 'Apteka', responsible_member_id: 'nieznany' }));
    item(t, 'mleko', 'l1', false);
    // Z dniem: jak zadanie bez osoby — każdy w grupie; bez dnia we wspólnej grupie: nikt (jak zadanie bez adresata);
    // w grupie osobistej: przypięte.
    const e = tripEntries(t, groups(t));
    expect(e.map((x) => [x.id, x.assignee]).sort()).toEqual([['l1', null], ['l3', null]]);
    expect(e.find((x) => x.id === 'l1')).toMatchObject({ due: { date: '2026-10-08', time: '17:00:00' }, trip: { open: 1 } });
    const v = myDays(t, ME, { y: 2026, m: 10, d: 7 }, 'day', { y: 2026, m: 10, d: 8 }, (iso) => iso.slice(0, 10));
    expect(v.days[0]!.entries.map((x) => (x.kind === 'task' ? x.task.id : x.kind))).toEqual(['l1']);
    expect(v.pinned.map((x) => x.id)).toEqual(['l3']);
    // Przypomnienie przychodzi (wcześniej plan przypomnień też go nie miał).
    const reminders = planReminders(t, ME, { y: 2026, m: 10, d: 7 }, Date.UTC(2026, 9, 7, 8, 0), { leadMin: 30, morning: 'off' }, {
      days: 2, max: 10, toMs: (x) => Date.UTC(x.y, x.m - 1, x.d, x.hh - 2, x.mm), localDate: (iso) => iso.slice(0, 10), label: { trip: (n) => `Zakupy: ${n}`, morningTitle: '', more: () => '', summary: () => '' },
    });
    expect(reminders.map((r) => r.title)).toEqual(['Zakupy: Biedronka']);
  });

  it('audyt 2 (M-225): „Cofnij” po „Zakupy zrobione” przywraca pozycje, dzień i osobę; anulowane przekazanie zostaje anulowane', () => {
    const t = world();
    put(t, 'lists', 'l', list('l', 'gf', { due_date: '2026-10-07', due_time: '18:00:00', responsible_member_id: 'mf' }));
    item(t, 'mleko', 'l', false);
    item(t, 'chleb', 'l', true);
    put(t, 'handoffs', 'h', { id: 'h', group_id: 'gf', entity: 'lists', entity_id: 'l', occurrence_date: null, from_member: 'mf', to_member: 'mm', status: 'pending', closed: false });
    const now = '2026-10-07T10:00:00.000Z';
    const before = JSON.parse(JSON.stringify(t)) as T;
    for (const all of [false, true]) {
      const t2 = JSON.parse(JSON.stringify(before)) as T;
      const ops = finishTripOps(t2, ME, 'l', all, now);
      const back = finishTripUndoOps(t2, ops);
      expect(back.some((o) => o.kind === 'patch' && o.entity === 'handoffs')).toBe(false);
      run(t2, [...ops, ...back]);
      expect(t2.lists!.l).toEqual(before.lists!.l);
      expect(t2.tasks).toEqual(before.tasks);
      expect(t2.handoffs!.h!.status).toBe('cancelled');
    }
  });
});
