/**
 * Pętla synchronizacji w działaniu: łączy czystą logikę (sync-engine/client + scheduler) z siecią,
 * zegarem i trwałym zapisem. Ekrany czytają `getState()` i wołają `dispatch()`; wszystko poza tym
 * dzieje się tutaj. Każde przejście stanu zapisuje się przez `persist` w jednej transakcji (R1).
 */
import { config } from '../config';
import {
  type ClientState,
  clearRejected,
  mutate,
  type NewOp,
  type Op,
  onFetchScope,
  onPullResponse,
  onPushResponse,
  pendingCount,
  pullRequest,
  type PushResponse,
  pushRequest,
} from '../domain/sync-engine/client';
import { pruneExpired } from '../domain/sync-engine/retention';
import { badField } from '../domain/sync-engine/row-check';
import { decide, type Indicator, indicator, initialScheduler, onEvent, pendingTimer, type SchedulerEvent, type SchedulerState } from '../domain/sync-engine/scheduler';
import { errorKind, type SyncTransport } from './transport';

export type Timer = (fn: () => void, ms: number) => () => void;

export type RuntimeDeps = {
  initial: ClientState;
  transport: SyncTransport;
  now: () => number;
  newId: () => string;
  setTimer: Timer;
  /** Zapis różnicy stanów (src/data/store.ts writeState); brak = tylko w pamięci. */
  persist?: (prev: ClientState, next: ClientState, now: number) => void;
  /**
   * Po udanym wysłaniu: operacje, odpowiedź serwera i stan sprzed odpowiedzi (D159 — ciche powiadomienia do grup).
   * Błąd tutaj nie psuje synchronizacji (zmiany już są na serwerze).
   */
  onPushed?: (ops: readonly Op[], res: PushResponse, state: ClientState) => void;
  /** Pominięte wiersze z datą spoza zakresu (audyt 3, N-1): nazwy pól do zgłoszenia błędu. */
  onInvalidRows?: (fields: string[]) => void;
};

/**
 * Jedna porcja pobrania z dociągnięciem nowych ukrytych list (sync_fetch_scope). `get` — bieżący stan (mógł się zmienić
 * w trakcie zapytania), `set` — zapis kroku. Zwraca, czy któraś grupa ma jeszcze wiersze (has_more). Wspólne dla pętli
 * synchronizacji i odświeżenia w tle (D159, src/app/background.ts). `live` — fałsz po stop() silnika: odpowiedź przepada (M-55).
 */
export async function pullStep(
  get: () => ClientState,
  set: (next: ClientState) => void,
  transport: SyncTransport,
  now: () => number,
  live: () => boolean = () => true,
  onInvalid: (fields: string[]) => void = () => {},
): Promise<boolean> {
  const req = pullRequest(get());
  const res = await transport.pull(req, config.sync.PULL_LIMIT_MAX);
  if (!live()) return false;
  const out = onPullResponse(get(), res, req);
  // N-1: wiersze z datą spoza zakresu pominięte — zgłoszenie z nazwami pól, bez treści.
  if (out.invalid.length) onInvalid(out.invalid);
  // Historia i rozstrzygnięte przekazania po terminie znikają też z telefonu (audyt 2, M-62) — w tym samym zapisie.
  set(pruneExpired(out.state, now()));
  // Nowe ukryte listy (dostęp nadany): ich wiersze mogą mieć stare wersje, więc pobieramy je w całości. Lista trafia do
  // pobranych dopiero po udanym pobraniu — błąd przerywa pętlę, a następne pobranie spróbuje jeszcze raz (M-53).
  // Dopiero po ostatniej porcji (N-94): trwały błąd jednej listy nie blokuje porcji dużej grupy (ponowienie z opóźnieniem
  // dotyczy wtedy tylko listy), a lista czeka w scopesToFetch.
  if (out.needMore) return true;
  for (const listId of out.fetchScopes) {
    const rows = await transport.fetchScope(listId);
    if (!live()) continue;
    const bad = [...new Set(rows.flatMap((r) => badField(r.e, r.row) ?? []))];
    if (bad.length) onInvalid(bad);
    set(onFetchScope(get(), rows, listId));
  }
  return false;
}

