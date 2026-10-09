/**
 * Model reguł serwera dla operacji z telefonu (audyt 2, M-50): czy `sync_push` przyjmie operację, a jeśli nie —
 * z jakim kodem. Przeniesione z ostatnich definicji w supabase/migrations: private.apply_op (kolumny z
 * private.sync_entities, powtórzone utworzenie, wiersz niewidoczny / usunięty), polityki RLS (widoczność list,
 * przekazań, uprawnienia zmiany grupy) i strażnicy wierszy (tasks_guard, lists_guard, events_guard, event_rsvps_guard,
 * event_task_series_guard, group_members_guard, handoffs_guard, object_members_guard, list_responsible_guard,
 * event_responsible_guard, tasks_event_guard, tasks_moved_guard, groups_stamp, my_day_scopes_guard, shopping_trips_guard) oraz kosz grup
 * (bump_group_version: deleted:group).
 * Kolejność sprawdzeń jak w SQL: kolumny, widoczność, strażnicy w kolejności nazw wyzwalaczy, licznik wersji grupy.
 *
 * Używają go atrapy serwera — testy ekranów (src/app/__tests__/harness.tsx: odrzucenie oblewa test, chyba że test je
 * zapowie) i tryb E2E (src/app/e2e.ts) — żeby operacja, którą serwer odrzuci, nie była w testach „sukcesem”.
 * Zgodność z prawdziwym SQL: tests/db/rules-vs-sql.test.ts (losowe operacje wszystkich ról na tych samych danych
 * w modelu i w Postgresie, kolumny = private.sync_entities).
 *
 * `applyOnServer` — skutek przyjętej operacji po stronie serwera: wartości domyślne kolumn (config.sync.PATCH_DEFAULTS),
 * pola nadawane przez serwer (twórca listy, nadawca i stan przekazania), kaskady usunięcia (applyOp telefonu, ten sam
 * algorytm co tasks_cascade / lists_cascade) i przyjęcie przekazania (handoffs_guard: nowa osoba przy zadaniu, liście
 * zakupów albo wydarzeniu, przy jednym terminie — wyjątek).
 *
 * Polecenia przeniesienia zadania do innej grupy (move_task_to_group, unmove_task — audyt 3, N-12) model sprawdza
 * krokami z task-move-cmd.ts, jak serwer: pierwsze odrzucenie odrzuca całość.
 * Poza modelem (zwraca null — „przyjęte”): pozostałe polecenia (`cmd`: przeniesienie zadania w grupie, udostępnienia, stałe
 * zakupy, podział serii), identyfikatory pochodne poza zakresem Moich spraw (invalid_id — ich generatory testuje tests/db), limity (limit:*), głębokość podzadań,
 * przyjęcie przekazania nieaktualnego (stale), wygasłe przywrócenie członka (deleted:expired) i przekazania wydarzeń.
 */
import { config } from '../config';
import { applyOp, type NewOp, type Op, type Row } from './sync-engine/client';
import { type MoveArgs, moveCmdSteps, type MoveStep } from './task-move-cmd';
import { overrideId } from './views/events';
import { nextId } from './views/task-repeat';
import { scopeRowId } from './views/my-scope';

export type ServerTables = { readonly [entity: string]: { readonly [key: string]: Row } | undefined };

type Spec = { readonly pk: string; readonly insert: readonly string[]; readonly patch: readonly string[]; readonly softDelete: boolean };

/** private.sync_entities (kontrakt z bazą: tests/db/rules-vs-sql.test.ts). */
export const SYNC_ENTITIES: { readonly [entity: string]: Spec } = {
  groups: { pk: 'id', insert: [], patch: ['name', 'color'], softDelete: false },
  group_members: { pk: 'member_id', insert: ['member_id', 'group_id', 'display_name', 'color', 'role'], patch: ['display_name', 'color', 'role', 'week_a'], softDelete: true },
  lists: { pk: 'id', insert: ['id', 'group_id', 'kind', 'name', 'visibility', 'sort_key', 'due_date', 'due_time', 'responsible_member_id', 'staples'], patch: ['name', 'visibility', 'sort_key', 'due_date', 'due_time', 'responsible_member_id', 'staples'], softDelete: true },
  tasks: {
    pk: 'id',
    insert: ['id', 'group_id', 'list_id', 'parent_id', 'title', 'note', 'sort_key', 'assignee_member_id', 'deadline_mode', 'due_date', 'due_time', 'start_date', 'completed_at', 'event_id', 'occurrence_date', 'rollover', 'series_id', 'repeat', 'category', 'cycle_date'],
    patch: ['title', 'note', 'sort_key', 'assignee_member_id', 'deadline_mode', 'due_date', 'due_time', 'start_date', 'completed_at', 'event_id', 'occurrence_date', 'rollover', 'repeat', 'category', 'cycle_date'],
    softDelete: true,
  },
  events: { pk: 'id', insert: ['id', 'group_id', 'title', 'note', 'start_date', 'start_time', 'end_time', 'rrule', 'audience', 'responsible_member_id', 'location', 'kind', 'days', 'duration_min'], patch: ['title', 'note', 'start_date', 'start_time', 'end_time', 'rrule', 'audience', 'responsible_member_id', 'location', 'days', 'duration_min'], softDelete: true },
  event_participants: { pk: 'id', insert: ['id', 'event_id', 'member_id', 'group_id'], patch: [], softDelete: true },
  event_overrides: { pk: 'id', insert: ['id', 'event_id', 'group_id', 'occurrence_date', 'cancelled', 'start_date', 'start_time', 'end_time', 'title', 'responsible_member_id', 'all_day', 'responsible_cleared', 'days', 'duration_min'], patch: ['cancelled', 'start_date', 'start_time', 'end_time', 'title', 'responsible_member_id', 'all_day', 'responsible_cleared', 'days', 'duration_min'], softDelete: true },
  event_rsvps: { pk: 'id', insert: ['id', 'group_id', 'event_id', 'occurrence_date', 'member_id', 'answer'], patch: ['answer'], softDelete: true },
  event_task_series: { pk: 'id', insert: ['id', 'group_id', 'event_id', 'list_id', 'title'], patch: ['event_id', 'title'], softDelete: true },
  handoffs: { pk: 'id', insert: ['id', 'group_id', 'entity', 'entity_id', 'occurrence_date', 'to_member'], patch: ['status', 'closed'], softDelete: false },
  my_day_scopes: { pk: 'id', insert: ['id', 'group_id', 'member_id', 'scope'], patch: ['scope'], softDelete: true },
  shopping_trips: { pk: 'id', insert: ['id', 'group_id', 'list_id', 'planned_date', 'done_at'], patch: [], softDelete: true },
};

