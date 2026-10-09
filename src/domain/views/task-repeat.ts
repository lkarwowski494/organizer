/**
 * Powtarzanie zadań (D76, decyzja właściciela z 7.10.2026, ADR 0016). Zapis w `tasks.repeat`:
 *  - według kalendarza — reguła RRULE (RFC 5545, ten sam podzbiór co wydarzenia, src/domain/rrule.ts):
 *    „FREQ=DAILY”, „FREQ=WEEKLY;BYDAY=MO,TH”, „FREQ=MONTHLY;BYMONTHDAY=n” (ten sam dzień miesiąca co termin; miesiące
 *    bez tego dnia są pomijane, jak w RFC: „invalid date … is ignored”) albo „FREQ=MONTHLY;BYMONTHDAY=-1” — ostatni dzień
 *    miesiąca (decyzja właściciela 8.10.2026, PWD-37; RFC 5545 §3.3.10, https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10:
 *    „Valid values are 1 to 31 or -31 to -1. For example, -10 represents the tenth to the last day of the month”,
 *    przykład „Monthly on the first and last day of the month … BYMONTHDAY=1,-1”);
 *  - od wykonania (D23) — „AFTER=DAILY;INTERVAL=n” albo „AFTER=WEEKLY;INTERVAL=n”.
 * Odhaczenie zadania z powtarzaniem tworzy następne z kolejnym terminem; odhaczone zostaje jako historia.
 * Id następnego = uuidv5(id + „|next”), więc dwa telefony odhaczające naraz nie zrobią dwóch kopii (serwer: utworzenie
 * istniejącego id nic nie robi). Cofnięcie odhaczenia usuwa nietkniętą kopię. Następne dostaje kopie podzadań (decyzja
 * właściciela z 8.10.2026; wcześniej powstawało bez nich, a stare wisiały jako zaległe — audyt 2, T-13): `copyOps`.
 * Audyt 2:
 *  - T-1: ponowne odhaczenie przywraca kopię z kosza (cofnięcie ją tam odłożyło; inaczej powtarzanie by się kończyło);
 *  - T-3: kopia bez osoby, która nie może jej dostać (usunięta z grupy, nie widzi listy) — „nikt konkretny” (D132);
 *  - T-4: cofnięcie odhaczenia minionego „Tylko tego dnia” zostawia następne (D133 i tak by je zrobiło);
 *  - T-2, T-12: kopie robi tylko telefon, któremu serwer na to pozwoli (żywa grupa i lista, nie dziecko); kopię po
 *    odhaczeniu przez dziecko dokłada telefon dorosłego (`missingRepeatOps`); operacji raz odrzuconej telefon nie ponawia;
 *  - T-19: D133 przy „od wykonania” — następne na dziś (nikt nie wykonał, więc nie ma od czego liczyć interwału).
 * Audyt 3: N-24 (przewidywane terminy w Kalendarzu: upcomingDues), N-25 (pierwotny dzień przeniesionego terminu:
 * cycle_date), N-27 (plan przypomnień z następnymi, których jeszcze nie ma: withUpcomingCopies), Q16 A / N-123 (dziecko
 * z kontem robi i zdejmuje następne swojej sprawy; to, co zostało po starszej wersji, sprząta orphanRepeatOps).
 */
import { config } from '../../config';
import { addDays, type CivilDate, compareDates, daysInMonth, formatIsoDate, isoWeekday, toDayNumber } from '../civil-date';
import { nextAfterCompletion } from '../deadlines';
import { parseIsoDate } from '../format';
import { uuidv5 } from '../ids';
import { occurrences, parseRule, WEEKDAY_CODES } from '../rrule';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { asTask, type Tables, type Task } from './model';
import { descendants, subtasksOf } from './nesting';
import { memberCanSeeList } from './visibility';

