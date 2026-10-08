/**
 * Odświeżenie w tle po cichym powiadomieniu (D159): pobranie do bazy konta, plan przypomnień z zapisanych ustawień
 * i dojazdu, droga przez działającą aplikację, limit czasu, zadanie expo-notifications.
 */
import { config } from '../../config';
import { migrate } from '../../data/db/migrations';
import { readState, saveLocal } from '../../data/store';
import { memoryDb } from '../../data/__tests__/sqlite';
import type { PullResponse, Row } from '../../domain/sync-engine/client';
import type { Reminder } from '../../domain/views/reminders';
import type { SyncTransport } from '../../sync/transport';
import { refreshInBackground, registerWakeTask, setLiveSession, WAKE_TASK, type BackgroundDeps } from '../background';
import { localToMs } from '../clock';
import type { DevicePush } from '../push';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const U = 'u1';
// 7.10.2026 10:00 w Warszawie.
const NOW = localToMs({ y: 2026, m: 10, d: 7, hh: 10, mm: 0 });
const rows = (...r: [string, Row][]) => r.map(([e, row]) => ({ e, v: 1, row: { version: 1, ...row } })) as PullResponse['groups'][number]['rows'];
const page1 = rows(
  ['groups', { id: 'g', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null }],
  ['group_members', { member_id: 'm1', group_id: 'g', user_id: U, display_name: 'Ala', role: 'owner', deleted_at: null }],
  ['lists', { id: 'l', group_id: 'g', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null }],
);
const page2 = rows(
  ['tasks', { id: 't1', group_id: 'g', list_id: 'l', parent_id: null, title: 'Paczka', assignee_member_id: 'm1', deadline_mode: 'own', due_date: '2026-10-08', due_time: '17:30', completed_at: null, deleted_at: null, rollover: true }],
  ['events', { id: 'e1', group_id: 'g', title: 'Basen', start_date: '2026-10-07', start_time: '18:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: null, location: 'Pływalnia', kind: 'event', deleted_at: null }],
);

function transport(pages: PullResponse['groups'][number]['rows'][], fail = false): SyncTransport & { pulls: number } {
  const t = {
    pulls: 0,
    push: async () => ({ last_seq: 0, results: [] }),
    pull: async () => {
      if (fail) throw new Error('sieć');
      const i = t.pulls++;
      return { groups: [{ group_id: 'g', cursor: i + 1, has_more: i + 1 < pages.length, resync: false, rows: pages[i] ?? [] }], scopes: [] };
    },
    fetchScope: async () => [],
  };
  return t;
}

function push(status: 'granted' | 'denied' = 'granted') {
  const plans: Reminder[][] = [];
  const p = { status: async () => status, replaceReminders: jest.fn(async (l: Reminder[]) => void plans.push(l)) } as unknown as DevicePush;
  return { p, plans };
}

function deps(over: Partial<BackgroundDeps> = {}) {
  const db = memoryDb();
  migrate(db);
  const { p, plans } = push();
  const tr = transport([page1, page2]);
  const d: BackgroundDeps = {
    session: { current: async () => ({ userId: U, displayName: 'Ala' }), onChange: () => () => {} },
    transport: tr,
    openDb: () => db,
    newId: () => 'c-1',
    push: p,
    nowMs: () => NOW,
    ...over,
  };
  return { d, db, plans, tr };
}

describe('odświeżenie w tle (D159)', () => {
  it('aplikacja nie działa: pobranie wszystkich porcji do bazy konta i plan z zapisanych ustawień', async () => {
    const { d, db, plans, tr } = deps();
    saveLocal(db, 'pref.reminderSettings', JSON.stringify({ leadMin: 10, morning: 'off' }));
    expect(await refreshInBackground(d)).toBe('new');
    expect(tr.pulls).toBe(2);
    expect(readState(db, 'x').cursors).toEqual({ g: 2 });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.map((r) => [r.id, r.at])).toEqual([
      ['e|e1|2026-10-07|2026-10-07', localToMs({ y: 2026, m: 10, d: 7, hh: 17, mm: 50 })],
      ['t|t1|2026-10-08', localToMs({ y: 2026, m: 10, d: 8, hh: 17, mm: 20 })],
    ]);
  });

  it('„Czas wyjść” z ostatniego policzonego dojazdu (ten sam środek i miejsce), gdy dojazd włączony', async () => {
    const { d, db, plans } = deps();
    saveLocal(db, 'pref.travelEnabled', '1');
    saveLocal(db, 'pref.travelMode', 'walking');
    saveLocal(db, 'travelResults', JSON.stringify({ 'e1|2026-10-07': { seconds: 1200, mode: 'walking', location: 'Pływalnia' } }));
    await refreshInBackground(d);
    const leave = plans[0]!.find((r) => r.id.startsWith('l|'))!;
    // 18:00 − 20 min dojazdu − zapas.
    expect(leave.at).toBe(localToMs({ y: 2026, m: 10, d: 7, hh: 17, mm: 40 - config.travel.BUFFER_MIN }));
    // Inny środek dla tego wydarzenia (zmiana tylko u mnie) — wynik nieaktualny, zwykłe przypomnienie.
    saveLocal(db, 'travelModes', JSON.stringify({ e1: 'driving', zle: 'rower' }));
    await refreshInBackground(d);
    expect(plans[1]!.some((r) => r.id.startsWith('l|'))).toBe(false);
    // Dojazd wyłączony — też bez „Czas wyjść”; uszkodzony tryb — samochód.
    saveLocal(db, 'pref.travelMode', 'rower');
    saveLocal(db, 'travelModes', null);
    saveLocal(db, 'travelResults', JSON.stringify({ 'e1|2026-10-07': { seconds: 1200, mode: 'driving', location: 'Pływalnia' } }));
    await refreshInBackground(d);
    expect(plans[2]!.some((r) => r.id.startsWith('l|'))).toBe(true);
    saveLocal(db, 'pref.travelEnabled', '0');
    await refreshInBackground(d);
    expect(plans[3]!.some((r) => r.id.startsWith('l|'))).toBe(false);
  });

  it('bez sieci — plan z tym, co już jest; bez zgody albo bez modułu powiadomień — samo pobranie; bez sesji — nic', async () => {
    const offline = deps({ transport: transport([], true) });
    expect(await refreshInBackground(offline.d)).toBe('new');
    expect(offline.plans).toEqual([[]]);
    const denied = deps({ push: push('denied').p });
    expect(await refreshInBackground(denied.d)).toBe('new');
    expect(denied.tr.pulls).toBe(2);
    const none = deps({ push: undefined });
    expect(await refreshInBackground(none.d)).toBe('new');
    const out = deps({ session: { current: async () => null, onChange: () => () => {} } });
    expect(await refreshInBackground(out.d)).toBe('none');
    expect(out.tr.pulls).toBe(0);
  });

  it('limit porcji i czasu (Apple: 30 s na zadanie)', async () => {
    const many = Array.from({ length: config.wake.PULL_PAGES_MAX + 5 }, () => [] as PullResponse['groups'][number]['rows']);
    const tr = transport(many);
    await refreshInBackground(deps({ transport: tr }).d);
    expect(tr.pulls).toBe(config.wake.PULL_PAGES_MAX);
    let t = NOW;
    const slow = transport(many);
    await refreshInBackground(deps({ transport: slow, nowMs: () => (t += config.wake.TASK_BUDGET_MS / 2) }).d);
    expect(slow.pulls).toBe(1);
  });

  it('identyfikator instalacji jak przy starcie aplikacji (M-8): z pęku kluczy tego urządzenia, zapisany w bazie', async () => {
    let n = 0;
    const saved = new Map<string, string>();
    const device = { load: (u: string) => saved.get(u) ?? null, save: (u: string, id: string) => void saved.set(u, id) };
    const first = deps({ deviceClientId: device, newId: () => `id-${++n}` });
    await refreshInBackground(first.d);
    const id = saved.get(U)!;
    expect(readState(first.db, 'x').clientId).toBe(id);
    // Drugi raz: ten sam identyfikator, bez zmiany.
    await refreshInBackground(first.d);
    expect(saved.get(U)).toBe(id);
    expect(readState(first.db, 'x').clientId).toBe(id);
  });

  it('błąd bazy — „failed”', async () => {
    const { d } = deps({
      openDb: () => {
        throw new Error('dysk');
      },
    });
    expect(await refreshInBackground(d)).toBe('failed');
  });

  it('aplikacja działa z tym kontem: odświeża jej pętla (bez drugiego pisarza bazy); inne konto — jak bez aplikacji', async () => {
    const refresh = jest.fn(async () => {});
    const off = setLiveSession({ userId: U, refresh });
    const { d, tr } = deps();
    expect(await refreshInBackground(d)).toBe('new');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(tr.pulls).toBe(0);
    // Wyrejestrowanie innej sesji niczego nie zdejmuje.
    setLiveSession({ userId: 'u2', refresh })();
    off();
    const other = setLiveSession({ userId: 'u2', refresh });
    const again = deps();
    await refreshInBackground(again.d);
    expect(again.tr.pulls).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    other();
    // Odświeżenie, które nie kończy się w limicie czasu — zadanie i tak się kończy.
    const stuck = setLiveSession({ userId: U, refresh: () => new Promise<void>(() => {}) });
    const timers: number[] = [];
    expect(await refreshInBackground(d, (fn, ms) => (timers.push(ms), fn(), () => {}))).toBe('new');
    expect(timers).toEqual([config.wake.TASK_BUDGET_MS]);
    stuck();
  });

  it('zadanie expo-notifications: zdefiniowane i zarejestrowane; wynik dla iOS', async () => {
    const R = { NewData: 0, NoData: 1, Failed: 2 };
    let task: () => Promise<unknown> = async () => undefined;
    const tm = { defineTask: jest.fn((name: string, fn: () => Promise<unknown>) => void (task = fn)) };
    const n = { registerTaskAsync: jest.fn(async () => Promise.reject(new Error('bez trybu tła'))), BackgroundNotificationTaskResult: R };
    const live = deps();
    registerWakeTask(live.d, tm as never, n as never);
    expect(tm.defineTask.mock.calls[0]![0]).toBe(WAKE_TASK);
    expect(n.registerTaskAsync).toHaveBeenCalledWith(WAKE_TASK);
    expect(await task()).toBe(R.NewData);
    registerWakeTask(deps({ session: { current: async () => null, onChange: () => () => {} } }).d, tm as never, n as never);
    expect(await task()).toBe(R.NoData);
    registerWakeTask(deps({ session: { current: async () => Promise.reject(new Error('x')), onChange: () => () => {} } }).d, tm as never, n as never);
    expect(await task()).toBe(R.Failed);
  });
});
