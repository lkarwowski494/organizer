/**
 * Zadania na wystąpieniu wydarzenia (D13) i co z nimi, gdy spotkanie się zmienia (D14):
 *  - przeniesienie jednego wystąpienia — zadania idą za nim same (klucz = data według reguły, termin liczy resolver),
 *  - odwołanie / usunięcie — telefon pyta: przepnij na kolejne wystąpienie serii, na inne spotkanie, odepnij, usuń,
 *  - zmiana serii („to i następne”, „wszystkie”) — podgląd skutków: zadania z wystąpień, które zostają, przechodzą
 *    same; z wystąpień, które znikają — na najbliższe nowe wystąpienie albo odpięte (wybór w podglądzie). Przy „to
 *    i następne” wszystko to robi jedno polecenie split_event (także zrobione zadania — audyt 2, E-21).
 */
import { config } from '../../config';
import { addDays, formatIsoDate } from '../civil-date';
import { parseIsoDate } from '../format';
import { capUntil, ruleUntil } from '../event-chain';
import type { SplitArgs, SplitTask } from '../event-split';
import { occurrences, type Rule } from '../rrule';
import type { NewOp } from '../sync-engine/client';
import { type Due, effectiveDue } from '../deadlines';
import { asEvent, occurrenceResolver, ruleOf, seriesChain } from './event-rows';
import { type EventDetail, expandEvents, type Occurrence, type Scope } from './events';
import { asTask, rows, type Tables, type Task } from './model';

/** Jak daleko szukamy kolejnego wystąpienia / spotkań do wyboru (config.eventTasks). */
const { LOOKAHEAD_DAYS, PICKER_DAYS } = config.eventTasks;

/** Otwarte zadania podpięte do serii (opcjonalnie: tylko do jednego wystąpienia). */
export function attachedTasks(t: Tables, eventId: string, occurrenceDate?: string): Task[] {
  return rows(t, 'tasks', asTask)
    .filter((x) => x.deleted_at === null && x.completed_at === null && x.event_id === eventId && (occurrenceDate === undefined || x.occurrence_date === occurrenceDate))
    .sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

/**
 * Zadania wystąpienia na ekranie wydarzenia (audyt 2, M-130; PWD-7 A): otwarte i zrobione osobno, z własnym terminem
 * (termin zadania albo — przy „ze spotkania” — termin wystąpienia, effectiveDue), żeby wiersz był taki jak w Moich
 * sprawach, a licznik „1/3 zrobione” zgadzał się z tym, co widać.
 */
export function occurrenceTasks(t: Tables, eventId: string, occurrenceDate: string): { open: (Task & { due: Due })[]; done: (Task & { due: Due })[] } {
  const all = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const mine = all
    .filter((x) => x.event_id === eventId && x.occurrence_date === occurrenceDate)
    .sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id))
    .map((x) => ({ ...x, due: effectiveDue(x, byId, occ) }));
  return { open: mine.filter((x) => x.completed_at === null), done: mine.filter((x) => x.completed_at !== null) };
}

/** Zadania terminów, które znikają: cała seria i „ten i następne” — na całym łańcuchu (audyt 3, N-3), jak end_series. */
function inCancelScope(t: Tables, d: EventDetail, occurrenceDate: string, scope: Scope): Task[] {
  if (d.rule === null) return attachedTasks(t, d.event.id);
  if (scope === 'this') return attachedTasks(t, d.event.id, occurrenceDate);
  const parts = new Set(d.chain.map((p) => p.id));
  return chainTasks(t, parts).filter((x) => scope === 'all' || x.occurrence_date! >= occurrenceDate);
}

