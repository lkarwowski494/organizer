import { config } from '../../config';
import { groupWaker, type WakeRequest } from '../wake';

const { DEBOUNCE_MS, RETRY_MS, MAX_GROUPS } = config.wake;

/** Zegar i timery pod kontrolą testu. */
function harness(reply: (r: WakeRequest) => Promise<{ retryInSec: number | null }>) {
  let now = 0;
  let timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const sent: WakeRequest[] = [];
  const w = groupWaker(
    (r) => (sent.push(r), reply(r)),
    (fn, ms) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return () => void (t.cancelled = true);
    },
  );
  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.cancelled = true;
      due.fn();
      await flush();
    }
    now = end;
    timers = timers.filter((t) => !t.cancelled);
  };
  return { w, sent, flush, advance, pending: () => timers.filter((t) => !t.cancelled).map((t) => t.at - now) };
}

describe('prośby o ciche powiadomienia (D159)', () => {
  it('seria zmian = jedna prośba po DEBOUNCE_MS od ostatniej, grupy bez powtórzeń i po kolei', async () => {
    const h = harness(async () => ({ retryInSec: null }));
    h.w.add(['g2']);
    await h.advance(DEBOUNCE_MS - 1);
    h.w.add(['g1', 'g2']);
    h.w.add([]);
    await h.advance(DEBOUNCE_MS - 1);
    expect(h.sent).toEqual([]);
    await h.advance(1);
    expect(h.sent).toEqual([{ groups: ['g1', 'g2'], retry: false }]);
    expect(h.pending()).toEqual([]);
  });

  it('wyjście z aplikacji wysyła od razu; pusto — nic', async () => {
    const h = harness(async () => ({ retryInSec: null }));
    await h.w.flush();
    expect(h.sent).toEqual([]);
    h.w.add(['g1']);
    await h.w.flush();
    expect(h.sent).toEqual([{ groups: ['g1'], retry: false }]);
    expect(h.pending()).toEqual([]);
  });

  it('serwer odkłada (przerwa u odbiorcy) — ponowienie samych zaległych po retryInSec, nie wcześniej niż RETRY_MS', async () => {
    const answers = [{ retryInSec: 600 }, { retryInSec: 1 }, { retryInSec: null }];
    const h = harness(async () => answers.shift()!);
    h.w.add(['g1']);
    await h.advance(DEBOUNCE_MS);
    await h.advance(600_000 - 1);
    expect(h.sent).toHaveLength(1);
    await h.advance(1);
    expect(h.sent[1]).toEqual({ groups: ['g1'], retry: true });
    await h.advance(RETRY_MS);
    expect(h.sent[2]).toEqual({ groups: ['g1'], retry: true });
    expect(h.pending()).toEqual([]);
  });

  it('nowa zmiana w grupie z zaległymi — zwykła prośba zastępuje ponowienie', async () => {
    const answers = [{ retryInSec: 600 }, { retryInSec: null }];
    const h = harness(async () => answers.shift()!);
    h.w.add(['g1']);
    await h.advance(DEBOUNCE_MS);
    h.w.add(['g1']);
    await h.advance(DEBOUNCE_MS);
    expect(h.sent).toEqual([{ groups: ['g1'], retry: false }, { groups: ['g1'], retry: false }]);
    expect(h.pending()).toEqual([]);
  });

  it('błąd sieci: zwykła prośba i ponowienie wracają po RETRY_MS', async () => {
    let fail = 2;
    const h = harness(async (r) => {
      if (fail-- > 0) throw new Error('sieć');
      return { retryInSec: r.retry ? null : 60 };
    });
    h.w.add(['g1']);
    await h.advance(DEBOUNCE_MS);
    expect(h.pending()).toEqual([RETRY_MS]);
    await h.advance(RETRY_MS);
    expect(h.sent.map((r) => r.retry)).toEqual([false, false]);
    await h.advance(RETRY_MS);
    expect(h.sent.map((r) => r.retry)).toEqual([false, false, false]);
    // Ponowienie po odłożeniu też może się nie udać — wraca jako ponowienie.
    fail = 1;
    await h.advance(RETRY_MS);
    expect(h.sent.at(-1)).toEqual({ groups: ['g1'], retry: true });
    await h.advance(RETRY_MS);
    expect(h.sent.at(-1)).toEqual({ groups: ['g1'], retry: true });
    expect(h.pending()).toEqual([]);
  });

  it('więcej grup niż MAX_GROUPS — kolejne prośby zaraz; zmiany w trakcie wysyłki czekają na swój czas', async () => {
    let release: () => void = () => {};
    const h = harness((r) => (r.groups.includes('g00') ? new Promise((ok) => (release = () => ok({ retryInSec: null }))) : Promise.resolve({ retryInSec: null })));
    const many = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => `g${String(i).padStart(2, '0')}`);
    h.w.add(many);
    await h.advance(DEBOUNCE_MS);
    expect(h.sent[0]!.groups).toHaveLength(MAX_GROUPS);
    // Druga wysyłka w trakcie pierwszej — ta sama obietnica.
    const again = h.w.flush();
    h.w.add(['nowa']);
    release();
    await again;
    await h.flush();
    expect(h.sent).toHaveLength(1);
    expect(h.pending()).toEqual([DEBOUNCE_MS]);
    await h.advance(DEBOUNCE_MS);
    expect(h.sent[1]!.groups).toEqual(['g20', 'nowa']);
  });

  it('pozostałe grupy bez zmian w trakcie — zaraz', async () => {
    const h = harness(async () => ({ retryInSec: null }));
    h.w.add(Array.from({ length: MAX_GROUPS + 1 }, (_, i) => `g${String(i).padStart(2, '0')}`));
    await h.advance(DEBOUNCE_MS);
    expect(h.sent.map((r) => r.groups.length)).toEqual([MAX_GROUPS, 1]);
  });

  it('stop: bez wysyłek i bez timerów', async () => {
    const h = harness(async () => ({ retryInSec: 60 }));
    h.w.add(['g1']);
    h.w.stop();
    expect(h.pending()).toEqual([]);
    h.w.add(['g2']);
    await h.w.flush();
    expect(h.sent).toEqual([]);
    const k = harness(async () => ({ retryInSec: 60 }));
    k.w.add(['g1']);
    const p = k.w.flush();
    k.w.stop();
    await p;
    expect(k.pending()).toEqual([]);
  });
});
