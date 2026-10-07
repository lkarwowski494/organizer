/**
 * Zakupy na liście zakupów (D73, decyzja właściciela z 7.10.2026, ADR 0014; migracja 20261008160000_shopping_trip):
 * lista zakupów sama ma termin i osobę odpowiedzialną i trafia do „Dotyczy mnie” jak zadanie „Zakupy: <nazwa>”.
 * Dotyczy mnie na tych samych zasadach co zadanie (concernsMeTask): moja osoba, albo bez osoby z terminem (każdy może
 * zrobić), albo bez osoby w grupie osobistej. We wspólnej grupie osoba albo termin są obowiązkowe (jak D68).
 * Odhaczenie „Zakupy” (ręcznie, z potwierdzeniem): kupione pozycje schodzą do kosza, termin i osoba się czyszczą;
 * niekupione zostają na następne zakupy albo — na życzenie — też są oznaczane jako kupione.
 */
import type { NewOp } from '../sync-engine/client';
import { toggleDone } from './commands';
import { cancelHandoff, handoffKey, outgoingPending } from './handoffs';
import type { GroupItem, TodayItem } from './index';
import { asList, asMember, asTask, type Member, rows, type Tables } from './model';

export type Trip = { date: string | null; time: string | null; responsibleId: string | null };

export function asTrip(r: Record<string, unknown>): Trip {
  const s = (v: unknown) => (v == null ? null : String(v));
  return { date: s(r.due_date), time: s(r.due_time), responsibleId: s(r.responsible_member_id) };
}

/** Czy lista ma zaplanowane zakupy (termin albo osobę). */
export const hasTrip = (x: Trip) => x.date !== null || x.responsibleId !== null;

/** Czy we wspólnej grupie brakuje osoby i terminu (D73 = D68 dla zakupów). */
export const tripLacksAddressee = (groupKind: GroupItem['kind'], x: Pick<Trip, 'date' | 'responsibleId'>) => groupKind === 'shared' && x.date === null && x.responsibleId === null;

/** Pola zakupów przy tworzeniu listy i przy planowaniu. */
export function tripSet(x: Trip) {
  return { due_date: x.date, due_time: x.date === null ? null : x.time, responsible_member_id: x.responsibleId };
}

export const planTrip = (listId: string, x: Trip): NewOp => ({ kind: 'patch', entity: 'lists', id: listId, set: tripSet(x) });

/** Pozycje listy: niekupione i w koszyku. */
export function tripItems(t: Tables, listId: string) {
  const items = rows(t, 'tasks', asTask).filter((x) => x.list_id === listId && x.deleted_at === null && x.parent_id === null);
  return { open: items.filter((x) => x.completed_at === null), inCart: items.filter((x) => x.completed_at !== null) };
}

/**
 * Zakupy zrobione. `all` — niekupione też oznaczam jako kupione; inaczej zostają na następne zakupy.
 * Oczekujące przekazanie zakupów (D70) traci sens, więc je anuluję.
 */
export function finishTripOps(t: Tables, userId: string, listId: string, all: boolean, nowIso: string): NewOp[] {
  const { open, inCart } = tripItems(t, listId);
  const bought = all ? [...inCart, ...open] : inCart;
  const ops: NewOp[] = [];
  if (all) for (const x of open) ops.push(toggleDone(x, nowIso));
  for (const x of bought) ops.push({ kind: 'delete', entity: 'tasks', id: x.id });
  ops.push(planTrip(listId, { date: null, time: null, responsibleId: null }));
  const pending = outgoingPending(t, userId).get(handoffKey('lists', listId, null));
  if (pending) ops.push(cancelHandoff(pending.id));
  return ops;
}

/** Zakupy jako wpis „Dotyczy mnie” (kształt zadania, `trip` = id listy). Tytuł to nazwa listy; ekran dopisuje „Zakupy:”. */
export type TripItem = TodayItem & { trip: { listId: string; open: number } };

/** `everyone` — wszystkie zaplanowane zakupy grup (Kalendarz, D73 + O-053); inaczej tylko dotyczące mnie. */
export function tripEntries(t: Tables, groups: Map<string, GroupItem>, everyone = false): TripItem[] {
  const out: TripItem[] = [];
  for (const [id, raw] of Object.entries(t.lists ?? {})) {
    const l = asList(raw);
    if (l.deleted_at !== null || l.kind !== 'shopping') continue;
    const trip = asTrip(raw);
    const g = groups.get(l.group_id);
    if (!g || !hasTrip(trip)) continue;
    const due = trip.date === null ? null : { date: trip.date, time: trip.time };
    const mine = trip.responsibleId === g.me.member_id;
    if (!everyone && !(mine || (trip.responsibleId === null && (g.kind === 'personal' || due !== null)))) continue;
    out.push({
      id,
      group_id: l.group_id,
      list_id: id,
      parent_id: null,
      title: l.name,
      note: null,
      sort_key: l.sort_key,
      assignee_member_id: trip.responsibleId,
      deadline_mode: due ? 'own' : 'none',
      due_date: trip.date,
      due_time: trip.time,
      start_date: null,
      event_id: null,
      occurrence_date: null,
      rollover: true,
      series_id: null,
      completed_at: null,
      deleted_at: null,
      due,
      line: g.line,
      groupName: g.name,
      listName: l.name,
      assignee: mine ? g.me.display_name : null,
      trip: { listId: id, open: tripItems(t, id).open.length },
    });
  }
  return out;
}

/** Kto może robić zakupy: aktywni dorośli grupy (z kontem albo bez — jak osoba odpowiedzialna za wydarzenie, D66). */
export function tripAdults(t: Tables, groupId: string): Member[] {
  return rows(t, 'group_members', asMember)
    .filter((m) => m.group_id === groupId && m.deleted_at === null && m.role !== 'child')
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'));
}
