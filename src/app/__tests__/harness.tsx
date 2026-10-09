/**
 * Wspólne środowisko testów ekranów: motyw (jasny lub ciemny), bezpieczne marginesy, usługi aplikacji
 * ze stanem w pamięci (ta sama logika co w aplikacji: mutate + materialize) i atrapą konta.
 *
 * Serwer reguł (audyt 2, M-50): każda operacja z ekranu przechodzi przez model reguł serwera
 * (src/domain/server-rules.ts, zgodny z SQL — tests/db/rules-vs-sql.test.ts) na kopii danych serwera. Operacja, którą
 * serwer by odrzucił, oblewa test (afterEach), chyba że test ją zapowie: `store.expectRejected('kod')`. Odrzucone
 * operacje zostają w kolejce telefonu (jak w aplikacji — o odrzuceniu telefon dowie się z odpowiedzi serwera).
 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, type AlertButton, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MONTHS_NOMINATIVE } from '../../config/calendar.pl';
import type { Scheme } from '../../config/theme';
import type { LocalDateTime } from '../../domain/civil-date';
import { formatLongDate, parseIsoDate } from '../../domain/format';
import { applyOnServer, serverVerdict } from '../../domain/server-rules';
import { type ClientState, initialState, mutate, type NewOp, type Row } from '../../domain/sync-engine/client';
import type { Indicator } from '../../domain/sync-engine/scheduler';
import type { AccountApi } from '../../sync/account';
import type { Snapshot } from '../../sync/runtime';
import { ThemeProvider } from '../../ui/theme';
import { AppProvider, type AppServices } from '../context';
import type { DeviceCalendar } from '../device-calendar';
import type { DevicePush } from '../push';

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

type Tables = { [e: string]: { [id: string]: Row } };
const cloneTables = (t: ClientState['base']): Tables => Object.fromEntries(Object.entries(t).map(([e, rows]) => [e, { ...rows }]));

/** Magazyny z bieżącego testu — po teście nie może zostać niezapowiedziane odrzucenie (afterEach niżej). */
const live = new Set<{ unexpected(): string[] }>();
afterEach(() => {
  const found = [...live].flatMap((s) => s.unexpected());
  live.clear();
  if (found.length) throw new Error(`Serwer odrzuciłby operacje z ekranu (M-50):\n${found.join('\n')}`);
});

export function memoryStore(initial: ClientState, indicator: Indicator = { state: 'synced', since: null }, userId = ME) {
  let n = 0;
  let snap: Snapshot = { state: initial, indicator };
  const listeners = new Set<() => void>();
  const dispatched: NewOp[] = [];
  /** Dane serwera: wiersze bazowe + operacje przyjęte (z polami, które nadaje serwer). */
  let server = cloneTables(initial.base);
  const rejected: { op: NewOp; code: string }[] = [];
  const expected: string[] = [];
  const store = {
    dispatched,
    /** Operacje odrzucone przez model reguł serwera (z kodem). */
    rejected,
    /** Test zapowiada odrzucenie z tym kodem (np. sprawdza zachowanie ekranu po odrzuceniu). */
    expectRejected: (code: string) => void expected.push(code),
    unexpected: () => {
      const left = [...expected];
      return rejected
        .filter(({ code }) => {
          const i = left.indexOf(code);
          if (i < 0) return true;
          left.splice(i, 1);
          return false;
        })
        .map(({ op, code }) => `${code}: ${JSON.stringify(op)}`);
    },
    getSnapshot: () => snap,
    subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
    dispatch: (op: NewOp | readonly NewOp[]) => {
      const ops: readonly NewOp[] = Array.isArray(op) ? op : [op as NewOp];
      dispatched.push(...ops);
      for (const o of ops) {
        const code = serverVerdict(server, userId, o);
        if (code === null) applyOnServer(server, userId, o, '2026-10-07T08:00:00.000Z');
        else rejected.push({ op: o, code });
      }
      snap = { ...snap, state: ops.reduce((st, o) => mutate(st, o, () => `op-${++n}`), snap.state) };
      listeners.forEach((f) => f());
    },
    refresh: jest.fn(),
    /** Zmiana danych serwera przez RPC konta (np. nowa grupa z właścicielem) — bez operacji telefonu. */
    serverPut: (entity: string, key: string, row: Row) => void ((server[entity] ??= {})[key] = row),
    clearRejected: () => {
      snap = { ...snap, state: { ...snap.state, rejected: [] } };
      listeners.forEach((f) => f());
    },
    /** Pobranie z serwera (zmiana drugiego telefonu): podmienia wiersze bazowe bez operacji tego telefonu. */
    pull: (fn: (base: ClientState['base']) => ClientState['base']) => {
      snap = { ...snap, state: { ...snap.state, base: fn(snap.state.base) } };
      server = cloneTables(fn(server));
      listeners.forEach((f) => f());
    },
    setIndicator: (i: Indicator) => {
      snap = { ...snap, indicator: i };
      listeners.forEach((f) => f());
    },
  };
  live.add(store);
  return store;
}