class Rejected extends Error {}
const reject = (code: string): never => {
  throw new Rejected(code);
};

const rowsOf = (t: ServerTables, e: string): Row[] => Object.values(t[e] ?? {});
const live = (r: Row | undefined): r is Row => !!r && r.deleted_at == null;
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Kolejność kluczy jsonb w Postgresie (krótsze najpierw, potem bajtowo) — który zbędny klucz zgłosi `limit 1`. */
function jsonbKeys(o: Row): string[] {
  return Object.keys(o).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)); // klucze obiektu są różne
}

type Me = { member_id: string; role: string; group: string };

function member(t: ServerTables, group: string, user: string): Me | null {
  const m = rowsOf(t, 'group_members').find((r) => r.group_id === group && r.user_id === user && r.deleted_at == null);
  return m ? { member_id: String(m.member_id), role: String(m.role), group } : null;
}

function memberCanSeeList(t: ServerTables, memberId: unknown, l: Row): boolean {
  const m = t.group_members?.[String(memberId)];
  if (!live(m) || m.group_id !== l.group_id) return false;
  if (l.visibility === 'group' || l.owner_member_id === memberId) return true;
  return l.visibility === 'restricted' && rowsOf(t, 'object_members').some((o) => o.scope_entity === 'lists' && o.scope_id === l.id && o.member_id === memberId && o.deleted_at == null);
}

/** Lista istnieje (klucz obcy zadań, serii i udostępnień); brak w danych to błąd danych, nie odrzucenie. */
function canSeeList(t: ServerTables, user: string, listId: unknown): boolean {
  const l = t.lists![String(listId)]!;
  const me = member(t, String(l.group_id), user);
  return !!me && memberCanSeeList(t, me.member_id, l);
}

/** Polityka SELECT (RLS) — wiersz, którego nie widzę, jest dla mnie „nie ma”. */
function canSee(t: ServerTables, user: string, entity: string, row: Row): boolean {
  if (entity === 'groups') return !!member(t, String(row.id), user);
  if (entity === 'lists') return canSeeList(t, user, row.id);
  if (entity === 'tasks' || entity === 'event_task_series' || entity === 'shopping_trips') return canSeeList(t, user, row.list_id);
  const me = member(t, String(row.group_id), user);
  if (entity === 'my_day_scopes') return !!me && row.member_id === me.member_id;
  if (entity === 'handoffs') return !!me && (row.from_member === me.member_id || row.to_member === me.member_id);
  return !!me;
}

/** Polityka UPDATE (RLS) poza SELECT: grupę zmienia owner albo admin. */
function canUpdate(t: ServerTables, user: string, entity: string, row: Row): boolean {
  if (entity !== 'groups') return true;
  const role = member(t, String(row.id), user)?.role;
  return role === 'owner' || role === 'admin';
}

function eventOf(t: ServerTables, id: unknown): Row | undefined {
  return t.events?.[String(id)];
}

function responsibleGuard(t: ServerTables, row: Row, old: Row | null) {
  if (row.responsible_member_id == null || (old && same(row.responsible_member_id, old.responsible_member_id))) return;
  const m = t.group_members?.[String(row.responsible_member_id)];
  if (!live(m) || m.group_id !== row.group_id || m.role === 'child') reject('invalid_member');
}

function tasksGuard(t: ServerTables, me: Me | null, row: Row, old: Row | null) {
  if (!me) reject('forbidden');
  const m = me!;
  if (old) {
    const changed = Object.keys({ ...row, ...old }).filter((k) => k !== 'completed_at' && k !== 'completed_by' && k !== 'version' && !same(row[k], old[k]));
    if (m.role === 'child' && changed.length > 0 && !childRepeatUpdateOk(t, changed, old, m.member_id)) reject('forbidden:child');
    if (m.role === 'child' && !same(row.completed_at, old.completed_at) && !childOwnsTask(t, String(old.id), m.member_id)) reject('forbidden:not_own');
    if (old.deleted_at != null && row.deleted_at == null && row.parent_id != null && t.tasks?.[String(row.parent_id)]?.deleted_at != null) reject('deleted:parent');
  }
  const l = t.lists?.[String(row.list_id)];
  // D34 z wyjątkiem Q6d A (audyt 3, 20261010120000): dziecko dopisuje tylko produkt — pozycję główną listy zakupów.
  if (!old && m.role === 'child' && !(l?.kind === 'shopping' && childItem(row)) && !childRepeatInsertOk(t, row, m.member_id)) reject('forbidden:child');
  if (!l || l.group_id !== row.group_id) return reject('invalid_list');
  if (l.deleted_at != null && row.deleted_at == null) reject('deleted:list');
  if (!memberCanSeeList(t, m.member_id, l)) reject('forbidden');
  if (!old && row.parent_id != null) {
    const p = t.tasks?.[String(row.parent_id)];
    if (!p || p.list_id !== row.list_id) reject('invalid_parent');
    if (p!.deleted_at != null) reject('deleted:parent');
  }
  const assigneeChanged = !old || !same(row.assignee_member_id, old.assignee_member_id);
  if (assigneeChanged && row.assignee_member_id != null && !memberCanSeeList(t, row.assignee_member_id, l)) reject('invalid_assignee');
}

