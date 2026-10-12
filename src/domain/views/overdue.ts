/**
 * „Przenieś zaległe na dziś” (D111): moje zaległe z własnym terminem i moje zaległe zakupy (termin listy, D73) dostają
 * termin na dziś (godzina zostaje), więc znika czerwone „zaległe od …”. Moje = przypisane do mnie albo z grupy osobistej
 * (decyzja właściciela z 8.10.2026, audyt 2: wspólne nieprzypisane i zadania dziecka mają termin dla wszystkich, więc
 * zostają). Pomijamy zadania z terminem po rodzicu albo wydarzeniu — tam termin zmienia się u rodzica — i grupy, w których
 * jestem dzieckiem (D34: serwer odrzuci zmianę). Zwraca też operacje cofnięcia (poprzednie terminy) i liczbę
 * przeniesionych spraw (na przycisk i pasek — nie liczbę operacji). D137: powtarzanie co miesiąc zapisane bez dnia
 * miesiąca dostaje dzień z dotychczasowego terminu, więc przeniesienie nie przesuwa cyklu na stałe. Audyt 2: T-11, P-56.
 * Audyt 3: „moje” to ta sama reguła co w Moich sprawach przy zakresie „Tylko przypisane do mnie” (concernsMe) — także
 * sprawa bez osoby z mojej listy „Tylko ja” (N-122: stała w zaległych, a przycisk jej nie liczył) i podzadanie bez osoby
 * w moim zadaniu (Q15 A). Wspólne bez osoby bierze się pojedynczo przyciskiem „Biorę to” na ekranie zadania
 * (decyzja właściciela z 9.10.2026, Q35 A, N-133: `takeOps` — przypisanie do mnie i termin na dziś).
 */
import type { NewOp } from '../sync-engine/client';
import { setRepeat } from './task-repeat';
import { patchTask, setDue } from './commands';
import type { GroupItem } from './index';
import { concernsMe, inheritedPerson, liveMembers, livePerson, ownPrivateList } from './concerns';
import { asList, type Tables, type Task } from './model';
import type { MyTask } from './my-days';
import { changeTrip } from './shopping-trip';

/** `groups` — moje grupy (groupsView): rodzaj grupy i mój wiersz członka; `t` — listy („Tylko ja”) i rodzice podzadań. */
export function movableOverdue(tasks: readonly MyTask[], groups: readonly GroupItem[], t: Tables): MyTask[] {
  const live = liveMembers(t);
  return tasks.filter((x) => {
    const g = groups.find((y) => y.id === x.group_id);
    if (!g || g.me.role === 'child' || x.due === null || (x.trip === undefined && x.deadline_mode !== 'own')) return false;
    const list = t.lists?.[x.trip?.listId ?? x.list_id];
    const own = list !== undefined && ownPrivateList(asList(list), g);
    // Zakupy: osoba zakupów listy (D73); zadanie — także osoba zadania nadrzędnego (Q15 A).
    return concernsMe(x.trip ? x.assignee_member_id : inheritedPerson(t, x, live), g, null, live, own, 'mine');
  });
}

export function moveOverdueOps(tasks: readonly MyTask[], isoToday: string, t: Tables, groups: readonly GroupItem[]): { ops: NewOp[]; undo: NewOp[]; count: number } {
  const movable = movableOverdue(tasks, groups, t);
  const own = movable.filter((x) => !x.trip);
  const trips = movable.filter((x) => x.trip);
  const monthly = own.filter((x) => t.tasks?.[x.id]?.repeat === 'FREQ=MONTHLY');
  // Audyt 3 (N-126): tylko dzień — godzina i osoba zmienione w tym czasie na drugim telefonie zostają. Zakupy: ta sama
  // operacja co „Zapisz zakupy”.
  const task = (x: MyTask, from: string, to: string) => setDue(x.id, { date: to, time: x.due!.time }, { date: from, time: x.due!.time });
  const trip = (x: MyTask, from: string, to: string) => {
    const was = { date: from, time: x.due!.time, responsibleId: x.assignee_member_id };
    return changeTrip(x.trip!.listId, was, { ...was, date: to });
  };
  return {
    ops: [...own.map((x) => task(x, x.due!.date, isoToday)), ...monthly.map((x) => setRepeat(x.id, { kind: 'monthly' }, x.due!.date)), ...trips.flatMap((x) => trip(x, x.due!.date, isoToday))],
    undo: [...own.map((x) => task(x, isoToday, x.due!.date)), ...monthly.map((x) => ({ kind: 'patch', entity: 'tasks', id: x.id, set: { repeat: 'FREQ=MONTHLY' } }) as NewOp), ...trips.flatMap((x) => trip(x, isoToday, x.due!.date))],
    count: movable.length,
  };
}

/**
 * „Biorę to” (Q35 A, N-133): wspólne zaległe zadanie bez osoby — przypisanie do mnie i termin na dziś; tak jak „Przenieś
 * zaległe” (N-126) zmienia sam dzień, więc godzina zmieniona w tym czasie na drugim telefonie zostaje. `null` — nie dotyczy: zrobione, bez własnego terminu albo nie zaległe, z (żywą) osobą,
 * poza wspólną grupą albo jestem w niej dzieckiem. Zwraca też cofnięcie.
 */
export function takeOps(t: Tables, x: Task, groups: readonly GroupItem[], isoToday: string): { ops: NewOp[]; undo: NewOp[] } | null {
  const g = groups.find((y) => y.id === x.group_id);
  if (!g || g.kind !== 'shared' || g.me.role === 'child' || x.completed_at !== null || x.deadline_mode !== 'own' || x.due_date === null || x.due_date >= isoToday) return null;
  if (livePerson(x.assignee_member_id, liveMembers(t)) !== null) return null;
  const monthly = t.tasks?.[x.id]?.repeat === 'FREQ=MONTHLY';
  return {
    ops: [patchTask(x.id, { assignee_member_id: g.me.member_id }), setDue(x.id, { date: isoToday, time: x.due_time }, { date: x.due_date, time: x.due_time }), ...(monthly ? [setRepeat(x.id, { kind: 'monthly' }, x.due_date)] : [])],
    undo: [patchTask(x.id, { assignee_member_id: x.assignee_member_id }), setDue(x.id, { date: x.due_date, time: x.due_time }, { date: isoToday, time: x.due_time }), ...(monthly ? [{ kind: 'patch', entity: 'tasks', id: x.id, set: { repeat: 'FREQ=MONTHLY' } } as NewOp] : [])],
  };
}
