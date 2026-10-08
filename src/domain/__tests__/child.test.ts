/**
 * Dziecko z własnym kontem (decyzja właściciela z 8.10.2026, PW-14 B): w Moich sprawach i Kalendarzu tylko swoje sprawy
 * i wydarzenia, w których uczestniczy (audyt 2, P-70); zakupy grupy widać jak dotąd (bez pola odhaczenia — ekran).
 */
import type { CivilDate } from '../civil-date';
import type { Row } from '../sync-engine/client';
import { calendarMonth, checkOff, liveMembers, todayView } from '../views';
import { childEventConcerns, childOwner } from '../views/child';
import { asTask, type Tables } from '../views/model';
import { myDays } from '../views/my-days';

const KID = 'u-tymek';
const TODAY: CivilDate = { y: 2026, m: 10, d: 7 };
const local = (iso: string) => iso.slice(0, 10);

type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, key: string, row: Row) => ((t[e] ??= {})[key] = row);

/** „Rodzina”: Ala (owner), Ola (admin), Tymek — dziecko z kontem, Zosia — profil dziecka; osobista grupa Tymka. */
function world(): T {
  const t: T = {};
  put(t, 'groups', 'gk', { id: 'gk', name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  const m = (id: string, g: string, user: string | null, name: string, role: string, extra: Row = {}) =>
    put(t, 'group_members', id, { member_id: id, group_id: g, user_id: user, display_name: name, role, deleted_at: null, ...extra });
  m('kp', 'gk', KID, 'Tymek', 'owner');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('ola', 'gf', 'u-ola', 'Ola', 'admin');
  m('tymek', 'gf', KID, 'Tymek', 'child');
  m('zosia', 'gf', null, 'Zosia', 'child');
  m('dawny', 'gf', 'u-d', 'Dawny', 'member', { deleted_at: '2026-09-01T00:00:00Z' });
  const l = (id: string, g: string, name: string, kind = 'tasks', extra: Row = {}) =>
    put(t, 'lists', id, { id, group_id: g, kind, name, visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: null, ...extra });
  l('lk', 'gk', 'Moje');
  l('lf', 'gf', 'Dom');
  l('lz', 'gf', 'Zakupy', 'shopping', { due_date: '2026-10-07' });
  put(t, 'tasks', 'chleb', task('chleb', 'lz', {}));
  return t;
}

function task(id: string, list: string, over: Row): Row {
  return {
    id, group_id: list === 'lk' ? 'gk' : 'gf', list_id: list, parent_id: null, title: id, note: null, sort_key: 'a0', assignee_member_id: null,
    deadline_mode: 'own', due_date: '2026-10-07', due_time: null, start_date: null, event_id: null, occurrence_date: null, completed_at: null, deleted_at: null, ...over,
  };
}
const add = (t: T, id: string, over: Row = {}, list = 'lf') => put(t, 'tasks', id, task(id, list, over));
const event = (t: T, id: string, over: Row = {}) =>
  put(t, 'events', id, { id, group_id: 'gf', title: id, start_date: '2026-10-07', start_time: '17:00:00', end_time: null, rrule: null, audience: 'members', responsible_member_id: null, kind: 'event', deleted_at: null, ...over });
const part = (t: T, event_id: string, member_id: string, deleted_at: string | null = null) => put(t, 'event_participants', `${event_id}-${member_id}`, { id: `${event_id}-${member_id}`, event_id, member_id, deleted_at });

describe('childEventConcerns: wydarzenie dotyczy dziecka', () => {
  it.each([
    ['całej grupy, bez osoby', 'group', null, false, true],
    ['uczestników — jestem', 'members', null, true, true],
    ['uczestników — nie jestem (np. zajęcia rodzeństwa)', 'members', null, false, false],
    ['osoba odpowiedzialna to ja', 'group', 'tymek', false, true],
    ['całej grupy, ale z inną osobą odpowiedzialną', 'group', 'ala', false, false],
    ['uczestników z inną osobą odpowiedzialną — jestem wskazany', 'members', 'ala', true, true],
  ] as const)('%s', (_, audience, responsible, iParticipate, expected) => {
    expect(childEventConcerns(audience, responsible, 'tymek', iParticipate)).toBe(expected);
  });
});

describe('childOwner: zadanie jest sprawą dziecka', () => {
  it('moje, cudze, osoby usuniętej z grupy (D132), podzadania, zadania przy wydarzeniu, uszkodzony łańcuch', () => {
    const t = world();
    add(t, 'moje', { assignee_member_id: 'tymek' });
    add(t, 'ali', { assignee_member_id: 'ala' });
    add(t, 'zosi', { assignee_member_id: 'zosia' });
    add(t, 'nikogo');
    add(t, 'pod-moim', { parent_id: 'moje', deadline_mode: 'inherit' });
    add(t, 'pod-pod-moim', { parent_id: 'pod-moim', deadline_mode: 'inherit' });
    add(t, 'pod-ali', { parent_id: 'ali', deadline_mode: 'inherit' });
    add(t, 'dawnego', { assignee_member_id: 'dawny', parent_id: 'moje' });
    event(t, 'rutyna');
    part(t, 'rutyna', 'tymek');
    event(t, 'zebranie', { audience: 'group', responsible_member_id: 'ala' });
    event(t, 'basen-zosi');
    part(t, 'basen-zosi', 'zosia');
    event(t, 'usuniete', { deleted_at: '2026-10-01T00:00:00Z' });
    part(t, 'usuniete', 'tymek');
    event(t, 'po-dawnym', { audience: 'group', responsible_member_id: 'dawny' });
    event(t, 'wypisany');
    part(t, 'wypisany', 'tymek', '2026-10-05T00:00:00Z');
    // Wyjątek terminu: w tym dniu odpowiada Tymek (D66).
    event(t, 'sprzatanie', { audience: 'group', responsible_member_id: 'ala' });
    put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'sprzatanie', occurrence_date: '2026-10-07', responsible_member_id: 'tymek', cancelled: false, deleted_at: null });
    const step = (id: string, eventId: string) => add(t, id, { event_id: eventId, occurrence_date: '2026-10-07', deadline_mode: 'event', due_date: null });
    step('krok', 'rutyna');
    step('ciasto', 'zebranie');
    step('recznik', 'basen-zosi');
    step('martwy', 'usuniete');
    step('przy-dawnym', 'po-dawnym');
    step('wypisany-krok', 'wypisany');
    step('mop', 'sprzatanie');
    add(t, 'pod-krokiem', { parent_id: 'krok', deadline_mode: 'inherit' });
    // Cykl w danych lokalnych: bez końca by się nie kręciło.
    add(t, 'cykl-a', { parent_id: 'cykl-b' });
    add(t, 'cykl-b', { parent_id: 'cykl-a' });
    const owns = childOwner(t, liveMembers(t));
    const mine = Object.keys(t.tasks!).filter((id) => owns(asTask(t.tasks![id]!), 'tymek')).sort();
    expect(mine).toEqual(['dawnego', 'krok', 'moje', 'mop', 'pod-krokiem', 'pod-moim', 'pod-pod-moim', 'przy-dawnym']);
  });
});