/** Pozycja dopisana przez dziecko: bez osoby, terminu, wydarzenia, serii, powtarzania, notatki i odhaczenia. */
const CHILD_ITEM_EMPTY = ['parent_id', 'assignee_member_id', 'due_date', 'due_time', 'start_date', 'completed_at', 'event_id', 'occurrence_date', 'series_id', 'repeat', 'note'];
const childItem = (row: Row) => (row.deadline_mode ?? 'none') === 'none' && CHILD_ITEM_EMPTY.every((k) => row[k] == null);

/** private.repeat_source (20261010070000): poprzednie zadanie łańcucha, którego następnym terminem jest wiersz `id`. */
function repeatSource(t: ServerTables, id: string, list: unknown, parent: unknown): Row | undefined {
  const tasks = rowsOf(t, 'tasks');
  if (parent == null) return tasks.find((x) => x.list_id === list && x.parent_id == null && x.repeat != null && x.id !== id && nextId(String(x.id)) === id);
  const sp = t.tasks?.[String(parent)] && repeatSource(t, String(parent), list, t.tasks[String(parent)]!.parent_id);
  return sp ? tasks.find((x) => x.parent_id === sp.id && nextId(String(x.id)) === id) : undefined;
}

/** private.child_repeat_copy: zadanie główne `r` jest następnym terminem sprawy dziecka `me` — poprzednie albo nic. */
function childRepeatCopy(t: ServerTables, r: Row, me: string): Row | undefined {
  if (r.parent_id != null) return undefined;
  const src = repeatSource(t, String(r.id), r.list_id, null);
  return src && childOwnsTask(t, String(src.id), me) ? src : undefined;
}

/** private.task_root: zadanie główne nad wierszem (najwyżej 8 kroków). */
function taskRoot(t: ServerTables, r: Row): Row | undefined {
  let cur: Row | undefined = r;
  for (let step = 0; cur && cur.parent_id != null && step < 8; step++) cur = t.tasks?.[String(cur.parent_id)];
  return cur;
}

/** private.child_repeat_insert_ok (Q16 A, audyt 3: N-123): dziecko zakłada następny termin swojej sprawy jak copyOps. */
function childRepeatInsertOk(t: ServerTables, r: Row, me: string): boolean {
  let s: Row | undefined;
  if (r.parent_id == null) s = childRepeatCopy(t, r, me);
  else {
    const root = taskRoot(t, t.tasks?.[String(r.parent_id)] ?? {});
    if (!root?.id || !childRepeatCopy(t, root, me)) return false;
    s = repeatSource(t, String(r.id), r.list_id, r.parent_id);
  }
  if (!s) return false;
  const mode = r.deadline_mode ?? 'none';
  return (
    same(r.title, s.title) && same(r.note, s.note) && (r.sort_key ?? 'a0') === (s.sort_key ?? 'a0') && (r.assignee_member_id == null || r.assignee_member_id === s.assignee_member_id) &&
    (r.rollover ?? true) === (s.rollover ?? true) && ['start_date', 'completed_at', 'event_id', 'occurrence_date', 'series_id', 'category', 'cycle_date'].every((k) => r[k] == null) &&
    (r.parent_id == null ? mode === 'own' && r.due_date != null && same(r.due_time, s.due_time) && r.repeat != null : r.repeat == null && mode !== 'event' && (r.due_time == null || r.due_time === s.due_time))
  );
}

/** private.child_repeat_update_ok: zdjęcie i przywrócenie następnego (z podzadaniami), jego termin — nietkniętego. */
function childRepeatUpdateOk(t: ServerTables, changed: string[], o: Row, me: string): boolean {
  const allowed = o.parent_id == null ? ['deleted_at', 'due_date', 'due_time', 'cycle_date'] : ['deleted_at'];
  if (!changed.every((k) => allowed.includes(k)) || (o.parent_id == null && o.completed_at != null)) return false;
  const root = taskRoot(t, o);
  return !!root && !!childRepeatCopy(t, root, me);
}

function tasksEventGuard(t: ServerTables, row: Row, old: Row | null) {
  // Seria tylko przy utworzeniu (series_id nie ma wśród kolumn do zmiany).
  if (!old && row.series_id != null) {
    const s = t.event_task_series?.[String(row.series_id)];
    if (!s || s.group_id !== row.group_id) reject('invalid_series');
  }
  if (row.event_id == null || (old && same(row.event_id, old.event_id))) return;
  const e = eventOf(t, row.event_id);
  if (!e || e.group_id !== row.group_id) reject('invalid_event');
  if (e!.deleted_at != null) reject('deleted:event');
}

/** private.child_owns_task: swoje = przypisane do dziecka, zadanie przy wydarzeniu dziecka, zakupy dziecka (po rodzicach). */
/** tasks_a_guard_moved (audyt 3, N-131): przeniesione nie wraca z kosza, dopóki żyje kopia. */
function tasksMovedGuard(t: ServerTables, row: Row, old: Row | null) {
  if (old && old.deleted_at != null && row.deleted_at == null && old.moved_to != null && live(t.tasks?.[String(old.moved_to)])) reject('moved');
}

