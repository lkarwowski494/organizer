/**
 * Które grupy obudzić po wysłaniu moich zmian (D159, ADR 0016): serwer wysyła ciche powiadomienie telefonom członków
 * tych grup, a one planują przypomnienia od nowa. Tylko zmiany przyjęte przez serwer (`ok`) i tylko takie, które mogą
 * zmienić czyjeś przypomnienia (sprawy z terminem w oknie planu, wydarzenia, obecność, członkowie, widoczność list).
 * Ocena ostrożna: gdy nie wiadomo (brak daty, seria), grupa jest budzona. Ciche powiadomienia mają mały budżet
 * (najwyżej 2–3 na godzinę na urządzenie, config.wake), więc pomijamy zmiany, które przypomnień nie ruszą:
 * pozycje zakupów, aktywność, stałe zakupy, sprawy z terminem poza oknem. Przekazanie budzi tylko przy przyjęciu
 * (audyt 3, N-18): serwer przenosi wtedy sprawę na odbiorcę, a telefon nadawcy musi skasować jej przypomnienia
 * (alert „przyjmuje” nie uruchamia aplikacji w tle); propozycja, odrzucenie i wycofanie nic nie przenoszą.
 */
import type { Entity, Op, PushResponse, Row } from './sync-engine/client';

type Tables = { readonly [e: string]: { readonly [id: string]: Row } | undefined };

/**
 * Encje, których zmiana może zmienić przypomnienia (treść, chwilę albo to, czy w ogóle są). `my_day_scopes` (zakres
 * Moich spraw) zmienia przypomnienia moich innych urządzeń (audyt 3, N-18).
 */
const RELEVANT: ReadonlySet<Entity> = new Set<Entity>(['groups', 'group_members', 'lists', 'object_members', 'tasks', 'events', 'event_participants', 'event_overrides', 'event_rsvps', 'my_day_scopes']);

/** Polecenia bez wpływu na przypomnienia (stałe zakupy, M-111). */
const IGNORED_CMDS = new Set(['staple_add', 'staple_remove']);

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Wersja wiersza poza oknem planu: termin (albo dzień terminu) później niż `horizon`; bez daty i seria — w oknie. */
function beyond(e: Entity, row: Row, horizon: string): boolean {
  if (e === 'tasks' || e === 'lists') {
    const due = str(row.due_date);
    return due !== null && due > horizon;
  }
  if (e === 'events') {
    const start = str(row.start_date);
    return row.rrule == null && start !== null && start > horizon;
  }
  if (e === 'event_overrides' || e === 'event_rsvps') {
    const occ = str(row.occurrence_date);
    const moved = str(row.start_date);
    return occ !== null && occ > horizon && (moved === null || moved > horizon);
  }
  return false;
}

/**
 * Grupa przyjętego przekazania (N-18) albo null: inna zmiana przekazania albo przekazywana sprawa (termin wydarzenia)
 * poza oknem planu. Nieznana sprawa — grupa budzona (ocena ostrożna).
 */
function accepted(op: Op, before: Tables, after: Tables, horizon: string): string | null {
  if (op.kind !== 'patch' || op.set.status !== 'accepted') return null;
  const h = before.handoffs?.[op.id] ?? after.handoffs?.[op.id];
  const g = str(h?.group_id);
  if (!h || !g) return null;
  // Jeden termin wydarzenia oceniamy jak wyjątek tego terminu, całą sprawę — po jej wierszu.
  const occ = str(h.occurrence_date);
  const [e, target]: [Entity, Row | undefined] = occ !== null ? ['event_overrides', { occurrence_date: occ, start_date: null }] : [String(h.entity) as Entity, before[String(h.entity)]?.[String(h.entity_id)]];
  return target && beyond(e, target, horizon) ? null : g;
}

/**
 * Grupy do obudzenia. `before` — stan serwera sprzed tych zmian (base), `after` — stan z nimi (materialize), `horizon` —
 * ostatni dzień okna planu (ISO). Wynik posortowany, bez powtórzeń.
 */
export function wakeGroups(ops: readonly Op[], res: PushResponse, before: Tables, after: Tables, horizon: string): string[] {
  const ok = new Set(res.results.filter((r) => r.status === 'ok').map((r) => r.seq));
  const out = new Set<string>();
  for (const op of ops) {
    if (!ok.has(op.seq)) continue;
    if (op.kind === 'cmd') {
      if (IGNORED_CMDS.has(op.cmd)) continue;
      const a = op.args;
      const g =
        str(a.group_id) ??
        str(after.events?.[String(a.event_id)]?.group_id) ??
        str(after.lists?.[String(a.list_id)]?.group_id) ??
        str(after.tasks?.[String(a.task_id)]?.group_id);
      if (g) out.add(g);
      continue;
    }
    if (op.entity === 'handoffs') {
      const g = accepted(op, before, after, horizon);
      if (g) out.add(g);
      continue;
    }
    if (!RELEVANT.has(op.entity)) continue;
    const versions = [before[op.entity]?.[op.id], after[op.entity]?.[op.id]].filter((r): r is Row => r !== undefined);
    const g = op.kind === 'create' ? op.group_id : versions.map((r) => (op.entity === 'groups' ? str(r.id) : str(r.group_id))).find((x) => x !== null);
    if (!g) continue;
    if (versions.length > 0 && versions.every((r) => beyond(op.entity, r, horizon))) continue;
    out.add(g);
  }
  return [...out].sort();
}
