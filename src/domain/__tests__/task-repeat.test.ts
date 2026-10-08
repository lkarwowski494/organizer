import { parseIsoDate } from '../format';
import { uuidv5 } from '../ids';
import type { Row } from '../sync-engine/client';
import { asTask } from '../views/model';
import { config } from '../../config';
import { expiredRepeatOps, formatRepeat, missingRepeatOps, nextDue, nextId, parseRepeat, REPEAT_NAMESPACE, repeatOf, repeatOps, type Repeat, setRepeat } from '../views/task-repeat';

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