function childOwnsTask(t: ServerTables, id: string, me: string): boolean {
  let cur = t.tasks?.[id];
  for (let step = 0; cur && step < 8; step++) {
    const who = t.group_members?.[String(cur.assignee_member_id)];
    if (cur.assignee_member_id != null && live(who)) return who.member_id === me;
    if (cur.event_id != null) {
      const e = eventOf(t, cur.event_id);
      if (!live(e)) return false;
      const o = rowsOf(t, 'event_overrides').find((x) => x.event_id === e.id && x.occurrence_date === cur!.occurrence_date && x.deleted_at == null);
      let resp = o?.responsible_member_id ?? (o?.responsible_cleared ? null : e.responsible_member_id) ?? null;
      if (resp != null && !live(t.group_members?.[String(resp)])) resp = null;
      const joined = rowsOf(t, 'event_participants').some((p) => p.event_id === e.id && p.member_id === me && p.deleted_at == null);
      if (resp == null) return e.audience === 'group' || joined;
      return resp === me || (e.audience === 'members' && joined);
    }
    if (cur.parent_id == null) {
      const l = t.lists?.[String(cur.list_id)];
      return !!l && l.kind === 'shopping' && l.responsible_member_id === me;
    }
    cur = t.tasks?.[String(cur.parent_id)];
  }
  return false;
}

function listsGuard(me: Me | null, row: Row, old: Row | null) {
  if (!me) reject('forbidden');
  if (me!.role === 'child') reject('forbidden:child');
  if (old && !same(row.visibility, old.visibility) && old.owner_member_id !== me!.member_id) reject('forbidden:not_list_owner');
}

function eventsGuard(t: ServerTables, entity: string, me: Me | null, row: Row, old: Row | null) {
  if (!me) reject('forbidden');
  if (me!.role === 'child') reject('forbidden:child');
  if (entity === 'events') return;
  if (!eventOf(t, row.event_id) || eventOf(t, row.event_id)!.group_id !== row.group_id) reject('invalid_event');
  const removing = !!old && old.deleted_at == null && row.deleted_at != null;
  if (entity === 'event_participants' && !removing) {
    const m = t.group_members?.[String(row.member_id)];
    if (!live(m) || m.group_id !== row.group_id) reject('invalid_member');
  }
}

function rsvpGuard(t: ServerTables, me: Me | null, row: Row) {
  if (!me) reject('forbidden');
  const e = eventOf(t, row.event_id);
  if (!live(e) || e.group_id !== row.group_id) reject('invalid_event');
  const target = t.group_members?.[String(row.member_id)];
  if (!live(target) || target.group_id !== row.group_id) return reject('invalid_member');
  if (target.member_id !== me!.member_id && !(target.user_id == null && target.role === 'child' && me!.role !== 'child')) reject('forbidden:not_self');
}

function seriesGuard(t: ServerTables, me: Me | null, row: Row, old: Row | null) {
  if (!me) reject('forbidden');
  if (me!.role === 'child') reject('forbidden:child');
  if (!eventOf(t, row.event_id) || eventOf(t, row.event_id)!.group_id !== row.group_id) reject('invalid_event');
  const l = t.lists?.[String(row.list_id)];
  if (!l || l.group_id !== row.group_id) return reject('invalid_list');
  if (l.kind !== 'tasks') reject('invalid_list:kind');
  // event_task_series_parent_guard
  if (row.deleted_at != null) return;
  if ((!old || old.deleted_at != null) && l.deleted_at != null) reject('deleted:list');
  if ((!old || old.deleted_at != null || !same(row.event_id, old.event_id)) && eventOf(t, row.event_id)?.deleted_at != null) reject('deleted:event');
}

function occurrenceResponsible(t: ServerTables, e: Row, d: unknown): unknown {
  const o = d == null ? undefined : rowsOf(t, 'event_overrides').find((x) => x.event_id === e.id && x.occurrence_date === d && x.deleted_at == null);
  if (!o) return e.responsible_member_id;
  return o.responsible_member_id ?? (o.responsible_cleared ? null : e.responsible_member_id);
}

function handoffsGuard(t: ServerTables, me: Me | null, row: Row, old: Row | null) {
  if (!me) reject('forbidden');
  const m = me!;
  if (m.role === 'child') reject('forbidden:child');
  if (!old) {
    if (row.to_member === m.member_id) reject('invalid_member');
    const to = t.group_members?.[String(row.to_member)];
    if (!live(to) || to.group_id !== row.group_id || to.role === 'child' || to.user_id == null) reject('invalid_member');
    if (row.entity === 'tasks') {
      const x = t.tasks?.[String(row.entity_id)];
      if (!live(x) || x.group_id !== row.group_id) reject('invalid_entity');
      if (x!.assignee_member_id !== m.member_id) reject('forbidden:not_responsible');
      if (!memberCanSeeList(t, row.to_member, t.lists![String(x!.list_id)]!)) reject('invalid_member');
    } else if (row.entity === 'lists') {
      const l = t.lists?.[String(row.entity_id)];
      if (!live(l) || l.group_id !== row.group_id || l.kind !== 'shopping') reject('invalid_entity');
      if (l!.responsible_member_id !== m.member_id) reject('forbidden:not_responsible');
      if (!memberCanSeeList(t, row.to_member, l!)) reject('invalid_member');
    } else {
      const e = eventOf(t, row.entity_id);
      if (!live(e) || e.group_id !== row.group_id) reject('invalid_entity');
      if (occurrenceResponsible(t, e!, row.occurrence_date) !== m.member_id) reject('forbidden:not_responsible');
    }
    return;
  }
  if (!same(row.closed, old.closed) && m.member_id !== old.from_member) reject('forbidden');
  if (same(row.status, old.status)) return;
  if (old.status !== 'pending') reject('invalid_value:status');
  if ((row.status === 'accepted' || row.status === 'declined') && m.member_id !== old.to_member) reject('forbidden');
  if (row.status === 'cancelled' && m.member_id !== old.from_member) reject('forbidden');
}

