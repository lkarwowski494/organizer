/**
 * „To i następne” jako jedno polecenie serwera (audyt 2, M-3, M-12, M-96): `private.split_event` w migracji
 * 20261008320000_event_split.sql robi całą zmianę w jednej transakcji — albo wszystko, albo nic (wcześniej odrzucenie
 * nowej serii zostawiało uciętą starą i znikały wszystkie następne terminy). Ten moduł to ten sam algorytm na tabelach
 * telefonu (wołany z applyOp silnika synchronizacji), więc zmiana jest widoczna od razu, także bez sieci (R1), a po
 * pobraniu telefon ma wynik serwera. Zgodność obu wersji sprawdza test różnicowy tests/db/event-split.test.ts.
 *
 * Kroki (tak samo w SQL):
 *  1. Polecenie powtórzone (ten sam identyfikator nowej serii — drugi telefon zmienił ten sam termin): nowe wartości jak
 *     zmiana całej nowej serii (ostatni zapis wygrywa), bez ponownego dzielenia.
 *  2. Gdy dzielona seria kończy się przed tym dniem, a ma następczynię (ktoś podzielił ją wcześniej), dzielimy następczynię.
 *  3. Nowa seria wskazuje poprzedniczkę (split_from), poprzedniczka kończy się dzień wcześniej. Gdy poprzedniczka miała
 *     już następczynię od późniejszego dnia, nowa seria kończy się tam, gdzie kończyła się poprzedniczka, i sama staje się
 *     poprzedniczką tamtej (bez dubli terminów).
 *  4. Z terminów od tego dnia (do końca dzielonej części) do nowej serii przechodzą — z tymi samymi identyfikatorami —
 *     zmiany pojedynczych terminów (te, których nowa seria nie ma, do kosza: podgląd skutków), odpowiedzi o obecności
 *     wszystkich osób, przekazania, zadania (także zrobione), a definicje stałych zadań, gdy nowa seria jest najnowsza.
 *  5. Decyzje z podglądu dla zadań z terminów, których nowa seria nie ma: najbliższy termin, odpięcie, kopia do kosza.
 * Osoba odpowiedzialna usunięta z grupy (albo dziecko) i usunięci uczestnicy nie przechodzą (D132).
 */
import { addDays, formatIsoDate } from './civil-date';
import { parseIsoDate } from './format';
import { uuidv5 } from './ids';
import type { Row } from './sync-engine/client';

type MutableTables = { [e: string]: { [id: string]: Row } };

/** Przestrzeń nazw: UUIDv5(NAMESPACE_URL, „https://github.com/lkarwowski494/organizer/event-split”). */
export const SPLIT_NAMESPACE = 'b17d6bd4-aff3-54f2-9b38-d323a09670df';
/** Nowa seria = UUIDv5(seria|dzień): dwa telefony dzielące ten sam termin tworzą tę samą serię (bez dubli). */
export const splitId = (eventId: string, date: string) => uuidv5(SPLIT_NAMESPACE, `${eventId}|${date}`);

export type SplitTask = { id: string; action: 'relink'; date: string } | { id: string; action: 'unlink' } | { id: string; action: 'delete' };
export type SplitArgs = {
  /** Nowa seria (splitId). */
  id: string;
  /** Seria, którą telefon dzieli (serwer może przejść do jej następczyni — krok 2). */
  event_id: string;
  /** Pierwszy dzień nowej serii: data wystąpienia, od którego zmieniam. */
  date: string;
  set: { title: string; start_date: string; start_time: string | null; end_time: string | null; rrule: string | null; audience: 'group' | 'members'; responsible_member_id: string | null; location: string | null };
  participants: { id: string; member_id: string }[];
  /** Zmienione pojedynczo terminy, których nowa seria nie ma (audyt 2, E-20) — do kosza zamiast do nowej serii. */
  drop_overrides: string[];
  tasks: SplitTask[];
};

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

const alive = (r: Row | undefined): r is Row => r !== undefined && r.deleted_at == null;
const trashed = (r: Row): Row => ({ ...r, deleted_at: r.deleted_at ?? 'pending' });

/** Żywa następczyni serii (najwcześniejsza; tak samo sortuje SQL). */
function successor(events: { [id: string]: Row }, id: string): Row | undefined {
  return Object.values(events)
    .filter((e) => e.split_from === id && e.deleted_at == null)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.id).localeCompare(String(b.id)))[0];
}

/** Uczestnicy nowej serii: brakujący dopisani, usunięci przywróceni, zbędni do kosza; tylko osoby, które są w grupie. */
function syncParticipants(t: MutableTables, sid: string, groupId: string, wanted: SplitArgs['participants'], inGroup: (m: string) => boolean): void {
  const ps = (t.event_participants ??= {});
  const want = new Map(wanted.map((p) => [p.member_id, p.id]));
  for (const [id, p] of Object.entries(ps)) {
    if (p.event_id !== sid) continue;
    const member = String(p.member_id);
    if (p.deleted_at == null && !want.has(member)) ps[id] = trashed(p);
    else if (p.deleted_at != null && want.has(member) && inGroup(member)) ps[id] = { ...p, deleted_at: null };
  }
  for (const [member, id] of want) {
    if (!inGroup(member) || ps[id] || Object.values(ps).some((p) => p.event_id === sid && p.member_id === member)) continue;
    ps[id] = { id, group_id: groupId, event_id: sid, member_id: member, deleted_at: null };
  }
}