/** Lokalny magazyn telefonu (stan lustra kalendarza, D95) w pamięci. */
export function memoryLocal() {
  const m = new Map<string, string>();
  return { load: (k: string) => m.get(k) ?? null, save: (k: string, v: string | null) => void (v === null ? m.delete(k) : m.set(k, v)) };
}

export function fakeAccount(over: Partial<AccountApi> = {}): jest.Mocked<AccountApi> {
  return {
    signInWithApple: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
    finishSignOut: jest.fn(async () => {}),
    deleteAccount: jest.fn(async () => {}),
    createGroup: jest.fn(async () => {}),
    createInvite: jest.fn(async (groupId: string) => ({ inviteId: 'inv-1', token: 'ab'.repeat(32), url: `io.github.lkarwowski494.organizer://invite/${'ab'.repeat(32)}?g=${groupId}`, expiresAt: '2026-10-14T10:00:00Z', maxUses: 10 })),
    acceptInvite: jest.fn(async () => ({ groupId: 'gf' })),
    revokeInvite: jest.fn(async () => {}),
    createJoinCode: jest.fn(async () => ({ inviteId: 'inv-2', joinId: '482913507', code: '731064', url: 'https://lkarwowski494.github.io/j/?g=482913507&c=731064', expiresAt: '2026-10-08T08:00:00Z' })),
    renewJoinCode: jest.fn(async () => ({ inviteId: 'inv-3', joinId: '482913507', code: '408215', url: 'https://lkarwowski494.github.io/j/?g=482913507&c=408215', expiresAt: '2026-10-08T09:00:00Z' })),
    createChildCode: jest.fn(async () => ({ inviteId: 'inv-4', joinId: '482913507', code: '615290', url: 'https://lkarwowski494.github.io/j/?g=482913507&c=615290', expiresAt: '2026-10-08T08:00:00Z' })),
    renewChildCode: jest.fn(async () => ({ inviteId: 'inv-5', joinId: '482913507', code: '903417', url: 'https://lkarwowski494.github.io/j/?g=482913507&c=903417', expiresAt: '2026-10-08T09:00:00Z' })),
    joinGroup: jest.fn(async () => ({ groupId: 'gf' })),
    rotateJoinId: jest.fn(async () => '555666777'),
    deleteGroup: jest.fn(async () => {}),
    restoreGroup: jest.fn(async () => {}),
    transferOwnership: jest.fn(async () => {}),
    registerPushToken: jest.fn(async () => {}),
    notifyHandoff: jest.fn(async () => {}),
    notifyAssignment: jest.fn(async () => {}),
    notifyGroups: jest.fn(async () => ({ retryInSec: null as number | null })),
    getPushMutes: jest.fn(async () => []),
    setPushMute: jest.fn(async () => {}),
    setMyName: jest.fn(async () => {}),
    reportError: jest.fn(async () => {}),
    sendFeedback: jest.fn(async () => {}),
    ...over,
  } as jest.Mocked<AccountApi>;
}

