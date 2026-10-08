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
  it('D132: zadanie osoby usuniętej z grupy wraca do „nikt konkretny” (z terminem — u wszystkich)', () => {
    const t = world();
    task(t, 'rachunek', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'ala' });
    expect(keys(myDays(t, ME, TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): ']);
    put(t, 'group_members', 'ala', { ...t.group_members!.ala!, deleted_at: '2026-10-07T10:00:00Z' });
    expect(keys(myDays(t, ME, TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): t-rachunek']);
    expect(todayView(t, ME, TODAY).today.map((x) => x.id)).toEqual(['rachunek']);
  });

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

describe('lekcje dziecka jednym wierszem (D127)', () => {
  function school(): T {
    const t = world();
    put(t, 'group_members', 'kuba', { member_id: 'kuba', group_id: 'gf', user_id: null, display_name: 'Kuba', role: 'child', deleted_at: null });
    put(t, 'group_members', 'ola', { member_id: 'ola', group_id: 'gf', user_id: null, display_name: 'Ola', role: 'child', deleted_at: null });
    const lesson = (id: string, who: string, start: string | null, end: string | null, over: Row = {}) => {
      ev(t, id, '2026-10-05', { group_id: 'gf', start_time: start, end_time: end, rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', kind: 'lesson', ...over });
      put(t, 'event_participants', `p-${id}`, { id: `p-${id}`, event_id: id, member_id: who, deleted_at: null });
    };
    lesson('mat', 'kuba', '08:00:00', '08:45:00');
    lesson('pol', 'kuba', '09:00:00', null);
    lesson('wf', 'kuba', '12:45:00', '13:30:00');
    lesson('ang', 'ola', '10:00:00', '10:45:00');
    // Zwykłe wydarzenie dziecka (nie lekcja) zostaje osobno.
    ev(t, 'basen', '2026-10-07', { group_id: 'gf', audience: 'members' });
    put(t, 'event_participants', 'p-basen', { id: 'p-basen', event_id: 'basen', member_id: 'kuba', deleted_at: null });
    return t;
  }

  it('dorosły spoza lekcji: jeden wiersz na dziecko i dzień, od pierwszej do ostatniej lekcji', () => {
    const v = myDays(school(), ME, TODAY, 'day', TODAY, local);
    expect(keys({ ...v, days: v.days })).toEqual(['2026-10-07 (dziś): l-kuba-2026-10-07 l-ola-2026-10-07 e-basen-2026-10-07']);
    const blocks = v.days[0]!.entries.flatMap((e) => (e.kind === 'lessons' ? [e.block] : []));
    expect(blocks.map((b) => [b.name, b.start, b.end, b.lessons.map((l) => l.title), b.groupName])).toEqual([
      ['Kuba', '08:00', '13:30', ['mat', 'pol', 'wf'], 'Rodzina'],
      ['Ola', '10:00', '10:45', ['ang'], 'Rodzina'],
    ]);
  });

  it('lekcja bez godziny; jestem uczestnikiem — osobno; dziecko widzi swoje lekcje osobno; inne dni bez lekcji', () => {
    const t = school();
    put(t, 'events', 'wf', { ...t.events!.wf!, start_time: null, end_time: null });
    put(t, 'events', 'pol', { ...t.events!.pol!, start_time: null });
    put(t, 'events', 'mat', { ...t.events!.mat!, start_time: null, end_time: null });
    const b = myDays(t, ME, TODAY, 'day', TODAY, local).days[0]!.entries.find((e) => e.kind === 'lessons' && e.block.name === 'Kuba');
    expect(b).toMatchObject({ block: { start: null, end: null } });
    // Zapisany jako uczestnik lekcji Oli — ta lekcja nie zwija się.
    put(t, 'event_participants', 'p-ang-me', { id: 'p-ang-me', event_id: 'ang', member_id: 'mf', deleted_at: null });
    expect(keys(myDays(t, ME, TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): l-kuba-2026-10-07 e-ang-2026-10-07 e-basen-2026-10-07']);
    put(t, 'group_members', 'kuba', { ...t.group_members!.kuba!, user_id: 'u-kuba' });
    expect(keys(myDays(t, 'u-kuba', TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): e-mat-2026-10-07 e-pol-2026-10-07 e-wf-2026-10-07 e-basen-2026-10-07']);
    expect(myDays(t, ME, TODAY, 'day', D('2026-10-08'), local).days[0]!.entries).toEqual([]);
  });
});

describe('zadanie dziecka bez konta (decyzja właściciela z 8.10.2026, PW-1 — jak wydarzenie z dzieckiem, D58)', () => {
  function family(): T {
    const t = world();
    put(t, 'group_members', 'kuba', { member_id: 'kuba', group_id: 'gf', user_id: null, display_name: 'Kuba', role: 'child', deleted_at: null });
    put(t, 'group_members', 'ola', { member_id: 'ola', group_id: 'gf', user_id: 'u-ola', display_name: 'Ola', role: 'child', deleted_at: null });
    task(t, 'plecak', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'kuba', due_time: '20:00' });
    task(t, 'pokój', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'kuba', deadline_mode: 'none', due_date: null });
    task(t, 'zeszyt', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'kuba', due_date: '2026-10-05' });
    task(t, 'oli', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'ola', deadline_mode: 'none', due_date: null });
    return t;
  }

  it('dorosły grupy: z terminem, przypięte i zaległe — z imieniem dziecka; jutro w swoim dniu', () => {
    const t = family();
    task(t, 'basen', { group_id: 'gf', list_id: 'lf', assignee_member_id: 'kuba', due_date: '2026-10-08' });
    const v = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect(keys(v)).toEqual(['2026-10-07 (dziś): o-zeszyt t-plecak']);
    expect(v.pinned.map((x) => [x.id, x.assignee])).toEqual([['pokój', 'Kuba']]);
    expect(v.days[0]!.entries.map((e) => (e.kind === 'overdue' || e.kind === 'task' ? e.task.assignee : null))).toEqual(['Kuba', 'Kuba']);
    expect(keys(myDays(t, ME, TODAY, 'day', D('2026-10-08'), local))).toEqual(['2026-10-08: t-basen']);
    // Ten sam widok u drugiego dorosłego; dawny układ sekcji (todayView) — ta sama reguła.
    expect(keys(myDays(t, 'u-ala', TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): o-zeszyt t-plecak']);
    expect(todayView(t, ME, TODAY).today.map((x) => x.id)).toEqual(['plecak']);
  });

  it('nie dotyczy: dziecka z kontem (ma swoje Moje sprawy), mnie jako dziecka, listy, której nie widzę', () => {
    const t = family();
    expect(myDays(t, ME, TODAY, 'day', TODAY, local).pinned.map((x) => x.id)).toEqual(['pokój']);
    expect(myDays(t, 'u-ola', TODAY, 'day', TODAY, local).pinned.map((x) => x.id)).toEqual(['oli']);
    put(t, 'group_members', 'mf', { ...t.group_members!.mf!, role: 'child' });
    const asChild = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect([keys(asChild), asChild.pinned]).toEqual([['2026-10-07 (dziś): '], []]);
    const u = family();
    put(u, 'lists', 'lr', { id: 'lr', group_id: 'gf', kind: 'tasks', name: 'Prezent', visibility: 'restricted', owner_member_id: 'ala', sort_key: 'a1', deleted_at: null });
    put(u, 'object_members', 'lr:kuba', { scope_entity: 'lists', scope_id: 'lr', member_id: 'kuba', group_id: 'gf', deleted_at: null });
    task(u, 'niespodzianka', { group_id: 'gf', list_id: 'lr', assignee_member_id: 'kuba', deadline_mode: 'none', due_date: null });
    expect(myDays(u, ME, TODAY, 'day', TODAY, local).pinned.map((x) => x.id)).toEqual(['pokój']);
    put(u, 'object_members', 'lr:mf', { scope_entity: 'lists', scope_id: 'lr', member_id: 'mf', group_id: 'gf', deleted_at: null });
    expect(myDays(u, ME, TODAY, 'day', TODAY, local).pinned.map((x) => x.id)).toEqual(['niespodzianka', 'pokój']);
  });

  it('dziecko usunięte z grupy (D132): jak nieprzypisane — z terminem u wszystkich, bez terminu u nikogo', () => {
    const t = family();
    put(t, 'group_members', 'kuba', { ...t.group_members!.kuba!, deleted_at: '2026-10-07T09:00:00Z' });
    const v = myDays(t, ME, TODAY, 'day', TODAY, local);
    expect(keys(v)).toEqual(['2026-10-07 (dziś): o-zeszyt t-plecak']);
    expect(v.pinned).toEqual([]);
    expect(v.days[0]!.entries.map((e) => (e.kind === 'task' || e.kind === 'overdue' ? e.task.assignee : null))).toEqual([null, null]);
  });

  it('ta sama reguła co wydarzenie z dzieckiem-uczestnikiem (D58), dla każdej mojej roli', () => {
    for (const role of ['owner', 'admin', 'member', 'child']) {
      const t = family();
      put(t, 'group_members', 'mf', { ...t.group_members!.mf!, role });
      ev(t, 'trening', '2026-10-07', { group_id: 'gf', audience: 'members', start_time: '18:00:00' });
      put(t, 'event_participants', 'p-trening', { id: 'p-trening', event_id: 'trening', member_id: 'kuba', deleted_at: null });
      const entries = myDays(t, ME, TODAY, 'day', TODAY, local).days[0]!.entries.map((e) => e.key);
      expect([role, entries.includes('t-plecak')]).toEqual([role, entries.includes('e-trening-2026-10-07')]);
      expect([role, entries.includes('t-plecak')]).toEqual([role, role !== 'child']);
    }
  });
});

describe('start_date („widoczne od”, bez UI) liczony względem pokazywanego dnia (audyt 2: T-23)', () => {
  it('Moje sprawy: w dniu terminu, gdy widoczne od tego dnia; przypięte i zaległe — względem dziś; Kalendarz — tak samo', () => {
    const t = world();
    task(t, 'basen', { due_date: '2026-10-09', due_time: '17:00', start_date: '2026-10-09' });
    task(t, 'zawcześnie', { due_date: '2026-10-09', start_date: '2026-10-10' });
    task(t, 'pin', { deadline_mode: 'none', due_date: null, start_date: '2026-10-08' });
    task(t, 'zaległe', { due_date: '2026-10-05', start_date: '2026-10-08' });
    task(t, 'zrobione', { due_date: '2026-10-09', start_date: '2026-10-10', completed_at: '2026-10-07T08:00:00Z' });
    expect(keys(myDays(t, ME, TODAY, 'day', D('2026-10-09'), local))).toEqual(['2026-10-09: t-basen']);
    expect(keys(myDays(t, ME, TODAY, 'week', TODAY, local))).toEqual(['2026-10-07 (dziś): ', '2026-10-09: t-basen']);
    expect(myDays(t, ME, TODAY, 'day', TODAY, local).pinned).toEqual([]);
    expect(myDays(t, ME, D('2026-10-08'), 'day', D('2026-10-08'), local).pinned.map((x) => x.id)).toEqual(['pin']);
    expect(keys(myDays(t, ME, D('2026-10-08'), 'day', D('2026-10-08'), local))).toEqual(['2026-10-08 (dziś): o-zaległe']);
    const cal = calendarMonth(t, ME, 2026, 10);
    expect(cal.find((d) => d.date === '2026-10-09')!.items.map((x) => x.id)).toEqual(['zrobione', 'basen']);
    expect(cal.find((d) => d.date === '2026-10-05')!.items.map((x) => x.id)).toEqual([]);
  });
});

describe('niezrobione podzadania zrobionego zadania (decyzja właściciela z 8.10.2026, „Zostaw podzadania”; audyt 2: T-13)', () => {
  function cleaning(): T {
    const t = world();
    task(t, 'sprz', { due_date: '2026-10-07', completed_at: '2026-10-07T08:00:00Z' });
    task(t, 'odk', { parent_id: 'sprz', deadline_mode: 'inherit', due_date: null });
    task(t, 'pod-odk', { parent_id: 'odk', deadline_mode: 'inherit', due_date: null });
    task(t, 'faktura', { parent_id: 'sprz', due_date: '2026-10-09' });
    task(t, 'kiedyś', { parent_id: 'sprz', deadline_mode: 'none', due_date: null });
    return t;
  }

  it('w dniu terminu jeszcze są (z dopiskiem rodzica na ekranie); potem mijają zamiast wisieć jako zaległe', () => {
    const t = cleaning();
    expect(keys(myDays(t, ME, TODAY, 'day', TODAY, local))).toEqual(['2026-10-07 (dziś): t-odk t-pod-odk']);
    expect(keys(myDays(t, ME, TODAY, 'day', D('2026-10-09'), local))).toEqual(['2026-10-09: t-faktura']);
    // Tydzień później: nic zaległego; własny termin podzadania też mija po swoim dniu; bez terminu — dalej przypięte.
    const later = D('2026-10-14');
    const v = myDays(t, ME, later, 'day', later, local);
    expect(keys(v)).toEqual(['2026-10-14 (dziś): ']);
    expect(v.pinned.map((x) => x.id)).toEqual(['kiedyś']);
    const l = listDetail(t, ME, 'lp', later)!;
    expect(l.done[0]!.children.map((c) => [c.id, c.expired])).toEqual([['kiedyś', false], ['odk', true], ['faktura', true]]);
    expect(l.done[0]!.children[1]!.children.map((c) => [c.id, c.expired])).toEqual([['pod-odk', true]]);
  });

  it('niezrobiony rodzic — podzadania przechodzą na dziś jak dotąd; zrobione podzadanie pod zrobionym — bez zmian', () => {
    const t = cleaning();
    put(t, 'tasks', 'sprz', { ...t.tasks!.sprz!, completed_at: null });
    expect(keys(myDays(t, ME, D('2026-10-14'), 'day', D('2026-10-14'), local))).toEqual(['2026-10-14 (dziś): o-odk o-pod-odk o-sprz o-faktura']);
    expect(isExpired({ rollover: true, deadline_mode: 'inherit', parent_id: 'p', completed_at: 'x' }, { date: '2026-10-01', time: null }, '2026-10-07', new Map([['p', { rollover: true, deadline_mode: 'own' as const, parent_id: null, completed_at: 'y' }]]))).toBe(false);
  });
});
