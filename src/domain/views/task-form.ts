/**
 * Pełny formularz zadania (D90, ADR 0019): „Więcej” przy polu dodawania i „Zmień” po szybkim dodaniu. Wypełniony tym,
 * co rozpoznał parser (nazwa, dzień, godzina, „co tydzień”, „@imię”), z wyborem grupy, osoby i powtarzania (bez wyboru listy, D97).
 *  - Formularz nie pyta o listę (D97): nowe zadanie trafia na ogólną listę grupy (`generalList`), przy „Zmień” w tej
 *    samej grupie zostaje na swojej liście. Zmiana grupy: serwer trzyma zadanie w jego grupie, więc powstaje kopia
 *    (z notatką, bez podzadań) na ogólnej liście nowej grupy, a stare idzie do kosza razem z podzadaniami (można je
 *    przywrócić); ekran mówi, ile podzadań to dotyczy (`movedSubtasks`, audyt 2: T-33).
 *  - We wspólnej grupie zadanie bez osoby i terminu nie trafi do niczyich Moich spraw (D68) — od decyzji właściciela
 *    z 8.10.2026 (PW-18 b) można je zapisać, formularz tylko o tym mówi (`formUnseen`); lista „Tylko ja” poza regułą (A).
 */
import { type CivilDate, isoWeekday, isValidDate, type LocalDateTime } from '../civil-date';
import { parseIsoDate } from '../format';
import { parseQuickAdd } from '../quickadd';
import type { NewOp } from '../sync-engine/client';
import { createList, createTask, patchTask, remove, setDue } from './commands';
import { groupsView, listsView } from './index';
import { extractMention, type MentionTarget, mentionTargets } from './mention';
import { asTask, type Tables } from './model';
import { subtasksOf } from './nesting';
import { parseRepeat, type Repeat, setRepeat } from './task-repeat';

export type TaskForm = {
  title: string;
  groupId: string;
  /** Lista zadania przy „Zmień” (zostaje, dopóki grupa ta sama); null = ogólna lista grupy (D97). */
  listId: string | null;
  date: string;
  time: string;
  assigneeId: string | null;
  repeat: Repeat | null;
};

export type FormError = 'title' | 'date' | 'time' | 'repeatNeedsDate' | 'group';

/** Grupy, do których mogę dodawać (nie jako dziecko), osobista pierwsza. */
export const formGroups = (t: Tables, userId: string) => groupsView(t, userId).filter((g) => g.me.role !== 'child');

/** Nazwy ogólnych list zadań (D97): w grupie osobistej „Moje zadania”, we wspólnej „Zadania”. */
export const PERSONAL_LIST_NAME = 'Moje zadania';
export const NEW_LIST_NAME = 'Zadania';

/**
 * Ogólna lista zadań grupy (D97): tu trafia zadanie bez wybranej listy. Osobista — pierwsza lista zadań (jak dotąd),
 * wspólna — lista „Zadania”; gdy jej nie ma, powstaje. Listy tematyczne („Balet – Róża”) wybiera się na liście.
 */
export function generalList(t: Tables, userId: string, groupId: string, newId: () => string): { listId: string; ops: NewOp[] } {
  // Audyt 2 (R-6): tylko lista całej grupy — na prywatną „Zadania” zadanie z @imię innej osoby serwer by odrzucił.
  const lists = listsView(t, userId, groupId).filter((l) => l.kind === 'tasks' && l.visibility === 'group');
  const personal = groupsView(t, userId).find((g) => g.id === groupId)?.kind === 'personal';
  const found = personal ? lists[0] : lists.find((l) => l.name === NEW_LIST_NAME);
  if (found) return { listId: found.id, ops: [] };
  const listId = newId();
  return { listId, ops: [createList({ id: listId, groupId, kind: 'tasks', name: personal ? PERSONAL_LIST_NAME : NEW_LIST_NAME })] };
}

