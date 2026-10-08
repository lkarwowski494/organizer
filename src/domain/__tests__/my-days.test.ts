import type { CivilDate } from '../civil-date';
import { parseIsoDate } from '../format';
import type { Row } from '../sync-engine/client';
import { calendarMonth, isExpired, listDetail, todayView } from '../views';
import { myDays, rangeOf, shiftAnchor } from '../views/my-days';

const ME = 'u-me';
const TODAY: CivilDate = { y: 2026, m: 10, d: 7 }; // środa
const D = parseIsoDate;
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
// Odhaczenie: chwila UTC → dzień w Warszawie (w testach: pierwsze 10 znaków, chwile w środku dnia).
const local = (iso: string) => iso.slice(0, 10);

function world(): T {
  const t: T = {};
  put(t, 'groups', 'gp', { id: 'gp', name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mp', { member_id: 'mp', group_id: 'gp', user_id: ME, display_name: 'Ja', role: 'owner', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Ł', role: 'admin', deleted_at: null });
  put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', display_name: 'Ala', role: 'owner', deleted_at: null });
  put(t, 'lists', 'lp', { id: 'lp', group_id: 'gp', kind: 'tasks', name: 'Moje', visibility: 'group', sort_key: 'a0', deleted_at: null });
  put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', sort_key: 'a0', deleted_at: null });
  put(t, 'lists', 'ldel', { id: 'ldel', group_id: 'gp', kind: 'tasks', name: 'X', visibility: 'group', sort_key: 'a0', deleted_at: 'x' });
  return t;
}
function task(t: T, id: string, over: Row = {}) {
  put(t, 'tasks', id, { id, group_id: 'gp', list_id: 'lp', parent_id: null, title: id, deadline_mode: 'own', due_date: '2026-10-07', due_time: null, start_date: null, completed_at: null, deleted_at: null, ...over });
}
const ev = (t: T, id: string, date: string, over: Row = {}) =>
  put(t, 'events', id, { id, group_id: 'gp', title: id, start_date: date, start_time: '17:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null, ...over });
const keys = (v: ReturnType<typeof myDays>) => v.days.map((d) => `${d.date}${d.past ? ' (minął)' : ''}${d.isToday ? ' (dziś)' : ''}: ${d.entries.map((e) => e.key).join(' ')}`);

describe('zakresy i przesuwanie', () => {
  it('dzień, tydzień od poniedziałku, miesiąc', () => {
    expect(rangeOf('day', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(rangeOf('week', TODAY)).toEqual({ from: D('2026-10-05'), to: D('2026-10-11') });
    expect(rangeOf('week', D('2026-10-11'))).toEqual({ from: D('2026-10-05'), to: D('2026-10-11') });
    expect(rangeOf('month', TODAY)).toEqual({ from: D('2026-10-01'), to: D('2026-10-31') });
    expect(rangeOf('month', D('2028-02-10')).to).toEqual(D('2028-02-29'));
  });
  it('wczoraj/jutro, tydzień, miesiąc (z przycięciem dnia i przejściem roku)', () => {
    expect(shiftAnchor('day', TODAY, -1)).toEqual(D('2026-10-06'));
    expect(shiftAnchor('week', TODAY, 1)).toEqual(D('2026-10-14'));
    expect(shiftAnchor('month', D('2026-01-31'), 1)).toEqual(D('2026-02-28'));
    expect(shiftAnchor('month', D('2026-12-15'), 1)).toEqual(D('2027-01-15'));
    expect(shiftAnchor('month', D('2026-01-15'), -1)).toEqual(D('2025-12-15'));
  });
});

describe('rolowanie i wygasanie (D61)', () => {
  it('audyt 8.10.2026: pozycje list zakupów nie są sprawami (Moje sprawy, Kalendarz)', () => {
    const t = world();
    put(t, 'lists', 'lz', { id: 'lz', group_id: 'gp', kind: 'shopping', name: 'Zakupy', visibility: 'group', sort_key: 'a0', deleted_at: null });
    task(t, 'mleko', { list_id: 'lz', deadline_mode: 'none', due_date: null });
    task(t, 'chleb', { list_id: 'lz' });
    const v = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect(v.pinned.map((x) => x.id)).toEqual([]);
    expect(keys(v)).toEqual(['2026-10-07 (dziś): ']);
    expect(todayView(t, ME, TODAY).today.map((x) => x.id)).toEqual([]);
    expect(calendarMonth(t, ME, 2026, 10).flatMap((d) => d.items.map((x) => x.id))).toEqual([]);
  });

  it('audyt 8.10.2026: podzadanie z dziedziczonym terminem mija razem z rodzicem (spotkanie, „tylko tego dnia”); własny termin przy spotkaniu przechodzi dalej', () => {
    const t = world();
    ev(t, 'basen', '2026-10-05');
    task(t, 'spakuj', { deadline_mode: 'event', due_date: null, event_id: 'basen', occurrence_date: '2026-10-05' });
    task(t, 'ręcznik', { parent_id: 'spakuj', deadline_mode: 'inherit', due_date: null });
    task(t, 'kartka', { due_date: '2026-10-06', rollover: false });
    task(t, 'koperta', { parent_id: 'kartka', deadline_mode: 'inherit', due_date: null });
    task(t, 'pod-koperta', { parent_id: 'koperta', deadline_mode: 'inherit', due_date: null });
    ev(t, 'zebranie', '2026-10-12');
    task(t, 'prezent', { due_date: '2026-10-06', event_id: 'zebranie', occurrence_date: '2026-10-12' });
    task(t, 'sierota', { parent_id: 'brak', deadline_mode: 'inherit', due_date: null });
    const v = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect(keys(v)).toEqual(['2026-10-07 (dziś): o-prezent']);
    expect(listDetail(t, ME, 'lp', TODAY)!.done.filter((x) => x.expired).map((x) => x.id).sort()).toEqual(['kartka', 'spakuj']);
  });

  it('zaległe przechodzą na dziś z liczbą dni (najstarsze na górze); termin bez zmian', () => {
    const t = world();
    task(t, 'paczka', { due_date: '2026-10-04' });
    task(t, 'mama', { due_date: '2026-10-06' });
    task(t, 'dziś', { due_time: '18:00' });
    const v = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect(keys(v)).toEqual(['2026-10-07 (dziś): o-paczka o-mama t-dziś']);
    expect(v.days[0]!.entries[0]).toMatchObject({ kind: 'overdue', task: { overdueDays: 3, due: { date: '2026-10-04' } } });
    expect(todayView(t, ME, TODAY).overdue.map((x) => x.id)).toEqual(['paczka', 'mama']);
  });

  it('„Tylko tego dnia” i zadanie na spotkaniu mijają; dziś jeszcze widać', () => {
    const t = world();
    task(t, 'życzenia', { due_date: '2026-10-06', rollover: false });
    task(t, 'życzeniaDziś', { rollover: false });
    ev(t, 'tańce', '2026-10-06');
    task(t, 'strój', { deadline_mode: 'event', due_date: null, event_id: 'tańce', occurrence_date: '2026-10-06' });
    const v = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect(keys(v)).toEqual(['2026-10-07 (dziś): t-życzeniaDziś']);
    expect(todayView(t, ME, TODAY).overdue).toEqual([]);
    expect(isExpired({ rollover: false, deadline_mode: 'own', parent_id: null, completed_at: 'x' }, { date: '2026-10-01', time: null }, '2026-10-07')).toBe(false);
    expect(isExpired({ rollover: false, deadline_mode: 'own', parent_id: null, completed_at: null }, null, '2026-10-07')).toBe(false);
  });

  it('remis zaległych: tytuł, potem id', () => {
    const t = world();
    task(t, 'b', { due_date: '2026-10-06', title: 'X' });
    task(t, 'a', { due_date: '2026-10-06', title: 'X' });
    task(t, 'c', { due_date: '2026-10-06', title: 'A' });
    expect(keys(myDays(t, ME, TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): o-c o-a o-b']);
  });
});

describe('dni minione, przyszłe, tydzień, miesiąc', () => {
  it('wczoraj: tylko odhaczone tego dnia (dzień odhaczenia, nie termin) i wydarzenia', () => {
    const t = world();
    task(t, 'zrobione', { due_date: '2026-10-01', completed_at: '2026-10-06T10:00:00Z' });
    task(t, 'dziśZrobione', { completed_at: '2026-10-07T08:00:00Z' });
    task(t, 'zaległe', { due_date: '2026-10-06' });
    ev(t, 'logopeda', '2026-10-06');
    const v = myDays(t, ME, TODAY, 'day', D('2026-10-06'), local);
    expect(keys(v)).toEqual(['2026-10-06 (minął): t-zrobione e-logopeda-2026-10-06']);
    // Odhaczone dziś znika z dzisiejszego widoku (jak dotąd).
    expect(keys(myDays(t, ME, TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): o-zaległe']);
  });

  it('pusty dzień w trybie dnia; jutro; przypięte zawsze w wyniku', () => {
    const t = world();
    task(t, 'pin', { deadline_mode: 'none', due_date: null });
    task(t, 'b-pin', { deadline_mode: 'none', due_date: null, title: 'pin' });
    task(t, 'jutro', { due_date: '2026-10-08' });
    expect(keys(myDays(t, ME, TODAY, 'day', D('2026-10-09'), local))).toEqual(['2026-10-09: ']);
    const v = myDays(t, ME, TODAY, 'day', D('2026-10-08'), local);
    expect(keys(v)).toEqual(['2026-10-08: t-jutro']);
    expect(v.pinned.map((x) => x.id)).toEqual(['b-pin', 'pin']);
  });

  it('tydzień: tylko dni z zawartością i dziś; miesiąc; tydzień bez dziś', () => {
    const t = world();
    task(t, 'pon', { due_date: '2026-10-05', completed_at: '2026-10-05T10:00:00Z' });
    task(t, 'pt', { due_date: '2026-10-09' });
    ev(t, 'nd', '2026-10-11');
    expect(keys(myDays(t, ME, TODAY, 'week', TODAY, local))).toEqual(['2026-10-05 (minął): t-pon', '2026-10-07 (dziś): ', '2026-10-09: t-pt', '2026-10-11: e-nd-2026-10-11']);
    task(t, 'listopad', { due_date: '2026-11-20' });
    expect(keys(myDays(t, ME, TODAY, 'month', D('2026-11-03'), local))).toEqual(['2026-11-20: t-listopad']);
    expect(keys(myDays(t, ME, TODAY, 'week', D('2026-10-14'), local))).toEqual([]);
  });

  it('pomijane: cudze przypisane, obca/usunięta lista, ukryte do start_date, usunięte, wydarzenia niedotyczące mnie', () => {
    const t = world();
    task(t, 'ali', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'ala' });
    task(t, 'moje', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'mf' });
    task(t, 'usunięta-lista', { list_id: 'ldel' });
    task(t, 'obca', { group_id: 'gx', list_id: 'lx' });
    task(t, 'później', { start_date: '2026-10-09' });
    task(t, 'usunięte', { deleted_at: 'x' });
    task(t, 'aliZrobione', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'ala', completed_at: '2026-10-06T10:00:00Z' });
    ev(t, 'aliEv', '2026-10-07', { group_id: 'gf', audience: 'members' });
    const v = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect(keys(v)).toEqual(['2026-10-07 (dziś): t-moje']);
    expect((v.days[0]!.entries[0] as { task: { assignee: string } }).task.assignee).toBe('Ł');
    expect(keys(myDays(t, ME, TODAY, 'day', D('2026-10-06'), local))).toEqual(['2026-10-06 (minął): ']);
  });
});

describe('lista: minione bez odhaczenia w sekcji zrobionych (D61)', () => {
  it('„Tylko tego dnia” po terminie → zrobione z flagą; rolowane zostaje w otwartych', () => {
    const t = world();
    task(t, 'życzenia', { due_date: '2026-10-06', rollover: false });
    task(t, 'paczka', { due_date: '2026-10-06' });
    const d = listDetail(t, ME, 'lp', TODAY)!;
    expect(d.open.map((x) => [x.id, x.expired])).toEqual([['paczka', false]]);
    expect(d.done.map((x) => [x.id, x.expired])).toEqual([['życzenia', true]]);
  });
});
