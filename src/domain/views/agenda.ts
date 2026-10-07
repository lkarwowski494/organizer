/**
 * Plan dnia: wydarzenia i zadania jednego dnia w jednej kolejności. Najpierw całodniowe (wydarzenia, potem zadania
 * bez godziny), dalej wszystko z godziną rosnąco; przy tej samej godzinie wydarzenie przed zadaniem, potem tytuł.
 * Godziny z serwera mają sekundy („18:00:00”), z telefonu nie („18:00”) — porównujemy GG:MM.
 */
import type { Occurrence } from './events';
import type { TodayItem } from './index';

export type AgendaEntry = { kind: 'event'; key: string; event: Occurrence } | { kind: 'task'; key: string; task: TodayItem };

const hm = (t: string | null | undefined) => (t == null ? null : t.slice(0, 5));

export function agenda(tasks: TodayItem[], events: Occurrence[]): AgendaEntry[] {
  const all = [
    ...events.map((e) => ({ entry: { kind: 'event' as const, key: `e-${e.eventId}-${e.occurrenceDate}`, event: e }, time: hm(e.startTime), rank: 0, title: e.title })),
    ...tasks.map((x) => ({ entry: { kind: 'task' as const, key: `t-${x.id}`, task: x }, time: hm(x.due?.time), rank: 1, title: x.title })),
  ];
  all.sort(
    (a, b) =>
      (a.time === null ? 0 : 1) - (b.time === null ? 0 : 1) ||
      (a.time ?? '').localeCompare(b.time ?? '') ||
      a.rank - b.rank ||
      a.title.localeCompare(b.title, 'pl') ||
      a.entry.key.localeCompare(b.entry.key),
  );
  return all.map((x) => x.entry);
}
