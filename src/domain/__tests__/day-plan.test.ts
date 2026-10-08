import { config } from '../../config';
import { dayPlan, type Span } from '../views/day-plan';
import { formatMinutes, minutesOf } from '../format';

type E = { id: string; depth: number; span: Span };
type D = { id: string; time: string | null; endTime: string | null };
const e = (id: string, start: string | null, end: string | null = null, depth = 0): E => ({ id, depth, span: { start, end } });
const d = (id: string, time: string | null, endTime: string | null = null): D => ({ id, time, endTime });
const plan = (es: E[], ds: D[], nowMin: number | null = null, gaps = true) =>
  dayPlan(es, ds, (x) => x.span, { nowMin, gaps }).map((r) => (r.kind === 'gap' ? `wolne ${formatMinutes(r.minutes)}` : r.item.id));

describe('lista z przerwami (D122)', () => {
  it('przykład z makiety: przerwy między sprawami, iPhone wpleciony po godzinie', () => {
    expect(
      plan(
        [e('kwiaty', '12:30'), e('odwiezc', '07:30'), e('tance', '17:00', '18:00'), e('basen', '19:00', '20:00'), e('spakowac', '19:00', '20:00', 1), e('smieci', '21:00')],
        [d('praca', '09:00', '12:00'), d('dentysta', '15:00', '16:00')],
      ),
    ).toEqual(['odwiezc', 'wolne 1 h 30 min', 'praca', 'wolne 30 min', 'kwiaty', 'wolne 2 h 30 min', 'dentysta', 'wolne 1 h', 'tance', 'wolne 1 h', 'basen', 'spakowac', 'wolne 1 h', 'smieci']);
  });

  it('bez godziny na początku (najpierw aplikacja, potem iPhone), kolejność wejścia zachowana', () => {
    expect(plan([e('a', null), e('b', '10:00'), e('c', null)], [d('x', null), d('y', '10:00')])).toEqual(['a', 'c', 'x', 'b', 'y']);
  });

  it('próg: krótsza przerwa ukryta, równa progowi pokazana', () => {
    const at = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const g = config.day.GAP_MIN;
    expect(plan([e('a', '10:00'), e('b', at(600 + g - 1))], [])).toEqual(['a', 'b']);
    expect(plan([e('a', '10:00'), e('b', at(600 + g))], [])).toEqual(['a', `wolne ${formatMinutes(g)}`, 'b']);
  });

  it('nakładanie: zajęte do najpóźniejszego końca; podzadanie nie liczy się do przerw', () => {
    expect(plan([e('dlugie', '09:00', '13:00'), e('krotkie', '10:00', '10:30'), e('sub', '23:00', null, 1), e('po', '14:00')], [])).toEqual(['dlugie', 'krotkie', 'sub', 'wolne 1 h', 'po']);
  });

  it('dziś: od teraz; minione przerwy znikają, bieżąca liczona od teraz', () => {
    const now = minutesOf('10:00');
    expect(plan([e('rano', '08:00'), e('poludnie', '12:00'), e('teraz', '10:15')], [], now)).toEqual(['rano', 'teraz', 'wolne 1 h 45 min', 'poludnie']);
    expect(plan([e('a', '11:00')], [], now)).toEqual(['wolne 1 h', 'a']);
  });

  it('bez przerw (miniony dzień, tydzień): wplecione, bez „wolne”; pusto: pusto; podzadanie bez rodzica zostaje', () => {
    expect(plan([e('a', '08:00'), e('b', '12:00')], [d('x', '10:00')], null, false)).toEqual(['a', 'x', 'b']);
    expect(plan([], [])).toEqual([]);
    expect(plan([e('sierota', '09:00', null, 1)], [])).toEqual(['sierota']);
  });
});
