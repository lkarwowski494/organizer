/**
 * Powiadomienia push na iPhonie (D70, ADR 0015). expo-notifications SDK 57
 * (https://docs.expo.dev/versions/v57.0.0/sdk/notifications/): getPermissionsAsync / requestPermissionsAsync
 * (status: granted | denied | undetermined), getDevicePushTokenAsync — natywny token APNs (`data`, szesnastkowo),
 * addPushTokenListener — „a push token may be changed by the push notification service while the app is running”.
 * Środowisko APNs tokenu — z uprawnienia buildu (expo-application, niżej), nie z __DEV__ (audyt 2, N-35).
 */
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { config } from '../config';
import { parseTarget, targetPath } from '../domain/notification-target';
import type { Reminder } from '../domain/views/reminders';

export type PushStatus = 'granted' | 'denied' | 'undetermined';
export type PushEnv = 'sandbox' | 'production';

export interface DevicePush {
  status(): Promise<PushStatus>;
  /** Pyta o zgodę (okno systemowe — tylko raz; później tylko Ustawienia iPhone'a). */
  request(): Promise<boolean>;
  token(): Promise<string | null>;
  /** Token zmieniony przez APNs w trakcie działania aplikacji; zwraca wyłączenie nasłuchu. */
  onToken(fn: (token: string) => void): () => void;
  /** Środowisko APNs, do którego należy token tego buildu. */
  env(): Promise<PushEnv>;
  /**
   * Dotknięcie powiadomienia (przypomnienia albo push) — ścieżka sprawy (PWD-16, notification-target.ts). Także
   * powiadomienie, którym uruchomiono aplikację (raz). Zwraca wyłączenie nasłuchu.
   */
  onOpen(fn: (path: string) => void): () => void;
  /**
   * Przypomnienia (D75): podmienia wszystkie zaplanowane powiadomienia lokalne na nową listę. Błąd pojedynczej
   * pozycji nie zatrzymuje pozostałych — obietnica odrzuca się pierwszym z nich po zaplanowaniu reszty.
   */
  replaceReminders(list: Reminder[]): Promise<void>;
}

// „Nie teraz” i ustawienia przypomnień należą do konta (D175) — src/app/account-prefs.ts. Tu tylko plan na tym telefonie.
// D159: plan zmienia się też w tle przy zablokowanym telefonie, więc pamięć planu w pęku kluczy z dostępem po pierwszym
// odblokowaniu (SecureStore SDK 57: keychainAccessible). Dostępności istniejącego wpisu zapis nie zmienia (expo-secure-store
// 57, ios/SecureStoreModule.swift: przy errSecDuplicateItem tylko SecItemUpdate wartości), dlatego nowy klucz, a dawny
// („reminderSchedule”, WHEN_UNLOCKED) usuwany przy pierwszym zapisie.
const SCHEDULE = 'reminderSchedule.v2';
const OLD_SCHEDULE = 'reminderSchedule';
const SCHEDULE_ACCESS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
/** Pamięć planu w pęku kluczy (wyżej); `store` — expo-secure-store albo atrapa w teście. */
export function scheduleMemory(store: Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'> = SecureStore): SchedulerMemory {
  let old = true;
  return {
    load: () => store.getItemAsync(SCHEDULE, SCHEDULE_ACCESS),
    save: async (v) => {
      await store.setItemAsync(SCHEDULE, v, SCHEDULE_ACCESS);
      if (old) await store.deleteItemAsync(OLD_SCHEDULE).catch(() => {});
      old = false;
    },
  };
}
const asStatus = (s: string): PushStatus => (s === 'granted' || s === 'denied' ? s : 'undetermined');

/**
 * Środowisko APNs z uprawnienia aps-environment podpisanego buildu. expo-application SDK 57
 * (https://docs.expo.dev/versions/v57.0.0/sdk/application/): getIosPushNotificationServiceEnvironmentAsync — „Maps to the
 * aps-environment key in the native target's registered entitlements”; czyta embedded.mobileprovision, więc bez profilu
 * (build z App Store i TestFlight) i na symulatorze daje null. „development” = host sandbox APNs, reszta — produkcyjny
 * (wtyczka expo-notifications w app.json: mode „production”).
 */
