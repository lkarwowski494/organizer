/**
 * Pełny formularz zadania (D90, ADR 0019): „Więcej” przy polu dodawania i „Zmień” po szybkim dodaniu. Wypełniony tym,
 * co rozpoznał parser (nazwa, dzień, godzina, „co tydzień”, „@imię”), z wyborem grupy, osoby i powtarzania (bez wyboru listy, D97).
 *  - Formularz nie pyta o listę (D97): nowe zadanie trafia na ogólną listę grupy (`generalList`), przy „Zmień” w tej
 *    samej grupie zostaje na swojej liście. Zmiana grupy: serwer trzyma zadanie w jego grupie, więc powstaje kopia
 *    (z notatką) na ogólnej liście nowej grupy, a stare idzie do kosza (można je przywrócić).
 *  - We wspólnej grupie zadanie potrzebuje osoby albo terminu (D68).
 */
import { type CivilDate, isoWeekday, isValidDate, type LocalDateTime } from '../civil-date';
import { parseIsoDate } from '../format';
import { parseQuickAdd } from '../quickadd';
import type { NewOp } from '../sync-engine/client';
import { createList, createTask, patchTask, remove, setDue } from './commands';
import { groupsView, listsView } from './index';
import { extractMention, type MentionTarget, resolveMention } from './mention';
import { asTask, type Tables } from './model';
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

export type FormError = 'title' | 'date' | 'time' | 'addressee' | 'repeatNeedsDate' | 'group';

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

/**
 * Formularz z tekstu pola dodawania. „@imię” z jednym dopasowaniem ustawia grupę i osobę; przy kilku zwraca kandydatów
 * (`mention` — wpisane imię), a „@imię” zostaje w nazwie, dopóki nie wybierzesz osoby (audyt 2, M-170: nie znika po cichu).
 */
export function formFromText(t: Tables, userId: string, text: string, now: LocalDateTime): { form: TaskForm; candidates: MentionTarget[]; mention: string | null } {
  const r = resolveMention(t, userId, text);
  const parsed = parseQuickAdd(r.kind === 'one' ? extractMention(text).text : text, now);
  const personal = formGroups(t, userId)[0];
  const target = r.kind === 'one' ? r.target : null;

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
    candidates: r.kind === 'many' ? r.targets : [],
    mention: r.kind === 'many' ? r.name : null,
  };
}

/** Wybór osoby spośród kilku dopasowań „@imię” (M-170): jej grupa i ona; „@imię” znika z nazwy. */
export function pickCandidate(f: TaskForm, mention: string, c: MentionTarget): TaskForm {
  const title = f.title.replace(`@${mention}`, ' ').replace(/\s+/g, ' ').replace(/\s+([,;:.!?])/g, '$1').trim();
  return { ...f, title, groupId: c.groupId, assigneeId: c.memberId };
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
  if (group.kind === 'shared' && f.assigneeId === null && d === '') return 'addressee';
  return null;
}

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
  ops.push(createTask({ id, groupId: f.groupId, listId, parsed: { title, due, rrule: null, tokens: [], unrecognizedDay: null }, assigneeId: f.assigneeId }));
  if (f.repeat) ops.push(setRepeat(id, f.repeat, due?.date));
  if (original) {
    // Inna grupa: kopia z notatką, oryginał do kosza.
    if (original.note) ops.push(patchTask(id, { note: String(original.note) }));
    ops.push(remove('tasks', String(original.id)));
  }
  return { ops, taskId: id };
}
