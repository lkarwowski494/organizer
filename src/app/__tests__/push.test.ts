import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';

import type { Reminder } from '../../domain/views/reminders';
import { apnsEnv, expoDevicePush, openedPaths, registerIfAllowed, reminderScheduler, scheduleMemory, showWhileOpen } from '../push';
import { fakePush } from './harness';
import { parseReminderSettings } from '../reminders';

jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getDevicePushTokenAsync: jest.fn(), addPushTokenListener: jest.fn(), cancelAllScheduledNotificationsAsync: jest.fn(async () => {}), scheduleNotificationAsync: jest.fn(async () => 'id'), getLastNotificationResponse: jest.fn(() => null), clearLastNotificationResponse: jest.fn(), addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })), SchedulableTriggerInputTypes: { DATE: 'date' } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}), AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly' }));
jest.mock('expo-application', () => ({ getIosPushNotificationServiceEnvironmentAsync: jest.fn(async () => null) }));
const m = Notifications as jest.Mocked<typeof Notifications>;
const app = Application as jest.Mocked<typeof Application>;

describe('pamięć planu przypomnień dostępna przy zablokowanym telefonie (D159)', () => {
  it('nowy klucz z dostępem po pierwszym odblokowaniu; dawny (WHEN_UNLOCKED) usuwany przy pierwszym zapisie', async () => {
    const store = { getItemAsync: jest.fn(async () => '{}'), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => Promise.reject(new Error('brak'))) };
    const mem = scheduleMemory(store as never);
    const access = { keychainAccessible: 'afterFirstUnlockThisDeviceOnly' };
    expect(await mem.load()).toBe('{}');
    expect(store.getItemAsync).toHaveBeenCalledWith('reminderSchedule.v2', access);
    await mem.save('a');
    await mem.save('b');
    expect(store.setItemAsync.mock.calls).toEqual([['reminderSchedule.v2', 'a', access], ['reminderSchedule.v2', 'b', access]]);
    expect(store.deleteItemAsync.mock.calls).toEqual([['reminderSchedule']]);
  });
});