export function setup(opts: { base?: T; scheme?: Scheme; indicator?: Indicator; account?: jest.Mocked<AccountApi>; calendar?: DeviceCalendar; push?: DevicePush; prefs?: AppServices['prefs']; travel?: AppServices['travel']; resetLocal?: () => void; session?: Partial<Pick<AppServices, 'displayName' | 'needsName' | 'emailName' | 'emailOnly'>> } = {}) {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const base = opts.base ?? sampleBase();
  // Dane jak po pobraniu: każda grupa ma kursor (bez tego lustro kalendarza czeka, mirrorReady).
  const state: ClientState = { ...initialState('c-test'), base, cursors: Object.fromEntries(Object.keys(base.groups ?? {}).map((g) => [g, 1])) };
  const store = memoryStore(state, opts.indicator);
  const account = opts.account ?? fakeAccount();
  // create_group (RPC) zakłada grupę i członkostwo właściciela na serwerze — dalsze operacje w nowej grupie są dozwolone.
  const createGroup = account.createGroup.getMockImplementation();
  account.createGroup.mockImplementation(async (a) => {
    store.serverPut('groups', a.groupId, { id: a.groupId, name: a.name, kind: 'shared', deleted_at: null });
    store.serverPut('group_members', a.ownerMemberId, { member_id: a.ownerMemberId, group_id: a.groupId, user_id: ME, display_name: a.displayName, role: 'owner', deleted_at: null });
    return createGroup?.(a);
  });
  const calendar = opts.calendar ?? { add: jest.fn(async () => 'saved' as const) };
  let id = 0;
  const services: AppServices = {
    store,
    account,
    calendar,
    push: opts.push,
    travel: opts.travel,
    resetLocal: opts.resetLocal,
    prefs: opts.prefs,
    local: memoryLocal(),
    userId: ME,
    displayName: 'Łukasz',
    ...opts.session,
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
  return { store, account, calendar, services, wrap, renderApp: async (ui: ReactElement) => render(wrap(<NavigationContainer>{ui}</NavigationContainer>)) };
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

/** Atrapa powiadomień: stan zgody, odpowiedź na prośbę, token. */
export function fakePush(over: Partial<DevicePush> = {}): jest.Mocked<DevicePush> {
  return {
    status: jest.fn(async () => 'undetermined' as const),
    request: jest.fn(async () => true),
    token: jest.fn(async () => 'ab'.repeat(32)),
    onToken: jest.fn(() => () => {}),
    onOpen: jest.fn(() => () => {}),
    env: jest.fn(async () => 'production' as const),
    replaceReminders: jest.fn(async () => {}),
    ...over,
  } as jest.Mocked<DevicePush>;
}

/** Wybór dnia w mini kalendarzu pola daty (D103): otwiera pole, przewija miesiące do daty i dotyka dnia. */
export async function pickDate(testID: string, iso: string) {
  const target = parseIsoDate(iso);
  if (!screen.queryByTestId(`${testID}-calendar`)) await fireEvent.press(screen.getByTestId(testID));
  for (let i = 0; i < 60; i++) {
    const cal = screen.getByTestId(`${testID}-calendar`);
    const header = String(within(cal).getByRole('header').props.children);
    const [name, year] = header.split(' ');
    const shown = Number(year) * 12 + MONTHS_NOMINATIVE.findIndex((m) => m.toLowerCase() === name!.toLowerCase());
    const want = target.y * 12 + target.m - 1;
    if (shown === want) {
      const label = formatLongDate(target, { y: NOW.y, m: NOW.m, d: NOW.d });
      return fireEvent.press(within(cal).getAllByLabelText(new RegExp(`^${label}(,|$)`))[0]!);
    }
    await fireEvent.press(screen.getByTestId(`${testID}-${shown < want ? 'next' : 'prev'}`));
  }
  throw new Error(`pickDate: nie znaleziono ${iso}`);
}

/** Pole godziny (D125): rozwinięcie panelu i ręczne wpisanie — jak dawniej wpisanie w pole tekstowe. */
export async function setTime(testID: string, value: string) {
  if (!screen.queryByTestId(`${testID}-panel`)) await fireEvent.press(await screen.findByTestId(testID));
  await fireEvent.changeText(screen.getByTestId(`${testID}-manual`), value);
}

/**
 * Powrót do aplikacji i wyjście z niej (AppState) — wszystkie nasłuchujące komponenty dostają zdarzenie. Atrapa
 * AppState z presetu React Native to jest.fn; mockRestore zostawiłby ją bez implementacji (kolejne testy dostałyby
 * subskrypcję undefined), więc `restore` przywraca poprzednią implementację.
 */
export function appStateEvents() {
  const listen = AppState.addEventListener as unknown as jest.Mock;
  const previous = listen.getMockImplementation();
  const handlers: ((s: string) => void)[] = [];
  listen.mockImplementation((_e: string, fn: (s: string) => void) => (handlers.push(fn), { remove: () => {} }));
  const emit = (s: string) => act(async () => handlers.forEach((h) => h(s)));
  return { foreground: () => emit('active'), background: () => emit('background'), restore: () => void listen.mockImplementation(previous) };
}