export const REPEAT_NAMESPACE = 'e21c312a-9090-47c5-9490-c54305c7ddd1';
export const nextId = (taskId: string) => uuidv5(REPEAT_NAMESPACE, `${taskId}|next`);

export type Repeat =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] } // 0 = poniedziałek
  /** `day` — dzień miesiąca (D137), żeby przeniesienie terminu nie przesuwało cyklu; bez niego = dzień terminu; -1 = ostatni. */
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
  const m = /^FREQ=MONTHLY;BYMONTHDAY=([1-9]|[12]\d|3[01]|-1)$/.exec(s);
  if (m) return { kind: 'monthly', day: Number(m[1]) };
  const w = /^FREQ=WEEKLY;BYDAY=((?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*)$/.exec(s);
  if (w) return { kind: 'weekly', days: w[1]!.split(',').map((c) => WEEKDAY_CODES.indexOf(c as (typeof WEEKDAY_CODES)[number])) };
  return null;
}

/**
 * Następny termin po odhaczeniu w dniu `done`: według kalendarza — pierwszy dzień reguły po najpóźniejszym z (termin,
 * pierwotny dzień terminu `cycle`, dzień wykonania), więc zrobione wcześniej nie przeskakuje terminu, a zaległe nie wraca
 * w przeszłość; od wykonania — dzień wykonania + interwał.
 * Audyt 3 (N-25): termin przeniesiony „Tylko ten raz” na wcześniej zastępuje swój dzień cyklu, nie dokłada nowego —
 * RFC 5545 §3.8.4.4 (https://www.rfc-editor.org/rfc/rfc5545#section-3.8.4.4): „The "RECURRENCE-ID" property allows the
 * reference to an individual instance within the recurrence set”; bez `cycle` zrobione 15.10 zamiast pn. 19.10 wracało 19.10.
 */
export function nextDue(r: Repeat, due: CivilDate, done: CivilDate, cycle: CivilDate | null = null): CivilDate {
  if (r.kind === 'after') return parseIsoDate(nextAfterCompletion(formatIsoDate(due), [formatIsoDate(done)], { freq: r.unit, interval: r.interval }));
  const latest = [done, ...(cycle ? [cycle] : [])].reduce((a, b) => (compareDates(b, a) > 0 ? b : a), due);
  const from = addDays(latest, 1);
  const rule = parseRule(formatRepeat(r));
  // Reguła tygodniowa liczy tygodnie od startu; start = termin (dzień z reguły albo poza nią — wtedy pierwsze trafienie później).
  return occurrences(due, rule, from, addDays(from, config.repeat.NEXT_SEARCH_DAYS))[0]!;
}

/**
 * Odhaczenie (albo cofnięcie) zadania z powtarzaniem: operacje razem z samym odhaczeniem. `canCreate` — czy ten telefon
 * może dołożyć następne (CanCreate; dziecko — tylko swojej sprawy, Q16 A; inaczej dołoży je telefon dorosłego).
 */
export function repeatOps(t: Tables, task: Task, doneDate: CivilDate, canCreate = true): NewOp[] {
  const r = repeatOf(t, task.id);
  if (!r || task.due_date === null || task.deadline_mode !== 'own' || !canCreate) return [];
  if (task.completed_at === null) return copyOps(t, task, r, formatIsoDate(nextDue(r, parseIsoDate(task.due_date), doneDate, cycleOf(task))));
  // T-4: minione „Tylko tego dnia” i tak dostaje następne (D133) — cofnięcie go nie zdejmuje.
  if (!task.rollover && task.due_date < formatIsoDate(doneDate)) return [];
  // Cofnięcie: kopia jeszcze nietknięta — znika razem ze swoimi podzadaniami (serwer robi to kaskadą, tasks_cascade;
  // telefon od razu, żeby kopie podzadań nie zostały bez rodzica); ruszona (odhaczona, usunięta) zostaje.
  const id = nextId(task.id);
  const copy = t.tasks?.[id] ? asTask(t.tasks[id]!) : null;
  if (!copy || copy.completed_at !== null || copy.deleted_at !== null) return [];
  return [{ kind: 'delete', entity: 'tasks', id }, ...subtasksOf(t, id).map((x): NewOp => ({ kind: 'delete', entity: 'tasks', id: x.id }))];
}

