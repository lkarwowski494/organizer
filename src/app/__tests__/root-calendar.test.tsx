/**
 * Audyt 3 (N-4): kalendarze „Organizer – …” a wylogowanie na pełnym korzeniu aplikacji. Lista kalendarzy lustra tego
 * telefonu jest w pęku kluczy (AppServices.devicePrefs) — tam, skąd czyta ją wylogowanie (Root, removeMirrorCalendars).
 * Build 22 zapisywał ją w bazie konta, więc po wylogowaniu kalendarze zostawały w iPhonie.
 */
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { config } from '../../config';
import { memoryDb } from '../../data/__tests__/sqlite';
import { migrate } from '../../data/db/migrations';
import { saveLocal } from '../../data/store';
import type { PullResponse } from '../../domain/sync-engine/client';
import type { SyncTransport } from '../../sync/transport';
import { type RootDeps, Root, type Session } from '../Root';
import { fakeAccount } from './harness';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const ME = 'u-1';
const rows = [
  { e: 'groups' as const, v: 1, row: { id: ME, name: 'Osobiste', kind: 'personal', version: 1, created_at: '2026-01-01', deleted_at: null } },
  { e: 'group_members' as const, v: 2, row: { member_id: ME, group_id: ME, user_id: ME, display_name: 'Ala', role: 'owner', version: 2, deleted_at: null } },
  { e: 'events' as const, v: 3, row: { id: 'e1', group_id: ME, title: 'Basen', start_date: '2026-10-08', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, location: null, kind: 'event', days: 1, duration_min: null, version: 3, deleted_at: null } },
];

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => {} }) as never);
});
afterEach(() => jest.restoreAllMocks());

function makeDeps(calendars: Set<string>) {
  const listeners = new Set<(s: Session | null) => void>();
  const keychain = new Map<string, string>();
  let n = 0;
  const sync = {
    status: jest.fn(async () => 'granted' as const),
    request: jest.fn(async () => true),
    listEvents: jest.fn(async () => []),
    createCalendar: jest.fn(async () => {
      const id = `cal-${++n}`;
      calendars.add(id);
      return id;
    }),
    updateCalendar: jest.fn(async () => {}),
    hasCalendar: jest.fn(async (id: string) => calendars.has(id)),
    deleteCalendar: jest.fn(async (id: string) => void calendars.delete(id)),
    createEvent: jest.fn(async () => `ev-${++n}`),
    updateEvent: jest.fn(async () => {}),
    deleteEvent: jest.fn(async () => {}),
    hasEvent: jest.fn(async () => true),
  };
  const transport: SyncTransport = {
    push: async (req) => ({ last_seq: req.ops.at(-1)!.seq, results: req.ops.map((o) => ({ seq: o.seq, status: 'ok' as const })) }),
    pull: async (req) => {
      const since = req.cursors[ME]?.v ?? 0;
      const r = rows.filter((x) => x.v > since);
      return { groups: [{ group_id: ME, cursor: Math.max(since, ...r.map((x) => x.v)), has_more: false, resync: false, rows: r }], scopes: [] } satisfies PullResponse;
    },
    fetchScope: async () => [],
  };
  const dbs = new Map<string, ReturnType<typeof memoryDb>>();
  let i = 0;
  const deps: RootDeps = {
    session: { current: jest.fn(async () => ({ userId: ME, displayName: 'Ala' }) as Session), onChange: (fn) => (listeners.add(fn), () => void listeners.delete(fn)) },
    account: fakeAccount(),
    prefs: { get: async (k) => keychain.get(k) ?? null, set: async (k, v) => void keychain.set(k, v) },
    calendar: { add: jest.fn(async () => 'saved' as const), sync: sync as never },
    transport,
    openDb: (u) => dbs.get(u) ?? (dbs.set(u, memoryDb()), dbs.get(u)!),
    newId: () => `0199a3b4-0000-7000-8000-${String(++i).padStart(12, '0')}`,
    subscribe: () => () => {},
    links: { onUrl: () => () => {} },
    nowMs: () => Date.UTC(2026, 9, 8, 8, 0),
    setTimer: (fn) => {
      const t = setTimeout(fn, 0);
      return () => clearTimeout(t);
    },
  };
  const db = deps.openDb(ME) as ReturnType<typeof memoryDb>;
  migrate(db);
  // Lustro i odczyt włączone w ustawieniach konta (D175), wprowadzenie obejrzane.
  for (const k of ['welcomeSeen', 'calendarMirror', 'calendarRead']) saveLocal(db, `pref.${k}`, '1');
  const signOut = async () => {
    await act(async () => listeners.forEach((fn) => fn(null)));
    await act(async () => {});
  };
  return { deps, sync, keychain, db, signOut };
}

it('N-4: kalendarz lustra utworzony po zalogowaniu trafia na listę w pęku kluczy i znika z iPhone’a po wylogowaniu', async () => {
  const calendars = new Set<string>();
  const { deps, sync, keychain, db, signOut } = makeDeps(calendars);
  await render(<Root deps={deps} fontsLoaded />);
  await waitFor(() => expect(sync.createCalendar).toHaveBeenCalled(), { timeout: config.calendar.MIRROR_DEBOUNCE_MS + 5000 });
  await waitFor(() => expect(keychain.get('calendarMirrorOwned')).toBe('["cal-1"]'));
  // Nic w bazie konta (stąd lista nie przeżyłaby usunięcia konta ani reinstalacji).
  expect(db.all("select key from sync_state where key like '%calendarMirrorOwned%'")).toEqual([]);
  await signOut();
  await waitFor(() => expect(sync.deleteCalendar).toHaveBeenCalledWith('cal-1'));
  expect(calendars.size).toBe(0);
}, 20000);

it('N-4: lista zapisana przez build 22 w bazie konta przechodzi do pęku kluczy, a wylogowanie usuwa i te kalendarze', async () => {
  const calendars = new Set<string>(['cal-22']);
  const { deps, sync, keychain, db, signOut } = makeDeps(calendars);
  saveLocal(db, 'pref.calendarMirrorOwned', '["cal-22"]');
  await render(<Root deps={deps} fontsLoaded />);
  await waitFor(() => expect(keychain.get('calendarMirrorOwned')).toBeDefined());
  expect(JSON.parse(keychain.get('calendarMirrorOwned')!)).toContain('cal-22');
  expect(db.all("select key from sync_state where key like '%calendarMirrorOwned%'")).toEqual([]);
  await signOut();
  await waitFor(() => expect(sync.deleteCalendar).toHaveBeenCalledWith('cal-22'));
  expect(calendars.has('cal-22')).toBe(false);
}, 20000);