function groupMembersGuard(me: Me | null, user: string, row: Row, old: Row | null) {
  const actor = me?.role ?? '';
  if (!old) {
    if (actor !== 'owner' && actor !== 'admin') reject('forbidden');
    // user_id nie jest kolumną do wstawienia (forbidden:user_requires_invite — tylko zaproszeniem).
    if (row.role !== 'child') reject('forbidden:role');
    return;
  }
  const self = old.user_id != null && old.user_id === user;
  if (!same(row.role, old.role) || !same(row.deleted_at, old.deleted_at)) {
    if (self && old.deleted_at == null && row.deleted_at != null && same(row.role, old.role) && old.role !== 'owner') {
      if (old.role === 'child') reject('forbidden:child');
    } else if (actor === 'owner') {
      if (old.role === 'owner' && old.user_id === user) reject('forbidden:owner_cannot_demote_self');
      if (row.role === 'owner') reject('forbidden:role');
    } else if (actor === 'admin') {
      if (!same(row.role, old.role) || old.role === 'owner' || old.role === 'admin') reject('forbidden:role');
    } else reject('forbidden:role');
  }
  if (!same(row.role, old.role) && row.user_id == null && row.role !== 'child') reject('forbidden:role');
  const named = !same(row.display_name, old.display_name) || !same(row.color, old.color);
  if (named && !self && actor !== 'owner' && !(actor === 'admin' && old.user_id == null)) reject('forbidden');
  // group_members_child_link (20261010120000, Q6b A): na dziecko tylko konto połączone kiedyś z profilem dziecka.
  if (row.role === 'child' && old.role !== 'child' && row.user_id != null && old.child_linked_at == null) reject('forbidden:role');
  // group_members_week_a_guard (BEFORE UPDATE OF week_a … WHEN zmiana): tydzień A ustawia dorosły.
  if (!same(row.week_a, old.week_a) && (actor === '' || actor === 'child')) reject('forbidden');
}

/** my_day_scopes_guard (20261008570000_my_scopes_trips.sql): tylko własne członkostwo; id z member_id (UUIDv5). */
function myScopesGuard(me: Me | null, row: Row, old: Row | null) {
  if (row.member_id !== me?.member_id) reject('forbidden:not_self');
  if (!old && row.id !== scopeRowId(String(row.member_id))) reject('invalid_id');
}

/** shopping_trips_guard: członek, nie dziecko; przy utworzeniu — żywa lista zakupów tej grupy. */
function tripsGuard(t: ServerTables, me: Me | null, row: Row, old: Row | null) {
  if (!me) reject('forbidden');
  if (me!.role === 'child') reject('forbidden:child');
  if (old) return;
  const l = t.lists?.[String(row.list_id)];
  if (!l || l.group_id !== row.group_id || l.kind !== 'shopping' || l.deleted_at != null) reject('invalid_list');
}

function groupsGuard(me: Me | null, row: Row, old: Row) {
  if (!same(row.color, old.color) && me?.role !== 'owner') reject('forbidden:role');
}

/** Strażnicy wiersza w kolejności nazw wyzwalaczy (BEFORE, alfabetycznie) — pierwszy błąd wygrywa. */
function guards(t: ServerTables, user: string, entity: string, row: Row, old: Row | null) {
  const group = String(entity === 'groups' ? row.id : row.group_id);
  const me = member(t, group, user);
  switch (entity) {
    case 'tasks':
      tasksGuard(t, me, row, old);
      tasksEventGuard(t, row, old);
      return tasksMovedGuard(t, row, old);
    case 'lists':
      listsGuard(me, row, old);
      return responsibleGuard(t, row, old);
    case 'events':
    case 'event_overrides':
      eventsGuard(t, entity, me, row, old);
      return responsibleGuard(t, row, old);
    case 'event_participants':
      return eventsGuard(t, entity, me, row, old);
    case 'event_rsvps':
      return rsvpGuard(t, me, row);
    case 'event_task_series':
      return seriesGuard(t, me, row, old);
    case 'handoffs':
      return handoffsGuard(t, me, row, old);
    case 'group_members':
      return groupMembersGuard(me, user, row, old);
    case 'my_day_scopes':
      return myScopesGuard(me, row, old);
    case 'shopping_trips':
      return tripsGuard(t, me, row, old);
    default:
      return groupsGuard(me, row, old!);
  }
}

/**
 * RLS przy wstawieniu (WITH CHECK). Członkostwo (wszystkie tabele), rolę przy członkach i widoczną listę zadania
 * sprawdzają już strażnicy; zostaje widoczna lista serii zadań przy wydarzeniu (event_task_series_guard jej nie sprawdza).
 */
function insertAllowed(t: ServerTables, user: string, entity: string, row: Row): boolean {
  // Zakres: własne członkostwo sprawdził już strażnik (forbidden:not_self).
  return (entity !== 'event_task_series' && entity !== 'shopping_trips') || canSeeList(t, user, row.list_id);
}

function trashed(t: ServerTables, group: unknown) {
  if (t.groups?.[String(group)]?.deleted_at != null) reject('deleted:group');
}