/** Osoba kopii: tylko taka, która może ją dostać — inaczej „nikt konkretny” (D132, T-3). */
const visibleAssignee = (t: Tables, x: Task) => (x.assignee_member_id !== null && memberCanSeeList(t, x.assignee_member_id, x.list_id) ? x.assignee_member_id : null);

/**
 * Następne zadanie z terminem `due` i kopie podzadań (decyzja właściciela z 8.10.2026): wszystkie żywe podzadania — także
 * zrobione, kopia jest niezrobiona — z tymi samymi tytułami, notatkami i kolejnością, do `config.MAX_TASK_DEPTH` poziomów.
 * Id kopii podzadania = nextId(podzadania), więc dwa telefony nie zrobią dwóch. Termin podzadania: „jak nadrzędne” i „bez
 * terminu” zostają, własny przesuwa się o tyle dni co zadanie, „ze spotkania” (tamto już było) — „jak nadrzędne”.
 * Kopia zadania, która już jest, zostaje — dokładamy tylko brakujące kopie podzadań (np. zrobiona na starszej wersji
 * aplikacji); odhaczona — nic; w koszu (cofnięte odhaczenie, T-1) wraca z nowym terminem i z podzadaniami usuniętymi
 * razem z nią (jak kaskada przywrócenia na serwerze).
 */
function copyOps(t: Tables, task: Task, r: Repeat, due: string): NewOp[] {
  const id = nextId(task.id);
  const copy = t.tasks?.[id] ? asTask(t.tasks[id]!) : null;
  if (copy && copy.completed_at !== null) return [];
  const ops: NewOp[] = [];
  const mark = copy?.deleted_at ?? null;
  if (!copy)
    ops.push({
      kind: 'create',
      entity: 'tasks',
      id,
      group_id: task.group_id,
      set: { list_id: task.list_id, parent_id: task.parent_id, title: task.title, note: task.note, sort_key: task.sort_key, assignee_member_id: visibleAssignee(t, task), deadline_mode: 'own', due_date: due, due_time: task.due_time, rollover: task.rollover, repeat: formatRepeat(r) },
    });
  else if (mark !== null) {
    // Kopia z kosza zaczyna jak nowa — bez pierwotnego dnia z dawnego przeniesienia (N-25).
    ops.push({ kind: 'restore', entity: 'tasks', id }, { kind: 'patch', entity: 'tasks', id, set: { due_date: due, due_time: task.due_time, ...(copy!.cycle_date !== null ? { cycle_date: null } : {}) } });
    for (const x of descendants(t, id, (x) => x.deleted_at === mark)) ops.push({ kind: 'restore', entity: 'tasks', id: x.id });
  }
  // Żywe po tych operacjach: kopia i jej podzadania (obecne albo wracające z nią) — pod nimi mogą powstać brakujące.
  const alive = new Set([id, ...descendants(t, id, (x) => x.deleted_at === null || x.deleted_at === mark).map((x) => x.id)]);
  const shift = toDayNumber(parseIsoDate(due)) - toDayNumber(parseIsoDate(task.due_date!));
  for (const s of subtasksOf(t, task.id)) {
    const sid = nextId(s.id);
    const parent = nextId(s.parent_id!);
    if (t.tasks?.[sid] || !alive.has(parent)) continue;
    alive.add(sid);
    const own = s.deadline_mode === 'own' && s.due_date !== null;
    ops.push({
      kind: 'create',
      entity: 'tasks',
      id: sid,
      group_id: s.group_id,
      set: {
        list_id: s.list_id,
        parent_id: parent,
        title: s.title,
        note: s.note,
        sort_key: s.sort_key,
        assignee_member_id: visibleAssignee(t, s),
        deadline_mode: own ? 'own' : s.deadline_mode === 'none' ? 'none' : 'inherit',
        due_date: own ? formatIsoDate(addDays(parseIsoDate(s.due_date!), shift)) : null,
        due_time: own ? s.due_time : null,
        rollover: s.rollover,
      },
    });
  }
  return ops;
}

