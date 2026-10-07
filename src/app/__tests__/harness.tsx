/**
 * Wspólne środowisko testów ekranów: motyw (jasny lub ciemny), bezpieczne marginesy, usługi aplikacji
 * ze stanem w pamięci (ta sama logika co w aplikacji: mutate + materialize) i atrapą konta.
 */
import { NavigationContainer } from '@react-navigation/native';
import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Scheme } from '../../config/theme';
import type { LocalDateTime } from '../../domain/civil-date';
import { type ClientState, initialState, mutate, type NewOp, type Row } from '../../domain/sync-engine/client';
import type { Indicator } from '../../domain/sync-engine/scheduler';
import type { AccountApi } from '../../sync/account';
import type { Snapshot } from '../../sync/runtime';
import { ThemeProvider } from '../../ui/theme';
import { AppProvider, type AppServices } from '../context';

export const ME = 'u-me';
export const NOW: LocalDateTime = { y: 2026, m: 10, d: 7, hh: 10, mm: 0 };

type T = { [e: string]: { [id: string]: Row } };

export function put(t: T, e: string, key: string, row: Row) {
  (t[e] ??= {})[key] = row;
}

/** Dane: grupa osobista, „Rodzina” (ja = admin, Ala = owner, Kuba = dziecko), „Klasa 2b” (ja = member). */
export function sampleBase(): T {
  const t: T = {};
  put(t, 'groups', ME, { id: ME, name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null, version: 1 });
  put(t, 'groups', 'gk', { id: 'gk', name: 'Klasa 2b', kind: 'shared', created_at: '2026-03-01T00:00:00Z', deleted_at: null, version: 1 });
  const m = (id: string, g: string, user: string | null, name: string, role: string) =>
    put(t, 'group_members', id, { member_id: id, group_id: g, user_id: user, display_name: name, role, created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('mk', 'gk', ME, 'Łukasz', 'member');
  m('kx', 'gk', 'u-x', 'Pani Ewa', 'owner');
  const l = (id: string, g: string, name: string, kind = 'tasks') =>
    put(t, 'lists', id, { id, group_id: g, kind, name, visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: null, version: 1 });
  l('lp', ME, 'Moje');
  l('lf', 'gf', 'Dom');
  l('lz', 'gf', 'Zakupy na weekend', 'shopping');
  l('lk', 'gk', 'Szkoła');
  const task = (id: string, list: string, g: string, title: string, extra: Row = {}) =>
    put(t, 'tasks', id, {
      id, group_id: g, list_id: list, parent_id: null, title, note: null, sort_key: 'a0', assignee_member_id: null,
      deadline_mode: 'none', due_date: null, due_time: null, start_date: null, completed_at: null, deleted_at: null, version: 1, ...extra,
    });
  task('t-books', 'lp', ME, 'Oddać książki do biblioteki');
  task('t-korki', 'lk', 'gk', 'Przynieść korki na trening', { deadline_mode: 'own', due_date: '2026-10-07', due_time: '17:30:00' });
  task('t-paczka', 'lf', 'gf', 'Odebrać paczkę', { deadline_mode: 'own', due_date: '2026-10-07', due_time: '18:00:00', assignee_member_id: 'mf' });
  task('t-kwiaty', 'lf', 'gf', 'Kupić kwiaty', { deadline_mode: 'own', due_date: '2026-10-08' });
  task('t-ala', 'lf', 'gf', 'Zadanie Ali', { deadline_mode: 'own', due_date: '2026-10-07', assignee_member_id: 'ala' });
  task('s-chleb', 'lz', 'gf', 'Chleb żytni');
  task('s-maslo', 'lz', 'gf', 'Masło', { completed_at: '2026-10-07T08:00:00Z' });
  return t;
}

export function memoryStore(initial: ClientState, indicator: Indicator = { state: 'synced', since: null }) {
  let n = 0;
  let snap: Snapshot = { state: initial, indicator };
  const listeners = new Set<() => void>();
  const dispatched: NewOp[] = [];
  return {
    dispatched,
    getSnapshot: () => snap,
    subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
    dispatch: (op: NewOp | readonly NewOp[]) => {
      const ops: readonly NewOp[] = Array.isArray(op) ? op : [op as NewOp];
      dispatched.push(...ops);
      snap = { ...snap, state: ops.reduce((st, o) => mutate(st, o, () => `op-${++n}`), snap.state) };
      listeners.forEach((f) => f());
    },
    refresh: jest.fn(),
    setIndicator: (i: Indicator) => {
      snap = { ...snap, indicator: i };
      listeners.forEach((f) => f());
    },
  };
}

export function fakeAccount(over: Partial<AccountApi> = {}): jest.Mocked<AccountApi> {
  return {
    signInWithApple: jest.fn(async () => {}),
    sendMagicLink: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
    deleteAccount: jest.fn(async () => {}),
    createGroup: jest.fn(async () => {}),
    createInvite: jest.fn(async (groupId: string) => ({ inviteId: 'inv-1', token: 'tok', url: `io.github.lkarwowski494.organizer://invite/tok?g=${groupId}`, expiresAt: '2026-10-14T10:00:00Z', maxUses: 10 })),
    acceptInvite: jest.fn(async () => ({ groupId: 'gf' })),
    revokeInvite: jest.fn(async () => {}),
    deleteGroup: jest.fn(async () => {}),
    restoreGroup: jest.fn(async () => {}),
    transferOwnership: jest.fn(async () => {}),
    ...over,
  } as jest.Mocked<AccountApi>;
}

export function setup(opts: { base?: T; scheme?: Scheme; indicator?: Indicator; account?: jest.Mocked<AccountApi> } = {}) {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const state: ClientState = { ...initialState('c-test'), base: opts.base ?? sampleBase() };
  const store = memoryStore(state, opts.indicator);
  const account = opts.account ?? fakeAccount();
  let id = 0;
  const services: AppServices = {
    store,
    account,
    userId: ME,
    displayName: 'Łukasz',
    newId: () => `new-${++id}`,
    now: () => NOW,
    nowIso: () => '2026-10-07T08:00:00.000Z',
    nowMs: () => Date.UTC(2026, 9, 7, 8, 0),
  };
  const wrap = (ui: ReactElement) => (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ThemeProvider scheme={opts.scheme ?? 'light'}>
        <AppProvider services={services}>{ui}</AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return { store, account, services, wrap, renderApp: async (ui: ReactElement) => render(wrap(<NavigationContainer>{ui}</NavigationContainer>)) };
}

/** Okna systemowe (Alert.alert) w testach: ostatnie okno i dotknięcie jego przycisku. */
export function lastAlert(): { title: string; message?: string; buttons: AlertButton[] } {
  const calls = (Alert.alert as unknown as jest.Mock).mock.calls;
  const [title, message, buttons] = calls.at(-1) as [string, string | undefined, AlertButton[]];
  return { title, message, buttons };
}
export async function answerAlert(text: string) {
  const b = lastAlert().buttons.find((x) => x.text === text);
  if (!b) throw new Error(`brak przycisku ${text}`);
  await act(async () => b.onPress?.());
}
