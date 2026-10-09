import * as fc from 'fast-check';

import { addDays, formatIsoDate } from '../civil-date';
import { parseIsoDate } from '../format';
import { uuidv5 } from '../ids';
import { applyOp, type Row } from '../sync-engine/client';
import { asTask } from '../views/model';
import { config } from '../../config';
import { copiesRepeats } from '../views';
import { cycleChange, cycleDateOps, expiredRepeatOps, orphanRepeatOps, withUpcomingCopies, formatRepeat, keepCycle, missingRepeatOps, nextDue, nextId, parseRepeat, REPEAT_NAMESPACE, repeatOf, repeatOps, type Repeat, setRepeat } from '../views/task-repeat';

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

  // Przykłady czytelne dla człowieka; pełny korpus z niezależnego wzorca (python-dateutil): nextdue-corpus.test.ts.
  it.each([
    [{ kind: 'weekly', days: [0, 3] }, '2026-10-12', '2026-10-10', '2026-10-15'], // zrobione przed terminem
    [{ kind: 'weekly', days: [0, 3] }, '2026-10-12', '2026-10-21', '2026-10-22'], // zaległe — nie wraca w przeszłość
    [{ kind: 'monthly' }, '2026-01-31', '2026-01-31', '2026-03-31'], // luty bez 31. pominięty (RFC 5545)
    [{ kind: 'daily' }, '2026-10-07', '2026-10-07', '2026-10-08'],
    // Decyzja właściciela z 8.10.2026: zaległe „codziennie” odhaczone dziś — następne jutro (dzisiejsze nie powstaje osobno).
    [{ kind: 'daily' }, '2026-10-05', '2026-10-08', '2026-10-09'],
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
    const t = {
      tasks: { t1: base() } as Record<string, Row>,
      lists: { l: { id: 'l', group_id: 'g', visibility: 'group', deleted_at: null } } as Record<string, Row>,
      group_members: { m: { member_id: 'm', group_id: 'g', role: 'member', deleted_at: null } } as Record<string, Row>,
    };
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

describe('D137: co miesiąc z dniem miesiąca', () => {
  it('zapis i odczyt; ustawienie bierze dzień z terminu; następny termin wraca do tego dnia po przeniesieniu', () => {
    expect(formatRepeat({ kind: 'monthly', day: 15 })).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(parseRepeat('FREQ=MONTHLY;BYMONTHDAY=15')).toEqual({ kind: 'monthly', day: 15 });
    expect(parseRepeat('FREQ=MONTHLY;BYMONTHDAY=32')).toBeNull();
    expect(setRepeat('t', { kind: 'monthly' }, '2026-10-15')).toMatchObject({ set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=15' } });
    expect(setRepeat('t', { kind: 'monthly', day: 3 }, '2026-10-15')).toMatchObject({ set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=3' } });
    expect(setRepeat('t', { kind: 'monthly' })).toMatchObject({ set: { repeat: 'FREQ=MONTHLY' } });
    // Czynsz 15., przeniesiony na 20.10 i odhaczony 20.10 → następny 15.11 (nie 20.11).
    expect(nextDue({ kind: 'monthly', day: 15 }, parseIsoDate('2026-10-20'), parseIsoDate('2026-10-20'))).toEqual(parseIsoDate('2026-11-15'));
  });
});

describe('PWD-37: ostatni dzień miesiąca (BYMONTHDAY=-1, RFC 5545 §3.3.10)', () => {
  it('zapis i odczyt; ustawienie nie podmienia dnia z terminu', () => {
    expect(formatRepeat({ kind: 'monthly', day: -1 })).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
    expect(parseRepeat('FREQ=MONTHLY;BYMONTHDAY=-1')).toEqual({ kind: 'monthly', day: -1 });
    expect(parseRepeat('FREQ=MONTHLY;BYMONTHDAY=-2')).toBeNull();
    expect(setRepeat('t', { kind: 'monthly', day: -1 }, '2026-10-31')).toMatchObject({ set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=-1' } });
  });

  // Oczekiwania policzone niezależnie: python-dateutil rrule(MONTHLY, bymonthday=-1).after(...) — luty 2027 ma 28 dni, 2028 — 29.
  it.each([
    ['2026-10-31', '2026-10-31', '2026-11-30'],
    ['2027-01-31', '2027-01-31', '2027-02-28'],
    ['2028-01-31', '2028-01-31', '2028-02-29'],
    ['2026-11-30', '2026-12-05', '2026-12-31'],
  ])('termin %s, zrobione %s → %s (żaden miesiąc nie przepada)', (due, done, next) => {
    expect(iso(nextDue({ kind: 'monthly', day: -1 }, d(due), d(done)))).toBe(next);
  });
});

describe('D181: zmiana terminu zadania powtarzanego — „Tylko ten raz / Też kolejne”', () => {
  it.each([
    // co tydzień: inny dzień tygodnia zmienia cykl; ten sam (o tydzień dalej) — nie
    [{ kind: 'weekly', days: [0] }, '2026-10-12', '2026-10-14', { kind: 'weekly', days: [2] }],
    [{ kind: 'weekly', days: [0, 3] }, '2026-10-12', '2026-10-13', { kind: 'weekly', days: [1, 3] }],
    [{ kind: 'weekly', days: [0, 3] }, '2026-10-12', '2026-10-15', { kind: 'weekly', days: [3] }],
    [{ kind: 'weekly', days: [0] }, '2026-10-12', '2026-10-19', null],
    [{ kind: 'weekly', days: [0] }, '2026-10-14', '2026-10-16', null], // termin już poza cyklem
    // co miesiąc: inny dzień miesiąca; zapis sprzed D137 (bez dnia) — dzień starego terminu
    [{ kind: 'monthly', day: 15 }, '2026-10-15', '2026-10-20', { kind: 'monthly', day: 20 }],
    [{ kind: 'monthly', day: 15 }, '2026-10-15', '2026-11-15', null],
    [{ kind: 'monthly', day: 15 }, '2026-10-20', '2026-10-22', null], // już przeniesione „tylko ten raz”
    [{ kind: 'monthly' }, '2026-10-15', '2026-10-20', { kind: 'monthly', day: 20 }],
    [{ kind: 'monthly' }, '2026-10-15', '2026-11-15', null],
    [{ kind: 'monthly', day: -1 }, '2026-10-31', '2026-11-30', null],
    [{ kind: 'monthly', day: -1 }, '2026-10-31', '2026-10-20', { kind: 'monthly', day: 20 }],
    [{ kind: 'monthly', day: -1 }, '2026-10-20', '2026-10-25', null],
    [{ kind: 'monthly', day: 30 }, '2026-10-30', '2026-10-31', { kind: 'monthly', day: 31 }],
    // bez cyklu w kalendarzu
    [{ kind: 'daily' }, '2026-10-12', '2026-10-14', null],
    [{ kind: 'after', unit: 'DAILY', interval: 3 }, '2026-10-12', '2026-10-14', null],
    [null, '2026-10-12', '2026-10-14', null],
  ] as [Repeat | null, string, string, Repeat | null][])('%j: %s → %s daje %j', (r, from, to, want) => {
    expect(cycleChange(r, from, to)).toEqual(want);
  });

  it('„Tylko ten raz”: zapis sprzed D137 dostaje dzień starego terminu, reszta bez zmian', () => {
    expect(keepCycle({ kind: 'monthly' }, '2026-10-15')).toEqual({ kind: 'monthly', day: 15 });
    expect(keepCycle({ kind: 'monthly', day: 15 }, '2026-10-15')).toBeNull();
    expect(keepCycle({ kind: 'weekly', days: [0] }, '2026-10-12')).toBeNull();
    expect(keepCycle(null, '2026-10-12')).toBeNull();
  });
});

describe('D133: powtarzanie po przeminięciu („Tylko tego dnia”)', () => {
  const T = (o: Row = {}): Row => ({ id: 'leki', group_id: 'g', list_id: 'l', parent_id: null, title: 'Leki', note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'own', due_date: '2026-10-05', due_time: '08:00', start_date: null, completed_at: null, deleted_at: null, rollover: false, repeat: 'FREQ=DAILY', ...o });
  const world = (tasks: Record<string, Row>) => ({ tasks, lists: { l: { id: 'l', group_id: 'g', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null } } as Record<string, Row> });
  const today = parseIsoDate('2026-10-08');
  it('minione niezrobione dostaje następne od dziś; raz', () => {
    const t = world({ leki: T() });
    const ops = expiredRepeatOps(t, today, () => true);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'create', id: nextId('leki'), set: { due_date: '2026-10-08', due_time: '08:00', repeat: 'FREQ=DAILY', rollover: false } });
    expect(expiredRepeatOps(world({ leki: T(), [nextId('leki')]: T({ id: nextId('leki'), due_date: '2026-10-08' }) }), today, () => true)).toEqual([]);
  });
  it('audyt 2 (T-19): „od wykonania” — następne dziś (nikt nie wykonał, więc nie ma od czego liczyć); według kalendarza — pierwszy dzień reguły od dziś', () => {
    const due = (repeat: string, due_date = '2026-10-05') => {
      const op = expiredRepeatOps(world({ leki: T({ repeat, due_date }) }), today, () => true)[0];
      return op?.kind === 'create' ? op.set.due_date : null;
    };
    expect(due('AFTER=WEEKLY;INTERVAL=1')).toBe('2026-10-08');
    expect(due('AFTER=DAILY;INTERVAL=3', '2026-10-07')).toBe('2026-10-08');
    expect(due('FREQ=WEEKLY;BYDAY=MO')).toBe('2026-10-12'); // 5.10 to poniedziałek; następny poniedziałek od dziś
    expect(due('FREQ=WEEKLY;BYDAY=TH')).toBe('2026-10-08'); // dziś czwartek
  });
  it('bez kopii: przechodzi dalej, zrobione, usunięte, dziś, bez powtarzania, termin po rodzicu, dziecko', () => {
    for (const o of [{ rollover: true }, { completed_at: 'x' }, { deleted_at: 'x' }, { due_date: '2026-10-08' }, { repeat: null }, { deadline_mode: 'inherit' }, { due_date: null }]) {
      expect(expiredRepeatOps(world({ leki: T(o) }), today, () => true)).toEqual([]);
    }
    expect(expiredRepeatOps(world({ leki: T() }), today, () => false)).toEqual([]);
    expect(expiredRepeatOps({}, today, () => true)).toEqual([]);
  });
  it('audyt 2 (T-2): bez kopii na liście usuniętej albo nieznanej i bez ponawiania kopii odrzuconej przez serwer', () => {
    const t = world({ leki: T() });
    t.lists.l = { ...t.lists.l!, deleted_at: 'x' };
    expect(expiredRepeatOps(t, today, () => true)).toEqual([]);
    expect(expiredRepeatOps({ tasks: { leki: T() } }, today, () => true)).toEqual([]);
    expect(expiredRepeatOps(world({ leki: T() }), today, () => true, new Set([nextId('leki')]))).toEqual([]);
  });
});

describe('audyt 3 (N-25): termin przeniesiony „Tylko ten raz” na wcześniej zastępuje swój dzień cyklu (RFC 5545 RECURRENCE-ID)', () => {
  const row = (extra: Row = {}): Row => ({
    id: 's', group_id: 'g', list_id: 'l', parent_id: null, title: 'Śmieci', note: null, sort_key: 'a0', assignee_member_id: null,
    deadline_mode: 'own', due_date: '2026-10-19', due_time: null, rollover: true, repeat: 'FREQ=WEEKLY;BYDAY=MO', cycle_date: null, completed_at: null, deleted_at: null, ...extra,
  });
  const t = (extra: Row = {}) => ({ tasks: { s: row(extra) } as Record<string, Row>, lists: { l: { id: 'l', group_id: 'g', visibility: 'group', deleted_at: null } } as Record<string, Row> });

  it('następny liczony od pierwotnego dnia, gdy przeniesiony jest wcześniej; później — od terminu', () => {
    // pn. 19.10 przeniesiony na czw. 15.10 i zrobiony 15.10 → pn. 26.10, nie znów 19.10
    expect(iso(nextDue({ kind: 'weekly', days: [0] }, d('2026-10-15'), d('2026-10-15'), d('2026-10-19')))).toBe('2026-10-26');
    // co miesiąc 15.: przeniesiony na 10.10 → 15.11
    expect(iso(nextDue({ kind: 'monthly', day: 15 }, d('2026-10-10'), d('2026-10-10'), d('2026-10-15')))).toBe('2026-11-15');
    // przeniesiony na później — pierwotny dzień nic nie zmienia
    expect(iso(nextDue({ kind: 'weekly', days: [0] }, d('2026-10-21'), d('2026-10-21'), d('2026-10-19')))).toBe('2026-10-26');
    // zaległe zrobione po pierwotnym dniu — od dnia wykonania
    expect(iso(nextDue({ kind: 'weekly', days: [0] }, d('2026-10-15'), d('2026-10-27'), d('2026-10-19')))).toBe('2026-11-02');
  });

  it('odhaczenie i D133 biorą pierwotny dzień z wiersza; kopia zaczyna bez niego', () => {
    const x = t({ due_date: '2026-10-15', cycle_date: '2026-10-19' });
    const ops = repeatOps(x, asTask(x.tasks.s!), d('2026-10-15'));
    expect(ops[0]).toMatchObject({ kind: 'create', set: { due_date: '2026-10-26' } });
    expect((ops[0] as { set: Row }).set.cycle_date).toBeUndefined();
    const gone = t({ due_date: '2026-10-15', cycle_date: '2026-10-19', rollover: false });
    expect(expiredRepeatOps(gone, d('2026-10-16'), () => true)[0]).toMatchObject({ set: { due_date: '2026-10-26' } });
  });

  it('zmiana terminu: „Tylko ten raz” na wcześniej zapamiętuje pierwotny dzień (raz), na później i „Też kolejne” — czyści', () => {
    const r: Repeat = { kind: 'weekly', days: [0] };
    const op = (cycle: string | null) => [{ kind: 'patch', entity: 'tasks', id: 's', set: { cycle_date: cycle } }];
    expect(cycleDateOps(asTask(row()), r, '2026-10-15', true)).toEqual(op('2026-10-19'));
    // drugi raz jeszcze wcześniej — dzień cyklu ten sam co za pierwszym razem
    expect(cycleDateOps(asTask(row({ due_date: '2026-10-15', cycle_date: '2026-10-19' })), r, '2026-10-13', true)).toEqual([]);
    expect(cycleDateOps(asTask(row({ due_date: '2026-10-15', cycle_date: '2026-10-19' })), r, '2026-10-21', true)).toEqual(op(null));
    expect(cycleDateOps(asTask(row({ due_date: '2026-10-15', cycle_date: '2026-10-19' })), { kind: 'weekly', days: [3] }, '2026-10-15', false)).toEqual(op(null));
    expect(cycleDateOps(asTask(row()), r, '2026-10-21', true)).toEqual([]);
    expect(cycleDateOps(asTask(row()), { kind: 'monthly', day: 19 }, '2026-10-10', true)).toEqual(op('2026-10-19'));
    // bez cyklu w kalendarzu albo bez własnego terminu — nic
    expect(cycleDateOps(asTask(row()), { kind: 'daily' }, '2026-10-15', true)).toEqual([]);
    expect(cycleDateOps(asTask(row()), { kind: 'after', unit: 'DAILY', interval: 2 }, '2026-10-15', true)).toEqual([]);
    expect(cycleDateOps(asTask(row()), null, '2026-10-15', true)).toEqual([]);
    expect(cycleDateOps(asTask(row({ deadline_mode: 'none', due_date: null })), r, '2026-10-15', true)).toEqual([]);
  });
});

describe('łańcuch powtarzania (audyt 2: T-1, T-3, T-4, T-12)', () => {
  const g = (): Record<string, Record<string, Row>> => ({
    groups: { g: { id: 'g', name: 'Rodzina', kind: 'shared', deleted_at: null } },
    group_members: {
      m: { member_id: 'm', group_id: 'g', user_id: 'u', display_name: 'Ja', role: 'admin', deleted_at: null },
      ala: { member_id: 'ala', group_id: 'g', user_id: 'u-ala', display_name: 'Ala', role: 'member', deleted_at: null },
    },
    lists: { l: { id: 'l', group_id: 'g', kind: 'tasks', name: 'Dom', visibility: 'group', owner_member_id: 'm', deleted_at: null } },
    tasks: { t1: { id: 't1', group_id: 'g', list_id: 'l', parent_id: null, title: 'Śmieci', note: null, sort_key: 'a1', assignee_member_id: 'ala', deadline_mode: 'own', due_date: '2026-10-12', due_time: null, rollover: true, repeat: 'FREQ=WEEKLY;BYDAY=MO', completed_at: null, deleted_at: null } },
  });
  const done = '2026-10-12T08:00:00Z';

  it('T-1: odhacz, cofnij, odhacz — kopia wraca z kosza z terminem', () => {
    const t = g();
    t.tasks![nextId('t1')] = { ...t.tasks!.t1!, id: nextId('t1'), due_date: '2026-10-19', deleted_at: 'pending' };
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))).toEqual([
      { kind: 'restore', entity: 'tasks', id: nextId('t1') },
      { kind: 'patch', entity: 'tasks', id: nextId('t1'), set: { due_date: '2026-10-19', due_time: null } },
    ]);
    // Kopia odhaczona i usunięta — zostaje, jak jest.
    t.tasks![nextId('t1')] = { ...t.tasks![nextId('t1')]!, completed_at: done };
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))).toEqual([]);
  });

  it('audyt 3 (N-25): kopia z kosza wraca bez pierwotnego dnia z dawnego przeniesienia', () => {
    const t = g();
    t.tasks![nextId('t1')] = { ...t.tasks!.t1!, id: nextId('t1'), due_date: '2026-10-15', cycle_date: '2026-10-19', deleted_at: 'pending' };
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))[1]).toEqual({ kind: 'patch', entity: 'tasks', id: nextId('t1'), set: { due_date: '2026-10-19', due_time: null, cycle_date: null } });
  });

  it('audyt 3 (Q16 A, N-123): dziecko z kontem dokłada i zdejmuje następne swojej sprawy; cudzej — nie', () => {
    const t = g();
    t.group_members!.kid = { member_id: 'kid', group_id: 'g', user_id: 'u-kid', display_name: 'Tymek', role: 'child', deleted_at: null };
    const can = copiesRepeats(t, 'u-kid');
    expect(can(asTask(t.tasks!.t1!))).toBe(false); // zadanie Ali
    t.tasks!.t1 = { ...t.tasks!.t1!, assignee_member_id: 'kid' };
    expect(copiesRepeats(t, 'u-kid')(asTask(t.tasks!.t1!))).toBe(true);
    expect(copiesRepeats(t, 'u')(asTask(t.tasks!.t1!))).toBe(true); // dorosły
    expect(copiesRepeats(t, 'u-obcy')(asTask(t.tasks!.t1!))).toBe(false);
    t.groups!.g = { ...t.groups!.g!, deleted_at: 'x' };
    expect(copiesRepeats(t, 'u')(asTask(t.tasks!.t1!))).toBe(false); // grupa w koszu
    expect(copiesRepeats({ ...t, groups: {} }, 'u')(asTask(t.tasks!.t1!))).toBe(false);
  });

  it('audyt 3 (N-123): następne, które zostało po cofnięciu odhaczenia na starszej wersji, znika — nietknięte, nie przy minionym „Tylko tego dnia”', () => {
    const t = g();
    const c = nextId('t1');
    t.tasks![c] = { ...t.tasks!.t1!, id: c, due_date: '2026-10-19' };
    t.tasks!.sub = { ...t.tasks!.t1!, id: 'sub', parent_id: c, repeat: null };
    const all = () => true;
    expect(orphanRepeatOps(t, d('2026-10-12'), all)).toEqual([{ kind: 'delete', entity: 'tasks', id: c }, { kind: 'delete', entity: 'tasks', id: 'sub' }]);
    // Ten telefon nie może, usunięcie już odrzucone, poprzednie zrobione albo w koszu — nic.
    expect(orphanRepeatOps(t, d('2026-10-12'), () => false)).toEqual([]);
    expect(orphanRepeatOps(t, d('2026-10-12'), all, new Set([c]))).toEqual([]);
    expect(orphanRepeatOps({ ...t, tasks: { ...t.tasks, t1: { ...t.tasks!.t1!, completed_at: done } } }, d('2026-10-12'), all)).toEqual([]);
    expect(orphanRepeatOps({ ...t, tasks: { ...t.tasks, t1: { ...t.tasks!.t1!, deleted_at: 'x' } } }, d('2026-10-12'), all)).toEqual([]);
    // Minione „Tylko tego dnia” ma następne z D133 — zostaje; dziś jeszcze trwa — znika.
    const once = { ...t, tasks: { ...t.tasks, t1: { ...t.tasks!.t1!, rollover: false } } };
    expect(orphanRepeatOps(once, d('2026-10-13'), all)).toEqual([]);
    expect(orphanRepeatOps(once, d('2026-10-12'), all)).toHaveLength(2);
    // Ruszone następne (odhaczone) zostaje; bez następnego, bez terminu — nic.
    expect(orphanRepeatOps({ ...t, tasks: { ...t.tasks, [c]: { ...t.tasks![c]!, completed_at: done } } }, d('2026-10-12'), all)).toEqual([]);
    expect(orphanRepeatOps(g(), d('2026-10-12'), all)).toEqual([]);
    expect(orphanRepeatOps({ ...t, tasks: { ...t.tasks, t1: { ...t.tasks!.t1!, deadline_mode: 'none', due_date: null } } }, d('2026-10-12'), all)).toEqual([]);
    expect(orphanRepeatOps({}, d('2026-10-12'), all)).toEqual([]);
  });

  it('audyt 3 (N-27): dane do planu przypomnień z następnymi, których jeszcze nie ma; wejściowe bez zmian', () => {
    const t = g();
    t.tasks!.t1 = { ...t.tasks!.t1!, repeat: 'FREQ=DAILY', rollover: false };
    t.tasks!.t2 = { ...t.tasks!.t1!, id: 't2', repeat: 'FREQ=DAILY', rollover: true, completed_at: done };
    for (const k of ['p1', 'p2']) t.tasks![k] = { ...t.tasks!.t1!, id: k, parent_id: 't1', repeat: null, deadline_mode: 'inherit', due_date: null };
    const out = withUpcomingCopies(t, d('2026-10-12'), 3, (iso) => iso.slice(0, 10));
    // Kopie podzadań idą z każdym kolejnym następnym.
    expect([nextId(nextId('p1')), nextId(nextId('p2'))].map((k) => out.tasks![k]?.parent_id)).toEqual([nextId(nextId('t1')), nextId(nextId('t1'))]);
    const c = nextId('t1');
    expect([out.tasks![c]?.due_date, out.tasks![nextId(c)]?.due_date, out.tasks![nextId(nextId(c))]]).toEqual(['2026-10-13', '2026-10-14', undefined]);
    expect(out.tasks![nextId('t2')]?.due_date).toBe('2026-10-13');
    expect(Object.keys(t.tasks!)).toEqual(['t1', 't2', 'p1', 'p2']);
    expect(withUpcomingCopies({}, d('2026-10-12'), 1, (iso) => iso)).toEqual({ tasks: {} });
  });

  it('audyt 3 (N-27, własność): przewidywanie = dokładanie dzień po dniu (missingRepeatOps, potem expiredRepeatOps każdego dnia)', () => {
    const naive = (t: Record<string, Record<string, Row>>, today: { y: number; m: number; d: number }, days: number, local: (iso: string) => string) => {
      const out = JSON.parse(JSON.stringify(t)) as Record<string, Record<string, Row>>;
      const put = (ops: ReturnType<typeof repeatOps>) => ops.forEach((op, i) => applyOp(out, { ...op, seq: i + 1, op_id: '' } as never));
      put(missingRepeatOps(out, today, () => true, local));
      for (let k = 0; k < days; k++) put(expiredRepeatOps(out, addDays(today, k), () => true));
      return out.tasks;
    };
    const item = fc.record({
      parent: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
      due: fc.integer({ min: -4, max: 6 }),
      rollover: fc.boolean(),
      done: fc.option(fc.integer({ min: -9, max: 0 }), { nil: null }),
      repeat: fc.constantFrom(null, 'FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,TH', 'AFTER=DAILY;INTERVAL=2'),
    });
    fc.assert(
      fc.property(fc.array(item, { maxLength: 6 }), fc.integer({ min: 1, max: 6 }), (items, days) => {
        const t = g();
        t.tasks = {};
        items.forEach((x, i) => {
          t.tasks![`k${i}`] = {
            ...g().tasks!.t1!, id: `k${i}`, title: `k${i}`, parent_id: x.parent !== null && x.parent < i ? `k${x.parent}` : null, due_date: formatIsoDate(addDays(d('2026-10-12'), x.due)),
            rollover: x.rollover, repeat: x.repeat, completed_at: x.done === null ? null : `${formatIsoDate(addDays(d('2026-10-12'), x.done))}T08:00:00Z`,
          };
        });
        const local = (iso: string) => iso.slice(0, 10);
        expect(withUpcomingCopies(t, d('2026-10-12'), days, local).tasks).toEqual(naive(t, d('2026-10-12'), days, local));
      }),
      { numRuns: 300 },
    );
  });

  it('T-3: kopia bez osoby usuniętej z grupy albo bez dostępu do listy; z dostępem — z osobą', () => {
    const t = g();
    const assignee = () => (repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))[0] as unknown as { set: { assignee_member_id: string | null } }).set.assignee_member_id;
    expect(assignee()).toBe('ala');
    t.group_members!.ala = { ...t.group_members!.ala!, deleted_at: 'x' };
    expect(assignee()).toBeNull();
    t.group_members!.ala = { ...t.group_members!.ala!, deleted_at: null };
    t.lists!.l = { ...t.lists!.l!, visibility: 'private' };
    expect(assignee()).toBeNull();
    t.lists!.l = { ...t.lists!.l!, visibility: 'restricted' };
    expect(assignee()).toBeNull();
    t.object_members = { o: { id: 'o', scope_entity: 'lists', scope_id: 'l', member_id: 'ala', deleted_at: null } };
    expect(assignee()).toBe('ala');
  });

  it('T-4: cofnięcie odhaczenia minionego „Tylko tego dnia” zostawia następne; bieżącego — zdejmuje', () => {
    const t = g();
    t.tasks!.t1 = { ...t.tasks!.t1!, rollover: false, completed_at: done };
    t.tasks![nextId('t1')] = { ...t.tasks!.t1!, id: nextId('t1'), due_date: '2026-10-19', completed_at: null };
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-14'))).toEqual([]);
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))).toEqual([{ kind: 'delete', entity: 'tasks', id: nextId('t1') }]);
  });

  it('T-12: dziecko nie tworzy kopii; dorosły dokłada brakującą — od dnia odhaczenia, tylko świeże odhaczenia', () => {
    const t = g();
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'), false)).toEqual([]);
    t.tasks!.t1 = { ...t.tasks!.t1!, completed_at: done };
    const local = (iso: string) => iso.slice(0, 10);
    const ops = missingRepeatOps(t, d('2026-10-13'), () => true, local);
    expect(ops).toEqual([expect.objectContaining({ kind: 'create', id: nextId('t1'), set: expect.objectContaining({ due_date: '2026-10-19', repeat: 'FREQ=WEEKLY;BYDAY=MO' }) })]);
    // Starsze niż MISSING_COPY_DAYS, grupa „nie moja”, kopia już jest, kopia odrzucona — nic.
    expect(missingRepeatOps(t, d('2026-10-12'), () => true, local, new Set([nextId('t1')]))).toEqual([]);
    expect(missingRepeatOps(t, d('2026-10-30'), () => true, local)).toEqual([]);
    expect(missingRepeatOps(t, d('2026-10-13'), () => false, local)).toEqual([]);
    t.tasks![nextId('t1')] = { ...t.tasks!.t1!, id: nextId('t1'), completed_at: null, deleted_at: 'x' };
    expect(missingRepeatOps(t, d('2026-10-13'), () => true, local)).toEqual([]);
    // Niezrobione — nie dla tej funkcji; puste dane — nic.
    expect(missingRepeatOps(g(), d('2026-10-13'), () => true, local)).toEqual([]);
    expect(missingRepeatOps({}, d('2026-10-13'), () => true, local)).toEqual([]);
  });

  it('okno brakujących kopii krótsze niż kosz (kopia wyczyszczona z kosza nie wraca)', () => {
    expect(config.repeat.MISSING_COPY_DAYS).toBeLessThan(config.sync.TOMBSTONE_DAYS);
  });
});

