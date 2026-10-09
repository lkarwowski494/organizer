/** Retencja na telefonie (audyt 2, M-62, M-68): te same terminy co sprzątanie serwera. */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { config } from '../../config';
import { initialState } from '../sync-engine/client';
import { PURGED_ENTITIES, pruneExpired, retentionNow } from '../sync-engine/retention';

const NOW = Date.parse('2026-10-07T10:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('pruneExpired', () => {
  it('historia: starsza niż ACTIVITY_DAYS znika, młodsza i bez daty zostają', () => {
    const s = {
      ...initialState('c'),
      base: {
        activity: {
          old: { id: 'old', created_at: ago(config.retention.ACTIVITY_DAYS + 1) },
          edge: { id: 'edge', created_at: ago(config.retention.ACTIVITY_DAYS - 1) },
          nodate: { id: 'nodate' },
          now: { id: 'now', created_at: ago(0) },
        },
        tasks: { t: { id: 't', created_at: ago(1000) } },
      },
    };
    const out = pruneExpired(s, NOW);
    expect(Object.keys(out.base.activity!)).toEqual(['edge', 'nodate', 'now']);
    // Inne tabele bez zmian (ten sam obiekt).
    expect(out.base.tasks).toBe(s.base.tasks);
  });

  it('przekazania: rozstrzygnięte po HANDOFF_DAYS od decyzji znikają, oczekujące zostają', () => {
    const old = ago(config.retention.HANDOFF_DAYS + 1);
    const s = {
      ...initialState('c'),
      base: {
        handoffs: {
          a: { id: 'a', status: 'accepted', decided_at: old },
          d: { id: 'd', status: 'declined', decided_at: ago(1) },
          p: { id: 'p', status: 'pending', decided_at: old },
          n: { id: 'n', status: 'cancelled', decided_at: null },
        },
      },
    };
    expect(Object.keys(pruneExpired(s, NOW).base.handoffs!)).toEqual(['d', 'p', 'n']);
  });

  it('nic po terminie albo brak tabel — ten sam stan (bez zapisu)', () => {
    const empty = initialState('c');
    expect(pruneExpired(empty, NOW)).toBe(empty);
    const s = { ...empty, base: { activity: { a: { id: 'a', created_at: ago(1) } } } };
    expect(pruneExpired(s, NOW)).toBe(s);
  });
});

