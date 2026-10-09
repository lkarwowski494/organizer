/**
 * Pętla synchronizacji jako czysta funkcja: zdarzenia → stan → decyzja „co teraz”.
 * Zegar i sieć są z zewnątrz (warstwa src/sync), więc całość jest testowalna bez telefonu.
 *
 * Wyzwalacze (raport architektury, „Ograniczenie R1”): powrót na pierwszy plan, odzyskanie sieci,
 * poke z Realtime, wysyłka ok. 1 s po lokalnej zmianie, timer, gdy kolejka nie jest pusta.
 * Błąd przejściowy → ponowienie z rosnącym opóźnieniem. Wygasła sesja → nic nie wysyłamy, dopóki
 * token nie zostanie odświeżony; operacji z kolejki NIGDY nie wyrzucamy (zasada „nic nie ginie”).
 * Błąd trwały protokołu (np. upgrade_required) → bez ponowień do powrotu na pierwszy plan (audyt 2, M-57).
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
  /**
   * Prośba o pobranie (poke, powrót, sieć…) przyszła w trakcie pobierania — mogło jej nie objąć, więc po nim pobieramy
   * jeszcze raz. Bez tego koniec pobierania (pull_ok) kasował prośbę i zmiana czekała do następnego zdarzenia.
   */
  readonly repull: boolean;
  /** Najwcześniejsza chwila następnej wysyłki (debounce po zmianie albo ponowienie po błędzie). */
  readonly pushNotBefore: number;
  readonly pullNotBefore: number;
  readonly failures: number;
  readonly lastSuccessAt: number | null;
  readonly lastError: string | null;
  /** Kod błędu trwałego (np. upgrade_required) — pętla stoi; zdejmuje go dopiero powrót na pierwszy plan. */
  readonly fatal: string | null;
  /** Ostatnia chwila zegara widziana przez pętlę — do wykrycia cofnięcia zegara telefonu (audyt 2, M-179). */
  readonly seenAt: number;
};

export type SchedulerEvent =
  | { t: 'local_change'; pending: number }
  | { t: 'foreground' }
  | { t: 'background' }
  | { t: 'network'; online: boolean }
  /** Sygnał z serwera; `fresh` = wersja grupy wyższa niż nasz kursor (inaczej nic do pobrania). */
  | { t: 'poke'; fresh: boolean }
  /** Operacja serwerowa właśnie się udała (nowa grupa, dołączenie): pobierz od razu, bez czekania na ponowienie (M-178). */
  | { t: 'refresh' }
  /** Pobudka timera: tylko sprawdzenie zegara (M-179). */
  | { t: 'clock' }
  | { t: 'started'; what: 'push' | 'pull' }
  | { t: 'push_ok'; pending: number }
  | { t: 'pull_ok'; needMore: boolean; pending: number }
  | { t: 'failed'; what: 'push' | 'pull'; error: 'network' | 'auth' | 'server' }
  | { t: 'failed'; what: 'push' | 'pull'; error: 'fatal'; code: string }
  | { t: 'auth_refreshed' };

export type Decision = { do: 'push' | 'pull' } | { do: 'wait'; until: number } | { do: 'idle' };

export function initialScheduler(now: number): SchedulerState {
  return {
    online: true, foreground: true, authExpired: false, inflight: null, pending: 0,
    // Start aplikacji: od razu pobranie (nowe dane innych osób) i wysyłka zaległości.
    needPull: true, repull: false, pushNotBefore: now, pullNotBefore: now, failures: 0, lastSuccessAt: null, lastError: null, fatal: null, seenAt: now,
  };
}

export function backoffMs(failures: number): number {
  const { BACKOFF_MIN_MS, BACKOFF_MAX_MS, BACKOFF_FACTOR } = config.sync;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * BACKOFF_FACTOR ** Math.max(0, failures - 1));
}

/**
 * Terminy są bezwzględne (zegar telefonu), więc cofnięcie zegara (ręcznie albo korekta czasu) wydłużałoby czekanie
 * o tyle, o ile cofnięto. Przy skoku wstecz przesuwamy terminy o ten sam odcinek — zostaje tyle czekania, ile było.
 */
function rebase(s: SchedulerState, now: number): SchedulerState {
  if (now >= s.seenAt) return { ...s, seenAt: now };
  const back = s.seenAt - now;
  return { ...s, seenAt: now, pushNotBefore: s.pushNotBefore - back, pullNotBefore: s.pullNotBefore - back };
}

/** Zdarzenia, które proszą o pobranie. */
const asksPull = (e: SchedulerEvent) => (e.t === 'poke' && e.fresh) || e.t === 'refresh' || e.t === 'foreground' || (e.t === 'network' && e.online) || e.t === 'auth_refreshed';

export function onEvent(prev: SchedulerState, e: SchedulerEvent, now: number): SchedulerState {
  const next = step(rebase(prev, now), e, now);
  return next.inflight === 'pull' && asksPull(e) ? { ...next, repull: true } : next;
}