describe('kopie podzadań w następnym terminie (decyzja właściciela z 8.10.2026; audyt 2: T-13)', () => {
  const sub = (id: string, parent: string, sort: string, o: Row = {}): Row => ({ id, group_id: 'g', list_id: 'l', parent_id: parent, title: id, note: null, sort_key: sort, assignee_member_id: null, deadline_mode: 'inherit', due_date: null, due_time: null, rollover: true, completed_at: null, deleted_at: null, ...o });
  const g = (): Record<string, Record<string, Row>> => ({
    groups: { g: { id: 'g', name: 'Rodzina', kind: 'shared', deleted_at: null } },
    group_members: {
      m: { member_id: 'm', group_id: 'g', user_id: 'u', display_name: 'Ja', role: 'admin', deleted_at: null },
      ala: { member_id: 'ala', group_id: 'g', user_id: 'u-ala', display_name: 'Ala', role: 'member', deleted_at: null },
    },
    lists: { l: { id: 'l', group_id: 'g', kind: 'tasks', name: 'Dom', visibility: 'group', owner_member_id: 'm', deleted_at: null } },
    tasks: {
      t1: { id: 't1', group_id: 'g', list_id: 'l', parent_id: null, title: 'Sprzątanie', note: null, sort_key: 'a1', assignee_member_id: 'm', deadline_mode: 'own', due_date: '2026-10-12', due_time: '10:00', rollover: true, repeat: 'FREQ=WEEKLY;BYDAY=MO', completed_at: null, deleted_at: null },
      odk: sub('odk', 't1', 'a1', { note: 'też pod łóżkiem', assignee_member_id: 'ala' }),
      okna: sub('okna', 'odk', 'a1', { deadline_mode: 'none' }),
      kosz: sub('kosz', 't1', 'a2', { deadline_mode: 'own', due_date: '2026-10-11', due_time: '18:00', rollover: false, completed_at: '2026-10-11T17:00:00Z' }),
      tort: sub('tort', 't1', 'a3', { deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-12' }),
      stare: sub('stare', 't1', 'a0', { deleted_at: '2026-10-01T00:00:00Z' }),
      podstare: sub('podstare', 'stare', 'a0'),
    },
  });
  const N = nextId;
  const created = (ops: ReturnType<typeof repeatOps>) => ops.map((o) => (o.kind === 'create' ? [o.id, o.set.parent_id, o.set.deadline_mode, o.set.due_date ?? null] : o.kind === 'cmd' ? [o.kind] : [o.kind, o.id]));

  it('odhaczenie: następne z kopiami wszystkich żywych podzadań (niezrobione, tytuł, notatka, kolejność, osoba, terminy)', () => {
    const ops = repeatOps(g(), asTask(g().tasks!.t1!), d('2026-10-12'));
    expect(created(ops)).toEqual([
      [N('t1'), null, 'own', '2026-10-19'],
      [N('odk'), N('t1'), 'inherit', null],
      [N('okna'), N('odk'), 'none', null],
      [N('kosz'), N('t1'), 'own', '2026-10-18'], // własny termin przesunięty o tyle samo dni co zadanie
      [N('tort'), N('t1'), 'inherit', null], // termin ze spotkania (tamto już było) — jak nadrzędne
    ]);
    expect(ops[1]).toEqual({ kind: 'create', entity: 'tasks', id: N('odk'), group_id: 'g', set: { list_id: 'l', parent_id: N('t1'), title: 'odk', note: 'też pod łóżkiem', sort_key: 'a1', assignee_member_id: 'ala', deadline_mode: 'inherit', due_date: null, due_time: null, rollover: true } });
    expect(ops[3]).toMatchObject({ set: { due_time: '18:00', rollover: false } });
    expect(ops.some((o) => o.kind === 'create' && 'completed_at' in o.set)).toBe(false);
    // Osoba, która nie może dostać kopii (usunięta z grupy) — „nikt konkretny” (D132), jak przy kopii zadania.
    const t = g();
    t.group_members!.ala = { ...t.group_members!.ala!, deleted_at: 'x' };
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))[1]).toMatchObject({ set: { assignee_member_id: null } });
  });

  it('dwa telefony nie robią dwóch kopii; kopia zrobiona bez podzadań (starsza wersja) dostaje brakujące; odhaczona — nic', () => {
    const t = g();
    for (const o of repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))) if (o.kind === 'create') t.tasks![o.id] = { ...o.set, id: o.id, group_id: o.group_id, deleted_at: null };
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))).toEqual([]);
    delete t.tasks![N('okna')];
    delete t.tasks![N('kosz')];
    t.tasks![N('tort')] = { ...t.tasks![N('tort')]!, deleted_at: '2026-10-13T08:00:00Z' }; // ktoś usunął w następnym — nie wraca
    expect(created(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12')))).toEqual([
      [N('okna'), N('odk'), 'none', null],
      [N('kosz'), N('t1'), 'own', '2026-10-18'],
    ]);
    // Pod usuniętą kopią podzadania nic nie powstaje (serwer odrzuciłby deleted:parent).
    t.tasks![N('odk')] = { ...t.tasks![N('odk')]!, deleted_at: '2026-10-13T08:00:00Z' };
    expect(created(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12')))).toEqual([[N('kosz'), N('t1'), 'own', '2026-10-18']]);
    t.tasks![N('t1')] = { ...t.tasks![N('t1')]!, completed_at: '2026-10-19T08:00:00Z' };
    expect(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))).toEqual([]);
  });

  it('cofnięcie odhaczenia zdejmuje kopię razem z jej podzadaniami; ponowne odhaczenie przywraca te, które poszły z nią', () => {
    const t = g();
    for (const o of repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12'))) if (o.kind === 'create') t.tasks![o.id] = { ...o.set, id: o.id, group_id: o.group_id, deleted_at: null };
    t.tasks![N('kosz')] = { ...t.tasks![N('kosz')]!, completed_at: '2026-10-13T08:00:00Z' }; // ruszona — i tak idzie z rodzicem (jak kaskada serwera)
    t.tasks!.dodane = sub('dodane', N('t1'), 'a9'); // dodane już w następnym
    const undo = repeatOps(t, asTask({ ...t.tasks!.t1!, completed_at: '2026-10-12T08:00:00Z' }), d('2026-10-12'));
    expect(undo).toEqual([N('t1'), N('odk'), N('okna'), N('kosz'), N('tort'), 'dodane'].map((id) => ({ kind: 'delete', entity: 'tasks', id })));
    // W koszu z tym samym znacznikiem (cofnięcie) — wracają; usunięta wcześniej osobno — zostaje (jak tasks_cascade).
    for (const o of undo) if (o.kind === 'delete') t.tasks![o.id] = { ...t.tasks![o.id]!, deleted_at: 'pending' };
    t.tasks![N('tort')] = { ...t.tasks![N('tort')]!, deleted_at: '2026-10-12T09:00:00Z' };
    delete t.tasks![N('okna')];
    expect(created(repeatOps(t, asTask(t.tasks!.t1!), d('2026-10-12')))).toEqual([
      ['restore', N('t1')],
      ['patch', N('t1')],
      ['restore', N('odk')],
      ['restore', N('kosz')],
      ['restore', 'dodane'],
      [N('okna'), N('odk'), 'none', null],
    ]);
  });

  it('D133 (minione „Tylko tego dnia”) i kopia po odhaczeniu przez dziecko też mają podzadania; najwyżej MAX_TASK_DEPTH poziomów', () => {
    const t = g();
    t.tasks!.t1 = { ...t.tasks!.t1!, rollover: false, due_date: '2026-10-05' };
    expect(created(expiredRepeatOps(t, d('2026-10-08'), () => true)).map((x) => x[0])).toEqual([N('t1'), N('odk'), N('okna'), N('kosz'), N('tort')]);
    const u = g();
    u.tasks!.t1 = { ...u.tasks!.t1!, completed_at: '2026-10-12T08:00:00Z' };
    expect(missingRepeatOps(u, d('2026-10-12'), () => true, (iso) => iso.slice(0, 10))).toHaveLength(5);
    // Uszkodzone dane lokalne: poziom głębiej niż pozwala serwer — bez kopii (i bez pętli przy cyklu).
    const w = g();
    w.tasks!.za = sub('za', 'okna', 'a1');
    w.tasks!.cykl1 = sub('cykl1', 'cykl2', 'a1');
    w.tasks!.cykl2 = sub('cykl2', 'cykl1', 'a1');
    expect(created(repeatOps(w, asTask(w.tasks!.t1!), d('2026-10-12'))).map((x) => x[0])).toEqual([N('t1'), N('odk'), N('okna'), N('kosz'), N('tort')]);
  });
});