/** Otwarte zadania podpięte do którejkolwiek z części. */
function chainTasks(t: Tables, parts: ReadonlySet<string>): Task[] {
  return rows(t, 'tasks', asTask)
    .filter((x) => x.deleted_at === null && x.completed_at === null && x.event_id !== null && parts.has(x.event_id))
    .sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

/** Zadania podpięte pojedynczo, których dotyczy odwołanie / usunięcie — o nie pytamy (D14). */
export function affectedByCancel(t: Tables, d: EventDetail, occurrenceDate: string, scope: Scope): Task[] {
  return inCancelScope(t, d, occurrenceDate, scope).filter((x) => x.series_id === null);
}

/** Kopie stałych zadań serii (D65) z odwołanych wystąpień: usuwane bez pytania, bo należą do tamtego terminu. */
export function seriesCopiesCancelOps(t: Tables, d: EventDetail, occurrenceDate: string, scope: Scope): NewOp[] {
  return inCancelScope(t, d, occurrenceDate, scope)
    .filter((x) => x.series_id !== null)
    .map((x): NewOp => ({ kind: 'delete', entity: 'tasks', id: x.id }));
}

/**
 * Kolejne (nieodwołane) wystąpienie tej serii po danym dniu, albo `null` — także w następnej części po „to i następne”
 * (audyt 3): seria i jej część, do której należy termin (`eventId` do przepięcia zadań).
 */
export function nextInSeries(t: Tables, userId: string, eventId: string, after: string): { eventId: string; occurrenceDate: string } | null {
  const from = addDays(parseIsoDate(after), 1);
  const chain = seriesChain(t, eventId);
  const o = expandEvents(t, userId, from, addDays(from, LOOKAHEAD_DAYS)).find((x) => chain.has(x.eventId) && x.occurrenceDate > after);
  return o ? { eventId: o.eventId, occurrenceDate: o.occurrenceDate } : null;
}

/** Dzień kolejnego terminu serii (nextInSeries). */
export function nextOccurrence(t: Tables, userId: string, eventId: string, after: string): string | null {
  return nextInSeries(t, userId, eventId, after)?.occurrenceDate ?? null;
}

/** Spotkania grupy do wyboru (najbliższe tygodnie), bez wskazanego wystąpienia. */
export function upcomingInGroup(t: Tables, userId: string, groupId: string, from: string, skip?: { eventId: string; occurrenceDate: string }): Occurrence[] {
  const start = parseIsoDate(from);
  return expandEvents(t, userId, start, addDays(start, PICKER_DAYS)).filter((o) => o.groupId === groupId && !(skip && o.eventId === skip.eventId && o.occurrenceDate === skip.occurrenceDate));
}

export type Relink = { kind: 'occurrence'; eventId: string; occurrenceDate: string } | { kind: 'unlink' } | { kind: 'delete' };

/** Operacje przepięcia zadań. Odpięte zadanie z terminem „jak spotkanie” zostaje bez terminu (przypięte, D16). */
export function relinkOps(tasks: Task[], to: Relink): NewOp[] {
  return tasks.map((x): NewOp => {
    if (to.kind === 'delete') return { kind: 'delete', entity: 'tasks', id: x.id };
    if (to.kind === 'unlink') return { kind: 'patch', entity: 'tasks', id: x.id, set: { event_id: null, occurrence_date: null, ...(x.deadline_mode === 'event' ? { deadline_mode: 'none' } : {}) } };
    return { kind: 'patch', entity: 'tasks', id: x.id, set: { event_id: to.eventId, occurrence_date: to.occurrenceDate } };
  });
}

/** Nowe zadanie na wystąpieniu: termin jak spotkanie (D13). */
export function createEventTask(a: { id: string; groupId: string; listId: string; eventId: string; occurrenceDate: string; title: string; seriesId?: string }): NewOp {
  return {
    kind: 'create',
    entity: 'tasks',
    id: a.id,
    group_id: a.groupId,
    set: {
      list_id: a.listId,
      parent_id: null,
      title: a.title,
      sort_key: 'a0',
      deadline_mode: 'event',
      due_date: null,
      due_time: null,
      event_id: a.eventId,
      occurrence_date: a.occurrenceDate,
      ...(a.seriesId ? { series_id: a.seriesId } : {}),
    },
  };
}

/** Podpięcie istniejącego zadania do wystąpienia; termin od teraz „jak spotkanie”, bez powtarzania (powtarzanie wymaga
 * własnego terminu — ograniczenie tasks_repeat_needs_due; audyt 8.10.2026: wcześniej serwer odrzucał podpięcie). */
export function attachOps(task: Pick<Task, 'id'>, eventId: string, occurrenceDate: string): NewOp[] {
  return [{ kind: 'patch', entity: 'tasks', id: task.id, set: { event_id: eventId, occurrence_date: occurrenceDate, deadline_mode: 'event', due_date: null, due_time: null, repeat: null } }];
}

type Series = { id: string; start: string; rule: Rule | null; gone?: boolean };
const occursIn = (s: Series, date: string) => !s.gone && occurrences(parseIsoDate(s.start), s.rule, parseIsoDate(date), parseIsoDate(date)).length > 0;
const firstFrom = (s: Series, date: string) => {
  const d = parseIsoDate(date);
  const [first] = s.gone ? [] : occurrences(parseIsoDate(s.start), s.rule, d, addDays(d, LOOKAHEAD_DAYS));
  return first ? formatIsoDate(first) : null;
};

export type SeriesEffects = {
  /** Najbliższe wystąpienia po zmianie (od dnia zmiany), do podglądu — ze wszystkich zmienionych części łańcucha. */
  preview: string[];
  /** Zadania, których wystąpienie zostaje (przechodzą same, ewentualnie do nowej serii). */
  kept: Task[];
  /**
   * Zadania, których wystąpienie znika; `nearest` — najbliższe nowe wystąpienie od ich dnia (albo brak) w części `eventId`
   * (nowa seria albo zmieniona część łańcucha).
   */
  lost: { task: Task; nearest: string | null; eventId: string }[];
  /** Ile zmienionych pojedynczo terminów przepada, bo nowa seria ich nie ma (audyt 2, E-20). */
  overridesLost: number;
};

type SplitCmd = Extract<NewOp, { kind: 'cmd' }> & { args: SplitArgs };
const splitOf = (ops: readonly NewOp[]) => ops.find((o): o is SplitCmd => o.kind === 'cmd' && o.cmd === 'split_event');

/** Część łańcucha, której zadania zmiana dotyczy: skąd (`source`, od dnia `from`) i jaka seria z niej wychodzi. */
type Affected = { source: string; from: string | null; result: Series };

/** Seria z wiersza części po zmianie (`gone` — część do kosza). */
const seriesOfRow = (row: { [k: string]: unknown }, gone: boolean): Series => {
  const e = asEvent(row);
  return { id: e.id, start: e.start_date, rule: ruleOf(e), gone };
};

/**
 * Części po zmianie: przy „to i następne” nowa seria (z terminami dzielonej części od tego dnia, do końca tej części, gdy
 * są późniejsze — jak w poleceniu) i późniejsze części zmienione w tym samym poleceniu (audyt 3, N-22); przy „wszystkie”
 * każda zmieniona albo usuwana część łańcucha.
 */
function affected(d: EventDetail, occurrenceDate: string, ops: NewOp[]): Affected[] {
  type SetOp = Extract<NewOp, { kind: 'patch' }>;
  const byId = new Map(d.chain.map((p) => [p.id, p]));
  const split = splitOf(ops);
  if (split) {
    const later = d.chain.some((p) => p.start_date > d.event.start_date);
    const own: Affected = { source: d.event.id, from: occurrenceDate, result: { id: split.args.id, start: split.args.set.start_date, rule: ruleOf({ rrule: capUntil(split.args.set.rrule, later ? ruleUntil(d.event.rrule) : null) }) } };
    // Wpisy follow powstają z części łańcucha (editEvent), więc każda jest w d.chain.
    const follow = (split.args.follow ?? []).map((x): Affected => ({ source: x.id, from: null, result: seriesOfRow({ ...byId.get(x.id)!, ...x.set }, x.delete === true) }));
    return [own, ...follow];
  }
  const parts = [d.event, ...d.chain.filter((p) => p.id !== d.event.id && ops.some((o) => o.kind !== 'cmd' && o.entity === 'events' && o.id === p.id))];
  return parts.map((p) => {
    const patched = ops.find((o): o is SetOp => o.kind === 'patch' && o.entity === 'events' && o.id === p.id);
    return { source: p.id, from: null, result: seriesOfRow({ ...p, ...patched?.set }, ops.some((o) => o.kind === 'delete' && o.entity === 'events' && o.id === p.id)) };
  });
}

/** Skutki zmiany serii (podgląd przed zapisem) dla zadań podpiętych do wystąpień od `occurrenceDate` (albo wszystkich). */
export function seriesEditEffects(t: Tables, d: EventDetail, occurrenceDate: string, scope: Exclude<Scope, 'this'>, ops: NewOp[]): SeriesEffects {
  const parts = affected(d, occurrenceDate, ops);
  const first = parts[0]!.result;
  const p = parseIsoDate(scope === 'all' && first.rule !== null ? occurrenceDate : first.start);
  const preview = [...new Set(parts.flatMap(({ result: r }) => (r.gone ? [] : occurrences(parseIsoDate(r.start), r.rule, p, addDays(p, LOOKAHEAD_DAYS)).map(formatIsoDate))))].sort().slice(0, 3);
  const tasks = parts.flatMap((a) => attachedTasks(t, a.source).filter((x) => a.from === null || x.occurrence_date! >= a.from).map((task) => ({ task, to: a.result })));
  const splitDrops = splitOf(ops)?.args;
  return {
    preview,
    kept: tasks.filter((x) => occursIn(x.to, x.task.occurrence_date!)).map((x) => x.task),
    lost: tasks.filter((x) => !occursIn(x.to, x.task.occurrence_date!)).map(({ task, to }) => ({ task, nearest: firstFrom(to, task.occurrence_date!), eventId: to.id })),
    overridesLost: splitDrops
      ? splitDrops.drop_overrides.length + (splitDrops.follow ?? []).reduce((n, x) => n + (x.drop_overrides?.length ?? 0), 0)
      : ops.filter((o) => o.kind === 'delete' && o.entity === 'event_overrides').length,
  };
}

/**
 * Wszystkie operacje zmiany serii po podglądzie: zadania z wystąpień, które znikają — kopie stałych zadań do kosza, inne
 * na najbliższe nowe wystąpienie albo odpięte (wybór). Przy „to i następne” te decyzje idą w tym samym poleceniu
 * split_event (wszystko albo nic), a zadania z terminów, które zostają, przenosi samo polecenie.
 */
export function seriesEditOps(ops: NewOp[], effects: SeriesEffects, lost: 'nearest' | 'unlink'): NewOp[] {
  const split = splitOf(ops);
  if (split) {
    const tasks = effects.lost.map(({ task, nearest }): SplitTask =>
      task.series_id !== null ? { id: task.id, action: 'delete' } : lost === 'nearest' && nearest ? { id: task.id, action: 'relink', date: nearest } : { id: task.id, action: 'unlink' },
    );
    return ops.map((o) => (o === split ? { ...split, args: { ...split.args, tasks } } : o));
  }
  const out: NewOp[] = [...ops];
  for (const { task, nearest, eventId } of effects.lost) {
    // Kopia stałego zadania z terminu, który znika, nie przechodzi — na nowy termin powstanie własna kopia.
    if (task.series_id !== null) out.push({ kind: 'delete', entity: 'tasks', id: task.id });
    else out.push(...relinkOps([task], lost === 'nearest' && nearest ? { kind: 'occurrence', eventId, occurrenceDate: nearest } : { kind: 'unlink' }));
  }
  return out;
}
