/**
 * Samosprawdzenie na prawdziwym iPhonie (spike S3 i S4, O-006 i O-007): raz na wersję aplikacji telefon sprawdza to,
 * czego testy w Node nie potwierdzą, i wysyła wynik jednym zgłoszeniem rodzaju „diagnostic” (bez treści z list).
 *  - Hermes: Intl.DateTimeFormat ze strefą Europe/Warsaw, w tym przy zmianach czasu (oczekiwania jak w clock.test,
 *    policzone niezależnie: Python zoneinfo, baza IANA);
 *  - polskie wielkie litery (toLocaleUpperCase('pl'));
 *  - SQLite z expo-sqlite: wersja, funkcje JSON, wycofanie transakcji po wyjątku.
 */
import type { DbAdapter } from '../data/db/adapter';
import type { AccountApi } from '../sync/account';
import { localNow } from './clock';
import type { Prefs } from './context';

export const SELF_CHECK_KEY = 'selfCheckVersion';

export type SelfCheck = { ok: boolean; details: { [k: string]: string } };

const TZ_CASES: [ms: number, expected: string][] = [
  [Date.UTC(2026, 9, 7, 8, 0), '2026-10-07 10:00'],
  [Date.UTC(2026, 11, 31, 23, 30), '2027-01-01 00:30'],
  [Date.UTC(2026, 9, 25, 0, 59), '2026-10-25 02:59'],
  [Date.UTC(2026, 9, 25, 1, 0), '2026-10-25 02:00'],
  [Date.UTC(2026, 2, 29, 1, 0), '2026-03-29 03:00'],
];

const pad = (n: number) => String(n).padStart(2, '0');

function attempt(fn: () => string): string {
  try {
    return fn();
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function runSelfCheck(db: DbAdapter): SelfCheck {
  const details: { [k: string]: string } = {};
  const fails: string[] = [];
  const expect = (key: string, value: string, good: (v: string) => boolean) => {
    details[key] = value;
    if (!good(value)) fails.push(key);
  };

  expect('hermes', typeof (globalThis as { HermesInternal?: unknown }).HermesInternal === 'object' ? 'yes' : 'no', () => true);
  const tz = attempt(() =>
    TZ_CASES.map(([ms, want]) => {
      const l = localNow(ms);
      const got = `${l.y}-${pad(l.m)}-${pad(l.d)} ${pad(l.hh)}:${pad(l.mm)}`;
      return got === want ? 'ok' : `${want}≠${got}`;
    }).join(','),
  );
  expect('timezone', tz, (v) => v.split(',').every((x) => x === 'ok'));
  expect('upper_pl', attempt(() => 'żółć'.toLocaleUpperCase('pl')), (v) => v === 'ŻÓŁĆ');
  expect('sqlite_version', attempt(() => db.all<{ v: string }>('select sqlite_version() as v')[0]?.v ?? '?'), (v) => /^\d+\.\d+/.test(v));
  // Funkcje JSON nie są wymagane (adapter ich nie używa) — tylko zapisujemy, czy są (otwarte pytanie S4).
  expect('sqlite_json', attempt(() => String(db.all<{ j: number }>(`select json_valid('{"a":1}') as j`)[0]?.j)), () => true);
  expect(
    'sqlite_rollback',
    attempt(() => {
      db.exec('create temp table if not exists self_check (x integer)');
      db.run('delete from self_check');
      try {
        db.transaction(() => {
          db.run('insert into self_check (x) values (1)');
          throw new Error('rollback');
        });
      } catch {
        // oczekiwane
      }
      const n = db.all<{ n: number }>('select count(*) as n from self_check')[0]?.n;
      db.exec('drop table self_check');
      return n === 0 ? 'ok' : `rows=${n}`;
    }),
    (v) => v === 'ok',
  );
  return { ok: fails.length === 0, details: fails.length ? { ...details, failed: fails.join(',') } : details };
}

/** Raz na wersję: sprawdź, wyślij, zapamiętaj. Błąd wysyłki — spróbujemy przy następnym uruchomieniu. */
export async function reportSelfCheck(db: DbAdapter, prefs: Prefs | undefined, account: Pick<AccountApi, 'reportError'>, version: string): Promise<void> {
  if (!prefs || (await prefs.get(SELF_CHECK_KEY)) === version) return;
  const r = runSelfCheck(db);
  try {
    await account.reportError({
      kind: 'diagnostic',
      message: `selfcheck ${r.ok ? 'ok' : `failed: ${r.details.failed}`}`,
      stack: JSON.stringify(r.details),
      screen: 'selfcheck',
      appVersion: version,
    });
  } catch {
    return;
  }
  await prefs.set(SELF_CHECK_KEY, version);
}
