/**
 * Plan przypomnień na telefonie (D75, ADR 0016). Z tego, co dotyczy mnie (myDays, ten sam widok co „Moje sprawy”):
 *  - sprawa z godziną (zadanie, wydarzenie, zakupy): `leadMin` minut przed; wydarzenie z policzonym dojazdem (D117) —
 *    zamiast tego „Czas wyjść” o godzinie wyjścia (`leaveFor`);
 *  - poranne podsumowanie o `morning` (D110): ile spraw na ten dzień, w tym zaległych, i pierwsze z nich — zaległe,
 *    bez godziny, potem z godziną („17:00 Tańce”). Wysyłane, gdy dzień ma cokolwiek (dawniej tylko sprawy bez godziny).
 * Tylko przyszłe chwile, najbliższe `max`. Zamiana czasu warszawskiego na chwilę — wstrzykiwana (`toMs`).
 * D134: podzadania i zadania wystąpienia stojące w planie pod rodzicem (nesting.ts) nie mają własnych przypomnień —
 * rodzic (wydarzenie albo zadanie) dostaje jedno, z ich listą w treści (także „Czas wyjść”); poranne podsumowanie
 * liczy tylko rodziców. Audyt 2 (N-2, N-3, T-20): zbiorcze przypomnienie nie może przyjść później niż własne —
 * podzadanie z własną godziną, którego rodzic nie ma przypomnienia (bez godziny, zaległy, całodniowy) albo ma je
 * później, dostaje własne (z dopiskiem rodzica) i liczy się w porannym podsumowaniu.
 */
import { config } from '../../config';
import { addDays, type CivilDate, formatIsoDate, type LocalDateTime } from '../civil-date';
import { parseIsoDate } from '../format';
import { type MyEntry, myDays } from './my-days';
import { nestEntries } from './nesting';
import type { Tables } from './model';

export type ReminderSettings = { leadMin: number; morning: string | 'off' };
export type Reminder = { id: string; at: number; title: string; body: string };

const hm = (t: string) => ({ hh: Number(t.slice(0, 2)), mm: Number(t.slice(3, 5)) });

export function planReminders(
  t: Tables,
  userId: string,
  today: CivilDate,
  nowMs: number,
  s: ReminderSettings,
  opts: { days: number; max: number; toMs: (t: LocalDateTime) => number; localDate: (iso: string) => string; label: { trip: (name: string) => string; morningTitle: string; more: (n: number) => string; summary: (n: number, overdue: number) => string; leave?: (title: string) => string; subtasks?: (titles: string[]) => string; parent?: (title: string, isEvent: boolean) => string };
    leaveFor?: (eventId: string, occurrenceDate: string) => { at: number; body: string } | null;
  },
): Reminder[] {
  const out: Reminder[] = [];
  for (let k = 0; k < opts.days; k++) {
    const day = addDays(today, k);
    const iso = formatIsoDate(day);
    const view = myDays(t, userId, today, 'day', day, opts.localDate);
    // Chwila własnego przypomnienia wpisu („Czas wyjść” albo `leadMin` przed) albo `null`.
    type Fire = { at: number; leave: { at: number; body: string } | null };
    const fires = new Map<string, Fire | null>();
    const fire = (e: MyEntry): Fire | null => {
      if (fires.has(e.key)) return fires.get(e.key)!;
      let f: Fire | null = null;
      const time = e.kind === 'event' ? e.event.startTime : e.kind === 'task' ? e.task.due!.time : null;
      if (time !== null) {
        const leave = e.kind === 'event' && opts.leaveFor ? opts.leaveFor(e.event.eventId, e.event.occurrenceDate) : null;
        if (leave) f = { at: leave.at, leave };
        else if (s.leadMin > 0) f = { at: opts.toMs({ ...parseIsoDate(iso), ...hm(time) }) - s.leadMin * 60_000, leave: null };
      }
      fires.set(e.key, f);
      return f;
    };
    // D134: wpis pod rodzicem trafia do przypomnienia najbliższego przodka, który je ma — chyba że to przyszłoby
    // później niż jego własne; wtedy przypomina sam (i niesie swoje podzadania).
    const nested = nestEntries(view.days[0]!.entries, t);
    const under = new Map<string, string[]>();
    const parentOf = new Map<string, MyEntry>();
    const holder: MyEntry[] = [];
    const entries: MyEntry[] = [];
    for (const n of nested) {
      const up = n.depth > 0 ? holder[n.depth - 1] : undefined;
      const own = fire(n.entry);
      if (up && (own === null || (fire(up) !== null && fire(up)!.at <= own.at))) {
        // Pod rodzicem stoją tylko zadania (nesting.ts).
        under.set(up.key, [...(under.get(up.key) ?? []), (n.entry as { task: { title: string } }).task.title]);
        holder[n.depth] = up;
        continue;
      }
      if (up) parentOf.set(n.entry.key, up);
      holder[n.depth] = n.entry;
      entries.push(n.entry);
    }
    const extra = (e: MyEntry) => {
      const list = under.get(e.key);
      const p = parentOf.get(e.key);
      const parent = p && p.kind !== 'lessons' && opts.label.parent ? ` · ${opts.label.parent(p.kind === 'event' ? p.event.title : p.task.title, p.kind === 'event')}` : '';
      return `${parent}${list && opts.label.subtasks ? ` · ${opts.label.subtasks(list)}` : ''}`;
    };
    // Bez terminu (przypięte) nie przypominamy — codziennie to samo byłoby szumem.
    const untimed: string[] = [];
    const timed: string[] = [];
    let overdue = 0;
    for (const e of entries) {
      // D127: zwinięte lekcje dziecka — bez przypomnień i bez miejsca w porannym podsumowaniu (codzienna rutyna szkoły).
      if (e.kind === 'lessons') continue;
      const title = e.kind === 'event' ? e.event.title : e.task.trip ? opts.label.trip(e.task.title) : e.task.title;
      // Zadania w dniu mają termin (myDays); odhaczone dziś i w przyszłości do widoku nie trafiają.
      const time = e.kind === 'event' ? e.event.startTime : e.kind === 'overdue' ? null : e.task.due!.time;
      if (e.kind === 'overdue') overdue++;
      if (time === null) {
        untimed.push(title);
        continue;
      }
      timed.push(`${time.slice(0, 5)} ${title}`);
      const f = fire(e);
      if (!f || f.at <= nowMs) continue;
      if (f.leave && e.kind === 'event') {
        out.push({ id: `l|${e.event.eventId}|${e.event.occurrenceDate}|${iso}`, at: f.at, title: opts.label.leave!(title), body: `${f.leave.body}${extra(e)}` });
        continue;
      }
      const group = e.kind === 'event' ? e.event.groupName : e.task.groupName;
      const key = e.kind === 'event' ? `e|${e.event.eventId}|${e.event.occurrenceDate}` : `t|${e.task.id}`;
      out.push({ id: `${key}|${iso}`, at: f.at, title, body: `${time.slice(0, 5)} · ${group}${extra(e)}` });
    }
    const all = [...untimed, ...timed];
    if (s.morning !== 'off' && all.length) {
      const at = opts.toMs({ ...parseIsoDate(iso), ...hm(s.morning) });
      const max = config.reminders.MORNING_LIST_MAX;
      const shown = all.slice(0, max).join(', ');
      const list = all.length > max ? `${shown} ${opts.label.more(all.length - max)}` : shown;
      if (at > nowMs) out.push({ id: `m|${iso}`, at, title: opts.label.morningTitle, body: `${opts.label.summary(all.length, overdue)}: ${list}` });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, opts.max);
}