export type Snapshot = { state: ClientState; indicator: Indicator };

export class SyncRuntime {
  private state: ClientState;
  private sched: SchedulerState;
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private cancelTimer: (() => void) | null = null;
  private stopped = false;
  /** Czekający na pobranie (refreshNow) i liczba pobrań rozpoczętych przed ich prośbą. */
  private waiters: { after: number; resolve: () => void }[] = [];
  private pullRuns = 0;
  /** Ostatni stan aplikacji z zewnątrz (pierwszy plan / tło) i liczba trwających odświeżeń z tła. */
  private appForeground = true;
  private woken = 0;
  /**
   * Numer „życia” silnika: stop() go podbija, a wynik żądania sprzed stop() przepada (audyt 2, M-55). Inaczej odpowiedź,
   * która przyszła po „Wyczyść dane”, wpisywała stary identyfikator, kursory i różnicę do wyczyszczonej bazy.
   */
  private generation = 0;
  /** Wersje grup po moich wysyłkach (sync_push → versions): sygnał Realtime z taką wersją to moja zmiana (N-100). */
  private readonly written = new Map<string, number>();

  constructor(private readonly deps: RuntimeDeps) {
    this.state = deps.initial;
    this.sched = { ...initialScheduler(deps.now()), pending: pendingCount(deps.initial) };
    this.snapshot = { state: this.state, indicator: indicator(this.sched) };
  }

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /**
   * Lokalna zmiana: widoczna od razu, zapisana razem z wpisem w kolejce, wysłana po debounce. Kilka operacji
   * naraz (np. „to i następne” = koniec starej serii + nowa seria) zapisuje się w jednej transakcji (R1).
   */
  dispatch(op: NewOp | readonly NewOp[]): void {
    const ops: readonly NewOp[] = Array.isArray(op) ? op : [op as NewOp];
    this.setState(ops.reduce((st, o) => mutate(st, o, this.deps.newId), this.state));
    this.event({ t: 'local_change', pending: pendingCount(this.state) });
  }

  /** „Wyczyść listę” odrzuconych zmian (D190) — zapisane w bazie telefonu jak każda zmiana stanu. */
  clearRejected(): void {
    this.setState(clearRejected(this.state));
    this.emit();
  }

  /**
   * Czy sygnał Realtime grupy niesie coś nowego (audyt 3, N-100): wersja ponad kursor i ponad wersję po mojej ostatniej
   * wysyłce. Własny sygnał po wysyłce nie każe pobierać drugi raz — pobranie po wysyłce i tak obejmuje tę wersję.
   * Brak wersji (kanał użytkownika: zmiana dostępu) — zawsze nowe.
   */
  isFresh(groupId: string, version: number | null): boolean {
    return version === null || version > Math.max(this.state.cursors[groupId] ?? 0, this.written.get(groupId) ?? 0);
  }

  /** Zdarzenia z zewnątrz: pierwszy plan, sieć, poke z Realtime, odświeżona sesja. */
  event(e: SchedulerEvent): void {
    if (e.t === 'foreground' || e.t === 'background') this.appForeground = e.t === 'foreground';
    this.sched = onEvent(this.sched, e, this.deps.now());
    this.emit();
    this.tick();
  }

  start(): void {
    this.stopped = false;
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.release();
  }

