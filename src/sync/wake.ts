/**
 * Prośby o ciche powiadomienia dla grup (D159, ADR 0016): po moich zmianach, które mogą zmienić czyjeś przypomnienia
 * (src/domain/reminder-wake.ts), telefon zbiera grupy przez config.wake.DEBOUNCE_MS od ostatniej zmiany i wysyła jedną
 * prośbę (seria edycji = jedno powiadomienie u innych — budżet Apple to 2–3 na godzinę). Wyjście z aplikacji wysyła
 * od razu (`flush`). Serwer odpowiada, za ile sekund może dostarczyć zaległe (przerwa między powiadomieniami do
 * urządzenia) — wtedy ponowienie samych zaległych (`retry`), póki aplikacja działa. Błąd sieci — ponowienie po
 * config.wake.RETRY_MS. Tylko w pamięci: po zamknięciu aplikacji zaległe wyjdą przy następnej prośbie kogokolwiek
 * z grupy (serwer je pamięta).
 */
import { config } from '../config';
import type { Timer } from './runtime';

export type WakeRequest = { groups: string[]; retry: boolean };
/** Wysyłka prośby; wynik — za ile sekund ponowić (null — nic nie czeka). */
export type WakeSend = (r: WakeRequest) => Promise<{ retryInSec: number | null }>;

export type GroupWaker = {
  /** Grupy po moich zmianach; wysyłka po config.wake.DEBOUNCE_MS od ostatniej. */
  add(groups: readonly string[]): void;
  /** Wyślij teraz (wyjście z aplikacji). */
  flush(): Promise<void>;
  stop(): void;
};

export function groupWaker(send: WakeSend, setTimer: Timer): GroupWaker {
  const fresh = new Set<string>();
  const retry = new Set<string>();
  let cancel: (() => void) | null = null;
  let busy: Promise<void> | null = null;
  let stopped = false;
  const later = (ms: number) => {
    cancel?.();
    cancel = stopped ? null : setTimer(() => void flush(), ms);
  };
  const take = (s: Set<string>) => {
    const out = [...s].sort().slice(0, config.wake.MAX_GROUPS);
    for (const g of out) s.delete(g);
    return out;
  };
  let retryDelay: number = config.wake.RETRY_MS;
  const once = async () => {
    cancel?.();
    cancel = null;
    const kind = fresh.size > 0;
    const groups = take(kind ? fresh : retry);
    // Zwykła prośba obejmuje też zaległe tych grup — ponowienie dla nich zbędne.
    if (kind) for (const g of groups) retry.delete(g);
    let failed = false;
    try {
      const r = await send({ groups, retry: !kind });
      if (r.retryInSec !== null) {
        for (const g of groups) retry.add(g);
        retryDelay = Math.max(r.retryInSec * 1000, config.wake.RETRY_MS);
      }
    } catch {
      failed = true;
      for (const g of groups) (kind ? fresh : retry).add(g);
      retryDelay = config.wake.RETRY_MS;
    }
    // Zmiany w trakcie wysyłki mają już swój czas (add); reszta grup ponad limit prośby — zaraz, po błędzie — po przerwie.
    if (cancel) return;
    if (fresh.size > 0) later(failed ? config.wake.RETRY_MS : 0);
    else if (retry.size > 0) later(retryDelay);
  };
  const flush = (): Promise<void> => {
    if (stopped || (fresh.size === 0 && retry.size === 0)) return Promise.resolve();
    busy ??= once().finally(() => (busy = null));
    return busy;
  };
  return {
    add(groups) {
      if (stopped || groups.length === 0) return;
      for (const g of groups) fresh.add(g);
      later(config.wake.DEBOUNCE_MS);
    },
    flush,
    stop() {
      stopped = true;
      cancel?.();
      cancel = null;
    },
  };
}
