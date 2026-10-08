/**
 * Przekazanie odpowiedzialności z potwierdzeniem (D70, decyzja właściciela z 7.10.2026, ADR 0013; migracja serwera
 * 20261008150000_handoffs). Do przyjęcia zadanie / wydarzenie zostaje u nadawcy; przyjęcie przenosi je na serwerze
 * w tej samej transakcji (telefon dostaje zmianę przy pobraniu), odrzucenie wraca do nadawcy jako informacja.
 * Zadanie powtarzane przekazuje się jako obowiązek, nie jeden termin (decyzja właściciela z 8.10.2026; migracja
 * 20261008330000_handoff_obligation): przekazanie dotyczy niezrobionych terminów łańcucha (`handoffSubjects`).
 */
import type { NewOp, Row } from '../sync-engine/client';
import { asEvent } from './event-rows';
import { groupsView } from './index';
import { asList, asMember, asTask, type Member, rows, type Tables } from './model';
import { nextId } from './task-repeat';
import { memberCanSeeList } from './visibility';

export type Handoff = {
  id: string;
  group_id: string;
  entity: 'tasks' | 'events' | 'lists';
  entity_id: string;
  occurrence_date: string | null;
  from_member: string;
  to_member: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  closed: boolean;
};

const STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export const asHandoff = (r: Row): Handoff => ({
  id: String(r.id),
  group_id: String(r.group_id),
  entity: r.entity === 'events' || r.entity === 'lists' ? r.entity : 'tasks',
  entity_id: String(r.entity_id),
  occurrence_date: r.occurrence_date == null ? null : String(r.occurrence_date),
  from_member: String(r.from_member ?? ''),
  to_member: String(r.to_member),
  status: STATUSES.find((x) => x === r.status) ?? 'pending',
  closed: r.closed === true,
});

/** `subjects` — czego przekazanie dotyczy teraz (`handoffSubjects`). */
export type HandoffItem = Handoff & { title: string; otherName: string; groupName: string; line: number; subjects: string[] };

/** Klucz przedmiotu przekazania: zadanie, seria albo jeden termin. */
export const handoffKey = (entity: string, entityId: string, occurrenceDate: string | null) => `${entity}|${entityId}|${occurrenceDate ?? ''}`;

/**
 * Czego przekazanie dotyczy teraz. Zadanie: niezrobione terminy łańcucha od przekazanego — ten i kolejne kopie (nextId) —
 * tak jak przyjęcie na serwerze (private.handoffs_guard); zrobione zostają w historii nadawcy. Wydarzenie i zakupy: sam
 * przedmiot, jeśli nie jest w koszu. Pusto — nie ma czego przyjmować (zrobione jednorazowe, w koszu, nieznane; audyt 2,
 * T-5: „Przyjmij” przy zrobionym zadaniu przepisywało historię).
 */
export function handoffSubjects(t: Tables, h: Pick<Handoff, 'entity' | 'entity_id'>): string[] {
  if (h.entity !== 'tasks') {
    const raw = t[h.entity]?.[h.entity_id];
    return raw && raw.deleted_at == null ? [h.entity_id] : [];
  }
  const out: string[] = [];
  // Łańcuch kończy się na pierwszym id, którego nie ma; kolejne id wynika z poprzedniego, więc cyklu nie ma.
  for (let id = h.entity_id, raw = t.tasks?.[id]; raw; id = nextId(id), raw = t.tasks?.[id]) if (raw.deleted_at == null && raw.completed_at == null) out.push(id);
  return out;
}

