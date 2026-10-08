/**
 * Zakupy na liście zakupów (D73, decyzja właściciela z 7.10.2026, ADR 0014; migracja 20261008160000_shopping_trip):
 * lista zakupów sama ma termin i osobę odpowiedzialną i trafia do „Moje sprawy” jak zadanie „Zakupy: <nazwa>”.
 * Moje sprawy na tych samych zasadach co zadanie (concerns.ts): moja osoba, albo bez osoby z terminem (każdy może
 * zrobić), albo bez osoby w grupie osobistej; osoba usunięta z grupy to „nikt konkretny” (D132). We wspólnej grupie
 * osoba albo termin są obowiązkowe (jak D68).
 * Odhaczenie „Zakupy” (ręcznie, z potwierdzeniem): kupione pozycje schodzą do kosza, termin i osoba się czyszczą;
 * niekupione zostają na następne zakupy albo — na życzenie — też są oznaczane jako kupione.
 */
import type { NewOp } from '../sync-engine/client';
import { inverseOps, toggleDone } from './commands';
import { concernsMe, liveMemberIds, ownPrivateList } from './concerns';
import { cancelHandoff, handoffKey, outgoingPending } from './handoffs';
import type { GroupItem, TodayItem } from './index';
import { shoppingSplit } from './list-tree';
import { asList, asMember, asTask, type List, type Member, rows, type Tables } from './model';

export type Trip = { date: string | null; time: string | null; responsibleId: string | null };

export function asTrip(r: Record<string, unknown>): Trip {
  const s = (v: unknown) => (v == null ? null : String(v));
  return { date: s(r.due_date), time: s(r.due_time), responsibleId: s(r.responsible_member_id) };
}

/** Czy lista ma zaplanowane zakupy (termin albo osobę). */
export const hasTrip = (x: Trip) => x.date !== null || x.responsibleId !== null;

/**
 * Czy zakupy potrzebują osoby albo dnia (D73 = D68 dla zakupów): we wspólnej grupie, poza listą „Tylko ja” — ta działa
 * jak grupa osobista (decyzja właściciela z 8.10.2026, audyt 2: PW-18 A).
 */
export const tripRequired = (groupKind: GroupItem['kind'], visibility: List['visibility']) => groupKind === 'shared' && visibility !== 'private';

/** Czy brakuje osoby i terminu, choć są potrzebne (`required` — tripRequired). */
export const tripLacksAddressee = (required: boolean, x: Pick<Trip, 'date' | 'responsibleId'>) => required && x.date === null && x.responsibleId === null;

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

/**
 * „Cofnij” po „Zakupy zrobione” (audyt 2, M-225; D60): pozycje wracają z kosza (i znów są niekupione, jeśli oznaczyłem
 * wszystko), dzień i osoba też. Anulowane przekazanie zostaje anulowane — serwer nie pozwala mu wrócić do „czeka”
 * (handoffs_guard: invalid_value:status). `t` — stan sprzed `ops`.
 */
export function finishTripUndoOps(t: Tables, ops: readonly NewOp[]): NewOp[] {
  // finishTripOps nie zawiera poleceń serwera (cmd), więc odwrotność zawsze istnieje.
  return inverseOps(t, ops.filter((o) => o.kind !== 'patch' || o.entity !== 'handoffs'))!;
}

/** Zakupy jako wpis „Moje sprawy” (kształt zadania, `trip` = id listy). Tytuł to nazwa listy; ekran dopisuje „Zakupy:”. */
export type TripItem = TodayItem & { trip: { listId: string; open: number } };

/**
 * `everyone` — wszystkie zaplanowane zakupy grup (Kalendarz, D73 + O-053); inaczej tylko dotyczące mnie (concernsMe:
 * osoba usunięta z grupy to „nikt konkretny”, D132 — audyt 2, M-22). `open` — „N do kupienia”, ta sama liczba co
 * w nagłówku listy (list-tree.ts, M-83).
 */
export function tripEntries(t: Tables, groups: Map<string, GroupItem>, everyone = false): TripItem[] {
  const out: TripItem[] = [];
  const live = liveMemberIds(t);
  for (const [id, raw] of Object.entries(t.lists ?? {})) {
    const l = asList(raw);
    if (l.deleted_at !== null || l.kind !== 'shopping') continue;
    const trip = asTrip(raw);
    const g = groups.get(l.group_id);
    if (!g || !hasTrip(trip)) continue;
    const due = trip.date === null ? null : { date: trip.date, time: trip.time };
    const mine = trip.responsibleId === g.me.member_id;
    if (!everyone && !concernsMe(trip.responsibleId, g, due, live, ownPrivateList(l, g))) continue;
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
      trip: { listId: id, open: shoppingSplit(t, id).open.length },
    });
  }
  return out;
}

/**
 * Kto może robić zakupy: aktywni dorośli grupy (z kontem albo bez — jak osoba odpowiedzialna za wydarzenie, D66).
 * `canSee` — audyt 2 (R-3): tylko osoby, które widzą listę (lista „Tylko ja” — tylko ja); serwer odrzuca innych
 * (`list_responsible_visible`).
 */
export function tripAdults(t: Tables, groupId: string, canSee: (memberId: string) => boolean = () => true): Member[] {
  return rows(t, 'group_members', asMember)
    .filter((m) => m.group_id === groupId && m.deleted_at === null && m.role !== 'child' && canSee(m.member_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'));
}
