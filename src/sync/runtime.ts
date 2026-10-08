/**
 * Pętla synchronizacji w działaniu: łączy czystą logikę (sync-engine/client + scheduler) z siecią,
 * zegarem i trwałym zapisem. Ekrany czytają `getState()` i wołają `dispatch()`; wszystko poza tym
 * dzieje się tutaj. Każde przejście stanu zapisuje się przez `persist` w jednej transakcji (R1).
 */
import { config } from '../config';
import {
  type ClientState,
  mutate,
  type NewOp,
  onFetchScope,
  onPullResponse,
  onPushResponse,
  pendingCount,
  pullRequest,
  pushRequest,
} from '../domain/sync-engine/client';
import { pruneExpired } from '../domain/sync-engine/retention';
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
};

export type Snapshot = { state: ClientState; indicator: Indicator };

export class SyncRuntime {
  private state: ClientState;
  private sched: SchedulerState;
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private cancelTimer: (() => void) | null = null;
  private stopped = false;

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

  /** Zdarzenia z zewnątrz: pierwszy plan, sieć, poke z Realtime, odświeżona sesja. */
  event(e: SchedulerEvent): void {
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
    this.cancelTimer?.();
    this.cancelTimer = null;
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
    const d = decide(this.sched, now);
    if (d.do === 'push') void this.run('push');
    else if (d.do === 'pull') void this.run('pull');
    else {
      const until = d.do === 'wait' ? d.until : pendingTimer(this.sched, now);
      if (until !== null) this.cancelTimer = this.deps.setTimer(() => this.tick(), Math.max(0, until - now));
    }
  }

  private async run(what: 'push' | 'pull'): Promise<void> {
    this.sched = onEvent(this.sched, { t: 'started', what }, this.deps.now());
    this.emit();
    let done: SchedulerEvent;
    try {
      done = what === 'push' ? await this.push() : await this.pull();
    } catch (e) {
      const error = errorKind(e);
      done = error === 'fatal' ? { t: 'failed', what, error, code: (e as Error).message } : { t: 'failed', what, error };
    }
    this.sched = onEvent(this.sched, done, this.deps.now());
    this.emit();
    this.tick();
  }

  private async push(): Promise<SchedulerEvent> {
    const res = await this.deps.transport.push(pushRequest(this.state));
    this.setState(onPushResponse(this.state, res));
    return { t: 'push_ok', pending: pendingCount(this.state) };
  }

  private async pull(): Promise<SchedulerEvent> {
    const req = pullRequest(this.state);
    const res = await this.deps.transport.pull(req, config.sync.PULL_LIMIT_MAX);
    const out = onPullResponse(this.state, res, req);
    // Historia i rozstrzygnięte przekazania po terminie znikają też z telefonu (audyt 2, M-62) — w tym samym zapisie.
    this.setState(pruneExpired(out.state, this.deps.now()));
    // Nowe ukryte listy (dostęp nadany): ich wiersze mogą mieć stare wersje, więc pobieramy je w całości.
    for (const listId of out.fetchScopes) {
      const rows = await this.deps.transport.fetchScope(listId);
      this.setState(onFetchScope(this.state, rows));
    }
    return { t: 'pull_ok', needMore: out.needMore, pending: pendingCount(this.state) };
  }
}