function enrich(t: Tables, userId: string, pick: (h: Handoff, me: string) => boolean, other: (h: Handoff) => string): HandoffItem[] {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const members = new Map(rows(t, 'group_members', asMember).map((m) => [m.member_id, m]));
  const out: HandoffItem[] = [];
  for (const row of rows(t, 'handoffs', asHandoff)) {
    const g = groups.get(row.group_id);
    if (!g) continue;
    // Nowe przekazanie przed wysłaniem nie ma nadawcy (ustawia go serwer) — to moje.
    const h = row.from_member === '' ? { ...row, from_member: g.me.member_id } : row;
    if (!pick(h, g.me.member_id)) continue;
    const subjects = handoffSubjects(t, h);
    const raw = t[h.entity]?.[subjects[0] ?? h.entity_id];
    // Zakupy (D73): tytuł to nazwa listy; ekran dopisuje „Zakupy:”.
    const title = !raw ? '' : h.entity === 'tasks' ? asTask(raw).title : h.entity === 'events' ? asEvent(raw).title : asList(raw).name;
    out.push({ ...h, title, otherName: members.get(other(h))?.display_name ?? '', groupName: g.name, line: g.line, subjects });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

/**
 * Do potwierdzenia przeze mnie — tylko, gdy jest co przyjąć (`handoffSubjects`). Przekazanie bez tego zostaje oczekujące:
 * cofnięcie odhaczenia, przywrócenie z kosza albo następny termin przywracają je do skrzynki.
 */
export const incomingHandoffs = (t: Tables, userId: string) => enrich(t, userId, (h, me) => h.to_member === me && h.status === 'pending' && handoffSubjects(t, h).length > 0, (h) => h.from_member);

/** Moje odrzucone, których jeszcze nie zamknąłem (informacja dla nadawcy). */
export const declinedHandoffs = (t: Tables, userId: string) => enrich(t, userId, (h, me) => h.from_member === me && h.status === 'declined' && !h.closed, (h) => h.to_member);

/**
 * Moje oczekujące, po kluczu przedmiotu (do dopisku „czeka na przyjęcie”) — przy każdym terminie, którego dotyczą
 * (zadanie powtarzane: także przy następnym, gdy przekazany już zrobiony).
 */
export function outgoingPending(t: Tables, userId: string): Map<string, HandoffItem> {
  const list = enrich(t, userId, (h, me) => h.from_member === me && h.status === 'pending', (h) => h.to_member);
  return new Map(list.flatMap((h) => h.subjects.map((id) => [handoffKey(h.entity, id, h.occurrence_date), h] as const)));
}

/**
 * Komu mogę przekazać: dorośli z kontem w tej grupie, bez mnie. Zadanie albo zakupy z listy (`listId`) — tylko osoby,
 * które ją widzą (audyt 2, R-4, T-10: serwer odrzuca innych).
 */
export function handoffTargets(t: Tables, userId: string, groupId: string, listId?: string): Member[] {
  const me = groupsView(t, userId).find((g) => g.id === groupId)?.me.member_id;
  return rows(t, 'group_members', asMember)
    .filter((m) => m.group_id === groupId && m.deleted_at === null && m.role !== 'child' && m.user_id !== null && m.member_id !== me && (listId === undefined || memberCanSeeList(t, m.member_id, listId)))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'));
}

export function createHandoff(a: { id: string; groupId: string; entity: Handoff['entity']; entityId: string; occurrenceDate?: string | null; toMember: string }): NewOp {
  return {
    kind: 'create',
    entity: 'handoffs',
    id: a.id,
    group_id: a.groupId,
    set: { entity: a.entity, entity_id: a.entityId, occurrence_date: a.occurrenceDate ?? null, to_member: a.toMember },
  };
}

export const decideHandoff = (id: string, accept: boolean): NewOp => ({ kind: 'patch', entity: 'handoffs', id, set: { status: accept ? 'accepted' : 'declined' } });
export const cancelHandoff = (id: string): NewOp => ({ kind: 'patch', entity: 'handoffs', id, set: { status: 'cancelled' } });
export const closeHandoff = (id: string): NewOp => ({ kind: 'patch', entity: 'handoffs', id, set: { closed: true } });

/**
 * Przekazania, o których mam poprosić serwer o powiadomienie (D70, push): moje nowe (potwierdzone przez serwer —
 * nadawcę wpisuje serwer) i moje decyzje (decided_at wpisuje serwer). Nie starsze niż `maxAgeH` godzin; serwer i tak
 * sprawdza wszystko jeszcze raz i każdy stan powiadamia najwyżej raz (push_sent_status).
 */
export function handoffsToNotify(t: Tables, userId: string, nowMs: number, maxAgeH: number): string[] {
  const me = new Map(groupsView(t, userId).map((g) => [g.id, g.me.member_id]));
  const out: string[] = [];
  for (const raw of Object.values(t.handoffs ?? {})) {
    const h = asHandoff(raw);
    const mine = me.get(h.group_id);
    if (!mine || h.status === 'cancelled' || raw.push_sent_status === h.status) continue;
    const at = h.status === 'pending' ? raw.created_at : raw.decided_at;
    if (typeof at !== 'string' || nowMs - Date.parse(at) > maxAgeH * 3_600_000) continue;
    if ((h.status === 'pending' && h.from_member === mine) || (h.status !== 'pending' && h.to_member === mine)) out.push(h.id);
  }
  return out.sort();
}
