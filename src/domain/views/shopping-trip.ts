/**
 * Zakupy na liście zakupów (D73, decyzja właściciela z 7.10.2026, ADR 0014; migracja 20261008160000_shopping_trip):
 * lista zakupów sama ma termin i osobę odpowiedzialną i trafia do „Moje sprawy” jak zadanie „Zakupy: <nazwa>”.
 * Moje sprawy na tych samych zasadach co zadanie (concerns.ts): moja osoba, albo bez osoby z terminem (każdy może
 * zrobić), albo bez osoby w grupie osobistej; osoba usunięta z grupy to „nikt konkretny” (D132). We wspólnej grupie
 * osoba albo termin są obowiązkowe (jak D68).
 * Odhaczenie „Zakupy” (ręcznie, z potwierdzeniem; także bez planu, gdy coś jest w koszyku — audyt 3, N-7): kupione
 * pozycje schodzą z listy (usunięte, ale nie w Koszu — sekcja „Kupione w ostatnich zakupach”, boughtItems), termin
 * i osoba się czyszczą;
 * niekupione zostają na następne zakupy albo — na życzenie — też są oznaczane jako kupione. Każde zrobione zakupy to
 * wiersz `shopping_trips` (kiedy i na kiedy były, migracja 20261008570000_my_scopes_trips) — Kalendarz pokazuje każde
 * przekreślone w ich dniu, jak zrobione zadania (PWD-11 A, audyt 2 M-280; D135).
 */
