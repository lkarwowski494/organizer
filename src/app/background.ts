/**
 * Odświeżenie w tle po cichym powiadomieniu (D159, ADR 0016; audyt 2, M-102): serwer budzi telefon, gdy ktoś zmienił
 * coś w moich grupach, a telefon pobiera zmiany i planuje przypomnienia od nowa — także gdy aplikacji dawno nie otwierano.
 * expo-notifications SDK 57 (https://docs.expo.dev/versions/v57.0.0/sdk/notifications/): zadanie z
 * TaskManager.defineTask w zasięgu modułu i registerTaskAsync — „a callback (task) that runs when a notification is
 * received while the app is in foreground, background, or terminated”; wymaga UIBackgroundModes: remote-notification
 * (app.json: enableBackgroundRemoteNotifications). Apple: „Your app has 30 seconds to perform any tasks”
 * (https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app), więc
 * odświeżenie ma limit config.wake.TASK_BUDGET_MS i planuje z tym, co zdążyło przyjść.
 * Dwie drogi:
 *  - aplikacja działa (także uśpiona w tle) z zalogowanym kontem: jej pętla synchronizacji pobiera (jeden zapis do bazy —
 *    bez drugiego pisarza), potem plan z jej danych (`setLiveSession`, Root);
 *  - aplikacja nie działa (iOS uruchomił ją w tle): baza konta i pobieranie bez ekranów.
 * Baza konta i sesja są dostępne przy zablokowanym telefonie po pierwszym odblokowaniu: plik bazy ma domyślną ochronę
 * iOS — „(Default) The file is inaccessible until the first time the user unlocks the device. After the first unlocking
 * of the device, the file remains accessible until the device shuts down or reboots.”
 * (https://developer.apple.com/documentation/uikit/encrypting-your-app-s-files), sesja i pamięć planu przypomnień są
 * w pęku kluczy z AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY (wiring.ts).
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { config } from '../config';
import { migrate } from '../data/db/migrations';
import { loadLocal, readState, saveLocal, writeState } from '../data/store';
import { adoptDevice, type ClientState, materialize } from '../domain/sync-engine/client';
import { pullStep, type Timer } from '../sync/runtime';
import { accountPrefs, adoptLegacyPrefs } from './account-prefs';
import { storedReminderPlan } from './reminders';
import type { RootDeps } from './Root';

export const WAKE_TASK = 'organizer-reminders-refresh';

/** Zalogowane konto w działającej aplikacji: pobierz zmiany i zaplanuj przypomnienia od nowa. */
export type LiveSession = { userId: string; refresh(): Promise<void> };
let live: LiveSession | null = null;

/** Root rejestruje konto na czas zalogowania; zwraca wyrejestrowanie. */
export function setLiveSession(s: LiveSession): () => void {
  live = s;
  return () => {
    if (live === s) live = null;
  };
}

export type BackgroundDeps = Pick<RootDeps, 'session' | 'transport' | 'openDb' | 'newId' | 'push' | 'legacyPrefs' | 'nowMs' | 'deviceClientId'>;
export type RefreshResult = 'new' | 'none' | 'failed';

const defaultTimer: Timer = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Obietnica albo limit czasu — co pierwsze (zadanie w tle ma 30 s). */
async function within(p: Promise<void>, ms: number, timer: Timer): Promise<void> {
  let cancel = () => {};
  await Promise.race([p, new Promise<void>((resolve) => (cancel = timer(resolve, ms)))]);
  cancel();
}

export async function refreshInBackground(deps: BackgroundDeps, timer: Timer = defaultTimer): Promise<RefreshResult> {
  try {
    const s = await deps.session.current();
    if (!s) return 'none';
    if (live?.userId === s.userId) {
      await within(live.refresh(), config.wake.TASK_BUDGET_MS, timer);
      return 'new';
    }
    const now = deps.nowMs ?? Date.now;
    const started = now();
    const db = deps.openDb(s.userId);
    // Baza z nowszej wersji aplikacji (M-177) — migrate rzuca, a tej bazy nie ruszamy („failed”).
    migrate(db);
    const set = (next: ClientState) => {
      writeState(db, state, next, now());
      state = next;
    };
    // Jak przy starcie aplikacji (Root, M-8): identyfikator instalacji z pęku kluczy tego urządzenia.
    const stored = readState(db, deps.newId());
    let state = stored;
    if (deps.deviceClientId) {
      const adopted = adoptDevice(stored, deps.deviceClientId.load(s.userId), deps.newId);
      if (adopted !== stored) set(adopted);
      deps.deviceClientId.save(s.userId, adopted.clientId);
    }
    // Porcje do końca albo do limitu; błąd sieci — plan z tym, co już jest (przypomnienia i tak trzeba odświeżyć).
    try {
      for (let i = 0; i < config.wake.PULL_PAGES_MAX && now() - started < config.wake.TASK_BUDGET_MS && (await pullStep(() => state, set, deps.transport, now)); i++);
    } catch {
      // jak wyżej
    }
    if (!deps.push || (await deps.push.status()) !== 'granted') return 'new';
    const local = { load: (k: string) => loadLocal(db, k), save: (k: string, v: string | null) => saveLocal(db, k, v) };
    const prefs = accountPrefs(local, adoptLegacyPrefs(deps.legacyPrefs, local));
    await deps.push.replaceReminders(await storedReminderPlan(materialize(state), s.userId, now(), prefs, local));
    return 'new';
  } catch {
    return 'failed';
  }
}

type Tasks = Pick<typeof TaskManager, 'defineTask'>;
type BackgroundNotifications = Pick<typeof Notifications, 'registerTaskAsync' | 'BackgroundNotificationTaskResult'>;

/**
 * Zadanie cichego powiadomienia — wołane raz przy starcie, w zasięgu modułu (App.tsx), jak każe dokumentacja SDK 57.
 * Wynik dla iOS: NewData / NoData / Failed.
 */
export function registerWakeTask(deps: BackgroundDeps, tm: Tasks = TaskManager, n: BackgroundNotifications = Notifications): void {
  const R = n.BackgroundNotificationTaskResult;
  tm.defineTask(WAKE_TASK, async () => {
    const r = await refreshInBackground(deps);
    return r === 'new' ? R.NewData : r === 'none' ? R.NoData : R.Failed;
  });
  void n.registerTaskAsync(WAKE_TASK).catch(() => {});
}
