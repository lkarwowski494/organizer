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
import { planTrip } from './shopping-trip';

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
  // Zakupy: ta sama operacja co planowanie zakupów (osoba bez zmian).
  const trip = (x: MyTask, date: string) => planTrip(x.trip!.listId, { date, time: x.due!.time, responsibleId: x.assignee_member_id });
  return {
    ops: [...own.map((x) => setDue(x.id, { date: isoToday, time: x.due!.time })), ...monthly.map((x) => setRepeat(x.id, { kind: 'monthly' }, x.due!.date)), ...trips.map((x) => trip(x, isoToday))],
    undo: [...own.map((x) => setDue(x.id, { date: x.due!.date, time: x.due!.time })), ...monthly.map((x) => ({ kind: 'patch', entity: 'tasks', id: x.id, set: { repeat: 'FREQ=MONTHLY' } }) as NewOp), ...trips.map((x) => trip(x, x.due!.date))],
    count: movable.length,
  };
}
