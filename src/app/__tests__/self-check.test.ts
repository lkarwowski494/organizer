import type { DbAdapter } from '../../data/db/adapter';
import { memoryDb } from '../../data/__tests__/sqlite';
import * as clock from '../../domain/local-time';
import { reportSelfCheck, runSelfCheck, SELF_CHECK_KEY } from '../self-check';

const prefsMap = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, prefs: { get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) } };
};

describe('samosprawdzenie telefonu (S3, S4)', () => {
  it('na zdrowym silniku wszystko ok; wersja SQLite i JSON zapisane', () => {
    const r = runSelfCheck(memoryDb());
    expect(r.ok).toBe(true);
    expect(r.details).toMatchObject({ hermes: 'no', timezone: 'ok,ok,ok,ok,ok', upper_pl: 'ŻÓŁĆ', sqlite_json: '1', sqlite_rollback: 'ok' });
    expect(r.details.sqlite_version).toMatch(/^3\.\d+/);
    expect(r.details.failed).toBeUndefined();
  });

  it('transakcja, która się nie wycofuje, i brak SQL — zgłoszone jako błąd z nazwą sprawdzenia', () => {
    const real = memoryDb();
    const noRollback: DbAdapter = { ...real, transaction: (fn) => { try { fn(); } catch { /* bez wycofania */ } } };
    expect(runSelfCheck(noRollback)).toMatchObject({ ok: false, details: { sqlite_rollback: 'rows=1', failed: 'sqlite_rollback' } });
    const broken: DbAdapter = { exec: () => { throw new Error('no db'); }, run: () => {}, all: () => { throw 'x'; }, transaction: () => {} };
    expect(runSelfCheck(broken)).toMatchObject({ ok: false, details: { sqlite_version: 'error: x', sqlite_rollback: 'error: no db', failed: 'sqlite_version,sqlite_rollback' } });
    expect(runSelfCheck({ ...real, all: () => [] }).details).toMatchObject({ sqlite_version: '?', sqlite_json: 'undefined' });
  });

  it('strefa czasowa: rozbieżność opisana (oczekiwane≠otrzymane)', () => {
    const spy = jest.spyOn(clock, 'localNow').mockReturnValue({ y: 2026, m: 1, d: 1, hh: 0, mm: 0 });
    const r = runSelfCheck(memoryDb());
    expect(r.details.timezone?.split(',')[0]).toBe('2026-10-07 10:00≠2026-01-01 00:00');
    expect(r.details.failed).toBe('timezone');
    spy.mockRestore();
  });

  it('Hermes rozpoznany', () => {
    (globalThis as { HermesInternal?: object }).HermesInternal = {};
    expect(runSelfCheck(memoryDb()).details.hermes).toBe('yes');
    delete (globalThis as { HermesInternal?: object }).HermesInternal;
  });

  it('raz na wersję: wysyła zgłoszenie „diagnostic” i zapamiętuje; błąd wysyłki — ponowi przy następnym starcie', async () => {
    const { m, prefs } = prefsMap();
    const account = { reportError: jest.fn(async () => {}) };
    await reportSelfCheck(memoryDb(), prefs, account, '0.1.0 (14)');
    expect(account.reportError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'diagnostic', message: 'selfcheck ok', screen: 'selfcheck', appVersion: '0.1.0 (14)' }));
    expect(JSON.parse((account.reportError.mock.calls[0] as unknown as [{ stack: string }])[0].stack)).toMatchObject({ sqlite_rollback: 'ok' });
    expect(m.get(SELF_CHECK_KEY)).toBe('0.1.0 (14)');
    await reportSelfCheck(memoryDb(), prefs, account, '0.1.0 (14)');
    expect(account.reportError).toHaveBeenCalledTimes(1);

    account.reportError.mockRejectedValueOnce(new Error('offline'));
    await reportSelfCheck(memoryDb(), prefs, account, '0.1.0 (15)');
    expect(m.get(SELF_CHECK_KEY)).toBe('0.1.0 (14)');
    const noRollback: DbAdapter = { ...memoryDb(), transaction: (fn) => { try { fn(); } catch { /* bez wycofania */ } } };
    await reportSelfCheck(noRollback, prefs, account, '0.1.0 (15)');
    expect(account.reportError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'selfcheck failed: sqlite_rollback' }));
    expect(m.get(SELF_CHECK_KEY)).toBe('0.1.0 (15)');
  });

  it('bez zapamiętanych ustawień — nic nie robi', async () => {
    const account = { reportError: jest.fn(async () => {}) };
    await reportSelfCheck(memoryDb(), undefined, account, 'v');
    expect(account.reportError).not.toHaveBeenCalled();
  });
});