/** D133: pierwszy termin od dziś — według kalendarza pierwszy dzień reguły, od wykonania dziś (audyt 2, T-19). */
function firstDueFrom(r: Repeat, due: CivilDate, today: CivilDate, cycle: CivilDate | null): CivilDate {
  return r.kind === 'after' ? today : nextDue(r, due, addDays(today, -1), cycle);
}

/** Pierwotny dzień terminu przeniesionego „Tylko ten raz” (N-25) albo null. */
const cycleOf = (x: Task) => (x.cycle_date === null ? null : parseIsoDate(x.cycle_date));

/**
 * Audyt 3 (N-24): kolejne terminy otwartego zadania powtarzanego według kalendarza w oknie do `last` — te, które naprawdę
 * powstaną: pierwszy jak przy odhaczeniu dziś (nextDue: od jutra albo od dnia po terminie), minione „Tylko tego dnia” —
 * jak jego następne (D133, od dziś), dalej co dzień reguły. Od wykonania — nie da się przewidzieć. Zadanie, które ma już
 * następne, nie przewiduje nic — przewiduje to następne (bez dubli).
 */
export function upcomingDues(t: Tables, x: Task, today: CivilDate, last: CivilDate): CivilDate[] {
  const r = x.deadline_mode === 'own' && x.parent_id === null && x.completed_at === null ? repeatOf(t, x.id) : null;
  if (!r || r.kind === 'after' || x.due_date === null || t.tasks?.[nextId(x.id)]) return [];
  const due = parseIsoDate(x.due_date);
  const first = !x.rollover && compareDates(due, today) < 0 ? firstDueFrom(r, due, today, cycleOf(x)) : nextDue(r, due, today, cycleOf(x));
  return occurrences(due, parseRule(formatRepeat(r)), first, last);
}

/**
 * Czy ten telefon może dołożyć (albo zdjąć) następne zadania `x`: żywa grupa, w której nie jestem dzieckiem, albo — Q16 A
 * (audyt 3, N-123) — moje własne zadanie, gdy jestem dzieckiem (serwer: wyjątek w tasks_guard). Inaczej serwer odrzuci.
 */
export type CanCreate = (x: Task) => boolean;

/** Zadanie z powtarzaniem, któremu ten telefon może dołożyć kopię (żywa lista, `canCreate`). */
const copyable = (t: Tables, x: Task, canCreate: CanCreate, skip: ReadonlySet<string>) =>
  x.deleted_at === null &&
  x.deadline_mode === 'own' &&
  x.due_date !== null &&
  repeatOf(t, x.id) !== null &&
  !t.tasks?.[nextId(x.id)] &&
  !skip.has(nextId(x.id)) &&
  t.lists?.[x.list_id] !== undefined &&
  t.lists[x.list_id]!.deleted_at == null &&
  canCreate(x);

/**
 * D133: zadanie powtarzane z „Tylko tego dnia”, które minęło niezrobione, i tak dostaje następne — z pierwszym terminem
 * od dziś (opuszczone dni przepadają). Ten sam identyfikator co przy odhaczeniu (nextId), więc dwa telefony nie zrobią
 * dwóch kopii, a późniejsze odhaczenie starego nic nie dokłada. `canCreate` — jak w CanCreate (inaczej serwer odrzuci);
 * `skip` — kopie już odrzucone przez serwer (bez ponawiania w kółko, T-2).
 */
