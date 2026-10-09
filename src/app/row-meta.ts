/**
 * Opis wiersza zadania, zakupów i wydarzenia — jeden dla Moich spraw i Kalendarza (audyt 2, M-128, M-129): ta sama
 * godzina, osoba, seria, dopisek rodzica, „Wyjdź o …”, „zaległe od …” i „minęło”. W liście dnia przy zadaniu z terminem
 * tego dnia stoi tylko godzina (jak przy wydarzeniu), pełna data — gdy wpis stoi w innym dniu niż termin (zaległe, bez
 * terminu). Kolejność: czas, grupa, reszta (StationRow, EventRow). Świadome różnice: Kalendarz pokazuje też zrobione
 * w dniu terminu z dniem odhaczenia (D135, PWD-1 C) i przyszłe terminy zadań powtarzanych (PWD-15 A).
 */
import { useMemo } from 'react';

import { config } from '../config';
import { formatIsoDate } from '../domain/civil-date';
import { formatDue, formatTime } from '../domain/format';
import type { TodayItem } from '../domain/views';
import type { Occurrence } from '../domain/views/events';
import type { Nesting } from '../domain/views/nesting';
import { routineStreak, taskStreaks } from '../domain/views/routines';
import { rsvpView } from '../domain/views/rsvp';
import { personOf } from '../domain/views/who';
import { strings } from '../i18n/strings.pl';
import { META_SEP } from '../ui/components';
import { formatTime as clockTime, localNow } from './clock';
import { useAppData, useServices } from './context';
import { useTravel } from './travel';

/** Wpis zadania z polami Kalendarza (calendarMonth) albo zaległego (myDays) — wszystkie opcjonalne. */
export type RowTask = TodayItem & { doneOn?: string | null; projected?: boolean; expired?: boolean; overdueDays?: number };

export function useRowMeta() {
  const { userId } = useServices();
  const { tables, today } = useAppData();
  const travel = useTravel();
  // Seria liczy się z całej tabeli zadań — raz na stan danych, nie przy każdym wierszu.
  const taskSeries = useMemo(() => taskStreaks(tables, (iso) => formatIsoDate(localNow(Date.parse(iso)))), [tables]);
  const streak = (k: number) => (k >= config.streak.MIN_SHOWN ? [strings['streak'](k)] : []);
  const who = (memberId: string | null, kind: 'who.task' | 'who.event') => {
    const p = personOf(tables, userId, memberId);
    return p ? [strings[kind](p)] : [];
  };
  const progress = (n?: Nesting) => (n?.progress ? [strings['nest.progress'](n.progress.done, n.progress.total)] : []);
  return {
    /** `day` — dzień listy, w której stoi wiersz (zadanie z terminem tego dnia — sama godzina). */
    task(x: RowTask, day: string | null, n?: Nesting): { when?: string; meta: string[]; alert?: string } {
      const when = x.due === null ? strings['today.noDue'] : x.due.date === day ? (x.due.time === null ? undefined : formatTime(x.due.time)) : formatDue(x.due, today);
      const done = x.completed_at !== null;
      return {
        when,
        meta: [
          ...(n?.parent ? [strings['nest.parent'](n.parent.title, n.parent.kind === 'event')] : []),
          ...progress(n),
          ...(x.trip && !done ? [strings['trip.open'](x.trip.open)] : []),
          ...who(x.assignee_member_id, 'who.task'),
          ...(x.trip || x.projected ? [] : streak(taskSeries(x.id))),
          ...(x.doneOn ? [strings['calendar.doneOn'](formatDue({ date: x.doneOn, time: null }, today))] : []),
          ...(x.projected ? [strings['calendar.repeatNext']] : []),
        ],
        alert: x.expired ? strings['lists.expired'] : x.overdueDays ? strings['today.overdueDays'](x.overdueDays) : undefined,
      };
    },
    /** Dopiski wydarzenia (osoba, obecność, zadania, seria) i „Wyjdź o …” (D117, gdy dojazd jest policzony). */
    event(o: Occurrence, n?: Nesting): { extra?: string; alert?: string } {
      const v = rsvpView(tables, userId, o.eventId, o.occurrenceDate);
      const leave = travel.info(o.eventId, o.occurrenceDate);
      const extra = [
        ...who(o.responsibleId, 'who.event'),
        // D129: w wierszu tylko, gdy ktoś nie będzie (reszta w szczegółach).
        ...(v && v.counts.no ? [strings['rsvp.short'](v.counts)] : []),
        ...progress(n),
        ...streak(routineStreak(tables, o.eventId, today)),
      ];
      return {
        extra: extra.length ? extra.join(META_SEP) : undefined,
        alert: leave ? strings['travel.leave'](clockTime(leave.leaveMs), leave.minutes, strings[`travel.mode.${leave.mode}`]) : undefined,
      };
    },
  };
}