export async function apnsEnv(read: () => Promise<'development' | 'production' | null> = Application.getIosPushNotificationServiceEnvironmentAsync): Promise<PushEnv> {
  return (await read()) === 'development' ? 'sandbox' : 'production';
}

type Scheduling = Pick<typeof Notifications, 'cancelAllScheduledNotificationsAsync' | 'scheduleNotificationAsync'>;

/** Pamięć planowania na telefonie (pęk kluczy) — przeżywa ponowne uruchomienie aplikacji. */
export type SchedulerMemory = { load(): Promise<string | null>; save(value: string): Promise<void> };
const NO_MEMORY: SchedulerMemory = { load: async () => null, save: async () => {} };
/** `leave` — zaplanowane „Czas wyjść” (id → chwila), `late` — pokazane „spóźnienia” (id → kiedy). */
type SchedulerState = { leave: Record<string, number>; late: Record<string, number> };
const DAY_MS = 86_400_000;
const isTimes = (v: unknown): v is Record<string, number> => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'number');

/**
 * Planowanie przypomnień po kolei (audyt 2, N-7, N-34): nowsza lista zastępuje starszą w całości, a przebieg, który
 * w trakcie dostał następcę, kończy się (następca i tak kasuje wszystko i planuje od nowa) — dwa przebiegi naraz nie
 * zostawią przypomnienia usuniętej sprawy. Pozycja bliżej niż config.reminders.SCHEDULE_MARGIN_MS od „teraz” jest
 * pomijana: wyzwalacz DATE to UNTimeIntervalNotificationTrigger(timeInterval: data − teraz) z datą uciętą do sekundy
 * (expo-notifications 57, ios/…/TriggerRecords.swift), a Apple wymaga „This value must be greater than zero.”
 * (https://developer.apple.com/documentation/usernotifications/untimeintervalnotificationtrigger/init(timeinterval:repeats:)).
 * Pozycja `now` (spóźnienie, PW-24) — od razu (SDK 57: „A null trigger means that the notification should be scheduled
 * for delivery immediately”), raz na termin i tylko wtedy, gdy „Czas wyjść” tego terminu nie przyszedł już wcześniej
 * (zaplanowany na chwilę, która minęła) — kto wyszedł o czasie i otwiera aplikację w drodze, nie dostaje „spóźniony”.
 */
export function reminderScheduler(n: Scheduling, now: () => number = Date.now, memory: SchedulerMemory = NO_MEMORY): (list: Reminder[]) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  let generation = 0;
  let state: SchedulerState | null = null;
  const load = async (): Promise<SchedulerState> => {
    if (state) return state;
    try {
      const v = JSON.parse((await memory.load()) ?? '{}') as Partial<SchedulerState>;
      state = { leave: isTimes(v.leave) ? v.leave : {}, late: isTimes(v.late) ? v.late : {} };
    } catch {
      state = { leave: {}, late: {} };
    }
    return state;
  };
  return (list) => {
    const mine = ++generation;
    const run = queue.then(async () => {
      if (mine !== generation) return;
      const s = await load();
      const start = now();
      // „Czas wyjść”, których chwila minęła, iOS już pokazał — zostają w pamięci na dobę.
      const shown = Object.fromEntries(Object.entries(s.leave).filter(([, at]) => at <= start && at > start - DAY_MS));
      await n.cancelAllScheduledNotificationsAsync();
      const leave: Record<string, number> = { ...shown };
      let failure: { e: unknown } | null = null;
      for (const r of list) {
        if (mine !== generation) return;
        // PWD-16: dotknięcie otwiera sprawę — ścieżka jak link głęboki (notification-target.ts).
        const content = { title: r.title, body: r.body, sound: 'default', data: { path: targetPath(r.target) } };
        try {
          if (r.now) {
            if (shown[r.id.replace(/\|late$/, '')] !== undefined || s.late[r.id] !== undefined) continue;
            await n.scheduleNotificationAsync({ identifier: r.id, content, trigger: null });
            s.late[r.id] = start;
            continue;
          }
          if (r.at < now() + config.reminders.SCHEDULE_MARGIN_MS) continue;
          await n.scheduleNotificationAsync({ identifier: r.id, content, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at } });
          if (r.id.startsWith('l|')) leave[r.id] = r.at;
        } catch (e) {
          failure ??= { e };
        }
      }
      s.leave = leave;
      s.late = Object.fromEntries(Object.entries(s.late).filter(([, at]) => at > start - DAY_MS));
      await memory.save(JSON.stringify(s)).catch(() => {});
      if (failure) throw failure.e;
    });
    queue = run.catch(() => {});
    return run;
  };
}

