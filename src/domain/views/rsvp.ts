/**
 * Potwierdzanie obecności (D124, ADR 0033): przy terminie wydarzenia grupy wspólnej „będę / nie będę / może”.
 * Kogo pytamy: uczestników (wydarzenie dla wybranych osób) albo całą grupę. Odpowiadam za siebie; dorosły także
 * za dziecko bez konta (dziecko z kontem odpowiada samo) — tak samo pilnuje serwer (event_rsvps_guard).
 * Identyfikator odpowiedzi to UUIDv5 z wydarzenia, daty i osoby (RFC 9562), więc dwa telefony piszą ten sam wiersz;
 * gdy telefon jeszcze go nie zna, wysyła utworzenie i zaraz zmianę — powtórzone utworzenie serwer pomija, a zmiana
 * i tak zapisze odpowiedź.
 */
import { uuidv5 } from '../ids';
import type { NewOp } from '../sync-engine/client';
import { asEvent, asParticipant } from './event-rows';
import { myMemberships } from './index';
import { asMember, rows, type Tables } from './model';

export type Answer = 'yes' | 'no' | 'maybe';
export const ANSWERS: readonly Answer[] = ['yes', 'maybe', 'no'];

/** Przestrzeń nazw: UUIDv5(NAMESPACE_URL, „https://github.com/lkarwowski494/organizer/event-rsvp”). */
export const RSVP_NAMESPACE = '25e69e19-ed6c-5137-b6a6-d2fd2ff0a0e5';
export const rsvpId = (eventId: string, date: string, memberId: string) => uuidv5(RSVP_NAMESPACE, `${eventId}|${date}|${memberId}`);

export type RsvpPerson = { memberId: string; name: string; me: boolean; answer: Answer | null; canAnswer: boolean };
export type RsvpView = { groupId: string; people: RsvpPerson[]; counts: Record<Answer | 'none', number> };

const isAnswer = (v: unknown): v is Answer => v === 'yes' || v === 'no' || v === 'maybe';

/** Obecność na terminie; `null` poza grupą wspólną albo gdy wydarzenia nie widzę. */
export function rsvpView(t: Tables, userId: string, eventId: string, date: string): RsvpView | null {
  const raw = t.events?.[eventId];
  if (!raw) return null;
  const e = asEvent(raw);
  const mine = myMemberships(t, userId).get(e.group_id);
  const g = t.groups?.[e.group_id];
  // D126: bez obecności przy lekcjach z planu i rutynach.
  if (!mine || !g || g.kind !== 'shared' || e.deleted_at !== null || e.kind !== 'event') return null;
  const members = rows(t, 'group_members', asMember).filter((m) => m.group_id === e.group_id && m.deleted_at === null);
  const invitedIds = new Set(rows(t, 'event_participants', asParticipant).filter((p) => p.event_id === eventId && p.deleted_at === null).map((p) => p.member_id));
  const invited = e.audience === 'members' ? members.filter((m) => invitedIds.has(m.member_id)) : members;
  const answers = new Map<string, Answer>();
  for (const r of Object.values(t.event_rsvps ?? {})) {
    if (r.event_id === eventId && r.occurrence_date === date && r.deleted_at == null && isAnswer(r.answer)) answers.set(String(r.member_id), r.answer);
  }
  const people = invited.map((m): RsvpPerson => {
    const me = m.member_id === mine.member_id;
    return { memberId: m.member_id, name: m.display_name, me, answer: answers.get(m.member_id) ?? null, canAnswer: me || (m.user_id === null && m.role === 'child' && mine.role !== 'child') };
  });
  people.sort((a, b) => Number(b.me) - Number(a.me) || Number(b.canAnswer) - Number(a.canAnswer) || a.name.localeCompare(b.name, 'pl') || a.memberId.localeCompare(b.memberId));
  const counts = { yes: 0, no: 0, maybe: 0, none: 0 };
  for (const p of people) counts[p.answer ?? 'none']++;
  return { groupId: e.group_id, people, counts };
}

/** Odpowiedź osoby na termin: zmiana istniejącego wiersza albo utworzenie i zmiana (patrz nagłówek). */
export function answerOps(t: Tables, a: { groupId: string; eventId: string; date: string; memberId: string; answer: Answer }): NewOp[] {
  const id = rsvpId(a.eventId, a.date, a.memberId);
  const patch: NewOp = { kind: 'patch', entity: 'event_rsvps', id, set: { answer: a.answer } };
  if (t.event_rsvps?.[id]) return [patch];
  return [{ kind: 'create', entity: 'event_rsvps', id, group_id: a.groupId, set: { event_id: a.eventId, occurrence_date: a.date, member_id: a.memberId, answer: a.answer } }, patch];
}

/**
 * Terminy, na które sam odpowiedziałem „nie będę” (klucz `<id wydarzenia>|<data wystąpienia>`). PW-23 (decyzja
 * właściciela 8.10.2026): bez przypomnienia, „Czas wyjść” i liczenia dojazdu; wiersz zostaje (D129). Liczy się tylko
 * moja odpowiedź — „nie będzie” za dziecko nie wycisza przypomnień dorosłego (otwarte pytanie do właściciela).
 */
export function declinedByMe(t: Tables, userId: string): Set<string> {
  const mine = myMemberships(t, userId);
  const out = new Set<string>();
  for (const r of Object.values(t.event_rsvps ?? {})) {
    if (r.deleted_at == null && r.answer === 'no' && mine.get(String(r.group_id))?.member_id === r.member_id) out.add(`${String(r.event_id)}|${String(r.occurrence_date)}`);
  }
  return out;
}
