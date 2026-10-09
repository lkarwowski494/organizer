/**
 * Łańcuch serii po „to i następne” (audyt 2, M-96; audyt 3, PK-05). Każde „to i następne” kończy część serii dzień przed
 * podziałem i zakłada następczynię (events.split_from) — dla użytkownika to dalej jedna seria (event-rows.ts, seriesChain).
 * Tu algorytmy na tabelach telefonu, które serwer ma w tej samej postaci w SQL (migracja
 * 20261010050000_series_chain.sql; zgodność sprawdza test różnicowy tests/db/event-split.test.ts):
 *  - `chainOwner` — część, do której należy dzień (krok 2 split_event): spóźniony zapis z telefonu, który jeszcze nie
 *    pobrał podziału (odpowiedź „nie będę”, odwołanie terminu, zadanie, przekazanie terminu), trafia do następczyni
 *    zamiast do części, która tego dnia już nie ma (N-23; serwer: wyzwalacze private.chain_repoint);
 *  - `applyEndSeries` — polecenie end_series: „Usuń całą serię” (bez dnia) i „Odwołaj ten i następne” na całym łańcuchu
 *    (N-3), razem z wyjątkami i odpowiedziami o obecności z terminów, które znikają (N-117); stałe zadania z części,
 *    które znikają, przechodzą do ostatniej, która zostaje (definicja działa na cały łańcuch);
 *  - `applyRestoreSeries` — polecenie restore_series: „Cofnij” po end_series (odpowiedzi innych osób przywraca tylko
 *    serwer, więc cofnięcie też jest poleceniem); `endSeriesEffects` liczy je z tabel przed zmianą.
 */
import { addDays, formatIsoDate } from './civil-date';
import { parseIsoDate } from './format';
import type { NewOp, Row } from './sync-engine/client';

type MutableTables = { [e: string]: { [id: string]: Row } };
type Events = { readonly [id: string]: Row };

const UNTIL = /(?:^|;)UNTIL=(\d{4})(\d{2})(\d{2})(?:;|$)/;

/** Ostatni dzień serii z reguły (UNTIL) albo `null` (bez końca albo COUNT). */
export function ruleUntil(rrule: string | null): string | null {
  const m = rrule === null ? null : UNTIL.exec(rrule);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Reguła kończąca się najpóźniej `iso` (UNTIL zamiast COUNT; wcześniejszy koniec zostaje). Tekstowo, jak w SQL. */
export function capUntil(rrule: string | null, iso: string | null): string | null {
  if (rrule === null || iso === null) return rrule;
  const until = ruleUntil(rrule);
  const end = until !== null && until < iso ? until : iso;
  return `${rrule.split(';').filter((p) => !/^(COUNT|UNTIL)=/.test(p)).join(';')};UNTIL=${end.replaceAll('-', '')}`;
}

const live = (r: Row | undefined): r is Row => r !== undefined && r.deleted_at == null;
const byStart = (a: Row, b: Row) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.id).localeCompare(String(b.id));

/** Żywa następczyni serii (najwcześniejsza; tak samo sortuje SQL). */
export function successor(events: Events, id: string): Row | undefined {
  return Object.values(events)
    .filter((e) => e.split_from === id && e.deleted_at == null)
    .sort(byStart)[0];
}

/** Wszystkie części łańcucha (także w koszu) połączone z `id` przez split_from — z nią samą (jak private.event_chain). */
export function chainIds(events: Events, id: string): Set<string> {
  const links = Object.values(events).filter((e) => e.split_from != null);
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of links) {
      const [a, b] = [String(e.id), String(e.split_from)];
      if (out.has(a) !== out.has(b)) {
        out.add(a).add(b);
        grew = true;
      }
    }
  }
  return out;
}

/** Żywe części łańcucha w kolejności dni (tylko z tej samej grupy). */
export function chainParts(events: Events, id: string): Row[] {
  const group = events[id]?.group_id;
  return [...chainIds(events, id)].map((x) => events[x]).filter((e): e is Row => live(e) && e.group_id === group).sort(byStart);
}

