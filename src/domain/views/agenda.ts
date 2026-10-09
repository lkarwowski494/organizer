/**
 * Plan dnia: wydarzenia i zadania jednego dnia w jednej kolejności. Najpierw całodniowe (wydarzenia, potem zadania
 * bez godziny), dalej wszystko z godziną rosnąco; przy tej samej godzinie wydarzenie przed zadaniem, potem tytuł.
 * Godziny z serwera mają sekundy („18:00:00”), z telefonu nie („18:00”) — porównujemy GG:MM.
 */
import { daySpan } from '../span';
import type { Occurrence } from './events';
import type { TodayItem } from './index';

/** D127: lekcje dziecka jednego dnia jako jeden wiersz („Kuba: 6 lekcji, 8:00–13:30”), rozwijany do pojedynczych. */
export type LessonBlock = { memberId: string; name: string; groupId: string; groupName: string; line: number; start: string | null; end: string | null; lessons: Occurrence[] };

/** Wpis kalendarza (bez zwijania lekcji). */
export type PlainEntry = { kind: 'event'; key: string; event: Occurrence } | { kind: 'task'; key: string; task: TodayItem };
export type AgendaEntry = PlainEntry | { kind: 'lessons'; key: string; block: LessonBlock };

const hm = (t: string | null | undefined) => (t == null ? null : t.slice(0, 5));

export function agenda(tasks: TodayItem[], events: Occurrence[]): PlainEntry[];
export function agenda(tasks: TodayItem[], events: Occurrence[], blocks: readonly LessonBlock[]): AgendaEntry[];
export function agenda(tasks: TodayItem[], events: Occurrence[], blocks: readonly LessonBlock[] = []): AgendaEntry[] {
  const all: { entry: AgendaEntry; time: string | null; rank: number; title: string }[] = [
    // D199: kolejny dzień wydarzenia przez północ stoi według godzin tego dnia (od 00:00).
    ...events.map((e) => ({ entry: { kind: 'event' as const, key: `e-${e.eventId}-${e.occurrenceDate}`, event: e }, time: hm(daySpan(e.startTime, e.endTime, e.part).start), rank: 0, title: e.title })),
    ...tasks.map((x) => ({ entry: { kind: 'task' as const, key: `t-${x.id}`, task: x }, time: hm(x.due?.time), rank: 1, title: x.title })),
    ...blocks.map((b) => ({ entry: { kind: 'lessons' as const, key: `l-${b.memberId}-${b.lessons[0]!.date}`, block: b }, time: hm(b.start), rank: 0, title: b.name })),
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
