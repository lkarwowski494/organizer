/**
 * Wybory formularza, których już nie ma (audyt 3, N-32, N-144, N-146): grupa, z której mnie usunięto (albo w której
 * jestem już dzieckiem), osoba usunięta z grupy i dzień, który minął. Szkic (D179) żyje do config.forms.DRAFT_MAX_DAYS
 * dni, a formularz bywa otwarty, gdy pobranie zmienia dane — zapis takiej rzeczy serwer odrzuca (forbidden,
 * invalid_assignee, invalid_member) i rzecz znika z telefonu do „Odrzuconych zmian”.
 *  - Przy przywróceniu szkicu (`sanitize…Draft`) wybory spoza bieżących opcji wracają do wartości z otwarcia formularza:
 *    grupa — domyślna, osoba — „nikt konkretny” (jak przy usunięciu osoby, D132), dzień z przeszłości — pusty (zadanie,
 *    zakupy) albo dzisiejszy (wydarzenie); formularz mówi o tym napisem (`DraftNotice`).
 *  - Przy „Zapisz” ta sama reguła daje błąd przy formularzu (`choicesError`) — zmiana przyszła w trakcie wypełniania.
 * Parametry otwarcia (np. „Nowa lista” z ekranu grupy) mają pierwszeństwo przed polami szkicu (N-146) — formularz
 * odrzuca wtedy pola szkicu, które parametr ustala.
 */
import type { CivilDate } from '../civil-date';
import { formatIsoDate } from '../civil-date';
import type { EventForm } from './event-form';
import { groupsView } from './index';
import type { Tables } from './model';
import type { TaskForm } from './task-form';

export type DraftNotice = { kind: 'group'; name: string | null } | { kind: 'people'; names: string[] } | { kind: 'date' };
export type DraftFix<F> = { changes: Partial<F>; notices: DraftNotice[] };
/**
 * Parametry otwarcia formularza, które wygrywają z polami szkicu (N-146): grupa (ekran grupy), rodzaj listy, dzień
 * (Kalendarz). Szkic z inną grupą traci też wybory osób z tamtej grupy — bez napisu (to nie zmiana na serwerze).
 */
export type Fixed = { groupId?: string; kind?: string; date?: string };

const dropUndefined = <F>(c: Partial<F>) => {
  for (const k of Object.keys(c) as (keyof F)[]) if (c[k] === undefined) delete c[k];
};

/** Grupa, do której nie mogę już dodawać (usunięto mnie, grupa w koszu albo jestem w niej dzieckiem). */
export const groupGone = (t: Tables, userId: string, groupId: string): boolean => !groupsView(t, userId).some((g) => g.id === groupId && g.me.role !== 'child');

/** Żywy członek grupy; `adult` — tylko dorosły (osoba odpowiedzialna, zakupy: D66). */
export function liveMember(t: Tables, groupId: string, memberId: string, o: { adult?: boolean } = {}): boolean {
  const m = t.group_members?.[memberId];
  return !!m && m.deleted_at == null && m.group_id === groupId && !(o.adult && m.role === 'child');
}

/** Imiona osób (wiersz usuniętego członka zostaje z imieniem; bez wiersza — pomijamy). */
export const namesOf = (t: Tables, ids: readonly string[]): string[] => ids.flatMap((id) => (typeof t.group_members?.[id]?.display_name === 'string' ? [String(t.group_members[id]!.display_name)] : []));

const groupName = (t: Tables, id: string): string | null => (typeof t.groups?.[id]?.name === 'string' ? String(t.groups[id]!.name) : null);
const past = (iso: string | undefined, today: CivilDate) => iso !== undefined && iso !== '' && iso < formatIsoDate(today);

function withPeople(notices: DraftNotice[], t: Tables, gone: string[]): DraftNotice[] {
  return gone.length ? [...notices, { kind: 'people', names: namesOf(t, gone) }] : notices;
}

/** Szkic nowego zadania: grupa, osoba („Dla kogo”), dzień z przeszłości (N-144: pusty, bez godziny i powtarzania). */
export function sanitizeTaskDraft(t: Tables, userId: string, today: CivilDate, d: Partial<TaskForm>, initial: TaskForm): DraftFix<TaskForm> {
  const c = { ...d };
  let notices: DraftNotice[] = [];
  if (c.groupId !== undefined && groupGone(t, userId, c.groupId)) {
    notices.push({ kind: 'group', name: groupName(t, c.groupId) });
    delete c.groupId;
    delete c.assigneeId;
  }
  const g = c.groupId ?? initial.groupId;
  if (c.assigneeId != null && !liveMember(t, g, c.assigneeId)) {
    notices = withPeople(notices, t, [c.assigneeId]);
    c.assigneeId = null;
  }
  if (past(c.date, today)) {
    notices.push({ kind: 'date' });
    Object.assign(c, { date: '', time: '', repeat: null });
  }
  return { changes: c, notices };
}

/**
 * Szkic wydarzenia (`groupId` tylko w nowym). Uczestnicy i osoba odpowiedzialna spoza grupy odpadają; nowe wydarzenie
 * z dniem z przeszłości wraca do dnia z otwarcia (w zmianie istniejącego dzień bywa miniony z wyboru — zostaje).
 */