/**
 * Część łańcucha, do której należy dzień: dopóki część kończy się przed nim, a ma następczynię — następczyni (krok 2
 * split_event; odwiedzone — bezpiecznik na zapętlony łańcuch, w SQL tak samo).
 */
export function chainOwner(events: Events, id: string, date: string): string {
  let target = events[id];
  if (!live(target)) return id;
  const seen = new Set([id]);
  for (let next = successor(events, id); next && !seen.has(String(next.id)) && (ruleUntil((target.rrule as string | null) ?? null) ?? date) < date; next = successor(events, String(target.id))) {
    seen.add(String(next.id));
    target = next;
  }
  return String(target.id);
}

/**
 * N-23: zapis terminu z telefonu, który jeszcze nie znał podziału — wiersz przechodzi do części, która ma ten dzień
 * (jak wyzwalacze private.chain_repoint przy dodaniu wiersza i przy zmianie terminu zadania).
 */
export function repointLate(t: MutableTables, entity: string, id: string): void {
  const row = t[entity]?.[id];
  const events = t.events ?? {};
  if (!row || typeof row.occurrence_date !== 'string') return;
  const key = entity === 'handoffs' ? (row.entity === 'events' ? 'entity_id' : null) : entity === 'event_overrides' || entity === 'event_rsvps' || entity === 'tasks' ? 'event_id' : null;
  if (key === null || typeof row[key] !== 'string') return;
  const owner = chainOwner(events, String(row[key]), row.occurrence_date);
  if (owner !== row[key]) t[entity]![id] = { ...row, [key]: owner };
}

export type EndArgs = {
  /** Dowolna część łańcucha. */
  event_id: string;
  /** Pierwszy dzień, który znika („ten i następne”); `null` — cała seria. */
  date: string | null;
  /** Nazwa do listy odrzuconych zmian (serwer jej nie czyta). */
  title?: string;
};
export type RestoreArgs = {
  event_id: string;
  title?: string;
  /** Części do przywrócenia z kosza. */
  events: string[];
  /** Reguły części sprzed ucięcia. */
  parts: { id: string; rrule: string }[];
  overrides: string[];
  rsvps: string[];
};

const dayBefore = (iso: string) => formatIsoDate(addDays(parseIsoDate(iso), -1));

/** Definicje stałych zadań idą do kosza razem z wydarzeniem i wracają z nim (jak events_series_cascade w SQL). */
function cascadeDefs(t: MutableTables, eventId: string, from: unknown, to: unknown): void {
  const defs = t.event_task_series ?? {};
  for (const [id, s] of Object.entries(defs)) {
    if (s.event_id !== eventId || (s.deleted_at ?? null) !== from) continue;
    if (to === null && !live(t.lists?.[String(s.list_id)])) continue;
    defs[id] = { ...s, deleted_at: to };
  }
}

/** Część do kosza razem ze swoimi definicjami stałych zadań. */
export function dropPart(t: MutableTables, id: string, stamp: string): void {
  t.events![id] = { ...t.events![id]!, deleted_at: stamp };
  cascadeDefs(t, id, null, stamp);
}

/** Żywe definicje stałych zadań części `from` przechodzą do części `to` (część `from` zaraz znika). */
export function moveDefs(t: MutableTables, from: string, to: string): void {
  const defs = t.event_task_series ?? {};
  for (const [id, s] of Object.entries(defs)) if (s.event_id === from && s.deleted_at == null) defs[id] = { ...s, event_id: to };
}

/**
 * Lokalny skutek end_series (ten sam algorytm co private.end_series): części od tego dnia do kosza, część z tym dniem
 * kończy się dzień wcześniej, a jej wyjątki i odpowiedzi od tego dnia — do kosza (N-117: po przedłużeniu serii nie ożyją).
 * Bez dnia — wszystkie części do kosza.
 */