import type { NewOp } from '../sync-engine/client';
import { inverseOps, toggleDone } from './commands';
import { concernsMe, liveMembers, ownPrivateList } from './concerns';
import { cancelHandoff, handoffKey, outgoingPending } from './handoffs';
import type { GroupItem, TodayItem } from './index';
import { shoppingSplit } from './list-tree';
import { type ScopeOf, scopeAll } from './my-scope';
import { asList, asMember, asTask, type List, type Member, rows, type Tables, type Task } from './model';
import { itemKey } from './shopping';

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
export function finishTripOps(t: Tables, userId: string, listId: string, all: boolean, nowIso: string, newId: () => string): NewOp[] {
  const { open, inCart } = tripItems(t, listId);
  const bought = all ? [...inCart, ...open] : inCart;
  const ops: NewOp[] = [];
  if (all) for (const x of open) ops.push(toggleDone(x, nowIso));
  for (const x of bought) ops.push({ kind: 'delete', entity: 'tasks', id: x.id });
  const list = t.lists![listId]!;
  // Zakupy bez planu (audyt 3, N-7: „Zakupy zrobione” przy samym koszyku) — nie ma czego czyścić.
  if (hasTrip(asTrip(list))) ops.push(planTrip(listId, { date: null, time: null, responsibleId: null }));
  ops.push({ kind: 'create', entity: 'shopping_trips', id: newId(), group_id: String(list.group_id), set: { list_id: listId, planned_date: asTrip(list).date, done_at: nowIso } });
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
 * `everyone` — wszystkie zaplanowane zakupy grup (Kalendarz, D73 + O-053); inaczej tylko dotyczące mnie w zakresie grupy
 * (`scopeOf`, PW-2; concernsMe:
 * osoba usunięta z grupy to „nikt konkretny”, D132 — audyt 2, M-22). `open` — „N do kupienia”, ta sama liczba co
 * w nagłówku listy (list-tree.ts, M-83).
 */
export function tripEntries(t: Tables, groups: Map<string, GroupItem>, everyone = false, scopeOf: ScopeOf = scopeAll): TripItem[] {
  const out: TripItem[] = [];
  const live = liveMembers(t);
  for (const [id, raw] of Object.entries(t.lists ?? {})) {
    const l = asList(raw);
    if (l.deleted_at !== null || l.kind !== 'shopping') continue;
    const trip = asTrip(raw);
    const g = groups.get(l.group_id);
    if (!g || !hasTrip(trip)) continue;
    const due = trip.date === null ? null : { date: trip.date, time: trip.time };
    // Decyzja właściciela (audyt 3: Q6c A, N-177): dziecko z kontem widzi zakupy grupy w Kalendarzu (`everyone`, D155),
    // ale nie w Moich sprawach, przypomnieniach ani podsumowaniu — zakupy robi dorosły (tripAdults), nie ono.
    if (!everyone && g.me.role === 'child') continue;
    if (!everyone && !concernsMe(trip.responsibleId, g, due, live, ownPrivateList(l, g), scopeOf(g.id))) continue;
    out.push(tripItem(t, id, l, g, trip));
  }
  return out;
}

/** Wpis zakupów listy `l` (kształt zadania, D73). */
function tripItem(t: Tables, id: string, l: List, g: GroupItem, trip: Trip): TripItem {
  const due = trip.date === null ? null : { date: trip.date, time: trip.time };
  const mine = trip.responsibleId === g.me.member_id;
  return {
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
  };
}

/**
 * Zrobione zakupy w Kalendarzu: wpis w kształcie zakupów listy, `id` — wiersz zakupów (kilka zakupów jednej listy
 * w jednym dniu ma osobne wiersze), lista w `trip.listId`; `completed_at` — chwila zrobienia.
 */
export type DoneTrip = TripItem & { completed_at: string };

/**
 * Zrobione zakupy list moich grup (PWD-11 A): każde w dniu planu, a zakupy bez dnia — w dniu zrobienia (`localDate`
 * zamienia chwilę na dzień w Warszawie). Cofnięte (usunięte) i z usuniętej listy — nie. Serwer trzyma je
 * config.retention.TRIP_DAYS dni.
 */
export function doneTrips(t: Tables, groups: Map<string, GroupItem>, localDate: (iso: string) => string): DoneTrip[] {
  const out: DoneTrip[] = [];
  for (const raw of Object.values(t.shopping_trips ?? {})) {
    const lr = t.lists?.[String(raw.list_id)];
    const l = lr ? asList(lr) : null;
    const g = l ? groups.get(l.group_id) : undefined;
    if (raw.deleted_at != null || !l || !g || l.deleted_at !== null) continue;
    const at = String(raw.done_at);
    const date = raw.planned_date == null ? localDate(at) : String(raw.planned_date);
    out.push({ ...tripItem(t, l.id, l, g, { date, time: null, responsibleId: null }), id: String(raw.id), completed_at: at });
  }
  return out.sort((a, b) => a.completed_at.localeCompare(b.completed_at) || a.id.localeCompare(b.id));
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

/** Kupiona pozycja z poprzednich zakupów (boughtItems). */
export type Bought = { id: string; title: string };

/**
 * „Kupione w ostatnich zakupach” (decyzja właściciela, audyt 3: Q9 B, N-49): pozycje listy usunięte jako kupione
 * (w koszyku w chwili usunięcia — „Zakupy zrobione” albo usunięcie z koszyka), których telefon jeszcze nie wyczyścił
 * (config.sync.TOMBSTONE_DAYS). Jeden wiersz na produkt (itemKey), najnowsze pierwsze; bez produktów, które już są na
 * liście (czekają albo w koszyku). Usunięcie niewysłane („pending:N”, applyOp) jest najnowsze. Kosz ich nie pokazuje.
 */
export function boughtItems(t: Tables, listId: string): Bought[] {
  const all = rows(t, 'tasks', asTask).filter((x) => x.list_id === listId && x.parent_id === null);
  const onList = new Set(all.filter((x) => x.deleted_at === null).map((x) => itemKey(x.title)));
  const when = (x: Task) => (x.deleted_at!.startsWith('pending:') ? Infinity : Date.parse(x.deleted_at!));
  const bought = all.filter((x) => x.deleted_at !== null && x.completed_at !== null).sort((a, b) => when(b) - when(a) || a.title.localeCompare(b.title, 'pl'));
  const seen = new Set<string>();
  const out: Bought[] = [];
  for (const x of bought) {
    const k = itemKey(x.title);
    if (onList.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ id: x.id, title: x.title });
  }
  return out;
}

/** „Kup jeszcze raz”: pozycja wraca na listę jako niekupiona (przywrócenie i zdjęcie z koszyka, jedna transakcja). */
export const buyAgainOps = (id: string): NewOp[] => [
  { kind: 'restore', entity: 'tasks', id },
  { kind: 'patch', entity: 'tasks', id, set: { completed_at: null } },
];