function step(s: SchedulerState, e: SchedulerEvent, now: number): SchedulerState {
  switch (e.t) {
    case 'clock':
      return s;
    case 'refresh':
      return { ...s, needPull: true, failures: 0, pullNotBefore: now };
    case 'local_change':
      return { ...s, pending: e.pending, pushNotBefore: Math.max(s.pushNotBefore, now + config.sync.PUSH_DEBOUNCE_MS) };
    case 'foreground':
      // Powrót na pierwszy plan: pobierz od razu; ponowienia po błędzie zaczynają od nowa (także jedna próba po błędzie
      // trwałym i po wygasłej sesji — token mógł zostać odświeżony w tle; audyt 2, M-9).
      return { ...s, foreground: true, needPull: true, failures: 0, fatal: null, authExpired: false, pushNotBefore: now, pullNotBefore: now };
    case 'background':
      return { ...s, foreground: false };
    case 'network':
      return e.online
        ? { ...s, online: true, needPull: true, failures: 0, pushNotBefore: now, pullNotBefore: now }
        : { ...s, online: false };
    case 'poke':
      return e.fresh ? { ...s, needPull: true } : s;
    case 'started':
      return { ...s, inflight: e.what, ...(e.what === 'pull' ? { repull: false } : {}) };
    case 'push_ok':
      // Po udanej wysyłce pobieramy: dopiero pobranie zdejmuje potwierdzone operacje z kolejki.
      return { ...s, inflight: null, pending: e.pending, needPull: true, failures: 0, lastSuccessAt: now, lastError: null, pushNotBefore: now };
    case 'pull_ok':
      return {
        ...s, inflight: null, pending: e.pending, needPull: e.needMore || s.repull, repull: false, failures: 0, lastSuccessAt: now, lastError: null,
        pullNotBefore: now, pushNotBefore: Math.max(s.pushNotBefore, now),
      };
    case 'failed': {
      // Nieudane pobranie i tak zostawia potrzebę pobrania (needPull), więc znacznik `repull` już niepotrzebny.
      const r = e.what === 'pull' ? { repull: false, needPull: s.needPull || s.repull } : {};
      if (e.error === 'auth') return { ...s, ...r, inflight: null, authExpired: true, lastError: 'auth' };
      if (e.error === 'fatal') return { ...s, ...r, inflight: null, fatal: e.code, lastError: e.code };
      const failures = s.failures + 1;
      const at = now + backoffMs(failures);
      return {
        ...s, ...r, inflight: null, failures, lastError: e.error,
        // Nieudane żądanie traktujemy jak brak sieci (captive portal: NetInfo `isInternetReachable` bywa nieznane — README
        // @react-native-community/netinfo: „If unknown defaults to null” — albo spóźnione względem żądania). Błąd sieci
        // wstrzymuje oba kierunki — inaczej po nieudanej wysyłce od razu szło nieudane pobranie (audyt 2, M-10).
        ...(e.error === 'network'
          ? { pushNotBefore: at, pullNotBefore: at, needPull: s.needPull || e.what === 'pull' }
          : e.what === 'push'
            ? { pushNotBefore: at }
            : { pullNotBefore: at, needPull: true }),
      };
    }
    case 'auth_refreshed':
      return { ...s, authExpired: false, lastError: null, failures: 0, needPull: true, pushNotBefore: now, pullNotBefore: now };
  }
}

export function decide(s: SchedulerState, now: number): Decision {
  if (s.inflight || !s.online || s.authExpired || s.fatal) return { do: 'idle' };
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
  // Po błędzie trwałym timer nic by nie zmienił (pętla czeka na pierwszy plan).
  return s.pending > 0 && s.foreground && !s.fatal ? now + config.sync.PENDING_TIMER_MS : null;
}

export type Indicator =
  | { state: 'offline'; pending: number }
  | { state: 'auth_expired'; pending: number }
  /** Serwer nie obsługuje już tej wersji aplikacji (upgrade_required). */
  | { state: 'upgrade_required'; pending: number }
  | { state: 'syncing'; pending: number }
  | { state: 'error'; pending: number; error: string }
  | { state: 'pending'; pending: number }
  | { state: 'synced'; since: number | null };

/** Wskaźnik stanu (architektura: offline / synchronizuję / zsynchronizowano X min temu / N zmian czeka / błąd + wygasła sesja). */
export function indicator(s: SchedulerState): Indicator {
  if (s.fatal === 'upgrade_required') return { state: 'upgrade_required', pending: s.pending };
  if (s.authExpired) return { state: 'auth_expired', pending: s.pending };
  if (!s.online) return { state: 'offline', pending: s.pending };
  if (s.inflight) return { state: 'syncing', pending: s.pending };
  if (s.lastError) return { state: 'error', pending: s.pending, error: s.lastError };
  if (s.pending > 0) return { state: 'pending', pending: s.pending };
  return { state: 'synced', since: s.lastSuccessAt };
}