export function applyEndSeries(t: MutableTables, args: Row, stamp: string = 'pending'): void {
  const a = args as unknown as EndArgs;
  const events = (t.events ??= {});
  if (!live(events[a.event_id])) return;
  const parts = chainParts(events, a.event_id);
  // Stałe zadania łańcucha mieszkają w najnowszej części — gdy ona znika, przechodzą do ostatniej, która zostaje.
  const keep = a.date === null ? undefined : parts.filter((p) => String(p.start_date) < a.date!).at(-1);
  for (const p of parts) {
    const id = String(p.id);
    if (a.date === null || String(p.start_date) >= a.date) {
      if (keep) moveDefs(t, id, String(keep.id));
      dropPart(t, id, stamp);
      continue;
    }
    const rule = (p.rrule as string | null) ?? null;
    if (rule === null || (ruleUntil(rule) ?? a.date) < a.date) continue;
    events[id] = { ...p, rrule: capUntil(rule, dayBefore(a.date)) };
    for (const e of ['event_overrides', 'event_rsvps'] as const) {
      const rows = t[e] ?? {};
      for (const [rid, r] of Object.entries(rows)) if (r.event_id === id && r.deleted_at == null && String(r.occurrence_date) >= a.date) rows[rid] = { ...r, deleted_at: stamp };
    }
  }
}

/** Lokalny skutek restore_series (jak private.restore_series): tylko wiersze tego łańcucha, w tej samej grupie. */
export function applyRestoreSeries(t: MutableTables, args: Row): void {
  const a = args as unknown as RestoreArgs;
  const events = (t.events ??= {});
  const first = events[a.event_id];
  if (!first) return;
  const chain = chainIds(events, a.event_id);
  const ours = (id: string) => chain.has(id) && events[id]?.group_id === first.group_id;
  for (const id of a.events) {
    const e = events[id];
    if (!ours(id) || live(e)) continue;
    events[id] = { ...e!, deleted_at: null };
    cascadeDefs(t, id, e!.deleted_at, null);
  }
  for (const p of a.parts) if (ours(p.id) && live(events[p.id])) events[p.id] = { ...events[p.id]!, rrule: p.rrule };
  for (const [e, ids] of [['event_overrides', a.overrides], ['event_rsvps', a.rsvps]] as const) {
    const rows = t[e] ?? {};
    for (const id of ids) {
      const r = rows[id];
      if (r && r.deleted_at != null && ours(String(r.event_id)) && live(events[String(r.event_id)])) rows[id] = { ...r, deleted_at: null };
    }
  }
}

const clone = (t: { readonly [e: string]: { readonly [id: string]: Row } }): MutableTables => Object.fromEntries(Object.entries(t).map(([e, rows]) => [e, { ...rows }]));

/**
 * Co zmieni end_series na tym telefonie: `changed` — te same zmiany jako zwykłe operacje (odcisk „Ostatnich zmian”,
 * src/domain/views/recent.ts), `undo` — polecenie restore_series, które je cofa (`null`, gdy nic się nie zmieni).
 */
export function endSeriesEffects(t: { readonly [e: string]: { readonly [id: string]: Row } }, args: EndArgs): { changed: NewOp[]; undo: NewOp | null } {
  const after = clone(t);
  applyEndSeries(after, args as unknown as Row);
  const changed: NewOp[] = [];
  const undo: RestoreArgs = { event_id: args.event_id, ...(args.title === undefined ? {} : { title: args.title }), events: [], parts: [], overrides: [], rsvps: [] };
  for (const [id, e] of Object.entries(after.events!)) {
    const before = t.events![id]!;
    if (before.deleted_at == null && e.deleted_at != null) {
      changed.push({ kind: 'delete', entity: 'events', id });
      undo.events.push(id);
    } else if (before.rrule !== e.rrule) {
      changed.push({ kind: 'patch', entity: 'events', id, set: { rrule: e.rrule } });
      undo.parts.push({ id, rrule: String(before.rrule) });
    }
  }
  for (const [entity, list] of [['event_overrides', undo.overrides], ['event_rsvps', undo.rsvps]] as const) {
    for (const [id, r] of Object.entries(after[entity] ?? {})) {
      if (t[entity]![id]!.deleted_at == null && r.deleted_at != null) {
        changed.push({ kind: 'delete', entity, id });
        list.push(id);
      }
    }
  }
  return { changed, undo: changed.length ? { kind: 'cmd', cmd: 'restore_series', args: undo } : null };
}
