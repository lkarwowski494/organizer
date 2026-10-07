import { parseIsoDate } from '../format';
import { uuidv5 } from '../ids';
import type { Row } from '../sync-engine/client';
import { asTask } from '../views/model';
import { formatRepeat, nextDue, nextId, parseRepeat, REPEAT_NAMESPACE, repeatOf, repeatOps, type Repeat, setRepeat } from '../views/task-repeat';

const d = parseIsoDate;
const iso = (c: { y: number; m: number; d: number }) => `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;

describe('powtarzanie zadań (D76)', () => {
  it('zapis i odczyt reguł; nieznany zapis = brak powtarzania', () => {
    const cases: [Repeat, string][] = [
      [{ kind: 'daily' }, 'FREQ=DAILY'],
      [{ kind: 'weekly', days: [3, 0, 3] }, 'FREQ=WEEKLY;BYDAY=MO,TH'],
      [{ kind: 'monthly' }, 'FREQ=MONTHLY'],
      [{ kind: 'after', unit: 'DAILY', interval: 3 }, 'AFTER=DAILY;INTERVAL=3'],
      [{ kind: 'after', unit: 'WEEKLY', interval: 2 }, 'AFTER=WEEKLY;INTERVAL=2'],
    ];
    for (const [r, s] of cases) {
      expect(formatRepeat(r)).toBe(s);
      expect(formatRepeat(parseRepeat(s)!)).toBe(s);
    }
    expect(parseRepeat('FREQ=WEEKLY;BYDAY=MO,TH')).toEqual({ kind: 'weekly', days: [0, 3] });
    for (const s of [null, undefined, '', 'FREQ=YEARLY', 'AFTER=DAILY;INTERVAL=0', 'FREQ=WEEKLY;BYDAY=XX']) expect(parseRepeat(s)).toBeNull();
    expect(setRepeat('t', { kind: 'daily' })).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { repeat: 'FREQ=DAILY' } });
    expect(setRepeat('t', null)).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { repeat: null } });
    expect(nextId('t1')).toBe(uuidv5(REPEAT_NAMESPACE, 't1|next'));
  });

  // Oczekiwania policzone niezależnie: python-dateutil rrule(...).after(max(termin, wykonanie) + 1 dzień, inc=True).
  it.each([
    [{ kind: 'weekly', days: [0, 3] }, '2026-10-12', '2026-10-10', '2026-10-15'], // zrobione przed terminem
    [{ kind: 'weekly', days: [0, 3] }, '2026-10-12', '2026-10-21', '2026-10-22'], // zaległe — nie wraca w przeszłość
    [{ kind: 'monthly' }, '2026-01-31', '2026-01-31', '2026-03-31'], // luty bez 31. pominięty (RFC 5545)
    [{ kind: 'daily' }, '2026-10-07', '2026-10-07', '2026-10-08'],
    [{ kind: 'weekly', days: [0] }, '2026-10-14', '2026-10-14', '2026-10-19'], // termin poza dniem reguły
    [{ kind: 'after', unit: 'DAILY', interval: 3 }, '2026-10-07', '2026-10-09', '2026-10-12'],
    [{ kind: 'after', unit: 'WEEKLY', interval: 2 }, '2026-10-07', '2026-10-05', '2026-10-19'],
  ] as [Repeat, string, string, string][])('%j: termin %s, zrobione %s → %s', (r, due, done, next) => {
    expect(iso(nextDue(r, d(due), d(done)))).toBe(next);
  });

  const base = (extra: Row = {}): Row => ({
    id: 't1', group_id: 'g', list_id: 'l', parent_id: null, title: 'Śmieci', note: 'worki', sort_key: 'a1', assignee_member_id: 'm',
    deadline_mode: 'own', due_date: '2026-10-12', due_time: '07:00', rollover: true, repeat: 'FREQ=WEEKLY;BYDAY=MO', completed_at: null, deleted_at: null, ...extra,
  });

  it('odhaczenie tworzy następne zadanie ze stałym id; drugi raz — nic', () => {
    const t = { tasks: { t1: base() } as Record<string, Row> };
    const ops = repeatOps(t, asTask(t.tasks.t1!), d('2026-10-12'));
    expect(ops).toEqual([
      {
        kind: 'create', entity: 'tasks', id: nextId('t1'), group_id: 'g',
        set: { list_id: 'l', parent_id: null, title: 'Śmieci', note: 'worki', sort_key: 'a1', assignee_member_id: 'm', deadline_mode: 'own', due_date: '2026-10-19', due_time: '07:00', rollover: true, repeat: 'FREQ=WEEKLY;BYDAY=MO' },
      },
    ]);
    t.tasks[nextId('t1')] = base({ id: nextId('t1'), due_date: '2026-10-19' });
    expect(repeatOps(t, asTask(t.tasks.t1!), d('2026-10-12'))).toEqual([]);
  });

  it('cofnięcie odhaczenia usuwa nietkniętą kopię, ruszoną zostawia', () => {
    const t = { tasks: { t1: base({ completed_at: '2026-10-12T08:00:00Z' }), [nextId('t1')]: base({ id: nextId('t1') }) } as Record<string, Row> };
    expect(repeatOps(t, asTask(t.tasks.t1!), d('2026-10-12'))).toEqual([{ kind: 'delete', entity: 'tasks', id: nextId('t1') }]);
    t.tasks[nextId('t1')] = base({ id: nextId('t1'), completed_at: 'x' });
    expect(repeatOps(t, asTask(t.tasks.t1!), d('2026-10-12'))).toEqual([]);
    t.tasks[nextId('t1')] = base({ id: nextId('t1'), deleted_at: 'x' });
    expect(repeatOps(t, asTask(t.tasks.t1!), d('2026-10-12'))).toEqual([]);
    delete t.tasks[nextId('t1')];
    expect(repeatOps(t, asTask(t.tasks.t1!), d('2026-10-12'))).toEqual([]);
  });

  it('bez reguły, bez własnego terminu — nic', () => {
    for (const extra of [{ repeat: null }, { deadline_mode: 'inherit' }, { due_date: null }]) {
      const t = { tasks: { t1: base(extra) } };
      expect(repeatOps(t, asTask(t.tasks.t1), d('2026-10-12'))).toEqual([]);
    }
    expect(repeatOf({}, 'x')).toBeNull();
  });
});
