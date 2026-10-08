/**
 * Plan przypomnień na telefonie (D75, ADR 0016). Z tego, co dotyczy mnie (myDays, ten sam widok co „Moje sprawy”):
 *  - sprawa z godziną (zadanie, wydarzenie, zakupy): `leadMin` minut przed;
 *  - poranne podsumowanie o `morning` (D110): ile spraw na ten dzień, w tym zaległych, i pierwsze z nich — zaległe,
 *    bez godziny, potem z godziną („17:00 Tańce”). Wysyłane, gdy dzień ma cokolwiek (dawniej tylko sprawy bez godziny).
 * Tylko przyszłe chwile, najbliższe `max`. Zamiana czasu warszawskiego na chwilę — wstrzykiwana (`toMs`).
 */
import { addDays, type CivilDate, formatIsoDate, type LocalDateTime } from '../civil-date';
import { parseIsoDate } from '../format';
import { myDays } from './my-days';
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
  opts: { days: number; max: number; toMs: (t: LocalDateTime) => number; localDate: (iso: string) => string; label: { trip: (name: string) => string; morningTitle: string; more: (n: number) => string; summary: (n: number, overdue: number) => string } },
): Reminder[] {
  const out: Reminder[] = [];
  for (let k = 0; k < opts.days; k++) {
    const day = addDays(today, k);
    const iso = formatIsoDate(day);
    const view = myDays(t, userId, today, 'day', day, opts.localDate);
    const entries = view.days[0]!.entries;
    // Bez terminu (przypięte) nie przypominamy — codziennie to samo byłoby szumem.
    const untimed: string[] = [];
    const timed: string[] = [];
    let overdue = 0;
    for (const e of entries) {
      const title = e.kind === 'event' ? e.event.title : e.task.trip ? opts.label.trip(e.task.title) : e.task.title;
      // Zadania w dniu mają termin (myDays); odhaczone dziś i w przyszłości do widoku nie trafiają.
      const time = e.kind === 'event' ? e.event.startTime : e.kind === 'overdue' ? null : e.task.due!.time;
      if (e.kind === 'overdue') overdue++;
      if (time === null) {
        untimed.push(title);
        continue;
      }
      timed.push(`${time.slice(0, 5)} ${title}`);
      if (s.leadMin <= 0) continue;
      const at = opts.toMs({ ...parseIsoDate(iso), ...hm(time) }) - s.leadMin * 60_000;
      const group = e.kind === 'event' ? e.event.groupName : e.task.groupName;
      const key = e.kind === 'event' ? `e|${e.event.eventId}|${e.event.occurrenceDate}` : `t|${e.task.id}`;
      if (at > nowMs) out.push({ id: `${key}|${iso}`, at, title, body: `${time.slice(0, 5)} · ${group}` });
    }
    const all = [...untimed, ...timed];
    if (s.morning !== 'off' && all.length) {
      const at = opts.toMs({ ...parseIsoDate(iso), ...hm(s.morning) });
      const shown = all.slice(0, 4).join(', ');
      const list = all.length > 4 ? `${shown} ${opts.label.more(all.length - 4)}` : shown;
      if (at > nowMs) out.push({ id: `m|${iso}`, at, title: opts.label.morningTitle, body: `${opts.label.summary(all.length, overdue)}: ${list}` });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, opts.max);
}