describe('powiadomienia na iPhonie (D70)', () => {
  it('przy otwartej aplikacji powiadomienie się pokazuje (audyt 2, N-1)', async () => {
    const setNotificationHandler = jest.fn();
    showWhileOpen({ setNotificationHandler });
    const handler = setNotificationHandler.mock.calls[0][0];
    expect(await handler.handleNotification({})).toEqual({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false });
  });

  it('stan zgody, prośba (alert i dźwięk), token APNs, „Nie teraz”', async () => {
    m.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never).mockResolvedValueOnce({ status: 'denied' } as never).mockResolvedValueOnce({ status: 'whatever' } as never);
    expect([await expoDevicePush.status(), await expoDevicePush.status(), await expoDevicePush.status()]).toEqual(['granted', 'denied', 'undetermined']);
    m.requestPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
    expect(await expoDevicePush.request()).toBe(true);
    expect(m.requestPermissionsAsync).toHaveBeenCalledWith({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    m.getDevicePushTokenAsync.mockResolvedValueOnce({ type: 'ios', data: 'ab'.repeat(32) } as never).mockResolvedValueOnce({ type: 'web', data: {} } as never);
    expect(await expoDevicePush.token()).toBe('ab'.repeat(32));
    expect(await expoDevicePush.token()).toBeNull();
    // Audyt 2 (N-35): środowisko z uprawnienia buildu, nie z __DEV__ (testy mają __DEV__ = true, a build — produkcję).
    expect(await expoDevicePush.env()).toBe('production');
    app.getIosPushNotificationServiceEnvironmentAsync.mockResolvedValueOnce('development');
    expect(await expoDevicePush.env()).toBe('sandbox');
  });

  it('przypomnienia: podmiana zaplanowanych; ustawienia (zły zapis = domyślne)', async () => {
    await expoDevicePush.replaceReminders([{ id: 'm|2026-10-08', at: 1_800_000_000_000, title: 'Dziś', body: 'kwiaty', target: { screen: 'today' } }]);
    expect(m.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    // PWD-16: ścieżka do otwarcia w danych powiadomienia.
    expect(m.scheduleNotificationAsync).toHaveBeenCalledWith({ identifier: 'm|2026-10-08', content: { title: 'Dziś', body: 'kwiaty', sound: 'default', data: { path: 'today' } }, trigger: { type: 'date', date: 1_800_000_000_000 } });
    expect(parseReminderSettings('{"leadMin":10,"morning":"off"}')).toEqual({ leadMin: 10, morning: 'off' });
    expect(parseReminderSettings(null)).toBeNull();
    expect(parseReminderSettings('{zły')).toBeNull();
    expect(parseReminderSettings('{"leadMin":"x"}')).toBeNull();
    // PWD-17: „Czas wyjść” zapisany osobno; zapis sprzed niego bez pola (= włączone).
    expect(parseReminderSettings('{"leadMin":10,"morning":"off","leave":false}')).toEqual({ leadMin: 10, morning: 'off', leave: false });
  });

  it('środowisko APNs: development → sandbox; production, brak profilu (App Store, TestFlight) i symulator → production', async () => {
    expect(await apnsEnv(async () => 'development')).toBe('sandbox');
    expect(await apnsEnv(async () => 'production')).toBe('production');
    expect(await apnsEnv(async () => null)).toBe('production');
  });

  it('nasłuch zmiany tokenu (audyt 2, N-36): tylko token APNs; wyłączenie nasłuchu', () => {
    const remove = jest.fn();
    m.addPushTokenListener.mockReturnValueOnce({ remove } as never);
    const fn = jest.fn();
    const off = expoDevicePush.onToken(fn);
    const listener = m.addPushTokenListener.mock.calls[0]![0];
    listener({ type: 'ios', data: 'cd'.repeat(32) } as never);
    listener({ type: 'web', data: {} } as never);
    expect(fn.mock.calls).toEqual([['cd'.repeat(32)]]);
    off();
    expect(remove).toHaveBeenCalled();
  });

  it('rejestracja tylko ze zgodą i tokenem; błędy ciche', async () => {
    const reg = jest.fn(async () => {});
    expect(await registerIfAllowed(fakePush({ status: jest.fn(async () => 'granted' as const) }), reg)).toBe(true);
    expect(reg).toHaveBeenCalledWith('ab'.repeat(32), 'production');
    expect(await registerIfAllowed(fakePush(), reg)).toBe(false);
    expect(await registerIfAllowed(fakePush({ status: jest.fn(async () => 'granted' as const), token: jest.fn(async () => null) }), reg)).toBe(false);
    expect(await registerIfAllowed(fakePush({ status: jest.fn(async () => 'granted' as const) }), jest.fn(async () => Promise.reject(new Error('sieć'))))).toBe(false);
    expect(reg).toHaveBeenCalledTimes(1);
    // Token z nasłuchu — bez ponownego getDevicePushTokenAsync (dokumentacja SDK 57: pętla).
    const p = fakePush({ status: jest.fn(async () => 'granted' as const) });
    expect(await registerIfAllowed(p, reg, 'ef'.repeat(32))).toBe(true);
    expect(reg).toHaveBeenLastCalledWith('ef'.repeat(32), 'production');
    expect(p.token).not.toHaveBeenCalled();
  });
});

describe('planowanie przypomnień (audyt 2: N-7, N-34)', () => {
  const r = (id: string, at: number): Reminder => ({ id, at, title: id, body: '', target: { screen: 'task', id } });
  const NOW = 1_800_000_000_000;
  const n = () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}), scheduleNotificationAsync: jest.fn(async (_req: Notifications.NotificationRequestInput) => 'id') });

  it('pozycja za blisko „teraz” pominięta; błąd jednej nie zatrzymuje reszty — zgłoszony po zaplanowaniu', async () => {
    const x = n();
    x.scheduleNotificationAsync.mockRejectedValueOnce(new Error('timeInterval must be greater than 0'));
    const plan = reminderScheduler(x, () => NOW);
    await expect(plan([r('za-blisko', NOW + 4_999), r('zly', NOW + 60_000), r('a', NOW + 120_000), r('b', NOW + 180_000)])).rejects.toThrow('greater than 0');
    expect(x.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(x.scheduleNotificationAsync.mock.calls.map((c) => c[0]!.identifier)).toEqual(['zly', 'a', 'b']);
    expect(x.scheduleNotificationAsync.mock.calls[1]![0]).toEqual({ identifier: 'a', content: { title: 'a', body: '', sound: 'default', data: { path: 'task/a' } }, trigger: { type: 'date', date: NOW + 120_000 } });
    // Kolejny plan działa mimo poprzedniego błędu.
    await plan([r('c', NOW + 60_000)]);
    expect(x.scheduleNotificationAsync).toHaveBeenLastCalledWith(expect.objectContaining({ identifier: 'c' }));
  });

  it('dwa przebiegi naraz: po kolei, a nowszy zastępuje starszy — nic z nieaktualnej listy nie zostaje', async () => {
    const x = n();
    let release!: () => void;
    x.cancelAllScheduledNotificationsAsync.mockImplementationOnce(() => new Promise<void>((done) => (release = done)));
    const plan = reminderScheduler(x, () => NOW);
    const first = plan([r('stare-1', NOW + 60_000), r('stare-2', NOW + 60_000)]);
    // Pierwszy przebieg właśnie kasuje, gdy przychodzą dwa nowe plany.
    await new Promise((done) => setImmediate(done));
    const skipped = plan([r('srodkowe', NOW + 60_000)]);
    const last = plan([r('nowe', NOW + 60_000)]);
    release();
    await Promise.all([first, skipped, last]);
    // Pierwszy po skasowaniu widzi następcę i nic nie planuje; środkowy nie rusza wcale; ostatni kasuje i planuje.
    expect(x.scheduleNotificationAsync.mock.calls.map((c) => c[0]!.identifier)).toEqual(['nowe']);
    expect(x.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(2);
  });

  it('następca w trakcie pętli przerywa starszy przebieg', async () => {
    const x = n();
    const plan = reminderScheduler(x, () => NOW);
    let next: Promise<void> | null = null;
    x.scheduleNotificationAsync.mockImplementationOnce(async () => {
      next = plan([r('nowe', NOW + 60_000)]);
      return 'id';
    });
    await plan([r('stare-1', NOW + 60_000), r('stare-2', NOW + 60_000)]);
    await next;
    expect(x.scheduleNotificationAsync.mock.calls.map((c) => c[0]!.identifier)).toEqual(['stare-1', 'nowe']);
    expect(x.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(2);
  });
});

describe('spóźnienie: od razu, raz, nie po „Czas wyjść” (PW-24, decyzja właściciela 8.10.2026)', () => {
  const NOW = 1_800_000_000_000;
  const n = () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}), scheduleNotificationAsync: jest.fn(async (_req: Notifications.NotificationRequestInput) => 'id') });
  const target = { screen: 'event', id: 'ev', date: '2026-10-07' } as const;
  const leave = (at: number): Reminder => ({ id: 'l|ev|2026-10-07|2026-10-07', at, title: 'Czas wyjść: Tańce', body: '25 min autem — wyjdź teraz', target });
  const late: Reminder = { id: 'l|ev|2026-10-07|2026-10-07|late', at: NOW, now: true, title: 'Czas wyjść: Tańce', body: 'Masz 15 min spóźnienia — wyjdź teraz', target };
  const memory = () => {
    const box: { v: string | null } = { v: null };
    return { box, load: jest.fn(async () => box.v), save: jest.fn(async (v: string) => void (box.v = v)) };
  };

  it('dojazd się wydłużył, zanim „Czas wyjść” przyszedł — od razu (bez wyzwalacza czasu) i tylko raz', async () => {
    const x = n();
    const mem = memory();
    let t = NOW - 30 * 60_000;
    const plan = reminderScheduler(x, () => t, mem);
    await plan([leave(NOW + 10 * 60_000)]);
    t = NOW;
    await plan([late]);
    expect(x.scheduleNotificationAsync.mock.calls.at(-1)![0]).toEqual({ identifier: late.id, content: { title: late.title, body: late.body, sound: 'default', data: { path: 'event/ev/2026-10-07' } }, trigger: null });
    // Kolejne przeplanowanie (zmiana danych) — bez drugiego „spóźniony”; po ponownym uruchomieniu też (pamięć w pęku kluczy).
    await plan([late]);
    await reminderScheduler(x, () => t + 60_000, mem)([late]);
    expect(x.scheduleNotificationAsync.mock.calls.filter((c) => c[0]!.trigger === null)).toHaveLength(1);
  });

  it('„Czas wyjść” już przyszedł (także przed ponownym uruchomieniem) — bez „spóźniony”', async () => {
    const x = n();
    const mem = memory();
    await reminderScheduler(x, () => NOW - 60 * 60_000, mem)([leave(NOW - 20 * 60_000)]);
    await reminderScheduler(x, () => NOW, mem)([late]);
    expect(x.scheduleNotificationAsync.mock.calls.some((c) => c[0]!.trigger === null)).toBe(false);
    // Doba później pamięć o tym „Czas wyjść” wygasa (nie rośnie bez końca).
    const later = n();
    await reminderScheduler(later, () => NOW + 25 * 3_600_000, mem)([]);
    expect(JSON.parse(mem.box.v!)).toEqual({ leave: {}, late: {} });
  });

  it('zła albo pusta pamięć — jak bez pamięci; błąd zapisu nie przerywa; błąd pokazania zgłoszony i ponowiony', async () => {
    for (const v of ['{zły', '{"leave":[1],"late":{"a":"x"}}', null]) {
      const x = n();
      await reminderScheduler(x, () => NOW, { load: async () => v, save: async () => Promise.reject(new Error('keychain')) })([late]);
      expect(x.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    }
    const x = n();
    x.scheduleNotificationAsync.mockRejectedValueOnce(new Error('present'));
    const plan = reminderScheduler(x, () => NOW);
    await expect(plan([late])).rejects.toThrow('present');
    await plan([late]);
    expect(x.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});

describe('dotknięcie powiadomienia (PWD-16, decyzja właściciela 8.10.2026)', () => {
  const response = (data: Record<string, unknown> | undefined) => ({ notification: { request: { content: { data } } } }) as never;
  const fake = (last: unknown) => {
    let listener!: (r: unknown) => void;
    const remove = jest.fn();
    return {
      n: {
        getLastNotificationResponse: jest.fn(() => last as never),
        clearLastNotificationResponse: jest.fn(),
        addNotificationResponseReceivedListener: jest.fn((fn: (r: unknown) => void) => ((listener = fn), { remove })),
      },
      tap: (r: unknown) => listener(r),
      remove,
    };
  };

  it('uruchomienie z powiadomienia — raz (potem wyczyszczone); dotknięcia w trakcie; obce dane pomijane', () => {
    const f = fake(response({ path: 'task/t1' }));
    const fn = jest.fn();
    const off = openedPaths(f.n as never, fn);
    expect(f.n.clearLastNotificationResponse).toHaveBeenCalled();
    f.tap(response({ path: 'event/ev/2026-10-14' }));
    f.tap(response({ path: 'settings' }));
    f.tap(response(undefined));
    expect(fn.mock.calls).toEqual([['task/t1'], ['event/ev/2026-10-14']]);
    off();
    expect(f.remove).toHaveBeenCalled();
    const none = fake(null);
    openedPaths(none.n as never, fn);
    expect(none.n.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('expoDevicePush.onOpen — przez expo-notifications', () => {
    const off = expoDevicePush.onOpen(() => {});
    expect(m.addNotificationResponseReceivedListener).toHaveBeenCalled();
    off();
  });
});