/**
 * Długości tekstów (audyt 3, N-134): CHECK char_length(…) w SQL (23514 → invalid:23514) — liczba znaków (code points),
 * nie jednostek UTF-16. [najmniej, najwięcej]; null w kolumnie dopuszczającej null przechodzi. Źródła: migracje
 * 20261006120000_core, 20261006120100_lists_tasks, 20261008100000_events, 20261008130000_event_task_series,
 * 20261008260000_event_location (kontrakt liczb z config: tests/db/config-sql.test.ts).
 */
const L = config.lengths;
const LENGTHS: { readonly [entity: string]: { readonly [col: string]: readonly [number, number] } } = {
  groups: { name: [1, L.GROUP_NAME] },
  group_members: { display_name: [1, config.profile.NAME_MAX_LENGTH] },
  lists: { name: [1, L.LIST_NAME] },
  tasks: { title: [1, L.TASK_TITLE], note: [0, L.NOTE] },
  events: { title: [1, L.EVENT_TITLE], note: [0, L.NOTE], location: [1, config.events.LOCATION_MAX_LENGTH] },
  event_overrides: { title: [1, L.EVENT_TITLE] },
  event_task_series: { title: [1, L.TASK_TITLE] },
};

function lengths(entity: string, row: Row) {
  for (const [col, [min, max]] of Object.entries(LENGTHS[entity] ?? {})) {
    const v = row[col];
    if (typeof v === 'string' && ([...v].length < min || [...v].length > max)) reject('invalid:23514');
  }
}

/** Indeksy unikalne (23505 → invalid:23505): jeden wyjątek na dzień, jeden udział i jedna odpowiedź osoby, jedno oczekujące przekazanie. */
const UNIQUE: { readonly [entity: string]: readonly string[] } = {
  event_overrides: ['event_id', 'occurrence_date'],
  event_participants: ['event_id', 'member_id'],
  event_rsvps: ['event_id', 'occurrence_date', 'member_id'],
  handoffs: ['entity', 'entity_id', 'occurrence_date'],
};
function unique(t: ServerTables, entity: string, row: Row) {
  const cols = UNIQUE[entity];
  if (!cols) return;
  const clash = rowsOf(t, entity).some((r) => (entity !== 'handoffs' || r.status === 'pending') && cols.every((c) => same(r[c], row[c])));
  if (clash) reject('invalid:23505');
}

/** Wyzwalacze AFTER (po liczniku wersji): osoba od zakupów musi widzieć listę (list_responsible_visible). */
function afterGuards(t: ServerTables, entity: string, row: Row, old: Row | null) {
  if (entity !== 'lists' || row.responsible_member_id == null) return;
  if (old && same(row.responsible_member_id, old.responsible_member_id) && same(row.visibility, old.visibility)) return;
  if (!memberCanSeeList(t, row.responsible_member_id, row)) reject('invalid_member');
}

/** Tabele widziane przez `user` (RLS) — polecenie przeniesienia widzi tylko zadania z list, które widzę. */
function visibleTasks(t: ServerTables, user: string): ServerTables {
  return { ...t, tasks: Object.fromEntries(Object.entries(t.tasks ?? {}).filter(([, r]) => canSee(t, user, 'tasks', r))) };
}

/** Kroki polecenia przeniesienia (task-move-cmd.ts) tak, jak wykona je serwer: na zadaniach, które widzę. */
const serverMoveSteps = (t: ServerTables, user: string, op: Extract<NewOp, { kind: 'cmd' }>): MoveStep[] | null => moveCmdSteps(visibleTasks(t, user), op);

/**
 * private.move_task_to_group i private.unmove_task (20261010060000_move_task_to_group.sql): te same sprawdzenia, potem
 * kroki po kolei na kopii danych — pierwsze odrzucenie odrzuca całe polecenie (N-12: wszystko albo nic).
 */
function moveVerdict(t: ServerTables, user: string, op: Extract<NewOp, { kind: 'cmd' }>): void {
  const a = op.args;
  const src = visibleTasks(t, user).tasks![String(a.task_id)];
  if (a.task_id == null || (op.cmd === 'move_task_to_group' ? a.group_id == null || !Array.isArray(a.tasks) || a.tasks.length === 0 : a.copy_id == null)) reject('invalid_value');
  if (!src) return reject('not_found');
  if (member(t, String(src.group_id), user)?.role === 'child') reject('forbidden:child');
  if (op.cmd === 'move_task_to_group') {
    const m = a as MoveArgs;
    if (src.parent_id != null || src.group_id === m.group_id) reject('invalid_value');
    if (src.deleted_at != null) reject('deleted');
    if (m.tasks[0]!.from !== m.task_id || m.tasks[0]!.set.parent_id != null) reject('invalid_value');
    const sub = new Set([m.task_id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rowsOf(t, 'tasks')) {
        if (r.parent_id == null || !sub.has(String(r.parent_id)) || sub.has(String(r.id))) continue;
        sub.add(String(r.id));
        grew = true;
      }
    }
    if (m.tasks.some((x) => !sub.has(x.from))) reject('invalid_value');
  } else {
    if (src.deleted_at == null) return;
    if (src.moved_to !== a.copy_id) reject('invalid_value');
  }
  const sim: { [e: string]: { [k: string]: Row } } = Object.fromEntries(Object.entries(t).map(([e, rows]) => [e, { ...rows }]));
  for (const step of serverMoveSteps(t, user, op)!) {
    if ('mark' in step) {
      sim.tasks![step.mark.id] = { ...sim.tasks![step.mark.id]!, moved_to: step.mark.to };
      continue;
    }
    const code = serverVerdict(sim, user, step.op);
    if (code !== null) reject(code);
    applyOnServer(sim, user, step.op, 'now');
    // Kopia zadania głównego musi powstać teraz (utworzenie istniejącego id to powtórzenie — bez zmian).
    if (op.cmd === 'move_task_to_group' && step.op.kind === 'create' && step.op.id === (a as MoveArgs).tasks[0]!.id) {
      const root = sim.tasks![step.op.id]!;
      if (!live(root) || root.group_id !== a.group_id || root.parent_id != null) reject('invalid_value');
    }
  }
}

