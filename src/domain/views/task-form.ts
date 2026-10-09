/**
 * Pełny formularz nowego zadania (D90, ADR 0019): „Więcej” przy polu dodawania. Wypełniony tym, co rozpoznał parser
 * (nazwa, dzień, godzina, „co tydzień”, „@imię”), z wyborem grupy, osoby i powtarzania (bez wyboru listy, D97).
 * Zmiana istniejącego zadania to tylko ekran zadania (decyzja właściciela 8.10.2026, D178 / PW-19 A) — „Zmień” po
 * szybkim dodaniu otwiera ekran zadania, a przeniesienie do innej grupy robi task-move.ts.
 *  - Formularz nie pyta o listę (D97): nowe zadanie trafia na ogólną listę grupy (`generalList`).
 *  - We wspólnej grupie zadanie bez osoby i terminu nie trafi do niczyich Moich spraw (D68) — od decyzji właściciela
 *    z 8.10.2026 (PW-18 b) można je zapisać, formularz tylko o tym mówi (`formUnseen`); lista „Tylko ja” poza regułą (A).
 */
import { LIST_NAMES } from '../../config/names.pl';
import { type CivilDate, isoWeekday, isValidDate, type LocalDateTime } from '../civil-date';
import { parseIsoDate } from '../format';
import { parseQuickAdd } from '../quickadd';
import type { NewOp } from '../sync-engine/client';
import { createList, createTask } from './commands';
import { groupsView, listsView } from './index';
import type { MentionTarget } from './mention';
import type { Tables } from './model';
import { type QuickAnswers, type QuickResolution, resolveQuick } from './quick-target';
import { type Repeat, setRepeat } from './task-repeat';

export type TaskForm = {
  title: string;
  groupId: string;
  date: string;
  time: string;
  assigneeId: string | null;
  repeat: Repeat | null;
};

export type FormError = 'title' | 'date' | 'time' | 'repeatNeedsDate' | 'group';

/** Grupy, do których mogę dodawać (nie jako dziecko), osobista pierwsza. */
export const formGroups = (t: Tables, userId: string) => groupsView(t, userId).filter((g) => g.me.role !== 'child');

/** Nazwy ogólnych list zadań (D97): w grupie osobistej „Moje zadania”, we wspólnej „Zadania”. */
export const PERSONAL_LIST_NAME = LIST_NAMES.PERSONAL;
export const NEW_LIST_NAME = LIST_NAMES.GENERAL;

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
 * Formularz z tekstu pola dodawania — grupa i osoba jak przy „+” (`resolveQuick`: „#Grupa”, „@ja”, „@imię”, grupa
 * z chipa). „@imię” pasujące do kilku osób daje kandydatów (`mention` — wpisane imię), a „@imię” zostaje w nazwie,
 * dopóki nie wybierzesz osoby (audyt 2, M-170: nie znika po cichu). Nieznane „@…” i „#…” zostają w nazwie; grupę
 * wybierasz wtedy w formularzu.
 */
export function formFromText(
  t: Tables,
  userId: string,
  text: string,
  now: LocalDateTime,
  o: { chipGroupId?: string | null; personalLabel?: string } = {},
): { form: TaskForm; candidates: MentionTarget[]; mention: string | null } {
  const resolve = (answers: QuickAnswers) => resolveQuick(t, userId, text, { chipGroupId: o.chipGroupId ?? null, personalLabel: o.personalLabel, answers });
  let answers: QuickAnswers = {};
  let r: QuickResolution = resolve(answers);
  if (r.kind === 'manyGroups' || r.kind === 'unknownGroup') r = resolve((answers = { skipTag: true }));
  const many = r.kind === 'many' ? r : null;
  if (r.kind === 'many' || r.kind === 'unknown') r = resolve({ ...answers, skipMention: true });
  const target = r.kind === 'ok' ? r.target : null;
  const parsed = parseQuickAdd(target?.body ?? text, now);

  return {
    form: {
      title: parsed.title,
      groupId: target?.groupId ?? '',
      date: parsed.due?.date ?? '',
      time: parsed.due?.time ?? '',
      assigneeId: target?.memberId ?? null,
      // „co tydzień” (parser zawsze daje wtedy termin) — w dzień tygodnia terminu.
      repeat: parsed.rrule && parsed.due ? { kind: 'weekly', days: [isoWeekday(parseIsoDate(parsed.due.date))] } : null,
    },
    candidates: many?.targets ?? [],
    mention: many?.name ?? null,
  };
}

/** Wybór osoby spośród kilku dopasowań „@imię” (M-170): jej grupa i ona; „@imię” znika z nazwy. */
export function pickCandidate(f: TaskForm, mention: string, c: MentionTarget): TaskForm {
  const title = f.title.replace(`@${mention}`, ' ').replace(/\s+/g, ' ').replace(/\s+([,;:.!?])/g, '$1').trim();
  return { ...f, title, groupId: c.groupId, assigneeId: c.memberId };
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
 * to nikt konkretny — D132, audyt 2: T-15) i bez terminu. Nowe zadanie trafia na ogólną listę grupy, nigdy na listę
 * „Tylko ja”, więc wyjątek A tu nie zachodzi.
 */
export function formUnseen(t: Tables, userId: string, f: TaskForm): boolean {
  if (formGroups(t, userId).find((g) => g.id === f.groupId)?.kind !== 'shared' || f.date.trim() !== '') return false;
  const person = f.assigneeId === null ? undefined : t.group_members?.[f.assigneeId];
  return !(person && person.deleted_at == null);
}

/** Data z formularza (do edytora powtarzania: dzień tygodnia i miesiąca); bez poprawnej daty — dziś. */
export function formDate(f: TaskForm, today: CivilDate): CivilDate {
  const m = DATE.exec(f.date.trim());
  return m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3])) ? parseIsoDate(f.date.trim()) : today;
}

/** Operacje zapisu nowego zadania (formularz musi przejść `validateForm`). Zwraca też id zadania. */
export function formOps(t: Tables, userId: string, f: TaskForm, newId: () => string): { ops: NewOp[]; taskId: string } {
  const date = f.date.trim();
  const due = date ? { date, time: f.time.trim() || null } : null;
  const g = generalList(t, userId, f.groupId, newId);
  const id = newId();
  const ops: NewOp[] = [...g.ops, createTask({ id, groupId: f.groupId, listId: g.listId, parsed: { title: f.title.trim(), due, rrule: null, tokens: [], unrecognizedDay: null }, assigneeId: f.assigneeId })];
  if (f.repeat) ops.push(setRepeat(id, f.repeat, due?.date));
  return { ops, taskId: id };
}
