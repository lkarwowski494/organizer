import * as fc from 'fast-check';

import { compareByDue, type Due, effectiveDue, isVisible, nextAfterCompletion, type TaskTerms } from '../deadlines';

const t = (o: Partial<TaskTerms> & { id: string }): TaskTerms => ({
  parent_id: null, deadline_mode: 'none', due_date: null, due_time: null, start_date: null, event_id: null, occurrence_date: null, ...o,
});
const map = (...ts: TaskTerms[]) => new Map(ts.map((x) => [x.id, x]));

describe('terminy', () => {
  it('termin z wystąpienia wydarzenia (D13), także dla podzadania; brak wystąpienia lub resolvera = bez terminu', () => {
    const occ = (id: string, d: string): Due => (id === 'ev' && d === '2026-10-12' ? { date: '2026-10-13', time: '17:00:00' } : null);
    const root = t({ id: 'r', deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-12' });
    const sub = t({ id: 's', parent_id: 'r', deadline_mode: 'inherit' });
    expect(effectiveDue(root, map(root), occ)).toEqual({ date: '2026-10-13', time: '17:00:00' });
    expect(effectiveDue(sub, map(root, sub), occ)).toEqual({ date: '2026-10-13', time: '17:00:00' });
    expect(effectiveDue(t({ id: 'x', deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-19' }), map(), occ)).toBeNull();
    expect(effectiveDue(root, map(root))).toBeNull();
    expect(effectiveDue(t({ id: 'y', deadline_mode: 'event' }), map(), occ)).toBeNull();
    expect(effectiveDue(t({ id: 'z', deadline_mode: 'event', event_id: 'ev' }), map(), occ)).toBeNull();
    // Własny termin przy zachowanym podpięciu wygrywa (D13).
    expect(effectiveDue(t({ id: 'o', deadline_mode: 'own', due_date: '2026-10-10', event_id: 'ev', occurrence_date: '2026-10-12' }), map(), occ)).toEqual({ date: '2026-10-10', time: null });
  });

  it('własny, brak, dziedziczony przez dwa poziomy (D15)', () => {
    const root = t({ id: 'r', deadline_mode: 'own', due_date: '2026-10-10', due_time: '18:00' });
    const sub = t({ id: 's', parent_id: 'r', deadline_mode: 'inherit' });
    const subsub = t({ id: 'ss', parent_id: 's', deadline_mode: 'inherit' });
    const own = t({ id: 'o', parent_id: 'r', deadline_mode: 'own', due_date: '2026-10-08' });
    const m = map(root, sub, subsub, own);
    expect(effectiveDue(subsub, m)).toEqual({ date: '2026-10-10', time: '18:00' });
    expect(effectiveDue(own, m)).toEqual({ date: '2026-10-08', time: null });
    expect(effectiveDue(t({ id: 'n' }), m)).toBeNull();
    // Rodzic bez terminu → podzadanie dziedziczące też bez terminu (przypięte).
    expect(effectiveDue(t({ id: 'x', parent_id: 'p', deadline_mode: 'inherit' }), map(t({ id: 'p' })))).toBeNull();
    // Zadanie główne z inherit (wydarzenie — Etap 4) albo brakujący rodzic: brak terminu.
    expect(effectiveDue(t({ id: 'y', deadline_mode: 'inherit' }), m)).toBeNull();
    expect(effectiveDue(t({ id: 'z', parent_id: 'brak', deadline_mode: 'inherit' }), m)).toBeNull();
    // Podzadanie bez terminu (none) NIE dziedziczy — jest przypięte, nawet gdy rodzic ma termin.
    expect(effectiveDue(t({ id: 'q', parent_id: 'r', deadline_mode: 'none' }), m)).toBeNull();
    // own bez daty (dane uszkodzone; serwer tego zabrania) — bez terminu zamiast wyjątku.
    expect(effectiveDue(t({ id: 'w', deadline_mode: 'own' }), m)).toBeNull();
  });

  it('uszkodzony cykl w danych lokalnych nie zawiesza aplikacji', () => {
    const a = t({ id: 'a', parent_id: 'b', deadline_mode: 'inherit' });
    const b = t({ id: 'b', parent_id: 'a', deadline_mode: 'inherit' });
    expect(effectiveDue(a, map(a, b))).toBeNull();
  });

  it('przypnij za X dni: niewidoczne do dnia startu', () => {
    const today = { y: 2026, m: 10, d: 7 };
    expect(isVisible({ start_date: null }, today)).toBe(true);
    expect(isVisible({ start_date: '2026-10-07' }, today)).toBe(true);
    expect(isVisible({ start_date: '2026-10-08' }, today)).toBe(false);
    expect(isVisible({ start_date: '2026-10-01' }, today)).toBe(true);
  });

  it('kolejność: przypięte na górze, potem po dacie, w dniu najpierw bez godziny', () => {
    const items: Due[] = [
      { date: '2026-10-09', time: '08:00' }, null, { date: '2026-10-08', time: null }, { date: '2026-10-09', time: null },
      { date: '2026-10-09', time: '07:00' }, null,
    ];
    expect([...items].sort(compareByDue)).toEqual([
      null, null, { date: '2026-10-08', time: null }, { date: '2026-10-09', time: null },
      { date: '2026-10-09', time: '07:00' }, { date: '2026-10-09', time: '08:00' },
    ]);
    expect(compareByDue({ date: '2026-10-09', time: '07:00' }, { date: '2026-10-09', time: '07:00' })).toBe(0);
    // Data ważniejsza niż godzina; bez godziny przed godziną także gdy porównujemy w odwrotnej kolejności.
    expect(compareByDue({ date: '2026-10-08', time: '09:00' }, { date: '2026-10-09', time: '07:00' })).toBe(-1);
    expect(compareByDue({ date: '2026-10-09', time: '07:00' }, { date: '2026-10-08', time: '09:00' })).toBe(1);
    expect(compareByDue({ date: '2026-10-09', time: '07:00' }, { date: '2026-10-09', time: null })).toBe(1);
    expect(compareByDue({ date: '2026-10-09', time: '07:00' }, { date: '2026-10-09', time: '06:00' })).toBe(1);
  });

  it('kolejność jest porządkiem (antysymetria, przechodniość)', () => {
    const due = fc.option(fc.record({ date: fc.constantFrom('2026-10-08', '2026-10-09'), time: fc.option(fc.constantFrom('07:00', '08:00')) }));
    fc.assert(fc.property(due, due, due, (a, b, c) => {
      expect(Math.sign(compareByDue(a, b))).toBe(-Math.sign(compareByDue(b, a)) || 0);
      if (compareByDue(a, b) <= 0 && compareByDue(b, c) <= 0) expect(compareByDue(a, c)).toBeLessThanOrEqual(0);
    }));
  });

  it('od wykonania (D23): kotwica, potem ostatnie ukończenie + interwał', () => {
    expect(nextAfterCompletion('2026-10-07', [], { freq: 'DAILY', interval: 3 })).toBe('2026-10-07');
    expect(nextAfterCompletion('2026-10-07', ['2026-10-09', '2026-10-12', '2026-10-10'], { freq: 'DAILY', interval: 3 })).toBe('2026-10-15');
    expect(nextAfterCompletion('2026-10-07', ['2026-12-30'], { freq: 'WEEKLY', interval: 2 })).toBe('2027-01-13');
    expect(nextAfterCompletion('2026-10-07', ['2026-10-10', '2026-10-10'], { freq: 'DAILY', interval: 1 })).toBe('2026-10-11');
    expect(() => nextAfterCompletion('2026-10-07', [], { freq: 'DAILY', interval: 1.5 })).toThrow('interwał');
    expect(() => nextAfterCompletion('2026-10-07', [], { freq: 'DAILY', interval: 0 })).toThrow(RangeError);
  });

  it('od wykonania: wynik nie zależy od kolejności ukończeń (zbieżność między telefonami)', () => {
    const date = fc.integer({ min: 0, max: 3000 }).map((n) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10));
    fc.assert(fc.property(fc.array(date, { minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 9 }), (cs, k) => {
      const rule = { freq: 'DAILY' as const, interval: k };
      const a = nextAfterCompletion('2026-01-01', cs, rule);
      expect(nextAfterCompletion('2026-01-01', [...cs].reverse(), rule)).toBe(a);
      const last = [...cs].sort().at(-1)!;
      expect((Date.parse(a) - Date.parse(last)) / 86_400_000).toBe(k);
    }));
  });
});