function verdictOrThrow(t: ServerTables, user: string, op: NewOp): void {
  if (op.kind === 'cmd') return op.cmd === 'move_task_to_group' || op.cmd === 'unmove_task' ? moveVerdict(t, user, op) : undefined;
  const spec = SYNC_ENTITIES[op.entity];
  if (!spec) return reject('unknown_entity');
  const table = t[op.entity] ?? {};
  const current = table[op.id];
  if (op.kind === 'create') {
    const vals: Row = { ...op.set, [spec.pk]: op.id, group_id: op.group_id };
    const bad = jsonbKeys(vals).find((k) => !spec.insert.includes(k));
    if (bad !== undefined) reject(`invalid_field:${bad}`);
    if (current && canSee(t, user, op.entity, current)) return; // powtórzone utworzenie
    const row: Row = { visibility: op.entity === 'lists' ? 'group' : undefined, ...op.set, [spec.pk]: op.id, group_id: op.group_id, deleted_at: null };
    // Cudzy wiersz o tym kluczu: strażnicy (BEFORE INSERT) działają przed konfliktem klucza — np. cudzy zakres Moich spraw.
    if (current) {
      guards(t, user, op.entity, row, null);
      reject('invalid:23505');
    }
    guards(t, user, op.entity, row, null);
    trashed(t, op.group_id);
    if (!insertAllowed(t, user, op.entity, row)) reject('forbidden'); // RLS WITH CHECK: 42501 → forbidden (sync_push)
    lengths(op.entity, row);
    unique(t, op.entity, row);
    // lists_guard: twórca listy to ja (owner_member_id nadaje serwer).
    return afterGuards(t, op.entity, { ...row, owner_member_id: member(t, op.group_id, user)?.member_id }, null);
  }
  if (op.kind === 'patch') {
    const bad = jsonbKeys(op.set).find((k) => !spec.patch.includes(k));
    if (bad !== undefined) reject(`invalid_field:${bad}`);
    if (Object.keys(op.set).length === 0) return;
  } else if (!spec.softDelete) return reject('unsupported');
  if (!current || !canSee(t, user, op.entity, current)) return reject('not_found');
  if (op.kind === 'patch') {
    if (spec.softDelete && current.deleted_at != null) reject('deleted');
    if (!canUpdate(t, user, op.entity, current)) reject('forbidden');
    guards(t, user, op.entity, { ...current, ...op.set }, current);
    trashed(t, op.entity === 'groups' ? op.id : current.group_id);
    lengths(op.entity, op.set);
    return afterGuards(t, op.entity, { ...current, ...op.set }, current);
  } else {
    const deleting = op.kind === 'delete';
    if ((current.deleted_at == null) !== deleting) return; // już usunięte / przywrócone — bez zmian
    guards(t, user, op.entity, { ...current, deleted_at: deleting ? 'now' : null }, current);
  }
  trashed(t, current.group_id); // grupy nie usuwa się operacją (unsupported wyżej)
}

/**
 * Kod odrzucenia, którym serwer odpowie na operację osoby `user` przy danych `t` (stan serwera), albo null — przyjęte
 * (także powtórzone utworzenie i usunięcie już usuniętego). Polecenia i reguły spoza modelu: null (opis wyżej).
 */
export function serverVerdict(t: ServerTables, user: string, op: NewOp): string | null {
  try {
    verdictOrThrow(t, user, op);
    return null;
  } catch (e) {
    if (e instanceof Rejected) return e.message;
    throw e;
  }
}

/**
 * events_series_cascade, lists_series_cascade: seria zadań przy wydarzeniu znika z wydarzeniem albo listą i wraca z nimi
 * (tylko usunięta razem z nimi i tylko, gdy drugi rodzic żyje). Kaskadę zadań robi applyOp (tasks_cascade, lists_cascade).
 */
function seriesCascade(t: { [e: string]: { [k: string]: Row } }, entity: 'events' | 'lists', id: string, was: unknown, kind: 'delete' | 'restore') {
  const col = entity === 'events' ? 'event_id' : 'list_id';
  const now = t[entity]![id]!.deleted_at;
  for (const [k, s] of Object.entries(t.event_task_series ?? {})) {
    if (s[col] !== id) continue;
    if (kind === 'delete' && was == null && s.deleted_at == null) t.event_task_series![k] = { ...s, deleted_at: now };
    const other = entity === 'events' ? t.lists?.[String(s.list_id)] : t.events?.[String(s.event_id)];
    if (kind === 'restore' && was != null && s.deleted_at === was && other?.deleted_at == null) t.event_task_series![k] = { ...s, deleted_at: null };
  }
}

/**
 * Wyjście i powrót członka (group_members_departure, group_members_leave_scopes): oczekujące przekazania z nim i do niego
 * anulowane, jego listy prywatne usunięte (z kaskadą) i jego udostępnienia odebrane; powrót przywraca listy prywatne.
 */
