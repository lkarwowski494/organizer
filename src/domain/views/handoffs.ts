/**
 * Przekazanie odpowiedzialności z potwierdzeniem (D70, decyzja właściciela z 7.10.2026, ADR 0013; migracja serwera
 * 20261008150000_handoffs). Do przyjęcia zadanie / wydarzenie zostaje u nadawcy; przyjęcie przenosi je na serwerze
 * w tej samej transakcji (telefon dostaje zmianę przy pobraniu), odrzucenie wraca do nadawcy jako informacja.
 */
import type { NewOp, Row } from '../sync-engine/client';
import { asEvent } from './event-rows';
import { groupsView } from './index';
import { asMember, asTask, type Member, rows, type Tables } from './model';

export type Handoff = {
  id: string;
  group_id: string;
  entity: 'tasks' | 'events';
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
  entity: r.entity === 'events' ? 'events' : 'tasks',
  entity_id: String(r.entity_id),
  occurrence_date: r.occurrence_date == null ? null : String(r.occurrence_date),
  from_member: String(r.from_member ?? ''),
  to_member: String(r.to_member),
  status: STATUSES.find((x) => x === r.status) ?? 'pending',
  closed: r.closed === true,
});

export type HandoffItem = Handoff & { title: string; otherName: string; groupName: string; line: number };

/** Klucz przedmiotu przekazania: zadanie, seria albo jeden termin. */
export const handoffKey = (entity: string, entityId: string, occurrenceDate: string | null) => `${entity}|${entityId}|${occurrenceDate ?? ''}`;

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
    const raw = h.entity === 'tasks' ? t.tasks?.[h.entity_id] : t.events?.[h.entity_id];
    const title = raw ? (h.entity === 'tasks' ? asTask(raw).title : asEvent(raw).title) : '';
    out.push({ ...h, title, otherName: members.get(other(h))?.display_name ?? '', groupName: g.name, line: g.line });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

/** Do potwierdzenia przeze mnie. */
export const incomingHandoffs = (t: Tables, userId: string) => enrich(t, userId, (h, me) => h.to_member === me && h.status === 'pending', (h) => h.from_member);

/** Moje odrzucone, których jeszcze nie zamknąłem (informacja dla nadawcy). */
export const declinedHandoffs = (t: Tables, userId: string) => enrich(t, userId, (h, me) => h.from_member === me && h.status === 'declined' && !h.closed, (h) => h.to_member);

/** Moje oczekujące, po kluczu przedmiotu (do dopisku „czeka na przyjęcie”). */
export function outgoingPending(t: Tables, userId: string): Map<string, HandoffItem> {
  const list = enrich(t, userId, (h, me) => h.from_member === me && h.status === 'pending', (h) => h.to_member);
  return new Map(list.map((h) => [handoffKey(h.entity, h.entity_id, h.occurrence_date), h]));
}

/** Komu mogę przekazać: dorośli z kontem w tej grupie, bez mnie (serwer sprawdzi jeszcze widoczność listy). */
export function handoffTargets(t: Tables, userId: string, groupId: string): Member[] {
  const me = groupsView(t, userId).find((g) => g.id === groupId)?.me.member_id;
  return rows(t, 'group_members', asMember)
    .filter((m) => m.group_id === groupId && m.deleted_at === null && m.role !== 'child' && m.user_id !== null && m.member_id !== me)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'));
}

export function createHandoff(a: { id: string; groupId: string; entity: 'tasks' | 'events'; entityId: string; occurrenceDate?: string | null; toMember: string }): NewOp {
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
