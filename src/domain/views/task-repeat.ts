/**
 * Powtarzanie zadań (D76, decyzja właściciela z 7.10.2026, ADR 0016). Zapis w `tasks.repeat`:
 *  - według kalendarza — reguła RRULE (RFC 5545, ten sam podzbiór co wydarzenia, src/domain/rrule.ts):
 *    „FREQ=DAILY”, „FREQ=WEEKLY;BYDAY=MO,TH”, „FREQ=MONTHLY” (ten sam dzień miesiąca co termin; miesiące bez tego
 *    dnia są pomijane, jak w RFC: „invalid date … is ignored”);
 *  - od wykonania (D23) — „AFTER=DAILY;INTERVAL=n” albo „AFTER=WEEKLY;INTERVAL=n”.
 * Odhaczenie zadania z powtarzaniem tworzy następne z kolejnym terminem; odhaczone zostaje jako historia.
 * Id następnego = uuidv5(id + „|next”), więc dwa telefony odhaczające naraz nie zrobią dwóch kopii (serwer: utworzenie
 * istniejącego id nic nie robi). Cofnięcie odhaczenia usuwa nietkniętą kopię. Podzadania nie są kopiowane.
 */
import { config } from '../../config';
import { addDays, type CivilDate, compareDates, formatIsoDate } from '../civil-date';
import { nextAfterCompletion } from '../deadlines';
import { parseIsoDate } from '../format';
import { uuidv5 } from '../ids';
import { occurrences, parseRule, WEEKDAY_CODES } from '../rrule';
import type { NewOp, Row } from '../sync-engine/client';
import { asTask, type Task } from './model';

export const REPEAT_NAMESPACE = 'e21c312a-9090-47c5-9490-c54305c7ddd1';
export const nextId = (taskId: string) => uuidv5(REPEAT_NAMESPACE, `${taskId}|next`);

export type Repeat =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] } // 0 = poniedziałek
  /** `day` — dzień miesiąca (D137), żeby przeniesienie terminu nie przesuwało cyklu; bez niego = dzień terminu. */
  | { kind: 'monthly'; day?: number }
  | { kind: 'after'; unit: 'DAILY' | 'WEEKLY'; interval: number };

const AFTER = /^AFTER=(DAILY|WEEKLY);INTERVAL=([1-9]\d?)$/;