function departure(t: { [e: string]: { [k: string]: Row } }, m: Row, kind: 'delete' | 'restore', at: string) {
  const mine = (l: Row) => l.group_id === m.group_id && l.owner_member_id === m.member_id && l.visibility === 'private';
  if (kind === 'restore') {
    for (const [id, l] of Object.entries(t.lists ?? {})) if (mine(l) && l.deleted_at != null && String(l.deleted_at) >= String(m.deleted_at)) applyOp(t, { seq: 0, op_id: 'server', kind: 'restore', entity: 'lists', id });
    return;
  }
  for (const [k, h] of Object.entries(t.handoffs ?? {})) {
    if (h.group_id === m.group_id && h.status === 'pending' && (h.from_member === m.member_id || h.to_member === m.member_id)) t.handoffs![k] = { ...h, status: 'cancelled', decided_at: at };
  }
  for (const [id, l] of Object.entries(t.lists ?? {})) {
    if (!mine(l) || l.deleted_at != null) continue;
    applyOp(t, { seq: 0, op_id: 'server', kind: 'delete', entity: 'lists', id });
    seriesCascade(t, 'lists', id, null, 'delete');
  }
  for (const [k, o] of Object.entries(t.object_members ?? {})) if (o.member_id === m.member_id && o.deleted_at == null) t.object_members![k] = { ...o, deleted_at: at };
  // member_scope_cleanup: zakres Moich spraw tej osoby znika (wraca „Wszystko”).
  for (const [k, sc] of Object.entries(t.my_day_scopes ?? {})) if (sc.member_id === m.member_id) delete t.my_day_scopes![k];
}

/**
 * Skutek przyjętej operacji na danych serwera (mutuje `t`). Wywołuj tylko dla operacji, dla których serverVerdict dał
 * null. `at` — znacznik czasu dla usunięć i decyzji.
 */
export function applyOnServer(t: { [e: string]: { [k: string]: Row } }, user: string, op: NewOp, at: string): void {
  const move = op.kind === 'cmd' ? serverMoveSteps(t, user, op) : null;
  if (move) {
    for (const step of move) {
      if ('op' in step) applyOnServer(t, user, step.op, at);
      else t.tasks![step.mark.id] = { ...t.tasks![step.mark.id]!, moved_to: step.mark.to };
    }
    return;
  }
  const old = op.kind === 'cmd' ? undefined : t[op.entity]?.[op.id];
  const me = op.kind === 'create' ? member(t, op.group_id, user) : null;
  applyOp(t, { ...op, seq: 0, op_id: 'server' } as Op);
  if ((op.kind === 'delete' || op.kind === 'restore') && (op.entity === 'events' || op.entity === 'lists')) seriesCascade(t, op.entity, op.id, old!.deleted_at, op.kind);
  if ((op.kind === 'delete' || op.kind === 'restore') && op.entity === 'group_members') departure(t, old!, op.kind, at);
  for (const rows of Object.values(t)) for (const [k, r] of Object.entries(rows)) if (typeof r.deleted_at === 'string' && r.deleted_at.startsWith('pending')) rows[k] = { ...r, deleted_at: at };
  if (op.kind === 'create') {
    const row = t[op.entity]![op.id]!;
    const assigned: Row =
      op.entity === 'lists' ? { owner_member_id: me!.member_id } : op.entity === 'handoffs' ? { from_member: me!.member_id, status: 'pending', closed: false, decided_at: null } : op.entity === 'shopping_trips' ? { done_by: me!.member_id } : {}; // przyjęte: jestem członkiem
    // Klucz główny w wierszu (członek: member_id) jak w tabeli serwera.
    t[op.entity]![op.id] = { ...config.sync.PATCH_DEFAULTS[op.entity], ...row, [SYNC_ENTITIES[op.entity]!.pk]: op.id, ...assigned };
  }
  // Wyzwalacz events_c_days (20261008530000_event_days.sql): „z godziną długość mówią godziny” — days = 1. Normalizacji
  // duration_min (20261008531000_event_duration.sql, private.event_duration) model nie odtwarza — ekrany nie czytają jej
  // z serwera, a test różnicowy (rules-vs-sql) nie losuje tej kolumny.
  if ((op.kind === 'create' || op.kind === 'patch') && op.entity === 'events' && t.events![op.id]!.start_time != null) t.events![op.id] = { ...t.events![op.id]!, days: 1 };
  if (op.kind === 'create') return;
  if (op.kind !== 'patch' || op.entity !== 'handoffs' || !old || old.status !== 'pending' || same(op.set.status, old.status) || op.set.status === undefined) return;
  t.handoffs![op.id] = { ...t.handoffs![op.id]!, decided_at: at };
  if (op.set.status !== 'accepted') return;
  const to = old.to_member;
  if (old.entity === 'tasks') {
    const task = t.tasks?.[String(old.entity_id)];
    if (task && task.completed_at == null && task.assignee_member_id === old.from_member) t.tasks![String(old.entity_id)] = { ...task, assignee_member_id: to };
  } else if (old.entity === 'lists') t.lists![String(old.entity_id)] = { ...t.lists![String(old.entity_id)]!, responsible_member_id: to };
  else if (old.occurrence_date == null) t.events![String(old.entity_id)] = { ...t.events![String(old.entity_id)]!, responsible_member_id: to };
  else {
    const id = overrideId(String(old.entity_id), String(old.occurrence_date));
    const prev = Object.values(t.event_overrides ?? {}).find((o) => o.event_id === old.entity_id && o.occurrence_date === old.occurrence_date);
    const key = prev ? String(prev.id) : id;
    (t.event_overrides ??= {})[key] = { ...config.sync.PATCH_DEFAULTS.event_overrides, id, event_id: old.entity_id, group_id: old.group_id, occurrence_date: old.occurrence_date, ...prev, responsible_member_id: to, responsible_cleared: false, deleted_at: null };
  }
}
