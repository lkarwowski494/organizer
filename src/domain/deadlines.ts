/**
 * Terminy zadań (decyzje D13, D15, D16, D23; model danych: kolumny deadline_mode, due_date, due_time,
 * start_date w supabase/migrations/20261006120100_lists_tasks.sql).
 *
 *  - own:     własny termin zadania,
 *  - inherit: termin rodzica (D15: podzadanie dziedziczy, można przestawić na własny),
 *  - event:   termin wystąpienia wydarzenia, do którego zadanie jest podpięte (D13; idzie za spotkaniem po
 *             przeniesieniu). Wystąpienie odwołane albo nieistniejące = brak terminu (zadanie nie ginie, D14),
 *  - none:    bez terminu — przypięte na górze listy bez końca, bez przypomnień (D16).
 *  start_date („przypnij za X dni”) ukrywa zadanie do tego dnia; to nie jest termin. Funkcja bez UI — żaden ekran go nie
 *  ustawia; widoki liczą widoczność względem dnia, w którym zadanie stoi (visibleOnItsDay w views/index.ts; audyt 2, T-23).
 */
import { addDays, type CivilDate, compareDates, formatIsoDate } from './civil-date';

export type TaskTerms = {
  id: string;
  parent_id: string | null;
  deadline_mode: 'none' | 'own' | 'inherit' | 'event';
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  event_id: string | null;
  occurrence_date: string | null;
};

/** Termin wystąpienia (data po przeniesieniu, godzina startu); `null` = wystąpienia nie ma (odwołane, zmieniona seria). */
export type OccurrenceDue = (eventId: string, occurrenceDate: string) => Due;

export type Due = { date: string; time: string | null } | null;

/**
 * Efektywny termin. `byId` — zadania tej samej listy (rodzice). Cykl nie jest możliwy (serwer: move_task).
 * `occurrence` — termin wystąpienia wydarzenia (src/domain/views/event-rows.ts); bez niego tryb „event” = brak terminu.
 */
export function effectiveDue(task: TaskTerms, byId: ReadonlyMap<string, TaskTerms>, occurrence: OccurrenceDue = () => null): Due {
  let t: TaskTerms | undefined = task;
  // Ograniczenie kroków na wypadek uszkodzonych danych lokalnych: najwyżej MAX_TASK_DEPTH + 1 poziomów.
  for (let step = 0; t && step < 8; step++) {
    if (t.deadline_mode === 'own') return t.due_date === null ? null : { date: t.due_date, time: t.due_time };
    if (t.deadline_mode === 'none') return null;
    if (t.deadline_mode === 'event') return t.event_id === null || t.occurrence_date === null ? null : occurrence(t.event_id, t.occurrence_date);
    t = t.parent_id === null ? undefined : byId.get(t.parent_id);
  }
  return null;
}

const parse = (iso: string): CivilDate => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m, d };
};

/** Czy zadanie jest dziś widoczne (start_date ≤ dziś albo brak). */
export function isVisible(task: Pick<TaskTerms, 'start_date'>, today: CivilDate): boolean {
  return task.start_date === null || compareDates(parse(task.start_date), today) <= 0;
}

/** Kolejność na liście: przypięte (bez terminu) na górze, potem po terminie, zadania bez godziny przed godzinowymi tego dnia. */
export function compareByDue(a: Due, b: Due): number {
  if (a === null || b === null) return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.time === b.time) return 0;
  if (a.time === null) return -1;
  if (b.time === null) return 1;
  return a.time < b.time ? -1 : 1;
}

/**
 * D23, tryb „od wykonania”: następny termin = data ostatniego ukończenia + interwał; bez ukończeń — data kotwicy.
 * Funkcja zbioru ukończeń (bez stanu), więc wynik jest ten sam na każdym telefonie niezależnie od kolejności
 * synchronizacji (architektura: „Cykliczność: ukończenie to wiersz, nie przesunięcie daty”).
 * Interwały: dni i tygodnie. Miesiące — otwarte pytanie (co z 31 stycznia + 1 miesiąc), poza zakresem.
 */
export type AfterRule = { freq: 'DAILY' | 'WEEKLY'; interval: number };

export function nextAfterCompletion(anchor: string, completions: readonly string[], rule: AfterRule): string {
  if (!Number.isInteger(rule.interval) || rule.interval < 1) throw new RangeError('nextAfterCompletion: interwał ≥ 1');
  if (completions.length === 0) return anchor;
  const last = completions.reduce((m, c) => (c > m ? c : m));
  const days = rule.interval * (rule.freq === 'WEEKLY' ? 7 : 1);
  return formatIsoDate(addDays(parse(last), days));
}