/** Lokalny skutek polecenia split_event (opis w nagłówku). Polecenie, którego serwer nie przyjmie, nic tu nie zmienia. */
export function applySplit(t: MutableTables, args: Row): void {
  const a = args as unknown as SplitArgs;
  const events = (t.events ??= {});
  let target = events[a.event_id];
  if (!alive(target)) return;
  const groupId = String(target.group_id);
  const members = Object.values(t.group_members ?? {}).filter((m) => m.group_id === groupId && m.deleted_at == null);
  const inGroup = (m: string) => members.some((x) => x.member_id === m);
  const resp = members.some((m) => m.member_id === a.set.responsible_member_id && m.role !== 'child') ? a.set.responsible_member_id : null;
  const fields = { title: a.set.title, start_date: a.set.start_date, start_time: a.set.start_time, end_time: a.set.end_time, audience: a.set.audience, responsible_member_id: resp, location: a.set.location };
  if (a.set.start_date < a.date) return;
  const existing = events[a.id];
  if (existing) {
    // Krok 1: powtórzone polecenie.
    if (String(existing.group_id) !== groupId || existing.split_from == null || existing.deleted_at != null) return;
    const capped = successor(events, a.id) ? ruleUntil(existing.rrule as string | null) : null;
    events[a.id] = { ...existing, ...fields, rrule: capUntil(a.set.rrule, capped) };
    syncParticipants(t, a.id, groupId, a.participants, inGroup);
    return;
  }
  // Krok 2: termin należy do następczyni, gdy dzielona kończy się przed nim.
  let next = successor(events, String(target.id));
  // Odwiedzone — bezpiecznik na uszkodzony (zapętlony) łańcuch; w SQL tak samo.
  const seen = new Set([String(target.id)]);
  while (next && !seen.has(String(next.id)) && (ruleUntil(target.rrule as string | null) ?? a.date) < a.date) {
    seen.add(String(next.id));
    target = next;
    next = successor(events, String(target.id));
  }
  if (target.rrule == null) return;
  const tid = String(target.id);
  const rule = String(target.rrule);
  const hi = next ? ruleUntil(rule) : null;
  // Krok 3.
  events[a.id] = { id: a.id, group_id: groupId, ...fields, note: target.note ?? null, rrule: capUntil(a.set.rrule, hi), kind: target.kind ?? 'event', split_from: tid, deleted_at: null };
  if (next) events[String(next.id)] = { ...next, split_from: a.id };
  events[tid] = { ...target, rrule: capUntil(rule, formatIsoDate(addDays(parseIsoDate(a.date), -1))) };
  syncParticipants(t, a.id, groupId, a.participants, inGroup);
  // Krok 4.
  const inRange = (v: unknown) => typeof v === 'string' && v >= a.date && (hi === null || v <= hi);
  const ov = (t.event_overrides ??= {});
  const drop = new Set(a.drop_overrides);
  for (const [id, o] of Object.entries(ov)) if (o.event_id === tid && o.deleted_at == null && inRange(o.occurrence_date) && drop.has(id)) ov[id] = trashed(o);
  // Nowa seria jest pusta, a dni z dzielonej są unikalne, więc przeniesienie nie łamie unikalności (seria, dzień[, osoba]).
  for (const [id, o] of Object.entries(ov)) if (o.event_id === tid && inRange(o.occurrence_date)) ov[id] = { ...o, event_id: a.id };
  const rs = (t.event_rsvps ??= {});
  for (const [id, r] of Object.entries(rs)) if (r.event_id === tid && inRange(r.occurrence_date)) rs[id] = { ...r, event_id: a.id };
  const hs = (t.handoffs ??= {});
  for (const [id, h] of Object.entries(hs)) {
    if (h.entity !== 'events' || h.entity_id !== tid) continue;
    if (inRange(h.occurrence_date) || (h.occurrence_date === null && h.status === 'pending' && !next)) hs[id] = { ...h, entity_id: a.id };
  }
  const tasks = (t.tasks ??= {});
  for (const [id, x] of Object.entries(tasks)) if (x.event_id === tid && inRange(x.occurrence_date)) tasks[id] = { ...x, event_id: a.id };
  if (!next) {
    const defs = (t.event_task_series ??= {});
    for (const [id, s] of Object.entries(defs)) if (s.event_id === tid) defs[id] = { ...s, event_id: a.id };
  }
  // Krok 5.
  for (const d of a.tasks) {
    const x = tasks[d.id];
    if (!x || x.event_id !== a.id) continue;
    if (d.action === 'relink') tasks[d.id] = { ...x, occurrence_date: d.date };
    else if (d.action === 'unlink') tasks[d.id] = { ...x, event_id: null, occurrence_date: null, ...(x.deadline_mode === 'event' ? { deadline_mode: 'none' } : {}) };
    else if (x.series_id != null && x.deleted_at == null) tasks[d.id] = trashed(x);
  }
}
