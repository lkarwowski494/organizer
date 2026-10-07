/**
 * Pętla synchronizacji jako czysta funkcja: zdarzenia → stan → decyzja „co teraz”.
 * Zegar i sieć są z zewnątrz (warstwa src/sync), więc całość jest testowalna bez telefonu.
 *
 * Wyzwalacze (raport architektury, „Ograniczenie R1”): powrót na pierwszy plan, odzyskanie sieci,
 * poke z Realtime, wysyłka ok. 1 s po lokalnej zmianie, timer, gdy kolejka nie jest pusta.
 * Błąd przejściowy → ponowienie z rosnącym opóźnieniem. Wygasła sesja → nic nie wysyłamy, dopóki
 * token nie zostanie odświeżony; operacji z kolejki NIGDY nie wyrzucamy (zasada „nic nie ginie”).
 */
import { config } from '../../config';

export type SchedulerState = {
  readonly online: boolean;
  readonly foreground: boolean;
  readonly authExpired: boolean;
  /** Trwa wywołanie sieciowe — nowe nie startuje, dopóki to się nie skończy. */
  readonly inflight: 'push' | 'pull' | null;
  /** Ile operacji czeka na wysłanie (z ClientState). */
  readonly pending: number;
  readonly needPull: boolean;
  /** Najwcześniejsza chwila następnej wysyłki (debounce po zmianie albo ponowienie po błędzie). */
  readonly pushNotBefore: number;
  readonly pullNotBefore: number;
  readonly failures: number;
  readonly lastSuccessAt: number | null;
  readonly lastError: string | null;
};

export type SchedulerEvent =
  | { t: 'local_change'; pending: number }
  | { t: 'foreground' }
  | { t: 'background' }
  | { t: 'network'; online: boolean }
  /** Sygnał z serwera; `fresh` = wersja grupy wyższa niż nasz kursor (inaczej nic do pobrania). */
  | { t: 'poke'; fresh: boolean }
  | { t: 'started'; what: 'push' | 'pull' }
  | { t: 'push_ok'; pending: number }
  | { t: 'pull_ok'; needMore: boolean; pending: number }
  | { t: 'failed'; what: 'push' | 'pull'; error: 'network' | 'auth' | 'server' }
  | { t: 'auth_refreshed' };

export type Decision = { do: 'push' | 'pull' } | { do: 'wait'; until: number } | { do: 'idle' };

export function initialScheduler(now: number): SchedulerState {
  return {
    online: true, foreground: true, authExpired: false, inflight: null, pending: 0,
    // Start aplikacji: od razu pobranie (nowe dane innych osób) i wysyłka zaległości.
    needPull: true, pushNotBefore: now, pullNotBefore: now, failures: 0, lastSuccessAt: null, lastError: null,
  };
}

export function backoffMs(failures: number): number {
  const { BACKOFF_MIN_MS, BACKOFF_MAX_MS, BACKOFF_FACTOR } = config.sync;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * BACKOFF_FACTOR ** Math.max(0, failures - 1));
}

export function onEvent(s: SchedulerState, e: SchedulerEvent, now: number): SchedulerState {
  switch (e.t) {
    case 'local_change':
      return { ...s, pending: e.pending, pushNotBefore: Math.max(s.pushNotBefore, now + config.sync.PUSH_DEBOUNCE_MS) };
    case 'foreground':
      // Powrót na pierwszy plan: pobierz od razu; ponowienia po błędzie zaczynają od nowa.
      return { ...s, foreground: true, needPull: true, failures: 0, pushNotBefore: now, pullNotBefore: now };
    case 'background':
      return { ...s, foreground: false };
    case 'network':
      return e.online
        ? { ...s, online: true, needPull: true, failures: 0, pushNotBefore: now, pullNotBefore: now }
        : { ...s, online: false };
    case 'poke':
      return e.fresh ? { ...s, needPull: true } : s;
    case 'started':
      return { ...s, inflight: e.what };
    case 'push_ok':
      // Po udanej wysyłce pobieramy: dopiero pobranie zdejmuje potwierdzone operacje z kolejki.
      return { ...s, inflight: null, pending: e.pending, needPull: true, failures: 0, lastSuccessAt: now, lastError: null, pushNotBefore: now };
    case 'pull_ok':
      return {
        ...s, inflight: null, pending: e.pending, needPull: e.needMore, failures: 0, lastSuccessAt: now, lastError: null,
        pullNotBefore: now, pushNotBefore: Math.max(s.pushNotBefore, now),
      };
    case 'failed': {
      if (e.error === 'auth') return { ...s, inflight: null, authExpired: true, lastError: 'auth' };
      const failures = s.failures + 1;
      const at = now + backoffMs(failures);
      return {
        ...s, inflight: null, failures, lastError: e.error,
        // Nieudane żądanie traktujemy jak brak sieci (captive portal: isInternetReachable na iOS kłamie).
        ...(e.what === 'push' ? { pushNotBefore: at } : { pullNotBefore: at, needPull: true }),
      };
    }
    case 'auth_refreshed':
      return { ...s, authExpired: false, lastError: null, failures: 0, needPull: true, pushNotBefore: now, pullNotBefore: now };
  }
}

export function decide(s: SchedulerState, now: number): Decision {
  if (s.inflight || !s.online || s.authExpired) return { do: 'idle' };
  // Kolejność: najpierw wysyłka (żeby inni szybciej zobaczyli zmiany), potem pobranie.
  if (s.pending > 0 && now >= s.pushNotBefore) return { do: 'push' };
  if (s.needPull && now >= s.pullNotBefore && s.foreground) return { do: 'pull' };
  const waits: number[] = [];
  if (s.pending > 0) waits.push(s.pushNotBefore);
  if (s.needPull && s.foreground) waits.push(s.pullNotBefore);
  if (waits.length) return { do: 'wait', until: Math.min(...waits) };
  // Kolejka niepusta, ale wysyłka czeka (np. na pierwszym planie bez sieci) — to obsługuje gałąź wyżej.
  return { do: 'idle' };
}

/** Kiedy obudzić pętlę timerem, gdy nic nie jest zaplanowane, a kolejka nie jest pusta. */
export function pendingTimer(s: SchedulerState, now: number): number | null {
  return s.pending > 0 && s.foreground ? now + config.sync.PENDING_TIMER_MS : null;
}

export type Indicator =
  | { state: 'offline'; pending: number }
  | { state: 'auth_expired'; pending: number }
  | { state: 'syncing'; pending: number }
  | { state: 'error'; pending: number; error: string }
  | { state: 'pending'; pending: number }
  | { state: 'synced'; since: number | null };

/** Wskaźnik stanu (architektura: offline / synchronizuję / zsynchronizowano X min temu / N zmian czeka / błąd + wygasła sesja). */
export function indicator(s: SchedulerState): Indicator {
  if (s.authExpired) return { state: 'auth_expired', pending: s.pending };
  if (!s.online) return { state: 'offline', pending: s.pending };
  if (s.inflight) return { state: 'syncing', pending: s.pending };
  if (s.lastError) return { state: 'error', pending: s.pending, error: s.lastError };
  if (s.pending > 0) return { state: 'pending', pending: s.pending };
  return { state: 'synced', since: s.lastSuccessAt };
}