  /**
   * Pobierz zmiany teraz i poczekaj na koniec pobierania (wszystkie porcje albo błąd) — odświeżenie z cichego
   * powiadomienia, gdy aplikacja działa (D159). Zatrzymana pętla kończy czekanie od razu.
   */
  refreshNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const done = new Promise<void>((resolve) => this.waiters.push({ after: this.pullRuns, resolve }));
    // W tle pętla nie pobiera (scheduler: tylko na pierwszym planie) — na czas odświeżenia jak na pierwszym planie
    // (wysyła też czekające zmiany); potem z powrotem tło, chyba że w międzyczasie aplikacja wróciła na pierwszy plan.
    this.woken++;
    if (!this.sched.foreground) this.sched = onEvent(this.sched, { t: 'foreground' }, this.deps.now());
    this.sched = onEvent(this.sched, { t: 'poke', fresh: true }, this.deps.now());
    this.emit();
    this.tick();
    return done.then(() => {
      if (--this.woken > 0 || this.appForeground || this.stopped) return;
      this.sched = onEvent(this.sched, { t: 'background' }, this.deps.now());
      this.emit();
    });
  }

  /** Zwalnia czekających na pobranie, które zaczęło się po ich prośbie (`run` — numer pobrania; brak = wszystkich). */
  private release(run = Infinity): void {
    const ready = this.waiters.filter((w) => w.after < run);
    this.waiters = this.waiters.filter((w) => w.after >= run);
    for (const w of ready) w.resolve();
  }

  private setState(next: ClientState): void {
    this.deps.persist?.(this.state, next, this.deps.now());
    this.state = next;
  }

  private emit(): void {
    this.snapshot = { state: this.state, indicator: indicator(this.sched) };
    for (const fn of this.listeners) fn();
  }

  private tick(): void {
    if (this.stopped) return;
    this.cancelTimer?.();
    this.cancelTimer = null;
    const now = this.deps.now();
    this.sched = onEvent(this.sched, { t: 'clock' }, now);
    const d = decide(this.sched, now);
    if (d.do === 'push') void this.run('push');
    else if (d.do === 'pull') void this.run('pull');
    else {
      const until = d.do === 'wait' ? d.until : pendingTimer(this.sched, now);
      if (until !== null) this.cancelTimer = this.deps.setTimer(() => this.tick(), Math.max(0, until - now));
    }
  }

  private async run(what: 'push' | 'pull'): Promise<void> {
    const run = what === 'pull' ? ++this.pullRuns : 0;
    this.sched = onEvent(this.sched, { t: 'started', what }, this.deps.now());
    this.emit();
    const gen = this.generation;
    let done: SchedulerEvent;
    try {
      done = what === 'push' ? await this.push(gen) : await this.pull(gen);
    } catch (e) {
      const error = errorKind(e);
      done = error === 'fatal' ? { t: 'failed', what, error, code: (e as Error).message } : { t: 'failed', what, error };
    }
    if (gen !== this.generation) return;
    this.sched = onEvent(this.sched, done, this.deps.now());
    this.emit();
    // Pobranie w toku, gdy przyszła prośba, mogło nie objąć nowej zmiany — czekamy na następne (`after`); to następne
    // zleca scheduler (repull).
    if (what === 'pull' && (done.t === 'failed' || (done.t === 'pull_ok' && !done.needMore))) this.release(run);
    this.tick();
  }

  /** Zapis po odpowiedzi tylko w tym samym „życiu” silnika (M-55). */
  private settle(gen: number, next: (s: ClientState) => ClientState): void {
    if (gen === this.generation) this.setState(next(this.state));
  }

  private async push(gen: number): Promise<SchedulerEvent> {
    const req = pushRequest(this.state);
    const res = await this.deps.transport.push(req);
    for (const [g, v] of Object.entries(res.versions ?? {})) this.written.set(g, Math.max(v, this.written.get(g) ?? 0));
    const before = this.state;
    this.settle(gen, (s) => onPushResponse(s, res, req));
    try {
      // Zmiany są już na serwerze (także po stop()) — inni i tak powinni je dostać (D159).
      this.deps.onPushed?.(req.ops, res, before);
    } catch {
      // Powiadomienie innych to dodatek; błąd nie psuje synchronizacji.
    }
    return { t: 'push_ok', pending: pendingCount(this.state) };
  }

  private async pull(gen: number): Promise<SchedulerEvent> {
    // Odpowiedź po stop() (np. „Wyczyść dane”) przepada; wynik i tak nie trafi do harmonogramu (run).
    const needMore = await pullStep(
      () => this.state,
      (next) => this.setState(next),
      this.deps.transport,
      this.deps.now,
      () => gen === this.generation,
      (fields) => {
        try {
          this.deps.onInvalidRows?.(fields);
        } catch {
          // Zgłoszenie to dodatek; błąd nie psuje synchronizacji.
        }
      },
    );
    return { t: 'pull_ok', needMore, pending: pendingCount(this.state) };
  }
}