describe('pozycje zakupów i odhaczanie (decyzja koordynatora z 8.10.2026: dziecko odhacza tylko swoje)', () => {
  it('pozycja jest dziecka, gdy przypisana do niego albo dziecko odpowiada za zakupy; checkOff tylko u dziecka', () => {
    const t = world();
    add(t, 'sok', { assignee_member_id: 'tymek' }, 'lz');
    add(t, 'ali', { assignee_member_id: 'ala' });
    add(t, 'moje', { assignee_member_id: 'tymek' });
    const owns = childOwner(t, liveMembers(t));
    const item = (id: string) => asTask(t.tasks![id]!);
    expect([owns(item('chleb'), 'tymek'), owns(item('sok'), 'tymek')]).toEqual([false, true]);
    // Lista zakupów, za które odpowiada dziecko (dane spoza dzisiejszego UI — reguła jak w SQL).
    put(t, 'lists', 'lz', { ...t.lists!.lz!, responsible_member_id: 'tymek' });
    expect(childOwner(t, liveMembers(t))(item('chleb'), 'tymek')).toBe(true);
    const kid = checkOff(t, KID);
    expect(['chleb', 'sok', 'ali', 'moje'].map((id) => kid(item(id)))).toEqual([true, true, false, true]);
    // Dane bez list (np. przed pierwszym pobraniem) — pozycja bez osoby nie jest dziecka.
    expect(childOwner({ tasks: { chleb: t.tasks!.chleb! } }, liveMembers(t))(item('chleb'), 'tymek')).toBe(false);
    // Dorosły odhacza wszystko; zadanie spoza moich grup — jak dotąd (rozstrzyga serwer).
    const adult = checkOff(t, 'u-ala');
    expect(['chleb', 'ali'].map((id) => adult(item(id)))).toEqual([true, true]);
  });
});

describe('widoki dziecka z kontem', () => {
  function family(): Tables {
    const t = world();
    add(t, 'moje', { assignee_member_id: 'tymek', due_time: '18:00:00' });
    add(t, 'przedszkole'); // nieprzypisane zadanie rodziców z terminem (P-70)
    add(t, 'ali', { assignee_member_id: 'ala' });
    add(t, 'osobiste', { due_date: null, deadline_mode: 'none' }, 'lk');
    event(t, 'basen');
    part(t, 'basen', 'tymek');
    event(t, 'basen-zosi', { start_time: '16:00:00' });
    part(t, 'basen-zosi', 'zosia');
    event(t, 'obiad', { audience: 'group', start_time: '13:00:00' });
    return t;
  }

  it('Moje sprawy: tylko moje zadania i wydarzenia, w których uczestniczę; zakupy grupy zostają', () => {
    const t = family();
    const v = todayView(t, KID, TODAY);
    expect(v.today.map((x) => x.id)).toEqual(['moje']);
    expect(v.pinned.map((x) => x.id)).toEqual(['osobiste']);
    const day = myDays(t, KID, TODAY, 'day', TODAY, local).days[0]!;
    expect(day.entries.map((e) => (e.kind === 'event' ? e.event.eventId : e.kind === 'task' ? (e.task.trip ? `zakupy:${e.task.id}` : e.task.id) : e.key))).toEqual(['zakupy:lz', 'obiad', 'basen', 'moje']);
  });

  it('Kalendarz: tylko moje zadania (także zrobione); zakupy grupy zostają', () => {
    const t = family();
    add(t, 'zrobione', { assignee_member_id: 'tymek', completed_at: '2026-10-07T08:00:00Z' });
    const day = calendarMonth(t, KID, 2026, 10).find((d) => d.date === '2026-10-07')!;
    expect(day.items.map((x) => x.id).sort()).toEqual(['lz', 'moje', 'zrobione']);
    // Dorosły w tej samej grupie widzi wszystko (D135).
    expect(calendarMonth(t, 'u-ala', 2026, 10).find((d) => d.date === '2026-10-07')!.items.map((x) => x.id).sort()).toEqual(['ali', 'lz', 'moje', 'przedszkole', 'zrobione']);
  });
});
