/**
 * Potwierdzanie obecności (D124, ADR 0033): przy terminie wydarzenia grupy wspólnej „będę / nie będę / może”.
 * Kogo pytamy: uczestników (wydarzenie dla wybranych osób) albo całą grupę. Odpowiadam za siebie; dorosły także
 * za dziecko bez konta (dziecko z kontem odpowiada samo) — tak samo pilnuje serwer (event_rsvps_guard).
 * Identyfikator odpowiedzi to UUIDv5 z wydarzenia, daty i osoby (RFC 9562), więc dwa telefony piszą ten sam wiersz.
 * Gdy telefon jeszcze go nie zna, wysyła utworzenie, przywrócenie i zmianę: powtórzone utworzenie serwer pomija,
 * przywrócenie ożywia wiersz z kosza, a zmiana zapisuje odpowiedź (audyt 2, E-25: wcześniej odpowiedź na wiersz
 * usunięty po stronie serwera ginęła). Po „to i następne” odpowiedzi przechodzą do nowej serii z tym samym
 * identyfikatorem (polecenie split_event), więc wiersz szukamy po wydarzeniu, dniu i osobie, a nie po identyfikatorze.
 */
import { uuidv5 } from '../ids';
import type { NewOp } from '../sync-engine/client';
import { asEvent, asOverride, asParticipant, occurrenceResponsible } from './event-rows';
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

/** Odpowiedź osoby na termin: zmiana istniejącego wiersza, przywrócenie z kosza albo utworzenie (patrz nagłówek). */
export function answerOps(t: Tables, a: { groupId: string; eventId: string; date: string; memberId: string; answer: Answer }): NewOp[] {
  const same = Object.values(t.event_rsvps ?? {}).filter((r) => r.event_id === a.eventId && r.occurrence_date === a.date && r.member_id === a.memberId);
  const row = same.find((r) => r.deleted_at == null) ?? same[0];
  const id = row ? String(row.id) : rsvpId(a.eventId, a.date, a.memberId);
  const restore: NewOp = { kind: 'restore', entity: 'event_rsvps', id };
  const patch: NewOp = { kind: 'patch', entity: 'event_rsvps', id, set: { answer: a.answer } };
  if (row) return row.deleted_at == null ? [patch] : [restore, patch];
  return [{ kind: 'create', entity: 'event_rsvps', id, group_id: a.groupId, set: { event_id: a.eventId, occurrence_date: a.date, member_id: a.memberId, answer: a.answer } }, restore, patch];
}

/**
 * Terminy, na które sam odpowiedziałem „nie będę” (klucz `<id wydarzenia>|<data wystąpienia>`). PW-23 (decyzja
 * właściciela 8.10.2026): bez przypomnienia, „Czas wyjść” i liczenia dojazdu; wiersz zostaje (D129). Dzieci — niżej
 * (`silencedForMe`).
 */
export function declinedByMe(t: Tables, userId: string): Set<string> {
  const mine = myMemberships(t, userId);
  const out = new Set<string>();
  for (const r of Object.values(t.event_rsvps ?? {})) {
    if (r.deleted_at == null && r.answer === 'no' && mine.get(String(r.group_id))?.member_id === r.member_id) out.add(`${String(r.event_id)}|${String(r.occurrence_date)}`);
  }
  return out;
}

/**
 * Terminy bez moich przypomnień, „Czas wyjść” i dojazdu: moje „nie będę” (PW-23) oraz — decyzja koordynatora
 * 8.10.2026 (D160) — termin, który dotyczy mnie tylko przez dzieci (wydarzenie dla wybranych osób, nie jestem
 * uczestnikiem ani nikt nie odpowiada za termin, uczestniczy dziecko — reguła D58 z expandEvents), gdy każde dziecko
 * uczestniczące ma „nie będzie”. Gdy odpowiadam za termin (D66), dotyczy mnie wprost — bez wyciszenia.
 */
export function silencedForMe(t: Tables, userId: string): Set<string> {
  const out = declinedByMe(t, userId);
  const mine = myMemberships(t, userId);
  const members = new Map(rows(t, 'group_members', asMember).map((m) => [m.member_id, m]));
  const no = new Map<string, Set<string>>();
  for (const r of Object.values(t.event_rsvps ?? {})) {
    if (r.deleted_at != null || r.answer !== 'no') continue;
    const key = `${String(r.event_id)}|${String(r.occurrence_date)}`;
    no.set(key, (no.get(key) ?? new Set()).add(String(r.member_id)));
  }
  for (const [key, who] of no) {
    const [eventId, date] = key.split('|') as [string, string];
    const raw = t.events?.[eventId];
    if (out.has(key) || !raw) continue;
    const e = asEvent(raw);
    const me = mine.get(e.group_id);
    if (!me || me.role === 'child' || e.audience !== 'members') continue;
    const o = Object.values(t.event_overrides ?? {}).map(asOverride).find((x) => x.event_id === eventId && x.occurrence_date === date && x.deleted_at === null);
    const responsible = occurrenceResponsible(o, e);
    // D132: osoba usunięta z grupy już nie odpowiada.
    if (responsible !== null && members.get(responsible)?.deleted_at === null) continue;
    const parts = rows(t, 'event_participants', asParticipant).filter((p) => p.event_id === eventId && p.deleted_at === null).map((p) => members.get(p.member_id));
    if (parts.some((m) => m?.member_id === me.member_id)) continue;
    const kids = parts.filter((m) => m?.role === 'child' && m.deleted_at === null);
    if (kids.length > 0 && kids.every((k) => who.has(k!.member_id))) out.add(key);
  }
  return out;
}