export const expoDevicePush: DevicePush = {
  status: async () => asStatus((await Notifications.getPermissionsAsync()).status),
  request: async () => (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } })).granted,
  token: async () => {
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === 'string' ? t.data : null;
  },
  onToken: (fn) => {
    const sub = Notifications.addPushTokenListener((t) => {
      if (typeof t.data === 'string') fn(t.data);
    });
    return () => sub.remove();
  },
  env: () => apnsEnv(),
  onOpen: (fn) => openedPaths(Notifications, fn),
  replaceReminders: reminderScheduler(Notifications, Date.now, scheduleMemory()),
};

type Responses = Pick<typeof Notifications, 'getLastNotificationResponse' | 'clearLastNotificationResponse' | 'addNotificationResponseReceivedListener'>;

/**
 * Ścieżki z dotkniętych powiadomień (PWD-16). SDK 57: lokalne — `content.data`; push — słownik „body” z treści APNs
 * (expo-notifications 57, ios/…/NotificationRecords.swift: dla UNPushNotificationTrigger `userInfo["body"]`), dlatego
 * serwer wysyła `body: { path }`. Uruchomienie z powiadomienia: getLastNotificationResponse, potem
 * clearLastNotificationResponse („May be used when an app selects a route based on the notification response”), żeby
 * ponowne zamontowanie nawigacji (np. po zmianie konta) nie otwierało tego samego drugi raz.
 */
export function openedPaths(n: Responses, fn: (path: string) => void): () => void {
  const take = (r: Notifications.NotificationResponse | null) => {
    const path = r?.notification.request.content.data?.path;
    if (parseTarget(path)) fn(path as string);
  };
  const last = n.getLastNotificationResponse();
  if (last) {
    n.clearLastNotificationResponse();
    take(last);
  }
  const sub = n.addNotificationResponseReceivedListener(take);
  return () => sub.remove();
}

/**
 * Audyt 2 (N-1): powiadomienie (przypomnienie, „Czas wyjść”, push) przy otwartej aplikacji ma się pokazać jak
 * w tle. Bez obsługi nie pokazuje się wcale — SDK 57: „The default behavior when the handler is not set or does not
 * respond in time is not to show the notification”. Wołane raz przy starcie (wiring), przed planowaniem.
 */
export function showWhileOpen(n: Pick<typeof Notifications, 'setNotificationHandler'> = Notifications): void {
  n.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
}

/**
 * Zgoda jest — zarejestruj token tego telefonu (bez zgody: nic). `known` — token z nasłuchu zmian (bez ponownego
 * getDevicePushTokenAsync: dokumentacja SDK 57 ostrzega, że wywołuje on nasłuch i grozi pętlą). Błędy sieci ciche:
 * rejestracja wraca przy powrocie do aplikacji i następnym starcie (HandoffNotifier).
 */
export async function registerIfAllowed(push: DevicePush, register: (token: string, env: PushEnv) => Promise<void>, known?: string): Promise<boolean> {
  try {
    if ((await push.status()) !== 'granted') return false;
    const token = known ?? (await push.token());
    if (!token) return false;
    await register(token, await push.env());
    return true;
  } catch {
    return false;
  }
}