/** Audyt 3, N-89: nagrobki i zakupy po terminie znikają z telefonu jak na serwerze (private.purge_group). */
describe('pruneExpired: reguły sprzątania kosza z serwera', () => {
  const T = config.sync.TOMBSTONE_DAYS + config.retention.PURGE_LAG_DAYS;
  const old = ago(T + 1);
  const young = ago(T - 1);
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, group_id: 'g', deleted_at: null, ...extra });
  const keys = (s: { base: { [e: string]: { [k: string]: unknown } } }) =>
    Object.fromEntries(Object.entries(s.base).map(([e, rows]) => [e, Object.keys(rows).sort()] as const).filter(([, k]) => k.length > 0));
  const fresh = { now: { id: 'now', entity: 'tasks', entity_id: 'x', created_at: ago(0) } };

  it('kosz po TOMBSTONE_DAYS (+ dzień zapasu): zadania, wydarzenia z zależnymi, serie, listy, wpisy dostępu, zakupy i ich historia', () => {
    const s = {
      ...initialState('c'),
      base: {
        lists: { l: row('l'), lold: row('lold', { deleted_at: old }), lbusy: row('lbusy', { deleted_at: old }), lyoung: row('lyoung', { deleted_at: young }) },
        tasks: {
          t1: row('t1', { list_id: 'l', deleted_at: old }),
          t2: row('t2', { list_id: 'l', deleted_at: young }),
          // Rodzic po terminie z podzadaniem, które zostaje (żywe) — zostaje razem z nim.
          p: row('p', { list_id: 'l', deleted_at: old }),
          c: row('c', { list_id: 'l', parent_id: 'p' }),
          // Rodzic i podzadanie po terminie — oba znikają.
          p2: row('p2', { list_id: 'l', deleted_at: old }),
          c2: row('c2', { list_id: 'l', parent_id: 'p2', deleted_at: old }),
          // Zadanie z listy, która jeszcze nie może zniknąć.
          tb: row('tb', { list_id: 'lbusy', deleted_at: young }),
        },
        events: { e: row('e', { deleted_at: old }), ey: row('ey', { deleted_at: young }), live: row('live') },
        event_overrides: { o1: row('o1', { event_id: 'e' }), o2: row('o2', { event_id: 'live', deleted_at: old }), o3: row('o3', { event_id: 'live' }) },
        event_rsvps: { r1: row('r1', { event_id: 'e' }), r2: row('r2', { event_id: 'live' }) },
        event_participants: { x1: row('x1', { event_id: 'e' }), x2: row('x2', { event_id: 'ey', deleted_at: old }) },
        event_task_series: { s1: row('s1', { event_id: 'e', list_id: 'l' }), s2: row('s2', { event_id: 'live', list_id: 'lold' }), s3: row('s3', { event_id: 'live', list_id: 'l', deleted_at: young }) },
        object_members: { 'l:m1': { scope_id: 'l', member_id: 'm1', deleted_at: old }, 'l:m2': { scope_id: 'l', member_id: 'm2', deleted_at: null } },
        shopping_trips: {
          z1: row('z1', { list_id: 'l', done_at: ago(config.retention.TRIP_DAYS + config.retention.PURGE_LAG_DAYS + 1) }),
          z2: row('z2', { list_id: 'l', done_at: ago(config.retention.TRIP_DAYS - 1) }),
          z3: row('z3', { list_id: 'l', done_at: ago(1), deleted_at: old }),
          z4: row('z4', { list_id: 'lold', done_at: ago(1) }),
        },
        activity: {
          ...fresh,
          a1: { id: 'a1', entity: 'tasks', entity_id: 't1', created_at: ago(1) },
          a2: { id: 'a2', entity: 'tasks', entity_id: 't2', created_at: ago(1) },
          a3: { id: 'a3', entity: 'events', entity_id: 'e', created_at: ago(1) },
          a4: { id: 'a4', entity: 'object_members', entity_id: 'm1', scope_id: 'l', created_at: ago(1) },
          a5: { id: 'a5', entity: 'object_members', entity_id: 'm2', scope_id: 'l', created_at: ago(1) },
          a6: { id: 'a6', entity: 'tasks', entity_id: 'zzz', scope_id: 'lold', created_at: ago(1) },
          a7: { id: 'a7', entity: 'lists', entity_id: 'lold', created_at: ago(1) },
          a8: { id: 'a8', entity: 'event_overrides', entity_id: 'o1', created_at: ago(1) },
        },
      },
    };
    expect(keys(pruneExpired(s, NOW))).toEqual({
      lists: ['l', 'lbusy', 'lyoung'],
      tasks: ['c', 'p', 't2', 'tb'],
      events: ['ey', 'live'],
      event_overrides: ['o3'],
      event_rsvps: ['r2'],
      event_task_series: ['s3'],
      object_members: ['l:m2'],
      shopping_trips: ['z2'],
      activity: ['a2', 'a5', 'now'],
    });
  });

  it('wiersz wskazywany przez zostające zadanie (przypięte, kopia serii) czeka, aż serwer go odepnie', () => {
    const s = {
      ...initialState('c'),
      base: {
        activity: fresh,
        events: { e: row('e', { deleted_at: old }), e2: row('e2', { deleted_at: old }) },
        event_task_series: { s: row('s', { event_id: 'e2', list_id: 'l', deleted_at: old }) },
        tasks: {
          pin: row('pin', { list_id: 'l', event_id: 'e' }),
          copy: row('copy', { list_id: 'l', series_id: 's' }),
          // Przypięte, ale samo usuwane razem z wydarzeniem — nie blokuje.
          gone: row('gone', { list_id: 'l', event_id: 'e2', deleted_at: old }),
        },
      },
    };
    expect(keys(pruneExpired(s, NOW))).toEqual({ activity: ['now'], events: ['e'], event_task_series: ['s'], tasks: ['copy', 'pin'] });
    // Serwer odpiął (nowe wersje wierszy przyszły z pobraniem) — teraz znikają.
    const after = { ...s, base: { ...s.base, tasks: { pin: row('pin', { list_id: 'l', event_id: null }), copy: row('copy', { list_id: 'l', series_id: null }) } } };
    expect(keys(pruneExpired(after, NOW))).toEqual({ activity: ['now'], tasks: ['copy', 'pin'] });
  });

  it('dzień zapasu: nagrobek tuż po terminie serwera jeszcze zostaje', () => {
    const s = { ...initialState('c'), base: { activity: fresh, tasks: { t: row('t', { deleted_at: ago(config.sync.TOMBSTONE_DAYS + 0.5) }) } } };
    expect(pruneExpired(s, NOW)).toBe(s);
  });
});

/** Audyt 3, N-93: zegar przestawiony w przód nie kasuje historii, której serwer jeszcze nie skasował. */
describe('retentionNow: zegar telefonu ograniczony chwilą z serwera', () => {
  it('zegar o 100 dni w przód — „teraz” = najnowsza historia + CLOCK_SLACK_DAYS; historia i przekazania zostają', () => {
    const s = {
      ...initialState('c'),
      base: {
        activity: { a: { id: 'a', created_at: ago(10) }, b: { id: 'b', created_at: ago(0) }, bad: { id: 'bad', created_at: 'zła' } },
        handoffs: { h: { id: 'h', status: 'accepted', decided_at: ago(20) } },
      },
    };
    const future = NOW + 100 * 86_400_000;
    expect(retentionNow(s.base, future)).toBe(NOW + config.retention.CLOCK_SLACK_DAYS * 86_400_000);
    expect(pruneExpired(s, future)).toBe(s);
    // Zegar zgodny z serwerem albo spóźniony — bez zmian; bez historii — zegar telefonu.
    expect(retentionNow(s.base, NOW)).toBe(NOW);
    expect(retentionNow(s.base, NOW - 5)).toBe(NOW - 5);
    expect(retentionNow({}, future)).toBe(future);
  });
});

/** Kontrakt z serwerem: każda tabela, z której usuwa private.purge_group (ostatnia definicja), ma regułę na telefonie. */
describe('PURGED_ENTITIES = tabele czyszczone przez private.purge_group', () => {
  it('ta sama lista', () => {
    const dir = path.join(__dirname, '../../../supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const sql = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const defs = [...sql.matchAll(/create (?:or replace )?function private\.purge_group\(g uuid\)[\s\S]*?\nend \$\$;/g)];
    const last = defs.at(-1)![0];
    const tables = new Set([...last.matchAll(/delete from public\.(\w+)/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual([...PURGED_ENTITIES].sort());
  });
});