export function expiredRepeatOps(t: Tables, today: CivilDate, canCreate: CanCreate, skip: ReadonlySet<string> = new Set()): NewOp[] {
  const isoToday = formatIsoDate(today);
  const out: NewOp[] = [];
  for (const row of Object.values(t.tasks ?? {})) {
    const x = asTask(row);
    if (x.completed_at !== null || x.rollover || !copyable(t, x, canCreate, skip) || x.due_date! >= isoToday) continue;
    const r = repeatOf(t, x.id)!;
    out.push(...copyOps(t, x, r, formatIsoDate(firstDueFrom(r, parseIsoDate(x.due_date!), today, cycleOf(x)))));
  }
  return out;
}

/**
 * T-12: zadanie powtarzane odhaczone przez kogoś, kto nie mógł dołożyć następnego (dziecko), dostaje je na telefonie
 * dorosłego — liczone od dnia odhaczenia. Tylko odhaczenia z ostatnich `config.repeat.MISSING_COPY_DAYS` dni: kopia
 * usunięta i wyczyszczona z kosza (po `config.sync.TOMBSTONE_DAYS`) nie może wrócić.
 */
export function missingRepeatOps(t: Tables, today: CivilDate, canCreate: CanCreate, localDate: (iso: string) => string, skip: ReadonlySet<string> = new Set()): NewOp[] {
  const since = formatIsoDate(addDays(today, -config.repeat.MISSING_COPY_DAYS));
  const out: NewOp[] = [];
  for (const row of Object.values(t.tasks ?? {})) {
    const x = asTask(row);
    if (x.completed_at === null || !copyable(t, x, canCreate, skip)) continue;
    const done = localDate(x.completed_at);
    if (done < since) continue;
    out.push(...repeatOps(t, { ...x, completed_at: null }, parseIsoDate(done)));
  }
  return out;
}

/**
 * Audyt 3 (N-123, Q16 A): następne, które zostało po cofnięciu odhaczenia na telefonie, który nie mógł go zdjąć (dziecko
 * na starszej wersji aplikacji) — dwa otwarte terminy. Zdejmuje je telefon, który może (jak cofnięcie: nietknięte, razem
 * z podzadaniami). Nie dotyczy minionego „Tylko tego dnia” — jego następne zostaje (D133, T-4). `skip` — usunięcia już
 * odrzucone przez serwer.
 */
export function orphanRepeatOps(t: Tables, today: CivilDate, canCreate: CanCreate, skip: ReadonlySet<string> = new Set()): NewOp[] {
  const isoToday = formatIsoDate(today);
  const out: NewOp[] = [];
  for (const row of Object.values(t.tasks ?? {})) {
    const x = asTask(row);
    if (x.deleted_at !== null || x.completed_at !== null || x.parent_id !== null || (!x.rollover && x.due_date !== null && x.due_date < isoToday) || !canCreate(x)) continue;
    const id = nextId(x.id);
    if (skip.has(id) || !t.tasks?.[id]) continue;
    out.push(...repeatOps(t, { ...x, completed_at: 'x' }, today));
  }
  return out;
}

/**
 * Audyt 3 (N-27): dane z następnymi, które dołoży telefon przy otwarciu Moich spraw — D133 (minione „Tylko tego dnia”,
 * także te, które miną w ciągu `days` dni) i po odhaczeniu przez kogoś, kto nie mógł (missingRepeatOps). Do planu
 * przypomnień: następne o 8:00 ma przypomnienie, zanim ktokolwiek otworzy aplikację. Te same id (nextId) co później
 * prawdziwe kopie, więc plan się nie zmienia, gdy powstaną. Dokłada też to, czego ten telefon nie może zrobić sam
 * (dziecko na starszej wersji) — zrobi to inny telefon.
 */