export function sanitizeEventDraft(t: Tables, userId: string, today: CivilDate, d: Partial<EventForm & { groupId: string }>, initial: EventForm & { groupId: string }, isNew: boolean, fixed: Fixed = {}): DraftFix<EventForm & { groupId: string }> {
  const c = { ...d };
  let notices: DraftNotice[] = [];
  if (fixed.groupId && c.groupId !== undefined) {
    if (c.groupId !== fixed.groupId) [c.participantIds, c.responsibleId] = [undefined, undefined];
    delete c.groupId;
  }
  // Inny dzień w szkicu niż z otwarcia: dzień i ostatni dzień ze szkicu odpadają; ten sam — ostatni dzień zostaje.
  if (fixed.date && c.date !== undefined) [c.date, c.endDate] = [undefined, c.date === fixed.date ? c.endDate : undefined];
  dropUndefined(c);
  if (isNew && c.groupId !== undefined && groupGone(t, userId, c.groupId)) {
    notices.push({ kind: 'group', name: groupName(t, c.groupId) });
    delete c.groupId;
    delete c.participantIds;
    delete c.responsibleId;
  }
  const g = c.groupId ?? initial.groupId;
  const gone = (c.participantIds ?? []).filter((id) => !liveMember(t, g, id));
  if (gone.length) c.participantIds = c.participantIds!.filter((id) => !gone.includes(id));
  if (c.responsibleId != null && !liveMember(t, g, c.responsibleId, { adult: true })) {
    gone.push(c.responsibleId);
    c.responsibleId = null;
  }
  notices = withPeople(notices, t, [...new Set(gone)]);
  if (isNew && past(c.date, today)) {
    notices.push({ kind: 'date' });
    delete c.date;
    delete c.endDate;
  }
  return { changes: c, notices };
}

export type RoutineDraft = { groupId: string; who: string[] };

/** Szkic rutyny: grupa i osoby („Dla kogo”). */
export function sanitizeRoutineDraft<F extends RoutineDraft>(t: Tables, userId: string, d: Partial<F>, initial: F, fixed: Fixed = {}): DraftFix<F> {
  const c = { ...d };
  let notices: DraftNotice[] = [];
  if (fixed.groupId && c.groupId !== undefined) {
    if (c.groupId !== fixed.groupId) delete c.who;
    delete c.groupId;
  }
  if (c.groupId !== undefined && groupGone(t, userId, c.groupId)) {
    notices.push({ kind: 'group', name: groupName(t, c.groupId) });
    delete c.groupId;
    delete c.who;
  }
  const g = c.groupId ?? initial.groupId;
  const gone = (c.who ?? []).filter((id) => !liveMember(t, g, id));
  if (gone.length) c.who = c.who!.filter((id) => !gone.includes(id));
  notices = withPeople(notices, t, gone);
  return { changes: c, notices };
}

export type ListDraft = { groupId: string; kind: 'tasks' | 'shopping'; trip: { date: string; time: string; responsibleId: string | null } };

/**
 * Szkic nowej listy: parametry otwarcia (grupa, rodzaj — N-146) wygrywają z polami szkicu bez napisu (to wybór z tego
 * otwarcia); grupa, której nie mam, wraca do domyślnej; osoba robiąca zakupy spoza grupy — „nikt konkretny”; dzień
 * zakupów z przeszłości — bez terminu.
 */
export function sanitizeListDraft<F extends ListDraft>(t: Tables, userId: string, today: CivilDate, d: Partial<F>, initial: F, fixed: Fixed = {}): DraftFix<F> {
  const c = { ...d };
  let notices: DraftNotice[] = [];
  if (fixed.groupId && c.groupId !== undefined) {
    if (c.groupId !== fixed.groupId && c.trip) c.trip = { ...c.trip, responsibleId: null };
    delete c.groupId;
  }
  if (fixed.kind) delete c.kind;
  if (c.groupId !== undefined && groupGone(t, userId, c.groupId)) {
    notices.push({ kind: 'group', name: groupName(t, c.groupId) });
    delete c.groupId;
  }
  const g = c.groupId ?? initial.groupId;
  if (c.trip) {
    let trip = c.trip;
    if (trip.responsibleId !== null && !liveMember(t, g, trip.responsibleId, { adult: true })) {
      notices = withPeople(notices, t, [trip.responsibleId]);
      trip = { ...trip, responsibleId: null };
    }
    if (past(trip.date, today)) {
      notices.push({ kind: 'date' });
      trip = { ...trip, date: '', time: '' };
    }
    c.trip = trip;
  }
  return { changes: c, notices };
}

/**
 * Sprawdzenie przy „Zapisz” (zmiana przyszła w trakcie wypełniania): grupa, której już nie mam, i osoby spoza grupy.
 * `known` — osoby, które rzecz już miała (zmiana istniejącej: usunięty z grupy uczestnik nie blokuje zmiany nazwy).
 */
export function choicesError(t: Tables, userId: string, a: { groupId: string; people?: readonly string[]; adults?: readonly string[]; known?: readonly string[]; checkGroup?: boolean }): { error: 'group' } | { error: 'people'; names: string[] } | null {
  if (a.checkGroup !== false && groupGone(t, userId, a.groupId)) return { error: 'group' };
  const known = new Set(a.known ?? []);
  const gone = [...(a.people ?? []).filter((id) => !liveMember(t, a.groupId, id)), ...(a.adults ?? []).filter((id) => !liveMember(t, a.groupId, id, { adult: true }))].filter((id) => !known.has(id));
  return gone.length ? { error: 'people', names: namesOf(t, [...new Set(gone)]) } : null;
}