export function formatRepeat(r: Repeat): string {
  switch (r.kind) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${[...new Set(r.days)].sort().map((d) => WEEKDAY_CODES[d]).join(',')}`;
    case 'monthly':
      return r.day ? `FREQ=MONTHLY;BYMONTHDAY=${r.day}` : 'FREQ=MONTHLY';
    case 'after':
      return `AFTER=${r.unit};INTERVAL=${r.interval}`;
  }
}

/** Odczyt; nieznany zapis (np. z nowszej wersji aplikacji) = brak powtarzania na tym telefonie. */
export const repeatOf = (t: { tasks?: Record<string, Row> }, id: string) => parseRepeat(t.tasks?.[id]?.repeat as string | undefined);

export function parseRepeat(s: string | null | undefined): Repeat | null {
  if (!s) return null;
  const a = AFTER.exec(s);
  if (a) return { kind: 'after', unit: a[1] as 'DAILY' | 'WEEKLY', interval: Number(a[2]) };
  if (s === 'FREQ=DAILY') return { kind: 'daily' };
  if (s === 'FREQ=MONTHLY') return { kind: 'monthly' };
  const m = /^FREQ=MONTHLY;BYMONTHDAY=([1-9]|[12]\d|3[01])$/.exec(s);
  if (m) return { kind: 'monthly', day: Number(m[1]) };
  const w = /^FREQ=WEEKLY;BYDAY=((?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*)$/.exec(s);
  if (w) return { kind: 'weekly', days: w[1]!.split(',').map((c) => WEEKDAY_CODES.indexOf(c as (typeof WEEKDAY_CODES)[number])) };
  return null;
}

/**
 * Następny termin po odhaczeniu w dniu `done`: według kalendarza — pierwszy dzień reguły po późniejszym z (termin,
 * dzień wykonania), więc zrobione wcześniej nie przeskakuje terminu, a zaległe nie wraca w przeszłość; od wykonania —
 * dzień wykonania + interwał.
 */
export function nextDue(r: Repeat, due: CivilDate, done: CivilDate): CivilDate {
  if (r.kind === 'after') return parseIsoDate(nextAfterCompletion(formatIsoDate(due), [formatIsoDate(done)], { freq: r.unit, interval: r.interval }));
  const from = addDays(compareDates(done, due) > 0 ? done : due, 1);
  const rule = parseRule(formatRepeat(r));
  // Reguła tygodniowa liczy tygodnie od startu; start = termin (dzień z reguły albo poza nią — wtedy pierwsze trafienie później).
  return occurrences(due, rule, from, addDays(from, config.repeat.NEXT_SEARCH_DAYS))[0]!;
}

/** Odhaczenie (albo cofnięcie) zadania z powtarzaniem: operacje razem z samym odhaczeniem. */
export function repeatOps(t: { tasks?: Record<string, Row> }, task: Task, doneDate: CivilDate): NewOp[] {
  const r = repeatOf(t, task.id);
  if (!r || task.due_date === null || task.deadline_mode !== 'own') return [];
  const id = nextId(task.id);
  const existing = t.tasks?.[id] ? asTask(t.tasks[id]!) : null;
  if (task.completed_at !== null) {
    // Cofnięcie: kopia jeszcze nietknięta — znika; ruszona (odhaczona, usunięta) zostaje.
    return existing && existing.completed_at === null && existing.deleted_at === null ? [{ kind: 'delete', entity: 'tasks', id }] : [];
  }
  // Kopia już jest (drugi telefon, wcześniejsze odhaczenie) albo ktoś ją świadomie usunął — nic nie dokładamy.
  if (existing) return [];
  return [
    {
      kind: 'create',
      entity: 'tasks',
      id,
      group_id: task.group_id,
      set: {
        list_id: task.list_id,
        parent_id: task.parent_id,
        title: task.title,
        note: task.note,
        sort_key: task.sort_key,
        assignee_member_id: task.assignee_member_id,
        deadline_mode: 'own',
        due_date: formatIsoDate(nextDue(r, parseIsoDate(task.due_date), doneDate)),
        due_time: task.due_time,
        rollover: task.rollover,
        repeat: formatRepeat(r),
      },
    },
  ];
}

/**
 * D133: zadanie powtarzane z „Tylko tego dnia”, które minęło niezrobione, i tak dostaje następne — z pierwszym terminem
 * od dziś (opuszczone dni przepadają). Ten sam identyfikator co przy odhaczeniu (nextId), więc dwa telefony nie zrobią
 * dwóch kopii, a późniejsze odhaczenie starego nic nie dokłada. Pomija grupy, w których jestem dzieckiem (serwer odrzuci).
 */
export function expiredRepeatOps(t: { tasks?: Record<string, Row> }, today: CivilDate, canCreate: (groupId: string) => boolean): NewOp[] {
  const isoToday = formatIsoDate(today);
  const out: NewOp[] = [];
  for (const row of Object.values(t.tasks ?? {})) {
    const x = asTask(row);
    if (x.deleted_at !== null || x.completed_at !== null || x.rollover || x.deadline_mode !== 'own' || x.due_date === null || x.due_date >= isoToday) continue;
    if (!repeatOf(t, x.id) || t.tasks?.[nextId(x.id)] || !canCreate(x.group_id)) continue;
    out.push(...repeatOps(t, x, addDays(today, -1)));
  }
  return out;
}

/**
 * Ustawienie powtarzania; brak terminu = brak powtarzania (ekran wymaga terminu). Co miesiąc — z dniem miesiąca z terminu
 * (D137: „Przenieś zaległe” zmienia wtedy tylko ten jeden raz, kolejne znów tego dnia).
 */
export const setRepeat = (id: string, r: Repeat | null, dueDate?: string | null): NewOp => ({
  kind: 'patch',
  entity: 'tasks',
  id,
  set: { repeat: r ? formatRepeat(r.kind === 'monthly' && !r.day && dueDate ? { kind: 'monthly', day: Number(dueDate.slice(8, 10)) } : r) : null },
});