export function withUpcomingCopies(t: Tables, today: CivilDate, days: number, localDate: (iso: string) => string): Tables {
  const tasks = { ...(t.tasks ?? {}) };
  const out = { ...t, tasks };
  const all = () => true;
  const put = (ops: NewOp[]) => {
    let seq = 0;
    for (const op of ops) applyOp(out as { [e: string]: { [id: string]: Row } }, { ...op, seq: ++seq, op_id: '' } as Op);
  };
  put(missingRepeatOps(out, today, all, localDate));
  for (let k = 0; k < days; k++) put(expiredRepeatOps(out, addDays(today, k), all));
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

/**
 * Zmiana terminu zadania powtarzanego (decyzja właściciela 8.10.2026, D181 / PW-32 A): telefon pyta „Tylko ten raz / Też
 * kolejne”, gdy nowy dzień zmienia cykl — co tydzień: inny dzień tygodnia; co miesiąc: inny dzień miesiąca. Codziennie
 * i „od wykonania” cyklu w kalendarzu nie mają, a termin już raz przeniesiony poza cykl (D137) nie wyznacza nowego —
 * wtedy pytania nie ma. Zwraca regułę dla „Też kolejne” albo null (bez pytania).
 *  - co tydzień: dzień starego terminu zamieniony na dzień nowego (inne dni zostają);
 *  - co miesiąc: dzień nowego terminu; ostatni dzień miesiąca zostaje ostatnim, gdy nowy termin też nim jest.
 */
export function cycleChange(r: Repeat | null, oldDate: string, newDate: string): Repeat | null {
  if (!r) return null;
  const from = parseIsoDate(oldDate);
  const to = parseIsoDate(newDate);
  const lastDay = (d: CivilDate) => d.d === daysInMonth(d.y, d.m);
  if (r.kind === 'weekly') {
    if (!r.days.includes(isoWeekday(from))) return null;
    const days = [...new Set(r.days.map((d) => (d === isoWeekday(from) ? isoWeekday(to) : d)))].sort((a, b) => a - b);
    return formatRepeat({ kind: 'weekly', days }) === formatRepeat(r) ? null : { kind: 'weekly', days };
  }
  if (r.kind !== 'monthly') return null;
  const onCycle = r.day === undefined || r.day === from.d || (r.day === -1 && lastDay(from));
  if (!onCycle) return null;
  const day = r.day === -1 && lastDay(to) ? -1 : to.d;
  return day === (r.day ?? from.d) ? null : { kind: 'monthly', day };
}

/**
 * Audyt 3 (N-25): pierwotny dzień terminu przy zmianie terminu zadania powtarzanego według kalendarza (co tydzień, co
 * miesiąc; codziennie i „od wykonania” cyklu w kalendarzu nie mają). Cykl zostaje („Tylko ten raz” albo zmiana bez
 * pytania, `keep`) i nowy termin jest przed dniem cyklu — zapamiętany dzień: dotychczasowy albo stary termin (drugie
 * przeniesienie nie przesuwa cyklu). Na później albo „Też kolejne” (nowy cykl) — bez pierwotnego dnia.
 */
export function cycleDateOps(task: Task, r: Repeat | null, newDate: string, keep: boolean): NewOp[] {
  if (r?.kind !== 'weekly' && r?.kind !== 'monthly') return [];
  if (task.deadline_mode !== 'own' || task.due_date === null) return [];
  const origin = task.cycle_date ?? task.due_date;
  const want = keep && newDate < origin ? origin : null;
  return want === task.cycle_date ? [] : [{ kind: 'patch', entity: 'tasks', id: task.id, set: { cycle_date: want } }];
}

/**
 * „Tylko ten raz” (D137): reguła, która trzyma dotychczasowy cykl po przeniesieniu terminu — co miesiąc bez zapisanego
 * dnia (zapis sprzed D137) dostaje dzień starego terminu; inaczej null (reguła już trzyma cykl).
 */
export function keepCycle(r: Repeat | null, oldDate: string): Repeat | null {
  return r?.kind === 'monthly' && r.day === undefined ? { kind: 'monthly', day: parseIsoDate(oldDate).d } : null;
}