/** Osoby, którym mogę przypisać zadanie w grupie (także dzieci — D34; bez usuniętych). */
export function formMembers(t: Tables, groupId: string): { member_id: string; display_name: string }[] {
  return Object.values(t.group_members ?? {})
    .filter((m) => m.group_id === groupId && m.deleted_at == null)
    .map((m) => ({ member_id: String(m.member_id), display_name: String(m.display_name ?? '') }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'));
}

/** Formularz z tekstu pola dodawania. „@imię” z jednym dopasowaniem ustawia grupę i osobę; inaczej zwraca kandydatów. */
export function formFromText(t: Tables, userId: string, text: string, now: LocalDateTime): { form: TaskForm; candidates: MentionTarget[] } {
  const { text: rest, mention } = extractMention(text);
  const candidates = mention ? mentionTargets(t, userId, mention.name) : [];
  const parsed = parseQuickAdd(candidates.length ? rest : text, now);
  const personal = formGroups(t, userId)[0];
  const target = candidates.length === 1 ? candidates[0]! : null;

  return {
    form: {
      title: parsed.title,
      groupId: target?.groupId ?? personal?.id ?? '',
      listId: null,
      date: parsed.due?.date ?? '',
      time: parsed.due?.time ?? '',
      assigneeId: target?.memberId ?? null,
      // „co tydzień” (parser zawsze daje wtedy termin) — w dzień tygodnia terminu.
      repeat: parsed.rrule && parsed.due ? { kind: 'weekly', days: [isoWeekday(parseIsoDate(parsed.due.date))] } : null,
    },
    candidates: candidates.length > 1 ? candidates : [],
  };
}

/** Formularz z istniejącego zadania („Zmień”). */
export function formFromTask(t: Tables, taskId: string): TaskForm | null {
  const raw = t.tasks?.[taskId];
  if (!raw) return null;
  const x = asTask(raw);
  return {
    title: x.title,
    groupId: x.group_id,
    listId: x.list_id,
    date: x.deadline_mode === 'own' && x.due_date ? x.due_date : '',
    time: x.deadline_mode === 'own' && x.due_time ? x.due_time.slice(0, 5) : '',
    assigneeId: x.assignee_member_id,
    repeat: parseRepeat(raw.repeat as string | undefined),
  };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateForm(t: Tables, userId: string, f: TaskForm): FormError | null {
  if (f.title.trim() === '') return 'title';
  const group = formGroups(t, userId).find((g) => g.id === f.groupId);
  if (!group) return 'group';
  const d = f.date.trim();
  const m = DATE.exec(d);
  if (d !== '' && (!m || !isValidDate(Number(m[1]), Number(m[2]), Number(m[3])))) return 'date';
  if (f.time.trim() !== '' && (d === '' || !TIME.test(f.time.trim()))) return d === '' ? 'date' : 'time';
  if (f.repeat && d === '') return 'repeatNeedsDate';
  return null;
}

/**
 * Dopisek „nikt tego nie widzi w Moich sprawach” (D68, PW-18 b): zadanie we wspólnej grupie bez osoby (usunięta z grupy
 * to nikt konkretny — D132, audyt 2: T-15) i bez terminu. Zostaje na swojej liście „Tylko ja” (ta sama grupa) — wtedy
 * poza regułą (A).
 */
export function formUnseen(t: Tables, userId: string, f: TaskForm): boolean {
  if (formGroups(t, userId).find((g) => g.id === f.groupId)?.kind !== 'shared' || f.date.trim() !== '') return false;
  const person = f.assigneeId === null ? undefined : t.group_members?.[f.assigneeId];
  if (person && person.deleted_at == null) return false;
  const list = f.listId === null ? undefined : t.lists?.[f.listId];
  return !(list && list.visibility === 'private' && list.group_id === f.groupId);
}

/** Ile żywych podzadań pójdzie do kosza razem z zadaniem przy zmianie grupy — kopia ich nie ma (audyt 2, T-33). */
export const movedSubtasks = (t: Tables, taskId: string) => subtasksOf(t, taskId).length;

/** Dzień tygodnia daty z formularza (do edytora powtarzania); bez daty — dziś. */
export function formWeekday(f: TaskForm, today: CivilDate): number {
  const m = DATE.exec(f.date.trim());
  return isoWeekday(m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3])) ? parseIsoDate(f.date.trim()) : today);
}

/** Operacje zapisu (formularz musi przejść `validateForm`). Zwraca też id zadania po zapisie. */
export function formOps(t: Tables, userId: string, f: TaskForm, newId: () => string, originalId?: string): { ops: NewOp[]; taskId: string } {
  const ops: NewOp[] = [];
  const date = f.date.trim();
  const due = date ? { date, time: f.time.trim() || null } : null;
  const original = originalId ? t.tasks?.[originalId] : undefined;
  const sameGroup = !!original && original.group_id === f.groupId;
  let listId: string;
  if (sameGroup) listId = String(original!.list_id);
  else {
    const g = generalList(t, userId, f.groupId, newId);
    listId = g.listId;
    ops.push(...g.ops);
  }
  const title = f.title.trim();
  if (sameGroup) {
    const x = asTask(original!);
    if (title !== x.title) ops.push(patchTask(x.id, { title }));
    if (f.assigneeId !== x.assignee_member_id) ops.push(patchTask(x.id, { assignee_member_id: f.assigneeId }));
    const sameDue = due ? x.deadline_mode === 'own' && x.due_date === due.date && (x.due_time?.slice(0, 5) ?? null) === due.time : x.deadline_mode === 'none';
    if (!sameDue) ops.push(setDue(x.id, due));
    const before = parseRepeat(original.repeat as string | undefined);
    if (JSON.stringify(before) !== JSON.stringify(f.repeat)) ops.push(setRepeat(x.id, f.repeat, due?.date));
    return { ops, taskId: x.id };
  }
  const id = newId();
  ops.push(createTask({ id, groupId: f.groupId, listId, parsed: { title, due, rrule: null, tokens: [] }, assigneeId: f.assigneeId }));
  if (f.repeat) ops.push(setRepeat(id, f.repeat, due?.date));
  if (original) {
    // Inna grupa: kopia z notatką, oryginał do kosza.
    if (original.note) ops.push(patchTask(id, { note: String(original.note) }));
    ops.push(remove('tasks', String(original.id)));
  }
  return { ops, taskId: id };
}
