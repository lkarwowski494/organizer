/**
 * „Przenieś zaległe na dziś” (D111): moje zaległe z własnym terminem i moje zaległe zakupy (termin listy, D73) dostają
 * termin na dziś (godzina zostaje), więc znika czerwone „zaległe od …”. Moje = przypisane do mnie albo z grupy osobistej
 * (decyzja właściciela z 8.10.2026, audyt 2: wspólne nieprzypisane i zadania dziecka mają termin dla wszystkich, więc
 * zostają). Pomijamy zadania z terminem po rodzicu albo wydarzeniu — tam termin zmienia się u rodzica — i grupy, w których
 * jestem dzieckiem (D34: serwer odrzuci zmianę). Zwraca też operacje cofnięcia (poprzednie terminy) i liczbę
 * przeniesionych spraw (na przycisk i pasek — nie liczbę operacji). D137: powtarzanie co miesiąc zapisane bez dnia
 * miesiąca dostaje dzień z dotychczasowego terminu, więc przeniesienie nie przesuwa cyklu na stałe. Audyt 2: T-11, P-56.
 */
import type { NewOp } from '../sync-engine/client';
import { setRepeat } from './task-repeat';
import { setDue } from './commands';
import type { GroupItem } from './index';
import type { Tables } from './model';
import type { MyTask } from './my-days';
import { changeTrip } from './shopping-trip';

/** `groups` — moje grupy (groupsView): rodzaj grupy i mój wiersz członka. */
export function movableOverdue(tasks: readonly MyTask[], groups: readonly GroupItem[]): MyTask[] {
  return tasks.filter((x) => {
    const g = groups.find((y) => y.id === x.group_id);
    const mine = !!g && g.me.role !== 'child' && (g.kind === 'personal' || x.assignee_member_id === g.me.member_id);
    return mine && x.due !== null && (x.trip !== undefined || x.deadline_mode === 'own');
  });
}

export function moveOverdueOps(tasks: readonly MyTask[], isoToday: string, t: Tables, groups: readonly GroupItem[]): { ops: NewOp[]; undo: NewOp[]; count: number } {
  const movable = movableOverdue(tasks, groups);
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
