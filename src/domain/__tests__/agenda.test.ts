import { agenda } from '../views/agenda';
import type { Occurrence } from '../views/events';
import type { TodayItem } from '../views';

const ev = (id: string, startTime: string | null, title = id): Occurrence => ({
  eventId: id,
  occurrenceDate: '2026-10-07',
  date: '2026-10-07',
  startTime,
  endTime: null,
  title,
  recurring: false,
  overrideId: null,
  groupId: 'g',
  groupName: 'G',
  line: 0,
  concernsMe: true,
  responsibleId: null,
  responsibleName: null,
  location: null,
});
const task = (id: string, time: string | null, title = id) => ({ id, title, due: { date: '2026-10-07', time } }) as unknown as TodayItem;
const keys = (xs: ReturnType<typeof agenda>) => xs.map((x) => x.key);

describe('plan dnia: całodniowe na górze, potem godziny po kolei', () => {
  it('wydarzenia i zadania przemieszane chronologicznie', () => {
    const out = agenda(
      [task('t18', '18:00:00'), task('tAll', null), task('t9', '09:00'), task('t1730', '17:30')],
      [ev('e17', '17:00:00'), ev('eAll', null), ev('e8', '08:15'), ev('e18', '18:00')],
    );
    expect(keys(out)).toEqual(['e-eAll-2026-10-07', 't-tAll', 'e-e8-2026-10-07', 't-t9', 'e-e17-2026-10-07', 't-t1730', 'e-e18-2026-10-07', 't-t18']);
  });

  it('ta sama pora i rodzaj: tytuł (po polsku), potem klucz; godzina z sekundami = bez sekund', () => {
    expect(keys(agenda([task('b', '10:00', 'Łyżwy'), task('a', '10:00:00', 'Lody'), task('c', null, 'Ż'), task('d', null, 'Ż')], []))).toEqual(['t-c', 't-d', 't-a', 't-b']);
    expect(keys(agenda([], [ev('y', null, 'X'), ev('x', null, 'X')]))).toEqual(['e-x-2026-10-07', 'e-y-2026-10-07']);
  });

  it('zadanie bez terminu (przypięte) liczy się jak całodniowe; wynik zawiera dane wpisu', () => {
    const t = { id: 'p', title: 'P', due: null } as unknown as TodayItem;
    const out = agenda([t], [ev('e', '07:00')]);
    expect(out[0]).toEqual({ kind: 'task', key: 't-p', task: t });
    expect(out[1]).toMatchObject({ kind: 'event', event: { eventId: 'e' } });
  });
});
